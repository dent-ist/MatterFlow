# Findings from the end-to-end suite

Application defects found while writing the Playwright suite (`docs/qa/e2e.md`, ticket #63). The suite does not fix application code. Each finding has a skipped `test.fixme` named `E2E-Fn` in `frontend/e2e/tests/`; remove the `fixme` when the defect is fixed. Found on `dev` at d6c0570, run against the production-built app served by the API.

| ID | Severity | Area | Finding |
|---|---|---|---|
| E2E-F1 | Minor | Task detail, workflow reopen | The UI and the API disagree about reopening a step of a **New** task, and the UI gives a wrong reason. |
| E2E-F2 | Minor | Task detail, assignment | A technician cannot hand a task without a Pod to a colleague from **Edit details**: the Assignee list holds only the current assignee. |

## E2E-F1: reopening a step on a New task

**What happens.** A task that was never started (status New) accepts step actions, so steps can be completed. The Task response then says `allowedActions.canReopenSteps: false` (`TaskActionRules.Compute` uses `TaskEditability.IsAllowed(status, StepReopen)`, which allows only In Progress and Completed), and the Workflow tab hides **Reopen step** and shows "You don't have permission to reopen steps." for a System Admin. The API endpoint `POST /api/v1/tasks/{id}/workflow/steps/{stepId}/reopen` nevertheless succeeds (200) for the same task.

**Reproduce.**
1. Create a task (status New, not started) with a 2-step workflow.
2. Complete step 1 (UI **Mark complete**, or the API).
3. Open the Workflow tab, expand step 1: no **Reopen step** button; the hint reads "You don't have permission to reopen steps."
4. `POST /api/v1/tasks/{id}/workflow/steps/{step1}/reopen` with the workflow `rowVersion`: 200, step 1 is In Progress.

**Expected.** One rule on both sides. Either completing a step on a New task starts the task (so reopen is allowed), or reopen is refused by the API for New tasks as well, and the UI hint says why ("Start the task first") instead of blaming permissions. Related: completing a step on a New task leaves the task New, which the sample scenarios do not expect (scenario 2 assigns the technician, which starts the task, before the first step).

**Where.** `backend/src/Modules/MatterFlow.WorkManagement/Application/TaskActionRules.cs` (`canStepReopen`), `.../Domain/TaskEditability.cs`, the step reopen endpoint in `TaskControllers.cs`; message in `frontend/src/app/features/tasks/detail/task-step.ts` (`blockedReason`).

**Test.** `workflow-steps.spec.ts`, `E2E-F1` (fixme). The reopen tests in the suite start the task first (`TaskApi.start()`).

## E2E-F2: Assignee list for users without User.View

**What happens.** In **Edit details** the Assignee dropdown is filled from `GET /api/v1/users?status=active` (`UsersClient.listUsers`, which needs `User.View`) plus the members of the task's Pod (`task-details-tab.ts`, `userOptions`). A Data Technician has `Task.Assign` but not `User.View`, so the user list call fails silently and the dropdown contains only "Unassigned", the current assignee and, when the task has a Pod, that Pod's members. The Create Task page does not have this problem because it uses `GET /api/v1/users/lookup`.

**Reproduce.**
1. Sign in as a user with the Data Technician role (`X-Dev-User: ke\tech`).
2. Open a task assigned to that user that has **no Pod**.
3. **Edit details**, open **Assignee**: only "Unassigned" and the user themselves are offered. A colleague who exists and is active cannot be chosen. With a Pod on the task, only members of that Pod can be chosen.

**Expected.** Anyone who may assign (`Task.Assign`) can pick any active user, as on Create Task (scenario SCN-006 says a technician can assign to another user without a manager).

**Where.** `frontend/src/app/features/tasks/detail/task-details-tab.ts` (around `usersApi.listUsers('active', undefined, 1, 100)`): use the lookup endpoint/`UserPicker` that Create Task uses.

**Test.** `assignment-and-views.spec.ts`, `E2E-F2` (fixme). The passing SCN-006 test gives the task a Pod containing both people.
