# 08 Developer guide and samples

Audience: the owner's small development team. The template and two sample apps are the main adoption tool; this guide is deliberately short. Related: `02-package-format.md`, `04-launch-identity-and-tokens.md`, `07-platform-services-and-api.md`.

## 1. Template repository layout (`matterflow-app-template`, separate repo)

```text
my-app/
├── app.json                    manifest (version is the source of truth, `mf-app pack` stamps it)
├── frontend/                   any framework (Vite + TypeScript sample); build output to frontend/dist
│   ├── src/ main.ts  mf.ts     mf.ts = tiny SDK: launch token -> session, apiFetch(), files, jobs
│   ├── index.html  vite.config.ts   (base: './', no inline scripts, no eval, hashed assets)
│   └── package.json  package-lock.json
├── backend/                    optional .NET 10 minimal API
│   ├── MyApp.Api/ Program.cs  (AddMatterFlowAppIdentity(), /health)
│   ├── MyApp.Tests/
│   └── Directory.Build.props   (net10.0, nullable, warnings as errors, central package versions)
├── mf-app.json                 CLI settings (paths to frontend/dist and backend publish)
├── .github/workflows/ci.yml    build, test, `mf-app validate`, `npm audit`, `dotnet list package --vulnerable`, `mf-app pack`, upload artifact + SHA-256
└── README.md
```

Rules baked into the template: lockfile committed (`npm ci`), Dependabot enabled, no `node_modules` or `.exe` in the package, relative URLs only, no inline script/style-src beyond what the CSP allows (`style-src 'unsafe-inline'` is allowed for frameworks that inject styles).

## 2. Local development

1. `mf-app dev` serves `frontend/` on `http://localhost:5199/apps/my-app/` with the **same sandbox headers** (so storage/cookie assumptions fail early), injects a stub launch token (claims editable in `mf-app.json`), and runs a mock gateway: `/apps/_mf/session`, `jwks.json` (dev key), `/apps/my-app/api/*` proxied to your back end on `http://127.0.0.1:5200` with a dev `X-MF-Identity`.
2. **Against a MatterFlow dev instance** (Dev auth, `docs/dev-environment.md`): set `Apps:Enabled=true`, `Apps:StoragePath=./.apps`, run the API, then `mf-app push --server http://localhost:5080` (Dev auth user is System Admin) to upload, approve and enable the app; open it from the Apps page. Back ends run without the App Host in dev (`Apps:AppHost:Mode=InProcessDev` starts them as plain child processes on a leased port; not available in Production).
3. Unit-test token validation with the SDK's `FakeMatterFlow` (issues tokens signed by a throw-away key).

## 3. Front end: launch and session (TypeScript)

```ts
// mf.ts - runs inside the sandbox: NO localStorage/cookies; keep everything in memory.
type Session = { sessionToken: string; user: { id: string; account: string; displayName: string; email?: string };
                 context: { matter?: string; task?: string; step?: string; source: string }; nonce: string };

let session: Session | null = null;

export async function start(): Promise<Session> {
  const m = /[#&]mf_launch=([^&]+)/.exec(location.hash);
  if (!m) throw new Error('Open this app from MatterFlow.');
  history.replaceState(null, '', location.pathname + location.search);      // remove the token from the URL at once
  const res = await fetch('/apps/_mf/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ launchToken: decodeURIComponent(m[1]) }),         // credentials omitted by default
  });
  if (!res.ok) throw new Error(res.status === 409 ? 'This app is switched off.' : 'Your session could not be started.');
  session = await res.json();
  scheduleRefresh(session.expiresInSeconds ?? 900);
  addEventListener('pagehide', () => { fetch('/apps/_mf/session', { method: 'DELETE', keepalive: true, headers: { Authorization: `Bearer ${session!.sessionToken}` } }); });
  return session!;
}

export function apiFetch(path: string, init: RequestInit = {}) {            // path like 'transfers'
  return fetch(`/apps/harvey-uploader/api/${path}`, {
    ...init, headers: { ...init.headers, Authorization: `Bearer ${session!.sessionToken}` },
  });
}
```

(Refresh and logout follow `04` section 5: `POST /apps/_mf/session/refresh` and `DELETE /apps/_mf/session`; `sendBeacon` cannot set the Authorization header, hence `fetch` with `keepalive`. `scheduleRefresh` is in the SDK.)

## 4. Back end: validate the identity assertion

C# (.NET 10) with the SDK (`MatterFlow.App.Sdk`):

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddMatterFlowAppConfiguration();          // reads config + secrets from the App Host pipe
builder.Services
    .AddAuthentication("MatterFlow")
    .AddMatterFlowIdentity(o =>
    {
        o.Issuer   = builder.Configuration["MF_ISSUER"]!;        // https://matterflow.firm.local
        o.Audience = $"app:{builder.Configuration["MF_APP_CODE"]}";
        o.JwksUrl  = builder.Configuration["MF_JWKS_URL"]!;      // cached 5 min, refetch on unknown kid
        o.ClockSkew = TimeSpan.FromSeconds(30);
    });
builder.Services.AddAuthorization();
var app = builder.Build();
app.UseAuthentication(); app.UseAuthorization();
app.MapGet("/health", () => Results.Ok()).AllowAnonymous();
app.MapPost("/transfers", (HttpContext ctx, TransferRequest req) =>
{
    var user   = ctx.User.FindFirst("preferred_username")!.Value;   // KE\jsmith
    var matter = ctx.User.FindFirst("matter")?.Value;              // 00154-00001
    ...
}).RequireAuthorization();
app.Run();
```

What `AddMatterFlowIdentity` does (so you can use any library): read `X-MF-Identity`, validate with `TokenValidationParameters { ValidAlgorithms = ["ES256"], ValidIssuer, ValidAudience, RequireExpirationTime = true, ValidateLifetime = true }`, check header `typ == "mf-identity+jwt"`, keys from JWKS.

TypeScript (Node back end or an Azure-style function, using `jose`):

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';
const jwks = createRemoteJWKSet(new URL(process.env.MF_JWKS_URL!), { cooldownDuration: 30_000, cacheMaxAge: 300_000 });
export async function verifyIdentity(token: string) {
  const { payload, protectedHeader } = await jwtVerify(token, jwks, {
    issuer: process.env.MF_ISSUER!, audience: `app:${process.env.MF_APP_CODE}`, algorithms: ['ES256'], typ: 'mf-identity+jwt', clockTolerance: 30,
  });
  return payload;   // sub, preferred_username, name, email?, matter?, task?, step?
}
```

(Node back ends are not supported in release 1; the snippet is also what a front-end-only app does to decode a **launch** token for display - without trusting it.)

## 5. Packaging, testing, versioning

- `mf-app pack` -> `dist/my-app-1.2.0.mfapp.zip` + prints SHA-256. Send the zip to a System Admin **and** the hash through a second channel (chat/e-mail); the wizard shows the server-computed hash to compare.
- Tests: unit tests for logic; `FakeMatterFlow` for token handling; one Playwright smoke test against `mf-app dev` (page loads under sandbox headers; no console CSP errors); `mf-app validate` in CI.
- Versioning: semver. Patch = fix; minor = backwards-compatible; major = breaking changes to your own data format. Your data in `MF_DATA_DIR` outlives versions: write forward-compatible files and keep a `schemaVersion`. Rollback by an admin must never corrupt data (read older and newer).
- Release checklist: dependencies audited, no secrets, `app.json` permissions minimal (ask for `email` only if needed), changelog in the wizard notes.

## 6. Walkthrough A: `md-convert` (front end only)

1. `mf-app init md-convert --template static`.
2. In `main.ts` call `start()` only to show "Signed in as <display name>"; the tool does not need it.
3. File input (`<input type=file accept=".md,.markdown,text/markdown">`) reads the file in memory (`File.text()`); `marked` renders HTML; `html2pdf`-style library or `pdf-lib` + print CSS produces a PDF in memory. **Sanitize the HTML** with DOMPurify before rendering even though it is local.
4. Download: `const url = URL.createObjectURL(blob); a.href = url; a.download = name; a.click()` (works because `allow-downloads` is set; the blob URL belongs to the opaque origin).
5. `app.json` as in `02` example 1; no backend, no platform services; the file never leaves the browser (state this on the page).
6. Pack, upload, review, enable, tick the roles, open from the Apps page.

## 7. Walkthrough B: `harvey-uploader` (front end + back end + file service + connector)

1. Front end `start()` -> session; context shows matter `00154-00001`, task `TSK-1234`.
2. Folder picker: `GET /apps/_mf/v1/files/roots` -> `source`; browse `entries` (breadcrumbs, search by name locally); the user selects a folder (a `fileRef`).
3. Vault picker: `POST /apps/_mf/v1/connectors/harvey/operations/vaults.list` -> choose or create a vault.
4. Start: `POST /apps/harvey-uploader/api/transfers { folderRef, vaultId }` -> the back end creates a platform job (`POST /apps/_mf/v1/jobs` with its service token), walks the folder (`files/walk`), then for each file calls `connectors/harvey/operations/files.upload { vaultId, fileRef }`, reporting progress (`PUT jobs/{id}/progress`). State per file is persisted in `MF_DATA_DIR/transfers/<jobId>.json` for resume.
5. Front end polls `GET jobs/{id}`; on success (Phase 4) it can call the callback API: add a comment "Uploaded 412 files to vault X" (`comments:write`) and complete the step (`step:complete`), only if the developer chooses.
6. Edge cases to implement: duplicate names, locked files (skip + report), cancel, partial failure report CSV, vault permission error mapping, 5 GB: no browser involvement in byte transfer.

## 8. Sandbox limitations and workarounds

| Limitation | Workaround |
|---|---|
| No cookies, `localStorage`, `sessionStorage`, IndexedDB, Cache API, service workers | Keep state in JS memory; persist server-side via your back end (`MF_DATA_DIR`) keyed by user id; wrap storage access in try/catch if a library touches it (`lock-storage` shim in the template) |
| Cross-window `postMessage` only works with windows you opened (popups allowed) | Use it between your own windows; MatterFlow does not message apps in window mode |
| Downloads | `Blob` + `a[download]`, or `GET` on your API with `Content-Disposition: attachment` through `fetch` then blob |
| PDF/object preview | Use a JS renderer (pdf.js bundled) into a canvas; `<object>/<embed>` are blocked |
| Clipboard | Write via `navigator.clipboard.writeText` on user gesture works; read is blocked |
| External scripts/fonts/CDNs | Not allowed (`script-src 'self'`); bundle everything |
| Calling other intranet hosts | Not allowed unless `network.allowedOrigins` is approved; prefer going through your back end |
| Reload loses the session | Reopen from MatterFlow (one click) |
| `window.open`, `target=_blank` to other sites | Popups work but stay sandboxed; do not rely on them |

## 9. Do and don't

Do: ask for the minimum context, scopes, roots and connectors; keep secrets in app configuration (`secret: true`); validate every input in the back end; treat the identity assertion as the only truth about the user; log identifiers, not content; add `schemaVersion` to your data files; handle `503 APP_BACKEND_UNAVAILABLE` with retry; keep bundles small; test under `mf-app dev`.
Don't: store client data or file contents on disk beyond what a job needs and delete it after; trust the `X-MF-*` headers of a request without validating the JWT; log tokens or secrets; call `/api` of MatterFlow; put credentials in `app.json`, the front end or the repository; use `eval`, inline scripts or CDN links; write outside `MF_DATA_DIR`; assume your port or process lives forever.

## 10. Support model

The owner's team supports its apps (contact in the manifest). Operational issues (App Host, accounts, shares) go to IT as per `06` section 3.
