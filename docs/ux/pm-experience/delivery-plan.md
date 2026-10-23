# Project Manager experience: delivery plan

Date: 2026-10-23, base `origin/dev`. Source: `README.md` in this folder. Structure on GitHub: one epic **#758** (labels `epic` + `phase-21`) with 29 sub-issues #759 to #787. Extends epic #667 (built); nothing there is redone.

Effort is in **AI-agent hours** (wall-clock of one developer agent, with unit, integration, e2e, axe and screenshots). Total **117.0 hours** in 29 issues.

## 1. Dependencies on other epics

| Epic | Needed for | Rule |
|---|---|---|
| #667 Project Manager role and My Matters (built) | Everything: page, scope helper, health, activity marker, bulk API | Extend, never duplicate |
| #753 Notifications | Deep links to the matter (#783); no new events here | #783 only verifies and fixes links; if #753 is not on dev, the check waits |
| #671 Reports | Starter reports (#784) and the Reports menu item (#775) | Both wait; the menu item is added by a one-line change when #671 lands |
| Sensitive matters epic (separate, being designed; number to be added here) | Shared visibility rule | #760 builds the seam with a no-op hook and a guard test; when the epic lands the rule is plugged in at that one place. No PM issue may bypass the seam |
| #420 Phase 2 shortcuts | none | No new or changed shortcut anywhere |

## 2. Issue list

| # | ID | Title | Agent-h | Depends on | Package | Lane |
|---|---|---|---|---|---|---|
| #759 | PX-01 | Test data for the PM scope: PMs with 3 / 40 matters, sensitive-ready matters, assets and clients on managed and unmanaged matters | 2 | None | WP-PX1 | B |
| #760 | PX-02 | Shared scope rule (backend): 'matters managed by me' resolved once, with the visibility-rule seam for sensitive matters | 3 | #759 | WP-PX1 | B |
| #761 | PX-03 | Assets list: filter 'linked to matters managed by me' (matterManagedByMe, role) and scope | 3 | #760 | WP-PX1 | B |
| #762 | PX-04 | Clients and Projects lists: filters 'linked to matters managed by me' (matterManagedByMe, role) | 4.5 | #760 | WP-PX1 | B |
| #763 | PX-05 | Global search: results outside my matters carry an 'inMyMatters' flag | 3.5 | #760 | WP-PX1 | B |
| #764 | PX-06 | Permissions and starter roles: remove Dashboard permissions from the Project Manager role, Report grants, grant script | 2.5 | None | WP-PX1 | B |
| #765 | PX-07 | My Matters deadlines by matter: 2 to 4 week range with per-day and per-matter grouping | 3 | #760 | WP-PX2 | C |
| #766 | PX-08 | My Matters workload: who is away in the next 4 weeks and per-person open load by matter | 3 | #760 | WP-PX2 | C |
| #767 | PX-09 | My Matters trends: overdue over time, created vs closed per week, average task age, on hold | 5.5 | #760 | WP-PX2 | C |
| #768 | PX-10 | My Matters activity: 30 days, filter by matter and kind, and the 'Since your last visit' summary | 4.5 | #760 | WP-PX2 | C |
| #769 | PX-11 | Matter overview endpoint: counts by status, next five deadlines, people working, linked assets, recent activity, health with reasons | 5 | #760 | WP-PX2 | B |
| #770 | PX-12 | Performance: query budget for scoped lists, trends, deadlines, workload, activity and matter overview at 200 matters | 3 | #761, #762, #763, #765, #766, #767, #768, #769 | WP-PX2 | C |
| #771 | PX-13 | Scope service and 'My matters / All' switch component (remembered, permission-gated) | 4 | #760 | WP-PX3 | A |
| #772 | PX-14 | Matters list and Task Queue open scoped to my matters | 3.5 | #771 | WP-PX3 | A |
| #773 | PX-15 | Assets, Clients and Projects lists open scoped to my matters | 5 | #771, #761, #762 | WP-PX3 | A |
| #774 | PX-16 | Search: small 'Not in your matters' label on results outside the PM's matters | 2.5 | #763 | WP-PX3 | A |
| #775 | PX-17 | Compact menu for the Project Manager: My Matters, Matters, Tasks, Assets, Reports, search | 3 | #764 | WP-PX3 | A |
| #776 | PX-18 | My Matters tab shell: Overview, Deadlines, Workload, Trends, Activity (lazy routes, URL state) | 3.5 | #771 | WP-PX4 | C |
| #777 | PX-19 | Overview tab: 'Since your last visit' summary | 3 | #776, #768 | WP-PX4 | C |
| #778 | PX-20 | Deadlines tab: 2 to 4 week calendar and list, by matter | 4.5 | #776, #765 | WP-PX4 | C |
| #779 | PX-21 | Workload tab: open work per person on my matters, who is away | 4 | #776, #766 | WP-PX4 | C |
| #780 | PX-22 | Trends tab: overdue over time, created vs closed per week, average task age, on hold | 5.5 | #776, #767 | WP-PX4 | C |
| #781 | PX-23 | Activity tab: what changed since I last looked, filters, mark as read | 4 | #776, #768 | WP-PX4 | C |
| #782 | PX-24 | Matter record Overview tab enriched (reverses 'no per-matter dashboards') | 6 | #769 | WP-PX5 | B |
| #783 | PX-25 | Quick actions per matter row/page: + New task, bulk, add a comment, open the matter's tasks; notification deep links | 6 | #772, #782 | WP-PX5 | B |
| #784 | PX-26 | Starter Reports for the Project Manager role: 'Open and overdue tasks by matter', 'Tasks completed this month' | 3 | #764 | WP-PX5 | R |
| #785 | PX-27 | Phone and tablet layouts, accessibility and permission matrix for all new PM views; bundle check | 4 | #772, #773, #774, #775, #777, #778, #779, #780, #781, #782, #783 | WP-PX6 | A |
| #786 | PX-28 | Docs and final verification: ux-spec, UAT rows, e2e catalogue, runbook note, decisions status, full verification pass for the PM role | 5 | #785, #770, #784 | WP-PX6 | A |
| #787 | PX-29 | PM experience review with screenshots at four widths (four day-in-the-life scenarios) | 8 | #786 | WP-PX6 | A |

Total: **117.0 agent-hours**.

## 3. Work packages

| Package | Issues | Agent-h |
|---|---|---|
| WP-PX1 Backend foundations: scope seam, filters, permissions | #759, #760, #761, #762, #763, #764 | 18.5 |
| WP-PX2 My Matters and matter APIs | #765, #766, #767, #768, #769, #770 | 24.0 |
| WP-PX3 Scope switch, scoped lists, search label, compact menu | #771, #772, #773, #774, #775 | 18.0 |
| WP-PX4 My Matters tabs | #776, #777, #778, #779, #780, #781 | 24.5 |
| WP-PX5 Matter overview, quick actions, starter reports | #782, #783, #784 | 15 |
| WP-PX6 Quality, docs, review | #785, #786, #787 | 17 |

## 4. SQL scripts

Needed: **one data script** (#764, starter-role Dashboard removal, idempotent, never edits a merged script). **Conditional**: an index script from the measurement in #770, and `dbo.MatterDailyStats` only if trends miss their budget (#767/#770). Starter reports (#784) use the Reports seed mechanism. Next free number at implementation time; no EF migrations.

## 5. Lanes and waves

Lanes are file owners: one agent owns one lane's files for the whole epic.

- **Lane A (35.0 h)**: Shell and scope UI (owns shared/scope, nav-items, list pages, search label, tests, docs): #771, #772, #773, #774, #775, #785, #786, #787.
- **Lane B (35.5 h)**: Backend foundations and matter record (owns scope seam, Assets/Clients/Projects filters, permissions, matter overview API and page): #759, #760, #761, #762, #763, #764, #769, #782, #783.
- **Lane C (43.5 h)**: My Matters (owns WorkViews MyMatters* queries and features/my-matters): #765, #766, #767, #768, #770, #776, #777, #778, #779, #780, #781.
- **Lane R (3 h)**: Reports (starter reports; waits for #671): #784.

Waves (each wave starts when its dependencies are merged on `dev`):
- **Wave 0**: #759, #760, #764 (fixtures, scope seam, permissions).
- **Wave 1** (parallel): backend #761, #762, #763, #765, #766, #767, #768, #769; frontend #771 (switch), #775 (menu).
- **Wave 2**: #770 (performance), #772, #773, #774, #776 (tab shell), #782 (matter overview), #784 (reports, when #671 is on dev).
- **Wave 3**: tabs #777, #778, #779, #780, #781; #783 (quick actions and links).
- **Wave 4**: #785 (phone, a11y, matrix, bundle), #786 (docs and verification).
- **Wave 5**: #787 (PM experience review with screenshots, about 8 agent-hours, after the implementation).

Critical path: #760 > #771 > #776 > tabs > #785 > #786 > #787. With three parallel agents (A, B, C) the build is about two thirds of the total hours on the calendar.

## 6. Definition of done (every issue and the epic)

- Acceptance criteria met; unit + integration + e2e green (twice), including permission variants (Project Manager, PM without `Task.View`, PM without `Asset.View`, holder of `Matter.AssignManagers`, Director, technician, System Admin).
- axe 0 violations and no page-level horizontal scroll at 1366x768, 1920x1080, 768x1024 and 375x812; keyboard-only flows with existing keys only; **no new or changed shortcut** (#420).
- Every new view, filter and endpoint calls the shared matter-visibility rule (#760); an integration test proves a matter hidden by the Sensitive matters rule is absent from counts, lists, search and trends once that epic is on dev.
- Counts equal the lists they open (strip, tab buckets, matter overview).
- Initial bundle under 700 kB; new tabs, charts and pages lazy; chunk sizes in the PR.
- `dotnet build -warnaserror`, `dotnet format --verify-no-changes`, Prettier and lint clean; OpenAPI and nswag regenerated, drift check clean; permission lists in step with `contracts/permissions.json`.
- Performance: budgets of #770 met at 200 matters.
- Docs updated (#786); decisions addendum AK status current.
