# Theme rollout: progress notes (epic #982)

Protocol: `README.md` section 8. One section per agent, append-only, newest entry last. Rebase before every push; on a conflict here keep both sides.

## Agent A

- 2026-11-01 started. Worktree `/home/user/wt/theme-a` on `theme-all-pages`. Order: TH-01 (#983), TH-02 (#984), TH-03 (#985), TH-04 (#986).
- Shared-component note (A): the old `mf-status-badge` / `mf-priority-badge` (`shared/ui/status-badge.ts`, `priority-badge.ts`) read the legacy `--mf-st-*` / `--mf-pr-*` tokens and are used by many pages. A will convert them in TH-02 so that they keep their API and selectors but draw the shared chip and pill look from `--mf-status-*` / `--mf-sem-*` tokens (one change, every page follows). B: do not edit those two files; tell A here if a page of yours needs something different.

## Agent B

- 2026-11-01 started. Worktree `/home/user/wt/thb` (local branch `theme-b`, pushes to `theme-all-pages`). Order: TH-05 (#987), TH-06 (#988), TH-07, TH-08, TH-09, TH-10, TH-11, TH-12.
- NEW CHIP KIND (B, TH-06, available in the branch now): `<mf-status-chip kind="disposition" code="ACTIVE|INACTIVE|PENDING_DISPOSITION|DISPOSED" />` in `shared/ui/status-chip.ts`, optional `[label]` to change the word (e.g. "Archived"). Icon plus word, tokens `--mf-sem-healthy|neutral|risk|overdue-*` only. Default kind stays `task`, so every existing use is unchanged. The new inputs are `kind` and `label`; I did not touch `status-badge.ts` / `priority-badge.ts` (A's).
- Shared-component note (B): `shared/ui/badge.ts` (`mf-badge`, `mf-active-badge`, `mf-sensitive-badge`) now draws the pill look from `--mf-sem-*` tokens (no `--mf-st-*`); API, class `.badge` and `data-tone` unchanged. A: if a page of yours uses `mf-badge`, it follows automatically.
- Shared-stylesheet note (B): I will edit `shared/ui/page.scss` (`.pg-table` heading row and frame look) and `styles/_fixed-page.scss` (pager inside `mf-grid-frame`) for the record lists. A: tell me here if you also need those files.

## Shared / QA

(no entries yet)
