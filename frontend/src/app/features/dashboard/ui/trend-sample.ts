import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LineStyle, isHollow, markerPath } from '../../../shared/charts/chart-palette';

/** A short sample of a line (its colour, dash pattern and marker) for the legend, the tooltip and the table header. Decorative. */
@Component({
  selector: 'mf-trend-sample',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg width="30" height="12" viewBox="0 0 30 12" aria-hidden="true" focusable="false">
      <line
        x1="1"
        y1="6"
        x2="29"
        y2="6"
        fill="none"
        stroke-width="2.5"
        stroke-linecap="round"
        [attr.stroke]="style().color"
        [attr.stroke-dasharray]="style().dash || null"
      />
      <path
        [attr.d]="path()"
        stroke-width="2"
        stroke-linejoin="round"
        [attr.stroke]="style().color"
        [attr.fill]="hollow() ? 'var(--mf-surface)' : style().color"
      />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      line-height: 0;
    }
  `,
})
export class TrendSample {
  readonly style = input.required<LineStyle>();
  protected readonly path = computed(() => markerPath(this.style().marker, 15, 6, 3));
  protected readonly hollow = computed(() => isHollow(this.style().marker));
}
