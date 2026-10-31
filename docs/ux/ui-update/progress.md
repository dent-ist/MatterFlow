# UI update: progress notes (epic #953)

Each agent edits only its own section. Newest entry first inside a section. Format: date, issue, what is pushed, what the other agent or QA can now use, open questions.

## Agent 1 (foundation and backend)

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

### 2026-10-31 UI-10 to UI-17 first build (refs #961 to #968)

- Pushed the shared blocks in `frontend/src/app/shared/ui/`: `status-chip.ts` (step n of m, hold/close detail), `priority-pill.ts`, `event-type.ts` (8 types, fixed icons), `filter-chips.ts`, `side-panel.ts` (rail, badges, `aria-expanded`), `tree.ts` (ARIA tree, keys, type-ahead, search), `grid-frame.ts` (fit-to-window card), `tip.ts` (hover and focus tooltip). Spec: `building-blocks.spec.ts`.
- Pushed the new page in `frontend/src/app/features/my-matters/ui/` (`shell.ts` is the page; the route `my-matters.routes.ts` now loads it). The old page and tabs are still in `pages/`, `panels/`, `tabs/` until UI-18 removes what is replaced.
- The page runs on `ui/mm-api.ts` (`MmApi`, an interface) with `EmptyMmApi` as a TYPED STAND-IN (it returns empty lists). FLAGGED: Agent 1, when `getMyMattersTree`, `getMyMattersEvents`, `getMyMattersUpcomingEvents`, create/update/deleteMatterEvent, `getMyMattersFeed`, `getMyMattersTaskCounts`, `getMyMattersAssets` and `getMyMattersAsset` are in the generated client, I swap `EmptyMmApi` for `GeneratedMmApi` (one file). The task grid already uses the real `getTaskQueue` (status, step n of m); the `show` parameter is mapped to the older query parameters (`overdue`, `atRisk`, `dueWithin`, `unassigned`, `priority`) until `show` exists.
- Calendar task due dates use the existing `getMyMattersCalendar`; Metrics reuses the existing Breakdown and Data components; New task, New asset and New project open the existing full forms with the matter prefilled (only New calendar item is a dialog). See deviations when UI-18 is done.

**Agent 2 requests (tokens, UI-01):** the new code reads these token names; please define them (or tell me your names and I rename in one pass): `--mf-event-court|trial|deposition|production|filing|mediation|meeting|other` (text and icon colour) and the same with `-bg` (tint), 4.5:1 pairs; `--mf-primary-contrast` (text on primary), `--mf-radius-xl` (12 px cards), `--mf-active` (the active-matter dot, teal), `--mf-st-new-line` (outline of the New chip), `--mf-tip-bg` and `--mf-tip-fg` (tooltip), `--mf-fs-h1-compact` (19 px page title). Existing `--mf-*` tokens are used for everything else; the UI-01 check should find no hard-coded colour in my files.

**Agent 2 requests (API):** none so far; the contract is followed as written. Open point: `markSeen` for the new feed uses the existing `markMyMattersActivitySeen({})` (no `upToEventId` = everything); please confirm that this moves the `seenAtUtc` marker of the feed.
