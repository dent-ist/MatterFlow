# Matter > Notes: height toggle (UI spec, #1341, epic #1340)

Desktop only, 1366x768 and 1920x1080 (D-82). Follows `docs/ux/design-guidelines.md` (D-02, D-03, D-05, D-10a, D-15, D-17, D-20, D-46). No new or changed keyboard shortcut (#420). Numbers below are read from the CSS (no browser was available for this spec); the implementation PR must measure them and quote the real values.

## 1. What the person gets

Two independent toggles in the Notes tab of a Matter:

- **Width** (exists): hides the note list so the editor has the whole card.
- **Height** (new): folds the matter header so the Notes card uses the whole height under the top bar. The note list stays on the left.

Both can be on or off in any combination (section 7). The height choice is remembered per person; the width toggle keeps today's behaviour (section 6).

## 2. The new button

| Item | Value |
| --- | --- |
| Component | `mf-btn mf-btn--icon` (36 x 36, radius 4, icon 18 px = `--mf-icon-md`), same markup as the width button, attribute `data-note-height`. No private paint. |
| Icon | `pi-arrows-v` in both states. Not used by a neighbour (width = `pi-window-maximize`/`-minimize`, Close = `pi-times`, Edit = `pi-pencil`, More = menu). Not a key of the icon registry (`tab-icons.ts`), so the registry guard `tab-icons.spec.ts` is unaffected; the only other use in the app is the "Moved" badge on the workflow version page (another screen, another concept). Do not add it to the registry. |
| Placement | Directly **after** the width button, 8 px gap: `... [More] [Width] [Height] [Close]` in read mode; `... [More] [Width] [Height] | [Cancel] [Save]` in edit mode (before the vertical divider). The Close button stays last. |
| When there is no open note | No pane header exists (the list fills the card), so the button sits at the right end of the list's first row, after `New Note`, 8 px gap. Rule: it is in the pane header whenever a note is open, otherwise in the list row; never both. Opening a note moves focus to the note title as today. Template view (no width toggle) uses the list-row button. |
| Off | Secondary icon button as the width button looks today. |
| Pressed (on) | `aria-pressed="true"`, fill `--mf-selected-bg`, icon `--mf-primary` (D-05). Hover `--mf-surface-alt`, focus ring 2 px `--mf-focus`. The fill is the signal, the icon does not change. |
| Width button | Gets the same pressed look (fill `--mf-selected-bg`, icon `--mf-primary`) while it is on, so the two toggles read as a pair. Its icon swap stays. Small scope addition, see the owner decisions. |
| Accessible name and tooltip | Identical text (`mfTip` + `aria-label`, D-17, sentence case, D-20): off **"Expand to the full height"**, on **"Show the matter header again"**. Same pattern as the width toggle and D-46 (`aria-pressed`, name follows the state). |
| Existing mismatch | The width button's `title` says "Full width" / "Show list" but its accessible name says "Expand to the full width" / "Show the list again". Implementation sets the width tooltip to its accessible name (via `mfTip`) so both buttons say the same thing. |

## 3. What folds

Today, above the Notes card, the page stacks: breadcrumb row, title row with Edit / New / More actions, optional sensitive bar, optional inactive-matter and inactive-client banners, then the tab strip (`matter-header.ts`, `matter-detail-page.ts`). The Notes tab has **no separate summary strip** (the summary lives in the Summary tab); folding covers the header block only.

| Part | Folded | Why |
| --- | --- | --- |
| Breadcrumb and title row (Edit, New, More actions) | Hidden | This is the height we want back. The page title stays in the page as a visually hidden `h1` (`mf-sr-only`, keeps `data-page-title`) so screen readers and the route announcer still have a heading. |
| Sensitive bar, inactive-matter and inactive-client banners (D-10a) | **Kept**, 36 px each | They carry access and state information a person must not lose by folding. Rare, so the typical gain is not reduced. |
| Tab strip (`mf-tabs`, 40 px + 12 px) | **Kept** | The only way to leave Notes without first unfolding; no second navigation is invented. Folding applies to Notes only: any other tab shows the full header. |
| Notes card | Unchanged | Grows into the freed space. |

The matter name is not on screen while folded. This is accepted: the browser tab title still names the matter, the fold is the person's explicit choice, and one click shows it again. Do not add a replacement label to the tab strip.

## 4. Filling the viewport, no page scroll

The page is already a fixed page (`mf-fixed-page`, D-03): shell main area = window minus top bar (53 px, `--mf-header-h`), main padding 12 px top, 8 px bottom (fixed mode), tab panel and `mf-notes-tab` are `.mf-fill`, the card `.nt` is `flex: 1 1 auto; min-height: 0; overflow: hidden`, and the list and editor scroll inside themselves. Folding therefore needs **no height calculation**: the header is removed (not hidden by height tricks), the flex column gives the freed space to the card. Forbidden: `100vh`, `calc(100vh - ...)`, fixed px heights, a page or main-area scrollbar at any state. Fold and unfold must not re-create `mf-notes-tab` (the header is its sibling; the open note, caret, scroll position and unsaved text stay).

Measured from the CSS (plain matter: breadcrumb about 17 px + title row 36 px + 8 px margin = about 61 px; tab strip 52 px; tolerance +/- 3 px for the font's line height):

| Window | Main content height | Notes card, header shown | Notes card, header folded | Gain |
| --- | --- | --- | --- | --- |
| 1366x768 | 768 - 53 - 20 = 695 | about 582 | about 643 | **+61 px (+10 %)** |
| 1920x1080 | 1080 - 53 - 20 = 1007 | about 894 | about 946 | **+61 px (+7 %)** |

Sensitive matter (bar +44 px) with the bar kept: header shown 538 / 850, folded 599 / 902, gain still +61 px. An inactive matter or client adds 44 px to both columns in the same way.

## 5. States while folded

- **Validation, save state, conflicts, lock warnings:** all live inside the Notes card (pane header "Unsaved changes", `nt__banner` rows, Save/Cancel). Folding does not touch them and never hides them; the card only gets taller. Toasts are global overlays. Nothing unfolds automatically on an error, on a save or on opening the editor (a remembered choice is never overridden by the app).
- **Editing:** Edit still sets the width toggle on (today's rule); it never changes the height toggle.
- **Focus:** the toggle is the same DOM node before and after, so focus stays on it. No focus move, no scroll, no announcement beyond the changed name and pressed state. The header block is not focusable while folded (not rendered).
- **Loading skeleton** of the matter page honours the remembered choice (no header drawn, tab strip drawn) so the page does not jump when the data arrives.

## 6. Remembered choice

- Browser storage, one entry per person: key `mf.notes.height.v1.<userId>` (`anon` when no id), value `1` = folded; the entry is removed when turned off. Read once when the Notes tab is created; written on each click. Every read and write inside try/catch; blocked storage means the toggle works for the visit and starts off after a reload. Anything but `1` = off. Default **off**.
- The choice is global for the person, not per matter: opening Notes on another matter, following a deep link `?tab=notes`, or reloading shows the same state at once. Leaving to another tab shows the header; coming back to Notes folds it again. Another person on the same browser has their own entry. No backend, no cross-tab sync.
- The height state is never reset by opening, closing, saving, cancelling or deleting a note (unlike the width state, which those actions reset today).
- Width stays as it is: not remembered, switched on when a note is edited, off again on close or cancel.

## 7. The four combinations

| Width | Height | List | Matter header | Editor | Notes card at 1366x768 / 1920x1080 |
| --- | --- | --- | --- | --- | --- |
| off | off | left, resizable | shown | right of the list | 582 / 894 high (today) |
| on | off | hidden | shown | full card width | 582 / 894 high |
| off | on | left, resizable | folded | right of the list | 643 / 946 high |
| on | on | hidden | folded | full card width and height | 643 / 946 high |

Pressed fills as in section 2 in every row; the tab strip is visible in every row.

## 8. Deferred: Full screen (build only after the toggles are reviewed)

Measured gain on top of "both on": the top bar (+53 px height: card 696 / 999) and the left rail (+220 px width, `--mf-nav-w`: card about 1318 / 1872 wide). Recommendation: do not build it now. The height gain is 53 px (+8 %), the width gain does not help reading lines that are already long with the list hidden, and it hides global search, Create Task, notifications and the user menu. If the owner still wants it after review:

- Entry: icon button `pi-expand`, "Enter full screen" / "Exit full screen" tooltips, placed after the height button; state not remembered (always starts off).
- Exit: a visible secondary button **"Exit Full Screen"** (icon `pi-arrow-down-left-and-arrow-up-right-to-center`, text always shown) at the right end of the tab strip row, always visible, never auto-hidden; no keyboard shortcut, no browser Fullscreen API.
- Implies width off or on as chosen and height folded; leaving restores the previous toggles.

## 9. Acceptance

Every state in sections 2-7 at both sizes; no page scrollbar in any of the four combinations (including a long note, the editor with a validation message, and a sensitive matter); the real gain in px quoted in the PR; axe 0; focus stays on the toggle; storage blocked and corrupt values tested; `design-guidelines.md` gets one rule (D-xx) with this behaviour when the feature ships; screenshots only on `design-evidence` under `notes-height/`.

## Decisions for the owner

1. Keep the sensitive bar and the inactive banners visible while folded (this spec) or fold them too (gain +44 px on such matters, but a sensitive matter would show no marker).
2. Also give the width toggle the pressed fill (this spec) or leave it untouched.
3. Width stays unremembered (it is set automatically by Edit); say so if you want it remembered as well.
