# Workflow screens: before and after

Screenshots at 1280, 1024, 768 and 375 px in `before/` and `after/` (`<nn>-<state>-<width>.png`): workflow list (01), new workflow (02), existing workflow with version history (03), draft designer with several steps (04), step picker no results (05), step input preview open (06), publish dialog (07), published read-only version (08), step picker loading (09) and error (10). No page-level horizontal scroll at any width (checked in the capture script).

## What changed and why

**Spacing bug (the request).** "Search steps" was a bare `label` and `input` with no layout, so they touched. The picker now uses the shared `mf-search-box` (label, 4 px gap, 40 px field with clear button, hint below), the same as every list. The field no longer has a fixed 240 px minimum that overflowed the narrow library column (`min-width: min(240px, 100%)`). Search is now debounced (300 ms) like the rest of the app instead of calling the API on every key.

**Page rhythm.** Cards and alerts sit in one `wf-stack` with a single `--mf-s4` gap (before: stacked margins gave 32 px in places and 0 in others). Execution mode lost its default browser fieldset border, and its legend is now a normal card heading (18 px token). Cards share one head pattern: heading, one-line help, content.

**Designer.**
- Library panel is a scrollable list (max 32 rem) with a result count ("46 steps", or "Showing the first 50 of 64"), clear Add buttons (plus icon; "Added" with a check when already used), no-results text that says what to do, loading text only on first load, an inline error with Retry. Before, 50 steps pushed the steps list far below the fold, especially at 375 px.
- Steps list: numbered circle (ordered mode only), title, badges (Required, Skippable, Comment on skip, Deactivated), skip checkboxes (draft only), icon Up/Down buttons, Preview inputs, danger-outline Remove. Read-only versions show the same badges and no edit controls, and a badge instead of disabled radios for the mode. On narrow screens the tools wrap under the step text.
- Library heading stays "Workflow Steps" (the name used in the menu); the right card is now "Steps in this version (n)" instead of a second, near-identical "Workflow steps".
- Header: "Unsaved changes" badge next to the published-version note.

**Edit page.** Header shows Active/Published/Draft badges and an "Open draft vN" action; version history is a card with an explanation, a "Current" badge and the table inside it.

**Publish dialog.** The diff is a list of badges (Added, Removed, Moved, Skip rule changed, Mode) with the step title, and Impact is its own panel.

**Accessibility.** Focus moves to the next addable library step after Add (the clicked button becomes disabled); Remove already returned focus. Reorder help is tied to the list with `aria-describedby`; the live region still announces add/move/remove. The scrollable library list is keyboard focusable. Result count is a status region.

## Unchanged
Permissions (Workflow.Manage), URLs, rowVersion concurrency, immutability of published versions, snapshot-on-publish, the Alt+Arrow keyboard reorder, and all API calls.
