# Roles editor layout and Dashboard permissions

Screenshots taken on the real stack (SQL Server in Docker, published API serving the Angular build, Chromium) as System Admin and as the personas named in the file names.

## 1. Roles editor: field alignment

Before: Name and Description were 480 px, the search box and "Copy from role" sat in a loose row at different widths, the search box lost its label inside the fixed-header page (so the two controls sat at different heights), and a blank live-region line pushed the first permission group down.

After: the form part is one 640 px column (same width as `.mf-form-card`): labels use the shared `.mf-label`, every control is a full-width `.mf-control` with the same 40 px height, Search permissions and Copy from role share one row aligned to the same edges (one column at 375 px), the empty note line takes no space, and permission codes sit on their own line above the description.

| Viewport | Before | After |
|---|---|---|
| 1366x768 | `roles-before-editor-1366.png` | `roles-after-editor-1366.png` |
| 1024x768 | `roles-before-editor-1024.png` | `roles-after-editor-1024.png` |
| 375 (full page) | `roles-before-editor-375.png` | `roles-after-editor-375.png` |

The new Dashboard group of the permission catalog: `roles-after-editor-dashboard-1366.png`, `-1024.png`, `-375.png`.
No horizontal page scroll at any of the three widths (checked in the e2e test `dashboard-permissions.spec.ts`).

## 2. Dashboard permissions

`Dashboard.View` opens the Dashboard (menu item and route); each tab has its own permission and only has effect with `Dashboard.View`.

| Screenshot | Role | What shows |
|---|---|---|
| `dashboard-director.png` | Director | all five tabs |
| `dashboard-pod-lead.png` | Pod Lead | Summary, Swimlane, Users |
| `dashboard-project-manager.png` | Project Manager | Summary, Swimlane |
| `dashboard-data-technician.png` | Data Technician | Summary only (the unassigned queue to pick work from). Superseded by issue #81: the technician now holds `Dashboard.ViewUnassigned` and sees the queue alone, see `../dashboard-v5/README.md` |
| `dashboard-trends-and-swimlane.png` | custom: View + Trends + Swimlane | those two tabs |
| `dashboard-view-only-no-tabs.png` | custom: Dashboard.View only | the friendly note with a link to My Work |
| `dashboard-no-dashboard-view.png` | custom: no Dashboard.View | menu item hidden, route shows the 403 page |
