# Reports: security test results and findings (issue #725)

Run by Agent RL on 2026-11-07, branch `reports`, in an own worktree. What each threat is covered by, and what was missing, is in `security-test-matrix.md`. This file records the findings, what was done about each, and the test runs.

## Findings

| # | What | Severity | State |
|---|---|---|---|
| F1 | The validator accepted `FOR XML` and `FOR JSON` after a `UNION`, `INTERSECT` or `EXCEPT` and on a parenthesised query (`SELECT 1 UNION SELECT 2 FOR XML PATH`, `(SELECT 1) FOR JSON AUTO`). Spec 6.3 refuses every FOR clause. The check looked at query specifications only, and in ScriptDom the clause hangs on the binary and parenthesis nodes | Low: it only shapes the output of a query the login may run; no extra data | **Fixed** in `SqlValidator` (two visitor overrides). Corpus entries V081, V082, V083 |
| F2 | The legacy form `FROM ::fn_virtualfilestats(NULL, NULL)` was accepted. ScriptDom represents it as a different node (`BuiltInFunctionTableReference`) with a plain identifier, so the `fn_` check on schema object names never saw it | Low: the login has no `VIEW SERVER STATE`, so the functions that matter fail on the server | **Fixed** in `SqlValidator`. Corpus entry V078. `STRING_SPLIT` (another node type) stays allowed and is in the corpus as V114 |
| F3 | A filter JSON with a null entry or without a column (`[null]`, `[{}]`, `[{"op":"contains"}]`, `"column": null`) threw a `NullReferenceException` in the cache key, so the rows and export endpoints answered 500 instead of 400 | Low: unhandled error on hostile input, no data involved | **Fixed** in `ResultQuery.ParseFilters` (400 `RESULT_QUERY_INVALID`). Unit tests failed before the change |
| F4 | The key of the cached "last order" of a result was built with colons and bars between the texts, so two different filters could produce the same key (`value "x:" + value2 "y"` against `value "x" + value2 ":y"`; one filter whose value imitates the key of two filters). The second question was answered with the rows of the first. Grid and export used the same cache, so they stayed equal to each other but both were wrong | Low: only the person's own result, no access across people | **Fixed** in `ResultQuery.CacheKey` (every part written with its length). Unit tests failed before the change |
| F5 | The CSV formula guard looked at the very first character only. A text such as `"  =1+1"` or `"\n=cmd..."` was written as it is. Spec 12.3 says first non-whitespace character | Low: whether a spreadsheet takes a formula behind spaces for a formula depends on the program, the spec asks for the guard | **Fixed** in `ReportCsvWriter.StartsLikeAFormula`. Unit tests failed before the change |
| F6 | The report login can run `xp_dirtree` and `xp_fileexist` (and `xp_fixeddrives`, `xp_msver`) of `master`, which SQL Server grants to every login. Everything that writes, runs commands or reads the registry is refused | Low through the application (a report is one validated SELECT; `EXEC`, `sp_` and `xp_` are refused), medium for someone who holds the login password: the SQL Server host's directory structure, and on Windows a UNC path to another machine | **Open, issue #1292.** Not small and not inside the module: the fix is a DENY for the login in `master`, part of the provisioning script and runbook section 11. The test pins the current set, so it fails when the set grows and must change when the issue is closed |

## Observations that are not defects

- `GRANT` or `DENY` that the login gives to itself is ignored by SQL Server without an error. The test checks the effect (no permission recorded, `HAS_PERMS_BY_NAME` still 0, `AuditEvent` still unreadable), not an exception.
- The report login can see which database and server permissions it holds: `CONNECT SQL`, `VIEW ANY DATABASE` at server level and `CONNECT`, `VIEW ANY COLUMN ENCRYPTION KEY DEFINITION`, `VIEW ANY COLUMN MASTER KEY DEFINITION` in the database. The test lists a set of forbidden ones (CONTROL, ALTER, INSERT, UPDATE, DELETE, EXECUTE, CREATE ..., VIEW SERVER STATE, IMPERSONATE, ...) and fails when one appears.
- Every login can read some system catalogue tables of `master` (for example `spt_values`); they hold no data of ours. `sp_who`, `sp_tables` and the list form of `sp_configure` also work for every login and show only what the login may see.
- A write (POST, PUT, DELETE) without the `X-MatterFlow-Client` header answers 400 before authentication; the 401 walk therefore sends the header.
- The 400 for a bad sort or filter has the media type `application/json` (not `application/problem+json`) because of the controller's `[Produces]`. The body is the usual problem document. Cosmetic.
- A sort text of several thousand characters is cut off earlier with `QUERY_TOO_LARGE`.
- The `RequestSizeLimit` of 256 kB is enforced by Kestrel; the in-process test server does not apply it, so the limits behind it (text 400 characters, at most 200 or 1,000 list elements) are tested with bodies of up to 240 kB.
- A client that goes away cancels the query on the server (`A_client_that_goes_away_cancels_its_query_on_the_server`): works in the in-process server; the production path (Kestrel) is the same `RequestAborted` token.
- Option A (#808) is pinned as documented: see `ReportSensitiveMatterInterimTests`. When the owner confirms decision 2 or chooses another option, those tests and the `Open` lines of `SensitiveAccessCatalog` change together.

## What was added

| Area | Tests | Where |
|---|---|---|
| Validator corpus (114 entries, 93 refused, 21 inert look-alikes) | 114 + 2 | `UnitTests/Reports/ReportSecurityCorpusTests.cs`, `Corpus/validator-corpus.json` |
| Injection values for every parameter type (binder) | 13 | same file, `Corpus/injection-values.json` |
| CSV formula corpus, quoting, line breaks, typed values, export equals grid | 14 | `UnitTests/Reports/ReportCsvSecurityTests.cs`, `Corpus/csv-formula-corpus.json` |
| Hostile sort (`#n`), filter and column names, cache key | 54 | `UnitTests/Reports/ResultQueryHostileInputTests.cs` |
| Injection through the real login, hostile sort, filter, column and paging inputs, position sort | 6 | `IntegrationTests/Reports/ReportInjectionCorpusTests.cs` |
| Direct-login rights | 5 | `ReportLoginRightsTests.cs` |
| Abuse limits | 9 | `ReportAbuseLimitsTests.cs` |
| Access walk over every route, same 404 for every reason, current version only | 3 | `ReportAccessMatrixTests.cs` |
| CSV through the real login, expired, lost permission | 4 | `ReportCsvExportSecurityTests.cs` |
| No SQL text anywhere | 2 | `ReportNoSqlLeakTests.cs` |
| Audit | 2 | `ReportAuditSecurityTests.cs` |
| Sensitive matters, option A | 4 | `ReportSensitiveMatterInterimTests.cs` |

198 new unit tests and 35 new integration tests, all with the trait `Suite=ReportsSecurity`. No new permission, no schema script, no frontend change, no API or contract change (OpenAPI and the generated client are untouched).

## Runs

Everything ran through `/home/user/.mf-heavy/heavy.sh`, one integration class at a time, each with its own Testcontainers SQL Server 2022 (the container is removed at the end of a class; the disk stayed above 2.5 GB free).

| Run | Result |
|---|---|
| `dotnet test tests/MatterFlow.UnitTests --filter "FullyQualifiedName~Reports"`, twice | 922 passed, 0 failed, both times (198 of them new) |
| New integration classes (`Suite=ReportsSecurity`, 8 classes), pass 1 and pass 2 | 35 of 35 passed, both passes |
| Existing Reports integration classes after the four code fixes (Rows, Export, Views, Run, Preview, Analyze, Choices, ListBinding, Starter, Audit, LoginProbe) | 119 of 119 passed |
| `tests/MatterFlow.ArchitectureTests` | 51 of 51 passed |
| `dotnet build -warnaserror` of the unit and integration test projects (and so of the Api and every module) | succeeded, 0 warnings |
| `dotnet format --verify-no-changes` for the Reports project and the new test files | clean |

Not run: the remaining classes of `IntegrationTests/Reports` (Admin, Assignment, Definition, List, Schema, DateTime, CategoryRule, ReportsModule, AssetReports), `SchemaTests`, the contracts check, the frontend suites and the Playwright e2e. None of them touches the files that changed (`SqlValidator`, `ResultQuery`, `ReportCsvWriter`); the validator is exercised by every run, preview, analyze and starter test above.
