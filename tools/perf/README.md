# Performance tooling (ticket 64)

Everything needed to load a realistic MatterFlow dataset into a throwaway SQL Server and to measure the published API and the built web app
against it. Results of the first round: `docs/qa/performance-round-1.md`.

| File | What it does |
|---|---|
| `seed-perf-data.sql` | Loads about 300 users with roles, 40 Pods, 200 Clients, 1,000 Matters, 3,000 Projects, 52k Assets (250 each in 50 Matters), 25,000 Tasks with real workflow and step instances (about 115k) and form values, 60,000 comments, 100,000 Task-Asset links and about 485,000 audit events. Set-based T-SQL, under a minute, about 640 MB of data and indexes. |
| `loadtest.mjs` | N concurrent virtual users (Dev auth, persona mix, think time) for D seconds; per scenario count, errors, requests per second, p50/p95/p99/max. Node 22, no packages. |
| `top-queries.sql` | The costliest statements (plan cache) and missing-index suggestions after a run. |
| `frontend-timings.mjs` | Chromium timings of the published web app (cold/warm load, queue with 25 and 100 rows, long comment thread); needs `npm ci` in `frontend/`. |
| `seed-asset-report-data.sql`, `asset-report-timings.mjs` | The asset report engine at 100,000 assets (epic #851, issue #873): creates an asset type with a number and a select field, loads 100,000 assets and 200,000 typed index rows in 100 matters of one manager, and times `POST /asset-reports/run` for eight report shapes (p50, p95, max; `--plans` prints the plan-cache view). Needs a running stack, for example `E2E_KEEP_STACK=1 frontend/e2e/run-local.sh --list -g none`, then `node tools/perf/asset-report-timings.mjs --base http://127.0.0.1:5190 --container <sql container>`. Results: `docs/ux/pm-review/performance.md`, "Asset reports". |
| `reproduce.sh` | Does all of the above (`PERF_SENSITIVE=1` starts the API with the sensitive-matter rule on) on a throwaway stack: SQL container on a random loopback port, publish, seed, run, collect, clean up. |

## One command

```
tools/perf/reproduce.sh                                        # Scale 1, 50 and 100 users, 60 s each, results in artifacts/perf-results/
PERF_SCALE=0.1 PERF_VUS="20" PERF_DURATION=20 tools/perf/reproduce.sh     # quick smoke run
PERF_THINK=0-0 PERF_NO_LIMITS=1 PERF_VUS=50 tools/perf/reproduce.sh       # saturation test: no think time, rate limits off
```

Needs Docker (SQL Server 2022 image), the .NET 10 SDK, Node 22 and about 6 GB of free disk for Scale 1 (the script checks). The container and the API
process are removed again unless `PERF_KEEP=1`. The full list of variables is at the top of `reproduce.sh`.

## By hand

1. Start SQL Server and create an empty database `MatterFlow` (`RECOVERY SIMPLE`, `READ_COMMITTED_SNAPSHOT ON`, files pre-sized to avoid growth pauses).
2. Start the API once against it with `Seed__StarterConfiguration__Enabled=true` and a `Dev:Users` entry for `perf.admin` with the System Admin role. That
   applies the schema scripts and creates the starter roles, task types, workflows and forms the seeder builds on. Stop it again.
3. `sqlcmd -I -b -d MatterFlow -v Scale=1 -i seed-perf-data.sql` (`-I` is required: the schema has filtered indexes). The script refuses a database
   that already holds Tasks or Clients, and a second run (`dbo.SeedMarker`). Take a backup now and restore it before every run, so that runs start
   from the same data.
4. Start the API again (`Release` build, `ASPNETCORE_ENVIRONMENT=Development` for Dev auth) and run
   `node loadtest.mjs --base http://127.0.0.1:PORT --vus 50 --duration 60 --warmup 10 --out result.json`.
5. `sqlcmd -I -d MatterFlow -W -w 400 -i top-queries.sql` before the plan cache is cleared.

## The dataset

`Scale` multiplies Clients, Tasks, comments, links and spread Assets (users and Pods stay 300 and 40). Users are `perf.user001` to `perf.user300`
(Dev provider, so `X-Dev-User: perf.user040` signs in): 1-5 Director, 6-15 Project Manager, 16-30 Pod Lead, 31-185 Data Technician, 186-245 Data Scientist,
246-270 Intake Coordinator, 271-290 Read-Only Observer, 291-295 Configuration Admin, 296-300 Compliance Auditor. Users 6-270 have a primary Pod.

- Tasks: 25% New, 25% In Progress, 5% On Hold, 40% Completed, 5% Cancelled; four priorities (8/22/55/15%); 25% ASAP, the rest due within -15 to +35 days
  (15% of those with a time); open Tasks created in the last 60 days, closed ones up to 180 days ago; 40% of the Tasks sit in the 50 "big" Matters; 60% have a
  Project; about 60% belong to a Pod, in progress Tasks have an assignee (a technician or scientist in that person's Pod); the 15 starter Task Types and 8
  starter workflows (2 to 7 steps, 4.6 on average), step status consistent with the Task status, request and step form values from the published forms.
- Sensitive matters (epic #788): 10 percent of the Matters are sensitive (`SensitivePercent` in the `#cfg` table at the top of the seed), plus every fourth "big" Matter, so about 11 percent of the Matters and 17 percent of the Tasks (at Scale 0.8: 90 Matters, 3,368 Tasks). 80 percent of those have a Primary
  project manager among users 6 to 15 (every other one also a Secondary), 20 percent have no manager, so only the Directors (users 1 to 5, who hold `Matter.ViewSensitive`)
  and the people assigned a task on them see them. Tasks are assigned across the technicians and scientists whatever the Matter, so most sensitive Matters have several people
  who see only their own task. Their audit events are stamped (`IsSensitiveScope`). The seed prints the counts (`SensitiveMatters`, `SensitiveMattersWithManager`,
  `TasksOnSensitiveMatters`, `AssigneesOnSensitiveMatters`, `SensitiveAuditEvents`).
- Comments are skewed on purpose: Task 1 gets about 350, Task 2 about 160, so the long-thread paths (`skip`/`take`, Load more) are exercised.
- Task-Asset links point to Assets of the Task's own Matter (the table enforces it).
- Audit events follow the real event shapes (`TASK_CREATED`, `TASK_STATUS_CHANGED`, `STEP_STARTED`/`STEP_COMPLETED`, `COMMENT_ADDED`, `TASK_ASSET_LINKED`,
  `FIELD_CHANGED` and the created events of Clients, Matters, Projects and users), spread over the 180 days.
- Not seeded: custom field index rows (`CustomFieldIndex`), Asset form values, comment revisions, email intake.

Content is random (`NEWID()`), so two runs differ in text and assignment but not in volume or distribution.

## Measuring the sensitive-matter rule

The rule is behind the go-live switch `Features:SensitiveMatterAccess` (default off). The dataset above always holds the sensitive Matters, so one seeded database serves both
runs. Run the same load with and without the rule and compare p50 and p95 of the heavy reads (Task Queue, Dashboard, My Work, search, audit search). The budget of the design
(README 12.5 of `docs/ux/sensitive-matters`) is not worse than +15 percent; the first measurement, at 20,000 Tasks, is in `docs/qa/sensitive-matters-performance.md` (round 1 missed it; the tuning of issue #810 and the second round are recorded there):

```
PERF_SCALE=1 PERF_VUS="50" tools/perf/reproduce.sh                      # rule off (today's behaviour)
PERF_SCALE=1 PERF_VUS="50" PERF_SENSITIVE=1 tools/perf/reproduce.sh     # rule on
```

The personas fit the rule: managers (users 1 to 15) are the Directors, who see everything, and the Project Managers, who see what they manage; technicians and scientists
see non-sensitive Matters plus their own tasks on sensitive ones.

## The load test

Each virtual user is one persona user and loops: pick a scenario by the persona's weights, run it, think 400-1600 ms (`--think min-max`), repeat. The persona mix is
62% technicians, 12% pod leads, 8% managers, 12% intake coordinators and 6% auditors (`PERSONAS` and `MIX` at the top of `loadtest.mjs`). Scenarios: queue default
(25 rows), filtered (priority, Pod, overdue, Matter, type, due range, text, assignee, Client, requestor), sorted (every sort field, pages 1-5, 25/50/100 rows); My Work and
Pod Work with their views; dashboard; global search typeahead with text and with numbers (Client number, Matter reference, `TSK-n`, bare digits, `client-matter`);
advanced search (task, matter, asset, project); Task detail alone and as the Task page's four parallel calls (Task, comments, activity, assets); audit search (every filter); Task
create; the workflow cycle (create, start the first step, save its values, complete it) and comment add. Every request carries `X-MatterFlow-Client: web`
and `X-Time-Zone: America/New_York`. A request counts as an error for any status outside 200-399, including 429.

The numbers depend on the machine; compare runs from the same machine and the same restored database. The load generator shares the CPU with the API and SQL Server
unless you point `--base` at another host.
