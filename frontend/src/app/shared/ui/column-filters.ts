import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { SEARCH_DEBOUNCE_MS } from './search-box';

/**
 * Inline column filters of a grid (product-owner request for Assets): one compact control under each filterable column header, in a
 * second header row (`tr.mf-filter-row`, see `styles/_fixed-page.scss`), shown or hidden by the Filters toggle above the grid.
 *
 *   <tr class="mf-filter-row">
 *     <td><mf-column-text-filter label="Name" [value]="name()" (valueChange)="setName($event)" /></td>
 *     <td><mf-column-select-filter label="Type" [options]="typeOptions()" [value]="typeId()" (valueChange)="..." /></td>
 *   </tr>
 */

/** A text filter: 32 px input labelled "Filter by <column>", live after a 300 ms pause, immediately on Enter, with a clear (x) button. */
@Component({
  selector: 'mf-column-text-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cf">
      <input
        class="mf-control mf-control--compact cf__input"
        type="text"
        autocomplete="off"
        spellcheck="false"
        [attr.placeholder]="placeholder() || label()"
        [attr.maxlength]="maxlength()"
        [attr.aria-label]="'Filter by ' + label()"
        [attr.data-filter]="key() || label()"
        [value]="draft()"
        (input)="onInput($any($event.target).value)"
        (keydown.enter)="$event.preventDefault(); commit($any($event.target).value)"
        (keydown.escape)="onEscape($event)"
      />
      @if (draft()) {
        <button
          type="button"
          class="cf__clear"
          [attr.aria-label]="'Clear ' + label() + ' filter'"
          (click)="clear()"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .cf {
      position: relative;
      display: flex;
    }
    .cf__input {
      width: 100%;
      min-width: 0;
      padding-right: 28px;
      font-weight: 400;
      /* A narrow column cuts the placeholder with an ellipsis; it never wraps or overflows the cell (#228). */
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cf__input::placeholder {
      color: var(--mf-text-muted);
    }
    .cf__clear {
      position: absolute;
      top: 50%;
      right: 2px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      transform: translateY(-50%);
      border: 0;
      border-radius: var(--mf-radius);
      background: transparent;
      color: var(--mf-text-muted);
      cursor: pointer;
    }
    .cf__clear:hover {
      background: var(--mf-surface-alt);
      color: var(--mf-text);
    }
    .cf__clear .pi {
      font-size: 0.75rem;
    }
  `,
})
export class ColumnTextFilter {
  /** The column name; the control is named "Filter by <label>". */
  readonly label = input.required<string>();
  /** Stable key for tests (`data-filter`); defaults to the label. */
  readonly key = input('');
  /** What the empty box says ("Title or ref"); defaults to the column name. The accessible name stays "Filter by <label>". */
  readonly placeholder = input('');
  /** The committed text (from the URL); the control keeps its own draft while typing. */
  readonly value = input('');
  readonly maxlength = input(200);
  /** The trimmed text to filter by (empty when cleared). Never twice for the same text. */
  readonly valueChange = output<string>();

  protected readonly draft = signal('');
  private last = '';
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    // A change of the committed value from outside (Clear filters, Back button) replaces the draft.
    effect(() => {
      const committed = this.value() ?? '';
      untracked(() => {
        if (committed.trim() !== this.draft().trim()) this.draft.set(committed);
        this.last = committed.trim();
      });
    });
  }

  protected onInput(text: string): void {
    this.draft.set(text);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(text), SEARCH_DEBOUNCE_MS);
  }

  protected commit(text: string): void {
    clearTimeout(this.timer);
    const trimmed = text.trim();
    if (trimmed === this.last) return;
    this.last = trimmed;
    this.valueChange.emit(trimmed);
  }

  protected clear(): void {
    this.draft.set('');
    this.commit('');
  }

  /** Esc clears a filled box (and stops there); an empty box lets Esc through to the page. */
  protected onEscape(event: Event): void {
    if (!this.draft()) return;
    event.stopPropagation();
    this.clear();
  }
}

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

/** A select filter: 32 px native select labelled "Filter by <column>"; the first option is the "no filter" choice. */
@Component({
  selector: 'mf-column-select-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <select
      class="mf-control mf-control--compact cf__select"
      [attr.aria-label]="'Filter by ' + label()"
      [attr.data-filter]="key() || label()"
      (change)="valueChange.emit($any($event.target).value)"
    >
      @for (o of options(); track o.value) {
        <option [value]="o.value" [selected]="o.value === value()">{{ o.label }}</option>
      }
    </select>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .cf__select {
      width: 100%;
      min-width: 0;
      font-weight: 400;
      /* The arrow of a native select takes room of its own: tight side padding keeps the widest choice ("Out of office") whole in a
         narrow column instead of clipping it. */
      padding-inline: var(--mf-s1);
    }
  `,
})
export class ColumnSelectFilter {
  readonly label = input.required<string>();
  readonly key = input('');
  readonly options = input.required<readonly FilterOption[]>();
  readonly value = input('');
  readonly valueChange = output<string>();
}

/**
 * The Filters button above a grid (at its right end, like Columns on the work lists): a filter icon, the name "Filters" and the number of
 * active filters. It is a toggle (`aria-pressed` and `aria-expanded`) for the filter row; the tooltip says "Show filters" / "Hide filters".
 */
@Component({
  selector: 'mf-filters-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="mf-btn ft"
      [attr.aria-pressed]="open()"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="controls() || null"
      [attr.aria-haspopup]="sheet() ? 'dialog' : null"
      [title]="open() ? 'Hide filters' : 'Show filters'"
      data-filters-toggle
      (click)="toggled.emit()"
    >
      <i class="pi pi-filter" aria-hidden="true"></i>
      Filters
      @if (count() > 0) {
        <span class="ft__count" data-filter-count>({{ count() }})</span>
      }
    </button>
  `,
  styles: `
    .ft[aria-pressed='true'] {
      border-color: var(--mf-primary);
      background: var(--mf-selected-bg);
    }
    .ft__count {
      font-weight: 400;
    }
  `,
})
export class FiltersToggle {
  readonly open = input(false);
  /** Number of active filters. */
  readonly count = input(0);
  /** Id of the filter row the button shows and hides. */
  readonly controls = input('');
  /** The controls open in a sheet (dialog) instead of the filter row. */
  readonly sheet = input(false);
  readonly toggled = output<void>();
}

/** Remembers a per-user boolean in `localStorage`; storage that is missing or blocked just means "not remembered". */
export function readFlag(key: string, fallback = false): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

export function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Not persisted (private window or blocked storage).
  }
}
