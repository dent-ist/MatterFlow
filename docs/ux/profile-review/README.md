# My profile: independent UX review (profile, availability, out of office, account menu)

Scope: the **My profile** page (`/profile`), the **header account menu** (name button, My profile, Set out of office / I'm back, Keyboard shortcuts), the **Set out of office dialog**, the header's out-of-office label, and the language and time-zone display (the time-zone field exists; there is no language setting). Reviewed as a senior UX designer and front-end reviewer on `origin/dev` at `48aa4aa`. **No application code was changed.** Everything below was observed in the real stack (published API with Dev auth, SQL Server 2022, the production Angular build) driven with Playwright Chromium, plus a read of `features/profile`, `shared/availability/*`, `shared/layout/user-menu.ts`, `core/availability/*` and the earlier UX documents (UX spec S23 and Section 5.1, `docs/ux/profile-availability/`, decisions addendum L and M).

Screenshots are in `screenshots/` (`<name>-<width>x<height>.png`; 1366x768 unless the name says otherwise; 1920x1080, 768x1024 and 375x812 where it matters). Before/after mocks are in `mocks/` (HTML plus PNG).

**Test data.** `npm run seed:demo` (50 test users, 4 pods, 200 tasks, 4 users out of office), plus personas added through the API: a Read-Only Observer, Compliance Auditor, Configuration Admin, Intake Coordinator, Director, a pending user, a disabled user, three users with custom roles (Client.View only; User.Manage only; Pod.View without Task.View), a user with a 66-character display name and a 150-character out-of-office note, and a user in 5 pods. Browser time zone America/New_York; also checked with a Dev-auth account that has no display name (`KE\kekim`).

Ranking key: **severity** blocker / major / minor / nit; **effort** in AI-agent hours (one hour is roughly one focused implementation-plus-tests session of an AI agent; S is 1 to 3, M is 4 to 8, L is 9 or more).

**Owner decision applied:** no keyboard-shortcut recommendations. The "Keyboard shortcuts" menu entry stays exactly as it is. The Phase 2 backlog note is at the end.

---

## 1. Page inventory

| # | Surface | Route or place | Purpose | Permission |
|---|---|---|---|---|
| 1 | My profile | `/profile` | Set Available / Out of office (from, until, note), weekly work hours, time zone | `Task.View` (route guard); API `GET/PUT /me/availability` |
| 2 | Account menu | header, every page | My profile, Set out of office... / I'm back, Keyboard shortcuts | everyone sees the menu; the first two items need `Task.View` |
| 3 | Set out of office dialog | opened from the menu | Two-field quick way (Until, Note) | `Task.View` |
| 4 | "I'm back" action | the menu while out of office | Ends out of office at once | `Task.View` |
| 5 | Header out-of-office label | header, under the name | "Out of office until Oct 26" (icon only on phone) | `Task.View` |
| 6 | Leave without saving? guard | route and window unload | Protects unsaved profile edits | n/a |
| 7 | Edit availability dialog (other people) | Administration > Users | The same form for an administrator | `User.Manage`; **not reviewed here** (the Users review covers it; the form is shared, so findings P3, P7, P8 apply to it) |

Seven surfaces, six reviewed. A person without `Task.View` has no profile: the menu shows only "Keyboard shortcuts" and `/profile` answers the 403 page (checked with `KE\clientonly`, `profile-as-clientonly-1366x768`). That is consistent with the spec: people who cannot be assigned work have nothing to announce.

---

## 2. Summary

The profile is **functionally sound**: 0 axe violations (WCAG 2.2 AA plus best-practice) on every state I tried (default, out of office, validation errors, load error, dialog, menu, phone), the error summary takes focus and each link reaches its field, the "Leave without saving?" guard works, 409 conflicts are handled, focus returns to the menu button after the dialog, and the sentence under the dates ("You will show as out of office from now until Oct 26 and as available again on Oct 27.") is the best piece of microcopy in the app.

What is weak is **everything around that form**:

1. **It is not a profile.** The page shows no name, account, email, role or pod. The person cannot see what the system knows about them, which Pod is their primary one, or why they are not seeing something. (P1)
2. **One 644 px column in a 1146 px page.** More than half the screen is empty at 1366 (and 1060 px at 1920), while the weekly hours grid is 7 rows of 57 px: at 1366x768 the first screen shows 5 of 7 days and no time zone or Save. (P2)
3. **The hours control costs about 50 Tab stops** (4 per native time field, 8 per working day) for what is in 95 percent of cases "the same hours on weekdays". (P3)
4. **The header menu and the page disagree**: setting out of office from the menu while My profile is open leaves the page saying "Available" (BUG-1), and on a phone the header cannot show who is signed in or that they are out. (P4, P5)
5. **Visual drift from the reworked pages**: 28 px page header where every reworked page uses the 22 px record header; an error summary 1098 px wide above a 644 px form; a white action bar wider than the form; the plain text "Loading...". (P11, P8, P15)

### Top recommendations, ranked by impact over effort

| # | Recommendation | Evidence | Effort | Findings |
|---|---|---|---|---|
| 1 | Fix the stale page after a menu action and clamp long names in the header | BUG-1 (`menu-set-while-profile-open`), BUG-2 (`long-name-profile-768x1024`) | 2 h | BUG-1, BUG-2 |
| 2 | Give the profile an identity: record-style header (name, account, role, pods, status chip) and a read-only Account card | `profile-default-1366x768` has none of it | 6 h | P1, P11, P12 |
| 3 | Two columns from 1100 px and a first screen that fits at 1366x768 | measured: form 644 px of 1146, 5 of 7 days visible | 4 h | P2, P8 |
| 4 | Compact work hours: weekday toggles plus one start/end pair, per-day grid behind "Different hours on some days" | 50 Tab stops, 400 px tall grid | 8 h | P3 |
| 5 | Account menu: identity and current status first, an out-of-office dot on the phone icon, one line per name | `user-menu-open-375x812`, `ooo-profile-375x812` | 3 h | P4, P5 |
| 6 | Presets in the Set out of office dialog (Rest of today, Until tomorrow, Until Monday, 1 week) | the dialog needs a typed date for the most common cases | 3 h | P6 |
| 7 | Time zone as a friendly select with the local time and a one-line rule about display zones | free text over about 420 IANA ids; two zones in play (addendum M) | 4 h | P9 |

Total of all work packages: **about 33 agent-hours** (section 7).

---

## 3. My profile page (`/profile`)

Screens: `profile-default-1366x768`, `profile-default-1920x1080`, `profile-default-768x1024`, `profile-default-375x812`, `profile-bottom-1366x768`, `profile-bottom-375x812`, `ooo-profile-1366x768`, `ooo-profile-768x1024`, `ooo-profile-375x812`, `profile-ooo-selected-375x812`, `ooo-fields-invalid-1366x768`, `error-summary-top-1366x768`, `state-loading-1366x768`, `state-load-error-1366x768`, `dirty-guard-1366x768`, `long-name-profile-*`.

### What works

- One form, one Save: status, dates, note, hours and zone are saved together; Save and Discard are disabled until something changes.
- The **status preview** ("Your current status: Off hours / Out of office until Oct 26") is the API's evaluation when nothing is edited and a live preview of the draft otherwise ("Preview of your changes."). Excellent; it is the model for "show the result of the setting".
- **Live validation plus an error summary** (`error-summary-top-1366x768`): three problems named, each a link to its field, summary focused after a failed Save, invalid fields outlined and marked with an icon (not colour alone).
- The out-of-office block is a disclosure of the radio (fields appear only when needed), with a 200-character counter and the helper "for example who covers for you".
- Dates use the shared `mf-date-input` (typed or calendar), time fields are native.
- The route guard and window-unload guard work; the 409 path reloads the latest values and says the edits were not saved.
- States: loading, load error with Retry (`state-load-error`), and a 403 for people without `Task.View`.

### Issues and recommendations

**P1 (major, M): the profile has no profile.** The page says nothing about the person: no display name, Windows account, email, role, Pods or primary Pod (`profile-default-1366x768`). The header shows name and account, but a technician who wonders "why can I not see Pod Work for the other Pod?" or "which email will the Pod Lead see?" has nowhere to look. The data is already on `/me` (`displayName`, `windowsAccount`, `email`, roles, pods with `isPrimary`).
Recommendation: a read-only **Account** card (Name, Windows account with the shared copy button, Email, Role, Pods with the primary one marked) with the line "Managed by your administrator." and no edit controls (display name and email are admin-edited, addendum L). Roles and Pods use the same pills as Administration. People are not asked to maintain anything here; the point is that they can see. Mock: `mocks/mock-profile-page.png`.

**P2 (major, M): layout wastes the screen and hides the end of the form.** Measured: the page box is 1146 px wide at 1366 and 1700 px at 1920; the form is 644 px, the hours grid 560 px, the error summary 1098 px and the action bar 888 px, so five widths share one page (`error-summary-top-1366x768`). At 1366x768 the first screen ends after Friday: Saturday, Sunday, "Copy Monday...", Time zone and the Save buttons need a scroll, and the sticky action bar covers the bottom edge of the grid (`profile-default-1366x768`).
Recommendation: from 1100 px two columns (left: Availability then Work hours; right: Account), one card style (the bordered 8 px card the Client overview already uses), one width per column, the error summary at the width of the left column. Below 1100 px one column, Account last. With P3 the whole page then fits at 1366x768 without scrolling.

**P3 (major, M): the weekly hours control is slow to use and to tab through.** Seven rows of 57 px (400 px), each working day has a checkbox and two native time fields. A native time field is **four** Tab stops in Chromium (hour, minute, AM/PM, clock button); a default week is 5 x 9 = 45 stops plus the weekend, the two helper buttons and the time zone: **about 50 stops** before Save (measured with a Tab sweep). For the common case ("Mon to Fri, 9 to 5") that is the cost of changing nothing.
Recommendation: show **day toggles** (Mon to Sun, `aria-pressed` buttons, 32 px) and **one start/end pair** ("From 09:00 AM to 05:00 PM on the days above"). A link "Different hours on some days" opens the existing per-day grid (data model unchanged: the pair writes the same `workHours` array, and a week whose days differ opens the grid by itself). Tab stops fall to about 16, height to about 140 px. Keep "Copy Monday to all weekdays" inside the grid; keep Reset. Mock: `mocks/mock-profile-page.png`.

**P4 (minor, S): on a phone the header cannot say who is signed in or that they are out of office.** At 375 the user menu is icon only (spec says so) and the out-of-office label disappears with the name; the only place the state shows is the preview inside the page (`ooo-profile-375x812`). At 768 it works (`ooo-header-on-my-work-768x1024`).
Recommendation: keep the icon, add a small amber dot with an accessible name ("Out of office") on the icon while out; the menu's first row (P5) carries the text.

**P5 (minor, S): the menu has no identity and no status.** Three actions (`user-menu-open-1366x768`). Recommendation: a non-interactive first row with name, account (`mf-mono`), the availability chip (same `mf-badge` as the page) and, when out, "until Oct 26"; then My profile; then Set out of office... or I'm back; a divider; Keyboard shortcuts (unchanged, only its position). On a phone this row is the only identity the person ever sees. Keep the ARIA menu-button pattern as built.

**P6 (minor, S): two ways to set out of office, unequal.** The page offers From, Until and Note with a Save button; the header dialog offers Until and Note and saves at once (`ooo-dialog-default-1366x768`). That is right (the dialog is the 10-second path) but the common answers still need a typed date.
Recommendation: presets as chips above the date field: **Rest of today, Until tomorrow, Until Monday, 1 week, Pick a date** (the chip fills Until; the existing sentence confirms the effect), and a link "More options on My profile" for From and work hours. Wording stays. Mock: `mocks/mock-user-menu.png`.

**P7 (minor, S): "I'm back" and "out" do not tell the page.** See BUG-1. Separately, after "Set out of office" the toast says 'Use "I'm back" in your name menu when you return.' (good) but that text is also what stays on screen when the next toast arrives (BUG-4).

**P8 (minor, S): form chrome is off the grid.** The sticky action bar is 888 px wide (form 644), white on the grey page with no shadow, so it reads as a band cutting the content (`profile-default-1366x768`, `profile-bottom-1366x768`); on a phone it covers the last field. Save is a pale disabled primary until the first change, which reads as "broken" to some. Recommendation: the bar is the width of its column, has the shared top shadow, and a quiet "No unsaved changes" on the right while clean. Use the shared sticky form action bar (`mf-form-actions--sticky`, already used by this form) with the column's width.

**P9 (minor, M): the time zone field.** A free-text input with a datalist of about 420 IANA ids, placeholder "Start typing, for example New_York". The browser zone is preselected, which is right, but the field says nothing about **which time zone the rest of the app uses**: by addendum M every timestamp elsewhere shows in the browser's zone, while the profile zone decides only work hours and the out-of-office days. Someone travelling can set a zone here and still see every other time in the browser zone, with nothing explaining it.
Recommendation: a select with friendly names grouped as the firm sees them (Eastern, Central, Mountain, Pacific, Alaska, Hawaii, "Other zones..." opening the existing list), each showing the IANA id as secondary text; under it "It is 9:41 AM there now." and "Dates and times elsewhere in MatterFlow use your browser's time zone (America/New_York)." Validation stays.

**P10 (nit, no change): language.** There is no language setting and the product is English only. Do not add one. Time and date formats follow the browser locale (checked: `Oct 26, 2026`, `09:00 AM`); a label "Language and format: English (United States), from your browser" is not worth the space.

**P11 (nit, S): the page header drifts from the reworked pages.** `/profile` uses the plain page header at **28 px** (title top at 24 px); Task Queue, My Work, Clients and the records use 22 px at 12 to 14 px. Clicking from My Work to My profile makes the title jump 12 px down and grow 6 px. Recommendation: with P1 the title becomes the person's name in the record header (22 px, context line under it), the page name "My profile" moves to the document title ("My profile - MatterFlow", unchanged) and to the menu entry. Primary action in the header: **Set out of office...** (or **I'm back**), which is the page's one verb and follows the action rule (no Edit, no Activity, no overflow here).

**P12 (nit, S): the preview strip is a one-off.** The grey "Your current status" panel is not `mf-work-strip` or `mf-badge` in a header; after P11 the status chip lives in the header line and the preview text moves under the Status radios ("Preview of your changes." only while dirty).

**P13 (nit, S): small copy and consistency.** "Reset to Mon-Fri 9:00 AM-5:00 PM" and "Copy Monday to all weekdays" are text-link buttons with an icon on one of them only; make both the same quiet button. The description under the old title ("Tell colleagues when you are out of office and set the hours you usually work.") becomes the card description of Availability.

**P14 (minor, S): loading is the text "Loading...".** Every other reworked page shows a skeleton with the final height (`record-state` / `grid-body`); here the page header is there and the form area is one line (`state-loading-1366x768`), so the page jumps 700 px when the data arrives. Recommendation: a skeleton of the two cards.

### Edge cases checked

| Case | Result |
|---|---|
| Long display name (66 chars) | Header grows to 66 px and the search box collapses to an icon at 768 (BUG-2); at 1366 the name truncates fine (`long-name-profile-1366x768`) |
| 150-character note | Counter and textarea fine (`long-name-profile-768x1024`: 158 / 200); header label is not affected |
| Out of office with no until | Header says "Out of office"; the sentence says "until you set yourself available again" (good) |
| Until before From, end before start, unknown zone | All three named in the summary, nothing saved, links reach the fields (`error-summary-top-1366x768`) |
| Reload while the form is dirty | Browser unload prompt; in-app navigation shows "Leave without saving?" with Stay / Leave (`dirty-guard-1366x768`) |
| Out-of-office user's header at 768 | Amber "Out of office until Oct 26" under the name (`ooo-header-on-my-work-768x1024`) |
| No `Task.View` | No My profile entry, `/profile` is the 403 page |
| Axe | 0 violations on all of the above |

---

## 4. Account menu, header label and Set out of office dialog

Screens: `user-menu-open-1366x768`, `user-menu-open-768x1024`, `user-menu-open-375x812`, `ooo-user-menu-1366x768`, `ooo-menu-im-back-1366x768`, `ooo-dialog-default-1366x768`, `ooo-dialog-default-375x812`, `ooo-dialog-filled-1366x768`, `ooo-set-toast-1366x768`, `im-back-toast-1366x768`, `ooo-dialog-closed-focus-*`, `long-name-menu-1366x768`.

**What works.** The ARIA menu-button pattern is complete (Enter, Space, Arrow Down open; arrows, Home, End; Esc closes and returns focus; Tab closes). The dialog moves focus to the Until field, closes on Esc and Cancel, and returns focus to the menu button (verified: `document.activeElement` is the trigger). The dialog is small and calm; its sentence updates as you type; Until and Note are optional. The button label "Set out of office" repeats the title (clear). "I'm back" ends at once and says "Welcome back / You show as available again." The header label is amber with a calendar icon (not colour alone). At 375 the dialog fits the screen without scrolling.

**Issues.** P4, P5, P6 above; BUG-2 and BUG-3 below. One more:

**M1 (nit, S): the focus ring colour inside the dialog.** The Until field is focused on open and shows the documented orange ring (`--mf-focus`), which looks like an error state next to the blue primary button (`ooo-dialog-default-1366x768`). This is the app-wide focus colour and is documented; it is only noticeable here because the field is focused automatically. Leave the colour; do not auto-focus a date field in a dialog: focus the first preset chip or the dialog heading, which also stops the on-screen keyboard from opening on a phone.

---

## 5. Cross-cutting consistency (profile against the reworked pages)

| Convention | Reworked pages | Profile |
|---|---|---|
| Page header | Record header: 22 px title, context line, actions right | Plain header, 28 px, description line |
| Action rule (Edit, Activity, primary, overflow) | Edit / Activity / primary / More | Save and Discard at the bottom; no header action |
| Cards | `mf-card` look, 8 px radius, one width per column | Unframed sections; summary, hours grid and bar have four widths |
| Loading | Skeleton with final height | "Loading..." |
| Error | `record-state` (heading, reason, Reference with copy button, Retry) | Alert with Retry, no reference |
| Toasts | Bottom left (Undo toast) and PrimeNG toast bottom right | Bottom right (same as the app) |
| Tokens | `--mf-*` only | `--mf-*` only (good) |
| Keyboard | One tab stop per control; roving where grids | 50 stops in the hours grid (P3) |
| Phone | Cards below 640 px, 16 px gutter | Works, one column; hours rows wrap (time fields stack under the day name) |

---

## 6. Bugs found (with repro)

| ID | Severity | Bug | Repro | Expected |
|---|---|---|---|---|
| BUG-1 | major | **My profile does not follow the header menu.** With `/profile` open, choose Set out of office... in the name menu and save: the header says "Out of office" but the page still shows Available and the preview "Off hours". "I'm back" has the same gap, and a later Save on the stale page would send an old `rowVersion` (409) or overwrite. | Sign in as any technician, open `/profile`, name menu > Set out of office... > Set out of office (`menu-set-while-profile-open-1366x768`). | The page reloads from the shared `MyAvailability` state, or asks to. Cheapest: the form reads its baseline from the store and re-baselines when it changes while clean (and shows the existing conflict text when dirty). |
| BUG-2 | minor | **A long display name wraps the header.** At 768 px the name wraps to two lines, the header grows from 57 to 66 px and the global search collapses to an icon; the name is not clamped at any width. | Display name of 60+ characters, open any page at 768x1024 (`long-name-profile-768x1024`). | One line, ellipsis, full name as tooltip and accessible name; header stays 57 px. |
| BUG-3 | minor | **Name and account shown twice.** When the display name equals the account but for case, the user button shows "KE\kekim" over "ke\kekim" and Access Pending shows "ke\pending (KE\pending)". The comparison in `user-menu.ts` (and the Access Pending template) is case-sensitive. | Sign in with a Dev account that has no display name (`user-menu-open-1366x768` as `ke\kekim`; `sys-access-pending-1366x768` in the shell review). | Compare case-insensitively; show the account line only when it adds information. |
| BUG-4 | nit | **Contradictory toasts stack.** "You are out of office" is still on screen when "Welcome back / You show as available again." arrives (`im-back-toast-1366x768`). | Set out of office, then I'm back within 4 seconds. | A new availability toast replaces the previous one (same key). |
| BUG-5 | nit | **The sticky action bar covers the last field on a phone and is wider than the form on desktop.** | `profile-default-375x812`, `profile-bottom-1366x768`. | See P8. |

Checked and **no bug**: save, discard, conflict (409) and validation paths; the header label on 768; focus return after the dialog; axe on every state; the 403 for users without `Task.View`; `/profile` for a pending user redirects to Access Pending.

---

## 7. Proposed work packages and order

Estimates are AI-agent hours including unit tests, an e2e update and screenshots. Dependencies are in the last column.

| WP | Content | Findings | Effort | Depends on |
|---|---|---|---|---|
| WP-P1 | **Bugs**: page follows the shared availability state; clamp the header name; case-insensitive name/account; replace the previous availability toast | BUG-1 to BUG-4, P7 | 3 h | none; do first |
| WP-P2 | **Identity**: record-style header (name, context line, status chip, one primary action) and the read-only Account card; document title unchanged | P1, P11, P12 | 6 h | WP-P1 |
| WP-P3 | **Layout**: two columns from 1100 px, card look, one width per column, shared action bar, skeleton | P2, P8, P14 | 5 h | WP-P2 |
| WP-P4 | **Compact work hours**: day toggles plus one pair, per-day grid behind a link, same data model, a11y and e2e (SCN for hours) | P3, P13 | 8 h | WP-P3 |
| WP-P5 | **Account menu and phone**: identity and status row, out-of-office dot on the phone icon, dialog presets, no autofocus on the date field | P4, P5, P6, M1 | 5 h | WP-P1 |
| WP-P6 | **Time zone**: friendly select with local time and the display-zone sentence | P9 | 4 h | WP-P3 |
| WP-P7 | **Verification**: Playwright screenshots and axe at 375, 768, 1366, 1920 for the three states (available, out, errors); update `docs/ux/ux-spec.md` S23 and the UAT list | all | 2 h | all |

**Total: 33 agent-hours.** Suggested order: WP-P1, WP-P5 and WP-P2 can run in parallel; then WP-P3, WP-P4, WP-P6; WP-P7 last. If only one thing is done, do WP-P1 plus WP-P2 (9 h): they remove the only functional bug and make the page a profile.

**Product decisions needed before WP-P2 and WP-P6:** (1) whether the Account card shows the email at all (I assume yes: it is the person's own data); (2) whether the time-zone select should list only US zones (the firm works across all US zones, addendum M) or all of them behind "Other zones...". Neither blocks the rest.

---

## 8. Already decided or shipped (not re-recommended)

- Availability is operational information, never "unavailable"; work can still be assigned (S23).
- Status, dates, note, hours and zone in one form with one Save; Until optional; the sentence; the preview.
- The menu entries and their order, the dialog, "I'm back"; the Users administration column and the admin "Edit availability" dialog.
- No notification bell, no language setting, no sign-out (Windows authentication).

## 9. Phase 2 backlog (owner decision: no keyboard-shortcut recommendations now)

Not recommended in this review and not part of any work package: a shortcut to open the account menu or toggle out of office; a shortcut hint inside the Set out of office dialog.

## 10. What I did NOT verify

- A real screen reader; browsers other than Chromium; 200 and 400 percent zoom; Windows high-contrast mode; touch on a real phone (375 and 768 are emulated).
- The administrator's "Edit availability" dialog in Administration > Users (another review covers Users).
- Daylight-saving transitions and a profile zone different from the browser zone beyond reading the code (the e2e suite covers the clock change days).
- Real Active Directory display names (Dev auth only).
