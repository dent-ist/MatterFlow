import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { OptionsMenu } from '../../../shared/ui/options-menu';

/** One thing a person can tick: a matter or an asset type. */
export interface PickOption {
  id: number;
  label: string;
  /** A small second line (the client of a matter). */
  hint?: string;
}

/**
 * A multi-select for the selection bar of the Data Area (epic #893, issue #931): a labelled button that says what is chosen ("All matters", "90001-80006 Employment",
 * "3 matters") and opens a small panel of check boxes under it. "All" is the first entry and means nothing narrowed; ticking anything else un-ticks it; un-ticking the last
 * one goes back to all. A search box narrows a long list; when the list is asked for from a server (`remote`) the box reports what was typed and the parent hands in the new
 * options. The chosen ones that are not among the options (they scrolled out of a search) stay listed first, so a choice never disappears from view. Never a shortcut (#420).
 */
@Component({
  selector: 'mf-data-pick',
  imports: [OptionsMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .dp__label {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    :host ::ng-deep .om__summary {
      max-width: 100%;
      box-sizing: border-box;
    }
    :host ::ng-deep .om__summary > span:not(.om__n) {
      min-width: 0;
      max-width: 15rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dp__search {
      width: 100%;
      box-sizing: border-box;
    }
    .dp__list {
      display: grid;
      gap: 0;
      max-height: 16rem;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    .dp__item {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 32px;
      padding: 0 var(--mf-s1);
      cursor: pointer;
    }
    .dp__item:hover {
      background: var(--mf-surface-alt);
    }
    .dp__item input {
      flex: none;
      width: 16px;
      height: 16px;
      margin: 0;
    }
    .dp__text {
      display: grid;
      min-width: 0;
    }
    .dp__hint,
    .dp__none {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .dp__none {
      margin: 0;
      padding: var(--mf-s1);
    }
    @media (max-width: 639.98px) {
      .dp__item {
        min-height: 44px;
      }
      /* A phone: the button is as wide as the Period select under it (issue #937), its chevron at the right like a select. */
      :host ::ng-deep mf-options-menu {
        display: block;
      }
      :host ::ng-deep .om__summary {
        display: flex;
        width: 100%;
      }
      :host ::ng-deep .om__summary > span:not(.om__n) {
        flex: 1 1 auto;
        max-width: none;
      }
      :host ::ng-deep .om__summary > i {
        order: 3;
      }
    }
  `,
  template: `
    <span class="dp__label">{{ label() }}</span>
    <mf-options-menu
      [label]="label()"
      [text]="summary()"
      [triggerName]="triggerName()"
      icon="pi-chevron-down"
      align="start"
      [wide]="wide()"
      (opened)="opened.emit()"
    >
      @if (searchable()) {
        <input
          type="search"
          class="mf-control mf-control--compact dp__search"
          [attr.aria-label]="'Search ' + many()"
          [value]="text()"
          (input)="typed($any($event.target).value)"
        />
      }
      <ul class="dp__list">
        <li>
          <label class="dp__item">
            <input
              type="checkbox"
              data-pick-all
              [checked]="selected().length === 0"
              (change)="clear()"
            />
            <span class="dp__text">{{ allText() }}</span>
          </label>
        </li>
        @for (o of shown(); track o.id) {
          <li>
            <label class="dp__item">
              <input
                type="checkbox"
                [attr.data-pick]="o.id"
                [checked]="selected().includes(o.id)"
                (change)="toggle(o.id)"
              />
              <span class="dp__text">
                <span>{{ o.label }}</span>
                @if (o.hint) {
                  <span class="dp__hint">{{ o.hint }}</span>
                }
              </span>
            </label>
          </li>
        }
      </ul>
      @if (shown().length === 0 && !loading()) {
        <p class="dp__none" data-pick-none>No {{ one() }} matches.</p>
      }
    </mf-options-menu>
  `,
})
export class DataPick {
  readonly label = input.required<string>();
  readonly options = input<readonly PickOption[]>([]);
  /** The ids that are ticked (empty: all). */
  readonly selected = input<readonly number[]>([]);
  /** Labels of the ticked ones, for those that are not among the options. */
  readonly chosen = input<readonly PickOption[]>([]);
  /** "All matters". */
  readonly allText = input.required<string>();
  /** "matter" and "matters": the summary of several ("3 matters"). */
  readonly one = input.required<string>();
  readonly many = input.required<string>();
  /** A search box is drawn above the list. */
  readonly searchable = input(false);
  /** The options come from a server for what was typed (no narrowing here). */
  readonly remote = input(false);
  readonly wide = input(false);
  readonly loading = input(false);

  readonly changed = output<number[]>();
  readonly query = output<string>();
  readonly opened = output<void>();

  protected readonly text = signal('');

  protected readonly summary = computed(() => {
    const ids = this.selected();
    if (ids.length === 0) return this.allText();
    if (ids.length === 1) {
      return this.labelOf(ids[0]);
    }
    return `${ids.length} ${this.many()}`;
  });

  protected readonly triggerName = computed(() => `${this.summary()}, choose ${this.many()}`);

  private labelOf(id: number): string {
    return (
      this.chosen().find((o) => o.id === id)?.label ??
      this.options().find((o) => o.id === id)?.label ??
      `${this.one()} ${id}`
    );
  }

  protected readonly shown = computed<PickOption[]>(() => {
    const selected = this.selected();
    const options = this.options();
    const pinned = this.chosen().filter(
      (c) => selected.includes(c.id) && !options.some((o) => o.id === c.id),
    );
    const typed = this.text().trim().toLowerCase();
    const narrowed =
      this.remote() || typed === ''
        ? [...options]
        : options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(typed));
    return [...pinned, ...narrowed];
  });

  protected toggle(id: number): void {
    const ids = this.selected();
    this.changed.emit(ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]);
  }

  protected clear(): void {
    this.changed.emit([]);
  }

  protected typed(value: string): void {
    this.text.set(value);
    if (this.remote()) this.query.emit(value);
  }
}
