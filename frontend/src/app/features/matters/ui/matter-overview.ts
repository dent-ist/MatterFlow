import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import {
  MatterOverviewClient,
  MatterOverviewDeadline,
  MatterOverviewHealth,
  MatterOverviewHoldReason,
  MatterOverviewPerson,
  MatterOverviewReason,
  MyMattersActivityItem,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { StillLoading } from '../../../shared/ui/still-loading';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';
import { TaskTypeBadge } from '../../../shared/task-type/task-type-badge';
import { MatterDataBlock } from './matter-data-block';
import { activityText, activityTime, awayText, dayHeading, dueDay } from '../../my-matters/facts';
import { queryToParams } from '../../my-matters/my-matters-filters';
import { panelLoader } from '../../my-matters/panel-loader';

/** A reason of the health flag with its count, in words ("4 tasks are overdue"); the thresholds are the ones the API echoes. */
export function reasonWords(r: MatterOverviewReason, h: MatterOverviewHealth): string {
  const n = r.count;
  const tasks = (one: string, many: string) => (n === 1 ? one : many);
  switch (r.code) {
    case 'OVERDUE':
      return tasks(`${n} task is overdue`, `${n} tasks are overdue`);
    case 'UNASSIGNED':
      return tasks(`${n} task has nobody assigned`, `${n} tasks have nobody assigned`);
    case 'DUE_SOON':
      return tasks(
        `${n} task is due within ${h.amberDueDays} days`,
        `${n} tasks are due within ${h.amberDueDays} days`,
      );
    case 'LONG_HOLD':
      return tasks(
        `${n} task has been on hold for more than ${h.stuckOnHoldDays} days`,
        `${n} tasks have been on hold for more than ${h.stuckOnHoldDays} days`,
      );
    case 'NO_OPEN_TASKS':
      return 'no open tasks';
    default:
      return r.code;
  }
}

/**
 * The matter record's Overview, enriched (epic #758, PX-24; README 7): the matter at a glance above the details list, in one request
 * (`GET /matters/{id}/overview`). Health with its reasons in words (colour is never the only signal), Tasks by status, the next five deadlines,
 * who is working on it (open and overdue, an away badge in words), the linked assets and the recent activity. A section the person may not
 * use is absent (the API sends null: the task sections need Task.View, the assets Asset.View). A matter without a manager is normal: nothing
 * here warns about it. Every count is a link to the list it counts.
 */
@Component({
  selector: 'mf-matter-overview',
  imports: [ErrorReference, MatterDataBlock, RouterLink, StillLoading, TaskTypeBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--mf-s4);
    }
    .mo {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s3);
      align-items: start;
    }
    .mo__card {
      min-width: 0;
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }
    .mo__card--wide {
      grid-column: 1 / -1;
    }
    .mo__title {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-lg);
      font-weight: 700;
    }
    .mo__n {
      color: var(--mf-text-muted);
      font-weight: 400;
    }
    .mo__list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .mo__row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      column-gap: var(--mf-s3);
      padding: var(--mf-s1) 0;
      border-top: 1px solid var(--mf-border);
    }
    .mo__row:first-child {
      border-top: 0;
    }
    .mo__link {
      display: inline-flex;
      align-items: center;
      min-width: 0;
      min-height: 24px;
      color: var(--mf-link);
      overflow-wrap: anywhere;
    }
    .mo__meta {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .mo__fact {
      align-self: center;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .mo__over {
      color: var(--mf-due-overdue);
      font-weight: 700;
    }
    .mo__flag {
      margin: 0 0 var(--mf-s2);
      font-weight: 700;
    }
    .mo__flag i {
      margin-right: var(--mf-s1);
    }
    .mo__flag--red {
      color: var(--mf-danger);
    }
    .mo__reasons {
      margin: 0;
      padding-left: var(--mf-s4);
    }
    .mo__statuses {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2) var(--mf-s4);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .mo__statuses a {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      color: var(--mf-link);
    }
    .mo__statuses b {
      margin-right: 0.3em;
      font-variant-numeric: tabular-nums;
    }
    .mo__away {
      display: inline-block;
      margin-left: var(--mf-s2);
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-text-muted);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-sm);
      white-space: nowrap;
    }
    .mo__foot {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s3);
      margin-top: var(--mf-s2);
    }
    .mo__foot a,
    .mo__foot button {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      cursor: pointer;
    }
    .mo__empty {
      margin: 0;
      color: var(--mf-text-muted);
    }
    /* The skeleton holds about the room the sections take, so the details list does not jump when they arrive. */
    .mo__sk {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s3);
      min-height: 26rem;
      align-content: start;
    }
    .mo__sk-card {
      display: grid;
      align-content: start;
      gap: var(--mf-s2);
      min-height: 10rem;
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
    }
    .mo__sk-card--wide {
      grid-column: 1 / -1;
    }
    .mo__bar {
      height: 14px;
      border-radius: 4px;
      background: var(--mf-border);
    }
    .mo__error {
      display: grid;
      gap: var(--mf-s1);
      justify-items: start;
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
    }
    .mo__error p {
      margin: 0;
    }
    /* From 1280 px the sections sit in three columns, so the task types, the holds and the data (PM v2, #882) do not push the deadlines, the people and the
       activity down; the recent activity spans all three. */
    @media (min-width: 1280px) {
      .mo,
      .mo__sk {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
    @media (max-width: 767.98px) {
      .mo,
      .mo__sk {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    @media (max-width: 639.98px) {
      .mo__link,
      .mo__statuses a,
      .mo__foot a,
      .mo__foot button {
        min-height: 44px;
      }
      .mo__row {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
  template: `
    @if (allowed()) {
      @switch (loader.state()) {
        @case ('loading') {
          <p class="mf-sr-only" role="status" data-loading>Loading the matter overview</p>
          <div class="mo__sk" aria-hidden="true" data-overview-skeleton>
            <span class="mo__bar"></span><span class="mo__bar"></span>
            <span class="mo__bar" style="width: 55%"></span>
          </div>
          <mf-still-loading (retry)="loader.load()" />
        }
        @case ('error') {
          <div class="mo__error" role="alert" data-overview-error>
            <p>Couldn't load the matter overview.</p>
            <mf-error-reference />
            <button type="button" class="mf-btn" data-overview-retry (click)="loader.load()">
              Retry
            </button>
          </div>
        }
        @default {
          @if (data(); as d) {
            <div class="mo" data-overview-sections [attr.aria-busy]="loader.busy() ? 'true' : null">
              @if (d.health; as h) {
                <section class="mo__card" aria-labelledby="mo-health" data-section="health">
                  <h3 class="mo__title" id="mo-health">Health</h3>
                  <p class="mo__flag" [class.mo__flag--red]="h.flag === 'RED'" data-flag>
                    <i [class]="flagIcon(h.flag)" aria-hidden="true"></i>{{ flagWord(h.flag) }}
                  </p>
                  <ul class="mo__reasons" data-reasons>
                    @for (r of h.reasons; track r.code) {
                      <li>
                        @if (r.query) {
                          <a class="mo__link" routerLink="/tasks" [queryParams]="params(r.query)">{{
                            words(r, h)
                          }}</a>
                        } @else {
                          {{ words(r, h) }}
                        }
                      </li>
                    }
                  </ul>
                </section>
              }
              @if (d.taskCounts; as c) {
                <section class="mo__card" aria-labelledby="mo-status" data-section="status">
                  <h3 class="mo__title" id="mo-status">Tasks by status</h3>
                  <ul class="mo__statuses" data-statuses>
                    <li>
                      <a routerLink="/tasks" [queryParams]="params(c.newQuery)"
                        ><b>{{ c.new }}</b
                        >{{ ' ' }}New</a
                      >
                    </li>
                    <li>
                      <a routerLink="/tasks" [queryParams]="params(c.inProgressQuery)"
                        ><b>{{ c.inProgress }}</b
                        >{{ ' ' }}In progress</a
                      >
                    </li>
                    <li>
                      <a routerLink="/tasks" [queryParams]="params(c.onHoldQuery)"
                        ><b>{{ c.onHold }}</b
                        >{{ ' ' }}On hold</a
                      >
                    </li>
                    <li>
                      <a routerLink="/tasks" [queryParams]="params(c.completedQuery)"
                        ><b>{{ c.completed }}</b
                        >{{ ' ' }}Completed (30 days)</a
                      >
                    </li>
                  </ul>
                </section>
              }
              @if (d.types; as types) {
                @if (types.length > 0) {
                  <section class="mo__card" aria-labelledby="mo-types" data-section="types">
                    <h3 class="mo__title" id="mo-types">Task types</h3>
                    <ul class="mo__list">
                      @for (t of types; track t.taskTypeId) {
                        <li class="mo__row" data-type-row>
                          <a class="mo__link" routerLink="/tasks" [queryParams]="params(t.query)">
                            <mf-task-type-badge
                              variant="wide"
                              [name]="t.name"
                              [iconKey]="t.iconKey"
                              [colourKey]="t.colourKey"
                            />
                          </a>
                          <span class="mo__fact">
                            {{ t.open }} open
                            @if (t.overdue > 0) {
                              ,
                              <a
                                class="mo__over"
                                routerLink="/tasks"
                                [queryParams]="params(t.overdueQuery)"
                                >{{ t.overdue }} overdue</a
                              >
                            }
                          </span>
                        </li>
                      }
                    </ul>
                  </section>
                }
              }
              @if (d.deadlines; as dl) {
                <section class="mo__card" aria-labelledby="mo-deadlines" data-section="deadlines">
                  <h3 class="mo__title" id="mo-deadlines">Next deadlines</h3>
                  @if (dl.items.length === 0) {
                    <p class="mo__empty" data-empty>No upcoming deadlines.</p>
                  } @else {
                    <ul class="mo__list">
                      @for (t of dl.items; track t.taskId) {
                        <li class="mo__row" data-deadline>
                          <a
                            class="mo__link"
                            [routerLink]="['/tasks', t.taskId]"
                            [queryParams]="origin.params('matter')"
                            [state]="origin.state()"
                            >{{ t.taskNumber }} {{ t.title }}</a
                          >
                          <span class="mo__fact">{{ due(t) }}</span>
                          <span class="mo__meta">{{ t.assigneeName ?? 'Unassigned' }}</span>
                        </li>
                      }
                    </ul>
                    @if (dl.total > dl.items.length) {
                      <div class="mo__foot">
                        <a routerLink="/tasks" [queryParams]="params(dl.query)"
                          >All {{ dl.total }} deadlines</a
                        >
                      </div>
                    }
                  }
                </section>
              }
              @if (d.people; as p) {
                <section class="mo__card" aria-labelledby="mo-people" data-section="people">
                  <h3 class="mo__title" id="mo-people">Who is working on it</h3>
                  @if (p.items.length === 0 && p.unassignedOpen === 0) {
                    <p class="mo__empty" data-empty>Nobody has open tasks on this matter.</p>
                  } @else {
                    <ul class="mo__list">
                      @for (x of p.items; track x.userId) {
                        <li class="mo__row" data-person>
                          <span>
                            <a
                              class="mo__link"
                              routerLink="/tasks"
                              [queryParams]="params(x.query)"
                              >{{ x.displayName }}</a
                            >
                            @if (x.away; as away) {
                              <span class="mo__away" data-away>{{ awayWords(away) }}</span>
                            }
                          </span>
                          <span class="mo__fact">{{ load(x) }}</span>
                        </li>
                      }
                    </ul>
                    @if (p.unassignedOpen > 0) {
                      <p class="mo__meta" data-unassigned>
                        {{ p.unassignedOpen }} open
                        {{ p.unassignedOpen === 1 ? 'task has' : 'tasks have' }} nobody assigned.
                      </p>
                    }
                    @if (p.total > p.items.length) {
                      <p class="mo__meta" data-capped>
                        Showing {{ p.items.length }} of {{ p.total }} people.
                      </p>
                    }
                  }
                </section>
              }
              @if (hasAssets()) {
                <mf-matter-data-block [matterId]="matterId()" [reload]="reload()" />
              }
              @if (d.holdReasons; as holds) {
                @if (holds.length > 0) {
                  <section class="mo__card" aria-labelledby="mo-holds" data-section="holds">
                    <h3 class="mo__title" id="mo-holds">On hold by reason</h3>
                    <ul class="mo__list">
                      @for (h of holds; track h.onHoldReasonId) {
                        <li class="mo__row" data-hold-reason>
                          <a class="mo__link" routerLink="/tasks" [queryParams]="params(h.query)">{{
                            h.name
                          }}</a>
                          <span class="mo__fact">{{ holdWords(h) }}</span>
                        </li>
                      }
                    </ul>
                  </section>
                }
              }
              @if (d.assets; as a) {
                <section class="mo__card" aria-labelledby="mo-assets" data-section="assets">
                  <h3 class="mo__title" id="mo-assets">
                    Linked assets <span class="mo__n">({{ a.total }})</span>
                  </h3>
                  @if (a.items.length === 0) {
                    <p class="mo__empty" data-empty>No assets are linked to this matter.</p>
                  } @else {
                    <ul class="mo__list">
                      @for (x of a.items; track x.assetId) {
                        <li class="mo__row" data-asset>
                          <a class="mo__link" [routerLink]="['/assets', x.assetId]">{{
                            x.displayName
                          }}</a>
                          <span class="mo__meta">{{ x.assetTypeName }}</span>
                        </li>
                      }
                    </ul>
                    <div class="mo__foot">
                      <button type="button" data-open-assets (click)="openAssets.emit()">
                        Open the Assets tab
                      </button>
                    </div>
                  }
                </section>
              }
              @if (d.activity; as events) {
                <section
                  class="mo__card mo__card--wide"
                  aria-labelledby="mo-activity"
                  data-section="activity"
                >
                  <h3 class="mo__title" id="mo-activity">Recent activity</h3>
                  @if (events.length === 0) {
                    <p class="mo__empty" data-empty>No recent activity.</p>
                  } @else {
                    <ul class="mo__list">
                      @for (e of events; track e.eventId) {
                        <li class="mo__row" data-event>
                          <a
                            class="mo__link"
                            [routerLink]="
                              e.taskId ? ['/tasks', e.taskId] : ['/matters', e.matterId]
                            "
                            [queryParams]="e.taskId ? origin.params('matter') : undefined"
                            [state]="origin.state()"
                            >{{ text(e) }}</a
                          >
                          <time class="mo__fact mo__meta" [attr.datetime]="e.occurredAtUtc">{{
                            when(e)
                          }}</time>
                        </li>
                      }
                    </ul>
                    @if (canOpenActivity()) {
                      <div class="mo__foot">
                        <button type="button" data-open-activity (click)="openActivity.emit()">
                          Open the activity
                        </button>
                      </div>
                    }
                  }
                </section>
              }
            </div>
          }
        }
      }
    }
  `,
})
export class MatterOverviewSections {
  readonly matterId = input.required<number>();
  /** Changes whenever the numbers should be asked for again. */
  readonly reload = input(0);
  /** The person may open the activity drawer (Audit.View): its link is offered. */
  readonly canOpenActivity = input(false);
  readonly openAssets = output<void>();
  readonly openActivity = output<void>();

  protected readonly origin = inject(TaskOriginLinks);
  private readonly api = inject(MatterOverviewClient);
  private readonly auth = inject(AuthStore);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  /** Without Task.View and Asset.View there is nothing to show and nothing is asked for. */
  protected readonly allowed = computed(
    () => this.auth.has('Task.View') || this.auth.has('Asset.View'),
  );

  protected readonly loader = panelLoader(
    () => [this.matterId(), this.reload()],
    () => this.api.getMatterOverview(this.matterId()),
    { enabled: () => this.allowed() },
  );

  protected readonly data = computed(() => this.loader.data());
  /** The Data block needs Asset.View (the overview's own assets section is null without it). */
  protected readonly hasAssets = computed(() => this.data()?.assets != null);
  protected readonly words = reasonWords;
  protected readonly text = activityText;

  protected params(query: string): Params {
    return queryToParams(query);
  }

  protected flagWord(flag: string): string {
    return flag === 'RED' ? 'Red' : flag === 'AMBER' ? 'Amber' : 'Green';
  }

  protected flagIcon(flag: string): string {
    return flag === 'RED'
      ? 'pi pi-exclamation-circle'
      : flag === 'AMBER'
        ? 'pi pi-exclamation-triangle'
        : 'pi pi-check-circle';
  }

  protected due(t: MatterOverviewDeadline): string {
    const day = dueDay(t, this.zone);
    return day ? dayHeading(day) : 'No date';
  }

  /** "3 tasks, longest 6 days" (the longest on hold, in whole days). */
  protected holdWords(h: MatterOverviewHoldReason): string {
    const tasks = h.count === 1 ? '1 task' : `${h.count} tasks`;
    return h.oldestDays > 0
      ? `${tasks}, longest ${h.oldestDays === 1 ? '1 day' : `${h.oldestDays} days`}`
      : tasks;
  }

  protected load(p: MatterOverviewPerson): string {
    return p.overdue > 0 ? `${p.open} open, ${p.overdue} overdue` : `${p.open} open`;
  }

  protected awayWords(away: NonNullable<MatterOverviewPerson['away']>): string {
    return awayText(away, new Date(this.clock.now()).getFullYear());
  }

  protected when(e: MyMattersActivityItem): string {
    return activityTime(e.occurredAtUtc, this.clock.now(), this.zone);
  }
}
