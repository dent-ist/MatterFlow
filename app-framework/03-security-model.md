# 03 Security model

Related: `docs/architecture.md` 6 and 9, `docs/qa/security-review-1-resolutions.md` (SEC-04 audit guard, SEC-08 headers, SEC-10 Dev auth), `docs/qa/security-review-2-resolutions.md`, `docs/requirements/decisions-addendum.md` (C no attachments, E, F).

## 1. Trust assumption

**Assumption: trusted internal authors.** MatterFlow is internal and firm-wide; every app is built and published by the owner's own team; there are no customers, external publishers, marketplace or tenants. The framework is therefore designed against **accidents and insider/compromise scenarios**, not against anonymous hostile publishers.

## 2. What the controls are for

| Realistic risk | Primary controls |
|---|---|
| Buggy app (XSS, bad parsing, infinite loop) | Sandbox CSP + opaque origin; no ambient credentials; job-object limits; request timeouts and size caps |
| Vulnerable npm/NuGet dependency in an app | Same sandbox (a compromised dependency in the front end has no more power than the app); dependency report in the wizard; per-app account with no network; allow-listed roots |
| Compromised developer account | Developers cannot publish (System Admin only); approval + hash review; optional second approver; audit |
| Compromised System Admin account | Audit (append-only), hash and delta review, optional second approver, `App.Manage` not delegable by default; residual risk accepted (a System Admin already owns MatterFlow) |
| Mistaken scope/root/connector request | Explicit permission review step with delta; least privilege defaults; roots are bound by admin, never named in the package |
| Leaked secret | Secrets only in `AppSecret` (encrypted), never in packages (scan), never returned to the browser, masked in logs |
| Confused deputy on file access | Role-based root grants + optional ACL probe + audit + quotas (section 6) |
| Resource exhaustion by a bug | Job objects (memory/CPU/process), per-app rate limits, body limits, connection caps, crash-loop breaker |
| Phishing-style misuse of the launch endpoint | No redirect parameter, Fetch-Metadata checks, token in fragment, 60 s one-time, audit, GET shows interstitial for cross-site initiators |

## 3. Assets, actors, trust boundaries

| Asset | Where | Why it matters |
|---|---|---|
| MatterFlow data (tasks, matters, comments, audit) | SQL Server | Firm-sensitive; no client documents (addendum C) |
| User identity / launch authority | Windows auth, `AppUser` | Impersonation of users |
| Signing keys | `AppSigningKey` (private key encrypted) | Forge launch tokens |
| Connector credentials (Harvey) | `Connector` secret (encrypted) | Access to the document system |
| Network folders | File roots | Bulk client documents live there (outside MatterFlow) |
| App secrets/config | `AppSecret`, `AppConfig` | Per-app credentials |
| The server | Windows Server | Everything else |

Actors: **User** (any signed-in, role-granted), **System Admin** (publishes), **Developer** (builds; cannot publish), **App front end** (untrusted-by-default JS in a sandbox), **App back end** (semi-trusted process in a per-app account), **IT operator** (installs services), **Attacker** (a malicious page on the intranet, a compromised account, a stolen token).

```mermaid
flowchart LR
  subgraph T1[Trust zone 1: MatterFlow web, Windows auth]
    API[/api]
  end
  subgraph T2[Zone 2: Gateway, token auth only]
    GW[/apps/*]
  end
  subgraph T3[Zone 3: sandboxed front end, opaque origin]
    FE[App JS]
  end
  subgraph T4[Zone 4: App Host back ends, per-app account, loopback only]
    BE[App back end]
  end
  subgraph T5[Zone 5: File Broker and connectors]
    FB[File Broker]
    CN[Connector runtime]
  end
  FE -. no creds .-> API
  FE -->|bearer session| GW
  GW -->|identity assertion| BE
  GW -->|signed service request| FB
  GW --> CN
```

Boundaries that matter: (1) browser <-> IIS (TLS, Windows auth for `/api`, token for `/apps`); (2) sandbox <-> MatterFlow origin (CSP sandbox); (3) web process <-> App Host (localhost, mutual signature); (4) back end <-> everything else (account, firewall, ACLs).

## 4. STRIDE threat model

Likelihood (L) and impact (I): H/M/L. "Residual" is what remains after the mitigations.

| ID | Threat | STRIDE | L/I | Mitigations | Residual |
|---|---|---|---|---|---|
| T-01 | Malicious or buggy app front end reads MatterFlow data via ambient Windows credentials (`fetch('/api/...')`) | E/I | M/H | Opaque origin; `/api` has no CORS and needs `X-MatterFlow-Client` (preflight fails); `/apps` anonymous so credentials are never attached; `connect-src` path-limited; COOP + noopener | Browser bugs in sandbox; mitigated by patching; low |
| T-02 | Malicious zip: zip-slip, symlink, bomb | T/D/E | M/H | V1-V5 validation; extraction by own code, normalised paths, final path check, no reparse; caps; staging cleaned; extraction by a service with write only to `\apps` | Low |
| T-03 | Malicious or vulnerable code in a back end | E/T | M/H | Per-app account, no network (firewall by account to loopback), job object, read-only code dir, writable only own data; framework-dependent .NET only; reviewed and hashed; admin approval | Medium: it can abuse platform services it was granted. Keep grants minimal |
| T-04 | XSS inside an app | T/I | H/L | Sandbox makes XSS app-local: no cookies, no MatterFlow origin; session token only in memory (still stealable by XSS within that app, 15 min, scope-limited) | App-level data exposure for that user's session |
| T-05 | XSS in MatterFlow via manifest/metadata (name, description, icon) | T/E | M/H | Metadata rendered as text only (Angular binding), icon whitelist or sanitized SVG served from `/apps` sandboxed (never inlined); README not rendered as HTML | Low |
| T-06 | Launch token theft/replay | S/I | M/M | 60 s expiry, `jti` one-time redeem (unique index), audience = app, `nonce` echoed, token in URL fragment (not sent to server or Referer), cleared by `history.replaceState`; session token opaque, hashed at rest, 15 min idle / 8 h absolute, revocable | Token read by XSS in same app within window |
| T-07 | Forged launch/identity token | S/E | L/H | ES256 with private key encrypted at rest, `kid` rotation, algorithm pinned (reject `none`, HS*), `iss`/`aud`/`typ` checks | Key compromise = server compromise |
| T-08 | Confused deputy: app reads files the user could not | E/I | M/H | Root grants per app and role; optional ACL probe; read-only default; path canonicalisation; audit; quotas (section 6) | Without ACL probe: any user with the app sees everything in the granted root. Accept for small team; choose roots narrowly |
| T-09 | Path traversal / UNC / ADS tricks in file API | T/E | M/H | Root-relative paths only; reject `..`, `:`, device names, reparse points; verify final path with handle; case-insensitive compare; deny `\\?\` | Low |
| T-10 | SSRF via connectors or app `network.allowedOrigins` | T/I | M/H | Connector base URL fixed by admin; outbound only to that host; DNS resolve then block loopback/link-local/metadata ranges unless connector allow-list explicitly lists; no redirects followed across hosts; app cannot pass URLs to connectors | Low |
| T-11 | Secret leakage (logs, errors, browser, packages) | I | M/H | `AppSecret` encrypted (ASP.NET Data Protection with machine key ring protected by DPAPI + ACL); never returned (write-only API, shows "set"); redaction in logs (`docs/architecture.md` 17); secret scan at upload; backend receives secrets only via App Host handshake | Back end can log its own secret; guideline + log scrubber on App Host capture |
| T-12 | Resource exhaustion (CPU, memory, disk, sockets, upload flood) | D | H/M | Job object limits; per-app body/timeouts; rate limits per session and IP; disk quota on `\apps-data`; max concurrent proxied requests per app; crash-loop breaker | Noisy neighbour on shared server; monitor |
| T-13 | Supply chain: compromised NuGet/npm dependency | T/E | M/H | `deps.json`/lockfile report, pinned versions, `npm ci`; dependencies bundled at build; sandbox/per-app account limit blast radius; optional AV; Dependabot on app repos | Medium; same as any internal software |
| T-14 | Privilege escalation via `App.Manage` | E | L/H | System Admin only by default; `User.Manage`/`Role.Manage` holders cannot grant it (SEC-01 rule: cannot grant above own level); audited; if delegated: reviewers get a "can run code on the server" warning; recommended to keep with System Admin | A delegated holder can publish code that runs on the server |
| T-15 | Cross-app access (app A calls app B's API or reads its data) | E/I | M/M | Session token bound to one app (`aud`); gateway checks slug = session app; per-app accounts and ACLs on `\apps-data`; loopback ports are not reachable except by App Host/gateway (Windows Firewall rule + bind 127.0.0.1 + identity assertion required) | Fallback shared-account mode (L1) weakens file isolation |
| T-16 | Clickjacking | S/T | L/M | `frame-ancestors 'none'`, `X-Frame-Options: DENY` on `/apps`; MatterFlow already denies framing | Low |
| T-17 | Open redirect / phishing via launch endpoint | S | M/M | Launch takes only AppCode and numeric/known ids; redirect target built server-side from the slug; no `returnUrl`; cross-site initiated (`Sec-Fetch-Site: cross-site`) gets an interstitial "Open <App>?" page; `Sec-Fetch-Dest` must be `document` | Social engineering of a user clicking a hostile link that targets a real app: the app opens only with that user's own authority |
| T-18 | Log injection (CRLF, ANSI, huge lines) in captured app logs and gateway logs | T/R | M/L | Structured logging; strip control chars; max line 8 KB; admin UI shows logs as text; app-supplied strings never logged raw | Low |
| T-19 | Repudiation: "who published/launched/read this?" | R | M/M | Audit (section 8): append-only, correlation ids, actor + app + task + step | Audit table is only DENY-protected against `mf_app`; DBAs can alter (existing limitation, SEC-04) |
| T-20 | Delegated token abuse (Phase 4): app calls MatterFlow more than the user intended | E | M/H | Scopes ∩ user permissions ∩ approved scopes ∩ bound task/step; 5 min TTL; audit "<user> via <app>"; per-app rate limits; no scope grants Task creation or admin | Medium; limited by the narrow facade |
| T-21 | Replay/forgery of service requests between web and App Host / File Broker | S/T | L/H | Loopback only; HMAC/JWT signed requests with 30 s `iat`, per-service key from DPAPI-protected file readable only by the two accounts; reject non-loopback | Local admin can read keys (same as everything) |
| T-22 | Static front-end code readable by anyone who knows a slug (S1 decision) | I | M/L | No secrets by contract and scan; slugs not listed publicly; `Cache-Control` | Accepted; option Q-S1 capability path |
| T-23 | Stale permission: user's role removed but session lives | E | M/M | Gateway re-checks role grant on session create, refresh and every proxied call (cached 30 s); disable app kills sessions immediately | Up to 30 s |
| T-24 | Anonymous `/apps` location widens the IIS attack surface | S/D | M/M | Gateway rejects everything without token except static/JWKS; path guard; rate limit; per-IP connection caps; same process hardening as the API | Medium; unauthenticated static serving of package front ends. Penetration test item |
| T-25 | Data persistence by an app (client data written to disk) | I | M/M | Policy: apps store no client data beyond job metadata (addendum C); data folder quota; `08` do/don't; periodic review | Policy-only for back ends |

## 5. Sandbox header details

See `01-architecture.md` section 6. Key points: applied to every response in `/apps/*`; no `allow-same-origin`, no `allow-top-navigation`, no `allow-popups-to-escape-sandbox`, no `allow-pointer-lock`; `allow-modals` for confirm dialogs; `allow-downloads` for generated files. **The MatterFlow shell CSP is unchanged** (`SecurityHeadersMiddleware.AppContentSecurityPolicy`); the only shell change is none in window mode (a future `embedded` mode adds `frame-src https://<host>/apps/`). Tests assert these headers on 200, 304, 404, 500 and proxied responses.

## 6. File access: model comparison and confused deputy

| | Model 1: act as the signed-in user | Model 2: allow-listed roots via File Broker (**chosen for release 1**) |
|---|---|---|
| How | Impersonate the user (Kerberos constrained delegation / protocol transition) when touching the share | Broker account `svc-mf-files` reads/writes only inside admin-defined roots |
| Fidelity | Best: NTFS ACLs decide, no confused deputy | Coarser: rights = root grants for app and role; optional ACL probe |
| IT effort | **High**: delegation config in AD for the service, SPNs for each file server, protocol transition rights | **Low**: one service account with NTFS read (write where needed) on chosen shares |
| Risk | Delegation misconfiguration is a classic AD hole | Confused deputy: "the server can read anything in the root" |
| Fit | Later phase if IT agrees | Now |

**Confused-deputy mitigation (model 2):** (1) roots are narrow and admin-bound per app (`AppFileRootGrant`) (role access to the app itself is the `AppRoleGrant`); (2) read-only unless the manifest asks for write and an admin approves; (3) the broker verifies every path against the root with final-path resolution; (4) **ACL probe** (optional per root): the broker builds an identification-level token for the user (S4U via `WindowsIdentity(upn)`), evaluates the file's security descriptor with `AuthzAccessCheck`, and denies if the user could not read it directly; if the probe cannot run (AD unreachable, S4U not allowed) behaviour is per root: `fail-closed` (default) or `fall-back-to-grant`; (5) every list/read/upload is audited with user, app, root, relative path, bytes; (6) quotas: bytes and files per user per day per app, concurrent streams; (7) no raw path ever returned to the app: opaque `fileRef` handles per session. > **IT dependency:** the probe needs the web/broker account to resolve user token groups from AD (read access) and the broker account to have NTFS read on the roots.

## 7. Token design, key management, secrets (summary; `04` has the protocol)

- **Keys:** ES256 (P-256) key pairs in `AppSigningKey` (`Kid`, public JWK, private key encrypted with ASP.NET Core Data Protection, key ring in the database `DataProtectionKeys` table or file share protected by DPAPI machine scope; **IT dependency: choose where the key ring lives** (a single IIS node: local machine scope is enough). New key every 90 days (`Apps:KeyRotationDays`), published in JWKS immediately, used for signing after 24 h, old key stays in JWKS for the max token lifetime (8 h + margin 24 h) then retires. Emergency rotation: admin button "Revoke signing key" invalidates all sessions.
- **Secrets storage:** `AppSecret.ValueProtected varbinary(max)` (Data Protection purpose `MatterFlow.Apps.Secret.v1.<AppId>.<Key>`), connector credentials likewise; no plaintext in the database, logs or audit (audit stores key name and "changed" only). Back ends get secrets from the App Host at start over a one-time named-pipe handshake; the App Host never writes them to disk in plaintext.
- **Database identities:** unchanged: the web app uses `mf_app` (`docs/runbook.md` 5.2); the new audit tables get the same `INSERT, SELECT` + `DENY UPDATE, DELETE` pattern as `dbo.AuditEvent` (script in `05`), and `AuditStoreGuard` is extended to check them.

## 8. Audit design

| Event | Where | Fields |
|---|---|---|
| `APP_PACKAGE_UPLOADED`, `APP_VERSION_VALIDATED`/`REJECTED`, `APP_VERSION_APPROVED`, `APP_VERSION_ACTIVATED`, `APP_VERSION_ROLLED_BACK`, `APP_ENABLED`, `APP_DISABLED`, `APP_REMOVED`, `APP_ROLE_GRANTED`/`REVOKED`, `APP_CONFIG_CHANGED`, `APP_SECRET_CHANGED` (name only), `APP_KEY_ROTATED`, `APP_ROOT_BOUND`, `APP_CONNECTOR_BOUND` | `AuditEvent` (existing, same transaction) | actor, `ObjectType=App`, `ObjectId`, SHA-256 of package, version, delta summary |
| `APP_LAUNCHED` | `AppLaunchAudit` + `AuditEvent` when a task is involved (shows in the task Activity tab) | user, app, version, task, step, matter ref, source (`LAUNCHER`/`TASK`/`STEP`), result (`OK`, `DENIED_ROLE`, `DENIED_DISABLED`, ...) |
| `APP_FILE_LIST`/`READ`/`UPLOAD`, `APP_CONNECTOR_CALL`, `APP_CALLBACK`, `APP_JOB_*` | `AppServiceAudit` | user, app, task, step, service, operation, target (root + relative path or vault id), bytes, outcome, duration |

Both new audit tables are append-only for `mf_app`. Usage counts (`AppUsageDaily`: app, day, launches, distinct users) are derived; **no per-person report exists in the UI** (addendum: no performance metrics); raw rows are for security review (`Audit.View`). Retention: same as `AuditEvent` (indefinite, addendum O).

## 9. Assumptions to revisit if the trust model changes

External publishers or apps from other teams: (a) turn on `Apps:RequireSecondApprover`, publisher identity and signing; (b) mandatory scanner and dependency policy gates; (c) move to AppContainer/separate VMs and a separate sandbox origin (own DNS name/certificate) so that a browser sandbox bypass is not fatal; (d) per-publisher quotas; (e) drop S1 (authorize static files); (f) remove on-demand code execution on the web server's host; (g) legal/contract review of data handling. Adding another **internal** team only needs: grant `App.Manage` (or a future `App.Publish` split) and tell them the rules.

## 10. Security test plan and independent review

| Area | Tests |
|---|---|
| Headers | Automated: every response class under `/apps/*` has the exact CSP/sandbox, nosniff, XFO; SVG/HTML inside a package opened top-level is sandboxed; `/api` unchanged |
| Isolation (browser, Playwright) | App page tries `fetch('/api/v1/me')`, reads `document.cookie`, `localStorage`, `window.opener`, `parent`, `top`: all fail/blocked; MatterFlow `X-MatterFlow-Client` call fails |
| Package | Zip-slip, symlink, bomb, forbidden extension, huge manifest, duplicate entries, case-collision (`A.js`/`a.js`), unicode normalisation, reserved names: all rejected, nothing written outside staging |
| Tokens | Expired, wrong `aud`, wrong `iss`, `alg=none`, HS256 with public key as secret, replayed `jti`, tampered claims, rotated key, revoked key |
| Authorization | Role without grant; grant removed mid-session; disabled app; step link to disabled app; launching with a task the user cannot view; cross-app session use |
| Files | `..`, `%2e%2e`, UNC, ADS, symlink/junction out of root, 8.3 short names, long paths, TOCTOU swap during stream, ACL probe deny |
| Connectors | SSRF to metadata/loopback/other host, redirect following, error message leakage, rate limit |
| Resource | Memory bomb, fork bomb, infinite loop, giant upload, slow-loris, crash loop: limits hold and host stays responsive |
| App Host | Spoofed control request, port squatting, config tampering, log injection |
| Audit | Every action in section 8 produces a row; `mf_app` cannot update/delete; `AuditStoreGuard` covers new tables |

An **independent review before Phase 1 release** must verify: sandbox effectiveness in the real IIS/Edge/Chrome setup including the anonymous location (T-01, T-24); token validation and one-time redemption (T-06, T-07); package extraction code (T-02); that `/api` behaviour did not change; the permission model (T-14, T-23). Before Phase 2 release: process isolation and firewalling (T-03, T-15, T-21). Before Phase 3: file service and connectors (T-08, T-09, T-10). Before Phase 4: delegated tokens (T-20).
