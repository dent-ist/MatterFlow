import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';
import { CountChip } from './count-chip';

let nextId = 0;

/**
 * An expandable section card for a side column (epic #1373, issue #1376; mockup `docs/design/mockups/vendor-management`, "Summary: side column"): the matter Summary's Team panel, and
 * the Vendors panel under it (#1379). ONE white card (`mf-card`, D-10) with a 44 px header: a chevron button that folds the body (`aria-expanded`, `aria-controls`, accessible name "Collapse Team"
 * or "Expand Team"), the title (16/600), the count chip (`mf-count-chip`, D-12) and an optional extra chip beside it (`mfPanelChip`: the red "1 Blacklisted" warning, so a fold never hides it);
 * the panel's own action (`mfPanelAction`, a text button such as Edit) sits at the right of the header. The body is the projected rows. Folding is per visit and is not remembered.
 *
 * With `empty` the panel is ONE line, no chevron and no body: the title, a count chip of 0, the muted `emptyText` and the action ("Vendors 0, No vendors linked, + Add Vendor").
 *
 *   <mf-section-panel title="Team" [count]="7" [(expanded)]="open">
 *     <button mfPanelAction type="button" class="mf-btn mf-btn--text">Edit</button>
 *     <ul>...rows...</ul>
 *   </mf-section-panel>
 */
@Component({
  selector: 'mf-section-panel',
  imports: [CountChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sp', '[attr.data-section-panel]': 'key()' },
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .sp__card {
      display: flex;
      flex-direction: column;
      padding: 0;
    }
    .sp__head {
      display: flex;
      align-items: center;
      gap: var(--mf-s1);
      min-height: var(--mf-grid-row-h);
      padding-right: var(--mf-s2);
    }
    .sp__h {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      margin: 0;
      font-size: inherit;
    }
    .sp__toggle {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
      height: var(--mf-grid-row-h);
      padding: 0 var(--mf-s3);
      border: 0;
      border-radius: var(--mf-radius-xl);
      background: transparent;
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .sp__toggle:hover {
      background: var(--mf-surface-alt);
    }
    .sp__toggle .pi {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-icon-sm);
    }
    .sp__title {
      font-size: var(--mf-fs-lg);
      font-weight: var(--mf-fw-semibold);
      white-space: nowrap;
    }
    /* The one-line empty panel: no chevron, so the title starts at the card padding. */
    .sp--empty .sp__head {
      padding-left: var(--mf-s4);
      gap: var(--mf-s2);
    }
    .sp__none {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-md);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sp__body {
      min-width: 0;
    }
  `,
  template: `
    <section class="mf-card sp__card" [class.sp--empty]="empty()" [attr.aria-label]="title()">
      <div class="sp__head">
        @if (empty()) {
          <h3 class="sp__title" data-panel-title>{{ title() }}</h3>
          <mf-count-chip data-panel-count>0</mf-count-chip>
          <span class="sp__none" data-panel-empty>{{ emptyText() }}</span>
        } @else {
          <h3 class="sp__h">
            <button
              type="button"
              class="sp__toggle"
              data-panel-toggle
              [attr.aria-expanded]="expanded()"
              [attr.aria-controls]="bodyId"
              [attr.aria-label]="(expanded() ? 'Collapse ' : 'Expand ') + title()"
              (click)="expanded.set(!expanded())"
            >
              <i
                class="pi"
                [class.pi-chevron-down]="expanded()"
                [class.pi-chevron-right]="!expanded()"
                aria-hidden="true"
              ></i>
              <span class="sp__title" data-panel-title>{{ title() }}</span>
              <mf-count-chip data-panel-count>{{ count() }}</mf-count-chip>
              <ng-content select="[mfPanelChip]" />
            </button>
          </h3>
        }
        <ng-content select="[mfPanelAction]" />
      </div>
      @if (!empty() && expanded()) {
        <div class="sp__body" [id]="bodyId" data-panel-body>
          <ng-content />
        </div>
      }
    </section>
  `,
})
export class SectionPanel {
  /** The panel's name, Title Case ("Team", "Vendors"). */
  readonly title = input.required<string>();
  /** The number of things in the panel, in the count chip. */
  readonly count = input(0);
  /** Names the panel for tests and for a page that scrolls to it (`data-section-panel`). */
  readonly key = input('');
  /** Nothing in the panel: one line with `emptyText` and the action, no chevron. */
  readonly empty = input(false, { transform: booleanAttribute });
  /** The muted words of the empty line ("No members"). */
  readonly emptyText = input('');
  /** Open (the rows show) or folded (the header only); starts open. */
  readonly expanded = model(true);
  protected readonly bodyId = `sp-b-${nextId++}`;
}
