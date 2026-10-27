# PM v2: delivery plan (epic #851)

Design: `README.md` (this folder). Decisions: `docs/requirements/decisions-addendum.md` section AN. Status: **built 2026-10-27, final verification in `docs/qa/pm-v2-final-verification.md`** (was: planned; HIGHEST priority to start) (owner order: 1. this epic, 2. combined verification then merge to main, 3. Application settings #850, 4. Impersonation #828, 5. Reports #671).

## 1. Dependencies

| Item | Relation |
|---|---|
| #758 / #812 (PM experience, follow-ups) | Built. Reused: `IManagedMatterScope`, scope switch, My Matters tabs, `PmScopeFixture`, perf harness. |
| #788 (sensitive matters) | Built. Every new endpoint passes `IMatterVisibility` and gets catalog and persona coverage (PV-37). |
| #850 (Application settings) | **Planned, no dependency.** New titles use the shared title helper `<Page>: <Tab> - <App name>`; the name arrives from #850 later. The on-hold "required" switch is configuration now and moves to the Settings page later. |
| #828 (Impersonation) | **Planned, no dependency.** New write endpoints (views, reports, disposition, reasons) follow the normal write pipeline, so the central read-only rule of #828 will cover them without change. |
| #671 (Reports) | Not related: the asset report builder is built-in and narrow. |
| SQL scripts | Last used on dev: 39. Each package that needs one takes **the next free number at implementation time** (`ls db/scripts` on `origin/dev`); six small scripts are expected (PV-01, 05, 13, 16, 21, 25) plus a possible index script (PV-36). Any new table needs `db/report-access.json` and GRANT/DENY for `mf_report_reader` (PV-05, 21, 25). |

## 2. Work packages

Lane A task types, B My Matters sections, C Breakdown and Trends, D assets (disposition, size, Data), E report builder, F on hold and turnaround, G export, views and fixtures, H page fixes from the review, I cross-cutting. Effort is agent-hours including tests.

| Package | Issue | Title | Lane | Wave | Hours | Depends on |
|---|---|---|---|---|---|---|
| PV-01 | #852 | Task Type: colour, default and target days (DB, domain, API) | A | W0 | 3.5 | - |
| PV-02 | #853 | Task Type admin UI: colour picker, target days, preview, list columns | A | W1 | 4.0 | #852 |
| PV-03 | #854 | Shared task type badge (icon, colour, accessible name, tooltip) | A | W1 | 3.5 | #852 |
| PV-04 | #855 | My Matters task items: type, priority, status, age, on-hold, at-risk; server-side sort and type filter | B | W1 | 6.0 | #852 |
| PV-05 | #856 | UserView store: remembered section state and named views (table, API, client service) | B | W0 | 5.0 | - |
| PV-06 | #857 | My Matters sections: type badge in rows, filter and sort toolbar, remembered per section | B | W2 | 7.0 | #854, #855, #856 |
| PV-07 | #858 | Focus: pick today's task types once; stays until changed | B | W3 | 3.0 | #856, #857 |
| PV-08 | #859 | My Matters Overview first screen: compact summary, no repeats, honest health flag, one New task | B | W3 | 4.0 | #857 |
| PV-09 | #860 | Task Queue and work queues: filters atRisk, onHoldReason, sort by type (base) | C | W1 | 3.0 | #852 |
| PV-10 | #861 | Breakdown API: tasks per task type per matter and total | C | W1 | 6.0 | #852 |
| PV-11 | #862 | Breakdown tab UI (lazy): matrix, per matter / all matters, clickable cells, accessible table, phone cards | C | W2 | 8.0 | #854, #860, #861 |
| PV-12 | #863 | Trends demoted: last tab, compact, one-line disclosure | C | W3 | 2.0 | #862 |
| PV-13 | #864 | Asset disposition: schema and migration | D | W0 | 3.0 | - |
| PV-14 | #865 | Asset disposition: domain, API, audit, permission Asset.Dispose, link guard | D | W1 | 6.0 | #864 |
| PV-15 | #866 | Asset disposition UI: list column/filter, record page, change dialog, bulk, history | D | W2 | 6.0 | #865 |
| PV-16 | #867 | Asset size: designated number field, unit, always-indexed NUMBER/SELECT fields, reindex | D | W0 | 6.0 | - |
| PV-17 | #868 | Demo seed and e2e fixtures for PM v2 | G | W2 | 3.5 | #852, #864, #867, #876 |
| PV-18 | #869 | Data API: assets and size per matter and type, status, warnings | D | W2 | 7.0 | #865, #867 |
| PV-19 | #870 | Data tab UI (lazy): tables, warnings, links, phone cards | D | W3 | 8.0 | #869 |
| PV-20 | #871 | Data volume over time per matter and across matters | D | W3 | 5.0 | #867, #874 |
| PV-21 | #872 | Asset report definitions: personal saved reports (table and API) | E | W0 | 5.0 | - |
| PV-22 | #873 | Asset report engine: Count/Sum/Average, group-by, visibility, units, limits | E | W2 | 9.0 | #864, #867, #872 |
| PV-23 | #874 | Lazy chart components: Pie, Bar and Show as table (shared, no new dependency) | E | W0 | 6.0 | - |
| PV-24 | #875 | Report builder UI: define, run as table, Pie/Bar with graph field, save, open, export | E | W3 | 9.0 | #872, #873, #874 |
| PV-25 | #876 | On-hold reason: lookup table, admin page, status-change API, audit | F | W0 | 7.0 | - |
| PV-26 | #877 | On-hold reason in the UI: dialog, lists, filter, aging text | F | W2 | 5.0 | #860, #876 |
| PV-27 | #878 | Target turnaround: At risk badge, strip count, filter, avg actual vs target | F | W2 | 6.0 | #852, #855, #860, #861 |
| PV-28 | #879 | Export and copy of filtered lists (CSV, copy as text) | G | W3 | 6.0 | #860 |
| PV-29 | #880 | Saved views: name, apply, default, rename, delete | G | W3 | 6.0 | #856, #857 |
| PV-30 | #881 | Matters list: column widths, truncation, PM columns | H | W3 | 3.5 | #878, #865 |
| PV-31 | #882 | Matter record Overview: type mix, data block, on-hold reasons, Details placement | H | W3 | 5.0 | #861, #869, #871 |
| PV-32 | #883 | Assets tab and Assets list: size and disposition columns, status filter, linked column | H | W3 | 3.0 | #866 |
| PV-33 | #884 | Notifications for a PM: group overdue notices, task type in the text, honest bell | H | W3 | 4.0 | #854 |
| PV-34 | #885 | Search as a PM: type, due date and disposition in hits | H | W3 | 2.5 | #854, #865 |
| PV-35 | #886 | Clients and Projects lists: count of my matters per row | H | W0 | 2.0 | - |
| PV-36 | #887 | Performance budget, indexes and plans for PM v2 | I | W4 | 5.0 | #861, #869, #873 |
| PV-37 | #888 | Sensitive-matter catalog and persona coverage for every new endpoint | I | W4 | 4.0 | #861, #865, #869, #873, #879 |
| PV-38 | #889 | Accessibility, four widths, phone, e2e and bundle gate for PM v2 | I | W4 | 9.0 | #862, #870, #875, #857 |
| PV-39 | #890 | Docs, runbook and final verification for PM v2 | I | W4 | 2.5 | all |

Total **199.0 agent-hours** nominal (39 issues). Per wave: W0: 37.5 h | W1: 28.5 h | W2: 51.5 h | W3: 61.0 h | W4: 20.5 h.

## 3. Waves and lanes

```
W0 (no dependencies, start together)   PV-01 PV-05 PV-13 PV-16 PV-21 PV-23 PV-25 PV-35
W1                                      PV-02 PV-03 PV-04 PV-09 PV-10 PV-14
W2                                      PV-06 PV-11 PV-15 PV-18 PV-22 PV-26 PV-27 PV-17
W3                                      PV-07 PV-08 PV-12 PV-19 PV-20 PV-24 PV-28 PV-29 PV-30..34
W4                                      PV-36 PV-37 PV-38 PV-39 (PV-36/37 can start as soon as their inputs land)
```
Suggested staffing: 3 agents in parallel. Agent 1 lanes A, B, C (task types, sections, Breakdown); agent 2 lanes D, E (assets, Data, reports); agent 3 lanes F, G, H, I (on hold, export, views, page fixes, tests). Critical path: PV-16 (size and index rule) -> PV-18 -> PV-19, and PV-01 -> PV-04 -> PV-06 -> PV-07.

## 4. Honest estimate

Nominal 199 agent-hours. Earlier epics of this size ran 15 to 25 percent over once review rounds and CI fixes are counted, so plan **230 to 250 agent-hours**. With three agents in parallel that is about **80 to 95 hours of elapsed agent time** (waves overlap; W4 verification is partly serial). The three heaviest unknowns: the report engine plan on 100,000 index rows (PV-22, PV-36), the lift of the Dashboard charts into a shared lazy module without visual change (PV-23), and the accessibility of the Breakdown matrix on a phone (PV-11, PV-38).

Cut line if the owner wants a smaller first release (about 120 h): PV-01 to PV-11 (icons, sections, Focus, Breakdown), PV-13 to PV-19 (disposition, size, Data), PV-25 and PV-26 (on-hold reason), PV-36 to PV-38; defer the report builder (PV-21 to PV-24, 29 h), export and views (PV-28, PV-29), turnaround (PV-27) and PV-30 to PV-35.

## 5. Definition of done (every package)

1. Requirements and acceptance criteria of the issue met; `dotnet build -warnaserror`, `dotnet test` (unit and integration), `dotnet format --verify-no-changes`, Angular `npm test`, `npm run lint`, `npm run format:check`, `npm run build` green.
2. OpenAPI (`contracts/openapi`) and the generated client in sync; `validate-contracts.mjs` passes; permissions in contracts, backend and frontend in step.
3. Module boundaries intact (architecture tests); new module code registered only if a module is added (none planned).
4. Every new endpoint passes `IMatterVisibility` / `IManagedMatterScope`, is in the sensitive-matter catalog and persona walk, and has a parity test where it aggregates.
5. SQL: numbered script (next free number), immutable once merged, replayable from empty, `db/report-access.json` and GRANT/DENY for new tables, report-access tests green.
6. Frontend: lazy tab or route, no static import of the api-client or lookup-store in eager shell code, **initial bundle under 700 kB** (629.21 kB at the base) with each new chunk listed in the build output.
7. Accessibility: axe 0 at 1920x1080, 1366x768, 768x1024 and 375x812; keyboard-only path; no sideways page scroll; charts have Show as table; colour never the only signal.
8. Shell contracts: page header, states (loading, empty, error, 403, 404), still-loading, document title `<Page>: <Tab> - <App name>`.
9. No new or changed keyboard shortcuts (#420).
10. Demo seed and e2e fixtures cover the feature (PV-17); screenshots at four sizes attached to the evidence document of PV-38.
11. Commit title `WP-PV <title>` with a paragraph starting "In plain words:", plain `#n` references (never closing keywords) and the standard trailers.
