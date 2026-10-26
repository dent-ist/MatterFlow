# My profile review: delivery plan

Owner approval: "I like all of your recommendations, so please don't wait for me. create epics / issues and continue working" (2026-10-20), with product decisions delegated to the PM ("you can make decisions for me"). Decisions are recorded as "Decision (PM)" in each issue's "PM requirements review" comment and summarised below. Date of this plan: 2026-10-20, base `origin/dev`. Source review: `README.md` in this folder (14 findings P1 to P14 with P10 a "no change", the M1 nit, BUG-1 to BUG-5, 7 work packages, screenshots in `screenshots/`, two mocks in `mocks/`).

Structure on GitHub: one epic **#520** (labels `epic` + `phase-14`), **21 sub-issues** (label `phase-14`): #521, #525, #527, #528, #529, #531, #532, #534, #535, #536, #538, #539, #540, #567, #578, #580, #582, #584, #589, #595, #601 (numbers are not contiguous because the parallel planning agents of the other epics create issues at the same time). Two more issues, #522 (BUG-2) and #524 (BUG-3), were created and closed as duplicates of the App shell epic's #592, which owns them (see section 2). None is decided "not now". Folded IDs (named in the host issue title, nothing dropped): P7 in #521; P12 in #528 (with P11); BUG-5 in #531 (with P8); P3 is split in #534 (compact control) and #535 (per-day grid); P13 in #536; M1 and the "More options" part of P6 in #539; P9 is split in #540 (select) and #567 (local time and display-zone sentence); P10 (no language setting) is recorded as a decision in the docs issue #595, no code. "Verified good" items of the review (focus return after the dialog, 409 handling, the dirty guard, validation summary, 0 axe violations on every state, the 403 page without `Task.View`) are regression tests only.

Issues blocked on an owner decision: **none**. The two questions the review put to the owner (section 7) are decided by the PM: (1) the Account card **shows the email** (the person's own data); (2) the time zone select lists **the US zones first (Eastern, Central, Mountain, Pacific, Alaska, Hawaii, Arizona) and all other zones behind "Other zones..."**.

Effort is in **AI-agent hours** (wall-clock of one developer agent, including unit, e2e, axe and screenshots). The review estimated 33 hours; the plan is **44.5** because the review did not count the keyboard and Tab-stop evidence, the permission matrix, the regression of the shared form in the Users dialog and the docs issue (together 8.5 h), and it counted the long-name clamp and the case-insensitive name rule (2 h) that the App shell epic now owns. The first release is **2.5 h** of Profile work plus the two shell issues it depends on.

## 1. Issue list

| # | ID | Title (short) | Agent-h | Depends on | Package |
|---|---|---|---|---|---|
| #521 | BUG-1, P7 | My profile follows the header menu (Set out of office and I'm back update the open page) | 2 | None. First release. | WP-PF1 (R1) |
| #525 | BUG-4 | Availability toasts pass one key so a new one replaces the previous | 0.5 | Shell #591 (keyed toasts) first. First release. | WP-PF1 (R1) |
| #527 | P1 | Read-only Account card (name, account, email, roles, pods with the primary one marked) | 3.5 | None (new file). | WP-PF2 |
| #528 | P11, P12 | Profile header content (name, context line, status chip, one primary action) on the shared header contract; preview text under Status | 2.5 | #521; shell #592, #600, #604 | WP-PF2 |
| #529 | P2 | Two columns from 1100 px, one card style, one width per column | 3 | #527 | WP-PF3 |
| #531 | P8, BUG-5 | Sticky action bar the width of its column, shared shadow, "No unsaved changes" | 2 | #529 | WP-PF3 |
| #532 | P14 | Skeleton while loading and the shared record state on a load error | 1.5 | #528, #529 | WP-PF3 |
| #534 | P3 | Compact work hours: day toggles plus one start/end pair | 5 | #529, #531 | WP-PF4 |
| #535 | P3 | "Different hours on some days" opens the per-day grid; a differing week opens it by itself | 3 | #534 | WP-PF4 |
| #536 | P13 | Reset and Copy Monday are the same quiet button; copy pass | 1 | #535 | WP-PF4 |
| #538 | P6 | Set out of office dialog presets (Rest of today, Until tomorrow, Until Monday, 1 week, Pick a date) | 2.5 | None | WP-PF5 |
| #539 | M1, P6 | No autofocus on the date field; focus the heading; "More options on My profile" | 1.5 | #538 | WP-PF5 |
| #580 | P5 | Account menu starts with a non-interactive identity and status row | 2 | Shell #592; #521 | WP-PF5 |
| #578 | P4 | Out-of-office dot on the phone user icon | 1 | Shell #592; #580 | WP-PF5 |
| #540 | P9 | Time zone select with friendly names and Other zones | 2.5 | Component: none. Wiring: #529 | WP-PF6 |
| #567 | P9 | Local time there and the display-zone sentence | 1.5 | #540 | WP-PF6 |
| #582 | P3 evidence | Keyboard and axe audit with Tab-stop evidence (no shortcut changes) | 1.5 | WP-PF1 to WP-PF6 | WP-PF7 |
| #584 | Permissions | Permission and state matrix for the page, menu and dialog | 1.5 | #527, #580 | WP-PF7 |
| #589 | Regression | Administration > Users "Edit availability" dialog with the shared form changes | 1.5 | #534, #535, #540, #531 | WP-PF7 |
| #595 | Docs | ux-spec S23 and 5.1, decisions section, UAT rows, e2e catalogue | 2.5 | All code issues | WP-PF8 |
| #601 | Verification | Final verification pass for My profile | 2.5 | All issues | WP-PF8 |

Total: **44.5 agent-hours** (21 issues). R1 = first release. Review ID to issue: BUG-1 #521, BUG-2 #522 (closed, shell #592), BUG-3 #524 (closed, shell #592), BUG-4 #525 (mechanism: shell #591), BUG-5 #531; P1 #527, P2 #529, P3 #534 and #535, P4 #578, P5 #580, P6 #538 and #539, P7 #521, P8 #531, P9 #540 and #567, P10 #595 (decision only), P11 #528, P12 #528, P13 #536, P14 #532, M1 #539.

## 2. Decisions (PM) in one place

- **Cross-epic ownership (App shell #585).** The shell planner assigned: BUG-2 (long-name clamp) and BUG-3 (case-insensitive name/account, `sameIdentity` helper) to **#592**; the keyed, de-duplicating toast mechanism to **#591**; the page-header contract to **#600**, the My profile header move to that contract to **#604** (header block only); the skip-link target, unified toasts and offline banner are the shell's. The account menu identity row (P5, #580) and the phone dot (P4, #578) are **built here** (shell #629 was closed as a duplicate of them). Rule for lane order on `shared/layout/user-menu.ts`: #592, then #580, then #578. The Profile epic never forks the header, the toast host or the helper.
- **BUG-1 (#521).** The form re-baselines from the shared `MyAvailability` store when clean; when dirty the edits stay and the existing conflict text appears with a Load latest button. No polling, no new endpoint.
- **Identity (#527, #528).** Account card is read-only with "Managed by your administrator."; roles by name, primary Pod first; email shown. The header shows the person's name (account when none), the context line (role, primary Pod), the availability chip and one primary action: **Set out of office...** or **I'm back**. No Edit, no Activity, no overflow. The header shape is the shell's contract; the content is ours.
- **Layout (#529, #531, #532).** Two columns from 1100 px (Availability, Work hours left; Account right); below 1100 one column, Account last; bordered 8 px cards; the action bar is the column's width, Save stays disabled until a change and "No unsaved changes" explains it; skeleton and the shared record state for a failed load.
- **Work hours (#534, #535, #536).** Day toggles (`aria-pressed`) and one pair, native time fields kept; the data model (`workHours`) is unchanged; a week whose days differ opens the per-day grid and is never collapsed (no silent data loss); Tab stops from about 50 to at most 18.
- **Dialog (#538, #539).** Presets fill Until, which is the last day out (Rest of today = today, Until tomorrow = tomorrow, Until Monday = the next Monday, 1 week = today + 7), computed in the profile time zone; the sentence under the date names the return day. Focus goes to the dialog heading, not the date field, so no on-screen keyboard opens and a stray Enter applies nothing; link "More options on My profile".
- **Time zone (#540, #567).** US zones first plus Arizona, "Other zones..." opens the existing searchable list; the browser zone and a saved legacy zone always stay selectable and are never overwritten silently; the local time there and the display-zone sentence (addendum M) are shown.
- **No language setting (P10).** The product stays English only; date and time formats follow the browser locale. Recorded in the decisions addendum by #595.
- **Keyboard (owner decision).** No new or changed keyboard shortcut in this phase (Phase 2 backlog #420); the "Keyboard shortcuts" menu entry and all existing shortcuts stay exactly as they are. Accessibility mechanisms (focus management, buttons, skip-link target) are in scope.
- **Additive API (none).** Everything the plan needs is on `/me` and `GET/PUT /me/availability`; the time zone string and `workHours` are unchanged. **SQL: none. Next free script number is 28.** Backend work: none.
- **Out of scope.** Editing name or email, a language setting, notifications, sign out, a custom time picker, split shifts, a map time zone picker, changing the display time zone elsewhere in the app (addendum M), keyboard shortcuts, the Users page and its drawer (Users epic #422), screen-reader and forced-colours testing.

## 3. Work packages (ranked)

Rules for developer agents: branch from `origin/dev`, rebase before each push, touch only the files of your package unless the issue says otherwise, run unit + e2e + axe (0 violations at 1366, 1920, 768 and 375, with menus, dialogs and drawers open) and assert no page-level horizontal scroll, attach screenshots in `docs/ux/profile-review/fixes/<package>/` (`pf1-bugs`, `pf2-identity`, `pf3-layout`, `pf4-work-hours`, `pf5-menu`, `pf6-time-zone`, `pf7-audit`, `final`), keep the initial bundle at its current size, add no new token, add no keyboard shortcut. Shared files (`record-skeleton.ts`, `record-state.ts`, `mf-form-actions`, `availability-form.ts`, `user-menu.ts`) serve other pages and epics: their specs are regression tests and changes are additive. **SQL scripts:** none planned; the next free number is **28** (latest `27-dashboard-unassigned.sql`). **Backend work:** none.

| Rank | WP | Issues | Main files / areas | Agent-h | Parallel with | Waits for | Backend / SQL |
|---|---|---|---|---|---|---|---|
| 1 | WP-PF1 Bugs | #521, #525 | `availability-form.ts`, `my-availability.ts`, `availability-edit.ts` (call sites) | 2.5 | all | #525 waits for shell #591 | Frontend only |
| 2 | WP-PF2 Identity | #527, #528 | new `account-card.ts`, `profile-page.ts`, `availability-chip.ts` | 6 | WP-PF5, WP-PF6 (component) | #528: #521, shell #592, #600, #604 | Frontend only |
| 3 | WP-PF3 Layout | #529, #531, #532 | `profile-page.ts/.scss`, `availability-form.ts/.scss`, `record-skeleton.ts` (additive kind) | 6.5 | WP-PF5, WP-PF6 | #527; #532 also #528 | Frontend only |
| 4 | WP-PF4 Work hours | #534, #535, #536 | new `work-hours-compact.ts`, `availability-form.ts` | 9 | WP-PF5, WP-PF6 | WP-PF3 | Frontend only |
| 5 | WP-PF5 Menu and dialog | #538, #539, #580, #578 | `set-out-of-office-dialog.ts`, `user-menu.ts/.scss` | 7 | WP-PF2, 3, 4, 6 | #580 and #578 wait for shell #592 | Frontend only |
| 6 | WP-PF6 Time zone | #540, #567 | new `time-zone-select.ts`, `availability-form.ts` (wire) | 4 | WP-PF2, 3, 5 | wiring waits for #529 | Frontend only |
| 7 | WP-PF7 Keyboard, permissions, regression | #582, #584, #589 | e2e specs, small fixes, `availability-dialog.ts` | 4.5 | none (late) | WP-PF1 to WP-PF6 | none |
| 8 | WP-PF8 Docs and final verification | #595, #601 | `docs/ux/*`, `docs/requirements/decisions-addendum.md`, `docs/qa/e2e.md`, `frontend/e2e/*` | 5 | none | all | none |

Total: **44.5 agent-hours**.

### First release (the defects that hurt today)

#521 (BUG-1: the page does not follow the header menu, 2 h) and #525 (BUG-4: contradictory toasts, 0.5 h, after the shell's #591). The shell epic's first release also removes the long-name header wrap and the doubled name/account line (#592, 1 h) and the stacking toasts mechanism (#591, 1.5 h), which are the other three profile defects. Together: the bugs of the review are fixed in about 2.5 h of Profile work plus 2.5 h of shell work, all independent of the redesign. BUG-5 (the action bar covering the last field on a phone) is a nit and ships with #531.

### Waves for up to 3 parallel developer agents

Lanes are file owners: one agent owns one lane's files for the whole epic, which removes merge conflicts. Lane A owns the profile page and `availability-form.ts`, lane B the header user menu and the Set out of office dialog, lane C the new standalone components (Account card, time zone select) and then tests and docs.

- **Wave 1 (first release plus standalone components)**
  - Lane A (2 h): #521
  - Lane B (3 h): #538, #539 (and #525 as soon as shell #591 has merged)
  - Lane C (6 h): #527, #540 (component only, not yet wired)
- **Wave 2**
  - Lane A (18.5 h): #528 (when shell #604 has landed; else start with #529), #529, #531, #532, #534, #535, #536
  - Lane B (3 h): #580, #578 (after shell #592)
  - Lane C (1.5 h): wire #540 after #529, then #567
- **Wave 3**
  - Lane B (3 h): #584, #589
  - Lane C (1.5 h): #582
- **Wave 4 (docs)**
  - Lane C (2.5 h): #595
- **Wave 5 (verification)**
  - Lane C (2.5 h): #601

Lane totals: A 20.5 h, B 10.5 h (including #525), C 15 h. With three agents the wall-clock is about **28 hours** (lane A 20.5, then #582, #595, #601 in lane C); one agent alone needs 44.5.

### Exact first wave

1. Lane A: #521. 2. Lane B: #538 then #539, and #525 once shell #591 has merged. 3. Lane C: #527 then the #540 component. Next after wave 1: lane A continues with #529 and, once shell #604 is on dev, #528.

### Critical path

#521 (2) -> #529 (3) -> #531 (2) -> #534 (5) -> #535 (3) -> #536 (1) -> #582 (1.5) -> #595 (2.5) -> #601 (2.5), with #528 (2.5) and #532 (1.5) in lane A between them: about 28 hours. Lane B has about 17 hours of slack, lane C about 10.

### Hot spots (merge-conflict watch)

- **`shared/availability/availability-form.ts` (653 lines) and `.scss`**: #521, #528 (preview text), #529, #531, #532, #534, #535, #536, then the wiring of #540 and the regression #589; one agent (lane A); lane C's wiring of #540 is a few lines and rebases. It is also used by the Users epic's Edit availability dialog (#440 of #422): additive changes only, a `variant` input if the layouts must differ.
- **`shared/layout/user-menu.ts`**: shell #592 first, then #580, #578; #525 touches call sites only. The App shell epic (#585) owns the rest of the header.
- **`shared/availability/set-out-of-office-dialog.ts`**: #538 then #539, one agent.
- **`features/profile/profile-page.ts`**: #527 (place the card), #528, #529, #532; shell #604 edits its header block only (land first or rebase).
- **`record-skeleton.ts` / `record-state.ts`**: additive only (#532); the Client, Matter, Project and Task page specs are the regression tests.
- **Tests**: older e2e for profile and availability (`profile-availability`, user menu specs) select the old Loading text, the grid rows and the dialog's autofocus; the package that changes the behaviour updates them.

### Extension points

- **Work hours compact control (#534):** a standalone component emitting the same `workHours` array; the Users dialog can use it unchanged.
- **Time zone select (#540):** standalone component with the same string value; reusable wherever a zone is chosen.
- **Account card (#527):** reads the signed-in `/me` only; a later "view someone else" page would need a different data source.

### Definition of done per package

Issues closed, tests green twice (including permission variants), axe clean at four sizes with overlays open, no page-level horizontal scroll, screenshots in `fixes/<package>/`, bundle and style budgets kept, API unchanged, the docs named in the issue noted for #595, the epic #520 tasklist ticked, and the line below added to the Status section.

### Docs package (WP-PF8, #595)

`ux-spec.md` S23 and Section 5.1 rewritten to the code (identity header, Account card, two columns, compact hours, presets, time zone select, menu identity row, phone dot, copy deck, UAT rows), a section of the decisions addendum for this epic holding every Decision (PM) above (take the next free letter on dev at that time: parallel epics also claim letters, the shell epic uses AE and the Users epic Z), `docs/qa/e2e.md` for the new specs, a banner in the review README, and the P10 decision (no language setting). Where the code differs from the issues, the docs follow the code and say so.

### Final verification package (WP-PF8, #601)

Contract e2e at four sizes over the review's personas (available, out, errors, loading, load error, long name, no display name): axe 0 including `target-size`, no sideways scroll, the first screen fits at 1366x768, at most 18 Tab stops to Save, one primary action in the header; the state and permission matrix; regression subsets for every shared file touched (record skeleton, user menu, Users Edit availability dialog); the before/after table of the review's measurements; bundle report; screenshots in `fixes/final/`; a comment on the epic with the open items. It uses its own e2e stack and ports and never stops processes or containers of another agent's run.

## 4. Status

(One line per work package; keep other packages' lines when merging. Format: `WP name (date, commit): issues done / open; tests; bundle size; screenshots folder; known limits.`)

- Owner decision (2026-10-20): no new or changed keyboard shortcuts in this phase; the existing "Keyboard shortcuts" menu entry and shortcuts stay as they are (Phase 2 backlog #420).
- Planning (2026-10-20): epic #520 and 21 sub-issues created and linked; PM requirements review comments posted on every issue; #522 and #524 closed as duplicates of the App shell epic's #592; no issue is blocked on the owner; SQL script 28 is free and none is planned.
- WP-PF1 Bugs (2026-10-25): #521, #525 done (earlier commits); e2e `profile-pf1-bugs`; screenshots `fixes/pf1-bugs/`.
- WP-PF2 Identity (2026-10-26): #527 done, #528 done (header: name, context line, chip, one primary action; no avatar or icon); e2e `profile-pf2-account`, `profile-pf3-layout`; screenshots `fixes/pf2-identity/`.
- WP-PF3 Layout (2026-10-26): #529, #531, #532 done (two columns from 1100 px, card style, bar, skeleton and record state `profile`); first screen at 1366x768 holds Availability, Work hours with the time zone and the bar (Notifications sits in the right column); e2e `profile-pf3-layout`; screenshots `fixes/pf3-layout/`.
- WP-PF4 Work hours (2026-10-26): #534, #535, #536 done; 18 Tab stops from Status to Save (was about 50); e2e `profile-pf4-hours-zone`; screenshots `fixes/pf4-work-hours/`.
- WP-PF5 Menu and dialog (2026-10-26): #538, #539 (earlier), #580, #578 done; e2e `profile-pf5-dialog`, `profile-pf5-menu`; screenshots `fixes/pf5-menu/`.
- WP-PF6 Time zone (2026-10-26): #540, #567 done (select, saved and browser zones as extra options, local time, display-zone sentence); screenshots `fixes/pf6-time-zone/`.
- WP-PF7 Keyboard, permissions, regression (2026-10-26): #582, #584, #589 done; e2e `profile-pf7-keyboard`, `profile-pf7-permissions`, `profile-pf7-users-dialog`; evidence `fixes/pf7-audit/`.
- WP-PF8 Docs and final verification (2026-10-26): #595, #601 done; `profile-pf8-final`; `fixes/final/` with the before and after table.
