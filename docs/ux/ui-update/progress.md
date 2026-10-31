# UI update: progress notes (epic #953)

Each agent edits only its own section. Newest entry first inside a section. Format: date, issue, what is pushed, what the other agent or QA can now use, open questions.

## Agent 1 (foundation and backend)

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
