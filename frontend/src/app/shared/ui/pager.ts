import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

let nextId = 0;

/**
 * "Showing 101-150 of 442", "Page 3 of 9" and First, Previous, Next, Last (UX 5.2, #237). Page numbers are 1-based like the API. Disabled
 * buttons keep their place. Below 640 px it is one row (Previous, "Page 3 of 9", Next): the size select, the range and the edge buttons go.
 * From 640 px the facts (rows per page, range, note) and the controls ("Page 3 of 9" and the buttons): when both do not
 * fit on one line the controls wrap as a whole, so there are at most two rows and never a lone button (#280).
 */
@Component({
  selector: 'mf-pager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="mf-pager" aria-label="Pagination">
      @if (pageSizes().length > 0) {
        <label class="mf-pager__size" [for]="sizeId">
          Rows per page
          <select
            class="mf-control mf-control--compact"
            [id]="sizeId"
            [value]="pageSize()"
            (change)="pageSizeChange.emit(+$any($event.target).value)"
          >
            @for (n of pageSizes(); track n) {
              <option [value]="n" [selected]="n === pageSize()">{{ n }}</option>
            }
          </select>
        </label>
      }
      <span data-range>{{ range() }}</span>
      <div class="mf-pager__note"><ng-content select="[pager-note]" /></div>
      <div class="mf-pager__nav">
        <span class="mf-pager__page" data-page>Page {{ shownPage() }} of {{ pages() }}</span>
        @if (edges()) {
          <button
            type="button"
            class="mf-btn mf-pager__edge"
            [disabled]="page() <= 1"
            (click)="pageChange.emit(1)"
          >
            First
          </button>
        }
        <button
          type="button"
          class="mf-btn"
          [disabled]="page() <= 1"
          (click)="pageChange.emit(page() - 1)"
        >
          Previous
        </button>
        <button
          type="button"
          class="mf-btn"
          [disabled]="page() >= pages()"
          (click)="pageChange.emit(page() + 1)"
        >
          Next
        </button>
        @if (edges()) {
          <button
            type="button"
            class="mf-btn mf-pager__edge"
            [disabled]="page() >= pages()"
            (click)="pageChange.emit(pages())"
          >
            Last
          </button>
        }
      </div>
    </nav>
  `,
  styles: `
    .mf-pager {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mf-s2);
      padding: var(--mf-s2) 0;
      color: var(--mf-text-muted);
    }
    /* The facts (size, range, note) take the left, the controls the right; when they do not fit side by side the controls drop, as a whole,
       to a row of their own. The note may give up width (its text wraps) rather than make a third row. */
    .mf-pager__note {
      flex: 1 1 9rem;
      min-width: 0;
      max-width: max-content;
    }
    .mf-pager__note:empty {
      display: none;
    }
    .mf-pager__nav {
      display: flex;
      flex: none;
      align-items: center;
      gap: var(--mf-s2);
      margin-left: auto;
    }
    .mf-pager__size {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      margin-right: auto;
    }
    .mf-pager__page {
      white-space: nowrap;
    }
    @media (max-width: 639.98px) {
      .mf-pager {
        flex-wrap: nowrap;
        justify-content: space-between;
      }
      .mf-pager__nav,
      .mf-pager__note {
        display: contents;
      }
      .mf-pager__size,
      [data-range],
      .mf-pager__edge {
        display: none;
      }
      /* Touch targets on a phone (#192, #238). */
      .mf-btn {
        min-width: 44px;
        min-height: 44px;
      }
    }
  `,
})
export class Pager {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  /** Page sizes to offer ("Rows per page"); empty hides the selector. */
  readonly pageSizes = input<readonly number[]>([]);
  /** First and Last buttons; false keeps the older Previous/Next only pager. */
  readonly edges = input(true);
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();

  protected readonly sizeId = `mf-pager-size-${nextId++}`;

  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  /** The page as shown: never past the last page. */
  protected readonly shownPage = computed(() => Math.min(Math.max(1, this.page()), this.pages()));
  protected readonly range = computed(() => {
    const total = this.total();
    if (total === 0) return 'Showing 0 of 0';
    const from = (this.page() - 1) * this.pageSize() + 1;
    const to = Math.min(total, this.page() * this.pageSize());
    return `Showing ${from}-${to} of ${total}`;
  });
}
