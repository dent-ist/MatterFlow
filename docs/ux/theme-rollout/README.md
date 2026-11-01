# Theme rollout plan (epic #982, branch `theme-all-pages`)

Owner decision, 2026-11-01: the new My Matters, the new navigation and the shared theme are approved and merged to `dev` and `main`. The theme is now **applied to all other pages**. Rules and checklist per page: `docs/ux/theme-guide.md` section 7. Tokens: `docs/ux/tokens.css`. Shared components: `frontend/src/app/shared/ui/` (`docs/ux/ui-update/shared-blocks.md`).

## 1. Goal

Every page uses tokens only and the shared components, with the My Matters look (dark navy navigation, coloured chips, shared dropdown, fixed-page grids). At the end there is no `--mf-st-*` token and the colour ledger (`frontend/scripts/theme-colours-baseline.json`, 37 files at the start) is empty, so lint fails on any colour literal.

## 2. Branch rules

- Work branch `theme-all-pages`, created from `origin/dev` (6ac65a4, equal to `main`).
- Each agent uses its **own git worktree** on this branch. Push with `git push origin HEAD:theme-all-pages`. Rebase often: `git fetch origin && git rebase origin/theme-all-pages` before every push.
- Never push to `dev` or `main` during the rollout. No PR per issue. TH-16 opens one PR to `dev` at the end. `main` only with the owner's approval.
- Commit message style: `WPx <what>` (see recent history), a paragraph starting `In plain words:`, then the trailers given in the session.

## 3. Issues, owners, hours

| Issue | Id    | Title                                                                                                 | Agent                | Hours             |
| ----- | ----- | ----------------------------------------------------------------------------------------------------- | -------------------- | ----------------- |
| #983  | TH-01 | Dashboard conversion (current structure)                                                              | A                    | 8.0               |
| #984  | TH-02 | Task Queue, My Work, Pod Work on one shared work grid                                                 | A                    | 10.0              |
| #985  | TH-03 | Task page `/tasks/:id`                                                                                | A                    | 6.0               |
| #986  | TH-04 | Create task, notifications, search, profile                                                           | A                    | 5.0               |
|       |       | **Agent A subtotal**                                                                                  |                      | **29.0**          |
| #987  | TH-05 | Matters list and record                                                                               | B                    | 5.0               |
| #988  | TH-06 | Assets list and record, disposition chip kind                                                         | B                    | 5.0               |
| #989  | TH-07 | Clients list and record                                                                               | B                    | 4.0               |
| #990  | TH-08 | Projects                                                                                              | B                    | 3.0               |
| #991  | TH-09 | Administration: Users, Roles, Pods                                                                    | B                    | 4.0               |
| #992  | TH-10 | Administration: Task types, Workflows, Steps, Labels, Asset types, Custom fields, form-engine library | B                    | 8.0               |
| #993  | TH-11 | Administration: Reports, Audit logs, Settings                                                         | B                    | 3.0               |
| #994  | TH-12 | Access pending and error pages                                                                        | B                    | 1.0               |
|       |       | **Agent B subtotal**                                                                                  |                      | **33.0**          |
| #995  | TH-13 | Retire legacy tokens, colour ledger to zero                                                           | either (last)        | 4.0               |
| #996  | TH-14 | Visual consistency sweep, four sizes                                                                  | either (after TH-13) | 6.0               |
| #998  | TH-16 | Final QA and merge to `dev`                                                                           | QA agent             | 14.0              |
|       |       | **Total (without TH-15)**                                                                             |                      | **86.0**          |
| #997  | TH-15 | Dashboard redesign per mockup v2 (BLOCKED, waits for owner)                                           | A                    | 10.0, not counted |

With TH-15 the total would be 96.0 h.

## 4. Order

- A and B work in parallel, each in the order of its list. TH-02 (shared work grid) comes before TH-03 and TH-04. TH-09 (admin list shell) comes before TH-10 and TH-11. TH-06 adds the disposition chip kind to `mf-status-chip`; B writes a note in `progress.md` so A can use it.
- TH-13 starts when TH-01 to TH-12 are merged into the branch. TH-14 follows TH-13. TH-16 is last.
- Hand-back of one issue = its checks pass, its screenshots are committed, a note is in `progress.md`.

## 5. Decisions already made (project manager)

1. Dashboard: the CURRENT structure is converted in this rollout (tiles, chart palette, chips, fixed layout). The redesign of `docs/ux/mockups/dashboard-mockup-v2.html` (A compact or Recommended) is TH-15 and waits for the owner's answers to the six questions in `docs/ux/mockups/README.md`.
2. The Notes feature is a separate epic.
3. Task Types / Asset Types / Labels pickers keep working (they already use the solid chip).
4. `--mf-st-*` tokens and the 37-file ledger reach zero (TH-13).
5. Task Queue label ("Tasks" vs "Task Queue") follows #978 if the owner has decided; otherwise unchanged.
6. #976, #977, #980 are out of scope unless a page conversion touches them.

Open question for the owner: should the numeric date format (`MM/DD hh:mm AM/PM`, theme guide section 8) also apply to converted pages? Default: no, `mfDate` stays.

## 6. Rules for every page

- Tokens only; no colour literal (a data colour such as a user-picked task type colour carries `theme-colour-ok: <reason>`).
- Shared components from `shared/ui`; no hand-made badge.
- Lists and grids: `mf-fixed-page` + `mf-grid-frame`; header, filters and pager stay put.
- No thick coloured left borders. Colour is never the only signal.
- No new or changed keyboard shortcut (#420).
- Initial bundle under 700 kB (about 653 kB now).
- axe clean at 1366x768, 1920x1080, 768x1024 and 375x812; focus ring visible; 44 px targets on phone.
- Sensitive-matter rule untouched on every list, count and link.
- OpenAPI document and the nswag client are regenerated from code (`npm run api:generate`), never hand-merged.
- Module boundaries, schema scripts and permissions: unchanged by this work.

## 7. Testing rule

Per issue (cheap only): `npm run lint` (includes the theme colour and contrast checks), `npm run format:check`, tsc for app, spec and e2e, unit tests of the touched folders, the bundle gate (`npm run build`), edit stale e2e specs, a quick smoke e2e of the touched pages on a fresh DB at each hand-back, before/after screenshots at four sizes.

Once, at the end (TH-16): full backend integration, full Playwright on a fresh DB, sensitive-matter e2e, axe on every page, visual sweep, OpenAPI/client drift check, report `docs/ux/theme-rollout/qa-report.md`, merge to `dev`.

## 8. Progress-note protocol

- One file: `docs/ux/theme-rollout/progress.md`, with a section per agent (`## Agent A`, `## Agent B`, `## Shared / QA`). Each agent edits only its own section, append-only, newest entry last: date, issue id, status (started / handed back), files converted, ledger count before and after, checks run, open points, questions for the other agent.
- Rebase before every push; resolve conflicts in `progress.md` by keeping both sides.
- Never overwrite each other's files. If you need a change in a file the other agent owns, add a note to your section and ask.
- Shared files are edited by TH-13 only: `docs/ux/theme-guide.md`, `docs/ux/tokens.css` (removals), `frontend/scripts/theme-colours-baseline.json` as a whole. Before TH-13, put changes for them as small append-only notes in `progress.md`. Adding a new token needed by your page is allowed as a small separate commit, announced in `progress.md`.
- Regenerate the ledger with `node scripts/check-theme-colours.mjs --update` **only for the files you converted**: run it, then `git diff` the baseline and keep only the lines of your files (revert the rest) so you do not rewrite the other agent's counts.
- Screenshots: `docs/ux/theme-rollout/before/<page>-<WxH>.png` and `.../after/<page>-<WxH>.png`; TH-14 adds the full sweep to `after/`.
- Disk and memory are tight on build machines: remove test output and unused worktrees after each hand-back; run Playwright with one worker.

## 9. Risks

- The shared work grid serves three pages and Dashboard drill-downs: convert and test them together.
- The form-engine library (47 literals) feeds task type designers and task forms: keep its public API and the form-rule vectors in `contracts/`.
- Chart colours must stay distinguishable (colour-blind safe) when moved to tokens.
- Many e2e specs assert old styles, sizes or class names.
- Disk space and memory; the full test run is long and was split in three pieces last time.
- Two agents touching shared SCSS (`styles.scss`, `styles/_*.scss`, `app-shell.scss`): announce edits in `progress.md`.

## 10. Out of scope

Notes epic; Dashboard redesign (TH-15); Impersonation (#828); Reports (#671); date-format change on other pages.

## 11. First steps

- **Agent A:** create your worktree on `theme-all-pages`; read theme guide section 7, `shared-blocks.md`, `check-theme-colours.mjs`; start TH-01 (#983): screenshots before, then tiles and chart palette; next TH-02.
- **Agent B:** same setup; start TH-05 (#987) Matters, then TH-06 (announce the disposition chip), TH-07, TH-08, then TH-09 before TH-10 and TH-11.
- **QA agent:** wait until TH-14 is handed back; prepare disk space and a fresh database; follow TH-16 (#998).
