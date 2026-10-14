# MatterFlow Test Plan

Version 1.0, 2026-10-14. Owner: QA Lead. Sources: `requirements/baseline-v1.1.md`, `requirements/decisions-addendum.md` (A to K override the baseline), `architecture.md` (sections 8, 15, 16), `ux/ux-spec.md` (section 9 checklists). Companion files: `traceability.md`, `permission-matrix-tests.md`, `risk-register.md`, `findings.md`.

Where this plan depends on a behaviour that is ambiguous in the sources, the dependency is marked `FND-nn` and resolved in `findings.md`. Test cases tagged with a FND are written against the recommended resolution and must be re-checked if the product owner decides otherwise.

## 1. Objectives and scope

- Prove the Phase 1 behaviours in the baseline as amended by addendum A to K, using the architecture's stable API error codes as the oracle.
- Prioritise the areas where defects are expensive: dynamic forms and versioning, workflow state machines, bulk-complete atomicity, number normalisation, authorization, audit atomicity, concurrency.
- Out of scope: anything the addendum removed (attachments, subtasks, dependencies, cloning, exports, bulk reassign, read-audit logging, ethical walls, notifications). A negative check that these do not exist is in scope (UAT-X-4).

## 2. Test strategy by layer

| Layer | Tooling | What it proves | Owner | Runs |
|---|---|---|---|---|
| L1 Unit (.NET) | xUnit, Shouldly, NSubstitute | Pure domain rules: task lifecycle matrix (every cell, table-driven), step state machine and ordering guard, `FirstResolvedAt` semantics, bulk-complete planner, rule evaluator against `form-rules.vectors.json`, `BusinessNumber` normaliser, due and overdue calculation (incl. DST), validators, comment sanitiser, script runner pure parts (GO splitter, checksum, prefix ordering) | Ticket developer | Every PR |
| L2 Architecture | NetArchTest | Module dependency rules, a permission policy on every controller action, no role-name checks, no cross-module navigation properties | Platform lead | Every PR |
| L3 Angular unit/component | Vitest, Angular Testing Library, MSW | `projects/form-engine` (shared vectors), renderer show/hide/required/options, guards, `matterRef` and `dueLabel` pipes, number input pad-on-blur, permission directive, facades, key pages, dialog copy (e.g. bulk-complete confirmation) | Ticket developer | Every PR |
| L4 Schema/runner | xUnit + Testcontainers.MsSql | Every script applies cleanly on empty DB and on previous release DB; runner behaviours of addendum J; EF model vs DB drift; triggers (immutability, published-form immutability); constraints (composite FKs, CHECKs) | Platform lead | PR smoke subset, nightly full |
| L5 API integration | xUnit, WebApplicationFactory, Testcontainers SQL Server 2022, Respawn, Dev auth with one test user per role | Endpoint contract, status and error codes, permission matrix, transactions and rollback, audit rows, concurrency, uniqueness, cross-Matter rejection, bulk-complete atomicity, JIT provisioning | Ticket developer writes module tests; QA owns cross-module suites | Module tests with each ticket (run on demand and nightly); PR smoke; full nightly |
| L6 Contract | JSON schema, OpenAPI diff, vectors | `contracts/openapi/v1.json` unchanged unless intended; rule schema; both stacks pass the same vectors | CI | Every PR |
| L7 E2E | Playwright (Chromium), docker compose, Dev auth, axe-core | Journeys SCN-001..020, UAT checklists, accessibility | QA | Deferred to Phase 6; one smoke spec earlier |
| L8 Non-functional | k6 or NBomber (API), seeded DB | p95 targets on queue, search, dashboard; concurrency soak | QA + platform | Phase 6 |
| L9 Manual / exploratory | Checklists, charters | Windows auth on a domain-joined IIS test box, new Outlook drag-drop, NVDA, zoom, forced colours, copy deck review | QA | Phase 6 plus spike |

### 2.1 Principles

1. The .NET API is the authority. Any rule the UI enforces is also tested at the API with Angular bypassed.
2. Every state-changing test asserts three things: HTTP result and error code, resulting database state, and the audit rows (type, actor, correlation id).
3. Negative tests are first class. Each rule has at least one test that tries to violate it.
4. Rollback is tested explicitly for every multi-step transaction (task create, bulk-complete, publish, reopen-with-auto-status, deactivate with checks): force a failure at the last step and assert nothing changed, including audit.
5. Tests use builders, never shared mutable fixtures; Respawn resets between tests. Time is injected (`TimeProvider`), never `DateTime.Now`.

### 2.2 Angular component test scope (L3)

Required per ticket: the component's states (loading, empty, error), permission-gated controls hidden and not merely disabled, keyboard operability of the main action, ProblemDetails `errors` mapped back to the right control, unsaved-changes guard. The form-engine library additionally runs the full shared vector file in Vitest.

### 2.3 Playwright e2e scope (L7, deferred)

Deferred to Phase 6 by product-owner decision. Preparation done earlier so the end is not a surprise: stable `data-testid` conventions in `shared/ui` wrappers, a `tools/seed-dev-data` profile for e2e, a page-object skeleton created in Phase 0, and one smoke spec (login to Access Pending, admin grants role, dashboard) added with the walking skeleton (#22). The e2e suite covers SCN-001..020, the UAT checklists marked "E2E" in `traceability.md`, and axe-core on the key screens (S01 to S11, S21).

## 3. Entry and exit criteria by phase

Phases follow `architecture.md` section 18.2. "Gate" = must be true before the phase is declared done.

| Phase | Entry | Exit (QA gate) |
|---|---|---|
| 0 Foundations (#1, #13 to #22) | Repo exists; Docker available on CI | CI green incl. PR smoke integration (scripts apply, boot with Dev auth, `/health/ready`, `/me`, create Client and Matter). Runner tests for all J safeguards pass (RUN-01..RUN-10). Access Pending enforcement test passes for every endpoint (generated from OpenAPI). Audit atomicity test passes (AUD-01). Form-rule vectors file has first 40 vectors and passes in both stacks. Outlook spike result recorded (ADR) |
| 1 Core data and engines (#2, #3, #4: #23 to #32) | Phase 0 exit | Number normalisation and uniqueness tests pass at unit, DB and API level. Permission matrix (PM-xx) generated tests pass for Identity and Organization endpoints. Vectors >= 100 and pass on both sides. Publish validator rejects every invalid case in section 7.5 of the architecture. JIT provisioning concurrency test passes |
| 2 Configuration, assets, workflow (#5, #6, #7: #33 to #40) | Phase 1 exit | Snapshot-on-publish tests pass (VER-xx). Step state machine unit tests cover every row of 8.2. Task Type usable-flag rules pass. Asset cross-Matter rejection at API and DB passes. Library edit does not alter published workflow (A8) |
| 3 Task management (#8) | Phase 2 exit; tickets for epic G created and estimated | Lifecycle matrix test covers all 25 cells. Bulk-complete suite K-xx passes incl. rollback. Concurrency suite CON-xx passes. SCN-004..016, 018 pass at API level. Audit coverage matrix (every explicit event type fires once, with correct correlation) passes |
| 4 Views, search, intake (#9, #10, #11) | Phase 3 exit | Queue sort test with the S03-6 dataset passes. Dashboard counts equal queue totals for every tile. Search number-aware cases pass. Parser tests pass on the email corpus (section 6.4). Nothing persisted by intake (disk and DB inspection test) |
| 5 Admin completion and polish | Phase 4 exit | UX review complete; copy-deck strings verified; no open S1 or S2 defects |
| 6 Hardening (#12) | All features merged | Full integration suite green 5 consecutive nightlies; e2e SCN-001..020 pass; performance targets met on seed data (section 6.2); security review of permission matrix, CSRF, redaction complete; axe-core zero critical or serious; IIS Windows-auth rehearsal passed; backup/restore rehearsal; UAT sign-off; zero open S1/S2, S3 either fixed or accepted by PO in writing |

Release exit criteria (global): all requirement rows in `traceability.md` have status Passed or are explicitly deferred by the PO; 100% of confirmed SCN scenarios pass; line coverage >= 80% on Domain and Application of WorkflowEngine, WorkManagement and Configuration; no known data-loss or authorization defect.

## 4. Defect severity and priority

| Severity | Definition | Examples | Response |
|---|---|---|---|
| S1 Critical | Data loss or corruption, security or authorization bypass, audit gap on a mutation, system unusable | Zero-permission user reads a Task; bulk-complete leaves half the steps completed; audit row missing for status change; duplicate `00343` clients; migration runner re-runs an applied script | Blocks merge and release. Fix within 1 working day. Regression test mandatory |
| S2 High | Core scenario broken with no workaround, wrong business result | Ordered workflow lets step 3 start before step 2; overdue flag wrong; published workflow altered by library edit; completion check wrong under race | Blocks release. Fix in the current sprint |
| S3 Medium | Feature works incorrectly with a workaround, or non-core scenario broken | Filter combination wrong; wrong copy text; focus not returned from dialog | Scheduled; may ship with PO acceptance |
| S4 Low | Cosmetic, minor usability | Alignment, tooltip typo | Backlog |

Priority (P1 to P3) is set by the PO independently. Every defect records: build, environment, layer where found, test case id, requirement id, whether an automated test now guards it. A defect found by exploration is not closed until an automated test exists (unit if possible).

## 5. Definition of done

### 5.1 Per ticket (applies to every issue #13 onwards)

1. Acceptance criteria met and demonstrated on the feature branch.
2. **Unit tests are required in the ticket** (L1 for backend logic, L3 for Angular logic and components). A ticket with business logic and no unit tests is not done. Pure rules (state machines, validators, normalisers) include table-driven tests that name every case from the sources.
3. Module-level integration tests are authored with the ticket where the ticket adds an endpoint, a DB script or a transaction (the architecture requires this even though the full integration pass is at the end). They need to compile and pass locally and in the nightly job; they are not required to be in the PR gate except the smoke subset.
4. Permission policy declared on every new endpoint; the permission-matrix generator picks it up (no hand edits needed). Negative 403 test present.
5. Audit events implemented for each mutation and asserted in at least one test (or explicitly marked non-audited with reason).
6. OpenAPI regenerated and committed; Angular client regenerated; contracts job green.
7. Any new `db/scripts/NN-*.sql` is append-only, passes `tools/check-scripts`, and the schema test job applies it.
8. No secrets or sensitive content in logs (redaction rules, architecture section 17).
9. CI green; code review by a second developer; traceability row updated with the test ids.
10. UX: for UI tickets, the relevant UAT checklist items are ticked in the PR description (manual check) and axe-core run locally has no critical issues.

### 5.2 Deferred to the end (product-owner decision)

Full cross-module integration suites, Playwright e2e for SCN-001..020, performance, accessibility audit, Windows-auth/IIS rehearsal and UAT happen in Phase 6 (#12). A ticket is therefore "done" without e2e, but QA tracks the e2e backlog in `traceability.md` so Phase 6 starts with a ready script list. Risk of this deferral is recorded in `risk-register.md` (R-15) and mitigated by the smoke job, nightly integration and contract checks.

### 5.3 Per epic

All child tickets done; the epic's rows in `traceability.md` have module-level automated tests passing; no open S1/S2 defects in the epic; demo recorded against the UAT items of its screens.

## 6. Test data strategy

### 6.1 Builders and fixtures

- C# builders per aggregate (`ClientBuilder`, `MatterBuilder`, `TaskBuilder.InState(...)`, `WorkflowBuilder.Ordered(n).WithStep(...)`, `FormBuilder`). Defaults are valid; tests override only what they assert.
- Test users per starter role (Director, Project Manager, Pod Lead, Data Technician, Data Scientist), plus `SysAdmin`, `NoRole` (zero permissions), `Disabled`, and `Custom(permissionSet)` created per test.
- Fixed reference clock `2026-03-10T14:00:00Z` with firm timezone `America/New_York` (DST boundary tests use 2026-03-08 and 2026-11-01).
- Email corpus under `tests/data/emails/`: `.eml` and `.msg` samples (plain, HTML, multipart, with and without attachments, non-English subject, 20k+ char body, malformed, 26 MB oversized). No real client data; synthetic only.
- Form vector file `contracts/form-rules.vectors.json` is shared by .NET and TypeScript.

### 6.2 Seed volumes (`tools/seed-dev-data`)

| Profile | Users | Clients | Matters | Projects | Tasks | Assets | Other | Used for |
|---|---|---|---|---|---|---|---|---|
| `small` | 12 | 5 | 10 | 20 | 100 | 50 | 3 Task Types, 4 workflows | Dev and e2e |
| `scale` | 300 | 300 | 1,000 | 3,000 | 5,000 (approx. 15% New, 35% In Progress, 10% On Hold, 30% Completed, 10% Cancelled; 20% ASAP) | 250 per Matter (about 250,000; 10 matters at 300) | 40 Pods, 8 Task Types with forms (5 filterable fields each), 25 workflows (ordered and unordered, 3 to 12 steps), about 20,000 `StepInstance` per 5,000 Tasks avg 4, 60,000 comments, about 400,000 audit rows | Performance (Phase 6), queue sort dataset, search |
| `sort` | 5 | 1 | 1 | 0 | 24 | 0 | all priorities | S03-6 default sort: every priority x {ASAP, overdue explicit, future explicit date-only, future with time} with distinct creation dates |
| `numbers` | 3 | clients `00001`, `00002`, `00343`, `99999`, `10000` | matters `00001` under several clients, `00012` | 0 | 0 | 0 | | Number normalisation, lookup and search |

The architecture seed lists 300k assets and 1,000 matters; the addendum says 200 to 300 per matter. 250 x 1,000 = about 250k is used and 300 x 1,000 = 300k is the stress ceiling (FND-14).

Performance targets (proposal, since baseline OPEN-17 gives none): Task Queue first page p95 < 500 ms; global search p95 < 300 ms (architecture 14); dashboard < 1 s; task create < 800 ms; bulk-complete of 30 steps < 1.5 s. Measured at 20 concurrent users on the `scale` profile on SQL Server 2022 container with 4 vCPU.

### 6.3 Data hygiene

Seed data and email corpus are synthetic and contain no real client or matter names. Test databases are ephemeral. Logs from tests are scanned by a test that fails on known sentinel strings (`SECRET-SUBJECT-123`) to prove redaction (R-xx logging).

### 6.4 Email corpus checklist

Plain `.eml`; HTML-only `.eml`; multipart/alternative; `.msg` from classic Outlook; `.msg` with attachments (names must not appear in any output or log); From with display name and without; display name containing a comma or quote; sent date in non-UTC offset; subject over 300 chars; body over 20,000 chars; pasted Outlook header block (English); pasted block without headers; forwarded chain; empty body; corrupt file; zero-byte file; 26 MB file.

## 7. Environments

| Env | Purpose | Auth | DB | Notes |
|---|---|---|---|---|
| Local dev | Developer loop | Dev provider with `Dev:Users` | Docker SQL Server | Seed `small` |
| CI (GitHub Actions ubuntu) | Unit, architecture, PR smoke, nightly integration | Dev provider | Testcontainers SQL Server 2022 per test class, Respawn | No Windows auth possible here |
| Compose e2e | Playwright | Dev provider | Container, seed `small`/`e2e` | Phase 6 |
| Perf | Scale tests | Dev provider | Dedicated SQL Server 2022, seed `scale` | Phase 6 |
| Test IIS (domain-joined) | Windows auth, JIT provisioning, app-pool AD lookup, Negotiate in Edge/Chrome, new Outlook drag-drop | Windows Integrated | SQL Server on same network | Manual; at least Phase 0 skeleton rehearsal and Phase 6 |
| Staging | UAT with PO | Windows (Dev provider permitted only if flagged, A-15) | Copy of seed `scale` minus fake names | Phase 6 |
| Production | n/a for QA | Windows | | Dev provider must be impossible to enable: tested (SEC-DEV-01) |

Browsers: Edge current and Chrome current (Chromium for automation). Screen reader: NVDA with Edge. Firefox and Safari not supported.

## 8. Automated vs manual

| Area | Automated | Manual |
|---|---|---|
| Business rules, state machines, validators | L1, L5 | Exploratory sessions on workflow and lifecycle (one 90 minute charter per sprint from Phase 3) |
| Permissions | Generated matrix (L5), architecture test (L2), Angular directive tests | Review of seeded role matrix with PO |
| Forms engine | Vectors both stacks, publish validator, renderer | Designer usability with a real admin, keyboard-only walkthrough |
| Audit | L5 assertions per mutation, atomicity fault injection | Review of Activity wording with PO |
| Concurrency | L5 parallel tasks (barriers) | None |
| Migrations | L4 | Rehearsal on a copy of a populated DB before each release |
| Windows auth, IIS, AD enrichment | None possible in CI | Manual on the domain-joined test box (checklist WIN-01..WIN-08 in the traceability file) |
| Outlook drag-drop | Parser tests, JS payload parser tests on captured payloads | Spike matrix (#21), repeated on every new Outlook release before go-live |
| Accessibility | axe-core in e2e | NVDA, keyboard-only, 200% zoom, forced colours (UAT-X-6..9) |
| Look and copy | Snapshot of copy-deck strings | Visual review |
| Performance | k6 against `scale` profile | None |

## 9. Reporting and metrics

Nightly dashboard (GitHub Actions summary): test counts per layer, flaky list (a test failing and passing without code change twice in a week is quarantined within 2 days and fixed or deleted), coverage on the three core modules, open defects by severity, traceability coverage (rows with at least one passing automated test / total rows). Weekly QA note to the PM: gate status of the current phase and top risks.

## 10. Roles

QA Lead: plan, traceability, permission matrix, cross-module suites, e2e, exploratory. Developers: L1, L3, module L5 tests per ticket. Platform lead: CI, Testcontainers harness, runner and schema tests. PO: UAT, resolves findings, signs off.

## 11. Assumptions and dependencies

- Tickets #1 to #40 exist; epics G (#8), H (#9), I (#10), J (#11) and Z (#12) have no child tickets yet, so rows for them cite the epic. QA will update the matrix when the PM creates children.
- Findings in `findings.md` that affect test oracles (FND-01, 02, 03, 04, 05, 06, 07, 09) should be resolved by the PO before Phase 3 starts.
