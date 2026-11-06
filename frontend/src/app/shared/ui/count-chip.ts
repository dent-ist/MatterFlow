import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

/**
 * Chip kind 2 of the four (D-12, #1129): the count chip. A number beside a title or a tab (the list count in a page header, the number of things waiting in a tab): 22 px high, at least
 * 22 px wide, `--mf-surface-alt`, 12 / 600 text, no icon, never wraps. It is plain information, not a button. Put the number in the content; say what it counts in the surrounding
 * text, a number alone is not a name. On a `--mf-surface-alt` panel (a Swimlane lane header) the page sets `--mf-cc-bg: var(--mf-surface)` so the chip stays visible.
 *
 * `overlay` (#1238) is the same chip over the corner of an icon button (the notification bell, the Notes History and Referenced Items buttons, the rail buttons of a side panel): 18 px,
 * `--mf-primary` with white text and a 2 px ring in the surface colour, positioned 7 px above and to the right of the nearest `position: relative` parent. `alert` makes it
 * `--mf-danger` (unread, overdue). Hide it from assistive tools (`aria-hidden="true"`) and say the number in the button's own name.
 *
 *   <mf-count-chip>{{ total }}</mf-count-chip>
 *   <mf-count-chip overlay alert aria-hidden="true">{{ unread }}</mf-count-chip>
 */
@Component({
  selector: 'mf-count-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.cc-overlay]': 'overlay()' },
  template: `<span class="cc" [class.cc--overlay]="overlay()" [class.cc--alert]="alert()"
    ><ng-content
  /></span>`,
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
      background: var(--mf-cc-bg, var(--mf-surface-alt));
      color: var(--mf-text);
      font-size: var(--mf-fs-chip);
      font-weight: var(--mf-fw-semibold);
      line-height: 1;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    :host(.cc-overlay) {
      position: absolute;
      top: -7px;
      right: -7px;
    }
    .cc--overlay {
      height: 18px;
      min-width: 18px;
      padding: 0 4px;
      border: 2px solid var(--mf-surface);
      background: var(--mf-primary);
      color: var(--mf-primary-contrast);
      font-weight: var(--mf-fw-bold);
    }
    .cc--overlay.cc--alert {
      background: var(--mf-danger);
      color: var(--mf-white);
    }
  `,
})
export class CountChip {
  /** Sits over the corner of an icon button instead of in the text flow. */
  readonly overlay = input(false, { transform: booleanAttribute });
  /** Overlay only: the alarm colour (unread, overdue). */
  readonly alert = input(false, { transform: booleanAttribute });
}
