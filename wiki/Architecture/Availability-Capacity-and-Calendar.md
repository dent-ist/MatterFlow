# Availability, Capacity and Calendar

[[_TOC_]]

**What this page is for.** How MatterFlow decides whether a person is available, how the Dashboard counts capacity and unassigned work, and how the Dashboard Calendar works. If you touch Out of office, holidays, the capacity battery, the unassigned gauge or the Calendar tab, read this first. Design text: `docs/architecture.md` section 6.7 and the decisions addendum sections AS, AT and AV (see [Decision Index](../Reference/Decision-Index.md)).

## Principle

Availability and load are **operational capacity information**. The product never ranks or evaluates people with them (dashboard counts are not performance metrics). The availability **state is never stored**: it is computed when read, so every screen shows the same answer for the same instant.

## Building blocks

| Piece | Where | Role |
|---|---|---|
| `UserAvailabilityEvaluator` | `backend/src/MatterFlow.SharedKernel/Availability/UserAvailability.cs` | Pure function: profile plus a time gives `AVAILABLE`, `OUT_OF_OFFICE` or `OFF_HOURS` (soft state: outside work hours or a holiday). `EvaluateDay` gives the state of one calendar day. Unit tested for DST, zones and midnight |
| `HolidayRulesEngine` and rule kinds | `SharedKernel/Availability/HolidayRules.cs` | Expands holiday rules (`FIXED`, `NTH_WEEKDAY`, `EASTER_OFFSET`, `ONCE`, `RANGE`; weekend rule `NONE`, `US`, `UK`) for any year |
| `CalendarCoverage` | `SharedKernel/Availability/CalendarCoverage.cs` | Coverage levels of a day and a pod: `CRITICAL`, `LOW`, `WATCH`, `GOOD`, `CLOSED`, `NON_WORKING` |
| `CapacityRules` | `SharedKernel/Tasks/CapacityRules.cs` | The capacity states of a person and the slot arithmetic, shared by the battery, the People list and the assignee picker |
| Availability profile, work hours, Out of office | `Identity` module: `UserAvailabilityService`, `AbsenceService` | Tables `UserAvailability`, `UserWorkHour`, `UserAbsence` (scripts 22 and 58) |
| Holiday calendars | `Identity` module: `HolidayCalendarService`, `HolidayLoader` | Tables `HolidayCalendar`, `Holiday` (script 59); `AppUser.HolidayCalendarId`, `Pod.DefaultHolidayCalendarId` |
| Settings | `Configuration` module: `DashboardSettingsService`, `CalendarSettingsService` | `Dashboard.Gauge`, `Dashboard.Capacity`, `Calendar.Thresholds`, `Calendar.FirmHolidayCalendarId` in `dbo.AppSetting` |
| Read side | `WorkViews` module: `CapacityService`, `UnassignedGauge`, `CalendarService`, `WorkloadService`, `SwimlaneService` | Dashboard endpoints |
| Bulk reader | `IUserAvailabilityReader` (`Identity.Contracts`) | Evaluates many users in a fixed number of SQL statements |

## Availability evaluation

::: mermaid
flowchart TD
  S["Person and an instant"] --> H{"Holiday on the person's local day?"}
  H -->|"yes"| OH1["OFF_HOURS with reason HOLIDAY"]
  H -->|"no"| A{"Out of office entry covers the local day?"}
  A -->|"yes"| OOO["OUT_OF_OFFICE until the end day, or until the person is back"]
  A -->|"no"| W{"Inside the weekly work hours?"}
  W -->|"yes"| AV["AVAILABLE"]
  W -->|"no"| OH2["OFF_HOURS: weekend, outside hours or a day without a schedule"]
:::

- A holiday of the day wins over everything (calendar of the person, else the default of their primary pod, else the firm calendar, plus every active "applies to everyone" calendar).
- Out of office entries have types `VACATION`, `SICK`, `TRAINING`, `CONFERENCE`, `OTHER`; the end day is inclusive; an entry without an end lasts until the person is back. An overlap is 409 `ABSENCE_OVERLAP`.
- Default work hours Monday to Friday 09:00 to 17:00 in the person's time zone (default `Firm:TimeZoneId`). End times are exclusive.
- Who may read or change another person's availability: `User.Manage`, or `User.ManageAvailability` within a shared active pod (`ICalendarAccess`), or `User.View` holders such as the Director.

## Capacity battery

- A **worker** is a user who holds `Workflow.Execute` and is an active member of a Pod in the page scope (scope is `all`, `mine` or one pod).
- Load = number of open assigned tasks that are New or In progress (On hold does not count). Each person has 3 slots (`CapacityRules.DefaultSlotsPerPerson`).
- Person states: load 0 `AVAILABLE`, 1 `OCCUPIED`, 2 `BUSY`, 3 or more `OVERLOADED`; `OUT_OF_OFFICE` and `OFF_HOURS` win over the load.
- Setting `Dashboard.Capacity.countOffHours` (default true): a person outside work hours still counts as capacity; with it off they are left out of the total slots.
- The load is a bare integer counted unfiltered by the sensitive-matter rule (a deliberate aggregate exception, decision AS item 12, listed in the visibility source allow-list).
- Endpoints: `GET /api/v1/dashboard/capacity` and the People list (`DashboardBoardController`); permission `Dashboard.ViewUsers`.

## Unassigned gauge

- Counts open tasks nobody holds, using `dbo.Task.UnassignedAt` (script 57; null for rows from before the script, readers use `COALESCE(UnassignedAt, CreatedAt)`).
- Gives the oldest wait in minutes (working minutes by default, or clock minutes) and one level 0 to 5.
- Setting `Dashboard.Gauge` (JSON): working day (default 8 AM to 6 PM, Monday to Friday), age basis, hours per level (default 1 to 5), count bonus (one level per 5 tasks, at most +2).
- Shown with `Dashboard.ViewSummary`; the Summary tab with only `Dashboard.ViewUnassigned` lists unassigned tasks without the department counts.

## Dashboard Calendar

- Endpoints `GET /api/v1/dashboard/calendar/days`, `/day`, `/summary` (`DashboardCalendarController`); needs `Dashboard.View` and `Dashboard.ViewCalendar`. `absenceType` is left out without `Dashboard.ViewAbsenceReasons`; the note is never returned.
- Per day: expected = people in view minus holiday and non-working; available = expected minus Out of office. Day tiles are Available, Out of Office and Off Hours (people off for a holiday count in Off Hours).
- Thresholds in `Calendar.Thresholds` (defaults 75 percent firm, 60 percent pod, optional per-pod minimum people).
- Administration of holidays: Administration > Settings (holiday calendars, import, thresholds), permission `Settings.Manage`.
- Out of office entry endpoints: `/api/v1/users/{id}/absences` (`AbsenceService`); advisory check `POST /users/{id}/absences/check` (WorkViews).

## Where to look when changing it

| Change | Start in |
|---|---|
| A new availability rule | `UserAvailabilityEvaluator` and its unit tests in `backend/tests/MatterFlow.UnitTests` |
| A new holiday rule kind | `HolidayRules.cs`, script for the column, `HolidayCalendarService` |
| Capacity states or slots | `CapacityRules.cs`, `CapacityService.cs`, Users tab in `frontend/src/app/features/dashboard` |
| A new gauge or capacity setting | [How to Add a Setting](../Backend/How-to-Add-a-Setting.md) |

## Related pages

- [Notifications Audit and Settings](Notifications-Audit-and-Settings.md)
- [Dashboard Frontend](../Frontend/Dashboard-Frontend.md)
- [ER Diagrams](../Database/ER-Diagrams.md)

Last verified against commit f45fc1d.
