import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface FilterChip {
  key: string;
  label: string;
  /** The number of rows the chip gives; shown after the label and read in its name. */
  count?: number | null;
  /** A PrimeIcons class drawn before the label (optional). */
  icon?: string;
  /** Tooltip: what the number counts. */
  hint?: string;
  /** Tinted (the risk colours) while the count is above zero and the chip is not chosen: somebody is waiting (Users: Pending access). */
  tinted?: boolean;
  /** Red text while the count is above zero (an alert count such as Overdue). */
  alert?: boolean;
  /** A plain count with no filter behind it: drawn as text, not as a button. */
  inert?: boolean;
  /** A chip that cannot give anything is disabled when it has a zero count and is not the chosen one. */
  hidden?: boolean;
}

/**
 * A row of toggle chips with counts (`mf-filter-chips`, epic #953 UI-10): the status row and the activity kinds. One chip is chosen at a time (`aria-pressed`, a ticked outline
 * as well as the fill, so colour is not the only signal); choosing the chosen chip again returns `emptyKey` when it is set (the kinds clear that way), otherwise it keeps it.
 * Each chip is 26 px high (`--mf-chip-h`) on a desktop and a 44 px target on a phone. The row is a labelled group, not a menu: Tab moves between chips, Space and Enter choose.
 */
@Component({
  selector: 'mf-filter-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="row"
      role="group"
      [attr.aria-label]="label()"
      [attr.data-strip]="strip() ? '' : null"
    >
      @for (c of chips(); track c.key) {
        @if (!c.hidden && c.inert) {
          <span
            class="chip chip--inert"
            [attr.data-strip-item]="strip() ? c.key : null"
            [attr.title]="c.hint ?? null"
          >
            <span>{{ c.label }}</span>
            {{ ' ' }}
            @if (c.count === null && strip()) {
              <span class="n">--</span>
            } @else if ((c.count ?? -1) >= 0) {
              <span class="n">{{ c.count }}</span>
            }
          </span>
        } @else if (!c.hidden) {
          <button
            type="button"
            class="chip"
            [class.tinted]="c.tinted && (c.count ?? 0) > 0"
            [class.alert]="c.alert && (c.count ?? 0) > 0"
            [attr.aria-pressed]="c.key === value()"
            [attr.data-key]="c.key"
            [attr.data-strip-item]="strip() ? c.key : null"
            [attr.title]="c.hint ?? null"
            (click)="pick(c.key)"
          >
            @if (c.key === value()) {
              <i class="pi pi-check tick" aria-hidden="true"></i>
            } @else if (c.icon) {
              <i class="pi ico" [class]="c.icon" aria-hidden="true"></i>
            }
            <span>{{ c.label }}</span>
            {{ ' ' }}
            @if (c.count === null && strip()) {
              <span class="n">--</span>
            } @else if ((c.count ?? -1) >= 0) {
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
    /* Chip kind 3 (D-12, #1129): the shape of the status chip (26 px, 0 8, pill, 12 / 600); chosen = solid primary, white text, a tick; the count is bold at the end. */
    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      box-sizing: border-box;
      height: var(--mf-chip-h);
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-mid);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      font-size: var(--mf-fs-chip);
      font-weight: var(--mf-fw-semibold);
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
    }
    .chip:hover {
      background: var(--mf-surface-alt);
    }
    .chip.tinted[aria-pressed='false'] {
      border-color: var(--mf-sem-risk-line);
      background: var(--mf-sem-risk-bg);
      color: var(--mf-sem-risk-fg);
    }
    .chip.alert .n {
      color: var(--mf-sem-overdue-fg);
    }
    /* A plain count with no filter behind it is text, not a fifth chip kind. */
    .chip--inert {
      padding: 0;
      border-color: transparent;
      background: transparent;
      color: var(--mf-text-muted);
      cursor: default;
    }
    .chip--inert:hover {
      background: transparent;
    }
    .chip .n {
      color: inherit;
      font-weight: var(--mf-fw-bold);
      font-variant-numeric: tabular-nums;
    }
    .chip--inert .n {
      color: var(--mf-text);
    }
    .chip .tick,
    .chip .ico {
      flex: none;
      font-size: var(--mf-icon-sm);
    }
    .chip[aria-pressed='true'] {
      background: var(--mf-primary);
      border-color: var(--mf-primary);
      color: var(--mf-primary-contrast);
    }
    .chip[aria-pressed='true'] .n {
      color: inherit;
    }
    @container gc (max-width: 759px) {
      .ico {
        display: none;
      }
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
  /** The row is the summary strip of a list (admin lists, Users): its chips also carry `data-strip` and `data-strip-item` (the hooks the strip always had). */
  readonly strip = input(false);
  /** What choosing the chosen chip again returns (null = keep it chosen). */
  readonly emptyKey = input<string | null>(null);
  readonly valueChange = output<string>();

  protected pick(key: string): void {
    const empty = this.emptyKey();
    this.valueChange.emit(key === this.value() && empty != null ? empty : key);
  }
}
