import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ScrollArea } from './fixed-page';

/**
 * Grid frame (`mf-grid-frame`, epic #953 UI-10): the card that holds a grid and reaches the bottom of the window. It generalises the fixed-page mechanism (`mf-fixed-page`,
 * `mfScrollArea`, `styles/_fixed-page.scss`) into one card with four parts:
 *
 *   <mf-grid-frame scrollLabel="Task list">
 *     <div frameHead>title, search, actions</div>       pinned above
 *     <div frameStatus>filter chips</div>                pinned above the rows
 *     <table>...</table>                                  the only part that scrolls (sticky `th` header, focusable region)
 *     <div frameFoot>pager</div>                          pinned at the bottom of the card
 *   </mf-grid-frame>
 *
 * On a desktop window (768 x 561 or more) the frame takes all the height its parent leaves (`flex: 1 1 0; min-height: 0`), never fewer than about five rows (`--mf-frame-min`),
 * and the empty space of a short list is inside the frame, so the frame always ends at the bottom gutter. Below that size the page scrolls as a whole and the frame is as tall as
 * its rows (phone cards). The card is white with a thin border; no coloured border.
 */
@Component({
  selector: 'mf-grid-frame',
  imports: [ScrollArea],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-grid-frame]': '""' },
  template: `
    <div class="head"><ng-content select="[frameHead]" /></div>
    <div class="status"><ng-content select="[frameStatus]" /></div>
    <div class="scroll" [mfScrollArea]="scrollLabel()" [resetKey]="resetKey()">
      <ng-content />
    </div>
    <div class="foot"><ng-content select="[frameFoot]" /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-width: 0;
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-card);
      container-type: inline-size;
      container-name: gc;
      overflow: hidden;
    }
    /* The table every grid in a frame shares: a sticky heading row and a sort button in each heading (the rows are the grid's own). */
    :host ::ng-deep .tt {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: var(--mf-fs-md);
    }
    :host ::ng-deep .tt th {
      position: sticky;
      top: 0;
      z-index: 1;
      height: 40px;
      padding: 0 var(--mf-s3);
      background: var(--mf-surface-alt);
      border-bottom: 1px solid var(--mf-border);
      text-align: left;
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--mf-text-muted);
    }
    :host ::ng-deep .tt th[aria-sort='ascending'],
    :host ::ng-deep .tt th[aria-sort='descending'] {
      color: var(--mf-text);
    }
    :host ::ng-deep .tt .sort {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-height: 32px;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      letter-spacing: inherit;
      text-transform: inherit;
      cursor: pointer;
    }
    .head:empty,
    .status:empty,
    .foot:empty {
      display: none;
    }
    .head,
    .status,
    .foot {
      flex: none;
      min-width: 0;
    }
    .scroll {
      min-width: 0;
    }
    @media (min-width: 768px) and (min-height: 561px) {
      :host {
        flex: 1 1 0;
        min-height: var(--mf-frame-min, 412px);
      }
      .scroll {
        flex: 1 1 0;
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
      }
    }
  `,
})
export class GridFrame {
  /** What the grid is ("Task list"): the scrolling region is named "<label>, scrollable". */
  readonly scrollLabel = input('List');
  /** Anything that changes the rows without an address change; the frame scrolls back to the top. */
  readonly resetKey = input<unknown>(undefined);
}
