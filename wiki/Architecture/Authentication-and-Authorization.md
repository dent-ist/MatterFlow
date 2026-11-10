# Authentication and Authorization

[[_TOC_]]

**What this page is for.** How a person is identified (Windows in production, Dev in development), how roles become permissions, how a `Perm:` policy protects an endpoint, and how the permission list reaches the Angular app. Design: `docs/architecture.md` section 6. Code: `backend/src/Modules/LptHub.Identity`.

## Authentication providers

| Provider | When | How |
|---|---|---|
| `Windows` | Production (IIS) and any non-Development environment | ASP.NET Core Negotiate handler; IIS has Windows authentication on and anonymous off |
| `Dev` | Only when `ASPNETCORE_ENVIRONMENT` is `Development` or `Test` | `DevAuthenticationHandler` signs in `Auth:Dev:DefaultUser`, or the user named in the header `X-Dev-User`; the query `?devUser=` works in Development only |

- `Auth:Provider` unset means `Dev` in Development and `Windows` elsewhere (`AuthProviderSelection.Resolve`). Asking for `Dev` in any other environment (Staging and UAT included) throws at startup. Never weaken this guard.
- First sign-in provisions the user just in time (`UserResolver`): an `AppUser` and a `UserIdentity` row with no roles, status Access Pending. Concurrent first requests rely on the unique index and a retry.
- `Bootstrap:SystemAdmins` lists accounts that get the System Admin role once, at their first sign-in, and only while the system has no active System Admin (audit event `ADMIN_BOOTSTRAPPED`).
- Optional AD profile lookup (`ActiveDirectory:LookupEnabled`, off by default) fills display name and email; otherwise the name is `KE\sam` and an admin can edit it.

## Roles and permissions

::: mermaid
flowchart LR
  JSON["contracts/permissions.json: 70 permission codes"] -->|"startup sync"| P["dbo.Permission"]
  CS["Permissions.cs constants"] -.->|"unit test keeps equal"| JSON
  TS["frontend core/auth/permissions.ts"] -.->|"unit test keeps equal"| JSON
  P --- RP["dbo.RolePermission"] --- R["dbo.Role"] --- UR["dbo.UserRole"] --- U["dbo.AppUser"]
  SEED["StarterRoles.cs: Director, Project Manager, Pod Lead, Data Technician, Data Scientist"] -->|"seeded once"| R
:::

- The catalog is `contracts/permissions.json` (code, group, description). The `Identity` module embeds it and syncs it into `dbo.Permission` at every startup (`IdentitySeeder`, `PermissionCatalog.cs`). The C# constants are in `Identity.Contracts/Permissions.cs`; the TypeScript list is `frontend/src/app/core/auth/permissions.ts`. A unit test fails when they differ. Full list: [Permission Catalogue](../Reference/Permission-Catalogue.md).
- **System Admin** is a built-in role row (`dbo.Role.IsSystemAdmin`). It holds every permission implicitly, including permissions added later. At least one active System Admin must remain (`LAST_ADMIN`).
- **Starter roles** (`Seeding/StarterRoles.cs`): Director, Project Manager, Pod Lead, Data Technician, Data Scientist. They are seeded once, only when no non-system role exists, and administrators edit them afterwards. A script may also grant a new permission to existing roles (for example script 46 grants `Asset.Dispose`, script 65 grants `Report.Run` to the Project Manager role only while it still has the starter description). `Report.Run` is held by the Project Manager starter role and no other (owner decision 8); it shows only the reports an administrator has assigned to the person's roles, so per-report access is the assignment, not the permission.
- **Director and `Matter.BeManager` (issue #976, owner decision 2026-11-07).** The starter Director holds `Matter.BeManager` (no new permission) so that it opens My Matters, which needs `Matter.BeManager`, `Matter.View` and `Task.View`. Side effects: the Director can be named Primary or Secondary project manager and gets the "My matters / All" switch on the lists (the default scope depends on whether the person manages a matter, see Landing page below; All through `Matter.AssignManagers`). The Director's landing page is the Dashboard, set as the role's landing page (script 67), so My Matters stays in the menu but is not the start page. Who sees sensitive matters is unchanged (`Matter.ViewSensitive`). Existing databases: `66-director-be-manager.sql`.
- A user's **effective permissions** are the union of the permissions of their active roles. An account with none is **Access Pending**. A disabled account gets 403 `ACCOUNT_DISABLED`.
- **No code branches on role names.** Only permission codes (architecture test `Authorization_never_uses_role_names`). The one place a role name appears is the frontend landing rule for the Project Manager (`PROJECT_MANAGER_ROLE` in `guards.ts`), which only matters in step 3 of the landing rule (Automatic).

## Policies on endpoints

- Policy name = `Perm:<code>`. Alternatives with `|`: `Perm:Task.View|TaskType.Manage` (any one is enough).
- Write the policy with the constants: `[Authorize(Policy = "Perm:" + Permissions.Task.Create)]`, or the shortcut attribute `[RequirePermission(Permissions.Task.Create)]` (`Authorization/AccessAuthorization.cs`).
- `[AllowAuthenticated]` is only for `GET /api/v1/me` (it lets Access Pending users in). Anonymous endpoints are allow-listed in `AuthorizationRulesTests` (for example branding reads, `/api/v1/system`, health).
- `FailClosedConvention` gives any action without a policy the "active and not pending" default, and the architecture test fails the build for it anyway.
- Per-record rules sit on top of the permission: the Sensitive matter rule ([Sensitive Matter Visibility](Sensitive-Matter-Visibility.md)), calendar access (`ICalendarAccess`), and the Report assignment rule.
- The permission snapshot is cached per process (`Authorization:CacheSeconds`, default 60). A role change on this node takes effect at once; on another node it can take up to that long.

## How permissions reach the frontend

::: mermaid
sequenceDiagram
  participant App as Angular app start
  participant Store as AuthStore (core/auth)
  participant API as GET /api/v1/me
  participant Guard as route guards
  participant UI as components
  App->>Store: load()
  Store->>API: request
  API-->>Store: roles, permissions, isPending, hasWork, pods
  Store->>Guard: permission signals
  Guard-->>App: allow, send to /access-pending, /403 or landing page
  Store->>UI: has(code) signal
  UI->>UI: mfHasPermission directive, nav items, buttons
:::

- `AuthStore` (`frontend/src/app/core/auth/auth.store.ts`) loads `/me`, refreshes on window focus (throttled to 60 s) and after a 403 `PERMISSION_DENIED` or `ACCESS_PENDING`.
- Route guards (`core/auth/guards.ts`): `accessGuard` (everything inside the shell; sends Access Pending users to `/access-pending`), `pendingOnlyGuard`, `landingGuard`, `permissionGuard(...codes)` (any one of the codes), `permissionAllGuard(...codes)` (all codes). Guards use `canActivate`, so a refused user lands on `/403`, not `/404`.
- Controls: the structural directive `*mfHasPermission="'Task.Assign'"` (or an array: any of) in `shared/directives/has-permission.directive.ts`, and menu items declare their permissions in `shared/layout/nav-items.ts`.
- The server always decides. The frontend hides controls but never relies on hiding for security, and it never reads `Matter.ViewSensitive` to decide record visibility.

## Landing page

Epic #1330 (script 67). One function, `defaultLandingPath` (`core/auth/guards.ts`, also called `landingFor`), gives the page behind `/`, the logo, the "Go to ..." link on the 403 and 404 pages and Check Again on Access Pending. A pending or disabled person goes to Access Pending first. The chain, in order:

1. **The person's own choice** (My Profile > My Landing Page), if they can still open that page.
2. **The default of their first role**, if it is set and they can open it. "First" is first by role name (alphabetical, ignoring case, inactive roles left out), the same order `GET /me` and the Users grid return; there is no primary-role field. If that role is Automatic or its page is not openable, the chain goes to step 3, not to the second role.
3. **Automatic**, the older rule: My Matters when `landsOnMyMatters` (all of `Matter.BeManager`, `Matter.View`, `Task.View`; a System Admin only if the Project Manager role is on their profile); My Work when the person has `Task.View` and has work (`hasWork` from `/me`); the Dashboard when any Dashboard tab permission is held; the Task Queue with `Task.View`; otherwise the first page they can open (Clients, Matters, Projects, Assets, Administration); otherwise `/403`.

- **Pages** are stable keys in `contracts/landing-pages.json` (`dashboard`, `my-matters`, `my-work`, `clients`, `matters`, `projects`, `assets`, `pod-work`, `task-queue`, `reports`, `administration`), never URLs. The same file holds the rule for who can open each page (the navigation and route-guard rule); the backend embeds it as `LandingPageCatalog`.
- **Role default:** `dbo.Role.LandingPage`, empty = Automatic. Set in Administration > Users > Roles, field **Landing Page**; the role must be able to open the page (`Role.Manage`). Starter defaults: Project Manager = My Matters, Director = Dashboard; Pod Lead, Data Technician, Data Scientist, System Admin and custom roles = Automatic.
- **Personal choice:** stored in `dbo.UserView` (surface `landing-page`). Set in **My Profile > My Landing Page**; saved at once. If the page is no longer openable (a permission was removed), the person silently falls through the chain, the card says so, and the stored choice is kept in case access returns.
- **API:** `GET/PUT /me/landing-page`, `GET /me/landing-pages` (pages the person can open now), `GET/PUT /roles/{id}/landing-page`. See the [Module Guide](../Backend/Module-Guide.md).
- **My Profile** opens for every person who is not pending, so everybody can reach the picker. The work cards (availability, absences, holidays) need `Task.View`.
- **Compact menu:** the shorter menu (no Pod Work) follows the resolved landing page (`landsOnMyMattersPage`): it applies to a person whose landing page is My Matters, not to everybody who holds `Matter.BeManager`.
- **Default list scope:** Clients, Matters, Projects, Assets and Task Queue open on **All** unless the person manages at least one matter, in which case they open on "My matters". A stored choice always wins. A person who may not choose All stays on "My matters". Code: `ScopeService.defaultFor`.

## Related pages

- [Permission Catalogue](../Reference/Permission-Catalogue.md)
- [How to Add a Permission](../Backend/How-to-Add-a-Permission.md)
- [Request Lifecycle](Request-Lifecycle.md)
- [Demo Data and Personas](../Operations/Demo-Data-and-Personas.md)

Last verified against commit a8f9659.
