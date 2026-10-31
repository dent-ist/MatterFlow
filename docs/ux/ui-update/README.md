# UI update (branch `ui-update`)

Epic: #953. Design guideline: `docs/ux/mockups/my-matters-v3-b-tree-r2.html` (see `docs/ux/mockups/README.md`, section "My Matters v3 B, revision 2").

## Goal

Update the Navigation panel and the My Matters page to the new mockup, and build one shared theme layer (design tokens in code) so changing one value applies across the app. Backend APIs are built to support the new features. No dark theme and no theme editor in this round. Other pages are not restyled; a guide for converting them is delivered (UI-07).

## Branch rules

- All work goes to `ui-update` (from dev at 0a88090). Dev is frozen, main is untouched. No pull requests until the owner says "merge to dev".
- Each agent works in its own git worktree on `origin/ui-update` and pushes with `git push origin HEAD:ui-update`.
- Never overwrite the other agent's files. Rebase often (`git pull --rebase origin ui-update`).
- After every rebase, regenerate the OpenAPI document and the nswag client from code. Never merge them by hand.
- SQL script numbers are allocated by Agent 1 only (next free number after 48). Scripts stay immutable once pushed.
- Owner rules still apply: no new keyboard shortcuts (#420), bundle under 700 kB, sensitive-matter visibility, `Dev` auth guard untouched, no thick coloured left borders, accessibility (axe, 4.5:1, keyboard).

## Owner decisions of 2026-10-31

- Events: created/edited by Primary and Secondary PM and by holders of `Matter.Edit` (no `Matter.*Manage` exists; owner to confirm); visible to anyone who can see the matter; sensitive-matter rules apply.
- Comments exist only on tasks. The Assets tab has no comment column; the asset side panel shows linked tasks with the latest task comment.
- A project needs a matter.
- Theme option A: one token set, read by every component. No dark theme, no editor.
- Impersonation #828 and Reports #671 wait until ui-update is merged.
- Clicking an activity item opens the task in a new browser tab/window.
- Pod Work before Tasks (supersedes #952). Reminders are out of scope.

## Two-agent split and order

| Issue | Title | Owner | Hours |
| --- | --- | --- | --- |
| #954 UI-01 | Design tokens (push early) | Agent 1 | 6.0 |
| #955 UI-02 | API contract document (push FIRST) | Agent 1 | 1.5 |
| #956 UI-03 | My Matters scope APIs | Agent 1 | 8.0 |
| #957 UI-04 | Task status and step progress in the task list API | Agent 1 | 4.0 |
| #958 UI-05 | Matter events backend | Agent 1 | 8.0 |
| #959 UI-06 | Navigation panel update | Agent 1 | 3.0 |
| #960 UI-07 | Theme adoption guide and conversion plan | Agent 1 | 2.5 |
| | Agent 1 subtotal | | 33.0 |
| #961 UI-10 | Shared UI building blocks | Agent 2 | 8.0 |
| #962 UI-11 | Page shell | Agent 2 | 5.0 |
| #963 UI-12 | Tree panel | Agent 2 | 5.0 |
| #964 UI-13 | Overview | Agent 2 | 8.0 |
| #965 UI-14 | "+ New" menu and dialogs | Agent 2 | 4.0 |
| #966 UI-15 | Calendar tab | Agent 2 | 7.0 |
| #967 UI-16 | Assets tab | Agent 2 | 5.0 |
| #968 UI-17 | Metrics and Activity tabs | Agent 2 | 4.0 |
| #969 UI-18 | Retire old code, tidy, addendum AP, hand-back checks | Agent 2 | 4.0 |
| | Agent 2 subtotal | | 50.0 |
| | **Total** | | **83.0** |

Order: Agent 1 does UI-02 and UI-01 first and pushes both. Agent 2 starts with UI-10 once those are pushed, then follows its list in order, coding against `api-contract.md` and picking up real endpoints as Agent 1 pushes UI-03, UI-04 and UI-05. UI-06 consumes the tokens; UI-07 follows UI-10 so it can list the shared components.

## How the agents coordinate

1. API contract first: `docs/ux/ui-update/api-contract.md` is the agreement. Agent 1 pushes it before anything else and logs every later change in it with a date.
2. Progress notes: each agent appends to `docs/ux/ui-update/progress.md` (date, issue, what is pushed, what the other agent can now use, open questions). Each agent edits only its own section of that file.
3. Rebase often; push small commits.
4. Regenerate OpenAPI and the client after every rebase; never hand-merge generated files.
5. SQL script numbers: Agent 1 only.

## Testing rule

Cheap checks only until the end: `dotnet build -warnaserror`, `dotnet format --verify-no-changes`, unit/architecture/schema tests, targeted integration tests of touched backend, frontend lint, prettier, tsc and unit tests of touched folders, the bundle gate, and a quick smoke e2e of the touched page on a fresh DB at each agent hand-back.

ONE full run later on `ui-update`, before the owner decides to merge: full integration, full Playwright on a fresh DB, sensitive-matter e2e, performance and axe.

## Out of scope

Dark theme, admin theme editor, restyling other pages (guide only), reminders, drawer for activity items, #828, #671.
