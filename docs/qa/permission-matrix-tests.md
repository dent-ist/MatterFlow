# Permission Matrix Test Design

Source: `architecture.md` section 6 (catalog 6.3, pipeline 6.1, policies 6.5, CSRF 6.6), section 11 (endpoint groups, error codes), addendum E. Delivered by #16, #17 (authorization), #23, #24, #25 (identity admin) and exercised by every feature ticket that adds an endpoint. Findings affecting this design: FND-03 (permission code drift), FND-04 (activity values), FND-06 (step reopen), FND-16 (Pod Work visibility).

## 1. Principles

1. **Generated, not hand-written.** A test generator reads `contracts/openapi/v1.json` (each operation carries `x-permission`, a list of required codes, per architecture 11) and `contracts/permissions.json`. For every operation it produces cases automatically. A new endpoint without `x-permission` and without an explicit `[AllowAuthenticated]` fails the architecture test (L2) and the generator.
2. **Four identities per operation:** (a) unauthenticated, (b) `NoRole` (zero permissions), (c) `OnlyMissing` = a custom role holding every permission the operation needs except one (repeated for each required code), (d) `Exact` = a custom role holding exactly the required codes. Plus System Admin and the five starter roles for the role matrix (section 4).
3. **Expected results:** (a) 401 `UNAUTHENTICATED`; (b) 403 `ACCESS_PENDING` (any endpoint except `GET /me`); (c) 403 `PERMISSION_DENIED` with `meta.missingPermission` equal to the withheld code, **and no state change and no audit row**; (d) the success status of the operation (using prepared valid payloads); System Admin: success.
4. **Order of checks:** authentication, then access pending, then permission, then validation, then existence. A user without permission gets 403 even for a nonexistent id (no existence oracle): test with id 999999.
5. **Backend authoritative:** Angular gating is tested separately in FT (hidden controls); the API tests never rely on the UI.
6. Role semantics are tested by permission set, never by role name (L2 architecture test bans role-name string comparisons).

## 2. Cross-cutting negative cases (hand-written)

| ID | Layer | Case | Expected |
|---|---|---|---|
| PM-X-01 | IT | Unauthenticated request to every operation | 401 |
| PM-X-02 | IT | Zero-permission user: all operations except `GET /me` | 403 `ACCESS_PENDING`; `GET /me` 200 `{status:"ACCESS_PENDING"}` and nothing else useful |
| PM-X-03 | IT | Disabled user (`IsActive=false`) valid Windows identity | 403 `ACCOUNT_DISABLED` everywhere including `/me` status |
| PM-X-04 | IT | Permission removed mid-session, no re-login | Next request denied (cache invalidated); with a second node simulated (cache not invalidated) worst case 60 s documented (FND-19) |
| PM-X-05 | IT | Role added mid-session | Allowed on next request |
| PM-X-06 | IT | User with multiple roles | Permissions additive; removing one role removes only its exclusive permissions |
| PM-X-07 | IT | Mutating call missing `X-MatterFlow-Client`, wrong content-type, `Sec-Fetch-Site: cross-site` | 400 / 403 before permission logic; no state change |
| PM-X-08 | IT | Search/lists with partial view permissions | Search groups only for types the user may view; counts/totals do not leak hidden types |
| PM-X-09 | IT | Multi-permission endpoints (see section 3 flagged rows) | Each sub-permission checked; denial of one sub-permission rejects the **whole** request, no partial update |
| PM-X-10 | UT (arch) | Every controller action has a permission policy or `[AllowAuthenticated]`; only `/me` is the latter | Pass |
| PM-X-11 | IT | System Admin role cannot be edited or deleted; roles in use cannot be deleted; last active admin cannot be disabled or demoted | 409 `LAST_ADMIN` / validation errors |
| PM-X-12 | IT | Privilege escalation: user with `User.Manage` assigns System Admin to self or others, or grants a role carrying permissions they do not hold; user with `Role.Manage` adds a permission they do not hold to a role | **Enforced (SEC-01):** 403 `PERMISSION_DENIED`. Only a System Admin may grant or revoke the System Admin role or activate/deactivate a System Admin; everybody else may grant only roles whose permissions they hold, and add only permissions they hold to a role. Tests: `IdentityPrivilegeTests` |
| PM-X-13 | IT | Bootstrapped admin revoked, logs in again | Not re-granted (ADMIN_BOOTSTRAPPED once) |
| PM-X-14 | IT | Dev auth provider in production configuration | Not available (SEC-DEV-01) |
| PM-X-15 | IT | IDOR: user with `Task.Edit` PUT /tasks/{id} for a task on any Matter | Allowed (Phase 1 visibility: anyone with `Task.View` sees all; E1). The test documents that there is deliberately no Matter-level denial |

## 3. Endpoint x permission catalogue (the generator's oracle)

"All of" = every listed code is required (sub-permission checks). The status column is the expected success code for `Exact` role.

| Area | Operation | Required permission(s) | Success | Notes / negative specifics |
|---|---|---|---|---|
| Identity | GET /me | authenticated only | 200 | Only `AllowAuthenticated` |
| | GET /users, GET /users/{id} | `User.View` | 200 | |
| | PUT /users/{id} (activate/disable/name) | `User.Manage` | 200 | Last-admin guard |
| | PUT /users/{id}/roles | `User.Manage` (+ `Role.Manage`? FND-03) | 200 | Audit `ROLE_GRANTED/REVOKED` |
| | GET /roles, GET /roles/{id}, GET /permissions | `User.View` (the user drawer lists roles; decided in security review SEC-15, code is authoritative) | 200 | |
| | POST/PUT /roles | `Role.Manage` | 201/200 | System Admin role locked |
| | GET /pods | `Pod.View` | 200 | |
| | POST/PUT /pods | `Pod.Manage` | 201/200 | |
| | PUT /pods/{id}/members | `Pod.ManageMembers` | 200 | |
| Organization | GET /clients, /clients/{id}, lookup | `Client.View` | 200 | |
| | POST /clients | `Client.Create` | 201 | |
| | PUT /clients/{id} (non-number fields) | `Client.Edit` | 200 | |
| | PUT /clients/{id} changing number | `Client.Edit` and `Client.EditNumber` (all of) | 200 | Without EditNumber: 403 and nothing else in the request applied |
| | GET /matters, /matters/{id}, lookup | `Matter.View` | 200 | |
| | POST /matters | `Matter.Create` | 201 | |
| | PUT /matters/{id} | `Matter.Edit` | 200 | |
| | PUT /matters/{id} changing number | `Matter.Edit` + `Matter.EditNumber` | 200 | |
| | POST /matters/{id}/active | `Matter.SetActive` | 200 | UX says `Matter.Edit` (FND-03) |
| | GET /projects | `Project.View` | 200 | |
| | POST /projects | `Project.Create` | 201 | |
| | PUT /projects/{id} | `Project.Edit` | 200 | |
| | POST /projects/{id}/archive | `Project.Archive` | 200 | |
| Assets | GET /asset-types, /matters/{id}/assets, /assets/{id} | `Asset.View` | 200 | |
| | POST /matters/{id}/assets | `Asset.Create` | 201 | |
| | PUT /assets/{id} | `Asset.Edit` | 200 | |
| | POST/DELETE /tasks/{id}/assets | `Asset.Link` and `Task.Edit` (FND-03, recommended) | 200 | Cross-Matter 409 only reachable with permission |
| | POST/PUT /asset-types | `AssetType.Manage` | 201/200 | |
| Tasks read | GET /tasks, /tasks/{id}, /tasks/{id}/workflow | `Task.View` | 200 | |
| | GET /tasks/{id}/activity | `Task.View` | 200 | Old/new values visibility: FND-04 |
| | GET /tasks/{id}/comments | `Task.View` | 200 | |
| Task write | POST /tasks | `Task.Create`; plus `Task.Assign` if assignee/Pod supplied; plus `Task.SetPriority` if priority differs from default (all of) | 201 | Tested by combos: assignee without Assign -> 403 whole request, no task |
| | PUT /tasks/{id} | `Task.Edit`; plus `Task.SetPriority` if priority changes; `Task.Assign` if assignment changes (all of) | 200 | PM-X-09 |
| | POST /tasks/{id}/assignment | `Task.Assign` | 200 | UX also lists `Task.Reassign`, merged (FND-03) |
| | POST /tasks/{id}/priority | `Task.SetPriority` | 200 | |
| | POST /tasks/{id}/status (to IN_PROGRESS/ON_HOLD) | `Task.ChangeStatus` | 200 | |
| | POST /tasks/{id}/status (to CANCELLED) | `Task.Cancel` (+ `Task.Comment`? FND-03) | 200 | Comment mandatory |
| | POST /tasks/{id}/complete | `Task.Complete`; with `completeUnresolvedSteps=true` also `Workflow.Execute` (recommended) | 200 | K-14 |
| | POST /tasks/{id}/reopen (or status IN_PROGRESS from Completed/Cancelled) | `Task.Reopen` | 200 | Matter active |
| | POST /tasks/{id}/comments | `Task.Comment` | 201 | Allowed on all statuses |
| | PUT/DELETE /tasks/{id}/comments/{cid} | `Task.Comment` and author only | 200/204 | Non-author with all permissions: 403; System Admin: FND-11 |
| Workflow execution | POST step start/save/complete/skip | `Workflow.Execute` | 200 | Ordering/skip rules apply after permission |
| | POST step reopen | `Workflow.StepReopen` | 200 | On Completed task also moves task (FND-06) |
| Config | GET/POST/PUT /priorities | `Priority.Manage` for writes; reads need `Task.View` (every starter role holds it; decided in security review SEC-15, code is authoritative; status labels, asset link roles and task types read the same way) | 200 | Read access to config lists used by forms must not require Manage: test that a technician can load priorities, status labels, asset link roles |
| | PUT /status-labels | `StatusLabel.Manage` | 200 | |
| | /task-types, /task-types/{id}/workflows (writes) | `TaskType.Manage` | 200 | SCN-019 |
| | /forms/** writes (drafts, publish, clone) | `TaskType.Manage` for Task Type forms; `Workflow.Manage` for step forms; `AssetType.Manage` for asset forms; `CustomField.Manage` for client/matter/project fields | 200 | Generator needs owner-kind-aware permission mapping; test cross-use (TaskType.Manage cannot publish an Asset Type form) |
| | /step-definitions, /workflows writes, publish | `Workflow.Manage` | 200/201 | SCN-019 |
| | GET /forms/versions/{id}/schema | `Task.View` for every owner kind today (security review SEC-15). Known limitation: a user with `Asset.View` or a custom-field permission but without `Task.View` cannot load that schema; owner-kind-aware read permissions are a follow-up | 200 | Schema must not be readable by zero-permission user |
| | POST/PUT /asset-link-roles | `AssetType.Manage` (assumed) | 201/200 | Ownership of this permission is not stated: FND-03 |
| Views | GET /views/my-work | `Task.View` | 200 | |
| | GET /views/pod-work | `Task.View` and `Pod.View` | 200 | Which Pods may be selected: FND-16 |
| | GET /dashboard | `Dashboard.View` and any of `Dashboard.ViewSummary`, `ViewBreakdowns`, `ViewTrends`; the payload is redacted per tab permission | 200 | Without them: 403; a tab permission without `Dashboard.View`: 403; sections the caller may not see are zero/empty (UAT-S01-6) |
| | GET /dashboard/swimlane, /dashboard/workload | `Dashboard.View` + `Dashboard.ViewSwimlane`, `Dashboard.View` + `Dashboard.ViewUsers` | 200 | Either missing: 403 |
| Search | GET /search | at least one View permission; per-type groups gated | 200 | PM-X-08 |
| | GET /search/{type} | that type's View permission | 200 | |
| Intake | POST /intake/parse-email | `Task.Create` | 200 | Also 413 `PAYLOAD_TOO_LARGE`, 415, 400 `EMAIL_PARSE_FAILED` after permission |
| Audit | GET /audit/events | `Audit.View` | 200 | (path corrected, SEC-27) |
| | POST /client-log | **does not exist yet** (SEC-27); authenticated (rate limited) when built | 204 | Documented exception: confirm PM-X-10 allows it (it is a second `AllowAuthenticated` action; architecture says `/me` is the only one, FND-03) |
| Ops | /health/live, /health/ready | anonymous | 200 | No detail leakage |

## 4. Role x permission seed verification (starter matrix)

A single data-driven test (PM-ROLE-01) loads the seeded starter roles and compares them cell by cell with architecture 6.3 table, so an accidental edit to the seed or to the permission catalog fails. Expected grants (X) per role are exactly those in the architecture table; every `*.Manage`, `User.Manage`, `Audit.View` (except Director) and `EditNumber`/`SetActive` (except Director, PM) are absent for the others.

Behavioural role matrix (PM-ROLE-02): for each of Director, Project Manager, Pod Lead, Data Technician, Data Scientist and System Admin, call a representative operation set and assert allow/deny. Expected deny cells worth singling out:

| Operation | Director | PM | Pod Lead | Technician | Data Scientist | Admin |
|---|---|---|---|---|---|---|
| POST /clients, POST /matters | allow | allow | allow | **deny** (FND: open question 1) | **deny** | allow |
| Change client/matter number | allow | allow | deny | deny | deny | allow |
| POST /matters/{id}/active | allow | allow | deny | deny | deny | allow |
| POST /projects | allow | allow | allow | allow | **deny** | allow |
| POST /matters/{id}/assets | allow | allow | allow | allow | allow | allow |
| POST /tasks, assign, priority, cancel, reopen, complete, steps | allow | allow | allow | allow | allow | allow |
| PUT /pods/{id}/members | allow | deny | allow | deny | deny | allow |
| GET /users | allow | deny | deny | deny | deny | allow |
| GET /audit/events | allow | deny | deny | deny | deny | allow |
| Dashboard department scope | allow | allow | allow | personal only | personal only | allow |
| Any `*.Manage` config, roles, users | deny | deny | deny | deny | deny | allow |

## 5. Negative design per permission code (summary of generator output)

For each code in the catalog, at least one operation lists it in `x-permission`; the generator asserts there is no "orphan" code (permission defined but gating nothing) and no operation relying on a code absent from the catalog. Orphan check candidates to watch: `Task.Reassign` (UX only), `Workflow.StepEdit` (UX only), `Task.Attach` (removed), `Matter.SetActive`, `User.View`, `User.Manage`.

## 6. Angular side (FT)

- `*mfHasPermission` hides, not disables, controls the user lacks permission for; state-blocked controls are disabled with a reason (UAT-X-5).
- Route `canMatch` guards: direct URL to `/admin/task-types` without `TaskType.Manage` goes to the 403 page; `accessGuard` sends ACCESS_PENDING users to `/access-pending` from every route.
- After a 403 `PERMISSION_DENIED`/`ACCESS_PENDING` response the permission list is refreshed.
- Inline queue controls (priority, assignee) absent without permission and read-only on Completed/Cancelled rows.

## 7. Execution

Generated suite is part of the module integration tests, runs nightly and on demand, and a trimmed "smoke" slice (b and c for 10 representative operations) runs on every PR. Runtime budget: whole matrix < 10 minutes using one container and Respawn checkpoints. Any new permission code or operation without a generated case blocks the PR.
