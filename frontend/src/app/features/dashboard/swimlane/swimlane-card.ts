import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SwimlaneCard, TaskQueueRow } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { DueStatePipe } from '../../../shared/pipes/due-label.pipe';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { PriorityBadge, levelBars, priorityColors } from '../../../shared/ui/priority-badge';
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
    NgTemplateOutlet,
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
    <ng-template #dueChip>
      @if (closed()) {
        <span class="due-chip due-chip--closed">
          <i class="pi pi-check" aria-hidden="true"></i>
          {{ c.status === 'CANCELLED' ? 'Cancelled' : 'Done' }}
          {{
            compact()
              ? short(c.completedAtUtc | mfDate: 'date')
              : (c.completedAtUtc | mfDate: 'date')
          }}
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
          <span class="due-chip">{{ compact() ? short(due.dateText) : due.dateText }}</span>
        }
      }
    </ng-template>
    @if (compact()) {
      <article
        class="card card--line"
        [class.card--overdue]="c.isOverdue"
        [class.card--closed]="closed()"
        [attr.data-card]="c.taskId"
        [attr.data-task]="c.ref"
      >
        <span
          class="bar"
          aria-hidden="true"
          data-level-glyph
          [style.background]="colors().bg"
          [style.box-shadow]="'inset 0 0 0 1px ' + colors().fg"
          [style.color]="colors().fg"
        >
          @for (on of bars(); track $index) {
            <span class="lvl-bar" [class.on]="on"></span>
          }
        </span>
        <div class="line">
          <span class="type" [title]="c.taskTypeName">
            <mf-task-type-icon [iconKey]="c.taskTypeIconKey" size="sm" />
            <span class="sr-only">{{ c.taskTypeName }}</span>
          </span>
          <a class="ref mf-ref" [routerLink]="['/tasks', c.taskId]" data-card-ref>{{ c.ref }}</a>
          <h4 class="title">
            <button
              type="button"
              class="open"
              data-card-open
              [id]="'sl-open-' + c.taskId"
              [attr.data-nav]="navigable() ? 'card:' + c.taskId : null"
              [attr.tabindex]="tabStop()"
              [attr.aria-label]="
                c.title + ', ' + c.ref + ', ' + c.priority.label + ' priority. Open details'
              "
              [title]="tooltip()"
              (click)="open.emit(c)"
            >
              {{ c.title }}
            </button>
          </h4>
          @if (showWho()) {
            <span class="avatar" data-avatar [class.avatar--none]="!c.assignee">
              <span aria-hidden="true">{{
                c.assignee ? initialsOf(c.assignee.displayName) : '-'
              }}</span>
              <span class="sr-only">{{ c.assignee?.displayName ?? 'Unassigned' }}</span>
              @if (outOfOffice()) {
                <span class="ooo-dot" data-ooo [title]="oooTitle()">
                  <i class="pi pi-calendar-minus" aria-hidden="true"></i>
                  <span class="sr-only">Out of office</span>
                </span>
              }
            </span>
          }
          <span class="due" data-due>
            <ng-container *ngTemplateOutlet="dueChip" />
          </span>
        </div>
      </article>
    } @else {
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
              [title]="tooltip()"
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
            @if (!showWhere() && c.matterIsSensitive) {
              <span class="mark mark--sens" data-sensitive title="Sensitive matter">
                <i class="pi pi-lock" aria-hidden="true"></i>
                <span class="mark-text">Sensitive</span>
              </span>
            }
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

          @if (showWhere()) {
            <div class="where" data-where>
              <span class="where-text"
                ><span class="client-name" data-client>{{ c.clientName }}</span> /
                <span class="matter-name">{{ c.matterName }}</span></span
              >
              @if (c.matterIsSensitive) {
                <span class="mark mark--sens" data-sensitive title="Sensitive matter">
                  <i class="pi pi-lock" aria-hidden="true"></i>
                  <span class="mark-text">Sensitive</span>
                </span>
              }
            </div>
          }

          @if (showWho()) {
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
          }

          <div class="meta">
            <span class="due" data-due>
              <ng-container *ngTemplateOutlet="dueChip" />
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
    }
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
    .card--closed .where {
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
    .where {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      pointer-events: none;
    }
    .where-text {
      flex: 1;
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
    /* Compact density (W1): one line of 44 px: priority bar with the level glyph, type icon, number, title (one line), assignee initials
       with the Out of office flag, due chip. Client, matter, menus and progress are in the tooltip and the drawer. In a narrow lane (under
       300 px, a laptop at 1366 px) the icons of the due chip give their room to the title. */
    :host(.compact) {
      container-type: inline-size;
    }
    .card--line {
      height: 44px;
      box-sizing: border-box;
      align-items: stretch;
    }
    .card--line .bar {
      display: flex;
      flex-direction: column-reverse;
      justify-content: center;
      align-items: center;
      gap: 1px;
      width: 14px;
    }
    .lvl-bar {
      width: 8px;
      height: 3px;
      border: 1px solid currentColor;
      box-sizing: border-box;
    }
    .lvl-bar.on {
      background: currentColor;
    }
    .line {
      flex: 1;
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
      padding: 0 var(--mf-s2) 0 var(--mf-s2);
    }
    .line > :not(.title) {
      flex: none;
      position: relative;
      pointer-events: none;
    }
    .line > .ref {
      pointer-events: auto;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      font-size: var(--mf-fs-xs);
    }
    .line > .title {
      flex: 1;
      min-width: 3rem;
    }
    .line .title {
      font-size: var(--mf-fs-sm);
      line-height: 1.5;
    }
    .line .open {
      display: block;
      width: 100%;
      -webkit-line-clamp: unset;
      line-clamp: unset;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      overflow-wrap: normal;
      min-height: 24px;
      line-height: 24px;
    }
    .line .avatar {
      width: 1.25rem;
      height: 1.25rem;
      font-size: 0.625rem;
    }
    .line .avatar:has(.ooo-dot) {
      margin-left: 6px;
    }
    .ooo-dot {
      position: absolute;
      left: -6px;
      top: -6px;
      display: grid;
      place-items: center;
      width: 12px;
      height: 12px;
      border: 1px solid var(--mf-warning);
      border-radius: 50%;
      background: var(--mf-warning-bg);
      color: var(--mf-warning);
      font-size: 7px;
    }
    .line .due-chip {
      font-size: var(--mf-fs-xs);
    }
    .line .due-date {
      display: none;
    }
    @container (max-width: 300px) {
      .line {
        gap: var(--mf-s1);
      }
      .line .due-chip i {
        display: none;
      }
    }
  `,
})
export class SwimlaneCardView {
  private readonly auth = inject(AuthStore);
  private readonly lookups = inject(LookupStore);

  readonly card = input.required<SwimlaneCard>();
  readonly density = input<Density>('comfortable');
  /** The lane is grouped by client / matter: the group is the client and the matter, so the card does not repeat them. */
  readonly hideWhere = input(false);
  /** The lane is grouped by assignee: the group is the person, so the card does not repeat them. */
  readonly hideWho = input(false);
  /** The title button's tab stop: 0 for the one card the lane's arrow keys rest on, -1 otherwise. */
  readonly tabStop = input<number>(-1);
  /** True where the title button is the lane's navigation item (list modes); in the tree the treeitem around the card is. */
  readonly navigable = input(true);

  /** The card with an inline edit applied (optimistic, then the server's answer, or the old one back). */
  readonly cardChange = output<SwimlaneCard>();
  readonly open = output<SwimlaneCard>();

  protected readonly compact = computed(() => this.density() === 'compact');
  protected readonly showWhere = computed(() => !this.hideWhere());
  protected readonly showWho = computed(() => !this.hideWho());
  protected readonly bars = computed(() => {
    const n = levelBars(this.lookups.priorityRank(this.card().priority.priorityId));
    return [0, 1, 2, 3].map((i) => i < n);
  });
  /** Everything the one-line card leaves out, as the hover text of the title button (and of the comfortable card's client line). */
  protected readonly tooltip = computed(() => {
    const c = this.card();
    const parts = [`${c.clientName} / ${c.matterRef} ${c.matterName}`];
    if (this.compact()) {
      parts.push(`${c.priority.label} priority`, c.assignee?.displayName ?? 'Unassigned');
      if (this.outOfOffice()) parts.push(this.oooTitle());
    }
    return parts.join('\n');
  });
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
  /** A date without its year ("Oct 18"), for the one-line card. */
  protected short(text: string): string {
    return text.replace(/,?\s*\d{4}$/, '');
  }

  protected editable(field: 'status' | 'priority' | 'assignee'): boolean {
    return canEditField(field, this.row(), (p) => this.auth.has(p));
  }

  protected changed(row: TaskQueueRow): void {
    this.cardChange.emit(applyRow(this.card(), row));
  }
}
