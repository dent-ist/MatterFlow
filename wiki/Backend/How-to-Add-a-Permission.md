# How to Add a Permission

[[_TOC_]]

**What this page is for.** Every place that must change when you add a permission code, so backend, frontend, database and docs stay in step. Background: [Authentication and Authorization](../Architecture/Authentication-and-Authorization.md). The catalog source of truth is `contracts/permissions.json`.

## Steps

1. **Name it.** Format `Group.Action` with two PascalCase words (regex `^[A-Z][A-Za-z]+\.[A-Z][A-Za-z]+$`, at most 64 characters), for example `Asset.Dispose`. Never branch on role names; only on permission codes.
2. **Add it to `contracts/permissions.json`**: `code`, `group` (at most 40 characters; the roles page lists groups in catalog order, so place it inside its group), `description` (1 to 300 characters, plain words).
3. **Add the C# constant** in `backend/src/Modules/MatterFlow.Identity.Contracts/Permissions.cs`, inside the nested static class of the group, with a summary comment, and add it to `Permissions.All`.
4. **Add the TypeScript code** to the `PERMISSIONS` array in `frontend/src/app/core/auth/permissions.ts` (one code per line; the unit test parses that array).
5. **Update the count test.** `PermissionCatalogTests.Catalog_matches_the_architecture_adjustments_of_finding_fnd_03` asserts the total (`codes.Count.ShouldBe(70)` at the time of writing). Change the number. Other tests in that file lock the Dashboard and Reports groups; read them if you add to those.
6. **Enforce it on the server.** Use it in a policy: `[Authorize(Policy = "Perm:" + Permissions.Asset.Dispose)]` on the controller action, or check it in the service with `IPermissionChecker`. The architecture test fails for any policy naming a code that is not in the catalog.
7. **Enforce it in the UI.** Hide or disable controls with `*mfHasPermission="'Asset.Dispose'"`; guard routes with `permissionGuard('...')` (in the feature's `*.routes.ts`); add the code to a menu item in `shared/layout/nav-items.ts`. The server remains the real check.
8. **Default grants.**
   - The System Admin holds every permission implicitly: no rows needed.
   - New installs: add it to the right starter roles in `backend/src/Modules/MatterFlow.Identity/Seeding/StarterRoles.cs` (roles are seeded **once**, only when no non-system role exists).
   - Existing databases: roles are editable and already seeded, so add a numbered SQL script that inserts the permission row and grants it to the named roles, idempotently (pattern: `db/scripts/archive/46-asset-dispose-permission.sql`, also 34, 60; the archived chain is history, a new script is numbered 67 or higher). Roles that were renamed or created by hand are not touched; say so in the script header.
   - A permission that is only a marker or that no starter role should hold (for example `Settings.Manage`, the Reports permissions): grant to no role and say why.
9. **Docs and wiki:** add the row to [Permission Catalogue](../Reference/Permission-Catalogue.md); mention it in the matching feature in [Feature Map](../Features/Feature-Map.md); update `docs/architecture.md` section 6.3 if it changes the starter role matrix.
10. **Tests:** run `dotnet test tests/MatterFlow.UnitTests` (permission catalog tests) and `npm test` in `frontend/` (guard specs). Add an integration test that a caller without the permission gets 403 `PERMISSION_DENIED` (`IntegrationTests/Tasks/TaskPermissionMatrixTests.cs` is a model).

## Related pages

- [Permission Catalogue](../Reference/Permission-Catalogue.md)
- [How to Add an Endpoint](How-to-Add-an-Endpoint.md)
- [Routing and Navigation](../Frontend/Routing-and-Navigation.md)

Last verified against commit cf50a0a.
