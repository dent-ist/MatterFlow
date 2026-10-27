import { toSignal } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { NotificationItem, NotificationsClient } from '../../api/generated/api-client';
import { retryWhenBackOnline } from '../../core/http/connectivity';
import { QuietRequests } from '../../core/http/interceptors';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { badgeText } from '../../shared/layout/notification-bell';
import { PageHeader } from '../../shared/ui/page-header';
import { Pager } from '../../shared/ui/pager';
import { NotificationStore } from './notification-store';
import {
  NotificationGroup,
  absoluteTime,
  groupLink,
  groupNotifications,
  groupSummary,
  notificationLink,
  relativeTime,
} from './notification-text';

const PAGE_SIZES = [25, 50, 100] as const;

type Filter = 'all' | 'unread';

/**
 * The Notifications page (NT-D4, #748, README 4.4): all of the person's notifications for objects they may still view, an All / Unread
 * toggle, paging, "Mark all as read". Filter, page and page size live in the address (`?filter=unread&page=2&pageSize=50`). Rows are links
 * to the task or matter; opening one marks it read. Below 640 px the rows are cards and the pager is Previous / Next.
 */
@Component({
  selector: 'mf-notifications-page',
  imports: [PageHeader, Pager, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-page-header
      heading="Notifications"
      description="Your recent notifications. Read ones are removed after about 90 days."
    >
      @if (store.unreadCount() > 0) {
        <button mfActions type="button" class="mf-btn" data-mark-all-read (click)="markAll()">
          Mark all as read
        </button>
      }
    </mf-page-header>

    <div class="npg__bar" role="group" aria-label="Show">
      <button
        type="button"
        class="mf-btn npg__toggle"
        data-filter="all"
        [attr.aria-pressed]="filter() === 'all'"
        (click)="setFilter('all')"
      >
        All
      </button>
      <button
        type="button"
        class="mf-btn npg__toggle"
        data-filter="unread"
        title="Unread notifications. The overdue notices of one day count once."
        [attr.aria-pressed]="filter() === 'unread'"
        (click)="setFilter('unread')"
      >
        Unread ({{ unreadLabel() }})
      </button>
    </div>

    <div
      class="mf-sr-only"
      role="status"
      aria-live="polite"
      data-result-count
      [textContent]="announcement()"
    ></div>

    <div class="npg__body" [attr.aria-busy]="state() === 'loading' ? 'true' : null">
      @switch (state()) {
        @case ('error') {
          <p class="npg__note" role="alert" data-page-error>
            Couldn't load notifications.
            <button type="button" class="mf-btn mf-btn--text" data-page-retry (click)="load()">
              Retry
            </button>
          </p>
        }
        @case ('ready') {
          @if (items().length === 0) {
            <p class="npg__note" data-page-empty>
              {{ filter() === 'unread' ? 'No unread notifications.' : 'No notifications yet.' }}
              @if (filter() === 'unread') {
                <button
                  type="button"
                  class="mf-btn mf-btn--text"
                  data-show-all
                  (click)="setFilter('all')"
                >
                  Show all
                </button>
              }
            </p>
          } @else {
            <ul class="npg__list" data-page-list>
              @for (entry of entries(); track entry.kind === 'group' ? entry.key : entry.item.id) {
                @if (entry.kind === 'group') {
                  <li data-notification-group-item>
                    <div class="npg__group">
                      <a
                        class="npg__row"
                        data-notification-group
                        [class.npg__row--unread]="entry.unread > 0"
                        [routerLink]="groupTarget(entry).commands"
                        [queryParams]="groupTarget(entry).queryParams"
                        [title]="summary(entry)"
                        (click)="openGroup(entry)"
                      >
                        <span class="npg__dot" aria-hidden="true"></span>
                        <span class="npg__message">
                          @if (entry.unread > 0) {
                            <span class="mf-sr-only">Unread: </span>
                          }
                          {{ summary(entry) }}
                          <span class="npg__count">({{ entry.items.length }} notices)</span></span
                        >
                        <time
                          class="npg__time"
                          [attr.datetime]="entry.newestUtc"
                          [title]="absolute(entry.newestUtc)"
                          >{{ relative(entry.newestUtc) }}</time
                        >
                      </a>
                      <button
                        type="button"
                        class="mf-btn mf-btn--text npg__toggle-group"
                        data-group-toggle
                        [attr.aria-expanded]="isOpen(entry.key)"
                        [attr.aria-controls]="'npg-group-' + entry.key"
                        (click)="toggleGroup(entry.key)"
                      >
                        {{ isOpen(entry.key) ? 'Hide' : 'Show' }} the {{ entry.items.length }}
                        notices
                      </button>
                    </div>
                    @if (isOpen(entry.key)) {
                      <ul class="npg__sub" [id]="'npg-group-' + entry.key" data-group-items>
                        @for (item of entry.items; track item.id) {
                          <li>
                            <a
                              class="npg__row"
                              data-notification-item
                              [class.npg__row--unread]="!item.isRead"
                              [routerLink]="link(item)"
                              [title]="item.message"
                              (click)="open(item)"
                            >
                              <span class="npg__dot" aria-hidden="true"></span>
                              <span class="npg__message">
                                @if (!item.isRead) {
                                  <span class="mf-sr-only">Unread: </span>
                                }
                                {{ item.message }}</span
                              >
                              <time
                                class="npg__time"
                                [attr.datetime]="item.createdUtc"
                                [title]="absolute(item.createdUtc)"
                                >{{ relative(item.createdUtc) }}</time
                              >
                            </a>
                          </li>
                        }
                      </ul>
                    }
                  </li>
                } @else {
                  @let item = entry.item;
                  <li>
                    <a
                      class="npg__row"
                      data-notification-item
                      [class.npg__row--unread]="!item.isRead"
                      [routerLink]="link(item)"
                      [title]="item.message"
                      (click)="open(item)"
                    >
                      <span class="npg__dot" aria-hidden="true"></span>
                      <span class="npg__message">
                        @if (!item.isRead) {
                          <span class="mf-sr-only">Unread: </span>
                        }
                        {{ item.message }}</span
                      >
                      <time
                        class="npg__time"
                        [attr.datetime]="item.createdUtc"
                        [title]="absolute(item.createdUtc)"
                        >{{ relative(item.createdUtc) }}</time
                      >
                    </a>
                  </li>
                }
              }
            </ul>
          }
        }
        @default {
          <p class="npg__note npg__muted" data-page-loading>Loading notifications...</p>
        }
      }
    </div>

    @if (state() === 'ready' && total() > 0) {
      <mf-pager
        [page]="page()"
        [pageSize]="pageSize()"
        [total]="total()"
        [pageSizes]="sizes"
        [edges]="false"
        (pageChange)="setPage($event)"
        (pageSizeChange)="setPageSize($event)"
      />
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .npg__bar {
      display: flex;
      gap: var(--mf-s2);
      margin-bottom: var(--mf-s3);
    }
    .npg__toggle[aria-pressed='true'] {
      border-color: var(--mf-primary);
      background: var(--mf-selected-bg);
      font-weight: 700;
    }
    .npg__body {
      min-height: 8rem;
    }
    .npg__list {
      margin: 0;
      padding: 0;
      list-style: none;
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }
    .npg__list li + li {
      border-top: 1px solid var(--mf-border);
    }
    .npg__row {
      display: flex;
      align-items: baseline;
      gap: var(--mf-s3);
      box-sizing: border-box;
      min-height: 44px;
      padding: var(--mf-s2) var(--mf-s3);
      color: var(--mf-text);
      text-decoration: none;
    }
    .npg__row:hover {
      background: var(--mf-surface-alt);
    }
    .npg__row--unread .npg__message {
      font-weight: 700;
    }
    .npg__dot {
      flex: none;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      align-self: center;
    }
    .npg__row--unread .npg__dot {
      background: var(--mf-primary);
    }
    .npg__message {
      flex: 1 1 auto;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .npg__group {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
    }
    .npg__group > .npg__row {
      flex: 1 1 20rem;
      min-width: 0;
    }
    .npg__toggle-group {
      flex: none;
      margin-right: var(--mf-s3);
    }
    .npg__count {
      color: var(--mf-text-muted);
      font-weight: 400;
    }
    .npg__sub {
      margin: 0;
      padding: 0 0 0 var(--mf-s4);
      list-style: none;
      border-top: 1px solid var(--mf-border);
    }
    .npg__sub li + li {
      border-top: 1px solid var(--mf-border);
    }
    .npg__time {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      white-space: nowrap;
    }
    .npg__note {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
      padding: var(--mf-s4) 0;
    }
    .npg__muted {
      color: var(--mf-text-muted);
    }
    /* Phones: cards, the time under the message. */
    @media (max-width: 639.98px) {
      .npg__row {
        flex-wrap: wrap;
        align-items: flex-start;
        row-gap: 2px;
      }
      .npg__dot {
        margin-top: 0.45rem;
        align-self: flex-start;
      }
      .npg__message {
        flex-basis: calc(100% - 8px - var(--mf-s3));
      }
      .npg__time {
        flex-basis: 100%;
        padding-left: calc(8px + var(--mf-s3));
      }
    }
  `,
})
export class NotificationsPage {
  protected readonly store = inject(NotificationStore);
  private readonly client = inject(NotificationsClient);
  private readonly quiet = inject(QuietRequests);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly sizes = PAGE_SIZES;
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly filter = computed<Filter>(() =>
    this.params().get('filter') === 'unread' ? 'unread' : 'all',
  );
  protected readonly page = computed(() => {
    const n = Number.parseInt(this.params().get('page') ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  });
  protected readonly pageSize = computed(() => {
    const n = Number.parseInt(this.params().get('pageSize') ?? '', 10);
    return (PAGE_SIZES as readonly number[]).includes(n) ? n : PAGE_SIZES[0];
  });

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly items = signal<readonly NotificationItem[]>([]);
  protected readonly total = signal(0);
  protected readonly announcement = signal('');
  /** The overdue notices of one day and kind are one entry; "Show the n notices" opens a group up (PM v2, #884). Display only: nothing is merged on the server. */
  protected readonly entries = computed(() => groupNotifications(this.items()));
  protected readonly summary = groupSummary;
  protected readonly groupTarget = groupLink;
  private readonly opened = signal<ReadonlySet<string>>(new Set());
  protected readonly unreadLabel = computed(() => badgeText(this.store.unreadCount()));
  private loadedOnce = false;
  private requestId = 0;

  constructor() {
    effect(() => {
      this.filter();
      this.page();
      this.pageSize();
      untracked(() => void this.load());
    });
    retryWhenBackOnline(
      () => this.state() === 'error',
      () => void this.load(),
    );
  }

  protected async load(): Promise<void> {
    const mine = ++this.requestId;
    if (!this.loadedOnce) this.state.set('loading');
    try {
      const res = await this.quiet.run(() =>
        firstValueFrom(this.client.listNotifications(this.filter(), this.page(), this.pageSize())),
      );
      if (mine !== this.requestId) return;
      this.items.set(res.items);
      this.total.set(res.totalCount);
      this.state.set('ready');
      if (this.loadedOnce) this.announcement.set(this.countText(res.totalCount));
      this.loadedOnce = true;
    } catch {
      if (mine === this.requestId) this.state.set('error');
    }
  }

  private countText(total: number): string {
    if (total === 0)
      return this.filter() === 'unread' ? 'No unread notifications.' : 'No notifications.';
    const noun = total === 1 ? 'notification' : 'notifications';
    return `${total} ${this.filter() === 'unread' ? 'unread ' : ''}${noun}, page ${this.page()}.`;
  }

  protected setFilter(filter: Filter): void {
    void this.navigate({ filter: filter === 'unread' ? 'unread' : null, page: null });
  }

  protected setPage(page: number): void {
    void this.navigate({ page: page > 1 ? page : null });
  }

  protected setPageSize(size: number): void {
    void this.navigate({ pageSize: size === PAGE_SIZES[0] ? null : size, page: null });
  }

  private navigate(queryParams: Record<string, string | number | null>): Promise<boolean> {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
    });
  }

  protected async markAll(): Promise<void> {
    await this.store.markAllRead();
    await this.load();
  }

  protected isOpen(key: string): boolean {
    return this.opened().has(key);
  }

  protected toggleGroup(key: string): void {
    const next = new Set(this.opened());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.opened.set(next);
  }

  protected openGroup(group: NotificationGroup<NotificationItem>): void {
    void this.store.markGroupRead(group.items);
  }

  protected open(item: NotificationItem): void {
    void this.store.markRead(item);
  }

  protected link(item: NotificationItem): unknown[] {
    return notificationLink(item);
  }

  protected relative(createdUtc: string): string {
    return relativeTime(createdUtc, this.clock.now(), this.zone);
  }

  protected absolute(createdUtc: string): string {
    return absoluteTime(createdUtc, this.zone);
  }
}
