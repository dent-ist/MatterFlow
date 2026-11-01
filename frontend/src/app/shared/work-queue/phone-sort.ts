import { Dropdown, DropdownItem } from '../ui/dropdown';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { SortDirection } from './queue-filters';
import { DESC_FIRST, SORT_LABELS } from './sort-note';
import { SortKind, directionWords } from './sort-sentences';

let nextId = 0;

/** The sorts the phone offers, in the order of the list: the sortable columns of the work grids (the same URL values as the headers). */
export const PHONE_SORTS: readonly string[] = [
  'priority',
  'priorityAge',
  'attention',
  'due',
  'created',
  'number',
  'status',
  'title',
  'matter',
  'matterName',
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
  /** What the field orders, for the words of its direction (a list's own fields; counts, which sort descending first, are read as counts). */
  kind?: SortKind;
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
  imports: [Dropdown],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './phone-sort.scss',
  template: `
    <div class="ps" data-phone-sort>
      <div class="ps-field">
        <span class="ps-lbl" aria-hidden="true">Sort by</span>
        <mf-dropdown
          [buttonId]="uid + '-sort'"
          data-sort-select
          label="Sort by"
          [items]="sortItems()"
          [value]="current()"
          [neutralValue]="null"
          [panelWidth]="260"
          (valueChange)="pickField($event)"
        />
      </div>
      @if (current()) {
        <div class="ps-field">
          <span class="ps-lbl" aria-hidden="true">Order</span>
          <mf-dropdown
            [buttonId]="uid + '-dir'"
            data-dir-select
            label="Order"
            [items]="dirItems()"
            [value]="direction()"
            [neutralValue]="null"
            (valueChange)="pickDir($event)"
          />
        </div>
      } @else if (defaultOrder()) {
        <p class="ps-note" data-sort-rule>
          {{ grouped() ? 'Grouped by due date, most urgent group first.' : defaultOrder() }}
        </p>
      }
      @if (groupable()) {
        <div class="ps-field">
          <span class="ps-lbl" aria-hidden="true">Group by</span>
          <mf-dropdown
            [buttonId]="uid + '-group'"
            data-group-select
            label="Group by"
            [items]="groupItems"
            [value]="grouped() ? 'due' : ''"
            [neutralValue]="null"
            (valueChange)="groupChange.emit($event === 'due' ? 'due' : null)"
          />
        </div>
      }
    </div>
  `,
})
export class PhoneSort {
  /** The sort in the address (null: the default order). */
  readonly sort = input<string | null>(null);
  readonly dir = input<SortDirection | null>(null);
  readonly defaultLabel = input('Priority, most urgent first');
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
  protected readonly sortItems = computed<DropdownItem[]>(() => [
    ...(this.defaultField()
      ? []
      : [{ value: '', label: `${this.defaultLabel()} (default order)` }]),
    ...this.fields().map((f) => ({ value: f.value, label: f.label })),
  ]);
  protected readonly dirItems = computed<DropdownItem[]>(() => [
    { value: 'asc', label: this.words('asc') },
    { value: 'desc', label: this.words('desc') },
  ]);
  protected readonly groupItems: DropdownItem[] = [
    { value: '', label: 'None' },
    { value: 'due', label: 'Due' },
  ];
  /** The field the select shows: the address's, else the list's default one. */
  protected readonly current = computed(() => this.sort() || this.defaultField() || '');
  protected readonly direction = computed<SortDirection>(
    () => this.dir() ?? (this.descFirst(this.current()) ? 'desc' : 'asc'),
  );

  /** The words of a direction for the sort shown ("Most urgent first", "A to Z"): the select says what comes first, not "Ascending" (issue #898). */
  protected words(dir: SortDirection): string {
    const own = this.options()?.find((o) => o.value === this.current());
    const text = directionWords(
      this.current(),
      dir,
      own?.kind ?? (own?.descFirst ? 'count' : undefined),
    );
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

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
