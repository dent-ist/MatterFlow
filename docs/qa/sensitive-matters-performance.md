# Sensitive-matter rule: performance at 20,000 tasks (epic #788, SM-18)

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

The rule ships behind the switch (`Features:SensitiveMatterAccess`, default off), so nothing changes for anybody until go-live. The epic's definition of done ("performance within +15 percent on the heaviest reads") is **not met** at this scale on this machine: the heaviest reads (Task Queue, Dashboard summary, Pod Work, audit and text search) cost tens of milliseconds more per request. A follow-up issue tracks the tuning and a re-run (`PERF_SCALE=0.8 PERF_VUS=30 PERF_DURATION=90 PERF_WARMUP=15 tools/perf/reproduce.sh`, once without and once with `PERF_SENSITIVE=1`). Until then the owner decides whether this cost is acceptable for the first deployment.
