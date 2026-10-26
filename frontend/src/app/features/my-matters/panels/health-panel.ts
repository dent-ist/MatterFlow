import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MyMattersClient, MyMattersHealthRow } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { AddCommentDialog } from '../../../shared/matter-actions/add-comment-dialog';
import { matterActionMenu } from '../../../shared/matter-actions/matter-actions';
import { Badge, BadgeTone } from '../../../shared/ui/badge';
import { Pager } from '../../../shared/ui/pager';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import {
  RecordCard,
  RecordCardDef,
  RecordCardList,
  phoneCards,
} from '../../../shared/ui/record-card-list';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone } from '../../../core/time/time';
import { reasonText, shortDate } from '../facts';
import { MmFilters, commonArgs, queryToParams } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { PanelBox } from './panel-box';

export type HealthSort =
  'nextDeadline' | 'client' | 'matter' | 'open' | 'overdue' | 'dueThisWeek' | 'unassigned' | 'flag';

export const HEALTH_PAGE_SIZE = 50;

const FLAGS: Record<string, { label: string; tone: BadgeTone; icon: string }> = {
  RED: { label: 'Red', tone: 'danger', icon: 'pi-exclamation-circle' },
  AMBER: { label: 'Amber', tone: 'warning', icon: 'pi-exclamation-triangle' },
  GREEN: { label: 'Green', tone: 'success', icon: 'pi-check-circle' },
};

export { reasonText };

/**
 * Matter health (README 6.3): one row per matter in scope, the viewer sorts (nothing is ranked and the flag is not a default sort), server
 * paged at 50. The Matter cell is the link to the matter; "+ New task" is a separate button (never nested in the link) that opens Create
 * task with the matter fixed and returns here. The flag is text and icon first, colour second; "How is this decided?" spells the rule out.
 * Below 640 px the rows are cards with a full-width 44 px "+ New task". A matter with no manager never shows a warning anywhere.
 */
@Component({
  selector: 'mf-mm-health',
  imports: [
    ActionMenu,
    AddCommentDialog,
    Badge,
    NgTemplateOutlet,
    PanelBox,
    Pager,
    RecordCard,
    RecordCardDef,
    RecordCardList,
    RouterLink,
    RowLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .hp__how {
      margin: 0 0 var(--mf-s2);
    }
    .hp__rule {
      margin: 0 0 var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt, var(--mf-surface));
    }
    .hp__rule p {
      margin: 0 0 var(--mf-s1);
    }
    .hp__rule p:last-child {
      margin-bottom: 0;
    }
    .hp__scroll {
      overflow-x: auto;
    }
    .hp__table {
      width: 100%;
      border-collapse: collapse;
    }
    .hp__table th,
    .hp__table td {
      padding: var(--mf-s1) var(--mf-s2);
      border-top: 1px solid var(--mf-border);
      text-align: left;
      vertical-align: middle;
    }
    .hp__table thead th {
      border-top: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      white-space: nowrap;
    }
    .hp__table .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .hp__sort {
      display: inline-flex;
      gap: var(--mf-s1);
      align-items: center;
      min-height: 24px;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .hp__sort:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .hp__sort .pi {
      font-size: 0.75rem;
    }
    .hp__matter {
      min-width: 12rem;
    }
    .hp__table td a {
      display: inline-block;
      min-width: 24px;
      min-height: 24px;
      line-height: 24px;
    }
    .hp__client {
      color: var(--mf-text-muted);
    }
    .hp__fold {
      display: none;
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .hp__empty {
      display: grid;
      gap: var(--mf-s2);
      justify-items: start;
      padding: var(--mf-s2) 0;
    }
    .hp__empty p {
      margin: 0;
    }
    .hp__link {
      color: var(--mf-link);
    }
    @media (max-width: 639.98px) {
      .hp__link {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
      }
      .hp__how .mf-btn {
        min-height: 44px;
      }
    }
    .hp__muted {
      color: var(--mf-text-muted);
    }
    .hp__worst {
      display: block;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .hp__new {
      white-space: nowrap;
    }
    .hp__actions {
      white-space: nowrap;
    }
    .hp__actions > * {
      vertical-align: middle;
    }
    .hp__card-more {
      flex: 0 0 auto;
    }
    .hp__why {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    /* Tablet: Due this week and % complete move into the matter's row detail (README 9). */
    @media (min-width: 640px) and (max-width: 1099.98px) {
      .hp__col-wide,
      .hp__col-client {
        display: none;
      }
      .hp__table th,
      .hp__table td {
        padding-inline: 3px;
      }
      .hp__matter {
        min-width: 7rem;
      }
      .hp__new {
        padding-inline: var(--mf-s2);
      }
      .hp__fold {
        display: block;
      }
    }
    .hp__cards {
      display: block;
    }
    .hp__card-line {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .hp__card-new {
      flex: 1 0 100%;
      min-height: 44px;
      margin-top: var(--mf-s1);
    }
  `,
  template: `
    <mf-mm-panel
      name="health"
      title="Matter health"
      [state]="loader.state()"
      [busy]="loader.busy()"
      (retry)="loader.load()"
    >
      @if (page(); as p) {
        @if (p.total === 0) {
          <div
            class="hp__empty"
            data-empty
            [attr.data-empty-kind]="filtered() ? 'filtered' : 'none'"
          >
            @if (filtered()) {
              <p>No matters match these filters.</p>
              <button type="button" class="mf-btn" data-clear-filters (click)="clearFilters.emit()">
                Clear filters
              </button>
            } @else if (filters().scope === 'all') {
              <p>There are no active matters.</p>
            } @else {
              <p data-no-matters>You are not the project manager of any matter yet.</p>
              @if (canShowAll()) {
                <button type="button" class="mf-btn" data-show-all (click)="showAll.emit()">
                  Show all matters
                </button>
              } @else {
                <p class="hp__muted">Ask a director to assign you.</p>
              }
              @if (canMyWork()) {
                <a class="hp__link" routerLink="/my-work" data-to-my-work>Go to My Work</a>
              }
            }
          </div>
        } @else {
          <p class="hp__how">
            <button
              type="button"
              class="mf-btn mf-btn--text"
              data-how
              [attr.aria-expanded]="howOpen()"
              aria-controls="mm-health-rule"
              (click)="howOpen.set(!howOpen())"
            >
              How is this decided?
            </button>
          </p>
          @if (howOpen()) {
            <div class="hp__rule" id="mm-health-rule" data-rule>
              <p>
                <strong>Red</strong>: at least one open task is overdue. <strong>Amber</strong>:
                nothing is overdue, but an open task has nobody assigned, is due within
                {{ p.amberDueDays }} days, or has been on hold for more than
                {{ p.stuckOnHoldDays }} days. <strong>Green</strong>: none of those.
              </p>
              <p>
                A matter with no open tasks is Green. Who manages a matter, or whether anybody does,
                never changes the flag, and the flag does not rank matters.
              </p>
            </div>
          }
          @if (phone()) {
            <div class="hp__cards">
              <mf-record-card-list
                state="ready"
                noun="matters"
                label="Matter health"
                [empty]="false"
              >
                <ng-template [mfRecordCard]="p.items" let-r>
                  <mf-record-card
                    [name]="r.matterRef + ' ' + r.matterName"
                    [link]="['/matters', r.matterId]"
                    list="my-matters-health"
                    [rowKey]="r.matterId"
                  >
                    <span mfCardBadges>
                      <mf-badge [tone]="flag(r).tone" [icon]="flag(r).icon" data-flag>{{
                        flag(r).label
                      }}</mf-badge>
                    </span>
                    <ng-container mfCardMeta>
                      <p class="rc-line">
                        <span class="rc-text">{{ r.clientName }}</span>
                      </p>
                      <p class="rc-line">
                        <span class="rc-text" data-flag-reason>{{ worst(r) }}</span>
                      </p>
                      <p class="rc-line" data-card-numbers>
                        <span class="rc-text">{{ numbers(r) }}</span>
                      </p>
                      <p class="rc-line">
                        <span class="rc-text">Next deadline: {{ next(r) }}</span>
                      </p>
                    </ng-container>
                    <ng-container mfCardCounts>
                      @if (canCreate()) {
                        <button
                          type="button"
                          class="mf-btn hp__card-new"
                          data-new-task
                          [attr.aria-label]="'New task for ' + r.matterRef"
                          (click)="newTask(r)"
                        >
                          <i class="pi pi-plus" aria-hidden="true"></i> New task
                        </button>
                      }
                      <span class="hp__card-more" data-row-actions>
                        <mf-action-menu
                          [floating]="true"
                          [label]="menus().get(r.matterId)!.label"
                          [items]="menus().get(r.matterId)!.items"
                        />
                      </span>
                    </ng-container>
                  </mf-record-card>
                </ng-template>
              </mf-record-card-list>
            </div>
          } @else {
            <div class="hp__scroll">
              <table class="hp__table" data-health-table>
                <caption class="mf-sr-only">
                  Matter health,
                  {{
                    p.total
                  }}
                  matters, sorted by
                  {{
                    sortName()
                  }}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" class="hp__col-client" [attr.aria-sort]="ariaSort('client')">
                      <ng-container
                        *ngTemplateOutlet="head; context: { key: 'client', label: 'Client' }"
                      />
                    </th>
                    <th scope="col" [attr.aria-sort]="ariaSort('matter')">
                      <ng-container
                        *ngTemplateOutlet="head; context: { key: 'matter', label: 'Matter' }"
                      />
                    </th>
                    <th scope="col" class="num" [attr.aria-sort]="ariaSort('open')">
                      <ng-container
                        *ngTemplateOutlet="head; context: { key: 'open', label: 'Open' }"
                      />
                    </th>
                    <th scope="col" class="num" [attr.aria-sort]="ariaSort('overdue')">
                      <ng-container
                        *ngTemplateOutlet="head; context: { key: 'overdue', label: 'Overdue' }"
                      />
                    </th>
                    <th
                      scope="col"
                      class="num hp__col-wide"
                      [attr.aria-sort]="ariaSort('dueThisWeek')"
                    >
                      <ng-container
                        *ngTemplateOutlet="
                          head;
                          context: { key: 'dueThisWeek', label: 'Due this week' }
                        "
                      />
                    </th>
                    <th scope="col" class="num" [attr.aria-sort]="ariaSort('unassigned')">
                      <ng-container
                        *ngTemplateOutlet="
                          head;
                          context: { key: 'unassigned', label: 'Unassigned' }
                        "
                      />
                    </th>
                    <th scope="col" class="num hp__col-wide">% complete</th>
                    <th scope="col" [attr.aria-sort]="ariaSort('nextDeadline')">
                      <ng-container
                        *ngTemplateOutlet="
                          head;
                          context: { key: 'nextDeadline', label: 'Next deadline' }
                        "
                      />
                    </th>
                    <th scope="col" [attr.aria-sort]="ariaSort('flag')">
                      <ng-container
                        *ngTemplateOutlet="head; context: { key: 'flag', label: 'Flag' }"
                      />
                    </th>
                    <th scope="col"><span class="mf-sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of p.items; track r.matterId) {
                    <tr data-health-row [attr.data-matter-id]="r.matterId">
                      <td
                        class="hp__client hp__col-client"
                        [attr.title]="r.clientNumber + ' ' + r.clientName"
                      >
                        {{ r.clientName }}
                      </td>
                      <td class="hp__matter">
                        <a
                          data-matter-link
                          [routerLink]="['/matters', r.matterId]"
                          mfRowLink="my-matters-health"
                          [rowKey]="r.matterId"
                          >{{ r.matterRef }} {{ r.matterName }}</a
                        >
                        <p class="hp__fold" data-fold>{{ folded(r) }}</p>
                      </td>
                      <td class="num">
                        <a [routerLink]="['/tasks']" [queryParams]="params(r.query)">{{
                          r.open
                        }}</a>
                      </td>
                      <td class="num">{{ r.overdue }}</td>
                      <td class="num hp__col-wide">{{ r.dueThisWeek }}</td>
                      <td class="num">{{ r.unassigned }}</td>
                      <td class="num hp__col-wide">{{ percent(r) }}</td>
                      <td>{{ next(r) }}</td>
                      <td>
                        <span [attr.title]="why(r)" data-flag-cell>
                          <mf-badge [tone]="flag(r).tone" [icon]="flag(r).icon" data-flag>{{
                            flag(r).label
                          }}</mf-badge>
                          <span class="hp__worst" data-flag-reason>{{ worst(r) }}</span>
                          <span class="mf-sr-only"> ({{ why(r) }})</span>
                        </span>
                      </td>
                      <td class="hp__actions">
                        @if (canCreate()) {
                          <button
                            type="button"
                            class="mf-btn hp__new"
                            data-new-task
                            [attr.aria-label]="'New task for ' + r.matterRef"
                            (click)="newTask(r)"
                          >
                            <i class="pi pi-plus" aria-hidden="true"></i> New task
                          </button>
                        }
                        <span data-row-actions>
                          <mf-action-menu
                            [floating]="true"
                            [label]="menus().get(r.matterId)!.label"
                            [items]="menus().get(r.matterId)!.items"
                          />
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @if (p.total > p.pageSize) {
            <mf-pager
              [page]="pageNumber()"
              [pageSize]="p.pageSize"
              [total]="p.total"
              [edges]="false"
              (pageChange)="pageChange.emit($event)"
            />
          }
        }
      }
    </mf-mm-panel>
    @if (commentRow(); as row) {
      <mf-add-comment-dialog
        [matterId]="row.matterId"
        [matterLabel]="row.matterRef + ' ' + row.matterName"
        [(visible)]="commentOpen"
      />
    }

    <ng-template #head let-key="key" let-label="label">
      <button type="button" class="hp__sort" [attr.data-sort]="key" (click)="sortBy(key)">
        {{ label }}
        @if (sortKey() === key) {
          <i
            class="pi"
            [class.pi-arrow-up]="dir() === 'asc'"
            [class.pi-arrow-down]="dir() === 'desc'"
            aria-hidden="true"
          ></i>
        }
      </button>
    </ng-template>
  `,
})
export class HealthPanel {
  readonly filters = input.required<MmFilters>();
  readonly sort = input<HealthSort | null>(null);
  readonly dir = input<'asc' | 'desc'>('asc');
  readonly pageNumber = input(1);
  /** The page's filters differ from the default (the empty state then offers Clear filters, not "ask a director"). */
  readonly filtered = input(false);
  readonly sortChange = output<{ sort: HealthSort; dir: 'asc' | 'desc' }>();
  readonly pageChange = output<number>();
  readonly clearFilters = output<void>();
  readonly showAll = output<void>();

  private readonly api = inject(MyMattersClient);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  protected readonly phone = phoneCards();
  protected readonly howOpen = signal(false);

  protected readonly loader = panelLoader(
    () => [this.filters(), this.sort(), this.dir(), this.pageNumber()],
    () => {
      const a = commonArgs(this.filters());
      return this.api.getMyMattersHealth(
        this.sort() ?? undefined,
        this.sort() ? this.dir() : undefined,
        this.pageNumber(),
        HEALTH_PAGE_SIZE,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
      );
    },
  );

  constructor() {
    // Back from a matter puts focus on the row that was left.
    restoreRowFocus('my-matters-health', () => this.loader.state() === 'ready');
  }

  protected readonly page = computed(() => this.loader.data());
  protected readonly canCreate = computed(() => this.auth.has('Task.Create'));
  /** The row whose "Add comment" is open (the dialog posts to one of that matter's open tasks). */
  protected readonly commentRow = signal<MyMattersHealthRow | null>(null);
  protected readonly commentOpen = signal(false);
  protected readonly canShowAll = computed(() => this.auth.has('Matter.AssignManagers'));
  protected readonly canMyWork = computed(() => this.auth.has('Task.View'));
  /** The column the table is sorted by (the API's default is the next deadline). */
  protected readonly sortKey = computed<HealthSort>(
    () => (this.sort() ?? 'nextDeadline') as HealthSort,
  );
  protected readonly params = queryToParams;

  protected sortName(): string {
    return this.sortKey()
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase();
  }

  protected ariaSort(key: HealthSort): 'ascending' | 'descending' | 'none' {
    if (this.sortKey() !== key) return 'none';
    return this.dir() === 'desc' ? 'descending' : 'ascending';
  }

  protected sortBy(key: HealthSort): void {
    const same = this.sortKey() === key;
    this.sortChange.emit({ sort: key, dir: same && this.dir() === 'asc' ? 'desc' : 'asc' });
  }

  protected flag(r: MyMattersHealthRow) {
    return FLAGS[r.flag] ?? FLAGS['GREEN'];
  }

  /** The worst reason of the flag as words, with the number where there is one ("2 overdue"; "+1 more" when others apply): the row says why, not only a colour. */
  protected worst(r: MyMattersHealthRow): string {
    const [first, ...rest] = r.flagReasons;
    const words: Record<string, string> = {
      OVERDUE: `${r.overdue} overdue`,
      UNASSIGNED: `${r.unassigned} unassigned`,
      DUE_SOON: 'due soon',
      LONG_HOLD: 'on hold a long time',
      NO_OPEN_TASKS: 'no open tasks',
    };
    if (!first) return '';
    return (words[first] ?? first) + (rest.length > 0 ? `, +${rest.length} more` : '');
  }

  protected why(r: MyMattersHealthRow): string {
    const d = this.loader.data();
    const reasons = r.flagReasons.map((c) =>
      reasonText(c, d?.amberDueDays ?? 3, d?.stuckOnHoldDays ?? 7),
    );
    return `${this.flag(r).label}: ${reasons.join(', ')}`;
  }

  protected percent(r: MyMattersHealthRow): string {
    return r.percentComplete === undefined || r.percentComplete === null
      ? '-'
      : `${r.percentComplete}%`;
  }

  protected next(r: MyMattersHealthRow): string {
    return shortDate(r.nextDeadline, calendarDayInZone(this.clock.now(), this.zone).year, 'none');
  }

  protected folded(r: MyMattersHealthRow): string {
    return `${r.clientName}. ${r.dueThisWeek} due this week, ${this.percent(r) === '-' ? 'no workflow steps' : this.percent(r) + ' complete'}.`;
  }

  protected numbers(r: MyMattersHealthRow): string {
    return `${r.overdue} overdue . ${r.dueThisWeek} this week . ${r.unassigned} unassigned`;
  }

  /** The row's quick actions besides + New task, which keeps its button (epic #758, PX-25). */
  /** Built once per page of rows, not on every change detection. */
  protected readonly menus = computed(
    () => new Map((this.page()?.items ?? []).map((r) => [r.matterId, this.buildMenu(r)] as const)),
  );

  private buildMenu(r: MyMattersHealthRow) {
    return matterActionMenu(
      { matterId: r.matterId, matterRef: r.matterRef, name: r.matterName, isActive: true },
      (p) => this.auth.has(p),
      {
        newTask: () => this.newTask(r),
        bulk: () =>
          void this.router.navigate(['/matters', r.matterId], {
            queryParams: { tab: 'tasks' },
            state: { selectTasks: true },
          }),
        addComment: () => {
          this.commentRow.set(r);
          this.commentOpen.set(true);
        },
        openTasks: () =>
          void this.router.navigate(['/tasks'], { queryParams: { matter: r.matterId } }),
      },
      ['newTask'],
    );
  }

  /** Create task with the matter fixed; the page returns here (with the filters) when the task is created or the form is left. */
  protected newTask(r: MyMattersHealthRow): void {
    void this.router.navigate(['/tasks/new'], {
      queryParams: { matterId: r.matterId, returnTo: this.router.url },
    });
  }
}
