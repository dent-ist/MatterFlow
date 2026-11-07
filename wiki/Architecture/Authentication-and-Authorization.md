# Authentication and Authorization

[[_TOC_]]

**What this page is for.** How a person is identified (Windows in production, Dev in development), how roles become permissions, how a `Perm:` policy protects an endpoint, and how the permission list reaches the Angular app. Design: `docs/architecture.md` section 6. Code: `backend/src/Modules/MatterFlow.Identity`.

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
- **Starter roles** (`Seeding/StarterRoles.cs`): Director, Project Manager, Pod Lead, Data Technician, Data Scientist. They are seeded once, only when no non-system role exists, and administrators edit them afterwards. A script may also grant a new permission to existing roles (for example script 46 grants `Asset.Dispose`, script 61 grants `Report.Run` to the Project Manager role only while it still has the starter description). `Report.Run` is held by the Project Manager starter role and no other (owner decision 8); it shows only the reports an administrator has assigned to the person's roles, so per-report access is the assignment, not the permission.
- A user's **effective permissions** are the union of the permissions of their active roles. An account with none is **Access Pending**. A disabled account gets 403 `ACCOUNT_DISABLED`.
- **No code branches on role names.** Only permission codes (architecture test `Authorization_never_uses_role_names`). The one place a role name appears is the frontend landing rule for the Project Manager (`PROJECT_MANAGER_ROLE` in `guards.ts`), which only chooses the landing page.

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

`defaultLandingPath` (`guards.ts`), in order: My Matters when `landsOnMyMatters` (all of `Matter.BeManager`, `Matter.View`, `Task.View`; a System Admin only if the Project Manager role is on their profile); My Work when the person has `Task.View` and has work (`hasWork` from `/me`); the Dashboard when any Dashboard tab permission is held; the Task Queue with `Task.View`; otherwise the first page they can open (Clients, Matters, Projects, Assets, Administration); otherwise `/403`.

## Related pages

- [Permission Catalogue](../Reference/Permission-Catalogue.md)
- [How to Add a Permission](../Backend/How-to-Add-a-Permission.md)
- [Request Lifecycle](Request-Lifecycle.md)
- [Demo Data and Personas](../Operations/Demo-Data-and-Personas.md)

Last verified against commit ba461d2.
