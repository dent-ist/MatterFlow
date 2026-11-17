# Task Type access mockup (#1402, epic #1397)

Mockup only: static HTML, CSS and JS, no build, no network, nothing saves, no app code changed. Open `index.html` in a browser (double-click). Sizes: 1366x768 and 1920x1080 (desktop only). `assets/tokens.css` is a copy of `docs/ux/tokens.css`; icons are PrimeIcons (`assets/primeicons.*`). All data is invented (13 law-firm task types, 10 roles, 86 people who can open tasks). "Today" is fixed at 11/17/2026 so the screens read the same every day. No keyboard shortcut is added or changed (#420). Screenshots are on the `design-evidence` branch, folder `tasktype-access-mockup-1402` (not on this branch).

What it answers: issue #1402 says "mockup first only if the guideline does not already cover the pattern". The guideline covers most of it (grid, multi-select, tabs, banner, confirm dialog, tooltip, states), so this mockup reuses those and marks the few places where no rule exists yet (section "For the UI designer").

## Read this first: the Task Type edit screen is a page, not a dialog

The issue and the task text say "create/edit dialog". On `dev` it is not: Administration > Task Types opens a **record page** (`/admin/task-types/:id`) with the header, the facts strip and the tabs Overview, Workflows and Request Form; the Overview tab is the edit form with its own sticky `[Cancel] [Save Changes]` (D-44n). The mockup therefore shows the page. The three role multi-selects, the summary line and the confirm are the same whatever the container.

## Decision: Access is a fourth tab, not a section of Overview

Recommendation: a tab named **Access** (icon `pi-lock`, Title Case, D-15), last in the strip. `?placement=section` shows the alternative (Access as a section under General on Overview) so the two can be compared.

Why a tab:

1. **It does not fit under General.** At 1366x768 the General section already fills the panel (name, icon, color, turnaround, description); a section under it starts below the fold (screenshot 14). A security setting that is reached by scrolling is easy to miss. Access alone fits in one screen (screenshot 03).
2. **Its own save weight.** It has its own endpoint (`PUT /task-types/{id}/access`), its own preview and its own confirm, and the people who change it are not always the people who rename a type. A tab keeps the Overview save simple and the Access confirm unmistakable.
3. **It matches the page.** The page is already one concern per tab (Overview, Workflows, Request Form), and all of them share the sticky footer that appears while something is edited (`showFooter`). Workflows is the precedent for a list of linked things on a tab.
4. **Visible without opening it.** The record header shows a `Restricted` chip next to `Active`, so a restricted type is recognisable on every tab.

The tab is also enabled on **New Task Type** (the rules are saved together with the new type: create, then save the access, in the one click `Create Task Type`). A disabled tab like Request Form ("Save the task type first") would leave a new sensitive type open to everyone, usable and active, until someone comes back. No confirm on a new type: it has no tasks and nobody to lose access.

## Screens and states

Use the **Mockup Guide** (bottom-left pill) for links and switches, or the URL options below.

1. **Task Types list with an Access column** (`?view=list`, screenshots 01, 02). New column **Access** after Request Form (D-43: status words before counts), 148 px.
   - Open type: plain muted word `Everyone` (a repeated chip on every row would be noise, D-12 "no repeated Available chip").
   - Restricted type: status chip, slate with `pi-lock` (slate = sensitive, D-04): `Restricted 3`, the number is how many roles can view. The chip is a text-button chip (`mf-btn--chip`) that opens the type's Access tab. Tooltip (`[mfTip]`, D-18, also on keyboard focus) lists the three lists: "Can View: Attorney, eDiscovery Analyst, Partner / Can Edit: Attorney, Partner / Can Be Assigned: no extra limit". The number is never the only place for the information.
   - All View roles inactive: the same chip in amber with `pi-exclamation-triangle` and the tooltip line "All Can View roles are inactive, so only System Admin can see this task type." (design section 9.3; row "Contract Analysis").
   - **Filter and sort** use the shared grid pattern: the filter row gets a select `All Access / Everyone / Restricted` (like Request Form), the heading sorts (first click puts Restricted first, like the count columns), and the strip gets a toggle chip **Restricted 4** beside Active, Not Usable, Form in Draft and Inactive (`?filter=restricted`, screenshot 02).
   - **Fit at 1366 (D-43a).** The default columns already fill 1098 px (D-44u). To add Access (148) and keep Name at its 200 px minimum, **Target (Days) moves to the optional columns** (hidden by default, one click away in Columns; `?target=1` shows it and then Name falls to 79 px, so it only works on a wider window). Name is 201 px at 1366. This is an owner choice (open question 2).
2. **Access tab** (`?view=record&id=3&tab=access`, screenshots 03, 04, 05).
   - Left, three fields in one column (D-35, 480 px): **Can View**, **Can Edit**, **Can Be Assigned**. Each is `mf-dropdown` in `field` + `multi` form (36 px trigger, checkbox per role, role member count at the right, `Done`), and under it the chosen roles as removable tag chips (`mf-tag-chip`, "Remove <role>"). The trigger of an empty list reads what empty means: `Everyone (No Limit)` for Can View, `No Extra Limit` for the other two.
   - Plain-English help under each: Can View "Roles that can see this task type. Leave empty so everyone can." Can Edit "Roles that can change its tasks and create new ones. Leave empty so everyone who can view can also edit." Can Be Assigned "Roles whose people can be chosen as assignee. Leave empty so any viewer who normally takes tasks can be."
   - **Edit and Assign roles are added to View, visibly.** A role chosen in Can Edit or Can Be Assigned appears in Can View at once as a slate chip with a link icon and no remove button (tooltip: "Partner is in Can Edit, so it can also view. Remove it from Can Edit first."), and Can View carries the note "Roles in Can Edit or Can Be Assigned are added here (link icon)." Choosing an Edit role on an open type therefore restricts it (the server does the same, design 19.3), and the summary says so.
   - Right, a card (D-10): the **live summary line**, exactly "Open to everyone." or "Restricted: 3 roles can view, 2 can edit, 2 can be assigned." (when Edit or Assign is empty: "all viewers can edit", "all viewers can be assigned"), then "How access works": roles add up (any of a person's roles qualifies), hidden means hidden (lists, counts, search, notifications, exports), System Admin always sees everything and reports are not limited by these rules. The summary is a polite live region.
   - A role that is inactive cannot be newly chosen (disabled row, "Inactive" instead of a count); one already in a list shows an amber chip and the summary adds an amber note (`?id=10`, screenshot 12). A server refusal (`ROLE_NOT_FOUND`) is the usual red field error (`?state=fielderror`).
   - Footer `[Cancel] [Save Changes]`, only while something is edited (as on the page today); `Save Changes` becomes `Saving...` while busy.
3. **Confirmation from the preview** (`mf-confirm-dialog`, 416 px, screenshots 06, 07, 08, 15). Save asks `POST .../access/preview`; while it runs the dialog shows skeleton lines. The dialog opens only when the save changes who sees or edits (`peopleLosingView`, `peopleLosingEdit`, `becomesOpenToEveryone` or `callerLosesView`); a save that affects nobody saves at once with the toast "Access rules saved". Title "Save Access Rules", `[Cancel] ... [Save Access Rules]` (D-30, D-34). Wording (counts come from the preview):

   | Preview | Lead sentence | Lines under it |
   | --- | --- | --- |
   | `peopleLosingView` > 0 | "This will hide the task type from 61 people." | "14 open tasks of this type will no longer appear for them in lists, counts, search or notifications." and, if `openTasksAssignedToPeopleLosingView` > 0, "3 of those tasks are assigned to them and stay assigned. Reassign them first if the work must continue." |
   | `becomesOpenToEveryone` | "This makes the task type open to everyone." | "Everyone who can use tasks will be able to see and use Privilege Review and its 14 open tasks. The roles you removed are no longer needed." |
   | `peopleLosingEdit` > 0 | (with the first row) | "17 more people can still view it but no longer change it." |
   | `callerLosesView` | (added line, bold) | "You will lose access yourself. You hold none of the chosen roles, so you will no longer see Privilege Review. Only a System Admin can change it back." and the confirm button turns solid red (D-34, hard to undo) |
   | none of these | no dialog | toast "Access rules saved" |

   Closing line, except when you lose access: "You can change the access again at any time." (D-34: say whether it can be undone). A System Admin never gets the "you lose access" line.
   - **Preview fails**: the dialog says "Couldn't check who is affected. Nothing was saved..." with `[Cancel] [Retry]` (`?preview=error`); **checking**: skeleton (`?preview=loading`).
4. **Switch off: "Access rules are saved but not enforced yet"** (`?enforced=0`, screenshots 09, 15). Amber banner (D-10a, `pi-exclamation-triangle`; amber because the setting does nothing yet and people may think it protects) on the Access tab and above the list when at least one type is restricted ("4 restricted task types are still visible to everyone until Task Type Access is switched on."). The chip tooltip adds "Saved, but not enforced yet." The confirm changes its lead to "These rules are saved but not enforced yet, so nobody loses access today." plus "When Task Type Access is switched on, this will hide Privilege Review from 61 people (14 open tasks)." and a toast "Not enforced yet" follows the save. Without a UI to flip the switch the banner names "IT" (it is `Features:TaskTypeAccess` in the server settings).
5. **Roles: role in use** (`?view=roles&error=1`, screenshot 10). Administration > Users > Roles, Delete Role > confirm (the existing "Delete Role" dialog) > the 409 `ROLE_USED_BY_TASK_TYPE` is shown inline in the editor in the existing error style, no toast (D-51): "This role is used by 1 Task Type. Remove it there first." (the server text, "Task Types" for more than one), plus one text button per Task Type from the problem meta (`taskTypes`) that opens that type's Access tab. `?usedby=3` shows the three-type wording. The existing "N users have this role" 409 is unchanged and comes first.
6. **Audit Logs** (`?view=audit&menu=event`, screenshot 11). The three new events appear under Configuration Changes (TaskType is a configuration object). Labels for `audit-format.ts` `EVENT_TYPES`: `TASK_TYPE_ACCESS_CHANGED` = "Task type access changed", `TASK_TYPE_RESTRICTED` = "Task type restricted", `TASK_TYPE_UNRESTRICTED` = "Task type opened to everyone" (plain words instead of "unrestricted"). The What column shows the label and, under it, the summary text the server already writes (`Task Type 'Privilege Review': Can View changed from (everyone) to Attorney, ...`), the Target links the Task Type. The Event Type dropdown lists them. Events of one save share a correlation id, so the real page groups them under one operation row; the mockup lists them flat.
7. **Empty, loading, error** (shared components, nothing new): list `?scene=empty` ("No task types yet." + New Task Type), `?scene=loading` (skeleton rows), `?scene=error` ("Couldn't load task types." + Retry), `?scene=allopen&filter=restricted` ("No task types match these filters." + Clear Filters); Access tab `?state=loading` (skeleton of the real layout, "Loading access rules" for readers), `?state=error` ("Couldn't load the access rules." + Retry, screenshot 13), `?state=stale` (the existing "Someone else changed this task type. Reload Latest" line, because the access save and the type save share a row version). A save failure toast is "Couldn't save the access rules." + reason (`?state=saveerror`, then Save Changes).

## How to open and switch

| Option | Values |
| --- | --- |
| `?view=` | `list` (default), `record`, `new`, `roles`, `audit` |
| `?id=` `&tab=` | task type (default 3, Privilege Review) and `access` (default), `overview`, `workflows`, `form` (the last two are stubs) |
| `?placement=` | `tab` (default), `section` (alternative, plus `&scroll=access`) |
| `?enforced=` | `1` (default), `0` (not enforced) |
| `?viewer=` | `manager` (default, only the Operations Admin role, can lose access), `sysadmin` |
| `?scene=` | list data: `normal`, `allopen`, `empty`, `loading`, `error`; `?filter=restricted` or `inactive` |
| `?state=` | Access tab: `ready`, `loading`, `error`, `stale`, `saveerror`, `fielderror` |
| `?draft=` | unsaved choices, e.g. `view:1,4,7,8\|edit:1,7,6\|assign:1,4` (role ids: 1 Attorney, 2 Billing, 3 Contract Reviewer (inactive), 4 eDiscovery Analyst, 5 Operations Admin, 6 Paralegal, 7 Partner, 8 Project Manager, 9 Records Clerk, 10 Vendor Liaison) |
| `?menu=` | `view`, `edit`, `assign` (open a role list), `event` (Audit) |
| `?dialog=` `&preview=` | `confirm` or `delete`; preview `auto` (computed from the choices, mockup arithmetic), `hide`, `open`, `lose`, `all`, `notenforced`, `loading`, `error` |
| `?tip=` | `access` (forces the first restricted row's tooltip), `chip`, `summary` |
| `?error=1` `&usedby=` | Roles 409; `1` (default) or `3` |
| `?cell=plain` `?target=1` | Access cell without the number; show Target (Days) |
| `?chrome=0` `?guide=1` | hide / open the guide |

The screens are interactive: change the role lists, `Save Changes` shows the computed preview and the confirm, and the list, header chip, banners and toast follow (nothing is stored; reload resets). Esc closes a dialog or an open role list, as the app does today.

## For the UI designer (new or stretched patterns; prefer existing, nothing private was invented)

1. **A fourth tab "Access" on the Task Type record page**, and a `Restricted` status chip beside `Active` in the record header (D-15, D-12). A rule is needed for "a tab that exists on a new record".
2. **Access column** (status chip with a count inside, or the word `Everyone`) and the **Restricted strip chip**. D-44u lists the Task Types default columns: it needs Access added and Target (Days) moved to optional.
3. **Multi-select as a form field with the choice shown as removable tag chips under it**, and a **non-removable "linked" tag chip** (slate, `pi-link`) for a role that is there because another list needs it. D-14 only describes the toolbar form ("Attorney +2"); the chips are the existing `mf-tag-chip`. Also the **first row of the list**: "Everyone (No Limit)" and "No Extra Limit" instead of "All <Things>", because "All Roles" would read as the opposite of what an empty list means.
4. **Confirm body with a lead sentence and up to three fact lines with icons** (D-34 says one sentence), and a solid red confirm for "you lose access". The lines are the existing 14 px text with 18 px icons.
5. **Inline 409 with links** (Roles): the existing error line plus one text button per Task Type.
6. **Amber chip with a triangle in a status place that is usually slate** (restricted but every View role inactive).

Not decided by the mockup, to be added to `docs/ux/design-guidelines.md` by #1402 (D-12, D-14, D-34, D-43, D-44u, and a new D-44 entry for the Access tab) once the designer agrees.

## Open design questions (for the owner)

1. **Tab or section?** Recommendation: the Access tab, enabled on a new Task Type and saved with it (see Decision above).
2. **Make room for the Access column by hiding Target (Days) by default?** Recommendation: yes; it stays one click away in Columns. Alternative: keep every column and show the chip without the number (`?cell=plain`, Access 128 px, Name 221 px, Target still has no room).
3. **When to confirm.** Recommendation: only when the save changes who sees or edits (otherwise save and toast), and the confirm may carry a lead sentence plus fact lines. Alternative: always confirm, or strictly one sentence.
4. **If the preview fails**, block the save (Cancel and Retry only, as mocked) or offer "Save Without Checking". Recommendation: block, so nobody restricts a type without knowing how many people it hides.
5. **Audit label for `TASK_TYPE_UNRESTRICTED`:** "Task type opened to everyone" (mocked) or "Task type unrestricted". Recommendation: the plain one.

## Assumptions and what this mockup does not cover

- The people counts and "open tasks" in the preview are mockup arithmetic (members of the chosen roles, capped at 86); the real numbers come from `POST /task-types/{id}/access/preview`. `Records Clerk` has 0 members so the role-in-use screen can show a delete that passes the member check.
- Role names and the people counts in the list are shown from `GET /roles`, which `TaskType.Manage` holders can read (#1399). System Admin is not offered in the lists: it always sees everything.
- Not shown: dark mode, the Workflows and Request Form tabs (stubs), the unsaved-changes question (unchanged), the Matter and task screens that follow the rules (#1400, #1401), a proactive "used by N Task Types" line on the Role editor (the usage query exists in #1399 but no endpoint is named; optional follow-up).
- Not run: axe, the guard specs, ngc, the Angular build; this is static HTML. Keyboard order was reasoned about, not walked with a screen reader. The real component set (`mf-dropdown`, `mf-confirm-dialog`, `mf-record-grid`) will differ in pixels; the sizes and tokens are the ones of the guideline.
