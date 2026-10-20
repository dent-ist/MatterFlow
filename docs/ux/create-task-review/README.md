# Create task: independent UX review (with the email-first, task-type tiles and reorderable-tiles designs)

Scope: the **Create task flow end to end** as a user sees it: `/tasks/new`, `/tasks/new?matterId=&projectId=&taskType=`, every entry point (header button, Matter and Project pages, the matter/project task grids, Dashboard, My Work and Task Queue empty states), choosing the task type, the form after the type is chosen (sections Task / Input / Priority, due date and assignment, shipped in #349), the matter picker and project choice, the existing email pieces ("Quick fill from email"), workflow choice, validation and server errors, what happens after Create, and the edge cases (20, 60 and 140 task types, a 44-field form, long names, phone to 1920, keyboard, axe, permission variants, performance). Reviewed on `origin/dev` at `36825dc` (production Angular build, published API with Dev auth, SQL Server 2022, Playwright Chromium). **No application code was changed and no GitHub issues were created.** The App shell epic (#585) owns the header "Create task" button and the toasts; the Search epic (#421) owns global search: where a recommendation touches them it says so.

Evidence: `screenshots/` (65 PNGs, `<name>-<width>x<height>.png`, 1366x768 unless the name says otherwise; 1920x1080, 768x1024 and 375x812 where it matters), `mocks/` (17 high-fidelity HTML mocks with PNGs, plus the two generators `build-ef.mjs` and `build-tiles.mjs`, so a team can edit and re-render them), `seed/` (the extra-data seeder used here). Every number below (positions, tile counts, Tab stops, timings, axe) was measured in the browser on the data in section 8.

Severity: **blocker / major** (a user loses time or cannot do the task at some width or role), **minor** (friction, inconsistency), **nit**. Effort is in AI-agent hours (implementation, unit tests and the e2e update, not review time). Findings are numbered `CT-n`; bugs are separate (`BUG-n`, section 7).

---

## 0. Flow inventory

| # | Screen / state | How you get there | Notes |
|---|---|---|---|
| 1 | Create task, type chooser (tiles) | `/tasks/new` | Intake panel (collapsed) + search (more than 12 types) + 3-column cards |
| 2 | Create task, form after a type is chosen | click a tile, or `?taskType=<id>` | Summary strip, type chip, Task / Input / Priority-due-assignment |
| 3 | Same, with the "Priority, due date and assignment" section open | click the section header | Opens by itself when it holds an error |
| 4 | Quick fill from email: panel open (drop zone, paste box, file picker) | "Fill from email" | Remembered per browser in `localStorage` |
| 5 | Quick fill: reading / error / review panel / done | after a file, paste or drop | Review panel repeats Title, Description, Requestor with Keep/Replace boxes |
| 6 | Matter picker (typeahead) | Matter field | 8 results, no client name, no "more" |
| 7 | Project select | after a matter is chosen | Disabled until a matter exists |
| 8 | Validation summary | Create with problems | Red summary above the form, focused |
| 9 | Server error summary | failed save | 400 fields mapped, 409 message, 500 generic |
| 10 | Saving state | click Create | Button reads "Creating...", both buttons disabled |
| 11 | After Create: Task page | success | Toast "Task TSK-81 created" |
| 12 | After "Create and add another" | success | Same page, same type, empty title, focus in Title |
| 13 | "Change type" confirmation | Change type (when request-form values exist) | Dialog |
| 14 | Prefilled from Matter | Matter page "Create task", matter task grid | crumb `Tasks > 90001-80001 > Create task` |
| 15 | Prefilled from Project | Project page / project task grid | Matter and project preselected |
| 16 | No permission | user without `Task.Create` | "You don't have permission to view this." page, header button hidden |
| 17 | Empty-state and CTA entry points | Dashboard CTA, My Work empty, Task Queue empty | link to `/tasks/new` |

**17 states and entry points.** The `?taskType=` deep link exists but **nothing in the app produces it** (grep of every `/tasks/new` link: header button, matter and project actions, scoped task grid, Dashboard, My Work, Task Queue). It is only useful for bookmarks, which is a missed chance for "create another like this" and for Frequent tiles (CT-24).

What already exists for email (it is more than the brief assumes): a **server parser** (`POST /api/v1/intake/parse-email`, `.eml` via MimeKit and `.msg` via MsgReader, in memory only, plus a paste endpoint) returning `subject, body, bodyHtml, fromName, fromEmail, sentAt, source, warnings`; the **`mf-email-intake` component** (collapsed panel with a drop zone for `.eml/.msg` files, a paste box, a file picker, a review panel with per-field Keep/Replace, privacy and privilege notes, live-region messages); the page's `applyPrefill` (Title, Description, Requestor name and email, read-only "Source email sent"); six sample emails in `frontend/e2e/fixtures/email` and `e2e/tests/email-intake.spec.ts` (SCN-017). The form-engine's `fill` is only the message-template helper in `messages.ts`; what matters for prefill is that `<mf-dynamic-form [values]>` re-seeds whenever its `values` object is replaced, so a future AI can prefill **request-form fields** with no engine change. Not in the code: any task-type or matter suggestion, any confidence, any page-wide drop target.

---

## 1. Summary

The page is **functionally solid**: the type-first idea is clear, the "Task / Input / Priority" sections from #349 work (the closed section opens by itself on an error; the "Create without Assign or Set priority" variant is explained), double click creates exactly one task, 0 axe violations (WCAG 2.2 AA plus best-practice) on the chooser at 20, 60 and 140 types, the form, the open section and the open email panel at 1366 and 375, no horizontal scroll at any width, a keyboard path with roving arrows into the grid and Enter landing in the Matter field.

What does not hold up is **scale and the email-first future**:

- **The chooser does not scale.** Cards are 143 px tall (127 at 1920) in 3 columns, and the first card starts at y=379 at every width: 379 px of page header, intake strip, heading, help text and search come first. At 1366x768 only **6 cards are fully visible whatever the data**; 140 types is a **7,013 px page at 1366 and 18,987 px at 375** (phone: 140 cards, one per row). There is no Frequent, no grouping, no ordering of one's own.
- **The email path is hidden and heavy.** The drop zone is behind a collapsed "Fill from email" button (collapsed by default, UXR-38). Opened, it pushes the tiles off the screen (**0 tiles visible** at 1366x768, a 380 px panel). The review panel then repeats the form (Title, Description, Requestor) with four Keep/Replace checkboxes, so the user reviews twice. A file dropped just outside the small zone makes the browser **open the file and leave the page** (no page-level drop guard).
- **Nothing helps the choices that cannot be undone.** Type, workflow and matter are immutable, yet the Matter picker shows only `ref + name` (no client, no sensitive flag until after the pick, no recent matters, no "8 of 43"), a failing search says "No matches.", and the workflow is a bare radio with name, version and step count (the workflow description exists in the API and is not shown).
- **Smaller issues**: the type is shown twice (summary strip and chip) before the first field, the form column leaves 380 px (1366) to 970 px (1920) unused, the validation summary lists plain text (no jump to the field) and doubles long labels, Cancel always goes to the Task Queue even when you came from a Matter, the new Task page opens scrolled 398 px.

### Top 10 findings, ranked by impact over effort

| # | Recommendation | Evidence | Effort | Finding |
|---|---|---|---|---|
| 1 | Compact tiles (48 px, icon and name, description on demand), 5 columns at 1366: 35 tiles on the first screen with a Frequent row | 6 visible now (`chooser-20types-1366x768`) | 8 h | CT-01, CT-03 |
| 2 | Email-first intake: slim drop strip at the top, page-wide drop target, no separate review panel (prefill the form with "From email" marks) | 0 tiles visible with the panel open (`email-open-1366x768`) | 18 h | CT-11 to CT-15 |
| 3 | One analysis contract (task type + confidence + reason + extracted fields + matter candidates), UI wired to an `IntakeAnalyzer`, Off / Demo / Live | none exists | 6 h API + part of 18 h | section 5 (A) |
| 4 | Demo mode: labelled, deterministic suggestion service behind a server flag, so the owner can demo without the AI | none exists | 8 h | section 5 (A.6) |
| 5 | Page-wide drop guard (a missed drop must not open the file) | `BUG-2` | 1 h | CT-13 |
| 6 | 140 types: groups (collapsed), search with group labels, Frequent and pinned | 7,013 px page | 10 h (needs the optional group, script 28) | CT-02, section 6 (B) |
| 7 | Arrange mode: drag plus buttons, Pin, Frequent first, Reset; per-user server preference (additive) | not present | 12 h + 8 h | section 7 (C) |
| 8 | Matter picker that helps a one-way choice: recent matters on focus, client name, sensitive marker, "8 of 43", real error message | silent "No matches." for a user without Matter.View (`persona-noMatterView-matter-1366x768`) | 5 h | CT-16 to CT-19, BUG-3 |
| 9 | One header line for type and matter instead of strip + chip + help; workflow explained (description, steps on demand) | Matter field at y=364 of 768 | 5 h | CT-07 to CT-09 |
| 10 | Validation summary with links, no doubled labels, a reference on server errors; fix the scrolled landing | `form-44fields-errors-1366x768`, BUG-1 | 3 h | CT-20 to CT-23, BUG-1, BUG-5 |

---

## 2. Findings by step

### 2.1 Choosing the task type

**What works.** Type-first with the immutability warning in plain words ("Type, workflow and matter can't be changed after you create the task"); only usable types (published form and an eligible workflow) are offered; search appears above 12 types, ranks name-starts first, ignores punctuation ("dedup" finds "De-duplication") and answers in about 80 ms at 140 types; roving tab stop with Arrow keys, Home and End verified (`Right, Right, Down, Left, End, Home` land where expected); choosing a tile moves focus to the Matter field; 0 axe violations at 20, 60 and 140 types.

Measured (cards fully visible without scrolling, card size, page height):

| Types | 1366x768 | 1920x1080 | 768x1024 | 375x812 | Page height 1366 / 375 |
|---|---|---|---|---|---|
| 15 (starter) | 6 (143 px high) | 15 (127 px) | 8 | 2 | 1,164 / 2,682 px |
| 20 | 6 | 15 | 8 | 2 | 1,473 / 3,327 px |
| 60 | 6 | 15 | 8 | 2 | 3,353 / 8,579 px |
| 140 | 6 | 15 | 8 | 2 | **7,013 / 18,987 px** |

Screenshots: `chooser-20types-1366x768`, `chooser-60types-1920x1080`, `chooser-140types-1366x768`, `chooser-140types-375x812`, `chooser-140types-search-1366x768`.

| ID | Sev | Finding | Recommendation |
|---|---|---|---|
| CT-01 | major | The first screen is spent before the first card: the first card starts at y=379 (1366 and 1920, 393 on phone). Cards are 143 px (127 at 1920) with an icon, a 16 px name and a 3-line description cut at 110 characters. 6 cards are visible at 1366x768 however many exist. | Compact tiles, 48 px, icon plus name (2 lines max), description on hover and focus and in a "Show descriptions" switch. See section 6 (B): 35 tiles visible at 1366x768. 8 h |
| CT-02 | major | No structure for 60 or 140 types: only one search box. A new user cannot browse, a regular user cannot reach "their" types without typing. | Frequent row (the user's own recent creations) plus pinned, then groups for more than 48 types. Section 6 (B). 10 h (groups need the optional group field) |
| CT-03 | minor | Descriptions are cut at 110 characters at a word boundary, but the starter descriptions all end "Example title: ..." so the visible part ends mid-example ("Example title: CAL...", "Example title: Archive..."), the useful part is lost. | With compact tiles the description is a popover/line on demand, shown in full (up to 1,000 characters allowed by the schema), not clamped to 110. 0.5 h inside WP-1 |
| CT-04 | minor | The card is a `role="radio"` with `aria-checked="false"` forever: a screen reader announces "radio button, not checked, 1 of 140" and nothing is ever checked, because choosing a card changes the page. | Use `role="group"` + native buttons (roving tabindex and the existing `mfGridNav` keep working with a data attribute instead of `[role=radio]`). 1 h inside WP-1 |
| CT-05 | minor | The description is exposed as a `title` tooltip (not reachable by keyboard or touch). | A real description element tied with `aria-describedby`, shown on hover and keyboard focus (WCAG 1.4.13: dismissible, hoverable, persistent), see B.5. |
| CT-06 | minor | On a phone each type is one 143 px card per row: 2 visible at 812 px, 140 types are 18,987 px; the search box has no sticky position. | 2-column compact tiles, sticky search, Frequent first, "Show more" per group. B.7. |
| CT-24 | minor | `?taskType=` is never produced by the app. | "Create task" tiles in Frequent could link directly; the Task page could offer "Create another like this" (`?taskType=&matterId=`). Out of this review's work packages; mentioned for the App shell epic. 1 h later |

### 2.2 The form after a type is chosen

**What works.** The three sections of #349 (Task, Input, Priority/due/assignment collapsed with a one-line summary "Normal priority, no due date (ASAP), Unassigned"), the section auto-opening on an error (verified: closed, error in Time, Create: `aria-expanded` became `true`), the Create-without-Assign/Set-priority variants with an explanation instead of a disabled control (`persona-createonly-chooser-1366x768` and e2e), the sticky action bar, "Create and add another" keeping type, matter, project, priority and pod and focusing the Title, the unsaved-changes guard, the Sensitive banner.

| ID | Sev | Finding | Recommendation |
|---|---|---|---|
| CT-07 | major | Before the first field there are four blocks: the header, the collapsed "Quick fill from email" bar, a **summary strip** (Matter "Not chosen", Task type, Workflow) and a **type chip** that repeats the Task type again. At 1366x768 the Matter field is at y=364 and only Matter, Title and the start of Description are visible; the request-form fields and the workflow need scrolling (page 2,835 px with the 22-field starter type, 5,444 px with 44 fields). | One line under the header: icon, type name, workflow name, Change type (the strip's job moves into that line plus the existing "can't be changed" sentence once). Saves about 200 px. `form-collapsed-1366x768`. 3 h |
| CT-08 | minor | The 720 px column leaves 380 px unused at 1366 and about 970 px at 1920 (`form-collapsed-1920x1080`). | Keep the 720 px reading width (decision), but use the right column for **context that helps the choice**: Source email (email-first), workflow steps, matter facts. See A.4. |
| CT-09 | minor | Workflow is a radio list at the end of Input showing "Name v1 (7 steps, ordered, default)". The API returns a **description** for each published workflow; it is not shown, and with one eligible workflow the user sees a radio with a single option. Nothing says what the steps are. | One eligible workflow: a read-only line with "Steps: ..." disclosure; several: radio cards with description and a step preview on expand. 2 h |
| CT-10 | minor | The request-form fields come after Requestor in one flat list (22 fields in the starter "Data Processing", 44 in my long case) with no progress ("3 of 9 required left") and no section jump. | A counter in the sticky bar ("2 required fields left") that is a button jumping to the first one. 2 h with CT-20 |
| CT-25 | minor | "Cancel" always goes to `/tasks` (code `cancel()`), also when you came from a Matter or Project (the crumb correctly says `Tasks > 90001-80001 > Create task`). | Cancel returns to the page you came from (`history.back()` with the crumb as fallback). 0.5 h |
| CT-26 | minor | Designer defaults: the form designer stores `defaultValue` as designer metadata and no code applies it on Create (`form-schema.ts` has no default handling; `seed` starts as `{}`). Not verified in a browser; if admins set defaults they will not see them here. | Confirm with the designer owner; apply published defaults to `seed`. 1 h if confirmed |

### 2.3 The matter picker and project

Screenshots: `matter-picker-many-1366x768`, `matter-picker-long-1366x768`, `matter-picker-none-1366x768`, `matter-picker-long-375x812`, `persona-noMatterView-matter-1366x768`.

**What works.** Search by reference or part of the name (`80001`, `Alpha`, `Smith`), debounce 250 ms, first query 385 ms and later ones 73 to 87 ms on 312 matters, only active matters, keyboard (Arrow, Enter, Escape) and focus handling after the pick, a 230-character matter name wraps in the list instead of breaking the layout, deep links (`?matterId=`, `?projectId=`) prefill the matter and the project with the right crumb, an inactive matter in the link gives a clear message, the Project select lists only that matter's projects and says why it is disabled.

| ID | Sev | Finding | Recommendation |
|---|---|---|---|
| CT-16 | major | An empty field shows nothing: no recent matters, no hint. With 312 matters (and a firm with thousands) the user must already know what to type. The user's own recent matters (from their created tasks) are the best suggestion and the email-first flow also needs "candidates". | On focus with an empty field: "Recent" (last 5 distinct matters of the user's tasks, `getMyWork(view=created)` today, additive `GET /me/recent-matters` later) and, in email-first, "Suggested from the email". 3 h |
| CT-17 | minor | Options show `ref name` only. Two matters with the same name for different clients cannot be told apart; the API returns `clientName`, `isSensitive`, `openTaskCount` and they are not used. The **Sensitive** warning appears only after the pick. | Second line: client name; a Sensitive tag in the option; keep one line on phone. 1 h |
| CT-18 | minor | The list is capped at 8 with no sign that more exist ("Alpha" has 9 or more). | A last line "Showing 8. Keep typing to narrow." (or total from `PagedResult`). 0.5 h |
| CT-19 | minor | No highlight of the matched text, no result count announced (`aria-live`). | Bold the match; a visually hidden status "8 results". 1 h |
| CT-27 | minor | After a pick the field turns into text with a "Change" link; a 230-character name fills three lines of the form. | Two-line clamp with the full name in the Source/summary line. 0.5 h |

### 2.4 The existing email pieces

Screenshots: `email-collapsed-chooser-1366x768`, `email-open-1366x768`, `email-review-1366x768`, `email-paste-review-1366x768`, `email-error-unsupported-1366x768`, `email-done-chooser-1366x768`, `email-filled-form-full-1366x768`, `email-open-full-375x812`.

**What works.** A `.eml` file filled Title ("Custodian load list for Harbor Point"), Description, Requestor ("Linda Cho") and "Source email sent: Oct 13, 2026, 10:05 AM EDT" in the form; a non-email file gives a clear message; paste of an Outlook block works; the privacy sentence ("Attachments and the original email are not saved") and the privilege reminder are good and should stay; the live region announces each phase; when the name is missing the local part of the address is used with "Please confirm the name".

| ID | Sev | Finding | Recommendation |
|---|---|---|---|
| CT-11 | major | The path the owner expects to be the most used is a **collapsed 60 px bar** with a "Fill from email" button, closed by default and remembered per browser. A new user never sees a drop zone. | Make intake the first thing on the page: a slim always-visible strip (A.2). |
| CT-12 | major | Opened, the panel is 380 px tall (drop zone, paste box, buttons) and pushes the tiles below the fold: **0 tiles visible at 1366x768**. The review panel then adds another 400+ px (second Title, Description editor, requestor fields, four Keep/Replace checkboxes), and **the same values are reviewed again in the form**. | Remove the intermediate review panel: put the values straight into the form with a "From email" mark on each prefilled field and a one-click "Undo email fill". The form is the review (A.4). |
| CT-13 | major | Drag and drop works only on the small dashed zone, which exists only while the panel is open. Nothing handles `dragover` or `drop` elsewhere (grep of `window:dragover` and `window:drop` finds nothing; a synthetic drop on a tile or the page body is **not** default-prevented), so a miss opens the `.eml`/`.msg` in the browser tab. The unsaved-changes guard asks, but a first-time user has just lost the page. | Page-level drop target with an overlay "Drop the email to read it", and `preventDefault` for files everywhere on this page (BUG-2). 1 h |
| CT-14 | minor | The hint under the zone says "Dragging straight from Outlook may not work in your browser". That sentence is honest while the spike (architecture 13.2) is open but looks like an apology on the main path. | Keep the honesty, move it to the "Not working? Use Browse or Paste" help line. A.2. |
| CT-15 | minor | After "Fill the task" the chooser shows the banner "Details from the email are ready. Choose a task type to continue." and the values live only in hidden state until a type is chosen. If the user changes their mind and "Clear"s, the form values already applied remain (the panel clear resets the panel, not the page). `requestedAt` (the sent date) is only reset by "Create and add another" (code). | Undo on the page (A.4), and show the sent date as part of the provenance line. |

### 2.5 Workflow selection and explanation

Covered by CT-09. Additionally: the immutability sentence appears twice (chooser help, strip note) and nowhere next to the Workflow field itself where the irreversible choice is made; the workflow radio is the last item of Input, after 20 request-form fields, so a user can create a task without ever seeing the workflow when exactly one default exists (by design, but invisible). With one eligible workflow show it at the top in the type line (CT-07); with several, ask for it **before** the long request form.

### 2.6 Validation and server errors

Screenshots: `validation-empty-1366x768`, `form-44fields-errors-1366x768`, `save-slow-1366x768`, `server-error-500-1366x768`, `server-error-400-fields-1366x768`, `server-error-409-1366x768`, `server-error-502-html-1366x768`.

**What works.** One summary, focused on submit ("summary focused"), that follows the fields live and disappears when empty; a required field hidden in the closed section cannot hide (the section opens); **double click creates one task** (1 POST, the button reads "Creating..." and both buttons are disabled, the 4-second delayed API test); a 409 message ("The matter was made inactive while you were filling in the form.") and field errors (`title`, `formValues.custodians`) reach the summary; a task with the form fields hidden by a rule cannot fail on them.

| ID | Sev | Finding | Recommendation |
|---|---|---|---|
| CT-20 | minor | The summary lists plain text. With 9 problems (44-field form) it is 250 px tall and no line is a link: the user scrolls to find "Detail 4". | Each line is a link that scrolls to and focuses the field; show "9 problems" as its heading. 2 h |
| CT-21 | minor | With long labels the line is doubled: "Question 1: describe in as much detail as is known today ...: Enter question 1: describe in as much detail ..." (`form-44fields-errors-1366x768`). | Message "Required" or "Enter a value" after the label, and cut the label in the summary at about 80 characters. BUG-5 |
| CT-22 | minor | A 500 shows "An unexpected error occurred." with no support reference although the load-error states use `mf-error-reference`. A proxy error (HTML 502) shows the raw Angular text "Http failure response for http://127.0.0.1:5197/api/v1/tasks: 502 Bad Gateway". | Use the reference component and a generic sentence for non-problem responses. BUG-4. 1 h |
| CT-23 | minor | A slow save shows only "Creating..." (no progress message after 10 s) and no way to know whether it worked if the connection drops. | After 8 s: "Still creating. Don't click again, it may already be done" plus a check of "Created by me" on retry. 1 h |

### 2.7 After Create

What works: the user lands on the new Task page with a toast "Task TSK-81 created"; "Create and add another" keeps the context, focuses the Title (`create-another-after-1366x768`), toast "Task TSK-82 created".

| ID | Sev | Finding | Recommendation |
|---|---|---|---|
| CT-28 | minor | The toast of "Create and add another" has no link to the task just created; the number is text only. The App shell epic owns toasts (#585, decision AE). | Ask #585 for a toast action "Open" (the Undo toast already uses actions in the same host). |
| CT-29 | minor | After "Create and add another" there is no visible summary of what was kept (matter, project, priority, pod). | One line under the type line: "Kept from the last task: Matter 90001-80001, Priority Normal" with "Clear". 1 h |

The scrolled landing is a bug (BUG-1).

### 2.8 Edge cases

- **Long names.** Task type names are limited to 100 characters in the schema (`NVARCHAR(100)`): the long type "Cross-Border Data Transfer Review under GDPR and Local Blocking Statutes (EU, UK, CH)" (85 characters) wraps to 3 lines in the card, 3 in the summary strip and 3 in the chip (`chooser-search-long-375x812`). Compact tiles clamp to 2 lines with the full name in the description popover. Matter names of 230 characters wrap in the picker and the chosen text (CT-27); no overflow, no horizontal scroll.
- **44-field form with long labels**: renders, 5,444 px tall, one column; see CT-10 and CT-20.
- **Widths**: no horizontal scroll at 1366, 1920, 768 or 375 (`documentElement.scrollWidth == innerWidth` everywhere). Phone: the shell hides the left navigation behind a menu button, the form is one column.
- **Keyboard**: from page load, 22 Tab stops reach the first tile (a skip link exists; the rest is the shell navigation and header), one Tab leaves the grid (roving). From the Matter field to the Create button are **16 Tab stops** because the description editor toolbar has 6 separate tab stops (shared rich-text editor; a roving toolbar is the WAI-ARIA pattern, minor, outside this page).
- **Accessibility (axe)**: 0 violations on the chooser at 20, 60 and 140 types (1366 and 375), the form (closed and open) and the open email panel (1366 and 375). Findings in this document are semantic (CT-04, CT-05) and keyboard (CT-19), not automatic ones.
- **Permission variants** (custom roles created for the review): *Create without Assign and Set priority*: works as designed, the section says what is missing. *Task.View and Task.Create but no Matter.View*: the chooser works, the Matter field answers **"No matches." for every query**, so the user cannot create a task and is not told why (BUG-3; the 403 is swallowed). *Without Task.Create*: `/tasks/new` shows "You don't have permission to view this." and the header button is hidden (correct). There is **no per-task-type or per-matter visibility** in the permission model (the type list needs `Task.View` or `TaskType.Manage`; matters have no access list, "Sensitive" is only a warning), so "a user who cannot see some task types or matters" does not exist today; if it is added, the server must filter the lists (the chooser and picker already trust the server lists).
- **Performance**: 140 types load in about 1.1 to 1.2 s including the app start, 1,488 DOM nodes; typing in the search filters in 75 to 84 ms; the matter search answers in 73 to 87 ms (first call 385 ms). No performance finding up to a few hundred types; the type list is not paged, which is fine to about 500 (a tile is cheap), and grouping (collapsed) reduces the DOM further.

---

## 3. Cross-cutting consistency

- **Shared form page (#361) and record header**: the page uses `mf-record-header` with the `Tasks > Matter > Create task` crumb (good) and the shared field components; keep them. The new tile chooser and intake strip should be new shared components (`mf-type-tile`, `mf-intake-strip`) so the **Edit dialog (#350)** and a future "Create from a Task" can reuse them; the Edit dialog has no chooser (type is immutable).
- **Dialog copy and tokens**: all mocks use only tokens from `docs/ux/tokens.css`; tile height 48 px sits between the work grid's 44 px comfortable row and the 40 px picker row; no new token is needed (a tile is a bordered surface like the Task page facts tile).
- **mf-record-card-list** is the phone pattern of the work lists; the chooser on a phone is a 2-column tile grid (it is a pick list, not records), Arrange mode on a phone is a card list with move buttons (same 44 px hit areas as `mf-record-card-list`).
- **Reorder precedent**: the Priorities admin page already has "Drag a row or use the arrows to reorder" with native HTML5 drag plus Move up/Move down buttons (`data-move-up`), no CDK. Arrange mode follows that pattern, so users learn it once.
- **Preferences precedent**: per-user, per-page client storage is the rule for work lists (keys `mf.work-columns.v2.<scope>.<userId>`); addendum U (#243) postponed server preferences for work lists. See C.4 for why the tile order is argued differently.
- **App shell epic (#585)**: owns the header "Create task" button (hidden on this page, UXR-23) and the toast host; the "Open" toast action and the unchanged placement are requests to it. **Search epic (#421)**: the matter picker should use the same matter search endpoint and ranking as global search once #421 lands (recent matters, client name), and global search could later offer "Create task from this matter".
- **Shortcuts**: none proposed (owner decision, Phase 2, #420). See section 11.

---

## 4. Keyboard, focus and accessibility basics

- Chooser: roving tab stop, arrows, Home, End verified; Enter focuses the Matter field (good). Recommended semantics: group + buttons (CT-04), group headings as real headings for screen-reader navigation, a visually hidden live region "12 of 140 task types" while searching (exists for the filter; extend to groups).
- Arrange mode (C.6) is buttons only: Tab to a tile, then its move buttons; focus **stays on the button just pressed** after the tile moves (the list re-renders but the focused control keeps focus), a live message "Data Processing moved to position 3 of 64", no key chords.
- Email intake: the drop zone is a button (`role="button"`, Enter opens paste); keep a real `<input type=file>` reachable by Tab ("Browse files"), a labelled paste box, and a live region for every phase (reading, suggestion ready, error).
- Contrast and target size: tiles 48 px, move buttons 32 px (WCAG 2.5.8 needs 24); confidence is never colour-only (word "High / Check it / Low" plus percentage plus bar).

---

## 5. Owner requirement A: email-first intake UI

**Position.** Yes: creating a task from an email should be the first thing the page offers, and the UI can be built **now** with the AI behind a contract that has three modes (Off, Demo, Live). Everything except the model itself already exists (parser, privacy copy, prefill). The design principle: **the AI never decides for the user and never saves anything**. Type, workflow and matter are immutable, so a suggestion is always an explicit accept; the user sees why; the form is the review.

Mocks (desktop 1366 and phone 375, `mocks/`): `mock-email-first-1-empty`, `-2-reading`, `-3-suggestion`, `-4-review`, `-5-errors`, each as `-desktop` and `-phone` HTML and PNG.

### A.1 The page flow

```
[Create task]
  idle ---- drop / browse / paste ----> reading ----> suggestion ----> review (the form) ----> Create
     \                                    |   \                          ^
      \-- pick a tile (manual) -----------|----\-- no suggestion -------/    error states at every arrow
```

1. **Idle** (mock 1): a card "Start from an email" at the top with the drop zone, **Browse files** (primary) and **Paste email text**, the privacy sentence, and below it "or choose the task type yourself" with the tiles. On 1366x768 the slim variant of the card (96 px) keeps 35 tiles in view (B.2); the large variant is used when the page has fewer than 20 types.
2. **Reading** (mock 2): the file chip (name, size), three steps with progress (Read the file, Found sender date and subject, Suggesting a task type and matter), Cancel. The manual tiles stay usable (starting one cancels the read). Live region "Reading the email." Typical duration is a few seconds; show the steps honestly: the first two come from the existing parser immediately, the third waits for the analyzer.
3. **Suggestion** (mock 3): two cards. Left: **The email** (From, Sent, Subject, an excerpt with the words the suggestion used highlighted, "Attachments (2) were ignored and are not saved"). Right: **Suggested task type** (icon, name, description, confidence bar with the percentage and the word, "Why", **Use Privilege Review** primary, **Choose another type**, and "Other possibilities" with their percentages), then **Matter** candidates (best match marked, why, Search another matter).
4. **Review** (mock 4): the existing form with the type line, every prefilled field marked **From email** (a small pill, also in the accessible name: "Title, from email"), the matter marked **Confirm** until the user touches or accepts it, a banner "Prefilled from the email. Please check 2 things" listing what needs the user (the checklist is data: matter unconfirmed, workflow with several options, a required request-form field the AI could not fill), the Source email in the right column (the free space of CT-08), the privilege reminder next to the Description, and the sticky bar Create task / Create and add another / Cancel. Nothing is saved before Create.
5. **Errors** (mock 5): unsupported or too-large file (existing messages, kept), email read but **no suggestion** (neutral warning, sender and subject still filled, tiles below), **low confidence** (below 50%: no "Use" button, the top three shown as "Maybe", the user chooses), **service unavailable** (retry, the email is still read), **timeout** (after 15 s the step list says "Taking longer than usual", with "Continue without a suggestion").

### A.2 The drop zone

- **Where**: top of Create task, always visible when no type is chosen; after a type is chosen it collapses to a one-line "Email attached: <subject> (Replace)" or "Start from an email" link (re-reading replaces the prefill after a confirm).
- **Page-wide drop** (CT-13): `dragenter` anywhere on the page shows a full-area overlay "Drop the email to read it" and the drop works anywhere; outside the zone nothing else may open the file (`preventDefault` on `dragover` and `drop` for files while the page is open; remove on destroy). 1 h.
- **Accepted**: `.msg`, `.eml` (existing server limit 10 MB in the UI, the API default says 25 MB: one number should be chosen; the UI copy follows the API setting), paste of text and of HTML (existing). **One email at a time**: several files give "Drop one email at a time" (a queue is Phase 2).
- **Outlook drag**: the new Outlook spike (architecture 13.2) is unresolved and not verified here. The zone accepts a file, or text/HTML as today; a failed drag keeps the existing sentence but moves it to a help line (CT-14). If the spike ends with "file drop works" the zone needs no change.
- **Privacy copy** (keep, tighten): "We read the subject, sender, date and body, then forget the file. Attachments and the original email are not saved." And for the AI modes one more sentence, shown only in Demo and Live: "In Live mode: the text is sent to <the firm's approved AI service> to suggest a task type; nothing is stored there." (the owner fills the real name and retention statement).

### A.3 Suggestion rules (what the UI does with the answer)

| Confidence | Label | Behaviour |
|---|---|---|
| 0.80 and above | **High** (green + word) | The type card is the primary choice; "Use <type>" is the primary button; the type's tile is pre-highlighted in the chooser below. |
| 0.50 to 0.79 | **Check it** (amber + word) | The card says "Not sure"; the primary action is "Use <type>" but the alternatives are shown expanded. |
| below 0.50 or none | **Low** (grey) | No primary button; "Maybe" list (top 3) and the tiles; nothing preselected. |

Thresholds are constants in one file and a server setting in Live (the owner will tune them with real data). **Never** auto-accept, never auto-create, never set priority, assignee or due date (permissions and policy); a due date mentioned in the email can be shown as a hint chip "Email mentions: Friday" next to the Due date field for the user to apply.

### A.4 The review step is the form (no second panel)

Remove the current intermediate review panel (CT-12). Prefilled values go into the form fields themselves; each carries the **From email** pill and the form header offers **Undo email fill** (restores the values that were there before, per field). The existing rules for non-empty fields stay: a field the user already typed is not overwritten (shown as "Kept your text. Use the email's instead?" with a one-click replace), replacing the Keep/Replace checkboxes. Requestor name from the sender, with "Please confirm the name" when only the address was known (exists). The Source email (subject, sent, excerpt) sits in the right column on wide screens and behind a "Source email" disclosure on phones, never saved after Create.

### A.5 The contract (what the future AI service must return)

Additive endpoint, same permission (`Task.Create`), same in-memory rule as the parser: **`POST /api/v1/intake/analyze-email`** (multipart `file`, or JSON `{pastedText, pastedHtml}`), returns the **existing `ParsedEmailResponse` fields unchanged** plus an `analysis` object. The UI is written against this and nothing else.

```jsonc
{
  "subject": "...", "body": "...", "bodyHtml": "...", "fromName": "...", "fromEmail": "...",
  "sentAt": "2026-10-19T20:42:00Z", "source": "MSG", "warnings": [],       // exactly today's ParsedEmailResponse
  "analysis": {
    "status": "OK",                       // OK | NOT_CONFIGURED | UNAVAILABLE | TIMEOUT | NO_SUGGESTION
    "mode": "LIVE",                       // OFF | DEMO | LIVE  (DEMO makes the UI show the Demo label; never trust the client to set it)
    "analysisId": "6f1c...",              // opaque, for the optional feedback call and support; no content inside
    "taskType": {                         // null when none
      "taskTypeId": 12,                   // must be a type the caller may use (server filters: active, usable)
      "confidence": 0.87,                 // 0 to 1
      "reason": "The email asks for a privilege check before a production.",   // plain text, at most 240 characters
      "evidence": [ { "quote": "privilege check", "start": 148, "end": 163 } ] // offsets into body (plain text), optional
    },
    "alternatives": [ { "taskTypeId": 7, "confidence": 0.07, "reason": "..." } ],   // at most 3, descending
    "workflowDefinitionId": 31,           // optional, must be eligible for the type; else the default is used
    "fields": {                           // every value optional; the UI applies only what the user's form can take
      "title":        { "value": "Privilege check before Friday", "confidence": 0.9 },
      "requestorName":{ "value": "Dana Whitfield", "confidence": 0.95 },
      "dueHint":      { "value": "2026-10-23", "confidence": 0.6, "evidence": [ { "quote": "Friday" } ] },   // hint only
      "formValues":   { "custodians": { "value": "J. Ortiz, M. Pham", "confidence": 0.7 } }                 // keys of the suggested type's published form
    },
    "matterCandidates": [                 // at most 5, descending; the server returns only matters the caller can pick
      { "matterId": 16, "matterRef": "00343-00012", "name": "Project Falcon Production", "clientName": "Acme Holdings",
        "isActive": true, "confidence": 0.82, "reason": "Matched \"Falcon\" in the subject." } ],
    "warnings": []
  }
}
```

Rules the UI enforces regardless of the service: ids that are not in the loaded usable types or not pickable matters are dropped silently; `reason` is rendered as text, never HTML; unknown form keys are ignored; the whole `analysis` can be absent (older server) and the UI behaves as Off. An optional, **off by default** `POST /api/v1/intake/feedback {analysisId, accepted, chosenTaskTypeId}` (no content) lets the owner measure accept rate during the demo and pilot.

Client side: an `IntakeAnalyzer` injection token with `analyze(source): Observable<IntakeEvent>` (events `reading`, `parsed`, `analysis`, `error`), and three implementations selected from the server mode (`GET /api/v1/me` gains `features.intakeAnalysis: OFF | DEMO | LIVE`, additive): `ParseOnlyAnalyzer` (today's behaviour, Off), `HttpAnalyzer` (calls `analyze-email`; used for Demo and Live because the server decides what the answer is), and a `FixtureAnalyzer` for unit tests and Storybook-style screenshots only.

### A.6 How the demo works before the AI exists

Recommendation (the owner's requirement is met, with one change to their idea): **do not fake it in the browser; fake it on the server, behind the same contract, labelled.**

1. Config `Intake:Analysis:Mode = Off | Demo | Live` (appsettings, default **Off** in production). In **Demo** the endpoint is served by `RuleBasedIntakeAnalyzer`: a deterministic scorer over the **real** usable task types (words of the subject and body against type names and descriptions, plus a small configurable phrase table, e.g. "privilege log" -> Privilege Review) and over the **real** matters (reference, name words, "Falcon"), returning the full contract with believable confidences. It works with any email, shows the real types and real matters, and costs about one day. It is also a useful, honest baseline to compare the AI against later.
2. The UI shows a permanent **Demo mode** label in the intake card (mock 1) and "Demo suggestion" on the suggestion card, so nobody mistakes it for the product. Off shows no AI wording at all; Live shows "Suggested by <service name>" with "Check it before you use it".
3. For the team demo ship **three sample emails** (`.eml`) next to the existing six fixtures, one per demo scenario: a clear privilege review request (High, matter found), an ambiguous one (Check it, two matters), a vague one (no suggestion, error state). The owner drops them live and shows all three outcomes.
4. A developer-only override for screenshots and tests: `?intakeDemo=ok|ambiguous|none|down|slow` honoured **only** in non-production builds and only for the `FixtureAnalyzer`; it never reaches production.

Before the AI exists and with Off, the page still improves: the drop strip is always visible and the parse-only flow fills Title, Description, Requestor and sent date, then asks for the type with Frequent tiles (no "coming soon" teaser in production; the Demo label is the teaser when the owner chooses to show it).

### A.7 Work and risks

WP-3 (UI, 18 h): intake strip and page-wide drop, state machine and the five states, removal of the review panel, provenance marks and Undo, analyzer token with `ParseOnlyAnalyzer`/`HttpAnalyzer`, a11y and e2e. WP-4 (API contract, 6 h): DTOs, OpenAPI, endpoint returning `NOT_CONFIGURED` in Off, nswag client, `features.intakeAnalysis` on `/me`, contract test. WP-5 (Demo analyzer, 8 h): rule-based service, config, three sample emails, e2e of the demo. Risks: the Outlook drag spike (unverified here), what text may leave the building in Live (a privilege and policy decision, not a UI one), and keeping the rule that no content is logged (the analyzer must be listed with the parser in the "request bodies are excluded from logging" rule).

---

## 6. Owner requirement B: task type tiles

**Position.** About 20 tiles on the first screen at 1366x768 is easy; the data allows **about 35** (5 in the Frequent row plus 30 below the fold line) with 48 px tiles. It should not be used to show all 140: past 48 types the page shows Frequent, pinned and **collapsed groups** with a search that flattens them.

Mocks: `mock-tiles-1-1366x768-viewport`, `mock-tiles-2-1920x1080-viewport`, `mock-tiles-3-100plus-grouped-1366x768-viewport`, `mock-tiles-4-search-1366x768-viewport`, `mock-tiles-5-phone-375x812`.

### B.1 The tile

Height 48 px, minimum width 200 px, 8 px gap (the current card is 143 px by 358 px). Content: the 28 px task type icon (already in the catalog, `mf-task-type-icon`), the name in 13 px semibold on one or two lines (clamped at 2, full name in the popover), an optional pin star at the right. No description on the tile. The description appears (a) in a popover on hover and on keyboard focus after 400 ms (dismiss with Escape, hoverable and persistent, WCAG 1.4.13) and is also the `aria-describedby` text, (b) on demand with a **Show descriptions** switch (remembered with the other layout preference) that switches the grid to 3 columns of 96 px tiles with a two-line description, i.e. today's look for users who want it, (c) on a phone as a second line under the name in that list mode.

### B.2 What is visible without scrolling (computed from the measured shell: header 56 px, left rail 220 px, content padding 24 px, 1366x768 content width 1,098 px)

| Viewport | Columns | Top block (crumb, title, intake strip, search row) | Frequent row | Rows below | Tiles visible |
|---|---|---|---|---|---|
| 1366x768 | 5 (213 px) | about 290 px | 5 | 6 rows of 52 px | **35** (5 + 30) |
| 1366x768, intake large (fewer than 20 types, mock 1 of A) | 5 | about 390 px | 5 | 4 rows | 25 |
| 1920x1080 | 7 (230 px) | about 290 px | 7 | 12 rows | **91** |
| 768x1024 | 3 | about 300 px | 3 | 10 rows | 33 |
| 375x812 | 2 | about 330 px | 2 | 6 rows | 14 |

So 20 types always fit in one screen at 1366x768 with the intake strip; 60 types need a short scroll; **140 types would be 28 rows**: too many, hence B.3.

### B.3 Rules by number of types (usable types the user can see)

| Types | Layout |
|---|---|
| up to 24 | One flat A to Z grid. No Frequent row (everything is visible), no groups, no search box until 13 (as today), Arrange available. |
| 25 to 48 | Frequent row (up to 5 or 7) + flat grid + search. |
| 49 and more | Frequent row + **groups** (collapsible sections with the group name, a count and the first three type names as a hint when collapsed) + search that flattens the groups and shows the group name on each result (mock 4). Groups collapsed by default except the one containing the user's most used type; "Expand all". Open/closed state remembered per user. |

Groups need data: task types have **no category today** (the table has `Name`, `Description`, `IsActive`, `DefaultWorkflowDefinitionId`). Recommendation: an optional `GroupName` (max 60) on `TaskType`, admin-edited in the Task Type page with a datalist of existing groups (additive column in script 28), types without it go to "Other". The icon catalog's twelve categories (General, Identification, Preservation, Collection, Processing, Review, Analysis, Production, Presentation, Data and systems, Communication, Admin) are a good **suggested starter list** for the admin. Until groups exist, 49 and more types show Frequent + a flat grid + search (still 5 columns, still better than today).

### B.4 Search

Keep the shipped ranking (name before description, word starts before middle, punctuation ignored); show the count live ("4 of 140 task types"), Enter chooses the first result when exactly one remains, Escape clears. In grouped mode show each result's group in grey. Keep it as a visible field (not an icon) because it is the fastest path for people who know the name.

### B.5 Frequent, pinned, recent

Section "Your frequent task types": pinned first (C.5), then the user's most created types of the last 90 days (up to one row; data source in C.5). A user with no history sees a Suggested row of the types most used by their Pod or the firm (`openTaskCount` exists on the type list, org-wide, as a cold-start ordering) labelled "Popular", disappearing once the user has their own.

### B.6 Keyboard and screen reader

A group (`role="group"`, named by its heading) of native buttons; one roving tab stop for the whole grid and each group; arrows move over the visible tiles across row breaks (the shipped `mfGridNav` logic), Home/End; Enter or Space chooses. Group headers are buttons with `aria-expanded`. Search count in a polite live region. The pin star is a toggle button (`aria-pressed`) only in Arrange mode, so the normal tile has one action.

### B.7 Phone

2 columns of 48 px tiles; search is sticky under the header; Frequent first; groups as accordions with "Show more" inside long groups (first 10 tiles); the intake card becomes two full-width buttons (Choose file, Paste) with the drop target page-wide for desktop browsers only; with descriptions on, one column list rows. Result: 14 tiles on the first screen against 2 today.

Effort: WP-1 tiles 8 h (grid, tile, popover, density, Frequent row, semantics, phone, tests); groups 4 h more once `GroupName` exists (WP-8).

---

## 7. Owner requirement C: user-reorderable tiles

Mocks: `mock-arrange-1-desktop-1366x768-viewport`, `mock-arrange-2-phone-375x812`.

### C.1 Interaction

A single **Arrange** button next to the search box switches the grid into Arrange mode (an info bar says what to do and has **Done**). In Arrange mode:

- each tile shows a drag handle, its position number, **Move earlier**, **Move later**, **Move to start** and a **Pin** toggle (all native buttons with names such as "Move Data Processing earlier"); the tile's main action (choose) is disabled so a click cannot start a task by accident;
- **drag and drop** with the pointer (native HTML5 drag as on the Priorities page, no new dependency; start after 5 px, a drop line shows where it lands, Escape cancels);
- **non-drag alternative (WCAG 2.5.7)**: the buttons above. They are the complete function, not a fallback hidden in a menu; keyboard users Tab to the tile's buttons and press Enter/Space; no key chords (Phase 2, #420);
- after a move, **focus stays on the button just used** and a polite live message says "Data Processing moved to position 3 of 64"; the moved tile is highlighted for two seconds (reduced-motion respected);
- ordering buttons at the ends are disabled with `aria-disabled` (not removed) so the Tab order does not jump.

Outside Arrange mode the grid is exactly the chooser of B. On a phone Arrange mode is a list of 44 px-hit rows with up, down and pin buttons (mock 2); dragging on touch is not offered (it conflicts with scrolling); the buttons are the way.

### C.2 Order modes (one control, three choices)

| Mode | Order | Notes |
|---|---|---|
| **My order** | Pinned first, then the user's own order, new types at the end (marked **New** until first used) | Set by Arrange. |
| **Frequent first** | Pinned first, then by the user's creations in the last 90 days (most first), ties and zero by default order | Automatic; no manual order is needed or lost (switching back keeps "My order"). |
| **Default** | The administrator's order (C.7), else A to Z | What a new user sees. |

Reset to default order: one button, with an Undo in the toast (the previous layout is held in memory for that session).

### C.3 What other users see

Nothing of this: each person has their own layout; an administrator's default (C.7) is the starting point for everyone and for anyone who resets.

### C.4 Persistence: recommendation

| Option | For | Against |
|---|---|---|
| Client storage (`mf.createTask.types.v1.<userId>` in `localStorage`, the pattern of the work lists) | No server work; consistent with the decision that work-list preferences stay client-side (addendum U, #243); about 2 h. | Per browser: a person on two machines or a clean-profile VDI loses the arrangement; cleared site data and private windows lose it silently; the owner wants this to be a visible productivity feature, and a curated order is the kind of thing people do not redo. |
| **Server preference (additive)** | Follows the person; survives browsers; a single small JSON; works on the phone and the desktop alike; enables "Frequent first" without any client history. | One new table and two endpoints; reopens the #243 question. |

**Recommendation: server-side, deliberately scoped, behind a store interface.** The #243 decision postponed server preferences for *work lists* (columns, widths, density, page size, which also depend on the screen), and said so for those. The tile order is different in kind: it is small, it is explicit user curation (not a layout detail), and it is needed on every device. Build `TaskTypeLayoutStore` with two implementations (local first, server synchronised), ship the local one in WP-6 and the server one in WP-7 if the owner agrees; the UI is identical. If the owner prefers to keep #243's line, stop after WP-6 and note the limitation in the help text ("Saved in this browser").

Additive API (SQL script **28**, free): table `dbo.UserPreference (UserId INT, PrefKey NVARCHAR(60), JsonValue NVARCHAR(MAX), RowVersion ROWVERSION, CONSTRAINT PK PRIMARY KEY (UserId, PrefKey))`; `GET /api/v1/me/preferences/{key}` and `PUT /api/v1/me/preferences/{key}` (If-Match on the row version, 64 KB cap, allowed keys list, key `createTaskTypes` first); permission: the user's own, no permission needed; audit: none (not data). Value:

```json
{ "v": 1, "mode": "custom", "pinned": [12, 7], "order": [12, 7, 3, 9], "groupsOpen": ["Review"], "descriptions": false }
```

Unknown or deleted ids are ignored on read; inactive or unusable types are never shown; the list is trimmed on write.

### C.5 Frequent first: the data source

The user's own recent creations. Today the client can compute it from `GET /api/v1/me/work?view=created` (My Work "Created by me", the user's tasks with their type) over the last 90 days, but that is a heavy list query for a counter and capped by paging. Additive and cheap: **`GET /api/v1/task-types/usage?scope=me&days=90`** returning `[{ taskTypeId, count, lastCreatedAt }]` from `dbo.Task` (CreatedByUserId, CreatedAtUtc, TaskTypeId: an index on `(CreatedByUserId, CreatedAtUtc)` includes TaskTypeId), no new table. The same endpoint with `scope=pod` powers the cold-start "Popular" row. Pinned and the manual order are the only stored data.

### C.6 New task types, defaults, accessibility

- **New types**: in My order they go to the end, with a **New** mark until used or dismissed, and the Arrange bar tells the user how many appeared since they last arranged (mock). In Frequent first and Default nothing special is needed.
- **Admin-defined default order**: optional integer `SortOrder` on `TaskType` (script 28), set by drag in the Task Types admin list (recently reworked; the Priorities page's drag-plus-arrows is the model) or by number; null sorts by name. Cost 10 h with the group field (WP-8). Without it Default is A to Z.
- **Accessibility**: section 4; buttons satisfy WCAG 2.5.7; 2.4.11 (focus not obscured: tile buttons scroll clear of the sticky bar); 4.1.3 live messages; 1.4.13 for the description popover; 2.5.8 targets 32 px or 44 px.
- **Out of scope on purpose**: hiding a type from one's own list (a hidden type is a type the user cannot find when they need it); sharing orders between users.

---

## 8. Test data and how this was measured

`npm run seed:demo` (80 tasks, 50 users, 5 clients, 12 matters, 4 projects, 4 pods, 60 assets) plus the extra seeder in `seed/` (through the public API as the Dev admin): 15 clients (one of 100 characters), **312 matters** (one of 230 characters, every 17th Sensitive), **140 usable task types** (the 15 starter types plus 125 across the twelve EDRM-style phases, each with a published form of 1 to 4 fields, a type with **44 fields and long labels** (6 required), a type name of 85 characters and a description of about 700 characters), and the 60-type stage made by temporarily deactivating the rest. Roles for the permission variants were created through the API (Create-only, no Matter.View, full, no Task.Create). Browser: Playwright Chromium, `America/New_York`, 1366x768, 1920x1080, 768x1024 and 375x812; axe 4.10.2 with wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa and best-practice tags. Network errors were simulated with route interception using the API's real problem-details shape.

---

## 9. Bug list (with repro)

| ID | Sev | What | Repro | Fix | Effort |
|---|---|---|---|---|---|
| BUG-1 | minor | The new Task page opens scrolled. | On Create task scroll down (document `scrollTop` 398), fill, Create: the Task page opens with `scrollTop` 398 and the header and facts are above the visible area (`after-create-landing-2-1366x768`). | Scroll to top on navigation to a record (router `scrollPositionRestoration: 'enabled'` or `scrollTo(0,0)` in the success handler). | 0.5 h |
| BUG-2 | major | A file dropped outside the small drop zone makes the browser open it and leave the page. | Drop an `.eml` on the title area of Create task (a synthetic `drop` event is not default-prevented; `beforeunload` asks only if the form has data). Browser default not exercised against real files here (see section 10). | Page-level `dragover` and `drop` handling (A.2). | 1 h (inside WP-3) |
| BUG-3 | major | Matter search error shows "No matches.": a user with `Task.Create` and `Task.View` but no `Matter.View` cannot create tasks and is not told why. | Custom role Task.View + Task.Create; type "Alpha" in Matter (`persona-noMatterView-matter-1366x768`). The `catch` in `EntityPicker.run` sets no options and no error. | Distinguish error from empty: "We couldn't search matters" with a Retry; for a 403 name the missing permission ("Needs View matters"); also make the role editor select `Matter.View` with `Task.Create` as it does for Dashboard tabs. | 2 h |
| BUG-4 | minor | A non-problem server response (HTML 502) puts raw text in the summary: "Http failure response for http://.../api/v1/tasks: 502 Bad Gateway". | Intercept POST /tasks with `text/html` 502 (`server-error-502-html-1366x768`). | Generic sentence plus `mf-error-reference` when the body is not problem details; show the `traceId` of a 500. | 1 h |
| BUG-5 | minor | The summary doubles a long field label. | 44-field type, Create empty (`form-44fields-errors-1366x768`). | "Label: Required" with the label shortened; see CT-21. | 0.5 h |
| BUG-6 | minor | `role="radio"` with `aria-checked="false"` always (CT-04). | Screen reader or `getByRole('radio')`. | Buttons in a group. | in WP-1 |
| BUG-7 | nit | After an email fill and "Clear", the page keeps the prefilled values and the "Source email sent" line (code: `Clear` resets the panel only). Not exercised in the browser. | Fill from email, Fill the task, then Clear. | Page-level Undo (A.4). | in WP-3 |

---

## 10. What I did NOT verify

- **Real Outlook drag and drop** (new Outlook, OWA): the spike result is not in the repo; the drop zone was exercised with synthetic events and with `setInputFiles`, and a missed-drop navigation was inferred from the missing page-level handler plus a synthetic event, not from a real file dragged from a desktop.
- A real `.msg` file: the six fixtures are `.eml`; the `.msg` parser (MsgReader) was not run here.
- **Any AI behaviour**: confidence thresholds, latency, privacy of a live service are design proposals; the demo analyzer is not built.
- `Task.Create` without `Task.View` (the type list needs one of `Task.View` or `TaskType.Manage` by code): not run.
- The Edit dialog equivalent (#350), the Pod prefill entry point (no Pod parameter exists in the page code), and the effect of Create on Pod Work counts.
- Form designer defaults (CT-26) and what a published form with a Date or Asset field looks like on a phone.
- Screen readers (NVDA, JAWS, VoiceOver): semantics are reasoned from the DOM and axe, not heard.
- Windows high-contrast and 200% text zoom (only the 768 px layout was used as a proxy for reflow).
- More than 312 matters or 140 types, and slow networks (only the 4-second API delay).
- The full-page captures of the shell are not shipped: the app scrolls the document with a fixed header and full-page capture duplicates it; the viewport shots are the evidence.

---

## 11. Phase 2 note (not part of the recommendations above)

Per the owner decision (#420) no keyboard shortcuts are proposed in this phase. For the Phase 2 backlog only: a "create task" go-to shortcut already belongs to the shell; arranging tiles by keyboard chords, a shortcut to focus the type search, and a global paste-to-create ("paste an email anywhere") would build on this work. Everything in this review works with Tab, Enter, Space, arrows and buttons.

---

## 12. Proposed work packages, dependencies and order

Estimates are AI-agent hours including unit tests, e2e and axe updates.

| WP | Content | Findings | Effort | Depends on |
|---|---|---|---|---|
| WP-1 | Compact tile chooser: tiles, 5/7 columns, Frequent row from usage, search with group labels, descriptions popover and switch, group/button semantics, phone 2 columns | CT-01 to CT-06 | 8 h | (Frequent data: WP-6/usage endpoint; works without it using A to Z) |
| WP-2 | Form header and picker: one type line, workflow explanation, matter picker (recent, client, Sensitive, "8 of N", real errors, highlight), Cancel back, "kept from last task", validation links and counter, error reference, scroll fix | CT-07 to CT-10, CT-16 to CT-23, CT-25, CT-27 to CT-29, BUG-1, BUG-3 to BUG-5 | 14 h | WP-1 (layout); #585 for the toast "Open" action |
| WP-3 | Email-first UI: intake strip and page-wide drop, states reading/suggestion/review/errors, provenance marks and Undo, removal of the review panel, `IntakeAnalyzer` with `ParseOnlyAnalyzer`/`HttpAnalyzer` | CT-11 to CT-15, BUG-2, BUG-7 | 18 h | WP-4 for the suggestion states |
| WP-4 | Additive API: `POST /intake/analyze-email` contract (returns `NOT_CONFIGURED` in Off), optional feedback endpoint, `features.intakeAnalysis` on `/me`, OpenAPI and nswag | A.5 | 6 h | none |
| WP-5 | Demo analyzer (rule-based, server), `Intake:Analysis:Mode`, three sample emails, Demo labels, demo e2e | A.6 | 8 h | WP-4 |
| WP-6 | Arrange mode (drag plus buttons, Pin, My order / Frequent first / Default, Reset with undo, New marker) with `TaskTypeLayoutStore` (local) and the usage endpoint `GET /task-types/usage` | section 7 | 12 h | WP-1 |
| WP-7 | Server preference: SQL script **28** (`UserPreference`), `GET/PUT /me/preferences/{key}`, store implementation and migration of the local value | C.4 | 8 h | WP-6, owner decision on #243 |
| WP-8 | Admin: optional `GroupName` and `SortOrder` on `TaskType` (script **28**, same script), Task Type edit field, drag/arrows default order, groups on the chooser | B.3, C.6 | 10 h | WP-1 |
| | **Total** | | **84 h** | |

SQL: script **28** is free (last used 27); WP-7 and WP-8 share one script (`28-create-task-preferences.sql`: `dbo.UserPreference`, `TaskType.GroupName`, `TaskType.SortOrder`; additive, nullable, no data migration). If another epic claims 28 first, use the next free number. Every API item is **additive** (new endpoints, new nullable columns, a new field on `/me`); no existing contract changes.

**Suggested order.** 1) WP-4 + WP-3 (without the suggestion states) + the drop guard first: it makes email-first demonstrable and removes BUG-2. 2) WP-5 so the owner can demo (WP-3 suggestion states land with it). 3) WP-1 then WP-2 (tiles and the form). 4) WP-6, then WP-8 (groups matter once types exceed 48), then WP-7 on the owner's decision. Quick wins that can go anywhere: BUG-1, BUG-3, BUG-4, BUG-5, CT-25 (about 5 h).

**Decisions needed from the owner** (each has a recommendation above): (1) server-side preference for the tile order (C.4); (2) Demo mode as a server-side rule-based analyzer with the Demo label (A.6); (3) the optional task-type group (B.3); (4) the confidence thresholds as the starting values (A.3); (5) which AI service name and retention sentence the Live privacy line will state.
