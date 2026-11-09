# Troubleshooting

[[_TOC_]]

**What this page is for.** The errors developers meet most often, with the cause and the fix. Production problems are also covered in `docs/runbook.md` section 10. Where a fix below is a guess from the code rather than a verified run, it says so.

## Environment

| Symptom | Cause and fix |
|---|---|
| `No space left on device`, builds or Docker fail | The cloud container has a small disk. Check `df -h /`. Remove your own build output (`backend/**/bin`, `obj`, `frontend/dist`, `frontend/node_modules` copies, `artifacts/`), stale worktrees (`git worktree remove`), and Docker leftovers you created (`docker image prune` only for images you pulled; never remove another agent's container or volume). Do not copy `node_modules`; hard-link it (`cp -al`) |
| `Cannot connect to the Docker daemon` | Start it: `nohup dockerd >/tmp/dockerd.log 2>&1 &`, wait about 10 to 15 seconds, then retry ([Cloud Container Notes](../Getting-Started/Cloud-Container-Notes.md)) |
| SQL Server container not healthy or port 1433 refused | `docker ps` and `docker logs matterflow-sql`. Start it with `npm run db:up` (or `docker compose -f docker-compose.dev.yml up -d --wait sqlserver`). The sa password is in `docker-compose.dev.yml`; connection strings need `TrustServerCertificate=True` |
| `Cannot open database "MatterFlow"` | The init container did not run: `docker compose -f docker-compose.dev.yml run --rm --no-deps sqlserver-init` (part of `npm run db:up`) |
| Want a clean database | `npm run db:reset` (deletes the volume). Do not do this on a database other people use |
| `ng` fails with a Node version message | You used the global or latest Angular CLI. Use the repo-local CLI: `npm run ng -- ...` inside `frontend/` ([Commands](../Getting-Started/Commands.md)) |
| `npm ci` peer dependency errors | Run it inside `frontend/` where `.npmrc` sets `legacy-peer-deps` |
| `dotnet` not found or wrong SDK | `apt-get install -y dotnet-sdk-10.0` (the install script is blocked by the proxy); `global.json` pins 10.0.100 with roll forward |
| Form engine import `form-engine` not found | Build the library first: `npm run setup` or `npm run ng -- build form-engine` (the app maps `form-engine` to `dist/form-engine`) |
| Outbound download fails with 403 or a TLS error | The egress proxy: see `/root/.ccr/README.md`; never disable TLS verification |

## Startup and database

| Symptom | Cause and fix |
|---|---|
| Startup fails naming a script and a checksum | An applied script was edited. Restore the original file from git; add a new script for the change ([How to Change the Schema](../Database/How-to-Change-the-Schema.md)) |
| Startup fails: duplicate prefix | Two scripts share a number; renumber the unmerged one |
| Startup fails: a new script is numbered lower than the highest applied | Out-of-order merge; renumber it to the next free number |
| Startup fails with the audit guard message (Production) | The API's SQL identity can alter `dbo.AuditEvent` (for example `sa` or `db_owner`). Use the `mf_app` role; local Development databases are not checked the same way |
| `/health/ready` 503 | `database_not_configured`, `database_unreachable`, `migrations_pending` (run `--migrate-only`), or `migration_failed` (a `Success=0` row) |
| Warning "READ_COMMITTED_SNAPSHOT is off" | Expected on the demo database; a DBA step in production (runbook section 3) |
| Every request answers 400 "Invalid Hostname" | `AllowedHosts` lacks the host name used |
| Reports are off | The report login is missing or shares the application login; see [Reports Module](../Architecture/Reports-Module.md). Locally run `npm run db:report-login` |
| Notifications never appear in production | The app pool slept; run `deploy/configure-iis.ps1` (AlwaysRunning) |

## API

| Symptom | Cause and fix |
|---|---|
| 400 "Client header required" on POST, PUT or DELETE | Send `X-MatterFlow-Client: web` (the Angular app does it; curl and Swagger need it explicitly) |
| 401 | No identity: with Dev auth set `Auth__Dev__DefaultUser` or send `X-Dev-User` |
| 403 `ACCESS_PENDING` | The user has no role yet; grant one in Administration > Users |
| 403 `PERMISSION_DENIED` | The policy names a permission the user lacks (the detail names it). The role may need it, or a script that grants new permissions to existing roles has not run (roles are seeded once) |
| A person lands on the wrong page after sign-in | Follow `docs/runbook.md` section 18: own choice (My Profile > My Landing Page), then the default of the first role by name (Administration > Users > Roles, Landing Page), then the Automatic rule. The Users drawer names the role that decides |
| 404 on a record that exists | The Sensitive matter rule, if `Features:SensitiveMatterAccess` is on and the person cannot see the matter |
| 409 `CONCURRENCY_CONFLICT` | Stale `rowVersion`, or a SQL deadlock retry message; reload and retry |
| 429 | A per-user rate limit (`RateLimits:*`); the response advertises the wait. The demo seeder paces itself |
| 503 `QUERY_TIMEOUT` | A heavy read exceeded `Queries:ReadCommandTimeoutSeconds`; narrow the filters or check indexes |

## Build, drift and format

| Symptom | Cause and fix |
|---|---|
| CI "OpenAPI drift" | You changed an endpoint or DTO. Build the backend and commit `contracts/openapi/v1.json` |
| CI "API client drift" | Run `npm run api:generate` in `frontend/` and commit `src/app/api/generated` |
| Merge conflict in `api-client.ts` or `v1.json` | Never merge by hand: take either side, rebuild the backend, run `npm run api:generate` |
| `dotnet format` fails | `dotnet format` (without `--verify-no-changes`) rewrites; commit the result. `.editorconfig` has the rules |
| Prettier failure | `npx prettier --write <files>` in `frontend/` |
| Lint: theme colour or icon-size script fails | A colour literal or px icon size; use the tokens ([UI Standard](../Frontend/UI-Standard.md)) |
| Build error: initial bundle over 700 kB | Something heavy entered the initial bundle (often the generated client or the form engine); load it lazily ([API Client and Generated Code](../Frontend/API-Client-and-Generated-Code.md)) |
| Warnings fail the build | CI uses `-warnaserror`; fix the warning, do not suppress it |

## Tests

| Symptom | Cause and fix |
|---|---|
| Architecture test: module references a project it must not | Use the other module's `.Contracts` instead; for a new module update `AllowedContracts` ([Backend Modules](../Architecture/Backend-Modules.md)) |
| Architecture test: action without a policy or with an unknown permission | Add `[Authorize(Policy = "Perm:...")]` with a code from `contracts/permissions.json` |
| Architecture test: update request without `rowVersion` | Add a required, non-nullable `RowVersion` |
| `SensitiveEndpointCatalogTests` lists unclassified endpoints | Classify them in `SensitiveAccessCatalog.cs` ([Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md)) |
| `VisibilitySourceRulesTests` names a new file | Review the read path and add the file with a reason to the allow-list |
| `ReportAccessCatalogueTests` fails | New table not in `db/report-access.json` or the GRANT or DENY line is missing |
| `PermissionCatalogTests` fails | JSON, C# constants and `permissions.ts` differ, or the total count changed ([How to Add a Permission](../Backend/How-to-Add-a-Permission.md)) |
| Integration or schema tests cannot start | Docker is not running, or the SQL image is not pulled (`docker pull mcr.microsoft.com/mssql/server:2022-latest`) |
| Playwright: browser not found | Use the preinstalled Chromium (`E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, `E2E_NO_SANDBOX=1`); do not run `playwright install` |
| Playwright: port in use | `run-local.sh` refuses to reuse another stack: set `E2E_API_PORT` to a free port or leave it unset |
| Playwright: `sensitive-*` specs skip | The Sensitive matter switch is off; run them by name (the script then turns it on) or set `E2E_SENSITIVE_ACCESS=1` |
| A UI guard spec fails | Fix the code, not the guard; an exception needs a reason in the guard and in the guidelines section 8 |

## Related pages

- [Runbook](Runbook.md)
- [Fix a Bug](../How-To/Fix-a-Bug.md)
- [Continuous Integration](../Getting-Started/Continuous-Integration.md)

Last verified against commit a8f9659.
