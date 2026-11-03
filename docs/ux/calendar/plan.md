# Dashboard Calendar (resource planning): plan (epic #1074)

Branch `dev`. Progress: `progress.md` in this folder. Decision: `docs/requirements/decisions-addendum.md` section AT. Mockup, README (15 open questions, ranked features) and feasibility: `docs/ux/mockups/dashboard-calendar/` on branch `calendar-mockup` (read with `git show origin/calendar-mockup:docs/ux/mockups/dashboard-calendar/index.html`). The mockup `index.html` is the reference implementation of the coverage maths and of the holiday-rule expansion (Easter, nth weekday, observed days, ranges): port it and test against it. Related: #997 (TH-15). Builds on Dashboard v4 (#1063, decision AS: worker definition, battery formula, capacity states).

## 1. Goal

A Director or Pod Lead opens Dashboard > Calendar and sees, month by month or week by week, who can work on each day and where coverage is thin. People keep several Out of office entries on their Profile; an administrator keeps holiday calendars; the same availability rules feed capacity, workload, My Matters, the matter overview and the users list. Release 1 is a resource planner: no task is drawn on the calendar.

## 2. Issues and hours (agent-hours)

| Issue | Code | Title | Hours | Agent |
| --- | --- | --- | --- | --- |
| #1075 | CAL-01 | Backend: data model and migration (scripts 58 to 60) | 6.0 | G2 |
| #1076 | CAL-02 | Backend: evaluator rewrite (periods, holidays, five consumers, battery Holiday) | 7.0 | G2 |
| #1077 | CAL-03 | Backend: calendar endpoints (days, day panel, summary) | 7.0 | G2 |
| #1078 | CAL-04 | Backend: absences and holidays admin APIs, thresholds | 7.5 | G2 |
| #1079 | CAL-05 | Frontend: Profile > Out of office | 5.0 | H2 |
| #1080 | CAL-06 | Frontend: Admin > Holidays and thresholds settings | 7.0 | H2 |
| #1081 | CAL-07 | Frontend: Calendar tab (Month, Week, filters, banner, forecast, phone) | 8.0 | H2 |
| #1082 | CAL-08 | Frontend: right panel (counts, pods, people by role by workload) | 5.0 | H2 |
| #1083 | CAL-09 | Cross-cutting: contracts, catalog, seed, e2e, axe, guide | 6.0 | G2 3.0, H2 3.0 |
| #1084 | CAL-10 | Final QA (only when the owner says) | 6.0 | any |
| #1074 | CAL-00 | Epic, issues, plan, decision AT | 2.0 | PM |
| | | **Total** | **66.5** | |

Agent G2 30.5 h (CAL-01 to CAL-04, 3.0 of CAL-09), Agent H2 28.0 h (CAL-05 to CAL-08, 3.0 of CAL-09), QA 6.0 h, PM 2.0 h. The mockup estimated about 76 h for its larger release 1. Dropped by the owner: Timeline (about 5 h of the 7 for Week and Timeline), export (1.5), Tasks at risk and Reassign (6.0), "Who is out this week" strip; added: the by-role lists sorted by workload (about 1.5) and the Holiday battery state.

## 3. Rules that shape the build

- **Worker** = active user who holds `Workflow.Execute` and is an active member of a pod (decision AS). The Director and Project Managers are not counted.
- **Day state of a person** (one pure function, `EvaluateDay`): HOLIDAY (the person's calendar plus every "applies to everyone" calendar) wins over OUT_OF_OFFICE; else OUT_OF_OFFICE if any absence covers the date (a floating date in the person's time zone, end date included); else NON_WORKING (a part-timer's day without hours, or a weekend); else AVAILABLE.
- **Expected** = people in view minus those on holiday or non-working that day. **Available** = expected minus out of office. **Coverage %** = available / expected (no division by zero: expected 0 gives level CLOSED). The cell prints "available of expected" (decision AT 8): on Thanksgiving a US firm with 6 UK colleagues shows "6 of 6 expected", not 6/36; the total in view and the number on holiday are in the tooltip and the day panel.
- **Level of a day** (server side, one function; thresholds from settings, defaults T = 75 % firm minimum, P = 60 % pod minimum): CRITICAL if coverage < P, or a pod with expected > 0 has nobody available; LOW if coverage < T; WATCH if coverage >= T but at least one pod is below its minimum; GOOD otherwise; CLOSED if expected is 0 (firm closure); NON_WORKING for a weekend or a day nobody works. Pod minimum = the per-pod people minimum if set, else ceil(P % x the pod's expected people that day), never more than the pod's expected. A holiday never creates a risk day by itself.
- **Person in two pods:** counted once in All pods (their primary pod for the pod minimum, the pod with the lowest id unless a primary flag exists; G2 confirms in code); counted in each pod when that pod is filtered.
- **Right panel lists** (decision AT 16 and 17): AVAILABLE and UNAVAILABLE, each grouped by Role. The role of a person for grouping is their **primary tech-ops role**: among their active roles that hold `Workflow.Execute`, the first in the order the Admin > Roles list shows (name A to Z, case-insensitive; the roles table has no sort column, so alphabetical is the app order; flagged for the owner). A person appears once. People with no such role are not workers and are not listed. Role groups are in that same order. Within a group: Available, lightest load first (who can take work); Unavailable, heaviest load first (whose work needs cover); ties by name A to Z. Workload = open assigned tasks (New + In progress; On hold excluded), the `load` of the battery People list, as a bare integer (hidden-matter tasks count by number, decision AS item 12).
- **Unavailable reason shown:** Out of office, Holiday (names in the panel header), or Not working; the absence type (Vacation, Sick, Training, Conference, Other) only with `Dashboard.ViewAbsenceReasons`; the note never appears in the Calendar (only the owner and managers who may edit see it, in the absence screens).
- **Forecast, 4 weeks:** per week, free % = (3 x average available people over the week's working days - open tasks of the scope's workers) / (3 x average available), clamped 0 to 100, null when nobody is available; open tasks are counted for everyone in scope, also absent people (they still need an owner). Numbers only.
- **Battery on a firm closure:** new capacity `state` value `HOLIDAY` (everyone off hours is off for a holiday); the six people states stay; holiday people are counted in Off hours.
- **Permissions (three new):** `Dashboard.ViewCalendar` (Director, Pod Lead; Pod Lead only for pods they lead, same `podScope` rules as `GET /dashboard/capacity`), `Dashboard.ViewAbsenceReasons` (Director, Pod Lead), `User.ManageAvailability` (Director all, Pod Lead members of pods they lead). Holidays, calendar assignment of pods and thresholds need existing `Settings.Manage`; the person's calendar field needs `User.Manage`; own entries need `Task.View`.
- **Privacy:** type and note are left out of the server response (property absent) without the reasons permission; every absence write is audited; `UserAbsence` is denied to the report login in `db/report-access.json`, holiday tables allowed.
- **Sensitive matters:** this release shows people and availability only; the only task-derived numbers are the per-person load integer and the forecast, both aggregate numbers (extension of AS item 12; the security reviewer confirms).
- **UI rules:** tokens only; shared `mf-tabs` with icon, `mf-form-dialog`, `mf-confirm-dialog`, list standard; panels are read-only; fixed-page layout; no new or changed keyboard shortcuts (#420); initial bundle under 700 kB (lazy tab); axe at 1366x768, 1920x1080, 768x1024, 375x812; Sunday first.

## 4. API contract sketch (so G2 and H2 can work in parallel)

JSON camelCase, enums upper snake strings, dates `yyyy-MM-dd` (floating days), instants UTC ISO. Shapes are a sketch: G2 may add fields; renames and removals are announced in `progress.md` first. `podScope` is the existing capacity parameter (`all`, `mine`, pod id). Errors: 400 invalid input, 403 without permission or pod outside the Pod Lead's pods, 409 overlap or version conflict.

```
GET /api/v1/dashboard/calendar/days?from&to&podScope&role          (Dashboard.ViewCalendar; to-from <= 62 days)
  -> { asOfUtc, today: date, firstDayOfWeek: 0,
       roles: [ { roleId, name } ],
       days: [ { date, total, expected, available, outOfOffice, onHoliday, offHours,
                 coveragePercent: int|null, level: "GOOD"|"WATCH"|"LOW"|"CRITICAL"|"CLOSED"|"NON_WORKING",
                 holidays: [ { name, calendarId, category, colourKey, appliesToEveryone } ],
                 pods: [ { podId, name, expected, available, minimum, level } ] } ] }

GET /api/v1/dashboard/calendar/day?date&podScope&role&q            (Dashboard.ViewCalendar)
  -> { date, level, holidays: [ { name, category, colourKey } ],
       counts: { total, expected, available, outOfOffice, onHoliday, offHours },
       pods: [ { podId, name, expected, available, minimum, level } ],
       available:   [ { roleId, roleName, people: [ { userId, displayName, podNames: string[], load: int } ] } ],   // load ascending
       unavailable: [ { roleId, roleName, people: [ { userId, displayName, podNames: string[], load: int,
                        reason: "OUT_OF_OFFICE"|"HOLIDAY"|"NOT_WORKING",
                        backOn: date|null,                       // first working day after the entry; null when open-ended
                        absenceType?: "VACATION"|"SICK"|"TRAINING"|"CONFERENCE"|"OTHER" } ] } ] }   // load descending; absenceType ABSENT without Dashboard.ViewAbsenceReasons

GET /api/v1/dashboard/calendar/summary?podScope&role               (Dashboard.ViewCalendar)
  -> { thresholds: { minCoveragePercent: 75, podMinimumPercent: 60 },
       risk: { daysAtRisk: int, firstRiskDate: date|null, firstRiskLevel, worstPod: { podId, name }|null, windowDays: 30 },
       forecast: [ { weekStart: date, availablePeople: number, freePercent: int|null } ] }   // 4 weeks

GET    /api/v1/users/{userId}/absences?includePast                 (own: Task.View; others: User.ManageAvailability in scope)
  -> [ { absenceId, userId, type, startDate, endDate: date|null, note, state: "NOW"|"UPCOMING"|"PAST", workingDays: int, rowVersion } ]
POST   /api/v1/users/{userId}/absences      body { type, startDate, endDate, note }   -> 201 the entry; 409 { overlapsWith: { absenceId, type, startDate, endDate } }
PUT    /api/v1/users/{userId}/absences/{absenceId}   body { ..., rowVersion }
DELETE /api/v1/users/{userId}/absences/{absenceId}?rowVersion=
POST   /api/v1/users/{userId}/absences/{absenceId}/back            ("I'm back": ends the current entry yesterday)
POST   /api/v1/users/{userId}/absences/check   body { startDate, endDate }
  -> { podsBelowMinimum: [ { podId, name, days: date[] } ] }       // advisory, never blocks
GET    /api/v1/users/{userId}/availability   (existing) status derived from the absences; fields status/outOfOfficeFrom/outOfOfficeUntil/note replaced by
                                              absences[], holidayCalendar: { calendarId, name }|null, nextHolidays: [ { date, name } ]

GET/POST/PUT/DELETE /api/v1/admin/holiday-calendars[/{calendarId}]                 (Settings.Manage)
  calendar = { calendarId, name, colourKey, regionNote, appliesToEveryone, isActive, holidayCount, peopleCount, rowVersion }
GET/POST/PUT/DELETE /api/v1/admin/holiday-calendars/{calendarId}/holidays[/{holidayId}]
  holiday = { holidayId, name, ruleKind: "FIXED"|"NTH_WEEKDAY"|"EASTER_OFFSET"|"ONCE"|"RANGE", month, day, nth, weekday, easterOffset,
              onceDate, rangeEnd..., yearly, weekendRule: "NONE"|"US"|"UK", regionNote, rowVersion }
GET  /api/v1/admin/holiday-calendars/{calendarId}/preview?year=      -> [ { date, endDate|null, name, observedFrom|null } ]
POST /api/v1/admin/holiday-calendars/{calendarId}/holidays/import?dryRun=true   body { text, year }
  -> { lines: [ { line, ok, message, parsed? } ], okCount, errorCount }          // dryRun=false saves the ok lines in one transaction when errorCount is 0 or acceptOk=true
GET/PUT /api/v1/admin/settings/holidays    -> { firmCalendarId, podDefaults: [ { podId, calendarId|null } ], rowVersion }
PUT  /api/v1/users/{userId}/holiday-calendar   body { calendarId|null }            (User.Manage)
GET/PUT/DELETE /api/v1/admin/settings/calendar  -> { minCoveragePercent, podMinimumPercent, podMinimums: [ { podId, people } ], defaults, isCustom, rowVersion }

GET /api/v1/dashboard/capacity   (existing)  state gains "HOLIDAY"
```

## 5. Parallel split and file ownership

Two agents, each in its own worktree under `/home/user/wt/`, pushing only to `dev` (`git pull --no-rebase origin dev`, then `git push origin HEAD:dev`; no rebase, no force; never `main`; no stash, no kill).

**Agent G2 (backend):** CAL-01 to CAL-04 and the backend part of CAL-09. Order: CAL-01 (scripts and permissions) first, then CAL-02, CAL-03, CAL-04. Regenerate the OpenAPI contract and the nswag client as soon as the DTOs and endpoints compile and push them early, then write "client pushed" in `progress.md`.

**Agent H2 (frontend):** CAL-05 to CAL-08 and the frontend part of CAL-09. Starts at once on fixtures that follow section 4 (a local `features/dashboard/calendar/calendar-contract.ts` with hand-written types and `calendar-fixtures.ts`, clearly marked temporary, plus fixtures for the Profile and Admin screens). When G2 has pushed the client, H2 deletes the temporary types, switches to the generated client and runs the full unit set. H2 never edits generated client files or `contracts/openapi`.

| Owner | Files and folders |
| --- | --- |
| Agent G2 | `db/scripts/58-user-absence.sql`, `59-holiday-calendars.sql`, `60-calendar-permissions.sql` (numbers 58 to 60 reserved; a fourth number needs a note in `progress.md` and the next free number), `backend/src/SharedKernel/Availability/**`, `backend/src/Modules/MatterFlow.Identity/**` (absences, availability service, lookup, users list, StarterRoles, seeding), the holiday code (a new area inside `MatterFlow.Identity` unless G2 finds a better home; no new module without a note, boundaries stay), `MatterFlow.WorkViews` (calendar endpoints, capacity `HOLIDAY`), `MatterFlow.WorkManagement` only for `MyMattersWorkloadService` and `MatterOverviewService` consumers, backend tests, `tools/seed-demo`, `contracts/**` (OpenAPI, `permissions.json`), generated frontend client, sensitive catalog and persona walk, `db/report-access.json`, `docs/architecture.md` availability section |
| Agent H2 | `frontend/src/app/features/dashboard/calendar/**` (new), the Calendar tab entry in `dashboard-page.ts` and `tab-icons.ts`, `frontend/src/app/shared/availability/**` (split of the form; new absence list and dialog), Profile and header-menu availability callers, `frontend/src/app/features/admin/holidays/**` (new) and the Settings > Dashboard calendar section, `frontend/src/app/core/auth/permissions.ts` (only to mirror the catalog after G2 pushes it), Calendar and Admin e2e specs, `docs/ux/tokens.css` and `scripts/check-theme-contrast.mjs` (coverage tokens), `docs/ux/theme-guide.md` (new Calendar section only) |
| Shared | `docs/ux/calendar/progress.md` (append-only, one section per agent), decision AT status line |

Conflict points: `contracts/openapi` and the generated client (only G2); `shortcut-registry.ts` (nobody); `dashboard-page.ts` (only H2); the availability form (only H2, CAL-05 first); `permissions.ts` generated or mirrored after G2's CAL-01 push.

Testing: cheap checks while building (lint, tsc, targeted unit tests). One full QA run only through CAL-10, when the owner says.

## 6. Work per issue (short)

- **CAL-01** scripts 58 (absences + copy), 59 (holidays, calendar columns), 60 (permissions + grants), starter roles, catalog, report-access, schema tests.
- **CAL-02** pure evaluator and holiday expansion, five consumers, constant-query loading, battery `HOLIDAY`, test updates.
- **CAL-03** three calendar endpoints, coverage maths, role grouping and workload sort, reasons gating, catalog and persona.
- **CAL-04** absence CRUD with overlap, past and scope rules, audit, "I'm back", holiday admin, import dry run, thresholds.
- **CAL-05** absence list and dialogs, validation, I'm back, header menu.
- **CAL-06** Admin > Holidays screens and dialogs, import, pod and person calendar, thresholds form.
- **CAL-07** tab, Month and Week, filters, cell, legend, tokens, banner, forecast, phone.
- **CAL-08** panel with counts, pods, the two role-grouped lists, reasons permission.
- **CAL-09** OpenAPI and nswag, catalog, seed, e2e, axe, guide.
- **CAL-10** full QA with evidence, only on the owner's word.

## 7. Risks

See epic #1074. Main ones: the evaluator change touches five consumers; migration of the single Out of office value; holiday calendar assignment (person, pod, firm, everyone); coverage maths (expected versus total, observed days, two-pod people); load shown per person under sensitive-matter rules.

## 8. Not in this work

Timeline view, export (CSV, Excel, ICS), "Who is out this week" strip, Tasks at risk, Reassign before leave, notifications, half days, approval workflow, Outlook sync, a firm setting for Monday-first weeks, the 24-month retention job. No new or changed keyboard shortcuts (#420).

## 9. Open for the owner

None blocks the start. Please confirm when convenient: (a) the primary-role rule (first role A to Z among roles that hold Workflow.Execute) because roles have no display order; (b) that the Calendar may show each person's open-task count (a number) to people with `Dashboard.ViewCalendar`; (c) the default thresholds 75 % and 60 %.
