# Notifications: delivery plan

Date of this plan: 2026-10-22, base `origin/dev`. Source: `README.md` in this folder (spec: 8 events, panel, page, polling API, data model, security, accessibility, preferences, retention, test plan, open questions). Decisions: `docs/requirements/decisions-addendum.md` section AH.

**Binding owner decisions.** (1) Bell in the header with unread count, panel of recent items, `/notifications` page, polite live region, name "Notifications, n unread", no sound. (2) The client polls every 30 seconds; no email, Teams, browser push or sounds in this release; a daily digest email is a possible later feature and its design stays open. (3) Notifications are created by the server in the same transaction as the action; recipients only; never the actor; permission re-checked on read. (4) Eight first-release events (technician 1 to 3, project manager 4 to 7, pod lead 8). (5) A "Notifications" section on My profile, one switch per event type, all on by default; read notifications are deleted after about 90 days. (6) New `Notification` table through a new numbered SQL script (next free number at implementation time). (7) No new or changed keyboard shortcuts (Phase 2, #420). (8) Initial bundle under 700 kB: the bell is lazy; eager shell code never statically imports the generated API client or the lookup store.

Structure on GitHub: one epic **#753** (labels `epic` + `phase-17`) and 24 sub-issues **#729 to #752** (label `phase-17`, contiguous, in the order of the table), tick-list in the epic body. The epic and issue numbers are in the table. Effort is in **AI-agent hours** (wall-clock of one developer agent including unit, integration, e2e, axe and screenshots). The owner's guess was 35 to 45 hours; this plan is **53** because there is no background-job infrastructure to reuse (scheduler, applock, IIS keep-alive, retention: 8.5 h), the mention feature does not exist (5 h, cuttable), and the e2e/axe/performance pass and final verification are explicit (5.5 h). Without the mention issue the plan is **48**; if events 4 to 7 wait for the Project Manager role epic, the rest (about 41 h) can still ship.

## 1. Issue list

| # | ID | Title (short) | Agent-h | Depends on | Package |
|---|---|---|---|---|---|
| #729 | NT-A1 | SQL script: `Notification` and `NotificationPreference`, indexes, grants (next free script number) | 1.5 | None. First. | WP-NT1 |
| #730 | NT-A2 | Notifications module, Contracts (`INotificationPublisher`), recipient rules, composition, architecture tests | 2.5 | NT-A1 | WP-NT1 |
| #731 | NT-A3 | Object visibility port (permission re-check on read) | 2 | NT-A2 | WP-NT1 |
| #732 | NT-A4 | API: list, mark read, mark all read | 2.5 | NT-A2, NT-A3 | WP-NT1 |
| #733 | NT-A5 | API: poll endpoint (unread count, since cursor, ETag/304) | 2 | NT-A4 | WP-NT1 |
| #734 | NT-A6 | API: notification preferences, honoured at creation | 1.5 | NT-A2 | WP-NT1 |
| #735 | NT-B1 | Event 1: task assigned to you | 1.5 | NT-A2 | WP-NT2 |
| #736 | NT-B2 | Event 3a: comment on your task | 1.5 | NT-A2 | WP-NT2 |
| #737 | NT-B3 | Event 3b: @mention in comments (composer picker and notification) | 5 | NT-B2 | WP-NT2 |
| #738 | NT-B4 | Event 5: new task on your matter (project manager) | 1 | NT-A2; Project Manager role epic | WP-NT2 |
| #739 | NT-B5 | Event 7: you were set as a matter's Primary or Secondary manager | 1 | NT-A2; Project Manager role epic | WP-NT2 |
| #740 | NT-B6 | Event 8: task unassigned in your pod (pod lead) | 1.5 | NT-A2 | WP-NT2 |
| #741 | NT-C1 | Scheduler host: `BackgroundService`, applock, health, IIS always-running | 2.5 | NT-A2 | WP-NT3 |
| #742 | NT-C2 | Events 2 and 4: due within a day and overdue (idempotent) | 3 | NT-C1; event 4 needs the Project Manager role epic | WP-NT3 |
| #743 | NT-C3 | Event 6: task unassigned or on hold for a while | 2 | NT-C1; Project Manager role epic | WP-NT3 |
| #744 | NT-C4 | Retention: delete read notifications after 90 days | 1 | NT-C1 | WP-NT3 |
| #745 | NT-D1 | Lazy bell, poller and store; bundle guard | 3.5 | NT-A5 (OpenAPI) | WP-NT4 |
| #746 | NT-D2 | Notification panel (desktop popover, phone sheet) | 4 | NT-D1 | WP-NT4 |
| #747 | NT-D3 | Live region and bell accessible name | 1 | NT-D1 | WP-NT4 |
| #748 | NT-D4 | `/notifications` page: list, read/unread filter, paging | 3.5 | NT-A4, NT-D1 | WP-NT4 |
| #749 | NT-D5 | My profile "Notifications" section: one switch per event | 2 | NT-A6 | WP-NT4 |
| #750 | NT-E1 | End-to-end, axe, permission matrix and performance pass | 3.5 | All code issues | WP-NT5 |
| #751 | NT-E2 | Docs: ux-spec, UAT rows, decisions AH close-out, e2e catalogue, runbook | 1.5 | All code issues | WP-NT5 |
| #752 | NT-E3 | Final verification pass | 2 | All issues | WP-NT5 |

Total: **53 agent-hours** (24 issues). Packages: WP-NT1 12, WP-NT2 11.5, WP-NT3 8.5, WP-NT4 14, WP-NT5 7.

## 2. Decisions (PM) in one place

- **Source of events.** New `Notification` rows written by a publisher called from the commands (create path) and by a scheduler (time-based). The audit log and task Activity are not reused (compliance record, no recipients).
- **New module** `MatterFlow.Notifications` with a `.Contracts` project; other modules call only `INotificationPublisher`. Same transaction as the action (the publisher adds to the open unit of work).
- **Endpoints** under `/me/notifications` (no new permission; `contracts/permissions.json` unchanged); bell shown with `Task.View`.
- **Polling** every 30 s plus jitter, cheap `poll` endpoint with ETag/304 and `sinceId` cursor; pause when the tab is hidden or the shell shows offline; errors never toast.
- **Preferences** stored sparsely (only "off" rows), applied at creation.
- **Idempotency** by a unique key (recipient, event type, object, dedupe key) with the due date or state-change time in the key.
- **Scheduler** is a new `BackgroundService` (nothing like it exists), 5-minute tick, `sp_getapplock`, IIS keep-alive configured in `deploy/`.
- **No toast, no sound, no title flashing** for new items; badge and polite live region only.
- **Out of scope.** Email and daily digest, Teams, browser push, sounds, "Mark as unread", coalescing of bursts (Q2), unread count in the tab title (Q6), shortcuts (#420), per-matter or per-task watch lists, notification of external parties.

## 3. Work packages (ranked)

Rules for developer agents: branch from `origin/dev`, rebase before each push, touch only the files of your package unless the issue says otherwise, regenerate OpenAPI and the client (nswag) when the API changes (never hand-merge), no new or changed keyboard shortcut, never statically import the generated API client or the lookup store from eager shell code.

| Rank | WP | Issues | Main files / areas | Agent-h | Parallel with | Waits for | Backend / SQL |
|---|---|---|---|---|---|---|---|
| 1 | WP-NT1 Foundation and API | NT-A1 to NT-A6 | new SQL script, new `MatterFlow.Notifications*` projects, `ModuleComposition.cs`, `contracts/openapi/v1.json` | 12 | WP-NT3 (after NT-A2) | NT-A1 first | **Backend and one new SQL script** |
| 2 | WP-NT2 Create-path events | NT-B1 to NT-B6 | `MatterFlow.WorkManagement` command handlers (one call each), Organization/Pods lookups, comment composer (NT-B3) | 11.5 | WP-NT3, WP-NT4 | NT-A2; NT-B4/B5 wait for the Project Manager role epic | Backend (NT-B3 also frontend) |
| 3 | WP-NT3 Scheduler and retention | NT-C1 to NT-C4 | new `Notifications.Infrastructure/Scheduling`, `deploy/` publish scripts, health check | 8.5 | WP-NT2, WP-NT4 | NT-A2; NT-C2/C3 event 4 and 6 wait for the Project Manager role epic | Backend, deploy scripts |
| 4 | WP-NT4 Frontend | NT-D1 to NT-D5 | new `shared/layout/notification-bell.ts` (tiny, eager), `features/notifications/*` (lazy), `features/profile/*` (section), `user-menu.ts` untouched | 14 | WP-NT2, WP-NT3 | NT-A5 contract in OpenAPI before NT-D1; NT-A4 before NT-D4; NT-A6 before NT-D5 | none |
| 5 | WP-NT5 Verification and docs | NT-E1 to NT-E3 | e2e specs, `docs/ux/*`, `docs/requirements/decisions-addendum.md`, `docs/qa/e2e.md`, runbook | 7 | none (late) | all | none |

### Waves for 3 parallel developer agents

Lanes are file owners: lane A owns the Notifications backend module and the OpenAPI file, lane B owns the scheduler and the comment-related work, lane C owns the frontend.

- **Wave 1**
  - Lane A (10.5 h): NT-A1, NT-A2, NT-A3, NT-A4, NT-A5 (publish OpenAPI after NT-A5 so lane C can start; lane C may use a mock server earlier)
  - Lane B (2.5 h): NT-C1 (after NT-A2)
  - Lane C (3.5 h): NT-D1
- **Wave 2**
  - Lane A (8 h): NT-A6, NT-B1, NT-B2, NT-B6, NT-B4, NT-B5
  - Lane B (11 h): NT-C2, NT-C3, NT-C4, NT-B3
  - Lane C (10.5 h): NT-D2, NT-D3, NT-D4, NT-D5
- **Wave 3 (verification)**
  - Lane A (3.5 h): NT-E1
  - Lane B (1.5 h): NT-E2
  - Lane C (2 h): NT-E3

Lane totals: A 22 h, B 15 h, C 16 h (53 in all, wave 3 split for convenience). With three agents the wall-clock is about **26 hours**; one agent alone needs 53; with two agents (fold lane B into A and C) about 30 hours.

### Critical path

NT-A1 1.5, NT-A2 2.5, NT-A3 2, NT-A4 2.5, NT-A5 2, then then the frontend lane NT-D1 3.5 (can start on a mock before NT-A5 ends), NT-D2 4, NT-D3 1, NT-D4 3.5, NT-D5 2 and NT-E3 2 = about 26 hours (lane C is the critical lane once the API exists).

### Hot spots (merge-conflict watch)

- **`contracts/openapi/v1.json` and the TS client**: NT-A4, NT-A5, NT-A6 (and NT-B3 if it adds an endpoint) in this order; other epics regenerate too: rebase and regenerate, never hand-merge.
- **`ModuleComposition.cs`, `Directory.Packages.props`**: NT-A2 only.
- **`shared/layout/app-shell.html` / `app-shell.ts`**: one slot for the bell next to the user menu (NT-D1); the Profile epic owns `user-menu.ts` and the App shell epic owns the page-header contract: keep the edit to a single added element and a lazy import.
- **Task command handlers** (assign, create, comment, unassign, hold): NT-B1, NT-B2, NT-B4, NT-B6 each add one publisher call; Work Management epics also edit them; keep the change minimal.
- **Database script number**: take the next free number when NT-A1 starts; scripts are immutable once merged.
- **`frontend/src/app/shared/layout/initial-bundle.spec.ts`**: not edited; it already scans every `shared/layout/*.ts` file.

### Extension points

- **Event catalogue.** One enum plus one message builder per event, a recipient resolver and a preference group: a new event is a small additive change (a daily digest later would read the same table).
- **Poll contract.** `items` and `unreadCount` are the only consumer surface; an SSE/WebSocket transport could replace polling without changing the store.

### Definition of done per issue and for the epic

- Acceptance criteria met; unit, integration and e2e tests added and green (twice), including permission variants (a person who may view the object, one who may not, the actor, a person with the switch off).
- axe: 0 violations (WCAG 2.2 AA plus best practice) at 1366x768, 1920x1080, 768x1024 and 375x812, with the panel open; no page-level horizontal scroll.
- Keyboard-only flows work with the existing keys only (Tab, Enter, Esc); no new or changed shortcut.
- Initial bundle under 700 kB and not more than 4 kB above the baseline at merge; the bell chunk lazy; `initial-bundle.spec.ts` green.
- OpenAPI and TS client regenerated (additive), `validate-contracts.mjs` green, architecture tests green, `dotnet build -warnaserror`, format and lint checks pass.
- SQL: only the new numbered script, no EF migrations, grants included.
- Screenshots (panel, page, profile section at the four sizes) under `docs/ux/notifications-review/fixes/<package>/`.
- Docs updated per NT-E2; final pass NT-E3.

### Docs package (NT-E2)

`docs/ux/ux-spec.md` gets a Notifications section (bell, panel, page, profile section, copy deck of the 11 messages), UAT rows, section **AH** of the decisions closed out with issue numbers, the e2e catalogue, `docs/architecture.md` (new module, scheduler, polling contract) and the runbook (IIS keep-alive, health check, retention).

### Final verification package (NT-E3)

Contract e2e over the full flow with two users at four sizes, scheduler idempotency run twice, retention dry run, permission loss test, performance numbers, bundle size, and the open questions Q1 to Q8 of the README recorded as answered or deferred.

## 4. Status

(One line per work package; keep other packages' lines when merging. Format: `WP name (date, commit): issues done / open; tests; bundle size; screenshots folder; known limits.`)

- Planning (2026-10-22): epic #753 and 24 sub-issues #729 to #752 created; no code started. Open questions for the owner: README section 14 (Q1 mentions scope is the main one). Events 4 to 7 depend on the Project Manager role epic #667.
- WP-NT1 Foundation and API (2026-10-22, 5af2e0e): #729 to #734 done (script `29-notifications.sql`, module `MatterFlow.Notifications` + `.Contracts`, visibility port `IObjectVisibility`, `/me/notifications` list, read, read-all, poll with ETag/304, `/me/notification-preferences`); unit, schema and Testcontainers integration tests green; poll p95 53 ms with 100,000 rows; no bundle change (backend only); no screenshots (no UI); known limits: endpoints need `Task.View` (a user without it gets 403, not an empty list), the 28 number was taken by the matter-manager script so this epic uses 29.
- WP-NT2 Create-path events (2026-10-22, ebcf640): #735 (task assigned), #736 (comment on your task) and #740 (task unassigned in your pod) done; #737 mentions deferred by the owner; #738 and #739 wait for the Project Manager epic. Pod leads are the pod members who hold the active role named "Pod Lead".
