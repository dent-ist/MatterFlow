import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PhoneSort, SortChoice, SortOption } from '../work-queue/phone-sort';

/** `-openTasks` to field and direction (the `sort` of the address has the direction as a leading minus). */
export function parseSortExpression(
  expression: string | null | undefined,
): { field: string; dir: 'asc' | 'desc' } | null {
  const first = (expression ?? '').split(',')[0].trim();
  if (!first) return null;
  return first.startsWith('-')
    ? { field: first.slice(1), dir: 'desc' }
    : { field: first, dir: 'asc' };
}

/** A pick of the Sort by select as the `sort` of the address; the list's default order (ascending) is no `sort` at all (null). */
export function sortExpression(choice: SortChoice | null, defaultSort: string): string | null {
  if (!choice) return null;
  if (choice.field === defaultSort && choice.dir === 'asc') return null;
  return choice.dir === 'desc' ? `-${choice.field}` : choice.field;
}

/**
 * The sort of a record list on a phone (WP12): the cards have no column headers, so the Filters sheet carries a Sort by select with the same
 * `sort` values as the headers (`name`, `-openTasks`). It is `mf-phone-sort` with the list's own options and the list's default sort
 * as one of them. Counts sort descending on the first pick, like their headers.
 *
 *   <mf-filters-bar ...>
 *     <mf-record-sort mfSheetSort [options]="sortOptions" [sort]="sort()" defaultSort="clientNumber" (sorted)="pickSort($event)" />
 *   </mf-filters-bar>
 */
@Component({
  selector: 'mf-record-sort',
  imports: [PhoneSort],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-phone-sort
      [options]="options()"
      [defaultField]="defaultSort()"
      [sort]="parsed()?.field ?? null"
      [dir]="parsed()?.dir ?? null"
      (sortPick)="sorted.emit(expression($event))"
    />
  `,
})
export class RecordSort {
  readonly options = input.required<readonly SortOption[]>();
  /** The `sort` of the address (empty: the default order). */
  readonly sort = input<string | null | undefined>(null);
  /** The sort field the list opens with. */
  readonly defaultSort = input.required<string>();
  /** The new `sort` for the address (null: back to the default order). */
  readonly sorted = output<string | null>();

  protected readonly parsed = computed(() => parseSortExpression(this.sort()));

  protected expression(choice: SortChoice | null): string | null {
    return sortExpression(choice, this.defaultSort());
  }
}
