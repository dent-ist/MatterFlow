import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SwimlaneCard, TaskQueueRow } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { DueStatePipe } from '../../../shared/pipes/due-label.pipe';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { PriorityBadge, priorityColors } from '../../../shared/ui/priority-badge';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { canEditField } from '../../../shared/work-queue/inline-edit';
import { RowEdit } from '../../../shared/work-queue/row-edit';
import { Density, applyRow, cardToRow } from './swimlane-model';

/** Initials for the avatar: first letters of the first and last word. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * One task on the Swimlane board. Left colour bar, level-bar icon and text for the priority (the same colours as the priority badges, never
 * colour alone), task type icon, reference link, title (two lines), client and matter, assignee (with an Out of office flag), due chip (in
 * the viewer's zone), workflow progress and the inline Status, Priority and Assignee menus of the queues (with Undo). The title is the
 * button that opens the side drawer; it stretches over the whole card, and the other controls sit above it.
 */
@Component({
  selector: 'mf-swimlane-card',
  imports: [
    RouterLink,
    MatterRef,
    PriorityBadge,
    StatusBadge,
    TaskTypeIcon,
    RowEdit,
    DueStatePipe,
    MfDatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.compact]': "density() === 'compact'" },
  template: `
    @let c = card();
    @let r = row();
    <article
      class="card"
      [class.card--overdue]="c.isOverdue"
      [class.card--closed]="closed()"
      [attr.data-card]="c.taskId"
      [attr.data-task]="c.ref"
    >
      <span
        class="bar"
        aria-hidden="true"
        [style.background]="colors().bg"
        [style.box-shadow]="'inset 0 0 0 1px ' + colors().fg"
      ></span>
      <div class="body">
        <h4 class="title">
          <button
            type="button"
            class="open"
            data-card-open
            [id]="'sl-open-' + c.taskId"
            [attr.data-nav]="navigable() ? 'card:' + c.taskId : null"
            [attr.tabindex]="tabStop()"
            [attr.aria-label]="c.title + ', ' + c.ref + '. Open details'"
            (click)="open.emit(c)"
          >
            {{ c.title }}
          </button>
        </h4>

        <div class="top">
          <span class="type" [title]="c.taskTypeName">
            <mf-task-type-icon [iconKey]="c.taskTypeIconKey" size="sm" />
            <span class="sr-only">{{ c.taskTypeName }}</span>
          </span>
          <a class="ref mf-ref" [routerLink]="['/tasks', c.taskId]" data-card-ref>{{ c.ref }}</a>
          <span class="grow"></span>
          <span class="field" data-field="priority">
            @if (editable('priority')) {
              <mf-row-edit field="priority" [row]="r" (rowChange)="changed($event)" />
            } @else {
              <mf-priority-badge
                [priorityId]="c.priority.priorityId"
                [label]="c.priority.label"
                [color]="c.priority.color"
              />
            }
          </span>
        </div>

        <div class="client" [title]="c.clientName" data-client>
          <span class="client-name">{{ c.clientName }}</span>
          @if (c.matterIsSensitive) {
            <span class="mark mark--sens" data-sensitive title="Sensitive matter">
              <i class="pi pi-lock" aria-hidden="true"></i>
              <span class="mark-text">Sensitive</span>
            </span>
          }
        </div>
        <div class="where">
          <mf-matter-ref
            [value]="c.matterRef"
            [link]="['/matters', c.matterId]"
            [hint]="c.matterName"
          />
          <span class="matter-name" [title]="c.matterName">{{ c.matterName }}</span>
        </div>

        <div class="people">
          <span class="avatar" aria-hidden="true" [class.avatar--none]="!c.assignee">{{
            c.assignee ? initialsOf(c.assignee.displayName) : '-'
          }}</span>
          <span class="field who" data-field="assignee">
            @if (editable('assignee')) {
              <mf-row-edit field="assignee" [row]="r" (rowChange)="changed($event)" />
            } @else {
              <span class="who-text">{{ c.assignee?.displayName ?? 'Unassigned' }}</span>
            }
          </span>
          @if (outOfOffice()) {
            <span class="mark mark--ooo" data-ooo [title]="oooTitle()">
              <i class="pi pi-calendar-minus" aria-hidden="true"></i>
              <span class="mark-text">Out of office</span>
            </span>
          }
        </div>

        <div class="meta">
          <span class="due" data-due>
            @if (closed()) {
              <span class="due-chip due-chip--closed">
                <i class="pi pi-check" aria-hidden="true"></i>
                {{ c.status === 'CANCELLED' ? 'Cancelled' : 'Done' }}
                {{ c.completedAtUtc | mfDate: 'date' }}
              </span>
            } @else {
              @let due = c | dueState: c.status;
              @if (due.kind === 'asap') {
                <span class="due-chip due-chip--asap" [title]="due.tooltip">
                  <i class="pi pi-bolt" aria-hidden="true"></i>ASAP
                </span>
              } @else if (c.isOverdue || due.kind === 'overdue') {
                <span class="due-chip due-chip--overdue">
                  <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                  {{ due.badge ?? 'Overdue' }}
                  <span class="due-date">{{ due.dateText }}</span>
                </span>
              } @else if (due.daysUntil === 0) {
                <span class="due-chip due-chip--soon">
                  <i class="pi pi-clock" aria-hidden="true"></i>Due today
                </span>
              } @else if (due.daysUntil === 1) {
                <span class="due-chip"
                  >Tomorrow <span class="due-date">{{ due.dateText }}</span></span
                >
              } @else {
                <span class="due-chip">{{ due.dateText }}</span>
              }
            }
          </span>
          <span class="field" data-field="status">
            @if (editable('status')) {
              <mf-row-edit field="status" [row]="r" (rowChange)="changed($event)" />
            } @else {
              <mf-status-badge [code]="c.status" [label]="c.statusLabel" />
            }
          </span>
        </div>

        @if (c.stepsTotal > 0) {
          <div class="progress" data-progress>
            <span
              class="track"
              role="img"
              [attr.aria-label]="
                'Workflow steps: ' + c.stepsResolved + ' of ' + c.stepsTotal + ' done'
              "
            >
              <span class="fill" [style.width.%]="percent()"></span>
            </span>
            <span class="steps" aria-hidden="true">{{ c.stepsResolved }}/{{ c.stepsTotal }}</span>
          </div>
        }
      </div>
    </article>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .card {
      position: relative;
      display: flex;
      min-width: 0;
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
      box-shadow: var(--mf-shadow-1);
    }
    .card:hover {
      border-color: var(--mf-border-strong);
    }
    .card--overdue {
      border-color: var(--mf-due-overdue);
    }
    .card--closed .title,
    .card--closed .where,
    .card--closed .client {
      color: var(--mf-text-muted);
    }
    .bar {
      flex: none;
      width: 0.5rem;
      border-radius: calc(var(--mf-radius-lg) - 1px) 0 0 calc(var(--mf-radius-lg) - 1px);
    }
    .body {
      flex: 1;
      display: grid;
      gap: 2px;
      min-width: 0;
      padding: var(--mf-s2) var(--mf-s3) var(--mf-s2) var(--mf-s2);
    }
    /* The title button comes first in the markup (so its stretched ::after lies under everything that follows) but is drawn second. */
    .top {
      order: -1;
    }
    .top,
    .where,
    .people,
    .meta,
    .progress {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .who {
      flex: 0 1 auto;
      min-width: 0;
    }
    .grow {
      flex: 1;
    }
    .type {
      display: inline-flex;
      color: var(--mf-text-muted);
    }
    .ref {
      white-space: nowrap;
      position: relative;
      color: var(--mf-link);
      font-size: var(--mf-fs-sm);
      text-underline-offset: 2px;
    }
    .field {
      position: relative;
      min-width: 0;
    }
    .title {
      margin: 0;
      font-size: var(--mf-fs-md);
      font-weight: 600;
      line-height: 1.3;
    }
    /* The button is the card's one big target: its ::after covers the whole card; links and menus sit above it. */
    .open {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      overflow: hidden;
      max-width: 100%;
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
      overflow-wrap: anywhere;
    }
    .open::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: var(--mf-radius-lg);
    }
    .open:focus-visible {
      outline: none;
    }
    .open:focus-visible::after {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .client {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      pointer-events: none;
    }
    .client-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .where {
      position: relative;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      pointer-events: none;
    }
    .where mf-matter-ref {
      pointer-events: auto;
      flex: none;
    }
    .matter-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .avatar {
      flex: none;
      display: inline-grid;
      place-items: center;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 50%;
      background: var(--mf-selected-bg);
      color: var(--mf-primary);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
    }
    .avatar--none {
      background: var(--mf-surface-alt);
      color: var(--mf-text-muted);
    }
    .who {
      font-size: var(--mf-fs-sm);
    }
    .who-text {
      color: var(--mf-text-muted);
    }
    .mark {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      flex: none;
      padding: 0 var(--mf-s2);
      border: 1px solid currentColor;
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      line-height: 1.5;
      white-space: nowrap;
    }
    .mark--ooo {
      position: relative;
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
    }
    .mark--sens {
      color: var(--mf-text);
      background: var(--mf-surface-alt);
    }
    .meta {
      justify-content: space-between;
      flex-wrap: wrap;
    }
    .due-chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      font-size: var(--mf-fs-sm);
      color: var(--mf-text);
      white-space: nowrap;
    }
    .due-chip--overdue {
      color: var(--mf-due-overdue);
      font-weight: 700;
    }
    .due-chip--soon {
      color: var(--mf-due-soon);
      font-weight: 700;
    }
    .due-chip--asap {
      color: var(--mf-asap);
      font-weight: 700;
    }
    .due-chip--closed {
      color: var(--mf-text-muted);
    }
    .due-date {
      color: var(--mf-text-muted);
      font-weight: 400;
    }
    .progress {
      font-size: var(--mf-fs-xs);
      color: var(--mf-text-muted);
    }
    .track {
      flex: 1;
      height: 6px;
      background: var(--mf-surface-alt);
      border: 1px solid var(--mf-border-strong);
      border-radius: 3px;
      overflow: hidden;
    }
    .fill {
      display: block;
      height: 100%;
      background: var(--mf-primary);
    }
    .steps {
      font-variant-numeric: tabular-nums;
    }
    /* Compact density: reference, one-line title, matter, priority, due and assignee; client, progress and the long labels go. */
    :host(.compact) .body {
      gap: 2px;
      padding-block: var(--mf-s1);
    }
    :host(.compact) .open {
      -webkit-line-clamp: 1;
      line-clamp: 1;
    }
    :host(.compact) .client,
    :host(.compact) .progress,
    :host(.compact) .mark-text {
      display: none;
    }
    :host(.compact) .who-text,
    :host(.compact) .who {
      font-size: var(--mf-fs-xs);
    }
  `,
})
export class SwimlaneCardView {
  private readonly auth = inject(AuthStore);

  readonly card = input.required<SwimlaneCard>();
  readonly density = input<Density>('comfortable');
  /** The title button's tab stop: 0 for the one card the lane's arrow keys rest on, -1 otherwise. */
  readonly tabStop = input<number>(-1);
  /** True where the title button is the lane's navigation item (list modes); in the tree the treeitem around the card is. */
  readonly navigable = input(true);

  /** The card with an inline edit applied (optimistic, then the server's answer, or the old one back). */
  readonly cardChange = output<SwimlaneCard>();
  readonly open = output<SwimlaneCard>();

  protected readonly row = computed<TaskQueueRow>(() => cardToRow(this.card()));
  protected readonly closed = computed(() =>
    ['COMPLETED', 'CANCELLED'].includes(this.card().status),
  );
  protected readonly colors = computed(() => priorityColors(this.card().priority.color));
  protected readonly percent = computed(() => {
    const c = this.card();
    return c.stepsTotal > 0 ? Math.round((c.stepsResolved / c.stepsTotal) * 100) : 0;
  });
  protected readonly outOfOffice = computed(
    () => this.card().assignee?.availability.state === 'OUT_OF_OFFICE',
  );
  protected readonly oooTitle = computed(() => {
    const a = this.card().assignee?.availability;
    if (!a) return '';
    return a.note ? `Out of office: ${a.note}` : 'Out of office';
  });
  protected readonly initialsOf = initials;

  protected editable(field: 'status' | 'priority' | 'assignee'): boolean {
    return canEditField(field, this.row(), (p) => this.auth.has(p));
  }

  protected changed(row: TaskQueueRow): void {
    this.cardChange.emit(applyRow(this.card(), row));
  }
}
