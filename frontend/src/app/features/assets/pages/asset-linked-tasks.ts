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
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { AssetTaskLink, AssetsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { DueCell } from '../../../shared/work-queue/due-cell';
import { SortHeader } from '../../../shared/ui/data-table';
import { ErrorReference } from '../../../shared/ui/error-reference';
import {
  RecordCard,
  RecordCardDef,
  RecordCardList,
  phoneCards,
} from '../../../shared/ui/record-card-list';
import { StatusBadge } from '../../../shared/ui/status-badge';

type LoadState = 'loading' | 'ready' | 'error';

/** What the tab learned about the asset's tasks: the record page's summary strip shows it (#506). */
export interface LinkedTaskTotals {
  total: number;
  open: number;
  overdue: number;
}

/** The order of the status sort: the open states first. */
const STATUS_ORDER = ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];

/** The day a link is due, for the sort: the date, else the instant; a task without a due date has none (ASAP). */
function dueKey(t: AssetTaskLink): number | null {
  if (t.dueDate) return Date.parse(t.dueDate + 'T00:00:00Z');
  return t.dueAtUtc ? Date.parse(t.dueAtUtc) : null;
}

/**
 * The Linked tasks tab of an Asset (UX S08, #505): every task the asset is linked to as a 44 px table on the shared cells (number, title as
 * the one link, status badge, the Due cell, assignee and the role of the link), sorted by due date (earliest first, no due date last) and
 * sortable by Due and Status. One line above it counts them: "19 linked - 4 open - 1 overdue". Below 640 px each task is a card. Needs
 * `Task.View`; without it the tab says so and loads nothing. Rendered only while its tab is open.
 */
@Component({
  selector: 'mf-asset-linked-tasks',
  imports: [
    ErrorReference,
    RouterLink,
    Button,
    StatusBadge,
    DueCell,
    SortHeader,
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
    td.lt-ref {
      width: 1%;
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
                t.assigneeName ? 'Assigned to ' + t.assigneeName : 'Unassigned'
              }}</span>
            </p>
          </mf-record-card>
        </ng-template>
      </mf-record-card-list>
    } @else {
      @switch (state()) {
        @case ('loading') {
          <div class="pg-state" role="status" aria-busy="true" data-loading>
            Loading linked tasks...
          </div>
        }
        @case ('error') {
          <div class="pg-alert" role="alert" data-error>
            We couldn't load the linked tasks.
            <mf-error-reference />
            <p-button label="Retry" severity="secondary" (onClick)="load()" />
          </div>
        }
        @default {
          @if (links().length === 0) {
            <div class="pg-state" data-empty="linked-tasks">
              No tasks are linked to this asset yet.
            </div>
          } @else {
            <p class="lt-summary" data-linked-summary>
              {{ totals().total }} linked - {{ totals().open }} open -
              <span [class.lt-over]="totals().overdue > 0">{{ totals().overdue }} overdue</span>
            </p>
            <div class="mf-scroll">
              <table class="mf-grid" data-linked-table>
                <caption class="mf-sr-only">
                  Tasks linked to this asset
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Ref</th>
                    <th class="mf-cell-name" scope="col">Title</th>
                    <th
                      class="mf-cell-badge"
                      mfSort="status"
                      [sort]="sort()"
                      defaultSort="due"
                      (sorted)="sort.set($event)"
                    >
                      Status
                    </th>
                    <th
                      class="mf-cell-date"
                      mfSort="due"
                      [sort]="sort()"
                      defaultSort="due"
                      (sorted)="sort.set($event)"
                    >
                      Due
                    </th>
                    <th scope="col">Assignee</th>
                    <th scope="col">Role</th>
                  </tr>
                </thead>
                <tbody>
                  @for (t of sorted(); track t.taskId) {
                    <tr [attr.data-task]="t.taskNumber">
                      <td class="lt-ref">{{ t.taskNumber }}</td>
                      <td class="mf-cell-name">
                        <a
                          class="mf-name"
                          [routerLink]="['/tasks', t.taskId]"
                          [attr.title]="t.title"
                          >{{ t.title }}</a
                        >
                      </td>
                      <td class="mf-cell-badge"><mf-status-badge [code]="t.statusCode" /></td>
                      <td class="mf-cell-date" data-due>
                        <mf-due-cell [due]="t" [status]="t.statusCode" />
                      </td>
                      <td class="lt-who" [attr.title]="t.assigneeName ?? null" data-assignee>
                        @if (t.assigneeName) {
                          {{ t.assigneeName }}
                        } @else {
                          <span class="lt-none">Unassigned</span>
                        }
                      </td>
                      <td class="lt-who">{{ t.assetLinkRoleName ?? '-' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      }
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
