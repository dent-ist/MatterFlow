import { toSignal } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MyMattersActivityItem, MyMattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { formatInstant } from '../../../core/time/time';
import { SortHeader } from '../../../shared/ui/data-table';
import { OptionsMenu } from '../../../shared/ui/options-menu';
import { Pager } from '../../../shared/ui/pager';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { ScrollRegion } from '../../../shared/ui/scroll-region';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';
import { activityWhat, activityWhen, activityWho } from '../facts';
import { ManagedMatters } from '../managed-matters';
import { MmFilters, commonArgs } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { SinceFeed } from '../panels/since-panel';
import { PanelBox } from '../panels/panel-box';

/** The events on a page of the grid (issue #946). */
export const ACTIVITY_TAB_PAGE = 25;

/** The kinds of the Kind filter, in the words the people use; the codes are the API's `kind` values. */
export const ACTIVITY_KINDS: readonly { value: string; label: string }[] = [
  { value: '', label: 'All kinds' },
  { value: 'TASK_CREATED', label: 'New task' },
  { value: 'STATUS_CHANGED', label: 'Status change' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ON_HOLD', label: 'Put on hold' },
  { value: 'REASSIGNED', label: 'Reassigned' },
  { value: 'COMMENTED', label: 'Comment' },
  { value: 'MANAGER_CHANGED', label: 'Manager changed' },
];

/**
 * Activity tab (epic #758, PX-23; epic #893 issue #946): what changed on my matters in the last 30 days as a grid, one event a row: When (date and time, a
 * sort button, newest first), Who (the person's name), What (one short phrase), Task (code and title, a link) and Matter (only for a person with several
 * matters). 25 rows a page with the shared pager; below 640 px the rows are cards in the same order. An unread event says "New" in words and is bold. The
 * Kind and Unread only choices live in the shared Options menu (in the address, so the counts on Overview open exactly this list). "Mark all as read" moves the
 * one marker the whole page shares (so does the line above the tab); opening the tab never does, opening an event marks that one and what is older. A
 * comment is only ever "Commented": its text is never shown. A polite live region says how many are new and which page was opened.
 */
@Component({
  selector: 'mf-mm-activity-tab',
  imports: [OptionsMenu, PanelBox, Pager, RouterLink, RowLink, ScrollRegion, SortHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .at__opt {
      display: grid;
      gap: 2px;
      min-width: 12rem;
    }
    .at__opt label {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .at__check {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 32px;
    }
    .at__wrap {
      max-width: 100%;
      overflow-x: auto;
    }
    .at__wrap:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    /* Fixed columns: the same column in the same place on every page. The cell padding is 12 px and a row is 44 px, one line (only a long task title wraps). */
    .at__table {
      width: 100%;
      min-width: 38rem;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: var(--mf-fs-sm);
    }
    .at__table th,
    .at__table td {
      padding: 12px;
      border-bottom: 1px solid var(--mf-border);
      text-align: left;
      vertical-align: middle;
    }
    .at__table thead th {
      padding-block: 8px;
      border-bottom: 1px solid var(--mf-border-strong, var(--mf-border));
      background: var(--mf-surface-alt);
      font-weight: 700;
      white-space: nowrap;
    }
    /* 10 px above and below a 24 px line: a 44 px row with 12 px between the columns. */
    .at__table td {
      padding-block: 10px;
    }
    .at__table tbody tr {
      height: 44px;
    }
    .at__table tbody tr:last-child td {
      border-bottom: 0;
    }
    .at__cut {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .at__when {
      white-space: nowrap;
      color: var(--mf-text-muted);
    }
    .at__task {
      overflow-wrap: anywhere;
    }
    .at__table a,
    .at__cards a {
      color: var(--mf-link);
    }
    .at__table td a {
      display: inline-block;
      min-height: 24px;
      line-height: 24px;
    }
    :host ::ng-deep .at__table thead .mf-sort {
      min-height: 28px;
    }
    .at__row--new td {
      font-weight: 700;
    }
    .at__row--new .at__when {
      color: var(--mf-text);
    }
    .at__new {
      margin-right: var(--mf-s1);
      color: var(--mf-text);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      text-transform: uppercase;
    }
    .at__cards {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .at__card {
      display: grid;
      gap: 2px;
      min-width: 0;
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      overflow-wrap: anywhere;
    }
    .at__card--new {
      border-inline-start: 4px solid var(--mf-primary);
    }
    .at__card--new .at__what {
      font-weight: 700;
    }
    .at__card a {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
    }
    .at__what {
      margin: 0;
    }
    .at__meta {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .at__list:focus {
      outline: none;
    }
    .at__empty {
      margin: 0;
      color: var(--mf-text-muted);
    }
    @media (max-width: 639.98px) {
      .at__check {
        min-height: 44px;
      }
      .at__opt select {
        min-height: 44px;
      }
    }
  `,
  template: `
    <mf-mm-panel
      name="activity-tab"
      title="Activity"
      [state]="loader.state()"
      [busy]="loader.busy()"
      [bare]="bare()"
      (retry)="loader.load()"
    >
      @if (unread() > 0) {
        <button
          mfPanelActions
          type="button"
          class="mf-btn"
          data-mark-all-read
          [disabled]="marking()"
          (click)="markAll()"
        >
          Mark all as read
        </button>
      }
      @if (!bare()) {
        <mf-options-menu mfPanelActions label="Activity" [active]="optionsActive()">
          <div class="at__opt" data-activity-filters>
            <label for="at-kind">Kind of event</label>
            <select
              id="at-kind"
              class="mf-control mf-control--compact"
              data-filter="kind"
              [value]="kind()"
              (change)="setKind($any($event.target).value)"
            >
              @for (k of kinds; track k.value) {
                <option [value]="k.value" [selected]="k.value === kind()">{{ k.label }}</option>
              }
            </select>
          </div>
          <label class="at__check">
            <input
              type="checkbox"
              data-filter="unread"
              [checked]="unreadOnly()"
              (change)="setUnreadOnly($any($event.target).checked)"
            />
            Unread only
          </label>
        </mf-options-menu>
      }
      <span class="mf-sr-only" role="status" aria-live="polite" data-activity-announce>{{
        announcement()
      }}</span>
      @if (items().length === 0) {
        <p class="at__empty" data-empty>
          {{
            filtered()
              ? 'No activity matches these filters in the last 30 days.'
              : 'No activity on your matters in the last 30 days.'
          }}
        </p>
      } @else {
        @if (phone()) {
          <ul class="at__cards at__list" tabindex="-1" data-activity-list data-activity-cards>
            @for (item of items(); track item.eventId) {
              <li
                class="at__card"
                [class.at__card--new]="item.isUnread"
                data-activity-row
                [attr.data-unread]="item.isUnread"
              >
                <a
                  data-activity-link
                  [attr.data-event-id]="item.eventId"
                  mfRowLink="my-matters-activity-tab"
                  [rowKey]="item.eventId"
                  [routerLink]="link(item)"
                  [queryParams]="item.taskId ? origin.params('my-matters') : undefined"
                  [state]="origin.state()"
                  (click)="opened(item)"
                  >{{ subject(item) }}</a
                >
                <p class="at__what">
                  @if (item.isUnread) {
                    <span class="at__new" data-new-word>New</span>
                  }
                  {{ what(item) }}
                </p>
                <p class="at__meta">
                  <time [attr.datetime]="item.occurredAtUtc" [attr.title]="stamp(item)">{{
                    when(item)
                  }}</time>
                  . {{ who(item) }}
                  @if (showMatter()) {
                    . {{ item.matterRef }} {{ item.matterName }}
                  }
                </p>
              </li>
            }
          </ul>
        } @else {
          <div class="at__wrap" mfScrollRegion="Activity table">
            <table class="at__table" data-activity-table>
              <caption class="mf-sr-only">
                Activity on your matters in the last 30 days,
                {{
                  newestFirst() ? 'newest' : 'oldest'
                }}
                first.
                {{
                  total()
                }}
                {{
                  total() === 1 ? 'event' : 'events'
                }}.
              </caption>
              <colgroup>
                <col [style.width]="showMatter() ? '15%' : '16%'" />
                <col [style.width]="showMatter() ? '15%' : '16%'" />
                <col [style.width]="showMatter() ? '28%' : '30%'" />
                <col />
                @if (showMatter()) {
                  <col style="width: 16%" />
                }
              </colgroup>
              <thead>
                <tr>
                  <th
                    mfSort="when"
                    data-sort-when
                    [sort]="sortExpr()"
                    defaultSort="-when"
                    (sorted)="setSort($event)"
                  >
                    When
                  </th>
                  <th scope="col">Who</th>
                  <th scope="col">What</th>
                  <th scope="col">Task</th>
                  @if (showMatter()) {
                    <th scope="col">Matter</th>
                  }
                </tr>
              </thead>
              <tbody class="at__list" tabindex="-1" data-activity-list>
                @for (item of items(); track item.eventId) {
                  <tr
                    class="at__row"
                    [class.at__row--new]="item.isUnread"
                    data-activity-row
                    [attr.data-unread]="item.isUnread"
                  >
                    <td class="at__when">
                      @if (item.isUnread) {
                        <span class="at__new" data-new-word>New</span>
                      }
                      <time [attr.datetime]="item.occurredAtUtc" [attr.title]="stamp(item)">{{
                        when(item)
                      }}</time>
                    </td>
                    <td class="at__cut" [attr.title]="who(item)" data-col="who">
                      {{ who(item) }}
                    </td>
                    <td class="at__cut" [attr.title]="what(item)" data-col="what">
                      {{ what(item) }}
                    </td>
                    <td class="at__task" data-col="task">
                      <a
                        data-activity-link
                        [attr.data-event-id]="item.eventId"
                        mfRowLink="my-matters-activity-tab"
                        [rowKey]="item.eventId"
                        [routerLink]="link(item)"
                        [queryParams]="item.taskId ? origin.params('my-matters') : undefined"
                        [state]="origin.state()"
                        (click)="opened(item)"
                        >{{ subject(item) }}</a
                      >
                    </td>
                    @if (showMatter()) {
                      <td
                        class="at__cut"
                        data-col="matter"
                        [attr.title]="
                          item.matterRef + ' ' + item.matterName + ', ' + item.clientName
                        "
                      >
                        @if (canLinkMatter()) {
                          <a data-matter-link [routerLink]="['/matters', item.matterId]"
                            >{{ item.matterRef }} {{ item.matterName }}</a
                          >
                        } @else {
                          {{ item.matterRef }} {{ item.matterName }}
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        @if (total() > pageSize) {
          <mf-pager
            [page]="pageNo()"
            [pageSize]="pageSize"
            [total]="total()"
            [edges]="false"
            (pageChange)="setPage($event)"
          />
        }
      }
    </mf-mm-panel>
  `,
})
export class ActivityTab {
  readonly filters = input.required<MmFilters>();
  /** The marker moved here: the page's other panels read again. */
  readonly marked = output<void>();

  protected readonly origin = inject(TaskOriginLinks);
  private readonly api = inject(MyMattersClient);
  private readonly auth = inject(AuthStore);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  /** The line of changes above this tab (when the tab is on the page): its "Mark as read" moves the marker this list is read against. */
  private readonly since = inject(SinceFeed, { optional: true });
  /** The matters the person manages: the Matter column is for several of them only. */
  private readonly managed = inject(ManagedMatters, { optional: true });
  protected readonly phone = phoneCards();

  protected readonly pageSize = ACTIVITY_TAB_PAGE;
  protected readonly kinds = ACTIVITY_KINDS;
  protected readonly marking = signal(false);
  protected readonly announcement = signal('');
  protected readonly canLinkMatter = computed(() => this.auth.canLink('matter'));

  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly matterId = computed(() => {
    const n = Number(this.query().get('matterId'));
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  protected readonly kind = computed(() => {
    const k = this.query().get('kind') ?? '';
    return ACTIVITY_KINDS.some((x) => x.value === k) ? k : '';
  });
  protected readonly unreadOnly = computed(() => this.query().get('unread') === 'true');
  /** `?asort=when` is oldest first; absent is newest first (the default). */
  protected readonly newestFirst = computed(() => this.query().get('asort') !== 'when');
  protected readonly sortExpr = computed(() => (this.newestFirst() ? '-when' : 'when'));
  protected readonly pageNo = computed(() => {
    const n = Number.parseInt(this.query().get('apage') ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  });
  protected readonly filtered = computed(
    () => this.matterId() !== null || this.kind() !== '' || this.unreadOnly(),
  );
  /** Things in force inside the Options menu (the number on its button). */
  protected readonly optionsActive = computed(
    () => (this.kind() !== '' ? 1 : 0) + (this.unreadOnly() ? 1 : 0),
  );
  /** The Matter column: a person with several matters, and not while one matter is chosen (it would say the same on every row). */
  protected readonly showMatter = computed(
    () =>
      this.matterId() === null &&
      (this.filters().scope === 'all' || !this.managed || this.managed.only() === null),
  );
  /** No activity at all (no filter is hiding any): one muted line, no filters (issue #920). */
  protected readonly bare = computed(
    () => this.loader.state() === 'ready' && this.items().length === 0 && !this.filtered(),
  );

  protected readonly loader = panelLoader(
    () => [
      this.filters(),
      this.matterId(),
      this.kind(),
      this.unreadOnly(),
      this.newestFirst(),
      this.pageNo(),
      this.since?.marks(),
    ],
    () => {
      const a = commonArgs(this.filters());
      return this.api.getMyMattersActivity(
        ACTIVITY_TAB_PAGE,
        this.matterId() ?? undefined,
        this.kind() ? [this.kind()] : undefined,
        this.unreadOnly() ? true : undefined,
        undefined,
        this.newestFirst() ? undefined : 'asc',
        this.pageNo() > 1 ? this.pageNo() : undefined,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
      );
    },
  );

  /** Local marks (events marked read here) until the next reload. */
  private readonly readUpTo = signal(0);

  protected readonly items = computed((): MyMattersActivityItem[] => {
    const all = this.loader.data()?.items ?? [];
    const upTo = this.readUpTo();
    return upTo === 0
      ? all
      : all.map((i) => (i.isUnread && i.eventId <= upTo ? { ...i, isUnread: false } : i));
  });
  protected readonly total = computed(() => this.loader.data()?.total ?? 0);
  protected readonly unread = computed(() => this.items().filter((i) => i.isUnread).length);
  protected readonly who = activityWho;
  protected readonly what = activityWhat;

  constructor() {
    restoreRowFocus('my-matters-activity-tab', () => this.loader.state() === 'ready');
    effect(() => {
      const d = this.loader.data();
      untracked(() => {
        this.readUpTo.set(0);
        if (!d) return;
        const pages = Math.max(1, Math.ceil(d.total / ACTIVITY_TAB_PAGE));
        // A page past the end (a filter made the list shorter, an old address): the first page.
        if (d.items.length === 0 && this.pageNo() > 1) {
          this.go({ apage: null });
          return;
        }
        this.announcement.set(
          this.pageNo() > 1
            ? `Page ${this.pageNo()} of ${pages}.`
            : d.unreadCount > 0
              ? `${d.unreadCount} new ${d.unreadCount === 1 ? 'event' : 'events'} since your last visit.`
              : '',
        );
      });
    });
  }

  protected when(e: MyMattersActivityItem): string {
    return activityWhen(e.occurredAtUtc, this.clock.now(), this.zone);
  }

  protected stamp(e: MyMattersActivityItem): string {
    return formatInstant(e.occurredAtUtc, this.zone);
  }

  /** The Task cell: the task's code and title; an event of no task (a manager change) names the matter it belongs to. */
  protected subject(e: MyMattersActivityItem): string {
    if (e.taskId) return [e.taskNumber, e.taskTitle].filter(Boolean).join(' ') || 'Task';
    return `${e.matterRef} ${e.matterName}`;
  }

  protected link(e: MyMattersActivityItem): unknown[] {
    return e.taskId ? ['/tasks', e.taskId] : ['/matters', e.matterId];
  }

  // ---- filters, sort and page (in the address)

  private go(params: Record<string, string | number | null>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
    });
  }

  protected setKind(kind: string): void {
    this.go({ kind: kind || null, apage: null });
  }

  protected setUnreadOnly(on: boolean): void {
    this.go({ unread: on ? 'true' : null, apage: null });
  }

  protected setSort(sort: string): void {
    this.go({ asort: sort === 'when' ? 'when' : null, apage: null });
  }

  protected setPage(page: number): void {
    this.go({ apage: page > 1 ? page : null });
  }

  // ---- the marker

  /** Opening an event marks it, and what is older, as read; the page does not wait for the answer. */
  protected opened(e: MyMattersActivityItem): void {
    if (!e.isUnread) return;
    this.api
      .markMyMattersActivitySeen({ upToEventId: e.eventId })
      .subscribe({ error: () => undefined });
  }

  /** "Mark all as read": everything up to now (up to the newest event of the answer when the list is newest first on its first page). */
  protected async markAll(): Promise<void> {
    if (this.marking()) return;
    this.marking.set(true);
    try {
      const latest = this.loader.data()?.latestEventId ?? 0;
      const upTo = this.newestFirst() && this.pageNo() === 1 && latest > 0 ? latest : undefined;
      await firstValueFrom(this.api.markMyMattersActivitySeen({ upToEventId: upTo }));
      this.readUpTo.set(upTo ?? Number.MAX_SAFE_INTEGER);
      this.announcement.set('All activity marked as read.');
      this.marked.emit();
      this.focusList();
    } catch {
      // The error toast says it; the events stay unread.
    } finally {
      this.marking.set(false);
    }
  }

  /** The list takes focus when the button that was pressed is no longer there. */
  private focusList(): void {
    afterNextRender(() => document.querySelector<HTMLElement>('[data-activity-list]')?.focus(), {
      injector: this.injector,
    });
  }
}
