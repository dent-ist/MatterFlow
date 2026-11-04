# Theme guide

Epic #953, issue UI-01 (#954). Owner decision "option A": **one set of design tokens in code**, read by every component, so that a theme editor and a dark theme can be added later without touching components. There is **no dark theme and no editor in this round.**

## 1. Where the tokens live

| What                                | Where                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| The tokens (single source of truth) | `docs/ux/tokens.css`, loaded first by `frontend/angular.json` (`styles`)         |
| Global rules that read them         | `frontend/src/styles.scss`, `frontend/src/styles/*.scss`                         |
| PrimeNG                             | `frontend/src/app/core/theme/mf-preset.ts` reads the tokens with `var(--mf-...)` |
| Check: no hard-coded colours        | `frontend/scripts/check-theme-colours.mjs` (part of `npm run lint`)              |
| Check: contrast of every pairing    | `frontend/scripts/check-theme-contrast.mjs` (part of `npm run lint`)             |

## 2. The three layers

1. **Palette** `--mf-p-<hue>-{fg,bg,solid,line}`: seven hues (red, amber, blue, teal, violet, orange, slate). Only this layer and the neutral/feedback tokens at the top of the file hold hex values.
2. **Semantic** `--mf-sem-<meaning>-{fg,bg,solid,line}`: what a colour _means_.

   | Meaning        | Token name | Hue         | Used for                               |
   | -------------- | ---------- | ----------- | -------------------------------------- |
   | Overdue        | `overdue`  | red         | overdue tasks, errors that need action |
   | At risk        | `risk`     | amber       | at-risk tasks, due soon                |
   | Information    | `info`     | blue        | in progress, links, hints              |
   | Healthy        | `healthy`  | teal        | completed, nothing to do               |
   | Needs a person | `person`   | violet      | unassigned                             |
   | Critical       | `critical` | deep orange | Critical priority                      |
   | Neutral        | `neutral`  | slate       | on hold, sensitive, quiet facts        |

3. **Component** tokens: `--mf-status-<new|progress|hold|done|cancel>-{fg,bg,line}` (task status), `--mf-event-<court|trial|deposition|production|filing|mediation|meeting|other>-{fg,bg}` (event types), `--mf-nav-*` (navigation), `--mf-toast-*` (PrimeNG toasts). They point at layer 2 or 1 with `var()`.

Other tokens: radius (`--mf-radius`, `-md`, `-lg`, `-xl`, `-pill`), spacing (`--mf-s1`..`--mf-s7`, 4 px base), type (`--mf-fs-xs`..`--mf-fs-h1`, `--mf-fs-title` 19 px, body `--mf-fs-md` 14 px), density (`--mf-ctl-h` 36, `--mf-ctl-h-sm` 30, `--mf-chip-h` 26, `--mf-gutter` 16, grid row heights), shadows (`--mf-shadow-1`, `-2`, `-card`, `-pop`), focus ring (`--mf-focus`, `--mf-nav-focus`, `--mf-focus-width`, `--mf-focus-offset`).

The older `old-st-*` status tokens (the pre-theme status colours, In Progress teal) were deleted in TH-13 (#995): every page reads `--mf-status-*` (In Progress blue, Completed teal, as in the My Matters mockup). Tokens added in TH-13: `--mf-black` (print text), `--mf-danger-strong` and `--mf-danger-deep` (hover and pressed state of the solid danger button).

## 3. Change one token, the app follows (example)

To make every overdue indicator (chips, counts, the Overdue feed items, the tree dots) a slightly different red, change **one line** in `docs/ux/tokens.css`:

```css
--mf-p-red-fg: #b42318; /* was the value above; try #A01D14 */
```

`--mf-sem-overdue-fg`, which every overdue component reads, follows it, and so does the PrimeNG danger button (`--mf-danger` is separate: change it too if the buttons should follow). Run `npm run lint`: the contrast check fails if the new red is below 4.5:1 on its tint or on a card. A theme editor later only has to write these same custom properties on `:root` (or a `[data-theme]` block, see the dark navy values at the end of the file).

## 4. Rules for code

- No colour literal (`#hex`, `rgb()`, `hsl()`) in a component, template or stylesheet. Use `var(--mf-...)`. The lint script fails for any file with a literal. The ledger `frontend/scripts/theme-colours-baseline.json` is empty (`{}`) since TH-13 (#995) and stays empty: there is no allowance any more. The only files that hold hex values are `docs/ux/tokens.css` and lines marked `theme-colour-ok`.
- Colour is never the only signal: add an icon or a word (WCAG 1.4.1).
- Text needs 4.5:1, icons and bars 3:1; use the `-fg` on `-bg`/white and the `-solid` for graphics only.
- Focus: `:focus-visible` shows the 2 px ring in `--mf-focus` (`--mf-nav-focus` on the navy panel). Never remove it.
- No thick coloured left borders on cards, rows or alerts. The selected navigation item is a white pill.
- No keyboard shortcut is added by a theme change (#420).
- A line with `theme-colour-ok: <reason>` is skipped by the check; use it only for data colours that cannot be tokens (for example a user-picked task type colour) and say why.

## 5. Contrast of every pairing (generated by `check-theme-contrast.mjs --table`)

| Pairing                                                | Foreground                         | Background                         | Ratio  | Needs |
| ------------------------------------------------------ | ---------------------------------- | ---------------------------------- | ------ | ----- |
| overdue text on its tint                               | `--mf-sem-overdue-fg` #b42318      | `--mf-sem-overdue-bg` #fdecea      | 5.7:1  | 4.5:1 |
| overdue text on a card                                 | `--mf-sem-overdue-fg` #b42318      | `--mf-surface` #ffffff             | 6.6:1  | 4.5:1 |
| overdue solid (dot, bar, icon) on a card               | `--mf-sem-overdue-solid` #c62828   | `--mf-surface` #ffffff             | 5.6:1  | 3:1   |
| risk text on its tint                                  | `--mf-sem-risk-fg` #8a4b00         | `--mf-sem-risk-bg` #fff4db         | 6.2:1  | 4.5:1 |
| risk text on a card                                    | `--mf-sem-risk-fg` #8a4b00         | `--mf-surface` #ffffff             | 6.8:1  | 4.5:1 |
| risk solid (dot, bar, icon) on a card                  | `--mf-sem-risk-solid` #b45309      | `--mf-surface` #ffffff             | 5.0:1  | 3:1   |
| info text on its tint                                  | `--mf-sem-info-fg` #1f4e9c         | `--mf-sem-info-bg` #e3ecfa         | 6.7:1  | 4.5:1 |
| info text on a card                                    | `--mf-sem-info-fg` #1f4e9c         | `--mf-surface` #ffffff             | 8.0:1  | 4.5:1 |
| info solid (dot, bar, icon) on a card                  | `--mf-sem-info-solid` #1f4e9c      | `--mf-surface` #ffffff             | 8.0:1  | 3:1   |
| healthy text on its tint                               | `--mf-sem-healthy-fg` #0b6b5f      | `--mf-sem-healthy-bg` #ddf3ef      | 5.5:1  | 4.5:1 |
| healthy text on a card                                 | `--mf-sem-healthy-fg` #0b6b5f      | `--mf-surface` #ffffff             | 6.4:1  | 4.5:1 |
| healthy solid (dot, bar, icon) on a card               | `--mf-sem-healthy-solid` #0f766e   | `--mf-surface` #ffffff             | 5.5:1  | 3:1   |
| person text on its tint                                | `--mf-sem-person-fg` #5b3fa6       | `--mf-sem-person-bg` #efeafb       | 6.6:1  | 4.5:1 |
| person text on a card                                  | `--mf-sem-person-fg` #5b3fa6       | `--mf-surface` #ffffff             | 7.8:1  | 4.5:1 |
| person solid (dot, bar, icon) on a card                | `--mf-sem-person-solid` #6d4bc2    | `--mf-surface` #ffffff             | 6.1:1  | 3:1   |
| critical text on its tint                              | `--mf-sem-critical-fg` #9a3a06     | `--mf-sem-critical-bg` #fdebdc     | 6.1:1  | 4.5:1 |
| critical text on a card                                | `--mf-sem-critical-fg` #9a3a06     | `--mf-surface` #ffffff             | 7.0:1  | 4.5:1 |
| critical solid (dot, bar, icon) on a card              | `--mf-sem-critical-solid` #c2410c  | `--mf-surface` #ffffff             | 5.2:1  | 3:1   |
| neutral text on its tint                               | `--mf-sem-neutral-fg` #475569      | `--mf-sem-neutral-bg` #eef1f5      | 6.7:1  | 4.5:1 |
| neutral text on a card                                 | `--mf-sem-neutral-fg` #475569      | `--mf-surface` #ffffff             | 7.6:1  | 4.5:1 |
| neutral solid (dot, bar, icon) on a card               | `--mf-sem-neutral-solid` #475569   | `--mf-surface` #ffffff             | 7.6:1  | 3:1   |
| status new text on its chip                            | `--mf-status-new-fg` #2b4a78       | `--mf-status-new-bg` #ffffff       | 8.9:1  | 4.5:1 |
| status new text on a card                              | `--mf-status-new-fg` #2b4a78       | `--mf-surface` #ffffff             | 8.9:1  | 4.5:1 |
| status progress text on its chip                       | `--mf-status-progress-fg` #1f4e9c  | `--mf-status-progress-bg` #e3ecfa  | 6.7:1  | 4.5:1 |
| status progress text on a card                         | `--mf-status-progress-fg` #1f4e9c  | `--mf-surface` #ffffff             | 8.0:1  | 4.5:1 |
| status hold text on its chip                           | `--mf-status-hold-fg` #475569      | `--mf-status-hold-bg` #eef1f5      | 6.7:1  | 4.5:1 |
| status hold text on a card                             | `--mf-status-hold-fg` #475569      | `--mf-surface` #ffffff             | 7.6:1  | 4.5:1 |
| status done text on its chip                           | `--mf-status-done-fg` #0b6b5f      | `--mf-status-done-bg` #ddf3ef      | 5.5:1  | 4.5:1 |
| status done text on a card                             | `--mf-status-done-fg` #0b6b5f      | `--mf-surface` #ffffff             | 6.4:1  | 4.5:1 |
| status cancel text on its chip                         | `--mf-status-cancel-fg` #374151    | `--mf-status-cancel-bg` #e5e7eb    | 8.3:1  | 4.5:1 |
| status cancel text on a card                           | `--mf-status-cancel-fg` #374151    | `--mf-surface` #ffffff             | 10.3:1 | 4.5:1 |
| disposition Active text on its chip                    | `--mf-sem-healthy-fg` #0b6b5f      | `--mf-sem-healthy-bg` #ddf3ef      | 5.5:1  | 4.5:1 |
| disposition Active icon on its chip                    | `--mf-sem-healthy-solid` #0f766e   | `--mf-sem-healthy-bg` #ddf3ef      | 4.7:1  | 3:1   |
| disposition Inactive text on its chip                  | `--mf-sem-neutral-fg` #475569      | `--mf-sem-neutral-bg` #eef1f5      | 6.7:1  | 4.5:1 |
| disposition Inactive icon on its chip                  | `--mf-sem-neutral-solid` #475569   | `--mf-sem-neutral-bg` #eef1f5      | 6.7:1  | 3:1   |
| disposition Pending disposition text on its chip       | `--mf-sem-risk-fg` #8a4b00         | `--mf-sem-risk-bg` #fff4db         | 6.2:1  | 4.5:1 |
| disposition Pending disposition icon on its chip       | `--mf-sem-risk-solid` #b45309      | `--mf-sem-risk-bg` #fff4db         | 4.6:1  | 3:1   |
| disposition Disposed text on its chip                  | `--mf-sem-overdue-fg` #b42318      | `--mf-sem-overdue-bg` #fdecea      | 5.7:1  | 4.5:1 |
| disposition Disposed icon on its chip                  | `--mf-sem-overdue-solid` #c62828   | `--mf-sem-overdue-bg` #fdecea      | 4.9:1  | 3:1   |
| event court icon and text on its tint                  | `--mf-event-court-fg` #1e3a8a      | `--mf-event-court-bg` #e4e9f7      | 8.5:1  | 4.5:1 |
| event trial icon and text on its tint                  | `--mf-event-trial-fg` #86198f      | `--mf-event-trial-bg` #f6e4f8      | 6.8:1  | 4.5:1 |
| event deposition icon and text on its tint             | `--mf-event-deposition-fg` #0b627d | `--mf-event-deposition-bg` #d9eff5 | 5.8:1  | 4.5:1 |
| event production icon and text on its tint             | `--mf-event-production-fg` #4d6310 | `--mf-event-production-bg` #e9f1ce | 5.8:1  | 4.5:1 |
| event filing icon and text on its tint                 | `--mf-event-filing-fg` #a3194f     | `--mf-event-filing-bg` #fbe3ec     | 6.2:1  | 4.5:1 |
| event mediation icon and text on its tint              | `--mf-event-mediation-fg` #17683a  | `--mf-event-mediation-bg` #daf1e2  | 5.7:1  | 4.5:1 |
| event meeting icon and text on its tint                | `--mf-event-meeting-fg` #6b4600    | `--mf-event-meeting-bg` #f3e8cf    | 6.9:1  | 4.5:1 |
| event other icon and text on its tint                  | `--mf-event-other-fg` #475569      | `--mf-event-other-bg` #e8ecf1      | 6.4:1  | 4.5:1 |
| task type slate glyph (white) on its chip              | `--mf-white` #ffffff               | `--mf-tt-slate` #475569            | 7.6:1  | 3:1   |
| task type blue glyph (white) on its chip               | `--mf-white` #ffffff               | `--mf-tt-blue` #1f4e9c             | 8.0:1  | 3:1   |
| task type teal glyph (white) on its chip               | `--mf-white` #ffffff               | `--mf-tt-teal` #0f766e             | 5.5:1  | 3:1   |
| task type green glyph (white) on its chip              | `--mf-white` #ffffff               | `--mf-tt-green` #15803d            | 5.0:1  | 3:1   |
| task type amber glyph (white) on its chip              | `--mf-white` #ffffff               | `--mf-tt-amber` #b45309            | 5.0:1  | 3:1   |
| task type orange glyph (white) on its chip             | `--mf-white` #ffffff               | `--mf-tt-orange` #c2410c           | 5.2:1  | 3:1   |
| task type red glyph (white) on its chip                | `--mf-white` #ffffff               | `--mf-tt-red` #c62828              | 5.6:1  | 3:1   |
| task type rose glyph (white) on its chip               | `--mf-white` #ffffff               | `--mf-tt-rose` #be185d             | 6.0:1  | 3:1   |
| task type violet glyph (white) on its chip             | `--mf-white` #ffffff               | `--mf-tt-violet` #6d4bc2           | 6.1:1  | 3:1   |
| task type indigo glyph (white) on its chip             | `--mf-white` #ffffff               | `--mf-tt-indigo` #4f46e5           | 6.3:1  | 3:1   |
| nav text on the panel                                  | `--mf-nav-text` #eaf1fa            | `--mf-nav-bg` #1a3556              | 10.9:1 | 4.5:1 |
| nav muted text and ADMINISTRATION heading on the panel | `--mf-nav-heading` #b4c3d8         | `--mf-nav-bg` #1a3556              | 7.0:1  | 4.5:1 |
| nav text on hover                                      | `--mf-nav-text` #eaf1fa            | `--mf-nav-hover-bg` #2b4b75        | 7.8:1  | 4.5:1 |
| nav muted text on hover                                | `--mf-nav-text-muted` #b4c3d8      | `--mf-nav-hover-bg` #2b4b75        | 5.0:1  | 4.5:1 |
| nav selected text on the white pill                    | `--mf-nav-selected-fg` #17324f     | `--mf-nav-selected-bg` #ffffff     | 13.1:1 | 4.5:1 |
| nav focus ring on the panel                            | `--mf-nav-focus` #ffc15a           | `--mf-nav-bg` #1a3556              | 7.7:1  | 3:1   |
| nav focus ring on hover                                | `--mf-nav-focus` #ffc15a           | `--mf-nav-hover-bg` #2b4b75        | 5.5:1  | 3:1   |
| text on the page                                       | `--mf-text` #1b1f27                | `--mf-bg` #f5f6f8                  | 15.3:1 | 4.5:1 |
| muted text on the page                                 | `--mf-text-muted` #4b5563          | `--mf-bg` #f5f6f8                  | 7.0:1  | 4.5:1 |
| muted text on a card                                   | `--mf-text-muted` #4b5563          | `--mf-surface` #ffffff             | 7.6:1  | 4.5:1 |
| link and primary on a card                             | `--mf-primary` #1f4e9c             | `--mf-surface` #ffffff             | 8.0:1  | 4.5:1 |
| white text on primary                                  | `--mf-primary-contrast` #ffffff    | `--mf-primary` #1f4e9c             | 8.0:1  | 4.5:1 |
| tooltip text                                           | `--mf-tip-fg` #ffffff              | `--mf-tip-bg` #1b1f27              | 16.5:1 | 4.5:1 |
| active-matter dot on a card                            | `--mf-active` #0f766e              | `--mf-surface` #ffffff             | 5.5:1  | 3:1   |
| focus ring on the page                                 | `--mf-focus` #b45309               | `--mf-bg` #f5f6f8                  | 4.6:1  | 3:1   |
| focus ring on a card                                   | `--mf-focus` #b45309               | `--mf-surface` #ffffff             | 5.0:1  | 3:1   |
| input border on a card                                 | `--mf-border-strong` #6b7280       | `--mf-surface` #ffffff             | 4.8:1  | 3:1   |

## 6. Open items for the owner

- Resolved in TH-13: the old teal In Progress colour is gone; In Progress is blue and Completed teal everywhere.
- Open: the date format of section 8 is still only on the new My Matters.
- `--mf-nav-heading` repeats `--mf-nav-text-muted`; a theme editor may split them.

## 7. Adopting the theme in a page

**Status (TH-13, 2026-11-01): every page in the list of 7.3 is converted** (epic #982, TH-01 to TH-12), the old status tokens are deleted and the ledger is empty. The checklist below is for new pages. Data colours that cannot be tokens (the named Task Type palette, a user-picked priority colour, the PrimeNG palette scale in `mf-preset.ts`, the `theme-color` meta tag) carry `theme-colour-ok` with the reason.

Added by UI-07 (#960). Reference pages that already follow it: the navigation panel (`app-shell`) and the new My Matters (`frontend/src/app/features/my-matters/ui/`). Shared blocks: `frontend/src/app/shared/ui/` (full table in `docs/ux/ui-update/shared-blocks.md`). 

### 7.1 Checklist for one page

1. **Tokens only.** Replace every colour literal with a `var(--mf-...)` token (section 4). The ledger is empty, so `npm run lint` fails on any literal.
2. **Status and priority.** Use `mf-status-chip` (never a hand-made badge) and `mf-priority-pill` (only for what needs the eye: Critical, High, At risk, Overdue, On hold). Statuses use `--mf-status-*`; the old status colours are gone.
3. **Fixed-page layout.** A list or grid page is `mf-fixed-page` with the card in `mf-grid-frame`: the header, filters and pager stay put, only the frame scrolls, the frame reaches the bottom gutter (`--mf-gutter`). Below 768 x 561 the page scrolls and rows may become cards.
4. **Tiles and chips.** Counts are `mf-filter-chips` or `mf-stat-tile`; a chip has the count, an icon or a word and `aria-pressed`.
5. **Dialogs.** PrimeNG dialogs already read the preset; title 16 px, secondary action left, primary right (S18, #619). No colour inside.
6. **Empty, loading and error states.** One calm line with an icon, a Retry for errors (`mf-record-state` / the list shell), never a card full of zeros.
7. **Data.** If the page changes what data it asks for: the sensitive-matter rule applies to every list and count (see `docs/ux/sensitive-matters`), and the OpenAPI document and the nswag client are regenerated from code (`npm run api:generate`), never hand-edited.
8. **Accessibility.** Run axe on the page; text 4.5:1 and icons 3:1 (use the `-fg`/`-solid` tokens and `check-theme-contrast.mjs`); visible focus ring; every widget works with the keyboard; targets 44 px on a phone; no thick coloured left border on cards, rows or alerts.
9. **Shortcuts.** No new or changed keyboard shortcut (#420). Arrow keys inside a widget (tree, calendar) are not shortcuts.
10. **Size.** `npm run build` keeps the initial bundle under 700 kB (now about 652 kB); lazy-load page code.

### 7.2 The shared components (copied from the My Matters code)

```html
<!-- Status with "step n of m" and the segmented bar (task-list.ts) -->
<mf-status-chip
  [code]="t.status"
  [stepNumber]="step(t)"
  [stepTotal]="t.workflow.stepsTotal"
  [showBar]="true"
/>

<!-- A priority pill; the kind decides the colour (task-list.ts) -->
<mf-priority-pill [kind]="p" [label]="t.priority.label" />

<!-- A row of toggle chips with counts (task-list.ts) -->
<mf-filter-chips
  label="Status"
  [chips]="statusChips()"
  [value]="status()"
  (valueChange)="statusChange.emit($any($event))"
/>

<!-- The card that holds a grid and fits the window (task-list.ts); the table inside is class "tt" -->
<mf-grid-frame scrollLabel="Open tasks" [resetKey]="resetKey()">
  <div frameHead class="hd">...</div>
  ...
</mf-grid-frame>

<!-- An event type icon, plain or as a named chip (calendar-tab.ts) -->
<mf-event-icon [type]="e.typeCode" />
<mf-event-icon [type]="t.code" [chip]="true" />

<!-- The collapsible right panel (overview.ts) -->
<mf-side-panel
  [open]="layout.sideOpen()"
  (openChange)="$event ? layout.expandSide() : layout.collapseSide()"
  [sections]="sections()"
  >...</mf-side-panel
>
```

Also: `mf-tree` (ARIA tree, `filterTree` for search), `[mfTip]` (tooltip on hover and focus).

### 7.3 Ordered page list and estimates

Estimates are agent-hours for the visual conversion only (tokens, shared blocks, fixed-page layout, states, axe). Data changes are extra. Order = value first: pages people open most, then those that share the most code.

| #   | Page (route)                                                                     | Hours    | Components and work it needs                                                                                                                        |
| --- | -------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dashboard (`/dashboard`)                                                         | 8.0      | stat tiles to tokens, chart palette (`chart-palette.ts`) to semantic tokens, filter chips, status chip                                              |
| 2   | Tasks: Task Queue (`/tasks`), My Work (`/my-work`), Pod Work (`/pods/work`)      | 10.0     | one shared work grid (`task-table`, `queue-page`): grid frame, status chip with step, priority pill, filter chips; the three pages convert together |
| 3   | Matters list and record (`/matters`)                                             | 5.0      | grid frame, status/priority pills, record header, tabs, tiles                                                                                       |
| 4   | Assets list and record (`/assets`)                                               | 5.0      | grid frame, disposition chip (a new `mf-status-chip` kind), linked-task table                                                                       |
| 5   | Clients list and record (`/clients`)                                             | 4.0      | grid frame, record header, matter list                                                                                                              |
| 6   | Projects (`/projects`)                                                           | 3.0      | grid frame, record header                                                                                                                           |
| 7   | Task page (`/tasks/:id`)                                                         | 6.0      | facts strip tiles, status chip, workflow bar, comments, dialogs                                                                                     |
| 8   | Create task, notifications, search, profile                                      | 5.0      | forms (`_forms.scss`), lists, empty states                                                                                                          |
| 9   | Administration: Users, Roles, Pods                                               | 4.0      | admin list shell, dialogs                                                                                                                           |
| 10  | Administration: Task types, Workflows, Steps, Labels, Asset types, Custom fields | 8.0      | admin list shell, colour pickers (data colours, `theme-colour-ok`), designer screens (form-engine library has 47 literals)                          |
| 11  | Administration: Reports, Audit logs, Settings                                    | 3.0      | admin list shell, log tables                                                                                                                        |
| 12  | Access pending, error pages                                                      | 1.0      | record state                                                                                                                                        |
|     | **Total**                                                                        | **62.0** |                                                                                                                                                     |

Every existing page is listed once (the Task Queue, My Work and Pod Work are one row because they share the grid; the three admin screens groups cover all admin routes).

### 7.4 Example: converting a hard-coded badge

Before (a colour literal; the lint fails on it):

```ts
styles: [`.badge { background: #E5F5EA; color: #146C2E; }`];
```

After (a token; the contrast is already proven):

```ts
styles: [
  `.badge { background: var(--mf-sem-healthy-bg); color: var(--mf-sem-healthy-fg); }`,
];
```

Better still, use `<mf-status-chip code="COMPLETED" />` and delete the style.

### 7.5 Lessons of the rollout and the visual sweep (TH-01 to TH-17, TH-14)

Where things live now, so the next page does not repeat the discoveries:

- **One dropdown.** Every choice or filter control is `mf-dropdown` (`shared/ui/dropdown.ts`): the inline column filters (`ColumnSelectFilter`, `ColumnTristateFilter`), the pager's rows per page, Dashboard Scope and Period, Pod Work's Pod, the time zone, the phone sort sheet and the Search filters. Data-entry selects inside forms (Project in the edit dialog, form-engine fields, colour pickers) stay native and take their look from `_forms.scss`. In a table cell the host takes `width: 0; min-width: 100%` so the words of the choices never widen a column; set `--mf-ctl-h-sm` on the host to match neighbouring 32 px inputs. A page that opens it near the bottom gets the list upward automatically.
- **Chips.** Counts and status switches are `mf-filter-chips` (with `[strip]="true"` for a summary strip: it keeps `data-strip` / `data-strip-item`; items may be `inert`, `tinted` or `alert`). `mf-work-strip` remains only for read-only record strips.
- **Status and priority.** `mf-status-badge` draws `mf-status-chip`; lists use `mf-priority-flag` (pill for Critical and High, plain words for the rest); only `mf-priority-badge` remains for the admin colour preview.
- **Grids.** The work grid keeps its own scroll area and draws the `mf-grid-frame` card on `mf-work-list`; record and admin lists use `mf-grid-frame`. Heading rows are small bold capitals in the muted ink, so specs read header text with `textContent` (`allTextContents()`), not `innerText`. A grid that is wider than its frame scrolls sideways inside the frame (LC-09) and its filter row scrolls with it; the controls move to the sheet only in a narrow window (under 768 px).
- **No coloured edges.** An overdue row or card, the current workflow step and the Swimlane and Users cards carry their state in words and a full thin ring or border, never a 3 to 8 px coloured left edge.
- **Dialogs.** Title 16 px / 600, secondary action on the left in the DOM and on screen, primary on the right (the Edit task dialog was the last exception).
- **Headings.** Dashboard lane and list headings are `h3` with `aria-level="2"` so the outline does not skip a level.
- **Targets.** A text link of 16 px needs `padding-block: 4px; margin-block: -4px` to reach 24 px without a taller line (axe `target-size`).
- **Tests.** Use `e2e/support/dropdown.ts` (`filterDropdown`, `labelledDropdown`, `dropdownById`, `dropdownByAttr`; `.selectOption`, `.optionTexts`; the chosen value is the `data-value` attribute) and `src/app/testing/dropdown-testing.spec-util.ts` (`ddSelect`, `ddChoose`). Colour specs read tokens through `tokenHex` (`token-colours.spec-util.ts`), never a copied hex.
- **Sweep.** `docs/ux/theme-rollout/sweep.md` lists every route checked at 1366x768, 1920x1080, 768x1024 and 375x812 with axe (WCAG A/AA and best-practice), what was found and what was fixed or filed.

### 7.6 The app shell and the logo (SH-01, #1044, epic #1037)

- **Full-height navigation panel.** From 640 px up the dark navy panel (`--mf-nav-bg`) runs from the very top of the window to the bottom as one straight line on the left, and holds the logo and the application name in its top row (as tall as the old header, `--mf-header-h`, with a thin line under it). The white top bar starts to the right of the panel; its search box lines up with the page content (24 px from the panel edge, the same left edge as the page title). The DOM keeps one logo link inside the header (`.mf-logo`, so the tab order and the `data-testid="app-logo"` are unchanged); from 640 px up `_brand.scss` lays it over the panel column. Between 640 and 1099 px the panel is the 56 px rail and only the mark shows (the name stays for screen readers and in the link's `aria-label`). Below 640 px the logo stays in the white top bar and the menu is a drawer.
- **Selection shape.** `--mf-nav-item-radius` is `--mf-radius-md` (6 px). The panel keeps 8 px side margins, so the selected white row, a sub-item and the hover row are 6 px rounded and 8 px in from the panel edge, in the full panel and in the rail. Contrast is unchanged and there is no coloured edge (selection keeps the bold weight).
- **Logo rule.** The bundled default mark has a white-on-navy variant (`public/logo-light.svg`, next to `favicon.svg`); the panel uses it from 640 px up (a `<picture>` with a `min-width: 640px` source), the white top bar on a phone uses the normal one. An uploaded logo cannot be recoloured, so it is always shown on a light tile (`--mf-surface`, 6 px radius, 4 px padding, `.mf-logo__pic--tile`) with the name in white next to it; the same rule is in `docs/ux/app-settings`. The tile is a panel-only look: on a phone the uploaded logo sits on the white bar as before.
- **Kept.** Fixed-page layout (the page never scrolls on desktop), the short-window rule (the menu scrolls inside itself, the version line is pinned; it now also has the old header height), print (panel and bar hidden), skip link first, no keyboard shortcut added.

### 7.7 My Matters scope (MM-20, #1053)

The Client and Matters tree (`mf-mm-tree-panel`) is the only control that chooses a client or matter on My Matters; the chosen scope is `mf-mm-scope-chip` beside the page title (pill, surface colour, a named x, ellipsis plus tooltip). Where the tree is not docked (under 1100 px) the Scope button opens it. Details in `docs/ux/my-matters-calm/README.md`.

## 8. Date and time format of the new My Matters (UI-23, issue #974)

One helper owns it: `frontend/src/app/shared/ui/numeric-date.ts` (constant `NUMERIC_DATE`, pattern `MM/DD hh:mm AM/PM`). Change it there and every date of the page follows.

- A date with no time of day is `MM/DD` (`10/26`); a date in another year than the current one is `MM/DD/YYYY` (`01/05/2027`, with the time when there is one).
- A time is a 12-hour clock with a leading zero and a space before AM or PM: `04:00 PM`, `12:00 AM` at midnight, `12:00 PM` at noon. Example: `10/26 04:00 PM`.
- The person's time zone decides the day, the clock and "the current year" (instants only; calendar dates are floating days).
- In templates use the `mfNum` pipe (`value | mfNum`, `| mfNum: 'date'`, `| mfNum: 'time'`); in code use `numericDate`, `numericInstant`, `numericDateAndTime`.
- Accessible text and tooltips keep a readable full date: `readableDate` / `readableInstant` give "October 26, 2026, 4:00 PM". Relative words ("Today", "2 days ago", "Due in 2 d") stay as they are. The month title of the calendar ("October 2026") is a heading, not a date, and stays.
- Other pages keep `mfDate` for now. The native date and time inputs of the event dialog follow the browser's locale.


## 6. Create and edit in a pop-up dialog; side panels for detail (epic #1001, MD-22; owner decision 2026-11-02, addendum AQ.4)

**Every create and edit opens in the shared centred pop-up dialog** (`mf-form-dialog`, `frontend/src/app/shared/ui/form-dialog.ts`). The right-hand side panel (`mf-slide-panel`, `slide-panel.ts`) is **only for read and detail context**: the tasks of a project, the details of a production or spec with comments and history, the notes history, the AI "coming soon" panel. A small centred confirmation (`mf-confirm-dialog`) is for confirmations ("Set matter inactive"). The old routed form pages stay until their screen is converted (the matter edit page `/matters/:id/edit` is one; creating a matter is the pop-up on the Matters list).

Rules of the dialog:

- Header: title (and an optional quiet subtitle, for example the CM number) and a close button. Body scrolls inside the dialog (never taller than 90% of the window). Footer: **Cancel on the left, the primary action on the right**.
- Esc and a click on the scrim close it; Tab stays inside; focus goes to the first field when it opens and returns to the control that opened it.
- Sizes: `small` 416 px, default 576 px, `large` 768 px; **full screen below 640 px**.
- `dirty` makes every way of closing ask "You have unsaved changes. Discard them?" (Keep editing / Discard). `busy` shows "Saving..." and ignores clicks; `error` shows a message in the footer (`role="alert"`); `canSubmit` false makes the primary button `aria-disabled`.
- The page owns the form and the save; it closes the dialog (`visible.set(false)`) when the save worked and refreshes its data. The dialog does not navigate away; a page that wants to go somewhere (a new matter opens its page) does it in its `(saved)` handler.
- Put the form inside an `@if` so it exists only while the dialog is open; reset the form signals each time `visible` turns true.
- Examples: `features/projects/ui/project-panel.ts` (create and edit a project), `features/matters/ui/matter-form-dialog.ts` (New matter and Edit matter: one shared form, MD-43).

Screens that should adopt the dialog later (not converted in this epic): My Matters Add event dialog, Create/Edit task, Clients create/edit, Assets list create/edit, Users, Roles, Pods, the admin lookup forms (task types, asset types, labels, custom fields) and profile preferences.


## 9. Buttons: one rule, from the shared theme only (epic #1001, MD-26, #1030)

Every button in the app, the Matter detail tabs included, is drawn by the shared button system and nothing else: PrimeNG `p-button` with the preset in `core/theme/mf-preset.ts`, or a native `<button class="mf-btn ...">` from `src/styles/_buttons.scss`. Both render the same tokens, so they look the same.

| Kind | `p-button` | native | Use for |
| --- | --- | --- | --- |
| Primary (filled brand) | default | `mf-btn mf-btn--primary` | the one main action of a bar or form: "+ New Project", "Create matter", "Save" |
| Secondary (white outline) | `severity="secondary"` | `mf-btn` | everything else in a bar, Cancel, Edit, Export |
| Danger | `severity="danger"` (outlined) | `mf-btn mf-btn--danger` | Delete, Retire; the red fill (`mf-btn--solid`) only inside a confirmation |
| Text (link style) | `[text]="true"` | `mf-btn mf-btn--text` | quiet in-line actions: "Change", "Try again", "All activities" |
| Icon only | `[rounded]="true" [text]="true"` with `aria-label` | `mf-btn mf-btn--icon` | row and bar icons; always an accessible name |

- **One size.** 32 px high (44 px for touch and phone), 14 px label, 600 weight (400 for text buttons). `size="small"` is the same size in this theme and is **not used** in new code: leave it out.
- **Labels** are verbs or "+ New Thing" in Title Case ("New Production", "New Spec", "New Asset", "New Note", "New Project"); the `pi pi-plus` icon goes in front of a "New ..." button.
- **No local button CSS.** A page style sheet never sets `background`, `border`, `color`, `padding`, `font`, `min-height` or `border-radius` on `.p-button`, `.mf-btn` or on a raw `<button>` that acts as a button. A link-looking action is `mf-btn mf-btn--text`, not a private `.xxx__link` class. Layout (margin, flex, gap, alignment) around a button is fine.
- **Guard.** `src/app/shared/ui/button-rule.spec.ts` fails when a component under `features/` or `shared/` that belongs to a Matter detail tab (matter detail page, summary, projects, assets, productions, notes, scoped tasks) styles a button itself or uses `size="small"` on a `p-button`.

**My Matters (owner decision 2026-11-02, #1030):** My Matters no longer has its own button paint. Its "+ New" menu button, Filter, scope Browse and Clear, the calendar Previous/Today/Next/Add event, Mark all as read, the tree icon buttons and the Metrics Work/Assets toggle are `mf-btn` variants (`mf-btn--primary`, `mf-btn--text`, `mf-btn--icon`, and the shared `mf-seg` toggle with `mfSegmented`). One look and one 32 px size across the app. Still local by design: in-text links (`.lnk`), the sort buttons inside column headers, calendar day cells, and the pressed/selected state tint of the tree icon buttons. `button-rule.spec.ts` now covers every file in `features/my-matters/ui`, `tabs` and `panels`.

## 11. The shared grid: resize, reorder, filter, Columns menu, row hover (epic #1001, MD-28, #1032)

One set of small blocks in `frontend/src/app/shared/ui`, used together. A page opts in to each part it needs; every part works on its own.

| Part | File | What it does |
| --- | --- | --- |
| Column model and storage | `grid-prefs.ts` | `GridColumnDef` (`key`, `label`, `locked`, `defaultHidden`, `pinned`), `GridPrefs` (`order`, `visible`), pure `shownKeys`, `orderedKeys`, `moveKey`, `moveBefore`, `withVisible`, and the guarded storage `mf.grid.v1.<grid>.<userId\|anon>` |
| Resize | `resizable-columns.ts` (`table[mfResizable="<grid>"]`) | drag, focus the handle and use Left/Right (Shift: big step), Home, Enter or double-click to fit; widths in `mf.col-widths.v1.<grid>.<userId>`; the table is frozen at its measured widths before the first change (no layout shift) |
| Reorder | `reorder-columns.ts` (`table[mfReorder] (columnMove)`) | drag a header (drop on its left or right half); it only reports `{key, beforeKey}`, the page keeps the order |
| Columns menu | `grid-columns.ts` (`<mf-grid-columns [defs] [prefs] (prefsChange) (resetColumns)>`) | show/hide per column (locked ones cannot be hidden), "Move X left / right" buttons per shown column (the keyboard way to reorder, with a live-region announcement), "Reset to default" (order and visibility; widths stay) |
| Filter | `filters/column-filter-row` (`mfColumnFilterRow`) | unchanged: the inline filter row under the header, same look everywhere |
| Row hover | token `--mf-row-hover` | `.pg-table tbody tr:hover > td` and `.wt tbody tr:hover > td`; text, muted text and links on it are checked in `check-theme-contrast.mjs`; hover is never the only signal of selection or focus (those keep their own marks) |

How to adopt it on a list page (the Matters list is the example, `features/matters/pages/matters-list-page.ts`; the Matter Tasks tab is `shared/work-queue/scoped-tasks.ts`):

1. Describe the columns once: `gridDefs = computed<GridColumnDef[]>(...)` in the default order. Leave out what a permission hides. Mark Ref/Name/Title `locked`; mark a column that must stay first `pinned`; mark optional ones `defaultHidden`.
2. Keep `prefs = signal(loadGridPrefs(gridPrefsKey('<grid>', userId)))`; `setPrefs` saves with `saveGridPrefs`; reset calls `clearGridPrefs`. `dataColumns = computed(() => shownKeys(defs, prefs))`, then apply the page's own width rules (a narrow window drops a column) on top.
3. Draw the header and the cells from `dataColumns()` with `@for` and `@switch` (one `@case` per column), so the order is whatever the person chose. Give every `th` a `data-col="<key>"`; give selection and action cells `data-no-resize data-no-reorder`.
4. Put `mfResizable="<grid>"`, `mfReorder` and `(columnMove)="onMove($event)"` on the `<table>`; in `onMove` call `moveBefore(defs, prefs, e.key, e.beforeKey)` and `setPrefs`.
5. Add `<mf-grid-columns>` to the page actions (hide it on a phone, where the list is cards).
6. Add a unit spec (order, hide, reset, per-user key) and a targeted e2e (keyboard move, reload keeps it).

Work tables (Task Queue, My Work, Pod Work, the Matter and Project Tasks tabs) use `mf-task-table`, which has its own column-based resize (`shared/work-queue/column-resize.ts`) and the same `mfReorder`; the Tasks tabs take their columns from `grid-prefs` (`reorderable` input), the Task Queue pages keep their older chooser.

**Where the Matter Tasks tab stands (MD-29, #1033):** default order Ref, Type (chip and the type's name), Title, Project, Priority, Assignee, Due, Status, Progress. Project is a default column (right after Title) for a Matter that has projects; a Matter without projects has nothing to choose, so the column is left out there. Any column but Ref and Title can be hidden in the Columns menu. Ref is pinned first, Title cannot be hidden.

**Pages that should adopt it later (not converted; estimates in agent-hours):** Clients list 2.5, Projects list 2.5, Assets list 3, Matter Projects tab 2, Matter Assets tab 2, Matter Activities 2, Users 3, Roles 2.5, Pods 2.5, admin lookups (Task Types, Asset Types, Labels, Custom Fields, Workflows) 2 each, Audit Logs 3, Reports lists 3; unifying the Task Queue / My Work / Pod Work chooser and resize with this set (one Columns menu instead of the chooser panel, one resize store) 10.

### 11.1 List page anatomy (epic #1037, LC-01 #1038, owner decision addendum AR)

Every list page puts the same things in the same place with the same names. A zone that a page does not fill is left out, it never moves another zone. The picture is `docs/ux/grid-consistency/anatomy-mockup.html` (branch `grid-consistency-review`).

```
Row 1  [icon] Title  (count chip)                                          [+ New Thing]
Row 2  [Search tasks]  [Filters (2)]  [Other filters]  [view slot]  ...  Sorted by Name, A to Z  [Columns]  [...]  [+ New]
Row 3  (only with chips or a notice) filter chips  Clear filters                  Sorted by Name, A to Z   Reset sort
Grid   sort by header click; a bulk bar REPLACES row 2 while rows are selected
Foot   Rows per page [50]   Showing 1-50 of 139   Page 1 of 3   First  Previous  Next  Last
```

| Zone | Component | Notes |
| --- | --- | --- |
| Row 1 | `mf-page-header` with `[count]` | the H1, then the total after the filters as a small chip (`data-list-count`, left out while the list loads); the primary "+ New Thing" is the last `mfActions` button (Title Case, `pi pi-plus`, guide section 9) |
| Row 2 | `mf-list-toolbar` (`shared/filters/list-toolbar.ts`) | Search first (always visible, not the global search; it drives the one text filter marked `search: true` in the page's `FilterDef[]`, so the URL parameter, links and saved views are unchanged), then Filters (n) and Other filters, then the `[mfView]` slot (quick views or a View dropdown), a spring, the `[mfColumns]` slot, the `[mfMore]` "..." menu (`mf-options-menu`: Saved views, Export) and, on a tab that has no H1, the `[mfPrimary]` button |
| Row 3 | `mf-list-toolbar` + `mf-sorted-line` (`shared/ui/sorted-line.ts`, in the `[mfBarEnd]` slot) | chips with "Clear filters" show whenever a filter is active, with the filter row open or closed; the Sorted by line always names the sort, the default order included, and "Reset sort" shows only while the person chose a sort. With no chip and no notice there is no row 3: the Sorted by line moves up into row 2, before Columns (owner decision 2026-11-02), so a list keeps one toolbar row. A page whose row 2 is already full (the Task Queue's quick-view chips) sets `[sortedBelow]="true"` and keeps row 3 for the line in every state |
| Bulk bar | `[mfBulk]` slot, `[bulkActive]` | replaces row 2 ("3 selected", the actions, Clear) |
| Footer | `mf-pager` | rows per page 25 / 50 / 100 (default 50, `DEFAULT_PAGE_SIZE` in `list-query.ts`), Showing a-b of n, Page n of m, First / Previous / Next / Last; no "Load more" |
| Phone (under 640 px) | the same component | Search and Filters stay (the Filters sheet holds every filter and the Sort select), Columns and Other filters are hidden, the primary button stays |

Rules: the Search box is `mf-search-box` (live after 300 ms, Enter at once, x to clear); a filter with `search: true` has no cell in the filter row and no field in the sheet, makes no chip and is not counted in the Filters badge, but it still counts as an active filter for Clear filters and the empty state. The `/` shortcut (unchanged, `shortcut-registry.ts`) focuses Search first. Sort is by header click (Enter or Space on the header button); nothing here adds or changes a keyboard shortcut (#420). Both Columns menus stay in phase 1 (the work lists keep their chooser, the record lists keep `mf-grid-columns`: same place, same name "Columns").

**Wide grids scroll inside the frame (LC-09 #1052, owner decision 2026-11-02).** On a desktop window every column the person has chosen stays visible at its width (resizable above its minimum); when the columns are wider than the grid frame the frame scrolls sideways inside itself, the page never scrolls sideways, the header row stays at the top, the Ref or Name column stays pinned on the work lists, and the scroll region is focusable and named ("Task list, scrollable"; arrow keys scroll). No list drops a column because of the window width any more (the old narrow-box rule, the `data-drop` thresholds and the Matters Secondary PM 1280 px rule are gone; `data-drop` stays as a marker only). Under 640 px the lists are cards as before.

**Adopted:** Task Queue, My Work, Pod Work, the Matter Tasks tab (`mf-scoped-tasks`), Clients, Matters, Projects, Assets, and (LC-08) the Matter Assets and Matter Projects tabs. Not yet (later phases): admin lists, My Matters, Search, Notifications, Audit Logs, Activities. Search on Clients and Matters also finds the CM Number (the API `q`).

**Standard columns.** Tasks, one order on every list (`WORK_COLUMNS` in `shared/work-queue/column-prefs.ts` is the order of the table and of the Columns menu): Ref, Type, Title, CM Number, Matter Name (global lists only), Project, Priority, Assignee, Due, Status, Progress; a list that is already scoped drops the obvious columns by default (Matter Tasks: no CM Number or Matter Name; My Work: no Assignee; the Closed tab shows Closed in place of Due). Assets: Type, Name, CM Number (global lists), Size, Linked Tasks, External Reference, Disposition. The matter number is "CM Number" everywhere; the workflow progress is "Progress".

### 11.2 Matter detail tab controls (epic #1037, LC-08 #1051)

The seven tabs of a Matter (Summary, Tasks, Projects, Assets, Productions, Notes, Activities) look like one family. The review with the matrix of what differed and small pictures is `docs/ux/matter-detail/tab-controls-review.md`.

**The tab strip** is the shared `mf-tabs` for every tab: a PrimeIcons icon, the label, the count in brackets where the viewer may see it (Tasks, Projects, Assets, Productions, Notes), a 2 px primary underline on the selected tab, one Tab stop with the arrow keys moving between tabs, sideways scroll with edge cues on a phone. A tab never draws its own strip, and a sub-switch inside a tab (Productions / Specs, Notes By tag / Latest / Templates) is the shared segmented control, never a second row of tabs.

**The control row** of a tab sits directly under the strip and above the frame, one line, left to right:

```
[Search x]  [Filters (n)]  [view: segmented or dropdown]  ......  Sorted by ...  [Columns]  [...]  [+ New Thing]
```

| Zone | Rule |
| --- | --- |
| Search | `mf-search-box` (compact, leading icon, placeholder "Search tasks / projects / assets / productions / specs / title and text", live after 300 ms). Always first. |
| Filters and views | `mf-filters-toggle` and the column filter row for a record list; a view is the shared segmented control (`mfSegmented`) for 2 to 4 modes or `mf-dropdown` for a filter with many values. Never a hand-made button group or a native `<select>`. |
| Right end | Sorted by line, Columns, the "..." menu, then the primary action of the tab last ("+ New Task", "+ New Project", "+ New Asset", "+ New Production", "+ New Note"). One primary per tab. The same words the header "New" menu uses. |
| Heights | every control is the shared control height; nothing in a row is painted by a page (`button-rule.spec.ts` fails on a local colour, border or background for a button, a segmented control or a dropdown in these tabs). |
| Log tabs | Activities has no list to search: its row holds the Kind dropdown only, and the tab name is the screen-reader heading. |
| Summary | has no list controls; its one action ("Edit") lives in the Details card header. See "Matter Summary and header (MD-42)" below. |
| Width | `mf-list-toolbar` wraps as pieces; the primary action stays at the right end of its line. On a phone the control row is Search and Filters, then the view. |

A new Matter tab uses `mf-list-toolbar` (record or work list) or the row above with the same order; it does not invent a header of its own.

### 11.3 Tab strips: one component, an icon on every tab (epic #1037, LC-10 #1058)

Every tab strip in the app is the shared `mf-tabs` (`shared/ui/tabs.ts`): one height, spacing, selected style (2 px primary underline), hover and focus style, count in brackets, small number badge, and the same overflow behaviour (the strip scrolls sideways with an edge fade and chevron on a narrow screen, the selected tab is brought into view). `mf-work-tabs` (My Work, Pod Work), the Dashboard strip (`mf-dash-tabs`) and the Swimlane lane switcher are thin wrappers around it; none draws its own `role="tab"`.

**An icon on every tab.** `MfTab.icon` is required, so a tab without an icon does not compile. Icons are PrimeIcons classes from one registry, `shared/ui/tab-icons.ts` (`tabIcon(key or label)`): the same concept has the same icon wherever it shows. The icon is decorative (`aria-hidden`), the label (with the count) is the accessible name, and the selected tab is never shown by colour alone (underline and bold).

| Concept | Icon | Where |
| --- | --- | --- |
| Summary, Overview | `pi-home` | Matter, Client, Task type, Workflow, Asset type, My Matters |
| Details | `pi-info-circle` | Project, Asset, Step, Report |
| Tasks, Linked tasks | `pi-check-square` | Matter, Project, Asset, Client, search results |
| Projects / Assets | `pi-folder` / `pi-database` | Matter, Task, My Matters, search, Asset type |
| Matters / Clients | `pi-briefcase` / `pi-building` | Client page, search |
| Productions / Notes | `pi-send` / `pi-file-edit` | Matter |
| Activity, Activities, History | `pi-history` | Matter, Asset, Report, My Matters |
| Comments | `pi-comments` | Task |
| Workflow, Workflows | `pi-sitemap` | Task, Task type |
| Steps / Used by / Versions | `pi-list` / `pi-link` / `pi-clone` | Workflow, Step |
| Calendar / Metrics | `pi-calendar` / `pi-chart-bar` | My Matters |
| Dashboard: Breakdowns, Trends, Swimlane, Users | `pi-chart-pie`, `pi-chart-line`, `pi-table`, `pi-user` | Dashboard |
| My Work and Pod Work views | Active `pi-bolt`, Due soon `pi-clock`, Closed `pi-check-circle`, Created by me `pi-user-edit`, Unassigned `pi-inbox`, By member `pi-users`, All open `pi-list` | My Work, Pod Work |
| Admin: Users, Roles, Pods; Labels; Task types, Workflows, Steps; Reports | `pi-user`, `pi-shield`, `pi-users`; `pi-flag`, `pi-tag`, `pi-pause`, `pi-hashtag`; `pi-tags`, `pi-sitemap`, `pi-list`; `pi-file`, `pi-folder-open`, `pi-play`, `pi-share-alt`, `pi-heart` | Administration |
| Settings: Branding, Dashboard | `pi-palette`, `pi-gauge` | Settings |

A new tab adds its concept to `TAB_ICONS` first. The guard `shared/ui/tab-icons.spec.ts` fails when an entry is not a PrimeIcons class, when a file draws its own `role="tab"`, or when a file that uses `mf-tabs` builds tabs without an icon.

### 11.4 Dashboard Summary (epic #1063, decision AS; mockup `docs/ux/mockups/dashboard-v4/` on branch `dashboard-mockup-v4`)

The Summary tab is one fixed page (the page never scrolls on a window of 768 x 561 or more; only the grid body and the right column do), built from shared parts and four new patterns.

```
[Dashboard]                                            Updated   Scope [All pods v]  [Refresh]
[Summary] [Breakdowns] [Trends] [Swimlane] [Users]
[ Overdue 9 ] [ Unassigned 17 ] [ On hold 12 ]                      3 cards, toggles (aria-pressed)
Tasks (143)  [Search] [Filters] ... Sorted by ...  [Columns]       |  Team capacity    [i] [People]
Ref | Type | Title | CM Number | Matter Name | ... | Due | ...      |  Capacity used 37%   [Healthy]
...rows, the frame scrolls sideways, Ref pinned...                  |  [=========.....]
Rows per page 50   Showing 1-50 of 143   Page 1 of 3               |  8 of 12 can take work now ...
                                                                    |  Unassigned wait   [Level 3 . High]
                                                                    |  (half circle gauge) 7 / 2 h 48 m
```

| Part | Component | Rules |
| --- | --- | --- |
| Needs attention cards | `mf-dash-cards` (`summary/dash-cards.ts`) | Three cards in this order: Overdue, Unassigned, On hold. Each is a toggle button (all three the same width, sized to the content and left aligned under the tab names; the explanation, such as "Excludes ASAP tasks", is a tooltip on hover and keyboard focus and part of the accessible name, not visible text): a click filters the grid (`card=` in the address), a second click clears it; one or none is on (`aria-pressed`). One Tab stop, Left/Right move between the cards (no new shortcut, #420). The count is the server's and scope-wide: it does not shrink with Search or Filters; the chip "Needs attention: Overdue" in the toolbar says why the grid total differs. A card at zero is calm (teal check; the tooltip says "Nothing here"). Under 768 px the three stay in one compact row. |
| Grid | `mf-dash-grid` (`summary/dash-grid.ts`) on `mf-work-list` / `mf-task-table` | The list standard of 11.1: `mf-list-toolbar` (Search, Filters, Columns, chips with Clear filters, "Sorted by" with Reset sort), the standard task column order, 50 rows a page, the frame scrolls sideways with Ref pinned. The base query is the card's (or the scope's open tasks); filters narrow it further. While the Unassigned card is on, the extra column "Unassigned for" shows (not in the Columns menu) and the grid sorts longest waiting first (`sort=unassignedSince`, "Sorted by Unassigned for, longest waiting first"). |
| Type cell | the standard `type` column of `mf-task-table` | The same chip and type name as every task list (DB-10). |
| Due cell | `mf-due-suffix-cell` (`shared/work-queue/due-suffix.ts`) | The numeric date (`NUMERIC_DATE`, `MM/DD hh:mm AM/PM`) and, only while overdue, a bold red suffix on the SAME line: `+9d` (days), `+7h` (under a day), `+<1h`. Today, tomorrow and later have no suffix. The words ("9 days overdue") are in the tooltip and in the accessible name, so red is never the only signal. The maths is the shared Due logic (`describeDueCell`). |
| Assign cell | the Assignee column's `mf-row-edit` | An unassigned task shows "Unassigned" with the chevron, like an assigned row: the whole cell is the one control (accessible name "Unassigned: assign this task") and opens the shared assignee menu (`showStates`), which lists each person with the state icon and word and the load ("Busy, 2 open"). Without Task.Assign it is plain text. 409: "This task was changed by someone else. The row was reloaded." After a successful assign the row leaves the Unassigned view, focus moves to the next row, and the cards, gauge and battery are read again. |
| Capacity battery | `mf-dash-battery` (`summary/dash-battery.ts`) | ONE department indicator that shows the REMAINING capacity (DB-12, #1086): the fill and the number are the API's `freePercent`, so a full battery means plenty of free capacity. The percentage sits INSIDE the battery, as plain text without a ring next to a bolt icon, on a battery 51 px high (no separate big line; under 28 percent the number sits just after the short fill in the normal text colour). The People button is an icon-only button (`aria-label` and tooltip "People") on the title row, after the status chip and the info button. The status word chip beside the title and its icon change with the level: Healthy (50% and more, `pi-check-circle`), Watch (30 to 49, `pi-eye`), Low (10 to 29, `pi-exclamation-triangle`), Critical (under 10, `pi-times-circle`). The colour steps at 50, 40, 30, 20 and 10 percent: `--mf-rem-0..5` (teal, yellow-green, amber, orange, red, dark red, each with a `-fg` text colour; the number on the fill and the word chip use the pair, contrast checked in `check-theme-contrast.mjs`). The battery is an image named "Remaining capacity NN percent. 8 of 12 can take work now. Healthy." and its tooltip is "Remaining capacity NN%" plus the formula ("Remaining capacity = free slots / (3 x people who are at work now) ..."). Neutral states show the state word inside a hatched battery without a percentage: "After hours", "Everyone out", "No workers". Below: the summary line, a legend of six states with icon, count and words, a rate hint "N assigned in the last hour" (hidden when absent), an info button with the formula. People opens `mf-dash-people` (dialog, search, grouped by state, scrollable, up to 200, read only when it opens). Needs Dashboard.ViewUsers. |
| Unassigned gauge | `mf-dash-gauge` (`summary/dash-gauge.ts`) | Design A: a half circle with the scale 0 to 5 (numbers on the segments, stripe pattern on the segments up to the level), the needle, the level badge ("Level 3 . High", "Normal", "All clear"), the count, the age of the oldest unassigned task ("2 h 48 m, oldest, working hours") and one "what to do" line. The level is the server's. The visual and the button "Show them, longest waiting first" select the Unassigned card and reset the sort. `aria-live="polite"` speaks only when the level changes. Levels 4 and 5 pulse softly; `prefers-reduced-motion` removes the pulse and the needle's movement. The page reads the summary again every minute while the gauge is on screen. Needs Dashboard.ViewSummary. |
| Tokens | `--mf-cap-0..3` (+ `-fg`), `--mf-wait-0..5` in `docs/ux/tokens.css` | The capacity ramp reuses the heat-map blues; the wait ramp uses the teal, amber, orange and red solids. Contrast of the text-on-fill and graphic pairs is in `scripts/check-theme-contrast.mjs`. |
| Settings | Administration > Settings > Dashboard (`mf-dashboard-settings`) | Workday start and end, working days, age basis (working or clock hours), hours for levels 1 to 5, tasks per extra level, the most extra levels; the defaults under each field, Reset to default only fills the form, Save stores (or resets, when the values equal the defaults); the firm's time zone is read-only text. |

Roles: Director and Pod Lead (Dashboard.ViewSummary) get the cards, grid and gauge; the battery needs Dashboard.ViewUsers on top (a Pod Lead has it; a role without it keeps the cards, grid and gauge and the right column holds the gauge only). A Technician (Dashboard.View + ViewUnassigned) keeps the "Unassigned work" queue alone: no cards, grid, battery or gauge. A Pod Lead opens on "My pods". Under 768 px (or a window under 561 high) the page is one column: cards, battery, gauge, then the tasks as cards (the card list keeps the standard cells; the Type icon, `+9d` and the Assign picker are the desktop grid's).

### 11.5 Dashboard Breakdowns (epic #1063, DB-11 #1085)

The tab is one fixed page: an info row, then four cards (Priority, Status, Age in one row of equal height; Task Type under them across the width). From 1300 px of tab width that is three columns plus the wide Task Type card; from 700 px two columns; below 700 px one column and the page scrolls (phone). On a desktop window (768 x 561 or more) the Task Type card takes the rest of the height (12 rem at least) and its list scrolls inside it under the pinned title, so there is no empty area under the cards.

| Part | Rule |
| --- | --- |
| Card (`BD_CARD_CSS`, `breakdown-card.ts`) | The Dashboard card style: `--mf-radius-xl`, `--mf-border-soft`, `--mf-shadow-card`, 16 px padding. Title Case H3 at `--mf-fs-xl` (Priority, Status, Task Type, Age) and the view switch in the header. |
| View switch (`mf-bd-switch`) | The shared segmented control (`mfSegmented`): Bars, Pie, Table, one Tab stop, arrow keys, the pressed button ticked and bold, the group named "View of <card>". It replaces the "View as table" link; the choice is remembered per card and user (`BreakdownPrefs`); the table is the accessible table. In a card narrower than 17 rem only the icons show (the words stay for assistive tools). |
| Rows | At least 36 px high, label and count at `--mf-fs-lg`, count bold, bar 16 px. |
| Priority and status icons | A 28 px tile with a PrimeIcons icon, coloured with the badge tokens of the same priority or status (`--mf-pr-*-bg/fg`, `--mf-status-*-bg/fg`), so the pair is already contrast checked. The icon is decorative; the label, count and share are text. Priority: Critical `pi-exclamation-triangle`, High `pi-arrow-up`, Normal `pi-minus`, Low `pi-arrow-down`. Status: New `pi-plus-circle`, In Progress `pi-play-circle`, On Hold `pi-pause-circle`. |
| Task Type | The same `mf-task-type-chip` (icon tile in the type's colour) and the type name as the task lists. The summary does not carry the type's colour key, so the tile uses the colour the chip derives from the type's id until the API sends it. |
| Age | The sequential ramp `--mf-ramp-1..6` (light to dark with age). |
| Overdue | Unchanged: the red hatched segment and the red "N overdue" text; the text is now the shared link chip (soft pill, link colour, focus ring) and still opens the Task Queue with the same filters plus `overdue=true`. Counts and names in the table view use the shared link style with a focus ring. |
| Info row | One soft band above the cards: "Open tasks, now. Not affected by the period." with an info icon, and the legend (Not overdue, Overdue) at its right end. |

### 11.6 Dashboard Users, Workload view (epic #1095, US-01 #1091)

- **One filter bar.** The segmented count bar and the chip row are one bar (`mf-users-summary`, `data-capacity-bar`): Idle, Light, Normal, Heavy, Out of office and Off hours, six buttons that are ALL the same size (8.25 rem, the widest label with its count), each with an icon, left aligned and never stretched or sized by the number of people (US-05 #1096). Each is a toggle button with icon, word and count (`aria-pressed`, keyboard), a tooltip with the threshold, and the group's name lists every count. The unassigned link and the Assign work menu sit at the end of the same row; an info button ("Who is counted") explains the population.
- **Who is counted.** The Workload board lists every active user with a role (any permission) who is in an active pod or holds open tasks, so a Director or Project Manager can appear. The Team capacity battery and the Calendar count only active users holding Workflow.Execute who belong to an active pod of the scope. That is why this tab can say 60 people where the battery says 46. The tooltip says so; the rule was not changed (it is a backend query).
- **Table, quiet rows.** Columns: Person, Load, Highest priority, Availability, Overdue, Due soon, On hold, Next due, and a labelled Assign button (icon and word; the word hides on a phone, the accessible name stays "Assign work to <name>"). Load is ONE element next to the person: the open-task count, a 5 rem bar split by priority in the priority colours (tooltip "10 open: 2 Critical, 5 High, 3 Normal"), and the level word; there is no separate Open tasks column and no "Open by priority" signal icons. The Availability chip shows only when the person is not available (Out of office, Off hours, Holiday). Zeros in Overdue, Due soon and On hold are a muted dash (the figure stays in the accessible text); Overdue above zero stays red. Next due is never cut at normal widths and is red when overdue.
- **Toolbar.** One row with the labels in line with their controls (Highest priority, Availability, Sort), search, view switch, the cards and table buttons and Legend (theme guide 11.1 conventions). The Dense tile and Standard tile buttons are gone; an old saved tile size is ignored and a saved mode that no longer exists opens the table.
- **Card view (US-05).** A bigger card, three to four to a line on a laptop and one on a phone, scrolling inside the page frame: the avatar initials and name (a button that opens the person's drawer and covers the whole card), Workload (the open-task count, the bar split by priority and the level word, with the same words as the table) and the Availability line (icon and word: Available, Out of office until ..., Off hours). Overdue work is only a red badge with its count when above zero. Nothing else is on the card; the full status is the name's tooltip and accessible name. The Assign icon appears on hover or focus.
- **Legend (US-05).** Six states, each with its icon, colour chip and ONE line, from the real thresholds of the board: Idle "No open tasks", Light "1 to 3 open tasks", Normal "4 to 8 open tasks", Heavy "9 or more open tasks", Out of office, Off hours. Nothing else (priority signals, columns glossary and the framing text are gone). It fits at 1366 x 768 without scrolling.

### 11.7 Dashboard Users, person drawer (epic #1095, US-03 #1093)

The drawer that opens from a person (the `mf-users-drawer` dialog, a right drawer; the list stays visible behind it, full screen on a phone) now has the shared `mf-tabs` strip with an icon on each tab: **Overview** (`pi-home`: the person's state and load, the counts Open, Overdue, Due soon and On hold, and the open tasks with the same inline edits as before), **Task types** (`pi-th-large`) and **Trend** (`pi-chart-bar`). A different person always opens on Overview. Task types and Trend read `GET /dashboard/users/{id}/history` for the page scope (`mf-users-history`; Dashboard.ViewUsers only; a person outside the scope is a 404, shown as a note).

- **Task types.** A 3 months | 12 months switch (the shared segmented control), then a table: task type (icon and name), Completed, Their median (with the sample size n), Firm median (with n), and Compared. Times are working minutes unless the server says clock time, shown as "45 min" or "3.3 h", and the note says "Times are working time". The comparison is ratio words with an icon, never colour alone and never a ranking: "1.3x firm median" with an up-right arrow and the spoken "Longer than the firm median", a down-right arrow for "Shorter than the firm median" (0.8x or less), an equals sign for "About the firm median". Under 5 completed tasks the median cell says "Not enough tasks yet" and there is no comparison. The footer says the figures are for planning and coaching, not a ranking.
- **Trend.** Completed per month for the last 12 months as 12 bars with their numbers on top (tokens `--mf-primary` on `--mf-surface-alt`), the on-time sentence ("33 of 37 tasks on time (89%)", or "Not enough tasks yet"), and the same figures in a table under a disclosure ("Table of the same figures"). Each bar has an accessible name ("Nov 2026: 12 completed").
- Loading shows skeleton rows, an error shows Retry, an empty window says the person has not completed any tasks in it.

### 11.8 Dashboard Users, Skills view (epic #1095, US-04 #1094)

Workload | Coverage | Skills is the view switch of the Users tab (Coverage only with Dashboard.ViewCoverage; Skills needs Dashboard.ViewUsers, the tab's own permission); the address carries `view=skills`. `mf-skills-view` reads `GET /dashboard/users/skills` for the page scope. A matrix of people (rows, the Person column sticks) by task types (columns, the header sticks) scrolls inside its frame, a focusable region named "Skills matrix, scrollable". Each cell prints the completed count of the chosen window (3 or 12 months) as a number, always, with a tint by count (0 none, 1 to 2, 3 to 4, 5 to 9, 10 and more; ramp tokens `--mf-ramp-*` with their text colours). A column header marks thin cover (0 to 2 people with 5 or more completed in 12 months) with an icon, the word "Thin" and a tooltip, and the words are also spoken. The toolbar follows the Workload toolbar (labels in line): search by name, Task type, Availability (All, Can take work now), the 3 | 12 months switch and an info button saying the same 3-month counts drive the assignee suggestions (#1088). Choosing a task type narrows the matrix to that column and shows **Growth candidates**: people with fewer than 5 completed in 12 months in it who can take work now, the lightest load first, at most six; a click on a name opens the person's drawer. This is for planning cover and training, not a ranking of people.

## 10. Note text colours (epic #1001, MD-30, #1034)

The Notes editor offers a fixed palette of eight text colours plus Default: red, orange, amber, green, teal, blue, violet and slate (grey). They are the tokens `--mf-note-<key>` in `docs/ux/tokens.css`; `scripts/check-theme-contrast.mjs` checks each at 4.5:1 on a card and on the quote tint. A note stores a colour as `<span data-color="red">` (never inline CSS); the server keeps only these eight keys. The page maps the key to the token (`[data-color='red'] { color: var(--mf-note-red) }` in `note-editor-refs.scss`). Colour never carries meaning alone: the menu names every colour, and bold or headings stay available.


## Matter Summary and header (MD-42, #1060; mockup `docs/ux/mockups/matter-summary`)

- **Header** (`mf-matter-header`): breadcrumb `Matters > <matter name>`, title `Client > Matter name` (22 px, 18 px on a phone, two lines at most), the New and "..." menus. The CM number, Active, Sensitive and AI chips are not in the header; they are in the Summary Details. What stays: the amber **sensitive information bar** under the title (access information on every tab) and the inactive-matter and inactive-client banners below the header (read-only information; without the Active chip they are the only sign of it outside the Summary).
- **Summary = asset strip + one full-width Details card.** The strip has equal tiles (220 to 320 px), one per type and no Total tile (MD-43), scrolls sideways instead of wrapping, and a compact dashed empty bar with "New Asset". Details fits its content, sits at the top and scrolls inside itself when taller than the room; the page never scrolls on desktop. Fields are a grid of small muted labels over values: 3 columns when the card is 1100 px wide or more, 2 from 700 px, 1 below (container queries). Order: CM number (one highlighted line with its copy button), Client, Matter number, Matter name, Status, Sensitive (only when sensitive; "Restricted access" is its tooltip), Primary PM, Secondary PM (initials avatar, name, "Change" / "Add"), AI allowed, Created, Last changed (`MM/DD/YYYY hh:mm AM/PM`, long form with the time zone as tooltip), then the custom fields without a heading.
- **Recent activity is not on the Summary** (owner decision); it is the Activities tab. The matter overview endpoint (`GET /matters/{id}/overview`, fields `activity`, `deadlines`, `people`, `health`...) is no longer called by the Matter page; the API and the OpenAPI file are unchanged. Candidates for a later cleanup: the whole overview endpoint and `MatterOverviewClient`.
- **Names:** a person without a display name shows the account without its domain on this tab (`shortAccountName`, `shared/ui/person-name.ts`: `KE\kekim` gives `kekim`, a name with a space is never touched). Other places that still show the raw account: the Matters list manager columns, My Matters, Users, the audit browser; they were not changed here.
The Notes editor offers a fixed palette of eight text colours plus Default: red, orange, amber, green, teal, blue, violet and slate (grey). They are the tokens `--mf-note-<key>` in `docs/ux/tokens.css`; `scripts/check-theme-contrast.mjs` checks each at 4.5:1 on a card and on the quote tint. A note stores a colour as `<span data-color="red">` (never inline CSS); the server keeps only these eight keys. The page maps the key to the token (`[data-color='red'] { color: var(--mf-note-red) }` in `note-editor-colours.scss`). Colour never carries meaning alone: the menu names every colour, and bold or headings stay available.

**The one matter form (MD-43, #1061).** "+ New Matter" and Edit (Summary) open the same component, `mf-matter-form-dialog`. Field order: Client, Matter number, CM Number, Matter name, Sensitive matter, AI allowed, custom fields. **CM Number is a read-only preview** (client number, a dash, matter number; updates live; never typed). In Edit, Client and Matter number sit in the same places but are locked: the Matter number unlocks after a short confirmation ("Change the matter number?", primary "Unlock the matter number") and only for holders of `Matter.EditNumber`; a changed number is confirmed again on Save with the exact result ("The CM Number changes from A to B. It is used in references everywhere. Continue?", primary "Change CM Number"); the Client stays locked because the API has no way to move a matter to another client. The "Total" tile of the asset strip was removed in the same change.

## 12. Dashboard Calendar (epic #1074, decision AT; mockup `docs/ux/mockups/dashboard-calendar/` on branch `calendar-mockup`; plan `docs/ux/calendar/plan.md`)

What the Calendar adds to the theme, and the rules a later change must keep. The screens are `features/dashboard/calendar/` (Month, Week, the day panel, the insights), `shared/availability/absences/` (the Out of office list and dialog on the Profile) and `features/admin/holidays/` (Settings > Holidays, the thresholds, the person's calendar field).

### 12.1 Coverage tokens

A day is coloured by the level the server computes (GOOD, WATCH, LOW, CRITICAL, CLOSED, NON_WORKING). The colours are the proposed alias tokens `--mf-cov-<good|watch|low|crit>-<bg|fg|solid>` and `--mf-cov-none-<bg|fg>` in `docs/ux/tokens.css`, built **only** from the existing semantic hues: Good is healthy (teal), Watch is risk (amber), Low is critical (deep orange), Critical is overdue (red); Closed and Non-working are neutral. The blue capacity ramp (`--mf-cap-*`) stays for load and is never used for coverage. Every pairing is in `scripts/check-theme-contrast.mjs` (text 4.5:1 on its tint and on a card, the solid 3:1):

| Pairing | Foreground | Background | Ratio | Needs |
| --- | --- | --- | --- | --- |
| coverage good text on its tint | `--mf-cov-good-fg` #0b6b5f | `--mf-cov-good-bg` #ddf3ef | 5.5:1 | 4.5:1 |
| coverage good text on a card | `--mf-cov-good-fg` #0b6b5f | `--mf-surface` #ffffff | 6.4:1 | 4.5:1 |
| coverage good solid on its tint | `--mf-cov-good-solid` #0f766e | `--mf-cov-good-bg` #ddf3ef | 4.7:1 | 3:1 |
| coverage good solid on a card | `--mf-cov-good-solid` #0f766e | `--mf-surface` #ffffff | 5.5:1 | 3:1 |
| coverage watch text on its tint | `--mf-cov-watch-fg` #8a4b00 | `--mf-cov-watch-bg` #fff4db | 6.2:1 | 4.5:1 |
| coverage watch text on a card | `--mf-cov-watch-fg` #8a4b00 | `--mf-surface` #ffffff | 6.8:1 | 4.5:1 |
| coverage watch solid on its tint | `--mf-cov-watch-solid` #b45309 | `--mf-cov-watch-bg` #fff4db | 4.6:1 | 3:1 |
| coverage watch solid on a card | `--mf-cov-watch-solid` #b45309 | `--mf-surface` #ffffff | 5.0:1 | 3:1 |
| coverage low text on its tint | `--mf-cov-low-fg` #9a3a06 | `--mf-cov-low-bg` #fdebdc | 6.1:1 | 4.5:1 |
| coverage low text on a card | `--mf-cov-low-fg` #9a3a06 | `--mf-surface` #ffffff | 7.0:1 | 4.5:1 |
| coverage low solid on its tint | `--mf-cov-low-solid` #c2410c | `--mf-cov-low-bg` #fdebdc | 4.5:1 | 3:1 |
| coverage low solid on a card | `--mf-cov-low-solid` #c2410c | `--mf-surface` #ffffff | 5.2:1 | 3:1 |
| coverage crit text on its tint | `--mf-cov-crit-fg` #b42318 | `--mf-cov-crit-bg` #fdecea | 5.7:1 | 4.5:1 |
| coverage crit text on a card | `--mf-cov-crit-fg` #b42318 | `--mf-surface` #ffffff | 6.6:1 | 4.5:1 |
| coverage crit solid on its tint | `--mf-cov-crit-solid` #c62828 | `--mf-cov-crit-bg` #fdecea | 4.9:1 | 3:1 |
| coverage crit solid on a card | `--mf-cov-crit-solid` #c62828 | `--mf-surface` #ffffff | 5.6:1 | 3:1 |
| coverage closed text on its tint | `--mf-cov-none-fg` #475569 | `--mf-cov-none-bg` #eef0f4 | 6.6:1 | 4.5:1 |

**Colour is never the only signal.** Each cell prints the level as an icon and a word (Good with a check, Watch with a triangle, Low with an exclamation, Critical with a ban, Closed with a flag, Non-working with a moon), "available of expected" in words ("6 of 6 expected"; "6/6" in a narrow cell by a container query) and how many are out. Weekends and non-working days are muted, today is a filled number, the selected day an outlined cell. The accessible name of a day carries the date, "today", the level word, the numbers and the holiday names; the tooltip adds the total in view and the holiday and non-working counts.

Holiday category colours are the note-tag palette (`--mf-tag-<colour>-bg|fg`), always with the flag icon and the category and name; the admin picks the colour key. Absence types are a word, a glyph (sun, heart, book, users, ellipsis) and a semantic hue (info, critical, healthy, person, neutral).

### 12.2 Tab, page and panel

- The tab is the shared `mf-tabs` strip with the icon `pi-calendar` from `shared/ui/tab-icons.ts` (key `calendar`), after Users, shown with `Dashboard.ViewCalendar`; a link without the permission shows the usual "not available for your role" note. Settings > Holidays uses `pi-flag` (key `holidays`).
- The Pod filter is the page-wide Scope of the Dashboard header (All pods, My pods, one pod; the default is the server's). The tab adds a Role filter, Month and Week, and "Add out of office" (`User.ManageAvailability`). The state is in the address: `cal`, `month`, `week`, `day`, `role` with the page's `pod`; defaults are not written. Previous, Today and Next and the arrow keys inside the grid follow My Matters; no new shortcut (#420).
- **Fixed page**: from 768 x 561 the document never scrolls; the grid, the week table and the panel scroll inside themselves. Below it (and on a phone) the page scrolls.
- The day panel is read-only (section 6): docked from 1024 px (340 px, 300 px up to 1099 px), a slide-over from 768 to 1023 px, a bottom sheet under 768 px (Close, Escape, a click outside; focus goes to Close when it opens as a sheet). It shows the date, holidays by category, four counts, coverage by pod (level icon and word, a bar with the minimum marked), then AVAILABLE and UNAVAILABLE, each grouped by Role in the server's order and sorted by workload as the server returns them (Available: lightest first; Unavailable: heaviest first). A row has the name, the pod, the open-task count as a bare number and a state chip; an unavailable person has the reason, "back MM/DD" and, only when the server sent it, the type of absence. A note or a task title is never in the panel.
- Dates follow section 8 (`MM/DD`, with the year when it is not the current one); headings and aria text spell the month.
- Dialogs are `mf-form-dialog` (Add and Edit out of office, calendar, holiday, import; Cancel left, primary right, "Discard changes?") and `mf-confirm-dialog` (delete); a phone gets them full screen.

**CAL-11 polish (#1089).** A Good day cell is quiet: neutral (class `cv-quiet`, no fill), no word or icon, and its count ("43/46") is small and muted; only Watch, Low and Critical days are coloured and labelled with the icon and word, so colour is never the only signal. The full count stays in the day panel and in the cell's accessible name. The legend keeps Good as a neutral outlined chip. The risk bar is a slim one-line pill, drawn only when there is a risk day (without one a visually hidden status says so). The forecast box is "Free task slots, next 4 weeks" (the tooltip says it measures free task slots, not people present) with real dates ("Nov 1 to 7"). The legend chips never clip: the row wraps. The day panel shows its four counts on one row, folds "Coverage by pod" by default (a toggle with `aria-expanded`), shows the pod status as an icon (the word stays for assistive tools and the title) so pod names are not truncated, and words the banner "43 of 46 expected people are available (93%)". The demo seed (`--aged`) adds busy absence windows so all states appear.

### 12.3 States

Loading shows a skeleton of the grid; an error shows `mf-dash-state` with Retry; no people shows "No people to plan yet"; a role with nobody shows "Clear filters"; a failed refresh keeps the figures and shows the stale banner. The Profile list, the holiday screens and the threshold form have their own loading, empty and error lines, each with Retry.
