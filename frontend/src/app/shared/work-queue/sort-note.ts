import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { Dismissable } from '../ui/dismissable';
import { SortDirection } from './queue-filters';
import { directionWords } from './sort-sentences';

/** Sorts whose first click goes newest first. */
export const DESC_FIRST: ReadonlySet<string> = new Set([
  'created',
  'completed',
  'closed',
  'updated',
]);

export const SORT_LABELS: Readonly<Record<string, string>> = {
  priority: 'Priority',
  priorityAge: 'Priority, then age',
  due: 'Due date',
  created: 'Created',
  number: 'Ref',
  status: 'Status',
  completed: 'Closed',
  closed: 'Closed',
  title: 'Title',
  matter: 'Matter Number',
  matterName: 'Matter Name',
  updated: 'Updated',
  age: 'Age',
  assignee: 'Assignee',
  client: 'Client',
};

/**
 * "Sorted by Priority (default order) (i)" or "Sorted by Due date, soonest first": the note that sits in the footer next to the range
 * ("Showing 1-50 of 442") on the Task Queue (#216). The info button opens the full default rule above the footer (the shared popover
 * rule: Esc, outside click).
 */
@Component({
  selector: 'mf-sort-note',
  imports: [Dismissable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sort-note.scss',
  template: `
    <span class="sn" data-sort-note>
      @if (sort(); as s) {
        <span class="sn-label">Sorted by {{ label() }}, {{ words() }}</span>
      } @else {
        <span class="sn-label">Sorted by {{ defaultLabel() }} (default order)</span>
        <button
          #infoBtn
          type="button"
          class="sn-info"
          aria-label="How the default order works"
          aria-controls="sn-rule"
          [attr.aria-expanded]="info()"
          (click)="info.set(!info())"
        >
          <i class="pi pi-info-circle" aria-hidden="true"></i>
        </button>
        @if (info()) {
          <p
            id="sn-rule"
            class="sn-rule"
            role="note"
            data-sort-rule
            [mfDismissable]="infoBtn"
            (dismissed)="info.set(false)"
          >
            {{ defaultOrder() }}. Choosing a column header sorts by it and replaces this order.
          </p>
        }
      }
    </span>
  `,
})
export class SortNote {
  readonly sort = input<string | null>(null);
  readonly dir = input<SortDirection | null>(null);
  readonly defaultOrder = input(
    'Default order: Priority, then ASAP first, then due date, then oldest',
  );
  readonly defaultLabel = input('Priority, most urgent first');

  protected readonly info = signal(false);
  protected readonly label = computed(() => SORT_LABELS[this.sort() ?? ''] ?? this.sort());
  /** The direction in words ("soonest first"): the label carries it, there is no arrow to read (issue #898). */
  protected readonly words = computed(() =>
    directionWords(
      this.sort() ?? '',
      this.dir() ?? (DESC_FIRST.has(this.sort() ?? '') ? 'desc' : 'asc'),
    ),
  );
}
