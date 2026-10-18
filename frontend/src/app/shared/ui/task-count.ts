import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** The record a count belongs to; the Task Queue filters by it with `client=`, `matter=` or `project=`. */
export type CountScope = 'client' | 'matter' | 'project';

/** The open statuses of the Task Queue (the same words the Dashboard and the summary strip link with). */
const OPEN = ['NEW', 'IN_PROGRESS', 'ON_HOLD'];

/**
 * The Task Queue address behind a count (WP9, #266): the record plus the open statuses, and `overdue=true` for the overdue count. These
 * are the rules of the summary strip and `GET /task-queue`, so the number in the list equals the total the link opens.
 */
export function taskQueueQuery(
  scope: CountScope,
  id: number,
  kind: 'open' | 'overdue',
): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = { [scope]: String(id), status: [...OPEN] };
  if (kind === 'overdue') query['overdue'] = 'true';
  return query;
}

/**
 * One Open tasks or Overdue cell of the record lists. Open tasks is a right-aligned number, Overdue the shared overdue style (red text,
 * alert icon, "overdue" in the accessible name and the tooltip) only above 0 and a muted en dash at 0. A positive count links to the Task
 * Queue; a zero is plain text (no link to an empty list). A count the viewer may not see is not shown at all: the pages leave the column
 * out without `Task.View`, so `count` is a number here.
 */
@Component({
  selector: 'mf-task-count',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-count]': 'kind()', '[class.tc-card]': 'word()' },
  template: `
    @if (count() > 0) {
      <a
        class="tc"
        [class.tc-over]="kind() === 'overdue'"
        routerLink="/tasks"
        [queryParams]="query()"
        [attr.aria-label]="sentence()"
        [attr.title]="sentence()"
      >
        @if (kind() === 'overdue') {
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
        }
        {{ count() }}{{ wordText() }}
      </a>
    } @else if (kind() === 'overdue') {
      <span class="tc tc-zero" [attr.title]="sentence()">
        <span aria-hidden="true">–{{ wordText() }}</span
        ><span class="tc-sr">{{ sentence() }}</span>
      </span>
    } @else {
      <span class="tc tc-zero" [attr.title]="sentence()">0{{ wordText() }}</span>
    }
  `,
  styles: `
    :host {
      display: block;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    /* On a card (WP12) the count is read as words, "14 open", at the left of its line. */
    :host(.tc-card) {
      display: inline-block;
      text-align: left;
    }
    .tc {
      display: inline-block;
      min-width: 24px;
      line-height: 24px;
      white-space: nowrap;
    }
    a.tc {
      color: var(--mf-link);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    a.tc-over {
      color: var(--mf-due-overdue);
      font-weight: 700;
    }
    a.tc:hover {
      text-decoration-thickness: 2px;
    }
    .tc-zero {
      color: var(--mf-text-muted);
    }
    .pi {
      margin-right: var(--mf-s1);
      font-size: 0.9em;
    }
    .tc-sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class TaskCount {
  readonly count = input.required<number>();
  readonly kind = input.required<'open' | 'overdue'>();
  readonly scope = input.required<CountScope>();
  readonly recordId = input.required<number>();
  /** The record's name, for the spoken name and the tooltip. */
  readonly name = input('');
  /** Say what the number counts, "14 open" and "3 overdue" (the record cards have no column headers). */
  readonly word = input(false);

  protected readonly query = computed(() =>
    taskQueueQuery(this.scope(), this.recordId(), this.kind()),
  );
  protected readonly wordText = computed(() => (this.word() ? ` ${this.kind()}` : ''));
  protected readonly sentence = computed(() => {
    const n = this.count();
    const what =
      this.kind() === 'overdue'
        ? `${n} overdue ${n === 1 ? 'task' : 'tasks'}`
        : `${n} open ${n === 1 ? 'task' : 'tasks'}`;
    return this.name() ? `${what} in ${this.name()}` : what;
  });
}
