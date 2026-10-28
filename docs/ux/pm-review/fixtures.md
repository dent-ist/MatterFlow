# Project Manager role: test data (PM-01, #668)

Two sources, both idempotent and both going through the public API (managers are set with `PUT /matters/{id}/managers`, so the audit trail is real).

## Demo data (`npm run seed:demo`)

After the Demo matters exist, `ensureManagers` (tools/seed-demo) gives managers to matters that have none yet. It never overwrites a manager that is already set.
The Project Manager test users are the ones the seeder already creates (Test User 03, 19, 35, 51; number 19 is out of office).

| Demo matter (order) | Primary | Secondary | Case |
|---|---|---|---|
| 1, 2, 3 | first Project Manager user (Test User 03) | none | Primary only |
| 4 | second (Test User 19, out of office) | none | **Persona "three matters"**, Primary |
| 5 | none | second | **Persona "three matters"**, Secondary without a Primary |
| 6 | first | none | Primary only, sensitive matter |
| 7 | second | none | **Persona "three matters"**, Primary |
| 8 | third (Test User 35) | none | **Persona "one matter"** |
| 9 to 12 | none | none | no manager (normal: nothing is flagged) |

### Two personas for reviews and the budget test (issue #925, epic #893)

`ensurePersonas` makes these true on any Demo database, also one seeded earlier (it changes the managers of the Demo matters where they differ):

* **One matter:** Test User 35 manages exactly one matter (Demo matter 8).
* **Three matters:** Test User 19 manages exactly three (4 Primary, 5 Secondary, 7 Primary).

`ensurePersonaTasks` then gives their matters, through the API, an overdue task, an unassigned task, a task On hold and a task that becomes At risk (a task with `[persona risk]` / `[persona hold]` in the requestor name), but only for the states they lack. The API creates every task "now", so **At risk** (80 percent of the task type's target turnaround used since creation) and **On hold for more than 7 days** need one more step:

```
npm run seed:demo -- --aged
```

`--aged` (Docker needed, local API only) runs a few `UPDATE` statements inside the development SQL Server container (`matterflow-sql`; `--sql-container` / `--sql-password` or `SEED_SQL_CONTAINER` / `SEED_SQL_PASSWORD` name another): the creation date of every third open, not overdue Demo task whose type has a target is moved back to just past 80 percent of it, the hold of each held Demo task starts 3, 9, 14 or 21 days ago (the persona hold 10 days ago). Only tasks with the demo marker in the requestor name are touched, and only those that still have fresh dates, so repeating it changes nothing. It is the one place where the seeder writes to the database directly. The seeder also gives three task types a target turnaround when they have none (Production (Outgoing) 5, Incoming Production Intake 4, Analytics / TAR Setup 6 days).

What the personas see after `npm run seed:demo -- --aged --seed 7` (measured on a fresh database, 120 tasks planned): one matter, 8 open, 2 overdue, 3 at risk, 1 unassigned, 1 on hold for 10 days; three matters, 16 open, 3 overdue, 3 at risk, 5 unassigned, 5 on hold (oldest 14 days). The exact numbers change with `--seed`; the four states are always there. Without `--aged` the overdue and unassigned tasks and a hold exist, but no task is At risk and no hold is older than a minute.

## End-to-end fixtures (`frontend/e2e/support/pm-fixtures.ts`)

`pmFixtures(seed, personas)` builds, once per worker, with a per-worker token in every name:

| User | Role | Manages |
|---|---|---|
| `pmA` (PM Alpha) | Project Manager | seven matters: Primary of `primary`, `both`, `overdue`, `unassigned`, `hold`, `clean`; Secondary of `secondary` |
| `pmB` (PM Bravo) | Project Manager | `solo` (Primary), `secondary` (Primary), `both` (Secondary), `secondaryOnly` (Secondary, no Primary) |
| `pmNone` | Project Manager | nothing |
| `pmNoTask` | Matter.View, Matter.BeManager, Matter.AssignManagers, no Task.View | nothing |
| `director` | Director (holds `Matter.AssignManagers`, cannot be named) | nothing |
| `observer` | Read-Only Observer | nothing |
| `editor` | Matter.Edit without `Matter.AssignManagers` | nothing |
| `away` | Data Technician, out of office | nothing |

Matters `none1` (two tasks), `none2` and `none3` have no manager (the bulk test sets the first two, so other tests use `none3`). Tasks: one overdue (`overdue`), two unassigned (`unassigned`), one on hold for ten days (`hold`, needs the SQL container of `frontend/e2e/run-local.sh`), one far in the future (`primary`).

The large set (200 matters, 20,000 open tasks) is not built here: it belongs to the performance issue #686, which has to tune the queries against it.

## Scope fixtures (epic #758, WP-PX3 and WP-PX5)

`pmFixtures` also builds what the "My matters / All" specs (`px3-*`) and the matter specs (`px5-matter`) need, with the token in every name:

| What | Detail |
|---|---|
| `pmNoAssign` | Matter.BeManager without `Matter.AssignManagers` (and Task.View, Asset.View, Project.View); Primary of `m.noAssign`; sees no switch and is held on My matters |
| `technician` | Data Technician: no manager permission, no switch |
| `otherClient` | a second client whose only matter, `m.otherClient`, has no manager: the Clients list in "My matters" does not show it |
| `assetMine`, `assetOther` | one asset on `m.primary` (managed by `pmA`) and one on `m.solo` (managed by `pmB`) |
| `projectMine`, `projectOther` | one project on each of the same two matters |

The Matters list therefore holds 14 matters per token (the twelve above, `m.noAssign` and `m.otherClient`). The specs that need weeks of data (`px4-tabs`) and the matter overview (`px5-matter`) use `mmWorld` (`frontend/e2e/support/my-matters-fixtures.ts`), which builds one Project Manager, one client and the matters and tasks each test writes down. The playwright stack of `e2e/run-local.sh` starts a fresh database: a database that has been used for many runs can have more than 50 people who may be named project manager, and the manager pickers of `pm-matters` then no longer list the fixture people.
