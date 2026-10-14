import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/** "Showing 1-25 of 312" with Previous/Next (UX 5.2). Page numbers are 1-based like the API. */
@Component({
  selector: 'mf-pager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="mf-pager" aria-label="Pagination">
      <span data-range>{{ range() }}</span>
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
    </nav>
  `,
  styles: `
    .mf-pager {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mf-s2);
      padding: var(--mf-s2) 0;
      color: var(--mf-text-muted);
    }
  `,
})
export class Pager {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  readonly pageChange = output<number>();

  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly range = computed(() => {
    const total = this.total();
    if (total === 0) return 'Showing 0 of 0';
    const from = (this.page() - 1) * this.pageSize() + 1;
    const to = Math.min(total, this.page() * this.pageSize());
    return `Showing ${from}-${to} of ${total}`;
  });
}
