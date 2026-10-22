# Reports: delivery plan

Owner brief (2026-10-22): binding decisions are listed at the top of `README.md` in this folder (spec, 18 sections). Date of this plan: 2026-10-22, base `origin/dev`. Decisions go to `docs/requirements/decisions-addendum.md` section **AI** (the owner named AI for this epic; letters Y, AA, AB, AE and others are reserved by other epics).

**Binding owner decisions (short).** (1) SQL SELECT reports written by `Report.Manage` admins with `:NAME` placeholders, typed parameters, fixed or SELECT-driven choice lists, built-ins. (2) Parameters are always real SQL parameters; multi-choice goes through one JSON parameter and an engine-owned `OPENJSON` sub-select. (3) A separate READ-ONLY login with no rights on audit/credential tables; validator is defence in depth only. (4) Limits: 60 s, 50,000 rows with a truncated notice, one running report per user. Preview (20 rows) required before activation; versions with restore; schema browser; starter reports. (5) Permissions `Report.Manage`, `Report.Assign`, `Report.Run` + assignment to a role; sensitive matters option A (no filtering). (6) Table only, CSV in release one, saved personal views, favourites/recent good to have; audit of runs and changes. (7) No charts, no email scheduling, no row-level security. **No new or changed keyboard shortcuts** (#420). Bundle under 700 kB: lazy routes, no static api-client or lookup-store in eager code.

Structure on GitHub: one epic **#671** (labels `epic` + `phase-19`) and 32 sub-issues (#673 to #728, label `phase-19`; numbers follow creation order and are not contiguous because other epics were created in parallel). Tick-list in the epic body.

Effort is in **AI-agent hours** (wall-clock of one developer agent including unit, integration, e2e, axe). Total **120 h**; the first release (R1) is **117.5 h**; R2 is favourites and recent (2.5 h). The owner guessed about 100 h. The plan is higher because of: security work counted explicitly (validator 4.5 h, login provisioning 4 h, security suite 5 h, access catalogue 4.5 h), a server-side result store (5 h) instead of shipping all rows to the browser, and two-way assignment screens (6.5 h). **Cut options to land near 100 h:** drop the diff view and restore UI (about 2 h, keep versions in the API), drop the assignment matrix view, skip saved parameter values in views (1 h), simplify the schema browser panel to a searchable list (1 h), defer the phone-optimised editor (1.5 h); each is stated in the issue and does not touch security.

## 1. Issue list

| # | ID | Title | Agent-h | Depends on | Package (release) |
|---|---|---|---|---|---|
| #673 | A1 | Reports permissions: Report.Manage, Report.Assign, Report.Run | 2 | None | WP-RP1 (R1) |
| #677 | A2 | DB script: Reports tables, mf_report_reader role, access catalogue and test | 4.5 | #673 | WP-RP1 (R1) |
| #680 | A3 | Reports module skeleton, ADR and OpenAPI/nswag wiring | 3.5 | #673 | WP-RP1 (R1) |
| #684 | A4 | Read-only report login: demo provisioning, corporate runbook, startup probe | 4 | #677 | WP-RP1 (R1) |
| #687 | B1 | SQL scanner and :NAME placeholder detection | 4 | #680 | WP-RP2 (R1) |
| #690 | B2 | SQL validator: one SELECT only (ScriptDom) plus defence checks | 4.5 | #687 | WP-RP2 (R1) |
| #694 | B3 | Parameter model, type coercion and value validation | 4 | #687, #677 | WP-RP2 (R1) |
| #698 | B4 | Multi-choice binding (JSON + constant sub-select) and date-range expansion | 3 | #687, #694 | WP-RP2 (R1) |
| #702 | C1 | Execution engine: read-only connection, timeout, cancel, row cap, concurrency limits | 5 | #684, #690, #698 | WP-RP3 (R1) |
| #705 | C2 | Result store and server-side page, sort and filter | 5 | #702 | WP-RP3 (R1) |
| #709 | C3 | Preview and activation gate | 3 | #702, #708 | WP-RP3 (R1) |
| #707 | C4 | Run log and audit events for runs and definition changes | 3 | #677, #702 | WP-RP3 (R1) |
| #708 | D1 | Report admin API: CRUD, categories, versions, restore | 5 | #677, #690, #694 | WP-RP4 (R1) |
| #710 | D2 | Schema browser API | 2 | #684 | WP-RP4 (R1) |
| #711 | D3 | Choice lists and lookup parameters (fixed list, SELECT list, matter/client/user/pod) | 3 | #702, #694 | WP-RP4 (R1) |
| #712 | E1 | Admin Reports list (admin list kit) | 3.5 | #708 | WP-RP5 (R1) |
| #713 | E2 | Report editor: details, query editor, parameter definitions | 6 | #712, #687, #711 | WP-RP5 (R1) |
| #714 | E3 | Preview panel, activate and version history UI | 4 | #713, #709 | WP-RP5 (R1) |
| #715 | E4 | Schema browser panel in the editor | 2 | #713, #710 | WP-RP5 (R1) |
| #716 | F1 | Role assignment API (both directions) and audit | 2.5 | #677, #707 | WP-RP6 (R1) |
| #717 | F2 | Assignment UI: role 'Reports' tab and report 'Roles' tab | 4 | #716, #713 | WP-RP6 (R1) |
| #718 | G1 | User Reports listing (grouped by category) and navigation | 3.5 | #716, #680 | WP-RP7 (R1) |
| #719 | G2 | Run page and parameter form (control per type) | 5 | #718, #694, #711, #702 | WP-RP7 (R1) |
| #720 | G3 | Result grid: paging, sorting, filters, reorder, resize, column chooser | 7 | #719, #705 | WP-RP7 (R1) |
| #721 | G4 | CSV export of current filtered/sorted rows | 4 | #705, #720 | WP-RP7 (R1) |
| #722 | G5 | Saved views (personal named layout) | 4 | #720 | WP-RP7 (R1) |
| #723 | G6 | Favourites and recent reports (good to have) | 2.5 | #718 | WP-RP7 (R2) |
| #724 | H1 | Starter reports and demo seed | 3 | #702, #708, #716 | WP-RP8 (R1) |
| #725 | H2 | Security test suite (injection, login rights, abuse limits, CSV, access) | 5 | #702, #721, #684 | WP-RP8 (R1) |
| #726 | H3 | Performance, bundle budget, accessibility and phone pass | 3.5 | #720, #721, #714 | WP-RP8 (R1) |
| #727 | H4 | Documentation: ux-spec, runbook, decisions AI, e2e catalogue | 2 | #726 | WP-RP8 (R1) |
| #728 | H5 | Final verification pass | 3 | #724, #725, #726, #727 | WP-RP8 (R1) |

Total: **120 agent-hours** (32 issues).

## 2. Work packages

| Package | Name | Issues | Agent-h |
|---|---|---|---|
| WP-RP1 | Foundations (permissions, schema, module, login) | 4 | 14 |
| WP-RP2 | Query safety and parameters | 4 | 15.5 |
| WP-RP3 | Execution engine | 4 | 16 |
| WP-RP4 | Admin API | 3 | 10 |
| WP-RP5 | Admin screens | 4 | 15.5 |
| WP-RP6 | Role assignment | 2 | 6.5 |
| WP-RP7 | User screens (list, run, grid, CSV, views) | 6 | 26 |
| WP-RP8 | Starters, security tests, hardening, verification | 5 | 16.5 |

## 3. Order, lanes and waves

- **Wave 1 (foundation, serial):** A1 -> A2 -> A3 -> A4. Land first; everything else needs the module, tables and the login.
- **Wave 2 (backend, two lanes):** Lane 1 safety: B1 -> B2 -> B4 (B3 in parallel with B2); Lane 2 data: D1 (needs A2, B2, B3), D2 (needs A4). Then C1 (needs A4, B2, B4), C2, C3, C4, D3.
- **Wave 3 (frontend, two lanes after the APIs exist):** Admin lane E1 -> E2 -> E3, E4; Assignment F1 -> F2 (F2 needs the editor tab, E2). User lane G1 -> G2 -> G3 -> G4, G5, G6.
- **Wave 4 (close):** H1 starters (needs C1, D1, F1), H2 security suite (can start with C1 and grow), H3 performance/a11y/phone, H4 docs, H5 final verification.
- First usable slice (admin can create, preview, activate, assign; a user can run and see a table): A1 to A4, B1 to B4, C1 to C3, D1, D3, E1 to E3, F1, F2, G1 to G3. Then CSV (G4), views (G5), starters (H1), hardening.
- File ownership to avoid clashes: backend `Modules/Reports/**` (one lane per folder: Application/Domain vs Infrastructure/Api); `db/scripts/<next free>-reports.sql` and `db/report-access.json` only A2; `ModuleComposition.cs`, `permissions.json` only A1/A3; frontend `src/app/reports/**` and `src/app/admin/reports/**` (lazy), Roles page tab only F2; `tools/db/**` only A4.

## 4. Shared rules for every issue

Scope per issue is in its body. Rules: no EF migrations; SQL scripts take the next free number at implementation time and are immutable once merged; NuGet versions only in `Directory.Packages.props` (ScriptDom is added there); module boundaries per `MatterFlow.ArchitectureTests`; permission names kept in step across `contracts/permissions.json`, `Permissions.cs`, `permissions.ts`; OpenAPI and nswag client updated together; Dev auth guard untouched; the reports connection never falls back to the app connection; warnings are errors.

## 5. Definition of done (every issue)

1. Acceptance criteria of the issue met, each with a named test.
2. Unit, integration and e2e tests added, green twice; permission variants covered for any endpoint or screen.
3. Security: new endpoints check permission server-side; no SQL text in run-only error messages; parameters bound, never concatenated; nothing logs secrets or full SQL in audit events.
4. Accessibility: axe 0 violations at 1366x768, 1920x1080, 768x1024, 375x812 with menus and dialogs open; keyboard-only walk; focus visible and returned; hidden (not disabled) actions without permission.
5. No new or changed keyboard shortcuts (#420 stays the Phase 2 backlog).
6. Bundle: initial bundle under 700 kB (measured); Reports code only in lazy chunks; no static import of the generated api-client or lookup-store in eager code.
7. `dotnet build -warnaserror`, `dotnet format --verify-no-changes`, frontend lint, `format:check`, build, contracts check green; OpenAPI and client in sync.
8. Docs touched are updated (README/runbook where noted); the issue gets a short comment with the commit.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Validator misses a dangerous construct | Login permissions are the real control; direct-login security tests (H2); startup probe |
| New table silently readable by the report login | Access catalogue test (A2) |
| Large results exhaust memory | One result per user, TTL, budget, row cap, perf test (C2, H3) |
| IIS recycle drops cached results | Clear expired message; Run again keeps parameters; open question Q5 |
| ScriptDom parse differences with new T-SQL | Pin version, corpus tests, fall back to reject (never accept unparsed) |
| Corporate DB compatibility level below 130 | Startup check with message; TVP fallback documented |
| Bundle growth | Lazy routes, textarea editor (no Monaco), bundle check in H3 and CI |

## 7. Status

2026-10-22: planned, nothing started. Issues blocked on an owner decision: none (the open questions in README section 18 have safe defaults: views not snapshots, comma CSV with BOM, in-memory results).
