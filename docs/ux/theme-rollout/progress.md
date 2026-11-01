# Theme rollout: progress notes (epic #982)

Protocol: `README.md` section 8. One section per agent, append-only, newest entry last. Rebase before every push; on a conflict here keep both sides.

## Agent A

- 2026-11-01 started. Worktree `/home/user/wt/theme-a` on `theme-all-pages`. Order: TH-01 (#983), TH-02 (#984), TH-03 (#985), TH-04 (#986).
- Shared-component note (A): the old `mf-status-badge` / `mf-priority-badge` (`shared/ui/status-badge.ts`, `priority-badge.ts`) read the legacy `--mf-st-*` / `--mf-pr-*` tokens and are used by many pages. A will convert them in TH-02 so that they keep their API and selectors but draw the shared chip and pill look from `--mf-status-*` / `--mf-sem-*` tokens (one change, every page follows). B: do not edit those two files; tell A here if a page of yours needs something different.

## Agent B

(no entries yet)

## Shared / QA

(no entries yet)
