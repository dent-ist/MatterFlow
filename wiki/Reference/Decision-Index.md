# Decision Index

[[_TOC_]]

**What this page is for.** An index of the decisions that shape the product and the code, each with a one-line summary and where to read the full text. When a behaviour surprises you, find the decision here before changing it. The sources are `docs/requirements/decisions-addendum.md` (owner and product decisions, sections A to AV; they override the baseline), the ADR table in `docs/architecture.md` section 1, and `docs/adr/`. Summaries are short and may omit conditions: read the section before relying on it. For sections L to P, S to AF and AK to AV the summary is based mainly on the section heading and the first lines, so open the section for the actual rules.

## Architecture decisions (`docs/architecture.md` section 1)

| ADR | Decision in one line |
|---|---|
| 001 | Modular monolith: one host, one SQL Server, one `DbContext` |
| 002 | .NET 10 (LTS), ASP.NET Core controllers, EF Core for data access only, FluentValidation, no MediatR |
| 003 | Schema is hand-written numbered SQL scripts applied by a startup runner; no EF migrations (addendum J) |
| 004 | Windows Integrated Auth on IIS, just-in-time zero-permission provisioning, a Dev provider off-domain (refused in Production) |
| 005 | Same origin: the API serves `/api` and the Angular build; no CORS; CSRF by a required custom header |
| 006 | Authorization by permission codes through dynamic policies; role names never checked; System Admin allowed everything |
| 007 | Pod Lead is a role; `PodMember` has no lead flag |
| 008 | `UserIdentity` maps external logins to `AppUser`; every foreign key points to `UserId` |
| 009 | Dynamic forms: versioned metadata, values as JSON on the owning row plus a typed `CustomFieldIndex` for filterable fields |
| 010 | Conditional rules are a safe JSON expression tree with a schema and shared conformance vectors; .NET authoritative, TypeScript for UX |
| 011 | Task, form and workflow versions are pinned by foreign key to immutable published rows |
| 012 | New tasks use only the current published version of an eligible workflow and of the task type form |
| 013 | Completion needs every step resolved; Complete with unresolved steps offers bulk-complete in one transaction (addendum K) |
| 014 | Full task lifecycle and step state matrices are in section 8 |
| 015 | Audit is transactional: explicit events plus an interceptor for field diffs; no history tables |
| 016 | Optimistic concurrency with `rowversion`; workflow and lifecycle commands also lock the task |
| 017 | Angular 21 standalone and signals, feature folders, no NgRx; PrimeNG wrapped in `shared/ui` |
| 018 | Outlook intake is a server-side in-memory parse of `.eml` or `.msg` plus a paste path; nothing stored |
| 019 | Search is SQL `LIKE` with number normalisation; no full-text or search engine |
| 020 | Task numbers `TSK-<n>` from a SQL sequence |
| 021 | `Matter.ClientNumber` is denormalised with a composite key and a computed `MatterRef` |
| 022 | Custom fields of living records validate against the current published form; task and step values are pinned |
| 023 | Asset link roles are an admin-editable lookup |
| 024 | Projects are flat; an assigned user need not be in the assigned pod (the UI warns) |
| 025 | Ethical walls deferred; read paths go through an access seam (later the Sensitive matter rule) |
| 026 | Matter status is `IsActive` only; deactivation rules; inactive client or project blocks new matters or tasks |
| 027 | No attachments or file storage anywhere |
| 028 | Starter role and permission matrix is seeded and fully editable |
| 029 | Reports module with a separate read-only SQL login (`docs/adr/029-reports-module.md`) |

Other ADR-like documents: `docs/adr/outlook-dnd-spike.md` (drag and drop from new Outlook).

## Owner and product decisions (`docs/requirements/decisions-addendum.md`)

| Section | Topic | Summary |
|---|---|---|
| A | Task immutability and editing | Task type, workflow and matter cannot change after creation; project can (same matter); Completed and Cancelled can be reopened; assigning a user moves New to In Progress |
| B | Matters and Clients | Tasks only on active matters; matter inactive only when all tasks closed; numbers 1 to 5 digits stored zero padded; inactive client cannot get matters |
| C | Requestor, attachments, intake | Requestor name required; no attachments or stored emails; intake parses and discards; paste path always works |
| D | Comments | Rich text basic formatting, sanitised; internal only; soft delete; edit history |
| E | Security and identity | Phase 1: anyone with `Task.View` sees all tasks (later superseded for Sensitive matters by AJ); Pod Lead is a role; offboarding is manual |
| F | Scope reductions | Dropped: global task custom fields, subtasks, dependencies, cloning, bulk reassign, exports, read-audit logging |
| G | Dates and sorting | Due date optional (no date means ASAP, never overdue); one firm time zone for date-only dues; ASAP sorts first within a priority |
| H | Scale | 200 to 300 users; small scale drives the monolith and plain SQL |
| I | Build assumptions | .NET, EF Core, SQL Server, Angular; same origin; Windows auth with a Dev provider; initial admin from configuration |
| J | Database migrations | Numbered SQL scripts, immutable, startup runner, no EF migrations |
| K | Completing with unresolved steps | Confirmation offers bulk completion; rules for skippable steps |
| L | Admin account, time zone, AD lookup | Bootstrap admin, firm time zone, optional AD lookup |
| M | Local-time display | Times shown in the viewer's zone including due dates |
| N | QA findings resolved by the PM | Rulings on QA findings of 2026-10-14 |
| O | SME review decisions | Asset and matter modelling decisions from the eDiscovery SME |
| P | Required custom fields and existing records | How a newly required field treats existing records |
| Q | Task type coverage | Completion counts per person for training (Dashboard coverage matrix) |
| R | Rich-text task description | Safe tables in the description, sanitised |
| S | Dashboard Summary split | Summary split and one Refresh |
| T | My Work | My Work decisions |
| U | Task Queue and shared grid | Task Queue and grid decisions |
| V | Clients, Matters and Projects | Record page and counts decisions |
| W | Task Detail | Task detail page decisions |
| X | Inline column filters | Column filter close-out |
| Y | Administration pages | Counts and labels on admin pages; read permissions |
| Z | Users administration | Users and roles administration |
| AA | Assets | Assets screens |
| AB | Search UX | Search UX decisions |
| AC | My profile | Profile page, availability, work hours |
| AD | Pod Work | Pod Work UX |
| AE | App shell and system pages | Shell, 403, 404 and error pages |
| AF | Task Types administration | Task types, workflows and steps screens |
| AG | Project Manager role and My Matters | PM role, My Matters, matter managers |
| AH | Notifications | In-app notifications, switches, scheduler |
| AI | Reports | Reports epic and access rules (interim state for sensitive matters, item 6) |
| AJ | Sensitive matter access control | The visibility rule for Sensitive matters (epic #788) |
| AK | Project Manager experience | PM experience follow-ups |
| AL | Admin impersonation ("View as", read-only) | **Planned, not started** per the addendum; no implementation was found in the code at this commit (unverified beyond a text search for "impersonat") |
| AM | Application settings | Branding name and icon; settings page; defaults in code |
| AN | PM v2 | Task type icons, filters, Breakdown and Data tabs, asset reports |
| AO | My Matters: a calmer page | My Matters redesign (epic #893) |
| AP | UI update | Shared theme, new navigation, new My Matters (2026-10-31) |
| AQ | Matter detail redesign | Matter tabs, Productions, Notes, AI switch (epic #1001) |
| AR | Consistent lists and shell polish | List anatomy, shell polish (epic #1037) |
| AS | Dashboard v4 | Summary cards, grid, capacity battery, unassigned gauge (epic #1063) |
| AT | Dashboard Calendar | Absences, holidays, coverage planning (epic #1074) |
| AU | Assignee picker | Execute-only people, hide out of office, rank by workload then experience |
| AV | Capacity battery by absence | Capacity counts people by absence, not by the clock |

The addendum also records the owner's baseline answers in `docs/requirements/baseline-v1.1.md` section 22 (decision register) and the open questions of section 21.

## Other places decisions are recorded

| Place | What |
|---|---|
| `CLAUDE.md` | Standing rules: shortcuts frozen (issue #420), status "not deployed" (2026-10-24), Dev auth guard, desktop only (2026-11-04), UI standard |
| `docs/ux/*/README.md` and `delivery-plan.md` | Design reviews and delivery plans per epic; each names its addendum section |
| `docs/qa/security-review-1.md`, `security-review-2.md` and the `-resolutions` files | Security findings (SEC-nn) and how each was resolved |
| `.github/dependabot.yml` | Major dependency updates deferred until development is finished (owner, 2026-10-24) |

## Related pages

- [Overview](../Getting-Started/Overview.md)
- [Documentation Map](Documentation-Map.md)
- [Glossary](Glossary.md)

Last verified against commit c4bfdaf.
