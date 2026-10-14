# MatterFlow Domain Review (eDiscovery Operations SME)

**Reviewer role:** eDiscovery operations SME (EDRM, Relativity, Harvey, processing/production, PM and technician practice, privilege and confidentiality).
**Inputs:** `requirements/baseline-v1.1.md`, `requirements/decisions-addendum.md` (overrides baseline), `architecture.md` sections 6.3, 7, 8, 19, `ux/ux-spec.md` (skimmed).
**Ground rules respected:** no billing, no stored attachments, no approvals, no external integrations, no ethical walls in Phase 1, anyone with `Task.View` sees all Tasks, Task Type/Workflow/Matter immutable after create. I do not re-open any of these. Where a risk comes from a decided scope item, the recommendation is a **mitigation inside that scope** (configuration, convention, small UI affordance, or a go-live precondition), not a reversal.

Labels: **MUST-FIX (Phase 1)** = would cause real operational or confidentiality harm at launch, and the fix is small. **LATER** = valuable, safe to defer. **CONFIG** = no code; solved by the seed configuration in `seed-configuration.md`.

---

## 1. Verdict

The model fits how an eDiscovery department actually works: Matter-centric, a configurable intake form per request type, reusable procedural steps, assets as references to things that live in Relativity/Harvey/on a shelf, and an audit trail that substitutes for approvals. The decision to keep it a tracker (not a review platform, not billing) is right. The biggest gaps are not features; they are **three operational truths the design underplays**:

1. **Deadlines are external and different in kind.** A "due date" in this business is usually a court order, a stipulated production date or a regulator's date, and missing it has sanctions consequences. The design has one optional internal Due Date and no notifications.
2. **Physical media and data have a chain of custody** that lawyers may have to prove years later. The design treats Assets as simple references with audited edits.
3. **Task text is likely to contain privileged or highly sensitive content** (email bodies with legal advice, witness names, deal code names), and Phase 1 visibility is "anyone with `Task.View` sees all."

Everything below is mostly a way of making those three safe without growing scope.

---

## 2. Findings and recommendations

### 2.1 Deadlines and dates

| # | Finding | Why it matters in practice |
|---|---|---|
| D1 | One Due Date serves two meanings: "when my team will finish" and "when the court/other side needs it." | A production due to opposing counsel at 5 pm Friday is not the same as an internal target of Thursday. Technicians prioritize by the date shown; if the field mixes both, real deadlines get lost or padded. |
| D2 | No notifications (decided) plus no "due soon" escalation beyond a 2-day amber label. | Without alerts the *only* protection against a missed court deadline is someone opening the queue. |
| D3 | Date-only Due Date is overdue after 23:59 firm time. | Deliveries often have a clock time (e.g. "by 3 pm ET," "COB"); firm-wide single timezone is fine, but cross-office staff must see the time. |
| D4 | Data date ranges (collection/processing/search scope) are not first-class. | Date ranges are the most common source of rework: inclusive vs exclusive, which date field (sent vs modified), which timezone. |

**D1 MUST-FIX (Phase 1, small).** Keep the Due Date as the date the *work* must be finished. Every deadline-bearing Task Type form carries a standard block: `deadline_driver` (Internal / Court order / Regulatory / Stipulation / Client / Other) and `deadline_note` (required when the driver is court, regulatory or stipulation). This is pure configuration and is already in the seed (CONFIG). The MUST part: make sure the Task Queue filters can filter/show *at least one* of these filterable fields (mark `deadline_driver` `IsFilterable` in the seed; the engine allows 5 per form version) so a PM can pull "all court-driven work." Also have Priority guidance (seed) say Critical = court-ordered or same-day.

**D2 MUST-FIX (Phase 1, tiny).** Notifications stay out. But: (a) the Dashboard must show a **Due soon** tile and an **Overdue** tile for everyone, not only for `Dashboard.ViewDepartment` holders (the UX spec's fallback tiles already do for My Work; confirm they exist for the department view too); (b) the Task Queue must support a one-click "Due within 2 business days + Overdue" preset, shared by all. **LATER:** email digest of Critical/High items due within 48 hours (the lowest-cost notification to add first).

**D3 MUST-FIX (UI only).** When a Due Date has a time, show the time in every list (Queue, My Work, Pod Work), not only on the detail page. When only a date, show date; ASAP stays ASAP. The seed encourages entering a time for external deliveries.

**D4 CONFIG now, LATER as structure.** Seed forms carry `date_range_start`, `date_range_end`, `date_basis` (conditionally required when either date is set) and `time_zone`. **LATER:** a shared "date range" composite control (start, end, basis, inclusive note) so the pattern is identical across forms and filterable.

### 2.2 Custodians

| # | Finding |
|---|---|
| C1 | "Custodian" appears only as an illustrative text field; it is multi-valued, is the pivot for processing, search and collection, and is shared across tasks of one Matter. |
| C2 | Typing custodian names free-form on every Task produces spelling variants ("Jones, Bob", "Robert Jones"), making it impossible to answer "what has been done for custodian X?" |

**C1/C2 CONFIG now:** custodians are a `TEXTAREA`, one per line `Last, First (title)`, required on Collection Receipt and Collection/Data Set assets (seed). Global search covers Task Title/ID and Asset fields; since custodians are not title text, tell users to put the key custodian in the title (seed example titles do).
**LATER:** a Matter-level **Custodian list** (name, title/department, status such as in-scope, hold issued, data collected) referenced by `CUSTODIAN_REF` / multi-select fields. This is the single most valuable domain object missing from the model, but it is a new entity and not needed for launch. Until then, put the canonical custodian list in a Matter custom field (`TEXTAREA`) and ask people to copy names from it.

### 2.3 Chain of custody for physical media

The design lists "Physical Drive / Media" as an Asset Type and audits Asset edits, which is a good base. Gaps:

| # | Finding | Recommendation |
|---|---|---|
| M1 | Asset history is audit-only; is it viewable by the people who handle media, and does it show *who held it when*? Chain of custody needs a readable sequence of transfers: from, to, date/time, condition/seal, reason. | **MUST-FIX:** on Asset detail, show an **Activity/History tab** listing audit events for that Asset (field, old, new, actor, time), visible to anyone with `Asset.View`. Confirm the UX spec has it for Assets, not just Tasks. |
| M2 | Assets can be edited in place; a custody-relevant field (custody holder, location, status) could be silently overwritten, and there is no "reason." | **MUST-FIX (convention + config):** the seed adds a Task Type **Physical Media Custody Event** (one Task per transfer: released by, received by, date-time, seal number, condition, tracking, signed receipt). The Tasks *are* the chain of custody ledger, because Tasks are immutable by Type/Matter and every edit is audited. Also make sure `Asset` records cannot be hard-deleted in the UI/API, only set to an inactive status (architecture A-10 covers Task Types/Workflows; extend to Assets). |
| M3 | The Asset "status" is generic. | **CONFIG:** seed statuses for Physical Media: In custody, Checked out, At vendor, Returned, Destroyed. Disposition fields (date, certificate reference, authorized-by, witness) become required by rule when Returned/Destroyed. |
| M4 | Hash values and seal numbers have no structured home. | **CONFIG:** fields on the Physical Media and Collection assets (hash algorithm + value, seal number, condition on receipt). |
| M5 | Passwords/keys for encrypted media are an obvious temptation to type into a text field. | **MUST-FIX (guard-rail copy):** field help and form copy in the seed say "where the key is held, never the key itself"; add the same line to the Asset form builder help. An admin tool that scans for fields named *password* is overkill; the copy and training are enough. |
| M6 | Destruction and return need witness/certificate and authorization from an attorney or client. Approvals are out of scope, but *recording who authorized* is not approval. | **CONFIG:** `authorized_by`, `certificate_ref`, `destruction_witness` fields (seed). |

**LATER:** printable media label / custody receipt (the "no reports/exports" decision stands; a print stylesheet for one Task is enough), barcode scanning for media labels.

### 2.4 Privileged and confidential content

Phase 1 facts: Outlook intake copies the email body, signature and quoted chain into Description (UX spec: "signatures and quoted chains are kept"); comments are rich text; audit stores old/new values; any `Task.View` holder sees everything; global search returns titles. No ethical walls (decided).

| # | Finding | Recommendation |
|---|---|---|
| P1 | An email forwarded from an attorney may be an attorney-client communication or contain work product. It becomes Task Description and a permanent audit "new value." | **MUST-FIX:** on the Outlook-intake screen and the Task Description field show a short, always-visible notice: "Summarize the request. Do not paste privileged advice or the full email thread." Default the pasted body to *collapsed with a Trim quoted text action*, and make "trim quoted chain" a one-click action (the UX spec says the user trims manually; one click is cheap). |
| P2 | Highly sensitive matters (M&A code names, internal investigations, HR) will be visible in Queue titles to every `Task.View` holder, and in global search. | **MUST-FIX as a go-live precondition, not code:** (a) the firm's General Counsel / risk partner formally signs off that Phase 1 open visibility is acceptable for the eDiscovery department; (b) `Task.View` is granted only to eDiscovery department staff (it is a role grant, so this is already possible); (c) a **Matter custom field `sensitivity_flag`** with a `code_name` (seed) and a rule: for flagged Matters, titles use the code name. This respects "no ethical walls" while giving staff a visible rule. **LATER (already decided):** ethical walls / matter ACLs. When built, they must also gate search, dashboard counts and audit reads. |
| P3 | Audit and logs hold content. The baseline says log redaction is proposed; confirm it is in the build. | **MUST-FIX:** error logs and the correlation-id page must never include form values, descriptions or comment bodies (UX spec UAT-S22-2 covers the page; verify the logs). `Audit.View` stays Director/Compliance only (seed). |
| P4 | Handling flags are not captured as structured data. | **CONFIG (and recommended default for every type):** `handling_flags` multi-select (Privileged material, PII/PHI, AEO, Cross-border, Protective order) with required `handling_notes` for AEO and cross-border. |
| P5 | Client "outside counsel guidelines" (OCG) commonly restrict use of AI tools, third-party vendors and data location. Harvey Vault requests are exactly where this bites. | **CONFIG:** Client custom field `outside_counsel_guidelines`; Harvey Vault asset and request form require `client_ai_use_confirmed`. **LATER:** a soft warning on Harvey tasks when the Client's OCG says restrictions apply. |
| P6 | Comments are "internal only" (decided) but still accessible to all `Task.View` holders. | Covered by P1/P2. Add the same notice above the comment box (one line). |

### 2.5 Naming, references and the `#####-#####` convention

| # | Finding | Recommendation |
|---|---|---|
| N1 | The combined reference is the key people paste into Relativity workspace names, folder paths and emails. | **MUST-FIX (small):** every place that displays the combined ref has a **Copy** affordance (Matter header, Task header, Asset header). Copy always yields the padded form `00343-00012`. |
| N2 | Users type `343`; the system pads to `00343` (addendum B). Good. Risk: people searching on a workspace name like `343-12` or `00343-00012 - Smith v Acme`. | **MUST-FIX:** global search must accept (a) unpadded pairs `343-12`, (b) padded pairs, (c) a pair followed by free text (strip after the second number). Add to the search test vectors. |
| N3 | No convention for naming Assets; "Display Name" will become inconsistent, and an eDiscovery department lives on consistent names. | **CONFIG:** seed naming patterns per Asset Type: workspace `#####-##### - Short name`; media `#####-#####-M###`; collection `#####-##### - Source - date`; production `#####-##### - PROD###`. Put the pattern in each Asset Type's help text. **LATER:** an optional "name pattern" validation per Asset Type (warn, never block). |
| N4 | Duplicate assets: the same Relativity workspace registered twice (different spellings), or the same Artifact ID in two Matters. | **MUST-FIX (small):** on Asset create/edit, warn when another Asset in the same Matter has the same Display Name (case-insensitive) or, for workspaces, the same `workspace_artifact_id`. Warn only. **LATER:** configurable "unique within Matter/system" field flag, which would also cover Bates ranges and media serial numbers. |
| N5 | Task numbers `TSK-1042` are system-wide while people refer to work as "the Smith processing." | Already mitigated by titles. Seed titleHint examples carry the custodian/volume in the title. |
| N6 | Firms usually have internal/administrative matters (training, tool maintenance, vendor evaluation, access audits). | **CONFIG:** seed internal Client/Matter (example `00001-00001`). Tell the firm to create their own. |

### 2.6 Request data commonly needed (fields)

The Task core (title, description, priority, due date, requestor, Pod, assignee) is right. What PMs and technicians reliably need and that must be in the *forms* (all CONFIG in the seed):

- **Requesting attorney vs. submitter:** paralegals often send on behalf of an attorney. Requestor Name/Email is a single person. Add `responsible_attorney` to the Matter (seed) and a free-text "on behalf of" convention; **LATER:** optional second contact on Task.
- **Deadline driver and note** (see D1), **handling flags** (P4), **time zone**, **date range and basis**.
- **Source and destination assets** (ASSET_REF) on every data-movement type, so the Asset-to-Task link carries the story ("what processed into where").
- **Expected volume** (GB, docs): drives Pod planning. Not billing.
- **Confirmation that approvals were obtained** (e.g. attorney cleared the production set; who authorized a transfer or destruction). The product owner removed approvals; recording a *fact and a name* on the form is not an approval engine and is how technicians protect themselves. The seed uses `attorney_cleared` + `cleared_by` and `authorized_by`.
- **Matter-level context** the team keeps asking for: court, case number, ESI protocol status/location, clawback order status, legal hold status (informational), trial/discovery cutoff dates (Matter custom fields in the seed).

### 2.7 On Hold, waiting and follow-up

| # | Finding | Recommendation |
|---|---|---|
| H1 | Much real work waits on someone else (client password, vendor media, attorney clearance). The On Hold status has no reason. Cancel requires a comment; Hold does not. | **MUST-FIX (small):** require a comment on transition to On Hold ("Waiting on whom / for what"), same mechanism as Cancel. If the product owner prefers no new rule, make it a prompt with a pre-filled "Waiting on: " that can be left blank. Without a reason, On Hold becomes a graveyard. |
| H2 | Aging On Hold items are invisible. | **LATER:** Dashboard "On Hold longer than N days" tile; the baseline already has aging. Use the existing "status changed at" column to sort. |
| H3 | A step cannot be worked while the Task is On Hold (architecture A-6). | Acceptable; note for training: if only one input is missing, finish what you can first and put the Task On Hold at the end. |

### 2.8 Workflow and step realities

1. **One request often means several Tasks** (process, load, search, produce). No subtasks/cloning (decided). **Convention (CONFIG):** use a **Project** as the "request" container and one Task per deliverable; seed Project field `workstream`. Scenario 9 exercises this. **LATER:** "Duplicate Task" button (copy of fields only, not workflow state).
2. **Skip vs. Complete.** Seed marks exception handling and QC as skippable only with a mandatory comment in the faster workflows; productions have non-skippable QC. This matches the department norm that nothing goes out the door unchecked.
3. **Bulk complete (addendum K) is risky on a Production.** The shortcut marks all remaining steps Completed even when nobody did QC or delivery. The "required inputs" guard helps because the seed makes critical checks required checkboxes (`privilege_exclusion_verified`, `attorney_cleared`, `receipt_confirmed`). **MUST-FIX (config):** keep those as `required` in S07/S08 so the guard bites. Also show the list of steps that will be bulk-completed in the confirmation dialog by name (not only a count).
4. **QC by a different person** is a norm: a checkbox `qc_by_other_person` is in S06. A system rule ("QC step cannot be done by the same user as step N") would be step-level ownership and is out of scope.
5. **Reopen of Production steps after delivery** is legitimate (a re-production). Convention: do not reopen a delivered production; create a new Task and a new Production asset (volume superseded). Put in the training notes. The Production asset status "Superseded / re-produced" and "Clawed back" exist for this.

### 2.9 Assets and the registry

- **Lifecycle status per type** (seed): workspaces get archived/deleted; data sets are superseded; media are returned/destroyed; productions get superseded/clawed back. A generic Active/Inactive is not enough (**MUST-FIX**: allow Asset Types to define their own status list, or at minimum seed a general Status select; confirm architecture supports per-type statuses, else use a form select on each type as the seed does).
- **Assets without a Task** are fine (a workspace registered after the fact). **Tasks should link Assets with a role** (Source/Destination/Subject/Result, baseline 5.3, OPEN-14). **MUST-FIX (decide):** adopt exactly those four labels as seed values for TaskAsset roles (non-configurable in Phase 1 is fine); without them "linked assets" is unreadable on a Matter with 200+ assets.
- **200-300 assets per Matter:** the registry needs a Type filter, a status filter and a name search on the Matter's Assets tab (UX spec shows lists; confirm those filters).
- **Matter close:** closing a Matter requires all Tasks Completed/Cancelled (decided). Real closes also require disposition of assets (workspaces archived, media returned). **LATER:** "Matter close checklist" showing assets still Active/In custody. **MUST-FIX (small):** when an admin tries `Matter.SetActive=false`, the confirmation lists *Assets not in a final status* as an informational warning (it does not block). Cheap and prevents forgotten drives.

### 2.10 Roles and permissions

- The architecture starter matrix is sound. Observations: (a) **Intake Coordinator** and **Read-Only Observer** roles are the two most requested in practice (seed); (b) **Task.Cancel + Task.Reopen for everyone** with `Task.View` seeing all, plus no reason on reopen, is lenient but consistent with "audit instead of approval"; (c) technicians creating Projects is fine; creating Clients/Matters is not in the matrix; the architecture's open question 1 should be answered **no for technicians, yes for PMs and Pod Leads** because a mistyped Matter number is hard to correct (all assets/names depend on it).
- **MUST-FIX (config):** Because `Task.View` exposes everything, do not grant the Data Scientist or any contractor role until the firm's sign-off (P2). External/contract technicians should be a **separate role** and ideally not exist in Phase 1.
- **Audit.View** (Director, Compliance Auditor) is correct; do not give it to PMs.

### 2.11 Offboarding, coverage and handover

Offboarding is manual and one-by-one (decided). Real departures and vacations are common. **MUST-FIX (UX):** the Task Queue assignee filter includes inactive users (decided) and the User admin screen shows a count of open Tasks per user *with a link to the filtered queue*, so the admin can find and reassign. **LATER:** bulk reassign (decided out of scope for now) and out-of-office delegate.

### 2.12 Retention, data protection and the product's own data

- Audit is kept forever (A-14) and contains form values. Clients' OCGs may require destruction of client information at matter end. **MUST-FIX (decision, not code):** the firm decides before go-live whether MatterFlow data (task text, audit, comments) counts as client data under the OCG and who may request deletion. If yes, a purge procedure (by Matter, run by DBA, scripted) is needed within months of the first matter closing. Capture the decision in the project risk log. **LATER:** admin "Purge Matter" tool.
- Backups also hold this data; align backup retention with the same decision (architecture open question 5).
- Windows Auth, TLS, SQL encryption at rest: assume per firm standards; verify.

### 2.13 Intake

- Outlook drag-drop is an unvalidated spike (decided; paste/manual path always works). Operationally, **most urgent requests arrive by phone, Teams or in person**; the manual form must be fast: Matter lookup by typed number, a default workflow pre-selected per Task Type (seed provides defaults), Priority default Normal, assignee optional. Aim: a Task creatable in under 60 seconds for a simple request.
- **Duplicate forwards:** the same email gets forwarded by two people. **MUST-FIX (small):** on Task create, if another open Task in the same Matter has the same Title (case-insensitive), show a non-blocking "Similar open Task: TSK-nnnn" link. **LATER:** match on requestor + sent date.
- **Requestor from the email "From" prefill** will often be a paralegal on behalf of an attorney (see 2.6). Fine.

### 2.14 Metrics that were declined, but data should still be captured

Reports/exports are dropped (decided), so volumes recorded in step inputs (docs processed, GB, QC defects) become trapped in JSON. **LATER:** mark a few step inputs `IsFilterable` so that the Queue could filter on them and a future export can read them. In the seed, the following step inputs are the candidates: `docs_published`, `docs_loaded`, `qc_result`, `exceptions_remaining`. No billing or productivity implications; these are quality and capacity metrics.

---

## 3. Prioritized recommendations

### 3.1 MUST-FIX for Phase 1

| ID | Recommendation | Size | Section |
|---|---|---|---|
| MF-1 | Privilege/confidentiality notice on Outlook intake, Description and comment box; one-click "trim quoted chain" | S | 2.4 P1, P6 |
| MF-2 | Go-live precondition: GC/risk sign-off of open `Task.View` visibility; restrict `Task.View` to department staff; `sensitivity_flag` + code-name convention on Matter | Process + config | 2.4 P2 |
| MF-3 | Deadline driver/note block in Task Type forms; filterable; Priority guidance tied to court deadlines | Config | 2.1 D1 |
| MF-4 | Due soon + Overdue visible on Dashboard for all users; show due time in every list | S | 2.1 D2, D3 |
| MF-5 | Asset history tab visible to `Asset.View`; Assets never hard-deleted; per-type status values | S/M | 2.3 M1, M2; 2.9 |
| MF-6 | Physical Media Custody Event Task Type + Physical Media asset fields; "never type the password" copy | Config + copy | 2.3 |
| MF-7 | Copy button for combined ref; search accepts unpadded pairs and "ref + text" | S | 2.5 N1, N2 |
| MF-8 | Duplicate warnings (Asset name/workspace ID in Matter; similar open Task title) | S | 2.5 N4, 2.13 |
| MF-9 | Comment required on On Hold | S | 2.7 H1 |
| MF-10 | TaskAsset roles Source/Destination/Subject/Result as seed values | S | 2.9 |
| MF-11 | Confirmation for bulk Complete names the steps; critical checks configured as required inputs | S | 2.8.3 |
| MF-12 | Matter deactivation warns about assets not in a final status; user admin shows open-task count per user with link | S | 2.9, 2.11 |
| MF-13 | Logs/error pages free of form content (verify) | S | 2.4 P3 |
| MF-14 | Decision on retention/purge of MatterFlow data under client OCGs, before first matter close | Decision | 2.12 |
| MF-15 | Seed configuration loaded on first deployment (this package) | Config | seed doc |

### 3.2 LATER

| ID | Recommendation |
|---|---|
| L-1 | Matter-level Custodian list and custodian reference control |
| L-2 | Shared "date range" composite control |
| L-3 | Email digest for Critical/High items due in 48 hours (first notification to add) |
| L-4 | Unique-within-Matter field flag (Bates ranges, serials, workspace IDs) |
| L-5 | Duplicate Task (copy fields) and second contact on Task |
| L-6 | Matter close checklist; "Purge Matter" admin tool |
| L-7 | On Hold aging tile; out-of-office delegate; bulk reassign |
| L-8 | Ethical walls and Matter ACLs (already deferred); when built, cover search, dashboards and audit |
| L-9 | Printable single-Task custody receipt; barcode scan for media labels |
| L-10 | Soft warnings from Client OCG fields (Harvey tasks) |
| L-11 | Export of structured step values (if reports return) |

### 3.3 Things the design got right (keep)

- Immutable Task Type/Workflow/Matter with Cancel-and-recreate: matches how departments treat requests (a wrong type means wrong form and wrong SOP).
- Versioned forms and workflows with snapshot on publish: SOPs change and old work must keep the SOP it was done under.
- Skip with mandatory comment, and reopen without approval but with audit.
- ASAP as a first-class concept: most operational requests have no real date.
- Asset-as-reference, one Matter owner: avoids the temptation to build a document store.
- Pods with cross-Pod assignment allowed (A-11).
- Single firm timezone and UTC storage.

---

## 4. Open questions for the product owner / department head

1. Will the firm accept open visibility within the department (MF-2) in writing, and which matters need code names?
2. Who may create Clients and Matters (recommend PMs and Pod Leads only)?
3. Does any client's OCG require deletion of MatterFlow data at matter end (MF-14)?
4. Is Harvey use gated by a per-client permission process the form should reflect (P5)?
5. Do you want a second contact on Task ("on behalf of attorney") in Phase 1, or is the Matter's `responsible_attorney` enough?
6. Should On Hold require a comment (MF-9) or only prompt?
7. Which of the seed Task Types do not match your actual request catalog? (The seed is a starting point; edit freely.)
