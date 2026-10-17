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
- **Panel 2, "Backlog at end of day" (stocks, 200 px).** A level at the end of each day (of each week beyond 31 days). Segmented control: `Open and overdue` (default, both stocks of All task types) | `Open` | `Overdue`; with task types compared `Open and overdue` is not offered and turns into `Open` (announced together with panel 1: "Showing Created and Open to compare task types."). A "Hide backlog" / "Show backlog" button in the card header hides the panel; it is remembered per user in this browser and is not in the address.
- Each panel has its own y axis and its own gridlines: top = the smallest of 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10 times a power of ten that holds the peak plus 5 percent (never below 4), whole-number ticks from 0 (about four intervals, on round steps; peak 21 gives 0, 5, 10, 15, 20, 25). Tick labels use the viewer's number format. A stock of 152 therefore cannot flatten the flows.
- **Compare task types** (the control panel) is a list with search, totals that link to the Task Queue, Select all (the 8 highest totals) and Clear; at most 8 types. It is never disabled. Picking the first type while panel 1 shows `Created and completed` switches it to `Created` (the first single measure) and says so in a live region; the list shows the one-line reason "Pick a task type and the chart switches to Created." while the two-line measure is active. Both panels then compare the types (panel 2: Overdue per type). Removing the last type puts the two-line view back.
- **All task types** is hidden automatically while types are compared (it is a different magnitude; its row says "(hidden for scale)"). Ticking it shows it and the choice sticks (`all=1`); the axis always scales to the visible lines only.
- Below 600 px the segmented control becomes a select. The selected segment is bold with a check mark (never colour alone); it is a native radio group, so the arrow keys move through it.

Layout (T1): the plot is measured (`ResizeObserver`) and drawn in real pixels, at least 640 px wide at 1366 and 1000 px at 1920, panels 320 + 200 px tall. From 1000 px the control panel is a column of 300 to 340 px (360 px from 1600 px) and the chart column is sticky below the page header (`top: var(--mf-dash-sticky-top, 0px) + 16px`; the page header package sets the variable), while the task type list scrolls inside its own max-height. Below 1000 px the panel is under the chart and nothing sticks.

Chart behaviour: weekends are shaded and today is a partial day (dotted last segment) in both panels; the tooltip and the live read-out list the value of every visible line of both panels for the hovered or focused day, grouped by panel (left/right arrows, Home, End, Escape); View as table has one column per visible line with a group header per panel and each non-zero count links to the Task Queue (created: created that day; completed, on time, late: completed that day; all with the task type filter `type=` where the line is a task type; overdue: see below). Long periods draw about eight markers per line so the marker shape still tells lines apart. An all-zero panel keeps the 0 to 4 axis and says "Nothing to count in this period."

Titles (#121): the page section heading is "Tasks over time" (hidden outline level 2), each panel has one title ("Created and completed", "Backlog at end of day", level 3) and so has "Compare task types"; the card has no title of its own. The period caption ("Sep 17 to Oct 16") sits on the card's first row beside Hide backlog and View as table.

WP8b additions (#120, #117, #118, #121):

- **Direct labels (T4).** A panel with 4 or fewer lines names each line at its last point ("Created 15", "Open 725"): line-coloured leader, ink text, nudged so labels are at least 12 px apart (`nudgeLabels`), `aria-hidden` duplicates of the read-out. 96 px are reserved at the right of every panel (one x scale) while any panel has labels; with 5 or more lines (type comparison) there are no labels and the margin is 14 px. With more than 14 points per line, markers are drawn at the first and last point and on the hovered or focused day (which also gets a light band); with 14 or fewer every point keeps its marker.
- **Axis (T5).** `xTicks`: daily points label the first day, every Monday and the last day ("Oct 6", month always shown, 12 px, not rotated, 4 px tick marks); a Monday that would touch the label before it or the last day is skipped, the last day is always labelled. Weekly points label week starts, at most 8 labels from 600 px and 4 below, the last always.
- **Weekly points (T7).** Periods over 31 days (90 days, 6 and 12 months, custom up to 366 days) come back with `granularity: week` for every series of both panels: Monday to Sunday buckets dated by their Monday (the first and last may be partial), flows summed, stocks (Open, Overdue) at the end of the week (current week: now). The panels say "per week", the tooltip and the read-out say "Week of Oct 6" ("This week so far" for the dotted last point), the table has a Week column, weekend shading is not drawn, and table links cover the week cut to the period (stocks: the end of the week). A 366-day range has 52 to 54 points (54 when it starts on a Sunday).
- **Phone (T8).** At 480 px and below the card loses its frame so the chart takes all the width the page leaves, each panel is 16:9 and at least 220 px (backlog 180 px), "Compare task types (N)" is a 44 px disclosure button under the chart (collapsed by default; N only when types are checked), the measure control is a select (below 600 px), and a tap on a day opens the tooltip and keeps it until a tap elsewhere or Escape (touch pointers do not close it on lift). The chart is the default, View as table stays one tap away. The app shell keeps its 56 px navigation rail at 375 px, so the chart is 271 px wide there, not 343 px.
- **Notes.** The one-line caveat "Based on each task's creation and closing time; later changes are not replayed." is visible whenever Open is drawn; the rest (Overdue counting, what the links list) is in a "How these are counted" disclosure under the chart.

Extension points: `trend-model.ts` builds `PanelView`s (`buildView`) and the pure helpers (`xTicks`, `nudgeLabels`, `markerIndexes`, `bucketRange`, `rangeQuery`), `trend-chart.ts` draws any number of panels from them (`geo` computed: ticks, bands, lines, end labels in pixels; x labels are drawn under the last drawn panel), `dash-trends-tab.ts` owns the choices (`normalizeChoice` is the single state machine). A new stock measure is a `BacklogMeasure` plus a `MEASURE_INFO`/`MEASURE_STYLES` entry and a column in `valuesOf`.

## Measures

(Overdue and Open are stocks and live in panel 2. Created, Completed, On time and Completed late are flows in panel 1.)

- **Created / Completed**: counted on the local day (the viewer's time zone) the task was created / completed. Totals equal the Created and Completed tiles.
- **Overdue** is a snapshot: for each day, the tasks that at the *end of that day* (for today: now) were created, had a due moment that had passed and were not yet closed (completed or cancelled). A timed due is that instant; a date-only due passes after 23:59:59 on that date in the viewer's zone (as the Task Queue does), so today's value equals the Overdue tile. Tasks without a due date are not counted. Example: how many tasks in the first week of October were not closed after their due date is the Overdue line on those days.
- **Open at end of day** (#120) is the same class of snapshot: for each day, the tasks created on or before the end of that day (for today: now) and not yet Completed or Cancelled by then (closing timestamp = last status change). New, In Progress, On hold and ASAP tasks count. No status replay: a task that is open now counts as open for its whole life since creation. Today's point equals the Open tile and the Task Queue's open count for the same scope; per task type it is the same predicate with the type filter (legend total "Open now"). The day link lists today the open filter, for an earlier day the tasks created by then that are still open (same caveat as Overdue).
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

Default chart measures use the dashboard tokens: Created `#1F4E9C` solid with circles, Completed `#0B5E55` long dashes with squares, Overdue `#B42318` dotted with triangles, Open `#5B2A86` (a deep violet no other dashboard colour uses; no CSS token yet) extra long dashes (14 4) with down triangles, On time `#146C2E` dash-dot with diamonds, Completed late `#8A4B00` dash-dot-dot with crosses. A task type keeps its slot while it stays checked.

## Address, memory and permissions

- Address: `?tab=trends&types=5,7&metric=ontime&all=1` (only what differs from the default is written). `metric` is the panel 1 measure (`created`, `completed`, `ontime`, `late`; absent = Created and completed), `bmetric` the panel 2 measure (`open`, `overdue`, `both`; absent = `both`, Open and overdue), `all=1` / `all=0` an explicit choice for All task types (absent = automatic: shown without types, hidden with types). A link opens the same view for anyone who may see the tab. Ticking boxes replaces the address (Back is not filled with every click). Legacy addresses keep working: `due=overdue` opens the backlog panel (also when the user hid it), `due=ontime` / `due=late` are the flow measures (the first one named wins), `metric=overdue` and `due=overdue` ask for `bmetric=overdue` (with types: Overdue per type in panel 2 and panel 1 shows Created), and the legacy `due` is dropped when the view is written back.
- Memory: the choices are remembered per user in this browser (`localStorage`, every access in try/catch; the tab works without it), and so is the hidden backlog panel. An address with any of these parameters wins over the memory; without them the remembered view is restored and the address is completed. The first version of the stored choice is read too.
- Permission: `Dashboard.View` plus `Dashboard.ViewTrends` (the Trends tab permission). The summary payload no longer carries a `trend`.

## Data

`GET /api/v1/dashboard/trend` (see `docs/architecture.md` section 8.6): one request names the checked task types; every point carries `open` next to the other counts, the legend rows `open` and `openQuery`, the response `granularity` (`day` up to 31 days, else `week`) and `metric=open` computes only that series; the cache key includes the granularity; checking a type that was already read needs no request; `fresh=true` follows the page's Refresh. At 5,000 tasks over 8 task types the median is far below 300 ms.

Open at end of day is computed from one grouped count (tasks created by the first snapshot that are still open, per task type) plus the rows created or closed inside the period, replayed per day in memory: no new index (median about 150 ms at 50,000 tasks over 8 types, `DashboardTrendLargePerformanceTests`), so no SQL script 28.
