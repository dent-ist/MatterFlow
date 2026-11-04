# UI update 2: draft findings (phase 1)

The app is desktop-only (owner decision, 2026-11-05): phone and tablet layouts are out of scope. Checks and screenshots use 1366x768 and 1920x1080 only.

Source: the UI designer's phase 1 review (code counts by grep on non-spec files at f26c324; "old shot" = seen in a 2026-11-01 or 2026-11-03 screenshot that the phase 2 crawl must re-check). Phase 2 replaces this file with `findings.md` built from the real screenshot crawl.

Severity: High / Medium / Low.

| # | Area | Finding | Severity | Reference page |
|---|------|---------|----------|----------------|
| 1 | Button order | Dialogs: Cancel left, primary right. Routed forms put the primary FIRST: project, create task, roles, matter, client, asset, workflow, settings, user drawer. Profile shows "Save changes" then "Discard changes". | High | mf-form-dialog |
| 2 | Capitalisation | "New client" (3x) and "New asset type" beside "New Task", "New Spec", "New Report". "Create Task" (project) vs "Create task" (shell) vs "New Task". Nav "Asset types" beside "Custom Fields". Tabs "Status labels" and "Notes tags" beside "Workflow Steps". Route titles "Access pending", "My profile". | High | |
| 3 | Dialog widths | 26, 30, 32, 34, 36, 40, 48 rem and 720 px. The guide says 416/576/768 px, but the app root is 14 px, so 36 rem is 504 px. | High | |
| 4 | Drawer widths | 30, 32, 34, 36, 37.5 rem and 480 px, with five different headers. | Medium | Dashboard Users person drawer |
| 5 | Control heights | Button and segmented switch 32, dropdown 36 (30 small, overridden to 32 in filter rows), form fields 40, min 28 in 18 places. tokens.css says touch target 24, styles.scss overrides it to 32. | High | |
| 6 | Dates | mfDate ("Oct 12, 2026, 10:23 PM EDT") in 42 files, mfNum/numericDate ("10/26 04:00 PM") in 12 files, one 'd MMM y', ISO dates in messages, native inputs in browser locale. | High | My Matters |
| 7 | Toasts | "Saved." (12 admin pages, with full stop) vs "Role saved" plus detail, "Project X saved", "Production deleted"; "Couldn't" vs "Could not". | Medium | |
| 8 | Loading, empty, error wording | "Loading..." vs "Loading"; "No matches." vs "No match"; "Something went wrong. Try again." (19x) vs "Couldn't load X." (about 25) vs "Could not refresh."; Retry vs Try again vs Reload. | Medium | |
| 9 | Confirm dialogs | 12 different cancel labels (Keep active, Stay, Keep it as it is, Back to draft, Edit, Close...). | Medium | |
| 10 | "New" button placement | Page header, under the tabs at the right (Roles), toolbar, plus the top-bar "Create task". | Medium (old shot) | |
| 11 | Chips and links | About 60 private chip/badge/tag/pill class families beside the shared ones, and 17 private link classes (.lnk x10, .link x7). The global rule only colours a:not([class]). | High | |
| 12 | Native select | Used in toolbars: Swimlane, Dashboard trend measure, My Matters data period and size, Notes, Asset reports, Reports run log. | Medium | |
| 13 | Hand-built dialogs | At least 12 hand-built p-dialog bypass mf-form-dialog (Edit task, Add event, Set out of office, assign, bulk, absence, availability, matter managers, priority, holiday, calendar, import). | High | mf-form-dialog |
| 14 | Page header | My Matters and Dashboard draw their own h1; the Dashboard has a blue 32 px icon tile and other pages a plain glyph; fixed pages use a 19 px title where the contract says 22; Profile has no header anatomy. | High | Dashboard |
| 15 | Cards | 12 px radius on 54 uses (grid frame, dashboard), 8 px on 83 (Profile, tiles); borders differ. | Medium | |
| 16 | Off-scale values | Radius 2, 3 (18x), 5, 7, 9, 10 px; fonts 10, 11, 11.5, 12.5, 13.5, 15, 17, 19, 26 px (about 60 places); weights 500 and 800. | Low | |
| 17 | Naming | Same fact, four names: Updated, Last changed, Modified, Last updated. "Matter number" vs "Matter Number"; "Workflow progress" and "Project manager" still in code after the decided renames. | Medium | |
| 18 | Row actions | Outlined "..." square on every row (Matters, Labels), a chevron (Roles), a text link "Assign to me", a quiet hover icon (Users). | Medium | Users |
| 19 | Grid row heights | 44/36/40/48/32 across grids; numeric alignment and pager differ outside the work lists. | Medium (crawl to confirm) | |
| 20 | Tab strips | Heights 2.75 rem vs 2.5 rem; description above the strip on Labels, below it on Roles. | Medium | |
| 21 | Segmented switch | Calendar Month/Week looked outlined in a 2026-11-03 shot while the guide says solid fill; Users switches have a fixed width. | Medium (re-check) | |
| 22 | Icons | Three registries (nav, section, tab) plus custom Tabler-style state icons; the Dashboard tile and the Summary tab both use pi-home; about 60 icon font-size literals remain in feature styles. | Medium | |
| 23 | Dropdown trigger | Heights and radius differ (dropdown 8 px, buttons and inputs 4 px). | Medium | |
| 24 | Truncation at 1366 | "Search by na", "Sorted by Availability an...". | Medium (old shot) | |
| 25 | Form layout | No shared required mark (asterisk, "(required)" or nothing). | Medium (crawl) | |
| 26 | Focus and hover | Global ring is shared, but 6 files override it; hover tints differ. | Low | |
| 27 | Uppercase | 33 uppercase rules in 27 files (tile captions, group headings, weekdays). | Low | |
| 28 | Number formats | Not consistent (to measure in the crawl). | Low | |
| 29 | 403, 404, error, access-pending | Each draws its own card. | Low | |

(The earlier finding 30, phone layouts, was dropped: the app is desktop-only.)

## The ten biggest

1 (button order), 2 (capitalisation), 6 (dates), 11 (private chips and links), 5 (control heights), 3 and 13 (dialogs), 4 (drawers), 14 (page header), 7/8/9 (toast, empty, error and confirm wording), 15 (card radius).

## Decisions recorded in ui-spec.md section 0.3 that the owner may care about

- D-02: every control is 36 px (buttons 32 to 36, form fields 40 to 36), 32 px dense in grid cells. Touches guide section 9. Fallback: everything 32.
- D-20: one capitalisation rule: "click it or name it is Title Case, read it is sentence case" (nav "Asset Types", chips "Out of Office" and "Off Hours", buttons "Clear Filters", tabs "Status Labels").
- D-30: routed page forms get the dialog order (Cancel, then primary last); Delete far left.
- D-32 and D-33: dialogs 416/576/768 px, drawers 520 px (720 wide), in px.
- D-60: one date format, the My Matters style (MM/DD hh:mm AM/PM, year when not this year); the long form only in tooltips and sentences.
- D-21: every page gets the Dashboard 32 px solid-blue icon tile, H1 22 px / 700.
- D-10: all cards 12 px radius. D-17: Dashboard Summary tab gets its own icon. D-13: links always underlined, no private link classes.
- D-00: epics grouped (15 page-group epics plus shared plus top) instead of one per page or tab; the Dashboard may split further in phase 2.
