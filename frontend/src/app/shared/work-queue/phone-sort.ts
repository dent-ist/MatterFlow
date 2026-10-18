import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { SortDirection } from './queue-filters';
import { DESC_FIRST, SORT_LABELS } from './sort-note';

let nextId = 0;

/** The sorts the phone offers, in the order of the list: the sortable columns of the work grids (the same URL values as the headers). */
export const PHONE_SORTS: readonly string[] = [
  'priority',
  'priorityAge',
  'due',
  'created',
  'number',
  'status',
  'title',
  'matter',
  'client',
  'assignee',
  'closed',
  'updated',
  'age',
];

export interface SortChoice {
  field: string;
  dir: SortDirection;
}

/**
 * The sort of a work list on a phone (#192): the cards have no column headers, so the order is chosen here, in the Filters sheet, with the
 * same `sort` and `dir` parameters as the headers. "Default order" is the list's own rule (named under the select), a field plus a direction is a
 * header sort, and where the list can be grouped (My Work, Active) a Group by choice sits with it. 44 px controls.
 */
@Component({
  selector: 'mf-phone-sort',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './phone-sort.scss',
  template: `
    <div class="ps" data-phone-sort>
      <div class="ps-field">
        <label [for]="uid + '-sort'">Sort by</label>
        <select
          class="mf-control"
          [id]="uid + '-sort'"
          data-sort-select
          [value]="sort() ?? ''"
          (change)="pickField($any($event.target).value)"
        >
          <option value="" [selected]="!sort()">Default order ({{ defaultLabel() }})</option>
          @for (f of fields; track f) {
            <option [value]="f" [selected]="f === sort()">{{ label(f) }}</option>
          }
        </select>
      </div>
      @if (sort()) {
        <div class="ps-field">
          <label [for]="uid + '-dir'">Direction</label>
          <select
            class="mf-control"
            [id]="uid + '-dir'"
            data-dir-select
            [value]="direction()"
            (change)="pickDir($any($event.target).value)"
          >
            <option value="asc" [selected]="direction() === 'asc'">Ascending</option>
            <option value="desc" [selected]="direction() === 'desc'">Descending</option>
          </select>
        </div>
      } @else if (defaultOrder()) {
        <p class="ps-note" data-sort-rule>
          {{ grouped() ? 'Grouped by due date, most urgent group first.' : defaultOrder() }}
        </p>
      }
      @if (groupable()) {
        <div class="ps-field">
          <label [for]="uid + '-group'">Group by</label>
          <select
            class="mf-control"
            [id]="uid + '-group'"
            data-group-select
            [value]="grouped() ? 'due' : ''"
            (change)="groupChange.emit($any($event.target).value === 'due' ? 'due' : null)"
          >
            <option value="" [selected]="!grouped()">None</option>
            <option value="due" [selected]="grouped()">Due</option>
          </select>
        </div>
      }
    </div>
  `,
})
export class PhoneSort {
  /** The sort in the address (null: the default order). */
  readonly sort = input<string | null>(null);
  readonly dir = input<SortDirection | null>(null);
  readonly defaultLabel = input('Priority');
  /** The full default rule, shown under the select while the default order is on. */
  readonly defaultOrder = input<string | null>(null);
  readonly groupable = input(false);
  readonly grouped = input(false);

  readonly sortPick = output<SortChoice | null>();
  readonly groupChange = output<'due' | null>();

  protected readonly uid = `mf-ps-${nextId++}`;
  protected readonly fields = PHONE_SORTS;
  protected readonly direction = computed<SortDirection>(
    () => this.dir() ?? (DESC_FIRST.has(this.sort() ?? '') ? 'desc' : 'asc'),
  );

  protected label(field: string): string {
    return SORT_LABELS[field] ?? field;
  }

  protected pickField(field: string): void {
    this.sortPick.emit(field ? { field, dir: DESC_FIRST.has(field) ? 'desc' : 'asc' } : null);
  }

  protected pickDir(dir: string): void {
    const field = this.sort();
    if (field) this.sortPick.emit({ field, dir: dir === 'desc' ? 'desc' : 'asc' });
  }
}
