import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { Dismissable } from '../ui/dismissable';
import { SortDirection } from './queue-filters';

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
  matter: 'Matter',
  updated: 'Updated',
  age: 'Age',
  assignee: 'Assignee',
  client: 'Client',
};

/**
 * "Sorted by Priority (default order) (i)" or "Sorted by Due date (ascending)": the note that sits in the footer next to the range
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
        <span class="sn-label"
          >Sorted by {{ label() }}
          <i class="pi" [class]="dirIcon()" aria-hidden="true"></i>
          <span class="sn-sr">({{ dir() === 'desc' ? 'descending' : 'ascending' }})</span>
        </span>
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
  readonly defaultOrder = input('Default order: Priority, ASAP first, Due date, Oldest');
  readonly defaultLabel = input('Priority');

  protected readonly info = signal(false);
  protected readonly label = computed(() => SORT_LABELS[this.sort() ?? ''] ?? this.sort());
  protected readonly dirIcon = computed(() => {
    const desc = (this.dir() ?? (DESC_FIRST.has(this.sort() ?? '') ? 'desc' : 'asc')) === 'desc';
    return desc ? 'pi-sort-amount-down' : 'pi-sort-amount-up-alt';
  });
}
