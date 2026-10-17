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
import { calendarDayInZone, dayIndex } from '../../../core/time/time';
import { UndoService } from '../../../core/notify/undo.service';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { PriorityBadge } from '../../../shared/ui/priority-badge';
import { canEditField } from '../../../shared/work-queue/inline-edit';
import { RowEdit } from '../../../shared/work-queue/row-edit';
import { LIST_ORDER, ListKind, queueParamsSorted } from '../dashboard-links';
import { DashState } from './dash-state';
import { DueChip } from './due-chip';

export type PanelKind = ListKind;
export type PanelState = 'loading' | 'ready' | 'error';

/** Why a list is empty when the page knows (the Technician's queue: a filter or the scope hides everything). */
export interface PanelEmptyState {
  kind: 'filtered' | 'scope';
  message: string;
  /** `scope` only: the button that widens the view ("Show all pods"). */
  actionLabel?: string;
}

/** Rows per list on the Summary: the full capped list is always shown; in the fixed-height layout the list scrolls inside its panel (#137). */
const MAX_ROWS = 5;

let nextId = 0;

/** Whole calendar days between the creation day and today in the viewer's zone ("age" of a task). */
export function ageInDays(createdAtUtc: string, now: Date, zone: string): number {
  return Math.max(
    0,
    dayIndex(calendarDayInZone(now, zone)) - dayIndex(calendarDayInZone(createdAtUtc, zone)),
  );
}

/**
 * A short list of tasks to act on (Unassigned, Overdue, Due soon). One line per row where the list is wide enough (container query, not
 * the window): reference (link to the Task), task type icon, title, client, priority, the due chip (days overdue in the Overdue list;
 * age and, when there is one, the due chip in the Unassigned list), and for the Unassigned list the inline "Assign to..." menu and
 * "Assign to me" for people who may assign. Narrower lists wrap to a title line and a meta line (with the matter number).
 * Rows are Task Queue rows, so every editor is the same one the queue uses. "View all" opens the full filtered, sorted Task Queue.
 */
@Component({
  selector: 'mf-dash-task-list',
  imports: [RouterLink, MatterRef, PriorityBadge, RowEdit, TaskTypeIcon, DueChip, DashState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.fill]': 'scroll()' },
  template: `
    <section
      class="card"
      [class.card--toast]="toastOpen()"
      [attr.aria-labelledby]="id"
      [attr.data-panel]="kind()"
    >
      <header>
        <h3 [id]="id" tabindex="-1" data-skip-target>{{ heading() }}</h3>
        @if (state() === 'ready' && total() > 0) {
          <span class="count" data-total>{{ total() }}</span>
        }
        @if (orderNote(); as note) {
          <span class="order" data-order>{{ note }}</span>
        }
        @if (state() === 'ready' && total() > shown().length) {
          <span class="more" data-more>Showing {{ shown().length }} of {{ total() }}</span>
        }
        @if (state() === 'ready' && total() > 0) {
          <a
            class="all"
            routerLink="/tasks"
            [queryParams]="allParams()"
            [attr.title]="viewAllTitle() || null"
            [attr.aria-label]="viewAllTitle() || null"
            data-view-all
          >
            {{ viewAllText() }} <i class="pi pi-arrow-right" aria-hidden="true"></i>
          </a>
        }
      </header>
      @switch (state()) {
        @case ('loading') {
          <!-- Decorative: the Summary says "Loading" once for the three lists, not once per list. The five bones are the five rows of a full list. -->
          <div class="bones" aria-hidden="true" data-list-loading>
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
          @if (shown().length === 0) {
            @if (emptyState(); as es) {
              <!-- The Technician's queue (S9): the state block says whether a filter or the scope hides everything, and the way out. -->
              <div data-empty>
                @if (es.kind === 'filtered') {
                  <mf-dash-state
                    variant="empty-filtered"
                    [filteredText]="es.message"
                    (clear)="emptyClear.emit()"
                  />
                } @else {
                  <mf-dash-state
                    variant="empty"
                    [message]="es.message"
                    [actionLabel]="es.actionLabel ?? null"
                    (action)="emptyAction.emit()"
                  />
                }
              </div>
            } @else {
              <p class="msg" data-empty>
                <i class="pi pi-check-circle" aria-hidden="true"></i> {{ emptyText() }}
              </p>
            }
          } @else {
            <div
              class="rows"
              [class.rows--scroll]="scroll()"
              [attr.role]="scroll() ? 'region' : null"
              [attr.tabindex]="scroll() ? 0 : null"
              [attr.aria-label]="scroll() ? heading() + ' tasks, scrollable' : null"
              data-rows
            >
              @if (shown().length > 2 && skippable()) {
                <button type="button" class="skip" data-skip (click)="skipList()">
                  Skip {{ heading() }} list
                </button>
              }
              <ul>
                @for (row of shown(); track row.taskId; let i = $index) {
                  <li [attr.data-task]="row.taskNumber" [attr.data-row]="i">
                    <a class="main" [routerLink]="['/tasks', row.taskId]" [attr.title]="row.title">
                      <span class="ref">{{ row.taskNumber }}</span>
                      <span
                        class="type"
                        role="img"
                        data-type
                        [attr.aria-label]="row.taskTypeName"
                        [attr.title]="row.taskTypeName"
                      >
                        <mf-task-type-icon [iconKey]="row.taskTypeIconKey" size="sm" />
                      </span>
                      <span class="title">{{ row.title }}</span>
                    </a>
                    <span
                      class="client"
                      data-client
                      [attr.title]="row.matterRef + ' ' + row.matterName"
                    >
                      {{ row.clientName }}
                      <mf-matter-ref
                        class="matter"
                        [value]="row.matterRef"
                        [copy]="false"
                        [attr.title]="row.matterName"
                      />
                    </span>
                    <mf-priority-badge
                      class="prio"
                      [priorityId]="row.priority.priorityId"
                      [label]="row.priority.label"
                      [color]="row.priority.color"
                    />
                    <span class="when">
                      @if (kind() === 'unassigned') {
                        @if (row.dueDate || row.dueAtUtc) {
                          <mf-due-chip [due]="row" [status]="row.status" />
                        }
                        <span class="age" data-age>{{ ageText(row) }}</span>
                      } @else {
                        <mf-due-chip data-due [due]="row" [status]="row.status" />
                      }
                    </span>
                    @if (kind() === 'unassigned') {
                      <div class="assign">
                        @if (editable(row)) {
                          <mf-row-edit
                            field="assignee"
                            emptyLabel="Assign to..."
                            toastPlacement="start"
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
            </div>
          }
        }
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    /* Fixed-height Summary, lists beside the tiles (#137): the panel is as tall as its share of the column, the heading row stays and the rows scroll. */
    :host(.fill) {
      display: flex;
      flex-direction: column;
      flex: 0 1 auto;
      min-height: 9rem;
    }
    :host(.fill) .card {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
    }
    header {
      flex: none;
    }
    .rows {
      position: relative;
    }
    .rows--scroll {
      flex: 0 1 auto;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .rows--scroll:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .card {
      container-type: inline-size;
      box-sizing: border-box;
      padding: var(--mf-s2) var(--mf-s3);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    /* A toast along the bottom (under 1024px) must not cover the last row: room for it while it is open. */
    @media (max-width: 1023px) {
      .card--toast {
        padding-bottom: 5.5rem;
      }
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 2rem;
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
    .order,
    .more {
      min-width: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .order {
      flex: 1 1 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .more {
      flex: none;
      margin-left: auto;
      white-space: nowrap;
    }
    .order + .more {
      margin-left: 0;
    }
    .all {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-height: 24px;
      margin-left: auto;
      font-size: var(--mf-fs-sm);
      color: var(--mf-link);
      white-space: nowrap;
    }
    .order ~ .all,
    .more ~ .all {
      margin-left: 0;
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    /* Wide list: one line of 44px. */
    li {
      box-sizing: border-box;
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 44px;
      padding: 2px 0;
      font-size: var(--mf-fs-sm);
    }
    li + li {
      border-top: 1px solid var(--mf-border);
    }
    a.main {
      flex: 1 1 0;
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 6rem;
      min-height: 24px;
      color: var(--mf-text);
      text-decoration: none;
    }
    a.main:hover .title {
      text-decoration: underline;
    }
    .type {
      flex: none;
      display: inline-flex;
      color: var(--mf-text-muted);
    }
    .client {
      flex: 0 1 6.5rem;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--mf-text-muted);
    }
    .matter {
      display: none;
    }
    .prio {
      flex: none;
    }
    .when {
      flex: none;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      width: 6rem;
      line-height: 1.25;
    }
    .age {
      font-size: var(--mf-fs-xs);
      color: var(--mf-text-muted);
    }
    .assign {
      flex: none;
      display: flex;
      align-items: center;
      font-size: var(--mf-fs-sm);
    }
    /* Narrow list: a title line, then a line with the rest (and the matter number). */
    @container (max-width: 539px) {
      .order {
        order: 5;
        flex: 1 1 100%;
        white-space: normal;
      }
      li {
        flex-wrap: wrap;
        padding: var(--mf-s2) 0;
      }
      a.main {
        flex: 1 1 100%;
      }
      .client {
        flex: 0 1 auto;
        max-width: 100%;
      }
      .matter {
        display: inline-flex;
        margin-left: var(--mf-s1);
      }
      .when {
        flex-direction: row;
        align-items: center;
        gap: var(--mf-s2);
        width: auto;
      }
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
    @container (max-width: 539px) {
      .title {
        white-space: normal;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
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
    .muted {
      color: var(--mf-text-muted);
    }
    .msg {
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
    /* Five rows of 44 px, as a full loaded list: its height does not change when the rows arrive (px: the root font size is 14 px). */
    .bones {
      display: grid;
    }
    @media (prefers-reduced-motion: no-preference) {
      .bone {
        animation: mf-list-pulse 1.4s ease-in-out infinite;
      }
      @keyframes mf-list-pulse {
        50% {
          opacity: 0.55;
        }
      }
    }
    .bone {
      display: block;
      height: 44px;
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
  private readonly undo = inject(UndoService);

  readonly kind = input.required<PanelKind>();
  readonly heading = input.required<string>();
  readonly rows = input.required<readonly TaskQueueRow[]>();
  /** How many tasks match in all (the count behind the list). */
  readonly total = input(0);
  readonly state = input<PanelState>('ready');
  /** Task Queue query of the full list ("View all"). */
  readonly query = input.required<string>();
  readonly emptyText = input('Nothing here.');
  readonly emptyState = input<PanelEmptyState | null>(null);
  readonly viewAllText = input('View all');
  /** Tooltip of the "View all" link (for example the window of the list). */
  readonly viewAllTitle = input('');
  /** False for the last list of a page: nothing follows it to skip to. */
  readonly skippable = input(true);
  /** The rows scroll inside the panel (the fixed-height Summary with the lists beside the tiles): they become a focusable, named region. */
  readonly scroll = input(false);
  readonly rowChange = output<TaskQueueRow>();
  readonly retry = output<void>();
  readonly emptyClear = output<void>();
  readonly emptyAction = output<void>();

  protected readonly id = `mf-dash-list-${nextId++}`;

  /**
   * Rows shown: at most 5 (one line each), on every window height. In the fixed-height layout (#137) the list scrolls inside its panel
   * (heading, count and "View all" stay pinned), so a short window no longer cuts the list to 3 rows; "Showing N of M" counts what is shown.
   */
  protected readonly shown = computed(() => this.rows().slice(0, MAX_ROWS));
  protected readonly bones = [1, 2, 3, 4, 5];

  /** "View all" starts with the same order as the list (see `LIST_ORDER`). */
  protected readonly allParams = computed(() => {
    const order = LIST_ORDER[this.kind()];
    return queueParamsSorted(this.query(), order.sort, order.dir);
  });
  /** The assignment toast is open and this is the last list of the page: it leaves room for the toast under 1024px (see the styles). */
  protected readonly toastOpen = computed(
    () => !this.skippable() && this.undo.current()?.placement === 'start',
  );
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
}
