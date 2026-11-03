# Dashboard Calendar: progress (epic #1074)

Protocol: one section per agent below, append-only, newest entry last; `git pull --no-rebase origin dev` before every push. Weight = hours / 66.5 (rounded to one decimal; the column sums to 100.0). Percent done is set by the agent at hand-back; total = sum of weight x percent. Plan: `plan.md`. Decision: `docs/requirements/decisions-addendum.md` section AT.

| Issue | Code | Title | Hours | Weight % | Done % | Weighted % |
| --- | --- | --- | --- | --- | --- | --- |
| #1074 | CAL-00 | Epic, issues, plan, decision AT | 2.0 | 3.1 | 100 | 3.1 |
| #1075 | CAL-01 | Backend: data model and migration (scripts 58 to 60) | 6.0 | 9.0 | 0 | 0.0 |
| #1076 | CAL-02 | Backend: evaluator rewrite (periods, holidays, five consumers) | 7.0 | 10.5 | 0 | 0.0 |
| #1077 | CAL-03 | Backend: calendar endpoints | 7.0 | 10.5 | 0 | 0.0 |
| #1078 | CAL-04 | Backend: absences and holidays admin APIs, thresholds | 7.5 | 11.3 | 0 | 0.0 |
| #1079 | CAL-05 | Frontend: Profile > Out of office | 5.0 | 7.5 | 0 | 0.0 |
| #1080 | CAL-06 | Frontend: Admin > Holidays and thresholds | 7.0 | 10.5 | 0 | 0.0 |
| #1081 | CAL-07 | Frontend: Calendar tab (Month, Week, banner, forecast, phone) | 8.0 | 12.1 | 0 | 0.0 |
| #1082 | CAL-08 | Frontend: right panel (people by role by workload) | 5.0 | 7.5 | 0 | 0.0 |
| #1083 | CAL-09 | Cross-cutting: contracts, catalog, seed, e2e, axe, guide | 6.0 | 9.0 | 0 | 0.0 |
| #1084 | CAL-10 | Final QA (only when the owner says) | 6.0 | 9.0 | 0 | 0.0 |
| | | **Total** | **66.5** | **100.0** | | **3.1** |

## PM (CAL-00)

- 2026-11-03 Epic #1074 and issues #1075 to #1084 created and linked as sub-issues; #997 linked as related by comment; plan, this table and decision AT written on `dev`. Script numbers 58 to 60 are reserved for CAL-01. Agent G2 writes "client pushed" here after the OpenAPI and nswag push.

## Agent G2 (backend)

- 2026-11-03 **client pushed** (OpenAPI `contracts/openapi/v1.json` and the nswag client `frontend/src/app/api/generated/api-client.ts`, commit "WPx CAL-01 CAL-02 CAL-03 CAL-04 ..."). All endpoints of plan section 4 exist and compile; logic is in place and its tests are running. Agent H2 can switch from fixtures now. Two breaking changes for existing frontend code (H2 area, CAL-05): `UserAvailabilityDto` lost `status`, `from`, `until`, `note` (now `absences[]`, `holidayCalendar`, `nextHolidays`; `current` gained `reason` and `absenceType`) and `SaveAvailabilityRequest` lost `status`, `from`, `until`, `note` (it saves the time zone and the work hours only; entries have their own endpoints). I also added the three codes to `frontend/src/app/core/auth/permissions.ts` (the catalog check), nothing else in H2's folders.

### Deviations and decisions to know about (sketch in plan section 4 followed unless listed)

1. **Weekday and nth numbers of a holiday rule**: `weekday` is 0 = Sunday ... 6 = Saturday (the mockup and JavaScript number); `nth` is 1 to 4 or -1 for the last; the plus-days of "Thanksgiving + 1" is `plusDays`. Holiday fields: `month, day, nth, weekday, plusDays, easterOffset, onceDate, rangeEndMonth, rangeEndDay, rangeEndDate, yearly, weekendRule, regionNote`. `RANGE` is yearly (`month/day` to `rangeEndMonth/rangeEndDay`, may not cross New Year) or one time (`onceDate` to `rangeEndDate`, `yearly=false`). `ONCE` uses `onceDate`.
2. **409 overlap body**: the problem JSON carries the other entry in `meta.overlapsWith` (`{ absenceId, type, startDate, endDate }`), not at the top level; `code` is `ABSENCE_OVERLAP`. Other codes: `ABSENCE_TYPE_INVALID`, `ABSENCE_RANGE_INVALID`, `ABSENCE_IN_PAST`, `ABSENCE_OPEN_ENDED_NOT_TODAY`, `ABSENCE_READ_ONLY`, `NOTE_TOO_LONG`, `CONCURRENCY_CONFLICT`.
3. **Open-ended entries**: the server accepts `endDate = null` only when `startDate` is today in the person's zone (the header quick action); a running open-ended entry can be saved again as it is.
4. **`workingDays`** of an entry is `null` for an open-ended entry (the sketch said int).
5. **"I'm back"** returns `{ deleted: bool, absence?: AbsenceDto }` (deleted when the entry starts today or later; otherwise it ends yesterday).
6. **Day panel**: `backOn` is set for OUT_OF_OFFICE only (first working day after the run of touching entries, skipping weekends and holidays; null when open-ended); HOLIDAY and NOT_WORKING have none. `absenceType` is absent (property not present) without `Dashboard.ViewAbsenceReasons`.
7. **Day state order** (one function, `EvaluateDay`): weekend or no work hours that weekday, then holiday, then Out of office, else available. Plan section 3 listed "Out of office before non-working"; the mockup (the stated reference) gives non-working days precedence, so a part-timer's day off or a Saturday inside a vacation is not counted as "expected" and does not lower coverage. I followed the mockup. Holiday still wins over Out of office.
7a. **Weekend**: a person with no work hours on a Saturday or Sunday is `WEEKEND`; a weekday without hours is `NON_WORKING`; both count in `offHours`. Levels `NON_WORKING` (nobody expected, no holiday) and `CLOSED` (nobody expected, at least one on holiday).
8. **Pod scope of the Calendar**: everybody has `Pod.View` in the starter roles, so the capacity rule would never refuse a pod. The Calendar uses `ICalendarAccess`: a caller who holds `User.View` (Director; the System Admin implicitly) works with every pod; everybody else only with the active pods they are a member of ("pods they lead": Pod Lead is a role, not a flag). For them `podScope=all` means their pods, another pod is 403, unknown pod is 400. The same rule limits `User.ManageAvailability` to people who share an active pod. Flagged for the owner: the "Director" marker is `User.View`.
9. **Pod defaults of a person's calendar**: person's own calendar, else the default of the person's primary pod (the pod with the lowest id when none is primary), else the firm calendar; plus every active "applies to everyone" calendar. `GET /users/{id}/availability` shows the one in force with `source` PERSON, POD or FIRM.
10. **Settings storage**: the thresholds are one JSON value `Calendar.Thresholds` and the firm calendar is `Calendar.FirmHolidayCalendarId` in `dbo.AppSetting` (the issue named three keys; one value with one row version matches the gauge settings). `GET/PUT/DELETE /admin/settings/calendar` answer `{ minCoveragePercent, podMinimumPercent, podMinimums: [{ podId, people }], defaults, isCustom, rowVersion, updatedAtUtc, updatedBy }`. `GET/PUT /admin/settings/holidays` answer `{ firmCalendarId, podDefaults: [{ podId, podName, calendarId }], rowVersion }` (the row version is that of the firm setting; pods listed in a PUT are set, others stay).
11. **Reads need two permissions** like the other Dashboard tabs: `Dashboard.View` and `Dashboard.ViewCalendar`.
12. **Preview, import**: `GET /admin/holiday-calendars/{id}/preview?year=` returns `[ { date, endDate, name, observedFrom } ]` (a range is one line). `POST .../holidays/import?dryRun=true&acceptOk=false` body `{ text, year }`; formats `MM/DD/YYYY, Name`, `YYYY-MM-DD, Name`, `MM/DD, Name` (uses `year`) and ranges `a - b, Name`; answer `{ lines: [{ line, ok, message, parsed }], okCount, errorCount, saved }`. Saved holidays are `ONCE` or one-time `RANGE`.
13. **Capacity**: `state` gains `HOLIDAY` (documented on `DashboardCapacity`); the six people states and the People list are unchanged.
14. **Note on notes**: the compact availability summary used by lists and pickers (`availability.note`, existing behaviour since script 22) still carries the note of the entry that covers now. Decision AT item 2 says notes are visible only to the owner and managers; the Calendar endpoints never carry a note. Left as it is so existing screens keep working; PM may want to decide whether to remove the note from the compact summary.


## Agent H2 (frontend)

- 2026-11-03 **CAL-05 Profile > Out of office** (commit `cd69354`): the single Out of office value on the Profile is a list of entries (`shared/availability/absences/`: `absence-list`, `absence-dialog`, `holiday-card`, `absence-rules`). Grouped Now, Upcoming, Past (collapsed, read-only); Add and Edit in `mf-form-dialog` (Cancel left, primary right, "Discard changes?"); Delete with the small `mf-confirm-dialog`; "I'm back" on a running entry; server messages for overlap (names the other entry from `meta.overlapsWith`), a start in the past and the open-end rule; the advisory pod-below-minimum line from `/check`; a Person field for people with `User.ManageAvailability`. `availability-form` keeps work hours and time zone only (its save request is now `{ timeZoneId, workHours, rowVersion }`); the header menu "Set out of office..." has a Type field and creates an entry starting today, "I'm back" ends the running one.
- 2026-11-03 **CAL-06 Settings > Holidays and thresholds**: the mockup puts Holidays as the third tab of Settings (Branding, Dashboard, Holidays), so it is there and not a new left-menu item (`features/admin/holidays/`: `holidays-admin`, `calendar-dialog`, `holiday-dialog`, `import-dialog`, `thresholds-form`, `user-calendar-field`). Calendars by category with colour and "applies to everyone", the days of the chosen calendar in this year or a next-year preview, add/edit/delete, a line-by-line import check (server dry run) before saving, the firm default and one default per pod, and the "Holiday calendar" field on the person (user drawer, `User.Manage`) with the next holidays. The thresholds (firm minimum, pod minimum, optional people per pod; Reset to default only fills the form; version-conflict message) are a section of Settings > Dashboard.
- 2026-11-03 **CAL-07 and CAL-08 Calendar tab and panel** (`features/dashboard/calendar/`): tab `Calendar` (icon `pi-calendar`, `Dashboard.ViewCalendar`), lazy with the Dashboard chunk; Month (default) and Week (pods by days, a real table), Previous/Today/Next, arrow keys inside the Month grid (no new shortcut), the page-wide Scope of the Dashboard header as the Pod filter plus a Role filter, the legend, day cells with the level as icon and word and "available of expected" ("6 of 6 expected", "6/6" in a narrow cell), the 30-day risk banner with "Show risk days", the 4-week forecast tiles, the read-only day panel (docked from 1024, slide-over 768 to 1023, bottom sheet under 768), "Add out of office" for others. State in the address (`cal`, `month`, `week`, `day`, `role`, with `pod`).
- 2026-11-03 **CAL-09 (H2 part)**: coverage tokens `--mf-cov-*` in `docs/ux/tokens.css` and the contrast script (141 pairings pass); theme guide section 12; e2e specs `calendar.spec.ts`, `admin-holidays.spec.ts`, `profile-absences.spec.ts` (written and type-checked, **not run**: no stack, the owner runs the full QA in CAL-10); `profile-availability.spec.ts` and the e2e seeder adapted to the new API.

### How the switch from fixtures was done

The three doors (`absence-api.ts`, `calendar-api.ts`, `holiday-api.ts`) now call the generated client (G2's push, no generated file touched). The screens keep small view models (`*-contract.ts`: null instead of undefined, string unions, one place for the mapping); the sample data lives on only as in-memory test doubles for the specs (`shared/testing/calendar-testing.ts`, nothing in the app imports them).

### Deviations from the mockup and from the sketch (H2)

1. **Pod filter**: the Pod filter is the Dashboard's page-wide Scope in the header (same value on every tab, `?pod=`), not a second Pod dropdown in the toolbar.
2. **No initials in Week cells**: the mockup's Week cells list who is out as initials; the contract returns counts per pod and day only, and the owner dropped the "who is out" strip, so the cells carry counts, level and "n out".
3. **Cell text**: "26 of 36 expected" (decision AT item 8) instead of the mockup's "26/36"; "26/36" in a cell narrower than 130 px (container query). At 1366 px with the panel docked the cells are about 106 px, so the short form shows; at 1920 px the words show.
4. **Levels**: the thresholds are the plan's (Critical under 60 %, Low under 75 %, Watch for a pod below its minimum), so 11/25 (72 %) is Low (the mockup coloured it Watch, with different bands).
5. **Holidays**: a tab of Settings (as in the mockup) with the flag icon `pi-flag` (the mockup used the calendar icon; one concept one icon: the Calendar tab keeps `pi-calendar`).
6. **Import**: the API saves imported days as one-time days, so the mockup's "repeat every year" tick box is not in the dialog; the text says to edit a holiday to make it yearly. Accepted line formats are the server's (MM/DD/YYYY, YYYY-MM-DD, MM/DD).
7. **Person's calendar field** reads the effective calendar and its source from `GET /users/{id}/availability` (`holidayCalendar.source`); the pod name is not in that answer, so the first option says "Pod default (US Holiday)".
8. **Reset to default** of the thresholds only fills the form (like the gauge settings); the `DELETE /admin/settings/calendar` endpoint is not used.
9. **Open by default**: the panel opens on desktop only when today is in the view (Month or Week); otherwise it opens on a click.

### Tests run and not run

Run: eslint on `src`, Prettier on `src` and `e2e`, tsc app, spec and e2e, `check-theme-colours`, `check-theme-contrast`, targeted `ng test` runs (Calendar, holidays, absences, availability form, header menu, Profile, Settings, Users, Dashboard, shared UI, core), `ng build` (initial 661 kB, Calendar in the lazy Dashboard chunk). Not run: the full unit suite, the e2e suite (no stack), axe in a browser stack (the specs are written for four sizes), `dotnet`. Also run (no stack): the built development bundle in headless Chromium with the API answered from the browser (HTTP-level mock of the new endpoints over the mockup's seeded roster) and axe-core 4 (wcag2a, wcag2aa, wcag21aa, wcag22aa): no violations on Calendar Month, Week and the open panel (1366x768, 1920x1080, 768x1024, 375x812, plus 1366x600), the Technician's "not available" note, Profile with the Add and overlap dialogs, Settings > Holidays with the holiday, import and calendar dialogs; the Calendar document does not scroll on desktop (the grid and the panel do) and nothing scrolls sideways. Settings > Dashboard at 375 px had 26 px of sideways scroll from the existing level inputs of the gauge form (fixed in `dashboard-settings.ts`, not re-shot). Screenshots (`<role>-<view>-<size>.png`, Director, Pod Lead, Technician, System Admin) are in `docs/ux/calendar/screenshots/`; the mockup's own are on branch `calendar-mockup`.

