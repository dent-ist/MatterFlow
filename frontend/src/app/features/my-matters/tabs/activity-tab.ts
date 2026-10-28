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
import {
  MatterResponse,
  MattersClient,
  MyMattersActivityItem,
  MyMattersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { QuietRequests } from '../../../core/http/interceptors';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { formatInstant } from '../../../core/time/time';
import { EntityPicker, PickerOption } from '../../../shared/ui/entity-picker';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';
import { activityText, activityTime } from '../facts';
import { MmFilters, commonArgs } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { SinceFeed } from '../panels/since-panel';
import { PanelBox } from '../panels/panel-box';

/** The events asked for at a time (30 days are read page by page). */
export const ACTIVITY_TAB_PAGE = 30;

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

const matterOption = (m: MatterResponse): PickerOption => ({
  id: m.matterId,
  label: `${m.matterRef} ${m.name}`,
  inactive: !m.isActive,
});

/**
 * The items as the tab lists them: when some are unread, a divider "Since your last visit" before the unread ones and "Earlier" before the read
 * ones (the API sends newest first, so the unread ones lead); with none unread there are no dividers. Pure.
 */
export function activityRows(
  items: readonly MyMattersActivityItem[],
): ({ divider: string } | { item: MyMattersActivityItem })[] {
  const out: ({ divider: string } | { item: MyMattersActivityItem })[] = [];
  const anyUnread = items.some((i) => i.isUnread);
  let part: 'unread' | 'earlier' | null = null;
  for (const item of items) {
    const next = item.isUnread ? 'unread' : 'earlier';
    if (anyUnread && next !== part) {
      out.push({ divider: next === 'unread' ? 'Since your last visit' : 'Earlier' });
    }
    part = next;
    out.push({ item });
  }
  return out;
}

/**
 * Activity tab (epic #758, PX-23; README 6.5): what changed on my matters in the last 30 days, newest first, 30 at a time (cursor). An unread
 * event says "New" in words; a divider "Since your last visit" separates the unread ones from "Earlier". Filters: Matter, Kind and Unread only
 * (in the address, so the counts on Overview open exactly this list). "Mark all as read" and "Mark as read up to here" move the one marker the
 * whole page shares; opening the tab never does. Each event links to the task and to the matter; a comment is only ever "commented on <task>", its
 * text is never shown. A polite live region says how many are new and what a mark did; focus goes to a sensible place after a mark.
 */
@Component({
  selector: 'mf-mm-activity-tab',
  imports: [EntityPicker, PanelBox, RouterLink, RowLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* One control height in the row (the compact height of the list filter bars, 44 px on a phone); the Matter picker is a shared component
       whose input takes its height from --mf-row-h, so the row sets that token for its subtree (#824). */
    .at__filters {
      --mf-fb-h: var(--mf-row-h-compact);
      --mf-row-h: var(--mf-fb-h);
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--mf-s3) var(--mf-s4);
      margin: 0 0 var(--mf-s3);
    }
    .at__field {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .at__field label {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .at__matter {
      width: min(22rem, 100%);
    }
    .at__select {
      min-width: 10rem;
    }
    .at__check {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 32px;
    }
    .at__list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .at__list:focus {
      outline: none;
    }
    .at__divider {
      margin: var(--mf-s3) 0 var(--mf-s1);
      padding-top: var(--mf-s2);
      border-top: 2px solid var(--mf-border);
      font-size: var(--mf-fs-sm);
      font-weight: 700;
      text-transform: uppercase;
      color: var(--mf-text-muted);
    }
    .at__row {
      display: grid;
      grid-template-columns: 3.5rem minmax(0, 1fr) auto;
      grid-template-areas:
        'mark text time'
        'mark meta act';
      column-gap: var(--mf-s3);
      padding: var(--mf-s1) 0;
      border-top: 1px solid var(--mf-border);
    }
    .at__mark {
      grid-area: mark;
      font-size: var(--mf-fs-sm);
      font-weight: 700;
    }
    .at__text {
      grid-area: text;
      min-width: 0;
      min-height: 24px;
      overflow-wrap: anywhere;
      color: var(--mf-link);
    }
    .at__row--new .at__text {
      font-weight: 700;
    }
    .at__meta {
      grid-area: meta;
      min-width: 0;
      overflow: hidden;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .at__meta a {
      color: var(--mf-link);
    }
    .at__time {
      grid-area: time;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      white-space: nowrap;
    }
    .at__act {
      min-height: 24px;
      grid-area: act;
      justify-self: end;
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      font-size: var(--mf-fs-sm);
      cursor: pointer;
    }
    .at__more {
      margin-top: var(--mf-s3);
    }
    .at__empty {
      margin: 0;
      color: var(--mf-text-muted);
    }
    @media (max-width: 639.98px) {
      .at__row {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
          'mark time'
          'text text'
          'meta meta'
          'act act';
      }
      .at__act,
      .at__more,
      .at__text,
      .at__meta a {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
      }
      .at__act {
        justify-self: start;
      }
      .at__select,
      .at__field,
      .at__matter {
        width: 100%;
      }
      .at__filters {
        --mf-fb-h: 44px;
      }
      .at__filters .mf-control,
      .at__check {
        min-height: var(--mf-fb-h, 44px);
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
        <div class="at__filters" data-activity-filters>
          <div class="at__field at__matter">
            <mf-entity-picker
              label="Matter"
              inputId="at-matter"
              placeholder="All matters"
              [search]="searchMatters"
              [selected]="matter()"
              (selectedChange)="matterPicked($event)"
            />
          </div>
          <div class="at__field">
            <label for="at-kind">Kind</label>
            <select
              id="at-kind"
              class="mf-control mf-control--compact at__select"
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
        </div>
      }
      <span class="mf-sr-only" role="status" aria-live="polite" data-activity-announce>{{
        announcement()
      }}</span>
      @if (rows().length === 0) {
        <p class="at__empty" data-empty>
          {{
            filtered()
              ? 'No activity matches these filters in the last 30 days.'
              : 'No activity on your matters in the last 30 days.'
          }}
        </p>
      } @else {
        <ul class="at__list" tabindex="-1" data-activity-list #list>
          @for (r of rows(); track $index) {
            @if ('divider' in r) {
              <li class="at__divider" role="presentation" data-divider>{{ r.divider }}</li>
            } @else {
              <li
                class="at__row"
                [class.at__row--new]="r.item.isUnread"
                data-activity-row
                [attr.data-unread]="r.item.isUnread"
              >
                <span class="at__mark">
                  @if (r.item.isUnread) {
                    <span data-new-word>New</span>
                  }
                </span>
                <a
                  class="at__text"
                  data-activity-link
                  [attr.data-event-id]="r.item.eventId"
                  mfRowLink="my-matters-activity-tab"
                  [rowKey]="r.item.eventId"
                  [routerLink]="
                    r.item.taskId ? ['/tasks', r.item.taskId] : ['/matters', r.item.matterId]
                  "
                  [queryParams]="r.item.taskId ? origin.params('my-matters') : undefined"
                  [state]="origin.state()"
                  (click)="opened(r.item)"
                  >{{ text(r.item) }}</a
                >
                <span class="at__meta">
                  @if (canLinkMatter()) {
                    <a data-matter-link [routerLink]="['/matters', r.item.matterId]"
                      >{{ r.item.matterRef }} {{ r.item.matterName }}</a
                    >
                  } @else {
                    {{ r.item.matterRef }} {{ r.item.matterName }}
                  }
                  . {{ r.item.clientName }}
                </span>
                <time
                  class="at__time"
                  [attr.datetime]="r.item.occurredAtUtc"
                  [attr.title]="stamp(r.item)"
                  >{{ when(r.item) }}</time
                >
                @if (r.item.isUnread) {
                  <button
                    type="button"
                    class="at__act"
                    data-mark-up-to
                    [disabled]="marking()"
                    (click)="markUpTo(r.item)"
                  >
                    Mark as read up to here<span class="mf-sr-only">: {{ text(r.item) }}</span>
                  </button>
                }
              </li>
            }
          }
        </ul>
        @if (hasMore()) {
          <button
            type="button"
            class="mf-btn at__more"
            data-show-more
            [disabled]="loadingMore()"
            (click)="more()"
          >
            Load more
          </button>
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
  private readonly mattersApi = inject(MattersClient);
  private readonly auth = inject(AuthStore);
  private readonly quiet = inject(QuietRequests);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  /** The line of changes above this tab (when the tab is on the page): its "Mark as read" moves the marker this list is read against. */
  private readonly since = inject(SinceFeed, { optional: true });
  protected readonly phone = phoneCards();

  protected readonly kinds = ACTIVITY_KINDS;
  protected readonly marking = signal(false);
  protected readonly loadingMore = signal(false);
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
  protected readonly filtered = computed(
    () => this.matterId() !== null || this.kind() !== '' || this.unreadOnly(),
  );
  protected readonly matter = signal<PickerOption | null>(null);
  /** No activity at all (no filter is hiding any): one muted line, no filters (issue #920). */
  protected readonly bare = computed(
    () => this.loader.state() === 'ready' && this.rows().length === 0 && !this.filtered(),
  );

  protected readonly loader = panelLoader(
    () => [this.filters(), this.matterId(), this.kind(), this.unreadOnly(), this.since?.marks()],
    () => {
      const a = commonArgs(this.filters());
      return this.api.getMyMattersActivity(
        ACTIVITY_TAB_PAGE,
        this.matterId() ?? undefined,
        this.kind() ? [this.kind()] : undefined,
        this.unreadOnly() ? true : undefined,
        undefined,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
      );
    },
  );

  /** The pages after the first one (the first is the loader's); a reload of the first page starts the list again. */
  private readonly later = signal<MyMattersActivityItem[]>([]);
  private readonly cursor = signal<number | undefined>(undefined);
  private readonly more$ = signal(false);
  /** Local marks (events marked read here) until the next reload. */
  private readonly readUpTo = signal(0);

  constructor() {
    restoreRowFocus('my-matters-activity-tab', () => this.loader.state() === 'ready');
    effect(() => {
      const d = this.loader.data();
      untracked(() => {
        this.later.set([]);
        this.cursor.set(d?.nextCursor ?? undefined);
        this.more$.set(d?.hasMore ?? false);
        this.readUpTo.set(0);
        if (d) {
          this.announcement.set(
            d.unreadCount > 0
              ? `${d.unreadCount} new ${d.unreadCount === 1 ? 'event' : 'events'} since your last visit.`
              : '',
          );
        }
      });
    });
    // The chosen matter follows the address (a link, Back): its name is fetched once for an id the picker did not choose itself.
    effect(() => {
      const id = this.matterId();
      untracked(() => void this.syncMatter(id));
    });
  }

  private async syncMatter(id: number | null): Promise<void> {
    if (id === null) {
      this.matter.set(null);
      return;
    }
    if (this.matter()?.id === id) return;
    try {
      const m = await this.quiet.run(() => firstValueFrom(this.mattersApi.getMatter(id)));
      if (this.matterId() === id) this.matter.set(matterOption(m));
    } catch {
      this.matter.set({ id, label: `Matter ${id}` });
    }
  }

  protected readonly searchMatters = async (query: string): Promise<PickerOption[]> => {
    const f = this.filters();
    const page = await firstValueFrom(
      this.mattersApi.listMatters(
        query || undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        f.scope === 'all' ? (f.managerId ?? undefined) : undefined,
        f.scope === 'mine' ? true : undefined,
        undefined,
        undefined,
        undefined,
        1,
        8,
        undefined,
      ),
    );
    return page.items.map(matterOption);
  };

  protected readonly items = computed((): MyMattersActivityItem[] => {
    const all = [...(this.loader.data()?.items ?? []), ...this.later()];
    const upTo = this.readUpTo();
    return upTo === 0
      ? all
      : all.map((i) => (i.isUnread && i.eventId <= upTo ? { ...i, isUnread: false } : i));
  });
  protected readonly rows = computed(() => activityRows(this.items()));
  protected readonly unread = computed(() => this.items().filter((i) => i.isUnread).length);
  protected readonly hasMore = computed(() => this.more$());
  protected readonly text = activityText;

  protected when(e: MyMattersActivityItem): string {
    return activityTime(e.occurredAtUtc, this.clock.now(), this.zone);
  }

  protected stamp(e: MyMattersActivityItem): string {
    return formatInstant(e.occurredAtUtc, this.zone);
  }

  // ---- filters (in the address)

  private go(params: Record<string, string | null>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
    });
  }

  protected matterPicked(option: PickerOption | null): void {
    this.matter.set(option);
    this.go({ matterId: option ? String(option.id) : null });
  }

  protected setKind(kind: string): void {
    this.go({ kind: kind || null });
  }

  protected setUnreadOnly(on: boolean): void {
    this.go({ unread: on ? 'true' : null });
  }

  // ---- paging

  protected async more(): Promise<void> {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    try {
      const a = commonArgs(this.filters());
      const page = await this.quiet.run(() =>
        firstValueFrom(
          this.api.getMyMattersActivity(
            ACTIVITY_TAB_PAGE,
            this.matterId() ?? undefined,
            this.kind() ? [this.kind()] : undefined,
            this.unreadOnly() ? true : undefined,
            this.cursor(),
            a.scope,
            a.role,
            a.clientId,
            undefined,
            undefined,
            a.managerId,
          ),
        ),
      );
      this.later.update((l) => [...l, ...page.items]);
      this.cursor.set(page.nextCursor ?? undefined);
      this.more$.set(page.hasMore);
      this.announcement.set(`${page.items.length} more events loaded.`);
    } catch {
      this.announcement.set("Couldn't load more events. Try again.");
    } finally {
      this.loadingMore.set(false);
    }
  }

  // ---- the marker

  /** Opening an event marks it, and what is older, as read; the page does not wait for the answer. */
  protected opened(e: MyMattersActivityItem): void {
    if (!e.isUnread) return;
    this.api
      .markMyMattersActivitySeen({ upToEventId: e.eventId })
      .subscribe({ error: () => undefined });
  }

  private async mark(
    upToEventId: number | undefined,
    done: string,
    after: () => void,
  ): Promise<void> {
    if (this.marking()) return;
    this.marking.set(true);
    try {
      await firstValueFrom(this.api.markMyMattersActivitySeen({ upToEventId }));
      this.readUpTo.set(upToEventId ?? Number.MAX_SAFE_INTEGER);
      this.announcement.set(done);
      this.marked.emit();
      after();
    } catch {
      // The error toast says it; the events stay unread.
    } finally {
      this.marking.set(false);
    }
  }

  protected markAll(): Promise<void> {
    const latest = this.loader.data()?.latestEventId ?? 0;
    return this.mark(latest > 0 ? latest : undefined, 'All activity marked as read.', () =>
      this.focusList(),
    );
  }

  protected markUpTo(e: MyMattersActivityItem): Promise<void> {
    return this.mark(e.eventId, 'Marked as read up to here.', () => this.focusEvent(e.eventId));
  }

  /** The list takes focus when its unread part has gone (the button that was pressed is no longer there). */
  private focusList(): void {
    afterNextRender(() => document.querySelector<HTMLElement>('[data-activity-list]')?.focus(), {
      injector: this.injector,
    });
  }

  private focusEvent(id: number): void {
    afterNextRender(
      () =>
        document.querySelector<HTMLElement>(`[data-activity-link][data-event-id="${id}"]`)?.focus(),
      { injector: this.injector },
    );
  }
}
