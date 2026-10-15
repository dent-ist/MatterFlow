import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TaskQueueRow } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone, dayIndex, describeDue, parseDateOnly } from '../../../core/time/time';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { PriorityBadge } from '../../../shared/ui/priority-badge';
import { canEditField } from '../../../shared/work-queue/inline-edit';
import { RowEdit } from '../../../shared/work-queue/row-edit';
import { LIST_ORDER, ListKind, queueParamsSorted } from '../dashboard-links';

export type PanelKind = ListKind;
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
        <h3 [id]="id" tabindex="-1" data-skip-target>{{ heading() }}</h3>
        @if (state() === 'ready' && total() > 0) {
          <span class="count" data-total>{{ total() }}</span>
        }
      </header>
      @if (orderNote(); as note) {
        <p class="order" data-order>{{ note }}</p>
      }
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
            @if (rows().length > 2) {
              <button type="button" class="skip" data-skip (click)="skipList()">
                Skip {{ heading() }} list
              </button>
            }
            <ul>
              @for (row of rows(); track row.taskId) {
                <li [attr.data-task]="row.taskNumber">
                  <a class="main" [routerLink]="['/tasks', row.taskId]" [attr.title]="row.title">
                    <span class="ref">{{ row.taskNumber }}</span>
                    <span class="title">{{ row.title }}</span>
                  </a>
                  <div class="meta">
                    <mf-matter-ref
                      [value]="row.matterRef"
                      [copy]="false"
                      [attr.title]="row.matterName"
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
                          @if (relativeDay(row); as rel) {
                            · <strong>{{ rel }}</strong>
                          }
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
            <p class="more" data-more>Showing {{ rows().length }} of {{ total() }}.</p>
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
    a.main {
      display: flex;
      align-items: baseline;
      gap: var(--mf-s2);
      min-width: 0;
      color: var(--mf-text);
      text-decoration: none;
    }
    a.main:hover .title {
      text-decoration: underline;
    }
    .order {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    /* Visible only while it has focus: the keyboard way past a long list. */
    .skip {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    .skip:focus {
      position: static;
      width: auto;
      height: auto;
      margin: 0 0 var(--mf-s2);
      padding: var(--mf-s1) var(--mf-s2);
      clip: auto;
      background: var(--mf-surface);
      color: var(--mf-link);
      border: 1px solid var(--mf-link);
      border-radius: var(--mf-radius);
      font: inherit;
      font-size: var(--mf-fs-sm);
    }
    h3:focus {
      outline: none;
    }
    h3:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

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

  /** "View all" starts with the same order as the list (see `LIST_ORDER`). */
  protected readonly allParams = computed(() => {
    const order = LIST_ORDER[this.kind()];
    return queueParamsSorted(this.query(), order.sort, order.dir);
  });
  protected readonly orderNote = computed(() => LIST_ORDER[this.kind()].note);

  /** Moves focus to the row now at `index` (or the last one), else to the list heading: used after a row has left the list. */
  focusNear(index: number): void {
    const links = this.host.nativeElement.querySelectorAll<HTMLElement>('li a.main');
    const target = links.length ? links[Math.min(Math.max(index, 0), links.length - 1)] : null;
    (target ?? this.host.nativeElement.querySelector<HTMLElement>('h3'))?.focus();
  }

  /** Keyboard shortcut past this list: focus the heading of whatever follows it on the page. */
  protected skipList(): void {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-skip-target]'));
    const self = this.host.nativeElement;
    const next = targets.find(
      (t) =>
        !self.contains(t) && !!(self.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING),
    );
    next?.focus();
  }

  protected editable(row: TaskQueueRow): boolean {
    return canEditField('assignee', row, (p) => this.auth.has(p));
  }

  protected ageText(row: TaskQueueRow): string {
    const days = ageInDays(row.createdAtUtc, this.clock.now(), this.zone);
    return days === 0 ? 'Created today' : days === 1 ? '1 day old' : `${days} days old`;
  }

  /** "Today" or "Tomorrow" for a task due within two days, so the list can be scanned without reading dates (DASH-18). */
  protected relativeDay(row: TaskQueueRow): string | null {
    const today = dayIndex(calendarDayInZone(this.clock.now(), this.zone));
    const dueDay = row.dueAtUtc
      ? calendarDayInZone(row.dueAtUtc, this.zone)
      : row.dueDate
        ? parseDateOnly(row.dueDate)
        : null;
    if (!dueDay) return null;
    const diff = dayIndex(dueDay) - today;
    return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : null;
  }

  protected dueOf(row: TaskQueueRow) {
    return describeDue(row, this.clock.now(), this.zone, row.status);
  }
}
