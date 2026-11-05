import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Chip kind 2 of the four (D-12, #1129): the count chip. A number beside a title or a tab (the list count in a page header, the number of things waiting in a tab): 22 px high, at least
 * 22 px wide, `--mf-surface-alt`, 12 / 600 text, no icon, never wraps. It is plain information, not a button. Put the number in the content; say what it counts in the surrounding
 * text, a number alone is not a name.
 *
 *   <mf-count-chip>{{ total }}</mf-count-chip>
 */
@Component({
  selector: 'mf-count-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="cc"><ng-content /></span>`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      vertical-align: middle;
    }
    .cc {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      height: 22px;
      min-width: 22px;
      padding: 0 6px;
      border-radius: var(--mf-radius-pill);
      background: var(--mf-surface-alt);
      color: var(--mf-text);
      font-size: var(--mf-fs-chip);
      font-weight: var(--mf-fw-semibold);
      line-height: 1;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
  `,
})
export class CountChip {}
