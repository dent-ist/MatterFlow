import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AssetTaskLink, AssetsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { DueCell } from '../../../shared/work-queue/due-cell';
import { WORK_COLUMNS } from '../../../shared/work-queue/column-prefs';
import { columnWidthRem } from '../../../shared/work-queue/column-widths';
import { PriorityFlag } from '../../../shared/ui/priority-flag';
import { TaskTypeCell } from '../../../shared/ui/task-type-cell';
import { Tip } from '../../../shared/ui/tip';
import {
  RecordCell,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../../shared/ui/record-grid';
import {
  RecordCard,
  RecordCardDef,
  RecordCardList,
  phoneCards,
} from '../../../shared/ui/record-card-list';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { IntPipe } from '../../../shared/ui/number-format';

type LoadState = 'loading' | 'ready' | 'error';

/** What the tab learned about the asset's tasks: the record page's summary strip shows it (#506). */
export interface LinkedTaskTotals {
  total: number;
  open: number;
  overdue: number;
}

/** The width of a task grid column (`WORK_COLUMNS`, D-43), in rem: the same widths as every other task grid. */
const widthRem = (key: string): number => columnWidthRem(WORK_COLUMNS.find((c) => c.key === key)!);

/** The order of the status sort: the open states first. */
const STATUS_ORDER = ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];

/** The day a link is due, for the sort: the date, else the instant; a task without a due date has none (ASAP). */
function dueKey(t: AssetTaskLink): number | null {
  if (t.dueDate) return Date.parse(t.dueDate + 'T00:00:00Z');
  return t.dueAtUtc ? Date.parse(t.dueAtUtc) : null;
}

/**
 * The Linked tasks tab of an Asset (UX S08, #505; columns #1235): every task the asset is linked to as a 44 px table on the shared cells in the standard task column order
 * (Ref, Type chip and name, Title as the one link, Priority, Assignee, Due, Status; the widths of `WORK_COLUMNS`, 928 px plus a Title of at least 120 px, so it fits the 1098 px
 * of 1366), sorted by due date (earliest first, no due date last) and
 * sortable by Due and Status. One line above it counts them: "19 linked - 4 open - 1 overdue". Below 640 px each task is a card. Needs
 * `Task.View`; without it the tab says so and loads nothing. Rendered only while its tab is open.
 */
@Component({
  selector: 'mf-asset-linked-tasks',
  imports: [
    IntPipe,
    RouterLink,
    StatusBadge,
    DueCell,
    PriorityFlag,
    TaskTypeCell,
    Tip,
    RecordGrid,
    RecordCell,
    RecordCardList,
    RecordCardDef,
    RecordCard,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    .lt-summary {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
    }
    .lt-over {
      color: var(--mf-due-overdue);
      font-weight: 700;
    }
    /* The record grid is a card that takes the height of its parent; in the tab it is as tall as its rows. */
    .lt-grid {
      display: flex;
      flex-direction: column;
    }
    td.lt-title {
      width: 100%;
      max-width: 0;
    }
    td.lt-ref {
      font-family: var(--mf-font-mono);
      white-space: nowrap;
    }
    td.lt-who {
      max-width: 12rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .lt-none {
      color: var(--mf-text-muted);
    }
  `,
  template: `
    @if (!canView()) {
      <div class="pg-state" data-no-access="linked-tasks">
        You don't have permission to view tasks.
      </div>
    } @else if (phone()) {
      <mf-record-card-list
        noun="linked tasks"
        label="Linked tasks"
        [state]="state()"
        [empty]="links().length === 0"
        emptyText="No tasks are linked to this asset yet."
        (retry)="load()"
      >
        <ng-template [mfRecordCard]="sorted()" let-t>
          <mf-record-card [name]="t.title" [link]="['/tasks', t.taskId]">
            <mf-status-badge mfCardBadges [code]="t.statusCode" />
            <p mfCardMeta class="rc-line" [attr.data-task]="t.taskNumber">
              <span class="rc-ref">{{ t.taskNumber }}</span>
              @if (t.assetLinkRoleName) {
                <span class="rc-sep" aria-hidden="true">-</span><span class="mf-sr-only">, </span>
                <span class="rc-text">{{ t.assetLinkRoleName }}</span>
              }
            </p>
            <p mfCardMeta class="rc-line">
              <mf-due-cell [due]="t" [status]="t.statusCode" layout="inline" />
            </p>
            <p mfCardMeta class="rc-line">
              <span class="rc-text">{{
                t.assigneeName ? 'Assignee: ' + t.assigneeName : 'Unassigned'
              }}</span>
            </p>
          </mf-record-card>
        </ng-template>
      </mf-record-card-list>
    } @else {
      @if (state() === 'ready' && links().length > 0) {
        <p class="lt-summary" data-linked-summary>
          {{ totals().total | mfInt }} linked - {{ totals().open }} open -
          <span [class.lt-over]="totals().overdue > 0">{{ totals().overdue }} overdue</span>
        </p>
      }
      <div class="lt-grid" data-linked-table>
        <mf-record-grid
          label="Tasks linked to this asset"
          caption="Tasks linked to this asset"
          noun="linked tasks"
          [grid]="grid"
          [rows]="sorted()"
          [rowKey]="linkKey"
          [loadState]="state()"
          [empty]="links().length === 0"
          emptyText="No tasks are linked to this asset yet."
          [bones]="bones"
          [sort]="sort()"
          defaultSort="due"
          (sorted)="sort.set($event)"
          (retry)="load()"
        >
          <ng-template mfCell="ref" let-t>
            <td class="lt-ref">{{ t.taskNumber }}</td>
          </ng-template>
          <ng-template mfCell="type" let-t>
            <td data-type>
              <mf-task-type-cell
                [name]="t.taskTypeName"
                [iconKey]="t.taskTypeIconKey"
                [colourKey]="t.taskTypeColourKey"
                [typeId]="t.taskTypeId"
              />
            </td>
          </ng-template>
          <ng-template mfCell="title" let-t>
            <td class="lt-title">
              <a
                class="mf-link pg-clip"
                [routerLink]="['/tasks', t.taskId]"
                [mfTip]="linkTip(t)"
                data-title-link
                >{{ t.title }}</a
              >
              @if (t.assetLinkRoleName) {
                <span class="mf-sr-only">, linked as {{ t.assetLinkRoleName }}</span>
              }
            </td>
          </ng-template>
          <ng-template mfCell="priority" let-t>
            <td data-priority>
              @if (t.priorityLabel) {
                <mf-priority-flag
                  [label]="t.priorityLabel"
                  [color]="t.priorityColor"
                  [muted]="!t.isOpen"
                />
              } @else {
                <span class="lt-none">-</span>
              }
            </td>
          </ng-template>
          <ng-template mfCell="assignee" let-t>
            <td class="lt-who" [attr.title]="t.assigneeName ?? null" data-assignee>
              @if (t.assigneeName) {
                {{ t.assigneeName }}
              } @else {
                <span class="lt-none">Unassigned</span>
              }
            </td>
          </ng-template>
          <ng-template mfCell="due" let-t>
            <td data-due>
              <mf-due-cell [due]="t" [status]="t.statusCode" />
            </td>
          </ng-template>
          <ng-template mfCell="status" let-t>
            <td><mf-status-badge [code]="t.statusCode" /></td>
          </ng-template>
        </mf-record-grid>
      </div>
    }
  `,
})
export class AssetLinkedTasks {
  readonly assetId = input.required<number>();
  /** The totals once the list is loaded (the record page's summary strip, #506). */
  readonly loaded = output<LinkedTaskTotals>();

  private readonly api = inject(AssetsClient);
  private readonly auth = inject(AuthStore);

  protected readonly phone = phoneCards();
  /** The columns in the standard task column order (D-43: the widths of `WORK_COLUMNS`, the Title is the spring). Resizing is stored per person under "asset-linked-tasks". */
  protected readonly gridDefs = signal<readonly RecordGridColumn[]>([
    { key: 'ref', label: 'Ref', locked: true, ...this.fixed('ref') },
    { key: 'type', label: 'Type', ...this.fixed('type') },
    { key: 'title', label: 'Title', locked: true, minWidth: '8.5rem' },
    { key: 'priority', label: 'Priority', ...this.fixed('priority') },
    { key: 'assignee', label: 'Assignee', ...this.fixed('assignee') },
    { key: 'due', label: 'Due', sort: 'due', ...this.fixed('due') },
    { key: 'status', label: 'Status', sort: 'status', ...this.fixed('status') },
  ]);
  protected readonly grid = new RecordGridState('asset-linked-tasks', this.gridDefs);
  protected readonly bones: Record<string, string> = {
    ref: '5rem',
    type: '6rem',
    title: '14rem',
    priority: '4rem',
    assignee: '7rem',
    due: '5rem',
    status: '5rem',
  };
  protected readonly linkKey = (t: AssetTaskLink): number => t.taskId;
  private fixed(key: string): { width: string; minWidth: string } {
    const w = `${widthRem(key)}rem`;
    return { width: w, minWidth: w };
  }
  /** The tooltip of the Title link: the role the asset is linked as (#1240); a link without a role keeps the full title. */
  protected linkTip(t: AssetTaskLink): string {
    return t.assetLinkRoleName ? `Linked as ${t.assetLinkRoleName}` : t.title;
  }
  protected readonly canView = computed(() => this.auth.has('Task.View'));
  protected readonly state = signal<LoadState>('loading');
  protected readonly links = signal<AssetTaskLink[]>([]);
  /** `due` or `-due`, `status` or `-status`; the API order is already due date first. */
  protected readonly sort = signal('due');

  protected readonly totals = computed<LinkedTaskTotals>(() => ({
    total: this.links().length,
    open: this.links().filter((t) => t.isOpen).length,
    overdue: this.links().filter((t) => t.isOverdue).length,
  }));

  protected readonly sorted = computed(() => {
    const expression = this.sort();
    const desc = expression.startsWith('-');
    const field = desc ? expression.slice(1) : expression;
    const rows = [...this.links()];
    const byDue = (a: AssetTaskLink, b: AssetTaskLink): number => {
      const x = dueKey(a);
      const y = dueKey(b);
      if (x === y) return 0;
      if (x === null) return 1; // no due date last when ascending
      if (y === null) return -1;
      return x - y;
    };
    const compare = (a: AssetTaskLink, b: AssetTaskLink): number =>
      field === 'status'
        ? STATUS_ORDER.indexOf(a.statusCode) - STATUS_ORDER.indexOf(b.statusCode) || byDue(a, b)
        : byDue(a, b);
    // Stable: ties keep the API order (due date, then the newest link).
    rows.sort((a, b) => (desc ? -compare(a, b) : compare(a, b)));
    return rows;
  });

  constructor() {
    effect(() => {
      this.assetId();
      untracked(() => {
        if (this.canView()) void this.load();
      });
    });
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const result = await firstValueFrom(this.api.listAssetLinkedTasks(this.assetId()));
      this.links.set(result.items);
      this.state.set('ready');
      this.loaded.emit(this.totals());
    } catch {
      this.state.set('error');
    }
  }
}
