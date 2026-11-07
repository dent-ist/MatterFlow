# Reports: security test coverage matrix (issue #725)

Written 2026-11-07 by Agent RL (backend QA and security), branch `reports`. It answers one question for every threat and every acceptance line of #725: which test proves it today, and what was missing. The tests added with this document are listed per line, and the findings are in `security-test-results.md`.

Sources: issue #725 and its review comment, `status-2026-11.md` (WP-RA8, sections 2, 3 and 7), `README.md` section 6.3 (validator), 6.5 (limits), 7 (threat model), 12 (CSV), 13 (audit) and 16.3 (tests a to k), ADR 029, the wiki page Reports Module, and issue #808 (sensitive matters, option A).

How to run the suite (all tests of the Reports security work carry the trait `Suite=ReportsSecurity`; the older tests listed below are selected by class name):

```
cd backend
dotnet test tests/MatterFlow.UnitTests --filter "FullyQualifiedName~Reports"
dotnet test tests/MatterFlow.IntegrationTests --filter "Suite=ReportsSecurity"        # needs Docker; run a class at a time on a small disk
dotnet test tests/MatterFlow.IntegrationTests --filter "FullyQualifiedName~Reports"   # everything of Reports, new and old
dotnet test tests/MatterFlow.SchemaTests --filter "FullyQualifiedName~ReportsSchemaTests"
dotnet test tests/MatterFlow.ArchitectureTests
```

Data files (checked in, read by unit and integration tests): `backend/tests/MatterFlow.UnitTests/Reports/Corpus/validator-corpus.json` (114 entries, 93 refused), `injection-values.json` (text 69, numbers 20, dates 17, ids 13) and `csv-formula-corpus.json` (34 formulas, 18 safe texts). The integration project links the same files.

## 1. Acceptance lines of #725 and of its review comment

| Acceptance line | Covered by | State |
|---|---|---|
| Suite runs in CI and fails on any regression | Every test below runs in the normal backend CI jobs (unit, integration, schema, architecture). The new classes carry `[Trait("Suite", "ReportsSecurity")]` so the suite can also be run alone. The older security tests do not carry the trait yet (adding it to about 15 existing classes is a one-line change each and was left out to avoid edit conflicts) | Done, trait on the new classes only |
| Direct-login tests prove no write, EXEC or audit access | `ReportsSchemaTests.The_report_login_cannot_write_execute_or_change_anything`, `.The_catalogue_equals_the_effective_rights_of_the_report_role`, `ReportLoginProbeTests.The_report_login_itself_reads_business_data_and_nothing_else`. New: `ReportLoginRightsTests` (5 tests) | Done |
| Injection and validator corpora checked in as data files | New: `Corpus/validator-corpus.json`, `injection-values.json`, `csv-formula-corpus.json`, run by `ReportSecurityCorpusTests` (unit) and `ReportInjectionCorpusTests`, `ReportCsvExportSecurityTests` (integration, real login) | Done |
| Findings recorded in `security-test-results.md` | New file next to this one | Done |
| Unit, integration and e2e tests green (twice), permission variants | Unit and integration: green twice, see results file. Permission variants: `ReportAccessMatrixTests` (no permission, Run only, Manage only, Assign only against every Reports route), `ReportAssignmentApiTests`, `ReportAdminApiTests` (per controller). e2e: not part of this backend work (QA2 owns the Playwright run) | Backend done, e2e not run |
| Keyboard-only flows, axe, bundle size | Frontend and e2e; no frontend was touched here | Not in scope |
| Review comment: injection corpus as a data file through the real login for every parameter type | `ReportInjectionCorpusTests` (text, number, integer, date, single, multi, lookup, multi lookup, yes/no, date range) | Done |
| Review comment: validator corpus with at least 60 entries | `validator-corpus.json`, 93 refused plus 21 inert look-alikes, asserted by `The_validator_corpus_is_a_data_file_with_at_least_sixty_refused_statements_and_unique_ids` | Done |
| Review comment: direct-login lines for `xp_cmdshell`, other database and role membership | `ReportLoginRightsTests` (procedures, other database, `IS_SRVROLEMEMBER`, `IS_MEMBER`, `fn_my_permissions`) | Done, one finding (#1292) |
| Review comment: CSV formula corpus (with #721) | `ReportCsvSecurityTests` (unit), `ReportCsvExportSecurityTests` (integration) | Done, one hardening fix |
| Review comment: cross-user 404 for views (with #722) | `ReportViewsApiTests.Nobody_sees_edits_deletes_or_defaults_another_persons_view...`, `.Views_follow_the_report_rule...`; new `ReportAccessMatrixTests` walks the view endpoints for every reason a report stops being available | Done |
| Review comment: one test over every Reports endpoint for 401 and 403 | New `ReportAccessMatrixTests.Every_reports_endpoint_is_401_without_a_login_403_without_its_permission_and_reachable_with_it` (reads the route table, 42 operations) | Done |
| Review comment: XSS strings inert in the grid | Frontend spec (Angular interpolation only). Backend side: `ReportViewsApiTests.A_stored_view_is_plain_text_data_and_hostile_strings_come_back_unchanged`, `ReportCsvExportSecurityTests` (`<script>` and similar come back as data). The grid spec is not written: no frontend change in this task | Open, frontend |

## 2. Spec 16.3 (a) to (k)

| Line | Existing tests | Gap found | New tests |
|---|---|---|---|
| (a) injection corpus on every parameter type | `ParameterBinderTests` (per type, hostile choice texts, `A_multi_choice_array_is_built_by_the_serializer...`), `ReportListBindingTests` (`Hostile_text_options_come_back_as_plain_values`, `A_hostile_json_array_that_bypasses_the_binder...`), `ReportRunApiTests.Invalid_parameter_values_are_422...` | No corpus file; no proof through the real login for number, date, lookup, yes/no, range; nothing showed that the executed statement is the same for every value | `ReportSecurityCorpusTests` (binder, every type, typed or refused by name), `ReportInjectionCorpusTests` (real login: echo equals the value, rows counted by equality, statement text from the plan cache identical for 69 values, no new object or login, no WAITFOR delay, 876 requests for the other types) |
| (b) validator refuses 60+ statements | `SqlValidatorTests` (about 100 refused statements in code, 60+ asserted), `SqlScannerTests` (placeholders in strings, comments, brackets, at signs, unterminated) | Not a data file; no case of FOR after UNION or a parenthesised query, `::fn_` functions, nested comments, lowercase and mixed spelling, administration statements | `validator-corpus.json` + `ReportSecurityCorpusTests` (114 entries, verdict and stable code). Found and fixed: FOR XML/JSON after UNION or on `(SELECT ...)`, and `FROM ::fn_name()` were accepted |
| (c) the login itself cannot write, exec, read audit | `ReportsSchemaTests` (per table rights from the catalogue; INSERT, UPDATE, DELETE, TRUNCATE, ALTER, DROP, CREATE, EXEC of both procedures and `xp_cmdshell`, `IS_MEMBER`), `ReportLoginProbeTests` (startup probe, over-privileged logins) | `xp_cmdshell` only as one line; no other database, no linked server, no OPENROWSET/BULK, no role change, no GRANT, no impersonation, no server or database permission list, no procedure enumeration, no query on `IsSensitiveScope` | `ReportLoginRightsTests` (writes incl. privilege escalation in `UserRole`, DDL, rights, administration, procedures, linked servers, external data, other database, direct connect to another database, credentials metadata, server state, permission lists, role membership). Found: `xp_dirtree` and `xp_fileexist` callable (#1292) |
| (d) access catalogue | `ReportAccessCatalogueTests` (6), `ReportsSchemaTests.The_catalogue_equals_the_effective_rights_of_the_report_role` | none | none |
| (e) architecture | `ArchitectureTests` (module dependency rules, only Reports reads `ReportsReadOnly`, a policy on every action) | The behavioural double check was missing | `ReportAccessMatrixTests` fails when a Reports route has no single permission policy or allows anonymous |
| (f) connection-string guard | `ReportsConnectionGuardTests` (8), `ReportLoginProbeTests` (`The_application_connection_is_never_accepted...`, no connection, wrong password) | none | none |
| (g) CSV formula | `ReportCsvWriterTests` (prefixes `=` `+` `-` `@` TAB CR, headers, real negative numbers), `ReportExportApiTests` (guard in a real export, equals grid, headers) | No corpus; leading white space before a formula was not guarded although spec 12.3 says first non-whitespace; embedded line breaks, quotes, awkward text never read back with a CSV reader; numbers and dates beside hostile text not shown through a real query | `ReportCsvSecurityTests` (34 formulas, 18 safe texts, headers, typed values, quoting and line breaks read back, export equals grid with `#n` sort), `ReportCsvExportSecurityTests` (the same through the real login, 63 hostile cells, hostile headers). Fixed: white space before a formula |
| (h) cross-user access of `runId` and views | `ReportRowsApiTests.Another_persons_result_is_404...`, `ReportExportApiTests.Another_persons_result_is_404...`, `ReportViewsApiTests.Nobody_sees_edits_deletes_or_defaults_another_persons_view...` | Cancel and drop of another person's run; expired result for the owner against a stranger; a result after losing access | `ReportAbuseLimitsTests.Cancel_stops_only_my_own_run...`, `ReportCsvExportSecurityTests` (expired 410 for the owner and 404 for a stranger, lost permission 403), `ReportAccessMatrixTests` (rows and export after each reason access ends) |
| (i) no SQL text in errors for run-only users | `ReportRunApiTests.A_failing_query_shows_the_caller_a_reference...`, `ReportListApiTests` and `ReportDefinitionApiTests` (`The_body_never_contains_the_sql...`), `ReportChoicesApiTests.A_failing_choice_query_shows_the_author_the_reason_and_a_runner_only_a_reference` | Views, rows, export, cancel, assignment screens, hash mismatch, stored text that fails the validator, reports off, headers | `ReportNoSqlLeakTests` (more than 50 calls by a runner, an assigner, a manager without Run, a stranger and an anonymous caller, markers in the SQL, the choice query, a conversion error value, the tampered text and the hash; bodies and headers) |
| (j) 401/403 per endpoint | `ReportAdminApiTests.Every_manage_endpoint_refuses_people_without_Report_Manage`, `ReportAssignmentApiTests.Every_assignment_endpoint_refuses_people_without_Report_Assign`, `ReportViewsApiTests.Without_Report_Run_every_view_endpoint_is_forbidden...`, `ReportRowsApiTests` and `ReportExportApiTests` (403), `ReportPreviewApiTests.Only_Report_Manage_may_preview...` | Written by hand per controller, so a new endpoint was not covered automatically; `status`, `analyze`, `schema`, `runs/current` and `{runId}` were not all in the lists | `ReportAccessMatrixTests` (every route x anonymous, no permission, each single permission) |
| (k) XSS strings inert | `ReportViewsApiTests` (stored view is data) | The grid and name rendering is a frontend matter | Open for the frontend; backend returns JSON only and the export is `text/csv`, `attachment`, `nosniff` (`ReportExportApiTests`) |

## 3. Threat model (README section 7)

| Threat | Control | Tests | Gap closed here |
|---|---|---|---|
| 7.1 injection through values | typed parameters, constant list sub-select, choice values rechecked | `ParameterBinderTests`, `ReportListBindingTests`, `ReportChoicesApiTests.A_submitted_value_that_is_not_in_the_list_gives_422...` | Corpus through the real login for every type and for sort, filter, column and paging inputs |
| 7.2 malicious admin SQL | validator, login rights, probe, run log | `SqlValidatorTests`, `ReportsSchemaTests`, `ReportLoginProbeTests`, `ReportRunApiTests.A_stored_text_that_no_longer_matches_its_hash_or_the_validator...` | Bypass corpus, direct-login attempts, oversized stored text |
| 7.3 audit and credential tables | catalogue, DENY | `ReportAccessCatalogueTests`, `ReportsSchemaTests` | Real attempts, `IsSensitiveScope`, credential metadata, other databases |
| 7.4 resource abuse | timeout, row cap, one run per person, global cap, memory budget, rate limit | `ReportRunApiTests` (timeout, cap, 409, 429, 429 per hour), `ReportRunGateTests`, `ReportRowsApiTests.A_result_over_the_memory_budget_is_503...`, `ReportPreviewApiTests.A_preview_uses_the_one_running_report_lock...` | Meeting limits (8 parallel runs of one person, 5 people against a cap of 2), cancel by someone else, client disconnect, the default 50,000 cap and the settings ceilings, huge lists and texts, oversized SQL on every entry, budget not used by refused requests |
| 7.5 data exposure to the wrong people | assignment gate, option A | `ReportListApiTests`, `ReportDefinitionApiTests`, `ReportCategoryRuleApiTests`, `SensitiveEndpointCatalogTests` | `ReportAccessMatrixTests` (every reason a report stops being available looks like an unknown id), `ReportSensitiveMatterInterimTests` (4) |
| 7.6 CSV formula | writer guard | see (g) | see (g) |
| 7.7 cross-user results | owner check, 128-bit id | see (h) | see (h) |
| 7.8 error leaks | codes and references only | see (i) | see (i) |
| 7.9 stored XSS | Angular interpolation | `ReportViewsApiTests` | frontend open |
| 7.10 connection misuse | no fallback | `ReportsConnectionGuardTests`, `ReportLoginProbeTests`, `ReportRunApiTests.Reports_are_off_without_a_report_login` | `ReportNoSqlLeakTests.While_reports_are_off...` (answers do not name the connection or login) |
| 7.11 history tampering | append-only | `ReportsSchemaTests`, `ReportAdminApiTests.Versions_stay_append_only_in_the_database` | the login cannot touch them (`ReportLoginRightsTests`) |
| 7.12 schema browser denial | paged metadata | `ReportSchemaApiTests` | none |
| 7.13 privilege creep | catalogue test | `ReportAccessCatalogueTests` | `ReportLoginRightsTests` lists the login's server and database permissions, so a new right shows up |

## 4. The areas named in the task

| Area | Existing | New (count) | Remaining gap |
|---|---|---|---|
| SQL text (validator bypass) | `SqlValidatorTests`, `SqlScannerTests` | corpus file + test, 114 entries (unit) | none known |
| Parameters, every type | `ParameterBinderTests`, `ReportListBindingTests` | 13 unit tests, 5 integration | none known |
| Sort, filter, column names (rows, export, `#n`) | `ResultQueryTests`, `ReportRowsApiTests`, `ReportExportApiTests` | 54 unit cases, 2 integration | none known |
| Login rights | `ReportsSchemaTests`, `ReportLoginProbeTests` | 5 integration | #1292 (open) |
| Abuse limits | `ReportRunApiTests`, `ReportRunGateTests` | 9 integration | the 256 kB body limit is enforced by Kestrel and cannot be exercised in the in-process test server (the parameter limits behind it are tested) |
| CSV | `ReportCsvWriterTests`, `ReportExportApiTests` | 14 unit + 4 integration | none known |
| Access | per-controller theories, `ReportCategoryRuleApiTests` | 3 integration | none known |
| Audit | `ReportAuditApiTests`, `ReportAuditEntryTests` | 2 integration | none known |
| No SQL text | see (i) | 2 integration | none known |
| Sensitive matters, option A | `SensitiveEndpointCatalogTests` | 4 integration | Reports stay `Open` in the persona walk until the owner confirms decision 2 (#808) |

## 5. Not covered, on purpose

- Frontend: XSS-inert grid and name rendering, keyboard-only flows, axe, bundle size (no frontend change in this task).
- End to end in a browser with a real login (QA2).
- Request body limit of 256 kB (Kestrel; the in-process server does not apply `RequestSizeLimit`).
- Windows authentication and a corporate login (runbook section 11, checked by hand).
- Timing of a run under load and the performance targets of section 15 (#726).
