# Rename dry-run summary

Issue #1346. Produced on branch `lpt-hub` (baseline ae3a1d6) with `node tools/rename/rename.mjs` (dry run, nothing changed). Re-create with the same command;
the numbers must match [rename-map.md](rename-map.md). The `--samples 3` output below is the script's own text.

## Trial results (not part of the dry run)

- `--apply` was run once in a throw-away copy of the tree (`git worktree add`, now removed; never on this branch). It performed 32 folder moves and 34 file moves
  (all recorded by git as renames: 1,020 `R` entries), then rewrote 1,179 files.
- `node tools/rename/rename.mjs --check` on the trial copy: **OK, no occurrence of the old name outside the allow-list.**
- `dotnet build backend/LptHub.sln -warnaserror -nodeReuse:false -p:UseSharedCompilation=false` on the trial copy: **Build succeeded, 0 warnings, 0 errors** (1 min 55 s,
  all 32 projects including the four test projects). The build regenerated `contracts/openapi/v1.json`; the result equals what the script wrote (only the `title` changed), so there is no OpenAPI drift from the rename itself.
- Not run on the trial copy (later steps): `dotnet format --verify-no-changes`, tests, frontend build, the nswag client regeneration, a real stack.

## Dry run output

Tracked files: 3437. Allow-listed files: 521.

Baseline outside the allow-list: 4847 occurrences of the product name (any case) in 1175 files, plus 415 old database role names. Rules R01-R32 below rewrite 4847 name matches (must equal the first number) and 415 role names.

### Paths (git mv)

- Folders to move: 32
- Files whose own name changes (after their folder moved): 34
- Tracked files whose path changes in total: 1020

### Content rules

| Rule | Kind | Matches | Files | Meaning |
|---|---|---:|---:|---|
| R01 | header | 119 | 98 | HTTP headers X-MatterFlow-* (CSRF Client, View-As-Ended) |
| R02 | envvar | 8 | 7 | environment variables MATTERFLOW_* (MATTERFLOW_MIGRATE_ONLY) |
| R03 | role | 415 | 53 | database roles/logins mf_app, mf_migrator, mf_report_reader, mf_reports (and mf_migrator_login); keeps case |
| R04 | password | 16 | 11 | default dev passwords MatterFlow_Dev1! / _Reports1! / _Perf1! |
| R05 | urn | 16 | 16 | problem-details type URI urn:matterflow:error:* |
| R07 | lowercase | 1 | 1 | repository root line "MatterFlow/" in a folder tree |
| R10 | identifier | 29 | 9 | database name in connection strings (Database=, Initial Catalog=, Application Name=) |
| R11 | identifier | 14 | 13 | connection-string key ConnectionStrings:MatterFlow / ConnectionStrings__MatterFlow |
| R12 | identifier | 6 | 6 | connection-string key in code (GetConnectionString("..."), ConnectionStringName, ApplicationConnectionNames) |
| R13 | identifier | 2 | 1 | JSON key "MatterFlow" / "_MatterFlow" (appsettings connection-string entry and its comment key) |
| R14 | identifier | 34 | 10 | database name in SQL / sqlcmd (DATABASE x, USE x, -d x, NAME=x, DB_ID('x'), [x]) |
| R15 | identifier | 9 | 2 | IIS site and app pool names (configure-iis.ps1 parameters, Start-/Stop-WebSite) |
| R16 | identifier | 11 | 7 | prose that names the database, IIS site or app pool in backticks (database `X`, empty `X`, pool `X`, site `X`, backup of `X`) |
| R19 | identifier | 8 | 7 | other technical string values: sqlcmd -d argument split over lines, name = 'x' in SQL, database "x" in an error text, AddAuthentication("x") |
| R17 | identifier | 50 | 23 | identifier glued to other letters/underscore: MatterFlowDbContext, AddMatterFlowModules, FakeMatterFlow, __MatterFlow, MatterFlow_log |
| R18 | identifier | 3927 | 1048 | dotted names: namespaces, assemblies, projects, MatterFlow.sln, MatterFlow.{module}, "MatterFlow." |
| R20 | lowercase | 1 | 1 | lowercase database name in connection strings (Initial Catalog=matterflow) |
| R21 | lowercase | 1 | 1 | lowercase inside snake_case identifiers (a C# test name) |
| R22 | lowercase | 75 | 30 | lowercase product slug: npm packages, container/volume, host names, URL host, gMSA, folder, artifact, repo |
| R30 | display | 276 | 53 | browser-title suffix " - MatterFlow" |
| R31 (review) | display | 48 | 20 | quoted or backticked bare name ("MatterFlow", 'MatterFlow', `MatterFlow`): display text, but could be a technical value |
| R32 | display | 196 | 92 | every other occurrence: prose, comments, labels |
| R33 | display | 2 | 2 | article agreement after the rewrite: "a LPT Hub" -> "an LPT Hub" |
| | | **5264** | **1179** | total matches / files changed |

Kinds: header 119, envvar 8, role 415, password 16, urn 16, lowercase 78, identifier 4090, display 522.

### Samples (first 3 per rule)

- R01
  - `app-framework/01-architecture.md:180  X-MatterFlow- -> X-LptHub-`
  - `app-framework/03-security-model.md:70  X-MatterFlow- -> X-LptHub-`
  - `app-framework/03-security-model.md:137  X-MatterFlow- -> X-LptHub-`
- R02
  - `backend/src/MatterFlow.Api/Hosting/MigrateOnlyCommand.cs:7  MATTERFLOW -> LPTHUB`
  - `backend/src/MatterFlow.Api/Hosting/MigrateOnlyCommand.cs:15  MATTERFLOW -> LPTHUB`
  - `backend/src/MatterFlow.Api/Program.cs:11  MATTERFLOW -> LPTHUB`
- R03
  - `app-framework/03-security-model.md:88  mf_app -> lpt_app`
  - `app-framework/03-security-model.md:116  mf_app -> lpt_app`
  - `app-framework/03-security-model.md:126  mf_app -> lpt_app`
- R04
  - `backend/src/MatterFlow.Api/appsettings.Development.json:3  MatterFlow_Reports1 -> LptHub_Reports1`
  - `backend/tests/MatterFlow.IntegrationTests/Reports/ReportLoginProbeTests.cs:76  MatterFlow_Reports1 -> LptHub_Reports1`
  - `docker-compose.dev.yml:10  MatterFlow_Dev1 -> LptHub_Dev1`
- R05
  - `backend/src/MatterFlow.Api/Http/ApiProblemDetails.cs:11  urn:matterflow: -> urn:lpt-hub:`
  - `backend/src/MatterFlow.Api/Http/Problems.cs:90  urn:matterflow: -> urn:lpt-hub:`
  - `backend/src/Modules/MatterFlow.Assets/Api/ControllerResults.cs:22  urn:matterflow: -> urn:lpt-hub:`
- R07
  - `docs/architecture.md:95  MatterFlow/ -> lpt-hub/`
- R10
  - `backend/src/MatterFlow.Api/appsettings.Development.json:3  Database=MatterFlow -> Database=LptHub`
  - `backend/src/MatterFlow.Api/appsettings.Development.json:3  Application Name=MatterFlow -> Application Name=LptHub`
  - `backend/tests/MatterFlow.IntegrationTests/ReadinessAndMigrateOnlyTests.cs:17  Database=MatterFlow -> Database=LptHub`
- R11
  - `backend/src/MatterFlow.Data/DataModule.cs:16  ConnectionStrings:MatterFlow -> ConnectionStrings:LptHub`
  - `backend/src/Modules/MatterFlow.Reports/Infrastructure/ReportAppConnection.cs:14  ConnectionStrings:MatterFlow -> ConnectionStrings:LptHub`
  - `backend/tests/MatterFlow.IntegrationTests/Audit/AuditEventsApiTests.cs:27  ConnectionStrings:MatterFlow -> ConnectionStrings:LptHub`
- R12
  - `backend/src/MatterFlow.Api/Hosting/ReadinessHealthCheck.cs:28  GetConnectionString("MatterFlow" -> GetConnectionString("LptHub"`
  - `backend/src/MatterFlow.Api/Program.cs:88  GetConnectionString("MatterFlow" -> GetConnectionString("LptHub"`
  - `backend/src/MatterFlow.Data/DataModule.cs:13  ConnectionStringName = "MatterFlow" -> ConnectionStringName = "LptHub"`
- R13
  - `deploy/appsettings.Production.template.json:7  "_MatterFlow" -> "_LptHub"`
  - `deploy/appsettings.Production.template.json:8  "MatterFlow" -> "LptHub"`
- R14
  - `backend/tests/MatterFlow.UnitTests/Reports/Corpus/validator-corpus.json:352  DATABASE MatterFlow -> DATABASE LptHub`
  - `backend/tests/MatterFlow.UnitTests/Reports/SqlValidatorTests.cs:31  DATABASE MatterFlow -> DATABASE LptHub`
  - `backend/tests/MatterFlow.UnitTests/Reports/SqlValidatorTests.cs:32  DATABASE MatterFlow -> DATABASE LptHub`
- R15
  - `deploy/configure-iis.ps1:10  -SiteName MatterFlow -> -SiteName LptHub`
  - `deploy/configure-iis.ps1:10  -AppPoolName MatterFlow -> -AppPoolName LptHub`
  - `deploy/configure-iis.ps1:17  $SiteName = 'MatterFlow -> $SiteName = 'LptHub`
- R16
  - `docs/qa/e2e.md:21  empty 'MatterFlow' -> empty 'LptHub'`
  - `docs/runbook.md:88  empty 'MatterFlow' -> empty 'LptHub'`
  - `docs/runbook.md:171  pool 'MatterFlow' -> pool 'LptHub'`
- R19
  - `app-framework/08-developer-guide-and-samples.md:72  AddAuthentication("MatterFlow" -> AddAuthentication("LptHub"`
  - `docs/runbook.md:363  name = 'MatterFlow' -> name = 'LptHub'`
  - `frontend/e2e/support/seed.ts:483  '-d',
        'MatterFlow' -> '-d',
        'LptHub'`
- R17
  - `app-framework/01-architecture.md:152  MatterFlow -> LptHub`
  - `app-framework/02-package-format.md:38  MatterFlow -> LptHub`
  - `app-framework/02-package-format.md:81  MatterFlow -> LptHub`
- R18
  - `.gitattributes:14  MatterFlow -> LptHub`
  - `.github/workflows/ci.yml:42  MatterFlow -> LptHub`
  - `.github/workflows/ci.yml:42  MatterFlow -> LptHub`
- R20
  - `backend/tests/MatterFlow.UnitTests/Reports/ReportsConnectionGuardTests.cs:44  Initial Catalog=matterflow -> Initial Catalog=lpthub`
- R21
  - `backend/tests/MatterFlow.ArchitectureTests/ModuleDependencyRulesTests.cs:73  matterflow -> lpt_hub`
- R22
  - `.github/workflows/publish.yml:42  matterflow -> lpt-hub`
  - `app-framework/01-architecture.md:43  matterflow -> lpt-hub`
  - `app-framework/02-package-format.md:55  matterflow -> lpt-hub`
- R30
  - `docs/qa/e2e.md:167   - MatterFlow ->  - LPT Hub`
  - `docs/requirements/decisions-addendum.md:208   - MatterFlow ->  - LPT Hub`
  - `docs/requirements/decisions-addendum.md:337   - MatterFlow ->  - LPT Hub`
- R31
  - `backend/src/Modules/MatterFlow.Configuration/Domain/Settings/BrandingName.cs:14  "MatterFlow" -> "LPT Hub"`
  - `backend/tests/MatterFlow.IntegrationTests/Settings/BrandingApiTests.cs:90  "MatterFlow" -> "LPT Hub"`
  - `backend/tests/MatterFlow.IntegrationTests/Settings/BrandingApiTests.cs:104  "MatterFlow" -> "LPT Hub"`
- R32
  - `CLAUDE.md:1  MatterFlow -> LPT Hub`
  - `CLAUDE.md:31  MatterFlow -> LPT Hub`
  - `README.md:1  MatterFlow -> LPT Hub`
- R33
  - `app-framework/08-developer-guide-and-samples.md:28  a LPT Hub -> an LPT Hub`
  - `tools/db/schema-fingerprint.sql:2  a LPT Hub -> an LPT Hub`

### Needs a human look (rule R31: quoted bare name rewritten as display text)

48 occurrence(s) in 20 file(s).

- frontend/src/app/features/admin/settings/settings-page.spec.ts: 10
- backend/tests/MatterFlow.IntegrationTests/Settings/BrandingApiTests.cs: 7
- frontend/e2e/tests/app-settings.spec.ts: 5
- frontend/src/app/core/branding/branding.spec.ts: 4
- frontend/src/app/core/branding/branding.ts: 3
- backend/tests/MatterFlow.UnitTests/Configuration/Settings/BrandingNameTests.cs: 2
- docs/architecture.md: 2
- frontend/src/app/core/branding/branding-ui.spec.ts: 2
- frontend/src/app/core/title/page-title.spec.ts: 2
- backend/src/Modules/MatterFlow.Configuration/Domain/Settings/BrandingName.cs: 1
- backend/tests/MatterFlow.UnitTests/Configuration/Settings/AppSettingsCacheTests.cs: 1
- docs/qa/e2e.md: 1
- docs/requirements/decisions-addendum.md: 1
- docs/runbook.md: 1
- docs/ux/ux-spec.md: 1
- frontend/e2e/tests/sh-error-page.spec.ts: 1
- frontend/e2e/tests/sh-nav-brand.spec.ts: 1
- frontend/src/app/core/branding/branding.service.ts: 1
- frontend/src/app/features/system/pages/system-pages.spec.ts: 1
- wiki/Reference/Settings-Catalogue.md: 1

### Allow-listed files that still contain the old name (left untouched)

- `db/scripts/archive/**`: 32 occurrence(s) in 25 file(s) - archived schema scripts 01 to 66: immutable history (CLAUDE.md schema rule)
- `docs/adr/**`: 7 occurrence(s) in 2 file(s) - architecture decision records are dated history
- `docs/qa/**`: 64 occurrence(s) in 14 file(s) - dated QA records (security reviews, UAT rounds, final passes, E2E findings)
- `docs/ux/**`: 494 occurrence(s) in 86 file(s) - dated design records: review rounds, mock-ups, walkthrough evidence (JSON, PDF, HTML)

### Not rewritten (binary, not UTF-8, symbolic link) and outside the allow-list

None.

### Files matching 'matterflow' (any case) or an old role name that NO rule covers

None: every match is covered by a rule or by the allow-list.
