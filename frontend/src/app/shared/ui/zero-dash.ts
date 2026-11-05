import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A zero in an Overdue, Due Soon (At risk) or On Hold column (D-42, #1152): a muted dash "-" for the eye, "0" for a screen reader. Other zeros
 * (Open Tasks, Linked, Notes) stay "0". Put it where the count would be, only when the count is 0:
 *
 *   @if (m.onHoldTaskCount > 0) { <a>{{ m.onHoldTaskCount }}</a> } @else { <mf-zero-dash /> }
 */
@Component({
  selector: 'mf-zero-dash',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="zd" aria-hidden="true" data-zero-dash>-</span
    ><span class="mf-sr-only">0</span>`,
  styles: `
    .zd {
      color: var(--mf-text-muted);
    }
  `,
})
export class ZeroDash {}
