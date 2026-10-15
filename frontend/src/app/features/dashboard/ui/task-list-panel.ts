import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TaskQueueRow } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone, dayIndex, describeDue } from '../../../core/time/time';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { PriorityBadge } from '../../../shared/ui/priority-badge';
import { canEditField } from '../../../shared/work-queue/inline-edit';
import { RowEdit } from '../../../shared/work-queue/row-edit';
import { queueParamsSorted } from '../dashboard-links';

export type PanelKind = 'unassigned' | 'overdue' | 'dueSoon';
export type PanelState = 'loading' | 'ready' | 'error';

let nextId = 0;

/** Whole calendar days between the creation day and today in the viewer's zone ("age" of a task). */
export function ageInDays(createdAtUtc: string, now: Date, zone: string): number {
  return Math.max(
    0,
    dayIndex(calendarDayInZone(now, zone)) - dayIndex(calendarDayInZone(createdAtUtc, zone)),
  );
}

/**
 * A short list of tasks to act on (Unassigned queue, Overdue, Due soon): reference (link to the Task), title, matter, priority, and the
 * age of the task or its due date; the unassigned queue also has the inline Assignee menu and "Assign to me" for people who may assign.
 * Rows are Task Queue rows, so every editor is the same one the queue uses. "View all" opens the full filtered, sorted Task Queue.
 */
@Component({
  selector: 'mf-dash-task-list',
  imports: [RouterLink, MatterRef, PriorityBadge, RowEdit],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" [attr.aria-labelledby]="id" [attr.data-panel]="kind()">
      <header>
        <h3 [id]="id">{{ heading() }}</h3>
        @if (state() === 'ready' && total() > 0) {
          <span class="count" data-total>{{ total() }}</span>
        }
      </header>
      @switch (state()) {
        @case ('loading') {
          <div class="bones" role="status" aria-busy="true">
            <span class="sr-only">Loading {{ heading() }}...</span>
            @for (n of bones; track n) {
              <span class="bone" aria-hidden="true"></span>
            }
          </div>
        }
        @case ('error') {
          <p class="msg" role="alert" data-error>
            Couldn't load this list.
            <button type="button" class="link" (click)="retry.emit()">Retry</button>
          </p>
        }
        @default {
          @if (rows().length === 0) {
            <p class="msg" data-empty>
              <i class="pi pi-check-circle" aria-hidden="true"></i> {{ emptyText() }}
            </p>
          } @else {
            <ul>
              @for (row of rows(); track row.taskId) {
                <li [attr.data-task]="row.taskNumber">
                  <div class="main">
                    <a class="ref" [routerLink]="['/tasks', row.taskId]">{{ row.taskNumber }}</a>
                    <span class="title" [attr.title]="row.title">{{ row.title }}</span>
                  </div>
                  <div class="meta">
                    <mf-matter-ref
                      [value]="row.matterRef"
                      [link]="['/matters', row.matterId]"
                      [copy]="false"
                      [hint]="row.matterName"
                    />
                    <mf-priority-badge
                      [priorityId]="row.priority.priorityId"
                      [label]="row.priority.label"
                      [color]="row.priority.color"
                    />
                    @if (kind() === 'unassigned') {
                      <span class="age" data-age>{{ ageText(row) }}</span>
                    } @else {
                      @let due = dueOf(row);
                      @if (due.kind === 'overdue') {
                        <span class="due due--overdue" data-due>
                          <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                          {{ due.dateText }} · <strong>{{ due.badge }}</strong>
                        </span>
                      } @else {
                        <span class="due due--soon" data-due>
                          <i class="pi pi-clock" aria-hidden="true"></i>
                          {{ due.dateText }}
                        </span>
                      }
                    }
                  </div>
                  @if (kind() === 'unassigned') {
                    <div class="assign">
                      @if (editable(row)) {
                        <mf-row-edit
                          field="assignee"
                          [row]="row"
                          [assignMe]="true"
                          (rowChange)="rowChange.emit($event)"
                        />
                      } @else {
                        <span class="muted">{{
                          row.assignedUser?.displayName ?? 'Unassigned'
                        }}</span>
                      }
                    </div>
                  }
                </li>
              }
            </ul>
          }
          @if (total() > rows().length) {
            <p class="more">Showing {{ rows().length }} of {{ total() }}.</p>
          }
          @if (total() > 0) {
            <a class="all" routerLink="/tasks" [queryParams]="allParams()" data-view-all>
              {{ viewAllText() }} <i class="pi pi-arrow-right" aria-hidden="true"></i>
            </a>
          }
        }
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .card {
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      padding: var(--mf-s4);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    header {
      display: flex;
      align-items: baseline;
      gap: var(--mf-s2);
      margin-bottom: var(--mf-s2);
    }
    h3 {
      margin: 0;
      font-size: var(--mf-fs-lg);
    }
    .count {
      font-weight: 700;
      color: var(--mf-text-muted);
      font-variant-numeric: tabular-nums;
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: grid;
      gap: var(--mf-s1);
      padding: var(--mf-s2) 0;
    }
    li + li {
      border-top: 1px solid var(--mf-border);
    }
    .main {
      display: flex;
      align-items: baseline;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .ref {
      flex: none;
      font-family: var(--mf-font-mono);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      color: var(--mf-link);
    }
    .title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s3);
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .due {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
    }
    .due--overdue {
      color: var(--mf-due-overdue, var(--mf-danger));
    }
    .due--soon {
      color: var(--mf-due-soon, var(--mf-warning));
    }
    .assign {
      font-size: var(--mf-fs-sm);
    }
    .muted {
      color: var(--mf-text-muted);
    }
    .msg,
    .more {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .msg .pi {
      color: var(--mf-success);
    }
    .link {
      padding: 0;
      background: none;
      border: 0;
      color: var(--mf-link);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
    .all {
      margin-top: auto;
      padding-top: var(--mf-s2);
      font-size: var(--mf-fs-sm);
      color: var(--mf-link);
    }
    .bones {
      display: grid;
      gap: var(--mf-s2);
    }
    .bone {
      display: block;
      height: 2.75rem;
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class DashTaskList {
  private readonly auth = inject(AuthStore);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  readonly kind = input.required<PanelKind>();
  readonly heading = input.required<string>();
  readonly rows = input.required<readonly TaskQueueRow[]>();
  /** How many tasks match in all (the count behind the list). */
  readonly total = input(0);
  readonly state = input<PanelState>('ready');
  /** Task Queue query of the full list ("View all"). */
  readonly query = input.required<string>();
  readonly emptyText = input('Nothing here.');
  readonly viewAllText = input('View all');
  readonly rowChange = output<TaskQueueRow>();
  readonly retry = output<void>();

  protected readonly id = `mf-dash-list-${nextId++}`;
  protected readonly bones = [1, 2, 3];

  /** "View all" starts with the same order as the list: oldest first for the unassigned queue, soonest due first for the others. */
  protected readonly allParams = computed(() =>
    this.kind() === 'unassigned'
      ? queueParamsSorted(this.query(), 'created', 'asc')
      : queueParamsSorted(this.query(), 'due', 'asc'),
  );

  protected editable(row: TaskQueueRow): boolean {
    return canEditField('assignee', row, (p) => this.auth.has(p));
  }

  protected ageText(row: TaskQueueRow): string {
    const days = ageInDays(row.createdAtUtc, this.clock.now(), this.zone);
    return days === 0 ? 'Created today' : days === 1 ? '1 day old' : `${days} days old`;
  }

  protected dueOf(row: TaskQueueRow) {
    return describeDue(row, this.clock.now(), this.zone, row.status);
  }
}
