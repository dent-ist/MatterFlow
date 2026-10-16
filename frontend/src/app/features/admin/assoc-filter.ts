import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The state of a list that a link from the other tab has limited (Workflows filtered by a task type or a step, Task Types filtered by a
 * workflow): the sentence "Filtered by task type X" with the number of results. The removable chip ("Task type: X", remove button
 * "Remove filter Task type: X") is the one in the filters bar above the grid; the page shows this only while such a link filter is on.
 */
@Component({
  selector: 'mf-assoc-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="af" data-assoc-filter>
      <p class="af__note" role="status" data-filtered-by>
        Filtered by {{ kind() }} <strong>{{ name() }}</strong
        >{{ detail() }}.
      </p>
    </div>
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
