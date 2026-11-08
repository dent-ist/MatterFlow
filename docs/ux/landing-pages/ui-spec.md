# Landing pages: UI design spec (#1331, epic #1330)

Designer spec for (1) a **Landing Page** field per role in Role Setup (Administration > Users > Roles), (2) a **My Landing Page** picker for each person, (3) the rule that turns both into the page a person lands on. Follows `docs/ux/design-guidelines.md` (D-xx). Desktop only, 1366x768 and 1920x1080 (D-82). **No new or changed keyboard shortcut** (#420): nothing here touches `shortcut-registry.ts`.

No screenshots were made (spec only). Facts below were read from `frontend/src/app/core/auth/guards.ts`, `shared/layout/nav-items.ts`, `shared/layout/user-menu.ts`, `features/profile/*`, `features/admin/roles/*`, `shared/scope/*` and `backend/.../Seeding/StarterRoles.cs` on `origin/dev` (53f566e).

## 1. Decisions in one screen

| Question | Decision |
| --- | --- |
| Where does the person choose? | **A "My Landing Page" card on My Profile** (the existing settings page, next to Account and Notifications). Not the user menu. |
| Where does the role default live? | **Role editor, Permissions panel**, a "Landing Page" dropdown right under Description, saved with the role's own Save Changes. |
| What is stored? | A **stable page key** (`dashboard`, `my-matters`, ...), never a URL. Role: key or empty ("Automatic"). Person: key or empty ("Use My Role's Default"). |
| What if the saved choice is no longer allowed? | **Silent fallback at sign-in** (no toast, no blocked page) plus a **visible amber note on the My Landing Page card**. The stored choice is kept, so it works again if access returns. |
| Several roles | **The first role in the person's role list decides** the role default. Today that list is alphabetical by role name (section 6.3). |
| Order of the chain | person's choice, if still openable; else the first role's default, if set and openable; else **today's rule** (section 7). |

## 2. The selectable pages (stable keys)

One list for both pickers, in navigation order (D-80). A page is offered **only if the person (or, in Role Setup, the role being edited) can open it**, with the same test the navigation menu and the route guard already use. The implementation shares one function `canOpenPage(key, has)` so menu, guard, landing and both pickers cannot disagree.

| Key | Label (Title Case, as the navigation names it) | Address today | Offered when |
| --- | --- | --- | --- |
| `dashboard` | Dashboard | `/dashboard` | `Dashboard.View` and at least one tab permission (`Dashboard.ViewSummary`, `ViewUnassigned`, `ViewBreakdowns`, `ViewTrends`, `ViewSwimlane`, `ViewUsers`, `ViewCalendar`) |
| `my-matters` | My Matters | `/my-matters` | `Matter.BeManager` and `Matter.View` and `Task.View` |
| `my-work` | My Work | `/my-work` | `Task.View` |
| `clients` | Clients | `/clients` | `Client.View` |
| `matters` | Matters | `/matters` | `Matter.View` |
| `projects` | Projects | `/projects` | `Project.View` |
| `assets` | Assets | `/assets` | `Asset.View` |
| `pod-work` | Pod Work | `/pods/work` | `Pod.View` and `Task.View` |
| `task-queue` | Task Queue | `/tasks` | `Task.View` |
| `reports` | Reports | `/reports` | `Report.Run` |
| `administration` | Administration | `/admin` (opens the first Administration page the person may use) | any permission of any Administration menu item |

Notes: a System Admin holds every permission implicitly, so all eleven are offered. Calendar, record pages, Profile and the Access Pending, 403 and error pages are not landing choices. Keys never change when a route is renamed; the key to address map lives in one place (frontend) and the API stores and returns keys only. An unknown key coming back from storage is treated as "not set".

## 3. Role Setup: the Landing Page field

### 3.1 Placement

Administration > Users > Roles, role editor, Permissions panel. New field **between Description and "Search Permissions"**:

```
Name (required)
[ Director                                    ]
Description
[ Department head: full operational access ... ]
Landing Page
[ Dashboard                               v ]
Where people with this role start after signing in. People can choose their own page under My Profile.
[ Search Permissions ]   [ Copy From Role ]
```

- `mf-dropdown` with `field` (white form dropdown, D-44r), 36 px, `buttonId="role-landing"`, label "Landing Page", 480 px wide (`--mf-field-max`, D-35) at 1366 and at 1920; the editor pane is wider than 480 px at both sizes so nothing wraps or stretches. The label is Title Case; the field is optional, so no "(required)".
- Help line under it (13 px muted): **"Where people with this role start after signing in. People can choose their own page under My Profile."**
- Options, in this order: **"Automatic"**, then the pages of section 2 that the role can open **right now with the permissions ticked in the editor** (the list changes live as an administrator ticks or clears permissions). Fewer than 10 options, so no search box (D-14). Selected = check mark and 600 weight.
- **"Automatic"** means "no fixed page: use today's rule" (section 7, step 3). It is also what a new role starts with. The option is explained in a tooltip on the field (`[mfTip]`, 13 px): **"Automatic: My Matters for project managers, My Work for people who have work, otherwise Dashboard or the first page they can open."**
- The field is part of the role's existing form: it makes the form dirty, is saved by the existing **Save Changes**, and is discarded by Cancel and by the unsaved-changes question. It does not appear in the "Changed (n)" list (that list is permissions only).
- It is available with the same permission that edits roles (`Role.Manage`); no new permission.

### 3.2 Roles list overview (wide state only)

The roles list gets one more column, **"Landing Page"**, 160 px, between Description (the spring) and Members: the page name, or muted "Automatic". It shows only while no role is being edited (the wide state, which already shows Members and Permissions as columns); in the narrow state beside the editor it is left out. Why: an administrator can see in one glance which role lands where. Width check at 1366: the wide list is about 1098 px; Name 14 to 20 rem, Landing Page 160, Members 112, Permissions 112 still leave Description about 300 px.

### 3.3 States and messages

| State | What the field shows |
| --- | --- |
| Normal | dropdown with the saved value ("Automatic" when nothing is stored) |
| System Admin role (locked) | disabled (grey), value "Automatic"; help: **"System Admin always uses the automatic rule. People with this role can still choose their own page."** |
| Role has no openable page at all | only "Automatic" is offered, the field stays enabled, no message |
| The chosen page is no longer openable (an administrator cleared the permission in this editor, or it was cleared earlier) | the trigger shows **"My Matters (not available)"** with the danger border, error below with `pi-exclamation-circle`: **"This role can't open My Matters. Choose another landing page."** Save Changes is blocked until another value is chosen or the permission is ticked again. The API enforces the same rule and answers with the same sentence. |
| Saving | the editor's existing busy button "Saving..."; success is the existing role toast: **"Role saved"** with detail "Changes apply on each user's next request." (unchanged; the landing change is covered by it) |
| Save failed | the editor's existing inline error line (unchanged) |

Order of tab stops in the editor: Name, Description, **Landing Page**, Search Permissions, Copy From Role, then the permission groups, then the action buttons. The dropdown follows the shared dropdown keys (Enter or Space opens, arrows move, Enter chooses, Esc closes and returns focus), which are keys of one focused widget, not shortcuts.

### 3.4 Person drawer hint (Users)

In the person drawer, under the role checklist, one muted line shows where the role default comes from: **"Landing page comes from Director."** (the first role of the person; nothing is shown for a person with no role). It answers "why does she land there?" without a new control. No change to the drawer's layout rules (D-44l).

## 4. My Landing Page: where it lives, and why

### 4.1 Placement

**A card "My Landing Page" in the side column of My Profile** (user menu > My Profile), after Account and before Notifications. It is a normal `mf-card` (D-10) with the 16/600 title, the same width as its neighbours.

Why My Profile and not the user menu:
- The user menu holds **actions** (My Profile, Set Out of Office, Keyboard Shortcuts). A setting needs its current value, an explanation and room for the "no longer available" note; a menu item would need a dialog on top, and a dialog must not open from a menu entry that is not an action (D-31, D-36).
- My Profile already is the personal settings page (Account, Notifications) and is one click from the user menu. Notifications set the precedent: a control that saves at once and says so.
- No new menu item, no new route, no change to the user menu; the menu stays four entries or fewer (D-36).

**One dependency for the owner (section 11, question 1):** today the user menu shows "My Profile" only to people with `Task.View`, because the page is about work hours and availability. The card must be reachable by everyone who is not pending. Proposed: My Profile opens for every signed-in person; the availability, absence and holiday cards stay `Task.View`-only; Account, My Landing Page and Notifications show for all. Until that is decided, the picker is simply not reachable for a person without `Task.View` (every starter role holds `Task.View`).

### 4.2 Layout at both sizes

The side column is `2fr` of a two-column grid from 1100 px: about 420 px of card at 1366 and about 660 px at 1920. The dropdown is 100% of the card body up to 480 px (D-35), so it is about 388 px at 1366 and 480 px at 1920; the card never changes height between sizes except for the length of the help sentence (it wraps to two lines at 1366).

```
My Landing Page
The page you see first after signing in, and when you click the logo.
Landing Page
[ Use My Role's Default                    v ]
You start on Dashboard. This is the default of your role, Director.
```

- Description line (13 px muted, sentence case): **"The page you see first after signing in, and when you click the logo."**
- Label: **"Landing Page"** (13/600, above the field).
- `mf-dropdown field`, `buttonId="my-landing"`, 36 px.
- Options: **"Use My Role's Default"** first (this is the stored empty value), then the pages of section 2 the person can open **now**, in navigation order. At most 11 options, no search box.
- A live result line (13 px muted, `aria-live="polite"`) always says where the person will land, so the choice has a visible consequence:

| Situation | Line (exact) |
| --- | --- |
| Own choice, openable | **"You start on My Work."** |
| Role default, openable | **"You start on Dashboard. This is the default of your role, Director."** |
| Role set to Automatic, or its default is not openable | **"Your role has no fixed landing page. You start on My Work, chosen automatically."** (the page name is what today's rule picks) |
| Several roles | the role name in the second sentence is the first role: "This is the default of your role, Director." |
| No role default and no choice (a person with no role) | **"You start on Task Queue, chosen automatically."** |

### 4.3 Saving

The choice **saves at once** when picked (like the Notifications switches), because it is one control with a visible result and is reversible by picking again; there is no Save button and no "No unsaved changes" line. While the request runs the dropdown is disabled and the card shows the muted word "Saving...". Success: toast **"Landing page saved"** with detail **"You start on My Work after you sign in."** (or "You start on Dashboard, the default of your role." after choosing "Use My Role's Default"). The result line updates, focus stays on the dropdown.

### 4.4 States and messages

| State | Display |
| --- | --- |
| Loading | card skeleton with the final layout (title, description, one field), D-50; the rest of the page does not wait for it |
| Error loading | inside the card: **"Couldn't load your landing page."** + `Retry` (no toast, D-51) |
| Error saving | the dropdown goes back to the previous value and the card shows **"Couldn't save your landing page."** plus the reason, `role="alert"`, with `pi-exclamation-circle` (inline, no toast; same as Notifications) |
| Saved | toast as above; the line under the field changes |
| Read-only | **not applicable**: it is the person's own setting; there is no one else who views it read-only. A person who cannot open any page does not see the card. |
| **Saved choice no longer allowed** | see 4.5 |

### 4.5 When the saved choice is no longer allowed

Example: the person picked Pod Work, then lost `Pod.View`.

1. **At sign-in or on the logo click: nothing is shown.** The person lands on the next page of the chain (section 7). No toast, no redirect page, no error: a sign-in is not the moment for a notice about a setting, and the person did nothing wrong.
2. **On the My Landing Page card:** an amber banner (`.pg-banner`, D-10a, 36 px or taller when it wraps, `pi-exclamation-triangle`, `role="status"`) above the field: **"Pod Work is no longer available to you, so you start on Dashboard. Your choice is kept in case access comes back."** The dropdown trigger reads **"Pod Work (not available)"**; that entry is not in the list. Choosing any other value (or "Use My Role's Default") replaces it and the banner goes away.
3. **The stored choice is not deleted.** If the permission returns, the person lands on Pod Work again with no action.
4. Admin-side counterpart: none is needed; the Users drawer line (3.4) already names the role the default comes from.

## 5. Components reused (no private widgets)

`mf-dropdown` (`field`), `mf-card`, `mf-page-header` (My Profile already has one), `.pg-banner`, `NotificationService` toast, `mf-record-skeleton`/card skeleton, `mf-state-block`-style inline error with `Retry` (`mf-btn--text`), `[mfTip]`. The role field uses the existing form field structure of `roles-page.html` (`mf-fld`, `mf-label`, `mf-form-error`). New: one pure function `canOpenPage(key, has)`, one constant `LANDING_PAGES` (key, label, address, rule), nothing visual.

## 6. Defaults and rules

### 6.1 Starter-role defaults (reproduce today's landing exactly, except Director)

Today's landing is not a function of the role: step 1 depends on the person ("has work" = any pod membership or assignment, `hasWork` from `/me`). A fixed role page cannot reproduce "My Work if you have work, else Dashboard" for everybody, so those roles get **Automatic** (= today's rule, step 3 of the chain). Only roles whose landing is the same for every member get a fixed page.

| Starter role | Grants that decide the landing | Today lands on | Stored role default | Landing after this epic |
| --- | --- | --- | --- | --- |
| Project Manager | Matter.BeManager, Matter.View, Task.View (no Dashboard tab) | My Matters (step 0) | **My Matters** (`my-matters`) | My Matters (unchanged) |
| Director | Matter.BeManager (script 66), Matter.View, Task.View, all Dashboard tabs | My Matters (since script 66) | **Dashboard** (`dashboard`) | **Dashboard** (the one intended change, #1327) |
| Pod Lead | Task.View, Dashboard tabs Summary, Swimlane, Users, Coverage, Calendar | My Work if the person has work, else Dashboard | **Automatic** | unchanged |
| Data Technician | Task.View, Dashboard.ViewUnassigned | My Work if has work, else Dashboard | **Automatic** | unchanged |
| Data Scientist | Task.View, Dashboard.ViewUnassigned | My Work if has work, else Dashboard | **Automatic** | unchanged |
| System Admin (built-in, locked) | every permission | My Work if has work, else Dashboard; My Matters only when the person also holds the Project Manager role | **Automatic** | unchanged |
| Any role an administrator creates | its own grants | today's rule | **Automatic** | unchanged |

Seeding: the starter-role seeder writes the table above for new databases; script 67 adds the column and sets `my-matters` and `dashboard` only on roles that still have the starter description (the same "still the starter role" sign scripts 38, 65 and 66 use); everything else stays empty. Nothing changes for anybody until an administrator edits a role, except Directors.

A Director whose role is later set back to Automatic lands on My Matters again (the rule is unchanged and `Matter.BeManager` still decides step 0). That is intended: "Automatic" means "today's rule".

### 6.2 Page keys

`dashboard`, `my-matters`, `my-work`, `clients`, `matters`, `projects`, `assets`, `pod-work`, `task-queue`, `reports`, `administration` (section 2). Empty or absent = not set.

### 6.3 Several roles

The role default comes from **the first role in the person's role list**; the other roles' defaults are ignored (the owner's rule). If the first role's default is Automatic or not openable, the chain goes to today's rule, **not** to the second role. The role list is the one `/me` and the Users grid already return: **alphabetical by role name** (`OrderBy(name)`), inactive roles left out. So a person who is Director and Project Manager lands on Dashboard (Director sorts first), and Pod Lead plus Project Manager lands by Automatic. This is visible to the administrator through the Users drawer line (3.4). See section 11, question 2.

## 7. The landing chain (one place, one function)

`defaultLandingPath` becomes `landingFor(store)` and keeps being the single rule behind `/`, the logo, the "Go to ..." link of the 403 and 404 pages and "Check Again" on Access Pending:

1. The person's own choice, if it is a known key and `canOpenPage` is true.
2. Else the first role's default, if set and `canOpenPage` is true.
3. Else **today's rule** exactly as in `guards.ts`: My Matters (step 0, `landsOnMyMatters`) > My Work (`Task.View` and `hasWork`) > Dashboard (any tab) > Task Queue (`Task.View`) > Clients > Matters > Projects > Assets > Administration > `/403`.

A pending or disabled person goes to Access Pending before any of this. The "Go to <name>" link on 403 and 404 names the page the chain picked. Nobody ever lands on a page they cannot open, because step 3 is today's already-safe rule.

## 8. Keyboard and focus (no new or changed shortcuts)

- My Profile: Tab order follows the page: availability and absence cards, then the side column: holiday card, Account, **My Landing Page** (dropdown), Notifications. The banner of 4.5 is not a stop (it is a status); the dropdown is.
- Dropdown: Enter or Space opens, Up and Down move, Enter selects, Esc closes and gives focus back (shared widget keys, D-44b); nothing is bound at page level.
- After a save the focus stays on the dropdown; the toast and the result line are polite live regions.
- Role editor: section 3.3.
- `shortcut-registry.ts` is untouched.

## 9. Wording index (exact strings)

| Where | String |
| --- | --- |
| Role editor label | Landing Page |
| Role editor help | Where people with this role start after signing in. People can choose their own page under My Profile. |
| Role option | Automatic |
| Role option tooltip | Automatic: My Matters for project managers, My Work for people who have work, otherwise Dashboard or the first page they can open. |
| Role locked help | System Admin always uses the automatic rule. People with this role can still choose their own page. |
| Role error | This role can't open My Matters. Choose another landing page. (page name varies) |
| Roles list column | Landing Page (value "Automatic" muted) |
| Users drawer line | Landing page comes from Director. |
| Card title | My Landing Page |
| Card description | The page you see first after signing in, and when you click the logo. |
| Field label | Landing Page |
| First option | Use My Role's Default |
| Result lines | You start on My Work. / You start on Dashboard. This is the default of your role, Director. / Your role has no fixed landing page. You start on My Work, chosen automatically. / You start on Task Queue, chosen automatically. |
| Saved toast | Landing page saved + "You start on My Work after you sign in." |
| Not allowed banner | Pod Work is no longer available to you, so you start on Dashboard. Your choice is kept in case access comes back. |
| Not allowed trigger text | Pod Work (not available) |
| Load error | Couldn't load your landing page. + Retry |
| Save error | Couldn't save your landing page. + reason |
| Busy | Saving... |

Capitalisation follows D-20: labels, options and titles Title Case (minor words lowercase, "Use My Role's Default" keeps "My" capital because it is not on the minor list); help, banners, errors and toasts sentence case.

## 10. Lists that default to the "My matters" scope (for #1334)

The scope switch (`ScopeService`, `PageScope`) applies to anyone with `Matter.BeManager` (a System Admin only when also a Project Manager), and the default is `mine` unless a remembered choice or a link says otherwise (`ScopeService.defaultFor`, `PageScope.value`). **Five lists** build a `PageScope` and so default to My matters:

| # | List | Page key (`PageScope`) | File |
| --- | --- | --- | --- |
| 1 | Clients | `clients` | `features/clients/pages/clients-list-page.ts` |
| 2 | Matters | `matters` | `features/matters/pages/matters-list-page.ts` |
| 3 | Projects | `projects` | `features/projects/pages/projects-list-page.ts` |
| 4 | Assets | `assets` | `features/assets/pages/assets-list-page.ts` |
| 5 | Task Queue | `task-queue` | `features/task-queue/pages/task-queue-page.ts` |

Also scope-aware but not one of the five: **My Matters** itself (it is the "my matters" page by definition; its own All switch is separate) and the Asset Reports builder, which only offers the All choice through `ScopeService.canAll()` and has no default of its own (checked, no change needed unless QA finds one). The shared place for the new rule is `ScopeService.defaultFor`: return `mine` only when the person manages at least one matter (a count from the profile or the first list answer), else `all` when `canAll()`; a person who cannot choose All (no `Matter.AssignManagers`) stays on `mine`. An explicit remembered choice keeps winning. This is a behaviour rule only; **no screen or wording changes**, so it needs no design beyond this list. The scope switch itself (labels "My Matters / All") is unchanged.

## 11. Decisions for the owner (genuine ones only)

1. **My Profile for everyone?** The card needs My Profile to open for people without `Task.View` (section 4.1). Recommended: yes, with the work cards hidden for them. If not wanted, the picker stays unreachable for such custom roles.
2. **"First role" = alphabetical.** The person's role list is alphabetical by name today, so "first role" is alphabetical (Director before Project Manager). Recommended: accept (it is visible in the Users drawer line). The alternative, an explicit "primary role" per person or an assignment order, needs a new field and a Users screen change.
3. **Automatic for Pod Lead, Data Technician, Data Scientist and System Admin.** Needed to reproduce today's behaviour exactly (it depends on whether the person has work). If you would rather have a plain "My Work" for those roles, people with no pod and no assignment would then land on an empty My Work instead of the Dashboard.

Everything else in this spec follows the epic's defaults.
