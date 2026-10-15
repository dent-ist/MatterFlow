# Dashboard > Trends: task types, Overdue, On time and Completed late

Screenshots in `screenshots/` are from the production build against the real API and database (docker SQL Server), 10 task types and about 150 tasks whose created, completed and due dates were spread over the last 28 days (`frontend/e2e/tests/dashboard-trends-types-screens.spec.ts`). Widths 1366x768 (`-1366`) and 375x812 (`-375`).

| Shot | Shows |
| --- | --- |
| `01-all-only` | Initial view, identical to the chart before this change: All task types with Created and Completed |
| `02-three-types` | Three task types checked: All task types plus one line each, Show: Created |
| `03-tooltip` | Keyboard focus on the chart: the tooltip lists every visible line for the day |
| `04-eight-types` | Eight task types (the maximum) plus All |
| `05-limit-message` | A ninth type refused: "Pick up to 8 task types to keep the chart readable" |
| `06-table-8-types` | View as table: one column per visible line |
| `07-three-types-overdue` | Show: Overdue for three task types |
| `08-table-3-types-overdue` | The same as a table |
| `09-due-dates` | Default chart with the Due dates group: Overdue, On time and Completed late of All task types |

## Design

The chart has one panel next to it (below it on screens under 1000 px). The panel is the legend and the control, so what you tick is what you see:

- **Due dates** (three checkboxes, always visible above the long list): *Overdue*, *On time*, *Completed late*. They add lines of All task types to the default chart. Help text: "Uses each task's current due date. Tasks without a due date (ASAP) are not counted."
- **Task types**: the *All task types* line (checked by default, can be hidden) and one checkbox per task type, sorted by the total of the measure shown (largest first, then by name). Each row has the task type icon, its name, a sample of its line (colour, dash and marker, shown while it is checked) and the total, which links to the Task Queue filtered by that task type. Types without tasks in the period are listed but muted; inactive types that still have tasks are marked "(inactive)". A search box appears above 8 types. *Select all* checks the 8 types with the highest totals (and says so when there are more); *Clear* unchecks the types. At most 8 type lines at once; the All line does not count.
- **Show: Created | Completed | Overdue | On time | Completed late** applies to All task types and every checked type.

Two modes, chosen by whether any task type is checked (the simplest clear rule):

1. No task type checked (default): the chart is today's two-line chart (Created and Completed of All task types) plus any ticked Due dates lines. *Show* is disabled with the hint "Created and completed are both shown until you select a task type".
2. One or more task types checked: a single measure (the *Show* choice) for All task types and for each checked type. The Due dates checkboxes are disabled with an explanation; use *Show* to compare Overdue or On time by task type.

The chart: the y axis scales to the highest visible line; weekends are shaded; today is a partial day (dotted last segment); the tooltip and the live read-out list the value of every visible line for the hovered or focused day (left/right arrows, Home, End, Escape); View as table has a column per visible line and each non-zero day count links to the Task Queue (created: created that day; completed, on time, late: completed that day; all with the task type filter `type=` where the line is a task type; overdue: see below). Long periods draw about eight markers per line so the marker shape still tells lines apart.

## Measures

- **Created / Completed**: counted on the local day (the viewer's time zone) the task was created / completed. Totals equal the Created and Completed tiles.
- **Overdue** is a snapshot: for each day, the tasks that at the *end of that day* (for today: now) were created, had a due moment that had passed and were not yet closed (completed or cancelled). A timed due is that instant; a date-only due passes after 23:59:59 on that date in the viewer's zone (as the Task Queue does), so today's value equals the Overdue tile. Tasks without a due date are not counted. Example: how many tasks in the first week of October were not closed after their due date is the Overdue line on those days.
- **On time / Completed late**: tasks with a due date completed that day on or before / after their due moment.

Approximations, accepted by the product owner: the status history is not replayed (a task that is open now counts as open for its whole life, so a reopened task is counted overdue for the days it was actually closed) and the **current due date** is used for every day (editing a due date changes the past). The Overdue day link cannot reproduce a past snapshot: for today it opens the queue's overdue filter; for an earlier day it lists the tasks that are *still open* and were due by that day. The On time and Completed late links list every task completed that day. The chart says so under it.

## Colour, dash and marker (never colour alone)

Colours are Okabe-Ito / Tol hues darkened until each reaches at least 3:1 on the white card and on the weekend shade (WCAG 1.4.11). Every line also has its own dash pattern and marker shape, and the legend shows the same sample. Checked by `trend-palette.spec.ts` (contrast, unique dash and marker per chart, minimum distance in Lab and under simulated protanopia and deuteranopia).

| Slot | Colour | Contrast on white | Dash | Marker |
| --- | --- | --- | --- | --- |
| All task types | `#1B1F27` ink | 16.5 | solid | circle |
| 1 | `#0072B2` blue | 5.2 | long dash | square |
| 2 | `#C2410C` vermilion | 5.2 | dots | triangle |
| 3 | `#00795A` green | 5.4 | dash-dot | diamond |
| 4 | `#B0306F` magenta | 6.0 | short dash | inverted triangle |
| 5 | `#8A6A00` olive | 5.1 | extra long dash | cross |
| 6 | `#6B3FA0` violet | 7.4 | fine dots | plus |
| 7 | `#2F8FBF` sky | 3.6 | dash-dot-dot | ring |
| 8 | `#6B7280` grey | 4.8 | dash-dash-dot | outlined square |

Default chart measures use the dashboard tokens: Created `#1F4E9C` solid with circles, Completed `#0B5E55` long dashes with squares, Overdue `#B42318` dotted with triangles, On time `#146C2E` dash-dot with diamonds, Completed late `#8A4B00` dash-dot-dot with crosses. A task type keeps its slot while it stays checked.

## Address, memory and permissions

- Address: `?tab=trends&types=5,7&metric=overdue&all=0&due=overdue,ontime` (only what differs from the default is written). A link opens the same view for anyone who may see the tab. Ticking boxes replaces the address (Back is not filled with every click).
- Memory: the choices are remembered per user in this browser (`localStorage`, every access in try/catch; the tab works without it). An address with any of these parameters wins over the memory; without them the remembered view is restored and the address is completed.
- Permission: `Dashboard.ViewDepartment` (the permission of the summary's trend), unchanged by this work.

## Data

`GET /api/v1/dashboard/trend` (see `docs/architecture.md` section 8.6): one request names the checked task types; the legend totals come with it; checking a type that was already read needs no request; `fresh=true` follows the page's Refresh. At 5,000 tasks over 8 task types the median is far below 300 ms.
