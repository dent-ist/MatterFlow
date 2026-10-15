# 04 Launch, identity and tokens

Related: `docs/architecture.md` 6.1 (resolver, `ICurrentUser`), 6.6 (CSRF guard), `01-architecture.md` sections 3 and 6, `03-security-model.md` T-06, T-07, T-17, T-20.

## 1. Token types at a glance

| Token | Form | Lifetime | Issued by / to | Used for |
|---|---|---|---|---|
| **Launch token** | JWT ES256, `typ=mf-launch+jwt` | 60 s, one-time | Launch endpoint -> app front end (URL fragment) | Prove "this user opened this app now" |
| **Session token** | Opaque random 256-bit, stored as SHA-256 hash in `AppSession` | 15 min idle, 8 h absolute, refreshable, revocable | Gateway `POST /apps/_mf/session` -> front end (memory) | Authenticate calls to `/apps/<slug>/api/*` and `/apps/_mf/v1/*` |
| **Identity assertion** | JWT ES256, `typ=mf-identity+jwt` | 120 s | Gateway -> app back end (`X-MF-Identity` header) | Back end learns who is calling |
| **Service token** | Opaque, hashed at rest | 10 min | Gateway -> back end (`X-MF-Service-Token`), only if the app is approved for platform services | Back end calls file/connector/job services on behalf of the user |
| **Delegated token** (Phase 4) | JWT ES256, `typ=mf-delegated+jwt` | 5 min | `POST /apps/_mf/v1/token` | Calls to the Callback API |

Algorithm: **ES256** (compact, widely supported by `System.IdentityModel.Tokens.Jwt`/`jose`). RS256 is accepted in the validation helper only if a future partner library needs it; the server always signs ES256. `alg` is pinned by the validator; `none` and `HS*` are rejected.

## 2. Launch flow

```mermaid
sequenceDiagram
  autonumber
  participant U as User in MatterFlow (Windows auth)
  participant API as /api/v1/apps/{code}/launch
  participant W as New window (app)
  participant GW as Gateway /apps/_mf/session
  participant BE as App back end
  U->>API: click link (target=_blank, rel=noopener) GET ?task=TSK-1234&step=981
  API->>API: Windows user -> ICurrentUser; check Sec-Fetch-*; App.Launch + AppRoleGrant; app ENABLED; task.View; step belongs to task; AppStepLink exists
  API->>API: audit APP_LAUNCHED; mint launch token (jti, nonce)
  API-->>W: 302 Location /apps/md-convert/#mf_launch=eyJ...
  W->>GW: GET /apps/md-convert/ (no fragment sent) -> index.html + sandbox headers
  W->>W: read location.hash, history.replaceState (remove token)
  W->>GW: POST /apps/_mf/session {launchToken} (Origin: null)
  GW->>GW: verify sig/exp/aud/iss; INSERT AppSession(LaunchJti UNIQUE) ; re-check grants
  GW-->>W: {sessionToken, expiresIn, user, context}
  W->>GW: calls with Authorization: Bearer <sessionToken>
  GW->>BE: proxied with X-MF-Identity
```

### Why a real link

The link is an ordinary `<a href target="_blank" rel="noopener noreferrer">`, so the browser treats it as user-initiated navigation: popup blockers do not apply (no `window.open` after an async call), middle-click and "open in new tab" work, and the URL can be copied. A click on a link whose app is disabled shows the disabled-app page in the new window, not a silent failure.

### Launch endpoint rules

`GET /api/v1/apps/{code}/launch?task=<TSK-n>&step=<stepInstanceId>`; both optional. Policy: authenticated + `Perm:App.Launch` + `AppRoleGrant`. Fetch-Metadata: `Sec-Fetch-Dest` must be `document` and `Sec-Fetch-Site` in `same-origin|none` (a click inside MatterFlow, or a typed/bookmarked URL). `cross-site` -> HTML interstitial "Open <App name>? You were sent here from another site" with a button that performs the same-origin GET (defeats silent drive-by launches and phishing links that look like MatterFlow links). **No `returnUrl`, no `redirect`, no free text**: the redirect is built from the stored slug (open-redirect safe). Unknown `task`/`step` -> 404; no `Task.View` -> 403; step not linked to this app -> 400 `STEP_APP_MISMATCH`; app disabled -> 409 `APP_DISABLED` (the UI also greys the button and says why). Step must be on a task whose workflow version links the app; for a launcher launch (no task) the `matter`, `task` and `step` claims are absent.

## 3. Launch token claims

```json
{
  "iss": "https://matterflow.firm.local",
  "aud": "app:harvey-uploader",
  "sub": "mf-user:1042",
  "typ": "mf-launch+jwt",
  "iat": 1760524800,
  "nbf": 1760524800,
  "exp": 1760524860,
  "jti": "0b8cba5c-6e0e-4b7e-9f02-2f6f1a7d9a31",
  "nonce": "x3f9Yq1L0w",
  "preferred_username": "KE\\jsmith",
  "name": "Jane Smith",
  "email": "jane.smith@firm.example",
  "matter": "00154-00001",
  "task": "TSK-1234",
  "step": "981",
  "app_ver": "1.2.0",
  "mode": "window",
  "src": "step"
}
```

Header: `{"alg":"ES256","typ":"mf-launch+jwt","kid":"2026-10-a"}`. Rules: only the claims the manifest requested (`context`) and the admin approved are included (`email` only if requested and known; `matter`, `task`, `step` only when launched from a task/step). `sub` is the stable MatterFlow user id (not the SID). **Nothing else** is passed: no client name, no task title, no description (MatterFlow holds no client data, but titles may contain names). `nonce` is generated by the launch endpoint and returned again in the session response; the front end checks it equals the token's (detects mix-ups). `iss` is the configured public base URL. Matter number format: five digits, hyphen, five digits (`docs/requirements/decisions-addendum.md` B).

## 4. JWKS and key rotation

`GET /apps/_mf/jwks.json` (public, cacheable `max-age=300`):

```json
{ "keys": [
  { "kty": "EC", "crv": "P-256", "use": "sig", "alg": "ES256", "kid": "2026-10-a", "x": "...", "y": "..." },
  { "kty": "EC", "crv": "P-256", "use": "sig", "alg": "ES256", "kid": "2026-07-a", "x": "...", "y": "..." }
] }
```

Rotation (`AppSigningKey.Status`: `PENDING` -> `ACTIVE` -> `RETIRING` -> `RETIRED`): a new key is generated 24 h before use and published as `PENDING`; it becomes `ACTIVE` (signs) on schedule; the previous key goes `RETIRING` (still in JWKS) for the longest lifetime of anything it signed (identity assertions 2 min, launch 60 s; margin 24 h); then `RETIRED` (removed). Clients cache JWKS for 5 min and refetch once on an unknown `kid`. Emergency: `POST /api/v1/admin/apps/keys/{kid}/revoke` removes the key at once and revokes sessions.

## 5. Session handling inside the app

1. The front end calls `POST /apps/_mf/session` with `{ "launchToken": "..." }`. The gateway verifies the token, enforces one-time use by inserting `AppSession.LaunchJti` (unique), re-checks grants and app state, and returns:

```json
{ "sessionToken": "mfs_5Qk...", "expiresInSeconds": 900, "absoluteExpiresAt": "2026-10-15T22:00:00Z",
  "nonce": "x3f9Yq1L0w",
  "user": { "id": "mf-user:1042", "account": "KE\\jsmith", "displayName": "Jane Smith", "email": "jane.smith@firm.example" },
  "context": { "matter": "00154-00001", "task": "TSK-1234", "step": "981", "source": "step" },
  "app": { "code": "harvey-uploader", "version": "1.2.0" } }
```

2. The token is kept **in a JavaScript variable only** (the sandbox has no storage anyway). Reloading the window loses it, so the app shows "Session ended, open this app again from MatterFlow". The app may also offer a link to the launch URL `/api/v1/apps/<code>/launch?...` (same task and step ids from the context it holds) that navigates its own window (`target=_self`; navigating itself is allowed in the sandbox) and restores a session silently, because Windows sign-in is silent.
3. **Refresh:** `POST /apps/_mf/session/refresh` (bearer session) extends the idle timer up to the absolute limit; the gateway re-checks role grants. The app refreshes at 80% of idle time while the user is active.
4. **Logout / close:** `DELETE /apps/_mf/session` revokes immediately (`pagehide` handler uses `fetch(..., {keepalive:true})`). Disabling an app or removing a role grant revokes sessions of that app / role holders within 30 s.
5. A front-end-only app that does not need verified identity may ignore the session endpoint and just decode the launch token for display; any app that stores or acts on identity must redeem the token (the SDK does it by default).

### Back ends validate the identity assertion

`X-MF-Identity` carries `iss, aud=app:<code>, sub, preferred_username, name, email?, matter?, task?, step?, session_id (opaque id, not the token), iat, exp (120 s), jti`. The back end validates signature (JWKS), `aud` equals its own code, `exp`, and rejects requests without the header (the gateway is the only caller; the loopback port is firewalled). Samples are in `08` section 4.

## 6. Delegated API tokens (Phase 4, designed now)

Purpose: an app can send output back into MatterFlow (comment, form value, complete a step) **as the launching user**.

### Why ambient Windows credentials must not reach the app

If the sandbox were relaxed so that app pages could call `/api` with the browser's Windows credentials, any bug or compromised dependency in the app would act as the user with **all** of the user's rights, without a trace of which app did it, with CSRF guard bypass risk and no narrowing. Instead: the app gets a token that is narrower than the user (scopes), shorter-lived, bound to one task/step, and audited as `"<user> via <app>"`.

### Flow

```mermaid
sequenceDiagram
  participant F as App front end or back end
  participant GW as Gateway /apps/_mf/v1
  participant APP as Application services (Task, Workflow)
  F->>GW: POST /apps/_mf/v1/token  Bearer session (or X-MF-Service-Token), {scopes:["comments:write"]}
  GW->>GW: scopes subset of manifest scopes approved by admin; context has task/step; user still permitted
  GW-->>F: {accessToken (JWT, 5 min), scope, taskRef, stepId}
  F->>GW: POST /apps/_mf/v1/callbacks/tasks/TSK-1234/comments  Bearer delegated
  GW->>GW: verify; scope; bound task; Perm check as the USER (Task.Comment)
  GW->>APP: AddComment(actor=user, via=app)
  APP-->>GW: ok  (AuditEvent: actor user, summary "... via Harvey vault uploader")
```

Claims: `iss`, `aud=matterflow-callbacks`, `sub=mf-user:1042`, `act={"sub":"app:harvey-uploader"}` (RFC 8693 actor), `scope`, `task`, `step`, `exp` (5 min), `jti`. **Effective authority = approved scopes ∩ requested scopes ∩ user's current permissions ∩ bound task/step.** Tokens cannot be exchanged for broader ones and carry no refresh.

### New Bearer scheme and CSRF

The Callback API is a separate authentication scheme `AppDelegated` registered only for the `/apps/_mf/v1/callbacks` branch (IIS anonymous). It is **exempt from `RequestForgeryGuard` / the `X-MatterFlow-Client` rule** because there are no ambient credentials to forge: protection is the bearer token itself, `Origin` must be absent or `null`, `Content-Type: application/json`, `Sec-Fetch-Site` not `cross-site` for browser callers, body <= 256 KB, per-app and per-user rate limits (default 60/min), idempotency key header for POSTs (`Idempotency-Key`), and an allow-list of operations (the facade is not the full `/api`). The main `/api` never accepts these tokens.

### Scope catalogue (draft)

| Scope | Endpoint | Maps to policy (user must hold) | Notes |
|---|---|---|---|
| `task:read` | `GET .../callbacks/tasks/{ref}` | `Perm:Task.View` | Minimal DTO: ref, status, matter ref, due; no titles |
| `step:read` | `GET .../steps/{id}` | `Perm:Task.View` | state and inputs of the bound step |
| `comments:write` | `POST .../tasks/{ref}/comments` | `Perm:Task.Comment` | sanitized like UI comments (addendum D) |
| `form-values:write` | `PATCH .../steps/{id}/values` | `Perm:Workflow.Execute` | only keys of the step form; validated by the form engine |
| `step:complete` | `POST .../steps/{id}/complete` | `Perm:Workflow.Execute` | same validation as UI (inputs, order) |

Not offered: task creation, assignment, status change, user/role data, search. Adding a scope = new catalogue entry, new tests, new review.
