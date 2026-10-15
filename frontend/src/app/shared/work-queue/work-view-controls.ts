import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { ColumnChooser } from './column-chooser';
import { Density } from './column-prefs';
import { SortDirection } from './queue-filters';

const SORT_LABELS: Readonly<Record<string, string>> = {
  priority: 'Priority',
  due: 'Due date',
  created: 'Created',
  number: 'Ref',
  status: 'Status',
  completed: 'Closed',
};

/**
 * The right end of the work toolbar: a short "Sorted by Priority" note with the sort direction, an info button that opens the full
 * default rule (keyboard accessible, Escape closes), "Reset sort" while a header sort is active, and the Columns chooser.
 */
@Component({
  selector: 'mf-work-view-controls',
  imports: [ColumnChooser],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './work-view-controls.scss',
  template: `
    <div class="vc-sort" data-sort-note>
      @if (sort(); as s) {
        <span class="vc-label"
          >Sorted by {{ sortLabel() }}
          <i class="pi" [class]="dirIcon()" aria-hidden="true"></i>
          <span class="vc-sr">({{ dir() === 'desc' ? 'descending' : 'ascending' }})</span>
        </span>
        <button type="button" class="mf-btn mf-btn--text" (click)="resetSort.emit()">
          Reset sort
        </button>
      } @else {
        <span class="vc-label"
          >Sorted by {{ defaultLabel() }}
          <i class="pi pi-sort-amount-up-alt" aria-hidden="true"></i>
        </span>
        <button
          type="button"
          class="vc-info"
          aria-label="How the default order works"
          aria-controls="vc-rule"
          [attr.aria-expanded]="info()"
          (click)="info.set(!info())"
          (keydown.escape)="info.set(false)"
        >
          <i class="pi pi-info-circle" aria-hidden="true"></i>
        </button>
        @if (info()) {
          <p id="vc-rule" class="vc-rule" role="note" data-sort-rule>
            {{ defaultOrder() }}. Choosing a column header sorts by it and replaces this order.
          </p>
        }
      }
    </div>
    <mf-column-chooser
      [columns]="columns()"
      [density]="density()"
      (columnsChange)="columnsChange.emit($event)"
      (densityChange)="densityChange.emit($event)"
    />
  `,
})
export class WorkViewControls {
  readonly sort = input<string | null>(null);
  readonly dir = input<SortDirection | null>(null);
  /** The full default rule, for the info popover. */
  readonly defaultOrder = input('Default order: Priority, ASAP first, Due date, Oldest');
  /** The short name of the default sort column ("Priority"). */
  readonly defaultLabel = input('Priority');
  readonly columns = input.required<readonly string[]>();
  readonly density = input<Density>('comfortable');

  readonly resetSort = output<void>();
  readonly columnsChange = output<string[]>();
  readonly densityChange = output<Density>();

  protected readonly info = signal(false);
  protected readonly sortLabel = computed(() => SORT_LABELS[this.sort() ?? ''] ?? this.sort());
  protected readonly dirIcon = computed(() => {
    const desc =
      (this.dir() ??
        (this.sort() === 'created' || this.sort() === 'completed' ? 'desc' : 'asc')) === 'desc';
    return desc ? 'pi-sort-amount-down' : 'pi-sort-amount-up-alt';
  });
}
