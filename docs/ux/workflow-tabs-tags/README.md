# Workflows tabs and step tags (product-owner request)

Two changes, shown here at 1366x768 and 375x812 (`<screen>-<width>x<height>.png`, taken against a throwaway stack with the starter configuration plus a few extra steps; the run is `frontend/e2e/tests/workflow-tabs-tags-screens.spec.ts`, see the end of this note):

## A. One "Workflows" menu item, two tabs

> **Superseded by [task-types-tabs](../task-types-tabs/README.md):** the Workflows and Workflow Steps tabs are now the second and third tab of the **Task Types** page (menu item "Task Types", header "Task Types", titles "Task Types - Workflows" and "Task Types - Workflow Steps", breadcrumbs `Administration > Task Types > ...`). The addresses and the fixed-header layout described below are unchanged. The text below is kept as it was written.

- The Administration menu is now: Users, Pods, Task Types & Forms, **Workflows**, Labels, Assets, Custom Fields, Audit Logs. The separate "Workflow Steps" item is gone.
- The **Workflows** page has two tabs, built like Users/Roles (`mf-tabs`, route-based, one component that stays alive when the tab changes):
  - Tab 1 **Workflows**: the workflow list (`workflows-tab-*.png`).
  - Tab 2 **Workflow Steps**: the step library list with the new Tags column and tag filter (`workflow-steps-tab-*.png`, `workflow-steps-tab-tag-filter-*.png`).
- Every old address still works and no redirect is needed: `/admin/workflows` is tab 1, `/admin/steps` is tab 2 (the tab follows the address and the address follows the tab, including Left/Right/Home/End on the tab list). `/admin/steps/new`, `/admin/steps/:id`, `/admin/steps/:id/form`, `/admin/workflows/new`, `/admin/workflows/:id` and `/admin/workflows/:id/versions/:v` keep their own pages. The **Workflows** menu item is highlighted on all of them (`alsoActive: ['/admin/steps']`), and the page header shows the same icon (the one of the menu item, through `section-icons`).
- Breadcrumbs: tab 1 `Administration > Workflows`, tab 2 `Administration > Workflows > Workflow Steps`, step create/edit `Administration > Workflows > Workflow Steps > <step>` (the step form page adds `> Form`), workflow pages `Administration > Workflows > <workflow> > vN`.
- Document titles: `Workflows`, `Workflows - Workflow Steps` (steps and workflow pages keep `New step`, `Edit step`, ...).
- Both tabs need `Workflow.Manage` (route guard); the fixed-header grid pattern is unchanged (`mf-fixed-page`, the one scrolling region per tab, pinned header, tabs, toolbar and pager).

## B. Step tags

| What | Where | Screenshot |
|---|---|---|
| Tag input on the step editor: chips with a "Remove tag X" button, type + Enter or comma, Backspace removes the last chip, suggestions from existing tags as you type (combobox + listbox, free text allowed), polite live region announcing adds and removes, inline limit messages (40 characters, 20 tags, no control characters) | `/admin/steps/new`, `/admin/steps/:id` | `step-edit-tag-input-*.png` |
| Tags column (first three chips, then "+n more", long tags cut with an ellipsis) | Workflow Steps tab | `workflow-steps-tab-*.png` |
| Tag filter next to the search box: a "Tags" button with a panel of checkboxes and counts, chosen tags as removable chips, **Match all** (default) / **Match any**; the free-text search also matches tag text; the state is in the address (`tags`, `tagMatch`) | Workflow Steps tab | `workflow-steps-tab-tag-filter-*.png` |
| Tags as chips in the step picker, text search matches tags, the same Tags filter | Workflow designer, version page (draft) | `designer-step-picker-*.png` |

Tag rules (the same in the browser and on the server, `StepTagRules`): trimmed, inner whitespace collapsed to one space, at most 40 characters, at most 20 per step, no control characters, case-insensitive uniqueness per step with the first spelling kept; "relativity" and "Relativity" are one tag across steps (a key plus the display spelling of the first use). Errors use the stable codes `TAG_TOO_LONG`, `TOO_MANY_TAGS`, `TAG_INVALID`.

Tags are library metadata: they are **not** part of a published workflow version (the snapshot copies title, description, instructions, link and form version only), so editing tags never changes a published version, and a tag change is audited as a `FIELD_CHANGED` event on the step (field `Tags`, old and new list) and moves the step's row version.

Backend: script `23-step-tags.sql` (`dbo.StepTag`, `dbo.StepDefinitionTag`), `tags` on the step create/update/read DTOs (omit on update to leave them unchanged), `GET /api/v1/step-definitions?tags=a&tags=b&tagMatch=all|any&q=` (q also matches tag text; tags of a page are loaded with one query), `GET /api/v1/step-definitions/tags?q=&isActive=&limit=` (existing tags with usage counts). Both need `Workflow.Manage`. The starter configuration tags its steps (Intake, Collection, Processing, Relativity, QC, Review, Production, Close-out).

## Accessibility

axe-core 4.10 (all rules, default tags) reports no violation on any of the ten screenshots' pages (both sizes, including the open tag filter panel and the open suggestion list). Controls are labelled: "Tags" combobox, "Remove tag X", "Remove tag filter X", the filter radios "Match all" and "Match any" (legend "Tag matching"), the checkboxes carry the tag text and the count, the search boxes are "Search steps" and "Search workflows".

## Re-running the screenshots

```
E2E_SCREENSHOTS=$PWD/docs/ux/workflow-tabs-tags E2E_AXE=/path/to/axe.min.js \
  frontend/e2e/run-local.sh -g "workflow tabs and tags screenshots"
```

Without `E2E_SCREENSHOTS` the spec is skipped; with `E2E_AXE` every screen is also checked with axe and the run fails on a violation.
