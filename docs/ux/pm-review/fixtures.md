# Project Manager role: test data (PM-01, #668)

Two sources, both idempotent and both going through the public API (managers are set with `PUT /matters/{id}/managers`, so the audit trail is real).

## Demo data (`npm run seed:demo`)

After the Demo matters exist, `ensureManagers` (tools/seed-demo) gives managers to matters that have none yet. It never overwrites a manager that is already set.
The Project Manager test users are the ones the seeder already creates (Test User 03, 19, 35, 51; number 19 is out of office).

| Demo matter (order) | Primary | Secondary | Case |
|---|---|---|---|
| 1, 2 | first Project Manager user | none | Primary only |
| 3 | first | second | both |
| 4 | second | none | Primary only, another person |
| 5 | none | second | Secondary without a Primary |
| 6 | second | first | both, swapped |
| 7 | third (out of office) | none | an away manager |
| 8 | third | first | both |
| 9 to 12 | none | none | no manager (normal: nothing is flagged) |

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
