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
import { firstValueFrom } from 'rxjs';
import {
  TaskQueueClient,
  TaskQueueRow,
  UsersLookupClient,
} from '../../../api/generated/api-client';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { SectionTypes } from '../section-types';
import { taskTypeChipText } from './task-type-chip-text';
import { todayText } from '../calendar-month';
import { GridFilters } from './mm-scope';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { DueCell, describeDueCell } from '../../../core/time/time';
import {
  numericDate,
  numericInstant,
  readableDate,
  readableInstant,
} from '../../../shared/ui/numeric-date';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { TaskTypeChip } from '../../../shared/ui/task-type-chip';
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
import { personInitials } from '../../../shared/ui/person-initials';
import { IntPipe } from '../../../shared/ui/number-format';

const OPEN_KEY = 'mf-mm-grid-filter-open';
function rememberedOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** The queue parameters of the Assignee column filter. */
export function assigneeParams(g: GridFilters): Record<string, string | string[]> {
  if (g.assignee === 'none') return { unassigned: 'true' };
  return typeof g.assignee === 'number' ? { assignee: [String(g.assignee)] } : {};
}

/** The queue parameters of the Due column filter, from today's date (the viewer's zone). */
export function dueParams(g: GridFilters, today: string): Record<string, string> {
  const day = (offset: number): string => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  switch (g.due) {
    case 'overdue':
      return { dueTo: day(-1) };
    case 'today':
      return { dueFrom: today, dueTo: today };
    case 'week':
      return { dueFrom: today, dueTo: day(7) };
    case 'month': {
      const [y, m] = today.split('-').map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return {
        dueFrom: `${today.slice(0, 7)}-01`,
        dueTo: `${today.slice(0, 7)}-${String(last).padStart(2, '0')}`,
      };
    }
    case 'range':
      return { ...(g.from ? { dueFrom: g.from } : {}), ...(g.to ? { dueTo: g.to } : {}) };
    default:
      return {};
  }
}

const GRID_PAGE_SIZE = 25;
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
    IntPipe,
    Dropdown,
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
            <span class="tot">{{ total() | mfInt }}</span>
          }
        </h2>
        <div class="tools">
          <button
            type="button"
            class="mf-btn fbtn"
            data-filter-toggle
            aria-controls="mm-col-filters"
            [attr.aria-expanded]="filterOpen()"
            [class.on]="activeCount() > 0"
            (click)="toggleFilters()"
          >
            <i class="pi pi-filter" aria-hidden="true"></i>
            <span>Filters</span>
            @if (activeCount() > 0) {
              <span class="bdg" data-filter-count
                >{{ activeCount() | mfInt }}<span class="sr"> active</span></span
              >
            }
          </button>
          <mf-dropdown
            class="show"
            buttonId="mm-show"
            label="Show"
            prefix="Show:"
            [items]="showOptions()"
            [value]="show()"
            (valueChange)="paramsChange.emit({ show: $event === 'everything' ? null : $event })"
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
      @if (filterOpen() || activeChips().length > 0) {
        <div frameStatus class="fstack">
          @if (activeChips().length > 0) {
            <div class="achips" data-active-filters>
              @for (c of activeChips(); track c.key) {
                <span class="achip" [attr.title]="c.title ?? null"
                  >{{ c.label }}
                  <button
                    type="button"
                    class="ax"
                    [attr.data-remove]="c.key"
                    [attr.aria-label]="'Remove filter: ' + c.label"
                    (click)="paramsChange.emit(c.clear)"
                  >
                    <i class="pi pi-times" aria-hidden="true"></i>
                  </button>
                </span>
              }
              <button type="button" class="lnk" data-clear-filters (click)="clearFilters()">
                Clear Filters
              </button>
            </div>
          }
          @if (filterOpen()) {
            <div class="fr" id="mm-col-filters" role="group" aria-label="Column filters">
              <label class="srch">
                <span class="sr">Search tasks</span>
                <i class="pi pi-search" aria-hidden="true"></i>
                <input
                  type="search"
                  data-filter-q
                  placeholder="Search tasks"
                  autocomplete="off"
                  [value]="grid().q"
                  (input)="setQ($any($event.target).value)"
                />
              </label>
              <mf-dropdown
                buttonId="mm-f-status"
                label="Status"
                prefix="Status:"
                [multi]="true"
                [items]="statusItems()"
                [values]="statuses()"
                (valuesChange)="setStatuses($any($event))"
                placeholder="All Open"
                [panelWidth]="240"
              />
              <mf-dropdown
                buttonId="mm-f-priority"
                label="Priority"
                prefix="Priority:"
                [multi]="true"
                [items]="priorityItems()"
                [values]="prioValues()"
                (valuesChange)="
                  paramsChange.emit({ prio: $any($event).length ? $any($event).join(',') : null })
                "
                placeholder="Any"
                [panelWidth]="220"
              />
              <mf-dropdown
                buttonId="mm-f-assignee"
                label="Assignee"
                prefix="Assignee:"
                [items]="assigneeItems()"
                [value]="assigneeValue()"
                (valueChange)="paramsChange.emit({ asg: $event || null })"
                [search]="true"
                searchLabel="Search people"
                [limit]="60"
                (searched)="searchPeople($event)"
                placeholder="Anyone"
                [panelWidth]="280"
              />
              <mf-dropdown
                buttonId="mm-f-due"
                label="Due"
                prefix="Due:"
                [items]="dueItems"
                [value]="grid().due ?? ''"
                (valueChange)="
                  paramsChange.emit({
                    due: $event || null,
                    ...($event === 'range' ? {} : { dfrom: null, dto: null }),
                  })
                "
                [panelWidth]="220"
              />
              @if (grid().due === 'range') {
                <span class="rng">
                  <label
                    ><span class="sr">Due from</span
                    ><input
                      type="date"
                      data-due-from
                      [value]="grid().from ?? ''"
                      (change)="paramsChange.emit({ dfrom: $any($event.target).value || null })"
                  /></label>
                  <span aria-hidden="true">to</span>
                  <label
                    ><span class="sr">Due to</span
                    ><input
                      type="date"
                      data-due-to
                      [value]="grid().to ?? ''"
                      (change)="paramsChange.emit({ dto: $any($event.target).value || null })"
                  /></label>
                </span>
              }
            </div>
          }
        </div>
      }

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
                  <span [class]="'due ' + d.tone" [attr.title]="dueTitle(t, d)">
                    <span class="l1">
                      @if (d.tone === 'overdue') {
                        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                      } @else if (d.tone === 'today' || d.tone === 'soon') {
                        <i class="pi pi-clock" aria-hidden="true"></i>
                      }
                      {{ dueText(t, d) }}
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
      font-variant-numeric: tabular-nums;
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
    }
    .fbtn[aria-expanded='true'] {
      border-color: var(--mf-primary);
      box-shadow: 0 0 0 3px var(--mf-sem-info-bg);
    }
    .fbtn.on {
      background: var(--mf-sem-info-bg);
      border-color: var(--mf-sem-info-line);
    }
    .bdg {
      min-width: 18px;
      padding: 0 5px;
      box-sizing: border-box;
      border-radius: var(--mf-radius-pill);
      background: var(--mf-primary);
      color: var(--mf-primary-contrast);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      line-height: 18px;
      text-align: center;
    }
    .fstack {
      display: grid;
      gap: var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s4) var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
      background: var(--mf-surface-alt);
    }
    .achips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
    }
    .achip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 0 var(--mf-s1) 0 var(--mf-s3);
      border: 1px solid var(--mf-sem-info-line);
      border-radius: 999px;
      background: var(--mf-sem-info-bg);
      color: var(--mf-sem-info-fg);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      line-height: 24px;
    }
    .ax {
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: none;
      color: inherit;
      font-size: var(--mf-fs-xs);
      cursor: pointer;
    }
    .fr {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
    }
    .fr .srch {
      position: relative;
      flex: 1 1 200px;
      min-width: 160px;
    }
    .fr .srch .pi {
      position: absolute;
      left: var(--mf-s3);
      top: 9px;
      color: var(--mf-text-muted);
    }
    .rng {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    .rng input,
    .fr .srch input {
      box-sizing: border-box;
      height: var(--mf-ctl-h-sm);
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      font-size: var(--mf-fs-sm);
    }
    .fr .srch input {
      width: 100%;
      padding-left: 32px;
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
    .av {
      display: grid;
      place-items: center;
      flex: none;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--mf-sem-info-bg);
      color: var(--mf-primary);
      font-size: var(--mf-fs-xs);
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
        gap: 0.4em;
        min-height: 44px;
      }
      .fbtn {
        height: 44px;
      }
      .ax {
        width: 32px;
        height: 32px;
      }
    }
  `,
})
export class MmTaskList {
  readonly filters = input.required<MmFilters>();
  /** The Status filter: one or more of the five statuses, or `open` (the default). */
  readonly statuses = input<readonly StatusFilter[]>(['open']);
  readonly grid = input<GridFilters>({
    q: '',
    priorities: [],
    assignee: null,
    due: null,
    from: null,
    to: null,
    types: [],
    createdFrom: null,
    createdTo: null,
  });
  readonly show = input<ShowFilter>('everything');
  /** The matter name goes under the title where several matters are in play. */
  readonly showMatter = input(true);
  /** Changes with the client / matter: the frame scrolls back to the top. */
  readonly resetKey = input<unknown>(undefined);
  /** A change of the grid's filters as address parameters (null removes one); the page writes them to the address. */
  readonly paramsChange = output<Record<string, string | null>>();

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
      status: this.statuses().flatMap((k) => statusCodes(k)),
      ...(this.grid().q ? { q: this.grid().q } : {}),
      ...(this.grid().priorities.length ? { priority: this.grid().priorities.map(String) } : {}),
      ...assigneeParams(this.grid()),
      ...dueParams(this.grid(), this.today()),
      ...(this.grid().types.length ? { type: this.grid().types.map(String) } : {}),
      ...(this.grid().createdFrom ? { createdFrom: this.grid().createdFrom! } : {}),
      ...(this.grid().createdTo ? { createdTo: this.grid().createdTo! } : {}),
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
    () => [this.filters(), this.statuses(), this.show()],
    () => this.api.taskCounts(this.filters(), this.statuses(), this.show()),
  );
  protected readonly counts = computed<TaskCounts | null>(() => this.countsLoader.data());

  protected readonly statusItems = computed<DropdownItem[]>(() => {
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
      value: s.key,
      label: s.label,
      count: n[s.key],
      icon: STATUS_ICONS[s.key],
      tone: 'neutral' as const,
    }));
  });
  protected readonly dueItems: DropdownItem[] = [
    { value: '', label: 'Any Date' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'Next 7 Days' },
    { value: 'month', label: 'This Month' },
    { value: 'range', label: 'Custom Range' },
  ];
  private readonly lookups = inject(LookupStore);
  private readonly sectionTypes = inject(SectionTypes);
  private readonly usersApi = inject(UsersLookupClient);
  private readonly people = signal<{ id: number; name: string }[]>([]);
  protected readonly priorityItems = computed<DropdownItem[]>(() =>
    this.lookups.priorities().map((p) => ({ value: String(p.id), label: p.label })),
  );
  protected readonly prioValues = computed(() => this.grid().priorities.map(String));
  protected readonly assigneeItems = computed<DropdownItem[]>(() => {
    const people = this.people().map((u) => ({ value: String(u.id), label: u.name }));
    const chosen = this.grid().assignee;
    // A link may carry a person the first 50 of the lookup do not list: keep the choice visible on the button.
    const extra =
      typeof chosen === 'number' && !people.some((p) => p.value === String(chosen))
        ? [{ value: String(chosen), label: 'Selected Person' }]
        : [];
    return [
      { value: '', label: 'Anyone' },
      { value: 'none', label: 'Unassigned', icon: 'pi-user-minus', tone: 'neutral' as const },
      ...extra,
      ...people,
    ];
  });
  protected readonly assigneeValue = computed(() =>
    this.grid().assignee === null ? '' : String(this.grid().assignee),
  );
  private readonly today = computed(() => todayText(this.clock, this.zone));

  /** The column filters in force (Status other than All open counts as one); the Show filter is not one of them. */
  protected readonly activeCount = computed(() => {
    const g = this.grid();
    return (
      (this.statuses().includes('open') ? 0 : 1) +
      (g.q ? 1 : 0) +
      (g.priorities.length ? 1 : 0) +
      (g.assignee !== null ? 1 : 0) +
      (g.due ? 1 : 0) +
      (g.types.length ? 1 : 0) +
      (g.createdFrom || g.createdTo ? 1 : 0)
    );
  });
  protected readonly activeChips = computed(() => {
    const g = this.grid();
    const out: {
      key: string;
      label: string;
      title?: string;
      clear: Record<string, string | null>;
    }[] = [];
    if (!this.statuses().includes('open'))
      out.push({
        key: 'status',
        label: `Status: ${this.statuses()
          .map((k) => STATUS_FILTERS.find((x) => x.key === k)?.label ?? k)
          .join(', ')}`,
        clear: { status: null },
      });
    if (g.q) out.push({ key: 'q', label: `Task: ${g.q}`, clear: { q: null } });
    if (g.priorities.length)
      out.push({
        key: 'prio',
        label: `Priority: ${g.priorities.map((id) => this.lookups.priorities().find((p) => p.id === id)?.label ?? id).join(', ')}`,
        clear: { prio: null },
      });
    if (g.assignee !== null)
      out.push({
        key: 'asg',
        label: `Assignee: ${g.assignee === 'none' ? 'Unassigned' : (this.people().find((u) => u.id === g.assignee)?.name ?? 'Selected Person')}`,
        clear: { asg: null },
      });
    if (g.due)
      out.push({
        key: 'due',
        label: `Due: ${this.dueItems.find((d) => d.value === g.due)?.label ?? g.due}${g.due === 'range' && (g.from || g.to) ? ` ${this.numDay(g.from)} to ${this.numDay(g.to)}` : ''}`,
        clear: { due: null, dfrom: null, dto: null },
      });
    if (g.types.length) {
      const known = new Map(this.sectionTypes.options().map((t) => [t.id, t.name]));
      const typeText = taskTypeChipText(g.types, known);
      out.push({
        key: 'ttype',
        // The task type NAME (#978): one or two names in full, more as "N types" with every name in the tooltip. Until the names are read the count is shown.
        label: `Task type: ${typeText.label}`,
        title: typeText.title,
        clear: { ttype: null },
      });
    }
    if (g.createdFrom || g.createdTo)
      out.push({
        key: 'created',
        label: `Created: ${g.createdFrom ?? 'earlier'} to ${g.createdTo ?? 'today'}`,
        clear: { cfrom: null, cto: null },
      });
    return out;
  });
  protected readonly filterOpen = signal(rememberedOpen());

  protected toggleFilters(): void {
    const next = !this.filterOpen();
    this.filterOpen.set(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      // Not remembering is fine.
    }
    if (next) this.loadPeople();
  }
  private loadPeople(): void {
    if (this.people().length > 0) return;
    this.fetchPeople(undefined);
  }
  private peopleTimer: ReturnType<typeof setTimeout> | undefined;
  /** The Assignee list asks the server for the typed text (the lookup answers at most 50 people), so a firm with more people can still find everybody. */
  protected searchPeople(text: string): void {
    clearTimeout(this.peopleTimer);
    this.peopleTimer = setTimeout(() => this.fetchPeople(text.trim() || undefined), 250);
  }
  private fetchPeople(text: string | undefined): void {
    void firstValueFrom(this.usersApi.lookupUsers(text, 50))
      .then((r) => {
        const chosen = this.people().find((u) => u.id === this.grid().assignee);
        const next = r.map((u) => ({ id: u.userId, name: u.displayName }));
        if (chosen && !next.some((u) => u.id === chosen.id)) next.unshift(chosen);
        this.people.set(next);
      })
      .catch(() => undefined);
  }
  protected clearFilters(): void {
    this.paramsChange.emit({
      status: null,
      q: null,
      prio: null,
      asg: null,
      due: null,
      dfrom: null,
      dto: null,
      ttype: null,
      cfrom: null,
      cto: null,
    });
  }
  private qTimer: ReturnType<typeof setTimeout> | undefined;
  protected setQ(v: string): void {
    clearTimeout(this.qTimer);
    this.qTimer = setTimeout(() => this.paramsChange.emit({ q: v.trim() || null }), 300);
  }
  /** The Status choice: ticking All open resets it, ticking a status leaves All open, ticking nothing is All open again. */
  protected setStatuses(next: readonly string[]): void {
    const had = this.statuses().includes('open');
    let keys = next.filter((k) => k !== 'open');
    if (next.includes('open') && !had) keys = [];
    this.paramsChange.emit({ status: keys.length ? keys.join(',') : null });
  }

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
    this.show() === 'everything' && this.activeCount() === 0
      ? 'No open tasks.'
      : 'No tasks match these filters.',
  );

  constructor() {
    // The chip names the task types of the address (a drill from Metrics), so the names are read once when there is one.
    effect(() => {
      if (this.grid().types.length > 0) this.sectionTypes.ensure();
    });
    // The Priority filter and its chip read the shared priority list; a page opened by address would otherwise show an empty list.
    void this.lookups.ensureLoaded();
    if (this.filterOpen()) this.loadPeople();
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
    return personInitials(name);
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

  /** Line 1 of the Due cell in the numeric format (`10/26 04:00 PM`, `10/26` without a time, `ASAP`). */
  protected dueText(t: TaskQueueRow, d: DueCell): string {
    if (d.tone === 'asap') return d.line1;
    if (t.dueAtUtc) return numericInstant(t.dueAtUtc, this.clock.now(), this.zone);
    return t.dueDate ? numericDate(t.dueDate, this.clock.now(), this.zone) : d.line1;
  }

  /** The hover text keeps the readable full date ("October 26, 2026, 4:00 PM"). */
  protected dueTitle(t: TaskQueueRow, d: DueCell): string {
    if (d.tone === 'asap') return d.tooltip;
    if (t.dueAtUtc) return readableInstant(t.dueAtUtc, this.zone);
    return t.dueDate ? readableDate(t.dueDate) : d.tooltip;
  }

  protected numDay(v: string | null): string {
    return v ? numericDate(v, this.clock.now(), this.zone) : '';
  }

  protected due(t: TaskQueueRow) {
    const cell = describeDueCell(t, this.clock.now(), this.zone, t.status);
    // On Hold is never overdue on this page (the owner's rule, as in the Overdue chip and its count): the date shows in the plain tone, with no "d overdue" line.
    return t.status === 'ON_HOLD' && cell.overdue
      ? { ...cell, tone: 'none' as const, overdue: false, line2: '', daysUntil: undefined }
      : cell;
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
