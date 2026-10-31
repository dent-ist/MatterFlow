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

The older `--mf-st-*` status tokens stay for pages that are not converted yet (In Progress is teal there). A converted page uses `--mf-status-*` (In Progress blue, Completed teal, as in the My Matters mockup). When the last old page is converted, `--mf-st-*` is deleted. The old tokens are the "aliases": nothing existing changes colour in this round.

## 3. Change one token, the app follows (example)

To make every overdue indicator (chips, counts, the Overdue feed items, the tree dots) a slightly different red, change **one line** in `docs/ux/tokens.css`:

```css
--mf-p-red-fg: #b42318; /* was the value above; try #A01D14 */
```

`--mf-sem-overdue-fg`, which every overdue component reads, follows it, and so does the PrimeNG danger button (`--mf-danger` is separate: change it too if the buttons should follow). Run `npm run lint`: the contrast check fails if the new red is below 4.5:1 on its tint or on a card. A theme editor later only has to write these same custom properties on `:root` (or a `[data-theme]` block, see the dark navy values at the end of the file).

## 4. Rules for code

- No colour literal (`#hex`, `rgb()`, `hsl()`) in a component, template or stylesheet. Use `var(--mf-...)`. The lint script fails for a new file with a literal, and for an old file that gets more of them. Old files are in `frontend/scripts/theme-colours-baseline.json` (the ledger); when a page is converted its count drops and the ledger is rewritten with `node scripts/check-theme-colours.mjs --update`.
- Colour is never the only signal: add an icon or a word (WCAG 1.4.1).
- Text needs 4.5:1, icons and bars 3:1; use the `-fg` on `-bg`/white and the `-solid` for graphics only.
- Focus: `:focus-visible` shows the 2 px ring in `--mf-focus` (`--mf-nav-focus` on the navy panel). Never remove it.
- No thick coloured left borders on cards, rows or alerts. The selected navigation item is a white pill.
- No keyboard shortcut is added by a theme change (#420).
- A line with `theme-colour-ok: <reason>` is skipped by the check; use it only for data colours that cannot be tokens (for example a user-picked task type colour) and say why.

## 5. Contrast of every pairing (generated by `check-theme-contrast.mjs --table`)

| Pairing                                                | Foreground                         | Background                         | Ratio  | Needs |
| ------------------------------------------------------ | ---------------------------------- | ---------------------------------- | ------ | ----- |
| overdue text on its tint                               | `--mf-sem-overdue-fg` #B42318      | `--mf-sem-overdue-bg` #FDECEA      | 5.7:1  | 4.5:1 |
| overdue text on a card                                 | `--mf-sem-overdue-fg` #B42318      | `--mf-surface` #FFFFFF             | 6.6:1  | 4.5:1 |
| overdue solid (dot, bar, icon) on a card               | `--mf-sem-overdue-solid` #C62828   | `--mf-surface` #FFFFFF             | 5.6:1  | 3:1   |
| risk text on its tint                                  | `--mf-sem-risk-fg` #8A4B00         | `--mf-sem-risk-bg` #FFF4DB         | 6.2:1  | 4.5:1 |
| risk text on a card                                    | `--mf-sem-risk-fg` #8A4B00         | `--mf-surface` #FFFFFF             | 6.8:1  | 4.5:1 |
| risk solid (dot, bar, icon) on a card                  | `--mf-sem-risk-solid` #B45309      | `--mf-surface` #FFFFFF             | 5.0:1  | 3:1   |
| info text on its tint                                  | `--mf-sem-info-fg` #1F4E9C         | `--mf-sem-info-bg` #E3ECFA         | 6.7:1  | 4.5:1 |
| info text on a card                                    | `--mf-sem-info-fg` #1F4E9C         | `--mf-surface` #FFFFFF             | 8.0:1  | 4.5:1 |
| info solid (dot, bar, icon) on a card                  | `--mf-sem-info-solid` #1F4E9C      | `--mf-surface` #FFFFFF             | 8.0:1  | 3:1   |
| healthy text on its tint                               | `--mf-sem-healthy-fg` #0B6B5F      | `--mf-sem-healthy-bg` #DDF3EF      | 5.5:1  | 4.5:1 |
| healthy text on a card                                 | `--mf-sem-healthy-fg` #0B6B5F      | `--mf-surface` #FFFFFF             | 6.4:1  | 4.5:1 |
| healthy solid (dot, bar, icon) on a card               | `--mf-sem-healthy-solid` #0F766E   | `--mf-surface` #FFFFFF             | 5.5:1  | 3:1   |
| person text on its tint                                | `--mf-sem-person-fg` #5B3FA6       | `--mf-sem-person-bg` #EFEAFB       | 6.6:1  | 4.5:1 |
| person text on a card                                  | `--mf-sem-person-fg` #5B3FA6       | `--mf-surface` #FFFFFF             | 7.8:1  | 4.5:1 |
| person solid (dot, bar, icon) on a card                | `--mf-sem-person-solid` #6D4BC2    | `--mf-surface` #FFFFFF             | 6.1:1  | 3:1   |
| critical text on its tint                              | `--mf-sem-critical-fg` #9A3A06     | `--mf-sem-critical-bg` #FDEBDC     | 6.1:1  | 4.5:1 |
| critical text on a card                                | `--mf-sem-critical-fg` #9A3A06     | `--mf-surface` #FFFFFF             | 7.0:1  | 4.5:1 |
| critical solid (dot, bar, icon) on a card              | `--mf-sem-critical-solid` #C2410C  | `--mf-surface` #FFFFFF             | 5.2:1  | 3:1   |
| neutral text on its tint                               | `--mf-sem-neutral-fg` #475569      | `--mf-sem-neutral-bg` #EEF1F5      | 6.7:1  | 4.5:1 |
| neutral text on a card                                 | `--mf-sem-neutral-fg` #475569      | `--mf-surface` #FFFFFF             | 7.6:1  | 4.5:1 |
| neutral solid (dot, bar, icon) on a card               | `--mf-sem-neutral-solid` #475569   | `--mf-surface` #FFFFFF             | 7.6:1  | 3:1   |
| status new text on its chip                            | `--mf-status-new-fg` #2B4A78       | `--mf-status-new-bg` #FFFFFF       | 8.9:1  | 4.5:1 |
| status new text on a card                              | `--mf-status-new-fg` #2B4A78       | `--mf-surface` #FFFFFF             | 8.9:1  | 4.5:1 |
| status progress text on its chip                       | `--mf-status-progress-fg` #1F4E9C  | `--mf-status-progress-bg` #E3ECFA  | 6.7:1  | 4.5:1 |
| status progress text on a card                         | `--mf-status-progress-fg` #1F4E9C  | `--mf-surface` #FFFFFF             | 8.0:1  | 4.5:1 |
| status hold text on its chip                           | `--mf-status-hold-fg` #475569      | `--mf-status-hold-bg` #EEF1F5      | 6.7:1  | 4.5:1 |
| status hold text on a card                             | `--mf-status-hold-fg` #475569      | `--mf-surface` #FFFFFF             | 7.6:1  | 4.5:1 |
| status done text on its chip                           | `--mf-status-done-fg` #0B6B5F      | `--mf-status-done-bg` #DDF3EF      | 5.5:1  | 4.5:1 |
| status done text on a card                             | `--mf-status-done-fg` #0B6B5F      | `--mf-surface` #FFFFFF             | 6.4:1  | 4.5:1 |
| status cancel text on its chip                         | `--mf-status-cancel-fg` #374151    | `--mf-status-cancel-bg` #E5E7EB    | 8.3:1  | 4.5:1 |
| status cancel text on a card                           | `--mf-status-cancel-fg` #374151    | `--mf-surface` #FFFFFF             | 10.3:1 | 4.5:1 |
| event court icon and text on its tint                  | `--mf-event-court-fg` #1E3A8A      | `--mf-event-court-bg` #E4E9F7      | 8.5:1  | 4.5:1 |
| event trial icon and text on its tint                  | `--mf-event-trial-fg` #86198F      | `--mf-event-trial-bg` #F6E4F8      | 6.8:1  | 4.5:1 |
| event deposition icon and text on its tint             | `--mf-event-deposition-fg` #0B627D | `--mf-event-deposition-bg` #D9EFF5 | 5.8:1  | 4.5:1 |
| event production icon and text on its tint             | `--mf-event-production-fg` #4D6310 | `--mf-event-production-bg` #E9F1CE | 5.8:1  | 4.5:1 |
| event filing icon and text on its tint                 | `--mf-event-filing-fg` #A3194F     | `--mf-event-filing-bg` #FBE3EC     | 6.2:1  | 4.5:1 |
| event mediation icon and text on its tint              | `--mf-event-mediation-fg` #17683A  | `--mf-event-mediation-bg` #DAF1E2  | 5.7:1  | 4.5:1 |
| event meeting icon and text on its tint                | `--mf-event-meeting-fg` #6B4600    | `--mf-event-meeting-bg` #F3E8CF    | 6.9:1  | 4.5:1 |
| event other icon and text on its tint                  | `--mf-event-other-fg` #475569      | `--mf-event-other-bg` #E8ECF1      | 6.4:1  | 4.5:1 |
| nav text on the panel                                  | `--mf-nav-text` #EAF1FA            | `--mf-nav-bg` #1A3556              | 10.9:1 | 4.5:1 |
| nav muted text and ADMINISTRATION heading on the panel | `--mf-nav-heading` #B4C3D8         | `--mf-nav-bg` #1A3556              | 7.0:1  | 4.5:1 |
| nav text on hover                                      | `--mf-nav-text` #EAF1FA            | `--mf-nav-hover-bg` #2B4B75        | 7.8:1  | 4.5:1 |
| nav muted text on hover                                | `--mf-nav-text-muted` #B4C3D8      | `--mf-nav-hover-bg` #2B4B75        | 5.0:1  | 4.5:1 |
| nav selected text on the white pill                    | `--mf-nav-selected-fg` #17324F     | `--mf-nav-selected-bg` #FFFFFF     | 13.1:1 | 4.5:1 |
| nav focus ring on the panel                            | `--mf-nav-focus` #FFC15A           | `--mf-nav-bg` #1A3556              | 7.7:1  | 3:1   |
| nav focus ring on hover                                | `--mf-nav-focus` #FFC15A           | `--mf-nav-hover-bg` #2B4B75        | 5.5:1  | 3:1   |
| text on the page                                       | `--mf-text` #1B1F27                | `--mf-bg` #F5F6F8                  | 15.3:1 | 4.5:1 |
| muted text on the page                                 | `--mf-text-muted` #4B5563          | `--mf-bg` #F5F6F8                  | 7.0:1  | 4.5:1 |
| muted text on a card                                   | `--mf-text-muted` #4B5563          | `--mf-surface` #FFFFFF             | 7.6:1  | 4.5:1 |
| link and primary on a card                             | `--mf-primary` #1F4E9C             | `--mf-surface` #FFFFFF             | 8.0:1  | 4.5:1 |
| white text on primary                                  | `--mf-primary-contrast` #FFFFFF    | `--mf-primary` #1F4E9C             | 8.0:1  | 4.5:1 |
| tooltip text                                           | `--mf-tip-fg` #FFFFFF              | `--mf-tip-bg` #1B1F27              | 16.5:1 | 4.5:1 |
| active-matter dot on a card                            | `--mf-active` #0F766E              | `--mf-surface` #FFFFFF             | 5.5:1  | 3:1   |
| focus ring on the page                                 | `--mf-focus` #B45309               | `--mf-bg` #F5F6F8                  | 4.6:1  | 3:1   |
| focus ring on a card                                   | `--mf-focus` #B45309               | `--mf-surface` #FFFFFF             | 5.0:1  | 3:1   |
| input border on a card                                 | `--mf-border-strong` #6B7280       | `--mf-surface` #FFFFFF             | 4.8:1  | 3:1   |

## 6. Open items for the owner

- The older app colours In Progress teal; the new tokens colour it blue and Completed teal (as asked in the mockup). Converted pages follow the new tokens.
- `--mf-nav-heading` repeats `--mf-nav-text-muted`; a theme editor may split them.

## 7. Adopting the theme in a page

Added by UI-07 (#960). Reference pages that already follow it: the navigation panel (`app-shell`) and the new My Matters (`frontend/src/app/features/my-matters/ui/`). Shared blocks: `frontend/src/app/shared/ui/` (full table in `docs/ux/ui-update/shared-blocks.md`). Other pages are NOT restyled in this round.

### 7.1 Checklist for one page

1. **Tokens only.** Replace every colour literal with a `var(--mf-...)` token (section 4). Run `node scripts/check-theme-colours.mjs --update` after the page is clean so the ledger shrinks.
2. **Status and priority.** Use `mf-status-chip` (never a hand-made badge) and `mf-priority-pill` (only for what needs the eye: Critical, High, At risk, Overdue, On hold). Statuses use `--mf-status-*`; the old `--mf-st-*` colours disappear from the page.
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

Before (a colour literal; counted in the ledger):

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
