import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FilterChips } from '../../shared/filters/filter-chips';
import { ListFilters } from '../../shared/filters/list-filters';

/**
 * The state of a list that a link from the other tab has limited (Workflows filtered by a task type or a step, Task Types filtered by a
 * workflow): the sentence "Filtered by task type X" with the number of results, and the removable chip ("Task type: X", remove
 * button "Remove filter Task type: X") of the shared column filters. Nothing shows while the list is not filtered.
 */
@Component({
  selector: 'mf-assoc-filter',
  imports: [FilterChips],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (filters().chips().length > 0) {
      <div class="af" data-assoc-filter>
        <p class="af__note" role="status" data-filtered-by>
          Filtered by {{ kind() }} <strong>{{ name() }}</strong
          >{{ detail() }}.
        </p>
        <mf-filter-chips [filters]="filters()" />
      </div>
    }
  `,
  styles: `
    .af {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
      margin-bottom: var(--mf-s3);
    }
    .af__note {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .af__note strong {
      color: var(--mf-text);
    }
  `,
})
export class AssocFilter {
  readonly filters = input.required<ListFilters>();
  /** "task type", "workflow" or "step". */
  readonly kind = input.required<string>();
  readonly name = input.required<string>();
  /** Results of the filtered list; absent while it loads. */
  readonly count = input<number | null>(null);
  readonly noun = input<{ one: string; many: string }>({ one: 'result', many: 'results' });

  /** ": 3 workflows" once the list has loaded. */
  protected readonly detail = computed(() => {
    const n = this.count();
    if (n === null) return '';
    return `: ${n} ${n === 1 ? this.noun().one : this.noun().many}`;
  });
}
