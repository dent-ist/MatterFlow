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

/** One entry of a list's own sort select (the record lists, WP12): the API sort key, its words, and whether the first pick is descending (counts). */
export interface SortOption {
  value: string;
  label: string;
  descFirst?: boolean;
}

/**
 * The sort of a work list on a phone (#192): the cards have no column headers, so the order is chosen here, in the Filters sheet, with the
 * same `sort` and `dir` parameters as the headers. "Default order" is the list's own rule (named under the select), a field plus a direction is a
 * header sort, and where the list can be grouped (My Work, Active) a Group by choice sits with it. 44 px controls.
 * The record lists (Clients, Matters, Projects, WP12) pass their own `options` and the `defaultField` the list opens sorted by: there is no
 * "Default order" entry then (the default is one of the options) and the direction always shows.
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
          [value]="current()"
          (change)="pickField($any($event.target).value)"
        >
          @if (!defaultField()) {
            <option value="" [selected]="!sort()">Default order ({{ defaultLabel() }})</option>
          }
          @for (f of fields(); track f.value) {
            <option [value]="f.value" [selected]="f.value === current()">{{ f.label }}</option>
          }
        </select>
      </div>
      @if (current()) {
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
  /** The list's own sorts (null: the sortable columns of the work grids). */
  readonly options = input<readonly SortOption[] | null>(null);
  /** The sort field the list opens with when the address has none; set, the "Default order" entry is not offered. */
  readonly defaultField = input<string | null>(null);
  /** The full default rule, shown under the select while the default order is on. */
  readonly defaultOrder = input<string | null>(null);
  readonly groupable = input(false);
  readonly grouped = input(false);

  readonly sortPick = output<SortChoice | null>();
  readonly groupChange = output<'due' | null>();

  protected readonly uid = `mf-ps-${nextId++}`;
  protected readonly fields = computed<readonly SortOption[]>(
    () =>
      this.options() ?? PHONE_SORTS.map((value) => ({ value, label: SORT_LABELS[value] ?? value })),
  );
  /** The field the select shows: the address's, else the list's default one. */
  protected readonly current = computed(() => this.sort() || this.defaultField() || '');
  protected readonly direction = computed<SortDirection>(
    () => this.dir() ?? (this.descFirst(this.current()) ? 'desc' : 'asc'),
  );

  private descFirst(field: string): boolean {
    const own = this.options()?.find((o) => o.value === field);
    return own ? !!own.descFirst : DESC_FIRST.has(field);
  }

  protected pickField(field: string): void {
    this.sortPick.emit(field ? { field, dir: this.descFirst(field) ? 'desc' : 'asc' } : null);
  }

  protected pickDir(dir: string): void {
    const field = this.current();
    if (field) this.sortPick.emit({ field, dir: dir === 'desc' ? 'desc' : 'asc' });
  }
}
