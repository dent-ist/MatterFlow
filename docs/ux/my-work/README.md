# My Work screen review (toolbar, compact rows, urgency cues)

Screenshots of the real app (Chromium against the published API with a seeded SQL Server) at 1280, 1024, 768 and 375 px wide.

| Screen | Files |
|---|---|
| My Work with seven tasks across due states (overdue 2d, due today, tomorrow, later dates, ASAP) and two "New" tasks | `my-work-several-tasks-<width>.png` |
| My Work near-empty (two tasks): the "That's everything on your plate." line | `my-work-near-empty-<width>.png` |
| My Work empty (existing empty state) | `my-work-empty-<width>.png` |
| Pod Work, All tab | `pod-work-<width>.png` |
| Task Queue (filtered to one matter) | `task-queue-<width>.png` |
| Search hint on focus; "Sorted by Priority" info popover | `my-work-search-hint-1280.png`, `my-work-hint-and-sort-info-1280.png` |

What changed (see the PO-approved list): tabs left and search right on one row (search wraps full width below the tabs on narrow screens);
Filters, the sort note and Columns on one row; the search hint only shows while the box has focus; compact Workflow progress (bar, "1 of 3", current
step on a second line with the full text as a tooltip); Title cell with a muted "Client · Matter" line; ASAP as a plain label with a bolt icon;
"Overdue 2d" / "Due today" with colour, icon and words, "Tomorrow" in words; a "New" badge for tasks created since the last visit (My Work only);
zero tab counts muted, bold counts only for Active and Due soon above zero; "Sorted by Priority" with the full default rule behind an info button.
Task type icons are not shown yet: the shared icon component is not on `dev` at the time of this change.
