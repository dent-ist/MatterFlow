# Administration menu (product-owner request)

Screenshots at 1280 px, taken against a throwaway stack (Dev auth, one pending user).

- Flat menu, in order: Users, Task Types, Labels, Assets, Custom Fields, Audit Logs (`nav.png`). **Update:** Workflows and Workflow Steps became one "Workflows" item with two tabs ([workflow-tabs-tags](../workflow-tabs-tags/README.md)), and that item and Task Types & Forms are now ONE item, **Task Types**, with three tabs Task Types, Workflows and Workflow Steps ([task-types-tabs](../task-types-tabs/README.md)). Pods is no longer a menu item either: it is the third tab of Users ([users-pods](../users-pods/README.md)).
- Users page: tabs Users, Roles and Pods (`/admin/pods`; the Users item is highlighted on all three) (`users-tab.png`, `users-tab-active.png`, `roles-tab.png`). `/admin/users` and `/admin/roles` open the tab. The status filter (Pending access (n), Active, Inactive, All) sits next to the search box and is kept in the address (`status`, `q`, `page`).
- Pods: search box and status select aligned on their inputs (`pods.png`); same check on Task Types, Workflows, Workflow Steps, Clients, Matters, Projects, Assets (all inputs at the same top offset).
- Assets (administration): page title "Asset types and link roles" to tell it from the Assets data records; tabs Asset Types and Asset Link Roles (`assets-tab-asset-types.png`, `assets-tab-link-roles.png`). `/admin/asset-link-roles` redirects to `/admin/asset-types?tab=link-roles`.
- Labels keeps its Priorities and Status labels tabs (`labels.png`).
