# 10 Open questions

Each question has a recommendation and the consequence of choosing differently. **BLOCKER** = must be answered before the named phase can start. Assumptions: the trusted-internal-authors model in `README.md` section 2 (so no questions about external publishers, pricing or marketplace).

## A. IT and hosting

| ID | Question | Recommendation | Consequence if different |
|---|---|---|---|
| Q-IIS **BLOCKER (Phase 1)** | May the `/apps` location on the Windows-auth site allow Anonymous authentication (gateway authenticates by token)? | Yes. It gives isolation from ambient credentials and makes sandboxed `fetch` work. | Otherwise mode B (credentialed CORS from `null`; weaker, fragile) or a second host name/certificate (the thing path hosting avoids). |
| Q-ROUTE | Keep the launcher route `/apps` (served unauthenticated at IIS because of the location) or rename it `/tools`? | Keep `/apps` (the shell holds no data). | Rename costs one route and menu text. |
| Q-ACC **BLOCKER (Phase 2)** | Per-app local accounts created by IT with `Register-MfApp.ps1` (two-key), or created automatically by the App Host under a delegated right? | IT script for now (few apps). | Automatic creation needs a privileged component (risk) but removes IT toil; shared-account tier L1 is a weaker fallback. |
| Q-HOST | App Host account: gMSA or local virtual account? Which server (same as IIS)? | Same server, virtual account if single server; gMSA if IT standard. | gMSA needs AD admin steps. |
| Q-PORT | Loopback port range 51000-51499 acceptable? | Yes. | Change `Apps:PortRange`. |
| Q-BACKUP | Back up `\apps` and `\apps-data` and the Data Protection key ring? | Yes, with the server backup; key ring with the database backup. | Without it, rebuild apps from packages and lose app data and secrets. |
| Q-DP | Where does the Data Protection key ring live (database table vs protected file share)? | Database (`DataProtectionKeys`), protected by DPAPI machine scope, backed up with SQL. | File share needs ACLs/IT. |
| Q-WS | Install IIS WebSocket Protocol? | Only when an app needs it. | Apps with live push use polling meanwhile. |
| Q-TLS | Certificates | Not needed (path-based hosting, same host name). | n/a |

## B. Security and trust

| ID | Question | Recommendation | Consequence |
|---|---|---|---|
| Q-FILE **BLOCKER (Phase 3)** | File model 1 (act as the user, Kerberos constrained delegation) or 2 (allow-listed roots through the File Broker)? | Model 2 for release 1; evaluate model 1 once IT can scope delegation. | Model 1 first delays Phase 3 by IT/AD work and a bigger audit surface. |
| Q-PROBE | Enable the per-user ACL probe where possible? | Yes for roots holding matter documents, fail-closed; needs AD read. | Without it: root grants only; confused-deputy residual accepted per root. |
| Q-S1 | Authorize static front-end files per request (capability path `/apps/<slug>/s/<session>/`) instead of public-within-intranet? | No for release 1 (no secrets in front ends; cheaper). | Yes costs ugly URLs and complexity; consider if apps embed sensitive reference data. |
| Q-APPR | Two-person approval | Off by default (`Apps:RequireSecondApprover`); turn on when a second System Admin exists and especially when another team publishes. | On: every activation needs a second System Admin. |
| Q-AV | Antivirus scanning of packages | Optional hook, off by default; enable Defender scan (`MpCmdRun`) once IT confirms it can run under the web account. | None functionally. |
| Q-SIGN | Package signing | SHA-256 shown in wizard and audit (default); optional internal Ed25519 signature later. No PKI. | A PKI adds IT work without benefit for an internal team. |
| Q-PUB | Who may hold `App.Manage`? | System Admin only. If another internal team publishes: grant `App.Manage` (or a later `App.Publish` split) + second approver. | Delegation = server-code-execution right; see `05` section 1 rule 2. |
| Q-REV | Who reviews packages? | The owner's team lead acts as reviewer; the System Admin who activates is the second pair of eyes when the setting is on. | None. |
| Q-DATA | May apps store data? | Yes in their own `\apps-data\<guid>\data` (files/SQLite). **No MatterFlow database access** and no client data beyond job metadata. | Own SQL databases need DBA provisioning per app; defer. |
| Q-SECRET | Per-app configuration ownership | The app's developer lists keys in the manifest; a System Admin enters values (write-only). | Developers holding secrets themselves is a leak risk. |

## C. Product and UX

| ID | Question | Recommendation | Consequence |
|---|---|---|---|
| Q-NAME | Name of the feature/menu item: "Apps" or "Tools"? | "Apps" (the owner's wording). | Cosmetic. |
| Q-DISP | Embedded display mode | Future only; window mode in release 1. | Embedded needs `frame-src` change and layout work. |
| Q-GATE | Can an app block step completion (for example "the step needs the Harvey upload first")? | No; apps never gate a step in release 1 (callbacks can complete a step). | Gating adds state and failure modes. |
| Q-STEPS | Max apps per step | 3. | Higher clutters the step. |
| Q-DEF | Apps the user cannot open but are linked | Hide the button and show an info line. | Showing disabled buttons could leak app names to unauthorised roles. |
| Q-CAT | Categories | Admin-editable list, default `Conversion, Transfer, Review, Utility, Other`. | n/a |
| Q-USAGE | Usage reporting | Counts per app and day (launches, distinct users); no per-person view. | Per-person reports conflict with the addendum on performance metrics. |
| Q-ENV | Test and production versions of the same app | Two registrations on two servers (or `x-test` code); no promotion tooling. | A promote-between-environments feature is Phase 5. |

## D. Runtime and operations

| ID | Question | Recommendation | Consequence |
|---|---|---|---|
| Q-RT | Back-end runtimes | .NET 10 framework-dependent only in release 1; Node/Python later by new `runtime` values and a runtime allow-list. | More runtimes = more IT installs and more attack surface. |
| Q-QUOTA | Default quotas (data 2 GB, 25 MB body, 20 GB/day per user) | As in `06`/`07`. | Tune after pilot. |
| Q-RET | Retention of app logs and `AppSession`/job rows | Logs 14 days; sessions 7 days; audit indefinite (same as `AuditEvent`, addendum O). | Longer log retention may keep content in logs. |
| Q-SUP | Support model | The owner's team; contact in the manifest; IT only for infrastructure. | n/a |
| Q-ROLL | Data compatibility on rollback | Developer responsibility (forward/backward-compatible files); rollback never touches `\apps-data`. | Automatic data snapshots are Phase 5. |
| Q-HARVEY **BLOCKER (Phase 3)** | Harvey API: auth method, per-user permissions, upload limits, sandbox tenant | Obtain Harvey API documentation and a test tenant; vault allow-list in connector config for release 1. | The sample and connector design change with the real API. |
| Q-MULTI | Multiple IIS nodes later? | Not now. The design stores sessions/keys in SQL, but the App Host/File Broker and `\apps` are per server; scale-out needs shared storage and a host per node. | Revisit if MatterFlow ever scales out. |
| Q-DEV | Who may run `mf-app push` | Only System Admins (it uses their Windows credentials). | Developers hand zips to a System Admin. |
| Q-ENT | Entra ID migration (architecture 6.2) | Identity claims use `AppUser.UserId` (`sub=mf-user:<id>`), so apps survive a provider switch; `preferred_username` changes format. | Apps must not key data on the account name. |
