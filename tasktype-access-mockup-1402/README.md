# Issue #1402: Task Type access, Task Types screen (mockup)

Branch `tasktype-access-mockup`, folder `docs/ux/mockups/task-type-access/` (open `index.html`; its README explains every state and the URL options). Screenshots of the static mockup in Chromium, 1366x768 and 1920x1080, invented law-firm data, "today" fixed at 11/17/2026. Nothing here is the real app yet; the real screens come with issue #1402.

| File | Screen and state |
|---|---|
| `01`, `02` | Administration > Task Types: the new Access column (`Everyone` / `Restricted 3`), tooltip of a restricted row (01), list filtered to Restricted with the Restricted strip chip (02) |
| `03`, `04` | Task Type > Access tab while editing: three role multi-selects, chips (link icon = added because it can edit or be assigned), live summary line, footer `[Cancel] [Save Changes]` |
| `05` | Access tab, Can View list open (checkboxes, member counts, inactive role disabled, `Done`) |
| `06` | Confirm: "This will hide the task type from 61 people." with open and assigned task counts |
| `07` | Confirm: "This makes the task type open to everyone." |
| `08` | Confirm with every warning, including "You will lose access yourself." (solid red confirm) |
| `09` | Switch off: amber banner "Access rules are saved but not enforced yet." above the list |
| `10` | Administration > Users > Roles: Delete Role refused, "This role is used by 1 Task Type. Remove it there first." with a link to the type |
| `11` | Administration > Audit Logs: the three new events and the Event Type list with their labels |
| `12` | Access tab of a type whose only View role is inactive (amber chip, amber note) |
| `13` | Access tab load error with Retry |
| `14` | Alternative not recommended: Access as a section under General on Overview (starts below the fold) |
| `15` | Confirm while the switch is off: "These rules are saved but not enforced yet, so nobody loses access today." |

Only the list (01/02) and the Access tab (03/04) are shown at both sizes (limit of 15 images); the dialogs, banner, Roles, Audit and state screens are 1366x768 only. Not checked: dark mode, axe, a screen reader, the real components (this is static HTML).
