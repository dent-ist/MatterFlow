# UI update: progress notes (epic #953)

Each agent edits only its own section. Newest entry first inside a section. Format: date, issue, what is pushed, what the other agent or QA can now use, open questions.

## Agent 1 (foundation and backend)

### 2026-10-31 UI-07 (#960) theme adoption guide

- Section 7 of `docs/ux/theme-guide.md`: page checklist, shared components with snippets copied from the My Matters code, ordered page list with estimates (62 h in total), a before/after example. Docs only.

### 2026-10-31 UI-06 (#959) navigation

- The panel already had the navy look (MM-43/MM-58). Done now: Pod Work before Tasks (supersedes #952), panel width, row height, icon size (`--mf-nav-icon` 19 px), pill radius, rail width and child indent read tokens. The Task Queue keeps its label "Task Queue" ("Tasks" only for the compact menu, as before) to keep existing tests and links; owner may want it renamed. Specs of the layout folder pass (116), initial bundle 652.7 kB.

### 2026-10-31 UI-03, UI-04, UI-05 pushed (refs #956, #957, #958) - Agent 2 can swap to the generated client

- Commits 615d5d2 (backend, tests, script 49) and 3a9c43f (OpenAPI + nswag client regenerated; positional callers compile: `tsc` app, spec, e2e clean). Methods: `getMyMattersTree`, `getMyMattersEvents`, `getMyMattersUpcomingEvents`, `listMatterEventTypes`, `listMatterEvents`, `createMatterEvent`, `updateMatterEvent`, `deleteMatterEvent`, `getMyMattersFeed`, `getMyMattersTaskCounts`, `getMyMattersAssets`, `getMyMattersAsset`; `getTaskQueue` has `show` as its last parameter.
- Event permission assumption (for the owner): Primary and Secondary PM and `Matter.Edit` holders; no new permission. Deviation: order done 958 -> 957 -> 956 (the upcoming list needs the events table); activeDays setting is the config key `MyMatters:ActiveDays`, not an admin screen.
- Tests added (all pass): `MatterEventsApiTests` (6), `MatterEventsSensitiveTests` (1), `MyMattersUiUpdateTests` (7), catalog entries for 12 endpoints and the six-persona walk with events on every matter (walk passes), arch tests (47), schema tests (102), unit tests (2455). Changed a persona-walk id kind `MatterAsset`.
- QA must test: event create/edit/delete by Primary, Secondary, `Matter.Edit` holder and a stranger; a sensitive matter's events, assets, tree row, feed items for a stranger (404/absent); Show chips equal task-queue totals; overdue never counts On Hold; tree active flag after adding an asset; feed unread and Mark as read; script 49 replay on a fresh DB.
- NOT run: full integration suite, Playwright, performance on large data (the new queries are grouped; no budget test added).

### 2026-10-31 Answers to Agent 2 requests (token pass 2)

- Defined with your names: `--mf-event-*-fg/-bg` (already there), `--mf-radius-xl`, `--mf-primary-contrast`, `--mf-active`, `--mf-st-new-line`, `--mf-tip-bg`, `--mf-tip-fg`, `--mf-fs-h1-compact` (19 px). Contrast pairs for them are in the check.
- `markMyMattersActivitySeen({})` moves the same `seenAtUtc` marker the new feed uses (confirmed by design in the contract, section 3; I will cover it with a test in UI-03).

### 2026-10-31 UI-01 (#954) design tokens - Agent 2 can start UI-10

- Tokens are in `docs/ux/tokens.css` (single source, loaded by `angular.json`); guide `docs/ux/theme-guide.md`. New layers: palette `--mf-p-*`, semantic `--mf-sem-{overdue,risk,info,healthy,person,critical,neutral}-{fg,bg,solid,line}`, task status `--mf-status-{new,progress,hold,done,cancel}-{fg,bg,line}`, event types `--mf-event-{court,trial,deposition,production,filing,mediation,meeting,other}-{fg,bg}`, nav geometry `--mf-nav-w/-rail-w/-item-h/-icon`, radius `--mf-radius-md/-xl/-pill`, `--mf-fs-title` (19 px), density `--mf-ctl-h`, `--mf-ctl-h-sm`, `--mf-chip-h`, `--mf-gutter`, shadows `--mf-shadow-card/-pop`.
- Rules for new code: NO colour literals. `npm run lint` now also runs `scripts/check-theme-colours.mjs` (a new file with a hex/rgb literal fails; old files are in a ledger `scripts/theme-colours-baseline.json` that may only shrink) and `scripts/check-theme-contrast.mjs` (54 pairings). Put a reason after `theme-colour-ok:` on a line only for data colours that cannot be tokens.
- PrimeNG preset reads the tokens (`mf-preset.ts`). Old `--mf-st-*` status tokens are unchanged for unconverted pages; use `--mf-status-*` in new code.
- Checks run: contrast + colours scripts, eslint on the theme folder, prettier, theme unit specs (4 pass), `ng build` (initial 652 kB).

### 2026-10-31 UI-02 (#955)

- Pushed `docs/ux/ui-update/api-contract.md` (first version). Agent 2 can code against it now; every later change is a dated line in its change log.
- Assumption recorded for the owner (also in #958): events are created, edited and deleted by the matter's Primary and Secondary PM and by holders of `Matter.Edit`. No `Matter.*Manage` permission exists and none is invented.
- Existing endpoints that already do part of the work (no new code needed): task status, `sort=status`, `workflow.currentStepNumber/stepsTotal` on `GET /task-queue`.

## Agent 2 (My Matters frontend)

### 2026-10-31 hand-back: UI-10 to UI-18 built, API swap pending (refs #961 to #969)

**Built (all on `ui-update`, frontend only; the backend and the navigation are Agent 1's):**

- UI-10 #961 shared blocks in `frontend/src/app/shared/ui/` (`status-chip`, `priority-pill`, `event-type`, `filter-chips`, `side-panel`, `tree`, `grid-frame`, `tip`); guide `docs/ux/ui-update/shared-blocks.md`; spec `building-blocks.spec.ts`.
- UI-11 #962 page shell `features/my-matters/ui/shell.ts` (route `my-matters.routes.ts` loads it): title with icon and workflow bar, Client and Matter dropdowns (`mf-search-select`), Browse, Clear, + New, five tabs, address state (`mm-scope.ts`), tree and side panel layout rules (`mm-layout.ts`, spec), fit-to-window frames, phone cards.
- UI-12 #963 tree panel and rail (`tree-panel.ts`): search, Active only, Expand all, pin, collapse, legend, remembered open clients, Browse popover below 1100 px.
- UI-13 #964 Overview (`overview.ts`, `task-list.ts`): Status chips with counts, Show filter, urgency order, status chip with step n of m, side panel with Upcoming events and Recent activity (six kinds, View all), rail with badges.
- UI-14 #965 `+ New` (`new-menu.ts`) and the calendar item dialog (`event-dialog.ts`).
- UI-15 #966 Calendar tab (`calendar-tab.ts`), UI-16 #967 Assets tab (`assets-tab.ts`), UI-17 #968 Metrics (`metrics-tab.ts`, reuses Breakdown and Data) and Activity (`activity-tab.ts`).
- UI-18 #969 old page, panels, filter bar, Focus control, old Activity tab, pre-filter and their specs removed; decisions addendum AP (`docs/requirements/decisions-addendum.md`); after screenshots in `docs/ux/ui-update/after/` (mock API answers, dev stub user "Kim Admin"; real-stack shots are for QA).

**Needs Agent 1 (the one open item): the swap.** The page still runs on `ui/mm-api-interim.ts` (`InterimMmApi`), which calls the contract endpoints by address with `HttpClient`, because the generated client had no `getMyMattersTree`, `getMyMattersEvents`, `getMyMattersUpcomingEvents`, `listMatterEventTypes`, `create/update/deleteMatterEvent`, `getMyMattersFeed`, `getMyMattersTaskCounts`, `getMyMattersAssets` or `getMyMattersAsset` at the time of this hand-back. FLAGGED. When they are in the client: write `GeneratedMmApi` (one file, same `MmApi` methods), change the one provider line in `shell.ts`, delete `mm-api-interim.ts` and `EmptyMmApi`. `getTaskQueue` also gets `show` (UI-04): `statusShowParams()` in `task-list.ts` maps the Show filter to the older query parameters now; switch to `show` and drop the mapping. Regenerate the client after every rebase; nothing generated was edited by hand.

**Specs edited or removed (for QA, one list):** removed (they drove the old page): `mm-calm-b1/b2/b3/b4/b6`, `mm-calm-budget`, `mm-controls-tabs`, `mm-fit`, `mm-focus-scroll`, `mm-activity-breakdown`, `pm4-layout`, `pm4-my-matters`, `pm4-all-scope`, `px4-tabs`, `px7-add-work`, `pv-pm-ui`, `pv-data-tab`, `support/calm-metrics.ts`, `support/mm-header.ts`; the unit specs `pages/my-matters-page.spec.ts`, `tabs/activity-tab.spec.ts`, `tabs/tabs-helpers.spec.ts`, `my-matters-active-filters.spec.ts`, `prefilter.spec.ts` and the Focus-chip and pre-filter cases of `focus.spec.ts` and `my-matters-filters.spec.ts`. Edited: `px6-matrix` (five tabs, tab walk), `pm5-access` (keyboard and axe tests rewritten for the new page), `pv-final-gate` (five tabs, Status chip keys), `pv-export` (Metrics address), `pv-task-types-on-hold` (last describe removed), `px3-scope` (last describe removed), `sensitive-leak-scan` (new tab addresses). Added: `mm-ui-update.spec.ts` (page, filters, tree, + New, fit-to-window, phone, axe, calendar events, assets, activity). Lost coverage that QA should decide on: the Focus checklist, the "My matters / All matters" switch on the page, the Overview links into the Task Queue, the old row actions.

**Cheap checks run:** `ngc` of the app (template type check), `tsc` of the specs and of `e2e/tsconfig.json`, `npm run lint` (eslint, theme colour check, contrast check), prettier on `src`, `projects` and `e2e`, unit tests of `shared/ui/building-blocks`, `features/my-matters/**`, `features/matters/**` and `shared/layout/initial-bundle` (226 pass), production build (initial bundle 652.5 kB, no style budget warning from the new files), and a browser run of the page against contract-shaped fixture answers: axe (wcag2a, wcag2aa, wcag21aa, best-practice) clean on five tab views at four sizes, interaction checks (+ New menu, calendar item dialog, tree choose and rail, tree keys, calendar day list, asset side panel).

**NOT run:** the new and edited Playwright specs, the backend, any e2e on a real database (the endpoints did not exist yet), the full unit test suite, performance, the sensitive-matter e2e.

**Deviations from the brief, for the owner:** (1) New task, New asset and New project open the existing full forms with the matter prefilled (they carry task types, workflows and type-specific fields); only New calendar item is a dialog. (2) The "My matters / All matters" switch and the Focus checklist are not on the new page (the mockup has neither); `?scope=all` still works by address. (3) Metrics Breakdown numbers still open the Task Queue (the existing links) instead of returning to the Overview with a chip. (4) The side panel and tree states are remembered in the browser only; they are not in the address (`side=` and `tree=` of the mockup are not built). (5) No highlight flash on a choice; the polite announcement is there. (6) The Show dropdown is a native select with counts.

**Risks:** the page depends on the contract shapes exactly (a field renamed in the generated client shows as a compile error at the swap); the calendar takes its task due dates from `getMyMattersCalendar` (a busy day may be capped there); the harness used a stub user, so the permission-limited states are only unit-tested.
