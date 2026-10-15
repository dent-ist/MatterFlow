# Administration menu (product-owner request)

Screenshots at 1280 px, taken against a throwaway stack (Dev auth, one pending user).

- Flat menu, in order: Users, Pods, Task Types & Forms, Workflows, Workflow Steps, Labels, Assets, Custom Fields, Audit Logs (`nav.png`). **Update:** Workflows and Workflow Steps became one "Workflows" item with two tabs ([workflow-tabs-tags](../workflow-tabs-tags/README.md)), and that item and Task Types & Forms are now ONE item, **Task Types**, with three tabs Task Types, Workflows and Workflow Steps ([task-types-tabs](../task-types-tabs/README.md)). The menu is Users, Pods, Task Types, Labels, Assets, Custom Fields, Audit Logs (the Pods item is still there on this branch; the Pods tab under Users is another change).
- Users page: tabs Users and Roles (`users-tab.png`, `users-tab-active.png`, `roles-tab.png`). `/admin/users` and `/admin/roles` open the tab. The status filter (Pending access (n), Active, Inactive, All) sits next to the search box and is kept in the address (`status`, `q`, `page`).
- Pods: search box and status select aligned on their inputs (`pods.png`); same check on Task Types, Workflows, Workflow Steps, Clients, Matters, Projects, Assets (all inputs at the same top offset).
- Assets (administration): page title "Asset types and link roles" to tell it from the Assets data records; tabs Asset Types and Asset Link Roles (`assets-tab-asset-types.png`, `assets-tab-link-roles.png`). `/admin/asset-link-roles` redirects to `/admin/asset-types?tab=link-roles`.
- Labels keeps its Priorities and Status labels tabs (`labels.png`).
