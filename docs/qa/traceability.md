# Traceability Matrix

Maps every baseline scenario SCN-001..020, the baseline section 6.4 acceptance scenarios, and every addendum rule (A to K) to concrete test cases and to the GitHub epic or ticket that delivers it.

## Conventions

- Layers: **UT** .NET unit, **FT** Angular unit/component, **DB** schema/runner (Testcontainers), **IT** API integration (Testcontainers, Dev auth), **E2E** Playwright (Phase 6), **MAN** manual.
- "E2E" in the layer column means the case is automated at the end; where a case lists `IT, E2E` the IT part is authored with the ticket and the E2E part in Phase 6 (#12).
- Delivered-by: epics 0=#1, A=#2, B=#3, C=#4, D=#5, E=#6, F=#7, G=#8, H=#9, I=#10, J=#11, Z=#12. Child tickets that exist: #13 scaffold/CI, #14 runner + `01-init.sql`, #15 SharedKernel/API conventions, #16 authentication, #17 authorization, #18 audit, #19 Angular shell, #20 form-rules contract, #21 Outlook spike, #22 walking skeleton, #23 users queue, #24 roles, #25 Pods, #26 Clients, #27 Matters, #28 Projects, #29 forms persistence/publish, #30 .NET evaluator, #31 TS evaluator/renderer, #32 designer, #33 priorities/labels, #34 Task Types, #35 step library, #36 asset link roles, #37 Asset Types/Assets, #38 workflow definitions/publish, #39 instantiation and step machine, #40 workflow designer UI. **Epics G (#8), H (#9), I (#10), J (#11) have no child tickets yet**; rows cite the epic and QA will re-point them when children are created.
- Test ids: `<AREA>-<nn>`. A row's "Expected" always also implies: audit rows written in the same transaction where a mutation occurs, and no change on failure (see AUD-01, AUD-02).
- `FND-nn` points to `findings.md`; the row is written against the recommended resolution.
- Status column omitted deliberately: status lives in the CI dashboard; this file is the design.

---

## Part 1. Baseline acceptance scenarios SCN-001..020

| Scenario | Test ID | Layer | Preconditions | Steps | Expected | Delivered by |
|---|---|---|---|---|---|---|
| SCN-001 Duplicate Client | NUM-01 | IT, E2E | User with `Client.Create` | POST /clients `{number:"00001",name:"A"}`; POST again `{number:"00001",name:"B"}` | 1st 201 with `clientNumber:"00001"`; 2nd 409 `DUPLICATE_NUMBER`; one row exists | #26 (epic B #3) |
| | NUM-02 | DB | Empty DB | Insert two Clients with ClientNumber `00001` directly; insert `1` and `123456` and `abcde` | Unique index rejects duplicate; CHECK rejects non-5-digit | #26, #14 |
| | NUM-03 | IT | Client `00343` exists | POST client with `"343"` | 409 `DUPLICATE_NUMBER` (padded equivalent) | #26 |
| SCN-002 Same matter number, different clients | ORG-01 | IT, E2E | Clients `00001`, `00002` | Create Matter `00001` under each | Both 201; refs `00001-00001`, `00002-00001` | #27 |
| SCN-003 Duplicate matter in client | ORG-02 | IT, DB | Client `00001` with Matter `00001` | Create Matter `1` under client 1 | 409 `DUPLICATE_NUMBER`; composite unique index also rejects raw insert | #27 |
| SCN-004 Task without Project | TSK-01 | IT, E2E | Active Matter, Task Type with published eligible workflow, role `Task.Create` | POST /tasks without projectId | 201; `projectId` null; status NEW; workflow instance with one StepInstance per step PENDING; `TASK_CREATED` audit | #8 (G); depends #28, #34, #39 |
| SCN-005 Project from another Matter | TSK-02 | IT, DB, E2E | Matters M1, M2; Project P2 in M2 | POST /tasks matterId=M1 projectId=P2 | 400/409 `CROSS_MATTER_REFERENCE`; no Task row; raw SQL insert violates composite FK | #8 (G), #28 |
| | TSK-03 | IT | Task T in M1 and Project P1 in M1, P2 in M2 | PUT /tasks/T projectId=P2; then P1 | P2 rejected; P1 accepted; MatterId unchanged | #8 (G) |
| SCN-006 Technician self-assign | ASG-01 | IT, E2E | Data Technician (has `Task.Assign`), unassigned NEW task | POST /tasks/T/assignment `{userId:self}`; then another user | 200 both; status IN_PROGRESS after the first; `TASK_ASSIGNED` and status events share correlation id; no manager involved | #8 (G) |
| | ASG-02 | IT | Custom role without `Task.Assign` | Same call | 403 `PERMISSION_DENIED` naming the missing code | #8 (G), #17 |
| SCN-007 Multi-Pod My Work | VIEW-01 | IT, E2E | User U in Pods A and B; tasks assigned to U (some with Pod A, some B, some none) and tasks of other users | GET /views/my-work; GET /views/pod-work?podId=A, then B | My Work has all of U's tasks regardless of Pod; Pod Work only that Pod's items; others absent | #9 (H) |
| SCN-008 Dynamic form | FRM-01 | UT, FT | Vectors file | Run all vectors in .NET and TS | Identical visible/required/options/errors | #30, #31, #20 |
| | FRM-02 | IT, E2E | Task Type with `requires_ocr` checkbox and `ocr_language` required when true | POST /tasks with requires_ocr=true and no language; then with false and no language; then true with language | 400 `FORM_VALIDATION_FAILED` `form:ocr_language` REQUIRED; 2nd 201 (hidden not required); 3rd 201 | #8 (G), #30 |
| | FRM-03 | FT | Renderer with the same schema | Toggle checkbox | Field appears/disappears; required marker follows | #31 |
| SCN-009 Two eligible workflows, choose one | WF-01 | IT, E2E | Task Type linked to WF-A and WF-B both published | POST /tasks with workflowDefinitionId=A; with neither; with both (array); with unlinked WF-C | A: 201 with exactly one WorkflowInstance; none: 400; both: 400; C: 409 `WORKFLOW_NOT_ELIGIBLE` | #34, #8 (G) |
| | WF-02 | IT | WF with no PUBLISHED version | Create task | 409 `WORKFLOW_NOT_PUBLISHED` | #8 (G), #38 |
| SCN-010 Ordered progression | STP-01 | UT | Ordered 4-step workflow, all PENDING | Evaluate `complete` on step 3 | `STEP_ORDER_VIOLATION` | #39 |
| | STP-02 | IT, E2E | Same | Complete step 1; try 3; complete 2; then 3 | 3 rejected 409 `STEP_ORDER_VIOLATION` until 2 resolved | #39, #8 |
| | STP-03 | UT | Unordered workflow | Complete step 3 first | Allowed | #39 |
| SCN-011 Skip comment required | STP-04 | IT, FT | Skippable step with SkipCommentRequired | POST skip without comment; with whitespace; with comment | 400 `SKIP_COMMENT_REQUIRED` x2; 200 with comment stored | #39 |
| SCN-012 Non-skippable | STP-05 | IT, FT | Non-skippable step | POST skip | 409 `STEP_NOT_SKIPPABLE`; UI shows no Skip button | #39 |
| SCN-013 Reopen preserves downstream | STP-06 | UT, IT, E2E | Ordered, steps 1 to 4 COMPLETED | Reopen step 2 | Step 2 IN_PROGRESS; 3 and 4 still COMPLETED; no reason needed; `STEP_REOPENED` audit; UI flags 2 as reopened prerequisite | #39 |
| | STP-07 | IT | Ordered 5 steps: 1 to 4 COMPLETED, 5 PENDING (never resolved), reopen 2 | Try completing 5; complete 2; complete 5 | 5 blocked until 2 resolved; then allowed (FirstResolvedAt rule) | #39 |
| | STP-08 | UT | Step 3 reopened and re-completed with step 2 open | Complete step 3 (FirstResolvedAt set) | Allowed | #39 |
| SCN-014 Version snapshot | VER-01 | IT, E2E | WF v2 published, Task T created on v2 | Publish v3 (changed step title, added step, changed order) | T still shows v2 steps and instructions; new Task gets v3; v2 is RETIRED but readable | #38, #39 |
| | VER-02 | IT | Task Type form v1, Task created; publish v2 | GET task; edit task form values | Task keeps `FormVersionId` v1 and renders v1 fields; edit validates against v1 | #29, #8 |
| SCN-015 ASAP | DT-01 | UT, IT, E2E | Task without due date, clock far ahead | GET tasks `overdue=true`; dashboard overdue count | Not returned/counted; `dueLabel` renders "ASAP" not red | #8 (G), #9 (H) |
| | DT-02 | UT | Calculations | Date-only due 2026-03-10 firm tz at 2026-03-10T23:59 and 2026-03-11T00:00 firm time; with time 14:30 at 14:29, 14:31; DST boundaries 2026-03-08, 2026-11-01 | Overdue only after 23:59:59.9999999 (date-only) or after the time; DST correct; `OverdueAfterUtc` stored UTC | #8 (G) |
| SCN-016 Cross-Matter asset | AST-01 | IT, DB, E2E | Task in M1; assets A1 in M1, A2 in M1, B1 in M2 | Link A1, A2; link B1 | A1, A2 200 with relationship label; B1 409/400 `CROSS_MATTER_REFERENCE`; raw insert blocked by composite FK | #8 (G), #37 |
| | AST-02 | IT | Task type form with `ASSET_REF` field | Submit asset id from other Matter | 400 `form:<key>` `CROSS_MATTER_REFERENCE` | #30, #8 |
| SCN-017 Outlook email to Task | INT-01 | UT, IT | Email corpus | POST /intake/parse-email with each corpus file | `{subject, bodyText, fromName, fromEmail, sentAtUtc}` correct; attachments ignored; warnings for truncation | #11 (J) |
| | INT-02 | FT, E2E | Create Task page | Paste Outlook header block + body | Title, Description, Requestor Name/Email, sent date filled and editable; Task Type and Workflow remain unselected | #11 (J), #8 |
| | INT-03 | IT | Instrumented temp dir and DB | Parse then inspect | No file written, nothing stored, no content in logs, no attachment names (C3) | #11 (J), #18 |
| | INT-04 | MAN | New Outlook desktop, OWA, Edge, Chrome | Spike matrix (architecture 13.2) | Outcome A, B or C recorded in ADR; fallback messaging per UAT-S09-9 | #21 |
| SCN-018 Comment and history | CMT-01 | IT, E2E | Task T | POST comment; GET comments; edit; GET activity | Author, UTC time, body shown; edit keeps history; activity lists `COMMENT_ADDED`, `COMMENT_EDITED`; step change events present | #8 (G) |
| SCN-019 Management permission denied | PM-MGMT-01 | IT | Role without `TaskType.Manage`/`Workflow.Manage` | Call every management endpoint (generated, see permission-matrix-tests.md) | 403 `PERMISSION_DENIED` each, no state change | #17, #34, #35, #38 |
| SCN-020 Search by combined number | SRCH-01 | IT, E2E | Matter 00002-00001 with related Projects/Tasks/Assets | GET /search?q=00002-00001, `2-1`, `00002-1` | Matter returned first; related authorized records present | #10 (I) |
| | SRCH-02 | IT | Custom role with `Matter.View` but no `Task.View`/`Asset.View` | Same query | Only Matter group returned; no Task/Asset groups; no count leakage | #10 (I), #17 |

---

## Part 2. Baseline 6.4 acceptance scenarios (authentication and registration)

| Scenario | Test ID | Layer | Preconditions | Steps | Expected | Delivered by |
|---|---|---|---|---|---|---|
| 6.4-1 First login creates zero-permission profile | ID-01 | IT | Dev provider; unknown identity header | GET /me | `AppUser` + `UserIdentity` created in one transaction, zero roles, `status:"ACCESS_PENDING"`; `USER_PROVISIONED` audit | #16 (epic 0 #1) |
| | WIN-01 | MAN | Domain-joined test IIS | Open site first time | Silent Negotiate; SID stored as subject; DOMAIN\sam as username | #16, #22 |
| 6.4-2 Access Pending sees nothing | ID-02 | IT | Zero-permission user | Call every endpoint in OpenAPI (generated) except `/me` | All 403 `ACCESS_PENDING`; no data; also search/lists/users/pods/config | #16, #17 |
| | ID-03 | E2E, FT | Same user | Open any URL | Redirect to `/access-pending`; no nav/search; Check again says still pending (UAT-S21-1..3) | #19, #22 |
| 6.4-3 Admin grants, user gains exactly permitted access | ID-04 | IT, E2E | Pending user; admin | PUT /users/{id}/roles Data Technician and Pods; user calls GET /tasks, POST /clients, GET /roles | Task list 200; POST /clients 403; GET /roles 403; effective within the next request on same node | #23, #24, #25 |
| | ID-05 | IT | User with role | Remove role; next request | 403 `ACCESS_PENDING` immediately (cache invalidated) | #23 |
| 6.4-4 Repeat sign-in no duplicate | ID-06 | IT | Unknown identity | 20 concurrent first requests | Exactly one AppUser and one UserIdentity; all 200 | #16 |
| 6.4-5 Entra link preserves relations | ID-07 | IT | User with tasks, comments, Pod membership, audit rows | Add `UserIdentity(Entra, tid, oid)` for existing UserId via the seam; authenticate with Entra test scheme | Resolves to same UserId; all associations intact; no foreign key references provider data | #16 (seam only; migration tooling not Phase 1) |
| 6.4-6 Email/name coincidence never auto-links | ID-08 | IT | Windows user A with email x; Entra identity with same email | Authenticate Entra identity | New separate AppUser (zero roles), A untouched | #16 |
| Disabled account | ID-09 | IT | `IsActive=false` user | Any endpoint | 403 `ACCOUNT_DISABLED`; `/me` also reports disabled (UAT-S21-4) | #16, #23 |
| Bootstrap admin | ID-10 | IT | `Bootstrap:SystemAdmins` includes `CORP\jsmith` | First login; revoke admin; login again | Gets System Admin once, `ADMIN_BOOTSTRAPPED` audit; not re-granted | #16 |
| Last admin guard | ID-11 | IT | Single active admin | Disable him; remove role | 409 `LAST_ADMIN` both (UAT-S12-6); System Admin role unmodifiable | #24 |

---

## Part 3. Addendum rules

### A. Task immutability and editing

| Rule | Test ID | Layer | Preconditions | Steps | Expected | Delivered by |
|---|---|---|---|---|---|---|
| A1 Type, Workflow, Matter immutable | IMM-01 | IT | Task T | PUT /tasks/T with changed taskTypeId, matterId, workflow; look for any endpoint accepting them | 400 `IMMUTABLE_FIELD` (or property unknown/ignored per contract); values unchanged | #8 (G) |
| | IMM-02 | DB | Task row | `UPDATE Task SET TaskTypeId`, `MatterId`; `UPDATE WorkflowInstance SET WorkflowVersionId` | `TR_Task_Immutable`, `TR_WorkflowInstance_Immutable` raise errors | #8 (G), #39 |
| | IMM-03 | FT | Task detail | Inspect fields | Matter, Type, Workflow read-only with lock explanation (UAT-S10-3) | #8 (G) |
| A2 Project may change within Matter | TSK-03 | IT | see SCN-005 | | | #8 |
| A3 Form values editable, audited, stay on creation version | VER-02, AUD-03 | IT | Task with form v1; v2 published | Edit values | Validated against v1; `FIELD_CHANGED` with `form:<key>` old/new; form-version caption (UAT-S10-4) | #8 (G) |
| A4 Edit Completed/Cancelled requires In Progress | LIF-10 | IT | Completed task; Cancelled task | PUT details, assignment, priority, link asset on each | 409 `TASK_NOT_EDITABLE`; after reopen succeeds | #8 (G) |
| | LIF-11 | IT | Matter inactive (all tasks completed) | Reopen task | 409 `MATTER_INACTIVE` (both Completed and Cancelled) | #8 (G), #27 |
| A5 Cancel at any time with mandatory comment | LIF-12 | IT | Tasks in NEW, IN_PROGRESS, ON_HOLD (and COMPLETED, FND-01) with unresolved steps | POST status CANCELLED without comment; whitespace comment; with comment | 400 `CANCEL_COMMENT_REQUIRED` x2; 200 with comment saved as TaskComment `Purpose=CANCEL`, referenced by audit; steps untouched | #8 (G) |
| | LIF-13 | IT | Completed task | Cancel | Expected per FND-01 (recommended: allowed; current architecture: 409 `INVALID_STATUS_TRANSITION`). Test is parameterised and must be set once PO resolves | #8 (G) |
| | LIF-14 | IT | Cancelled task | Cancel again | 409 `INVALID_STATUS_TRANSITION` | #8 (G) |
| A6 Step reopen on Completed task auto-moves to In Progress | LIF-15 | IT | Completed task, active Matter | Reopen step | Step IN_PROGRESS; task IN_PROGRESS; `CompletedAt` cleared; `STEP_REOPENED` and `TASK_STATUS_CHANGED(cause=STEP_REOPEN)` same correlation; needs `Workflow.StepReopen` only (FND-06) | #39, #8 (G) |
| | LIF-16 | IT | Cancelled task; Matter inactive Completed task | Reopen step | Cancelled: 409 (reopen task first). Inactive Matter: 409 `MATTER_INACTIVE` | #39, #8 |
| A7 Assign user moves New to In Progress | ASG-03 | IT, E2E | NEW task | Pod-only assign; user assign; unassign user | Pod-only: still NEW; user: IN_PROGRESS; unassign: still IN_PROGRESS | #8 (G) |
| | ASG-04 | IT | NEW task | Create task with assignee at creation; with Pod only | IN_PROGRESS; NEW (UAT-S09-7) | #8 (G) |
| | ASG-05 | IT | ON_HOLD task with no user | Assign user | Stays ON_HOLD (auto-start applies to NEW only) | #8 (G) |
| A8 Library edit does not change published versions | VER-03 | IT | Step Definition S used in published WF v1 | Edit S title/instructions/form; publish new library form version | WF v1 steps show old copies and pinned form version; new draft WF picks up new data | #35, #38 |

### B. Matters and Clients

| Rule | Test ID | Layer | Preconditions | Steps | Expected | Delivered by |
|---|---|---|---|---|---|---|
| B1 Tasks only on active Matter | ORG-03 | IT, E2E | Inactive Matter | Create Task | 409 `MATTER_INACTIVE`; UI Create Task disabled with reason (UAT-S06-5) | #8 (G), #27 |
| | ORG-04 | IT | Inactive Project in active Matter | Create/move Task to it | 409 `PROJECT_INACTIVE`; existing tasks keep it (UAT-S07-3) | #28, #8 |
| B2 Inactive only if all Tasks Completed/Cancelled | ORG-05 | IT, E2E | Matter with tasks in each status | POST /matters/{id}/active false with 1 NEW; ON_HOLD; IN_PROGRESS; then all completed or cancelled | 409 `MATTER_HAS_OPEN_TASKS` for each open; succeeds when none; error links to open tasks | #27, #8 |
| | ORG-06 | IT | Race | Parallel: deactivate Matter and create Task (barrier) | Exactly one wins consistently: either deactivation succeeds and create gets 409, or create succeeds and deactivation gets 409; never an open task on an inactive Matter | #27, #8 |
| B3 Normalised numbers | NUM-04 | UT | `BusinessNumber` | Inputs `343`, `00343`, `0`, `00000`, `12345`, ` 343 `, `123456`, `000343`, `34a`, `""`, `٣٤٣` (Arabic-Indic), `1.5`, `-1` | Per FND-08 table: valid inputs padded; others `INVALID_NUMBER_FORMAT` | #15, #26 |
| | NUM-05 | IT | Client `00343` | GET /clients/lookup?ref=343, `00343`; matters lookup `343-12`, `00343-00012`, `343-00012` | Same record for all forms; response contains both parts and `matterRef:"00343-00012"` | #26, #27 |
| | NUM-06 | IT | Client number edit | PUT number without `Client.EditNumber`; with it to existing number; to new number | 403; 409 `DUPLICATE_NUMBER`; 200 and `CLIENT_NUMBER_CHANGED` audit; all `MatterRef` values cascade | #26, #27 |
| | NUM-07 | DB | Matter table | Insert MatterRef inconsistent with numbers | Computed/maintained `MatterRef` unique and consistent | #27 |
| | NUM-08 | FT | Number input | Type `343`, blur | Shows `00343`; Matter preview `00343-00012` live (UAT-S05-1, S06-2) | #26, #27 |
| B4 Search accepts both forms | SRCH-03 | IT | Seed `numbers` | q=`343`, `00343`, `343-12`, `12` | Number-aware matches per architecture 14 | #10 (I) |

### C. Requestor, attachments, intake

| Rule | Test ID | Layer | Preconditions | Steps | Expected | Delivered by |
|---|---|---|---|---|---|---|
| C1 Requestor name required, email optional | TSK-04 | IT, FT | | Create without name; with bad email; with name only; with name + email | 400 `REQUESTOR_NAME` required; 400 email format; 201; 201 | #8 (G) |
| C2 Prefill from email | INT-02 | FT | | see SCN-017 | | #11 (J) |
| C3 No attachments / no email storage | INT-03, INT-05 | IT, E2E | | INT-05: introspect OpenAPI and DB schema for attachment/file endpoints/tables; UI search for upload controls | None exist; no `TaskAttachment`, File Upload control absent from form designer palette (UAT-S14-1); no Attachments tab (UAT-S10-2) | #11 (J), #32 |
| C4 Paste path always works | INT-06 | FT, E2E | Dropzone disabled / spike outcome C | Create Task using only manual entry; paste text without headers | Task created; text goes to Description; no errors | #11 (J), #8 |
| | INT-07 | FT | Drop of unsupported payload | Drop | Fallback message, focus to Paste box, no crash (UAT-S09-9) | #11 (J) |

### D. Comments

| Rule | Test ID | Layer | Preconditions | Steps | Expected | Delivered by |
|---|---|---|---|---|---|---|
| D1 Basic formatting sanitised server-side | CMT-02 | UT, IT | Sanitiser | Submit `<script>`, `<img onerror>`, `<a href="javascript:">`, `<b>`, `<ul>`, nested styles, `<iframe>`, data URIs, overlong | Only allow-list `p, br, strong, em, b, i, ul, ol, li, a[href http/https/mailto]` retained, `rel=noopener`; stored HTML is sanitised (not only on render) | #8 (G) |
| | CMT-03 | FT | Editor | Paste from Word with fonts/colours | Stripped to allowed set (UAT-S10-16) | #8 (G) |
| D2 Internal only, no attachments | CMT-04 | MAN, FT | | Inspect composer | Labelled internal; no attachment option (UAT-S10-17) | #8 (G) |
| D3 Soft delete, own edit/delete only | CMT-05 | IT | Comments by U1 and U2 | U2 edits/deletes U1's; U1 edits own; U1 deletes own | 403 for others (even admin without special permission, per FND-11); edit history rows kept; delete sets deleted flag, row retained, hidden from GET, `COMMENT_DELETED` audit | #8 (G) |
| | CMT-06 | IT | Completed and Cancelled tasks, inactive Matter | Add, edit, delete own comment | Allowed (A-7) | #8 (G) |
| | CMT-07 | IT | Cancel comment (Purpose CANCEL) | Author tries delete/edit | Per FND-11 | #8 (G) |

### E. Security and identity

| Rule | Test ID | Layer | Preconditions | Steps | Expected | Delivered by |
|---|---|---|---|---|---|---|
| E1 `Task.View` sees all tasks; admin full access | SEC-01 | IT | User with `Task.View` in no Pod, task in unrelated Pod/Matter | GET /tasks, /tasks/{id}, search | All visible. No Matter-ACL logic exists (negative: no hidden-by-matter behaviour) | #8 (G), #17 |
| | SEC-02 | IT | System Admin | All permission-gated endpoints | Allowed without explicit permission rows | #17 |
| | SEC-03 | IT | User without `Task.View` | GET /tasks/{id}, /tasks, /views/*, /search tasks, dashboard drill-through | 403; search omits tasks | #17, #9, #10 |
| E2 Pod Lead is a role | ID-12 | IT, E2E | | Create custom role "Pod Lead"; assign to user in a Pod | Behaves as any role; no per-Pod lead flag in Pod DTO/UI (UAT-S12-4, S13-2) | #24, #25 |
| E3 Offboarding manual; assignee filter includes inactive | ID-13 | IT | Inactive user with 3 tasks | Deactivate (shows open-task count); GET /tasks?assigneeId=inactive | Count and link shown; no bulk reassign endpoint exists; filter returns tasks; assignee picker for new assignment excludes inactive (UAT-S03-4) | #23, #9 (H) |
| | SEC-04 | IT | Read access | Read tasks | No read-audit events written (F) | #18 |

### F. Scope reductions and removals

| Rule | Test ID | Layer | Preconditions | Steps | Expected | Delivered by |
|---|---|---|---|---|---|---|
| F1 No global Task custom fields | CF-01 | IT, FT | | Custom Fields admin; POST custom field scope TASK | Tabs only Client, Matter, Project, Asset (UAT-S18-4); TASK scope rejected 400 | #32, #5 (D) |
| F2 Removed features absent | NEG-01 | IT, E2E | | Crawl OpenAPI paths and UI routes for subtasks, dependencies, related, clone, bulk reassign, export, reports, approvals, notifications, step assignee | None present (UAT-X-4, S03-11) | #12 (Z) |
| F3 Custom fields on Client/Matter/Project/Asset | CF-02 | IT | Published fields | Save Client with custom values; invalid; hidden-conditional | Validated by current published version; JSON stored; filterable index rows written same transaction | #26, #27, #28, #37, #29 |
| | CF-03 | IT | Filterable field | Edit value; rebuild tool | `CustomFieldIndex` matches JSON; drift test | #29 |
| F4 Asset belongs to one Matter; Asset Types own fields | AST-03 | IT, DB | | Create asset; try to change MatterId/AssetTypeId | Immutable (UAT-S08-2); fields validated per type | #37 |
| | AST-04 | IT | Asset Type field removed in new version | View existing asset | Old value hidden not deleted (UAT-S17-3) | #37 |

### G. Dates and sorting

| Rule | Test ID | Layer | Preconditions | Steps | Expected | Delivered by |
|---|---|---|---|---|---|---|
| G1 Optional date and time; ASAP | DT-01, DT-02, DT-03 | UT, IT | | DT-03: time without date | 400 `VALIDATION_FAILED`; past date allowed with warning in UI (UAT-S09-16) | #8 (G) |
| G2 One firm timezone, UTC storage | DT-04 | UT, IT | `Firm:TimeZoneId` set | Save, read back; render | Stored UTC (`OverdueAfterUtc`); API returns ISO-8601 Z; UI shows firm tz (UAT-X-11) | #8 (G), #19 |
| G3 ASAP sorts above explicit dates within priority | SORT-01 | IT, E2E | Seed `sort` | GET /tasks?sort=default | Order per UAT-S03-6: Critical ASAP (oldest first), Critical overdue (earliest first), Critical future..., then High...; priority dominates; ties by CreatedAt | #9 (H) |
| | SORT-02 | IT | | Same for my-work and pod-work, and `sort=priority,-dueAt` whitelist | Same default; unknown sort field 400 | #9 (H) |
| | SORT-03 | IT | Date-only vs timed same day | Sort | Ordered by `OverdueAfterUtc` (date-only at 23:59:59) | #9 (H) |

### H. Scale

| Rule | Test ID | Layer | Preconditions | Steps | Expected | Delivered by |
|---|---|---|---|---|---|---|
| H1 Modular monolith, SQL Server only, plain indexes | PERF-01 | IT (perf) | Seed `scale` | k6: queue, search, dashboard, asset list (300/matter), create task | Targets in test-plan 6.2; query plans use index seeks on key filters (plan assertions for top 6 queries) | #12 (Z) |
| | ARCH-01 | UT (arch) | | NetArchTest module rules | No search engine package, no cross-module nav properties | #13 |
| | AST-05 | IT, E2E | Matter with 300 assets | List with server pagination/search | Paged, filter by text and type (UAT-S08-3) | #37 |

### I. Build assumptions

| Rule | Test ID | Layer | Preconditions | Steps | Expected | Delivered by |
|---|---|---|---|---|---|---|
| I1 Windows Integrated + JIT | ID-01, ID-06, WIN-01..WIN-08 (manual list in Part 6) | IT, MAN | | | | #16 |
| I2 Dev provider only off-domain | SEC-DEV-01 | IT | Production config | Start app with `Production` env and Dev auth configured | Startup fails or Dev scheme not registered; Dev header ignored | #16 |
| I3 Initial admin seeded by config | ID-10 | IT | | | | #16 |
| I4 Same-origin; CSRF guard | SEC-05 | IT | | POST without `X-MatterFlow-Client`; with wrong content-type; `Sec-Fetch-Site: cross-site`; GET | 400/403 for the first three; GET fine | #15, #16 |

### J. Database migrations

| Rule | Test ID | Layer | Preconditions | Steps | Expected | Delivered by |
|---|---|---|---|---|---|---|
| J1 Numbered scripts, not EF migrations | RUN-01 | DB, UT | Empty DB | Start app with scripts 01 to 03 | `SchemaMigration` has 3 rows ordered by prefix with checksum, applied-at UTC, duration, success; repo contains no `Migrations/` folder (arch test) | #14 |
| J2 Pending scripts run in numeric order (not lexical) | RUN-02 | UT, DB | Scripts `2-a`, `10-b`, `9-c` | Run | Order 2, 9, 10 | #14 |
| J3 Applied never re-run | RUN-03 | DB | Applied DB | Restart twice | No re-execution, rows unchanged | #14 |
| J4 Each script in a transaction; failure fails startup | RUN-04 | DB | Script that fails halfway | Start | Process fails startup; script changes rolled back where transactional; row recorded as failed or absent per design; Windows Event Log entry; `/health/ready` not ready | #14 |
| J5 App lock | RUN-05 | DB | Two app instances against one DB | Start both concurrently | Only one executes scripts; the other waits then sees them applied; no duplicate rows | #14 |
| J6 Duplicate prefixes detected | RUN-06 | UT, DB | Two files `05-a.sql`, `05-b.sql` | Start | Startup fails with clear message | #14 |
| J7 Checksum change of applied script detected | RUN-07 | DB | Applied script edited | Start | Fails loudly naming the script | #14 |
| J8 GO separators | RUN-08 | UT | Script with `GO`, `go`, `GO 5`, GO inside string/comment/line with other text | Split | Correct batches; `GO` inside strings/comments not split | #14 |
| J9 Embedded or folder discovery | RUN-09 | DB | Config folder vs embedded | Start both modes | Same result | #14 |
| J10 Immutability in CI | RUN-10 | CI | PR modifying merged script | `tools/check-scripts` | Fails the PR (also naming regex) | #13, #14 |
| J11 EF vs SQL drift | RUN-11 | DB | Applied scripts | Compare EF model to schema | No drift | #14, #15 |

### K. Bulk-complete of unresolved steps on Task completion

All K tests use an `IN_PROGRESS` task with a 5-step workflow unless stated. FND-05 (partial vs all-or-nothing) and FND-02 (NEW task) apply.

| Rule | Test ID | Layer | Preconditions | Steps | Expected | Delivered by |
|---|---|---|---|---|---|---|
| K1 Complete allowed with unresolved steps (confirm dialog) | K-01 | FT, E2E | 3 of 5 steps unresolved | Click Complete | Dialog text exactly "You have 3 steps not completed. Do you want to mark them all completed?"; singular wording for 1 per copy deck | #8 (G), #39 |
| | K-02 | IT | Same | POST /complete without `completeUnresolvedSteps` | 409 `COMPLETION_BLOCKED` with `unresolvedStepIds`; nothing changed | #8 (G) |
| K2 Confirm: steps completed in order, then task, one transaction | K-03 | IT, E2E | Ordered, steps 3 to 5 unresolved, all inputs satisfied | POST /complete `completeUnresolvedSteps:true` | Steps 3,4,5 COMPLETED (not SKIPPED) with `FirstResolvedAt` set in sequence 3,4,5; task COMPLETED; `CompletedAt` set; response is updated resource with new rowVersion | #8 (G), #39 |
| | K-04 | IT | Unordered | Same | All COMPLETED; task COMPLETED | #8 |
| | K-05 | IT | Fault injection: throw on last step / on task status write / on audit insert | Same call | Entire transaction rolled back: all steps unchanged, task unchanged, no audit rows | #8 (G), #18 |
| | K-06 | IT | Concurrency: while bulk-complete runs, another user completes step 4 | Barrier-synchronised | Serialised by per-Task lock; outcome consistent (no double `STEP_COMPLETED` for same step, no 500); stale rowVersion gives 409 `CONCURRENCY_CONFLICT` | #8 (G) |
| K3 Cancel leaves everything unchanged | K-07 | FT, E2E | Dialog open | Cancel / Esc | No API call; steps and status unchanged; focus returns to Complete button | #8 (G) |
| K4 Completed, not Skipped; skip remains per-step | K-08 | IT | Skippable step unresolved | Bulk-complete | Step COMPLETED; `SkipComment` empty; skip endpoint still available and enforces comment rule when used | #8 (G), #39 |
| K5 Guard: missing required inputs block | K-09 | IT, E2E | Step 4 has required input empty (also conditionally required visible field; and hidden conditional not required) | Bulk-complete | 409 `COMPLETION_BLOCKED` `meta.stepsMissingInputs=[4]`; nothing changed (FND-05); dialog lists steps and keeps Task open (UAT-S10-11) | #8 (G), #39, #30 |
| | K-10 | IT | Step 4 missing inputs but skippable | Skip step 4 with comment (if required); retry bulk | Succeeds; step 4 SKIPPED, others COMPLETED | #8 |
| | K-11 | IT | Step 3 lacks inputs, step 5 would be satisfiable | Bulk | Nothing partially completed (FND-05) | #8 |
| K6 Audit: individual events, one correlation id, flagged bulk | K-12 | IT | K-03 setup | Read audit | One `STEP_COMPLETED` per step with `bulk=true`, one `TASK_STATUS_CHANGED`, same `CorrelationId`; per-step events carry actor | #8 (G), #18 |
| K7 Supersedes "must resolve every step" | K-13 | IT | Task with all steps already resolved | POST complete (flag absent / true) | Completes with no bulk events when none unresolved; `bulk` flag not set | #8 |
| Permissions | K-14 | IT | User with `Task.Complete` only; user with `Task.Complete`+`Workflow.Execute` | Bulk-complete | Per FND-03: recommended requires both `Task.Complete` and `Workflow.Execute`; assert chosen rule; missing code in 403 | #8, #17 |
| State | K-15 | IT | ON_HOLD, NEW, COMPLETED, CANCELLED | Complete | ON_HOLD/COMPLETED/CANCELLED: 409 `INVALID_STATUS_TRANSITION`; NEW per FND-02 | #8 |
| Idempotency | K-16 | IT | Two identical requests, same rowVersion | Send both | One succeeds; second 409 (`CONCURRENCY_CONFLICT` or `INVALID_STATUS_TRANSITION`), no duplicate audit | #8 |

---

## Part 4. Additional requirement coverage (lifecycle, forms, audit, concurrency, views)

| Area | Test ID | Layer | Description | Expected | Delivered by |
|---|---|---|---|---|---|
| Lifecycle matrix | LIF-01 | UT | Table-driven over all 25 (from, to) cells with contexts (matter active/inactive, comment present, user permission) | Matches architecture 8.3; same-status = `INVALID_STATUS_TRANSITION` | #8 (G) |
| | LIF-02 | IT | Representative transitions via API incl. ON_HOLD -> COMPLETED forbidden, NEW -> COMPLETED (FND-02) | Codes correct, `CompletedAt`/`StatusChangedAt` maintained | #8 |
| | LIF-03 | IT | Each transition with missing permission (`ChangeStatus`, `Complete`, `Cancel`, `Reopen`) | 403 naming the code | #8, #17 |
| | LIF-04 | IT | Step actions by task status (matrix in 8.3 rule 5), incl. step start on NEW does not change status, ON_HOLD blocked (FND-09) | As matrix | #8, #39 |
| Step machine | STP-09 | UT | All rows of 8.2 including forbidden COMPLETED<->SKIPPED, IN_PROGRESS->PENDING | Rejected with correct code | #39 |
| | STP-10 | IT | Draft save on step (partial values) then complete | Draft allowed (type-valid only); complete requires full validation | #39 |
| | STP-11 | IT | Edit values of resolved step without reopen | 409 (reopen first); with reopen: `STEP_VALUES_EDITED` audit | #39 |
| Forms | FRM-04 | UT | Publish validator negative cases (cycles incl. via sections, self-reference, missing ref, depth 4, empty options, duplicate keys, key type change, bad regex, >5 filterable) | `PUBLISH_VALIDATION_FAILED` with each cause | #29 |
| | FRM-05 | IT | Hidden field submitted | Dropped, not persisted, no error (FND-12 on edit) | #30 |
| | FRM-06 | IT | Unknown key; option not available; user ref inactive; asset ref cross-matter; regex ReDoS pattern | `UNKNOWN_FIELD`, `OPTION_NOT_ALLOWED`, `REF_INVALID`, `CROSS_MATTER_REFERENCE`; regex timeout handled as failure not 500 | #30 |
| | FRM-07 | DB | Update/delete rows of PUBLISHED/RETIRED FormVersion, fields, options | Trigger raises error | #29 |
| | FRM-08 | IT | Publish atomicity | New PUBLISHED and old RETIRED in one transaction; failure leaves old PUBLISHED; second DRAFT/PUBLISHED blocked by filtered unique index | #29 |
| | FRM-09 | MAN/E2E | Designer: add, reorder (drag + buttons), rule builder, preview parity, keyboard only (UAT-S14-*) | | #32 |
| Task Types | TT-01 | IT | Task type with no published eligible workflow | Not selectable in create, POST rejected; flagged in admin (UAT-S14-8, S09-3) | #34 |
| Priorities and labels | PRI-01 | IT | Rename/deactivate priority in use; exactly one default; five fixed statuses editable labels, codes read-only | Historical tasks still display; second default rejected | #33 |
| Assets | AST-06 | IT | Asset type / link roles configurable; relationship label stored | Link requires `Asset.Link`; label from configured list | #36, #37 |
| Audit | AUD-01 | IT | Fault injection: audit insert fails during task create / status change / step complete / role grant | Operation fails and business change rolled back | #18 |
| | AUD-02 | IT | Audit permissions | App DB login: UPDATE/DELETE on `AuditEvent` denied | #18 |
| | AUD-03 | IT | Field edits through interceptor (title, due date, priority, form JSON per key); `[AuditExplicit]` properties not double written; excluded fields not audited | One event per changed field per SaveChanges, same CorrelationId; none for rowversion | #18 |
| | AUD-04 | IT | Coverage matrix: every explicit event type in architecture 9 produced by exactly one scenario | Present with actor, ids, MatterId/TaskId denormalised | #18 + owning tickets |
| | AUD-05 | IT | Reads | `/tasks/{id}/activity` by `Task.View`; `/audit` by `Audit.View`; without => 403; long values truncated at 4000 for display with marker, full kept (FND-04 for old/new visibility) | #18, #8 |
| Concurrency | CON-01 | IT | Two clients edit same task with same rowVersion | Second 409 `CONCURRENCY_CONFLICT` with `currentRowVersion`; ETag header set | #15, #8 |
| | CON-02 | IT | Two technicians complete last two steps of unordered workflow concurrently | Both succeed; task completion check evaluated serially; no lost update | #39 |
| | CON-03 | IT | Complete task racing with step reopen | Serialised; final state consistent (either completed then reopened to IN_PROGRESS, or reopen blocked completion) | #39, #8 |
| | CON-04 | IT | Concurrent Task create vs Matter deactivation | See ORG-06 | #27 |
| | CON-05 | IT | Concurrent edits to config entities (Role, TaskType, FormVersion draft) | 409 on stale version | #24, #34, #29 |
| Views | VIEW-02 | IT | Dashboard tile counts vs queue totals for same filters; overdue excludes ASAP/Completed/Cancelled | Equal; drill-through filters reproduce counts (UAT-S01-2,3) | #9 (H) |
| | VIEW-03 | IT | Queue filters combine (client, matter forms `343`, `00343-00012`, status, priority, assignee inactive, unassigned, asap, overdue, `field.<key>` on filterable only, unknown filter) | Correct sets; unknown filter 400; URL state | #9 (H) |
| | VIEW-04 | IT | My Work tabs: Active, Due Soon (excludes ASAP, includes overdue explicit), Completed (Completed and Cancelled), Created by Me | Per UAT-S02-* | #9 (H) |
| | VIEW-05 | IT | Dashboard without `Dashboard.View` or a tab permission | 403 / tab hidden / redacted payload (UAT-S01-6) | #9 (H) |
| | VIEW-06 | E2E | Inline priority/assignee change with Undo; read-only on closed tasks | UAT-S03-9, S03-10 | #9 (H) |
| Search | SRCH-04 | IT | LIKE wildcard escaping (`%`, `_`, `[`), min 2 chars, cap 5 per type, case-insensitivity, task number forms (`TSK-1042`, `1042` FND-17) | Safe; grouped; stable | #10 (I) |
| | SRCH-05 | IT | Advanced search filters per object; custom field filter only if flagged | UAT-S11-8 | #10 (I) |
| Logging | LOG-01 | IT | Create task with sentinel title/comment/email; force 500 and 400 | Sentinels absent from log sink and ProblemDetails; request bodies never logged | #15, #18 |
| Health | OPS-01 | IT | `/health/live`, `/health/ready` before and after migrations; anonymous; no detail | As spec | #13, #14 |

---

## Part 5. Delivery view (tickets and the tests they must bring)

| Ticket | Minimum tests authored with the ticket |
|---|---|
| #13 | ARCH-01, RUN-10, OPS-01 pipeline |
| #14 | RUN-01..RUN-11 |
| #15 | CON-01 (infrastructure), NUM-04 (BusinessNumber), SEC-05, LOG-01 |
| #16 | ID-01, ID-06..ID-10, SEC-DEV-01, WIN-01..08 (manual) |
| #17 | Generated permission matrix PM-* (see permission-matrix-tests.md), ID-02, SEC-01..03 |
| #18 | AUD-01..AUD-05, SEC-04 |
| #19, #22 | ID-03, smoke e2e, guard and interceptor FT |
| #20, #30, #31 | FRM-01, FRM-03, FRM-05, FRM-06 |
| #21 | INT-04 |
| #23, #24, #25 | ID-04, ID-05, ID-09, ID-11..13, CON-05 |
| #26, #27, #28 | NUM-01..08, ORG-01..06, CF-02 |
| #29 | FRM-04, FRM-07, FRM-08, VER-02, CF-03 |
| #32 | FRM-09 (FT + manual keyboard) |
| #33 | PRI-01 |
| #34 | WF-01 (config part), TT-01, PM-MGMT-01 |
| #35 | VER-03 |
| #36, #37 | AST-01..06 |
| #38 | VER-01, WF-02 |
| #39 | STP-01..11, LIF-04, CON-02, CON-03 |
| #40 | FT for designer and step library; UAT-S15, S16 manual |
| #8 (G) | TSK-*, IMM-*, LIF-*, ASG-*, K-*, CMT-*, DT-*, AUD-04 |
| #9 (H) | SORT-*, VIEW-* |
| #10 (I) | SRCH-* |
| #11 (J) | INT-01..03, INT-05..07 |
| #12 (Z) | Full IT in CI, all E2E, PERF-01, NEG-01, UAT sign-off, WIN-01..08 |

## Part 6. Manual Windows authentication checklist (domain-joined IIS box)

| ID | Check | Expected |
|---|---|---|
| WIN-01 | Edge and Chrome, Intranet zone, first visit | Silent sign-in, JIT profile created, Access Pending shown |
| WIN-02 | Browser not in Intranet zone | Credential prompt works or documented message; no crash |
| WIN-03 | Admin grants role; user presses Check again | App opens without re-login |
| WIN-04 | Disable AD account / disable AppUser | Protected access refused with the correct message |
| WIN-05 | AD profile enrichment allowed / denied (A-4) | Display name and email filled, or fallback `DOMAIN\sam` and no error |
| WIN-06 | SID stored as subject; rename sam account | Same AppUser, username updated for display |
| WIN-07 | POST from a different origin page | Blocked (CSRF guard) |
| WIN-08 | App pool recycle and DB failover during use | Clean error page with correlation id; recovery without restart |
