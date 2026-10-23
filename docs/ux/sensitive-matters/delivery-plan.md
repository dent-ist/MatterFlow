# Sensitive matter access control: delivery plan

Design: `README.md` (same folder). Decisions: addendum section AJ. Label `phase-20`. Estimates are agent-hours including tests. Nothing here claims a SQL script number: "next free number at implementation time" (28 to 33 are used on `dev`).

## Work packages

| ID | Package | Hours | Depends on |
|---|---|---|---|
| SM-01 | Permission `Matter.ViewSensitive`: catalog, `Permissions.cs`, `permissions.ts`, grant script (Director, System Admin), Roles screen text | 1.5 | none |
| SM-02 | Visibility port `IMatterVisibility` (SharedKernel), sources in Organization/WorkManagement `.Contracts`, C# predicates, feature switch, EF filter spike (decide filter vs explicit only), permission-cache check | 2.5 | SM-01 |
| SM-03 | SQL twin: inline TVFs `fnMatterVisible`/`fnTaskVisible`/`fnAssetVisible`, indexes, DENY for `mf_report_reader`, C#/SQL parity test, plan check at 20k tasks | 3.0 | SM-02 |
| SM-04 | Organization reads: clients summary/counts, matters list/lookup/get/summary, projects; 404 helper; matter writes via visible source | 3.0 | SM-02 |
| SM-05 | Mark/un-mark rules: audited `MATTER_SENSITIVITY_CHANGED`, un-mark restriction, creator-needs-manager rule, confirm dialog data | 1.0 | SM-04 |
| SM-06 | WorkManagement: tasks read/write, workflow, comments, task assets, activity, bulk and assign-batch, matter header (mode H) | 3.5 | SM-02, SM-04 |
| SM-07 | Assets (mode A) and Search (suggestions, advanced) | 3.0 | SM-02, SM-06 |
| SM-08 | WorkViews: Task Queue, My Work, Pod Work, Swimlane | 2.0 | SM-02, SM-03 |
| SM-09 | Dashboard (summary, scopes, trend, workload, coverage) and cache partitioning by viewer class | 2.0 | SM-03, SM-08 |
| SM-10 | My Matters (summary, health, attention, deadlines, workload, activity, seen marker) | 1.5 | SM-03, SM-08 |
| SM-11 | Identity and Configuration counts: assignee ranker/load, users counts, pods, "in use" guards and wording | 1.5 | SM-03 |
| SM-12 | Notifications: producer check, read-time filter, unread count, scheduler SQL (Due, Stalled), immediate revoke | 2.5 | SM-03 |
| SM-13 | Audit: events/search/facets, `IAuditReader`, display lookup, task-scoped activity, optional sensitivity stamp | 2.5 | SM-03 |
| SM-14 | Frontend: 404 handling, task header without matter link, lookups/caches/recent items/titles/breadcrumbs, confirm dialog, Roles text | 2.5 | SM-04, SM-06 |
| SM-15 | Test harness: universe fixture, six personas, endpoint catalog, response sentinel sweep, access matrix data (written first, red) | 3.5 | SM-01, SM-02 |
| SM-16 | Catalog coverage for every endpoint + architecture tests (raw-SQL scan, `Set<>` ban, `IAuditScoped` check) + mutation tests (immediate revoke) | 2.0 | SM-15 and the read packages |
| SM-17 | Frontend e2e per persona with DOM/storage/network sentinel scan | 1.5 | SM-14, SM-15 |
| SM-18 | Migration: report of existing sensitive matters, runbook, release note, go-live switch, perf run at 20k tasks | 1.0 | SM-03 |
| SM-19 | Contract/docs sync (OpenAPI, nswag, permissions parity), docs update, final verification issue | 1.0 | all |
| SM-20 | Reports decision tracker (open decision, interaction risks) | 0.5 | none |

**Total 41.5 agent-hours** (about 12 h tests, 29.5 h build). Slightly above the 30 to 40 h guess because the systematic endpoint suite (SM-15, SM-16, SM-17: 7 h) is the main control; if it must shrink, SM-17 (1.5 h) can follow the main release.

## Waves

1. **Wave 1 (foundations, 7.5 h):** SM-01, SM-02, SM-15 (tests first, red), SM-20. Exit: the port compiles, the harness runs and fails on every unprotected endpoint.
2. **Wave 2 (SQL and core reads, 12 h):** SM-03, SM-04, SM-05, SM-06. Exit: matters, tasks and projects are protected; the persona suite is green for Organization and WorkManagement rows.
3. **Wave 3 (all other read paths, parallel, 13.5 h):** SM-07, SM-08, SM-09, SM-10, SM-11, SM-12, SM-13. Each turns its rows of the inventory green.
4. **Wave 4 (UI, hardening, release, 7.5 h):** SM-14, SM-16, SM-17, SM-18, SM-19. Exit: catalog complete (an unclassified endpoint fails the build), e2e scan clean, final verification.

Critical path: SM-01, SM-02, SM-03, SM-08, SM-09, SM-16, SM-19.

## Definition of done (every issue)
- Acceptance criteria met; unit, integration (persona walk rows for the touched endpoints) and, where UI changes, e2e tests added and green twice.
- Inventory row(s) in README section 16 updated (final mode and test).
- Hidden resource answers 404 identical to a missing one; counts equal list parity for all six personas.
- No new or changed keyboard shortcut (#420); no SQL script number claimed in docs; new scripts use the next free number at implementation time and are not edited after merge.
- Module boundaries intact (`MatterFlow.ArchitectureTests`); `dotnet build -warnaserror`, `dotnet format`, Prettier and lint clean; OpenAPI and nswag client regenerated; permissions catalog parity.
- No sensitive sentinel in any response, log line, cache or client storage (README 12.2 sweep).

## Epic definition of done
Catalog test complete (no unclassified endpoint); C#/SQL parity green; mutation tests prove immediate revocation; performance within +15% on the heaviest reads; existing sensitive matters reviewed with the owner; Reports decision recorded (or the interim option A stated in the release notes); documentation and addendum AJ current.

## Issues
Epic #788. SM-01 #789, SM-02 #790, SM-03 #791, SM-04 #792, SM-05 #793, SM-06 #794, SM-07 #795, SM-08 #796, SM-09 #797, SM-10 #798, SM-11 #799, SM-12 #800, SM-13 #801, SM-14 #802, SM-15 #803, SM-16 #804, SM-17 #805, SM-18 #806, SM-19 #807, SM-20 #808.
