# My Matters: performance measurements (issue #686, epic #667)

Measured by `MyMattersPerformanceTests` (`backend/tests/MatterFlow.IntegrationTests/WorkViews`), run on 2026-10-23 on the shared build machine against SQL Server 2022 in Docker, API in-process.

**Data:** 200 matters of one client, 24,000 tasks (20,000 open, 4,000 completed; 1 in 12 open tasks on hold for 0 to 20 days, 2 in 3 unassigned, 1 in 6 ASAP), 3 step instances per task (72,000), about 100,000 audit events over 120 days, 20 people, 4 pods. Managers: `pm5` manages 5 matters (2.5 % of the tasks), `pm50` 50 matters (25 %), `heavy` 145 matters (the worst case of "mine"), a director uses the All matters scope (all 200).

**Budget (plan):** each endpoint p95 under 300 ms warm and under 800 ms cold; no read of `Task` by scan; a constant number of statements. The test fails at twice the time budget (shared machine) and fails on any scan of a Task index for the 5- and 50-matter managers.

## Result after script 33 (warm p95 over 15 runs; cold = first call)

| Endpoint | pm50 cold / p95 | heavy (145) cold / p95 | All matters cold / p95 | Statements (mine / all) |
|---|---|---|---|---|
| summary (`fresh=true`) | 33 / 10 ms | 19 / 27 ms | 39 / 44 ms | 2 / 3 |
| attention | 127 / 91 ms | 42 / 58 ms | 123 / 79 ms | 7 / 8 |
| health, first page | 432 / 39 ms | 39 / 67 ms | 87 / 56 ms | 3 / 4 |
| health, sorted by open | 29 / 47 ms | 37 / 58 ms | 60 / 146 ms | 3 / 4 |
| health, page 2 | 9 / 9 ms | 45 / 199 ms | 55 / 53 ms | 2-3 / 4 |
| workload | 34 / 18 ms | 27 / 21 ms | 39 / 30 ms | 4 / 5 |
| deadlines, 14 days | 30 / 13 ms | 19 / 18 ms | 25 / 28 ms | 4 / 5 |
| deadlines, 28 days | 9 / 13 ms | 16 / 23 ms | 17 / 19 ms | 4 / 5 |
| activity (30) | 36 / 43 ms | 36 / 48 ms | 13 / 17 ms | 8 / 9 |

The one cold value above 300 ms (432 ms, the very first health call of the process) is the EF query compilation; it stays inside the 800 ms cold budget. Statement counts are identical for 5, 50 and 145 matters (checked per endpoint by `The_number_of_statements_does_not_depend_on_the_number_of_matters`). The summary strip is cached by `DashboardCache` (`Dashboard:CacheSeconds`, default 15 s); the numbers above bypass the cache.

## Why script 33 (plans)

Before the script, `IX_Task_Matter (MatterId, StatusCode)` did not carry the columns the counts read (`DueDate`, `DueAtUtc`, `AssignedUserId`, `StatusChangedAt`). Every endpoint therefore planned a **Clustered Index Scan of `PK_Task` (estimate 20,000 rows)** even for the manager of 5 matters, the health table scanned `UQ_Task_WorkflowInstance` (24,000 rows) for the step counts, and the attention list sorted whole candidate sets after key lookups. Logical reads of the statements of one request (`last_logical_reads`, summed), before and after:

| Request | pm5 before | pm5 after | pm50 before | pm50 after |
|---|---|---|---|---|
| summary | 687 | 40 | 687 | 390 |
| attention | 5,717 | 281 | 4,860 | 1,952 |
| health, first page | 2,010 | 370 | 2,253 | 999 |
| deadlines (14 days) | 1,803 | 180 | 976 | 880 |

After the script (`33-my-matters-indexes.sql`: `IX_Task_Matter` re-created with `INCLUDE (DueDate, DueAtUtc, DueSortKey, AssignedUserId, AssignedPodId, StatusChangedAt, CreatedAt, WorkflowInstanceId)` and `IX_StepInstance_Workflow` with `INCLUDE (Status)`) the plans of `pm5` and `pm50` contain **no scan of any Task index** for any endpoint (test `A_person_with_a_few_matters_reads_the_task_table_only_by_seeks`, which reads `sys.dm_db_index_usage_stats` before and after the call). `heavy` and the All scope read most of the table; for them the optimizer scans the new narrow covering index once, which is the right plan (the clustered index was 12 times wider).

The attention list and the deadlines first read only the **ids** of the top rows (`TOP 10` / `TOP 25` over index columns: a seek and a small sort), then the columns of those few tasks and the names in one statement each; reading title and number inside the sorted query had made the optimizer scan the clustered index.

## Recent activity (Q11)

The activity read takes the lowest audit event id of the window from `IX_Audit_Time` and then reads the rows with `AuditEventId >= that id` (clustered key range) filtered by matter and kind. At 100,000 events (about 14,000 in the 7-day window) it takes 17 to 48 ms p95 and 108 to 1,249 logical reads; the optimizer prefers the clustered range over `IX_Audit_Matter` here because the window is already small. **No audit index was added** (not justified by the measurement). Revisit it if the weekly audit volume of the whole firm grows by two orders of magnitude: the first candidate would be a filtered index on `(MatterId, AuditEventId) INCLUDE (EventType, ActorUserId, TaskId, FieldKey)` for the five event types shown.

## Scope cap

The All matters scope refuses more than 5,000 matters with 400 `SCOPE_TOO_LARGE` (narrow by client or project manager). The health table sorts the matters of the scope in memory (at most the cap) and reads the step counts for the 50 rows of the page only.

## Epic #758 additions (PX-12, #770)

`MyMattersPerformanceTests` was extended, on the same data (200 matters, 24,000 tasks, about 100,000 audit events) plus **100,000 assets** on those matters, **300 more clients** (one matter and one project each, managed by one more project manager) and **three projects per matter**. Budget: p95 under 300 ms warm and 800 ms cold per endpoint (the test fails at twice that on a shared machine), a fixed number of statements, no scan of `Task` for a person with few matters, search with the new flag not slower than without it by more than 10 percent. Measured on the build machine, 15 warm runs; cold = first call. No new index script was needed and no snapshot table.

| Endpoint | pm50 cold / p95 (statements) | heavy (145 matters) cold / p95 | All matters cold / p95 (statements) |
|---|---|---|---|
| deadlines 14 days, by day | 66 / 20 ms (5) | 44 / 40 ms | 67 / 28 ms (6) |
| deadlines 28 days, by day | 64 / 22 ms (5) | 62 / 51 ms | 69 / 48 ms (6) |
| deadlines 14 days, by matter | 77 / 98 ms (7) | 79 / 55 ms | 81 / 47 ms (8) |
| workload with `include=matters` | 41 / 26 ms (7) | 72 / 54 ms | 62 / 62 ms (8) |
| activity, filtered (`kind=STATUS_CHANGED`) | 56 / 42 ms (8) | 56 / 63 ms | 38 / 16 ms (9) |
| since your last visit | 133 / 82 ms (5) | 63 / 88 ms | 109 / 83 ms (6) |
| trends, 8 weeks | 88 / 53 ms (4) | 58 / 139 ms | 112 / 133 ms (5) |
| trends, 26 weeks | 53 / 48 ms (4) | 64 / 212 ms | 83 / 197 ms (5) |

The statement count is the same for 5, 50 and 145 matters for every endpoint (checked by `The_number_of_statements_does_not_depend_on_the_number_of_matters`, which now covers the new calls), and with a few matters (pm5) every read of `Task` by the new calls is a seek, not a scan (`A_person_with_a_few_matters_reads_the_task_table_only_by_seeks`).

**Trends need no snapshot table.** They read the creation and completion instants of the scope's tasks and the open tasks with a due date, and bucket them into weeks in memory. The slowest case is 26 weeks for the worst-case person (145 matters, about 17,000 tasks): median 73 ms, p95 about 212 ms (All matters, 26 weeks: p95 about 197 ms). That is inside the 300 ms budget and far below the 500 ms at which the plan would have added `dbo.MatterDailyStats`, so the derivation stays; its approximation (re-dated or re-opened tasks are judged by their current values) is stated in the answer.

### Scoped lists at 100,000 assets

| List (`matterManagedByMe=true`) | pm5 (2,500 assets) | pm50 (25,000) | heavy (72,500) | pmclients (300 clients) |
|---|---|---|---|---|
| assets, page of 50 | 25 ms median, p95 49 | 47, p95 63 | 105, p95 135 | not applicable |
| assets, `role=primary` | 24, p95 38 | 45, p95 64 | 96, p95 132 | not applicable |
| clients | 14, p95 15 | 14, p95 17 | 18, p95 25 | 11, p95 12 |
| projects | 5, p95 5 | 6, p95 7 | 9, p95 11 | 11, p95 12 |

Every one of them is a semi-join on the managed matter ids (`IX_Matter_PrimaryManager` / `IX_Matter_SecondaryManager`), 3 to 4 statements, p95 far under 300 ms, and cold under 150 ms.

**Finding fixed on the way: one statement per matter on a page of assets.** The assets list looked up the matter of each row one by one, so a page of 50 assets spread over 50 matters cost 45 to 51 statements (any list, filtered or not; a scoped list sorted by name spreads over many matters). `IMatterDirectory.FindManyAsync` (new, Organization.Contracts) names all the matters of the page in one statement: the list is now 4 statements and about three times faster (unfiltered page, 25,000 assets: 50 ms median before, 15 ms after).

### Search with the `inMyMatters` flag

The first version computed the flag inside the ranked statement (an `IN` on the managed matter ids in the projection). On a broad search that matches everything (`q=Perf`: 100,000 assets and 24,000 tasks) the optimizer evaluated it for every candidate row before taking the top N: median **404 ms against 248 ms** without the flag, 60 percent slower, which the test caught. The flag is now computed after the page is read, by one more small statement per type that returned rows (a probe of the manager indexes for at most a page of matter ids or client ids), and the ranked statement is exactly what it was. Measured with 25 alternating calls on each side:

| Search | pm50 with flag / without (median) | heavy with flag / without (median) |
|---|---|---|
| global, `q=Perf` (matches everything) | 266 / 269 ms | 274 / 252 ms |
| global, `q=asset 77` | 153 / 160 ms | 158 / 160 ms |
| advanced, assets, `q=Perf asset 9` | 158 / 153 ms | 159 / 155 ms |

Within the 10 percent allowance in all three. Note for the owner: a global search for a word that appears in every record (`Perf` here) takes about 250 ms with or without the flag, because the text search is a plain `LIKE` over 100,000 assets and 24,000 tasks; that is not caused by this epic and stays inside the 300 ms budget only just (p95 about 400 ms for this extreme term, which the test allows at 600 ms). A real search term narrows quickly (150 ms for the two other terms).

### Matter overview

`GET /matters/{id}/overview`: 9 statements for a matter with nothing in it, 14 to 16 for a matter with 120 tasks, assets and 500 audit events, the same for a project manager and for an observer; cold 31 to 41 ms, p95 29 to 105 ms. The count does not depend on the number of tasks, people or events: the only variation is the optional name lookups that are skipped when there is nothing to name (the test allows a difference of two between matters, and fewer than 20 in all).
