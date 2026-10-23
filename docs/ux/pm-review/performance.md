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
