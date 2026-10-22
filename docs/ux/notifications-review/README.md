# Notifications: review and specification (bell, panel, page, events, preferences)

Status: proposal for implementation, written 2026-10-22 on `origin/dev`. Docs only; no application code was changed or run. Plan and issue list: `delivery-plan.md` in this folder. Decisions: `docs/requirements/decisions-addendum.md` section AH. Epic: "Epic: Notifications (bell, panel, events, preferences)".

## 1. Owner decisions (binding)

1. A bell in the header next to the user menu with an unread count. Click opens a panel of recent notifications, newest first. Each item: one-line message, time, unread dot, link to the task or matter. Clicking an item marks it read. "Mark all as read". A link to the full page `/notifications` (list, read/unread filter, paging).
2. Accessibility: a polite live region announces new items; the bell's accessible name is "Notifications, n unread"; no sound.
3. Delivery: the client polls every 30 seconds. No email, no Teams, no browser push, no sounds in this release. A daily digest email is a possible later feature; the design stays open and is not in scope.
4. The server creates a notification in the same transaction as the action that causes it. Recipients only. The person who made the change is never notified. A person sees only notifications for objects they may still view (permission re-checked on every read).
5. First-release events (8, all approved): see section 3.
6. Preferences: a "Notifications" section on My profile with one switch per event type, all on by default.
7. Housekeeping: read notifications are deleted after about 90 days.
8. Data: a new `Notification` table through a new numbered SQL script (the next free number at implementation time; scripts 28 and later may be taken by other epics). Scheduled events (overdue and similar) need a background job.
9. No new or changed keyboard shortcuts (Phase 2, issue #420). The initial bundle must stay under 700 kB (about 607 kB now); the bell is lazy-loaded and eager shell code never statically imports the generated API client or the lookup store (`frontend/src/app/shared/layout/initial-bundle.spec.ts`).

## 2. What exists today (facts found on dev)

- There is **no notification surface** (My Work M12.5 "Since your last visit" was decided "not built (no notification surface)", issue #168). This epic is that surface.
- There is **no background job infrastructure**: no `BackgroundService`, `IHostedService` or scheduler exists in the backend. Schema migration deliberately runs before the host listens and "not in a hosted service" (`docs/architecture.md`). The nightly CI workflows are test runs, not application jobs. A scheduler is therefore new work (WP-NT3).
- The audit log (`AuditEvent`, append-only, written by `AuditSaveChangesInterceptor` in the same transaction) and the task Activity timeline (issues #316/#317: activity events carry the comment id and an 80-character excerpt) already record who changed what. They are **not** reused as the notification source: audit is a compliance record with redaction and no recipients; a notification is derived, per-recipient, mutable (read time) and deletable. The audit write is a good model for the "same transaction" pattern.
- Task `DueDate` is a DATE; `NULL` means ASAP and is never overdue (decisions addendum M, `db/scripts/12-tasks.sql`). `Task.AssignedAt` exists (script 20). Task comments exist (Comments tab). Pods exist (`04-pods.sql`) with members and a lead role.
- **Not found on dev**: the Project Manager role (`Matter.PrimaryManagerId`, `Matter.SecondaryManagerId`; no column in scripts 01 to 27, no epic found by title) and any @mention concept in comments. Events 3 (mention part), 4, 5, 6, 7 depend on them (section 13).
- Shell contracts to reuse (`docs/ux/shell-review/`): one toast host bottom right (#616), connection/offline banner with automatic retry (#611), page-header contract (#600), failed list load shown once inline with Retry and no toast (#613).

## 3. Events (first release)

Recipient rules apply to all: never the actor; only people who may view the object now; the person's preference switch for that event type is on; at most **one notification per person per action** (if two rules hit the same person for the same action, the higher in the priority column wins, for example a manager who is also the assignee gets "assigned to you" and not "new task on your matter").

| # | Event type (code) | Audience | Trigger (where) | Priority | Idempotency key (`DedupeKey`) |
|---|---|---|---|---|---|
| 1 | `TaskAssigned` | Technician (new assignee) | Task assigned or reassigned to a person other than the actor, including create-with-assignee (assign command, same transaction) | 1 | `assign:<AssignedAt ticks>` |
| 2 | `TaskDue` (two stages: `due-soon`, `overdue`) | Technician (assignee) | Scheduler: open task with a due date, due within 1 day (today or tomorrow) / past due | 2 | `soon:<DueDate>` and `overdue:<DueDate>`; a new due date re-arms |
| 3 | `TaskComment` / `TaskMention` | Technician (assignee for comment; mentioned person for mention) | A comment added to a task by another person / a comment naming the person | 3 | `comment:<CommentId>` |
| 4 | `MatterTaskOverdue` | Project manager (Primary or Secondary of the matter) | Scheduler: a task on the matter becomes overdue | 4 | `overdue:<TaskId>:<DueDate>` |
| 5 | `MatterTaskCreated` | Project manager | Task created on the matter by someone else (create command, same transaction) | 5 | `created:<TaskId>` |
| 6 | `MatterTaskStalled` (`unassigned`, `on-hold`) | Project manager | Scheduler: open task unassigned for 2 days / on hold for 5 days (constants, see open question Q3) | 6 | `unassigned:<last assignment change ticks>`, `hold:<hold start ticks>` |
| 7 | `MatterManagerSet` | The person set as Primary or Secondary manager | Matter manager changed to this person by someone else | 7 | `mgr:<MatterId>:<Role>:<ticks>` |
| 8 | `PodTaskUnassigned` | Pod Lead (leads of the task's pod) | Task becomes unassigned in a pod (created without assignee into a pod, or unassigned) by someone else | 8 | `unassigned:<TaskId>:<ticks>` |

Suppression rules: a task with no due date (ASAP) never produces events 2 or 4. Closed, completed or cancelled tasks produce no scheduled events. A task that was fixed before the scheduler runs (assigned again, due date moved, taken off hold) produces nothing. Event 4 is skipped when the same person already got event 2 for the same task and date (manager who is the assignee). Event 6 `unassigned` is not sent for a task the scheduler sees only seconds after event 8 reached the pod lead; they are different audiences and stages, and 6 waits 2 days.

### 3.1 Message wording

Messages are written by the server at creation time (a snapshot, English, at most 200 characters, no HTML), in plain sentences with the task number, a short title and the matter. The link is built by the client from `ObjectKind` and `ObjectId` (never from stored text).

| Event | Message |
|---|---|
| 1 | `Ann Lee assigned you T-1042 "Review privilege log" (Acme v. Smith).` |
| 2 soon | `T-1042 "Review privilege log" is due tomorrow (Oct 23).` (today: `is due today.`) |
| 2 overdue | `T-1042 "Review privilege log" is overdue (due Oct 20).` |
| 3 comment | `Ann Lee commented on T-1042: "Please re-run the search with the new terms..."` (excerpt 80 characters, same rule as Activity) |
| 3 mention | `Ann Lee mentioned you in T-1042: "...@Bo Chen can you confirm..."` |
| 4 | `T-1042 "Review privilege log" on Acme v. Smith is overdue (due Oct 20, assigned to Bo Chen).` (`not assigned` when none) |
| 5 | `Ann Lee created T-1051 "Load production volume 3" on Acme v. Smith.` |
| 6 unassigned | `T-1042 "Review privilege log" on Acme v. Smith has been unassigned for 2 days.` |
| 6 on hold | `T-1042 "Review privilege log" on Acme v. Smith has been on hold for 5 days.` |
| 7 | `Ann Lee made you Primary manager of Acme v. Smith.` (`Secondary manager`) |
| 8 | `T-1042 "Review privilege log" in Demo Processing Pod is unassigned.` |

Rules: person names are display names; titles longer than 60 characters are trimmed with an ellipsis; the actor of a system event (2, 4, 6) is never named; wording avoids "you must" (informational, not instructions).

## 4. Panel and page (ASCII mock-ups)

### 4.1 Header and bell (desktop)

```
+--------------------------------------------------------------------------------+
| MatterFlow   [ search ........................ ]  [+ Create task]  (bell 3)  Ann Lee v |
+--------------------------------------------------------------------------------+
```
The bell is an icon button (24 px glyph, 40 px target) left of the user menu with a count badge: 1 to 99, then "99+"; the badge is hidden at 0. The count is text inside the badge (never colour alone).

### 4.2 Panel (desktop, 380 px wide, anchored under the bell)

```
+--------------------------------------------+
| Notifications                Mark all as read |
+--------------------------------------------+
| (*) Ann Lee assigned you T-1042 "Review     |
|     privilege log" (Acme v. Smith).         |
|     5 min ago                               |
|--------------------------------------------|
| (*) T-1038 "Load volume 2" is due tomorrow  |
|     (Oct 23).                       1 h ago |
|--------------------------------------------|
|     Bo Chen commented on T-1019: "Please... |
|                                  yesterday  |
|--------------------------------------------|
|     ... 10 most recent ...                  |
+--------------------------------------------+
| View all notifications                      |
+--------------------------------------------+
```
`(*)` = unread dot (also bold text and a visually hidden "Unread:" prefix). Up to 10 newest items, unread and read mixed by time. Message wraps to at most 2 lines (full text as `title`). Time is relative ("5 min ago", "1 h ago", "yesterday", then "Oct 18") with the absolute time as tooltip and in `<time datetime>`. Clicking an item marks it read and navigates to the task (`/tasks/<id>`) or matter (`/matters/<id>`) and closes the panel. Empty: "You're all caught up." with a muted line "New notifications appear here." Error: one inline line "Couldn't load notifications. Retry." (no toast). "Mark all as read" is disabled-looking text only when nothing is unread (hidden, never a dead control).

### 4.3 Panel (phone, below 640 px)

The panel is a full-width sheet under the header (top: header height, bottom: 0), scrolls inside, with a visible Close button; no horizontal scroll.

```
+--------------------------------+
| Notifications        [Close x] |
| Mark all as read               |
|--------------------------------|
| (*) Ann Lee assigned you T-1042|
|     "Review privilege log".    |
|     5 min ago                  |
|--------------------------------|
| ...                            |
| View all notifications         |
+--------------------------------+
```

### 4.4 Page `/notifications`

```
Notifications                                          [Mark all as read]
Your recent notifications. Read ones are removed after about 90 days.
[ All | Unread (3) ]                               Show 25 per page v
+------------------------------------------------------------------------+
| (*) Ann Lee assigned you T-1042 "Review privilege log" ...   5 min ago |
| (*) T-1038 "Load volume 2" is due tomorrow (Oct 23).          1 h ago |
|     Bo Chen commented on T-1019: "Please..."              Oct 21 14:02 |
+------------------------------------------------------------------------+
  < Previous   Page 1 of 4   Next >                          (96 total)
```
Header follows the page-header contract (#600): icon, H1, one muted context line, action right. Filter is a two-button toggle group (`aria-pressed`), URL `?filter=unread&page=2`. Rows are links (whole row), 44 px minimum height. Below 640 px the rows are cards (message, time under it) and the pager is "Previous / Next" with "Page 2 of 4". Items for objects the person can no longer view are not listed (and not counted in the total). Empty: "No notifications yet." / "No unread notifications." with "Show all".

### 4.5 My profile section

```
Notifications
Choose which events create a notification for you. Notifications appear in the bell; nothing is sent by email.
 Technician
  [on ] A task is assigned to me
  [on ] My task is overdue or due within a day
  [on ] Someone comments on or mentions me in my task
 Project manager (shown when you manage a matter)
  [on ] A task on my matter becomes overdue
  [on ] A new task is created on my matter
  [on ] A task on my matter is unassigned or on hold for a while
  [on ] I am set as a matter's Primary or Secondary manager
 Pod Lead (shown when you lead a pod)
  [on ] A task in my pod becomes unassigned
```
Switches save immediately (optimistic, "Saved." polite status, revert with an inline error on failure). Groups the person has no role for are shown collapsed under "Other events" so settings are never hidden permanently (a person who becomes a manager later is already opted in by default).

## 5. Polling and API design

Base path `/me/notifications` (under the `/me` family so the architecture rule "a zero-permission user gets 403 everywhere except /me" holds; a user with nothing viewable simply receives an empty list). Authenticated user only; every query is scoped to the caller's id from the token (never a user id in the URL).

| Method and path | Purpose | Notes |
|---|---|---|
| `GET /me/notifications/poll?sinceId={n}` | The 30-second call: `{ unreadCount, latestId, items[] }` where `items` are the visible notifications with `id > sinceId` (max 20, newest first) | Cheap path first. Supports `ETag` / `If-None-Match`: the ETag is derived from (`latestId`, `unreadCount`, `preferencesVersion`); an unchanged state returns `304` with no body. `Cache-Control: private, no-cache`. |
| `GET /me/notifications?filter=all|unread&page=&pageSize=` | The page and panel list (panel uses `pageSize=10`) | Paged (default 25, max 100), newest first, stable order by `Id DESC`; `totalCount` of visible items. |
| `POST /me/notifications/{id}/read` | Mark one read | Idempotent; 204; 404 for another person's id (never 403, so ids leak nothing). |
| `POST /me/notifications/read-all` | Mark all read (those visible and unread) | Idempotent; returns `{ marked }`. |
| `GET /me/notification-preferences`, `PUT /me/notification-preferences` | The switches | `PUT` takes the full list of `{ eventType, enabled }`; unknown types 400. |

Design points:
- **since cursor.** The client keeps `lastSeenId` in memory (not storage). First poll uses `sinceId=0` with `items` suppressed (`?initial=true`) so opening the app never announces old items. A later poll returns only newer items, which the live region announces and the store prepends.
- **Unread count.** Counted over unread rows that pass the visibility check (section 6), capped by counting at most the 100 newest unread rows; the badge shows "99+" above 99. The accessible name uses the exact number up to 99, otherwise "more than 99".
- **Client behaviour.** `setTimeout` loop of 30 s plus 0 to 5 s random jitter; pause while `document.hidden` and poll once immediately when the tab becomes visible; suspend while the shell's connection banner is offline and resume on "Back online."; on 401 stop (the sign-in banner owns it); on errors back off to 60 s then 120 s (never toast; the panel shows "Couldn't refresh. Retrying." only when opened); after a mutation (read, read-all) update locally and refetch the count.
- **Multiple tabs.** Each tab polls independently (50 users, section 8); a `BroadcastChannel` leader tab is a possible optimisation, not in this release.
- **Mark read race.** Read state is server truth; a poll returning an item the client already marked read shows it read.
- **OpenAPI.** All endpoints are added to `contracts/openapi/v1.json` and the nswag client regenerated; the eager shell code never imports that client (section 9).

## 6. Permissions and security

- No new permission code. Any signed-in user has a bell if they have `Task.View` (every event concerns a task or matter; the route guard matches `/profile`). `contracts/permissions.json` is unchanged (decision AH-6); backend `Permissions.cs` and frontend `permissions.ts` stay in step trivially.
- **Re-check on read.** A notification row stores the object kind and id and the matter id. List, count and poll queries join the object and apply the **same visibility predicate the task and matter endpoints use** (exposed to the module through a `.Contracts` port, for example `IObjectVisibility`, implemented by the WorkManagement/Organization modules). Rows that fail are excluded from items, `unreadCount`, `totalCount` and paging. Nothing is deleted when visibility is lost; if access returns, the rows reappear.
- **Information leakage.** The stored `Message` contains the task number, title and matter name, so a row must never be returned unless the check passes (including the message text, never a "hidden" placeholder). Messages are not edited when a title changes (snapshot); this is stated in the page help. IDs of other people's notifications return 404.
- **Writes.** Only the recipient can mark read. Creation is server-internal (no public create endpoint). The application DB principal (`mf_app`) needs `INSERT, SELECT, UPDATE (ReadUtc), DELETE` on `Notification` and the preference table; grants are in the new script (see `13-security-hardening.sql` for the pattern). Notification rows are not audited (derived data); the underlying action already has its audit row.
- **Module boundaries.** New module `MatterFlow.Notifications` (Domain/Application/Infrastructure/Api plus `.Contracts`). Other modules reference only `MatterFlow.Notifications.Contracts` (`INotificationPublisher`, event type enum, `NotificationRequest`). The module references only SharedKernel and other modules' `.Contracts`. Register in `ModuleComposition.cs`; the architecture tests must pass unchanged. Reason for a new module rather than WorkManagement: recipients, preferences, polling and retention are cross-cutting, and an existing module would otherwise depend on Organization/Pods internals.
- **Auth guard.** No change to the Dev/Windows auth guard.
- **Rate.** The poll endpoint is cheap but still behind the normal authorization pipeline; no anonymous access.

## 7. Data model (new numbered script: next free number at implementation time)

`dbo.Notification`

| Column | Type | Notes |
|---|---|---|
| `Id` | BIGINT IDENTITY PK | also the poll cursor |
| `RecipientUserId` | the user key type | FK to users |
| `EventType` | VARCHAR(40) | code from section 3, CHECK constraint list |
| `ObjectKind` | VARCHAR(20) | `Task` or `Matter` |
| `ObjectId` | the key type of the object | |
| `MatterId` | nullable | for the visibility join and cleanup |
| `ActorUserId` | nullable | who caused it; NULL for scheduled events |
| `Message` | NVARCHAR(300) | snapshot text |
| `DedupeKey` | NVARCHAR(80) | section 3 |
| `CreatedUtc` | DATETIME2 | |
| `ReadUtc` | DATETIME2 NULL | NULL = unread |

Indexes: `UX_Notification_Dedupe (RecipientUserId, EventType, ObjectId, DedupeKey)` unique (idempotency); `IX_Notification_Unread (RecipientUserId, Id DESC) INCLUDE (ObjectKind, ObjectId, MatterId) WHERE ReadUtc IS NULL` (count and poll); `IX_Notification_Recipient (RecipientUserId, Id DESC)` (list); `IX_Notification_Read (ReadUtc) WHERE ReadUtc IS NOT NULL` (retention).

`dbo.NotificationPreference (UserId, EventType, Enabled)`, primary key (UserId, EventType); **only rows that differ from the default** are stored (absence = on), so new event types are on for everyone without a data migration.

Preferences are applied **at creation** (a disabled type creates no row). Consequence: turning a switch off stops future items but existing ones remain; turning it on does not backfill. Stated in the profile help text. No EF migrations; the script follows `db/scripts/README.md` rules (immutable once merged; fix forward).

## 8. Idempotency, scheduling and performance

- **Create path (events 1, 3, 5, 7, 8).** `INotificationPublisher.Publish(...)` adds rows to the unit of work already open for the action (same DbContext/transaction as the audit write) so action and notification commit or roll back together. A unique-index violation on `UX_Notification_Dedupe` is treated as "already notified" only for scheduled inserts; for in-transaction inserts the key contains a per-action value so it cannot collide. Recipient resolution queries (pod leads, matter managers) are small indexed lookups inside the same transaction.
- **Scheduler (events 2, 4, 6).** A single `BackgroundService` (new; no job infrastructure exists) in the host, `PeriodicTimer` every 5 minutes (retention once a day). Each run: (a) takes `sp_getapplock` `Notifications.Scheduler` (no overlap, safe if a second instance ever runs); (b) selects candidate tasks with a set-based query (open, `DueDate` not null, `DueDate <= tomorrow` / `< today`, joined to assignee and matter managers) in batches of 500; (c) `INSERT ... SELECT ... WHERE NOT EXISTS` (or catch duplicate-key) using the dedupe key, so re-running, restarts and overlapping runs never duplicate; (d) records nothing else. Overdue/"today" use the firm's configured time zone, the same definition as the Dashboard and My Work overdue counts (open question Q4). Because the key carries the due date, moving a due date re-arms; because candidates must still be open and due, a fixed task creates nothing.
- **Catch-up.** After downtime the first run sends what is currently true (one overdue per task and date), not a backlog of each missed day.
- **IIS.** The app pool must not idle out or the job stops: set `startMode=AlwaysRunning` and the application's `preloadEnabled`, and disable the idle timeout, in `deploy/` publish scripts and the runbook (documented in WP-NT3, not silently assumed). Failures are logged with a counter and shown on the existing health endpoint as a degraded (not failed) check when the last successful run is older than 30 minutes.
- **Performance for 50 users.** Poll load is 50 users x 2 per minute = about 100 requests per minute (about 1.7 per second), most answered 304 from one indexed read. The unread count is an index-only seek on the filtered index limited to 100 rows plus the visibility join on those rows. Volume estimate: 50 users x about 20 notifications per day = 1,000 rows per day, about 90,000 live rows at steady state with the 90-day rule; the list query is a seek on `(RecipientUserId, Id DESC)`. Budget (tested in the performance suite): poll p95 under 50 ms server time with 100,000 rows; same SQL statement count for 5 and 50 users; scheduler run under 2 seconds with 10,000 open tasks.

## 9. Frontend structure and bundle

- **Eager (in the shell):** a tiny `NotificationBell` button component (icon, badge, accessible name, click handler) in `shared/layout/`; no PrimeNG overlay, no HTTP, no api-client or lookup-store imports. Target under 3 kB gzipped.
- **Lazy:** on first idle time after the shell renders (`requestIdleCallback` with a timeout fallback) and on first click, the bell does `await import('../../features/notifications/notification-store')`, which owns the poller, the signals, the panel component (opened with a dynamically imported overlay) and the generated client (itself dynamically imported, as `initial-bundle.spec.ts` demands). The `/notifications` page and the profile section are lazy routes/components.
- The existing `initial-bundle.spec.ts` automatically covers every `shared/layout/*.ts` file, so the bell file is checked; the delivery plan adds an explicit build check: initial bundle under 700 kB and growth no more than 4 kB over the baseline at merge time.
- No toast, no sound, no title flashing. New items change the badge and the live region only. (A "(3)" prefix in the document title is a possible later option: Q6.)
- No keyboard shortcut is added or changed. The bell, panel items, "Mark all as read" and "View all notifications" are ordinary tab stops; Esc closes the panel (native overlay behaviour, not a new application shortcut) and returns focus to the bell.

## 10. Accessibility

- Bell: `<button type="button" aria-haspopup="dialog" aria-expanded>` with accessible name **"Notifications, n unread"** ("Notifications, 0 unread" at zero; "Notifications, more than 99 unread" above 99). The visible badge is `aria-hidden`.
- A single visually hidden `role="status"` / `aria-live="polite"` region in the shell, always present from first render (so announcements work). Announcement text: for one new item, "New notification: <message>"; for several, "3 new notifications. Latest: <message>". Not announced on the initial load, at most one announcement per poll, never assertive, not when the poll finds only an unread count change caused by this person's own mark-read.
- Panel: `role="dialog"` non-modal with `aria-labelledby` (its heading); focus moves to the heading on open and back to the bell on close; list is a `<ul>`; each item is a link whose accessible text starts with "Unread:" when unread; times use `<time>`; unread dot is decorative plus a text prefix and bold weight (not colour alone); contrast AA in light and dark; targets at least 44 px on touch; respects reduced motion (no animation needed).
- Page: heading structure, filter buttons with `aria-pressed`, pager as `<nav aria-label="Notifications pages">`, result count announced politely after filter or page change; axe 0 violations at 1366x768, 1920x1080, 768x1024 and 375x812 with the panel open.
- Profile switches: native labelled switches; group headings; saved state announced politely.

## 11. Retention

A daily housekeeping step in the scheduler deletes `ReadUtc < now - 90 days` in batches of 1,000 (with a short delay between batches) so the log stays small and locks stay short. Unread notifications are not deleted by the 90-day rule (open question Q5 proposes a 1-year hard limit). Deleting a user or task does not need a cascade: rows for removed objects are invisible by the visibility join and removed by the same rule once read, or by the hard limit.

## 12. Test plan

- **Unit:** message builders (all 11 wordings, trimming, excerpts, names); recipient rules (never actor, one per person per action, priority); dedupe key builders; preference filter; relative time formatter; poll-loop timing (30 s plus jitter, hidden tab pause, offline suspend, backoff) with fake timers; live-region text builder.
- **Backend integration (Testcontainers):** each of the 8 events creates exactly the expected rows in the same transaction (and none when the action rolls back); actor never notified; recipient lacking view permission gets no row visible; permission lost then regained; preference off creates no row; scheduler idempotency (run twice, run concurrently with applock, restart) creates one row; due date moved re-arms; ASAP and closed tasks produce nothing; retention deletes only read rows older than 90 days; poll `304` on unchanged ETag; `sinceId` returns only newer visible items; read of another user's id is 404; auth matrix (anonymous 401; zero-permission user gets empty results, not 500); SQL statement count constant for 5 and 50 users; architecture tests green.
- **Contract:** OpenAPI and nswag drift check; `validate-contracts.mjs`.
- **Frontend unit/component:** bell label and badge ("99+"), panel items and states (empty, error, loading), mark one and all read, live region, page filter/paging from the URL, profile switches; initial-bundle guard for the bell.
- **e2e (Playwright, real API):** assign a task to User B as User A: B sees the badge within one poll (clock control), opens the panel, clicks the item, lands on the task, count decreases; A sees nothing; comment event; Mark all as read; `/notifications` filter and paging; preference off then no new item; permission loss hides items; phone sheet at 375 px; keyboard-only walk (Tab, Enter, Esc, focus return); axe at four sizes with the panel open; no new shortcut registered.
- **Manual/UAT:** screen reader pass (announcement, name) is recorded as a manual UAT row (not automated).
- **Performance:** poll p95 and scheduler run on a 100,000-row, 10,000-task data set in the performance suite.

## 13. Dependencies and risks

- Events 4 to 7 need the Project Manager role epic (Matter Primary/Secondary manager). It was not found on dev or in the epic list at the time of writing; if it lands later, those event issues wait and the rest ships. The recipient resolver is a port so the work is isolated.
- The mention part of event 3 needs an @mention concept in the comment composer, which does not exist on dev (WP-NT2 has an issue to add the minimal version; it can be cut, see Q1).
- A new scheduler is infrastructure risk on IIS (idle shutdown); mitigated in section 8.
- OpenAPI/nswag file conflicts with other open epics: regenerate after each rebase, never hand-merge (as other epics).
- Noise risk from event 8 (many unassigned tasks created in a burst); see Q2.
- Shell epic dependencies: header slot next to the user menu (user menu is owned by the Profile epic: #580 identity row, #578 phone dot), toast host and offline banner (#616, #611).

## 14. Open questions for the owner

| # | Question | Recommendation (used in the plan) |
|---|---|---|
| Q1 | Mentions do not exist in comments today. Build a minimal @name picker in the comment composer (5 h) or ship event 3 as "comment on your task" only and add mentions later? | Build the minimal version as its own issue; it is the only cuttable item (saves 5 h). |
| Q2 | Event 8 can be noisy when many unassigned tasks are created at once. Coalesce into "5 tasks unassigned in <pod>" within 10 minutes? | Not in release 1; measure first, then decide. |
| Q3 | "For a while" for event 6: 2 days unassigned, 5 days on hold, in calendar or business days? | 2 and 5 calendar days as constants in one place; make configurable later. |
| Q4 | Which time zone defines "overdue"/"due within a day" for the scheduler? | The firm time zone used by the Dashboard and My Work today. |
| Q5 | Unread notifications are never deleted by the 90-day rule. Add a 1-year hard limit? | Yes, 365 days for unread, same job. |
| Q6 | Show the unread count in the browser tab title ("(3) MatterFlow")? | Not now; trivial to add later. |
| Q7 | Where is the Project Manager role epic and its data (Matter.PrimaryManagerId / SecondaryManagerId)? Events 4 to 7 wait for it. | Link it as a dependency of the event issues. |
| Q8 | Should "Mark as unread" exist on the page? | No (clicking reads, as decided). |
