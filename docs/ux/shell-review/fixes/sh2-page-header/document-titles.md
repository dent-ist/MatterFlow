# Document titles after #606 (S21)

Rule: `<Page or record>: <Tab or view> - MatterFlow`. The only hyphen is the one before the app name. Table-driven unit test: `frontend/src/app/core/title/route-titles.spec.ts`; browser sample: `frontend/e2e/tests/sh-doc-titles.spec.ts`.

| Route | Before | After |
|---|---|---|
| `/admin/roles` | `Users - Roles - MatterFlow` | `Users: Roles - MatterFlow` |
| `/admin/pods` | `Users - Pods - MatterFlow` | `Users: Pods - MatterFlow` |
| `/admin/workflows` | `Task Types - Workflows - MatterFlow` | `Task Types: Workflows - MatterFlow` |
| `/admin/steps` | `Task Types - Workflow Steps - MatterFlow` | `Task Types: Workflow Steps - MatterFlow` |
| `/admin/priorities` | `Labels - Priorities - MatterFlow` | `Labels: Priorities - MatterFlow` |
| `/admin/status-labels` | `Labels - Status labels - MatterFlow` | `Labels: Status labels - MatterFlow` |
| `/admin/asset-types?tab=link-roles` | `Asset Types - Link Roles - MatterFlow` | `Asset Types: Link Roles - MatterFlow` |
| `/admin/reports?tab=runs` (and the other tabs) | `Reports - Run log - MatterFlow` | `Reports: Run log - MatterFlow` |
| `/admin/workflows/new` | `New workflow - MatterFlow` (section lost) | `Task Types: New workflow - MatterFlow` |
| `/tasks/<id>` with the Activity drawer open | `Activity - TSK-12 Title - MatterFlow` | `TSK-12 Title: Activity - MatterFlow` |

Unchanged because they already followed the rule: `Dashboard`, `Clients`, `My Work: Closed`, `Pod Work: <pod>: <tab>`, `<record>: <tab>` on Client, Matter, Project and Asset pages, `<record> not found` on records, `Page not found`, `No access`, `Error`, `Access pending`.

Only the tab text changes; no screen looks different, so there is no new screenshot for this issue (the header numbers are in `../final/`).
