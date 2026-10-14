# Decisions Addendum to Requirements Baseline v1.1

**This addendum OVERRIDES `baseline-v1.1.md` wherever they conflict.** It records decisions made with the product owner after the baseline was written (2026-10-14). Read the baseline first, then this file.

## A. Task immutability and editing

- A Task's **Task Type, Workflow, and Matter cannot change** after creation. Recovery from a wrong entry is Cancel and recreate.
- A Task's **Project may change**, within the same Matter.
- Task form values (Task Type request form) are **editable** and audited. Values stay on the form version the Task was created under.
- Editing a **Completed or Cancelled** Task requires first moving it back to **In Progress** (both are reopenable; Cancelled is not terminal). Reopening is blocked while the Matter is inactive.
- A Task can be **Cancelled at any time**, with a **mandatory comment**; unresolved workflow steps do not block Cancel.
- Reopening a step on a Completed Task **auto-moves the Task to In Progress** (audit both events).
- **Assigning a user** moves a New Task to In Progress automatically. Pod-only assignment does not. Unassigning later does not revert status.
- Editing a Step Definition in the library **does not** change already-published Workflow Versions (snapshot on publish).

## B. Matters and Clients

- Tasks can be created only on an **active** Matter.
- A Matter can be set **inactive only when all its Tasks are Completed or Cancelled**.
- **Client and Matter numbers** are 1 to 5 digits as entered (e.g. `343`), never more than 5. The system **normalizes to a zero-padded 5-character string** (`00343`) and stores/enforces uniqueness on that. Search and lookup accept padded or unpadded input. Combined display is `00343-00012`. This replaces the baseline's "exactly five digits as typed" rule.

## C. Requestor, attachments, intake

- Task has **Requestor Name (required)** and **Requestor Email (optional)**. Requestors are not app users (attorneys/paralegals are not users in this phase). Email "From" prefills these.
- **The system stores no attachments and no original email files.** Removed: `TaskAttachment`, the File Upload form control, source-email preservation, OPEN-10 (storage/scanning/retention). Outlook intake is **parse and discard**: extract Subject, Body, From (name/email), and sent date. Attachment filenames are not recorded.
- Firm uses **new Outlook**. Drag-and-drop feasibility from new Outlook into a browser is an unvalidated technical spike. Design intake so a paste / manual-entry path always works; drag-drop is an enhancement.

## D. Comments

- Rich text, **basic formatting only** (bold, italic, lists, links), sanitized server-side. No attachments. **Internal only.**
- Delete is **soft-delete**: hidden from the UI, retained in the database for audit. Authors may edit/delete their own comments; edit history kept. (Assumed; low risk.)

## E. Security and identity

- **Phase 1 visibility: anyone with `Task.View` sees all Tasks.** System Admin has full access. **Ethical walls and Matter-level ACLs are deferred to a later phase.** Read-access logging is out of scope.
- **Pod Lead is a role** (permission set), not a per-Pod flag.
- Offboarding is manual (admin reassigns Tasks one by one). Task Queue assignee filter includes inactive users.

## F. Scope reductions and removals

- **Dropped:** global Task custom fields (only per-Task-Type forms remain). Subtasks, dependencies, related-task links, cloning/templates. Bulk "reassign all". Reports/exports (dashboard only). Read-audit logging.
- Custom fields remain for Client, Matter, Project, Asset. Admins define Asset Types with their own fields. An Asset belongs to exactly one Matter. (Asset-Type-specific fields may be modeled as the Asset Type's form.)

## G. Dates and sorting

- **Due Date is optional; its time part is optional.** No due date = **ASAP** (never overdue). Date-only due date is overdue after 23:59 **firm time** on that date; with a time, overdue after that time. **One firm timezone** applies to all users; store UTC.
- **ASAP sorts above explicit due dates** within a priority.

## H. Scale (drives architecture)

- 200 to 300 users; 10+ new Tasks/day (a few thousand/year); 200 to 300 Assets per Matter. **Small scale: modular monolith, SQL Server only, plain indexes; no search engine, no full-text required.**

## I. Build assumptions for engineering

- Backend: ASP.NET Core (current LTS), EF Core, SQL Server. Frontend: Angular (current stable) with a mainstream component library chosen in the architecture doc. Same-origin deployment preferred.
- Auth: Windows Integrated Authentication with JIT zero-permission user provisioning (baseline §6.4). In dev/test, a switchable **development auth provider** is acceptable so the app is runnable off-domain.
- Initial System Admin is seeded via configuration.

## J. Database migrations (decided 2026-10-14)

- The schema is managed by **hand-written, numbered SQL scripts** (`01-init.sql`, `02-new-table.sql`, `03-....sql`, ...), **not EF Core migrations**. EF Core is used for data access only; no `Add-Migration`.
- A small **migration table** (e.g. `dbo.SchemaMigration`: script name, numeric prefix, checksum, applied-at UTC, duration, success) records each executed script.
- **On server startup**, the app discovers `.sql` files (embedded resources or a configured folder), compares them with the table, and executes the pending ones **in numeric-prefix order**, each in a transaction where SQL Server allows. Already-applied scripts are never re-run.
- Safeguards: a SQL Server **application lock** (`sp_getapplock`) so multiple instances don't migrate concurrently; **fail startup** on any script error; detect **duplicate prefixes** and **checksum changes of already-applied scripts** (fail loudly); support GO batch separators.
- Developers add scripts only by appending new files; applied scripts are immutable.
