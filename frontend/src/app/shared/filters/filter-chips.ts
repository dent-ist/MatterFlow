import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FilterChip } from './filter-def';
import { ListFilters } from './list-filters';
import { restoreSummary } from './restore-summary';

/**
 * Compact removable chips for the active filters (docs/ux/column-filters-review.md 4.5): one chip per active value ("Priority:
 * Critical") with a remove button named "Remove filter Priority: Critical". The bar shows them while the filter row is closed (or the
 * sheet is in use) and, whatever the row does, for a filter on a hidden column or without a column. One line: beyond `max` chips a
 * "+N more" button shows the rest.
 */
@Component({
  selector: 'mf-filter-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown().length > 0) {
      <ul class="fch" aria-label="Active filters" data-filter-chips>
        @for (c of visible(); track c.id) {
          <li class="fch__chip" [attr.data-chip]="c.defKey" [attr.data-chip-id]="c.id">
            <span class="fch__text">
              {{ c.label }}
              @if (c.hiddenColumn) {
                <span class="fch__hidden">(hidden column)</span>
              }
            </span>
            @if (c.hiddenColumn && c.column) {
              <button
                type="button"
                class="fch__act"
                [attr.aria-label]="'Show column for ' + c.label"
                (click)="showColumn.emit(c.column)"
              >
                Show column
              </button>
            }
            <button
              type="button"
              class="fch__x"
              [attr.aria-label]="'Remove filter ' + c.label"
              (click)="remove(c)"
            >
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </li>
        }
        @if (hiddenCount() > 0) {
          <li>
            <button
              type="button"
              class="fch__more"
              [attr.aria-expanded]="expanded()"
              (click)="expanded.set(!expanded())"
            >
              {{ expanded() ? 'Show fewer' : '+' + hiddenCount() + ' more' }}
            </button>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    .fch {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1);
      min-width: 0;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .fch__chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      max-width: 100%;
      min-height: 24px;
      padding: 0 var(--mf-s1) 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
      background: var(--mf-surface);
      font-size: var(--mf-fs-sm);
    }
    .fch__text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .fch__hidden {
      color: var(--mf-text-muted);
    }
    .fch__x,
    .fch__act,
    .fch__more {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      min-height: 24px;
      padding: 0;
      border: 0;
      border-radius: var(--mf-radius);
      background: transparent;
      color: var(--mf-link);
      font: inherit;
      font-size: var(--mf-fs-sm);
      cursor: pointer;
    }
    .fch__x {
      color: var(--mf-text-muted);
    }
    .fch__x:hover {
      background: var(--mf-surface-alt);
      color: var(--mf-text);
    }
    .fch__x .pi {
      font-size: 0.625rem;
    }
    .fch__act,
    .fch__more {
      padding: 0 var(--mf-s1);
      text-decoration: underline;
    }
    @media print {
      :host {
        display: none;
      }
    }
  `,
})
export class FilterChips {
  readonly filters = input.required<ListFilters>();
  /** 'all': every active filter; 'hidden': only filters whose column is not on screen (or that have no column). */
  readonly mode = input<'all' | 'hidden'>('all');
  /** Chips shown before "+N more". */
  readonly max = input(5);
  /** The user wants the column of a hidden-column filter back; the page owns the column chooser. */
  readonly showColumn = output<string>();

  protected readonly expanded = signal(false);
  protected readonly shown = computed(() =>
    this.mode() === 'all' ? this.filters().chips() : this.filters().hiddenChips(),
  );
  protected readonly visible = computed(() =>
    this.expanded() ? this.shown() : this.shown().slice(0, this.max()),
  );
  protected readonly hiddenCount = computed(() => Math.max(0, this.shown().length - this.max()));

  protected remove(chip: FilterChip): void {
    this.filters().removeChip(chip);
  }
}

/** "Restored your last view" notice with a Reset to default action (a plain link that applied a remembered view must say so). */
@Component({
  selector: 'mf-filter-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (filters().restored()) {
      <p class="fn" role="status" data-restored-notice>
        <i class="pi pi-history" aria-hidden="true"></i>
        <span data-restored-text>{{ text() }}</span>
        @if (!filters().noticeMessage()) {
          <button type="button" class="mf-btn mf-btn--text" (click)="filters().resetToDefault()">
            Reset to default
          </button>
        }
        <button
          type="button"
          class="mf-btn mf-btn--text"
          aria-label="Dismiss notice"
          (click)="filters().dismissRestored()"
        >
          Dismiss
        </button>
      </p>
    }
  `,
  styles: `
    .fn {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s2);
      padding: var(--mf-s1) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
      font-size: var(--mf-fs-sm);
    }
    @media print {
      .fn {
        display: none;
      }
    }
  `,
})
export class FilterNotice {
  readonly filters = input.required<ListFilters>();
  protected readonly text = computed(
    () =>
      this.filters().noticeMessage() ??
      restoreSummary(
        this.filters().restoredTab(),
        this.filters().chips(),
        this.filters().viewName(),
      ),
  );
}
