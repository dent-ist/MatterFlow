# Admin impersonation ("View as", read-only): design

Epic #828: "Epic: Admin impersonation (View as, read-only)" (issues #829 to #842, IM-01 to IM-14; label `phase-22`, higher priority than the postponed Reports epic #671). Status: **planned; not started** (the owner asked for design, plan and epic only). Decisions: `docs/requirements/decisions-addendum.md` section AL. Plan: `delivery-plan.md`. Code facts below come from reading `origin/dev` on 2026-10-26; anything else is marked _proposed_. No SQL script number is claimed: next free number at implementation time (last used on `dev`: 39).

## 1. Decisions (binding, from the owner)

| # | Decision |
|---|---|
| D1 | Impersonation is **read-only**. While it is on, every write is refused by the server with HTTP 403, `application/problem+json`, stable code `IMPERSONATION_READ_ONLY` and a short user-facing message. Allowed: GETs, stopping the impersonation, normal sign-out (no sign-out endpoint exists today; the allow-list has the slot). Nothing the admin does may change data, mark the target's notifications read, move the target's "Since your last visit" marker or change the target's saved scope/menu preferences. Preferences are read from the target; writing them is refused or ignored. |
| D2 | Who can be impersonated: any **active** user **except** System Administrators (never, not even by another System Administrator). An access-pending user (no role) cannot be. A disabled user cannot be. |
| D3 | At most **one hour**, then it ends by itself (the next request after expiry behaves as the admin again and the UI says so). The admin can stop at any time. Starting a new impersonation replaces the previous one. |
| D4 | New permission `User.Impersonate`. Held by default only by the System Administrator role (who holds every permission implicitly, so **no grant row**). Assignable to any other role later. |
| D5 | Works with both authentication modes (Dev provider with `X-Dev-User` / `DefaultUser`, Windows/Negotiate in production). The authenticated principal is **never replaced** in the transport; the server derives an **effective user** from a short-lived marker. Both identities stay available: effective for authorization, data scoping and every "my" view; real for audit. |
| D6 | Start, stop and expiry are audited events (who, as whom, when, from where). Every request made while impersonating is attributable: the real user id is in the audit context, so any audited event shows "by <admin> acting as <user>". A refused write is logged at a low level, rate-limited, not an audit flood. |
| D7 | No new or changed keyboard shortcut (#420). The initial bundle stays under 700 kB (about 629 kB now): picker and banner logic lazy; the eager shell never statically imports `api-client` or the lookup store. |

## 2. Where the code stands today (facts)

- `ICurrentUser` (SharedKernel) has `UserId`, `IsAuthenticated`, `DisplayName`, `IsSystemAdmin`. `CurrentUser` (Identity, scoped) holds an `AccessSnapshot` set by `AccessAuthorizationHandler`, which calls `IUserResolver.ResolveAsync(principal)`. `IPermissionChecker` is the same object. About 200 consumers read `ICurrentUser`; they must keep meaning "the user whose view this is".
- `UserAccessCache` (singleton) caches the snapshot per **external identity key** for `Authorization:CacheSeconds` (default 60); `InvalidateUser(userId)` removes entries by `snapshot.UserId`; a generation counter makes a racing load discard its result.
- `UserResolver` has side effects that must never run for the effective user: JIT provisioning, bootstrap System Admin grants, the `LastLoginAt` write (5-minute granularity), audit writes.
- Dev handler: user from header `X-Dev-User`, query `devUser` (Development only), else `Auth:Dev:DefaultUser`. Windows: `AddNegotiate()`, subject = SID. Pipeline: `UseRouting → UseAuthentication → UseAuthorization`, with `RequestForgeryGuard` before authentication (every state-changing `/api` request needs `X-MatterFlow-Client: web`, JSON or multipart content type, and a same-origin `Sec-Fetch-Site`).
- Policies: `Perm:<code>` resolved on demand by `PermissionPolicyProvider`; `FailClosedConvention` gives every action without an explicit policy the `NonPending` policy; an architecture test requires an explicit policy on every action.
- Audit: `AuditSaveChangesInterceptor.Materialize` sets `ActorUserId = currentUser.UserId` for field-diff and explicit events (`IAuditWriter.Write(AuditEntry)` is queued and saved in the same transaction; `IAuditCorrelation` shares one id per request). `AuditColumnsInterceptor` stamps `CreatedBy/ModifiedBy` from `ICurrentUser`. `dbo.AuditEvent` is append-only (trigger, no UPDATE/DELETE), denied to the report login.
- `Matter.ViewSensitive` pattern (epic #788): constant in `Permissions.cs` and in the `All` list, entry in `contracts/permissions.json`, string in `frontend/src/app/core/auth/permissions.ts`, a warning row on the Roles screen (`roles-page.ts`), parity tests; System Admin holds it implicitly; the Director got a grant row by script (we need none).
- Systematic security suite for sensitive matters: `SensitiveAccessCatalog` classifies every endpoint operation of the host (221 when written) and `SensitiveEndpointCatalogTests` reads `EndpointDataSource`, failing for an unclassified endpoint and for a catalog entry that matches nothing. We reuse the approach (section 7).
- There is **no SignalR** and no hosted service that reads `ICurrentUser`; notifications are polled (GET, with `ETag`/`If-None-Match`).
- Browser-only preferences (`dash-scope`, `dashboard-prefs`, `swimlane-prefs`, `trend-prefs`, `coverage-prefs`, `breakdown-view`) live in `localStorage` keyed by `userId`; there are no server-side scope/menu preferences. Server-side per-user state that a GET can touch: `dbo.UserMatterActivitySeen` (see R14), `LastLoginAt`, notification read state, notification preferences, availability.

## 3. The marker: options, choice, threat model

The marker says "this authenticated person is currently viewing as user X until time T".

| Option | For | Against |
|---|---|---|
| A. Signed, stateless cookie (Data Protection) containing real id, target id, expiry | no table, no per-request read | cannot be revoked before expiry without a deny list (which is a table anyway); Data Protection keys must be shared by every node of a farm (no key ring is configured today); expiry/stop races; no place to count refused writes or show "started from" |
| B. Opaque random handle in a cookie + server-side session row | revocable at once (Stop, expiry, target disabled, admin loses the permission); works on every node because the row is in SQL; nothing to sign or rotate; gives audit/ops a list ("who is viewing as whom now"); room for counters | one indexed primary-key read per request that carries the cookie |
| C. Header on every call, set by the SPA from sessionStorage | per tab | JavaScript-readable, no server-side stop/expiry, a forged header is only checked by the same lookup anyway |

**Choice: B.** Cookie `mf_view_as`: 32 random bytes (CSPRNG), base64url; `HttpOnly`, `SameSite=Strict`, `Secure` whenever the request is HTTPS (always in production; plain HTTP only in the Development/Test environments), `Path=/api`, `Max-Age` = remaining time. The database stores only the **SHA-256 hash** of the handle, so a database read does not hand out working cookies. The handle is unforgeable by entropy (256 bit); it is "server-verifiable" because it is only valid when a row with that hash exists and is live. Signing it would add nothing and would add a key to manage across nodes. A bad cookie is only looked up **after** authentication succeeded, so an anonymous flood never reaches the database.

Table (_proposed_, script at implementation time; a new table needs an entry in `db/report-access.json` and GRANT/DENY for `mf_report_reader`; classification: **deny**):

```
dbo.ImpersonationSession
  SessionId        uniqueidentifier PK (audit object id)
  HandleHash       binary(32) UNIQUE        -- SHA-256 of the cookie value
  RealUserId       int FK AppUser
  TargetUserId     int FK AppUser
  StartedAtUtc     datetime2, ExpiresAtUtc datetime2   -- StartedAt + min(Impersonation:MaxMinutes, 60)
  EndedAtUtc       datetime2 NULL, EndReason varchar(32) NULL  -- STOPPED | EXPIRED | REPLACED | TARGET_UNAVAILABLE | TARGET_NOW_SYSTEM_ADMIN | REAL_USER_LOST_PERMISSION
  StartedFromIp    varchar(45), UserAgent nvarchar(200)
  RefusedWrites    int NOT NULL DEFAULT 0
  IX (RealUserId, EndedAtUtc) ; IX (ExpiresAtUtc) WHERE EndedAtUtc IS NULL
```

Rows are kept (they are the evidence); a retention job is not needed at this scale (one row per start).

### Per-request resolution (`ImpersonationMiddleware`, after `UseAuthentication`, before `UseAuthorization`)

1. No cookie: nothing happens (cost zero).
2. Cookie present: hash it, read the row. The marker is **honoured** only if all hold: row exists; `EndedAtUtc IS NULL`; `now < ExpiresAtUtc`; `RealUserId` equals the **real** user resolved from the authenticated principal (so a stolen cookie in another person's browser, or after a `X-Dev-User` switch, is ignored); real user is active and still holds `User.Impersonate`; target still exists, is active, is not pending, is not a System Administrator now.
3. Not honoured: the request runs as the real user, the cookie is cleared (`Set-Cookie` expired), and a one-shot **ended notice** is attached (response header `X-MatterFlow-View-As-Ended: EXPIRED|TARGET_UNAVAILABLE|...`; `/me` also returns `impersonationEnded`). If the row is live but ended for a state reason (target disabled, permission lost, expired) the middleware ends it once: `UPDATE ... SET EndedAtUtc, EndReason WHERE SessionId=@id AND EndedAtUtc IS NULL`; the caller whose update affected one row writes the `IMPERSONATION_EXPIRED`/`..._ENDED` audit event (with `OccurredAtUtc = ExpiresAtUtc` for expiry), so exactly one event exists even with several nodes. A cookie of another person's session is not ended by the wrong person (rule 2 fails first), just ignored and cleared.
4. Honoured: `CurrentUser` gets the **effective** snapshot (target) and `IRealUser` the real one; response header `Cache-Control: private, no-store` and `Vary: Cookie` are added so no shared or browser cache can serve one view to the other.

### Threat model

| Threat | Control |
|---|---|
| Non-admin starts impersonation | `POST /impersonation` policy `Perm:User.Impersonate` is evaluated on the **real** snapshot (endpoint attribute `[ActsAsRealUser]`), never the effective one. |
| Admin impersonates a System Administrator | Refused in `ImpersonationEligibility` (one place): code `IMPERSONATION_TARGET_INELIGIBLE`, reason `TARGET_IS_SYSTEM_ADMIN`; re-checked on every request (a target promoted mid-session ends the session). |
| Escalation: effective user has more than the real user | Impossible by rule D2 for System Administrators; for a non-admin holder of `User.Impersonate` it is **by design** (they see what the target sees, read-only); the Roles screen warns exactly like `Matter.ViewSensitive` (open question Q1). |
| Impersonation grants less than the target has / uses the real user's rights | The effective snapshot is the target's, loaded by id with the same rules as for the target's own request. The real user's rights are used only for start/stop/eligible-users, and the check for start is made on the real user even when a session is live. |
| Chain: effective user holds `User.Impersonate` and starts another | Start/stop/list endpoints read the real user only; a start while impersonating **replaces** (closes the old row `REPLACED`). The effective user's permissions never enter. |
| Tampered or guessed cookie | 256-bit random handle; hash lookup; no match = ignored. No data in the cookie to tamper with. |
| Replay of an old cookie | Row ended/expired = ignored; `Max-Age` equals the remaining time; the cookie is bound to the real user's authenticated principal. |
| Stolen cookie (XSS) | `HttpOnly`; CSP and security headers as today; useless without the real user's Windows credentials. |
| CSRF to start or stop | `SameSite=Strict`; start and stop are POST/DELETE, so `RequestForgeryGuard` demands `X-MatterFlow-Client: web`, JSON content type and a same-origin `Sec-Fetch-Site`. GETs never change state (we also fix the GETs that did, R14). A cross-site GET carrying the strict cookie cannot happen. |
| Cross-user cache leakage | Every cache keyed by user uses the **effective** id (section 5); responses carry `private, no-store`; the SPA clears all stores on start/stop; a leakage test walks start/stop (section 10). |
| Audit evasion or mislabelling | `ActorUserId` is always the **real** user; the effective user is stored in a new column; the interceptor takes `IRealUser`, not `ICurrentUser`, for the actor (architecture test). |
| Session never ends | Fixed lifetime (not sliding), cap 60 minutes in code (`Impersonation:MaxMinutes` can only lower it), checked on every request, server clock only. |
| Dev provider abuse | Unchanged guard (`Dev` only in Development/Test); view-as is independent of it and adds no way to choose an identity. |

## 4. Effective vs real user abstraction

- `ICurrentUser` and `IPermissionChecker` mean the **effective** user (target while impersonating, else the real user). All existing consumers (authorization, data scoping, "my" views, `IMatterVisibility`, ranker, dashboards) keep working with no edit and automatically see the target.
- New `IRealUser` (SharedKernel): `int? RealUserId`, `string? RealDisplayName`, `bool IsImpersonating`, `Guid? ImpersonationSessionId`, `DateTime? ImpersonationExpiresAtUtc`. Without impersonation `RealUserId == ICurrentUser.UserId`. Implemented by `CurrentUser` (one object, two views).
- Audit and stamping read `IRealUser`: `AuditSaveChangesInterceptor` (`ActorUserId = RealUserId`, `OnBehalfOfUserId = IsImpersonating ? effective : null`, `ImpersonationSessionId`), `AuditColumnsInterceptor` (`CreatedBy/ModifiedBy` = real user in the unlikely case something is written), the log scope (`RealUserId`, `EffectiveUserId`, `SessionId`).
- `AccessAuthorizationHandler`: for endpoints with `[ActsAsRealUser]` (start, eligible-users, and the stop/state endpoints) it evaluates requirements on the real snapshot; for everything else on the effective snapshot. A pending or disabled **real** user fails as today.
- `UserResolver` gains `ResolveByIdAsync(userId)` for the effective user: a read-only load by id, **no** provisioning, bootstrap, `LastLoginAt` write or audit; cache key `uid|<userId>` in the same `UserAccessCache` (so `InvalidateUser` and `InvalidateAll` already cover it; the 60 s staleness is the same already accepted for roles).
- Architecture tests: (1) only the two interceptors and the impersonation code may inject `IRealUser`; (2) the two interceptors must not read `ICurrentUser.UserId` for the actor; (3) no code outside `MatterFlow.Identity` reads the cookie name.

## 5. Inventory of user-keyed read paths and caches (40 rows)

"Effective" = the target; "real" = the admin. Behaviour while impersonating; **WR** = needs a code change in the work package shown (WP in `delivery-plan.md`).

| Row | Path / cache | Behaviour while impersonating | WR |
|---|---|---|---|
| R01 | `UserAccessCache` (per identity key, 60 s) | Real entry unchanged; effective entry `uid|<id>` added; both dropped by `InvalidateUser` | IM-03 |
| R02 | `UserResolver` provisioning, bootstrap grants | Real only; never for the effective user | IM-03 |
| R03 | `LastLoginAt` write | Real only; the target's last sign-in must not move | IM-03 |
| R04 | `CurrentUser` / `ICurrentUser` | Effective; `IRealUser` added | IM-03 |
| R05 | Permission policies `Perm:*`, `NonPending` | Effective; start/stop/list use real (`[ActsAsRealUser]`) | IM-03 |
| R06 | `IPermissionChecker.Has/Require` in services | Effective | IM-03 |
| R07 | `GET /me` | Effective user, roles, permissions, `isSystemAdmin`(false), pods, `hasWork` + new `impersonating` block | IM-03, IM-07 |
| R08 | `hasWork` (landing choice) | Effective user's | IM-03 |
| R09 | Pods in `/me` | Effective user's | IM-03 |
| R10 | Menu, landing, nav items, route guards (frontend, derived from `/me`) | Effective; refreshed on start/stop | IM-08 |
| R11 | `IMatterVisibility` / `Viewer` / `ViewerPreparationFilter` | Effective user's visibility, behind `Features:SensitiveMatterAccess`; admin sees **less** than own | none (verify, IM-11) |
| R12 | `IManagedMatterScope` | Effective | none (verify) |
| R13 | My Matters scope, summary, health, attention, deadlines, workload | Effective ("my" = target) | none (verify) |
| R14 | `GET /my-matters/activity` **creates the `IsInitial` marker row on first read** (a GET that writes) | While impersonating the read must not insert; shows "all unread" semantics computed without the row | IM-04 |
| R15 | `GET /my-matters/since-last-visit` | Reads target's marker; never moves it (already true) | none |
| R16 | `POST /my-matters/activity/seen` | Refused (write) | IM-04 |
| R17 | Notifications list, unread count, poll with `ETag` | Target's; GET only; `ETag` is per user; `no-store` added | IM-06 |
| R18 | Notification mark-read, read-all (`ExecuteUpdate`) | Refused (write) | IM-04 |
| R19 | Notification preferences GET / PUT | GET target's; PUT refused | IM-04 |
| R20 | Bell store in the SPA (`NotificationStore`) | Cleared on start/stop; poll continues with GET only | IM-08 |
| R21 | `DashboardCache` (per user, period, zone, date, visibility) | Keyed by **effective** id; verified | IM-06 |
| R22 | Dashboard summary, trend, workload, coverage ("my" scope, pods) | Effective | none (verify) |
| R23 | My Work, Task Queue "assigned to me", Pod Work | Effective | none (verify) |
| R24 | Swimlane | Effective | none (verify) |
| R25 | "Created by me" views | Effective | none (verify) |
| R26 | Assignee ranker / `UsersLookup` suggestions | Effective viewer's visible counts (ranker shows only visible counts) | none (verify) |
| R27 | `IUserAvailabilityReader`, "my availability" | GET target's; set out of office / I'm back refused | IM-04 |
| R28 | `IUserTimeZone` (`X-Time-Zone` header from the browser) | The admin's browser zone; unchanged and harmless | none |
| R29 | Global search (suggestions, advanced, permission alternatives) | Effective permissions and visibility; any POST-style search is classified `ReadSafe` after review | IM-04, IM-10 |
| R30 | Audit views (`Audit.View`, `IAuditVisibility`) | Effective permission/visibility; rows show real + effective names | IM-05 |
| R31 | `AuditColumnsInterceptor` stamps | Real user (nothing is written anyway) | IM-05 |
| R32 | `AuditSaveChangesInterceptor` actor | Real user + `OnBehalfOfUserId` | IM-05 |
| R33 | Reports (postponed epic #671: runs, results, saved reports, report login) | Report execution is a write (run rows) and reads sensitive data without the visibility rule today (addendum AI item 6). View-as must refuse running/saving reports; tracked in IM-14 | IM-14 |
| R34 | Browser prefs in `localStorage` keyed by `userId` (6 stores) | Reads of the target's keys find nothing in the admin's browser, so defaults show; writes go to memory only (never to the target's key) | IM-08 |
| R35 | SPA stores (`LookupStore`, `ReferenceNames`, `NotificationStore`) via `SessionReset` | Cleared on start, stop, expiry, so no cross-user data | IM-08 |
| R36 | SignalR / push | None exists; polling only | none |
| R37 | `IMemoryCache` in Reports (`ReportChoiceService`, `ReportSchemaReader`) | Not user-keyed data; verify at Reports time | IM-14 |
| R38 | Hosted services (notification scheduler, report sweeper) | Not request-bound; never see impersonation | none |
| R39 | Users admin pages, roles, pods (admin lists) | Effective permissions apply: a non-admin target cannot open them | none |
| R40 | File and export GET downloads | Allowed (reads); logged with real+effective in the request log | none |

Count: **40** rows; **26** need a change or a decision in a work package (column WR), **14** are covered by the effective-user rule and only proven by tests (IM-11, IM-10).

## 6. Read-only enforcement

Three layers, outermost first.

1. **`ReadOnlyWhileImpersonatingMiddleware`** (after the impersonation middleware, before `UseAuthorization`, needs routing for endpoint metadata). When impersonating and the method is not GET/HEAD/OPTIONS and the endpoint has no `[AllowWhileImpersonating("reason")]` metadata: respond 403 `IMPERSONATION_READ_ONLY` immediately, before model binding, validation or permission checks (so the answer never depends on the target's rights and never says "permission denied"). Default-deny: POST/PUT/PATCH/DELETE and any unknown method are refused; a **new** write endpoint is covered without anyone remembering. It works for controllers, minimal APIs and anything else on the endpoint pipeline. Allowed by attribute: `POST /impersonation` (start/replace), `DELETE /impersonation` (stop). POST-as-query endpoints (if any exist; the catalog finds them) get `[ReadSafe("reason")]` only after review that they write nothing.
2. **Data guard** (defence in depth): a `SaveChanges` interceptor throws `ImpersonationReadOnlyException` (mapped to the same 403) when `IRealUser.IsImpersonating` and the change set contains any entity other than `ImpersonationSession` and `AuditEvent`. A `DbCommandInterceptor` rejecting non-SELECT commands (raw `ExecuteSql`, `ExecuteUpdate`, such as notification read-all and the activity marker) while impersonating is a spike in IM-04: keep it if its cost is below noise (one prefix check per command), otherwise rely on layer 1 plus the catalog test. Services with a GET that wrote (R14) are fixed to not write: `IMyMattersActivity` checks `IRealUser.IsImpersonating`.
3. **Catalog + coverage test** (section 7): proves that every endpoint is classified and that every write is refused, with no data change.

Error shape: `Problems.Create(context, 403, "IMPERSONATION_READ_ONLY", "Read-only while viewing as someone else", "You are viewing as <name>. Stop viewing as <name> to make changes.")`, `application/problem+json`, the stable `code` extension. OpenAPI documents the code on the write operations once (a shared response); the SPA maps it to a calm inline/toast message "This view is read-only" (never the generic "Something went wrong").

Refused-write logging: `ILogger` `Information` with `RealUserId`, `EffectiveUserId`, `SessionId`, method, route template (no body, no ids in the path beyond the template); in-memory limiter per node: first occurrence per (session, method, route template), then one summary per minute; the row counter `RefusedWrites` is incremented atomically (cheap, allow-listed). Audit event `IMPERSONATION_WRITE_REFUSED` is written for the first refusal per (session, route template) with a cap of 20 per session; the rest is the counter, shown in the stop/expiry event summary ("12 writes refused"). No audit flood.

## 7. Write-endpoint catalog and coverage test

Reuse the sensitive-matters harness (`backend/tests/MatterFlow.IntegrationTests/Security/`): add `ImpersonationEndpointCatalog` next to `SensitiveAccessCatalog`, same key (HTTP method + route pattern as ASP.NET Core knows it), classes:

- `Read` (GET/HEAD): must work while impersonating and must not change state (see section 10 "no hidden writes").
- `Write`: must be refused with 403 `IMPERSONATION_READ_ONLY`, nothing changed.
- `ReadSafe`: non-GET that only reads (e.g. a POST search), needs `[ReadSafe]` and a reason.
- `Allowed`: start, stop (and a future sign-out), needs `[AllowWhileImpersonating]`.

Tests: (a) `ImpersonationEndpointCatalogTests` reads `EndpointDataSource`: an uncatalogued endpoint fails, a catalog entry with no endpoint fails, the class must agree with the method and the attribute metadata (a `Write` that carries `[ReadSafe]` fails; a non-GET without a class fails). (b) `ImpersonationWriteRefusalTests` sends every `Write` and `ReadSafe`-less non-GET as the impersonating admin with an empty body (the middleware refuses before binding, so no valid payload is needed) and asserts 403, the stable code, and a database checksum of all business tables unchanged (only `ImpersonationSession`/`AuditEvent` may change). (c) Mutation test: with the middleware removed in the test host the same walk reports violations, so the suite is not vacuous. (d) `GetNeverWritesTests` walks every `Read` entry impersonating and compares the checksums of per-user tables (`UserMatterActivitySeen`, notifications, `UserIdentity.LastLoginAt`, availability, preferences) before and after: this catches R14-type GET-with-write bugs in future.

## 8. Audit design

Events (`ObjectType = ImpersonationSession`, `ObjectId` = session id): `IMPERSONATION_STARTED` (summary: "<admin> viewed as <user>"; new value: expiry; from-IP in summary), `IMPERSONATION_STOPPED`, `IMPERSONATION_EXPIRED` (also for the automatic ends, reason in `FieldKey`), `IMPERSONATION_WRITE_REFUSED` (section 6). A replacement writes `STOPPED(REPLACED)` then `STARTED`.
Schema (_proposed_, next script): `AuditEvent` gets `OnBehalfOfUserId int NULL` and `ImpersonationSessionId uniqueidentifier NULL` (ALTER ADD; the append-only trigger and grants are table-level and unaffected; the table stays denied to the report login). Existing rows keep NULL. `ActorUserId` is the real user for all events.
Audit API: `AuditEventDto` gets `onBehalfOfUserId`, `onBehalfOfName`; the audit browser shows "Kim Lee (as Pat Roe)" in the Actor column and a "Viewed as" filter; the display lookup resolves both names; the activity feeds that print an actor use the real user and add "(as ...)" when present. Audit visibility: unchanged (`Audit.View` of the viewer; sensitive-scope rule applies; the impersonation events have no matter, so they are visible to `Audit.View` holders).
Request attribution: the log scope carries `RealUserId`, `EffectiveUserId`, `SessionId` for every request while impersonating, so access logs and the (rate-limited) refusal lines are traceable even when no audit event is written.

## 9. API (proposed; OpenAPI and nswag client updated together)

| Method and route | Policy | Purpose |
|---|---|---|
| `POST /api/v1/impersonation` body `{ "userId": 123 }` | `Perm:User.Impersonate` on the **real** user; `[AllowWhileImpersonating]` | Start (or replace). 200 `ImpersonationState`; sets the cookie. 404 unknown user; 409/422 `IMPERSONATION_TARGET_INELIGIBLE` with `reason`: `TARGET_IS_SYSTEM_ADMIN`, `TARGET_ACCESS_PENDING`, `TARGET_DISABLED`, `TARGET_IS_SELF` |
| `DELETE /api/v1/impersonation` | authenticated real active user (no permission needed: stopping must always work); `[AllowWhileImpersonating]` | Stop. 204; clears the cookie; idempotent |
| `GET /api/v1/impersonation/eligible-users?q=&limit=` | `Perm:User.Impersonate` real | Picker data: `{ userId, displayName, email, roles[], eligible, reason? }`, ineligible users included with the reason (System Administrator, Access pending, Disabled, You) |
| `GET /api/v1/me` | as today | Effective user + `impersonating: { realUserId, realDisplayName, startedAtUtc, expiresAtUtc, readOnly: true }` or null; `impersonationEnded: { reason, endedAtUtc }` once after an automatic end |

`ImpersonationState` = the `impersonating` block plus the target `{ userId, displayName }`. Config: `Impersonation:MaxMinutes` (default 60, cap 60). No new global header except `X-MatterFlow-View-As-Ended` on the first response after an automatic end.

## 10. Frontend design

### Account menu and picker

```
  [ Kim Lee v ]                       Account menu (only with User.Impersonate)
  +------------------------+
  | My profile             |
  | Set out of office...   |
  | View as...             |   <- new; opens the picker; absent without the permission
  | Keyboard shortcuts     |
  +------------------------+

  View as...                                  [x]
  Search people  [ pat________ ]
  +--------------------------------------------------+
  | Pat Roe        Project Manager                    |   selectable
  | Pat Lin        Director                           |   selectable
  | Pat Admin      System Administrator   (cannot)    |   disabled, reason shown
  | Pat New        No role yet            (cannot)    |   disabled, reason shown
  | Pat Old        Disabled               (cannot)    |   disabled, reason shown
  +--------------------------------------------------+
  You will see MatterFlow as this person sees it, for up to 1 hour.
  Read-only: you cannot change anything.
                                  [ Cancel ] [ View as Pat Roe ]
```

The picker reuses `mf-entity-picker` fed by `eligible-users`; ineligible rows are listed with the reason as text (not colour alone) and `aria-disabled`. The dialog and its API call are a lazy chunk (`import()` from the menu handler); the menu item itself is a static string gated by `auth.can('User.Impersonate')`. While a session is active the menu shows "Stop viewing as <name>" instead (the effective user's permissions would otherwise hide the item), driven by the `impersonating` block.

### Banner (every page)

```
Desktop (full width, above the header, not dismissible, sticky)
+--------------------------------------------------------------------------------+
| (eye) Viewing as Pat Roe (read-only)  *  expires in 58 min  *  [ Stop viewing ]  |
+--------------------------------------------------------------------------------+

Phone (360 px): two lines, Stop stays a 44 px target
+--------------------------------------+
| Viewing as Pat Roe (read-only)       |
| 58 min left            [ Stop ]      |
+--------------------------------------+

After expiry (live region, banner replaced by a notice until dismissed)
+--------------------------------------------------------------------------------+
| View as ended: the hour is over. You are back as Kim Lee.            [ OK ]      |
+--------------------------------------------------------------------------------+
```

- A standalone eager component with **no imports of `api-client`, lookup store or the picker**; it reads a small signal in the existing `AuthStore` (fields from `/me`), a `setInterval` minute tick (cleared on destroy) for the countdown ("58 min", "less than 1 min"), and calls `ImpersonationApi.stop()` through a lazy `import()`. It is mounted in the app shell and in the standalone error/forbidden/not-found pages, the pending-access page and the connection banner host, so it appears on EVERY page including phone and error pages (e2e proves it).
- Colour: a distinct, high-contrast "warning" token pair (`--mf-warning-bg/--mf-warning`, the same pair as the Dev-auth banner but with an icon and text so colour is never the only cue); it does not replace the Dev-auth banner (both can show; View as sits above).
- Live region: one polite `role="status"` region (the existing route announcer host) announces "Now viewing as Pat Roe, read-only" on start, "Stopped viewing as Pat Roe. You are Kim Lee again" on stop, "View as ended after one hour. You are Kim Lee again" on expiry; the expiry notice is also reachable by focus (OK button) and by the `impersonationEnded` field. Document title and route announcer are unchanged (the banner never writes `document.title`).
- On start/stop/expiry: `AuthStore` refetches `/me`, runs `SessionReset` (clears `LookupStore`, `ReferenceNames`, `NotificationStore`), recomputes menu and landing, and navigates to the landing of the effective user (Stop returns to the page the admin started from if still allowed, else landing). Any API response with `X-MatterFlow-View-As-Ended` or `403 IMPERSONATION_READ_ONLY` while the SPA thinks it is not impersonating triggers the same refresh (another tab stopped it).
- The banner replaces "View as..." in the menu with "Stop viewing as Pat Roe" while active; "View as..." again starts a new one (replace).

### Write actions

Decision: write buttons stay **visible but disabled** with a tooltip/hint "Read-only while viewing as someone else"; the server refusal is the safety net. A single directive `mfWriteGuard` (and a `readOnly` signal in `AuthStore`) on primary write actions sets `disabled`, `aria-disabled="true"` and `aria-describedby` to one visually-hidden string, so screen readers hear the reason. Disabled-with-reason beats hiding because the admin sees the same layout as the user (the point of the feature) and understands why nothing happens.

```
Task detail while viewing as Pat Roe
+----------------------------------------------------+
| Task 1042  Review privilege log          [Edit] ... |
|  Status: In progress   [ Complete step ] (disabled) |
|  tooltip: "Read-only while viewing as someone else" |
|  Comment: [ ______________________ ] [ Post ] (dis.)|
+----------------------------------------------------+
Inline form submit that still reaches the server:
  "This view is read-only. Stop viewing as Pat Roe to make changes."   (not a generic error)
```

Local-only UI state (filters, sort, density, panel toggles) keeps working but is **not persisted** (R34).

### Accessibility

Banner is a `region` with a label ("Viewing as another user"), not hidden from the tab order, reachable by the skip link target order (it is before the header, after the skip link); contrast 4.5:1 in light and dark; countdown text changes at minute granularity and is **not** a live region (no per-minute chatter); only start/stop/expiry announce. Touch target 44 px on phone. Reduced motion respected (no animation). Axe runs at four widths (360, 768, 1280, 1920) in the e2e.

### Bundle

Initial total now about 629 kB, limit 700 kB. Eager additions: banner component (about 2 kB), `AuthStore` additions (a few signals), `mfWriteGuard` (small). Lazy: picker dialog, `ImpersonationApi`, the menu's `import()`. A bundle check (the existing size budget in the build) is part of IM-08 acceptance (budget: +6 kB at most).

## 11. Test plan

Permission matrix (integration, per endpoint class in the catalog):

| Caller | Start | Stop | Eligible list | Reads while on | Writes while on |
|---|---|---|---|---|---|
| Anonymous | 401 | 401 | 401 | 401 | 401 |
| Active user without `User.Impersonate` | 403 `PERMISSION_DENIED:User.Impersonate` | 204 (no-op) | 403 | n/a | n/a |
| Role granted `User.Impersonate` (non-admin) | 200 for eligible targets | 204 | 200 | target's view | 403 `IMPERSONATION_READ_ONLY` |
| System Administrator | 200 for eligible targets | 204 | 200 | target's view | 403 `IMPERSONATION_READ_ONLY` |

Target variants (start): active non-admin 200; System Administrator 409/422 `TARGET_IS_SYSTEM_ADMIN` (also when the caller is a System Administrator); access-pending 422; disabled 422; self 422; unknown id 404; a user disabled or promoted to System Administrator **mid-session** ends the session on the next request (admin view, ended notice).

Security tests (IM-11): cannot impersonate a System Administrator; cannot escalate (effective permission set equals the target's exactly; a request the target would get 403 on is 403 for the admin; `isSystemAdmin` false; an effective user holding `User.Impersonate` cannot start); real-user checks on start/stop (permission removed after start: next request ends the session, `DELETE` still 204); cookie tampering (flipped bit, truncated, other user's valid handle, empty, huge) = ignored and cleared, request runs as real user; replay after stop and after expiry; a valid cookie with a different `X-Dev-User` = ignored; cross-user cache leakage (admin dashboard, My Matters, notifications unread count and `ETag`, `/me`, ranker, search; three bodies differ and none contains the other's sentinel; `private, no-store` present); sensitive matter: the admin who sees S1 does not see it as a non-manager target and vice versa; no GET writes (checksum test); markers: target's `UserMatterActivitySeen`, notifications `ReadUtc`, `LastLoginAt`, availability and notification preferences identical before/after a full walk; audit: start/stop/expired exist exactly once with real, effective, IP; a refused write shows "by A as B"; the refusal audit is capped; clock-controlled expiry at 59:59 and 60:00 using `IClock`.

E2E (Playwright, IM-12): banner on My Work, a matter, the Admin pages, 403, 404, the pending-access page and the offline/connection page, on desktop and phone (360); axe at four widths with the banner on (and on the picker dialog); picker finds users, ineligible rows disabled with reason; write buttons disabled with the hint, and a forced write shows the read-only message; Stop returns to admin (menu, landing, bell refreshed, no stale name anywhere in DOM, storage, network); expiry (server clock shifted by the test host) shows the notice and announces it; keyboard: picker usable without a mouse, no new shortcut (registry file unchanged); initial bundle under 700 kB.

Performance: a request without the cookie is unchanged (no code path); with the cookie one primary-key read (about 0.2 ms) plus one cached snapshot; benchmark in IM-11 (budget: below +1 ms p95 on the read endpoints, within noise on the Task Queue at 20k tasks).

## 12. Rollout and runbook note (goes into `docs/runbook.md` in IM-13)

- No feature switch is needed: without the permission the feature does not exist for anyone but System Administrators. Optional emergency switch `Impersonation:Enabled` (default true, read at start, app pool recycle) lets an operator turn the feature off without a deploy (start returns 404, existing sessions end at their next request).
- Support: where to see who is viewing as whom now (`SELECT ... FROM dbo.ImpersonationSession WHERE EndedAtUtc IS NULL AND ExpiresAtUtc > SYSUTCDATETIME()`); how to end all (set `EndedAtUtc`, `EndReason='STOPPED'`); audit events and the "Viewed as" filter; the error code table (`IMPERSONATION_READ_ONLY`, `IMPERSONATION_TARGET_INELIGIBLE`); what the user sees if their cookie expired.
- Multi-node: nothing node-local; the effective snapshot may lag a role change by at most `Authorization:CacheSeconds` (60 s), as for any request.
- Privacy statement for the firm: view-as is read-only and audited; a System Administrator can already see all data in the database, but the audit trail now shows when an admin looked through another person's eyes.
- Rollback: remove the permission from the role; sessions end at their next request. The table and columns are additive; nothing to undo.

## 13. Interaction with other work

- **Sensitive matters (#788):** the effective user's visibility applies. A System Administrator sees every sensitive matter in their own view but only the target's in view-as. Tests in IM-11.
- **Reports (#671, postponed):** the Reports module runs queries with a separate read-only login and has write-like operations (run rows, saved reports, results). While impersonating, report runs and saves are writes and are refused; report results use the report login, not `ICurrentUser`, so "report as the target" does not exist and the Reports epic must decide whether view-as may open the Reports screens at all (recommendation: yes, read-only, with the same unfiltered caveat as addendum AI item 6). Tracked by IM-14.
- **Notifications (#753):** polling stays GET and must never touch `ReadUtc`; R17 to R20.
- **PM experience (#758):** "Since your last visit" is the marker never moved by view-as (R14 to R16); fixing the first-read insert (R14) is the one behaviour change.
- **Shortcuts (#420):** nothing added to `shortcut-registry.ts`.

## 14. Open questions for the owner (recommended answers)

| # | Question | Recommendation |
|---|---|---|
| Q1 | A non-admin role holding `User.Impersonate` can see any non-admin's data (including sensitive matters the holder could not see). Accept, with the Roles screen warning? | Yes; keep it admin-only by default; the warning mirrors `Matter.ViewSensitive`. |
| Q2 | Tell the target? (no notice by default; audit only) | No notice now; the audit is visible to `Audit.View` holders. Add a notification later if the firm wants transparency. |
| Q3 | May View as open Reports screens (read-only) once Reports is built? | Decide in the Reports epic; until then Reports are refused while impersonating. |
| Q4 | Should an admin need to type a reason when starting (audited text)? | Not now (adds friction); easy to add to the start body later. |
| Q5 | Several tabs share one browser cookie, so starting in one tab shows the banner in all after their next request. Acceptable? | Yes; per-tab impersonation is option C and not worth the weaker security. |
| Q6 | Downloads/exports (GET) while impersonating are allowed. OK? | Yes (read-only); they are logged with both ids. |
