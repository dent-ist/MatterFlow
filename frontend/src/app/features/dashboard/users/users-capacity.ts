import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { WorkloadSummary } from '../../../api/generated/api-client';
import { plural } from './users-model';

/**
 * The unassigned button at the right end of the state row (US-13, #1105): "17 unassigned tasks". It opens the right side panel of the unassigned tasks (`mf-users-unassigned`);
 * it is a button with a popup dialog, not a link. The count is the board's `unassignedTasks`, the same number as the panel's title. The "Assign work" dropdown that used to sit beside it
 * is gone; assigning is done from the panel's rows or from a person's Assign icon.
 */
@Component({
  selector: 'mf-users-capacity',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="strip" role="group" aria-label="Unassigned work" data-capacity>
      @if (summary()) {
        <button
          type="button"
          class="mf-btn unassigned"
          data-summary-unassigned
          aria-haspopup="dialog"
          [attr.aria-expanded]="expanded()"
          title="Open tasks nobody has: list them and assign them here"
          [attr.aria-label]="plural(count(), 'unassigned task') + '. Show the list'"
          (click)="show.emit()"
        >
          <i class="pi pi-inbox" aria-hidden="true"></i>
          <strong data-n>{{ unassignedText() }}</strong
          >&ngsp;<span>unassigned {{ count() === 1 ? 'task' : 'tasks' }}</span>
          <i class="pi pi-chevron-right go" aria-hidden="true"></i>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .strip {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
    }
    .unassigned {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      white-space: nowrap;
    }
    .unassigned .pi:first-child {
      color: var(--mf-warning);
      font-size: var(--mf-icon-md);
    }
    .go {
      color: var(--mf-text-muted);
      font-size: var(--mf-icon-sm);
    }
  `,
})
export class UsersCapacity {
  readonly summary = input<WorkloadSummary | null>(null);
  /** The panel is open (for `aria-expanded`). */
  readonly expanded = input(false);
  /** The button was pressed: the tab opens the panel. */
  readonly show = output<void>();

  protected readonly plural = plural;
  protected readonly count = computed(() => this.summary()?.unassignedTasks ?? 0);
  protected readonly unassignedText = computed(() => (this.summary() ? String(this.count()) : '-'));
}
