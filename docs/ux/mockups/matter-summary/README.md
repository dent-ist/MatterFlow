# Matter Summary tab: mockup (WPx, for owner review)

Mockup only. No app code was changed, nothing was built or tested with the project tooling. Open `index.html` in a browser (no server, no network).

## Look at this first

1. Open `index.html`. The top bar has a **Before | Recommended** switch and a **Mockup Toolbox** button. Flip between Before and Recommended at the same window size.
2. In the toolbox choose **Window size** (1920x1080, 1366x768, 1366x600, 768 tablet, 375 phone). Smaller sizes are drawn in a frame and shrunk to fit your screen.
3. Then try the other toggles: custom fields 0 / 4 / 12, activity rows None / Few / Many, Sensitive on/off, AI allowed No / On-prem / Company, Secondary PM Set / None, People names Display name / Raw account only, asset types 0 / 1 / 3 / 6, Total tile, Loading / Error, Viewer can edit.
4. Click Edit and Change to see the pop-up dialogs (mock content, Cancel on the left, Save on the right). Hover or Tab to the Sensitive chip, the dates and the copy button to see the tooltips.

Every toolbox choice is stored in the page address (for example `index.html#mode=before&dn=0&size=1366x768`), so a view can be sent as a link. `tb=0` hides the toolbar (used for the screenshots).

**Before** reproduces today's page from the owner's description (1683x851 screenshot): the 7-tab header, the asset strip, two equal full-height cards, the CM number band, the single Details column, ten activity rows with raw account names. Tip: choose "Raw account only" under People names to see it exactly as in the screenshot (the Before view does not force it).

## What changed against today

| # | Today | Recommended |
| --- | --- | --- |
| 1 | Both cards stretch to the bottom and leave large empty white areas | Cards fit their content, sit at the top, grow up to the available height and then scroll inside. The rest of the area is the page background. The page itself never scrolls on desktop. Below 1000 px wide or 561 px high the page scrolls and the cards become plain (as the app already does below 768 px). |
| 2 | CM number three times (breadcrumb, subtitle, Details); the Details band has the label at the top and the number in the middle | The breadcrumb is `Matters > <matter name>`. In Details the CM number is one compact highlighted line (label, number and copy button on one baseline, 42 px high, no big band). It is the first cell of the left column. The number is still in the subtitle row, so it appears twice, not three times (see question 1). |
| 3 | One tall column with a wide label column; "Primary PM" label sits higher than its value; the Sensitive chip is followed by the words "Restricted access" | Details is about 60% wide. Two columns of fields, each a small muted label above its value, all rows the same height. Left: CM number, Client, Matter number, Matter name, Status. Right: Sensitive, Primary PM, Secondary PM, AI allowed, Created, Last changed. Custom fields continue as equal fields in the free cells and rows below, with no heading. |
| 4 | Status, Sensitive and AI are plain text or chips with extra words | Status, Sensitive and AI allowed use the same chips as the page header. "Restricted access" moved into the Sensitive chip's tooltip (the chip can be reached with Tab; a screen-reader-only caption says "Restricted access"). A matter that is not sensitive shows a muted "No". |
| 5 | Primary PM is a bare account name with a "Change" button that does not line up | Small initials avatar and name. "Change" (or "Add" when there is no PM) is a small text button at the end of the Primary PM row; the row keeps the same height as every other row. Secondary PM shows avatar and name, or a muted "None". |
| 6 | Dates like "Nov 1, 2026, 8:42 PM EST" | My Matters numeric style, `11/01/2026 08:42 PM`; the long form with the time zone is the tooltip. |
| 7 | Recent activity: one line per event, ten times "Yesterday", raw account names, no icons, task names are plain text | About 40% wide, in the Activities tab style: a tinted kind icon (created, completed, in progress, on hold, assigned or reassigned, comment, project manager, asset), the sentence with the task or asset name as a link, and a second line with a small initials avatar, the display name and the date and time (`Today 09:48 AM`, `Yesterday 04:12 PM`, `11/01 08:50 PM`; the full date and time zone in a tooltip). The raw account name is shown (monospace, grey avatar, tooltip "No display name on file") only when the person has no display name. Eight rows, then the list scrolls inside the card; "All Activities" is pinned at the bottom of the card. |
| 8 | Asset strip tiles of different widths | Equal-width tiles (at least 220 px, wrapping), name on the left and count on the right, an optional **Total** tile first (shown only when there are two or more types). Zero assets shows a compact dashed bar "This matter has no assets yet." with a New Asset text button for people who can edit. |
| 9 | The sensitive info line is a grey text line | One compact amber bar under the header, with the lock icon (same words as today). |

Kept from the owner's earlier decisions: only fields the Matter already has plus AI allowed; custom fields as equal fields without a "custom fields" heading; no task counts or task buttons; no Next events panel; one Edit button that opens the pop-up dialog; Title Case buttons ("Edit", "Change", "Add", "All Activities", "Try Again", "New Asset"); theme tokens, the shared chips and the shared button rules (32 px buttons; the text button uses a negative block margin so rows stay uniform).

States covered: loading (skeleton tiles and rows; Details comes from the matter, so it is always there), error (inline message with "Try Again" per panel), no assets, no activity, no custom fields, sensitive on/off, three AI values, secondary PM set/none, viewer without edit permission (no Edit, Change or Add).

## Files

- `index.html`: the clickable mockup (tokens from `docs/ux/tokens.css` inlined unchanged, then the mockup styles and script).
- `screenshots/`: Before and Recommended at 1920x1080, 1366x768, 1366x600 and 375x812 (`before-<size>.png`, `recommended-<size>.png`), plus Recommended with 12 custom fields and 6 asset types, with raw account names and sparse data, loading, error, and a 768 tablet. Made by `screenshots.cjs`.
- `screenshots.cjs`: one light Chromium launch, no test runner. `node docs/ux/mockups/matter-summary/screenshots.cjs`.
- `contrast-check.cjs`: WCAG 1.4.3 text contrast over Before and Recommended, eight data states (including loading, error, the two dialogs) at 1366x768, 1366x600 and 375x812. Result: **0 failures in 48 state/size combinations**. The engine was checked against a deliberately bad colour. Needs a global `playwright`; `node docs/ux/mockups/matter-summary/contrast-check.cjs`.

## Decisions I made (please confirm or overrule)

- Details 6 : Activity 4 (grid `6fr 4fr`). The Details card turns to a single column of fields when the card is narrower than 560 px (phone).
- The CM number highlight is a tinted line in the left column, same info tint as today's band but one row high.
- Two icons per activity row (kind icon on the left, small avatar before the name). A single avatar with a tiny kind badge is the alternative if this looks busy.
- Sentences are composed around the link ("Moved <task> to In Progress", "Put <task> on hold") instead of "what" then the link, because the card is narrow and reads better.
- Dates: Details shows the year always (a matter lives for years); activity rows follow the theme guide helper (`MM/DD hh:mm AM/PM`, no year in the current year, leading zero on the hour, so `Yesterday 04:12 PM`, not `4:12 PM`).
- The small footnote "Latest 8" in the activity card footer says how many events the card holds.
- Short desktop windows (under 700 px high) get tighter spacing so the inner regions keep room.

## Open questions for the owner

1. **CM number twice.** It is now in the subtitle row and in Details. Drop it from the subtitle (and keep it only in Details), or keep both? The subtitle one is visible on every tab.
2. **Date format.** The theme guide helper drops the year for the current year (`11/01 08:42 PM`) and writes `04:12 PM`. Your brief used `11/01/2026 8:42 PM` and `4:12 PM`. I used the full year in Details and the helper style in the feed. OK, or one rule everywhere?
3. **"Today".** The feed shows `Today 09:48 AM` for today. Fine?
4. **Asset events in the feed.** Your brief wants asset names as links. Today's overview feed carries only task and project-manager events. Showing "Added asset ..." needs the overview (or the audit search, as the Activities tab uses) to return asset events plus the ids needed for the task and asset links. Do you want that in this work package, or tasks only for now?
5. **Who assigned.** In the current feed "assigned" and "reassigned" rows have no actor in the sentence. The mockup shows an actor on every row; check that the data really carries it.
6. **Display names.** The demo users have no display name, so today everything shows `KE\kekim`. Is that expected in production (Windows auth usually gives a name), and do you want a gentler fallback such as the user part only (`kekim`)?
7. **Secondary PM.** "Add" appears only on the Primary PM row (as asked); the Change Project Managers dialog edits both. Should a missing Secondary PM also get its own "Add"?
8. **Total tile.** With 6 asset types plus Total the strip wraps to a second row at 1366 px and steals about 50 px from the cards. Show Total only up to a few types, or drop it?
9. **1366x600.** Details shows about five rows before it scrolls. Acceptable, or should the identity fields stay visible and the custom fields collapse?
10. **Not sensitive.** The Sensitive field shows "No". Alternatively hide the row.
11. **Button text "All Activities".** Today it reads "All activities" (sentence case). Title Case follows the button rule; confirm.

## Build estimate (agent-hours)

| Part | Hours |
| --- | --- |
| Summary component: new layout, two-column field grid, CM line, fit-to-content cards with inner scroll, responsive rules | 3.0 |
| Header: breadcrumb change, compact sensitive bar | 0.5 |
| Shared pieces: initials avatar, activity kind icons and rows, tooltip on chips and dates, numeric date helper use | 2.0 |
| Asset strip: equal tiles, Total tile, empty state | 1.0 |
| Loading and error states per panel | 1.0 |
| Unit tests and e2e updates (summary spec, header spec, axe at 1366x768 and 375x812, screenshots) | 3.0 |
| Review fixes, lint, format, theme contrast check | 1.0 |
| **Frontend total** | **about 11.5** |
| Backend and contract, only if asset events and link ids are wanted in the feed (overview endpoint, OpenAPI, nswag client, tests) | 3.0 to 4.0 |

So about 11.5 agent-hours for the visible redesign with today's data, or about 15 to 16 with asset events and links in the feed.
