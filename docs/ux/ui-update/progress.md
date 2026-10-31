# UI update: progress notes (epic #953)

Each agent edits only its own section. Newest entry first inside a section. Format: date, issue, what is pushed, what the other agent or QA can now use, open questions.

## Agent 1 (foundation and backend)

### 2026-10-31 UI-02 (#955)

- Pushed `docs/ux/ui-update/api-contract.md` (first version). Agent 2 can code against it now; every later change is a dated line in its change log.
- Assumption recorded for the owner (also in #958): events are created, edited and deleted by the matter's Primary and Secondary PM and by holders of `Matter.Edit`. No `Matter.*Manage` permission exists and none is invented.
- Existing endpoints that already do part of the work (no new code needed): task status, `sort=status`, `workflow.currentStepNumber/stepsTotal` on `GET /task-queue`.

## Agent 2 (My Matters frontend)

(not started)
