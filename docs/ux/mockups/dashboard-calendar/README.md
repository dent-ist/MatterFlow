# Dashboard > Calendar mockup (WPx CAL-00)

Mockup and feasibility only, no app code. Open `index.html` by double-clicking (self-contained, tokens inlined from `docs/ux/tokens.css`). Data, permissions, migration, performance and privacy are in `feasibility.md`. Screenshots are in `screenshots/` (main states at 1366x768, 1920x1080, 1366x600, 768x1024 and 375x812; other states at 1366x768 and 375x812). Check script: `node docs/ux/mockups/dashboard-calendar/shots.js check` (global `playwright`): 200 state and size combinations, 0 contrast failures (4.5:1, 3:1 large text, the pattern of the Dashboard v4 script), 0 console errors, 0 fit failures (the page never scrolls on a window of 768 x 561 or more). `shots.js shots` rewrites the screenshots.

Deep links: `index.html#screen=calendar|profile|admin&role=director|pod|tech&view=month|week|timeline&day=2026-11-25&pod=qc&scale=day|week&state=loading|error|empty&off=thr,banner,fcst,risk,ovl,exp&without=Dashboard.ViewAbsenceReasons&with=Dashboard.ViewCalendar&pop=risk&dlg=add|edit|thr|warn|reassign|hol|import|cal|user&mock=1`.

## Look first
1. Open it. You are the Director on **Dashboard > Calendar** (new tab, calendar icon, after Users), November 2026, "today" is Tue 11/03/2026 10:42 AM. Each day shows `31/36` (available out of everyone in view), how many are out, a holiday label and a traffic-light colour with an icon and a word.
2. Click a day (try **11/25**, a Watch day: 10 out, Review and Processing under their minimum). The right panel lists who is unavailable and why, who is available, by pod, with the week strip and **Tasks at risk** (press **Reassign**).
3. Switch **Month | Week | Timeline** (Timeline: 36 people grouped by pod, bars by type, holidays hatched per person, a coverage row on top; click a bar to edit). Try the **Weeks** scale and go to June to September 2027.
4. **Mockup** (top right): View as Director / Pod Lead / Technician with the permissions as tick boxes, data states, the manager features as toggles, thresholds. Then open **Profile** (avatar) and **Admin > Settings > Holidays** from the same toolbox.

## How I read the request
- **A resource planner, not a task calendar.** The tab answers "who can work on day X, and are we thin?". Task due dates are never drawn. The only task information is the risk list in the day panel (tasks whose owner is out on the due date), because that is the one place where absences hurt work.
- **Number of tech ops on the day = the workers.** Same definition as the Dashboard battery (decision AS): holds `Workflow.Execute` and is an active member of a pod. The Director and the Project Managers are not counted. 36 people in 5 pods in the mock.
- **1. Multiple Out of office entries on the profile**: a list of entries (type, start, inclusive end, optional note), grouped Now / Upcoming / Past, create and edit in a pop-up dialog. Types: Vacation, Sick, Training, Conference, Other (the owner named only "vacation"; the others are what a manager needs to tell a plan from an emergency).
- **2. Holidays by Category in Admin settings.** I model a **holiday calendar** per category (US Holiday, UK Holiday, Firm closure ...), each with named dates. A person has **one** calendar (field on the user, default from the pod, then the firm default); calendars flagged "applies to everyone" (firm closure) are added on top.
- **3. Manager analysis**: right panel with the day, Available / Unavailable lists, counts, by-pod coverage, week strip.
- **4. Pod filter** (All pods / My pods / one pod) plus a Role filter.
- **5. Recommendations**: section "Feature recommendations" below; the top five are built behind toggles.

## What is on screen (A to F of the brief)
| | Where in the mockup |
|---|---|
| A Month, toolbar, legend, panel | Calendar tab: Previous / Today / Next like My Matters (Sunday first, arrow keys inside the grid exactly as My Matters; no new shortcut), Pod and Role dropdowns, view switch, legend. Day cell: number, `available/total`, `n out`, coverage icon and word (Watch, Low, Critical; Good has the icon), one holiday chip with category colour, flag icon and name, `+n more`. Weekends muted, today a filled circle, selected day outlined. |
| B Timeline | Rows grouped and collapsible by pod (each group has its own coverage numbers), Days (a month) or Weeks (26 weeks) scale, coverage row on top, absence bars coloured by type with glyph and word, holidays as hatched columns per person (a UK colleague is not shaded on Thanksgiving), part-time non-working days shaded, today line, "Find a person". A bar opens the edit dialog for people with the manager permission, otherwise it selects the day. |
| C Week | Pods by days matrix with `available/people`, coverage colour, and who is out as initials with the type glyph. |
| D Profile > Out of office | List of several entries, "Add out of office" pop-up (Cancel left, primary right), edit, delete with a small confirmation, **I'm back** on a current entry, past entries read-only, overlap and past-date validation, working-day count, the person's holiday calendar and next holidays on the side. |
| E Admin > Settings > Holidays | Calendars list (colour, number of holidays, people), the holidays of the chosen calendar with the date in the chosen year, the rule, region note and "counts as", **2026 / 2027 (preview)** switch, Add holiday and Edit (rule types: fixed date, weekday of a month, days from Easter, one time, ranges), **Import / paste list** with a line-by-line check, New calendar (name, region note, colour from the tag palette, applies to everyone), firm default and pod defaults, the "Holiday calendar" field on a user (preview dialog), and the table "where a holiday counts as a non-working day". |
| F Manager features | Toggles in the toolbox; see the ranking. |
| States | Loading skeleton, error with Retry, empty ("No people to plan yet"), no match with Clear filters, no access (Technician), no permission for reasons, Admin without `Settings.Manage`. |
| Phone (under 768) | Compact month (day number, count, icon), the selected day as a card below with "Who is in and out", the panel becomes a bottom sheet, forecast folds into a disclosure, Export and Thresholds are hidden, dialogs go full screen. At 768 to 1023 the panel is a slide-over. |

## Decisions
1. **Holiday wins over Out of office.** A person on a holiday with an entry is counted once, as "On holiday". Weekends and a part-timer's non-working weekday are never "out".
2. **Coverage % = available / people expected to work** (everyone in view minus those on holiday or on a non-working day). The cell still prints `available/total` as asked. On Thanksgiving a US firm shows `6/36` and the Good colour, because the 6 UK colleagues who are expected all work. A holiday never creates a risk day by itself. Open question 8 offers a "Total" alternative.
3. **Colour.** The capacity tokens (`--mf-cap-0..3`) are a blue load scale (light = free) and cannot say good or bad. So the coverage ramp is a traffic light built only from existing semantic tokens: Good = teal (healthy), Watch = amber (risk), Low = deep orange (critical), Critical = red (overdue); weekend and closed = slate. Proposed alias tokens `--mf-cov-good|watch|low|crit-{bg,fg,solid}` (inlined at the top of the mockup). The capacity blues are used only for the small availability chip in the panel (Available / Occupied / Busy / Overloaded, the Dashboard words). Colour is never alone: icon (check, triangle, exclamation, ban) and word.
4. **Absence type colours**: Vacation blue, Sick orange, Training teal, Conference violet, Other slate, each with a glyph and the word on bars wide enough; without the reasons permission every bar is slate "Out" (so type cannot be guessed from colour).
5. **Holiday category colours** use the existing note-tag palette (indigo, rose, green, ...) the admin picks from, always with a flag icon and the name. They differ from the absence hues on purpose.
6. **Selected day, panel, close.** The panel is a read-only side panel (theme guide section 6: panels are for detail, creating and editing are pop-up dialogs). On desktop it is open by default in Month and Week and closed in Timeline (the grid needs the width), reopened by clicking a day.
7. **Dates.** Calendar days are floating days: `MM/DD`, and `MM/DD/YYYY` for another year (My Matters rule, guide section 8). "Updated 10:42 AM" follows the `hh:mm AM/PM` rule. Headings and month titles stay words.
8. **Entry rules** (profile and dialog): end date is the last day out (included); end not before start; no overlap with another own entry (message names the other entry); start in the past is refused, except **Sick** (up to 14 days back) and managers entering for someone else; past entries are history (read-only); an entry that started can still be shortened with **I'm back**. A note is optional, 200 characters.
9. **No approval workflow now** (not asked). An entry is a plan the manager sees at once. The overlap warning tells the person if a pod falls below its minimum, without blocking.
10. **Who edits whose.** Self always. A manager on behalf of others with a new permission `User.ManageAvailability`, limited to the pods they lead (Director: all). Today the API needs `User.Manage` (full user administration) which a Pod Lead does not have. In the mockup: "Add out of office" in the Calendar toolbar (with a Person field) and a click on a timeline bar.
11. **Technician: no Calendar tab** (recommended). They see the "not available" note on a deep link and manage their own entries on the profile. Option if the owner wants transparency: grant `Dashboard.ViewCalendar` without `ViewAbsenceReasons`: they would see counts, names and a neutral "Out of office" (toolbox: View as Technician, tick `Dashboard.ViewCalendar`). I do not recommend it for 30 to 40 people in a law firm without a reason from the owner.
12. **Privacy.** Type and note need `Dashboard.ViewAbsenceReasons`; the server must leave them out of the answer (not only hide them), see `feasibility.md`. The note field warns that nobody should type medical details.
13. **Pod Lead scope.** Own pods only (like v4: My pods, Review, QC); the Director can pick any pod.

## Roles and permissions (proposed)
| Permission | New? | Director | Pod Lead | Technician | Needed for |
|---|---|---|---|---|---|
| `Dashboard.View` | existing | yes | yes | yes | opening the Dashboard |
| `Dashboard.ViewCalendar` | **new** | yes | yes (own pods) | no | the Calendar tab and its data |
| `Dashboard.ViewAbsenceReasons` | **new** | yes | yes (own pods) | no | type and note of an absence |
| `User.ManageAvailability` | **new** | yes | yes (members of own pods) | no | entering, editing, deleting absences of others |
| `Task.Assign` | existing | yes | yes | no | Reassign in Tasks at risk |
| `Settings.Manage` | existing | System Admin only (ticked in the mock to show the screen) | no | no | holidays, calendars, thresholds |
Everything about one's own entries needs only `Task.View`, as availability today. Existing permissions are **not** enough for the Calendar (no tab permission fits, `Dashboard.ViewUsers` is the people list with live states) and not for entering absences for others (`User.Manage` is too broad). Holidays and thresholds fit `Settings.Manage` (rename its description to "application settings").

## Feature recommendations, ranked (value to the manager first, cost second)
Cost in agent-hours on top of the base tab (frontend and backend together). **R1** = recommended for release 1; the first five are built behind toggles in the toolbox.
| # | Feature | Value | Cost | Release |
|---|---|---|---|---|
| 1 | **Coverage thresholds** (minimum % and minimum people per pod colour the days, name the pod) | Very high: turns a grid of numbers into a decision | 3.0 | **R1** |
| 2 | **Risk banner, next 30 days** with "Show risk days" | Very high, it is the first thing a manager needs on Monday | 1.5 | **R1** |
| 3 | **Overlap warning** in the entry dialog (pod would drop below its minimum, days named, never blocks) | High, avoids the problem at the source | 1.5 | **R1** |
| 4 | **Tasks at risk** in the day panel (not a due-date calendar) | High, links absence to real work | 3.0 | **R1** |
| 5 | **Reassign before leave + who covers** (same picker as the Dashboard grid; suggestions are free that day, same pod first, lightest load first) | High | 3.0 | **R1** (with 4) |
| 6 | **Free capacity forecast, 4 weeks** (battery formula: free slots over slots of people who are in; counts all open tasks of the scope, also those of absent people, because they still need an owner) | Medium to high | 2.5 | **R1**, small tile row; first to drop if budget is tight |
| 7 | Per pod and per role filters | High, cheap | 0.5 (role) | **R1** (pod is in the base) |
| 8 | Export CSV (and Excel), then ICS feed | Medium | CSV 1.5, ICS 3.0 | R2 (CSV can join R1) |
| 9 | Notifications: upcoming absences digest, coverage alert (uses the Notifications module) | Medium | 4.0 | R2 |
| 10 | Half days (morning or afternoon) | Medium for a law firm, hard to retrofit | 4.0 (two flags on the entry, evaluator, display) | R2 |
| 11 | Overlay of several regions' holidays | Covered: the calendar shows the holidays of every person in view | 0 | R1 (included) |
| 12 | Skill filter and better "who covers" | Medium | needs skills data (not in the product) | later |
| 13 | Working hours by time zone (a UK colleague's day starts earlier) | Low now | 3.0 | later |
| 14 | Request and approval workflow | Not requested; adds states, inbox, notifications, a second source of truth | 12 to 14 | **not now**; revisit if the firm wants approval |
| 15 | Personal calendar sync (Outlook) | Medium | 8+ | later |

## Open questions, with my recommended answer
1. **Who sees the calendar?** Recommend Director and Pod Lead (own pods); Technician no. Technician transparency is a one-permission change later.
2. **Who sees reasons and notes?** Recommend `Dashboard.ViewAbsenceReasons` for Director and Pod Lead only; notes visible to the owner of the entry and to managers who may edit it.
3. **Who edits others?** Recommend the new `User.ManageAvailability` limited to led pods.
4. **Past dates?** Recommend as drawn: not allowed, except Sick (14 days back) and managers.
5. **Open-ended "until I'm back"?** Recommend yes for the quick action in the header menu (today's behaviour), drawn on the calendar as a bar to the end of the window with an arrow; the profile dialog requires an end date.
6. **One holiday calendar per person?** Recommend yes, plus "applies to everyone" calendars for firm closures.
7. **What does a holiday do to capacity logic?** Recommend: Off hours (soft) for that day, never Out of office; assignment stays possible (section "Where a holiday counts" in the Admin screen).
8. **Cell number: out of everyone or out of those expected?** Drawn as asked (everyone). Recommend keeping it and colouring by expected. Alternative: print `6/6` on Thanksgiving.
9. **Week starts Sunday or Monday?** Drawn Sunday first to match My Matters. Recommend a later firm setting.
10. **Where are the thresholds set?** Recommend Admin > Settings > Dashboard (`Settings.Manage`) with defaults: 75 % and a pod minimum of 60 % of the pod rounded up until set. The mockup edits them in a dialog from the toolbar for demonstration.
11. **A person in two pods?** Recommend: counted once in "All pods" (primary pod for the minimum), and in each pod when that pod is filtered.
12. **Retention of past entries** (personal data)? Recommend keep 24 months, then delete; HR or the owner decides.
13. **Approval workflow?** Recommend not now (decision 9).
14. **Half days in release 1?** Recommend R2 but design the entry table with room for it (feasibility.md).
15. **Sick entered by a manager?** Allowed with the manager permission; the audit log records who entered it.

## Estimate (agent-hours, one agent, including tests)
| Part | Minimum (owner items 1 to 4: entries, holidays, month tab with panel, pod filter) | Recommended release 1 |
|---|---|---|
| SQL scripts: absences table with copy of the existing single value, holiday tables, user and pod calendar columns, permissions and role grants | 3.0 | 3.0 |
| Backend Identity: absence CRUD, validation (overlap, past, range), on-behalf permission, audit events | 4.5 | 5.0 |
| Evaluator: several periods plus holiday as non-working day, `IUserAvailabilityReader` and its five consumers (battery, People list, workload, My Matters, matter overview), users list filter | 6.0 | 6.0 |
| Holiday service and Admin API: calendars, rule expansion (fixed, weekday, Easter, observed day), import, per-user and per-pod calendar | 5.5 | 6.0 |
| Calendar read API: per-day counts, per-person ranges, panel lists, reason gating, pod scope | 4.0 | 5.0 |
| Tasks at risk and who covers (endpoint over existing data) | | 3.0 |
| Frontend Calendar tab: month, toolbar, legend, panel, phone, states | 9.0 | 9.0 |
| Week and Timeline | | 7.0 |
| Profile out of office list and dialog (split from the 861-line availability form), header menu adaptation | 5.0 | 5.0 |
| Admin Holidays screen, dialogs, import, user field | 6.5 | 7.0 |
| Manager features 1 to 3 and 6 (thresholds with settings store, risk banner, overlap warning, forecast) and 4 to 5 UI (risk list, reassign) | | 7.5 |
| OpenAPI, nswag, permission catalogue, starter roles | 2.0 | 2.5 |
| Tests: unit (evaluator, holiday rules), integration, e2e, axe at four sizes, contrast | 6.0 | 9.0 |
| **Total** | **51.5** | **about 76** |
Release 2 (export, notifications, half days): about 11 more. The mockup itself took about 7 agent-hours.

## Notes on the mockup data
36 workers in Review (10), Processing (8), Production (6), QC (6), Data Science (6); 6 of them on the UK calendar, 2 part-time (Friday off). Absences run from September 2026 to October 2027 (3 to 6 per person: vacations weighted to Thanksgiving, December and July and August, training, conferences, sick days in the past, a few single-day "Other"), US, UK and Firm closure holidays worked out from rules for 2026 and 2027 (including observed days: July 3 2026, December 28 2026, December 27 and 28 2027). Navigation stops at September 2026 and October 2027. Hand-made situations: today 5 out; a Data Science conference 11/17 to 11/19 (below minimum); Thanksgiving week 11/23 to 11/25 (Review and Processing below minimum on 11/25). The Director profile (Dana Whitfield) is not a worker, so she never appears in the counts.
