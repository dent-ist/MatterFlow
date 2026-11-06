# Documentation Map

[[_TOC_]]

**What this page is for.** Every document and documentation folder in the repository and what it is for, so you know where to look for a requirement, a design, a decision, a QA report or a mockup. Files outside `wiki/` are written as code paths because the published wiki cannot link to them.

**About this wiki's diagrams.** The Mermaid diagrams are written in the Azure DevOps syntax (`::: mermaid`). All 26 diagrams in the wiki were syntax-checked by parsing them with Mermaid 9.4.3 and Mermaid 10.9.1 in headless Chromium (`mermaid.parse`, 2026-11-07): none failed, and two deliberately broken diagrams were rejected, so the check works. This proves the syntax only. It does not show how the (possibly different) Mermaid version of Azure DevOps lays out a large diagram, and the big ER diagrams and the module dependency diagram were not viewed rendered. The check script was a throwaway and is not in the repository.

## Top-level documents

| File | Purpose |
|---|---|
| `CLAUDE.md` | Standing project rules for developers and AI agents (layout, commands, rules, UI standard, commit format) |
| `README.md` | Setup, run commands, demo data, configuration table, CI |
| `docs/architecture.md` | **Source of truth for design decisions** (ADR table, system context, schema runner, modules, auth, forms, workflow, audit, concurrency, API conventions, Angular, search, testing, CI, phases) |
| `docs/erd.md` | The logical ERD written at the start (v1.0, 2026-10-14); out of date for later tables, see [Database Overview](../Database/Overview.md) |
| `docs/dev-environment.md` | Notes for the cloud container (apt .NET, Docker, Node, Chromium) |
| `docs/runbook.md` | Operations guide: install on IIS, upgrade, backup, troubleshooting, reports login, Sensitive matters go-live; see [Runbook](../Operations/Runbook.md) |
| `docs/frontend-bundle.md` | Notes on the frontend bundle size |
| `docs/contract-issues-dotnet.md`, `docs/contract-issues-ts.md` | Notes from implementing the form-rules contract in each stack (all resolved) |
| `db/scripts/README.md` | Rules for SQL scripts and the list of later scripts |
| `contracts/README.md`, `contracts/form-rules.md` | Contract overview and the form rule semantics |
| `tools/perf/README.md` | Load and timing tools |
| `frontend/projects/form-engine/README.md` | The form engine library |
| `app-framework/*.md` | Design documents (01 to 10) for a planned app and extension framework: **not implemented**, nothing depends on it |

## `docs/requirements/`

| File | Purpose |
|---|---|
| `baseline-v1.1.md` | The original requirements baseline (terminology, objects, features, decision register) |
| `decisions-addendum.md` | Owner and product decisions, sections A to AV, which **override the baseline**; see [Decision Index](Decision-Index.md) |

## `docs/adr/`

`029-reports-module.md` (decision for the Reports module), `outlook-dnd-spike.md` (drag and drop from new Outlook spike).

## `docs/sme/` (domain expert material)

`domain-review.md` (the eDiscovery SME's review), `sample-scenarios.md`, `seed-configuration.md` and `seed-configuration.json` (starter task types, workflows, forms; embedded in the API), `seed-notes.md`.

## `docs/qa/` (quality)

| File or folder | Purpose |
|---|---|
| `test-plan.md`, `traceability.md`, `findings.md`, `risk-register.md` | Test strategy, requirement to test traceability, findings, risks |
| `e2e.md`, `e2e-findings.md` | The Playwright suite and its findings |
| `permission-matrix-tests.md`, `pm-permission-matrix.md` | Permission matrix tests and the PM matrix |
| `security-review-1.md`, `security-review-2.md` and `-resolutions` | Security reviews (SEC-nn) and how they were resolved |
| `performance-round-1.md`, `sensitive-matters-performance.md` | Performance measurements |
| `pm-keyboard-evidence.md`, `pm-v2-final-verification.md` | PM evidence and final verification |
| `final-pass-*.md` and folders, `full-pass-2026-10-16`, `dashboard-final-pass-2026-10-17`, `my-work-pass-2026-10-18`, `uat-round-1`, `uat-round-2` | Dated QA passes and UAT rounds with reports and screenshots |

## `docs/ux/` (design)

| File or folder | Purpose |
|---|---|
| `design-guidelines.md` | **The UI standard** (rules D-xx, component catalogue, wording, checklist, guards); see [UI Standard](../Frontend/UI-Standard.md) |
| `theme-guide.md`, `tokens.css` | Design tokens and how to adopt them; per-screen rules |
| `ux-spec.md` | The original UX specification (screens S01 and on) |
| `ux-review-round-1.md`, `review-round-2.md`, `review-round-4.md`, `review-round-5.md`, `dashboard-review*.md`, `column-filters-review.md`, `tab-strips-review.md`, `task-type-icons.md` | Review rounds and special topics |
| `ui-update/` | UI update 2: `README.md` (rules and plan), `ui-spec.md` (history of the standard), `inventory.md`, `shared-blocks.md`, `issue-template.md` (commit format), `stack-howto.md` and `stack-start.sh` (demo stack), `crawl/` (screenshot and probe scripts), `review-1` to `review-8`, `screenshots`, `qa-report.md`, `progress.md` |
| `<area>-review/` and `<area>/` folders | One folder per epic with `README.md` (spec), `delivery-plan.md`, fixes, mocks and screenshots: `admin-pages-review`, `assets-review`, `clients-review`, `create-task-review`, `dashboard-review-2`, `dashboard-v4`, `dashboard-users`, `dashboard-swimlane`, `dashboard-trends-types`, `calendar`, `my-matters-calm`, `matter-detail`, `my-work`, `my-work-review`, `notifications-review`, `pm-experience`, `pm-review`, `pm-v2-review`, `pod-work-review`, `profile-review`, `profile-availability`, `reports-review`, `search-review`, `sensitive-matters`, `shell-review`, `task-detail*`, `task-queue-review`, `task-types-review`, `task-types-tabs`, `users-review`, `users-pods`, `workflow-*`, `app-settings`, `impersonation` (planned), `theme-rollout`, `roles-dashboard-permissions`, `rich-description`, `detail-layout`, and others |
| `mockups/` | HTML mockups (dashboard, My Matters, notes) with a README |
| `docs/branding/` | Logo files |

## `wiki/` (this folder)

| Path | Purpose |
|---|---|
| `Home.md`, section pages and folders | The developer wiki; published as the Azure DevOps wiki |
| `tools/check-db-docs.mjs` | Checks the database pages against `db/scripts` |
| `.order` files | Page order for Azure DevOps |

## Where to find ...

| I need ... | Read |
|---|---|
| Why something works the way it does | `docs/architecture.md`, then `docs/requirements/decisions-addendum.md` ([Decision Index](Decision-Index.md)) |
| What a screen should look like | `docs/ux/design-guidelines.md`, `docs/ux/theme-guide.md`, the area's `docs/ux/<area>/README.md` |
| How to run or operate it | `README.md`, `docs/runbook.md`, `docs/dev-environment.md` |
| What was tested and found | `docs/qa/` |
| A table or column | [Table Reference](../Database/Table-Reference.md) (the early `docs/erd.md` is stale) |

## Related pages

- [Home](../Home.md)
- [Decision Index](Decision-Index.md)
- [How to Keep the Wiki Up to Date](How-to-Keep-the-Wiki-Up-to-Date.md)

Last verified against commit c4bfdaf.
