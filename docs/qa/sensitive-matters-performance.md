# Sensitive-matter rule: performance at 20,000 tasks (epic #788, SM-18, tuned in #810)

**Status:** round 1 (below) missed the +15 percent budget; the tuning of issue #810 and its second round are at the end of this file ("Round 2"). Summary: every read path is within about 15 percent at p50 and p95, except audit search (about +40 percent, 6 ms on 15; p95 unchanged) and the computed path of the Dashboard summary (about +20 percent).

Recorded 2026-10-24 for issue #806 (runbook `docs/runbook.md` section 12.6). Tool: `tools/perf` (`docs/qa/performance-round-1.md` has the method of the first round).

## Method

- Dataset: `PERF_SCALE=0.8` of `tools/perf/seed-perf-data.sql`: 20,000 tasks, 800 matters, 2,400 projects, 42,435 assets, about 388,000 audit events, 310 users. **90 matters (11 percent) are sensitive** (10 percent of all matters plus every fourth "big" matter), 64 of them have a Primary manager (users 6 to 15) and some a Secondary, the others none; **3,368 tasks (17 percent) sit on sensitive matters**, assigned across 215 people; 64,003 audit events carry the sensitivity stamp.
- Load: `tools/perf/reproduce.sh`, 30 virtual users (the tool's persona mix: 62 percent technicians, 12 percent pod leads, 8 percent managers, 12 percent intake, 6 percent auditors), think time 400 to 1600 ms, 15 s warm-up then 90 s, the seeded database restored before each run. Four runs one after the other on the same machine in the order rule off, on, off, on (`PERF_SENSITIVE=1` starts the API with `Features__SensitiveMatterAccess=true`; the average of the two runs of a state is shown, p95 for both runs).
- Machine: 4 vCPU and 16 GB, SQL Server 2022 in a container limited to 3 GB, the load generator and the API on the same machine, so absolute numbers are only comparable with each other. Times are milliseconds per request.

## Result

| scenario | n (off/on) | p50 off | p50 on | p50 change | p95 off (2 runs) | p95 on (2 runs) | p95 change |
|---|---:|---:|---:|---:|---|---|---:|
| advanced_search | 202/182 | 24.2 | 26.5 | +9% | 176, 128 | 138, 334 | +55% |
| audit_search | 193/172 | 16.4 | 30.1 | +84% | 147, 115 | 179, 196 | +43% |
| comment_add | 197/198 | 23.8 | 29.8 | +25% | 65, 72 | 64, 121 | +36% |
| dashboard | 194/179 | 9.8 | 72.9 | +648% | 125, 108 | 183, 205 | +67% |
| my_work | 853/817 | 29.7 | 36.4 | +23% | 85, 73 | 96, 99 | +24% |
| pod_work | 273/299 | 64.5 | 98.8 | +53% | 163, 132 | 167, 188 | +21% |
| queue_default | 515/469 | 57.0 | 93.6 | +64% | 131, 110 | 173, 180 | +47% |
| queue_filtered | 374/358 | 40.0 | 64.0 | +60% | 102, 92 | 144, 149 | +51% |
| queue_sorted | 201/198 | 53.5 | 90.3 | +69% | 117, 106 | 191, 228 | +88% |
| search_number | 252/247 | 165.6 | 191.7 | +16% | 348, 302 | 625, 1123 | +169% |
| search_text | 411/409 | 122.7 | 180.8 | +47% | 256, 218 | 331, 670 | +111% |
| step_complete | 170/169 | 47.4 | 58.9 | +24% | 137, 133 | 152, 135 | +6% |
| step_start | 170/168 | 44.0 | 50.5 | +15% | 133, 120 | 134, 153 | +14% |
| step_values | 170/168 | 66.2 | 75.7 | +14% | 219, 160 | 178, 205 | +1% |
| task_create | 272/282 | 84.8 | 86.1 | +2% | 227, 166 | 235, 264 | +27% |
| task_detail | 552/543 | 30.6 | 29.6 | -3% | 95, 84 | 95, 92 | +5% |
| task_page (4 parallel) | 383/382 | 37.8 | 37.8 | +0% | 109, 82 | 102, 121 | +16% |
| task_page.activity | 383/382 | 15.2 | 16.9 | +10% | 44, 34 | 37, 47 | +8% |
| task_page.assets | 383/382 | 15.2 | 15.5 | +2% | 47, 31 | 36, 49 | +9% |
| task_page.comments | 383/382 | 13.1 | 12.6 | -4% | 34, 31 | 33, 34 | +3% |
| task_page.task | 383/382 | 37.6 | 37.2 | -1% | 109, 82 | 102, 121 | +16% |

- off1 2494 0 27.7
- off2 2505 0 27.8
- on1 2427 176 27
- on2 2431 167 27  (run, requests, errors, requests per second)

The "errors" of the runs with the rule on are the rule working: the load test picks task and matter ids at random as the administrator, so a technician asks for tasks of sensitive matters he does not see and gets 404 (task detail, task page, comment add), and a task create on such a matter gets the 400 "not found" validation. No request returned 5xx in any run.

## Reading

- **Within +15 percent at p50** (budget of README 12.5): advanced search (+9), global search by number (+16, borderline), step start (+15, borderline) and step values (+14), task create (+1), task detail (minus 3) and the four calls of the task page (minus 4 to +11).
- **Over budget at p50:** the Task Queue (default +64, filtered +60, sorted +69 percent), Pod Work (+53), My Work (+23), global search by text (+47), audit search (+84), comment add (+25), step complete (+24) and the **Dashboard summary (+648 percent, 10 to 73 ms)**: with the rule off the answer is served from the 15-second cache; with it on, the cache key carries a visibility stamp that is computed on every request, and people no longer share entries. The p95 figures (about 200 requests per scenario and state) are noisy but point the same way (the two pairs of runs agree on every scenario above except where both are high).
- **Statements behind it** (`top-queries-30.txt` of the runs, logical reads per execution): the asset readers of mode A (matter rule or "linked to a task assigned to the caller") read 1,000 to 26,000 pages against about 1,060 for the plain list (one `COUNT(*)` over assets 26,283); the set-wide task counts and lists written in the row form (`INNER JOIN Matter ... WHERE (IsSensitive = 0 OR PrimaryManagerId = @u OR SecondaryManagerId = @u OR AssignedUserId = @u)`) read about 946 pages where the LEFT JOIN form reads 153; the dashboard summary issues one scalar `COUNT(*)` with the visible-matters join per figure (1,523 reads for the batch against 806 without the rule). These are tuning candidates (the join form wherever a whole table is counted, the visible matter set computed once per request, an index-only path for the dashboard stamp), not correctness problems.
- The statement-level measurements of the SQL twin (`docs/ux/sensitive-matters/README.md` section 4, SM-03 and SM-08: 24,000 tasks, per-matter open counts +2 percent, whole-table task count 84 to 236 reads) are consistent with this; this round adds the end-to-end cost under load, which is what the +15 percent budget was written for.

## Consequence

The rule ships behind the switch (`Features:SensitiveMatterAccess`, default off), so nothing changes for anybody until go-live. The epic's definition of done ("performance within +15 percent on the heaviest reads") is **not met** at this scale on this machine: the heaviest reads (Task Queue, Dashboard summary, Pod Work, audit and text search) cost tens of milliseconds more per request. The follow-up issue #810 tracks the tuning and a re-run (`PERF_SCALE=0.8 PERF_VUS=30 PERF_DURATION=90 PERF_WARMUP=15 tools/perf/reproduce.sh`, once without and once with `PERF_SENSITIVE=1`). Until then the owner decides whether this cost is acceptable for the first deployment.


---

# Round 2: tuning (issue #810, 2026-10-24)

## Method

Same dataset (`PERF_SCALE=0.8`: 20,000 tasks, 800 matters, 90 sensitive matters carrying 3,436 tasks), same load (`tools/perf/loadtest.mjs`, 30 virtual users, 400 to 1600 ms think time, 15 s warm-up, 90 s), same machine (4 vCPU, SQL Server 2022 limited to 3 GB, load generator and API on it), the seeded database restored before each run. The runs alternate rule on and rule off; **four runs of each state** with the tuned build, one of each with the build before the tuning (measured again on the same machine on the day, the first round's figures are above). The p50 and p95 columns are the mean of the runs of a state. Absolute numbers only compare with each other. Scripts of the run: `tools/perf/reproduce.sh` does the same with one command; the day's runs used a persistent SQL container (restore, start the API, run, collect) so that runs of the two builds could alternate.

Because a mixed 30-user run has a noise of about plus or minus 10 percent at p50 (the rule-off runs differ from each other by that much, and the Dashboard summary answers from a 15-second cache, so its p50 depends on how many requests hit it), the scenarios that stayed near the line were repeated **in isolation** (`--only`, 10 virtual users, 100 to 300 ms think time, rate limits lifted so that the 429 answers do not distort the figures, two runs of each state, 600 to 3,200 requests per scenario and state, no errors).

## What the plans showed

`top-queries` and `SET STATISTICS IO/TIME` on the exact statements EF generates (logged with `Microsoft.EntityFrameworkCore.Database.Command`):

1. **The join to `Matter` itself was the cost, not its reads.** `LEFT JOIN (visible matters) ... WHERE matched OR AssignedUserId = @u` forces a hash join over the whole task set. An ordered page (`ORDER BY priority, due ... OFFSET`) can no longer walk an index and stop after 25 rows (it joins and sorts all open tasks), and each of the nine quick-view counts and fifteen dashboard figures, which are scalar subqueries over the task table, pays its own hash join: the quick-view statement read 1,525 pages and took 35 ms against 806 pages and 10 ms without the rule. Reads on a warm cache are about 100 pages more than without; the CPU of the joins is what the p50 shows.
2. **The narrow task indexes did not carry the columns the rule needs.** With the rule as a test on the task's own columns, the optimiser still intersected two indexes (`IX_Task_Pod`, `IX_Task_StatusChanged`, `IX_Task_AssignedUser`, `IX_Task_Creator` had no `MatterId` or `AssignedUserId`) or looked every row up in the clustered index.
3. **Asset readers (mode A): `OR a.AssetId IN (SELECT ... TaskAsset JOIN Task WHERE AssignedUserId = @u)`** made the plan probe the link table once per asset row: 1,000 to 50,000 pages per statement (after the task indexes were widened it was 50,000 on every call). The same text search without the OR reads 1,090.
4. **Dashboard:** the visibility stamp took four statements per request (sensitive matters, managed matters, managed again, assigned tasks). The key was already per person, so the cache did not lose entries; the cost was the four round trips on the hit path.
5. **Audit search** adds three to four small statements (task label visibility, the visible-matter check for labels, a wider correlation count) to a request of three.

What was tried on the 20,000 tasks for a person with no managed matters (milliseconds per execution of the nine-count statement / the ordered page / the total count, 40 repetitions each, indexes as before the work): rule off 9.0 / 14.5 / 1.8; the LEFT JOIN of the visible matters 22.1 / 27.5 / 4.6; a LEFT JOIN of the small set of hidden matters 19.1 / 25.2 / 3.5; `NOT EXISTS (hidden matter) OR assigned` 54.4 / 15.6 / 33.1 (fast for the ordered page, 40,000 reads for the counts); `MatterId NOT IN (list of the hidden matters) OR assigned` 27.1 / 32.9 / 13.7. Only a test on the task's own columns with the widened indexes came close to the rule-off figures: rule off 6.5 / 24.1 / 1.8, old join 16.6 / 26.0 / 5.2, flag form 8.3 / 20.7 / 2.8.

## What was changed (the rule is the same, its SQL shape is not)

- **Script 37**: `dbo.Task.IsMatterSensitive`, a denormalised copy of `Matter.IsSensitive`, kept by `TR_Matter_SensitivityToTask` (marking or un-marking a matter) and `TR_Task_MatterSensitivityInsert` (every new task, however inserted), backfilled for the existing rows; the task indexes the readers use carry `MatterId`, `AssignedUserId` and the flag; a small filtered index on the tasks a person holds on sensitive matters. The parity test (`VisibilityFunctionsTests`) still compares the SQL functions, the C# predicate and the EF translation, now also the flag form.
- **`IMatterVisibility.WhereTaskFlagVisible`**: mode T as `NOT IsMatterSensitive OR AssignedUserId = viewer OR MatterId IN (managed matters)`. Every term is on the row, so a covering index answers it, an ordered page stays an index walk and the counts cost what the counts without the rule cost plus a bit test. Used by every WorkViews reader, `TaskAccess` and the task search.
- **Per-request preparation** (`[PreparesViewer]` on the queue, My Work, Pod Work, Dashboard, My Matters and Search controllers, `ViewerPreparationFilter`): one indexed statement loads the sensitive matters the caller manages (a few ids) so that they travel as a parameter list; the Dashboard and My Matters cache key (`AccessStampAsync`) is the same statement. The list is dropped when the request saves anything; an unprepared request uses the subquery form, so no answer depends on the preparation.
- **Assets (mode A)**: the assets linked to the viewer's tasks on sensitive matters are loaded once per request (`IAssetTaskLinkReader.PrepareAsync`, at most 500 ids, otherwise the subquery) and written as `AssetId IN (list)`.
- Smaller: the audit label lookup does not query when the page names no matter.

## Statements, rule on (reads and milliseconds per execution, warm, from `top-queries`)

| statement | before, on | after, on | rule off |
|---|---|---|---|
| nine quick-view counts (Task Queue) | 1,525 reads, 35.5 ms | 519 reads, 11.5 ms | 516 reads, 9.7 ms |
| ordered page of the queue | 163 reads, 30.4 ms | 126 reads, 19.9 ms | 126 reads, 24.8 ms |
| total count of the queue | 153 reads, 7.0 ms | about 106 reads, 2.8 ms (statement bench) | 82 reads, 1.8 ms |
| asset search / count, mode A | 1,281 reads, 104 ms; 49,021 reads, 366 ms for people with tasks on sensitive matters | 1,087 reads, 57 to 66 ms | 1,090 reads, 63 ms |
| task text search | 947 reads, 24.3 ms | 938 reads, 20.2 ms | 938 reads, 22.3 ms |
| Pod Work header | 153 reads, 10.5 ms | 116 reads, 6.5 ms | 136 reads, 6.7 ms |
| Dashboard stamp (per request) | four statements | one statement, shared with the request's preparation | none |

## Result: mixed run, four runs of each state (before: one run of each)

| scenario | before: p50 off | p50 on | change | after: p50 off | p50 on | change | p95 off | p95 on | change |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| advanced_search | 20.3 | 22.4 | +10% | 22.6 | 25.9 | +15% | 140 | 152 | +9% |
| audit_search | 14.7 | 22.1 | +50% | 15.3 | 21.7 | +42% | 135 | 129 | -4% |
| comment_add | 20.8 | 22.7 | +9% | 20.4 | 22.3 | +9% | 71 | 66 | -6% |
| dashboard | 36.4 | 15.5 | -57% | 25.2 | 31.3 | +24% | 118 | 114 | -3% |
| my_work | 29.7 | 32.7 | +10% | 23.6 | 27.2 | +15% | 67 | 70 | +3% |
| pod_work | 64.4 | 89.0 | +38% | 54.6 | 57.6 | +5% | 127 | 123 | -3% |
| queue_default | 51.2 | 81.4 | +59% | 49.6 | 51.2 | +3% | 97 | 102 | +5% |
| queue_filtered | 37.9 | 64.9 | +71% | 35.1 | 40.5 | +15% | 87 | 96 | +11% |
| queue_sorted | 57.9 | 78.9 | +36% | 57.0 | 59.9 | +5% | 119 | 127 | +7% |
| search_number | 143.8 | 180.9 | +26% | 141.4 | 150.1 | +6% | 319 | 315 | -1% |
| search_text | 129.8 | 156.8 | +21% | 121.0 | 127.8 | +6% | 232 | 268 | +15% |
| step_complete | 52.4 | 58.8 | +12% | 39.5 | 45.9 | +16% | 124 | 126 | +1% |
| step_start | 44.0 | 52.3 | +19% | 39.5 | 44.3 | +12% | 130 | 111 | -14% |
| step_values | 53.4 | 69.1 | +29% | 54.4 | 59.0 | +8% | 161 | 146 | -9% |
| task_create | 85.3 | 84.9 | -0% | 72.8 | 74.8 | +3% | 197 | 172 | -13% |
| task_detail | 30.3 | 28.8 | -5% | 26.6 | 26.4 | -0% | 84 | 77 | -8% |
| task_page (4 parallel) | 36.1 | 35.5 | -2% | 33.0 | 32.6 | -1% | 88 | 80 | -9% |
| task_page.activity | 15.1 | 16.4 | +9% | 13.5 | 15.1 | +11% | 38 | 33 | -11% |
| task_page.assets | 14.4 | 15.8 | +10% | 13.5 | 13.8 | +2% | 35 | 32 | -10% |
| task_page.comments | 11.9 | 13.3 | +12% | 11.2 | 11.8 | +5% | 30 | 29 | -4% |
| task_page.task | 36.1 | 35.5 | -2% | 32.4 | 32.5 | +0% | 88 | 80 | -9% |

The dashboard rows are not comparable run to run (cache hits answer in 2 ms, computed answers take 30 to 70 ms; the share of hits varies between runs from 55 to 85 percent). The rows over 15 percent in the mixed table (`dashboard`, `audit_search`, and `step_complete`, `advanced_search`, `my_work`, `queue_filtered` at the line) were therefore repeated in isolation.

## Result: scenarios in isolation (two runs of each state)

| scenario | p50 off | p50 on | change | p95 off | p95 on | change | requests off/on |
|---|---:|---:|---:|---:|---:|---:|---|
| audit_search | 13.7 | 18.6 | +36% | 128 | 123 | -4% | 596/601 |
| my_work | 24.0 | 24.2 | +1% | 54 | 49 | -8% | 3219/3189 |
| queue_default | 48.7 | 47.6 | -2% | 81 | 79 | -1% | 2125/2182 |
| queue_filtered | 33.8 | 35.0 | +4% | 74 | 70 | -5% | 1623/1571 |
| advanced_search | 21.6 | 23.0 | +6% | 121 | 124 | +3% | 1803/1863 |
| comment_add | 18.2 | 18.7 | +3% | 43 | 47 | +9% | 1190/1260 |
| dashboard | 2.2 | 2.5 | +16% | 57 | 65 | +13% | 752/763 |
| pod_work | 50.7 | 52.1 | +3% | 94 | 103 | +10% | 1210/1314 |
| step_complete | 37.9 | 37.6 | -1% | 96 | 87 | -9% | 893/769 |
| step_start | 37.6 | 37.5 | -0% | 83 | 91 | +9% | 891/770 |
| step_values | 47.9 | 48.7 | +2% | 96 | 107 | +11% | 893/771 |
| task_create | 65.8 | 60.6 | -8% | 126 | 131 | +4% | 889/865 |


## Reading

- **Within the budget at p50 and p95**: Task Queue (default, filtered, sorted), My Work, Pod Work, global search by number and by text, advanced search, task detail and the task page, task create, the workflow step calls, comment add. In the mixed table a few rows sit at +15 or +16 percent; their isolated runs read +1 to +6 percent, so the difference is the noise of the mixed run and not the rule.
- **Audit search: about +40 percent at p50, 5 to 6 ms on 14 to 15 ms; p95 is not worse (the heavy variants dominate it).** The statements of the page itself cost what they cost without the rule (7,700 against 7,500 reads, 86 against 91 ms); the difference is round trips the rule needs for one page: the visibility check of the task labels, the visible-matter check of matter and asset labels, a wider correlation count, each 1 to 3 ms. Cutting them needs the audit display lookup to ask WorkManagement for the visibility of a task in the same statement as its title (a contract change across Audit, Api and WorkManagement), which was not done here. The auditor persona is 6 percent of the load.
- **Dashboard summary**: a cached answer costs one indexed round trip more with the rule on (the stamp, 2.2 to 2.5 ms in isolation, p95 +13 percent), a computed answer about 4 ms more for a manager with matters of their own (the same statement with the managed matters as a list) and nothing for a technician. In the mixed run this shows as +24 percent at p50 because the share of cached answers differs between runs; the first round's "10 to 73 ms" was the four stamp statements on every request.
- **Cost of the denormalisation**: script 37 writes one flag per task of a sensitive matter once; marking or un-marking a matter updates its tasks inside the same transaction (a few milliseconds per thousand tasks), which gives them a new row version. Task create is unchanged (the insert trigger writes only when the value differs, which for tasks created through the API it never does).

## Repeat

`PERF_SCALE=0.8 PERF_VUS=30 PERF_DURATION=90 PERF_WARMUP=15 tools/perf/reproduce.sh` once without and once with `PERF_SENSITIVE=1`, alternating, at least twice each. For one scenario: `node tools/perf/loadtest.mjs --only my_work --vus 10 --think 100-300 ...` against a stack started with `RateLimits__ApiPerMinute=1000000` and the other `RateLimits__*` budgets raised.
