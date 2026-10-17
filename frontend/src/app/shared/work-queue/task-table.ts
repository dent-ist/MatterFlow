import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  effect,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { NavigationEnd, Params, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { DrillReturn, DrillSource } from './drill';
import { LoadState } from '../ui/data-table';
import { ScrollArea } from '../ui/fixed-page';
import { ColumnFilterRow } from '../filters/column-filter-row';
import { ListFilters } from '../filters/list-filters';
import { GridBody } from '../ui/grid-body';
import { MyWorkBucketCounts, TaskQueueRow } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { mfDate } from '../../core/time/time';
import { TaskTypeIcon } from '../icons/task-type-icon';
import { DueStatePipe } from '../pipes/due-label.pipe';
import { MfDatePipe } from '../pipes/mf-date.pipe';
import { MatterRef } from '../ui/matter-ref';
import { PriorityBadge } from '../ui/priority-badge';
import { CopyPart } from '../ui/copy-parts';
import { StatusBadge } from '../ui/status-badge';
import { RowGroup, groupRows } from './due-groups';
import { GroupHeader } from './group-header';
import { HoldNote, holdTitle } from './hold-note';
import { WORK_COLUMNS, ColumnDef, Density } from './column-prefs';
import { InlineField, canEditField } from './inline-edit';
import { CLOSED_STATUSES, SortDirection } from './queue-filters';
import { hasStepLink, stepLinkLabel, stepQueryParams } from './step-link';
import { RowEdit } from './row-edit';
import { KeyboardShortcuts, isEditable } from '../layout/keyboard-shortcuts';
import { isShortcut } from '../layout/shortcut-registry';
import { TaskSkeleton } from './task-skeleton';

/**
 * Box widths (px) under which the lowest-priority columns drop out. Workflow progress folds under the title below 1060 px, not the 1180
 * px the review proposed: A2 and A3 (WP6b) took Matter out of the default set, so the title keeps 370 px at the 1098 px box of a 1366
 * laptop, and folding there would add a third line to every row (nine rows would become seven).
 */
const PROGRESS_FOLDS_BELOW = 1060;
const MATTER_HIDES_BELOW = 960;
const PROJECT_HIDES_BELOW = 900;
/** Tablets (viewport 640 to 1023 px): Pod, Age and the dates drop out, Ref moves under the title, and the due cell takes two lines. */
const BAND_DROPS = ['pod', 'age', 'created', 'updated'];
const TABLET = '(min-width: 640px) and (max-width: 1023.98px)';
const NARROW_BELOW = 760;

/**
 * The table behind Task Queue, My Work and Pod Work (UX 5.2, S02 to S04): a real `<table>` with sortable header buttons that
 * announce `aria-sort`, a due cell that never relies on color alone (ASAP label with a bolt icon, "Overdue 4d" with an alert icon, "Due today"
 * with a clock icon, "Tomorrow"), a sensitive-matter marker, and five skeleton rows while loading. The title opens the Task. Status, Priority and Assignee are inline editors for users who may change them (`mf-row-edit`).
 */
@Component({
  selector: 'mf-task-table',
  imports: [
    TaskTypeIcon,
    RouterLink,
    MatterRef,
    DueStatePipe,
    MfDatePipe,
    PriorityBadge,
    RowEdit,
    ScrollArea,
    StatusBadge,
    HoldNote,
    GroupHeader,
    GridBody,
    ColumnFilterRow,
    NgTemplateOutlet,
    TaskSkeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: './task-table.scss',
  template: `
    <p class="wt-hint" data-scroll-hint [class.wt-hint--show]="overflowing()">
      Scroll sideways to see every column.
    </p>
    <div
      #wrap
      class="wt-wrap"
      [mfScrollArea]="listLabel()"
      [resetKey]="resetKey()"
      [class.wt-dim]="loading() && rows().length > 0"
    >
      <table
        class="wt"
        [class.wt--compact]="density() === 'compact'"
        [class.wt--narrow]="narrow()"
        [attr.aria-busy]="loading() ? 'true' : null"
      >
        <caption class="mf-sr-only">
          {{
            caption()
          }}
        </caption>
        <thead>
          <tr>
            @for (col of shownColumns(); track col.key) {
              <th scope="col" [attr.aria-sort]="ariaSort(col)" [attr.data-col]="col.key">
                @if (col.sortField) {
                  <button type="button" class="wt-sort" (click)="sortChange.emit(col.sortField)">
                    {{ col.label }}
                    <i class="pi" [class]="sortIcon(col)" aria-hidden="true"></i>
                  </button>
                } @else {
                  {{ col.label }}
                }
              </th>
            }
            @if (showAssign()) {
              <th scope="col" class="wt-actions">Actions</th>
            }
          </tr>
          @if (filters(); as f) {
            @if (f.rowVisible()) {
              <tr
                mfColumnFilterRow
                [id]="filterRowId()"
                [filters]="f"
                [columns]="filterColumns()"
              ></tr>
            }
          }
        </thead>
        <!-- The headers and the filter row stay in every state: loading, error and empty are rows of the body. -->
        <tbody
          mfGridBody
          noun="tasks"
          [state]="gridState()"
          [empty]="rows().length === 0 && !skeleton()"
          [filtered]="filtered()"
          [emptyText]="emptyText()"
          [emptyParts]="emptyParts()"
          [columns]="columnCount()"
          (retry)="retry.emit()"
          (clear)="clearFilters.emit()"
        >
          @if (skeleton()) {
            <tr>
              <td
                class="mf-sr-only"
                [attr.colspan]="columnCount()"
                role="status"
                aria-busy="true"
                data-loading
              >
                Loading tasks...
              </td>
            </tr>
            @for (n of skeletonRows; track n) {
              <tr mfTaskSkeleton [columns]="shownKeyList()" [showAssign]="showAssign()"></tr>
            }
          }
          @for (row of rows(); track row.taskId; let i = $index) {
            @if (groupAt().get(i); as group) {
              <tr
                mfGroupHeader
                [group]="group"
                [columns]="columnCount()"
                [collapsed]="collapsedGroups().has(group.key)"
                (toggled)="toggleGroup(group.key)"
              ></tr>
            }
            <tr
              [hidden]="hiddenAt()[i]"
              [class.wt-row--overdue]="row.isOverdue"
              [class.wt-row--leaving]="leaving().has(row.taskId)"
              [attr.data-leaving]="leaving().has(row.taskId) ? 'true' : null"
              [attr.data-task]="row.taskNumber"
            >
              @for (col of shownColumns(); track col.key) {
                <td [attr.data-col]="col.key">
                  @switch (col.key) {
                    @case ('ref') {
                      @if (row.status === 'ON_HOLD') {
                        <mf-hold-note
                          kind="mark"
                          [holdReason]="row.holdReason"
                          [truncated]="row.holdReasonTruncated"
                        />
                      }
                      <span class="wt-mono">{{ row.taskNumber }}</span>
                      @if (isNew(row)) {
                        <span
                          class="wt-newdot"
                          role="img"
                          aria-label="New"
                          title="Assigned since your last visit"
                          data-new-dot
                        ></span>
                      }
                    }
                    @case ('title') {
                      <div class="wt-titlecell">
                        <span class="wt-typeicon" [attr.title]="row.taskTypeName" data-type-icon>
                          <mf-task-type-icon [iconKey]="row.taskTypeIconKey" size="sm" />
                        </span>
                        <div class="wt-titlebody">
                          <a
                            class="wt-title"
                            [routerLink]="['/tasks', row.taskId]"
                            [queryParams]="linkParams()"
                            [state]="linkState()"
                            [attr.data-task-id]="row.taskId"
                            [attr.title]="titleTip(row)"
                            (click)="drillOut($event, row)"
                            >{{ row.title }}</a
                          >
                          @if (row.status === 'ON_HOLD' && row.holdReason) {
                            <mf-hold-note
                              kind="hint"
                              [holdReason]="row.holdReason"
                              [truncated]="row.holdReasonTruncated"
                            />
                          }
                          @if (isNew(row) || !hideContext() || foldProgress() || foldRef()) {
                            <span class="wt-subline">
                              @if (isNew(row)) {
                                <span
                                  class="wt-new"
                                  data-new-marker
                                  title="Assigned since your last visit"
                                  >New</span
                                >
                              }
                              @if (!hideContext() || foldRef()) {
                                <span class="wt-sub" data-title-context [attr.title]="context(row)">
                                  @if (foldRef()) {
                                    @if (row.status === 'ON_HOLD') {
                                      <mf-hold-note
                                        kind="mark"
                                        [holdReason]="row.holdReason"
                                        [truncated]="row.holdReasonTruncated"
                                      />
                                    }
                                    <span class="wt-mono" data-sub-task>{{ row.taskNumber }}</span>
                                    @if (isNew(row)) {
                                      <span
                                        class="wt-newdot"
                                        role="img"
                                        aria-label="New"
                                        title="Assigned since your last visit"
                                        data-new-dot
                                      ></span>
                                    }
                                    @if (!hideContext()) {
                                      ·
                                    }
                                  }
                                  @if (refInSub() && !hideContext()) {
                                    @if (auth.canLink('matter')) {
                                      <a
                                        class="wt-mono wt-subref"
                                        data-sub-ref
                                        [routerLink]="['/matters', row.matterId]"
                                        >{{ row.matterRef }}</a
                                      >
                                    } @else {
                                      <span class="wt-mono" data-sub-ref>{{ row.matterRef }}</span>
                                    }
                                    ·
                                  }
                                  @if (!hideContext()) {
                                    {{ row.clientName }} · {{ row.matterName }}
                                  }
                                </span>
                              }
                            </span>
                          }
                          @if (foldProgress() && row.workflow.stepsTotal > 0) {
                            <span
                              class="wt-sub wt-stepline"
                              data-title-progress
                              [attr.title]="progressTitle(row)"
                              ><ng-container
                                [ngTemplateOutlet]="prog"
                                [ngTemplateOutletContext]="{ $implicit: row }"
                            /></span>
                          }
                        </div>
                      </div>
                    }
                    @case ('matter') {
                      <mf-matter-ref
                        [value]="row.matterRef"
                        [link]="auth.canLink('matter') ? ['/matters', row.matterId] : null"
                        [copy]="false"
                        [hint]="row.matterName"
                      />
                      @if (row.matterIsSensitive) {
                        <i
                          class="pi pi-exclamation-triangle wt-sensitive"
                          role="img"
                          aria-label="Sensitive matter"
                          title="Sensitive matter"
                        ></i>
                      }
                    }
                    @case ('client') {
                      {{ row.clientName }}
                    }
                    @case ('project') {
                      {{ row.projectName ?? '-' }}
                    }
                    @case ('type') {
                      {{ row.taskTypeName }}
                    }
                    @case ('workflow') {
                      {{ row.workflowName }}
                    }
                    @case ('progress') {
                      <span class="wt-progress" [attr.title]="progressTitle(row)"
                        ><ng-container
                          [ngTemplateOutlet]="prog"
                          [ngTemplateOutletContext]="{ $implicit: row }"
                      /></span>
                    }
                    @case ('priority') {
                      @if (editable('priority', row)) {
                        <mf-row-edit
                          field="priority"
                          [row]="row"
                          (rowChange)="rowChange.emit($event)"
                        />
                      } @else {
                        <mf-priority-badge
                          [priorityId]="row.priority.priorityId"
                          [label]="row.priority.label"
                          [color]="row.priority.color"
                          [muted]="closed(row)"
                        />
                      }
                    }
                    @case ('pod') {
                      @if (row.assignedPod; as pod) {
                        <span class="wt-clip" [attr.title]="pod.name">{{ pod.name }}</span>
                      } @else {
                        <span class="wt-muted">No pod</span>
                      }
                    }
                    @case ('assignee') {
                      @if (editable('assignee', row)) {
                        <mf-row-edit
                          field="assignee"
                          [row]="row"
                          (rowChange)="rowChange.emit($event)"
                        />
                      } @else if (row.assignedUser; as user) {
                        <span class="wt-clip" [attr.title]="user.displayName">
                          {{ user.displayName }}
                          @if (!user.isActive) {
                            <span class="wt-muted">(inactive)</span>
                          }
                        </span>
                      } @else {
                        <span class="wt-unassigned">Unassigned</span>
                      }
                    }
                    @case ('creator') {
                      {{ row.createdBy?.displayName ?? '-' }}
                    }
                    @case ('requestor') {
                      {{ row.requestorName }}
                    }
                    @case ('due') {
                      @let due = row | dueState: row.status;
                      @if (closed(row)) {
                        <span class="wt-due wt-due--closed">{{
                          due.kind === 'asap' ? '-' : due.dateText
                        }}</span>
                      } @else if (due.kind === 'asap') {
                        <span class="wt-asap" [title]="due.tooltip">
                          <i class="pi pi-bolt" aria-hidden="true"></i>ASAP
                        </span>
                      } @else if (row.isOverdue || due.kind === 'overdue') {
                        <span class="wt-due wt-due--overdue">
                          <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                          {{ due.dateText }} · <strong>{{ due.badge ?? 'Overdue' }}</strong>
                        </span>
                      } @else if (due.daysUntil === 0) {
                        <span class="wt-due wt-due--soon">
                          <i class="pi pi-clock" aria-hidden="true"></i>
                          {{ due.dateText }} · <strong>Due today</strong>
                        </span>
                      } @else if (due.daysUntil === 1) {
                        <span class="wt-due">{{ due.dateText }} · <strong>Tomorrow</strong></span>
                      } @else {
                        <span class="wt-due" [class.wt-due--closed]="due.kind === 'closed'">{{
                          due.dateText
                        }}</span>
                      }
                    }
                    @case ('status') {
                      <div [attr.title]="holdTitle(row)">
                        @if (editable('status', row)) {
                          <mf-row-edit
                            field="status"
                            [row]="row"
                            (rowChange)="rowChange.emit($event)"
                          />
                        } @else {
                          <mf-status-badge [code]="row.status" [label]="row.statusLabel" />
                        }
                        @if (row.status === 'ON_HOLD' && row.holdReason) {
                          <mf-hold-note
                            [holdReason]="row.holdReason"
                            [truncated]="row.holdReasonTruncated"
                            [quiet]="density() === 'compact'"
                          />
                        }
                      </div>
                    }
                    @case ('closed') {
                      @if (row.closedAtUtc) {
                        <span class="wt-closed" [attr.title]="closedTitle(row.closedAtUtc)">{{
                          dayOf(row.closedAtUtc)
                        }}</span>
                      } @else {
                        <span aria-label="Not closed">-</span>
                      }
                    }
                    @case ('age') {
                      <span class="wt-age" [attr.title]="ageTitle(row)">{{ ageDays(row) }} d</span>
                    }
                    @case ('created') {
                      {{ dayOf(row.createdAtUtc) }}
                    }
                    @case ('updated') {
                      {{ row.updatedAtUtc | mfDate }}
                    }
                  }
                </td>
              }
              @if (showAssign()) {
                <td class="wt-actions">
                  @if (canAssign(row)) {
                    <button
                      type="button"
                      class="wt-action"
                      (click)="assignToMe.emit(row)"
                      [attr.aria-label]="'Assign to me, ' + row.taskNumber"
                    >
                      Assign to me
                    </button>
                  }
                </td>
              }
            </tr>
          }
          <span mfEmptyAction><ng-content select="[empty-action]" /></span>
        </tbody>
      </table>
      <ng-template #prog let-row>
        @if (row.workflow.stepsTotal === 0) {
          -
        } @else if (!row.workflow.currentStepName) {
          <span class="wt-muted">All steps resolved</span>
        } @else {
          {{ row.workflow.stepsResolved }} of {{ row.workflow.stepsTotal }} done ·
          @if (stepLinked(row)) {
            <a
              class="wt-steplink"
              data-step-link
              [routerLink]="['/tasks', row.taskId]"
              [queryParams]="stepQuery(row)"
              [state]="linkState()"
              (click)="drillOut($event, row)"
              [attr.aria-label]="stepLabel(row)"
              >{{ row.workflow.currentStepName }}</a
            >
          } @else {
            {{ row.workflow.currentStepName }}
          }
        }
      </ng-template>
      @if (nearEmpty()) {
        <div class="wt-near" role="note" aria-live="polite" data-near-empty>
          <ng-content select="[near-empty]" />
        </div>
      }
    </div>
  `,
})
export class TaskTable {
  private readonly clock = inject(Clock);
  protected readonly auth = inject(AuthStore);
  private readonly shortcuts = inject(KeyboardShortcuts);
  /** The title link to go back to when a menu opened with S or P closes (#181). */
  private returnTo: HTMLElement | null = null;
  protected readonly holdTitle = holdTitle;
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly router = inject(Router);
  private readonly drill = inject(DrillReturn);
  /** The address of the list as it is now: the exact view the task page offers to return to. */
  private readonly here = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  private readonly wrap = viewChild<ElementRef<HTMLElement>>('wrap');

  /** Width of the table's box in px (0 until measured); narrow boxes drop the lowest-priority columns instead of scrolling. */
  protected readonly boxWidth = signal(0);

  /** True on a tablet-sized window (640 to 1023 px): see `BAND_DROPS`. Phones keep the sideways-scrolling table until the cards of M11. */
  private readonly tablet = signal(false);

  /** True while the table is wider than its box, so the "Scroll sideways" hint only appears when it is needed (UAT2-21). */
  protected readonly overflowing = signal(false);

  readonly rows = input.required<readonly TaskQueueRow[]>();
  /** Keys of the columns to show, in table order. */
  readonly columns = input.required<readonly string[]>();
  readonly caption = input('Tasks');
  /** Anything that changes the rows without a navigation (a local page, sort or filter): the grid goes back to the top. */
  readonly resetKey = input<unknown>(undefined);
  /** The scrolling region's name: "Task Queue list". */
  protected readonly listLabel = computed(() => `${this.caption()} list`);
  /** loading: skeleton text row (dimmed rows while refreshing); error: the error row; ready: the rows or the empty row. */
  readonly state = input<LoadState>('ready');
  /** The column filters; the row shows under the headers while it is open. */
  readonly filters = input<ListFilters | null>(null);
  readonly filterRowId = input('work-filter-row');
  /** True while a filter is active: an empty list then says "No tasks match these filters". */
  readonly filtered = input(false);
  readonly emptyText = input('No tasks yet.');
  /** The empty text with links in it (replaces `emptyText`). */
  readonly emptyParts = input<readonly CopyPart[] | null>(null);
  /** Show the projected `[near-empty]` note directly under the last row. */
  readonly nearEmpty = input(false);
  readonly density = input<Density>('comfortable');
  /** Current API sort field; null shows no sort indicator (the default order applies). */
  readonly sort = input<string | null>(null);
  readonly dir = input<SortDirection | null>(null);
  /** Adds an "Assign to me" action to unassigned open rows. */
  readonly showAssign = input(false);
  /** Instant (ms) of the user's previous visit; tasks created after it get a "New" marker. Null shows no markers (My Work only). */
  readonly newSince = input<number | null>(null);
  /** The list the table belongs to: its task links carry `?from=` and the view to return to (M7). Null on record pages. */
  readonly from = input<DrillSource | null>(null);

  protected readonly linkParams = computed(() => (this.from() ? { from: this.from() } : null));
  protected readonly linkState = computed(() =>
    this.from() ? { returnTo: this.here() } : undefined,
  );

  /**
   * Keyboard model of the grid (#181). It reads only stable hooks, not the cell layout: `tr[data-task]` for a row, `a.wt-title` for the
   * title link, `td[data-col=status|priority] [data-inline-trigger]` for the menus. Down/Up move between the title links of the rows;
   * J and K do the same and S and P open the Status and Priority menus, but only while the keyboard shortcuts are on (single-character
   * keys, WCAG 2.1.4). Keys typed into a control, or inside an open menu, are left alone. Enter is the link's own.
   */
  private readonly onGridKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return;
    const target = event.target as HTMLElement;
    if (isEditable(target) || target.closest('.im-pop')) return;
    const row = target.closest<HTMLElement>('tr[data-task]');
    if (!row) return;
    const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';
    const character = !arrow;
    if (character && (!this.shortcuts.enabled() || this.shortcuts.sequencePending())) return;
    const step = isShortcut('row-next', event) ? 1 : isShortcut('row-prev', event) ? -1 : 0;
    if (step !== 0) {
      const rows = Array.from(
        row.closest('tbody')?.querySelectorAll<HTMLElement>('tr[data-task]') ?? [],
      );
      const next = rows[rows.indexOf(row) + step];
      event.preventDefault();
      next?.querySelector<HTMLElement>('a.wt-title')?.focus();
      return;
    }
    const menu = isShortcut('row-status', event)
      ? 'status'
      : isShortcut('row-priority', event)
        ? 'priority'
        : null;
    if (!menu) return;
    const trigger = row.querySelector<HTMLElement>(`td[data-col="${menu}"] [data-inline-trigger]`);
    // No trigger means the person may not change it (or the column is folded away): the key does nothing.
    if (!trigger) return;
    event.preventDefault();
    this.returnTo = row.querySelector<HTMLElement>('a.wt-title');
    trigger.click();
  };

  /** After a menu opened with S or P closes, focus goes back to the row's title link, so J and K keep working. */
  private readonly onGridFocus = (event: FocusEvent): void => {
    const back = this.returnTo;
    if (!back) return;
    const target = event.target as HTMLElement;
    if (target.closest('.im-pop')) return;
    this.returnTo = null;
    if (!target.matches('[data-inline-trigger]') || target.closest('tr') !== back.closest('tr'))
      return;
    // The trigger gets focus while the menu is still being removed; once that has settled, and nothing else (a dialog) took the focus,
    // the row's title link is where the person continues.
    setTimeout(() => {
      if (
        document.activeElement === target &&
        !document.querySelector('.im-pop') &&
        back.isConnected
      ) {
        back.focus();
      }
    });
  };

  /** A plain click on a title remembers the row, so Back can focus it again. */
  protected drillOut(event: MouseEvent, row: TaskQueueRow): void {
    const from = this.from();
    if (!from || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    this.drill.leave(from, row.taskId);
  }
  /** Leave out the "Client · Matter" line under the title: on a Matter's or Project's own page the header already says it. */
  readonly hideContext = input(false);
  /**
   * My Work grouped by due: the size of every bucket for the whole filtered set. The rows are in the server's bucket order, so each group's
   * header goes where its bucket starts. Null: no grouping.
   */
  readonly groupBuckets = input<MyWorkBucketCounts | null>(null);
  /** Index of the first row on the page within the whole result ((page - 1) x page size), to place the headers. */
  readonly groupOffset = input(0);

  protected readonly groups = computed<RowGroup[]>(() =>
    groupRows(this.rows().length, this.groupOffset(), this.groupBuckets()),
  );
  protected readonly groupAt = computed(() => new Map(this.groups().map((g) => [g.start, g])));
  /** Groups the person collapsed (not remembered: a fresh visit or a new grouping shows everything). */
  protected readonly collapsedGroups = signal<ReadonlySet<string>>(new Set());
  /** Per row index: true while its group is collapsed. */
  protected readonly hiddenAt = computed(() => {
    const hidden: boolean[] = new Array(this.rows().length).fill(false);
    const collapsed = this.collapsedGroups();
    for (const g of this.groups()) {
      if (collapsed.has(g.key)) hidden.fill(true, g.start, g.start + g.length);
    }
    return hidden;
  });

  protected toggleGroup(key: string): void {
    this.collapsedGroups.update((set) => {
      const next = new Set(set);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  readonly sortChange = output<string>();
  readonly retry = output<void>();
  readonly clearFilters = output<void>();
  /** The keys of the columns that are on screen now (the table folds some away on a narrow window). */
  readonly columnsShown = output<string[]>();
  readonly assignToMe = output<TaskQueueRow>();
  /** A row changed from the table (an inline edit): the optimistic row, then the server's row or the original again. */
  /** Tasks that just left the tab: their rows show muted until the page removes them. */
  readonly leaving = input<ReadonlySet<number>>(new Set());
  readonly rowChange = output<TaskQueueRow>();

  constructor() {
    const destroyRef = inject(DestroyRef);
    // Collapsed groups are forgotten when the grouping goes away (not persisted).
    effect(() => {
      if (this.groupBuckets() === null) this.collapsedGroups.set(new Set());
    });
    effect(() => {
      const keys = this.shownKeys();
      this.columnsShown.emit(keys === '' ? [] : keys.split(','));
    });
    afterNextRender(() => {
      const el = this.wrap()?.nativeElement;
      if (!el) return;
      const measure = () => {
        this.boxWidth.set(el.clientWidth);
        this.tablet.set(typeof matchMedia === 'function' && matchMedia(TABLET).matches);
        this.overflowing.set(el.scrollWidth > el.clientWidth + 1);
      };
      measure();
      // The keyboard model listens on the scrolling region (rows come and go under it).
      el.addEventListener('keydown', this.onGridKey);
      el.addEventListener('focusin', this.onGridFocus);
      destroyRef.onDestroy(() => {
        el.removeEventListener('keydown', this.onGridKey);
        el.removeEventListener('focusin', this.onGridFocus);
      });
      // Where the grid overflows sideways the filters move into the sheet.
      this.filters()?.watchOverflow(el);
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      const table = el.querySelector('table');
      if (table) observer.observe(table);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected readonly loading = computed(() => this.state() === 'loading');
  /** Rows kept while a refresh runs are shown dimmed; loading only replaces an empty list, an error always replaces the rows. */
  protected readonly gridState = computed<LoadState>(() => {
    const state = this.state();
    // A failed load never leaves old rows under the message (G6): the error is the body.
    if (state === 'error') return 'error';
    // Loading is the skeleton rows of this table, so the grid body shows its own rows for it (G4).
    return this.rows().length > 0 || state === 'loading' ? 'ready' : state;
  });
  /**
   * Columns in table order. Below the width thresholds the lowest-priority columns drop out so Status and Due never scroll out of view
   * (UXR4-02): Workflow progress moves under the title below 1100 px, the Matter column goes below 960 px (the line under the title
   * still names the client and matter) and Project below 900 px. Unknown width (0, before the first measure or in tests) shows everything.
   */
  protected readonly shownColumns = computed<ColumnDef[]>(() => {
    const wanted = new Set(this.columns());
    const width = this.boxWidth();
    const dropped = new Set<string>();
    if (width > 0 && width < PROGRESS_FOLDS_BELOW) dropped.add('progress');
    if (width > 0 && width < MATTER_HIDES_BELOW && !this.hideContext()) dropped.add('matter');
    if (width > 0 && width < PROJECT_HIDES_BELOW) dropped.add('project');
    if (width > 0 && this.tablet()) BAND_DROPS.forEach((k) => dropped.add(k));
    if (this.foldRef()) dropped.add('ref');
    return WORK_COLUMNS.filter((c) => (c.locked || wanted.has(c.key)) && !dropped.has(c.key));
  });

  /** On a tablet the task number moves under the title, so the title is the first (sticky) column and Status, Priority and Due fit (BUG-14). */
  protected readonly foldRef = computed(() => this.boxWidth() > 0 && this.tablet());

  /**
   * Below 760 px (tablets and phones) the due cell breaks into the date and the "Overdue 4d" label, and the title link is 24 px high: a
   * narrow title sits right above the line under it, and two stacked links need their centres 24 px apart (WCAG 2.2 2.5.8).
   */
  protected readonly narrow = computed(() => this.boxWidth() > 0 && this.boxWidth() < NARROW_BELOW);

  /** First load and tab change: the body shows skeleton rows (headers and filter row stay) instead of a one-row message (G4). */
  protected readonly skeleton = computed(
    () => this.state() === 'loading' && this.rows().length === 0,
  );
  protected readonly skeletonRows = [1, 2, 3, 4, 5, 6, 7, 8];
  protected readonly shownKeyList = computed(() => this.shownColumns().map((c) => c.key));

  protected readonly columnCount = computed(
    () => this.shownColumns().length + (this.showAssign() ? 1 : 0),
  );
  /** The filter row's cells: the shown columns, and an empty cell for the Actions column. */
  protected readonly filterColumns = computed(() => [
    ...this.shownColumns().map((c) => c.key),
    ...(this.showAssign() ? ['actions'] : []),
  ]);
  private readonly shownKeys = computed(() =>
    this.shownColumns()
      .map((c) => c.key)
      .join(','),
  );

  /** True when the Workflow progress column was asked for but is folded under the title because the table is narrow. */
  protected readonly foldProgress = computed(
    () =>
      this.columns().includes('progress') && !this.shownColumns().some((c) => c.key === 'progress'),
  );

  protected ariaSort(col: ColumnDef): 'ascending' | 'descending' | 'none' | null {
    if (!col.sortField) return null;
    if (this.sort() !== col.sortField) return 'none';
    return this.effectiveDir(col.sortField) === 'desc' ? 'descending' : 'ascending';
  }

  protected sortIcon(col: ColumnDef): string {
    const aria = this.ariaSort(col);
    return aria === 'ascending'
      ? 'pi-sort-amount-up-alt'
      : aria === 'descending'
        ? 'pi-sort-amount-down'
        : 'pi-sort-alt';
  }

  private effectiveDir(field: string): SortDirection {
    return (
      this.dir() ?? (['created', 'completed', 'closed', 'updated'].includes(field) ? 'desc' : 'asc')
    );
  }

  protected editable(field: InlineField, row: TaskQueueRow): boolean {
    return canEditField(field, row, (p) => this.auth.has(p));
  }

  protected canAssign(row: TaskQueueRow): boolean {
    return !row.assignedUser && ['NEW', 'IN_PROGRESS', 'ON_HOLD'].includes(row.status);
  }

  protected isNew(row: TaskQueueRow): boolean {
    const since = this.newSince();
    // When the person was handed the Task, not when it was created (a Task created last week and assigned today is new to them).
    return since !== null && new Date(row.assignedAtUtc ?? row.createdAtUtc).getTime() > since;
  }

  /** The current step is a link to the task's Workflow section for an open task that names its step (M12.3). */
  protected stepLinked(row: TaskQueueRow): boolean {
    return hasStepLink(row);
  }

  protected stepQuery(row: TaskQueueRow): Params {
    const from = this.from();
    return from
      ? { ...stepQueryParams(row.workflow.currentStepId as number), from }
      : stepQueryParams(row.workflow.currentStepId as number);
  }

  protected stepLabel(row: TaskQueueRow): string {
    return stepLinkLabel(row);
  }

  /**
   * The tooltip of a title (also its accessible description): the whole title, which the one-line cell may cut with an ellipsis; in the
   * Compact density the line under it is hidden, so it carries that line and the progress as well.
   */
  protected titleTip(row: TaskQueueRow): string {
    if (this.density() !== 'compact') return row.title;
    const line = this.context(row);
    const parts = [row.title, this.foldRef() ? line : `${row.taskNumber} · ${line}`];
    if (this.foldProgress() && row.workflow.stepsTotal > 0) parts.push(this.progressTitle(row));
    return parts.join('\n');
  }

  protected progressTitle(row: TaskQueueRow): string {
    const w = row.workflow;
    if (w.stepsTotal === 0) return 'No workflow steps';
    return w.currentStepName
      ? `${w.stepsResolved} of ${w.stepsTotal} steps done. Current step: ${w.currentStepName}`
      : 'All steps resolved';
  }

  protected closed(row: TaskQueueRow): boolean {
    return CLOSED_STATUSES.includes(row.status);
  }

  /** The full line under the title: "46044-00001 · Client · Matter" (the reference only where there is no Matter column). */
  protected context(row: TaskQueueRow): string {
    const text = `${row.clientName} · ${row.matterName}`;
    const line = this.refInSub() ? `${row.matterRef} · ${text}` : text;
    return this.foldRef() ? `${row.taskNumber} · ${line}` : line;
  }

  /** The matter reference leads the line under the title unless the Matter column shows it (A2). */
  protected readonly refInSub = computed(
    () => !this.shownColumns().some((c) => c.key === 'matter'),
  );

  protected ageDays(row: TaskQueueRow): number {
    const end = row.closedAtUtc ? new Date(row.closedAtUtc).getTime() : this.clock.now().getTime();
    return Math.max(0, Math.floor((end - new Date(row.createdAtUtc).getTime()) / 86_400_000));
  }

  /** Age tooltip: when it was created (local zone), and for a closed task how long it took. */
  protected ageTitle(row: TaskQueueRow): string {
    const created = `Created ${mfDate(row.createdAtUtc, this.zone, 'datetime')}`;
    return row.closedAtUtc ? `Took ${this.ageDays(row)} d. ${created}` : created;
  }

  /** The tooltip of a closed date: the time and zone ("Oct 16, 2026, 3:00 PM EDT"). */
  protected closedTitle(instant: string): string {
    return mfDate(instant, this.zone, 'datetime');
  }

  protected dayOf(instant: string): string {
    return mfDate(instant, this.zone, 'date');
  }
}
