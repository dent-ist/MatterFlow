# Pods under Users (product-owner request)

Screenshots are from a throwaway stack (Dev auth, real API and SQL Server), taken by `frontend/e2e/tests/users-pods-screens.spec.ts`
(`E2E_SCREENSHOTS=docs/ux/users-pods frontend/e2e/run-local.sh -g "users-pods screenshots"`) at 1366x768 and 375x812.

## 1. Pods is the third tab of Users

- Tabs: **Users | Roles | Pods** (`mf-tabs`, route-based like the other two): `/admin/users`, `/admin/roles`, `/admin/pods`. One matcher route, so the page stays alive when the tab changes. `/admin/pods?pod=<id>|new` (the pod editor deep link) keeps working inside the tab.
- Tab permissions: Pods needs `Pod.Manage` or `Pod.ManageMembers` (as before). A tab the person may not use is not offered, and a link to it lands on the first tab they may use (a pods-only user goes from `/admin/users` to `/admin/pods`; no tab at all is the 403 page).
- Menu: the separate "Pods" item is gone. Order: Users, Task Types & Forms, Workflows, Labels, Assets, Custom Fields, Audit Logs. "Users" shows with any of `User.View`, `User.Manage`, `Role.Manage`, `Pod.Manage`, `Pod.ManageMembers` and stays highlighted on all three tabs.
- Document titles: "Users", "Users: Roles", "Users: Pods" (then " - MatterFlow").
- Icon rule: **the Users icon (`pi-id-card`) on all three tabs**, because the tabs are one menu item and one page; the old pods icon is retired (`section-icons.ts` derives it from the Users item's `alsoActive` paths; `route-icons.spec.ts` covers it).
- Breadcrumbs: none, the page is top level like Roles. The pod editor opens inside the tab (title "Edit pod" / "New pod").
- Leaving the Pods tab with an unsaved pod edit asks first (same leave guard as Roles).

| Screenshot | |
|---|---|
| `pods-tab-1366x768.png`, `pods-tab-375x812.png` | Pods tab (list) |
| `pods-tab-editor-1366x768.png`, `pods-tab-editor-375x812.png` | Pod editor with the members table, inside the tab |

## 2. Pods column in the Users grid (inline edit)

- Chips: the primary pod has a star and the text **Primary**, the others are plain, an inactive pod is muted (dashed, "inactive"), more than three collapse to "+N" (full list in the tooltip and the accessible name); "2 pods" count, **No pod** when empty.
- Editor (people with `Pod.ManageMembers`; `Pod.Manage` alone edits pods, not who is in them, same as the Pods tab): the chips are a button (Enter, Space or Arrow Down opens) with a small fixed-position popover: search box, checklist of the active pods, a **Primary** radio on each ticked pod, **Apply** and **Cancel**. Nothing is sent per click; Apply sends ONE request (`PUT /api/v1/users/{id}/pods`).
- Rules: the first pod added to a person with no pods becomes primary. Unticking the primary pod clears it and the popover asks "Choose the primary pod before you apply."; Apply stays blocked (`aria-disabled`, described by that text) until one is chosen; another pod is never promoted silently. Inactive pods the person already has stay (muted, removable); inactive pods are not offered for new assignment. A pending user with no role can be assigned.
- After Apply: chips update at once (optimistic), one toast with **Undo** (restores the previous pods in one request, unless someone changed them since). A failure puts the old chips back and says so; a 409 (someone else changed the person's pods) says so and refreshes the list.
- Keyboard: Arrow Up/Down walk the search box and the checklist, the Primary radios keep their native arrows, Esc closes and returns focus to the button, Tab out or a click outside closes without applying.
- Accessible name of the button: "Pods: Processing (primary), Review, change pods of Jamal Okafor" ("Pods: none, change pods of ..." when empty).
- Read-only users (no `Pod.ManageMembers`) see the chips only.

| Screenshot | |
|---|---|
| `users-grid-pods-column-*` | the grid with the Pods column |
| `popover-open-*` | the popover |
| `popover-primary-required-*` | primary pod unticked: the prompt, Apply blocked |
| `after-apply-undo-*` | chips after Apply and the Undo toast |
| `read-only-chips-*` | a Compliance Auditor (User.View only): chips, no editor, no Pods tab |

## 3. Backend

- `PUT /api/v1/users/{userId}/pods` (`Perm:Pod.ManageMembers`): `{ podIds, primaryPodId?, expectedPodIds?, expectedPrimaryPodId? }`, one transaction, validation (primary among the pods, known pods, active pods for new assignments, enabled user), 409 `CONCURRENCY_CONFLICT` when the expected memberships differ, returns all of the user's pods.
- `GET /api/v1/users` returns `pods` (id, name, isActive, isPrimary) for every listed user with one extra query per page.
- Audit: `PodMember` raw field events are replaced by readable events on the Pod: "Added Jamal Okafor to Processing Pod", "Removed Jamal Okafor from Processing Pod (it was their primary pod)", "Set Review Pod as the primary pod of Jamal Okafor (was Processing Pod)". See docs/architecture.md section 9.
