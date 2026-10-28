# Application settings: branding (title and icon)

Epic #850 "Epic: Application settings: title and icon" (phase-23; issues #843 to #849). Decisions: `docs/requirements/decisions-addendum.md` section AM. Plan: `delivery-plan.md` (same folder).
**Status (2026-10-27): built and verified on `dev`** (issues #843 to #849; operations `docs/runbook.md` section 16, screen S27 in `docs/ux/ux-spec.md`, decisions addendum AM). Owner answers: Q1 `&` allowed, Q2 IIS anonymous for the branding path only (done, tested), Q3 no light chip in dark mode, Q4 the name is always next to the icon, Q5 fixed `theme-color`. Differences from this design: the startup read always revalidates (`cache: 'no-cache'`), so the delay in section 5.3 is at most about 30 seconds (the server's copy) instead of two minutes; the `/admin` route guard uses the menu's permission list; the app starts at once and applies the server's answer when it arrives (waiting for it moved the first render after the load event and broke older timing-sensitive browser tests), so a first visit with no remembered copy can show `MatterFlow` for a few tens of milliseconds before the custom name. Initial bundle 645.07 kB (was 641.53 kB, +3.5 kB, limit 700 kB).

## 1. Goal

An administrator changes the **application name** and the **application icon** on a page (Administration > Settings > Branding) at any time. No rebuild, no redeploy: the next page load of every user shows the new name in the header, the browser tab title, the sign-in and error pages, and the new icon as favicon and header mark. "Reset to default" returns to `MatterFlow` and the built-in icon.

Out of scope (owner): environments, integrations, secrets, e-mail. The storage is a small **generic typed settings table** so that other settings can be added later (section 4.4); this epic builds only Branding.

## 2. Owner requirements and where this design deviates

| Requirement | Result |
|---|---|
| Permission `Settings.Manage`, System Administrator by default | As asked (section 8). |
| Name: default `MatterFlow`, max 40, trimmed, no markup | As asked. "No markup" = `<` and `>` and control/bidi characters are rejected; `&` is allowed ("Smith & Co"). The UI only ever binds the name as text (never `innerHTML`). |
| Icon: PNG/SVG/ICO, <= 256 KB, square, >= 64 px, type by content, SVG safe, preview, reset | As asked. SVG is **rejected, not rewritten**, when it has anything outside an allow-list (section 6.2). ICO: the largest image must be square and >= 64 px. PNG: 64 to 1024 px. |
| Stored in the database, `varbinary(max)`, audited, rowVersion | As asked. |
| Public cacheable endpoints with ETag | As asked, plus one small change to `SecurityHeadersMiddleware` (section 5.3): it forces `no-store` on all of `/api` today. |
| Bootstrap fetch with safe default | As asked, plus a last-known copy in `localStorage` so the tab never flashes the default after the first visit (section 7.1). |
| Missing row | Code default; **no seed row** (section 4.2). |
| Module | **Configuration** module, new `Settings/` folder; no new module (section 4.1). |
| Apple touch icon | Only for a **PNG** upload; for SVG or ICO the `apple-touch-icon` link is removed (iOS cannot use them), so no mismatched old icon remains. |

## 3. Screen

Route `/admin/settings` (lazy), rail item "Settings" (icon `pi pi-cog`) in the Administration section of `nav-items.ts`, `permissions: ['Settings.Manage']`. Title: `Settings: Branding - <Application name>` (`pageTab('Settings', 'Branding')`). One tab today ("Branding"); the tab strip is there so later sections (not designed) slot in. Follows the admin pages review patterns (`docs/ux/admin-pages-review/`): H1, crumb, one form card, Save/Cancel footer, no dialog.

Desktop (1280):

```
Administration > Settings
Settings
[ Branding ]
+--------------------------------------------------------------------------+
| Application name                                                         |
| [ MatterFlow______________________ ]  12 / 40      [Reset to default]    |
| Shown in the header, the browser tab and the sign-in page.               |
|                                                                          |
| Application icon                                                         |
| +------+  PNG, SVG or ICO, square, at least 64 x 64, up to 256 KB.       |
| | icon |  [ Choose file... ]   [Reset to default]                        |
| +------+  mf-logo.svg, 2 KB                                              |
|                                                                          |
| Preview                                                                  |
|  Browser tab:   [ico] Matters: Overview - MatterFlow   [x]               |
|  Header:        [ico] MatterFlow                                         |
|                                                                          |
| Last changed 2026-10-27 09:14 by Dana Reyes                              |
+--------------------------------------------------------------------------+
                                              [Cancel] [Save changes]
```

Phone (375): single column, the same blocks stacked; preview rows wrap; footer buttons full width, sticky at the bottom; file picker is a full-width button.

```
< Settings
Application name
[ MatterFlow         ] 12/40
[Reset to default]
Application icon
[icon] logo.svg 2 KB
[ Choose file...      ]
[Reset to default]
Preview
 tab:    [i] Matters: Ov... 
 header: [i] MatterFlow
[ Cancel ][ Save changes ]
```

Behaviour: the preview updates as the user types or picks a file (client-side object URL; the server still validates on save). Errors sit under the field (`aria-describedby`), with an error summary announced in a live region on save. "Reset to default" is per field, asks no confirmation (it only fills the form; nothing changes until Save) and saves by sending the reset. After Save a toast: "Saved. Other users see it the next time they load the page."

## 4. Data model

### 4.1 Which module

**Configuration** (`MatterFlow.Configuration`): it already owns admin-maintained, firm-wide configuration (lookups, forms, task types), uses `IAuditWriter` from `Audit.Contracts`, and the Api host already references it. A new `Settings` module would need its own csproj pair, composition entry, architecture-test wiring and contracts for no gain. Boundary rules hold: only `SharedKernel` and `Audit.Contracts` are used; the permission check is the existing attribute. Code lives in `Domain/Settings` (rules), `Application/Settings`, `Api/SettingsControllers.cs`, `Infrastructure` as the existing module does. If settings grow beyond a handful, extracting a module is a mechanical move (public contract is the HTTP API). The public branding controller lives in the same module (`[AllowAnonymous]` explicit, as `FailClosedConvention` requires).

### 4.2 Table (next free script number at implementation time; last used is 39)

```sql
CREATE TABLE dbo.AppSetting (
  SettingKey      VARCHAR(100)    NOT NULL CONSTRAINT PK_AppSetting PRIMARY KEY,   -- 'Branding.AppName', 'Branding.Icon'
  ValueText       NVARCHAR(1000)  NULL,
  ValueBinary     VARBINARY(MAX)  NULL,
  ContentType     VARCHAR(100)    NULL,        -- binary values only
  ContentSha256   BINARY(32)      NULL,        -- binary values only; the ETag source
  UpdatedAtUtc    DATETIME2(3)    NOT NULL,
  UpdatedByUserId INT             NOT NULL,    -- FK dbo.AppUser
  RowVersion      ROWVERSION      NOT NULL,
  CONSTRAINT CK_AppSetting_Size CHECK (DATALENGTH(ValueBinary) <= 262144)
);
```

* **Typed in code, not in SQL**: a `SettingDefinition` registry (key, type text/binary, default, validator) in `Domain/Settings`; the table is a thin key/value store. A future typed setting = one definition + one section on the page. Unknown keys in the table are ignored.
* **Defaults live in code**, not in a seed row: name `MatterFlow`; icon = "none", meaning the built-in files (`favicon.svg`, `favicon-32.png`, `favicon.ico`, `apple-touch-icon.png`) stay in use. A missing row is therefore the normal, valid state (fresh database, after Reset). The app never fails on a missing row. Reset = delete the row (audited). No backfill (nobody uses the app; CLAUDE.md status).
* `db/report-access.json`: `AppSetting` classified **deny** with reason "Application settings; not report data" and the script ends with `DENY SELECT, VIEW DEFINITION ON dbo.AppSetting TO mf_report_reader;` (not secret, but not report data; deny keeps the rule simple and a later secret-bearing setting cannot leak by accident). The grants for the app login follow the script 31 pattern.
* Concurrency: per-row `RowVersion`. The admin GET returns one combined `rowVersion` per field (name, icon); PUT/DELETE carries it back; mismatch = `409` with the usual conflict problem. Two admins editing different fields do not conflict.
* Audit (`IAuditWriter`, entity `AppSetting`): `SETTINGS_BRANDING_NAME_CHANGED` (old and new text), `SETTINGS_BRANDING_ICON_CHANGED` (content type, size, SHA-256, never the bytes), `SETTINGS_BRANDING_RESET` (which field). Visible in the existing audit views; these events are not matter-scoped, so they are unaffected by the sensitive-matter rules.

## 5. API

All under `/api/v1`; OpenAPI in `contracts/openapi` and the nswag client are regenerated (CI drift check).

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /branding` | anonymous | `{ appName, iconUrl, iconKind, version }`. `iconUrl` is `null` when no custom icon (built-in files stay), else `/api/v1/branding/icon?v=<version>`. `iconKind`: `png`, `svg`, `ico` or `null`. `version` = first 12 hex of SHA-256 over name+icon hash. |
| `GET /branding/icon` | anonymous | Icon bytes, `Content-Type` from the stored sniffed type, `404` when none. |
| `GET /admin/settings/branding` | `Settings.Manage` | Same plus `rowVersion` per field, `updatedAtUtc`, `updatedBy`, limits (so the page shows the numbers from the server). |
| `PUT /admin/settings/branding/name` | `Settings.Manage` | `{ appName, rowVersion }`. |
| `PUT /admin/settings/branding/icon` | `Settings.Manage` | `multipart/form-data`: `file`, `rowVersion`. Request size capped at 300 KB before reading. |
| `DELETE /admin/settings/branding/name`, `.../icon` | `Settings.Manage` | Reset one field (`rowVersion` in the query). |

Error codes (problem+json, field errors on the field): `BRANDING_NAME_REQUIRED`, `BRANDING_NAME_TOO_LONG`, `BRANDING_NAME_INVALID_CHARS`, `BRANDING_ICON_TOO_LARGE`, `BRANDING_ICON_TYPE_UNSUPPORTED`, `BRANDING_ICON_NOT_SQUARE`, `BRANDING_ICON_TOO_SMALL`, `BRANDING_ICON_UNSAFE` (SVG), `BRANDING_ICON_CORRUPT`; `409` conflict; `403` without permission.

### 5.3 Caching and headers

* `GET /branding`: `ETag` (= `version`), `Cache-Control: public, max-age=60, must-revalidate`, `If-None-Match` gives `304`. Server side a 30 s in-memory cache, invalidated on every write on the node that wrote (other nodes converge within 30 s).
* `GET /branding/icon`: same `ETag`, `Cache-Control: public, max-age=3600`; the app always requests it with `?v=<version>`, so a changed icon is a new URL and is fetched at once.
* **Required code change:** `SecurityHeadersMiddleware` sets `no-store` on all of `/api` unless the response says `private, no-cache`. It gets one more exception: a response under `/api/v1/branding` that sets its own `public` + `max-age`. Everything else stays `no-store`. A test pins that no other path is relaxed.
* Icon response also carries `X-Content-Type-Options: nosniff` (already global), `Content-Disposition: inline`, and for SVG `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`. (The global API policy is `default-src 'none'`; the middleware keeps it, the sandbox is added.)
* **How long can a change be delayed?** The name: up to 60 s of browser cache plus 30 s of server cache, i.e. under 2 minutes after Save, applied on the user's next page load or reload (open tabs keep the old name until reloaded; no push). The icon in the header: same. The browser tab favicon: the app sets a new versioned URL on load, but browsers cache favicons on their own schedule; a hard reload or reopening the tab fixes it; allow "up to a day" in the worst case in some browsers. The admin sees the effect immediately in the preview and after reload.

## 6. Validation and security

### 6.1 Public endpoint exposure

The two public endpoints return only the name and the icon: no user data, no counts, no versions of the software. They are cheap (cached, ETag). They add no state and no cookie. Writes are admin-only and audited. Risk: an admin (or a stolen admin session) can show arbitrary text/image to everyone including the sign-in page. Mitigated by permission, audit, text-only rendering, 40-char limit and the size limit.

**Windows authentication caveat (verify in BR-03/BR-06):** production uses Windows auth on IIS. Browsers fetch favicons without credentials in some cases; if the IIS site disables anonymous authentication, `/api/v1/branding*` would answer `401`. The deploy scripts and `docs/runbook.md` must be checked: the ASP.NET Core fail-closed convention already protects every other action, so enabling IIS anonymous authentication for the site is safe only if that holds (an existing test enforces it). If it cannot be enabled, the header mark still works (the app sends credentials) and only the tab icon falls back to the built-in one. Recorded as open question Q2.

### 6.2 Image validation (by content, never by file name or the client's content type)

1. Size: reject above 256 KB (`BRANDING_ICON_TOO_LARGE`) while reading the stream (hard stop at 300 KB).
2. Type by magic bytes: PNG `89 50 4E 47 0D 0A 1A 0A`; ICO `00 00 01 00` plus a sane directory; SVG = well-formed XML whose root is `svg` in the SVG namespace. Everything else (JPEG, GIF, WebP, HTML, a PNG renamed to `.svg`) is `BRANDING_ICON_TYPE_UNSUPPORTED`.
3. Dimensions without a new NuGet package: PNG from the IHDR chunk (width = height, 64 to 1024); ICO from the directory (the largest entry is square and >= 64, every entry's data range inside the file); SVG from `viewBox` (or width/height) with an aspect ratio of exactly 1 (no minimum: vector). A truncated or inconsistent file is `BRANDING_ICON_CORRUPT`. We do not decode or re-encode pixels (no image library, no decompression-bomb surface; dimension caps and the 256 KB limit bound the risk).
4. **SVG safety = allow-list, reject on anything else.** Parse with `XmlReader`, `DtdProcessing.Prohibit`, `XmlResolver = null`, a character limit. Allowed elements: `svg g path rect circle ellipse line polyline polygon defs linearGradient radialGradient stop clipPath mask title desc use` (`use` only with a `#fragment` href). Allowed attributes: geometry/presentation attributes, `id`, `class`, `viewBox`, `fill`, `stroke*`, `opacity`, `transform`, `style` limited to a property allow-list without `url(` to anything but `#id`, no `@import`. Rejected (`BRANDING_ICON_UNSAFE`): `script`, `foreignObject`, `image`, `a`, `style` element, `animate*`/`set`, any `on*` attribute, any `href`/`xlink:href` that is not `#fragment`, `javascript:`/`data:` anywhere, entities, processing instructions, external references. Reject (not rewrite) keeps the stored bytes byte-identical to what the admin previewed.
5. Even if an SVG slipped through, it is only used through `<img>` and `<link rel=icon>`, where browsers do not run scripts, and it is served with `nosniff` + sandbox CSP. It is never inlined into the DOM and never opened as a document by the app.
6. Cross-site: the admin PUT uses the existing CSRF header convention (`X-MatterFlow-Client`).

## 7. Frontend integration

### 7.1 Startup (no flash, no blank title, no eager api-client)

* `index.html` keeps its static `<title>MatterFlow</title>` and icon links: this is the built-in fallback and what runs if everything below fails.
* `main.ts`, before `bootstrapApplication`: a tiny `loadBranding()` (about 1 kB, plain `fetch('api/v1/branding')`, 1.5 s timeout, `If-None-Match` handled by the browser) that never throws. In parallel it first reads the **last-known branding from `localStorage`** (try/catch; may be empty) and applies it synchronously, so repeat visits do not flash the default; the fetch result then updates it and the stored copy.
* It writes into a small module-level holder (`branding.ts`, a plain object plus a signal facade `BrandingService` for components) and sets `document.title`'s suffix, the `<link rel=icon>` set (data attribute `data-mf-icon` marks the links it manages), and `apple-touch-icon`.
* **Never** imports `api-client` or `lookup-store` (bundle rule; the type is a local interface checked against the generated client by a type-level spec in the lazy admin code). Initial bundle stays under 700 kB (~629 kB now; budget for this: < 3 kB). The admin page and its API calls are lazy.
* If the app name is unavailable it is `MatterFlow`; the shell renders in any case.

### 7.2 Inventory of every place the name or icon appears (from `origin/dev`)

| Place | Today | Change |
|---|---|---|
| `frontend/src/index.html` | `<title>MatterFlow</title>`, icon links, `theme-color` | stays as fallback; `theme-color` unchanged (colour is not part of branding) |
| `core/title/page-title.ts` | `APP_NAME = 'MatterFlow'` constant in `documentTitle()` | read the name from the branding holder; `documentTitle` stays a pure function of (page, name); `pageTab`/`recordTitle` unchanged; unit specs keep the default |
| `shared/layout/app-shell.html` | logo `aria-label="MatterFlow home"`, `<img src="favicon.svg">`, text `MatterFlow` | bind name (text interpolation) and icon URL; `aria-label` = `${name} home`; ellipsis for long names, `title` not needed |
| `shared/layout/route-announcer.ts` | announces `document.title` | no change (follows the title) |
| `shared/ui/state-page.ts` (403/404/error/offline) | `data-state-brand` text `MatterFlow` | bind name |
| `features/access-pending/pages/access-pending-page.html` | `.mf-brand` text | bind name |
| `features/system/pages/error-page.ts` | "MatterFlow could not load your account." | `${name} could not load your account.` |
| `features/system/pages/not-found-page.ts` | search placeholder "Search MatterFlow" | bind |
| `shared/search/global-search.ts`, `search-meta.ts` | `aria-label`/label "Search MatterFlow" | bind (keep wording `Search <name>`) |
| `shared/availability/time-zone-select.ts` | help text "elsewhere in MatterFlow" | bind |
| Route titles and records (`admin.routes.ts`, detail pages) | build `<Page>: <Tab>`, suffix added by `documentTitle` | no change |
| Sign-in page | Dev-provider sign-in (Development/Test only); Windows auth has none | covered by the shell/state-page brand; verify at implementation |
| `frontend/public/*` icons | built-in files | stay as default; never overwritten |
| PWA / web manifest | none exists (no manifest, no service worker) | nothing to do; note in docs that adding one later must read the branding |
| Notifications text | no hardcoded name found in frontend or backend notification text | none (re-check by grep at implementation) |
| Technical identifiers (`X-MatterFlow-Client` header, `mf_*` names, DB, namespaces, Swagger title) | | **not** branding; unchanged |

**Emails, exports, report headers that print the name:** none today (no e-mail exists; CSV exports and report runs carry no application name; the audit text for exports names the report, not the app). Rule for later work: any such output must read the name from the settings service, never a constant (listed in the BR-07 docs update so a future e-mail epic sees it).

Dark theme: a custom icon is shown on the header background of the current theme; an icon with a dark glyph on transparent may be hard to see in dark mode (open question Q3).

## 8. Permission

`Settings.Manage`, group `Administration`, description "Change application settings (name and icon)". Added the way `Matter.ViewSensitive` was (script 34): entry in `contracts/permissions.json`, constant and `All` in `Permissions.cs`, `permissions.ts`, a numbered script that inserts the `dbo.Permission` row idempotently. **System Administrator holds it implicitly** (no grant row, as for other permissions); no other role gets it by default; assignable on the Roles screen. Parity tests (catalog = backend = frontend) enforce the three copies. Nav item and route guard use it; the endpoints use the same attribute (server decides).

## 9. Accessibility

Labels tied to inputs; character counter `aria-live="polite"` only on threshold (not every key); file input reachable by keyboard with a visible name of the chosen file; error summary focus on failed save and field errors via `aria-describedby`; the preview is decorative (`aria-hidden`) with a text equivalent "Header will read: <name>"; the header mark has `alt=""` (the name is next to it); the new `<title>` is announced by the route announcer on the next navigation; no colour-only state; target size >= 24 px; axe-clean at 320/375/768/1280, no horizontal scroll. No new or changed keyboard shortcuts (#420).

## 10. Test plan

* **Unit (backend):** name rules (trim, length 40, `<`/`>`/control/bidi, whitespace collapse); PNG/ICO header parsing (good, truncated, wrong dims, not square, bomb-like header); SVG allow-list (each rejected construct has a case: script, foreignObject, on*, external href, entity/DOCTYPE, `url(http:`); type by content (PNG renamed `.svg`); size limit; ETag/`version` stability; missing row yields defaults.
* **Unit (frontend):** `documentTitle` with custom name, localStorage empty/throwing, fetch failing or timing out gives default title, link management (add/replace/remove apple-touch), name binding in shell/state-page/error pages, form validation and preview.
* **Integration (Docker SQL):** public endpoints without login (200, 304 on `If-None-Match`, headers incl. `Cache-Control` and nosniff, 404 icon when none); admin endpoints 401/403/200; PUT/DELETE audited; rowVersion conflict `409`; oversize body refused; `report-access` test; `no-store` still on every other `/api` path; permission parity test; FailClosed convention test sees the anonymous actions as explicit.
* **E2E (Playwright):** admin changes the name and uploads an icon, the header and `document.title` and the `<link rel=icon>` href change after reload, a signed-out/other-user view (sign-in/error page) shows it, reset restores defaults, an unsafe SVG and a 300 KB file are rejected with messages, non-admin has no menu item and gets 403 on the route; **axe at 320/375/768/1280, no sideways scroll** on the page and the shell with a 40-character name; bundle-size check (< 700 kB).
* Not applicable: leak-scan (no matter data).

## 11. Rollout

No data to migrate. Deploy order: the SQL script first (permission row + table), then API, then web. Until an admin saves, nothing changes for users (defaults). Runbook note (BR-07): where to change it, caches (section 5.3), what to do if the icon looks old (hard reload), IIS anonymous access for the branding paths (6.1), how to reset in SQL (`DELETE dbo.AppSetting WHERE SettingKey LIKE 'Branding.%'`). Rollback: reset in the page or by that SQL.

## 12. Open questions for the owner (each with a recommendation)

* Q1. Allow `&` in the name? Recommended: yes.
* Q2. May IIS anonymous authentication be enabled for `/api/v1/branding*`? Recommended: yes if the deploy review confirms the fail-closed convention; otherwise the tab icon may fall back to the built-in one on the sign-in/error pages.
* Q3. Dark mode: show the icon on a neutral light chip in the header when the theme is dark? Recommended: no for now; admins upload an icon that works on both.
* Q4. Should the header show the name and the icon, or allow hiding the name (icon-only logos)? Recommended: always show the name (accessibility, simplicity).
* Q5. Keep the browser-tab colour (`theme-color`) fixed? Recommended: yes; colour branding is a later setting.
