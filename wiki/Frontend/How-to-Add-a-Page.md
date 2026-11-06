# How to Add a Page

[[_TOC_]]

**What this page is for.** Step by step: add a new screen (route) to the Angular app so that it follows the architecture, the permission rules and the UI standard. Read [UI Standard](UI-Standard.md) first; every screen you create or touch must follow `docs/ux/design-guidelines.md`.

## Steps

1. **Pick the feature folder.** Put the page in the feature it belongs to (`frontend/src/app/features/<area>/pages/`). A new area gets a new folder with `<area>.routes.ts`. A feature may import from `core`, `shared`, `api/generated` and `form-engine`, **not from another feature**; if two features need the same piece, move it to `shared`.
2. **Backend first, if needed.** Add the endpoint and regenerate the client ([How to Add an Endpoint](../Backend/How-to-Add-an-Endpoint.md), [API Client and Generated Code](API-Client-and-Generated-Code.md)).
3. **Create the page component** (standalone, `ChangeDetectionStrategy.OnPush`, signals). Start from a similar page:
   - A list: `features/clients/pages/clients-list-page.ts` (toolbar, filters, grid, pager).
   - A record page: `features/clients/pages/client-detail-page.ts` or `features/matters/pages/matter-detail-page.ts` (header, tabs).
   - A form: `features/clients/pages/client-form-page.ts`.
   - An admin page: `features/admin/priorities` or `status-labels` (lookup list pattern).
4. **Use the shared building blocks** (no private chips, buttons, dialogs): `mf-page-header` (or `mf-record-header` for a record), `mf-tabs`, `mf-grid-frame`, `mf-form-dialog`, state components for empty, loading, error and missing record. See [Shared Components Catalogue](Shared-Components-Catalogue.md). Set the page title with `PageTitle` or the route `title`.
5. **Register the route** in the feature's routes file with a lazy `loadComponent`, a `title` in Title Case, and `canActivate: [permissionGuard('X.View')]` (use `permissionAllGuard` when all codes are needed). Add `canDeactivate: [unsavedChangesGuard]` for forms. Mount the feature in `app.routes.ts` with `loadChildren` if it is new (inside the shell, with its guard).
6. **Menu item** (if it is a main page): add it to `NAV_ITEMS` in `shared/layout/nav-items.ts` with the same permissions as the route (Administration pages go to `ADMIN_NAV_ITEMS`; the `/admin` route reads that list, so a menu item can never be refused by the parent). Add an icon in the registry (`shared/layout/section-icons.ts`, `shared/ui/tab-icons.ts`); the guard spec `route-icons.spec.ts` checks routes have icons.
7. **Permissions in the UI.** Hide controls with `*mfHasPermission`; never rely on hiding for security. New permission: [How to Add a Permission](../Backend/How-to-Add-a-Permission.md). Do not decide Sensitive matter visibility in the frontend: use the server's `canOpen` flags.
8. **Words and formats.** Anything you click or that names something is Title Case; text you read is sentence case. Use the shared copy and pipes for dates, numbers, names and messages. Desktop only: check 1366x768 and 1920x1080.
9. **Remembered state.** If the page has filters, columns or a scope, follow [Grids and Column Preferences](Grids-and-Column-Preferences.md); the address wins over remembered state.
10. **Tests.** A unit spec beside each non-trivial file; a guard spec if you added a pattern; a Playwright spec for the main flow and an axe check ([Testing the Frontend](Testing-the-Frontend.md)).
11. **Checks before you push:** `npm run lint`, `npm run format:check`, `npm test`, `npm run build` (initial bundle under 700 kB), Angular template type check, screenshots at both sizes, axe clean. The full list is in `CLAUDE.md` ("UI standard").
12. **Docs and wiki.** Update `docs/ux/design-guidelines.md` if you introduced or changed a pattern. Update [Routing and Navigation](Routing-and-Navigation.md) and [Feature Map](../Features/Feature-Map.md). Use the UI commit message format ([Branching and Workflow](../Getting-Started/Branching-and-Workflow.md)).

## Related pages

- [Folder Structure](Folder-Structure.md)
- [Routing and Navigation](Routing-and-Navigation.md)
- [UI Standard](UI-Standard.md)

Last verified against commit 2e446f8.
