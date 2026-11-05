import { computed, signal } from '@angular/core';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from './list-query';

/**
 * Paging of a list that is already in memory (the small Administration lists: Priorities, Status Labels, On-Hold Reasons, Note Tags,
 * Asset Link Roles, Custom Fields; D-42, #1152): the same `mf-pager` as every other list, 25 / 50 / 100 rows with 50 the default.
 *
 *   readonly paging = new LocalPaging();
 *   @for (r of paging.slice(rows()); track r.id; let i = $index) { ... paging.offset() + i ... }
 *   <mf-pager [page]="paging.page()" [pageSize]="paging.size()" [pageSizes]="paging.sizes" [total]="rows().length"
 *     (pageChange)="paging.goTo($event)" (pageSizeChange)="paging.setSize($event)" />
 */
export class LocalPaging {
  readonly sizes = PAGE_SIZES;
  readonly page = signal(1);
  readonly size = signal<number>(DEFAULT_PAGE_SIZE);
  /** The index of the first row of the page in the whole list. */
  readonly offset = computed(() => (this.page() - 1) * this.size());

  /** The rows of the current page; a page past the end (after a delete) shows the last one. */
  slice<T>(rows: readonly T[]): T[] {
    const last = Math.max(1, Math.ceil(rows.length / this.size()));
    if (this.page() > last) this.page.set(last);
    const from = this.offset();
    return rows.slice(from, from + this.size());
  }

  goTo(page: number): void {
    this.page.set(Math.max(1, page));
  }

  setSize(size: number): void {
    this.size.set(size);
    this.page.set(1);
  }
}
