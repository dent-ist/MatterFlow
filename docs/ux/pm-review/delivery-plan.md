# Project Manager role and My Matters: delivery plan

Date: 2026-10-22, base `origin/dev`. Source: `README.md` in this folder (specification, 11 open questions). Structure on GitHub: one epic **#667** (labels `epic` + `phase-18`), 28 sub-issues #668 to #706 (label `phase-18`; numbers are in creation order and are not contiguous, other epics were created in parallel). Status 2026-10-23: built and on `dev` (WP-PM1 to WP-PM5); final verification #706 is still to run. The Q1 to Q11 answers actually taken are in addendum AG items 13 to 22 (Q2 differs from the recommendation below: Director and Project Manager both get `Matter.AssignManagers`).

**Binding owner decisions.** (1) Optional Primary and optional Secondary project manager per matter, identical rights, a matter without a manager is normal (no warning, no red flag, no needs-attention item), changes audited, shown in the matter header strip and as filterable "Project manager" columns on the Matters list. (2) A PM sees their own matters by default; with a permission (proposed `Matter.AssignManagers`) they search all matters and change assignment. (3) The Project Manager role lands on **My Matters** (My Work stays in the menu); the landing rule of #628 is extended. (4) No status report, Gantt, time or budget tracking, per-matter dashboards (small health strip only), email. (5) **No new or changed keyboard shortcuts** (Phase 2, #420). Notifications are specified in a separate epic (phase-17); PM events are registered there, this plan adds none of its own.

**Finding that shapes the plan.** A starter role named "Project Manager" already exists (`StarterRoles.cs`). The plan extends it (a marker permission `Matter.BeManager` plus a grant script for existing databases) instead of creating a role. Roles are seeded once and editable, so the grant script is required.

Effort is in **AI-agent hours** (wall-clock of one developer agent, including unit, integration, e2e, axe and screenshots). Total **98.5 hours** in 28 issues.

## 1. Issue list

| # | ID | Title (short) | Agent-h | Depends on | Package | Lane |
|---|---|---|---|---|---|---|
| #668 | PM-01 | Test data for the PM role: PM users, matters with Primary/Secondary/no manager, mixed health, away technicians | 2 | None | WP-PM1 | B |
| #669 | PM-02 | SQL script: Matter.PrimaryManagerId and SecondaryManagerId, constraints, filtered indexes | 2.5 | None | WP-PM1 | B |
| #670 | PM-03 | Permissions Matter.BeManager and Matter.AssignManagers, starter-role grants and a grant script for existing databases | 2.5 | None | WP-PM1 | B |
| #672 | PM-04 | Matter API: Primary / Secondary manager on the Matter DTOs, PUT /matters/{id}/managers, eligibility rules, audit | 4 | #669, #670 | WP-PM1 | B |
| #674 | PM-05 | Eligible managers lookup: GET /users/matter-managers | 1.5 | #670 | WP-PM1 | B |
| #675 | PM-06 | Matters list API: filters and sort by Primary / Secondary / any manager, 'managed by me', 'no manager' | 2.5 | #672 | WP-PM1 | B |
| #676 | PM-07 | Task Queue filter: tasks on matters managed by a person (managedByMe / managerId + role, dueWithin, oldest hold first) | 3 | #669 | WP-PM1 | B |
| #678 | PM-08 | My Matters summary: strip counts (matters I manage, open, overdue, due in 3 / 7 days, unassigned, on hold + oldest hold age) | 3.5 | #676 | WP-PM2 | C |
| #679 | PM-09 | My Matters health: one row per matter (counts, % workflow complete, next deadline, RAG), sort and paging | 5 | #676 | WP-PM2 | C |
| #681 | PM-10 | My Matters attention list and upcoming deadlines | 4 | #676 | WP-PM2 | C |
| #682 | PM-11 | My Matters workload and capacity: open tasks per pod and person on my matters, out-of-office | 3 | #676 | WP-PM2 | C |
| #683 | PM-12 | My Matters recent activity and the unread marker | 4.5 | #669 | WP-PM2 | C |
| #685 | PM-13 | Bulk re-assign and re-prioritise inside one matter: POST /matters/{id}/tasks/bulk | 5 | #672 | WP-PM2 | B |
| #686 | PM-14 | Performance: My Matters query budget at 200 matters / 20,000 open tasks, plans and indexes | 3 | #678, #679, #681, #682, #683 | WP-PM2 | C |
| #688 | PM-15 | Matters list: Primary and Secondary 'Project manager' columns with inline filters, Mine quick filter, bulk Set project managers | 4.5 | #675, #674 | WP-PM3 | B |
| #689 | PM-16 | Matter header strip shows Primary / Secondary manager, change dialog, small health strip | 4.5 | #672, #674, #678 | WP-PM3 | B |
| #691 | PM-17 | Landing rule: Project Managers land on My Matters; route, menu item, guard (extends #628) | 3 | #670 | WP-PM4 | A |
| #692 | PM-18 | My Matters page shell: header, filters (client, primary/secondary/both, date range), URL state, count strip | 5 | #691, #678 | WP-PM4 | A |
| #693 | PM-19 | Panels: Needs my attention and Upcoming deadlines | 4 | #692, #681 | WP-PM4 | A |
| #695 | PM-20 | Matter health table with RAG flag, row click and '+ New task' (also on phone) | 5.5 | #692, #679 | WP-PM4 | A |
| #696 | PM-21 | Panel: Workload and capacity (pod / person, out-of-office flags) | 3 | #692, #682 | WP-PM4 | C |
| #697 | PM-22 | Panel: Recent activity with unread marker and Mark all as read | 3 | #692, #683 | WP-PM4 | C |
| #699 | PM-23 | Bulk re-assign and re-prioritise in the matter's task grid (selection mode, dialog, result list) | 4.5 | #685, #689 | WP-PM4 | B |
| #700 | PM-24 | Phone and tablet layout of My Matters | 3.5 | #693, #695, #696, #697 | WP-PM4 | A |
| #701 | PM-25 | Scope 'All matters' and manager assignment for holders of Matter.AssignManagers | 3 | #692, #688 | WP-PM4 | A |
| #703 | PM-26 | Keyboard, axe and permission matrix for My Matters and the manager fields | 3 | #688, #689, #693, #695, #696, #697, #699, #701 | WP-PM5 | A |
| #704 | PM-27 | Docs: ux-spec section for My Matters, UAT rows, decisions-addendum AG status, e2e catalogue, architecture notes | 2.5 | #703 | WP-PM5 | A |
| #706 | PM-28 | Final verification pass for the Project Manager role and My Matters | 3.5 | #704 | WP-PM5 | A |

Total: **98.5 agent-hours**.

## 2. Work packages

| Package | Issues | Agent-h |
|---|---|---|
| WP-PM1 Foundations: data, permissions, matter API | #668, #669, #670, #672, #674, #675, #676 | 18 |
| WP-PM2 My Matters API | #678, #679, #681, #682, #683, #685, #686 | 28 |
| WP-PM3 Matter UI: list columns and header | #688, #689 | 9 |
| WP-PM4 My Matters page | #691, #692, #693, #695, #696, #697, #699, #700, #701 | 34.5 |
| WP-PM5 Access, docs, verification | #703, #704, #706 | 9 |

Definition of done (every issue and the epic): acceptance criteria met; unit + integration + e2e tests green (twice) including permission variants (Project Manager, PM without `Task.View`, holder of `Matter.AssignManagers`, Director, Observer); axe 0 violations at 1366x768, 1920x1080, 768x1024, 375x812 with new menus and dialogs open; no page-level horizontal scroll; existing keyboard keys only; `dotnet build -warnaserror`, `dotnet format`, lint and Prettier clean; OpenAPI and nswag client regenerated, never hand-merged; module boundaries kept (`MatterFlow.ArchitectureTests`); screenshots in `docs/ux/pm-review/fixes/<package>/`; budgets kept.

## 3. SQL scripts

Needed: **yes**. Script A (PM-02): Matter manager columns, check constraint, two filtered indexes. Script B (PM-03): idempotent data grant of the two new permissions to the existing Director / Project Manager roles. Script C (PM-12): `UserMatterActivitySeen` (or none if the Notifications epic's read state is used). Script D (PM-14): an index only if measurement requires it. Every script takes **the next free number at implementation time** (check `db/scripts` first; other epics write scripts in parallel); scripts A to C may be combined into one or two files; merged scripts are immutable, fix forward with a new number. No EF migrations.

## 4. Order, lanes and waves

Lanes are file owners: one agent owns one lane's files for the whole epic.

- **Lane A (page owner, 33 h)**: #691, #692, #693, #695, #700, #701, #703, #704, #706. Owns `features/my-matters/*`, landing rule, nav, docs and the final pass.
- **Lane B (matter and foundations, 36.5 h)**: #668, #669, #670, #672, #674, #675, #676, #685, #688, #689, #699. Owns the SQL, permissions, Matter API, Matters list, matter page, bulk API and its UI.
- **Lane C (dashboard API and panels, 29 h)**: #678, #679, #681, #682, #683, #686, #696, #697. Owns `WorkViews/Application/Queries/MyMatters*`, the workload and activity panels and the performance issue.

Waves:
1. **Wave 1**: Lane B: #668, #669, #670, #672, #674, #675, #676 (18 h; the first four unblock everybody). Lane A: #691 once #670 lands. Lane C starts #678 once #676 lands.
2. **Wave 2**: Lane C: #678, #679, #681, #682, #683. Lane A: #692, #693, #695. Lane B: #688, #689, #685.
3. **Wave 3**: Lane C: #696, #697, #686. Lane A: #700, #701. Lane B: #699.
4. **Wave 4**: Lane A: #703, #704, #706.

Wall-clock with three agents about **42.5 hours** (longest lane plus waiting); one agent alone needs 98.5. The OpenAPI file and client are regenerated by many issues: rebase and regenerate after every merge, never hand-merge.

### First release (about 24 hours): managers on matters

#668, #669, #670, #672, #674, #675, #688, #689: the two manager fields, permissions, audit, Matters list columns and filters, the matter header strip and the small health strip. Useful on its own (the owner can start assigning managers before My Matters exists) and carries no dashboard risk.

### Second release: My Matters

Landing rule, API, page, panels, bulk actions, phone, All matters scope, verification.

### Critical path

#669 (2.5) then #672 (4) then #676 (3) then #679 (5) then #695 (5.5) then #700 (3.5) then #703 (3) then #704 (2.5) then #706 (3.5) = about 32 hours of strictly serial work; the lanes above fit around it.

### Hot spots (merge-conflict watch)

- `contracts/openapi/v1.json` and the TS client: touched by almost every backend issue (above).
- `Task Queue` query and page (#676): shared with My Work, Pod Work and the Dashboard strip; additive filters only, their specs are the regression tests.
- Matters list and matter page (#688, #689, #699): lane B only; the Clients/Matters epic code is shared grid configuration, additive column definitions.
- `core/auth/guards.ts`, `nav-items.ts` (#691): also edited by other epics; keep the diff to one rule and one item.
- `StarterRoles.cs` / `permissions.json` / `permissions.ts` (#670): the Notifications epic may add permissions too; rebase and keep the catalogue tests green.

## 5. Risks

| Risk | Mitigation |
|---|---|
| "% workflow complete" and the activity query are the expensive ones | #686 measures at 200 matters / 20,000 tasks; budget p95 300 ms warm; paging; caching 30 s |
| Strip numbers differ from the lists they open | Every cell has an integration test against the Task Queue total (#678); one set of predicates (`TaskQueueRules`) |
| Users read "my matters" as access control | UI copy and docs say it is a default view (no row-level matter security exists) |
| Notifications epic changes read state or permissions | Dependencies recorded in #683 and #670; swap points are small |
| Existing databases miss the new grants | Grant script with an integration test for fresh vs upgraded databases (#670) |

## 6. Open owner questions

Q1 to Q11 of `README.md` section 12. None blocks wave 1 (each has a recommended answer that the issues assume): Q1 extend the existing role; Q2 `Matter.AssignManagers` (taken: Director and Project Manager); Q3 lost-role managers stay; Q4 Secondary without Primary allowed; Q5 marker permission name; Q6 own unread table; Q7 Task Queue filter; Q8 7-day hold threshold; Q9 workflow percentage definition; Q10 RAG rule; Q11 audit index by measurement.
