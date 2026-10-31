import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface FilterChip {
  key: string;
  label: string;
  /** The number of rows the chip gives; shown after the label and read in its name. */
  count?: number | null;
  /** A PrimeIcons class drawn before the label (optional). */
  icon?: string;
  /** A chip that cannot give anything is disabled when it has a zero count and is not the chosen one. */
  hidden?: boolean;
}

/**
 * A row of toggle chips with counts (`mf-filter-chips`, epic #953 UI-10): the status row and the activity kinds. One chip is chosen at a time (`aria-pressed`, a ticked outline
 * as well as the fill, so colour is not the only signal); choosing the chosen chip again returns `emptyKey` when it is set (the kinds clear that way), otherwise it keeps it.
 * Each chip is a 32 px target on a desktop and 44 px on a phone. The row is a labelled group, not a menu: Tab moves between chips, Space and Enter choose.
 */
@Component({
  selector: 'mf-filter-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row" role="group" [attr.aria-label]="label()">
      @for (c of chips(); track c.key) {
        @if (!c.hidden) {
          <button
            type="button"
            class="chip"
            [attr.aria-pressed]="c.key === value()"
            [attr.data-key]="c.key"
            (click)="pick(c.key)"
          >
            @if (c.key === value()) {
              <i class="pi pi-check tick" aria-hidden="true"></i>
            } @else if (c.icon) {
              <i class="pi ico" [class]="c.icon" aria-hidden="true"></i>
            }
            <span>{{ c.label }}</span>
            @if ((c.count ?? -1) >= 0) {
              <span class="n">{{ c.count }}</span>
            }
          </button>
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s2);
      min-width: 0;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 32px;
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
    }
    .chip:hover {
      background: var(--mf-surface-alt);
    }
    .chip .n {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-variant-numeric: tabular-nums;
    }
    .chip .tick,
    .chip .ico {
      font-size: var(--mf-fs-xs);
    }
    .chip[aria-pressed='true'] {
      background: var(--mf-primary);
      border-color: var(--mf-primary);
      color: var(--mf-primary-contrast);
    }
    .chip[aria-pressed='true'] .n {
      color: inherit;
    }
    @media (max-width: 767.98px) {
      .chip {
        min-height: 44px;
      }
    }
  `,
})
export class FilterChips {
  readonly chips = input.required<readonly FilterChip[]>();
  readonly value = input<string | null>(null);
  readonly label = input('Filter');
  /** What choosing the chosen chip again returns (null = keep it chosen). */
  readonly emptyKey = input<string | null>(null);
  readonly valueChange = output<string>();

  protected pick(key: string): void {
    const empty = this.emptyKey();
    this.valueChange.emit(key === this.value() && empty != null ? empty : key);
  }
}
