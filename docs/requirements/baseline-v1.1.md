# eDiscovery Project Request Tracker — Product Requirements Baseline

**Document type:** Product and functional requirements baseline / architecture input  
**Version:** 1.1  
**Date:** 2026-10-14  
**Status:** Discovery baseline — confirmed decisions, proposed requirements, and remaining decisions explicitly distinguished  
**Audience:** Product owner, engineering, solution architect, UX/UI designer, QA, security, eDiscovery operations

> **How to read this document**
> - **[CONFIRMED]** is a product decision explicitly agreed during discovery.
> - **[PROPOSED]** is a sensible design recommendation that has not been expressly approved; use it for planning, not as a final policy.
> - **[OPEN]** requires a product decision or technical spike before related implementation is finalized.
> - **MUST / SHOULD / MAY** describe requirement strength *within the stated decision status*. A proposed MUST is not yet an approved requirement.
>
> This document is the consolidated source of truth for requirements discussed to date. It is intentionally detailed enough to drive subsequent system architecture, schema, API contracts, UI specifications, work breakdown, and test planning. It is **not** itself a final technical design.

---

## 1. Product vision and scope

### 1.1 Product objective

Build an **internal law-firm eDiscovery project request and work-tracking application** supporting intake, work assignment, procedural workflow execution, matter-related assets, searchable operational queues, configurable forms, and historical audit trails. The system is an **operations tracker**, not a document-review platform, billing system, or automation engine controlling external eDiscovery systems.

### 1.2 Primary users

- eDiscovery Directors
- Project Managers
- Pod Leads
- Data Technicians
- Data Scientists
- System Administrators
- Other roles subsequently configured by administrators

**[CONFIRMED]** A Project Manager or Technician can create requests; Pod Leads and other authorized users can also create and assign tasks according to permissions. System roles are configurable, except for the built-in System Admin role.

### 1.3 Technology constraints

| Layer | Requirement |
|---|---|
| Relational database | **[CONFIRMED]** Microsoft SQL Server |
| Backend | **[CONFIRMED]** .NET / ASP.NET Core API architecture (exact runtime version TBD) |
| Frontend | **[CONFIRMED]** Angular (exact version and UI component library TBD) |
| Deployment / hosting | **[OPEN]** Firm-hosted, Azure, or other environment |
| Authentication / SSO | **[CONFIRMED]** Phase 1 Windows Integrated Authentication; future Microsoft Entra ID |

### 1.4 Phase boundaries

**Phase 1 — in scope**

- Manual Client and Matter records with firm-assigned five-digit numbers
- Matter-organized Projects, Tasks, and Assets
- Configurable roles and permissions; Pods and multi-Pod user membership
- Task assignment and reassignment by authorized users (including technicians)
- System-wide configurable priority labels
- Fixed internal task lifecycle with configurable display labels
- Optional task due date; absent due date displayed as **ASAP**
- Administrator-defined Task Types and associated eligible Workflows
- Reusable Step Definitions; ordered/unordered workflows; published versioning
- Form builder for Task Type intake and step data, including conditional fields
- Extensible custom fields for core business objects
- Task comments, attachments/source email preservation (subject to security constraints), activity and audit history
- Dashboard, My Work, Task Queue, and Pod Work views
- Outlook-email-assisted creation through drag-and-drop or feasible equivalent
- Basic persistent global search; advanced search as lower-priority Phase 1 functionality

**Phase 2 / deferred**

- AI to infer task type and extract details from email or attachments
- In-app/email notifications, reminders, and escalations
- Advanced search enhancements (broad custom-field indexing, saved personal views where deferred, attachment content search, natural-language/AI search)
- Additional integrations or automation only if separately approved

**Out of scope for Phase 1**

- Approval engine, approver assignments, approval states, or electronic approvals
- Step-level assignment
- Automatic actions in Relativity, Harvey, M365, or other external platforms
- Synchronizing Client/Matter master data with the firm's existing system
- Billing, invoicing, time capture, pricing, profitability, or staff productivity scoring
- Client-facing or vendor-facing external portal
- Assets owned directly by a Client or shared across Matters

---

## 2. Terminology and object relationships

### 2.1 Glossary

| Term | Meaning |
|---|---|
| Client | Internal tracker record representing a firm client; carries an external firm Client Number |
| Matter | Engagement/litigation matter under one Client; carries a five-digit Matter Number unique *within that Client* |
| Project | Optional organizational folder/container grouping Tasks within a Matter; not an independent billing or execution entity |
| Task / Request | Unit of operational work; belongs to one Matter, optionally grouped into a Project |
| Task Type | Admin-configured classification, intake form, and eligible-workflow associations |
| Workflow Definition | Reusable named workflow concept |
| Workflow Version | Immutable published configuration of workflow ordering and steps |
| Step Definition | Reusable library template with step title/instructions/documentation/default inputs |
| Workflow Step | Configuration of a Step Definition within a particular Workflow Version, including overrides |
| Workflow Instance | The workflow version instantiated/snapshotted for a particular Task |
| Step Instance | Execution and submitted-input state of a workflow step on a Task |
| Asset | Matter-owned reference to physical media, data collections, workspaces, Harvey vaults, or third-party datasets |
| Pod | Team grouping of technical personnel with one or more leads |
| Priority | System-wide admin-configured label with an underlying sort order |
| Task lifecycle status | One of the application's fixed internal states, displayed under configurable labels |

### 2.2 Conceptual hierarchy

```text
Client [ClientNumber: 5 characters]
└── Matter [MatterNumber: 5 characters, unique within Client]
    ├── Project [organizational container]
    │   └── Task(s)
    ├── Task(s) [without Project]
    └── Asset(s) [owned by exactly one Matter]

Task
├── Task Type
├── exactly one selected Workflow Version / Workflow Instance
├── optional Assigned Pod
├── optional Assigned User
├── one required Priority
├── optional Due Date
├── Comments and Attachments
├── links to zero or more Matter Assets
└── append-only change/event history

Task Type  ⇄  eligible published Workflow Definitions / Versions
Workflow Version  →  ordered or unordered configured Steps
Configured Step  →  reusable Step Definition + version-specific overrides
```

**[CONFIRMED]** Task always belongs to a Matter; Project is optional. **[CONFIRMED]** An Asset belongs to one Matter only. **[CONFIRMED]** A task selects exactly one workflow from those available for its Task Type.

### 2.3 Cross-entity invariants

- **[CONFIRMED]** A Task's Project, if present, MUST belong to the Task's Matter.
- **[CONFIRMED]** An Asset MUST have exactly one Matter owner and MUST NOT be shared between Matters.
- **[CONFIRMED]** A Task may reference multiple Assets; each referenced Asset MUST belong to the same Matter as the Task.
- **[CONFIRMED]** A Matter MUST belong to one Client.
- **[PROPOSED]** Deactivation/archiving should preserve history and linked records rather than cascade-delete operational objects.

---

## 3. Firm identifiers: Clients and Matters

### 3.1 External identifiers and format

**[CONFIRMED]** The firm's separate main system issues a **five-digit Client Number** and a **five-digit Matter Number**. Users manually enter these numbers into the tracker. They are distinct from tracker-generated internal SQL IDs.

Examples:

| Client Number | Matter Number | Combined display |
|---|---|---|
| `00001` | `00001` | `00001-00001` |
| `00001` | `00002` | `00001-00002` |
| `00002` | `00001` | `00002-00001` |

**[CONFIRMED]** Client Number is globally unique. **[CONFIRMED]** Matter Number is unique only **within a Client**; `00001` can appear under multiple Clients. **[CONFIRMED]** The combined identifier is calculated/displayed as `{ClientNumber}-{MatterNumber}` and used throughout the application because the law firm uses it in emails, Relativity workspace names, and folder structures.

- Store as fixed-length **character data**, never integers, to preserve leading zeros.
- Validate exactly five ASCII decimal digits for each component: `^[0-9]{5}$`.
- Enforce a unique Client Number and a composite unique `(ClientId, MatterNumber)` constraint.
- Use internal `ClientId`/`MatterId` for primary and foreign keys.
- Construct the combined value from Client and Matter Numbers; do not introduce a second independent combined business identifier.
- **[CONFIRMED]** Creation is always manual for Phase 1. No lookup, sync, or validation against the external firm's main system is available.
- **[PROPOSED]** Editing firm numbers is restricted and audited because they are used in external naming conventions.

### 3.2 Client requirements

| ID | Requirement | Status |
|---|---|---|
| CLI-001 | Authorized users can manually create a Client with required Client Number and Client Name. | CONFIRMED |
| CLI-002 | Enforce five-digit Client Number and global uniqueness. | CONFIRMED |
| CLI-003 | Maintain an internal immutable ClientId independent from Client Number. | CONFIRMED |
| CLI-004 | Administrators can extend Client with configured custom fields. | CONFIRMED |
| CLI-005 | List/detail pages show Client Number prominently; lookup/search by Client Number and name. | CONFIRMED |
| CLI-006 | Support active/inactive status and audited edits. | PROPOSED |

### 3.3 Matter requirements

| ID | Requirement | Status |
|---|---|---|
| MAT-001 | Authorized users can manually create a Matter under an existing Client. | CONFIRMED |
| MAT-002 | Require five-digit Matter Number and Matter Name. | CONFIRMED |
| MAT-003 | Enforce uniqueness for `(ClientId, MatterNumber)` only. | CONFIRMED |
| MAT-004 | Display combined `#####-#####` reference consistently. | CONFIRMED |
| MAT-005 | Maintain internal MatterId and ClientId foreign key. | CONFIRMED |
| MAT-006 | Administrators can extend Matter with custom fields. | CONFIRMED |
| MAT-007 | Show related Projects, Tasks, and Assets on Matter detail. | PROPOSED |
| MAT-008 | Matter lifecycle/status and archive conventions. | OPEN |

---

## 4. Projects

- **[CONFIRMED]** A Project is an **organizational container for Tasks** within a Matter; it does not need its own budget, billing, independent workflow, or external-system actions.
- **[CONFIRMED]** A Task may have no Project.
- **[CONFIRMED]** Administrators may define custom fields on Project.
- **[PROPOSED]** Project baseline fields: `ProjectId`, `MatterId`, `Name`, optional `Description`, `IsActive`, audit timestamps/users, custom values.
- **[PROPOSED]** Matter and Project screens should let authorized users create and organize Tasks; moving Tasks between Projects must not change their Matter.
- **[OPEN]** Whether Project folders may nest; default recommendation is **flat** (no subprojects) for Phase 1.

---

## 5. Assets and Asset Registry

### 5.1 Ownership and reference rules

- **[CONFIRMED]** An Asset is owned by exactly **one Matter** (`MatterId NOT NULL`). No Client-level ownership and no sharing between Matters in Phase 1.
- **[CONFIRMED]** An Asset can be referenced by multiple Tasks within its owning Matter.
- **[CONFIRMED]** A Task can link multiple Assets using a Task–Asset junction relation.
- **[CONFIRMED]** The product records external resources, but does not provision, modify, or synchronize them.

### 5.2 Asset Types

**[CONFIRMED]** Admins can configure Asset Types and their type-specific fields, using the shared dynamic-form/custom-field infrastructure.

Example Asset Types (illustrative, not a closed enum):

- Relativity Workspace
- Harvey Vault
- Physical Drive / Media
- Collection / Data Set
- Production
- Third-Party Application Data Set
- Other

**[PROPOSED]** Default Asset fields: ID, Matter, Asset Type, Display Name, optional external reference/URL, description, status, created/updated audit metadata. Type-specific fields vary; for example, a Relativity Workspace might have Workspace ID and environment while a physical drive might have media identifier and storage location.

### 5.3 Task–Asset links

**[PROPOSED]** `TaskAsset` can carry a relationship label such as **Source**, **Destination**, **Subject**, or **Result**. The list may be configurable, but no fixed taxonomy has been approved. The API MUST reject cross-Matter Asset references.

---

## 6. Identity, roles, permissions, and Pods

### 6.1 Roles

- **[CONFIRMED]** Provide built-in **System Admin** role with access to all product features.
- **[CONFIRMED]** Admins create, edit, and assign additional roles with distinct permissions.
- **[CONFIRMED]** Initial role names may include **Director, Project Manager, Pod Lead, Data Technician, Data Scientist**; these are configurable roles, not hard-coded authorization branches.
- **[PROPOSED]** A user may hold multiple roles, with additive permissions, constrained by visibility/security scope.
- **[OPEN]** Clarify whether System Admin's complete feature access also overrides confidential Matter/ethical-wall visibility; this must be decided before security implementation.

### 6.2 Permission design

**[CONFIRMED]** Assignment and priority-setting are available to technicians, not exclusively managers. Enforce through permissions rather than role-name checks.

Suggested permission catalog **[PROPOSED]**:

| Group | Example permission codes |
|---|---|
| Client/Matter | `Client.View`, `.Create`, `.Edit`; `Matter.View`, `.Create`, `.Edit` |
| Project | `Project.View`, `.Create`, `.Edit`, `.Archive` |
| Task | `Task.View`, `.Create`, `.Edit`, `.Assign`, `.Reassign`, `.SetPriority`, `.ChangeStatus`, `.Complete`, `.Reopen`, `.Comment`, `.Attach` |
| Workflow execution | `Workflow.Execute`, `Workflow.StepEdit`, `Workflow.StepReopen` |
| Assets | `Asset.View`, `.Create`, `.Edit`, `.Link` |
| Organization | `Pod.View`, `.Manage`, `.ManageMembers` |
| Configuration | `Role.Manage`, `TaskType.Manage`, `Workflow.Manage`, `AssetType.Manage`, `CustomField.Manage`, `Priority.Manage`, `StatusLabel.Manage` |
| Oversight | `Dashboard.ViewDepartment`, `Audit.View` |

- **[PROPOSED]** Model any assignment scope separately from action permission (all Pods, member Pods, authorized Matters) so `Task.Assign` does not automatically grant unrelated confidential Matter access.
- **[PROPOSED]** Backend authorizes every API operation and filters all read queries; Angular permission-gates UI controls for usability only.
- **[CONFIRMED]** Phase 1 uses Windows Integrated Authentication with just-in-time registration and no initial roles/permissions; administrator grants access. Future migration to Microsoft Entra ID must preserve user records and associations. See §6.4.
- **[OPEN]** Matter-level ethical walls/ACLs.

### 6.4 Authentication, first-login registration, and future Entra ID migration

**Authentication strategy [CONFIRMED]**

- Phase 1 MUST use **Windows Integrated Authentication** against the employee's existing Windows domain session; no application-managed passwords or separate application login form.
- The application is intended for the firm's private intranet / approved internal access path. Environment and browser compatibility for seamless sign-in MUST be verified. Windows sign-in may prompt if browser or domain policies prevent silent authentication.
- On first successful authentication, the backend MUST register the previously unknown Windows identity as a local `AppUser` with **zero roles and zero effective application permissions**. Registering does not grant access to client, matter, task, asset, or administrative records.
- An administrator MUST be able to see newly registered users and grant appropriate roles and Pod memberships. Once permissions are granted, access takes effect on subsequent authorized requests, subject to a defined permission refresh policy.
- Until authorized, the user MUST see only a restricted **Access Pending** state and their own minimal registration information. The backend MUST deny all protected resource endpoints by default, regardless of Angular UI state.
- Existing active users MUST resolve to the same `AppUser` on every login. Account disablement and role removal MUST prevent protected access even for an already authenticated Windows identity.
- The application MUST record identity provisioning and admin access-grant/change events in its audit history. Do not store Windows passwords, Kerberos tickets, or access tokens in application records.
- System Admin is the built-in privileged role, but **no newly registered user automatically receives it**. An initial System Admin account MUST be seeded or provisioned through a controlled deployment/bootstrap procedure [PROPOSED]; details are a deployment design decision.

**Identity abstraction [CONFIRMED intent; implementation PROPOSED]**

- All Tasks, comments, assignments, Pods, user-role links, workflow actions, and audits MUST reference a stable **application-owned `AppUser.UserId`**, never the Windows username or an Entra claim as their relational foreign key.
- Model external login identities separately: `UserIdentity(UserIdentityId, UserId, Provider, ProviderSubject, ProviderTenantId?, CreatedAt, VerifiedAt, IsActive)` with uniqueness enforced on an appropriate provider/tenant/subject combination.
- For Windows accounts, prefer a verified AD identity such as domain SID (subject to infrastructure capabilities), while retaining `DOMAIN\username` as display/diagnostic information; do not use display name or mutable email as the sole immutable key.
- For Entra ID migration, link the verified **tenant ID (`tid`) + object ID (`oid`)** to the **existing** `AppUser.UserId` before or during rollout using a controlled, verified matching procedure. Do not auto-merge accounts solely on email, UPN, or display name.
- Architecture MUST isolate authentication-provider handling from the application's RBAC and user-domain services so swapping Windows Integrated Authentication for Entra ID does not require changing task/Pod/comment/audit foreign keys.
- Entra ID transition MUST retain existing roles, permissions, Pod memberships, tasks, activity attribution, custom-field-related authorship, and saved preferences where implemented. Perform a dry-run identity reconciliation, resolve unmatched/duplicate users by admin review, and verify continuity before cutover.
- Entra ID sign-in and SSO are **future scope**; Phase 1 MUST be designed for migration but MUST NOT require Entra integration or claim availability of Entra identity identifiers until configured.

**Deployment and security decisions [OPEN]**

- Confirm Windows/domain topology, hosting and proxy arrangement (IIS + ASP.NET Core is a reasonable Phase 1 default), browser support, HTTPS, and the mechanism by which Windows user identity is trusted at the backend.
- If the Angular frontend and .NET API are on separate origins, verify browser credential forwarding, CORS, CSRF protection, and session/security behavior. Prefer a same-origin deployment to reduce complexity [PROPOSED].
- Confirm handling for domain migrations, Windows SID changes, service accounts, account disablement, and user profile enrichment from directory attributes (email/display name) when available.
- Confirm the controlled first System Admin bootstrap and whether pending-user admin notifications are omitted until Phase 2 (recommended: use an admin queue/page rather than notifications).

**Acceptance scenarios [CONFIRMED unless otherwise marked]**

1. A domain employee opens the application for the first time; the backend verifies Windows identity and creates one inactive-for-authorization / no-role application profile.
2. The employee can see Access Pending but cannot list/search Clients, Matters, Tasks, Assets, Users, Pods, or configuration by direct API access.
3. An authorized administrator sees the registration in an administrative user queue, assigns a role and optional Pods; on the next authorization check, the user can access exactly their permitted data and actions.
4. Repeated sign-in must not create a duplicate user.
5. During verified Entra ID migration, an Entra identity is linked to the same `AppUser.UserId`; existing task assignments, comments, audit attribution and Pod memberships remain intact.
6. A coincidentally matching email or name MUST NOT automatically link an Entra identity to a prior Windows account.

**Technical basis:** Microsoft ASP.NET Core Windows Authentication documentation and Microsoft Entra ID token claims guidance (see §23). Specific infrastructure readiness must be validated against the firm's environment.

### 6.3 Pods

- **[CONFIRMED]** A Pod represents a group of Data Technicians (and potentially shared specialists).
- **[CONFIRMED]** A user can belong to multiple Pods simultaneously.
- **[CONFIRMED]** A Pod can have a designated Lead; **[PROPOSED]** support multiple Leads in the underlying model.
- **[CONFIRMED]** A Task has at most one Assigned Pod and at most one Assigned User.
- **[PROPOSED]** A user may designate a Primary Pod for initial filters without affecting memberships.
- **[OPEN]** Whether Assigned User must belong to Assigned Pod; earlier discussion suggests cross-Pod assignment is permitted with proper authorization, so validation should not impose a hard membership restriction without a decision.

### 6.4 Assignment lifecycle

- **[CONFIRMED]** Authorized users, including Data Technicians, may assign or reassign Tasks without manager intervention.
- **[CONFIRMED]** No separate self-claim feature is required; self-assignment is ordinary assignment.
- **[CONFIRMED]** Task may be fully unassigned, Pod-assigned only, or Pod- and user-assigned.
- **[PROPOSED]** User-assigned without Pod is permitted for flexibility; if permitted, queues must display it correctly.
- **[CONFIRMED]** No step-level ownership or assignment.
- **[CONFIRMED]** Changes in assignee and Pod should appear in task history.

---

## 7. Task model, priority, dates, and status

### 7.1 Task baseline fields

| Field | Requirement | Status |
|---|---|---|
| `TaskId` | Internal primary key | CONFIRMED |
| `TaskNumber` | Human-friendly task reference (e.g., TSK-1042) | PROPOSED |
| `MatterId` | Required | CONFIRMED |
| `ProjectId` | Optional; must belong to Matter | CONFIRMED |
| `TaskTypeId` / type version | Required to select form/eligible workflow | CONFIRMED |
| `WorkflowInstanceId` | Exactly one workflow instance for task | CONFIRMED |
| `Title` | Required; Outlook subject prepopulates it when applicable | CONFIRMED |
| `Description` | Email body prepopulates it when applicable | CONFIRMED |
| `PriorityId` | Required | CONFIRMED |
| `LifecycleStatusCode` | Fixed internal lifecycle state | CONFIRMED |
| `AssignedPodId` | Optional | CONFIRMED |
| `AssignedUserId` | Optional | CONFIRMED |
| `DueDate` | Optional; NULL means ASAP | CONFIRMED |
| `CreatedAt`, `CreatedBy`, `ModifiedAt`, `ModifiedBy` | Audit metadata | PROPOSED |
| `RequestEmail...` | Source email metadata/file reference if created from Outlook | CONFIRMED concept; format TBD |
| Dynamic request values | Defined by task type's published form version | CONFIRMED |

### 7.2 Priority labels

- **[CONFIRMED]** Priorities are **system-wide** across all Clients, Matters, Tasks, and Pods—not per Task Type.
- **[CONFIRMED]** Priority is required on every Task; task creators and technicians with permission may set/change it.
- **[CONFIRMED]** Priorities are labels in the UI, not user-facing numbers; configuration has an internal order for sorting.
- **[PROPOSED]** Default labels: **Critical, High, Normal, Low**; default **Normal**.
- **[PROPOSED]** Priority configuration stores `PriorityId`, `Label`, `SortOrder`, optional display color, `IsActive`, `IsDefault`.
- **[PROPOSED]** Renaming/deactivating a priority must not invalidate historical tasks; changes audited.

### 7.3 Optional due date and ASAP

- **[CONFIRMED]** Due Date is **optional**.
- **[CONFIRMED]** If no Due Date is set, display **ASAP** and treat it as work to be handled promptly.
- **[CONFIRMED]** Do **not** automatically require users to repeatedly adjust artificial due dates.
- **[CONFIRMED]** `NULL` due date is **not overdue**.
- **[PROPOSED]** Explicit due date is overdue only after its relevant date/time passes while task is not Completed/Cancelled.
- **[OPEN]** Whether due date includes time, and which timezone governs comparison; default suggestion: local date only, firm timezone for overdue calculations.
- **[PROPOSED]** Show task age/aging indicators separately from due date; avoid treating aging as SLA violation.

### 7.4 Lifecycle statuses

**[CONFIRMED]** Internal lifecycle is fixed, with admin-customizable **display labels** (not additional custom lifecycle states):

| Immutable internal code | Default display label |
|---|---|
| `NEW` | New |
| `IN_PROGRESS` | In Progress |
| `ON_HOLD` | On Hold |
| `COMPLETED` | Completed |
| `CANCELLED` | Cancelled |

- **[CONFIRMED]** Workflow/step progress is separate from Task lifecycle status.
- **[CONFIRMED]** Completing a Task requires resolution of all workflow requirements; no approval gate.
- **[PROPOSED]** Reopening a completed Task is permission-controlled and audited, but does not require manager approval.
- **[OPEN]** Full allowed lifecycle transition matrix, including whether Completed → In Progress and Cancelled → New are permissible.
- **[PROPOSED]** Display labels can be changed, but persisted records, automation rules, and reporting use stable internal codes.

---

## 8. Task Types and dynamic intake forms

### 8.1 Task Type configuration

- **[CONFIRMED]** Admins create/edit/deactivate Task Types.
- **[CONFIRMED]** Each Task Type has its own configurable **request input form**.
- **[CONFIRMED]** Each Task Type has an eligible set of Workflows; a creator chooses exactly **one** available Workflow at task creation.
- **[CONFIRMED]** Workflow definitions are reusable and not exclusively owned by a single Task Type.
- **[PROPOSED]** A Task Type may provide a default Workflow but user selection remains explicit or confirmable.
- **[PROPOSED]** Require at least one eligible published Workflow before allowing new Tasks of that type.
- **[OPEN]** Whether the same Task Type can allow users to choose older published Workflow Versions, or only the current published version of each eligible Workflow. Default recommendation: current published only for new Tasks.

### 8.2 Form builder controls

**[CONFIRMED]** The admin form builder supports standard controls and required/optional validation. **[PROPOSED]** Initial control catalog:

| Control | Example |
|---|---|
| Single-line text | Custodian name |
| Multi-line text | Processing instructions |
| Number | Volume/record count |
| Checkbox | OCR required |
| Single-select dropdown | Processing profile |
| Radio group | Deduplication option |
| Multi-select | Requested output types |
| Date / datetime | Collection date |
| File upload | Instruction document |
| URL | Documentation location |
| Asset reference | Source or destination Asset |
| User reference | Contact or technical stakeholder |
| Section heading/help text | Group form fields |

Fields should define stable internal key, label, type, help/instructions, display order, required flag, optional default, and type-appropriate validation. Additional configuration such as dropdown choices must be versioned with the form.

### 8.3 Conditional fields

**[CONFIRMED]** Basic conditional form behavior **is Phase 1**:

- Show/hide a field based on another field's value.
- Make a field conditionally required.
- **[PROPOSED]** Conditional dropdown option sets.
- **[PROPOSED]** Multi-clause AND/OR logic with limited nesting.
- **[CONFIRMED]** No need for user-provided executable JavaScript; represent rules as structured safe metadata.
- **[PROPOSED]** Detect circular dependencies and invalid referenced fields before publishing.
- **[PROPOSED]** Hidden fields are not required and are excluded from persisted submissions unless explicit retention behavior is defined. Angular may preserve draft values when the user toggles fields within an unsaved form.
- **[CONFIRMED design principle]** The backend must validate required/conditional logic independently of Angular.

Illustration:

```text
Requires OCR? [checkbox]
  IF true:
    OCR Language [required dropdown]
Contains Encrypted Files? [checkbox]
  IF true:
    Password Instructions [required text]
```

### 8.4 Shared custom-field framework

- **[CONFIRMED]** Administrators can add custom fields to **Client, Matter, Project, Task, and Asset**.
- **[CONFIRMED]** Asset Types have type-specific configuration; Task Types have type-specific request forms.
- **[PROPOSED]** Reuse one metadata model and validation/form-renderer infrastructure across core-object fields, Task Type forms, and Workflow Step fields while keeping each definition's scope explicit.
- **[PROPOSED]** Support custom field visibility, requiredness, data types, validations, ordering, defaults, and administrative activation.
- **[OPEN]** Whether all custom fields are searchable/filterable or only explicitly indexed ones; propose limited Phase 1.

### 8.5 Versioning

- **[CONFIRMED]** Published Task Type Form and Workflow configurations must be versioned to protect existing Tasks from later admin changes.
- **[PROPOSED]** Draft → Publish → Retire lifecycle. Published versions are immutable; edits produce a new draft/version.
- **[PROPOSED]** Existing Tasks preserve field definitions and values from the applicable form version. Migration of active Tasks is outside Phase 1.

---

## 9. Workflow definition, execution, and audit

### 9.1 Workflow model

- **[CONFIRMED]** Admins create reusable **Step Definitions** with title, description, instructions, optional documentation URL, and required operational inputs.
- **[CONFIRMED]** Admins assemble reusable Steps into named Workflows and choose **ordered or unordered** execution.
- **[CONFIRMED]** A Step's behavior may be configured for its placement in a Workflow (required inputs, skip permission, skip-comment requirement, ordering).
- **[CONFIRMED]** Workflows are versioned; existing Tasks keep the instantiated selected version.
- **[CONFIRMED]** Each Task has exactly one selected Workflow, even if its Task Type permits several.
- **[CONFIRMED]** No approvals, approval queues, approver roles, or step-level assignments.

### 9.2 Step fields/configuration

| Property | Requirement | Status |
|---|---|---|
| Title | Human-readable step name | CONFIRMED |
| Description | Short explanation | CONFIRMED |
| Instructions | Detailed SOP/procedure | CONFIRMED |
| Documentation URL | Optional external documentation link | CONFIRMED |
| Data inputs | Admin-defined form fields; type/requiredness/conditions | CONFIRMED |
| Skippable | Explicit step configuration | CONFIRMED |
| Comment required on skip | Explicit step configuration | CONFIRMED |
| Workflow ordering | Ordered or unordered at workflow level | CONFIRMED |
| Step assignment | None | CONFIRMED |
| Approval requirement | None | CONFIRMED |

**Terminology:** A step's “metrics” are **operational values recorded as fields** (e.g., item count, GB, QC result). They are **not** staff performance, billing, or pricing metrics.

### 9.3 Step execution statuses

**[PROPOSED]** `PENDING`, `IN_PROGRESS`, `COMPLETED`, `SKIPPED` as internal step states. “Reopened” can be represented as an audited transition back to `IN_PROGRESS` or `PENDING`, rather than a permanent fifth state.

### 9.4 Ordered and unordered execution

- **[CONFIRMED]** For an **ordered workflow**, a technician MUST resolve preceding steps **in order** by marking them **Completed** or **Skipped** (only if skippable) before advancing.
- **[CONFIRMED]** If skip comment is configured as mandatory, technician MUST enter it to skip.
- **[CONFIRMED]** Non-skippable steps must be Completed, not Skipped.
- **[CONFIRMED]** For an **unordered workflow**, steps can be resolved in any order.
- **[CONFIRMED]** Completing a step requires its required visible/conditional input values.
- **[CONFIRMED]** Task completion requires all required workflow steps to be resolved correctly; there is no approval gate.
- **[PROPOSED]** An optional/skippable step may be left unresolved only if the workflow's overall completion policy explicitly permits that; otherwise mark it Skipped to resolve it. Define this consistently in the execution validator.

### 9.5 Reopen and edit behavior — intentionally simple

- **[CONFIRMED]** Technicians may reopen a previously Completed/Skipped step and edit recorded field values or skip comments as needed.
- **[CONFIRMED]** No manager approval or mandatory reopen reason in Phase 1.
- **[CONFIRMED]** Reopening a prior step **does not automatically reset** downstream completed steps.
- **[CONFIRMED]** A Task cannot be Completed/recompleted while its required workflow state is unresolved.
- **[CONFIRMED]** Every status/input/comment change is auditable.
- **[PROPOSED]** Ordered-sequence enforcement applies to progressing **new unresolved downstream steps**. Previously resolved downstream steps remain intact when an earlier step is reopened; the application should clearly flag the reopened prerequisite until resolved.
- **[OPEN]** Exact behavior if a currently Completed Task has a step reopened (automatically switch lifecycle back to In Progress vs require reopening Task first). Resolve before implementing transitions.

### 9.6 Version snapshot/integrity

- **[CONFIRMED]** Publishing a new Workflow Version must not alter the structure or instructions of existing Task workflow instances.
- **[PROPOSED]** Store identifiers to immutable versioned definitions and an instance snapshot sufficient to reproduce the task's historical instructions.
- **[PROPOSED]** Reassignments and workflow execution are tracked independently; no Step assignee columns.

---

## 10. Task creation and Outlook email intake

### 10.1 Manual task creation

A user with Task Create permission MUST be able to:

1. Select the Matter (required) and optionally Project.
2. Enter Task Title and optional Description.
3. Select Task Type.
4. Complete that type's dynamically rendered, conditionally validated intake form.
5. Select exactly one eligible published Workflow.
6. Choose required Priority label (proposed default Normal).
7. Optionally specify Due Date (otherwise ASAP).
8. Optionally assign Pod and/or User.
9. Submit to create Task and its workflow/step instances.

**[PROPOSED]** Creation is one transaction: no partially created Task if required workflow/form data fails validation.

### 10.2 Create from Outlook email

**[CONFIRMED]** Project Managers and Technicians should be able to **drag and drop an Outlook email** to accelerate Task creation. In Phase 1 the extraction is deterministic, **not AI-based**.

Expected mapping:

| Email source | Task target |
|---|---|
| Subject | Task Title (editable) |
| Body | Task Description (editable) |
| From | Requestor/source sender metadata |
| Sent/received date/time | Source message timestamps; also visible in intake record |
| Original message | Preserved as source file/reference if technically feasible |
| Attachments | Preserved/linked subject to file limits and permissions |

- **[CONFIRMED]** Task Type and Workflow selection remain manual in Phase 1.
- **[CONFIRMED]** Phase 2 may use AI to suggest Task Type and extract structured details.
- **[OPEN / TECHNICAL SPIKE]** Test support for classic Outlook, new Outlook, Outlook on the web, browser drag-and-drop payloads (`.msg`, `.eml`, attachments), and whether an Outlook add-in or upload fallback is needed. Do not promise identical drag-and-drop behavior across all Outlook clients without validation.
- **[PROPOSED]** Provide a supported file-upload fallback for `.msg` and/or `.eml` if browser drop does not expose the original email.
- **[PROPOSED]** Prevent accidental distribution/indexing of sensitive email contents through permission and storage controls.

---

## 11. Task collaboration, comments, attachments, and history

### 11.1 Comments

- **[CONFIRMED]** Users can leave comments on each Task.
- **[PROPOSED]** Comments include author, UTC timestamp, body, created/modified metadata, and soft-delete/edit markers.
- **[PROPOSED]** If comment editing is allowed, retain edit history; if removal is permitted, soft-delete and audit.
- **[CONFIRMED]** Comments are distinct from system-generated change history.
- **[CONFIRMED]** Technicians may use comments to record externally obtained approvals, but the tracker does **not** manage approval as a business process.

### 11.2 Task detail layout

**[PROPOSED]** Show tabs or sections for **Details**, **Workflow**, **Comments**, **Assets**, **Attachments**, and **Activity**. Always show Matter combined identifier, Task Title, Priority, current status, Pod/assignee, due date or ASAP, and selected Workflow.

### 11.3 Audit trail

**[CONFIRMED]** History logging is the basis for accountability and makes the Phase 1 workflow intentionally flexible. Audit at least:

- Task creation and updates to title, description, type-relevant values, priority, due date, and lifecycle status
- Task assignee and Pod changes
- Step completion, skipping, reopening, status changes, edited inputs, and skip-comment changes
- Task comment edits/deletions and attachment changes where supported
- Asset links, Client/Matter number edits, and relevant configuration changes

**[PROPOSED]** Events include `EventId`, `TimestampUtc`, `ActorUserId`, `ObjectType`, `ObjectId`, `EventType`, `FieldKey`, `OldValue`, `NewValue`, optional correlation/transaction id. Persist in the same transaction as the audited update. Control access to before/after values because emails/step fields may contain privileged or sensitive information. Retention, tamper-resistance, and purge policies remain **[OPEN]**.

---

## 12. User-facing navigation and work queues

### 12.1 Main navigation — proposal

```text
Dashboard
My Work
Task Queue
Pod Work
Clients
Matters
Projects (via Matter or global list)
Assets (via Matter or global list)
Global Search [persistent header]
Administration [permission-gated]
```

No notification bell or notification inbox is required in Phase 1.

### 12.2 Dashboard

**[CONFIRMED]** Dashboard is part of the application; exact visualizations are **[PROPOSED]**:

- Open Tasks; Unassigned Tasks; Overdue Tasks; Completed Tasks in a selected period
- Open tasks by Pod, Task Type, Priority, and lifecycle status
- Blocked/on-hold and aging tasks
- Recently created and recently completed Tasks
- Drill-through from summary counts to a filtered Task Queue
- Data scoped to records the user is permitted to access

Operational counts are **not** billing metrics or technician performance evaluation.

### 12.3 My Work

**[CONFIRMED]** My Work presents tasks assigned to the logged-in user, including work from **all Pods** they belong to. **[PROPOSED]**:

- Default view: active `NEW`, `IN_PROGRESS`, `ON_HOLD` assignments
- Tabs/views for Active, Due Soon, Completed, and **Created by Me**
- Visible Priority, combined Matter Number, current workflow step/progress, Due Date/ASAP, and task status
- Quick navigation to Task detail and permitted actions

### 12.4 Task Queue

**[CONFIRMED]** Provide a shared searchable, filterable operational task queue. **[PROPOSED]**:

- Search title/reference and filters: Client, Matter, Project, Task Type, Workflow, Pod, Assignee, Creator, Status, Priority, date ranges, ASAP, Overdue
- Table columns configurable per user, server pagination, and sorting
- Inline Priority/assignment changes only where authorized
- Default sorting: priority order; within priority, approaching/past explicit deadlines before ASAP; ASAP then by age, oldest first
- Alternate Kanban view optional, not a release blocker

### 12.5 Pod Work

**[CONFIRMED]** Users may belong to multiple Pods. **[PROPOSED]**:

- Pod selector defaults to Primary Pod (if configured) or one membership
- Pod-wide queue showing tasks assigned to Pod but not individual, assigned members, and overdue/on-hold tasks
- Appropriate Directors/Managers can see additional Pods based on privileges
- Authorized technicians can assign/reassign tasks directly without Pod Lead intervention

### 12.6 Saved views

**[PROPOSED / lower priority]** Common built-in views: All Open, Unassigned, My Pod, Created by Me, Overdue, Recently Completed. User-configured saved views may be Phase 1 stretch or Phase 2; not essential for launch.

---

## 13. Search

### 13.1 Persistent global search

- **[CONFIRMED]** A simple search box should be visible in a persistent application header, likely top-right.
- **[CONFIRMED]** Search everyday fields for Clients, Matters, Tasks, and other basic objects.
- **[PROPOSED]** Search Client Name/Number; Matter Name/Number/combined Number; Project Name; Task Title/ID; Asset Name/type/external reference.
- **[PROPOSED]** Case-insensitive, partial-word/prefix matching; results grouped by object type with direct navigation and View All.
- **[PROPOSED]** Debounce input, cap suggestions, apply all read authorization filters server-side.
- **[CONFIRMED]** Search is desirable but not a hard must-have for initial Phase 1 release; prioritize accordingly.

### 13.2 Advanced search

**[PROPOSED / lower-priority Phase 1]** Provide a dedicated filter-driven search page with paginated results and object-specific filters (Matter, Client, Task, Project, Asset). Searchable custom fields are limited to explicitly supported/indexed fields. Advanced attachments/full-text and natural language search are deferred.

**[PROPOSED]** Start with SQL Server indexes (possibly SQL Server Full-Text Search after evaluation); no additional search infrastructure is required for early delivery.

---

## 14. Administration console

**[CONFIRMED]** Administrators need configuration interfaces, not database migration scripts or developer changes, to manage:

1. User roles and granular permissions
2. Pods, membership, and lead designations
3. System-wide priority labels and sort order
4. Display labels for five fixed Task lifecycle statuses
5. Core-object custom fields
6. Asset Types and Asset Type fields
7. Task Types, Type-specific request forms, validation, and conditional rules
8. Reusable Step library
9. Workflow definitions, ordering, per-step settings, and published versions
10. Eligible Workflows associated with Task Types

**[PROPOSED]** Every configurable definition supports Draft / Publish / Retire state, safe validation prior to publishing, and administrative audit logging. Some simpler catalogs (e.g., status display labels) may use direct audited edits instead of versions.

---

## 15. Suggested user journeys / acceptance scenarios

| ID | Scenario and expected result | Status |
|---|---|---|
| SCN-001 | Create Client `00001`; creating another Client `00001` fails uniqueness validation. | CONFIRMED |
| SCN-002 | Under Client `00001`, create Matter `00001`; under Client `00002`, create Matter `00001`. Both succeed and display `00001-00001` / `00002-00001`. | CONFIRMED |
| SCN-003 | Duplicate Matter Number under same Client is rejected. | CONFIRMED |
| SCN-004 | Create Task directly under Matter without Project. | CONFIRMED |
| SCN-005 | Create Task under Project; reject a Project from another Matter. | CONFIRMED |
| SCN-006 | Technician who has assignment permission assigns an unassigned Task to themselves or another user without manager intervention. | CONFIRMED |
| SCN-007 | A technician in Pods A and B sees all personal assignments in My Work and may filter Pod Work by membership. | CONFIRMED |
| SCN-008 | Admin creates Task Type, adds textbox/checkbox and conditionally required field; new Task form responds dynamically and backend rejects missing visible required value. | CONFIRMED |
| SCN-009 | Admin links two eligible published Workflows to Task Type; user selects exactly one for new Task. | CONFIRMED |
| SCN-010 | Ordered Workflow does not allow newly progressing to Step 3 before Step 2 is resolved. | CONFIRMED |
| SCN-011 | A skippable Step with mandatory skip comment cannot be skipped without a comment. | CONFIRMED |
| SCN-012 | A non-skippable Step cannot be skipped. | CONFIRMED |
| SCN-013 | Technician reopens Step 2 after Steps 3–4 were completed; downstream completed states are preserved and change is audited. | CONFIRMED |
| SCN-014 | Administrator publishes Workflow v3; existing v2 Tasks retain v2 workflow steps and instructions. | CONFIRMED |
| SCN-015 | No due date displays ASAP; not classified Overdue. | CONFIRMED |
| SCN-016 | Task links two Assets from its Matter; reference to Asset in different Matter is rejected. | CONFIRMED |
| SCN-017 | Drop/upload supported Outlook email; map Subject to editable Title and Body to editable Description; user manually selects Task Type and Workflow. | CONFIRMED intent; technical feasibility OPEN |
| SCN-018 | Task comment is visible with author/time; edits and step changes are included in history according to policy. | CONFIRMED comments/audit; edit policy PROPOSED |
| SCN-019 | A role without TaskType/Workflow management permission cannot invoke management endpoints. | PROPOSED implementation consequence |
| SCN-020 | Global search for `00002-00001` returns matching Matter and related authorized records, not data user cannot access. | PROPOSED |

---

## 16. Non-functional requirements and architectural guardrails

### 16.1 Security and confidentiality

- **[CONFIRMED]** Phase 1 Windows Integrated Authentication on the firm intranet; future Entra ID SSO. Enforce local zero-permission provisioning, secure identity linkage, and authorization independently of successful domain authentication. See §6.4.
- **[PROPOSED]** TLS in transit, encryption at rest as configured by hosting platform, least-privilege backend, RBAC claims/policies, object-level authorization, server-side input validation.
- **[PROPOSED]** Protect Matter and task data from cross-Matter exposure in APIs, search, attachments, logs, and exports.
- **[OPEN]** Ethical-wall constraints, external confidential matters, retention period, legal holds on audit evidence, attachment scanning, data classification.

### 16.2 Data integrity and consistency

- **[PROPOSED]** SQL Server foreign keys and constraints for core ownership; backend validates complex cross-entity rules, with composite references/checks where practical.
- **[PROPOSED]** All workflow transitions, submission validation, and audit events happen transactionally to avoid partially applied updates.
- **[PROPOSED]** Use optimistic concurrency tokens (`rowversion`) for Tasks, Steps, and frequently edited configuration.
- **[PROPOSED]** Persist timestamps in UTC; render to user/firm timezone. Timezone conventions remain **[OPEN]**.

### 16.3 Configurable data storage

- **[PROPOSED]** Use ordinary relational columns and FKs for stable business fields; a metadata-driven, versioned schema for dynamic fields and conditional rules.
- **[PROPOSED]** Consider JSON document storage for dynamic values, supplemented by typed/indexed values for common search filters. **[OPEN / ARCHITECTURE]** Select JSON vs typed value tables vs hybrid after testing reporting/query requirements.
- **[PROPOSED]** Never run `ALTER TABLE Task` whenever an admin adds a form field.
- **[PROPOSED]** Validate and evaluate dynamic form rules in a shared semantic specification between Angular and .NET (separate implementations or shared schema), with .NET authoritative.

### 16.4 Performance, usability, operations

- **[PROPOSED]** Server-side pagination/filtering for large Task Queues and search; indexed joins on identifiers, Matter, assignee, Pod, status, and priority.
- **[PROPOSED]** Accessible keyboard-friendly Angular components, clear required/error states, desktop-first responsive layout.
- **[OPEN]** Data volumes, number of users, maximum attachment sizes, concurrency targets, acceptable response times, availability/SLA, deployment topologies, backup/restore and recovery objectives.
- **[PROPOSED]** Structured application error logging must redact privileged email/field content.

---

## 17. Preliminary logical data entities (not final DDL)

| Area | Candidate entities |
|---|---|
| Core organization | `Client`, `Matter`, `Project`, `Asset`, `AssetType`, `Task`, `TaskAsset` |
| Identity / authorization | `AppUser`, `UserIdentity`, `Role`, `Permission`, `UserRole`, `RolePermission`, optionally visibility policy entities |
| Pods | `Pod`, `PodMember` (role/lead flags or separate `PodLead`), `UserPreference` |
| Tasks | `Priority`, `TaskType`, `TaskTypeWorkflowEligibility`, `TaskAssignmentHistory`, `TaskComment`, `TaskAttachment`, `TaskStatusHistory` |
| Workflow configuration | `StepDefinition`, `StepDefinitionVersion` (if independently versioned), `WorkflowDefinition`, `WorkflowVersion`, `WorkflowStepDefinition`, `WorkflowInstance`, `StepInstance` |
| Forms and custom fields | `FormDefinition`, `FormVersion`, `FieldDefinition`, `FieldOption`, `FieldCondition`, `FormSubmission` / dynamic values |
| Audit / search | `AuditEvent`, optionally `SavedView`, `SearchIndexValue` |
| Email intake | `SourceEmail` and/or source attachment metadata tied to Task |

**Proposed SQL uniqueness and ownership checks**:

```sql
-- Examples only; exact DDL depends on final naming and tenancy/soft-delete policy.
UNIQUE (Client.ClientNumber)
UNIQUE (Matter.ClientId, Matter.MatterNumber)
CHECK (Client.ClientNumber consists of exactly 5 ASCII digits)
CHECK (Matter.MatterNumber consists of exactly 5 ASCII digits)
Task.MatterId NOT NULL
Task.ProjectId NULLABLE -- only a Project belonging to Task.MatterId
Asset.MatterId NOT NULL
TaskAsset -- Task and Asset must belong to same Matter
Task.PriorityId NOT NULL
Task.DueDate NULLABLE
```

Store and search Client/Matter business numbers separately; create the hyphenated value at presentation/query boundaries.

---

## 18. Suggested API / module boundaries (architecture input)

These are **[PROPOSED]**, not signed-off API contracts.

| Backend module | Responsibilities |
|---|---|
| Organization | Client, Matter, Project management; combined identifier formatting |
| Work Management | Task CRUD, assignment, priority, lifecycle status, comments, attachments, Task–Asset links |
| Workflow Engine | Workflow selection/instantiation, ordered/unordered step transitions, skip/reopen, completion checks |
| Configuration | Roles/permissions, Task Types, field forms, conditions, steps, workflows, priorities, status labels, asset types |
| Asset Registry | Matter assets, asset types, type-specific values |
| Work Views | Dashboard aggregates, My Work, Pod Work, Task Queue filters |
| Search | Global search and optional advanced search |
| Intake | Manual intake and Outlook message import/extraction |
| Audit | Append-only event recording and permission-scoped history reads |

**[PROPOSED]** Modular .NET monolith with clearly separated services/modules is sufficient for the expected Phase 1 scope unless scale or firm infrastructure dictates otherwise. Do not prematurely require microservices, orchestration infrastructure, or an external search engine.

---

## 19. UI inventory for future design

**[PROPOSED]** Screen list to guide wireframes and user stories:

1. Dashboard / department overview
2. My Work personal queue
3. Shared Task Queue with filters
4. Pod Work and Pod selector
5. Client list, create/edit, detail
6. Matter list, create/edit, detail (Projects/Tasks/Assets)
7. Project create/edit/detail
8. Asset list, create/edit/detail, linked Tasks
9. Create Task / create from email (multi-stage or one-page form)
10. Task detail, editable metadata, selected workflow and steps, comments, attachments, assets, history
11. Global Search results; Advanced Search (lower priority)
12. Admin: users/roles/permissions
13. Admin: Pods/members/leads
14. Admin: Task Types and dynamic form designer with preview
15. Admin: Step library and step form requirements
16. Admin: Workflow designer, ordered/unordered steps, version publish screen
17. Admin: Asset Types/custom fields
18. Admin: global priorities, status display labels, common custom fields
19. Admin: audit access (permission gated)

### 19.1 UI principles

- Combined `#####-#####` Matter reference is consistently visible where Matters/Tasks/Assets appear.
- Priority shown as label/badge; due date shown as date or **ASAP**.
- Lifecycle state is distinct from workflow step state.
- Task assignment is single user/Pod-level; no Step assignee picker.
- No approval controls, approval inbox, billing widgets, or notification center in Phase 1.
- Form designer previews conditional fields and enforces server-aligned rules.
- Task views are useful without users needing to set artificial deadlines.

---

## 20. Proposed delivery slicing and dependencies

This is an implementation **suggestion**, not approved sequencing.

| Workstream | Dependencies | Suggested delivery order |
|---|---|---|
| Foundations | .NET/Angular/SQL setup, auth decisions, audit, permissions | 1 |
| Organization | Client/Matter numbering, Project | 2 |
| Pods and assignments | User/Role/POD schema | 2–3 |
| Configuration/forms | Custom field engine, Task Type forms, conditional validator, versioning | 3 |
| Workflow engine | Step library, workflow versioning, execution transitions | 4 |
| Task management | Task CRUD, priority, status, comments, assignments, assets | 4–5 |
| Operational views | Dashboard, My Work, Queue, Pod Work | 5 |
| Assets | Asset Types and Matter registry | 5 |
| Outlook intake | Client compatibility technical spike, parsers, source retention | 5–6 |
| Search and refinements | Basic global search, advanced filters, saved-view enhancements if time | 6 |
| Security/acceptance | Concurrency, authorization, audit, testing, performance | Across all workstreams |

**Risk:** Dynamic form definitions + conditional validation + publication versioning are foundational and should be prototyped early; retrofitting them after CRUD screens would be costly.

---

## 21. Remaining decisions and design spikes

These should be resolved while moving from requirements into architecture and UI design. None negates the confirmed baseline.

| ID | Open item | Recommended approach / impact |
|---|---|---|
| OPEN-01 | Windows Authentication deployment and Entra transition details | Confirm intranet hosting/IIS, AD identity keys and account enrichment, browser credentials, bootstrap admin, verified identity linking and migration cutover |
| OPEN-02 | Matter visibility, ethical walls and System Admin override | High security impact; define before authorization implementation |
| OPEN-03 | Who may create/edit Clients/Matters, beyond general authorized roles | Define starter role-permission matrix |
| OPEN-04 | Workflow version eligibility for new Tasks | Default: only latest published version of each eligible Workflow |
| OPEN-05 | Required vs skippable step semantics for task completion | Explicit consistent validator and UI explanation |
| OPEN-06 | Reopening a Step on an already Completed Task | Default: reopen Task to In Progress as part of the operation; audit both |
| OPEN-07 | Exact task lifecycle transition matrix | Define Allowed transitions and roles; keep five internal states |
| OPEN-08 | Date vs datetime, timezone and overdue logic | Recommend date-only and firm timezone unless deadlines need times |
| OPEN-09 | Outlook compatibility and original email format | Spike drag/drop classic/new/web Outlook; upload fallback |
| OPEN-10 | Attachment storage, maximum size, malware scanning, retention | Define firm storage/compliance choices |
| OPEN-11 | Custom-field storage/indexing strategy and security classification | Benchmark JSON/typed/hybrid with realistic queues |
| OPEN-12 | Whether Pod membership limits assignment | Default no rigid restriction, but permission/visibility checks |
| OPEN-13 | Project nesting | Recommend flat Projects in Phase 1 |
| OPEN-14 | Asset role taxonomy: Source / Destination / Result | Decide default labels/configurability |
| OPEN-15 | Search prioritization | Basic search desirable; Advanced Search lower priority |
| OPEN-16 | Publishing and configuration rollback policies | Published versions immutable; draft editing; no auto-migration |
| OPEN-17 | Scale, availability, backup/RPO/RTO, reporting/export requirements | Needed for infrastructure sizing |
| OPEN-18 | Initial built-in role permission matrix and audit-view access | Define with eDiscovery operations leadership |

---

## 22. Decision register

This register captures the main decisions explicitly agreed in discovery, to reduce later requirement drift.

| ID | Agreed decision |
|---|---|
| DEC-001 | Internal law-firm eDiscovery work/request tracking; no billing in Phase 1 |
| DEC-002 | MS SQL Server + .NET backend + Angular frontend |
| DEC-003 | Client → Matter; Project only organizes Tasks; Task always belongs to Matter |
| DEC-004 | Client Number and Matter Number are independent five-digit character strings from existing firm system; combined displayed as `#####-#####` |
| DEC-005 | Client Number globally unique; Matter Number unique only within Client |
| DEC-006 | Client/Matter creation manual, no master-system integration |
| DEC-007 | Asset owned only by one Matter, not Client or multiple Matters |
| DEC-008 | Admin-configurable Asset Types and core-object custom fields |
| DEC-009 | Built-in System Admin; admin-configured other Roles and granular permissions |
| DEC-010 | Pods group technicians; users may belong to multiple Pods |
| DEC-011 | Technicians can assign/reassign Tasks; no required manager intervention |
| DEC-012 | Task-level assignment only; no step-level assignment |
| DEC-013 | Task priority required, system-wide configurable label; technicians can set priority |
| DEC-014 | Fixed Task internal lifecycle with configurable display labels |
| DEC-015 | Due Date optional; absent means ASAP and is not overdue |
| DEC-016 | No notifications in Phase 1 |
| DEC-017 | Task Type intake form designed by admin; conditional fields in Phase 1 |
| DEC-018 | A Task Type allows multiple eligible Workflows; each Task chooses exactly one |
| DEC-019 | Workflows are reusable, versioned, ordered or unordered, with configurable steps and input requirements |
| DEC-020 | No approval engine; approvals happen outside the tracker |
| DEC-021 | Ordered workflow strictly enforces progression in order; complete or skip (only where allowed); mandatory skip comment where configured |
| DEC-022 | Technicians may reopen/edit prior steps, audit changes; do not automatically reset later completed steps |
| DEC-023 | Task comments supported; changes/history audited |
| DEC-024 | Dashboard, My Work, Task Queue, and Pod Work required concepts |
| DEC-025 | Outlook email intake in Phase 1; AI type inference/extraction deferred to Phase 2 |
| DEC-026 | Persistent global search desired; not a hard Phase 1 must-have; advanced search lower priority |
| DEC-027 | No external-platform execution/integration in Phase 1 |
| DEC-028 | Phase 1 Windows Integrated Authentication using the employee's existing Windows session; no application password/login form |
| DEC-029 | First successful login creates a local user with no roles/permissions; admin assigns roles/Pods before resource access |
| DEC-030 | Future Entra ID sign-in must be mapped to the existing app user to preserve all task/Pod/comment/audit relationships |

---

## 23. Basis and provenance

Authentication design references: Microsoft [Configure Windows Authentication in ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/windowsauth?view=aspnetcore-10.0) and [Microsoft identity platform ID token claims reference](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference).

This document is primarily a **requirements consolidation of product decisions provided directly during discovery**, supplemented with clearly marked implementation recommendations. No additional external facts are required to substantiate the agreed behavior.

General industry context previously considered during discovery included EDRM lifecycle guidance and eDiscovery request/work-tracking approaches in Exterro Request Management, Relativity ecosystem project trackers, and legal-service workflow products. These informed design discussions but **do not** make every proposed feature a market standard or an approved requirement. Future architecture/design documents should independently verify any specific external platform API, Outlook integration claim, regulation, or version-dependent technical capability before relying on it.

---

## 24. Next deliverables enabled by this baseline

1. **System architecture specification:** deployment, .NET modules, SQL model, identity/security boundaries, dynamic-field runtime design, workflow state machine, audit strategy.
2. **ERD and physical SQL Server schema:** keys, composite constraints, versioned config tables, relational vs JSON dynamic values, indexing.
3. **UI/UX requirements and wireframes:** persona journeys, navigation, Dashboard, Task Queue, Task detail, form/workflow designers, Outlook intake.
4. **Detailed functional backlog:** epics, stories, granular business rules and acceptance tests using requirement IDs/scenarios.
5. **API contracts:** endpoints, DTOs, filtering, authorization, concurrency, transition errors.
6. **Test plan:** permission matrix, workflow ordering and reopening, conditional validations, audit integrity, number uniqueness, cross-Matter data protection.
7. **Implementation roadmap:** staged MVP definition, dependency-aware backlog, Phase 2 extension points.
