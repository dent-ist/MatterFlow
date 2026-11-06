import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { todayText } from '../calendar-month';
import { NumericDatePipe, numericDate } from '../../../shared/ui/numeric-date';
import { EventIcon } from '../../../shared/ui/event-type';
import { Badge } from '../../../shared/ui/badge';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { SidePanel, SideSection } from '../../../shared/ui/side-panel';
import { MmFilters } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { agoShort, feedTitle, feedWhat, KIND_LOOK } from './feed-format';
import { MmApi } from './mm-api';
import { MmLayout } from './mm-layout';
import { FEED_KINDS, FeedItem, FeedKind, MatterEvent, ShowFilter, StatusFilter } from './mm-models';
import { GridFilters } from './mm-scope';
import { MmTaskList } from './task-list';
import { IntPipe } from '../../../shared/ui/number-format';

const PREVIEW_ITEMS = 6;
const UPCOMING_DAYS = 14;

/**
 * The Overview tab (`mf-mm-overview`, epic #953 UI-13): the task grid on the left and, on the right, the side panel with Upcoming events (the next 14 days) and Recent activity
 * (six items, with the six kinds as chips and "View all"). The side panel collapses to a rail whose buttons carry the counts. Changing the client or the matter changes all three
 * at once, and a polite live message says what is shown. Clicking a task item opens the task in a NEW browser tab; an asset item opens the Assets tab with that asset's side panel.
 * Below 769 px the side sections stack under the grid. Each part loads and fails on its own.
 */
@Component({
  selector: 'mf-mm-overview',
  imports: [
    Badge,
    IntPipe,
    Dropdown,
    EventIcon,
    MmTaskList,
    NgTemplateOutlet,
    NumericDatePipe,
    SidePanel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <div class="ov" [class.stack]="layout.stacked()">
      <div class="lcol">
        <mf-mm-task-list
          [filters]="filters()"
          [statuses]="statuses()"
          [grid]="grid()"
          [show]="show()"
          [panelOpen]="layout.sideOpen() && !layout.stacked()"
          [showMatter]="showMatter()"
          [resetKey]="resetKey()"
          (paramsChange)="paramsChange.emit($event)"
        />
      </div>
      @if (layout.stacked()) {
        <div class="stackcol">
          <ng-container *ngTemplateOutlet="events" />
          <ng-container *ngTemplateOutlet="activity" />
        </div>
      } @else {
        <mf-side-panel
          class="side"
          [open]="layout.sideOpen()"
          (openChange)="$event ? layout.expandSide() : layout.collapseSide()"
          [sections]="sections()"
          label="Upcoming events and recent activity"
        >
          <ng-container *ngTemplateOutlet="events" />
          <ng-container *ngTemplateOutlet="activity" />
        </mf-side-panel>
      }
    </div>

    <ng-template #events>
      <section class="mf-card card ev" data-section="events" aria-labelledby="mm-ev-h">
        <div class="ch">
          <h2 id="mm-ev-h" class="mf-card__title" tabindex="-1" data-section-focus>
            Upcoming Events
          </h2>
          <span class="sub">next {{ days }} days</span>
        </div>
        <div class="list" [attr.aria-busy]="upcoming.busy()">
          @if (upcoming.state() === 'error') {
            <p class="msg" role="alert">
              Couldn't load events.
              <button type="button" class="mf-btn mf-btn--text" (click)="upcoming.load()">
                Retry
              </button>
            </p>
          } @else if ((upcoming.data()?.items?.length ?? 0) === 0) {
            <p class="msg">
              {{
                upcoming.state() === 'loading'
                  ? 'Loading events'
                  : 'No events in the next ' + days + ' days.'
              }}
            </p>
          } @else {
            <ul class="items">
              @for (e of upcoming.data()!.items; track e.eventId) {
                <li>
                  <button
                    type="button"
                    class="it"
                    [attr.data-event]="e.eventId"
                    (click)="openEvent(e)"
                  >
                    <span class="when">
                      <b>{{ when(e) }}</b>
                      @if (e.time) {
                        <span>{{ e.time | mfNum: 'time' }}</span>
                      }
                    </span>
                    <span class="body">
                      <span class="t">{{ e.title }}</span>
                      <span class="m">{{ e.matterName }}</span>
                      <mf-event-icon [type]="e.typeCode" [chip]="true" />
                    </span>
                  </button>
                </li>
              }
            </ul>
          }
        </div>
        <div class="cf">
          <button
            type="button"
            class="mf-btn mf-btn--text"
            data-view-calendar
            (click)="viewCalendar.emit(null)"
          >
            Open the Calendar
          </button>
        </div>
      </section>
    </ng-template>

    <ng-template #activity>
      <section class="mf-card card ac" data-section="activity" aria-labelledby="mm-ac-h">
        <div class="ch">
          <h2 id="mm-ac-h" class="mf-card__title" tabindex="-1" data-section-focus>
            Recent Activity
          </h2>
          @if (feed.data(); as f) {
            @if (f.unreadCount > 0) {
              <mf-badge class="unread" tone="info" icon="pi-bell"
                >{{ f.unreadCount | mfInt }} unread</mf-badge
              >
            }
          }
        </div>
        <div class="kc">
          <mf-dropdown
            buttonId="mm-feed-kind"
            label="Kind of Activity"
            prefix="Show:"
            [items]="kindItems()"
            [value]="kind()"
            (valueChange)="kind.set($any($event))"
            [countOnButton]="true"
            neutralValue="ALL"
            [panelWidth]="280"
          />
        </div>
        <div class="list" [attr.aria-busy]="feed.busy()">
          @if (feed.state() === 'error') {
            <p class="msg" role="alert">
              Couldn't load activity.
              <button type="button" class="mf-btn mf-btn--text" (click)="feed.load()">Retry</button>
            </p>
          } @else if (items().length === 0) {
            <p class="msg">
              {{ feed.state() === 'loading' ? 'Loading activity' : 'No recent activity.' }}
            </p>
          } @else {
            <ul class="items">
              @for (i of items(); track i.itemKey) {
                <li>
                  @if (i.taskId !== null) {
                    <a
                      class="it act"
                      [href]="taskHref(i.taskId)"
                      target="_blank"
                      rel="noopener"
                      [attr.data-feed]="i.itemKey"
                      [attr.aria-label]="label(i) + ', opens the task in a new tab'"
                    >
                      <ng-container *ngTemplateOutlet="row; context: { $implicit: i }" />
                    </a>
                  } @else {
                    <button
                      type="button"
                      class="it act"
                      [attr.data-feed]="i.itemKey"
                      [attr.aria-label]="label(i) + ', opens the asset'"
                      (click)="openAsset(i)"
                    >
                      <ng-container *ngTemplateOutlet="row; context: { $implicit: i }" />
                    </button>
                  }
                </li>
              }
            </ul>
          }
        </div>
        <div class="cf">
          <button type="button" class="mf-btn mf-btn--text" data-view-activity (click)="viewAll()">
            View All
          </button>
        </div>
      </section>
    </ng-template>

    <ng-template #row let-i>
      <span class="ki" [attr.data-tone]="look(i.kind).tone">
        <i class="pi" [class]="look(i.kind).icon" aria-hidden="true"></i>
      </span>
      <span class="body">
        <span class="t"
          >{{ title(i) }}
          @if (i.isUnread) {
            <span class="dot" aria-hidden="true"></span>
          }
        </span>
        <span class="m">{{ what(i) }}</span>
        <span class="m">{{ i.matterName }} · {{ ago(i) }}</span>
      </span>
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
    }
    .ov {
      display: flex;
      gap: var(--mf-s3);
      align-items: flex-start;
      min-height: 0;
    }
    .ov.stack {
      flex-direction: column;
      align-items: stretch;
    }
    .lcol {
      flex: 1 1 0;
      min-width: 0;
    }
    .ov.stack .lcol {
      flex: none;
    }
    @media (min-width: 768px) and (min-height: 561px) {
      .ov {
        align-items: stretch;
        height: 100%;
      }
      .lcol {
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .lcol > mf-mm-task-list {
        flex: 1 1 0;
        min-height: 0;
      }
    }
    .side {
      flex: none;
      min-height: 0;
    }
    /* The look is the shared card (mf-card: D-10); this only lays the card out, and the rows run to its edge so their rules and hover reach it. */
    .card {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }
    .ev {
      flex: 0 1 auto;
      max-height: 46%;
    }
    .ac {
      flex: 1 1 0;
    }
    .ch {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin-bottom: var(--mf-s3);
      flex: none;
    }
    h2.mf-card__title {
      margin: 0;
    }
    h2:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .sub,
    .m {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .unread {
      margin-left: auto;
    }
    .kc {
      margin-bottom: var(--mf-s2);
      flex: none;
    }
    .kc mf-dropdown {
      display: block;
    }
    .list {
      flex: 1 1 auto;
      min-height: 0;
      margin-inline: calc(-1 * var(--mf-s4));
      overflow: auto;
    }
    .items {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .it {
      display: flex;
      gap: var(--mf-s3);
      width: 100%;
      box-sizing: border-box;
      padding: var(--mf-s2) var(--mf-s4);
      border: 0;
      border-top: 1px solid var(--mf-border-soft);
      background: none;
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      text-decoration: none;
      cursor: pointer;
    }
    .it:hover {
      background: var(--mf-surface-alt);
    }
    .when {
      display: flex;
      flex-direction: column;
      flex: none;
      min-width: 64px;
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .when b {
      color: var(--mf-text);
      font-size: var(--mf-fs-sm);
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .t {
      font-weight: 600;
      font-size: var(--mf-fs-sm);
      overflow-wrap: anywhere;
    }
    .dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      margin-left: var(--mf-s1);
      border-radius: 50%;
      background: var(--mf-primary);
    }
    .ki {
      flex: none;
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: var(--mf-radius-lg);
      background: var(--k-bg);
      color: var(--k-fg);
    }
    .ki[data-tone='info'] {
      --k-bg: var(--mf-sem-info-bg);
      --k-fg: var(--mf-sem-info-fg);
    }
    .ki[data-tone='accent'] {
      --k-bg: var(--mf-status-progress-bg);
      --k-fg: var(--mf-status-progress-fg);
    }
    .ki[data-tone='neutral'] {
      --k-bg: var(--mf-surface-alt);
      --k-fg: var(--mf-text-muted);
    }
    .ki[data-tone='danger'] {
      --k-bg: var(--mf-sem-overdue-bg);
      --k-fg: var(--mf-danger);
    }
    .ki[data-tone='warning'] {
      --k-bg: var(--mf-sem-risk-bg);
      --k-fg: var(--mf-sem-risk-fg);
    }
    .cf {
      flex: none;
      margin-inline: calc(-1 * var(--mf-s4));
      padding: var(--mf-s2) var(--mf-s4) 0;
      border-top: 1px solid var(--mf-border-soft);
    }
    /* A text button keeps its 8 px padding inside its 24 px target, so its text lines up with the card's content edge. */
    .cf .mf-btn--text {
      margin-left: calc(-1 * var(--mf-s2));
    }
    .msg {
      margin: var(--mf-s2) var(--mf-s4);
      color: var(--mf-text-muted);
    }
    .stackcol {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s4);
    }
    @media (max-width: 767.98px) {
      .ov {
        flex-direction: column;
        height: auto;
      }
      .ev {
        max-height: none;
      }
      .list {
        overflow: visible;
      }
      .it {
        min-height: 44px;
      }
    }
  `,
})
export class MmOverview {
  protected readonly layout = inject(MmLayout);
  private readonly api = inject(MmApi);
  private readonly router = inject(Router);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  readonly filters = input.required<MmFilters>();
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
  readonly showMatter = input(true);
  readonly resetKey = input<unknown>(undefined);
  readonly paramsChange = output<Record<string, string | null>>();
  /** An asset item was chosen: the page opens the Assets tab with it. */
  readonly assetOpened = output<number>();
  /** The calendar is wanted (null: the current month; a yyyy-MM-dd: the month of that event). */
  readonly viewCalendar = output<string | null>();
  /** "View all": the Activity tab, with the chosen kind or none. */
  readonly viewActivity = output<FeedKind | null>();

  protected readonly days = UPCOMING_DAYS;
  protected readonly kind = signal<'ALL' | FeedKind>('ALL');

  protected readonly upcoming = panelLoader(
    () => this.filters(),
    () => this.api.upcoming(this.filters(), UPCOMING_DAYS, 10),
  );
  protected readonly feed = panelLoader(
    () => [this.filters()],
    () => this.api.feed(this.filters(), { page: 1, pageSize: 50 }),
  );

  protected readonly items = computed<FeedItem[]>(() => {
    const k = this.kind();
    const all = this.feed.data()?.items ?? [];
    return (k === 'ALL' ? all : all.filter((i) => i.kind === k)).slice(0, PREVIEW_ITEMS);
  });
  protected readonly kindItems = computed<DropdownItem[]>(() => {
    const c = this.feed.data()?.countsByKind;
    const total = c ? Object.values(c).reduce((a, b) => a + b, 0) : null;
    return [
      { value: 'ALL', label: 'All', count: total, icon: 'pi-list', tone: 'neutral' as const },
      ...FEED_KINDS.map((k) => ({
        value: k.kind,
        label: k.label,
        count: c ? c[k.kind] : null,
        icon: KIND_LOOK[k.kind].icon,
        tone: KIND_LOOK[k.kind].tone,
      })),
    ];
  });
  protected readonly sections = computed<SideSection[]>(() => [
    {
      key: 'events',
      label: 'Upcoming Events',
      icon: 'pi-calendar',
      count: this.upcoming.data()?.total ?? 0,
    },
    {
      key: 'activity',
      label: 'Recent Activity',
      icon: 'pi-bell',
      count: this.feed.data()?.unreadCount ?? 0,
      alert: true,
    },
  ]);

  protected look(k: FeedKind) {
    return KIND_LOOK[k];
  }
  protected title(i: FeedItem): string {
    return feedTitle(i);
  }
  protected what(i: FeedItem): string {
    return feedWhat(i, this.clock.now(), this.zone);
  }
  protected label(i: FeedItem): string {
    return `${KIND_LOOK[i.kind].label}: ${feedTitle(i)}, ${feedWhat(i, this.clock.now(), this.zone)}`;
  }
  protected ago(i: FeedItem): string {
    return agoShort(i.occurredAtUtc, this.clock.now());
  }
  protected when(e: MatterEvent): string {
    const today = todayText(this.clock, this.zone);
    const next = new Date(`${today}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    if (e.date === today) return 'Today';
    if (e.date === next.toISOString().slice(0, 10)) return 'Tomorrow';
    return numericDate(e.date, this.clock.now(), this.zone);
  }
  protected taskHref(id: number): string {
    return this.router.serializeUrl(this.router.createUrlTree(['/tasks', id]));
  }
  protected openAsset(i: FeedItem): void {
    if (i.assetId !== null) this.assetOpened.emit(i.assetId);
  }
  protected openEvent(e: MatterEvent): void {
    this.viewCalendar.emit(e.date);
  }
  protected viewAll(): void {
    const k = this.kind();
    this.viewActivity.emit(k === 'ALL' ? null : k);
  }
}
