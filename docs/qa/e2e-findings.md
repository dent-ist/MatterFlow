# Findings from the end-to-end suite

Application defects found while writing the Playwright suite (`docs/qa/e2e.md`, ticket #63). The suite does not fix application code. Each finding has a skipped `test.fixme` named `E2E-Fn` in `frontend/e2e/tests/`; remove the `fixme` when the defect is fixed. Found on `dev` at d6c0570, run against the production-built app served by the API.

| ID | Severity | Area | Finding |
|---|---|---|---|
| E2E-F1 | Minor | Task detail, workflow reopen | The UI and the API disagree about reopening a step of a **New** task, and the UI gives a wrong reason. |
| E2E-F2 | Minor | Task detail, assignment | A technician cannot hand a task without a Pod to a colleague from **Edit details**: the Assignee list holds only the current assignee. |
| E2E-F3 | Minor | API, concurrency | A SQL Server deadlock between two concurrent requests surfaces as `500 INTERNAL_ERROR` (seen once on `PUT /api/v1/workflows/{id}/versions/{versionId}` at the start of a run on a cold database). |

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

## E2E-F3: deadlock victim returned as 500

**What happens.** At the very start of a run on a fresh database, with two test workers creating configuration at the same time, one `PUT /api/v1/workflows/9/versions/9` (save draft with 3 steps) took 4.7 s and failed with `500 INTERNAL_ERROR`. The API log shows `Transaction (Process ID 56) was deadlocked on lock resources with another process and has been chosen as the deadlock victim`, wrapped in "An exception has been raised that is likely due to a transient failure. Consider enabling transient error resiliency by adding 'EnableRetryOnFailure'". The transaction rolled back; the same call succeeds when repeated. Error 1205 is a transient condition; the client gets an opaque 500 with only a trace id.

**Reproduce (not deterministic).** Start the API on an empty database (`frontend/e2e/run-local.sh`), then create steps and workflows in parallel from two clients (`POST /step-definitions`, `POST /workflows`, `PUT /workflows/{id}/versions/{v}` with 3 placements) right after startup. It happened once in about ten cold starts; warm databases did not show it in several hundred test runs.

**Expected.** Retry a deadlocked unit of work once or twice inside the API (or answer 409/503 with a retry hint) instead of a 500.

**Mitigation in the suite.** `Api.call` (used for setup, not for negative checks) retries a `500 INTERNAL_ERROR` once and logs `[e2e] ... retrying once`, and `global-setup.ts` warms the API before the workers start. If the warning shows up often, the defect is more than a cold-start effect. There is no `fixme` test for this one.

**Where.** `backend/src/Modules/MatterFlow.WorkflowEngine` (workflow draft save) and the `UseSqlServer` registration (no `EnableRetryOnFailure`, no deadlock retry).
