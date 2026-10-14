# Performance round 1 (ticket 64)

Date: 2026-10-14. Scope: realistic data (300 users, 25,000 Tasks, 52,000 Assets, 60,000 comments, 100,000 Task-Asset links, 485,000 audit events), API latency at
50 and 100 concurrent users on the published build, query plans of the slow paths, fixes, browser timings, and sizing advice for 300 users.
Tooling and reproduction: `tools/perf/README.md`.

## 1. Summary

- At 50 concurrent users every scenario now has p95 below 500 ms except the numeric search typeahead (p95 760 ms, p50 256 ms). Before, search (p95 1.2 to 1.6 s), the
  filtered queue, advanced search, the dashboard, Task detail and every write were above their targets. Error rate 0 in all 12 runs.
- Throughput of the same mix on the same 4-core machine rose from 40 to 45 requests/s at 50 users (offered load, not capacity) and from 47 to 73 requests/s at 100 users; with no think
  time and the rate limits lifted, the saturation point rose from 45 to 65 requests/s (+44%).
- Found and fixed: Pod Work, My Work and Dashboard counts that scanned the whole Task table (the overdue rule reads columns no index had); a full scan of the comment table on every
  comment write; a case-insensitive substring scan of the Task table in search, the queue text filters and the audit text search (5 times more CPU than necessary); two reads per
  workflow step on every Task detail load; a `SELECT DISTINCT` over the whole audit trail for the audit filters.
- Not fixable with an index: substring search ("contains") on Assets is a scan of every Asset (about 40 ms of CPU per search at 52,000 Assets, linear in the table). It is now the biggest
  CPU consumer and the first thing to redesign if the Asset table grows beyond about 150,000 rows (section 8).

## 2. Setup

| | |
|---|---|
| Machine | one 4 vCPU virtual machine, 16 GB RAM, virtual disk. The API, SQL Server, the Node load generator and the Docker proxy all share the 4 cores. |
| SQL Server | 2022 (container), `MSSQL_MEMORY_LIMIT_MB=3072`, default MAXDOP and cost threshold, `READ_COMMITTED_SNAPSHOT ON`, simple recovery, data file 1 GB and log 512 MB pre-sized. |
| API | `dotnet publish -c Release -r linux-x64` (Kestrel, Development environment only for Dev auth), `Logging:Default=Warning`, default rate limits, default pool size 200. |
| Load | `tools/perf/loadtest.mjs`: 50 or 100 virtual users, 10 s warm-up then 60 s measured, think time 400 to 1600 ms, persona mix (62% technicians, 12% pod leads, 8% managers, 12% intake, 6% auditors) over 17 scenarios, `X-Dev-User` per user, `X-MatterFlow-Client: web`. |
| Method | The seeded database is restored before every run. Before and after runs are interleaved, three rounds each; the tables show the median of the three runs for each cell. "Before" is the `dev` branch at commit `c1dc417`, "after" this branch. |
| Caveat | Run-to-run spread on this shared machine is about 15 to 30% for p95. Compare ratios, not single digits. A real server with separate hardware for SQL Server will show lower absolute numbers and a different split between API and database CPU. |

## 3. Dataset

Loaded by `tools/perf/seed-perf-data.sql` (about 50 seconds, set-based):

| Object | Rows | Object | Rows |
|---|---:|---|---:|
| Users (with roles) | 301 | Task comments | 60,000 |
| Pods | 40 | Task-Asset links | 100,000 |
| Clients | 200 | Step instances (4.6 per Task) | 115,500 |
| Matters | 1,000 | Form value sets (Task + step) | 93,500 |
| Projects | 3,000 | Audit events | 485,000 |
| Assets (250 each in 50 Matters, 42 on average elsewhere) | 51,900 | Tasks (6,250 New, 6,270 In Progress, 1,250 On Hold, 10,040 Completed, 1,200 Cancelled; 3,100 open and overdue) | 25,000 |

Size: about 640 MB of data and indexes (audit 263 MB, step instances 151 MB, form values 100 MB, Tasks 30 MB, comments 27 MB, Assets 23 MB, links 14 MB). Task 1 has about 350
comments (long-thread paths). The volumes match the scale in decisions addendum H (200 to 300 users, 10+ Tasks per day, 200 to 300 Assets per Matter) with margin: 25,000 Tasks is about 7
years of activity at 10 a day; 52,000 Assets is 1/5 of the addendum's upper bound of 1,000 Matters x 250 (see risks).

## 4. Results

Latency in milliseconds per request, medians of three 60 s runs. Targets at 50 users: queues, My Work, Pod Work, search p95 under 500; Task detail under 300; dashboard under 800; writes under 400;
zero errors.

### 4.1 50 concurrent users

| Scenario | before p50 | before p95 | before p99 | after p50 | after p95 | after p99 | p95 change |
|---|---:|---:|---:|---:|---:|---:|---:|
| Task queue, default page (25 rows) | 69 | 214 | 307 | 43 | 110 | 144 | 1.9x faster |
| Task queue, filtered | 60 | 394 | 996 | 28 | 114 | 231 | 3.5x faster |
| Task queue, sorted / paged | 72 | 225 | 289 | 61 | 180 | 248 | 1.2x faster |
| My Work | 45 | 156 | 230 | 24 | 93 | 138 | 1.7x faster |
| Pod Work | 104 | 353 | 435 | 53 | 167 | 222 | 2.1x faster |
| Dashboard | 194 | 546 | 748 | 15 | 180 | 283 | 3.0x faster |
| Search typeahead, text | 580 | 1,221 | 1,412 | 191 | 391 | 458 | 3.1x faster |
| Search typeahead, numbers | 744 | 1,614 | 2,114 | 256 | 760 | 1,035 | 2.1x faster |
| Advanced search | 97 | 625 | 794 | 44 | 291 | 417 | 2.1x faster |
| Task detail (GET /tasks/{id}) | 106 | 331 | 473 | 42 | 134 | 226 | 2.5x faster |
| Task page (4 parallel calls) | 116 | 382 | 582 | 51 | 154 | 194 | 2.5x faster |
| Audit search | 40 | 490 | 782 | 23 | 289 | 391 | 1.7x faster |
| Task create | 218 | 704 | 977 | 108 | 288 | 386 | 2.4x faster |
| Step start | 153 | 499 | 685 | 76 | 220 | 351 | 2.3x faster |
| Step save values | 173 | 633 | 866 | 97 | 306 | 538 | 2.1x faster |
| Step complete | 151 | 506 | 707 | 73 | 224 | 414 | 2.3x faster |
| Comment add | 93 | 261 | 369 | 30 | 100 | 177 | 2.6x faster |

Throughput (requests/s, median of runs): before 40.3, after 45.3. Requests per run: before 2417, after 2721. Errors: before 0, after 0 (all runs).

Targets: all met except "Search typeahead, numbers" (p95 760 ms; p50 256 ms) and, narrowly, "Step save values" p99 only (p95 306 ms is within the write target).

### 4.2 100 concurrent users

The machine is saturated at this load (SQL Server about 2 cores, the API 1.2 cores, the rest the load generator and the Docker proxy), so these numbers show queueing, not the cost
of a request. They are the "what happens at twice the planned load on a small box" figures.

| Scenario | before p50 | before p95 | before p99 | after p50 | after p95 | after p99 | p95 change |
|---|---:|---:|---:|---:|---:|---:|---:|
| Task queue, default page (25 rows) | 354 | 783 | 976 | 150 | 426 | 567 | 1.8x faster |
| Task queue, filtered | 320 | 2,296 | 3,592 | 114 | 392 | 679 | 5.9x faster |
| Task queue, sorted / paged | 379 | 822 | 1,026 | 200 | 692 | 930 | 1.2x faster |
| My Work | 316 | 690 | 951 | 122 | 392 | 525 | 1.8x faster |
| Pod Work | 851 | 1,611 | 1,910 | 273 | 804 | 1,104 | 2.0x faster |
| Dashboard | 1,287 | 2,360 | 2,638 | 185 | 825 | 1,160 | 2.9x faster |
| Search typeahead, text | 2,550 | 3,860 | 4,438 | 614 | 1,219 | 1,478 | 3.2x faster |
| Search typeahead, numbers | 3,202 | 5,053 | 5,674 | 901 | 1,979 | 2,591 | 2.6x faster |
| Advanced search | 307 | 2,677 | 3,098 | 109 | 756 | 1,226 | 3.5x faster |
| Task detail (GET /tasks/{id}) | 834 | 1,943 | 2,292 | 243 | 699 | 893 | 2.8x faster |
| Task page (4 parallel calls) | 834 | 1,736 | 2,109 | 240 | 669 | 984 | 2.6x faster |
| Audit search | 207 | 1,846 | 1,959 | 80 | 915 | 1,267 | 2.0x faster |
| Task create | 2,073 | 3,381 | 4,199 | 604 | 1,869 | 2,398 | 1.8x faster |
| Step start | 1,311 | 2,390 | 2,580 | 375 | 1,192 | 1,662 | 2.0x faster |
| Step save values | 1,723 | 3,150 | 3,351 | 479 | 1,350 | 1,648 | 2.3x faster |
| Step complete | 1,338 | 2,275 | 2,622 | 368 | 1,143 | 1,510 | 2.0x faster |
| Comment add | 612 | 1,089 | 1,264 | 158 | 544 | 636 | 2.0x faster |

Throughput (requests/s, median of runs): before 46.6, after 72.8. Requests per run: before 2798, after 4370. Errors: before 0, after 0 (all runs).

### 4.3 Saturation (no think time, rate limits lifted, 50 users, 45 s)

| | before | after |
|---|---:|---:|
| Throughput (requests/s) | 44.7 | 64.5 |
| Errors | 0 | 0 |

The capacity of this 4-core box for the mix is therefore about 65 requests/s, roughly 55 to 65 busy people (a person issues about one request per second while working a list).
With a 15 second dashboard cache the dashboard no longer shows in the capacity figure.

## 5. Query-plan notes

Method: after each run `tools/perf/top-queries.sql` lists the costliest statements from the plan cache and the missing-index DMVs; the suspects were then run with
`SET STATISTICS IO, TIME ON` against the seeded database (unloaded, warm cache).

| Statement | Finding | Fix | Before | After |
|---|---|---|---|---|
| Pod Work counts (8 per page): `COUNT(*) FROM Task WHERE AssignedPodId = @p AND status IN (...) AND overdue rule` | the overdue rule reads `DueDate`, `DueAtUtc`; `IX_Task_Pod` did not carry them, so the clustered index was scanned | script 18 widens `IX_Task_Pod`, `IX_Task_AssignedUser`, `IX_Task_Queue` (INCLUDE only, same keys) | 1,112 reads, 8 ms CPU | 10 reads, 3 ms |
| Dashboard headline (8 counts in one statement) | 13 scans of the Task table | same covering indexes (plus 15 s cache) | 3,561 reads, 43 ms | 637 reads, 14 ms |
| `COUNT(*) FROM TaskComment WHERE TaskId = @id` (the 2,000 comment limit, on every comment write) | counts deleted comments too, so the filtered `IX_TaskComment_Task (... WHERE IsDeleted = 0)` cannot be used: whole table scan | `IX_TaskComment_TaskAll (TaskId)` | 2,649 reads, 27 ms | 2 reads, 1 ms |
| Task search / queue `q` and requestor filters: `Title LIKE '%x%' OR RequestorName LIKE '%x%'` | substring scan in the database's case-insensitive SQL collation | compare `LOWER(column) COLLATE Latin1_General_100_BIN2` (the rule the Asset search already used) | 91 ms CPU (25,000 Tasks) | 16 ms |
| Audit browser text search (485,000 events) | the same collation scan | same rule | 199 ms (common term), 1,506 ms (rare term) | 63 ms, 286 ms |
| Audit filter lists (`DISTINCT ObjectType`, `DISTINCT EventType`) | read all index entries of the trail, growing with it | skip scan: one index seek per distinct value in one batch | 245 ms (2 statements, 7,000 reads) | 12 ms |
| Task detail: step values | two statements (`FormValueSet`, `FormVersion`) per step, plus the input check repeated them | `IFormValueStore.GetManyAsync`, one read for all steps, reused by the input checks | about 22 statements for a 6-step Task | about 11 |
| Asset typeahead (52,000 rows) | scan of `Asset` with three `LOWER(...) LIKE '%x%'`; 40 ms CPU is the floor of the approach | none found (tested: parallel plan, `CHARINDEX`, persisted lower-case columns, an `IN` subquery for the type name; none was cheaper) | 40 to 50 ms | unchanged |

Other observations: the Task queue id page is answered from `IX_Task_Queue` without touching the table (existing test `The_page_query_is_answered_from_the_queue_index...` still passes); the queue
default page costs 5 statements, the Task detail 11, create about 41 and a step action about 24 (all 1 to 2 ms each, no repeated per-row statement); the access snapshot of a user is cached
for 60 s as designed. Lowering the log level made no measurable difference (Information vs Warning, 50 users).

## 6. Changes

Database (`db/scripts/18-performance-indexes.sql`): widened `IX_Task_Queue`, `IX_Task_AssignedUser`, `IX_Task_Pod`; new `IX_TaskComment_TaskAll`. Applied scripts were not edited (drop and create by name).

Code:
- `TaskQueueService`, `SearchService`, `AuditSearchService`: binary-collation substring comparison (`TextMatch`, `RankedQuery` binary tiers).
- `WorkflowInstanceService` and `IFormValueStore.GetManyAsync`: one read for the values of all steps.
- `AuditSearchService.FacetsAsync`: skip scan.
- SEC2-03 deferred parts: `DashboardCache` (15 s per user, period, zone, date and department right; `Dashboard:CacheSeconds`) and `ReadQueryTimeoutFilter` (15 s command timeout for the queues, search, audit
  and dashboard reads; `Queries:ReadCommandTimeoutSeconds`; the 503 `QUERY_TIMEOUT` problem). New error code in the OpenAPI contract and the generated client.
- SEC2-10: Comments tab "Showing n of total" and Load more; SEC2-12: real host (and warning mark) next to comment links; rendered bodies are memoized so a 200-comment thread does not re-parse
  on every change detection pass.

Tests added: `PerformanceRound1Tests` (cache per user/period/right, timeout on each scanning endpoint and not on others, 503 mapping, one value read per Task detail, saved values and input
checks unchanged, index definitions and plans), `FormValueStoreTests` (GetMany), `AuditSearchApiTests` (exact facets, case-insensitive text), `DashboardCacheTests`, `TextMatchTests`,
`task-comments.spec.ts` (long threads, links), `rich-text.spec.ts` (decorateLinks). Whole suites: unit 1,032, architecture 35, schema 52, integration 589, frontend 732 + 292 pass.

## 7. Browser timings (published build, Chromium 141, Dev auth, 5 runs, median)

Initial bundle: 651.7 kB raw (157 kB transferred), unchanged by this work and under the 700 kB budget; the lazy Task detail chunk grew 129.7 to 133.2 kB (the link decoration and Load more).
Script ms is the JavaScript run time (V8 compile and execution) reported by the browser.

Without CPU throttling (a normal office PC on the LAN):

| page load | TTFB | DOMContentLoaded | load | FCP | LCP | usable | script ms | JS files | JS KB (wire) | JS KB (raw) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| My Work, cold cache | 3 | 176 | 180 | 336 | 336 | 414 | 124 | 38 | 278 | 845 |
| My Work, warm cache | 2 | 161 | 164 | 336 | 336 | 398 | 140 | 38 | 0 | 845 |
| Task queue (25 rows), cold | 3 | 163 | 165 | 348 | 348 | 413 | 111 | 41 | 413 | 1249 |
| Task queue (100 rows), cold | 3 | 163 | 167 | 360 | 364 | 578 | 198 | 41 | 413 | 1249 |
| Dashboard, cold | 3 | 163 | 165 | 260 | 260 | 272 | 58 | 27 | 256 | 801 |
| Task detail #1, cold | 3 | 187 | 191 | 356 | 400 | 437 | 92 | 45 | 460 | 1377 |

| SPA navigation (nav link click until the rows are rendered) | rows | ms | script ms | layout ms |
|---|---:|---:|---:|---:|
| My Work to Task queue (25 rows) | 25 | 182 | 62 | 18 |
| Task queue 25 to 100 rows (page-size change) | 100 | 185 | - | - |

| Task detail comments tab | comments shown | ms |
|---|---:|---:|
| open the tab (first page) | 200 | 105 |
| Load more (next page) | 331 | 60 |

With the CPU 4 times slower (Lighthouse's mobile profile, about a 5-year-old laptop on battery):

| page load | TTFB | DOMContentLoaded | load | FCP | LCP | usable | script ms | JS files | JS KB (wire) | JS KB (raw) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| My Work, cold cache | 3 | 541 | 554 | 1016 | 1288 | 1331 | 587 | 38 | 278 | 845 |
| My Work, warm cache | 2 | 564 | 576 | 1068 | 1192 | 1143 | 525 | 38 | 0 | 845 |
| Task queue (25 rows), cold | 3 | 498 | 511 | 1092 | 1412 | 1268 | 563 | 41 | 413 | 1249 |
| Task queue (100 rows), cold | 3 | 559 | 574 | 1248 | 1748 | 2201 | 911 | 41 | 413 | 1249 |
| Dashboard, cold | 3 | 561 | 575 | 920 | 920 | 1000 | 285 | 27 | 256 | 801 |
| Task detail #1, cold | 3 | 500 | 511 | 1020 | 1256 | 1286 | 437 | 45 | 460 | 1377 |

| SPA navigation (nav link click until the rows are rendered) | rows | ms | script ms | layout ms |
|---|---:|---:|---:|---:|
| My Work to Task queue (25 rows) | 25 | 619 | 271 | 63 |
| Task queue 25 to 100 rows (page-size change) | 100 | 690 | - | - |

| Task detail comments tab | comments shown | ms |
|---|---:|---:|
| open the tab (first page) | 200 | 547 |
| Load more (next page) | 331 | 295 |

Reading: first content in 0.3 to 0.4 s and a usable queue in about 0.4 s on a normal PC; about 1.3 s on a slow one. The 100-row page costs about 150 ms more than the 25-row page (the default page size
stays 25). Opening a 350-comment thread renders the first 200 in about 0.1 s (0.55 s slow); Load more adds 130 in 60 ms. No regression was found; no frontend change was needed beyond SEC2-10 and SEC2-12.

## 8. Remaining risks

1. **Asset and Task substring search scales linearly.** 40 ms of CPU per Asset search at 52,000 rows means about 200 ms at 250,000 (1,000 Matters x 250, the addendum's upper bound) and 100 users typing
   are then CPU bound on a 4-core server. Options when it shows up: a persisted normalized search column with an n-gram (trigram) side table, or SQL Server Full-Text (matches word prefixes, not
   arbitrary substrings, so it changes behavior); or require 3 characters and search Assets only inside a selected Matter (a Matter has at most 300 Assets).
2. **Audit text search is a scan** of `Summary` and `FieldKey` (286 ms at 485,000 events, linear). The audit grows without bound: at about 10 million events a rare-term search nears the 15 s timeout
   and answers 503. Mitigation: make the date range mandatory for text search, or partition by month.
3. **The numeric typeahead** (Client/Matter/Task numbers) runs the same substring tiers as text (the product matches numbers inside names too), so it is the slowest scenario (p95 760 ms at 50 users here).
4. **Dashboard figures can be 15 s old** and are per process (no shared cache in a farm of several nodes); a permission change takes effect after the cache time at the latest.
5. **Not covered:** a cold buffer pool (data was in memory; 640 MB), several nodes behind a load balancer, Windows authentication cost (Dev auth was used; the identity cache hides it after the first call),
   AD lookup, real Active Directory latency, backups or index maintenance running during the day, and users on a WAN.
6. **Write amplification** of the widened Task indexes (each carries 5 to 6 more columns): a status change updates three wider index rows. Measured write latency improved, not worsened, but watch
   index fragmentation (section 9).
7. The load tool counts a request by its HTTP status only; a 200 with wrong content would not show (functional tests cover that).

## 9. Recommendations for 300 users

Sizing (single application server plus one SQL Server, normal office hours; peak about 60 to 100 requests/s):
- **SQL Server:** 8 vCPU (4 is enough for the average, 8 absorbs the scan-heavy search and audit queries without hurting the rest), 32 GB RAM with `max server memory` at 24 GB (the whole dataset is under 1 GB today;
  memory mostly keeps the working set and plan cache hot; the 5-year audit trail will be 5 to 10 GB). Data and log on separate SSD volumes; data file pre-sized to 10 GB, log 2 GB, autogrow 512 MB (not percent);
  `tempdb` with 4 equally sized files.
- **Web server (IIS):** 4 vCPU, 8 GB. One application pool, no web garden. The API used about 1.2 cores at 65 requests/s.
- **SQL settings:** keep `READ_COMMITTED_SNAPSHOT ON` (already advised), `MAXDOP 4` and cost threshold for parallelism 50 (a forced parallel plan of the Asset search used 2.4 times the CPU for the same elapsed time in the test, so small scans should stay serial), compatibility level 160,
  Query Store `READ_WRITE` with the default capture (the first place to look when a screen is slow), `AUTO_UPDATE_STATISTICS_ASYNC ON`.
- **Maintenance:** nightly statistics update with sampling on `Task`, `AuditEvent`, `Asset`, `TaskComment`; weekly index reorganize/rebuild above 30% fragmentation (the Task indexes receive many updates); keep backups
  out of office hours.
- **Connection pool:** the default `Max Pool Size=100` is enough (a request holds a connection for a few milliseconds); raise to 200 only if the pool wait counter shows queueing.
- **Configuration:** leave `Dashboard:CacheSeconds` at 15 and `Queries:ReadCommandTimeoutSeconds` at 15; set `Logging:LogLevel:Microsoft.EntityFrameworkCore` to `Warning` if SQL text appears in the log.
- **Watch:** p95 of `/api/v1/search` and `/api/v1/audit/search` (the scan-bound ones), SQL Server CPU above 60% for 15 minutes, `PAGEIOLATCH` waits (memory too small), the 503 `QUERY_TIMEOUT` count.
- **Re-run this round** (`tools/perf/reproduce.sh`) after bigger changes and before go-live on the real server with `--base` pointed at it; a 300-user rehearsal with the same mix at 100 virtual users
  is the acceptance check (p95 under 500 ms for queues and search, writes under 400 ms).
