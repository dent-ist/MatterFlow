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

Updated 2026-10-16 by the Dashboard review 2 (#114, #115, #116, #119). The screenshots in `screenshots/` show the earlier design (Show radios, Due dates checkboxes, one chart); the current screens are in `docs/ux/dashboard-review-2/fixes/wp8a/`.

The Trends card has two stacked **panels** that share one x scale and one cursor, and a **control panel** next to them (under them below 1000 px):

- **Panel 1, "Created and completed" (flows, 320 px).** Events of a day. Segmented control above it: `Created and completed` (default: Created and Completed of All task types) | `Created` | `Completed` | `On time` | `Completed late`.
- **Panel 2, "Backlog at end of day" (stocks, 200 px).** A level at the end of each day. Today it has one measure, `Overdue` (a name, not a control). `Open` and `Open and overdue` are added by #120 (WP8b); the model has one place for them (`BACKLOG_MEASURES` in `trend-model.ts`). A "Hide backlog" / "Show backlog" button in the card header hides the panel; it is remembered per user in this browser and is not in the address.
- Each panel has its own y axis and its own gridlines: top = the smallest of 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10 times a power of ten that holds the peak plus 5 percent (never below 4), whole-number ticks from 0 (about four intervals, on round steps; peak 21 gives 0, 5, 10, 15, 20, 25). Tick labels use the viewer's number format. A stock of 152 therefore cannot flatten the flows.
- **Compare task types** (the control panel) is a list with search, totals that link to the Task Queue, Select all (the 8 highest totals) and Clear; at most 8 types. It is never disabled. Picking the first type while panel 1 shows `Created and completed` switches it to `Created` (the first single measure) and says so in a live region; the list shows the one-line reason "Pick a task type and the chart switches to Created." while the two-line measure is active. Both panels then compare the types (panel 2: Overdue per type). Removing the last type puts the two-line view back.
- **All task types** is hidden automatically while types are compared (it is a different magnitude; its row says "(hidden for scale)"). Ticking it shows it and the choice sticks (`all=1`); the axis always scales to the visible lines only.
- Below 600 px the segmented control becomes a select. The selected segment is bold with a check mark (never colour alone); it is a native radio group, so the arrow keys move through it.

Layout (T1): the plot is measured (`ResizeObserver`) and drawn in real pixels, at least 640 px wide at 1366 and 1000 px at 1920, panels 320 + 200 px tall. From 1000 px the control panel is a column of 300 to 340 px (360 px from 1600 px) and the chart column is sticky below the page header (`top: var(--mf-dash-sticky-top, 0px) + 16px`; the page header package sets the variable), while the task type list scrolls inside its own max-height. Below 1000 px the panel is under the chart and nothing sticks.

Chart behaviour: weekends are shaded and today is a partial day (dotted last segment) in both panels; the tooltip and the live read-out list the value of every visible line of both panels for the hovered or focused day, grouped by panel (left/right arrows, Home, End, Escape); View as table has one column per visible line with a group header per panel and each non-zero count links to the Task Queue (created: created that day; completed, on time, late: completed that day; all with the task type filter `type=` where the line is a task type; overdue: see below). Long periods draw about eight markers per line so the marker shape still tells lines apart. An all-zero panel keeps the 0 to 4 axis and says "Nothing to count in this period."

Extension points for the backlog series and direct labels (WP8b, #120, #117, #118, #121): `trend-model.ts` builds `PanelView`s (`buildView`), `trend-chart.ts` draws any number of panels from them (`geo` computed: ticks, bands, lines in pixels; x labels are drawn under the last drawn panel), `dash-trends-tab.ts` owns the choices (`normalizeChoice` is the single state machine). A new stock measure is a `BacklogMeasure` plus a `MEASURE_INFO`/`MEASURE_STYLES` entry and a column in `valuesOf`.

## Measures

(Overdue is a stock and lives in panel 2. Created, Completed, On time and Completed late are flows in panel 1.)

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

- Address: `?tab=trends&types=5,7&metric=ontime&all=1` (only what differs from the default is written). `metric` is the panel 1 measure (`created`, `completed`, `ontime`, `late`; absent = Created and completed), `bmetric` the panel 2 measure (`overdue`; absent = the default, WP8b adds `open`), `all=1` / `all=0` an explicit choice for All task types (absent = automatic: shown without types, hidden with types). A link opens the same view for anyone who may see the tab. Ticking boxes replaces the address (Back is not filled with every click). Legacy addresses keep working: `due=overdue` opens the backlog panel (also when the user hid it), `due=ontime` / `due=late` are the flow measures (the first one named wins), `metric=overdue` with types compares Overdue per type in panel 2 and panel 1 shows Created, and the legacy `due` is dropped when the view is written back.
- Memory: the choices are remembered per user in this browser (`localStorage`, every access in try/catch; the tab works without it), and so is the hidden backlog panel. An address with any of these parameters wins over the memory; without them the remembered view is restored and the address is completed. The first version of the stored choice is read too.
- Permission: `Dashboard.View` plus `Dashboard.ViewTrends` (the Trends tab permission). The summary payload no longer carries a `trend`.

## Data

`GET /api/v1/dashboard/trend` (see `docs/architecture.md` section 8.6): one request names the checked task types; the legend totals come with it; checking a type that was already read needs no request; `fresh=true` follows the page's Refresh. At 5,000 tasks over 8 task types the median is far below 300 ms.
