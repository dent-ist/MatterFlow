# Frontend Folder Structure

[[_TOC_]]

**What this page is for.** Where things are inside `frontend/`, and which folder a new file belongs in. Architecture and rules are on [Frontend Architecture](../Architecture/Frontend-Architecture.md).

## Workspace root (`frontend/`)

| Path | Contents |
|---|---|
| `angular.json`, `tsconfig*.json` | Workspace config; two projects: the app (`frontend`) and the library `form-engine`; configuration `api` for `start:api` |
| `package.json`, `.npmrc` | Scripts (see [Commands](../Getting-Started/Commands.md)); `legacy-peer-deps` |
| `eslint.config.js`, Prettier config | Lint rules (including the "features do not import features" pattern and the toast ban) |
| `nswag.json` | API client generation |
| `proxy.conf.json` | Dev server proxy of `/api` to `http://localhost:5080` |
| `public/` | Static files (favicon, logo) |
| `scripts/` | `check-theme-colours.mjs`, `check-theme-contrast.mjs`, `check-icon-sizes.mjs`, `check-off-scale.mjs`, `bundle-report.mjs`, `theme-colours-baseline.json` |
| `projects/form-engine/` | The dynamic form library |
| `e2e/` | Playwright tests |

## `src/app/`

| Folder | What belongs there |
|---|---|
| `app.routes.ts`, `app.config.ts`, `app.ts` | Route tree, providers (HTTP interceptors, theme, auth), root component |
| `features/<area>/` | One folder per feature: `pages/` (routed components), `ui/` or `components/`, facades and models, `<area>.routes.ts` (lazy). A feature imports from `core`, `shared`, `api/generated` and `form-engine` |
| `shared/ui/` | The UI kit: page header, record header, tabs, grids, chips, dialogs, drawers, state blocks, pickers, tooltip, number and date formatting |
| `shared/layout/` | App shell, navigation (`nav-items.ts`), user menu, notification bell, keyboard shortcuts (`shortcut-registry.ts`), version and banners |
| `shared/filters/` | List toolbar, filter popovers and filter definitions |
| `shared/work-queue/` | The task table and its columns, due cells, empty copy, inline edit, bulk dialog (used by Task Queue, My Work, Pod Work, Dashboard, Matter and Project Tasks) |
| `shared/tasks/`, `assignees/`, `availability/`, `scope/`, `search/`, `matter-actions/`, `task-type/`, `icons/`, `charts/`, `forms/`, `guards/`, `pipes/`, `directives/` | Shared pieces by topic |
| `shared/testing/` | Test helpers shared by specs |
| `core/auth/` | `AuthStore`, route guards, `permissions.ts`, `/me` API |
| `core/http/` | Interceptors, `ApiError`, connectivity |
| `core/session/`, `core/lookups/`, `core/views/`, `core/time/`, `core/theme/`, `core/title/`, `core/notify/`, `core/branding/`, `core/availability/`, `core/identity-admin/`, `core/config/` | Cross-cutting services (see [Frontend Architecture](../Architecture/Frontend-Architecture.md)) |
| `api/generated/` | `api-client.ts` (generated, never edited) |
| `testing/` | Spec utilities (dropdown testing, token colours) |

`frontend/src/styles/` holds global SCSS partials (buttons, cards, tables, dialogs, forms, menus); design tokens are `docs/ux/tokens.css`.

## Features

| Folder | What it is | Size (non-spec files) |
|---|---|---|
| `access-pending` | Page for people with no role yet | 2 |
| `admin` | All Administration pages (subfolders: `users`, `roles`, `pods`, `task-types`, `workflows`, `steps`, `lists` (the Lists page: registry, catalogue page, editor frame), `matter-lists`, `priorities`, `status-labels`, `on-hold-reasons`, `note-tags`, `asset-types`, `asset-link-roles`, `custom-fields`, `reports`, `audit`, `settings`, `holidays`, `shared`) | 108 |
| `assets` | Assets list, record page, form, reports, disposition | 14 |
| `clients` | Clients list, detail, form | 7 |
| `dashboard` | Dashboard page and tabs (`summary`, `swimlane`, `users`, `calendar`, `ui` for breakdowns and trends) | 99 |
| `matters` | Matters list, form, detail page with tabs, header, managers dialog, events panel | 14 |
| `my-matters` | The Project Manager's page (`ui`, `tabs`, `panels`, `data`) | 37 |
| `my-work` | My Work page | 2 |
| `notes` | Notes tab, note editor (Tiptap) and tag chip | 4 |
| `notifications` | Notifications page | 5 |
| `pod-work` | Pod Work page | 5 |
| `productions` | Productions tab | 2 |
| `profile` | My Profile: availability, work hours, notification switches | 4 |
| `projects` | Projects list, detail, form | 6 |
| `search` | Search results page | 8 |
| `system` | Error, 403 and 404 pages | 4 |
| `task-queue` | The Task Queue page (mounted at `/tasks`) | 1 |
| `tasks` | Create task, task detail (workflow, comments, assets, activity panels) | 34 |

## Naming conventions seen in the code

- Files are kebab-case; a routed page ends in `-page.ts`; a record page `<thing>-record-page.ts` or `<thing>-detail-page.ts`; a list `<things>-list-page.ts`.
- Specs sit next to the file: `x.ts` and `x.spec.ts`.
- Components use the prefix `mf-` for selectors (`mf-page-header`), directives `mf` (`mfHasPermission`, `mfTip`).
- Standalone components with inline templates are common (template in the `.ts`); larger ones use `.html` and `.scss` beside them.

## Related pages

- [Routing and Navigation](Routing-and-Navigation.md)
- [Shared Components Catalogue](Shared-Components-Catalogue.md)
- [How to Add a Page](How-to-Add-a-Page.md)

Last verified against commit a8142a1.
