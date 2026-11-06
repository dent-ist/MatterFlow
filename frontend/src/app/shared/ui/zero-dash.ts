import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A zero in an Overdue, Due Soon (At risk) or On Hold column (D-42, #1152): a muted dash "-" for the eye, "0" for a screen reader. Other zeros
 * (Open Tasks, Linked, Notes) stay "0". Put it where the count would be, only when the count is 0:
 *
 * A dash that is not a count says what is missing: `<mf-zero-dash srText="No project" />`.
 *
 *   @if (m.onHoldTaskCount > 0) { <a>{{ m.onHoldTaskCount }}</a> } @else { <mf-zero-dash /> }
 */
@Component({
  selector: 'mf-zero-dash',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="zd" aria-hidden="true" data-zero-dash>-</span
    ><span class="mf-sr-only">{{ srText() }}</span>`,
  styles: `
    .zd {
      color: var(--mf-text-muted);
    }
  `,
})
export class ZeroDash {
  /** What a screen reader says instead of the dash: "0" for a count, or a name such as "No project" where the dash stands for a missing value. */
  readonly srText = input('0');
}
