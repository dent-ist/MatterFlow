# MatterFlow Sample Scenarios (a day in the life)

**Purpose:** ten end-to-end narratives a user agent (or a human tester) can follow to exercise MatterFlow. Each lists personas, preconditions, steps and expected outcomes, including the negative checks that matter.
**Data:** assumes the seed from `seed-configuration.md` / `.json` is loaded. Task Type, Step and Workflow names are from that seed. Today in the narratives is a firm working day; times are firm time.
**Conventions:** "Expect" lines are assertions. Rules referenced come from `requirements/decisions-addendum.md` (letters A to K) and `architecture.md` section 8.

## Personas

| Persona | Role | Pod | Notes |
|---|---|---|---|
| Dana Whitfield | Director | - | Oversight, `Audit.View`, `Matter.SetActive` |
| Priya Raman | Project Manager | - | Takes requests from attorneys, creates Clients/Matters/Projects |
| Marcus Ellery | Pod Lead | Processing Pod | Balances load, manages Pod members |
| Jamal Okafor | Data Technician | Processing Pod, Workspace & Support Pod | In two Pods |
| Elena Sokolova | Data Technician | Production & Delivery Pod | Handles productions and media |
| Ravi Menon | Data Scientist | Analytics Pod | Analytics and TAR |
| Nora Beck | Intake Coordinator | - | Logs requests, no workflow execution |
| Sam Idris | New employee | - | First login, no roles yet |
| Alex Admin | System Admin | - | Configuration |
| Requestors (not users): Linda Cho (paralegal), Tom Hargrove (partner), Greta Voss (client IT) | - | - | Entered as Requestor Name/Email only |

## Shared preconditions

- Client `00343` "Acme Industrial" and Matter `00343-00012` "Smith v Acme" (active) exist, as do Client `00101` "Northwind Partners" with Matter `00101-00003`.
- Matter `00343-00012` has custom fields set: responsible attorney Tom Hargrove, ESI protocol Agreed / entered, clawback FRE 502(d) order.
- Assets in 00343-00012: Relativity Workspace "00343-00012 - Smith v Acme" (Artifact ID 1020441, Active); Collection "00343-00012 - Jones mailbox - 2026-09-14" (Received).
- Priorities: Critical, High, Normal (default), Low. Statuses as seeded.

---

## Scenario 1: Rush processing request that arrives as a forwarded email (paste path)

**Personas:** Linda Cho (requestor), Nora Beck (intake), Marcus Ellery (Pod Lead), Jamal Okafor (technician).

**Story:** At 9:05 Linda emails Nora: "Please process Jones's mailbox into the Smith workspace by end of day, we have a meet-and-confer tomorrow." The email body also quotes an attorney's advice about case strategy.

**Steps**
1. Nora opens Create Task. She pastes the email into the Outlook-intake paste box (drag-drop is not required). Expect: Title prefilled from the Subject, Description from the body, Requestor Name = Linda Cho, Requestor Email prefilled, sent time shown.
2. Nora reads the privilege notice, trims the quoted chain, and rewrites the Description to a one-line summary. Expect: edits allowed; Description is plain text.
3. Nora types Matter `343-12` in the Matter picker. Expect: resolves to `00343-00012` Smith v Acme; Project left empty.
4. She picks Task Type **Data Processing**. Expect: form renders; the only eligible workflow is **Standard Processing and Load**, pre-selected.
5. She fills: source = the Jones mailbox collection, target = the Smith workspace, OCR off, dedupe Global, `deadline_driver` = Stipulation with opposing party, `deadline_note` = "meet-and-confer 10/15". Priority High. Due date today with time 17:00. Pod = Processing Pod; no assignee.
6. She submits. Expect: Task created, status **New**, number TSK-nnnn, Due shows "today 5:00 PM", workflow instance with 7 steps all Pending; appears in Pod Work for the Processing Pod as unassigned and in the Task Queue sorted under High with an explicit deadline.
7. Jamal sees it in Pod Work, opens it and assigns it to himself. Expect: status auto-moves to **In Progress** (addendum A); audit shows assignment and status change.
8. Marcus opens Task Queue, filters Priority = High, Pod = Processing. Expect: Task listed, not overdue, "Due soon" amber label if within the threshold.

**Negative checks**
- Nora tries to leave Description empty: allowed (optional). Tries to create without a Requestor Name: blocked with an inline error.
- She tries to select a Project from Matter 00101-00003: blocked (cross-Matter).

---

## Scenario 2: Outgoing production with a court-driven deadline and a failed QC

**Personas:** Priya Raman (PM), Elena Sokolova (technician), Tom Hargrove (partner, not a user), Dana Whitfield (Director).

**Story:** A court order requires volume PROD004 to opposing counsel by Friday 3 pm. Tom has cleared the set verbally.

**Steps**
1. Priya creates Task Type **Production (Outgoing)** on `00343-00012`. Fills: source workspace = Smith workspace, produced to "Acme opposing counsel", format TIFF + load file, Bates prefix `ACME`, starting `ACME0004001`, privilege screen = Complete - cleared by attorney, clawback = FRE 502(d) order, delivery = Secure file transfer link, deadline driver = Court order, note = "Order dated 10/09, para 4". Priority Critical, due Friday 15:00. Expect: deadline note is required once driver = Court order (try submitting without it first: blocked).
2. Priority Critical + explicit due date: Task sorts above all High items; ASAP items within Critical sort above dated Critical (addendum G).
3. Elena assigns herself (status goes In Progress) and starts **S01 Intake Review**: confirms scope, ticks assets registered, completes. Expect: step 2 now available (ordered workflow).
4. She tries to complete **S06 QC** before **S07 Generation**. Expect: blocked by order (SCN-010).
5. Elena completes **S07** with bates range, counts, ticks `privilege_exclusion_verified`, `load_file_validated`, `attorney_cleared` = true and fills `cleared_by` = Tom Hargrove. Expect: cannot complete S07 if `privilege_exclusion_verified` is unchecked (required input).
6. QC (S06) done by Priya as second person: result **Fail - rework needed**, rework note "Bates gap at ACME0004388". Expect: `rework_notes` required when Fail.
7. Elena reopens **S07** to rebuild (reopen: no reason needed). Expect: S07 In Progress, S06 stays Completed (downstream not reset, SCN-013); a "reopened prerequisite" flag on S07; S08 (never resolved) stays blocked until S07 is resolved again, while S07 itself can be re-resolved at once (ordering guard, architecture 8.2).
8. She re-completes S07, re-runs S06 with result Pass. She then completes S08 (sent time, method, recipient, encryption applied, receipt confirmed = Awaiting confirmation) and S10.
9. She clicks Complete on the Task. Expect: Task Completed; completed time recorded.
10. Dana checks the Dashboard: Critical items count; the production no longer open; a court-driven filter by `deadline_driver` lists it as Completed.

**Negative checks**
- Skip S06: blocked (non-skippable in Standard Production).
- Edit Task form values while Completed: blocked until reopened.

---

## Scenario 3: Physical media arrives; chain of custody to destruction

**Personas:** Greta Voss (client IT, courier), Elena Sokolova (technician), Priya Raman (PM), Dana Whitfield (Director).

**Story:** A hard drive with the Jones laptop image arrives by courier. Over six weeks it is checked out, imaged, then destroyed on client instruction.

**Steps**
1. Elena creates Asset (Matter 00343-00012) type **Physical Media**, Display Name `00343-00012-M003`. Fills label, type External hard drive, serial, received today, received from Greta Voss, condition Sealed and intact, seal number, is encrypted = true, key location "client IT will email password to Elena (not stored here)". Storage location "Evidence cage B shelf 3", custody holder Elena. Expect: key location required once Is encrypted is ticked. Status In custody.
2. Elena tries to enter a value that looks like a password in key location. Expect: nothing enforces it (honor-system), but the field help warns; note for the tester.
3. She creates a Task **Physical Media Custody Event** event "Received at firm", linking media asset `M003`, released by Greta Voss, received by Elena, time 10:40, condition Sealed, signed receipt ticked, new location Evidence cage B shelf 3. Workflow Quick Request: she completes S01 and S10. Task Completed.
4. Three weeks later a second Custody Event: "Checked out internally", released by Elena, received by Jamal Okafor. Asset updated: custody holder Jamal, status Checked out.
5. Another: "Checked back in", storage location required (verify rule).
6. The client instructs destruction. Elena creates event "Destroyed". Expect: destruction method, witness, certificate reference and authorized-by all required; submit blocked until filled.
7. She sets the Asset status to **Destroyed** and fills disposition date and certificate reference.
8. Dana, as Director, opens the Asset's History tab. Expect: every edit with actor, time, field, old/new value; the Custody Event Tasks visible under linked Tasks, giving a complete ordered chain: received, checked out, in, destroyed.
9. Priya later tries to delete the Asset. Expect: no delete action exists; only status change.

**Negative checks**
- Link the media to a Task in Matter 00101-00003: rejected (cross-Matter).
- Create a duplicate Asset with the same Display Name in the same Matter: non-blocking warning.

---

## Scenario 4: Wrong Task Type chosen; cancel and recreate; move Project

**Personas:** Nora Beck, Jamal Okafor.

**Steps**
1. Nora creates a Task of type **General / Ad Hoc Request** titled "Load production from Northwind" on `00101-00003`. Realizes it should be **Incoming Production Intake**.
2. She opens the Task and looks for Task Type or Matter in the edit form. Expect: both read-only (addendum A).
3. She edits the Title and a form value. Expect: allowed and audited, form version unchanged.
4. She cancels the Task. Expect: dialog requires a comment; submitting empty is blocked. She writes "Wrong Task Type, recreated as TSK-nnnn". Status Cancelled; unresolved workflow steps do not block.
5. She creates the correct Task of type **Incoming Production Intake**, producing party Northwind, received via Physical media. Expect: `media_asset` required; she creates the media asset first, then selects it.
6. Project change: she creates Project "Incoming productions" in 00101-00003, moves the new Task into it. Expect: allowed; the Task's Matter unchanged; audit shows the Project change.
7. She attempts to move the Task to a Project of Matter 00343-00012. Expect: Project picker offers only 00101-00003 Projects; API rejects otherwise.
8. Jamal reopens the cancelled Task (to read it) by moving it to In Progress. Expect: allowed if Matter active; then cancels again with a comment.

---

## Scenario 5: Conditional form behavior on a processing request

**Personas:** Jamal Okafor (tester of the form), Alex Admin.

**Steps**
1. Create a **Data Processing** Task. Leave OCR unticked. Expect: OCR language hidden.
2. Tick OCR required. Expect: OCR language appears and is required; submitting without it shows an inline error from both client and server.
3. Select Processing profile = "Custom (describe)". Expect: custom profile description appears and is required.
4. Tick "Password-protected files known". Expect: "Where passwords are held" appears and is required. Enter "client IT will send by phone".
5. Set a Date range start but no basis. Expect: Date field filtered on is required.
6. Choose handling flag "Highly confidential / Attorneys' Eyes Only". Expect: handling notes required. Add "Foreign / cross-border data" too; still required.
7. Untick OCR after filling the language. Submit. Expect: the hidden OCR language value is not persisted (dropped); reopen the Task and confirm no OCR language shown.
8. Replay the submission directly against the API with a missing required visible field (tester with a script). Expect: 400 with a field-level `REQUIRED` error; the server is authoritative.

---

## Scenario 6: Complete a Task with unresolved steps (bulk complete and its guard)

**Personas:** Jamal Okafor, Marcus Ellery.

**Steps**
1. A **Data Load / Overlay** Task uses **Data Load Only** (S01, S02, S05, S06 skippable with comment, S10). S01 and S02 are done. Jamal did the load outside the tool and clicks **Complete** on the Task.
2. Expect: confirmation "You have 3 steps not completed. Do you want to mark them all completed?" listing the step names.
3. S05 has required inputs missing (workspace, expected, loaded, reconcile, spot-check). Expect: the dialog lists S05 as unable to auto-complete; the Task stays open; Jamal opens S05, fills inputs, completes it; clicks Complete again.
4. Now remaining S06 and S10 have required inputs too (S06: method, defects, result; S10: summary, assets updated, notified). Expect: both listed as missing inputs. Jamal skips S06 with a comment (allowed, comment required) and fills S10.
5. Click Complete. Expect: all done, Task Completed; audit shows the individual step events and the Task completion (no step carries the bulk flag, because the user resolved each step).
6. Variant: a Task whose remaining steps are all fully filled but not marked complete. Click Complete, confirm. Expect: all steps Completed in order (not Skipped), then Task Completed, one transaction; audit rows share one correlation id with a bulk flag.
7. Cancel at the dialog. Expect: nothing changes.

---

## Scenario 7: Number normalization, uniqueness, and Matter state rules

**Personas:** Priya Raman, Dana Whitfield.

**Steps**
1. Priya creates Client number `343`. Expect: stored and displayed `00343`; if `00343` exists, rejected as duplicate. Entering `1234567` is rejected (more than 5 digits); `12a` rejected.
2. She creates Matter `12` under Client `00343`. Expect: `00012`; combined `00343-00012`. Matter `00012` under Client `00101` is allowed (unique only within Client). Duplicate under same Client rejected.
3. She uses Global search for `343-12`, `00343-00012`, `00343-00012 Smith`, and `Acme`. Expect: Matter found each time (padded and unpadded); results only include records the user may see.
4. She uses the Copy button on the Matter header. Expect: clipboard holds `00343-00012`.
5. Priya edits the Matter number (she lacks `Matter.EditNumber`): control disabled. Dana edits it: audited event with old and new values.
6. Dana tries to set Matter `00101-00003` inactive while it has an In Progress Task. Expect: blocked with the list of open Tasks. She cancels/completes them, then deactivates; warning lists any Assets not in a final status.
7. Priya attempts to create a Task on the inactive Matter. Expect: blocked ("Matter is inactive"). She attempts to reopen a Completed Task on it. Expect: blocked while inactive.
8. Dana reactivates the Matter; creation works again.

---

## Scenario 8: Reopening a step on a Completed Task and the effects

**Personas:** Elena Sokolova, Dana Whitfield, Priya Raman.

**Steps**
1. Use the Completed production Task from Scenario 2 (or any Completed Task on an active Matter).
2. Elena opens its Workflow tab, reopens **S08 Delivery** to correct the tracking reference. Expect: the Task automatically moves to **In Progress**; audit has `STEP_REOPENED` and `TASK_STATUS_CHANGED` with cause step reopen; Completed time cleared.
3. She edits the tracking reference, completes the step, then completes the Task. Expect: Task Completed again.
4. While the Task is Completed, she tries to edit the Title. Expect: blocked ("reopen first").
5. She adds a Comment on the Completed Task. Expect: allowed (comments allowed in all statuses).
6. Dana sets the Matter inactive after all Tasks are done. Elena then tries to reopen a step on a Completed Task of that Matter. Expect: blocked because the Matter is inactive.
7. Priya, who has `Task.Reopen`, attempts to reopen a step but has no `Workflow.StepReopen` (test with a custom role). Expect: step reopen denied, Task reopen allowed. Confirms permissions are independent.

---

## Scenario 9: One attorney request becomes a Project with several Tasks; Pod work; On Hold; reassignment

**Personas:** Priya Raman, Marcus Ellery, Jamal Okafor (two Pods), Ravi Menon, Elena Sokolova.

**Story:** Tom Hargrove asks for "everything on Jones: process it, give a hit report on the new search terms, set up TAR, and produce the first 5,000 documents next week."

**Steps**
1. Priya creates Project "Jones custodian workstream" on `00343-00012` (workstream = Collection and processing, target date next Friday).
2. She creates four Tasks inside it: Data Processing (assigned to Processing Pod), Search and Culling (Analytics Pod), Analytics / TAR Setup (assigned to Ravi), Production (Outgoing) (Production & Delivery Pod, no due date so ASAP). Expect: the Project page lists all four; Matter page shows the Project and its Tasks.
3. Jamal, a member of Processing and Workspace & Support Pods, opens My Work. Expect: only tasks assigned to him personally; Pod Work lets him switch Pods and shows unassigned Pod tasks.
4. Marcus reassigns the Processing Task from Jamal to Elena (not in the Processing Pod). Expect: allowed, with a warning that the assignee is not a Pod member (A-11); no Pod restriction.
5. The processing Task needs a password from the client. Jamal sets the Task **On Hold**. Expect: a comment is requested ("Waiting on Greta Voss for password for 3 files") per the recommended rule; the Task shows On Hold, step actions blocked (resume first).
6. Next morning the password arrives; Jamal resumes the Task (In Progress), then Marcus assigns the Search Task to Ravi.
7. Priya checks the Task Queue sorted by default. Expect: ordering by Priority then ASAP above dated within priority; the ASAP production sorts above a dated Normal Task; overdue label only on explicit dates.
8. Alex Admin deactivates Jamal's user (he is leaving). Expect: Task Queue assignee filter still lists Jamal (inactive); an admin view shows his open Tasks; Marcus reassigns them one at a time.
9. Priya tries to complete the Project's Production Task before the processing Task is done. Expect: no cross-task dependency exists (decided); nothing blocks. This verifies the tracker does not enforce task dependencies.

---

## Scenario 10: First login, access grant, and configuration versioning

**Personas:** Sam Idris (new), Alex Admin (System Admin), Marcus Ellery, Dana Whitfield.

**Steps**
1. Sam opens MatterFlow for the first time. Expect: Windows identity resolved (or Dev provider in test); a user record created with zero roles; Sam sees only "Access Pending." Direct API calls to list Tasks, Clients, Users return 403.
2. Sam signs in again. Expect: no duplicate user.
3. Alex opens the User Access queue, sees Sam, grants role **Data Technician** and adds him to the Processing Pod. Expect: audit records the grant. Sam refreshes; Task Queue now visible; Admin menu hidden; `GET /task-types` management endpoints return 403.
4. Marcus (Pod Lead) tries to open Administration > Task Types. Expect: not permitted (config is System Admin only by default).
5. Alex opens the **Standard Processing and Load** workflow, creates a new draft, adds a second QC placement after S03 and changes S04 to non-skippable, then publishes version 2. Expect: published version immutable; v1 retired.
6. A Task created before publishing (still on v1) keeps seven steps and the old S04 setting (SCN-014). A Task created after uses v2.
7. Alex edits the **Data Processing** form: adds a required field `custodian_count_confirmed` and publishes. Expect: existing Tasks keep the old form version and values; new Tasks require the new field; opening an old Task and editing a value stays on its form version.
8. Alex edits the Step Definition **S06 Quality Control Check** in the library (changes instructions). Expect: already published workflow versions show the old instructions (addendum A); only workflows republished afterwards pick up the change.
9. Alex changes the status display label "On Hold" to "Waiting". Expect: UI everywhere shows Waiting; filters and audit still use code `ON_HOLD`.
10. Dana, with `Audit.View`, filters audit by object type Task Type and sees Alex's publishes with actor and time; Marcus cannot open the audit screen.

---

## Coverage map

| Area | Scenarios |
|---|---|
| Intake (paste, manual), requestor, privilege notice | 1, 4 |
| Deadlines, ASAP, priority, sorting | 1, 2, 9 |
| Ordered workflow, skip, reopen, QC | 2, 6, 8 |
| Bulk complete and guard | 6 |
| Conditional forms, server validation | 2, 3, 5 |
| Assets, cross-Matter rejection, history, custody | 3, 4 |
| Number normalization, search, Matter inactive rules | 7, 8 |
| Pods, My Work, Pod Work, On Hold, reassignment, offboarding | 1, 9 |
| Roles, JIT provisioning, versioning, labels, audit | 10, 8 |
