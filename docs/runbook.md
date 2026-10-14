# Runbook: deployment and operations

Sources: `docs/architecture.md` sections 2, 4 and 6, and `docs/requirements/decisions-addendum.md` (L, M). If this file and
those disagree, the architecture document and addendum win; fix this file.

## 1. Target topology

Status: this is the decided design. Today the API exposes `/api/*` and `/health/live`; serving the Angular build from `wwwroot/` (static files plus
`index.html` fallback) and the release packaging workflow are still to be built, so verify those steps when first deploying.

- One Windows Server on the firm intranet running **IIS**: one site, ASP.NET Core Module **in-process**, framework-dependent
  publish (`dotnet publish -c Release -r win-x64 --self-contained false`).
- The Angular production build (`frontend/dist/frontend/browser`) is copied into the app's `wwwroot/`. ASP.NET serves the static
  files and the `/api/*` endpoints from the **same origin** (no CORS, no separate front-end host). Client routes fall back to
  `index.html`.
- **Windows Authentication ON, Anonymous Authentication OFF** on the IIS site. HTTPS only (HSTS). Add the site to the browsers'
  **Intranet zone** so Edge/Chrome sign in silently (Kerberos/Negotiate).
- SQL Server access uses the app-pool identity (a gMSA is recommended) with integrated security (`Trusted_Connection`).

## 2. Configuration

Set through `appsettings.Production.json`, environment variables (`Section__Key`, double underscore) or IIS configuration. Nothing
secret lives in the repository.

| Key | Purpose |
|---|---|
| `ConnectionStrings:MatterFlow` | Application connection (DML + EXEC, no DDL; audit table INSERT/SELECT only). Example: `Server=SQLHOST;Database=MatterFlow;Trusted_Connection=True;Encrypt=True;TrustServerCertificate=False` (install a certificate on the SQL Server that the web server trusts; `TrustServerCertificate=True` disables validation of the SQL link and is for development only). |
| `AllowedHosts` | **Set to the site's real host name(s)**, for example `AllowedHosts=matterflow.firm.local` (semicolon separated). The shipped default allows only `localhost`, `127.0.0.1` and `[::1]`, so an unset value makes every request fail with 400 (host-header attacks and DNS rebinding are refused by design; security review SEC-19). |
| `ConnectionStrings:Migrations` | Connection used by the schema runner (needs DDL; a member of the `mf_migrator` role). Falls back to `ConnectionStrings:Default` if unset (a warning is logged). Use a different login from `ConnectionStrings:MatterFlow`: the application identity must be DML-only so the audit table stays append-only (architecture section 9, security review SEC-04). |
| `Security:AllowPrivilegedDatabaseIdentity` | Default `false`. In `Production` the API refuses to start when its own database identity can UPDATE, DELETE or ALTER `dbo.AuditEvent` (for example `sa`, `db_owner`). Set `true` only as a documented, temporary exception. |
| `Bootstrap:SystemAdmins` | List of accounts that become System Admin at their first sign-in. Set to `["ke\\kekim"]` (domain `KE`, SAM `kekim`; case-insensitive). As an environment variable: `Bootstrap__SystemAdmins__0=ke\kekim`. |
| `ActiveDirectory:LookupEnabled` | Optional display-name/email lookup at first login. **Off by default.** It reads AD with the web app's own identity, so enable it only after IT confirms that identity can read AD. When off or on any failure the display name falls back to `KE\sam` and an admin can edit name and email. |
| `Firm:TimeZoneId` | Default time zone, `America/New_York` (Eastern). Used when a browser does not send a valid `X-Time-Zone` header. Timestamps are always stored in UTC; users see their own local time (addendum M). |
| `Auth:Provider` | Leave unset in Production (defaults to `Windows`). `Dev` is rejected at startup unless `ASPNETCORE_ENVIRONMENT` is `Development` or `Test` (so also in Staging/UAT). |
| `Migrations:Enabled` | Default `true`. Also `LockTimeoutSeconds` (300), `CommandTimeoutSeconds` (600), `ConnectionStringName` (`Migrations`), `ScriptsFolder` (ops hotfix testing only). |
| `Seed:StarterConfiguration:Enabled` | Optional starter data (task types, workflows, forms, priorities). Default: on in Development, **off elsewhere**. Idempotent and never overwrites admin edits. `DryRun=true` only logs what it would create. |

Set `ASPNETCORE_ENVIRONMENT=Production`.

## 3. Database and migrations

- **Migrations run at startup**, before the host listens: the app takes an application lock, applies pending `db/scripts/NN-*.sql`
  scripts in order (each in one transaction), verifies checksums of applied scripts and records them in `dbo.SchemaMigration`.
  Any failure aborts the start (process exits non-zero, readiness never healthy). Details: architecture section 4.3.
- The database itself must exist and be empty or already managed by this runner. Create it once: `CREATE DATABASE MatterFlow;`.
  Script `13-security-hardening.sql` creates the database roles `mf_app` (DML + EXECUTE, no DDL, audit table INSERT/SELECT only) and
  `mf_migrator` (DDL + DML, audit rows still append-only). After the first start the DBA maps the logins, once:
  `CREATE USER [DOMAIN\\app-pool-gmsa$] FOR LOGIN [DOMAIN\\app-pool-gmsa$]; ALTER ROLE mf_app ADD MEMBER [DOMAIN\\app-pool-gmsa$];`
  and, for the separate migration login, `ALTER ROLE mf_migrator ADD MEMBER [<migration user>];`. The very first start therefore needs
  `ConnectionStrings:Migrations` (or `ConnectionStrings:Default`) with a privileged login; afterwards run the API as `mf_app` and keep the
  privileged login for deployments only. Never make the application identity `db_owner` or `sysadmin`.
- Audit protection in layers: `DENY UPDATE, DELETE` (and `ALTER` for `mf_app`) on `dbo.AuditEvent`; an INSTEAD OF trigger against
  UPDATE/DELETE; a permanently empty `dbo.AuditEventGuard` table whose foreign key makes `TRUNCATE TABLE` impossible even for sysadmin; a
  database DDL trigger against DROP/ALTER of the audit objects. A sysadmin can still disable triggers deliberately; monitor
  `sys.triggers` (`is_disabled`) and `sys.database_permissions` on the audit table as part of the periodic access review.
- Recommended: turn on `READ_COMMITTED_SNAPSHOT` once, as a DBA (cannot run inside a migration transaction): `ALTER DATABASE MatterFlow SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;` (security review SEC-17; fewer reader/writer deadlocks).
- Applied scripts are immutable (checksum guard). Fix forward by adding a new script.
- Planned, not implemented yet: a `migrate-only` command line switch (architecture 4.3 item 9) to migrate before swapping binaries.
- A `Success=0` row in `dbo.SchemaMigration` blocks startup until an operator repairs the database and removes the row.
- After migrations the app syncs the permission catalog and starter roles (first install only) idempotently
  (architecture section 4.6).
- Backups: not yet specified by the firm. Proposal pending: nightly full plus 15-minute log backups.

## 4. First login behavior

1. A user's first request creates their account just-in-time with **zero roles**; they land on **Access Pending** and can call only
   `GET /api/v1/me`.
2. If their account matches `Bootstrap:SystemAdmins`, they receive the System Admin role once, at that first sign-in (audit event
   `ADMIN_BOOTSTRAPPED`). Because it is applied once per user, an admin can later revoke it without it re-granting.
3. A System Admin opens **Administration > Users & Roles**, finds the user under *Pending access* and assigns roles. The user
   presses **Check again** (or reloads) and the permitted screens appear.
4. The last active System Admin cannot be disabled or lose the role (409 `LAST_ADMIN`).

## 5. Deployment checklist

1. IIS: install the .NET 10 Hosting Bundle; create the site and app pool (gMSA identity); Windows Authentication on, Anonymous off;
   HTTPS binding with a trusted certificate.
2. SQL Server: create the database and logins/roles (section 3).
3. Publish the API for `win-x64`, copy the Angular build into `wwwroot/`, copy to the site folder.
4. Set the configuration of section 2 (at least connection strings, `AllowedHosts`, `Bootstrap:SystemAdmins`, `Firm:TimeZoneId`). The API sends HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and a Content-Security-Policy itself; do not strip them in IIS. In IIS also set `requestFiltering/requestLimits/@maxAllowedContentLength` to 12582912 (12 MB, the email upload ceiling); the API caps every other request body at 2 MB.
5. Start the site. Check `https://<host>/health/live` (implemented today; `/health/ready` from architecture section 17 is not implemented yet).
6. Sign in as `ke\kekim`, confirm Administration is visible, then create roles and grant access to staff.
7. Confirm the site is in the Intranet zone on client machines (no credential prompt).

## 6. Troubleshooting

- **Site fails to start:** read the Windows Event Log and the application log; migration failures name the script, batch and SQL
  error. Fix the database or add a new script; never edit an applied one.
- **Everyone sees Access Pending:** expected for new accounts until an admin assigns roles; check `Bootstrap:SystemAdmins` spelling
  (`ke\\kekim` in JSON) if the admin does too.
- **Browser asks for credentials:** site not in the Intranet zone, or Anonymous Authentication is still enabled/Windows disabled.
- **Display names show as `KE\sam`:** AD lookup is off (default) or failing; an admin can edit the profile.
- **Wrong "overdue" times:** check the client sends `X-Time-Zone`; the server falls back to `Firm:TimeZoneId`.
