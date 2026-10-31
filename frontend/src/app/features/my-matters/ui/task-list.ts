import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink, convertToParamMap } from '@angular/router';
import { TaskQueueClient, TaskQueueRow } from '../../../api/generated/api-client';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { DueCell, describeDueCell } from '../../../core/time/time';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { TaskTypeChip } from '../../../shared/ui/task-type-chip';
import { FilterChip, FilterChips } from '../../../shared/ui/filter-chips';
import { GridFrame } from '../../../shared/ui/grid-frame';
import { Pager } from '../../../shared/ui/pager';
import { PriorityPill } from '../../../shared/ui/priority-pill';
import { StatusChip } from '../../../shared/ui/status-chip';
import { parseQueueState, queueArgs } from '../../../shared/work-queue/queue-filters';
import { MyMattersFocus } from '../focus';
import { MmFilters, commonArgs } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { MmApi } from './mm-api';
import { SHOW_FILTERS, STATUS_FILTERS, ShowFilter, StatusFilter, TaskCounts } from './mm-models';

export const GRID_PAGE_SIZE = 25;
const DEFAULT_SORT = 'attention';
/** The icons of the Status chips (the mockup's: layers for All open, then the status icons). */
const STATUS_ICONS: Record<StatusFilter, string> = {
  open: 'pi-clone',
  new: 'pi-circle',
  progress: 'pi-play-circle',
  hold: 'pi-pause-circle',
  completed: 'pi-check-circle',
  cancelled: 'pi-times-circle',
};
const DESC_FIRST = new Set(['created', 'updated', 'completed', 'closed']);

/** The statuses the Status chip asks for (the Show rules, with their own status limits, are applied by the server through `show`). */
export function statusCodes(status: StatusFilter): string[] {
  return [
    ...(STATUS_FILTERS.find((s) => s.key === status)?.codes ?? ['NEW', 'IN_PROGRESS', 'ON_HOLD']),
  ];
}

/**
 * The task grid of the Overview (`mf-mm-task-list`, epic #953 UI-13): the Status chip row with counts and the Show filter (they combine), the urgency order by default, sortable
 * headings (`aria-sort`), a pager, and a status chip that carries "step n of m", the hold reason and the dates. The frame fills the height it is given and scrolls inside itself
 * (sticky heading row, pager pinned); below 769 px the rows are cards and the page scrolls. Columns hide with the width of the frame (container queries): Priority moves into the
 * task cell under 640 px, Assignee goes under 780 px, the step bar needs 900 px. Each task is listed once and opens on its own page.
 */
@Component({
  selector: 'mf-mm-task-list',
  imports: [
    Dropdown,
    FilterChips,
    GridFrame,
    Pager,
    PriorityPill,
    RouterLink,
    StatusChip,
    TaskTypeChip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <mf-grid-frame scrollLabel="Open tasks" [resetKey]="resetKey()">
      <div frameHead class="hd">
        <h2 class="ttl">
          Tasks
          @if (counts(); as c) {
            <span class="tot">{{ total() }}</span>
          }
        </h2>
        <div class="tools">
          <mf-dropdown
            class="show"
            buttonId="mm-show"
            label="Show"
            prefix="Show:"
            size="sm"
            [items]="showOptions()"
            [value]="show()"
            (valueChange)="showChange.emit($any($event))"
            [countOnButton]="true"
            neutralValue="everything"
            [panelWidth]="260"
          />
          @if (total() > 1) {
            <button
              type="button"
              class="urg"
              data-sort-urgency
              aria-label="Sort by urgency, most urgent first"
              [attr.aria-pressed]="sort() === 'attention'"
              (click)="chosen.set(null)"
            >
              <i class="pi pi-sort-amount-down" aria-hidden="true"></i> Urgency
            </button>
          }
        </div>
      </div>
      <div frameStatus class="strow">
        <span class="strow-l" id="mm-status-l">Status</span>
        <mf-filter-chips
          label="Status"
          [chips]="statusChips()"
          [value]="status()"
          (valueChange)="statusChange.emit($any($event))"
        />
      </div>

      @if (loader.state() === 'error') {
        <p class="msg" role="alert">
          Couldn't load tasks.
          <button type="button" class="lnk" (click)="loader.load()">Retry</button>
        </p>
      } @else if (loader.state() === 'loading' && rows().length === 0) {
        <p class="msg" role="status">Loading tasks</p>
      } @else if (rows().length === 0) {
        <p class="msg" data-empty>{{ emptyText() }}</p>
      } @else {
        <table class="tt" [attr.aria-busy]="loader.busy()">
          <caption class="sr">
            Tasks
          </caption>
          <colgroup>
            <col />
            <col class="c-st" />
            <col class="c-prio" />
            <col class="c-asg" />
            <col class="c-due" />
          </colgroup>
          <thead>
            <tr>
              @for (h of heads; track h.key) {
                <th scope="col" [class]="h.cls" [attr.aria-sort]="ariaSort(h.sort)">
                  <button
                    type="button"
                    class="sort"
                    [attr.data-sort]="h.sort"
                    (click)="sortBy(h.sort)"
                  >
                    {{ h.label }}
                    <i class="pi" [class]="sortIcon(h.sort)" aria-hidden="true"></i>
                  </button>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (t of rows(); track t.taskId) {
              <tr [attr.data-task]="t.taskId">
                <td class="td-t" data-cell="title">
                  <div class="cell">
                    <mf-task-type-chip
                      [iconKey]="t.taskTypeIconKey"
                      [colourKey]="t.taskTypeColourKey"
                      [typeId]="t.taskTypeId"
                      [name]="t.taskTypeName"
                    />
                    <span class="tcell">
                      <a class="lnk" [routerLink]="['/tasks', t.taskId]" data-task-link>
                        <span class="ref">{{ t.taskNumber }}</span> {{ t.title }}
                      </a>
                      @if (showMatter()) {
                        <span class="mt">{{ t.matterName }}</span>
                      }
                    </span>
                    @if (t.atRisk && (t.status === 'NEW' || t.status === 'IN_PROGRESS')) {
                      <mf-priority-pill kind="risk" />
                    }
                    <span class="ppl">
                      @if (pill(t); as p) {
                        <mf-priority-pill [kind]="p" />
                      }
                    </span>
                  </div>
                </td>
                <td class="c-st" data-cell="status">
                  <mf-status-chip
                    [code]="t.status"
                    [stepNumber]="step(t)"
                    [stepTotal]="t.workflow.stepsTotal"
                    [showBar]="true"
                    [detail]="statusDetail(t)"
                  />
                </td>
                <td class="c-prio" data-cell="priority">
                  @if (pill(t); as p) {
                    <mf-priority-pill [kind]="p" [label]="t.priority.label" />
                  } @else {
                    <span class="sr">{{ t.priority.label }} priority</span>
                  }
                </td>
                <td class="c-asg" data-cell="assignee">
                  @if (t.assignedUser?.displayName ?? t.assignedPod?.name; as who) {
                    <div class="cell">
                      <span class="av" aria-hidden="true">{{ initials(who) }}</span>
                      <span>{{ who }}</span>
                    </div>
                  } @else {
                    <span class="una"
                      ><i class="pi pi-user-minus" aria-hidden="true"></i>Unassigned</span
                    >
                  }
                </td>
                <td class="c-due" data-cell="due">
                  @let d = due(t);
                  <span [class]="'due ' + d.tone" [attr.title]="d.tooltip">
                    <span class="l1">
                      @if (d.tone === 'overdue') {
                        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                      } @else if (d.tone === 'today' || d.tone === 'soon') {
                        <i class="pi pi-clock" aria-hidden="true"></i>
                      }
                      {{ d.line1 }}
                    </span>
                    @if (dueNote(t, d); as note) {
                      <span class="rel">{{ note }}</span>
                    }
                  </span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
      <div frameFoot>
        @if (total() > pageSize) {
          <mf-pager
            [page]="page()"
            [pageSize]="pageSize"
            [pageSizes]="[]"
            [total]="total()"
            (pageChange)="goPage($event)"
          />
        }
      </div>
    </mf-grid-frame>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    mf-grid-frame {
      height: 100%;
    }
    .hd {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--mf-s2) var(--mf-s4);
      padding: var(--mf-s3) var(--mf-s4);
    }
    .ttl {
      margin: 0;
      font-size: var(--mf-fs-lg);
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .tot {
      padding: 0 var(--mf-s2);
      border-radius: 999px;
      background: var(--mf-surface-alt);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
    }
    .tools {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      margin-left: auto;
      flex-wrap: wrap;
    }
    .urg,
    .lnk-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-height: 32px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-text-muted);
      font: inherit;
      cursor: pointer;
    }
    .urg[aria-pressed='true'] {
      color: var(--mf-text);
      font-weight: 700;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .strow {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s4) var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
    }
    .strow-l {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    @container gc (max-width: 800px) {
      .strow-l {
        display: none;
      }
    }
    .msg {
      margin: var(--mf-s5) var(--mf-s4);
      color: var(--mf-text-muted);
    }
    .lnk {
      color: var(--mf-link);
      text-decoration: none;
      background: none;
      border: 0;
      font: inherit;
      padding: 0;
      cursor: pointer;
    }
    .lnk:hover {
      text-decoration: underline;
    }
    .tt {
      table-layout: fixed;
    }
    .tt td {
      height: 44px;
      padding: 0 var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
      vertical-align: middle;
    }
    .td-t {
      min-width: 0;
      line-height: 1.3;
    }
    .td-t .lnk {
      font-weight: 600;
    }
    .cell {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .tcell {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1 1 auto;
    }
    .cell > mf-priority-pill,
    .ppl {
      flex: none;
    }
    .av {
      display: grid;
      place-items: center;
      flex: none;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--mf-sem-info-bg);
      color: var(--mf-primary);
      font-size: 10px;
      font-weight: 700;
    }
    .una {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      color: var(--mf-sem-person-fg);
      font-weight: 600;
    }
    .ref {
      font-family: var(--mf-font-mono);
      font-size: var(--mf-fs-xs);
      color: var(--mf-text-muted);
      margin-right: var(--mf-s1);
    }
    .mt {
      display: block;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ppl {
      margin-left: var(--mf-s2);
    }
    col.c-st {
      width: 176px;
    }
    col.c-prio {
      width: 116px;
    }
    col.c-asg {
      width: 150px;
    }
    col.c-due {
      width: 150px;
    }
    .due {
      display: inline-flex;
      flex-direction: column;
      line-height: 1.25;
    }
    .due .l1 {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      white-space: nowrap;
    }
    .due.overdue {
      color: var(--mf-sem-overdue-fg);
      font-weight: 700;
    }
    .due.soon,
    .due.today {
      color: var(--mf-sem-risk-fg);
      font-weight: 600;
    }
    .rel {
      font-size: var(--mf-fs-xs);
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    /* The grid adapts to the width it gets (container queries on the frame). */
    .c-prio,
    .c-asg {
      display: none;
    }
    col.c-prio,
    col.c-asg {
      display: none;
    }
    @container gc (min-width: 640px) {
      .c-prio {
        display: table-cell;
      }
      col.c-prio {
        display: table-column;
      }
      .ppl {
        display: none;
      }
    }
    @container gc (min-width: 780px) {
      .c-asg {
        display: table-cell;
      }
      col.c-asg {
        display: table-column;
      }
    }
    @media (max-width: 767.98px) {
      .tt,
      .tt tbody {
        display: block;
        width: 100%;
      }
      .tt thead,
      .tt colgroup {
        display: none;
      }
      .tt tr {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--mf-s2) var(--mf-s3);
        padding: var(--mf-s3) var(--mf-s4);
        border-bottom: 1px solid var(--mf-border);
      }
      .tt td {
        display: block;
        height: auto;
        padding: 0;
        border: 0;
      }
      .tt td.td-t {
        flex: 1 1 100%;
      }
      .tt td.c-prio,
      .tt td.c-asg {
        display: block;
      }
      .tt td.c-due {
        margin-left: auto;
      }
      .ppl {
        display: none;
      }
      .lnk {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
      }
      .strow {
        flex-direction: column;
        align-items: flex-start;
      }
    }
  `,
})
export class MmTaskList {
  readonly filters = input.required<MmFilters>();
  readonly status = input<StatusFilter>('open');
  readonly show = input<ShowFilter>('everything');
  /** The matter name goes under the title where several matters are in play. */
  readonly showMatter = input(true);
  /** Changes with the client / matter: the frame scrolls back to the top. */
  readonly resetKey = input<unknown>(undefined);
  readonly statusChange = output<StatusFilter>();
  readonly showChange = output<ShowFilter>();

  protected readonly pageSize = GRID_PAGE_SIZE;
  private readonly queue = inject(TaskQueueClient);
  private readonly focus = inject(MyMattersFocus);
  private readonly api = inject(MmApi);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly heads = [
    { key: 'task', label: 'Task', sort: 'title', cls: 'h-t' },
    { key: 'status', label: 'Status', sort: 'status', cls: 'c-st' },
    { key: 'prio', label: 'Priority', sort: 'priority', cls: 'c-prio' },
    { key: 'asg', label: 'Assignee', sort: 'assignee', cls: 'c-asg' },
    { key: 'due', label: 'Due', sort: 'due', cls: 'c-due' },
  ] as const;

  protected readonly chosen = signal<{ field: string; dir: 'asc' | 'desc' } | null>(null);
  protected readonly sort = computed(() => this.chosen()?.field ?? DEFAULT_SORT);
  protected readonly dir = computed(() => this.chosen()?.dir ?? 'asc');

  private readonly baseParams = computed(() => {
    const a = commonArgs(this.filters());
    return {
      ...(a.scope === 'all' ? {} : { managedByMe: 'true' }),
      ...(a.managerId === undefined ? {} : { managerId: String(a.managerId) }),
      ...(a.role === undefined ? {} : { role: a.role }),
      ...(a.clientId === undefined ? {} : { client: String(a.clientId) }),
      ...(a.matterId === undefined ? {} : { matter: String(a.matterId) }),
      status: statusCodes(this.status()),
      ...(this.focus.types().length > 0 ? { type: this.focus.types().map(String) } : {}),
    } as Record<string, string | string[]>;
  });

  private readonly pageAt = signal<{ key: string; page: number }>({ key: '', page: 1 });
  private readonly key = computed(() =>
    JSON.stringify([this.baseParams(), this.show(), this.sort(), this.dir()]),
  );
  protected readonly page = computed(() =>
    this.pageAt().key === this.key() ? this.pageAt().page : 1,
  );

  protected readonly loader = panelLoader(
    () => [this.baseParams(), this.show(), this.sort(), this.dir(), this.page()],
    () => {
      const base = parseQueueState(convertToParamMap(this.baseParams()));
      return this.queue.getTaskQueue(
        undefined,
        ...queueArgs({
          ...base,
          sort: this.sort(),
          dir: this.dir(),
          page: this.page(),
          pageSize: GRID_PAGE_SIZE,
        }),
        this.show() === 'everything' ? undefined : this.show(),
      );
    },
  );
  protected readonly rows = computed<TaskQueueRow[]>(() => this.loader.data()?.items ?? []);
  protected readonly total = computed(() => this.loader.data()?.total ?? 0);

  protected readonly countsLoader = panelLoader(
    () => [this.filters(), this.status(), this.show()],
    () => this.api.taskCounts(this.filters(), this.status(), this.show()),
  );
  protected readonly counts = computed<TaskCounts | null>(() => this.countsLoader.data());

  protected readonly statusChips = computed<FilterChip[]>(() => {
    const c = this.counts()?.byStatus;
    const n: Record<StatusFilter, number | null> = {
      open: c?.allOpen ?? null,
      new: c?.new ?? null,
      progress: c?.inProgress ?? null,
      hold: c?.onHold ?? null,
      completed: c?.completed ?? null,
      cancelled: c?.cancelled ?? null,
    };
    return STATUS_FILTERS.map((s) => ({
      key: s.key,
      label: s.label,
      count: n[s.key],
      icon: STATUS_ICONS[s.key],
    }));
  });
  protected readonly showOptions = computed<DropdownItem[]>(() => {
    const c = this.counts()?.byShow;
    const n: Record<ShowFilter, number | null> = {
      everything: c?.everything ?? null,
      overdue: c?.overdue ?? null,
      risk: c?.risk ?? null,
      unassigned: c?.unassigned ?? null,
      critical: c?.critical ?? null,
      due7: c?.due7 ?? null,
    };
    return SHOW_FILTERS.map((s) => ({ value: s.key, label: s.label, count: n[s.key] }));
  });
  protected readonly emptyText = computed(() =>
    this.show() === 'everything' && this.status() === 'open'
      ? 'No open tasks.'
      : 'No tasks match these filters.',
  );

  constructor() {
    effect(() => {
      const pages = Math.max(1, Math.ceil(this.total() / GRID_PAGE_SIZE));
      if (this.loader.state() === 'ready' && this.page() > pages) this.goPage(pages);
    });
  }

  protected goPage(page: number): void {
    this.pageAt.set({ key: this.key(), page });
  }

  protected sortBy(field: string): void {
    if (this.sort() === field)
      this.chosen.set({ field, dir: this.dir() === 'asc' ? 'desc' : 'asc' });
    else this.chosen.set({ field, dir: DESC_FIRST.has(field) ? 'desc' : 'asc' });
  }
  protected ariaSort(field: string): 'ascending' | 'descending' | 'none' {
    return this.sort() === field ? (this.dir() === 'asc' ? 'ascending' : 'descending') : 'none';
  }
  protected sortIcon(field: string): string {
    return this.sort() === field
      ? this.dir() === 'asc'
        ? 'pi-sort-amount-up-alt'
        : 'pi-sort-amount-down'
      : 'pi-sort-alt';
  }

  protected initials(name: string): string {
    const p = name.trim().split(/\s+/);
    return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p[p.length - 1][0] ?? '') : '')).toUpperCase();
  }

  protected step(t: TaskQueueRow): number | null {
    const w = t.workflow;
    if (!w || w.stepsTotal < 1) return null;
    return w.currentStepNumber ?? w.stepsTotal;
  }

  protected pill(t: TaskQueueRow): 'critical' | 'high' | null {
    const tone = t.priority.color;
    return tone === 'critical' ? 'critical' : tone === 'high' ? 'high' : null;
  }

  /** Line 2 of the Due cell: "10 d overdue", "Due today", "Due in 2 d" (nothing for a later date or a closed task). */
  protected dueNote(t: TaskQueueRow, d: DueCell): string {
    if (t.status === 'COMPLETED' || t.status === 'CANCELLED') return '';
    const n = d.daysUntil;
    if (n === undefined) return d.tone === 'asap' ? '' : d.line2;
    if (n < 0) return `${-n} d overdue`;
    if (d.overdue) return d.line2;
    if (n === 0) return 'Due today';
    return n <= 7 ? `Due in ${n} d` : '';
  }

  protected due(t: TaskQueueRow) {
    return describeDueCell(t, this.clock.now(), this.zone, t.status);
  }

  /** The hover and focus text of the status chip (hold age and reason, close date, cancel reason). */
  protected statusDetail(t: TaskQueueRow): string | null {
    const since = new Date(t.statusChangedAtUtc);
    const days = Math.max(
      0,
      Math.floor((this.clock.now().getTime() - since.getTime()) / 86_400_000),
    );
    if (t.status === 'ON_HOLD') {
      const why = t.onHoldReasonName ?? t.holdReason;
      return `On hold for ${days} ${days === 1 ? 'day' : 'days'}${why ? ` because ${why}` : ''}`;
    }
    if (t.status === 'IN_PROGRESS') {
      const n = this.step(t);
      const total = t.workflow?.stepsTotal ?? 0;
      return n && total > 0
        ? `Step ${n} of ${total}${t.workflow.currentStepName ? `: ${t.workflow.currentStepName}` : ''}`
        : null;
    }
    if (t.status === 'COMPLETED' || t.status === 'CANCELLED') {
      const when = (t.closedAtUtc ?? t.statusChangedAtUtc).slice(0, 10);
      const why = t.status === 'CANCELLED' && t.holdReason ? `: ${t.holdReason}` : '';
      return `${t.status === 'COMPLETED' ? 'Completed' : 'Cancelled'} ${when}${why}`;
    }
    return null;
  }
}
