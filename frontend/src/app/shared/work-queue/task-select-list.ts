import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TaskQueueRow } from '../../api/generated/api-client';
import { formatDateOnly } from '../../core/time/time';
import { OPEN_STATUSES } from './queue-filters';

/** True for the tasks a bulk change may touch: New, In Progress and On Hold. */
export const isBulkEditable = (row: Pick<TaskQueueRow, 'status'>): boolean =>
  OPEN_STATUSES.includes(row.status);

/**
 * The matter's tasks in selection mode (epic #667, #699): one row per task with a checkbox, as a table from 640 px and as a list of
 * cards below it, so selecting works at 375 px. Only open tasks can be ticked (a completed or cancelled task has no checkbox: it cannot
 * be changed). The selection is the page's: it survives paging and filtering until the person clears it or finishes. "Select all on this
 * page" ticks the open tasks shown.
 */
@Component({
  selector: 'mf-task-select-list',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { tabindex: '-1', '[attr.aria-label]': 'label()' },
  styles: `
    :host {
      display: block;
      outline: none;
    }
    .ts__scroll {
      overflow-x: auto;
    }
    .ts__table {
      width: 100%;
      border-collapse: collapse;
      background: var(--mf-surface);
    }
    .ts__table th,
    .ts__table td {
      padding: var(--mf-s1) var(--mf-s2);
      border-bottom: 1px solid var(--mf-border);
      text-align: left;
      vertical-align: middle;
    }
    .ts__table thead th {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .ts__check {
      width: 2.5rem;
    }
    .ts__check input {
      width: 1.25rem;
      height: 1.25rem;
    }
    .ts__row--on {
      background: var(--mf-selected-bg);
    }
    .ts__muted {
      color: var(--mf-text-muted);
    }
    .ts__cards {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ts__card {
      display: grid;
      grid-template-columns: 2.75rem minmax(0, 1fr);
      min-height: 64px;
      border-bottom: 1px solid var(--mf-border);
      background: var(--mf-surface);
    }
    .ts__card label {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 44px;
      min-height: 44px;
    }
    .ts__card input {
      width: 1.5rem;
      height: 1.5rem;
    }
    .ts__card-body {
      min-width: 0;
      padding: var(--mf-s1) var(--mf-s2) var(--mf-s1) 0;
    }
    .ts__card-body p {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .ts__empty {
      margin: 0;
      padding: var(--mf-s4);
      color: var(--mf-text-muted);
      text-align: center;
    }
  `,
  template: `
    @if (rows().length === 0) {
      <p class="ts__empty" data-select-empty>No tasks to select.</p>
    } @else if (phone()) {
      <ul class="ts__cards" data-select-cards>
        @for (r of rows(); track r.taskId) {
          <li
            class="ts__card"
            [class.ts__row--on]="selected().has(r.taskId)"
            [attr.data-task]="r.taskNumber"
          >
            @if (editable(r)) {
              <label>
                <input
                  type="checkbox"
                  data-select-row
                  [attr.aria-label]="'Select ' + r.taskNumber + ' ' + r.title"
                  [checked]="selected().has(r.taskId)"
                  (change)="pick.emit({ row: r, on: $any($event.target).checked })"
                />
              </label>
            } @else {
              <span></span>
            }
            <div class="ts__card-body">
              <p>
                <a [routerLink]="['/tasks', r.taskId]" [queryParams]="{ from: 'matter' }"
                  >{{ r.taskNumber }} {{ r.title }}</a
                >
              </p>
              <p class="ts__muted">
                {{ r.statusLabel }} . {{ r.priority.label }} .
                {{ r.assignedUser?.displayName ?? r.assignedPod?.name ?? 'Unassigned' }}
              </p>
              @if (!editable(r)) {
                <p class="ts__muted">Closed tasks can’t be changed.</p>
              }
            </div>
          </li>
        }
      </ul>
    } @else {
      <div class="ts__scroll">
        <table class="ts__table" data-select-table>
          <caption class="mf-sr-only">
            {{
              label()
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col" class="ts__check">
                <input
                  type="checkbox"
                  data-select-all
                  aria-label="Select all open tasks on this page"
                  [checked]="allOn()"
                  [indeterminate]="someOn() && !allOn()"
                  (change)="toggleAll.emit($any($event.target).checked)"
                />
              </th>
              <th scope="col">Ref</th>
              <th scope="col">Title</th>
              <th scope="col">Priority</th>
              <th scope="col">Assignee</th>
              <th scope="col">Due</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.taskId) {
              <tr [class.ts__row--on]="selected().has(r.taskId)" [attr.data-task]="r.taskNumber">
                <td class="ts__check">
                  @if (editable(r)) {
                    <input
                      type="checkbox"
                      data-select-row
                      [attr.aria-label]="'Select ' + r.taskNumber + ' ' + r.title"
                      [checked]="selected().has(r.taskId)"
                      (change)="pick.emit({ row: r, on: $any($event.target).checked })"
                    />
                  }
                </td>
                <td>{{ r.taskNumber }}</td>
                <td>
                  <a [routerLink]="['/tasks', r.taskId]" [queryParams]="{ from: 'matter' }">{{
                    r.title
                  }}</a>
                  @if (!editable(r)) {
                    <span class="ts__muted"> (closed: can’t be changed)</span>
                  }
                </td>
                <td>{{ r.priority.label }}</td>
                <td>{{ r.assignedUser?.displayName ?? r.assignedPod?.name ?? 'Unassigned' }}</td>
                <td>{{ r.isAsap ? 'ASAP' : r.dueDate ? date(r.dueDate) : '' }}</td>
                <td>{{ r.statusLabel }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class TaskSelectList {
  readonly rows = input.required<readonly TaskQueueRow[]>();
  readonly selected = input.required<ReadonlySet<number>>();
  readonly phone = input(false);
  readonly label = input('Tasks of this matter, select tasks');
  readonly pick = output<{ row: TaskQueueRow; on: boolean }>();
  readonly toggleAll = output<boolean>();

  protected readonly editableRows = computed(() => this.rows().filter(isBulkEditable));
  protected readonly allOn = computed(
    () =>
      this.editableRows().length > 0 &&
      this.editableRows().every((r) => this.selected().has(r.taskId)),
  );
  protected readonly someOn = computed(() =>
    this.editableRows().some((r) => this.selected().has(r.taskId)),
  );
  protected readonly editable = isBulkEditable;
  protected date = formatDateOnly;
}
