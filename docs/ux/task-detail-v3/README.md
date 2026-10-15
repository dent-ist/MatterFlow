# Task detail v3: collapsible Comments and Assets

Product-owner request (approved suggestions): the Comments and Assets sections under the Workflow become collapsible, Facebook-comment style, with the count in the bar ("Comments (3)", "Assets (2)"). Everything else of [task-detail-v2](../task-detail-v2/README.md) is unchanged (60 / 40 split with the splitter, "Show latest", sort, search, scroll regions, Activity drawer, Jump to, permissions).

## Behaviour

| Part | Behaviour |
|---|---|
| Bar | One full-width toggle **button** inside the section's `h2` (chevron, title with count, text badge, one-line preview while collapsed), `aria-expanded`, `aria-controls` (the panel stays in the page, `hidden` while collapsed), the preview is the button's `aria-describedby`. A click anywhere on the bar, Enter or Space toggles. Visible focus ring, no animation. Quick actions sit at the right end of the bar beside the button (not inside it), icon + text; on a narrow column (the bar is narrower than 22 rem: a half-width bar, phones) icon only, the name stays in `aria-label` / `title`. |
| Layout | Side by side only when both sections are in the same state (both open, or the two slim bars both collapsed); when only one is open it spans the whole left column and the other bar stacks under it. Below 36 rem of column width, and below 1100 px, they stack as before. |
| Remembered | Per user and section in `localStorage` (`mf.task-detail.comments.open.<userId>`, `mf.task-detail.assets.open.<userId>`), read before the first render. Defaults: Assets collapsed, Comments collapsed unless there are new comments. Only a person's own toggle (or a quick action) is stored; deep links, Jump to and "new" open a section without changing what is remembered. Storage errors (blocked, private window) are ignored. |
| Auto-expand | `?tab=comments`, `?tab=assets`, the "Jump to" row (focus moves to the section heading as before), a posted comment, a linked asset, and new comments by other people. `?step=` is unaffected. |
| Preview | Comments: `Latest: <author>, <5m ago / 3h ago / 2d ago / date>: <plain-text snippet>` (HTML stripped with `htmlToText`), or "No comments yet". Assets: the first two names and "+N more" ("Workspace Name, Review set +1 more") or "No linked assets". One line, ellipsis, the full text in the `title`. |
| "New" cue | Per user and task the time the Comments were last seen is stored (`mf.task-detail.comments.seen.<userId>.<taskId>`, the 200 most recent tasks are kept). If comments by other people are newer, the bar says "Comments (4) 2 new" (a text badge, announced once through an `aria-live="polite"` region) and the section opens on page load. The first visit to a task has no cue and follows the collapsed default (the visit is recorded). The time is updated while the section is open; collapsing it again clears the cue. The comments list is requested on page load either way (count from the API `total`); the thread body and the composer render only when open. |
| Quick actions | "Add comment" (when the person may comment): opens the section and puts the cursor in the composer. "Link asset" (when the person may link): opens the section, shows the link form and focuses the asset picker. View-only people get neither. |
| Composer | One line "Write a comment..." until it gets focus or a click; then the rich-text editor (toolbar, internal / privilege notes, Post comment). It stays an editor while it has focus or content, and goes back to one line after a post, or when emptied and blurred. Ctrl+Enter still posts. |

## Code

`shared/ui/disclosure-bar.ts` (the bar), `features/tasks/panels/section-state.ts` (storage, seen LRU, new count, previews), `task-comments.ts` / `task-asset-links.ts` (an `open` model, both always load), `task-detail-page.ts` (initial state, the stack / side-by-side rule). The old `InView` lazy load is gone: the list now loads with the page so the bar can show the count and the preview.

## Screenshots

Real stack (SQL Server in Docker, API with Dev auth, Chromium), the same busy task as v2 (12 comments, 8 assets, then one more comment by another user). `1366-*` is 1366x768, `375-*` is 375x812.

| File | Shows |
|---|---|
| `*-1-collapsed.png` | Both bars collapsed under the Workflow, counts and previews |
| `*-2-comments-open.png` | Only Comments open: it takes the whole row, the Assets bar stacks under it |
| `*-3-both-open.png` | Both open, side by side (1366) |
| `*-4-new-cue.png` | Another user commented: "1 new" badge, Comments opened by itself |
| `*-7-composer-one-line.png` | The composer as one line |
| `*-5-composer-editor.png`, `*-6-composer-with-text.png` | The composer as the editor, empty and with text |
