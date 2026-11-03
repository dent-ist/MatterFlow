# Dashboard Calendar: feasibility (WPx CAL-00)

Read with `README.md`. Everything below was checked in the code of `origin/dev` (2026-11-03). No code was written.

## 1. Data: what exists, what is missing
| Need | Today | Missing |
|---|---|---|
| One out of office period per user | `dbo.UserAvailability` (script 22): one row per user, `Status`, `OutOfOfficeFromDate`, `OutOfOfficeUntilDate` (both nullable), `Note` (200), `TimeZoneId`, `HasCustomWorkHours`, `RowVersion`. Work hours in `dbo.UserWorkHour` (ISO day, start, end). | **Many periods per user**: a new table `dbo.UserAbsence` (below). |
| Absence type | none | `AbsenceType` (VACATION, SICK, TRAINING, CONFERENCE, OTHER). Today there is only a free-text note. |
| Who can edit whose | `AvailabilityControllers.cs`: own data with `Task.View`; another user's with `User.Manage`. | A lighter `User.ManageAvailability`, scoped to the pods a person leads. |
| Holidays | nothing (grep: no holiday code, table or setting) | Holiday calendars, holiday rules and the person's (and pod's) calendar. |
| Workers and pods | `Pod`, `PodMember` (script 04), `Workflow.Execute` (role permission); `CapacityService` already resolves "worker = Workflow.Execute and active pod member" and the pod scope (`podScope`: all, mine, pod id; unknown pod 400, forbidden pod 403). | Reuse as is. |
| Time zone | `UserTimeZone` and `Firm:TimeZoneId`; the evaluator works per person's zone (DST safe). | Calendar days are floating dates in the person's zone; see section 5. |
| Open tasks and owners | `Task` with assignee, due date, status; `WorkloadService` counts open tasks per user. | A query "open tasks of user X due between A and B" (uses existing columns; an index on assignee and due date may help, check the plan). |
| Reassign | `Task.Assign` and the assignee picker with states (Dashboard grid, `users-assign.ts`). | Nothing: the mockup reuses it. |
| Thresholds | `dbo.AppSetting` key/value store (script 48), Dashboard settings page (`mf-dashboard-settings`, the settings registry in code). | Three keys: minimum coverage percent, minimum people per pod (JSON or one key per pod). |

## 2. New tables (next free script numbers at the time; today the last one is 57)
```
dbo.UserAbsence        AbsenceId, UserId, AbsenceType, StartDate DATE, EndDate DATE NULL (null = until the person is back), Note NVARCHAR(200),
                       CreatedAtUtc, CreatedByUserId, UpdatedAtUtc, UpdatedByUserId, RowVersion
                       CK EndDate >= StartDate; IX (UserId, StartDate) INCLUDE (EndDate, AbsenceType); IX (StartDate, EndDate) INCLUDE (UserId, AbsenceType)
                       No overlap constraint in SQL: the service rejects an overlap for one user in one transaction (a SQL Server exclusion needs a trigger).
dbo.HolidayCalendar    CalendarId, Name (unique), ColourKey (the tag palette), RegionNote, AppliesToEveryone BIT, SortOrder, IsActive
dbo.Holiday            HolidayId, CalendarId, Name, RuleKind (FIXED, NTH_WEEKDAY, EASTER_OFFSET, ONCE, RANGE), Month, Day, Nth, Weekday, PlusDays, EasterOffset,
                       OnceDate, RangeEndMonth, RangeEndDay, RangeEndDate, Yearly BIT, WeekendRule (NONE, US, UK), RegionNote
dbo.AppUser            + HolidayCalendarId INT NULL (null = pod default, then firm default)
dbo.Pod                + DefaultHolidayCalendarId INT NULL
dbo.AppSetting         rows Calendar.MinCoveragePercent, Calendar.PodMinimums, Calendar.FirmHolidayCalendarId
```
Holidays are stored as **rules** and expanded by one pure function (the same maths as the mockup: Easter, nth weekday, observed day, ranges) for any year. Nothing has to be re-entered each year; a one-time holiday is a rule of kind ONCE. Expanding a year is microseconds.
Half days (later) fit by adding `StartHalf` and `EndHalf` (NONE, AM, PM) to `UserAbsence`; I would leave room by naming the date columns as above and not adding a computed "days" column.

## 3. Migration of the existing single Out of office value
CLAUDE.md: nobody uses the application and all data is demo data, so a backfill is rarely needed, but scripts are immutable and the first real deployment must replay cleanly. So the migration is small and fix-forward:
1. Script A (new, e.g. `58-user-absence.sql`): create `UserAbsence`; `INSERT ... SELECT` one row per `UserAvailability` row with `Status = 'OUT_OF_OFFICE'`: type `OTHER` (the old record has no type), `StartDate = COALESCE(OutOfOfficeFromDate, CAST(UpdatedAtUtc AS date))`, `EndDate = OutOfOfficeUntilDate` (null stays null = until back), `Note`, `CreatedByUserId = UpdatedByUserId`. Idempotent (`WHERE NOT EXISTS`). The seeded/demo rows therefore become "the first entry", as requested.
2. The old columns `Status`, `OutOfOfficeFromDate`, `OutOfOfficeUntilDate`, `Note` stay in place (no destructive change in the same release). The code stops reading and writing them. A later numbered script drops them (and the `CK_UserAvailability_Range`, `IX_UserAvailability_Status`), once `db/report-access.json` and the report views no longer depend on them (`UserAvailability` is `allow` for the report login today; check report definitions before dropping).
3. `AvailabilityStatuses` and the DTO fields `status`, `outOfOfficeFrom`, `outOfOfficeUntil`, `note` of `UserAvailabilityDto` are replaced by an `absences` list. The OpenAPI contract and the nswag client change in the same pull request (CI drift check). The header menu "Set out of office..." and "I'm back" keep their behaviour: they create an entry starting today (until date optional) and end the current entry yesterday.
4. New tables need an entry in `db/report-access.json`. Recommendation: **deny** `UserAbsence` (type and note are personal data) or expose a view without `AbsenceType` and `Note`; holidays `allow`.

## 4. How availability and capacity evaluation must change
Today `UserAvailabilityProfile` has one window (`OutOfOfficeFromDate`, `OutOfOfficeUntilDate`) and `UserAvailabilityEvaluator.Evaluate(profile, nowUtc)` returns AVAILABLE, OUT_OF_OFFICE or the soft OFF_HOURS. Changes:
- `UserAvailabilityProfile` gets `IReadOnlyList<AwayPeriod> Periods` and `IReadOnlySet<DateOnly> HolidayDates` (the person's calendar and every applies-to-everyone calendar, expanded for the years that matter). `Evaluate` keeps its order: any period covering the instant (in the person's zone) wins; else a holiday today gives **OFF_HOURS with reason HOLIDAY** (a soft state: assignment stays possible, and `CapacityRules.IsPresent` already leaves such people out of the slots); else the work hours.
- A second pure function `EvaluateDay(profile, date)` returns the day states the calendar uses (AVAILABLE, OUT_OF_OFFICE with the period, HOLIDAY with names, NON_WORKING for a part-timer's day, WEEKEND). Both live in `SharedKernel/Availability` next to each other and share the helpers, so the battery, the People list, the assignee picker and the Calendar cannot disagree (the pattern `CapacityRules` already follows). Table-driven unit tests, including DST days and the observed-day rules.
- Consumers to change: `UserAvailabilityService` (profile loading: `ToProfile`, `EvaluateAsync`, save/validate), `IUserAvailabilityReader.AwayWindowsAsync` (returns **one** `AwayWindow` per user today; becomes a list, or "the current or next window" for the callers that need one) and its callers `CapacityService` (line about 191, People list "back on"), `MyMattersWorkloadService` (about line 56), `MatterOverviewService` (about line 139, the `MyMattersAwayWindow` DTO), the users list filter `availability=OUT_OF_OFFICE` in `UsersController` (SQL on the old columns becomes `EXISTS` on periods), `UsersLookupController` and the user administration list (state and "out until"). `EvaluateAsync` says "two queries regardless of the number of users": it becomes four set-based queries (profiles, hours, periods overlapping the window, holiday dates), still constant in the number of users.
- Battery text on a firm-closure day: everyone is OFF_HOURS, so the battery would read "After hours". It needs a neutral "Holiday" state or reason in `DashboardCapacity.State` (small change).
- Existing tests to update: `UserAvailabilityEvaluatorTests`, `UserAvailabilityApiTests`, `UserAvailabilitySchemaTests`, `CapacityRulesTests`, the frontend `availability` specs, `set-out-of-office-dialog` and `availability-form` specs, and e2e `profile-availability`, `profile-pf4-hours-zone`, `pw4-workload`, `users-us3-grid`.
- Frontend: `shared/availability/availability-form.ts` (861 lines) holds status, dates, note, work hours and time zone in one form. Split it: the out of office part becomes the new list and dialog; work hours and time zone stay as they are.

## 5. Performance: 40 users x 365 days
- The raw problem is 14,600 person-days; each is an array lookup. In memory it is well under 5 ms on the server and in the browser (the mockup computes all of it, a month, a 6-month timeline and the forecast, on every click without noticeable delay).
- **Query**: periods overlapping the requested range (a year of 40 users is a few hundred rows, an indexed range scan), holidays by rule (tens of rows), pod membership (cached by the pod module). No per-user and no per-day query.
- **Endpoints** (OpenAPI, all `podScope` like the capacity endpoints): `GET /dashboard/calendar/days?from&to&podScope&role` returns one object per day (available, out, holiday, off, total, expected, level inputs, holiday names), up to 42 or 90 rows; `GET /dashboard/calendar/people?from&to&podScope` returns per person the **ranges** (not days), the calendar id and the pod, about 100 ranges, about 10 KB; `GET /dashboard/calendar/day?date` returns the two lists of the panel with reasons when permitted; `GET /dashboard/calendar/risks` returns tasks at risk for a day. The coverage level is computed on the server (single source of truth); the client only draws.
- **Caching**: not needed for 40 users; the answers are small and an ETag per range is enough. The page reads again on focus like the Dashboard summary.
- **Rendering**: Month 42 cells, Week 5 x 7, Timeline 36 rows plus 5 group rows and a coverage row, about 1,000 to 1,300 DOM nodes per view including the page (counted in the mockup). No virtualisation is needed up to roughly 150 rows; beyond that the rows would be virtualised. The Timeline scrolls inside its frame with sticky header, coverage row and name column.
- **Write path**: one absence is an insert with an overlap check inside a transaction (`UPDLOCK` on the user's rows). Contention is negligible.

## 6. Permissions
New (all four need `contracts/permissions.json`, `Permissions.cs` and the Angular `permissions.ts` kept in step, a seed script in the style of scripts 46 and 48, and starter-role grants in `StarterRoles.cs`; Director and Pod Lead for the first three, nobody else):
| Code | Meaning |
|---|---|
| `Dashboard.ViewCalendar` | Calendar tab: counts, who is out and who is in, holidays |
| `Dashboard.ViewAbsenceReasons` | absence type and note in the calendar and exports |
| `User.ManageAvailability` | create, edit, delete absences of others (Pod Lead: members of the pods they lead; Director: all) |
Existing and sufficient: `Settings.Manage` (holidays, calendars, thresholds; reword its description), `Task.Assign` (reassign), `Task.View` (own entries, as today), `User.Manage` (the "Holiday calendar" field on a user). Existing permissions alone are not enough (README, "Roles and permissions").
Role presets in the mockup (Director, Pod Lead, Technician) match the proposal. Note: the starter Director does not hold `Settings.Manage` (only System Admin does); the mockup ticks it for the Director so that the Admin screen can be shown.

## 7. Privacy
- An absence type and note are personal data, Sick is health-adjacent. Rule: **the server leaves type and note out of every answer unless the viewer holds `Dashboard.ViewAbsenceReasons`** (and, for a Pod Lead, only for the pods in scope); counts, the word "Out of office", the return date and holidays are visible with `Dashboard.ViewCalendar`. The same gating applies to the day panel, timeline tooltips, ICS and CSV exports and the notification texts. Technician: no tab, no endpoint (403), and the API refuses `podScope` outside a Pod Lead's own pods (as the capacity endpoint does).
- The note field warns "do not enter medical details". Notes are visible to the owner and to managers who may edit the entry, not on lists.
- **Audit**: semantic audit events like script 22's rule ("who changed whose availability"): "Priya Nair added Vacation 07/05/2027 to 07/16/2027 for Ben Carter". Reading is not audited.
- **Reports**: deny the table to the report login or expose a view without type and note (section 3).
- **Retention**: recommend deleting entries 24 months after the end date (a scheduled job, a later small task); an owner or HR decision.
- **Sensitive matters**: the tasks-at-risk list follows the sensitive-matter visibility rule used by every task list (a viewer without access sees neither title nor matter name, only "a task"), as the Dashboard counts do. The capacity forecast counts open tasks as numbers only, like the battery.
- **Impersonation** (docs/ux/impersonation): an impersonating admin sees what the impersonated role would see.

## 8. Risks and things I could not settle from the code
- **Evaluation consumers are many** (five modules). The change is mechanical but wide; the shared pure functions and their tests are the protection. This is the biggest cost item.
- **Calendar day vs instant.** Entries are whole days in the person's zone (as today); the Calendar day is a floating date. A New York manager and a London colleague agree on "11/25" for the entry; the hours differ by five (shown later with "working hours by time zone"). Today's date in the calendar is the viewer's firm date.
- **Overlap rule vs migration.** An old open-ended row and a new entry could overlap if both are created between deployment steps; the migration runs in one script and the old columns are no longer read, so there is no window.
- **Holiday rule coverage.** FIXED, NTH_WEEKDAY, EASTER_OFFSET, ONCE, RANGE with the US and UK weekend rules cover the US federal and England/Wales sets. Other regions (for example lunar-calendar holidays) are entered as ONCE per year via the paste list; the import dialog makes that fast.
- **Observed days differ by firm.** The weekend rule is a per-holiday choice (None, US, UK) so the admin can fix a firm that does it differently.
- **Open question for the owner** that changes the work: approval workflow (not recommended now), half days in release 1 (recommended later), and whether Technicians should see the calendar (recommended no).
