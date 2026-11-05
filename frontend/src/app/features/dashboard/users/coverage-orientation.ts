import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Segmented } from '../../../shared/ui/segmented';
import { Orientation } from './coverage-model';

/** "By task type | Matrix": the shared segmented switch with two text buttons (`aria-pressed`), first in the Coverage toolbar (WP11, #134). */
@Component({
  selector: 'mf-coverage-orientation',
  imports: [Segmented],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div mfSegmented role="group" aria-label="Coverage orientation" data-coverage-orientation>
      @for (o of orientations; track o.key) {
        <button
          type="button"
          class="mf-btn"
          [attr.data-orientation]="o.key"
          [attr.aria-pressed]="value() === o.key"
          (click)="valueChange.emit(o.key)"
        >
          {{ o.label }}
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: inline-block;
    }
  `,
})
export class CoverageOrientation {
  readonly value = input.required<Orientation>();
  readonly valueChange = output<Orientation>();

  protected readonly orientations: { key: Orientation; label: string }[] = [
    { key: 'type', label: 'By Task Type' },
    { key: 'matrix', label: 'Matrix' },
  ];
}
