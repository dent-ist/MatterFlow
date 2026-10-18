import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { formatInstant } from '../../core/time/time';
import { SortDirection } from './queue-filters';
import { SORT_LABELS } from './sort-note';

/**
 * The line only the printed page shows (BUG-TQ6, TQ39), under the page title: the page and view, the sort, where this page sits
 * in the list ("Page 1 of 9 . 442 tasks, showing 1-50") and when it was printed in the viewer's time zone. The screen shows nothing
 * (the toolbar and the footer say the same things); the filters line is the one the filters bar prints just above.
 */
@Component({
  selector: 'mf-print-line',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="pl" data-print-line>
      <strong data-print-page>{{ name() }}</strong>
      <span data-print-sort>{{ sortText() }}</span>
      <span data-print-count>{{ countText() }}</span>
      <span data-print-when>Printed {{ printed() }}</span>
    </p>
  `,
  styles: `
    :host {
      display: none;
    }
    .pl {
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--mf-s3);
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    .pl > span:not(:last-child)::after {
      content: ' \\00b7';
      margin-left: var(--mf-s3);
    }
    @media print {
      :host {
        display: block;
      }
    }
  `,
})
export class PrintLine {
  /** The page and view ("Task Queue: Overdue"). */
  readonly name = input('Tasks');
  readonly sort = input<string | null>(null);
  readonly dir = input<SortDirection | null>(null);
  readonly total = input(0);
  readonly page = input(1);
  readonly pageSize = input(50);

  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  /** Set when the page is built and again just before the browser prints, so the time is the time of the print. */
  private readonly now = signal(this.clock.now());

  constructor() {
    const refresh = (): void => this.now.set(this.clock.now());
    window.addEventListener('beforeprint', refresh);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('beforeprint', refresh));
  }

  protected readonly printed = computed(() => formatInstant(this.now(), this.zone));

  protected readonly sortText = computed(() => {
    const s = this.sort();
    if (!s) return 'Sorted by default order';
    const way = this.dir() === 'desc' ? 'descending' : 'ascending';
    return `Sorted by ${SORT_LABELS[s] ?? s}, ${way}`;
  });

  protected readonly countText = computed(() => {
    const total = this.total();
    if (total === 0) return 'No tasks';
    const noun = total === 1 ? '1 task' : `${total} tasks`;
    const size = Math.max(1, this.pageSize());
    const pages = Math.ceil(total / size);
    const from = (this.page() - 1) * size + 1;
    const to = Math.min(total, this.page() * size);
    return pages > 1 ? `Page ${this.page()} of ${pages}, ${noun}, showing ${from}-${to}` : noun;
  });
}
