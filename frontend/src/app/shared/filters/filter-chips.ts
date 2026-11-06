import { TagChip } from '../ui/tag-chip';
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
  imports: [TagChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown().length > 0) {
      <ul class="fch" aria-label="Active filters" data-filter-chips>
        @for (c of visible(); track c.id) {
          <li [attr.data-chip]="c.defKey" [attr.data-chip-id]="c.id">
            <mf-tag-chip
              [removable]="true"
              [removeLabel]="'Remove filter ' + c.label"
              (remove)="remove(c)"
            >
              {{ c.label }}
              @if (c.hiddenColumn) {
                <span class="fch__hidden">(hidden column)</span>
              }
            </mf-tag-chip>
            @if (c.hiddenColumn && c.column) {
              <button
                type="button"
                class="mf-btn mf-btn--text fch__act"
                [attr.aria-label]="'Show column for ' + c.label"
                (click)="showColumn.emit(c.column)"
              >
                Show Column
              </button>
            }
          </li>
        }
        @if (hiddenCount() > 0) {
          <li>
            <button
              type="button"
              class="mf-btn mf-btn--text fch__more"
              [attr.aria-expanded]="expanded()"
              (click)="expanded.set(!expanded())"
            >
              {{ expanded() ? 'Show Fewer' : '+' + hiddenCount() + ' more' }}
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
    .fch > li {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
    }
    .fch__hidden {
      color: var(--mf-text-muted);
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
            Reset to Default
          </button>
        }
        <button
          type="button"
          class="fn__x"
          aria-label="Dismiss"
          data-dismiss-notice
          (click)="filters().dismissRestored()"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
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
    /* In row 2 of the stacked toolbar (#217) the bar owns the spacing and the notice takes the row's place. */
    :host-context(.fbar--row2) {
      display: block;
      flex: 1 1 auto;
      min-width: 0;
    }
    /* The same 32 px as a chip row with Clear filters, so the grid does not move when the notice is swapped for chips. */
    :host-context(.fbar--row2) .fn {
      box-sizing: border-box;
      min-height: 32px;
      margin: 0;
      padding-block: 0;
    }
    .fn__x {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      min-height: 24px;
      margin-left: auto;
      padding: 0;
      border: 0;
      border-radius: var(--mf-radius);
      background: transparent;
      color: var(--mf-text-muted);
      cursor: pointer;
    }
    .fn__x:hover {
      background: var(--mf-surface-alt);
      color: var(--mf-text);
    }
    .fn__x .pi {
      font-size: var(--mf-icon-xs);
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
