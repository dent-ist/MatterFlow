# Issue template for UI update 2 (every dev issue Agent U creates follows this)

One issue = one dev agent, one worktree, one reviewable change of about 2 to 6 agent-hours. The agent does exactly what the numbered changes say, nothing else. If something is unclear the agent comments on the issue and stops; it does not guess a style. The rules it applies are in `docs/ux/ui-update/ui-spec.md` (cited by id, for example D-12).

Title form: `UI update - <page>: <what changes>` (for example `UI update - Matters: one chip anatomy on the Matters list`). Labels: `ui-update-2`, the page label, `frontend`. Parent: the epic of the page (sub-issue). No closing keywords anywhere.

---

## Goal
One sentence a user would recognise: "On the Matters list, the status, sensitive and client chips look and size like every other chip."

## Page / route
`/matters` (list), roles that see it (Director, PM, ...), the tab or dialog if any. Spec rules applied: D-xx, D-yy.

## Scope
Exact files or components, from the spec and a quick search by Agent U (the dev agent may find more in the same component family and then says so in the PR; it does not touch other pages):
- `frontend/src/app/features/<...>/<file>.ts`
- `frontend/src/app/shared/ui/<file>.ts`
If the change is to a shared component, list every page that uses it and which of them have a screenshot in Acceptance.

## Changes (numbered, exact, with the target value)
1. In `<file>` replace `<what exists today>` by `<what to use>`: `<token or value>`.
2. ...
Each line states the property, the value in tokens (never a hex), the unit rule of spec section 0.2, and the state if it is not default. Example: "`.mf-seg > .mf-btn` selected: `background: var(--mf-primary); color: var(--mf-primary-contrast); font-weight: var(--mf-fw-semibold)`; remove the tick icon." Text changes list the exact string before and after ("New client" to "New Client").

## Before
Path of the screenshot in the repo: `docs/ux/ui-update/screenshots/<page>/<name>-1366x768.png` (taken in the crawl). Note what is wrong in it in one line.

## Target
One of: an exact description with numbers; an ASCII sketch; or a small HTML snippet at `docs/ux/ui-update/targets/<issue-slug>.html` that renders with the tokens. Example sketch:
```
[icon tile 32] Matters (140)                     [Filters] [Columns] [+ New Matter]
[Search...] [Filters (2)] ......... Sorted by CM Number, A to Z [Columns] [...]
```

## Acceptance (measurable; the reviewer checks each line)
- [ ] Every value comes from a token; `npm run lint` passes (no colour literal, no icon size literal); no px outside spec section 0.4.
- [ ] Heights measured in the browser: controls 36 px (32 px in a cell), tab 40 px, grid row 44 / 36 px, chip 26 px, dialog and drawer widths per D-32 and D-33 (list the ones that apply with the number).
- [ ] Wording matches D-20 and D-22 (list the exact strings that must appear).
- [ ] States per D-05: hover, focus ring, disabled, selected checked by script or by hand.
- [ ] axe: 0 violations at 1366x768 and 1920x1080 on every changed page and dialog.
- [ ] Screenshots at 1366x768 and 1920x1080 (desktop only; no phone or tablet sizes), before next to after, with the dialog or drawer open when the issue touches one: at most 15 compressed JPEG or optimised PNG (about 150 KB each) on the `design-evidence` branch under `evidence/<yyyy-mm-dd>-<issue>/` (see its README and the rule in CLAUDE.md), linked from the issue comment; never bulk PNGs in the repo.
- [ ] No private chip, link, button or dialog class is added; the shared component is used or extended.
- [ ] No keyboard shortcut added or changed (#420); `shortcut-registry.ts` untouched.
- [ ] Initial bundle under 700 kB (`npm run build` output quoted in the PR).
- [ ] Unit tests updated for the changed strings and sizes; e2e specs that read the old text are updated in the same PR.
- [ ] Anything specific to this issue (a number, a string, a position).

## Out of scope
What the agent must not touch (other pages of the same family that have their own issue, behaviour, API, data, permissions, `docs/ux/tokens.css` unless the change list says so, the theme guide).

## Rules (copy into every issue, do not drop one)
- UI work must follow `docs/ux/design-guidelines.md` (rules, component catalogue, wording tables, checklist).
- Tokens only (`docs/ux/tokens.css`); no colour literal, no px icon size; buttons, dialogs, chips, links, tabs, dropdowns come from the shared components.
- No new or changed keyboard shortcut (#420).
- Screenshots go to the `design-evidence` branch (see its README), at most 15 compressed images per issue (about 150 KB each), never to dev, main or the feature branch; link them from the issue comment.
- Bundle: initial under 700 kB.
- Before pushing, in your own worktree under `/home/user/wt/<name>` created from `origin/ui-update-2`: `tsc` for app, spec and e2e, `npm run lint`, `npm run format:check`, a real `npm run ng -- build`, and the unit tests for the touched files (`npm test`). Heavy jobs only through `/home/user/.mf-heavy/heavy.sh timeout <s> <cmd>`; disk 5 GB free; kill only your own processes, never `pkill`.
- Branch from `ui-update-2` and open the PR into `ui-update-2`. Never push to `dev` or `main`. No `git pull` in `/home/user/MatterFlow`.
- Commit message form (owner request): first line `UI2 #<issue> <short what changed>`, a blank line, then one bullet per main navigation page (and tab or component) that changed, in the app's own menu and tab names, so the owner knows which page to open and what to check: `- <Main nav page> > <Tab or area>: <what changed in plain words>`. For a shared change list the shared component first, then the pages where it is visible, for example `- Shared Button: height 32 -> 36 px; visible on every page` and `- Dashboard > Users: toolbar buttons are taller`. Plain English, no file lists. Keep the `Co-Authored-By` and `Claude-Session` trailer lines of the session after the bullets.
- Issue comments by dev agents start with the same "pages/tabs to check" bullets.
- Plain English in every comment to the owner; no secrets.

## Review (Agent U fills this when the PR is up)
Checklist result per acceptance line, screenshot paths reviewed, and one of: "Accepted", "Changes needed: <numbered list>".

---

## Epic template

Title `Epic: UI update - <page>`. Body: Goal (one sentence), the page and its sub-views and dialogs (from `inventory.md`), the findings that apply (ids from the findings list), the rules applied (D-xx), the list of sub-issues as a checklist (`- [ ] #n title`), screenshots folder `docs/ux/ui-update/screenshots/<page>/`, "Depends on: Epic: UI update - shared components (the issues named there)", Out of scope. Never a closing keyword.

The top epic `Epic: UI update 2 (branch ui-update-2)` holds the checklist of all epics and the order of work: (1) shared components (tokens, controls, chips, links, tabs, dialogs, drawers, toasts, states, formats); (2) shell, system pages; (3) pages that reuse shared grids (Tasks, Matters, Clients, Projects, Assets); (4) Dashboard, My Matters, Task page; (5) Search, Notifications, Profile; (6) Administration. A page issue never starts before the shared issue it depends on is merged into `ui-update-2`.
