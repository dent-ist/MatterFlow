# Rename map: MatterFlow to LPT Hub

Issue #1346 (prepare step) of epic #1345. Status: **proposal for the owner's review; nothing is renamed yet.**
Baseline: branch `lpt-hub`, taken from `dev` at ae3a1d6 (3,437 tracked files). Counts below are measured with `git grep` on that commit and by
`node tools/rename/rename.mjs` (dry run). The script in `tools/rename/rename.mjs` implements exactly the rules in this file, in the same order; the numbers
in `docs/rename/dry-run-summary.md` come from it.

## 1. The five kinds of name

| Kind | Old | New | Where it is used |
|---|---|---|---|
| Display name | `MatterFlow` | `LPT Hub` | text people read: UI default, browser title, API title, docs prose, comments, seed texts |
| Identifier | `MatterFlow` | `LptHub` | C# namespaces and assemblies, solution, project and folder names, database name, connection-string keys, IIS site and app pool, JSON/YAML config keys, `ConnectionStrings__X`, type names such as `MatterFlowDbContext` |
| Slug | `matterflow` | `lpt-hub` | npm package names, Docker container and volume, host names and URLs, gMSA, install folders, CI artifact, repository name, `urn:` namespace |
| Environment variable | `MATTERFLOW_*` | `LPTHUB_*` | the one variable `MATTERFLOW_MIGRATE_ONLY` |
| Database role / login | `mf_app` ... | `lpt_app` ... | four roles and one login, see section 4 |

Not renamed, on purpose (section 6): the internal `mf-` / `--mf-` / `mf.` / `Mf*` / `mfTitle*` prefix.

## 2. Baseline counts

Measured on the baseline commit. "Outside the allow-list" is what the script will change; the allow-list is `tools/rename/allowlist.txt`.

| What | Count |
|---|---|
| `MatterFlow` (exact case), all tracked text files | 5,301 occurrences in 1,272 files |
| `matterflow` (lowercase) | 93 occurrences in 48 files |
| `MATTERFLOW` (upper case) | 9 occurrences in 8 files |
| Other spellings (`Matterflow`, `Matter Flow`, `matter-flow`, `matter_flow`) | 0 |
| Binary files containing the name | 2 (two dated PDFs in `docs/ux/task-queue-review/`, allow-listed) |
| Tracked paths containing `MatterFlow` | 1,020 (all under `backend/`; 32 folders to move, 34 files that also carry the name themselves) |
| Old role names `mf_app`, `mf_migrator`, `mf_report_reader`, `mf_reports` | 410 occurrences in 69 files (incl. archive scripts) |
| Left alone by the allow-list | 597 occurrences of the name (archive scripts 32, ADRs 7, dated QA records 64, dated design records 494) |
| **Changed by the script** | **4,847 occurrences of the name in 1,175 files, plus 415 role names** (1,179 files in total) |

The epic's "177 folders" counted every nested folder; git moves 32 top-level project folders and the sub-folders follow.

## 3. Rules, in the order the script applies them

The first rule that matches a piece of text rewrites it; later rules never see it. Counts are from the dry run (`dry-run-summary.md`).

| Rule | Kind | Old to new | Count | Notes |
|---|---|---|---:|---|
| Paths | path | every path segment `MatterFlow` to `LptHub` (`git mv`, history follows) | 32 folders, 34 files | e.g. `backend/MatterFlow.sln` to `backend/LptHub.sln`, `src/Modules/MatterFlow.Notes` to `src/Modules/LptHub.Notes` |
| R01 | header | `X-MatterFlow-*` to `X-LptHub-*` | 119 | `X-MatterFlow-Client` (CSRF guard, interceptor, 110 files) and `X-MatterFlow-View-As-Ended` |
| R02 | env var | `MATTERFLOW` to `LPTHUB` | 8 | `LPTHUB_MIGRATE_ONLY` (see question 3) |
| R03 | role | `mf_app` `mf_migrator` `mf_report_reader` `mf_reports` (and `mf_migrator_login`) to `lpt_...` | 415 | keeps upper/lower case; does not touch `MF_APP_CODE`, `mf_launch`, `mf_view_as` |
| R04 | password | `MatterFlow_Dev1!` to `LptHub_Dev1!`, `_Reports1!`, `_Perf1!` likewise | 16 | section 5 |
| R05 | slug | `urn:matterflow:` to `urn:lpt-hub:` | 16 | problem-details `type` URI, a visible API value (question 4) |
| R07 | slug | folder-tree line `MatterFlow/` to `lpt-hub/` | 1 | `docs/architecture.md` line 95 (the repository root) |
| R10 | identifier | `Database=` / `Initial Catalog=` / `Application Name=` `MatterFlow` to `LptHub` | 29 | connection strings |
| R11 | identifier | `ConnectionStrings:MatterFlow`, `ConnectionStrings__MatterFlow` | 14 | the connection-string key |
| R12 | identifier | `GetConnectionString("MatterFlow")`, `ConnectionStringName`, `ApplicationConnectionNames` | 6 | code that reads the key |
| R13 | identifier | JSON keys `"MatterFlow"` and `"_MatterFlow"` | 2 | `deploy/appsettings.Production.template.json` |
| R14 | identifier | database name in SQL and sqlcmd (`DATABASE x`, `USE x`, `-d x`, `NAME=x`, `DB_ID('x')`) | 34 | compose, perf tools, runbook, tests |
| R15 | identifier | IIS site and app pool (`-SiteName`, `-AppPoolName`, `Start-/Stop-WebSite`) | 9 | `deploy/configure-iis.ps1`, runbook |
| R16 | identifier | prose that names the database, site or pool in backticks | 11 | runbook, wiki |
| R19 | identifier | other technical strings: `'-d', 'MatterFlow'` over two lines, `name = 'MatterFlow'`, `database "MatterFlow"`, `AddAuthentication("MatterFlow")` | 8 | |
| R17 | identifier | glued identifiers: `MatterFlowDbContext`, `AddMatterFlowModules`, `UseMatterFlowStaticFiles`, `FakeMatterFlow`, `MatterFlow_log` | 50 | |
| R18 | identifier | `MatterFlow` followed by `.` and a letter: namespaces, assemblies, project names, `MatterFlow.sln`, `Assembly.Load($"MatterFlow.{name}")` | 3,927 | 945 C# files, csproj, sln, workflows, embedded-resource names |
| R20 | slug | `Initial Catalog=matterflow` to `...=lpthub` | 1 | a case-insensitivity test |
| R21 | slug | lowercase inside snake_case to `lpt_hub` | 1 | the C# test method name `..._no_other_matterflow_project` |
| R22 | slug | every other `matterflow` to `lpt-hub` | 75 | section 3.2 |
| R30 | display | ` - MatterFlow` to ` - LPT Hub` | 276 | document-title suffix in specs and e2e |
| R31 | display | quoted bare `"MatterFlow"`, `'MatterFlow'`, `` `MatterFlow` `` to `LPT Hub` | 48 | listed for review (section 7) |
| R32 | display | everything else to `LPT Hub` | 196 | prose and comments |
| R33 | display | `a LPT Hub` to `an LPT Hub` | 2 | grammar after the rewrite |

Total: kinds in the dry run are identifier 4,090, display 522, role 415, header 119, lowercase 78, password 16, urn 16, env var 8.

### 3.1 Identifier decisions

| Thing | New value |
|---|---|
| Solution | `backend/LptHub.sln` |
| Projects and folders | `LptHub.Api`, `LptHub.SharedKernel`, `LptHub.Data`, `LptHub.<Module>`, `LptHub.<Module>.Contracts`, `LptHub.UnitTests`, `.IntegrationTests`, `.SchemaTests`, `.ArchitectureTests` (32 projects) |
| Root namespace and assembly names | `LptHub.*` (the module-boundary rule in CLAUDE.md and `ArchitectureTests` use the prefix `LptHub.`; the tests build it from strings, so they follow automatically) |
| `InternalsVisibleTo` | `LptHub.UnitTests`, `LptHub.IntegrationTests` (follows the project names; 16 entries) |
| Embedded resources | logical names `MatterFlow.Seed.seed-configuration.json` and `MatterFlow.Reports.Starters.*` become `LptHub.*`; the C# constants that read them change in the same rule (R18). The schema scripts (`db.scripts.*`), `contracts.*` and `db.report-access.json` have no product name and do not change |
| DbContext | `MatterFlowDbContext` to `LptHubDbContext` (class, file, 20 uses) |
| Extension methods | `AddMatterFlowModules`, `AddMatterFlowOpenApi`, `AddMatterFlowIdentity`, `AddMatterFlowSpaCompression`, `AddMatterFlowAppConfiguration`, `AddMatterFlowAppIdentity`, `UseMatterFlowStaticFiles`, `MapMatterFlowSpaFallback` get `LptHub` |
| Database | `MatterFlow` to `LptHub`; log file `MatterFlow_log` to `LptHub_log` |
| Connection-string key | `ConnectionStrings:LptHub` (env `ConnectionStrings__LptHub`); `Default` and `Migrations` unchanged |
| SQL application lock | `MatterFlow.Seed` to `LptHub.Seed` (only an in-process mutex name, no stored data) |
| Authentication scheme name in `app-framework/` sample | `"LptHub"` |
| IIS site and app pool | `LptHub` (no hyphen: PowerShell parameters stay unquoted; IIS would accept a hyphen) |
| Windows service names in `app-framework/` | `LptHubAppHost`, `LptHubFileBroker` |
| `launchSettings.json` profile | `LptHub.Api` |
| Environment variable | `LPTHUB_MIGRATE_ONLY` |

### 3.2 Lowercase contexts (checked one by one)

The 93 lowercase occurrences, with the decision for each context. Hyphen is the default; it is valid in all of these.

| Context | Old | New | Hyphen OK? |
|---|---|---|---|
| root `package.json` and lock | `matterflow` | `lpt-hub` | yes (npm names allow hyphens) |
| `frontend/package.json` and lock | `matterflow-frontend` | `lpt-hub-frontend` | yes |
| `tools/icons/package.json` and lock | `matterflow-icon-tools` | `lpt-hub-icon-tools` | yes |
| Docker container | `matterflow-sql` | `lpt-hub-sql` | yes |
| Docker volume | `matterflow-sql-data` | `lpt-hub-sql-data` | yes (volume names allow hyphen) |
| CI artifact | `matterflow-publish-${{ github.sha }}` | `lpt-hub-publish-${{ github.sha }}` | yes |
| Host names | `matterflow.firm.local`, `matterflow.firm.test`, `https://matterflow/apps/...`, `matterflow.internal` | `lpt-hub.firm.local`, `lpt-hub.firm.test`, `https://lpt-hub/apps/...`, `lpt-hub.internal` | yes (DNS labels allow hyphens) |
| gMSA / service account | `svc-matterflow$` | `svc-lpt-hub$` | yes (11 characters, below the 15-character limit) |
| SPN, install folders | `HTTP/matterflow.firm.local`, `C:\inetpub\matterflow`, `...-new`, `...-previous`, `C:\build\matterflow` | `lpt-hub` forms | yes |
| JWT claims in `app-framework/` | `aud=matterflow-callbacks`, `iss=https://matterflow.firm.local` | `lpt-hub-callbacks`, `https://lpt-hub.firm.local` | yes (design text, not code) |
| Template repository name | `matterflow-app-template` | `lpt-hub-app-template` | yes |
| Spike tool id | `matterflow-outlook-dnd-spike` | `lpt-hub-outlook-dnd-spike` | yes |
| `$id` in `contracts/form-rules.schema.json` | `https://matterflow.internal/schemas/form-rule.v1.json` | `https://lpt-hub.internal/schemas/form-rule.v1.json` | yes (nothing resolves it; checked that no other file refers to the old `$id`) |
| Problem-details type URI | `urn:matterflow:error:<code>` | `urn:lpt-hub:error:<code>` | yes (URN namespace ids allow hyphens) |
| Database name in a connection string | `Initial Catalog=matterflow` | `Initial Catalog=lpthub` | no: the database is `LptHub` (SQL Server names are case-insensitive by default); this is a unit test input |
| C# method name | `..._no_other_matterflow_project` | `..._no_other_lpt_hub_project` | no: `lpt_hub` in snake case |
| GitHub repository | `dent-ist/MatterFlow` | `dent-ist/lpt-hub` | owner action in #1351; the script does not touch git remotes |

### 3.3 Files that are not text

- Two PDFs under `docs/ux/task-queue-review/fixes/wp-print/` contain the name; they are dated records and allow-listed (the script never rewrites binary files, and `--check` reports one outside the allow-list).
- `frontend/public/favicon.svg` and `logo-light.svg` contain `<title>MatterFlow</title>`; the script changes the title text only. The artwork stays the old one until the owner picks the logo (question 1).
- No Office files, images or archives contain the name.

## 4. Database

| Old | New | Notes |
|---|---|---|
| database `MatterFlow` | `LptHub` | compose init container, `IF DB_ID(...)`, `-d` arguments, `package.json` `api:run`, e2e `run-local.sh`, perf and seed tools, runbook |
| role `mf_app` | `lpt_app` | 129 occurrences |
| role `mf_migrator` | `lpt_migrator` | 38 |
| role `mf_report_reader` | `lpt_report_reader` | 254 |
| login `mf_reports` | `lpt_reports` | created by `tools/db/provision-report-login.sql`; 46 |
| `mf_migrator_login` / `MF_MIGRATOR_LOGIN` | `lpt_migrator_login` / `LPT_MIGRATOR_LOGIN` | only a unit-test string |

Files that carry the roles outside the archive: `db/scripts/00-baseline.sql`, `db/report-access.json`, `tools/db/provision-report-login.sql`, `deploy/appsettings.Production.template.json`, `docs/runbook.md`, wiki, many integration and schema tests.

Consequences, all expected by the epic:
- `db/scripts/00-baseline.sql` is edited in place (allowed while nothing is deployed, `db/scripts/README.md` "Immutability"). Its stored checksum changes, so **every existing database must be rebuilt with `npm run db:reset`**. `67-role-landing-page.sql` has no product name and is untouched.
- **The baseline-equivalence test breaks by design.** `BaselineEquivalenceTests` builds database A from `db/scripts/archive` (which keeps `mf_*` roles, untouched) and database B from the baseline (now `lpt_*`) and expects equal fingerprints that include roles and permissions. The tooling must normalise the role names before comparing (or compare with a fixed `mf_` to `lpt_` mapping). This is work for #1348; see the risks in the report.

## 5. Default development password

`MatterFlow_Dev1!` becomes **`LptHub_Dev1!`** (12 characters; upper, lower, digit and symbol, so SQL Server's complexity policy is met). The same pattern for the two other demo passwords: `MatterFlow_Reports1!` to `LptHub_Reports1!` and `MatterFlow_Perf1!` to `LptHub_Perf1!`.

Every place (outside the allow-list), 16 occurrences:

| File | Password |
|---|---|
| `docker-compose.dev.yml` (3: sqlserver, init, report-login-init) | Dev1 |
| `package.json` (2 in `api:run`) | Dev1 |
| `frontend/e2e/run-local.sh` (2) | Dev1, Reports1 |
| `frontend/e2e/tests/dashboard-trends-types-screens.spec.ts` | Dev1 |
| `tools/seed-demo/seed-demo.mjs` | Dev1 |
| `tools/perf/asset-report-timings.mjs` (2) | Dev1 |
| `tools/perf/reproduce.sh` | Perf1 |
| `tools/db/provision-report-login.sql` | Reports1 |
| `backend/src/MatterFlow.Api/appsettings.Development.json` | Reports1 |
| `backend/tests/MatterFlow.IntegrationTests/Reports/ReportLoginProbeTests.cs` | Reports1 |
| `docs/ux/ui-update/stack-start.sh` (not allow-listed, runnable) | Dev1 |

Allow-listed leftovers with the old password (history only): `docs/qa/uat-round-1/report.md` (3), `docs/ux/pm-experience/review/walkthrough.mjs` (1).
The password is public by design (compose comment, security review SEC-19) and only reachable on loopback.

## 6. What stays as it is

| Stays | Why | Size |
|---|---|---|
| `mf-` prefix: CSS classes, custom properties `--mf-*`, component selectors `mf-*`, design tokens | internal, invisible to users; epic decision | about 16,600 uses in 948 files |
| `mf.` browser storage keys, `Mf*` component class prefix, `mfTitle*` helpers | would reset everybody's saved views; epic decision | 85 keys |
| cookie `mf_view_as`, URL fragment `#mf_launch`, `MF_APP_CODE`, `MF_JWKS_URL`, `mf-app` CLI (app-framework) | all use the `mf` prefix; none contains the product name; the script's role rule uses a whole-word match and cannot touch them | |
| `db/scripts/archive/**` | immutable history; 32 occurrences in 25 files (names and roles) | |
| dated records in `docs/qa/**` and `docs/ux/**`, `docs/adr/**` | history; the allow-list names the living documents that are excepted (`e2e.md`, `ux-spec.md`, shell scripts under `docs/ux`, ...) | 565 occurrences |
| `node_modules`, lock-file hashes | not tracked / no product name in them (only the `name` fields of the three lock files change) | |
| `docs/branding/lpt-hub-logo-*` | already new | |
| `docs/rename/**`, `tools/rename/**` | they define the old identifiers | |
| Table, column, schema and index names, `AppUser`, permission keys, route paths, JSON property names of the API | none contains the product name (searched) | |

Searched and found free of the product name (so nothing to do and no stored data affected): audit object-type strings, API JSON property names, cookie names, `localStorage` keys, SignalR/hub names, claim types, OpenAPI schema names (only the document title), `nswag.json`, `angular.json`, `tsconfig` paths, `.editorconfig`, `.github/actions`.

## 7. Needs a human look (cannot be decided by a pattern)

The script's rule R31 lists every quoted bare `"MatterFlow"`; after reading all 56 original hits, the technical ones (database names, `AddAuthentication`) were moved to explicit rules (R14, R19). The remaining 48 are display texts: the default name constant and its tests (`DEFAULT_APP_NAME`, `BrandingName.Default`, specs, e2e), docs that quote the default, and `tools/seed-demo/lib/aged.mjs` / `frontend/e2e/support/seed.ts` which pass the database name as `-d` argument and are covered by R19. After the apply, run `--check` and read `git diff` of these 20 files once.

Other behaviour and stored-data effects of the rename:

| Item | Effect |
|---|---|
| Default application name `Default = "MatterFlow"` (`BrandingName.cs`), `DEFAULT_APP_NAME`, and the `SettingDefinitions` default text | the name of a fresh installation becomes "LPT Hub". An administrator-set name in `AppSetting` (`Branding.AppName`) is stored data and is not touched; demo databases are reset anyway |
| Audit event for a branding change (`OldValue` "MatterFlow" in `BrandingApiTests`) | test expectation follows the default |
| `contracts/openapi/v1.json` title `MatterFlow API` to `LPT Hub API` | generated from `OpenApiSetup.cs`; both change in the same run, regenerate with the repo tooling to prove no drift (#1347) |
| Swagger UI title and request interceptor header | follow R01 and R32 |
| Problem-details `type` URI `urn:lpt-hub:error:*` | visible to API clients and used by 2 e2e specs and 1 integration test; they change together |
| Seed texts (`docs/sme/seed-configuration.json`, embedded into the API) | seven sentences such as "approval happens outside MatterFlow" become "outside LPT Hub"; this is user-visible seeded task text and only affects new databases |
| Embedded-resource names | consistent change of `.csproj` `LogicalName` and the C# constant (both R18); a mismatch would fail at startup with "embedded resource ... is missing", so the key integration classes must run in #1347 |
| `InternalsVisibleTo` | follows the project rename; a missed one fails compilation (covered by the trial build) |
| `ArchitectureTests` | namespace prefixes are built from `"MatterFlow."` strings and become `"LptHub."`; the test that finds the solution file looks for `LptHub.sln` |
| `wiki/` links | the wiki is inside this repo and its links are relative; no link text contains the repo name. The GitHub-hosted wiki (if any) and badge URLs are #1351 |

## 8. Questions for the owner

1. Which logo becomes the built-in one: `docs/branding/lpt-hub-logo-a.svg` or `-b.svg`? The script only changes the `<title>` in `frontend/public/favicon.svg` and `logo-light.svg`; the artwork swap is part of #1349.
2. Should `LPTHUB_MIGRATE_ONLY` stay as the mechanical form, or do you prefer `LPT_HUB_MIGRATE_ONLY`? (Only matters for deployment pipelines; none exists yet.)
3. Allow-list scope: are all of `docs/ux/**`, `docs/qa/**` (except the living files named in the allow-list) and `docs/adr/**` really "dated records"? The alternative is to rename them too (about 565 more occurrences), at the price of rewriting history.
4. Branch `qa-e2e-fixes-3` and any other open branch: not decided here. Whatever is open when the rename lands will conflict in almost every file.
