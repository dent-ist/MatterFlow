# MatterFlow Apps: design documents

**Status:** DRAFT for product-owner review · **Date:** 2026-10-15 · **Branch:** dev · **Scope:** design only (no application code, no GitHub issues until the owner has reviewed this folder).
**Builds on:** `docs/architecture.md` (modular monolith, Windows auth, middleware, CSP, CSRF guard), `docs/requirements/decisions-addendum.md`, `docs/runbook.md`, `docs/erd.md`, `contracts/permissions.json`, `docs/qa/security-review-1-resolutions.md` and `-2-`.

## 1. Vision

MatterFlow gains a plug-in capability, **Apps**: small self-hosted web applications (a front end and, optionally, a back end) that the owner's team builds, a **System Admin** publishes, and firm users open from three places: a workflow **step** ("Open Harvey uploader"), a **task** (Apps panel) or the **Apps launcher page** (standalone tools such as `md-convert`, which turns a Markdown file into a PDF). Apps run on the same IIS server and under the same host name as MatterFlow (`https://<matterflow-host>/apps/<slug>`), so IT needs no new DNS names or certificates. MatterFlow gives each app the signed-in user's identity (never a second login), the Matter number and task/step context, and, where approved, **server-side platform services** that a browser cannot provide: reading allow-listed network folders and calling integrations such as Harvey with credentials the app never sees.

## 2. Trust assumption (read this first)

> **This design assumes trusted internal authors.** MatterFlow is an internal, firm-wide application; every app is written **and** published by the owner's own team; there are no customers, external publishers, third-party apps, marketplace or multi-tenant concerns.

We still keep defence in depth, because the realistic risks are not hostile strangers but: a buggy app, a vulnerable npm/NuGet dependency inside an app, a compromised developer or admin account, a mistaken scope or file-root request, a leaked secret, a confused deputy on file access, resource exhaustion by a bug, and a phishing-style misuse of the launch endpoint. What the controls are for is listed in `03-security-model.md` section 2.

**Assumptions that must be revisited if this ever changes** (external publishers, customer-facing use, apps from other teams): mandatory two-person approval and code review; package signing with a PKI and publisher identities; mandatory antivirus/static analysis; stronger process isolation (per-app AppContainer or separate hosts); per-publisher quotas and rate limits; moving the sandbox host to a separate origin (own DNS name and certificate); removing "admin sees plain permission request list" in favour of a policy engine. The full list is `03-security-model.md` section 9. Letting **another internal team** publish apps is deliberately a **process/configuration change** (who holds `App.Manage`, optionally the second-approver setting) and not a redesign.

## 3. Documents

| # | File | Purpose |
|---|---|---|
| 1 | [01-architecture.md](01-architecture.md) | Components, storage layout, request flows, middleware order, exact `/apps/*` headers, IIS notes |
| 2 | [02-package-format.md](02-package-format.md) | Zip layout, `app.json` manifest and JSON Schema, examples, validation, versioning, packaging CLI |
| 3 | [03-security-model.md](03-security-model.md) | Assets, actors, trust boundaries, STRIDE threat model, keys, secrets, audit, security test plan |
| 4 | [04-launch-identity-and-tokens.md](04-launch-identity-and-tokens.md) | Launch flow, JWT claims, JWKS, sessions, delegated tokens (later phase) |
| 5 | [05-permissions-ux-and-admin.md](05-permissions-ux-and-admin.md) | SQL table drafts, role matrix, wireframes, workflow links, ERD additions |
| 6 | [06-hosting-and-app-host.md](06-hosting-and-app-host.md) | App Host Windows service, accounts, limits, IIS/YARP, what IT installs |
| 7 | [07-platform-services-and-api.md](07-platform-services-and-api.md) | File service, connectors (Harvey), jobs, callback API, OpenAPI sketches |
| 8 | [08-developer-guide-and-samples.md](08-developer-guide-and-samples.md) | Template, local dev, token validation snippets, walkthroughs, sandbox limits |
| 9 | [09-phases-estimates-and-risks.md](09-phases-estimates-and-risks.md) | Phase plan, effort in agent-weeks, tests, rollout, risks, cuts |
| 10 | [10-open-questions.md](10-open-questions.md) | Every undecided question, with a recommendation |

## 4. Glossary

| Term | Meaning |
|---|---|
| App | A registered plug-in: identity (`AppCode`, slug, GUID), metadata, versions, access grants. |
| App package | The ONE zip file (`frontend/`, `backend/`, `app.json`) that an admin uploads. |
| Manifest | `app.json` in the package root: what the app is and what it asks for. |
| AppCode | Stable, immutable app identifier (`md-convert`). Workflow versions link to apps by it. |
| Slug | The readable URL segment (`/apps/md-convert/`). Initially equal to the AppCode; changeable by an admin (old slug redirects). |
| AppGuid | Internal folder id under `\apps\<guid>\`; never shown to users. |
| Gateway | The part of MatterFlow web (in-process) that serves `/apps/*`: static files, backend reverse proxy (YARP), session and platform endpoints. |
| App Host | Separate Windows service that starts, supervises and limits app back ends. |
| Platform services | Server-side capabilities MatterFlow offers to apps: file service, connectors, jobs, callbacks. |
| Launch token | 60-second signed JWT that carries identity and context into a newly opened app window. |
| Session token | Opaque token the app holds in memory after redeeming a launch token. |
| Identity assertion | Short JWT the gateway adds to every request it forwards to an app back end. |
| Delegated token | (Phase 4) Narrow on-behalf-of token an app uses to call MatterFlow. |
| Connector | Admin-configured integration (Harvey) whose credentials stay in MatterFlow. |
| File root | Admin-configured allow-listed folder (for example `\\fs01\Matters`) that apps may be granted. |

## 5. Decisions table

| ID | Decision | Rationale |
|---|---|---|
| D1 | Apps are uploaded as ONE zip (`frontend/`, `backend/`, `app.json`), unpacked to `\apps\<guid>\<version>\`, outside the web root, never served by the IIS static handler. | Owner decision. The server controls every byte served. |
| D2 | Path-based hosting on the same IIS site: `https://<host>/apps/<slug>/`. | No new DNS names or certificates (IT-cheap). |
| D3 | Isolation of app front ends by `Content-Security-Policy: sandbox` on every response under `/apps/*` (opaque origin). | Same-origin hosting would otherwise give app JS access to MatterFlow's origin. |
| D4 | IIS: **Anonymous on, Windows auth off for the `/apps` location** (the gateway authenticates by token). | A sandboxed page cannot send Windows credentials, and IIS would answer every credential-less request with 401 before our code runs. Also guarantees no ambient credentials reach apps. **IT dependency + Phase 0 spike.** |
| D5 | Display mode `window` (new tab/window, `rel=noopener`); `embedded` documented as future. | Owner decision; simplest, best isolation. |
| D6 | Only a System Admin publishes: permission `App.Manage`, held by System Admin only by default. Approval is "review and enable" by that admin; a **two-person approval** setting exists (`Apps:RequireSecondApprover`, default off). | Small trusted team; flexible if another team publishes later. |
| D7 | Per-role access: `AppRoleGrant(RoleId, AppId)` rows plus a catalogue permission `App.Launch`; effective right = both. | Keeps the static catalogue (`contracts/permissions.json`) static; apps are data. Alternatives rejected in doc 05 section 3. |
| D8 | Identity: 60 s one-time ES256 launch token, redeemed at the gateway for an opaque session token; back ends receive a gateway-signed identity assertion; public keys at `/apps/_mf/jwks.json`. | No second login; short-lived; revocable; no secrets in the app. |
| D9 | Context given to apps: account, display name, email if known, Matter number (`00154-00001`), task reference, step id, and nothing else. | Data minimisation; MatterFlow holds no client data (addendum C). |
| D10 | Back ends run out of process in the **App Host** service (.NET 10, framework-dependent, localhost-only Kestrel, job-object limits, per-app Windows account); MatterFlow is the reverse proxy at `/apps/<slug>/api/*` (YARP in-app). The web app pool never runs uploaded code and never creates IIS sites. | Owner decision; least privilege. |
| D11 | File access model 2 for release 1: allow-listed roots, accessed by a **File Broker** under its own low-privilege account, with role-based root grants and an optional per-user ACL probe. Model 1 (impersonation / Kerberos constrained delegation) documented as a later option. | Works without AD delegation changes; confused-deputy risk managed by grants, audit, quotas. |
| D12 | Connector credentials live encrypted in MatterFlow; app code never sees them. | A browser or app must not hold Harvey credentials. |
| D13 | Delegated API calls (Phase 4) go to a narrow **Callback API** under `/apps/_mf/v1/callbacks`, using on-behalf-of tokens with scopes mapped to existing `Perm:` policies, bound to the launched task/step. | The main `/api` stays Windows-auth-only with the CSRF header rule. |
| D14 | Integrity: SHA-256 of the package and of every file is computed by the server, shown in the publish wizard and recorded in audit; optional internal signature check later. No PKI. | Trusted authors; detects accident and tampering at rest. |
| D15 | Audit every publish, approve, enable, disable, rollback, remove, launch and platform-service action (who, app, task, step). Usage counts per app/day only, never per-person performance. | Owner decision and addendum (no performance metrics). |
| D16 | Apps store their own data only under `\apps-data\<guid>\` (files, SQLite). No access to the MatterFlow database; no client data. | MatterFlow holds no client data (addendum C). |
| D17 | Feature flag `Apps:Enabled` (default false) until IT items are done. | Safe rollout; IT items are optional until needed (addendum L principle). |

## 6. Phase plan (summary; detail in doc 09)

| Phase | Content | Effort (agent-weeks) |
|---|---|---|
| 0 | Spike: sandbox header, anonymous `/apps` location, launch + `md-convert` | 0.3 |
| 1 | Platform core: registry, upload/validate/approve, gateway, sandbox, permissions, launch, Apps page, step/task links, audit, admin UI, template + samples | 6 |
| 2 | App Host and back ends | 4 |
| 3 | Platform services: file service, Harvey connector, jobs | 5 |
| 4 | Delegated tokens and callback API | 3 |
| 5 | Extras (embedded mode, signing, second approver UI, usage view) | pick as needed |

Total for 0-4: about 18 agent-weeks, of which release 1 (0-1) is about 6.

## 7. How to review

1. Read section 2 above, then `01` and `03` (the isolation story), then `05` (what users and admins see).
2. Check `10-open-questions.md`: each question has a recommendation; answer or accept them. Blocking questions are marked **BLOCKER**.
3. Anything marked **IT dependency** needs the IT team before the phase it names can ship.
4. Everything marked **Assumption** is a claim we could not verify on a real Windows Server (Linux-only environment); `09` lists the spikes.

## 8. What is NOT decided

See `10-open-questions.md` for the full list. Headline items: file-access model confirmation with IT (impersonation vs service account); per-app Windows accounts created by IT versus automatically; whether the Harvey API supports what the sample needs; whether IT accepts an anonymous IIS location for `/apps`; second-approver setting; antivirus product; backup of `\apps` and `\apps-data`; test/production pairing for apps; naming ("Apps" versus "Tools").
