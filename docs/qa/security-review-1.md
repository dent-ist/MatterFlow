# Security and code review 1

Scope: everything on branch `dev` at commit `efd3572` except the in-progress Task module (`MatterFlow.WorkManagement` Application/Api, `db/scripts/12-tasks.sql`). Reviewed 2026-10-14.
Method: static reading of `docs/architecture.md` sections 5, 6, 9-11, the decisions addendum, `permission-matrix-tests.md`, `risk-register.md`, then all controllers, the Identity, Audit, Configuration/Forms, Organization, Assets, WorkflowEngine (config side), Intake and Data modules, the SQL scripts 01-11, and the Angular app. Findings marked **verified** were reproduced against a running API plus a throwaway SQL Server 2022 container (Dev auth, `Migrations` on; container removed afterwards); no repository file was changed. Findings marked **needs confirmation** are code-reading conclusions I could not reproduce here.

Effort scale: S = under 1 day, M = 1 to 3 days, L = more than 3 days (one developer, including tests).

## 1. Executive summary

The foundations are good: every controller action declares a permission policy (enforced by an architecture test and by a fail-closed convention), Access Pending and disabled-user gates cannot be bypassed on any endpoint I probed, the Dev authentication provider cannot start in a `Production` environment, the CSRF guard held up against path and header tricks, EF Core is used everywhere with parameters, there is no `innerHTML`/`bypassSecurityTrust*` in the Angular app, and `npm audit` reports zero vulnerabilities.

What needs fixing before go-live:

1. **Privilege escalation (SEC-01, High, verified).** Anyone holding `User.Manage` can grant themselves (or anyone) the System Admin role. The permission-matrix doc (PM-X-12) recommended blocking this; the code does not.
2. **Authenticated CPU denial of service in email intake (SEC-02, High, verified).** A 150 KB `.eml` with nested HTML tags makes HtmlAgilityPack burn a core for more than 15 s; the 15 s "timeout" only abandons the request, the parser keeps running (a 300 KB mail kept a core at about 90% for more than 30 s after the response). Any user with `Task.Create` (every starter role) can do this repeatedly.
3. **Last-admin guard is racy (SEC-03, Medium, verified).** Two admins deactivating each other at the same moment left zero active System Admins in 11 of 12 rounds. Recovery needs direct database access.
4. **Audit "append-only" is not enforced in a default install (SEC-04, Medium, verified).** The `mf_app` principal is never created by any script or document step, so the `DENY UPDATE, DELETE` in `03-audit.sql` is skipped silently and can never be applied later (scripts are immutable). `TRUNCATE TABLE dbo.AuditEvent` succeeds despite the INSTEAD OF trigger.
5. **ReDoS in the "portable" form pattern subset (SEC-05, Medium, verified).** `(a|aa)+$` passes the subset check; the 250 ms regex timeout is per field, so a 40-field form costs 10 s of CPU per validation request. The browser has no timeout at all.
6. Smaller but real: bootstrap admin is matched on a mutable account name (SEC-06); privileged grants such as `ADMIN_BOOTSTRAPPED` are only logged, never audited (SEC-07); no security headers, HSTS or CSP (SEC-08); `rowVersion` is optional in user, role and form-draft updates (SEC-09); Dev provider guard checks only `IsProduction` (SEC-10); a vulnerable transitive `System.Security.Cryptography.Pkcs` (SEC-11).

Counts: 2 High, 10 Medium, 9 Low, 6 Info/needs-confirmation. No Critical (unauthenticated or remote code execution) finding.

Tests executed: `MatterFlow.UnitTests` 677 passed, `MatterFlow.ArchitectureTests` 31 passed. Integration and schema suites were not run (Testcontainers); I reproduced the critical paths manually instead.

## 2. Findings

| ID | Severity | Location | Status |
|---|---|---|---|
| SEC-01 | High | `UserAdministration.cs:142-182` | verified |
| SEC-02 | High | `HtmlToText.cs:31`, `EmailParseService.cs:47-58` | verified |
| SEC-03 | Medium | `UserAdministration.cs:159,198,240-248` | verified |
| SEC-04 | Medium | `03-audit.sql:37-50`, `docs/runbook.md:44` | verified |
| SEC-05 | Medium | `PortablePattern.cs:97`, `FormEvaluator.cs:27,215-240` | verified |
| SEC-06 | Medium | `UserResolver.cs:99,133` | code reading |
| SEC-07 | Medium | `UserResolver.cs:93,106-109,130` | code reading |
| SEC-08 | Medium | `Program.cs:69-80` | verified (headers absent) |
| SEC-09 | Medium | `UserAdministration.cs:251`, `RoleAdministration.cs:87`, `FormAdminService.cs:555-570` | verified (users) |
| SEC-10 | Medium | `AuthOptions.cs:52` | code reading |
| SEC-11 | Medium | `Directory.Packages.props` (MimeKit, MsgReader, SqlClient) | tool output; reachability needs confirmation |
| SEC-12 | Medium | `FormValueRules.cs:90-104` | code reading; needs confirmation against the Task module |
| SEC-13 | Low | `UserResolver.cs:106` with `UserAdministration.cs:142-183,219-235` | verified |
| SEC-14 | Low | `PodService.cs:222-240`, `PodsController.cs:51,123` | verified |
| SEC-15 | Low | `RolesController.cs:20,27,60`, `FormsController.cs:22`, `PrioritiesController.cs` | code reading |
| SEC-16 | Low | `FormAdminService.cs:635`, `FormDefinitionResolver.cs:66`, `FormValueStore.cs:162` | code reading |
| SEC-17 | Low | `UserAdministration.cs:159-183,198-210` (deadlock), `01-init.sql` | verified once |
| SEC-18 | Low | `Program.cs:61-67`, `IdentitySeeder.cs:75` | code reading |
| SEC-19 | Low | `appsettings.json:8`, `docker-compose.dev.yml:12`, `runbook.md:33` | code reading |
| SEC-20 | Low | `AuditSaveChangesInterceptor.cs:226-243`, `StarterSeed*`, `AssetService.cs:352-359` | needs confirmation |
| SEC-21 | Low | `FormEvaluator.cs:130-142`, `FormValueStore.cs:84` | code reading |
| SEC-22 | Info | `AssetService.cs:265` | code reading |
| SEC-23 | Info | `OrganizationModule.cs:25` | code reading |
| SEC-24 | Info | `IdentityModule.cs:33-41` | needs confirmation |
| SEC-25 | Info | `EmailParseService.cs:82-93` | code reading |
| SEC-26 | Info | `Problems.cs:25-35` | verified |
| SEC-27 | Info | `docs/qa/permission-matrix-tests.md` vs code | code reading |

### SEC-01 High: User.Manage can grant System Admin (privilege escalation)

- **Location:** `backend/src/Modules/MatterFlow.Identity/Application/UserAdministration.cs:142-182` (`SetRolesAsync`), controller `UsersController.cs:55-58`.
- **Description:** `SetRolesAsync` loads any role by id (line 151), checks only that the ids exist, and writes `UserRole` rows. Nothing checks whether the role is `IsSystemAdmin`, nor whether the caller is a System Admin. `PM-X-12` in the permission-matrix doc says "only System Admin may grant System Admin (recommended)". The same gap exists one level up: `Role.Manage` can add any permission (including `User.Manage`) to a role the caller already holds.
- **Exploit (reproduced):** created role `UserMgr` with only `User.View` and `User.Manage`, assigned it to a pending user `KE\mallory`, then as mallory: `PUT /api/v1/users/4/roles {"roleIds":[1,7]}` returned 200 and `/me` showed `roles:["System Admin","UserMgr"]`, `isSystemAdmin:true`, 43 permissions. The request needed no `rowVersion`.
- **Fix:** in `SetRolesAsync` require `currentUser.IsSystemAdmin` when `toGrant` or `toRevoke` contains an `IsSystemAdmin` role (return 403 `PERMISSION_DENIED`); in `RoleAdministration.UpdateAsync/CreateAsync` reject permissions the actor does not hold unless the actor is System Admin ("no grant above own level"). Add the PM-X-12 integration test.
- **Effort:** S.

### SEC-02 High: Email intake CPU denial of service (HTML nesting), timeout does not stop the work

- **Location:** `backend/src/Modules/MatterFlow.Intake/Application/HtmlToText.cs:31` (`document.LoadHtml(html)`), `EmailParseService.cs:47-58` (`Task.Run(...).WaitAsync(timeout)`), `EmlEmailParser.cs:36-40`, `MsgEmailParser.cs:30-31`. Endpoint `POST /api/v1/intake/parse-email`, policy `Task.Create`.
- **Description:** HtmlAgilityPack 1.13.1 `LoadHtml` is super-linear in element nesting depth. Measured on this machine: 8,000 nested `<div>` 0.6 s, 16,000 2.7 s, 32,000 17.6 s (a 160 KB payload). The conversion walk itself is iterative and fine; the parse is the cost. `EmailParseService` runs the parse in `Task.Run` and abandons it after `ParseTimeout` (15 s) via `WaitAsync`, but `HtmlToText.Convert` and the MSG parser do not observe the cancellation token, so the thread keeps burning CPU.
- **Exploit (reproduced):** an `.eml` with `Content-Type: text/html` and 30,000 `<div>` (150 KB): response after 15.07 s with "Reading the email took too long". A 60,000 `<div>` mail (300 KB): response after 15.05 s, and the API process stayed at 84 to 100% of a core for at least 30 more seconds. A handful of concurrent requests from one authenticated user saturates all cores of the single IIS server for minutes (the 10 MB limit allows about 2 million nested tags, i.e. effectively unbounded). Memory is a second axis: each request holds roughly 4 to 5 copies of up to 10 MB (IFormFile buffer, `ReadCappedAsync` buffer, `ToArray`, MemoryStream, parsed tree). Other measured slow-but-bounded MimeKit inputs: a 9 MB `Subject` header 6.5 s, 6.8 MB of encoded words 3.1 s, 5.9 MB address list 2.5 s.
- **Fix:** (1) before parsing, reject or truncate HTML larger than about 1 MB and, with a single pass over the string, reject nesting deeper than about 200 (or set `HtmlDocument.MaxDepthLevel` and cap input size); (2) cap header size and total parse input for EML (MimeKit `ParserOptions` limits, or pre-scan); (3) add a global concurrency limiter for intake (for example `SemaphoreSlim(2)`) and an ASP.NET `RateLimiter` policy per user; (4) make the timeout real: poll `CancellationToken` in `HtmlToText` between steps and, for the MSG/HAP calls that cannot be cancelled, run the parse in a bounded worker with a hard budget, or accept only `text/plain` plus a small HTML cap. Add a regression test with 50,000 nested tags that must return within 2 s.
- **Effort:** M.

### SEC-03 Medium: Last-admin guard is a check-then-act race (and deadlocks give 500)

- **Location:** `UserAdministration.cs:159` (role revoke), `:198` (deactivate), `:240-248` (`WouldLoseLastAdminAsync`), `AdminGuards.cs:14-19`.
- **Description:** the guard reads the active admin list, then saves later, with no lock, transaction isolation or constraint. Two admins acting on different users never touch the same row, so `rowVersion` does not help. Self-deactivation is blocked but the cross pair (A deactivates B while B deactivates A) is not. The same applies to two admins each revoking the other's System Admin role.
- **Exploit (reproduced):** with admins `kekim` and `mallory`, 12 rounds of simultaneous `PUT /users/{other}/status {isActive:false}`: 1 round returned 200/403, 11 rounds returned 200/200 and left **0 active System Admins** (verified in `dbo.AppUser` joined to the admin role). Recovery requires SQL access. An earlier attempt hit a SQL deadlock (victim got a 500 with a transient-failure message in the log) because readers block writers (see SEC-17).
- **Fix:** serialize the admin-affecting operations: inside one transaction take `sp_getapplock 'MatterFlow.AdminGuard'` (Exclusive, Transaction owner) or `SELECT ... FROM dbo.Role WITH (UPDLOCK, HOLDLOCK) WHERE IsSystemAdmin=1` before the guard query, then re-check, save, commit. Map deadlock victims (error 1205) to a retry. Optional belt and braces: a trigger on `UserRole`/`AppUser` that refuses to leave zero active admins.
- **Effort:** S.

### SEC-04 Medium: Audit append-only is not enforced in a default install (High if the audit trail is relied on as legal evidence)

- **Location:** `db/scripts/03-audit.sql:37-50`, `docs/runbook.md:44`, `docs/architecture.md:83,545`, `SchemaMigrationExtensions.cs:57-61`.
- **Description:** three weaknesses. (a) The `DENY UPDATE, DELETE ... TO mf_app` block runs only `IF DATABASE_PRINCIPAL_ID('mf_app') IS NOT NULL`. No script, doc step or code creates `mf_app` or `mf_migrator` (grep of the whole repo; the runbook only says "a login mapped to `mf_app`"). On a fresh database the principal does not exist when script 03 runs, so the DENY and GRANT are skipped, and the script is immutable and recorded, so they will never be applied later. (b) The INSTEAD OF trigger blocks `UPDATE`/`DELETE` but **not `TRUNCATE TABLE`**, and can be dropped or disabled by anyone with `ALTER`. (c) The runner falls back to the app connection string (docs: "in small installs one login may hold both"), so the app identity has DDL and can remove the trigger.
- **Verified:** on a fresh container, `sys.database_permissions` for `dbo.AuditEvent` was empty, `DATABASE_PRINCIPAL_ID('mf_app')` was NULL, `DELETE FROM dbo.AuditEvent` was rejected by the trigger, and `TRUNCATE TABLE dbo.AuditEvent` removed all 133 rows.
- **Fix:** add a new script (04+ style, e.g. `13-audit-hardening.sql`, or an install script run by the DBA) that creates `mf_app`/`mf_migrator` roles if missing and applies `GRANT INSERT, SELECT` / `DENY UPDATE, DELETE, ALTER` on the table unconditionally; add a DDL trigger or `DENY ALTER ON dbo.AuditEvent` for the app role; document that `ConnectionStrings:Migrations` must be a different login; have the app log an error at startup if `HAS_PERMS_BY_NAME('dbo.AuditEvent','OBJECT','DELETE') = 1` for the app login. Add a SchemaTest that connects as a restricted login and asserts DELETE/TRUNCATE/DROP TRIGGER fail.
- **Effort:** M.

### SEC-05 Medium: ReDoS in form-field patterns; 250 ms timeout is per field, none in the browser

- **Location:** `PortablePattern.cs:97` (only rejects an unbounded quantifier on a group that itself contains an unbounded quantifier), `FormEvaluator.cs:27,215-240` (`RegexTimeout = 250 ms`, `RegexOptions.ECMAScript`), `projects/form-engine/src/lib/rules/evaluator.ts:419` (`new RegExp(pattern).test(s)`), `designer-model.ts:622`.
- **Description:** the subset check does not detect alternation or overlapping sequences under a quantifier, so `(a|aa)+$` is "portable". A timeout returns "no match" (fails closed), which is correct, but each field burns the full 250 ms.
- **Exploit (reproduced with the real `FormEvaluator`):** a 40-field form where each text field has pattern `(a|aa)+$` and the input is 60 `a` plus `!` took **10.1 s** for one `Evaluate` call (40 x 250 ms). The endpoint `POST /api/v1/forms/versions/{id}/validate` is open to every `Task.View` holder, and the same evaluator runs on every Task, Asset, Client, Matter and Project save. The prerequisite is a published form containing such a pattern (a form designer with `TaskType.Manage`/`Workflow.Manage`/`AssetType.Manage`/`CustomField.Manage`, or an honest mistake such as `(\w|\d)+`). In the browser the same pattern freezes the tab, because JavaScript regex has no timeout.
- **Fix:** tighten the subset (reject a quantified group that contains `|`, reject nested quantifiers of any bound above a small product, reject adjacent overlapping quantified atoms) at publish time in both .NET and TypeScript with shared vectors; add a total regex budget per evaluation (for example stop evaluating further patterns after 500 ms); consider `RegexOptions.NonBacktracking` with ASCII classes written out explicitly instead of `ECMAScript` (rewrite `$` as `\z`, `\d` as `[0-9]`, `\w` as `[A-Za-z0-9_]`); cap text length before matching when `MaxLength` is absent (see SEC-21).
- **Effort:** M.

### SEC-06 Medium: Bootstrap System Admin is matched on a mutable account name

- **Location:** `UserResolver.cs:99` (`BootstrapAppliedAt is null && IsBootstrapAdmin(external.Username)`), `:133-134`, `UserResolver.cs:109` (username refreshed from the directory on every login).
- **Description:** the grant is keyed on `DOMAIN\sam` text, not on the SID that identifies the user. Any later, new `UserIdentity` whose name equals `KE\kekim` and whose `AppUser.BootstrapAppliedAt` is NULL receives System Admin. Realistic cases: the real account is deleted and the sAMAccountName is recycled for another person, or an AD admin renames an account. Case differences are handled correctly (`OrdinalIgnoreCase`). Re-application after revocation is correctly prevented per user, but a new user is always eligible forever.
- **Fix:** apply the bootstrap grant only while the system has no System Admin and never had one (for example, no `UserRole` row on the admin role, `BootstrapAppliedAt` not set for any user); optionally allow `Bootstrap:SystemAdmins` entries to be SIDs; write the audit events (SEC-07); log at Warning every time a name in the list is seen but not applied.
- **Effort:** S.

### SEC-07 Medium: Privileged grants and identity changes are not audited

- **Location:** `UserResolver.cs:93` (provisioning, log only), `:105-110` (`ExecuteUpdateAsync` of `LastLoginAt` and `Username` bypasses the audit interceptor), `:117-131` (bootstrap grant, log only), `UserRole` and `UserIdentity` are not `[Audited]` (`IdentityEntities.cs`).
- **Description:** architecture 6.1 and 6.4 and the runbook promise `USER_PROVISIONED` and `ADMIN_BOOTSTRAPPED` audit events. Grep finds the strings only in a log line. The bootstrap grant of the most powerful role therefore leaves only a `FIELD_CHANGED BootstrapAppliedAt` row with no actor, and a changed `UserIdentity.Username` (which feeds SEC-06) leaves nothing.
- **Fix:** write explicit `AuditEntry` rows for both events through `IAuditWriter` before `SaveChanges`; replace the `Username` `ExecuteUpdate` with a tracked update on the audited path, or write a `USER_IDENTITY_RENAMED` entry; add integration tests that assert the rows exist (R-07 "coverage matrix").
- **Effort:** S.

### SEC-08 Medium: No security headers, HSTS, HTTPS redirection or CSP; SPA hosting not wired

- **Location:** `backend/src/MatterFlow.Api/Program.cs:61-80`, `appsettings.json`.
- **Description:** architecture 6.1/6.6 specify `UseHttpsRedirection`, `UseHsts`, static files and a middleware that sets CSP `default-src 'self'`, `X-Content-Type-Options`, `frame-ancestors 'none'`. None of this exists. Verified response headers of `GET /api/v1/system/ping`: only `Content-Type`, `Date`, `Server: Kestrel`, `Transfer-Encoding`. No `Cache-Control: no-store` on authenticated JSON either (user lists, audit events may be cached by the browser or an intercepting proxy). The runbook states HTTPS and static hosting are "still to be built". The Angular `index.html` has no CSP meta.
- **Fix:** add a small middleware (or `UseSecurityHeaders`) with CSP (`default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`; PrimeNG needs `style-src 'self' 'unsafe-inline'` unless nonces are used), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` for `/api`, `UseHsts` outside Development, `AddServerHeader=false`; test headers in an integration test; set `AllowedHosts` (SEC-19).
- **Effort:** S.

### SEC-09 Medium: `rowVersion` is optional in several update paths (lost update)

- **Location:** `UserAdministration.cs:251` (`rowVersion is not null && ...`), `RoleAdministration.cs:87`, `FormAdminService.cs:555-570` (`TryApplyRowVersion` returns true for empty), `SaveFormDraftRequest.RowVersion` and `Publish ... [FromQuery] string? rowVersion` (`FormsController.cs:117-123`), pod member add/remove (no version, acceptable as set semantics).
- **Description:** architecture 10 and risk R-05 require a mandatory `rowVersion` on every update ("contract test fails for a DTO lacking it"). Organization, Assets, Configuration lookups, Task Types and Workflows enforce it (`[Required]` plus `ExpectVersion`); Identity admin and form drafts do not. Two admins editing the same role permission set, or two designers saving the same form draft, silently overwrite each other (draft save replaces the whole field list).
- **Verified:** `PUT /users/4/roles` with no `rowVersion` was accepted (SEC-01 reproduction).
- **Fix:** make `RowVersion` `[Required]` in `SetUserRolesRequest`, `SetUserActiveRequest`, `UpdateUserProfileRequest`, `SaveRoleRequest` (update only), `SaveFormDraftRequest`, and the publish endpoint; reuse `WorkflowSupport.ExpectVersion`. Add the contract test the risk register describes (every non-create request DTO has a required `rowVersion`).
- **Effort:** S.

### SEC-10 Medium: Dev provider guard only checks `IsProduction`

- **Location:** `AuthOptions.cs:52` (`provider == AuthProvider.Dev && environment.IsProduction()`), `DevAuthenticationHandler.cs:27-33` (header `X-Dev-User` and query `devUser`, then `Auth:Dev:DefaultUser`), default provider selection `AuthOptions.cs:36-40`.
- **Description:** with `ASPNETCORE_ENVIRONMENT=Staging` (or `UAT`, `Test`, any other name) and `Auth:Provider=Dev`, every caller can become any user, including `KE\kekim`, by sending one header or a URL (`?devUser=KE\kekim`, which is also a GET-only login-CSRF vector). The environment name is the only barrier; the runbook only says `Dev` is "rejected at startup when ASPNETCORE_ENVIRONMENT=Production". An accidental `Auth__Provider=Dev` in a copied `appsettings` on a pre-production box with real data is plausible. In `Production` the guard works (code path and `Dev_provider_cannot_be_enabled_in_production` test; `Dev:Users` seeding also requires Dev).
- **Fix:** allow Dev only when `environment.IsDevelopment()` (and optionally a named `Test` environment used by the factory); additionally refuse Dev when any non-loopback URL is bound; make the integration test cover `Staging`.
- **Effort:** S.

### SEC-11 Medium: Vulnerable transitive package `System.Security.Cryptography.Pkcs` (High advisory)

- **Location:** `dotnet list package --vulnerable --include-transitive` on all projects. Resolved 10.0.12 via MsgReader 6.2.0 and MimeKit 4.18.1 (Intake), 9.0.4 via Microsoft.Data.SqlClient 6.1.1 (all data-using projects). Advisories GHSA-846f-f764-76mx (High) and GHSA-2fmv-rv2c-59x7 (Moderate).
- **Description:** CPM transitive pinning is enabled in `Directory.Packages.props` but this package is not pinned. Reachability: the intake parsers never verify S/MIME, but MsgReader's `EmailClearSigned`/`EmailEncryptedAndMaybeSigned` handling and MimeKit's S/MIME support can touch CMS decoding for attacker-supplied files (**needs confirmation**). CI has no vulnerability gate (`ci.yml`, `nightly.yml` contain no `list package --vulnerable` or `npm audit`); a fresh restore with `CI=true` may start failing on NuGetAudit warnings treated as errors.
- **Fix:** add `<PackageVersion Include="System.Security.Cryptography.Pkcs" Version="[patched 10.0.x]" />` (check the advisory for the fixed version); add `dotnet list package --vulnerable --include-transitive` (fail on High) and `npm audit --omit=dev` as nightly steps; keep Dependabot.
- **Effort:** S.

### SEC-12 Medium: ASSET_REF and USER_REF values are not checked against the data

- **Location:** `FormValueRules.cs:90` (`IsPositiveInteger` is the whole check), `FormValueStore.cs`, no hook in `IFormValueStore`; `ErrorCodes.CrossMatterReference` is defined (`ErrorCodes.cs:31`) but never produced.
- **Description:** a form field of type `ASSET_REF` or `USER_REF` accepts any positive integer. The stored JSON has no foreign key, so a Task or Asset form can point at a nonexistent id, an asset of another Matter, an inactive asset, or an inactive user. The architecture lists `CROSS_MATTER_REFERENCE` as a rule. This is data integrity and a minor cross-Matter data link (Phase 1 visibility is open, so no confidentiality breach today, but ethical walls are planned).
- **Fix:** add an optional reference validator to the form submission pipeline (`IFormReferenceChecker` implemented by Assets and Identity) called from `FormSubmissionValidator.Evaluate` for visible `ASSET_REF`/`USER_REF` fields with the owner's MatterId; return `INVALID_REFERENCE`/`CROSS_MATTER_REFERENCE`. Needs confirmation how the Task module intends to do this.
- **Effort:** M.

### SEC-13 Low: Admin edits of their own user record fail with a false 409 on the first request after the cache expires

- **Location:** `UserResolver.cs:106` (`ExecuteUpdateAsync` bumps `RowVersion` in the database after the entity was tracked), then `UserAdministration.cs:142-183` / `219-235` reuse the same scoped `DbContext` and get the stale tracked `AppUser`.
- **Description:** the resolver loads `AppUser` into the request's DbContext, bumps `LastLoginAt` with a set-based update (row version changes in SQL, not in the tracked entity), and the controller's `FirstOrDefaultAsync` returns that stale tracked instance, so the UPDATE's `WHERE RowVersion = <stale>` hits 0 rows.
- **Verified:** after the 60 s cache expired, `PUT /users/4` (own profile, correct `rowVersion`) returned 409 `CONCURRENCY_CONFLICT`; the identical retry succeeded.
- **Fix:** resolve identity with a separate `DbContext`/`AsNoTracking` query (and `ExecuteUpdate` for bookkeeping), or `db.Entry(appUser).Reload()` after the bookkeeping update, or detach tracked entities at the end of resolution. Add an integration test: first self-edit after cache expiry succeeds.
- **Effort:** S.

### SEC-14 Low: Role names and e-mail addresses of pod members are visible to every Pod.View holder

- **Location:** `PodService.cs:222-240` (`ToDetailAsync` returns `Email` and `Roles` per member), `PodsController.cs:51,123` (`GET /pods/{id}`, `GET /users/{userId}/pods`).
- **Description:** `Pod.View` is in every starter role. Any technician can see who the System Admins are and everybody's e-mail through pod membership. Confirmed: a Data Technician saw `"roles":["System Admin"]` for the pod members. Low impact in a 250-person firm, but the matrix doc treats `GET /users` as `User.View`-only.
- **Fix:** drop `Roles` and `Email` from `PodMemberDto` unless the caller has `User.View`; or accept and document.
- **Effort:** S.

### SEC-15 Low: Read endpoints deviate from the permission-matrix doc

- **Location:** `RolesController.cs:20,27,60` (`GET /roles`, `/roles/{id}`, `/permissions` need `User.View`, doc says `Role.Manage`); `FormsController.cs:22` (class policy `Task.View` for published/retired schema reads of every owner kind, doc says "any permission that can render the form"); `PrioritiesController.cs`, `StatusLabelsController.cs`, `AssetLinkRolesController.cs`, `TaskTypesController.cs` (reads need `Task.View`, doc says "any authenticated app user with any permission").
- **Description:** role definitions are readable by `Director` (`User.View`) which is arguably intended (the user drawer needs it), but the doc and code disagree. A user with `Asset.View` or `Client.Edit` but no `Task.View` cannot load the asset or custom-field form schema (functional break, not a leak). Conversely any `Task.View` holder can read published schemas of Step, AssetType and Client forms (low sensitivity configuration).
- **Fix:** decide per endpoint and update either the doc or the code; for form schemas, authorize by owner kind (Task.View for TaskType/Step, Asset.View for AssetType, Client/Matter/Project.View for custom fields).
- **Effort:** S.

### SEC-16 Low: Duplicate-key detection by message text is locale dependent

- **Location:** `FormAdminService.cs:635`, `FormDefinitionResolver.cs:66`, `FormValueStore.cs:162` (`Message.Contains("duplicate key")`); the rest of the code uses SQL error numbers 2601/2627 correctly.
- **Description:** on a SQL Server with a non-English message language (or a different wording), a lost race returns 500 instead of the intended 409/idempotent behaviour.
- **Fix:** use `SqlException.Number is 2601 or 2627` like `WorkflowSupport.IsDuplicateKey`.
- **Effort:** S.

### SEC-17 Low: Deadlocks under concurrent admin writes; READ_COMMITTED_SNAPSHOT is not set

- **Location:** `docs/architecture.md:557` says `READ_COMMITTED_SNAPSHOT ON` is set in `01-init.sql`; `db/scripts/01-init.sql` does not do it (grep finds nothing in `db` or `backend`). No retry for error 1205.
- **Verified:** one of the first concurrent deactivation attempts produced a SQL deadlock and a 500 response.
- **Fix:** set RCSI in the DBA install script (cannot run inside the migration transaction) and verify it at startup/health; translate 1205 into a retried unit of work or a 409.
- **Effort:** S.

### SEC-18 Low: Startup seeds are coupled to the migration flag and not serialized

- **Location:** `Program.cs:61-67` (module seeds run only when `Migrations:Enabled`), `IdentitySeeder.cs:40-46,75`.
- **Description:** (a) with `Migrations:Enabled=false` (separate migrate step) the permission catalog and starter roles are never synced after upgrades; new permission codes stay missing. (b) Two instances starting together both insert catalog rows and one dies on the unique index (the runner has an app lock, the seeds do not). (c) `SeedStarterRolesAsync` re-creates the five starter roles whenever no non-system role exists, so deleting all custom roles resurrects them on the next restart.
- **Fix:** run seeds under the same applock, independent of `Migrations:Enabled`; record "starter roles seeded" in a table or setting instead of inferring from role count.
- **Effort:** S.

### SEC-19 Low: Configuration hygiene

- `appsettings.json:8` `"AllowedHosts": "*"` (host-header and DNS-rebinding exposure for an intranet Windows-auth app). Set to the real host names.
- `docs/runbook.md:33` example connection string uses `TrustServerCertificate=True`, which disables TLS certificate validation of the SQL link. Prefer a trusted certificate and `Encrypt=True;TrustServerCertificate=False`.
- `docker-compose.dev.yml:12` publishes SQL Server `sa` with a known password on all interfaces (`"1433:1433"`); bind to `127.0.0.1:1433:1433`.
- No request-size limit below Kestrel/IIS defaults (about 30 MB) on JSON endpoints and no rate limiting; a 25 MB JSON body is fully read before validation (returned 400 in 0.15 s, 5 million-element array 1.3 s, so bounded but wasteful). Add a global `RequestSizeLimit` (for example 1 MB) with the intake endpoints as the exception.
- Origin validation promised by architecture 6.6 is not implemented (only `Sec-Fetch-Site` and the custom header); acceptable because of the custom header, but update the doc.
- `Server: Kestrel` header (see SEC-08).
- **Effort:** S together.

### SEC-20 Low (needs confirmation): Audit rows can fail the business operation on over-long summaries

- **Location:** `AuditSaveChangesInterceptor.cs:226-243` copies `AuditEntry.Summary` into `NVARCHAR(500)` (`03-audit.sql`) without clipping; summaries are built from variable data, for example `"Hidden values dropped: " + string.Join(", ", keys)` in `FormValueStore.cs:96-104` and `AssetService.cs:352-359`.
- **Description:** a form with many hidden fields with long keys (64 chars allowed) can exceed 500 characters, causing SQL error 2628 and a 500 for a legitimate save, because audit failure fails the operation by design. Not reproduced.
- **Fix:** clip `Summary` to 500 in `Materialize` (and `ObjectId` 40, `FieldKey` 100) with a unit test.
- **Effort:** S.

### SEC-21 Low: Text values have no server-side length cap when the field defines none

- **Location:** `FormEvaluator.cs:130-142` (`MaxLength` optional), `FormValueRules.IsValidType`, `dbo.FormValueSet.ValuesJson NVARCHAR(MAX)`.
- **Description:** any text/textarea field without `MaxLength` accepts values up to the request limit (about 30 MB), also fed to regexes (SEC-05) and the audit table (`OldValue/NewValue NVARCHAR(MAX)`). `CustomFieldIndex.ValueText` is clipped to 450.
- **Fix:** enforce a platform default maximum (for example 20,000 chars for TEXTAREA, 1,000 for TEXT) in `FormEvaluator` and in publish validation (default when absent), with a global JSON body limit (SEC-19).
- **Effort:** S.

### Info and needs-confirmation items

- **SEC-22 Info:** `AssetService.cs:265` (`GetAsync`) calls `EnsureDefinitionAsync`, which can insert a `FormDefinition` and an audit row on a GET (only when an asset type lacks a definition; `AssetTypeService.cs:83` normally creates it). Safe-method side effects bypass the CSRF guard; make reads use the non-creating `FindIdAsync`.
- **SEC-23 Info:** `OrganizationModule.cs:25` registers `NoTasksMatterTaskGuard` (always 0 open tasks) with `TryAdd`. Until the Task module registers the real guard, `POST /matters/{id}/active` can deactivate a Matter with open Tasks. Make sure the Task module's registration is added before `AddOrganizationModule` or replaces it, and add a startup assertion.
- **SEC-24 Info (needs confirmation):** the host registers `AddNegotiate()` (`IdentityModule.cs:33-41`) while the runbook deploys behind IIS in-process. Microsoft documents `IISServerDefaults.AuthenticationScheme` for IIS; whether the Negotiate handler defers to IIS's own authentication and yields a principal with `ClaimTypes.PrimarySid` must be proven in the planned Windows rehearsal (R-09, WIN-01..08). If the handler does not defer, every request is a 401. The subject fallback `name.ToUpperInvariant()` when no SID is present is a weaker identity key and should log a warning.
- **SEC-25 Info:** `MaxEmailBytes` is 10 MB (`EmailIntakeModels.cs:47`) and the whole message is read into memory; real `.msg` files with a few large attachments exceed that and the user is told to paste text. Functional, not a vulnerability; consider a streamed OLE reader that skips attachment streams.
- **SEC-26 Info:** framework-generated 405 responses carry `code: INTERNAL_ERROR` (`Problems.cs:25-35` has no mapping for 405). Cosmetic, but clients may treat it as a server error.
- **SEC-27 Info:** documentation drift to fix when closing: the audit endpoint is `/api/v1/audit/events` (doc: `/audit`); `/client-log` does not exist; `ADMIN_BOOTSTRAPPED`/`USER_PROVISIONED` are described as audit events but are logs (SEC-07).

## 3. Verified OK (checked and found sound)

**Authorization**
- Every controller action in Identity, Organization, Assets, Configuration, WorkflowEngine, Audit, Intake and Api declares a policy; the only anonymous action is `SystemController.Ping`, the only authenticated-only action is `MeController.Get` (architecture tests `AuthorizationRulesTests`, 31/31 pass; I also enumerated every action by hand against `permissions.json`). Unannotated actions fall to `NonPending` through `FailClosedConvention`.
- Policy-to-permission mapping matches the catalog semantics for: users (`User.View` read, `User.Manage` write), roles (`Role.Manage` write), pods (`Pod.View`/`Pod.Manage`/`Pod.ManageMembers`), clients/matters/projects (View/Create/Edit/EditNumber/SetActive/Archive as separate policies, number change only on the `/number` endpoints), assets and asset types, task types, priorities, status labels, asset link roles, step definitions and workflows (`Workflow.Manage`, with draft reads gated in the service), audit (`Audit.View`), intake (`Task.Create`). Form design operations are gated per owner kind in the service (`FormPermissions.ManageFor`), including reading definitions and drafts; verified that a Data Technician gets 403 on `/forms/by-owner`, `/step-definitions`, `/workflows`, `/users`, `/roles`, `/permissions`, `/audit/events`.
- Access Pending and disabled gates: evaluated in `AccessAuthorizationHandler` for every requirement type; pending users get 403 `ACCESS_PENDING` on every permission endpoint, disabled users 403 `ACCOUNT_DISABLED` including `/me`; order of checks authentication, then pending/disabled, then permission, then validation (no existence oracle). System Admin implicit permissions limited to active users.
- Mass assignment: all request types are explicit DTOs; `UpdateAssetRequest` accepts `MatterId`/`AssetTypeId` only to reject changes (`ImmutableField`); number changes cannot ride on `Update` requests; `IsActive` on Client is part of `Client.Edit` by design.
- IDOR: under the Phase 1 decision "Task.View sees all" there is no per-record ownership to bypass; Matter/Client/Project ids in bodies are validated for existence and activity (`AssetService.CreateAsync`, `MatterService.CreateAsync`).
- Dev provider: `AuthProviderSelection.Resolve` throws for `Dev` in `Production`; the Dev scheme and `X-Dev-User` handler are registered only when the resolved provider is Dev; `Dev:Users` seeding is behind the same check; default in non-Development is Windows (but see SEC-10 for other environment names).
- Bootstrap: case-insensitive match works, applied once per user (`BootstrapAppliedAt`), not re-applied after revocation (integration test `Bootstrap_admin_is_granted_system_admin_once_case_insensitively`), non-listed users never bootstrapped (see SEC-06/07 for the gaps).
- Permission cache: generation counter prevents a load racing an invalidation from caching stale data; role, user-role, user status and profile changes all invalidate; catalog sync invalidates all; scale-out lag is documented (60 s).
- JIT provisioning race: single `SaveChanges` for user plus identity, unique index `UQ_UserIdentity_Provider`, retry loop with `ChangeTracker.Clear()`; integration test `Concurrent_first_requests_create_exactly_one_user`.
- Permission catalog: `permissions.json` (43 codes), `Permissions.cs` and the Angular `permissions.ts` match exactly (scripted comparison); removed codes are marked inactive; starter role matrix equals architecture 6.3.

**Request forgery and transport**
- `RequestForgeryGuard` verified empirically: POST without `X-MatterFlow-Client` returns 400, form content types 400, `Sec-Fetch-Site: cross-site`/`same-site` 403, `same-origin`/absent pass the header check, safe methods exempt; path variants `/API/...`, `/%61pi/...`, `/api/.../`, `/./api/...`, `/x/../api/...` are guarded, and `//api/...` is not routed at all (404), so no bypass. The guard runs before authentication and routing.
- No CORS policy is configured, so cross-origin reads and credentialed fetches are denied by default; a cross-origin preflight to the API returned 405 without `Access-Control-*` headers. The Angular interceptor adds the header for every non-GET/HEAD request.
- No open redirects (`window.location.assign('/')` is the only navigation), no outbound HTTP anywhere in the backend (no SSRF), documentation URLs are limited to `http`/`https` (`WorkflowSupport.OptionalUrl`) and never fetched.

**Input, output and injection**
- SQL: EF Core LINQ everywhere; the single raw SQL (`MatterService.cs:277`) is a `FromSql` interpolated string, which EF parameterizes; `LIKE` searches escape `\ % _ [` and use parameters; migration script names/checksums are passed as parameters; sort fields come from whitelists.
- XSS: no `innerHTML`, `bypassSecurityTrust*`, `DomSanitizer`, `eval` or `document.write` in `frontend/src` or `projects`; the one dynamic `[href]` (`asset-detail-page.ts:85`) is behind `^https?://\S+$` and `rel="noopener noreferrer"`; help text and instructions render through interpolation. Email HTML is converted to plain text by an allow-nothing, iterative walker (`HtmlToText`), scripts/styles/iframes/images dropped, output capped.
- Email parsing hygiene: in-memory only (no temp files, no paths; only the upload's extension is read), content decided by signature, MIME depth capped at 24, attachments never touched, logs never contain email content, failure messages never echo content. Pasted-text path with pathological inputs (9 MB of dashes, 5 M blank lines, 4 MB whitespace in the date, 3 MB name, 2 M open parentheses) answered in 0.02 to 0.7 s thanks to 250 ms regex timeouts. 400 randomly mutated `.msg` files (OpenMcdf/MsgReader 6.2.0) produced only 200/400 answers within 0.1 s, no crash or hang; a 8 MB `.msg` parsed in 0.1 s. MIME bombs of 250,000 parts took 1.7 s, 170,000 headers 0.4 s, 3,000 nested multiparts 5 ms.
- JSON: enum string converter and strict number handling, default max depth 64, FluentValidation not used; `Dictionary<string, JsonElement>` values are validated against the published schema and unknown keys are rejected with `UNKNOWN_FIELD`.
- Error responses: 500 returns only `traceId` (no stack or inner message); model-state errors use property paths only; framework 404/401/415 use the same envelope. Exceptions are logged server-side only and `EnableSensitiveDataLogging` is not on.
- Logging: no log statement writes e-mail addresses, form values, comment text or privileged text (grep of all `Log*` calls; only account names, user ids, script names and counts); `Redaction` helpers exist and `AuditEvent.ToString()` masks values.
- Time zone header: character whitelist, 64-char limit, IANA form only, falls back to the firm zone (no path traversal into zoneinfo).

**Data integrity**
- Concurrency: mandatory `rowVersion` plus conditional UPDATE (`TrackOriginalRowVersion`/`ExpectVersion`) on Clients, Matters, Projects, Assets, Asset Types, Task Types, Priorities, Status Labels, Asset Link Roles, Step Definitions, Workflows and Pods; Matter deactivation takes `UPDLOCK` and rechecks (`MatterService.SetActiveAsync`). Gaps listed in SEC-09.
- Audit design: audit rows are written in the same transaction as the change (interceptor opens one when the caller has none, rolls back on failure, re-queues explicit entries, `_flushing` guard prevents recursion); verified UPDATE and DELETE on `AuditEvent` are blocked by the trigger (message "append-only"); see SEC-04 for what is missing.
- Immutability triggers for published/retired form and workflow versions (`TR_FormVersion_Immutable`, `TR_FormField_Immutable`, `TR_FormFieldOption_Immutable`, workflow equivalents) back up the service guards; `ExecuteDeleteAsync` calls in `FormAdminService` are covered by them.
- Migration runner: numeric prefix ordering, `sp_getapplock` exclusive, SHA-256 checksum on normalized content, duplicate prefix/removed/out-of-order detection, failed script recorded and blocks startup, XACT_ABORT inside a transaction, script names parameterized, unit and schema tests exist. Residual: it uses the app identity when `ConnectionStrings:Migrations` is unset and falls back to `Default` rather than `MatterFlow` (fails loudly, so safe).
- Seeds: starter configuration is off outside Development (`StarterConfigurationOptions.From`), idempotent, runs as a scoped `SeedActor` that is inactive for HTTP requests; seed roles carry no user-management permissions except the documented `Director`/`Compliance Auditor` view rights.
- Number normalization: `BusinessNumber` accepts only ASCII digits, 1-5 chars, rejects all-zero, trimmed, stored `char(5)` with DB CHECK constraints (`CK_Client_Number`, `CK_Matter_Number`) and unique indexes; list search uses the same parser.
- Secrets: none in the repository or the last 60 commits; `docker-compose.dev.yml` has a dev-only `sa` password (see SEC-19); `.gitignore` excludes `.env*`, `*.local.json`.

**Frontend**
- No tokens or credentials in JavaScript (Windows integrated auth); `localStorage` only holds the dev stub scenario; production build uses `environment.production.ts` (`authProvider: 'api'`) via `fileReplacements`; route guards (`accessGuard`, `permissionGuard`, `pendingOnlyGuard`) are described and implemented as usability only, with the server enforcing every permission. Fail-closed: unauthenticated or load failure goes to `/error`.
- `npm audit`: 0 vulnerabilities (728 packages, 24 production, 705 development). PrimeNG 21.1.10 and Angular 21.2 are current.

## 4. Dependency vulnerability results

| Tool | Result |
|---|---|
| `npm audit --json` (frontend) | 0 info, 0 low, 0 moderate, 0 high, 0 critical (728 dependencies: 24 prod, 705 dev, 137 optional) |
| `dotnet list MatterFlow.sln package --vulnerable --include-transitive` | `System.Security.Cryptography.Pkcs` **High** GHSA-846f-f764-76mx and **Moderate** GHSA-2fmv-rv2c-59x7. Resolved 9.0.4 via `Microsoft.Data.SqlClient 6.1.1` (Data, Identity, Configuration, Organization, Assets, WorkflowEngine, WorkViews, Search, SchemaTests) and 10.0.12 via `MsgReader 6.2.0` / `MimeKit 4.18.1` (Intake, ArchitectureTests, IntegrationTests, UnitTests, Api). No other vulnerable package. See SEC-11. |
| `dotnet list package --deprecated` | `xunit 2.9.3` flagged "Legacy" (successor `xunit.v3`) in the four test projects; no production package deprecated. |
| Build/tests | `dotnet build MatterFlow.sln`: 0 warnings, 0 errors. Unit 677/677, architecture 31/31. |

CI does not run either vulnerability check (`ci.yml`, `nightly.yml`, `codeql.yml` reviewed); only Dependabot version updates.

## 5. Prioritized fix list

**P0, before any real data or production pilot**
1. SEC-01 System Admin grant restricted to System Admin; role grants capped at the actor's own permissions (S).
2. SEC-02 Intake: HTML size and depth caps, real cancellation, concurrency and rate limit (M).
3. SEC-04 Role provisioning script and unconditional audit DENY/ALTER protection; separate migrator login (M).
4. SEC-03 Serialize admin-affecting writes (S).
5. SEC-08 Security headers, HSTS, `no-store`, `AllowedHosts` (S).

**P1, before go-live**
6. SEC-05 Tighten the pattern subset in .NET and TypeScript plus per-evaluation regex budget (M).
7. SEC-06 and SEC-07 Bootstrap only while no admin exists; audit `ADMIN_BOOTSTRAPPED`, `USER_PROVISIONED`, username changes (S + S).
8. SEC-09 Mandatory `rowVersion` everywhere, with the DTO contract test (S).
9. SEC-10 Dev provider only in Development (S).
10. SEC-11 Pin `System.Security.Cryptography.Pkcs`, add a vulnerability gate to nightly CI (S).
11. SEC-12 Reference validation for ASSET_REF/USER_REF (M).
12. SEC-13 Fix stale tracked entity after login bookkeeping (S); SEC-17 RCSI plus deadlock retry (S).

**P2, hardening and hygiene**
13. SEC-14, SEC-15, SEC-16, SEC-18, SEC-19, SEC-20, SEC-21 (each S) and the Info items SEC-22 to SEC-27. Run the Windows/IIS rehearsal (SEC-24) early in Phase 1 exit.

## 6. Missing tests on critical paths

| Gap | Add |
|---|---|
| PM-X-12 (User.Manage cannot grant System Admin), role permission cap | Integration test in `IdentityApiTests` (fails today) |
| Last-admin under concurrency (deactivate/revoke each other) | Parallel integration test with a barrier (R-05) |
| Self-edit right after cache expiry | Integration test with `Authorization:CacheSeconds=1` |
| Bootstrap: audit rows exist, no re-apply for a recycled name, no apply when an admin exists | Integration |
| Dev provider in `Staging`, `Auth:Dev` query form disabled outside Development | Extend `RequestForgeryGuardTests` |
| Security headers and `Cache-Control` | Integration (`ApiSmokeTests`) |
| `AuditEvent` DELETE/UPDATE/TRUNCATE/DROP TRIGGER as restricted login | `MatterFlow.SchemaTests` with a login in `mf_app` |
| Intake: nested-tag HTML (50,000 `<div>`), 9 MB header, concurrent uploads | Unit/integration with time budget |
| Pattern ReDoS corpus (`(a|aa)+$`, `(\w|\d)+`, `(a?){30}a{30}`) must be rejected at publish in both stacks | Add to `contracts/form-rules.vectors.json` and both vector runners |
| Every request DTO with an update semantic has a required `rowVersion` | Architecture/contract test |
| Summary/ObjectId/FieldKey over-length audit entries | Unit test of `Materialize` clipping |
| ASSET_REF/USER_REF existence and Matter match | Forms/Assets integration |
| Matter deactivation with the real Task guard registered | Add when the Task module lands |
| Permission-matrix generator (doc section 1) is not implemented; only the architecture test exists | Implement the generated allow/deny matrix from `contracts/openapi/v1.json` |

## 7. How the verified findings were reproduced (for re-testing)

- Environment: API built from `dev` (`dotnet build MatterFlow.sln`), run with `ASPNETCORE_ENVIRONMENT=Development`, Dev auth, `Seed__StarterConfiguration__Enabled=false`, `Bootstrap__SystemAdmins__0=KE\kekim`, against `mcr.microsoft.com/mssql/server:2022-latest` in a throwaway container.
- SEC-01: create role with `User.View`+`User.Manage`, assign to a pending user, then `PUT /api/v1/users/{self}/roles` with the System Admin role id and no `rowVersion`.
- SEC-02: `.eml` with `Content-Type: text/html` and 30,000 or 60,000 repeats of `<div>`; time `POST /api/v1/intake/parse-email` (multipart `file`) and watch `top -p <api pid>` after the response. Stand-alone HtmlAgilityPack timing (`LoadHtml` only): 8k divs 603 ms, 16k 2,652 ms, 32k 17,637 ms.
- SEC-03: two admins, warm both caches, send `PUT /users/{other}/status {isActive:false,rowVersion}` from each in parallel, count active admins.
- SEC-04: `SELECT DATABASE_PRINCIPAL_ID('mf_app')`, `sys.database_permissions` for `dbo.AuditEvent`, `DELETE` then `TRUNCATE TABLE dbo.AuditEvent`.
- SEC-05: `FormSchema.Compile` of 40 TEXT fields with `Pattern="(a|aa)+$"`, `FormEvaluator.Evaluate` with 40 values of 60 `a` plus `!`.
- SEC-13: wait for the 60 s cache to expire, `PUT /users/{self}` once (409) and again (200).
