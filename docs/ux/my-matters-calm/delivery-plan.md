# My Matters, a calmer page: delivery plan

Date 2026-10-27, base `origin/dev` (`e2dd52e`). Source: `README.md` in this folder (findings F-01 to F-26, measurements, mock-ups). Epic **#893** (label `phase-24`), 9 issues filed by the owner (#894 to #902) plus 23 from this review (#903 to #925). Status: **planned, not started** (the owner's order stays: Application settings #850, Impersonation #828, Reports #671 first, unless the owner moves this epic up). **Everything below is a proposal until the owner decides (addendum AO).**

Effort is in agent-hours (wall-clock of one developer agent, with unit, integration, e2e, axe and screenshots). Total **89.0 hours** in 32 issues: 24.0 (owner's first review) + 65.0 (this review).

## 1. Rules for every issue

* Frontend only except where an issue says otherwise (MM-12 may add the ranked order to `GET /my-matters/attention` or do the ranking in the client; decide in the issue). No new SQL script is needed; none is claimed.
* No new or changed keyboard shortcuts (#420). Initial bundle stays under 700 kB (the tabs are lazy already). Contracts: if an API changes, `contracts/openapi` and the generated client move together.
* Every issue ends with: unit tests, the e2e spec of the page updated (`mm-controls-tabs.spec.ts`, `px5`, `pv-*` as needed), axe at four widths and phone, screenshots at 1366x768, 1920x1080, 768x1024, 375x812 into `docs/ux/my-matters-calm/after/` (same file names as `before/`), counts in the strip still equal the Task Queue totals.
* The shared pieces are built once: **Options menu** (#894), **segmented toggle** (#919), **shared task row** (#897, #901), **info point** (#914), **empty line** (#920), **error banner** (#921). Issues that use a shared piece say so; build the piece in the first issue that needs it.

## 2. Issue list with dependencies and release

| # | ID | Title | Agent-h | Depends on | Release | Package |
|---|---|---|---|---|---|---|
| #925 | MM-32 | Demo data: one-matter PM, at-risk and aged on-hold tasks | 2.0 | none | 1 (step 0) | WP-MM0 |
| #904 | MM-11 | Title block: no description, one create-task button | 1.0 | none | 1 | WP-MM1 |
| #920 | MM-27 | Empty states one line | 2.0 | none | 1 | WP-MM1 |
| #906 | MM-13 | Show a filter only when it can filter | 2.0 | none | 1 | WP-MM1 |
| #923 | MM-30 | Phone defect: squeezed on-hold title | 1.0 | none | 1 | WP-MM1 |
| #895 | MM-02 | Since your last visit: one line when nothing changed | 1.5 | #909 (same block) | 1 | WP-MM2 |
| #909 | MM-16 | One "what changed" block | 3.0 | none | 1 | WP-MM2 |
| #902 | MM-07 | Count strip as clear chips | 3.0 | none | 1 | WP-MM2 |
| #905 | MM-12 | Needs my attention: one ranked list | 4.5 | none | 1 | WP-MM2 |
| #908 | MM-15 | Matter health: hide for one, graded for several | 4.5 | none | 1 | WP-MM2 |
| #896 | MM-03 | No repeats (Next 7 days) | 3.0 | #905 | 1 | WP-MM2 |
| #894 | MM-01 | One Options menu | 5.0 | none (builds the shared Options) | 1 | WP-MM3 |
| #897 | MM-04 | Lighter rows (builds the shared row) | 4.0 | #905 | 1 | WP-MM3 |
| #903 | MM-10 | Overview calm layout, one column, budget | 4.0 | #905, #908, #909, #896 | 1 | WP-MM3 |
| | | **Release 1 subtotal** | **40.5** | | | |
| #919 | MM-26 | One toggle pattern, plain labels | 1.5 | none (builds the segmented toggle) | 2 | WP-MM4 |
| #898 | MM-05 | Clear sort | 2.0 | #894 | 2 | WP-MM4 |
| #899 | MM-06 | Filter wording and label style | 2.0 | #906 | 2 | WP-MM4 |
| #900 | MM-08 | Header buttons, matter chooser | 2.0 | #904 | 2 | WP-MM4 |
| #901 | MM-09 | Same right-hand pattern | 1.5 | #897 | 2 | WP-MM4 |
| #918 | MM-25 | Eye-catch: headline, colour/link/pill budget | 4.0 | #897, #902 | 2 | WP-MM4 |
| #921 | MM-28 | Loading and error: one Retry | 2.0 | #903 | 2 | WP-MM5 |
| #922 | MM-29 | Phone first screen | 3.5 | #903, #902 | 2 | WP-MM5 |
| #924 | MM-31 | Calm budget test, after-screenshots | 3.0 | Release 1 landed | 2 | WP-MM5 |
| | | **Release 2 subtotal** | **21.5** | | | |
| #907 | MM-14 | One task-type filter (Focus) (owner decision Q2) | 2.5 | #894, Q2 | 3 | WP-MM6 |
| #910 | MM-17 | Deadlines tab | 3.0 | #906, #894 | 3 | WP-MM6 |
| #911 | MM-18 | Breakdown simplified | 3.0 | #894, #919 | 3 | WP-MM6 |
| #912 | MM-19 | Breakdown on a phone | 2.0 | #911 | 3 | WP-MM6 |
| #913 | MM-20 | Data tab: one summary, one table | 4.0 | #894 | 3 | WP-MM7 |
| #914 | MM-21 | Data tab: warnings, info point, volume | 2.5 | #913 | 3 | WP-MM7 |
| #915 | MM-22 | Activity: day groups, per-task fold | 4.5 | #894 | 3 | WP-MM7 |
| #916 | MM-23 | Activity: names, dates, filters in Options | 2.5 | #915 | 3 | WP-MM7 |
| #917 | MM-24 | Trends slimmer | 3.0 | none | 3 | WP-MM7 |
| | | **Release 3 subtotal** | **27.0** | | | |
| | | **Epic total** | **89.0** | | | |

## 3. Order and lanes

Each lane is one agent working one package at a time (two lanes run in parallel without touching the same files).

* **Step 0** (any time before Release 1, 2.0 h): #925 so every later issue can be checked with realistic data (at risk, aged on hold, one-matter and three-matter PM).
* **Lane A (Overview content):** #909 + #895 (the "what changed" block), #905, #896, #908, #902, #903.
* **Lane B (chrome and controls):** #904, #906, #920, #923, #894 (Options; do it before #897 so rows and toolbars are built once), #897.
* Release 1 ends with a measurement run (the `metrics.mjs` of this review) and the after-screenshots; the owner looks at the 1366x768 Overview for both personas and says what they see first (acceptance for #918's three-second test).
* **Release 2** polishes: shared toggle, sort, wording, colour budget, phone, error and loading, then the budget test (#924), whose numbers are set from the Release 1 result (proposed: first task row at most 300 px desktop and 420 px phone, at most 25 controls and 150 words on the first screen, no repeated task id).
* **Release 3** takes the tabs in the order of what the PM opens most: Deadlines (#910), Activity (#915, #916), Breakdown (#911, #912), Data (#913, #914), Trends (#917), with #907 after the owner's answer to Q2.

## 4. Per-issue measurable target

| Issue | Measure before | Target after |
|---|---|---|
| #903 + Release 1 | first task row 569 px; Overview 1,678 / 2,599 px; 84 controls and 384 words on the first screen | 250 to 320 px; about 700 / 1,100 px; about 25 controls, about 120 words |
| #905 | Needs my attention 1,339 px (3+ matters), 3 repeats | at most 420 px, no repeat |
| #908 | 390 px for one matter, all Red | no card for one matter; graded chips for several |
| #909 | 158 + 367 px, same 5 events twice | one line or nothing |
| #906 | 53 px bar on every tab | 0 px for one matter and one client |
| #920 | empty Overview 78 controls, 320 words | one line of content |
| #921 | 6 Retry buttons for one failure | 1 |
| #922 | first task at 1,021 / 1,069 px on a phone | at most 420 px, two rows visible |
| #911, #912 | Breakdown 75 controls; phone 2,153 px | 15 controls; at most 1,100 px |
| #913, #914 | Data 484 words, 78 controls | at most 250 words |
| #915 | 25 two-line events | at most 12 one-line rows for the same period |
| #917 | Trends 449 words, flat chart | at most 250 words, no flat chart |

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Removing things people got used to (PM v2 is not deployed; nobody uses it, CLAUDE.md status of 2026-10-24) | No migration needed; remembered per-list choices are ignored; this is the cheapest moment to simplify. |
| Hiding a filter or section makes the page differ between people | Every hidden control has a stated rule (one client, one matter, no data), a chip shows any remembered filter that is not visible, and the rule is in the issue. |
| Strip counts vs lists (a list hides a task shown above it) | The "View all N" always opens the full filtered Task Queue, and e2e keeps strip = grid total. |
| Reversing the owner's PM v2 choices (per-list task type filter, Matter health flag) | Both are open questions Q2 and Q3; #907 waits for the answer. |
| New shared components grow the initial bundle | They are used by lazy tabs; the existing bundle check (700 kB) stays in CI. |
| Layout drift after the cut | #924 budget test. |

## 6. Verification

Per issue as in section 1. For the epic: re-run `docs/ux/my-matters-calm/before/stageA.mjs` (copy it as `after/`) on the same personas, fill a before and after table in the README, add the after-screenshots, and record evidence in `docs/qa/` as other epics do. Final verification is a separate issue created when Release 3 is done (as for PM v2, #890).
