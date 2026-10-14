# UAT round 1: exploratory walkthrough of the admin application

Run by the user agent (as `ke\kekim` and other Dev-auth users) on `dev` at commit f425a6d + later merges, 2026-10-14. Tasks were out of scope (screens did not exist). 145 screenshots are in `screenshots/` (`J<n>-<seq>-<what>.png`).

## 1. Run instructions that worked

- dockerd was already running. SQL Server: `docker run -e ACCEPT_EULA=Y -e 'MSSQL_SA_PASSWORD=MatterFlow_Dev1!' -p 14330:1433 --name uat-sql -d mcr.microsoft.com/mssql/server:2022-latest`, wait 20 s, then create the empty database by hand: `docker exec uat-sql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P 'MatterFlow_Dev1!' -Q "CREATE DATABASE MatterFlow"` (with plain `docker run` the database must be created manually; the README only covers compose).
- API: `cd backend/src/MatterFlow.Api`; export `ASPNETCORE_ENVIRONMENT=Development`, `ConnectionStrings__Default` and `ConnectionStrings__MatterFlow` = `Server=localhost,14330;Database=MatterFlow;User Id=sa;Password=MatterFlow_Dev1!;TrustServerCertificate=True`, `Auth__Provider=Dev`, `Auth__Dev__DefaultUser='ke\kekim'`, `Bootstrap__SystemAdmins__0='ke\kekim'`, `Seed__StarterConfiguration__Enabled=true`; `dotnet run --urls http://localhost:5080`.
- Frontend: `cd frontend && npm ci && npm run start:api` (proxy targets :5080).
- Browser: Playwright + @axe-core/playwright in the scratchpad with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`; Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome --no-sandbox`; other users via `extraHTTPHeaders` `X-Dev-User`. State-changing curl calls need `X-MatterFlow-Client: web`.

## 2. Journey results

| J | Result | Notes |
|---|---|---|
| J1 Access Pending, grant role | PASS | UAT-12, 13, 23 |
| J2 Roles and permissions | PASS | System Admin locked in UI and API (409). UAT-05 |
| J3 Pods | PASS | single primary pod enforced. UAT-14 |
| J4 Priorities, status labels, link roles | PASS | UAT-15, 25 |
| J5 Clients, Matters | PASS | `343` -> `00343`; duplicate, `0`, `123456` rejected; `00343-00012`; sensitive banner; copy button; `343-12` search. UAT-06, 16, 17 |
| J6 Projects | PASS | |
| J7 Custom fields | PARTIAL | enforcement works on create. UAT-04, 07, 18 |
| J8 Task Types, form designer | PARTIAL | conditional preview, draft, publish v2 work. UAT-01, 03 |
| J9 Step library, workflow designer | PASS | UAT-19 |
| J10 Asset Types, Assets | PARTIAL | UAT-02 |
| J11 Keyboard and accessibility | PASS | one axe violation (UAT-11) |
| J12 Responsiveness 1280 / 1024 | PASS | no horizontal overflow on 10 screens |

## 3. Findings (each reproduced twice)

| ID | Severity | Finding |
|---|---|---|
| UAT-01 | Major | Task Type edit page uses the stub workflow lookup: "Eligible workflows" shows fake workflows ("Standard Processing (published v2)", "Production (not published yet) (not published yet)", "Workflow 6 (no longer listed)"), default workflow dropdown blank; list shows "Workflow 6/7/8". Only GET /task-types/{id} is called, never /workflows. Saving could write wrong ids. Area: `frontend/src/app/core/lookups/workflow-lookup.ts` (`StubWorkflowLookup`), provided in `task-types.routes.ts`. |
| UAT-02 | Major | Number custom field silently drops invalid input: Asset "Approximate size (GB)" accepts `abc` / `12abc`, shows a success toast, value dropped, `droppedFields` empty. Input is `type=text inputmode=decimal`. Likely the same in other forms. |
| UAT-03 | Minor | Task Type form designer heading blank (": Data Processing > Form Published v2", Properties panel ": Custom profile description"); route data missing in admin.routes.ts. |
| UAT-04 | Minor | Wrong copy in the Custom Fields designer: "New tasks will use version 1" / "Existing tasks keep form version..." on Matter fields; "Draft v1 created from the published version" when none existed; "WarningForm:" prefix; "Version N is published..." twice; validation says "This form can be published" on a published version. |
| UAT-05 | Minor | Delete role has no confirmation; a role in use shows a toast with a raw trace Reference (409). |
| UAT-06 | Minor | Matter/Client list search only runs on Enter, no hint; `343-99` does not find `00343-99999` (padding normalisation), `34312` finds nothing. |
| UAT-07 | Major, product decision | A newly published required Matter custom field blocks ANY edit of existing matters until a value is invented; error says "highlighted" but nothing is highlighted; page copy promises "existing records stay editable". |
| UAT-08 | Minor | Activity/History tabs show raw lines (`IsActive set to "true"`, `ClientId set to "1"`, `form:billing_code set to "BC-100"`), no actor, oldest-first ("created" after field lines), identical times. |
| UAT-09 | Minor | Task Types list shows "EditDeactivate" with no spacing. |
| UAT-10 | Minor | Inconsistent control styling: native tiny checkboxes/radios, ~11px buttons ("Grant access", "Close", "Save"), unthemed default-blue links ("Back to Pods", "Go to my work"). |
| UAT-11 | Minor (a11y) | axe `aria-required-children` on Users and Roles: Search input inside the `role=tablist` `.mf-tabs`. Other 9 screens: zero wcag2a/2aa/21aa violations incl. contrast. |
| UAT-12 | Cosmetic | Access Pending: "signed in as ke\newhire (ke\newhire) . An administrator..." (duplicate name, stray space). |
| UAT-13 | Minor | Users: a pending user appears in both "Pending (1)" and "Active (2)"; after ticking a role, effective permissions still says "(0) ... stays in Access Pending" until Save; Save toast overlaps panel header. |
| UAT-14 | Minor | Pods: no URL per pod (reload loses place); duplicate "Pod created" message and toast; roleless users offered as members; Pod name not clickable; star has no visible tooltip. |
| UAT-15 | Cosmetic | Priority table column widths jump in rename/confirm modes; disabled Delete on the default priority has no explanation. |
| UAT-16 | Minor | Matter page opens on "Projects" instead of the first tab "Tasks (0 open)"; top-right toasts cover the user name. |
| UAT-17 | Cosmetic | Validation banner touches the form card; with blank number and name only "Enter a client number." is listed. |
| UAT-18 | Cosmetic | Custom values render padded (` BC-100 `); field help text repeated in Details; invalid custom field has no red border. |
| UAT-19 | Minor | Workflow Publish dialog for an empty draft says "First published version / No changes..." with an enabled Publish; error appears only after clicking (400). |
| UAT-20 | Minor | Placeholders in nav: admin lands on /tasks "not built yet"; Audit Log "not built yet"; Dashboard is a stub. |
| UAT-21 | Minor | Unsaved-changes guard is a native `confirm()`. |
| UAT-22 | Cosmetic | Sidebar not sticky; Audit Log clipped at 800 px height; at 1024 px nav is icon-only with title tooltips. |
| UAT-23 | Cosmetic | Header shows "ke\kekim" twice; Users "Name" is the account name (AD lookup off). |
| UAT-24 | Cosmetic | Date formats differ (`Oct 14, 2026 11:08 AM UTC` vs `Oct 14, 2026, 11:20:05 AM`). |
| UAT-25 | Cosmetic | Terminology drift: nav "Task Link Labels" vs "Asset link roles"; the "Priorities" page title also covers the Status labels tab. |

## 4. Copy and wording improvements

1. Access Pending: "You're signed in as ke\newhire. An administrator needs to give you a role before you can use MatterFlow."
2. Custom field publish: "New records will use version 1. Existing records keep their values."
3. Validation prefix: "Warning: Form - ...".
4. Role in use: "1 user has this role. Remove them from it before deleting." and "1 member(s)" pluralisation.
5. Users panel before save: "Permissions update after you save."
6. Search hint: "Press Enter to search".
7. Required field on existing records: name the fields that need values, or exempt old records.
8. Task Types: show workflow names; remove the duplicate "(not published yet)".
9. Activity: "ke\kekim created this client"; "Sensitive: No -> Yes".
10. Priorities: "The default priority can't be deleted. Choose another default first."
11. Number field error: "Enter a number, for example 250.5".
12. Make "Pod Lead role under Users & Roles" in the Pods help line a link.

## 5. What worked well

Access Pending (copyable account name, deep-link redirect, "Check again", friendly 403, trimmed nav, pending badge); roles (System Admin locked in UI and API, duplicate names caught, grouped permissions); pods (one primary enforced, aria-labelled star); priorities/labels (arrows and drag reorder, rename, duplicate detection, default protection, inline delete confirmation, live badge preview); clients/matters (live number hints, precise errors, "View the existing client" link, copy button with aria-live, sensitive banner states it is only a warning); projects (duplicate names, archive confirmation); form designer (conditional rules in preview, test submit, notes, key locked once saved, publish impact summary, v1 retired on v2 publish); workflow designer (diff dialog, Alt+Up/Down, version history, read-only published); accessibility (skip link, visible focus, labelled controls, one axe violation across 10 screens, no contrast failures); responsive (no overflow at 1280/1024).

## 6. Console and network

Listeners logged console errors/warnings, page errors, HTTP >= 400 and failed requests for every journey: no page errors, no failed requests, no 5xx. Only deliberate validation conflicts appeared (409: POST /roles, DELETE /roles/5, PUT /priorities/2, POST /priorities, POST /asset-link-roles, POST /clients, POST /matters, POST /projects; 400: POST /workflows/9/versions/10/publish on an empty draft).

## 7. Caveats

Tasks ignored as instructed. Audit Log is a placeholder, so audit content was checked only via Activity/History tabs. Step creation and Task Type / Asset Type deactivate were spot-checked only. The throwaway database died with the container.
