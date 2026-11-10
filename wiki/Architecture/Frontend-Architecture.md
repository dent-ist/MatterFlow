# Frontend Architecture

[[_TOC_]]

**What this page is for.** How the Angular app is organised: stack, folders, routing and guards, state, the HTTP layer, the shared UI kit, theme and design tokens, the form-engine library and the grid. Design decisions are in `docs/architecture.md` section 12; the UI standard is `docs/ux/design-guidelines.md`. Practical pages: [Folder Structure](../Frontend/Folder-Structure.md), [Routing and Navigation](../Frontend/Routing-and-Navigation.md), [Shared Components Catalogue](../Frontend/Shared-Components-Catalogue.md).

## Stack

- Angular 21, standalone components only (no NgModules), `OnPush` change detection, the new control flow (`@if`, `@for`), strict TypeScript.
- PrimeNG 21 with the Aura preset, customised in `core/theme/mf-preset.ts` and driven by tokens in `docs/ux/tokens.css`. Light theme only. Components are used through thin wrappers in `shared/ui`.
- Tiptap for the rich text editor (notes, comments, task description).
- Vitest for unit tests, Playwright (with axe-core) for end-to-end tests, ESLint (`angular-eslint`) and Prettier.
- Desktop only (owner decision, 2026-11-04): 1366x768 and 1920x1080.

## Layers

::: mermaid
flowchart TB
  ROUTES["app.routes.ts: lazy routes and guards"] --> SHELL["shared/layout: app shell, navigation, search, bell"]
  SHELL --> FEATURES["features/*: pages, components, facades"]
  FEATURES --> SHARED["shared/*: ui kit, filters, work-queue, tasks, forms, charts, directives, pipes"]
  FEATURES --> CORE["core/*: auth, http, session, lookups, theme, time, notify, views"]
  FEATURES --> GEN["api/generated: NSwag client"]
  FEATURES --> FE["projects/form-engine: dynamic forms"]
  SHARED --> CORE
  GEN --> HTTP["HttpClient with MF_HTTP_INTERCEPTORS"]
  CORE --> HTTP
:::

Rule: a feature imports from `core`, `shared`, `api/generated` and `form-engine`, **never from another feature**. ESLint enforces it with a `no-restricted-imports` pattern on `**/features/*` (`frontend/eslint.config.js`). Note: the pattern only catches import paths that spell out `features/`; a relative import into a sibling feature folder is not matched. For example `features/tasks/tasks.routes.ts` loads `../task-queue/pages/task-queue-page` (the Task Queue page lives in `features/task-queue` and is mounted at `/tasks`). Another example: `features/matters/pages/matter-detail-page.ts` imports `ProductionsTab` from `features/productions`, `NotesTab` from `features/notes` and project panels from `features/projects`. Treat such links as exceptions to keep small. Shared pieces are promoted to `shared`.

## Routing and permission gating

- `app.routes.ts`: `access-pending` and `error` sit outside the shell; everything else is inside `AppShell` behind `accessGuard`. Each feature is a lazy `loadChildren` route.
- Guards use `canActivate` (so a refused user lands on `/403`, not `/404`): `permissionGuard(...codes)` (any), `permissionAllGuard(...codes)` (all), `unsavedChangesGuard` on forms (`shared/guards`).
- The Administration route is open to anyone who may open any admin menu item; each child route has its own guard. The menu list (`ADMIN_NAV_ITEMS` in `shared/layout/nav-items.ts`) is the single source for both.
- Full route table: [Routing and Navigation](../Frontend/Routing-and-Navigation.md).

## State

**Signals plus per-feature facade services; no NgRx.** Server data comes through `HttpClient` and RxJS at the edge and is exposed as signals. App-wide singletons are signal stores in `core`:

| Store or service | Folder | Holds |
|---|---|---|
| `AuthStore` | `core/auth` | The signed-in person from `/me`: roles, permissions, pods, `hasWork` |
| `LookupStore`, `ReferenceNames`, `workflow-lookup` | `core/lookups` | Priorities, status labels, asset link roles, task types, names by id |
| `ViewState` service | `core/views` | Remembered screen state and saved views (calls `/api/v1/me/views`) |
| `NotificationService`, `UndoService` | `core/notify` | The one toast API (PrimeNG `MessageService` is banned by lint) |
| `SessionReset` | `core/session` | Stores register a `clear` function that runs when another person signs in |
| Branding, availability | `core/branding`, `core/availability` | Application name and icon; availability state and labels |
| Clock and time | `core/time` | Viewer time zone and date helpers |

Nothing about a matter is written to `localStorage`; the keys hold ids of the person's own preferences only (Sensitive matter rule).

## HTTP layer

`core/http/interceptors.ts` (`MF_HTTP_INTERCEPTORS`): `timeZoneInterceptor` adds `X-Time-Zone`; `csrfInterceptor` adds `X-LptHub-Client: web` on state-changing calls; `problemDetailsInterceptor` turns `application/problem+json` into a typed `ApiError` and raises the global toast unless a request opts out (`SKIP_ERROR_TOAST`); `connectivityInterceptor` drives the connection banner. 409 `CONCURRENCY_CONFLICT` offers a reload. The client itself is generated: [API Client and Generated Code](../Frontend/API-Client-and-Generated-Code.md).

## Shared UI and the standard

`shared/ui` holds the building blocks (page header, record header, tabs, grids, chips, dialogs, drawers, state blocks, pickers, tooltips). `shared/filters` holds the list toolbar and filter popovers. `shared/work-queue` and `shared/tasks` hold the task table and task widgets reused by Task Queue, My Work, Pod Work, Dashboard and the Matter and Project Tasks tabs. The catalogue of "which component for what" is section 3 of `docs/ux/design-guidelines.md`, summarised in [Shared Components Catalogue](../Frontend/Shared-Components-Catalogue.md).

Automated guards (capitalisation, button rule, link style, chip kinds, card style, grid anatomy, form anatomy, icon sizes, theme colours and contrast, initial bundle under 700 kB) are listed in section 6 of the guidelines and in [Testing the Frontend](../Frontend/Testing-the-Frontend.md).

## Theme and tokens

Design tokens are CSS variables in `docs/ux/tokens.css` (loaded through `angular.json` styles). The theme guide `docs/ux/theme-guide.md` explains the three layers and how to adopt the tokens in a page. Never write a colour literal or an off-scale size; the lint scripts `check-theme-colours.mjs`, `check-theme-contrast.mjs`, `check-icon-sizes.mjs` and `check-off-scale.mjs` fail the build. Global styles live in `frontend/src/styles/` (`_buttons.scss`, `_cards.scss`, `_tables.scss`, `_dialogs.scss`, `_forms.scss`, `_menus.scss`).

## Form engine library

`frontend/projects/form-engine` is an Angular library built before the app (`npm run setup` builds it into `dist/form-engine`). It renders and designs dynamic forms from a schema, evaluates conditional rules with the same vectors as the .NET engine, and is used by Task Type request forms, Step forms, Asset Types, custom fields, and the create task page. See [Forms and Form Engine](../Frontend/Forms-and-Form-Engine.md).

## Grids

Lists share one grid anatomy (row heights, header, pager 25/50/100, column resize, reorder, filters, Columns menu, remembered preferences): `shared/ui/grid-*.ts`, `data-table.ts`, `pager.ts`, `shared/work-queue/task-table.ts`. See [Grids and Column Preferences](../Frontend/Grids-and-Column-Preferences.md).

## Related pages

- [Folder Structure](../Frontend/Folder-Structure.md)
- [UI Standard](../Frontend/UI-Standard.md)
- [How to Add a Page](../Frontend/How-to-Add-a-Page.md)

Last verified against commit f45fc1d.
