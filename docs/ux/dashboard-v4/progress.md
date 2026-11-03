# Dashboard v4 (Summary tab): progress (epic #1063)

Protocol: one section per agent below, append-only, newest entry last; `git pull --no-rebase origin dev` before every push. Weight = hours / 48.0 (rounded to one decimal; the column sums to 100.0). Percent done is set by the agent at hand-back; total = sum of weight x percent. Plan: `plan.md`. Decision: `docs/requirements/decisions-addendum.md` section AS.

| Issue | Code | Title | Hours | Weight % | Done % | Weighted % |
| --- | --- | --- | --- | --- | --- | --- |
| #1063 | DB-00 | Epic, issues, plan, decision AS | 2.0 | 4.2 | 100 | 4.2 |
| #1064 | DB-01 | Backend: unassigned-since, summary gauge block, working-hours age, settings | 6.0 | 12.5 | 0 | 0.0 |
| #1065 | DB-02 | Backend: capacity summary and People list | 7.0 | 14.6 | 0 | 0.0 |
| #1066 | DB-03 | Frontend: Summary layout, cards, grid, right column | 6.0 | 12.5 | 0 | 0.0 |
| #1067 | DB-04 | Frontend: grid columns and inline assign | 7.0 | 14.6 | 0 | 0.0 |
| #1068 | DB-05 | Frontend: capacity battery | 4.5 | 9.4 | 0 | 0.0 |
| #1069 | DB-06 | Frontend: unassigned gauge and settings form | 4.5 | 9.4 | 0 | 0.0 |
| #1070 | DB-07 | Cross-cutting: contracts, catalog, e2e, axe, guide | 5.0 | 10.4 | 0 | 0.0 |
| #1071 | DB-08 | Final QA (only when the owner says) | 6.0 | 12.4 | 0 | 0.0 |
| | | **Total** | **48.0** | **100.0** | | **4.2** |

## PM (DB-00)

- 2026-11-03 Epic #1063 and issues #1064 to #1071 created and linked as sub-issues; #997 linked as related; plan, this table and decision AS written on `dev`. Script number 57 is reserved for DB-01.

## Agent G (backend)

- 2026-11-03 **client pushed.** OpenAPI (`contracts/openapi/v1.json`) and the nswag client (`frontend/src/app/api/generated/api-client.ts`) are regenerated and on `dev` with the DTOs and endpoints compiling. Agent H can switch from fixtures. Logic is in place; tests follow.
  Contract as built, with the DEVIATIONS from plan section 4 (all additive except the notes marked CHANGED):
  - `GET /dashboard` -> `unassignedGauge` as sketched (`count, oldestSinceUtc, oldestAgeMinutes, ageBasis, level, asOfUtc`); null without Dashboard.ViewSummary.
  - `GET /task-queue` -> rows have `unassignedSinceUtc` and `unassignedForMinutes` (null unless the task is open and has no assigned user); sort key `unassignedSince` (unassigned tasks first, longest waiting first when ascending).
  - `GET /dashboard/capacity` (Dashboard.View + ViewUsers, `podScope`). CHANGED per owner decision (a): people out of office or outside work hours are NOT in the denominator. Fields: `asOfUtc, state, workers, presentWorkers, slotsPerPerson, totalSlots, freeSlots, usedPercent, freePercent, canTakeWork, states[6], assignedLastHour`. `workers` = everyone in scope, `presentWorkers` = can take work now, `totalSlots` = presentWorkers x slotsPerPerson. `usedPercent` and `freePercent` are NULLABLE (null unless `state` = `OK`). NEW `state`: `OK` | `AFTER_HOURS` (nobody present, at least one off hours: show a neutral "After hours") | `ALL_OUT` (everybody out of office) | `NO_WORKERS` (empty scope). `states` still lists all six people states (`AVAILABLE, OCCUPIED, BUSY, OVERLOADED, OUT_OF_OFFICE, OFF_HOURS`) and adds up to `workers`. `assignedLastHour` is an int (0 when no workers).
  - `GET /dashboard/capacity/people` (same permission and scope; `q`, `state`): array of `{userId, displayName, state, load, outUntil, podNames}`; `outUntil` is the LAST day out (date only `yyyy-MM-dd`, null when open-ended); sorted Overloaded, Busy, Occupied, Available, Out of office, Off hours, then name; at most 200. Unknown `state` is 400 `UNKNOWN_STATE`.
  - `GET /users/lookup` items gain `capacityState` and `load` (New + In progress, true count).
  - NEW, not in the sketch (needed for the DB-06 settings form): `GET/PUT/DELETE /api/v1/admin/settings/dashboard` (Settings.Manage). GET returns `{gauge, defaults, isCustom, rowVersion, timeZoneId, updatedAtUtc, updatedBy}` with `gauge = {workdayStart:"08:00", workdayEnd:"18:00", workDays:[1..5 ISO], ageBasis:"WORKING"|"CLOCK", levelHours:[1,2,3,4,5], tasksPerLevel:5, countBonusMax:2}`; PUT body `{gauge, rowVersion}` (empty rowVersion when `isCustom` is false), DELETE `?rowVersion=` resets to defaults; 400 on invalid values, 409 on a version conflict. The settings are ONE stored value (key `Dashboard.Gauge`), not seven rows.
  - Time zone: the firm zone `Firm:TimeZoneId` (appsettings, default America/New_York) is the existing application-level zone, the same one the availability rules use. There is no DB setting for it; `timeZoneId` is shown read-only in the settings view.

## Agent H (frontend)

- 2026-11-03 DB-03 to DB-06 built against typed fixtures first (`dash-v4-contract.ts`, `dash-v4-fixtures.ts`, the `DashV4Api` facade), then switched to the generated client the same day after Agent G's "client pushed" (fixtures and the temporary types are deleted; `DashV4Api` now calls `DashboardBoardClient.getDashboardCapacity` and `getDashboardCapacityPeople`; the gauge is `summary.unassignedGauge`; the settings form uses `SettingsDashboardClient`). No generated file was edited by hand.
- 2026-11-03 Built on the contract as G pushed it: capacity `state` (OK / AFTER_HOURS / ALL_OUT / NO_WORKERS) decides the battery mode (neutral "After hours" and "Everyone is out of office" instead of a percentage); the formula tooltip says out-of-office and off-hours people are not counted (G's owner decision (a)); the Settings form sends ISO weekday numbers, an empty `rowVersion` for the first save, and a DELETE reset when the values equal the defaults.
- 2026-11-03 Overview and the Period control are gone from Summary (Trends keeps its Period); the old Summary lists (Overdue, Due soon, the Director's Unassigned list) are gone; the Technician's "Unassigned work" queue is unchanged. Unit specs and the Dashboard e2e specs that depended on the old Summary were removed or rewritten (new e2e: `dashboard-v4-summary.spec.ts`). Shared files touched (small, additive): `task-table.ts/.scss`, `work-list.ts`, `row-edit.ts`, `inline-menu.ts`, `assignee-list.ts`, `column-prefs.ts`, `sort-note.ts`, `sort-sentences.ts`, `tab-icons.ts`, `docs/ux/tokens.css`, `scripts/check-theme-contrast.mjs`.
- Open for G or the owner: (1) the People list orders by severity on the server and groups by state here, which agrees; (2) the issue text for the formula tooltip says "3 x people who take work", the built text says "people who are at work now" because of decision (a); (3) the phone task cards keep the standard cells (no Type-icon-only, `+9d` or Assign picker in cards).
