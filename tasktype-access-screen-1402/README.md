# Issue #1402: Task Type access, Task Types screen (built)

Branch `tasktype-access-screen`. Screenshots taken by the Playwright spec `frontend/e2e/tests/tasktype-access-screen.spec.ts` on a real stack (SQL Server 2022, the published API with Dev auth, `Features:TaskTypeAccess=true`), Chromium, 1366x768 and 1920x1080. The data is what the e2e seeding makes (task types "TTA Open ..." and "TTA Secret ...", roles named "E2E tta-a ..." and "E2E tta-b ...", one member each), so names are not the invented law-firm names of the mockup. The owner-approved mockup screenshots are in `tasktype-access-mockup-1402`.

| File | Screen and state |
|---|---|
| `01` | Administration > Task Types: Access column after Request Form (`Everyone`, `Restricted 2` chip with the tooltip), Access filter, strip chip Restricted, Columns button (Target (Days) is hidden by default) |
| `02` | Task Type > Access tab of an open type (empty lists say "Everyone (No Limit)" and "No Extra Limit", summary "Open to everyone.", How access works) |
| `03` | Access tab while editing: a role chosen in Can Edit appears in Can View as a linked chip without a remove button; summary updated; footer `[Cancel] [Save Changes]` |
| `04` | Save Access Rules: "This will hide the task type from 1 person." |
| `05` | Save Access Rules for a person who loses access themselves: bold line, solid red confirm, record header with the Restricted chip |
| `06` | The check failed: "Couldn't check who is affected. Nothing was saved." with Cancel and Retry only |
| `07` | Amber banner "Access rules are saved but not enforced yet." above the list (the answer of a server with the switch off is faked in the browser for this shot) |
| `08` | Administration > Users > Roles: Delete Role refused inline with a button per Task Type that opens its Access tab |
| `09` | Administration > Audit Logs: Configuration Changes quick view with the Task Type access events |

Not shown: no "before" pictures (the old list is the mockup's left-out state; take them from `dev`), the New Task Type page with the Access tab, the amber chip (all View roles inactive: unit tested only, no inactive role exists in the e2e data), dark mode, the checking state of the dialog (it only shows when the check takes longer than 0.4 s), any size other than the two named.
