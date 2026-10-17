import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Orientation } from './coverage-model';

/** "By task type | Matrix": two text toggle buttons in a group (`aria-pressed`), first in the Coverage toolbar (WP11, #134). */
@Component({
  selector: 'mf-coverage-orientation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="orient" role="group" aria-label="Coverage orientation" data-coverage-orientation>
      @for (o of orientations; track o.key) {
        <button
          type="button"
          class="seg"
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
    .orient {
      display: inline-flex;
      box-sizing: border-box;
      height: 32px;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      overflow: hidden;
      background: var(--mf-surface);
    }
    .seg {
      min-width: 5.5rem;
      padding: 0 var(--mf-s3);
      color: var(--mf-text);
      background: transparent;
      border: 0;
      font: inherit;
      font-size: var(--mf-fs-md);
      cursor: pointer;
    }
    .seg + .seg {
      border-left: 1px solid var(--mf-border-strong);
    }
    .seg:hover {
      background: var(--mf-surface-alt);
    }
    .seg[aria-pressed='true'] {
      color: var(--mf-primary);
      background: var(--mf-selected-bg);
      font-weight: 600;
      box-shadow: inset 0 -2px 0 var(--mf-primary);
    }
    .seg:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
  `,
})
export class CoverageOrientation {
  readonly value = input.required<Orientation>();
  readonly valueChange = output<Orientation>();

  protected readonly orientations: { key: Orientation; label: string }[] = [
    { key: 'type', label: 'By task type' },
    { key: 'matrix', label: 'Matrix' },
  ];
}
