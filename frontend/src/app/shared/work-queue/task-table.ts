import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  TemplateRef,
  DestroyRef,
  ElementRef,
  Injector,
  ViewContainerRef,
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
import { TaskQueueRow } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { mfDate } from '../../core/time/time';
import { TaskTypeIcon } from '../icons/task-type-icon';
import { DueCell } from './due-cell';
import { MfDatePipe } from '../pipes/mf-date.pipe';
import { MatterCell } from './matter-cell';
import { PriorityBadge } from '../ui/priority-badge';
import { CopyPart } from '../ui/copy-parts';
import { StatusBadge } from '../ui/status-badge';
import { BucketCounts, RowGroup, groupRows } from './due-groups';
import { GroupHeader } from './group-header';
import { HoldNote, holdTitle } from './hold-note';
import { WORK_COLUMNS, ColumnDef, Density } from './column-prefs';
import {
  ASSIGNEE_WITH_LINK_PX,
  ColumnWidthMap,
  ROOT_PX,
  columnWidthRem,
  pxToRem,
  remToPx,
  tableMinRem,
  widthVars,
} from './column-widths';
import { narrowDrops } from './narrow-columns';
import { RESIZE_MIN_VIEWPORT_PX, ResizeSide, resizeSide, startColumnResize } from './column-resize';
import type { ColumnMenu } from './column-menu';
import {
  ColumnAction,
  ColumnMenuId,
  columnMenuItems,
  steppedPx,
  widthMessage,
} from './column-menu-items';
import { InlineField, canEditField } from './inline-edit';
import { CLOSED_STATUSES, SortDirection } from './queue-filters';
import { hasStepLink, stepLinkLabel, stepQueryParams } from './step-link';
import { RowEdit } from './row-edit';
import { KeyboardShortcuts, isEditable } from '../layout/keyboard-shortcuts';
import { isShortcut } from '../layout/shortcut-registry';
import { TaskSkeleton } from './task-skeleton';
import { PHONE_CARDS_QUERY, TaskCardList } from './task-card-list';

const NARROW_BELOW = 760;
/** A touch held this long on a header opens its column menu (PM ruling on #207). */
const LONG_PRESS_MS = 500;

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
    MatterCell,
    DueCell,
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
    TaskCardList,
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
      @if (cardMode()) {
        <mf-task-card-list
          [rows]="rows()"
          [columns]="columns()"
          [state]="gridState()"
          [skeleton]="skeleton()"
          [loading]="loading()"
          [empty]="rows().length === 0 && !skeleton()"
          [filtered]="filtered()"
          [emptyText]="emptyText()"
          [emptyParts]="emptyParts()"
          [emptyAction]="emptyActionTpl()"
          [assignLink]="assignLink()"
          [newSince]="newSince()"
          [leaving]="leaving()"
          [linkParams]="linkParams()"
          [linkState]="linkState()"
          [groups]="groups()"
          [hiddenAt]="hiddenAt()"
          [collapsed]="collapsedGroups()"
          (rowChange)="rowChange.emit($event)"
          (toggled)="toggleGroup($event)"
          (drilled)="drillOut($event.event, $event.row)"
          (retry)="retry.emit()"
          (clear)="clearFilters.emit()"
        />
      } @else {
        <table
          class="wt"
          [class.wt--compact]="density() === 'compact'"
          [class.wt--narrow]="narrow()"
          [class.wt--scroll]="overflowing()"
          [style]="tableVars()"
          [attr.aria-busy]="loading() ? 'true' : null"
        >
          <!-- Fixed layout (#200): one <col> per shown column, shared by the header, the filter row, the group rows and the skeleton. The
             Title has no width and takes the rest; the widths are the --w-<key> variables of the table (colWidths). -->
          <colgroup>
            @for (col of shownColumns(); track col.key) {
              <col
                [attr.data-col]="col.key"
                [style.width]="col.fill ? null : 'var(--w-' + col.key + ')'"
              />
            }
          </colgroup>
          <caption class="mf-sr-only">
            {{
              caption()
            }}
          </caption>
          <thead>
            <tr>
              @for (col of shownColumns(); track col.key) {
                <!-- Column menu (#207): the Menu key or Shift+F10 on the sort button (or on the header of a column that cannot sort), a right
                   click, or a long press. A sortable header adds no tab stop; one that cannot sort becomes one only while the menu is on. -->
                <th
                  scope="col"
                  [attr.aria-sort]="ariaSort(col)"
                  [attr.data-col]="col.key"
                  [attr.tabindex]="!col.sortField && menuOn() ? 0 : null"
                  [attr.data-col-focus]="!col.sortField && menuOn() ? '' : null"
                  (keydown)="headerKey($event, col)"
                  (contextmenu)="headerContext($event, col)"
                  (pointerdown)="headerPress($event, col)"
                >
                  @if (col.sortField) {
                    <button
                      type="button"
                      class="wt-sort"
                      data-col-focus
                      [attr.title]="sortTip(col)"
                      (click)="sortChange.emit(col.sortField)"
                    >
                      {{ col.label }}
                      <i class="pi" [class]="sortIcon(col)" aria-hidden="true"></i>
                    </button>
                  } @else {
                    {{ col.label }}
                  }
                  @if (resizeSideOf(col); as side) {
                    <!-- Drag handle (#204): decorative, outside the tab order; the keyboard alternative is the Columns panel (#206). -->
                    <span
                      class="wt-resize"
                      aria-hidden="true"
                      [attr.data-resize]="col.key"
                      [attr.data-side]="side"
                      title="Double-click to fit the rows on this page"
                      (pointerdown)="resizeStart($event, col, side)"
                      (dblclick)="fitNow(col)"
                    ></span>
                  }
                </th>
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
                <tr mfTaskSkeleton [columns]="shownKeyList()"></tr>
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
                          </div>
                        </div>
                      }
                      @case ('matter') {
                        <mf-matter-cell
                          [row]="row"
                          [link]="auth.canLink('matter')"
                          [compact]="density() === 'compact'"
                        />
                      }
                      @case ('client') {
                        <span class="wt-clip" [attr.title]="row.clientName">{{
                          row.clientName
                        }}</span>
                      }
                      @case ('project') {
                        <span class="wt-clip" [attr.title]="row.projectName">{{
                          row.projectName ?? '-'
                        }}</span>
                      }
                      @case ('type') {
                        <span class="wt-clip" [attr.title]="row.taskTypeName">{{
                          row.taskTypeName
                        }}</span>
                      }
                      @case ('workflow') {
                        <span class="wt-clip" [attr.title]="row.workflowName">{{
                          row.workflowName
                        }}</span>
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
                            [selfAssign]="true"
                            [assignLink]="assignLink()"
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
                        <span class="wt-clip" [attr.title]="row.createdBy?.displayName">{{
                          row.createdBy?.displayName ?? '-'
                        }}</span>
                      }
                      @case ('requestor') {
                        <span class="wt-clip" [attr.title]="row.requestorName">{{
                          row.requestorName
                        }}</span>
                      }
                      @case ('due') {
                        <mf-due-cell
                          [due]="row"
                          [status]="row.status"
                          [layout]="density() === 'compact' ? 'inline' : 'two-line'"
                        />
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
                        <span class="wt-age" [attr.title]="ageTitle(row)"
                          >{{ ageDays(row) }} d</span
                        >
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
              </tr>
            }
            <span mfEmptyAction><ng-container [ngTemplateOutlet]="emptyAction" /></span>
          </tbody>
        </table>
      }
      <ng-template #emptyAction><ng-content select="[empty-action]" /></ng-template>
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
  private readonly emptyAction = viewChild<TemplateRef<unknown>>('emptyAction');
  protected readonly emptyActionTpl = computed(() => this.emptyAction() ?? null);

  /**
   * The work lists (not the Matter and Project grids) are cards below 640 px (#192). The page turns it on; the viewport decides. Where
   * `matchMedia` does not exist (unit tests) the table is shown.
   */
  readonly phoneCards = input(false);
  private readonly phone = signal(false);
  protected readonly cardMode = computed(() => this.phoneCards() && this.phone());

  /** Width of the table's box in px (0 until measured); narrow boxes drop the lowest-priority columns instead of scrolling. */
  protected readonly boxWidth = signal(0);

  /** The real root font size in px (text-only zoom grows it); the widths are rem. */
  private readonly rootPx = signal(ROOT_PX);

  /** True while the table is wider than its box, so the "Scroll sideways" hint only appears when it is needed (UAT2-21). */
  protected readonly overflowing = signal(false);

  readonly rows = input.required<readonly TaskQueueRow[]>();
  /** Keys of the columns to show, in table order. */
  readonly columns = input.required<readonly string[]>();
  /**
   * Column widths set by the user (the resize package, #203 to #207): a sparse map of column key to width in rem. A column without an
   * entry has its `ColumnDef.width`; entries are clamped to the column's min and max; the Title takes the rest (see `column-widths.ts`).
   */
  readonly colWidths = input<ColumnWidthMap>({});
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
  /** Shows the "Assign to me" link-button next to "Unassigned" in the Assignee cell (Pod Work). */
  readonly assignLink = input(false);
  /** Instant (ms) of the user's previous visit; tasks created after it get a "New" marker. Null shows no markers (My Work only). */
  readonly newSince = input<number | null>(null);
  /** The list the table belongs to: its task links carry `?from=` and the view to return to (M7). Null on record pages. */
  readonly from = input<DrillSource | null>(null);

  protected readonly linkParams = computed(() => (this.from() ? { from: this.from() } : null));
  protected readonly linkState = computed(() =>
    this.from() ? { returnTo: this.here() } : undefined,
  );

  /**
   * Keyboard model of the grid (#181). It reads only stable hooks, not the cell layout: `[data-task]` for a row (a `tr`, or a card `li`), `a.wt-title` for the
   * title link, `[data-col=status|priority] [data-inline-trigger]` for the menus. Down/Up move between the title links of the rows;
   * J and K do the same and S and P open the Status and Priority menus, but only while the keyboard shortcuts are on (single-character
   * keys, WCAG 2.1.4). Keys typed into a control, or inside an open menu, are left alone. Enter is the link's own.
   */
  private readonly onGridKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return;
    const target = event.target as HTMLElement;
    if (isEditable(target) || target.closest('.im-pop')) return;
    const row = target.closest<HTMLElement>('[data-task]');
    if (!row) return;
    const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';
    const character = !arrow;
    if (character && (!this.shortcuts.enabled() || this.shortcuts.sequencePending())) return;
    const step = isShortcut('row-next', event) ? 1 : isShortcut('row-prev', event) ? -1 : 0;
    if (step !== 0) {
      const rows = Array.from(
        row.closest('tbody, ul')?.querySelectorAll<HTMLElement>('[data-task]:not([hidden])') ?? [],
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
    const trigger = row.querySelector<HTMLElement>(`[data-col="${menu}"] [data-inline-trigger]`);
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
    if (
      !target.matches('[data-inline-trigger]') ||
      target.closest('[data-task]') !== back.closest('[data-task]')
    )
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
  /** Hide the Matter and Client columns: on a Matter's or Project's own page the header already says it. */
  readonly hideContext = input(false);
  /**
   * My Work grouped by due: the size of every bucket for the whole filtered set. The rows are in the server's bucket order, so each group's
   * header goes where its bucket starts. Null: no grouping.
   */
  readonly groupBuckets = input<BucketCounts | null>(null);
  /** The direction the buckets are listed in: the Task Queue's Due sort descending mirrors them (My Work always ascending). */
  readonly groupDir = input<'asc' | 'desc'>('asc');
  /** Index of the first row on the page within the whole result ((page - 1) x page size), to place the headers. */
  readonly groupOffset = input(0);

  protected readonly groups = computed<RowGroup[]>(() =>
    groupRows(this.rows().length, this.groupOffset(), this.groupBuckets(), this.groupDir()),
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
  /** A drag on a header edge ended with a new width (#204): the page stores it (`WorkWidths`). `defaultRem` is the default in force. */
  readonly columnResized = output<{ key: string; rem: number; defaultRem?: number }>();
  /** What the column menu asks of the page (#207): sort one way, hide a column, forget a stored width. Widths go through `columnResized`. */
  readonly columnAction = output<ColumnAction>();
  /** A polite message for the list's live region ("Due column 144 pixels"). */
  readonly announce = output<string>();
  /** False where the page stores no widths (a record page): no handles' double-click and no column menu. */
  readonly widthsEditable = input(true);
  readonly retry = output<void>();
  readonly clearFilters = output<void>();
  /** The keys of the columns that are on screen now (the table folds some away on a narrow window). */
  readonly columnsShown = output<string[]>();
  /** A row changed from the table (an inline edit): the optimistic row, then the server's row or the original again. */
  /** Tasks that just left the tab: their rows show muted until the page removes them. */
  readonly leaving = input<ReadonlySet<number>>(new Set());
  readonly rowChange = output<TaskQueueRow>();

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.menuRef?.destroy());
    if (typeof matchMedia === 'function') {
      const query = matchMedia(PHONE_CARDS_QUERY);
      const follow = (): void => this.phone.set(query.matches);
      follow();
      query.addEventListener?.('change', follow);
      destroyRef.onDestroy(() => query.removeEventListener?.('change', follow));
    }
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
        const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
        this.rootPx.set(root > 0 ? root : ROOT_PX);
        this.overflowing.set(el.scrollWidth > el.clientWidth + 1);
        this.wide.set(window.innerWidth >= RESIZE_MIN_VIEWPORT_PX);
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
   * Columns in table order. The one narrow-box rule (#201, `narrow-columns.ts`): while the Title would be narrower than 200 px, the
   * columns flagged `autoHide` drop out, least important first; the rest scrolls sideways with a sticky Ref. Unknown width (0, before the
   * first measure or in tests) shows everything.
   */
  protected readonly shownColumns = computed<ColumnDef[]>(() => {
    const wanted = new Set(this.columns());
    const hide = this.hideContext();
    const wide = WORK_COLUMNS.filter(
      (c) =>
        (c.locked || wanted.has(c.key)) && !(hide && (c.key === 'matter' || c.key === 'client')),
    );
    const dropped = narrowDrops(wide, this.boxWidth(), this.rootPx(), this.effectiveWidths());
    return wide.filter((c) => !dropped.has(c.key));
  });

  /**
   * Below 760 px (tablets and phones) the title link is 24 px high: a
   * narrow title sits right above the line under it, and two stacked links need their centres 24 px apart (WCAG 2.2 2.5.8).
   */
  protected readonly narrow = computed(() => this.boxWidth() > 0 && this.boxWidth() < NARROW_BELOW);

  /** First load and tab change: the body shows skeleton rows (headers and filter row stay) instead of a one-row message (G4). */
  protected readonly skeleton = computed(
    () => this.state() === 'loading' && this.rows().length === 0,
  );
  protected readonly skeletonRows = [1, 2, 3, 4, 5, 6, 7, 8];
  protected readonly shownKeyList = computed(() => this.shownColumns().map((c) => c.key));

  /** The `--w-<key>` custom properties read by the `<col>` elements, and the narrowest the table may get before the grid scrolls. */
  protected readonly tableVars = computed(() => {
    const widths = this.effectiveWidths();
    return {
      ...widthVars(this.shownColumns(), widths),
      '--wt-min': `${tableMinRem(this.shownColumns(), widths)}rem`,
    };
  });
  /** The widths in force: the user's, over the default of a grid whose Assignee cell holds "Unassigned" and the "Assign to me" button (Pod Work). */
  private readonly effectiveWidths = computed<ColumnWidthMap>(() =>
    this.assignLink()
      ? { assignee: pxToRem(ASSIGNEE_WITH_LINK_PX), ...this.colWidths() }
      : this.colWidths(),
  );

  protected readonly columnCount = computed(() => this.shownColumns().length);
  /** The filter row's cells: the shown columns. */
  protected readonly filterColumns = computed(() => this.shownColumns().map((c) => c.key));
  private readonly shownKeys = computed(() =>
    this.shownColumns()
      .map((c) => c.key)
      .join(','),
  );

  // ---- fit and the column menu (#205, #207)

  private readonly injector = inject(Injector);
  /** False on a phone (below 640 px the grid is cards or scrolls: no resizing, no menu). */
  private readonly wide = signal(true);
  protected readonly menuOn = computed(() => this.widthsEditable() && this.wide());
  protected readonly menu = signal<{
    col: ColumnDef;
    x: number;
    y: number;
    trigger: HTMLElement;
  } | null>(null);

  private widthPx(col: ColumnDef): number {
    return Math.round(remToPx(columnWidthRem(col, this.effectiveWidths())));
  }
  private defaultPx(col: ColumnDef): number {
    return this.assignLink() && col.key === 'assignee' ? ASSIGNEE_WITH_LINK_PX : col.width;
  }

  protected readonly menuItems = computed(() => {
    const m = this.menu();
    if (!m) return [];
    return columnMenuItems(m.col, {
      currentPx: this.widthPx(m.col),
      stored: m.col.key in this.colWidths(),
      canHide: true,
    });
  });

  /** Stores a width (px at the default zoom) through the page and tells the list's live region. */
  private applyWidth(col: ColumnDef, px: number): void {
    this.columnResized.emit({
      key: col.key,
      rem: pxToRem(px),
      defaultRem:
        this.assignLink() && col.key === 'assignee' ? pxToRem(this.defaultPx(col)) : undefined,
    });
    this.announce.emit(widthMessage(col, px));
  }

  /** Double-click on a handle, or "Fit to content": the widest of the header and the rows on this page (`column-fit.ts`, loaded now). */
  protected fitNow(col: ColumnDef): void {
    const table = this.wrap()?.nativeElement.querySelector('table');
    if (!table || !this.menuOn()) return;
    void import('./column-fit').then(({ fitColumn }) => {
      const px = fitColumn(table, col, this.rootPx());
      if (px !== null) this.applyWidth(col, px);
    });
  }

  private headerControl(th: HTMLElement): HTMLElement {
    return th.querySelector<HTMLElement>('[data-col-focus]') ?? th;
  }

  private readonly vcr = inject(ViewContainerRef);
  private menuRef: ComponentRef<ColumnMenu> | null = null;

  /** Opens the menu; its component loads on first use (a small chunk, not part of the first page load). */
  private openMenu(col: ColumnDef, th: HTMLElement, x: number, y: number): void {
    if (!this.menuOn()) return;
    const mine = { col, x, y, trigger: this.headerControl(th) };
    this.menu.set(mine);
    void import('./column-menu').then(({ ColumnMenu }) => {
      // Closed, or opened somewhere else, while the chunk was loading.
      if (this.menu() !== mine) return;
      this.menuRef?.destroy();
      const ref = this.vcr.createComponent(ColumnMenu);
      ref.setInput('items', this.menuItems());
      ref.setInput('label', col.label);
      ref.setInput('x', x);
      ref.setInput('y', y);
      ref.setInput('trigger', mine.trigger);
      ref.instance.picked.subscribe((id) => this.menuPick(id));
      ref.instance.closed.subscribe((focus) => this.closeMenu(focus));
      this.menuRef = ref;
    });
  }

  /** Menu key or Shift+F10 on the header's own control (its sort button, or the header of a column that cannot sort). */
  protected headerKey(event: KeyboardEvent, col: ColumnDef): void {
    if (!this.menuOn() || !isShortcut('column-menu', event)) return;
    const th = event.currentTarget as HTMLElement;
    const control = this.headerControl(th);
    if (event.target !== control) return;
    event.preventDefault();
    const box = control.getBoundingClientRect();
    this.openMenu(col, th, box.left, box.bottom + 2);
  }

  /** Right click (and the long press of some touch browsers): the menu opens at the pointer and the browser's menu stays away. */
  protected headerContext(event: MouseEvent, col: ColumnDef): void {
    if (!this.menuOn()) return;
    event.preventDefault();
    if (this.menu()?.col.key === col.key && event.detail === 0) return;
    this.openMenu(col, event.currentTarget as HTMLElement, event.clientX, event.clientY);
  }

  /** Long press (touch, 500 ms) on a header; moving more than 10 px or lifting first is a scroll or a tap (a tap still sorts). */
  protected headerPress(event: PointerEvent, col: ColumnDef): void {
    if (event.pointerType !== 'touch' || !this.menuOn()) return;
    if ((event.target as HTMLElement).closest('.wt-resize')) return;
    const th = event.currentTarget as HTMLElement;
    const x0 = event.clientX;
    const y0 = event.clientY;
    const stop = (): void => {
      clearTimeout(timer);
      th.removeEventListener('pointermove', move);
      th.removeEventListener('pointerup', stop);
      th.removeEventListener('pointercancel', stop);
    };
    const move = (e: PointerEvent): void => {
      if (Math.hypot(e.clientX - x0, e.clientY - y0) > 10) stop();
    };
    const timer = setTimeout(() => {
      stop();
      // The release after a long press must not also sort.
      const swallow = (e: Event): void => {
        e.stopPropagation();
        e.preventDefault();
        th.removeEventListener('click', swallow, true);
      };
      th.addEventListener('click', swallow, true);
      setTimeout(() => th.removeEventListener('click', swallow, true), 800);
      this.openMenu(col, th, x0, y0);
    }, LONG_PRESS_MS);
    th.addEventListener('pointermove', move);
    th.addEventListener('pointerup', stop);
    th.addEventListener('pointercancel', stop);
  }

  protected closeMenu(returnFocus: boolean): void {
    const m = this.menu();
    this.menu.set(null);
    this.menuRef?.destroy();
    this.menuRef = null;
    if (returnFocus) m?.trigger.focus();
  }

  protected menuPick(id: ColumnMenuId): void {
    const m = this.menu();
    if (!m) return;
    const { col, trigger } = m;
    this.closeMenu(false);
    switch (id) {
      case 'sort-asc':
      case 'sort-desc':
        if (col.sortField)
          this.columnAction.emit({
            kind: 'sort',
            field: col.sortField,
            dir: id === 'sort-asc' ? 'asc' : 'desc',
          });
        break;
      case 'widen':
      case 'narrow':
        this.applyWidth(col, steppedPx(col, this.widthPx(col), id === 'widen' ? 1 : -1));
        break;
      case 'fit':
        this.fitNow(col);
        break;
      case 'reset':
        this.columnAction.emit({ kind: 'reset', key: col.key });
        this.announce.emit(widthMessage(col, this.defaultPx(col)));
        break;
      case 'hide': {
        const shown = this.shownColumns();
        const at = shown.findIndex((c) => c.key === col.key);
        const next = shown[at + 1] ?? shown[at - 1];
        this.columnAction.emit({ kind: 'hide', key: col.key });
        this.announce.emit(`${col.label} column hidden`);
        // The header that had the focus goes away: continue on its neighbour.
        afterNextRender(
          () => {
            const th = next
              ? this.wrap()?.nativeElement.querySelector<HTMLElement>(
                  `thead tr:first-child th[data-col="${next.key}"]`,
                )
              : null;
            if (th) this.headerControl(th).focus();
          },
          { injector: this.injector },
        );
        return;
      }
    }
    trigger.focus();
  }

  protected resizeSideOf(col: ColumnDef): ResizeSide | null {
    return this.widthsEditable() ? resizeSide(col, this.shownColumns()) : null;
  }

  protected resizeStart(event: PointerEvent, col: ColumnDef, side: ResizeSide): void {
    const handle = event.currentTarget as HTMLElement;
    const table = handle.closest('table');
    if (!table || !this.widthsEditable()) return;
    startColumnResize({
      handle,
      event,
      table,
      def: col,
      side,
      rootPx: this.rootPx(),
      commit: (rem) =>
        this.columnResized.emit({
          key: col.key,
          rem,
          defaultRem:
            this.assignLink() && col.key === 'assignee'
              ? pxToRem(ASSIGNEE_WITH_LINK_PX)
              : undefined,
        }),
    });
  }

  protected ariaSort(col: ColumnDef): 'ascending' | 'descending' | 'none' | null {
    if (!col.sortField) return null;
    if (this.sort() !== col.sortField) return 'none';
    return this.effectiveDir(col.sortField) === 'desc' ? 'descending' : 'ascending';
  }

  /** The Due header says where ASAP goes while the list is sorted by it (ASAP counts as the earliest: first ascending, last descending). */
  protected sortTip(col: ColumnDef): string | null {
    if (col.sortField !== 'due' || this.sort() !== 'due') return null;
    return this.effectiveDir('due') === 'desc' ? 'Due (ASAP last)' : 'Due (ASAP first)';
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

  /** The tooltip of a title (also its accessible description): the whole title, which the cell may cut with an ellipsis. */
  protected titleTip(row: TaskQueueRow): string {
    return row.title;
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
