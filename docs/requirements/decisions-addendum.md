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

## K. Completing a Task with unresolved steps (decided 2026-10-14)

- The user can click **Complete** on a Task even when workflow steps are unresolved. The app shows a confirmation: *"You have N steps not completed. Do you want to mark them all completed?"*
- **Confirm** marks all unresolved steps **Completed** (in workflow order for ordered workflows) and then completes the Task, in **one transaction**. **Cancel** leaves everything unchanged.
- This is **Completed, not Skipped**. Skip stays a per-step action (with the comment rule where configured).
- **Guard:** a step whose **required inputs are missing** cannot be auto-completed. The dialog lists those steps and the Task stays open until the user fills them in (the user may skip any that are skippable). Only steps with all required inputs satisfied are bulk-completed.
- Audit: each step completion is recorded individually, sharing one correlation id with the Task completion, flagged as "bulk completed".
- This supersedes the earlier "every step must be individually resolved before the Task can be completed" assumption (baseline 9.4/9.5, architecture OPEN-05).

## L. Admin account, timezone, AD lookup (decided 2026-10-14)

- **Initial System Admin:** `ke\kekim` (`Bootstrap:SystemAdmins`, domain `KE`, SAM `kekim`; match case-insensitively).
- **Firm timezone: Eastern** (`America/New_York`, Windows id `Eastern Standard Time`; DST-aware). Technicians work across all US timezones. **Due dates and times are entered, displayed and judged for overdue in Eastern Time and always labeled "ET"** regardless of where the user is. Date-only due dates are overdue after 23:59 ET. Timestamps stored in UTC. (Per-user display timezone is a possible later enhancement.)
- **AD profile lookup (display name, email):** permitted **only if it needs no separate access that IT must provision.** Windows authentication itself supplies only the account identity, not name or email, so a lookup is a separate directory read. Design: optional and **off by default** (`ActiveDirectory:LookupEnabled`), reading with the web app's own identity; on any failure fall back to showing `KE\sam` and let an admin edit the display name and email. Whether the production server's identity can read AD is to be confirmed with IT at deployment; the app must work fully without it.

## M. Local-time display, including due dates (decided 2026-10-14)

**Supersedes the "ET-only" parts of sections G and L.** The product owner prefers each user's **local time** everywhere; technicians work across all US timezones.

- The browser sends its IANA timezone with each request (e.g. `X-Time-Zone: America/Chicago`); the server falls back to `America/New_York` (the firm default, `Firm:TimeZoneId`) if absent or invalid. Timestamps are stored in UTC.
- **Comments, activity/audit and all other timestamps** display in the viewer's local time with the zone abbreviation.
- **Due date with a time** is an absolute instant (`DueAtUtc`). The creator enters it in their local zone; every viewer sees it converted to their local zone. Overdue when now is past that instant (same answer for everyone).
- **Date-only due date** is a floating calendar date (no zone). It is overdue after 23:59:59 on that date **in the viewer's local zone**, so two viewers near midnight may disagree. Accepted trade-off.
- No due date = ASAP, never overdue; ASAP still sorts above explicit due dates within a priority.
- Overdue filters, dashboard counts and queue sorting use the **requesting user's** timezone. For sorting, a stored `DueSortKey` (the instant, or the date at 23:59:59 treated as UTC) gives an approximate order; the exact overdue flag is computed at query time. At this scale (a few thousand Tasks a year) query-time evaluation is acceptable.
- Schema effect: replace `DueTime` + `OverdueAfterUtc` with `DueDate date NULL`, `DueAtUtc datetime2 NULL` (set only when a time is chosen; CHECK it implies `DueDate`), and `DueSortKey datetime2 NULL`.

## N. QA findings resolved by the project manager (2026-10-14)

See `docs/qa/findings.md`. Notable: Completed -> Cancelled is allowed directly (Cancel "at any time"); a NEW Task can be Completed (bulk-complete applies); bulk-complete is all-or-nothing.

## O. Decisions from the SME review (2026-10-14)

- **On Hold requires a comment** (reason), stored like the Cancel comment (not deletable). Resuming needs no comment.
- **Matter sensitivity flag:** Matters get an optional `IsSensitive` flag (and the sensitive-matter warning banner on its Tasks/Assets and in search results). **Display-only in Phase 1**; it does not restrict access (ethical walls remain a later phase). A code-name convention is a firm practice, not a feature.
- **Open visibility** (anyone with `Task.View` sees all Tasks) is treated as covered by the firm's own sign-off; no work item for the product.
- **No data purge.** Phase 1 retains all records and audit history indefinitely; no retention/purge job.
- **Adopted from `docs/sme/domain-review.md`:** copy button on the `#####-#####` reference; search accepts an unpadded `343-12` pair; privilege-reminder notice on Outlook intake, Task Description and comments; Assets can be deactivated but never hard-deleted and show their change history; the bulk-complete dialog names the steps; seed Task Type forms carry a deadline-driver and notes block.
- **Deferred/not adopted for now:** per-Asset-Type statuses, duplicate-Asset/similar-Task warnings, "trim quoted chain" tool, custody-event Task Type beyond the seed data.

## P. Required custom fields and existing records (decided 2026-10-14, from UAT-07)

- Publishing a new required custom field **never blocks editing existing Clients, Matters, Projects or Assets**. Only the fields a user actually changes are validated (FND-07).
- If an existing record has no stored custom values and the user saves other changes **without touching the custom-fields section**, the save succeeds and the required custom fields stay empty.
- If the user **enters or changes any custom value** in that section, the required fields in that section must be satisfied, and the screen highlights exactly which ones are missing (inline, red border, listed by name).
- On **create**, all required custom fields are enforced as before.
- Detail screens may show a neutral "Not provided" for required fields that old records lack.

## Q. Task type coverage: completion counts per person for training (decided 2026-10-15, issue #73)

- The product owner asked for a view of **how many tasks each person completed per task type in a period**, to see who is not handling certain types of work and needs training or cross-coverage.
- This **supersedes the "no completion statistics, no per-person performance metrics" note of the Dashboard epic (#68) for this one view only.** The Swimlane and Users workload views stay operational-capacity views with no completion counts, speed or ranking.
- It is a **Coverage view inside the Dashboard Users tab** (`?tab=users&view=coverage`), headed "Task type coverage - use this to plan training and cross-coverage, not to rank people". There is no ranking, score or "best / worst" wording; ordering by total is allowed and labelled neutrally ("By total completed"). Zero cells are shown as possible training gaps, and the view counts how many people handled each task type (fewer than two is flagged: a bus-factor insight).
- **Read access is limited by its own permission, `Dashboard.ViewCoverage`** (separate from the Users tab permission), granted to Director and Pod Lead by default. The endpoint is `GET /api/v1/dashboard/coverage`.
- **What counts:** tasks with status COMPLETED (not cancelled) whose completion time falls inside the period in the viewer's time zone, counted for the person the task is **assigned to** (the Task keeps no separate "completed by", and a completed task cannot be reassigned, so this is the person who held it when it was completed). Inactive users appear only when they completed something in the period (marked Inactive). Availability is shown as a small marker only and never changes the counts.
- **Audit:** reading the view writes nothing extra to the audit log.

## R. Rich-text Task description with safe tables (decided 2026-10-15, issue #80)

Technicians paste long email instructions, often with tables, into the Task description. This **relaxes addendum D** ("basic formatting only") **for tables only**, in the Task Description and in comments.

- **The Task Description is rich text**: the formatting of comments (bold, italic, bulleted and numbered lists, links) **plus tables**. Comments accept tables too. Nothing else is added: no images, colours, fonts, styles, classes, scripts, forms or embedded content.
- **Server-side allow-list (authoritative; one sanitizer for comments, descriptions and email intake).** Tags `p br strong b em i u ul ol li a table thead tbody tfoot tr th td caption colgroup col`. Attributes: `href` on `a` (same link rules as before: `http`, `https`, `mailto`, absolute, no credentials, no direction controls, no markup characters), `colspan` and `rowspan` on cells (plain integers 2-100; 1 is dropped), `scope` on `th` (`row`, `col`, `rowgroup`, `colgroup`). **No** `style`, `class`, `id`, `width`, `bgcolor`, event handlers, `img`, `svg`, `math`, `iframe`, `form`, `style` or `script`.
- **Limits.** Nested tables to depth 3 (deeper tables are flattened into paragraphs). At most **200 table cells per field**. A description: at most 100,000 characters of stored HTML (`HTML_TOO_LARGE`), 20,000 visible characters (`TOO_LONG`, as before), 300,000 characters accepted before sanitizing, and a limit on tags and nesting (`TOO_COMPLEX`). Cells over the limit: `TABLE_TOO_LARGE`. A comment: 20,000 characters as before, same table limit. Errors are field errors with a clear message, never a silent cut.
- **Storage.** `dbo.Task.Description` stays `nvarchar(max)`; new column `DescriptionFormat` (`TEXT` | `HTML`, script 25). Existing descriptions stay `TEXT` and are shown escaped with their line breaks until the description is edited; new and edited descriptions are `HTML` (the sanitized form is what is stored and returned). A client that sends an unchanged text description back (a title edit, an older client) does not convert it and creates no audit entry. Plain text sent to the API is escaped into paragraphs.
- **Plain-text uses.** The audit trail, the swimlane summary and any list snippet or export use a plain-text rendering of the description (paragraphs and table rows on lines, cells separated by " | "); the audit never stores markup.
- **Editor.** The Create Task form and the Edit dialog use the rich text editor with table support: Insert table (up to 8 x 8, optional header row), add and delete rows and columns, Tab and Shift+Tab between cells (Tab never traps the keyboard). Pasted or dropped HTML (Outlook, Word, web pages) is rebuilt from the same allow-list before it is inserted; a table over 200 cells is pasted as text. The read view shows the table in its own scrolling box.
- **Email intake** (parse and discard, unchanged in principle): the sanitized HTML body (`.eml`, `.msg`, and the clipboard HTML of a pasted email) becomes the description with its tables; the plain-text body is the fallback when the HTML is over a limit. The **privilege reminder** stays on intake, the Task Description and comments.
- **Defence in depth.** The browser renders stored HTML through Angular's own sanitizer as well, and drops images, frames and forms again; the sanitizer's output is verified to be a fixpoint on every save; the security tests (hostile corpus, fuzz, round trip) and the residual risks are in `docs/qa/security-review-2-resolutions.md`, "Addendum 3".

