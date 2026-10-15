import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import {
  DashboardBreakdownItem,
  DashboardClient,
  DashboardSummary,
  TaskQueueClient,
  TaskQueueRow,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { QuietRequests } from '../../../core/http/interceptors';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { UndoService } from '../../../core/notify/undo.service';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { mfDate } from '../../../core/time/time';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { PageHeader } from '../../../shared/ui/page-header';
import { priorityColors } from '../../../shared/ui/priority-badge';
import { LIST_ORDER, ListKind, clearedUsersParams, queueArgsFor } from '../dashboard-links';
import { PERIOD_PRESETS, PeriodKey, isPeriodKey, periodDays, presetOf } from '../dashboard-period';
import {
  DASHBOARD_TABS,
  DASHBOARD_TAB_LABELS,
  DASHBOARD_TAB_PERMISSIONS,
  DashboardPrefs,
  DashboardTab,
  SUMMARY_DATA_TABS,
  isDashboardTab,
} from '../dashboard-prefs';
import { BarItem, BarList } from '../ui/bar-list';
import { DashSection } from '../ui/dash-section';
import { clearedViewParams } from '../swimlane/swimlane-model';
import { DashSwimlaneTab } from '../ui/dash-swimlane-tab';
import { DashTab, DashTabs, panelId, tabId } from '../ui/dash-tabs';
import { DashUsersTab } from '../ui/dash-users-tab';
import { Segment, StackedBar } from '../ui/stacked-bar';
import { StatTile } from '../ui/stat-tile';
import { DashTaskList, PanelState } from '../ui/task-list-panel';
import { DashTrendsTab } from '../ui/dash-trends-tab';
import { clearedTrendParams } from '../ui/trend-model';

type LoadState = 'loading' | 'ready' | 'error';

/** One list panel of the "Tasks to act on" section: what it is called and the Task Queue query behind it. */
interface PanelSpec {
  kind: ListKind;
  heading: string;
  emptyText: string;
  viewAllText: string;
  query: string;
}

interface ListData {
  state: PanelState;
  rows: TaskQueueRow[];
  total: number;
}

/** How often the page refreshes itself while the tab is visible. */
export const AUTO_REFRESH_MS = 5 * 60_000;
/** Pause after an inline edit before the counts are read again (several quick edits make one read). */
const COUNT_REFRESH_DELAY_MS = 700;

const LIST_SIZE: Record<ListKind, number> = { unassigned: 8, overdue: 6, dueSoon: 6 };
const EMPTY_LIST: ListData = { state: 'loading', rows: [], total: 0 };

/** Glossary: sentence case ("No pod", "Other pods"); the API still sends some Title Case labels. */
function sentence(label: string): string {
  if (label === 'No Pod') return 'No pod';
  if (label === 'Other Pods') return 'Other pods';
  if (label === 'Other Task Types') return 'Other task types';
  return label;
}

function toBars(items: readonly DashboardBreakdownItem[]): BarItem[] {
  return items.map((i) => ({
    label: sentence(i.label),
    count: i.count,
    query: i.query ?? null,
    tone: i.code ?? null,
    muted: i.isOther,
    iconKey: i.iconKey ?? null,
  }));
}

/**
 * Dashboard (UX S01, baseline 12.2), organised in three tabs (WAI-ARIA tabs; the selection lives in the address as `?tab=`, each change is
 * a history entry and a plain /dashboard link opens Summary): Summary (Needs attention, Overview, the unassigned queue with inline assignment, Overdue and Due soon),
 * Breakdowns (open tasks by priority, task type and status, and their age) and Trends (created and completed per day). All three read
 * one shared summary request; only the Summary tab also reads the task lists, and only when it is shown. Everything that counts tasks is
 * a link to `/tasks` carrying the query the API computed for that number. The Dashboard needs `Dashboard.View` and each tab its own
 * `Dashboard.View<Tab>` permission: only permitted tabs are shown (the first one is the default; a link to a forbidden tab falls back to it), and with
 * none the page says so and points to My Work. The page refreshes itself every five minutes while visible
 * without moving the page. Operational counts only: no billing, hours or per-person scores.
 */
@Component({
  selector: 'mf-dashboard-page',
  imports: [
    PageHeader,
    ErrorReference,
    BarList,
    StackedBar,
    DashTrendsTab,
    DashSection,
    DashTaskList,
    HasPermissionDirective,
    DashTabs,
    RouterLink,
    NgTemplateOutlet,
    StatTile,
    DashSwimlaneTab,
    DashUsersTab,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-page-header heading="Dashboard">
      @if (hasData() && showHeaderControls()) {
        <div mfActions class="controls">
          <button
            type="button"
            class="mf-btn refresh"
            data-refresh
            [attr.aria-disabled]="refreshing() ? 'true' : null"
            [attr.aria-busy]="refreshing() ? 'true' : null"
            (click)="refresh()"
          >
            <i
              class="pi"
              [class]="refreshing() ? 'pi-spin pi-spinner' : 'pi-refresh'"
              aria-hidden="true"
            ></i>
            Refresh
          </button>
          @if (updated(); as u) {
            <span class="updated" data-updated>
              Updated {{ u }}<span class="auto"> · refreshes every 5 minutes</span>
            </span>
          }
        </div>
      }
    </mf-page-header>

    <p class="sr-only" role="status" aria-live="polite" data-dash-live>{{ live() }}</p>

    @if (refreshFailed()) {
      <div class="stale" role="status" data-stale>
        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
        <span>
          The dashboard could not be refreshed. Showing the figures from {{ updated() }}.
          <mf-error-reference />
        </span>
        <button type="button" class="mf-btn" data-stale-retry (click)="retryRefresh()">
          Retry
        </button>
      </div>
    }

    <ng-template #periodControl>
      <label class="period">
        <span>Completed and created in</span>
        <select
          class="mf-control"
          data-period
          [value]="period()"
          (change)="setPeriod($any($event.target).value)"
        >
          @for (p of periods; track p.key) {
            <option [value]="p.key" [selected]="p.key === period()">{{ p.label }}</option>
          }
        </select>
      </label>
    </ng-template>

    <ng-template #listsGrid let-items let-narrow="narrow">
      <div class="grid grid--lists" [class.grid--narrow]="narrow" data-lists>
        @for (panel of items; track panel.kind) {
          <mf-dash-task-list
            [kind]="panel.kind"
            [heading]="panel.heading"
            [emptyText]="panel.emptyText"
            [viewAllText]="panel.viewAllText"
            [rows]="listOf(panel.kind).rows"
            [total]="listOf(panel.kind).total"
            [state]="listOf(panel.kind).state"
            [query]="panel.query"
            [skippable]="panel.kind !== lastKind()"
            (rowChange)="onRowChange(panel.kind, $event)"
            (retry)="reloadList(panel.kind)"
          />
        }
      </div>
    </ng-template>

    @if (visibleTabs().length === 0) {
      <!-- Dashboard.View without any tab permission: nothing to show but a pointer. -->
      <p class="note" data-no-tabs-note>
        <i class="pi pi-info-circle" aria-hidden="true"></i>
        <span>
          No Dashboard tab is turned on for your role. Ask an administrator to add one (Summary,
          Breakdowns, Trends, Swimlane or Users) to your role.
          @if (canSeeMyWork()) {
            Your assigned tasks are in <a routerLink="/my-work" data-my-work-link>My Work</a>.
          }
        </span>
      </p>
    } @else {
      @switch (state()) {
        @case ('loading') {
          <ng-container *ngTemplateOutlet="tabList" />
          <div class="skeletons" role="status" aria-busy="true" aria-label="Loading the dashboard">
            @for (n of skeletonTiles; track n) {
              <div class="skeleton"></div>
            }
          </div>
        }
        @case ('error') {
          <div class="alert" role="alert" data-error>
            <span>The dashboard could not be loaded.</span>
            <mf-error-reference />
            <button type="button" class="mf-btn" (click)="load()">Retry</button>
          </div>
        }
        @default {
          @if (data(); as d) {
            @if (isEmpty()) {
              <div class="empty" data-empty>
                <i class="pi pi-inbox empty-icon" aria-hidden="true"></i>
                <p>No open tasks, and none were created or completed in this period.</p>
                <div class="empty-period"><ng-container *ngTemplateOutlet="periodControl" /></div>
                <a *mfHasPermission="'Task.Create'" class="cta" routerLink="/tasks/new">
                  Create the first task
                </a>
              </div>
            } @else {
              <ng-container *ngTemplateOutlet="tabList" />
              @switch (activeTab()) {
                @case ('summary') {
                  <div
                    class="panel"
                    role="tabpanel"
                    data-tabpanel="summary"
                    [id]="panelId('summary')"
                    [attr.aria-labelledby]="tabId('summary')"
                  >
                    <div class="summary">
                      <div class="summary-tiles">
                        <div
                          role="group"
                          aria-labelledby="attn-h"
                          class="group"
                          data-group="attention"
                        >
                          <h2 id="attn-h">Needs attention</h2>
                          <div class="tiles">
                            <mf-stat-tile
                              label="Overdue"
                              icon="pi-exclamation-circle"
                              tone="danger"
                              emphasis="attention"
                              linkText="View overdue tasks"
                              [value]="d.overdue.count"
                              [query]="d.overdue.query"
                              caption="Excludes ASAP tasks"
                            />
                            <mf-stat-tile
                              label="Unassigned"
                              icon="pi-user-minus"
                              tone="strong"
                              emphasis="attention"
                              linkText="View unassigned tasks"
                              [value]="d.unassigned.count"
                              [query]="d.unassigned.query"
                              caption="No person assigned"
                            />
                            <mf-stat-tile
                              label="On hold"
                              icon="pi-pause-circle"
                              tone="warning"
                              emphasis="attention"
                              linkText="View tasks on hold"
                              [value]="d.onHold.count"
                              [query]="d.onHold.query"
                              caption="Waiting on something"
                            />
                            <mf-stat-tile
                              label="ASAP open"
                              icon="pi-bolt"
                              tone="asap"
                              emphasis="quiet"
                              linkText="View ASAP tasks"
                              [value]="d.asapOpen.count"
                              [query]="d.asapOpen.query"
                              caption="No due date, handle promptly"
                            />
                          </div>
                        </div>
                        <div
                          role="group"
                          aria-labelledby="ov-h"
                          class="group"
                          data-group="overview"
                        >
                          <div class="group-head">
                            <h2 id="ov-h">Overview</h2>
                            <ng-container *ngTemplateOutlet="periodControl" />
                          </div>
                          <div class="tiles">
                            <mf-stat-tile
                              label="Open"
                              icon="pi-folder-open"
                              emphasis="quiet"
                              linkText="View open tasks"
                              [value]="d.open.count"
                              [query]="d.open.query"
                              caption="New, in progress and on hold"
                            />
                            <mf-stat-tile
                              label="Due soon"
                              icon="pi-clock"
                              emphasis="quiet"
                              linkText="View tasks due soon"
                              [value]="d.dueSoon.count"
                              [query]="d.dueSoon.query"
                              caption="Next 2 days, excludes ASAP"
                            />
                            <mf-stat-tile
                              label="Completed"
                              icon="pi-check-circle"
                              emphasis="quiet"
                              linkText="View completed tasks"
                              [value]="d.completed.count"
                              [query]="d.completed.query"
                              [caption]="periodCaption()"
                            />
                            <mf-stat-tile
                              label="Created"
                              icon="pi-plus-circle"
                              emphasis="quiet"
                              linkText="View created tasks"
                              [value]="d.created.count"
                              [query]="d.created.query"
                              [caption]="periodCaption()"
                            />
                          </div>
                        </div>
                      </div>
                      @if (panels().length > 0) {
                        <mf-dash-section
                          class="summary-main"
                          heading="Tasks to act on"
                          name="lists"
                        >
                          <ng-container
                            *ngTemplateOutlet="
                              listsGrid;
                              context: { $implicit: mainPanels(), narrow: false }
                            "
                          />
                        </mf-dash-section>
                      }
                      @if (morePanels().length > 0) {
                        <mf-dash-section class="summary-more" heading="Deadlines" name="lists-more">
                          <ng-container
                            *ngTemplateOutlet="
                              listsGrid;
                              context: {
                                $implicit: morePanels(),
                                narrow: morePanels().length === 1,
                              }
                            "
                          />
                        </mf-dash-section>
                      }
                    </div>
                  </div>
                }
                @case ('breakdowns') {
                  <div
                    class="panel"
                    role="tabpanel"
                    data-tabpanel="breakdowns"
                    [id]="panelId('breakdowns')"
                    [attr.aria-labelledby]="tabId('breakdowns')"
                  >
                    <mf-dash-section heading="Open tasks by" name="breakdowns">
                      <div class="grid" data-grid="breakdowns">
                        <mf-bar-list
                          heading="Open by priority"
                          rowHeading="Priority"
                          [items]="priorities()"
                          emptyText="No open tasks."
                        />
                        <mf-bar-list
                          heading="Open by task type"
                          rowHeading="Task type"
                          [items]="types()"
                          emptyText="No open tasks."
                        />
                        <mf-bar-list
                          heading="Open by status"
                          rowHeading="Status"
                          [items]="statuses()"
                          emptyText="No open tasks."
                        />
                        <mf-stacked-bar
                          heading="Age of open tasks"
                          rowHeading="Age"
                          [segments]="aging()"
                          emptyText="No open tasks."
                          note="Days since the task was created. Informational, not a service-level target."
                        />
                      </div>
                    </mf-dash-section>
                  </div>
                }
                @case ('trends') {
                  <div
                    class="panel"
                    role="tabpanel"
                    data-tabpanel="trends"
                    [id]="panelId('trends')"
                    [attr.aria-labelledby]="tabId('trends')"
                  >
                    <mf-dash-section heading="Created and completed" name="trend">
                      <span mfSectionActions class="head-period" data-trend-period>
                        <ng-container *ngTemplateOutlet="periodControl" />
                      </span>
                      @defer (on immediate) {
                        <mf-dash-trends-tab
                          [period]="period()"
                          [caption]="periodCaption()"
                          [refreshKey]="d.generatedAtUtc"
                        />
                      } @placeholder {
                        <p class="soon-load" role="status">Loading the trend.</p>
                      }
                    </mf-dash-section>
                  </div>
                }
                @default {
                  <ng-container *ngTemplateOutlet="boardPanel" />
                }
              }
            }
          } @else {
            <!-- Only the Swimlane and Users tabs: they read their own endpoints, there is no summary to wait for. -->
            <ng-container *ngTemplateOutlet="tabList" />
            <ng-container *ngTemplateOutlet="boardPanel" />
          }
        }
      }
    }

    <ng-template #boardPanel>
      @switch (activeTab()) {
        @case ('swimlane') {
          <div
            class="panel"
            role="tabpanel"
            data-tabpanel="swimlane"
            [id]="panelId('swimlane')"
            [attr.aria-labelledby]="tabId('swimlane')"
          >
            @defer (on immediate) {
              <mf-dash-swimlane-tab />
            } @placeholder {
              <p class="soon-load" role="status">Loading the swimlane board.</p>
            }
          </div>
        }
        @case ('users') {
          <div
            class="panel"
            role="tabpanel"
            data-tabpanel="users"
            [id]="panelId('users')"
            [attr.aria-labelledby]="tabId('users')"
          >
            @defer (on immediate) {
              <mf-dash-users-tab />
            } @placeholder {
              <p class="soon-load" role="status">Loading team workload.</p>
            }
          </div>
        }
      }
    </ng-template>

    <ng-template #tabList>
      <mf-dash-tabs
        [tabs]="visibleTabs()"
        [selected]="activeTab() ?? ''"
        (tabChange)="selectTab($event)"
      >
        @if (activeTab() === 'users') {
          <button
            type="button"
            class="mf-btn mf-btn--icon"
            data-refresh-users
            aria-label="Refresh team workload"
            title="Refresh team workload"
            [attr.aria-disabled]="users()?.refreshing() ? 'true' : null"
            [attr.aria-busy]="users()?.refreshing() ? 'true' : null"
            (click)="users()?.refresh()"
          >
            <i
              class="pi"
              [class]="users()?.refreshing() ? 'pi-spin pi-spinner' : 'pi-refresh'"
              aria-hidden="true"
            ></i>
          </button>
        }
        @if (activeTab() === 'swimlane') {
          <button
            type="button"
            class="mf-btn mf-btn--icon"
            data-refresh-board
            aria-label="Refresh board"
            title="Refresh board"
            [attr.aria-disabled]="swimlane()?.refreshing() ? 'true' : null"
            [attr.aria-busy]="swimlane()?.refreshing() ? 'true' : null"
            (click)="swimlane()?.refresh()"
          >
            <i
              class="pi"
              [class]="swimlane()?.refreshing() ? 'pi-spin pi-spinner' : 'pi-refresh'"
              aria-hidden="true"
            ></i>
          </button>
        }
      </mf-dash-tabs>
    </ng-template>
  `,
  styles: `
    /* A readable measure on wide monitors: the page is left-aligned and stops at 1360px instead of stretching every card. */
    :host {
      display: block;
      max-width: 1360px;
    }
    .group h2 {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-md);
      text-transform: none;
      color: var(--mf-text-muted);
    }
    .group {
      margin-bottom: var(--mf-s5);
    }
    /* Summary: tiles on the left and the unassigned queue beside them from 1180px; the other lists in a row below. */
    .summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      column-gap: var(--mf-s5);
      align-items: start;
    }
    .summary-more {
      grid-column: 1 / -1;
    }
    @media (min-width: 1180px) {
      .summary {
        grid-template-columns: minmax(0, 452px) minmax(0, 1fr);
      }
    }
    .note {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s4);
      padding: var(--mf-s3) var(--mf-s4);
      color: var(--mf-text-muted);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    .note .pi {
      margin-top: 2px;
    }
    .note a {
      color: var(--mf-link);
    }
    .empty-period {
      margin: var(--mf-s3) 0 var(--mf-s4);
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s3);
    }
    .group-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--mf-s2) var(--mf-s4);
      margin-bottom: var(--mf-s2);
    }
    .group-head h2 {
      margin: 0;
    }
    .head-period {
      margin-left: auto;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    .period {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .updated {
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .stale {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s4);
      padding: var(--mf-s2) var(--mf-s3);
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
      border: 1px solid var(--mf-warning);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-sm);
    }
    .stale span {
      flex: 1;
    }
    /* Compact fixed-width tiles, left-aligned: they never stretch to fill the row. */
    .tiles,
    .skeletons {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(170px, 220px));
      justify-content: start;
      gap: var(--mf-s3);
    }
    @media (max-width: 480px) {
      .tiles,
      .skeletons {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--mf-s2);
      }
    }
    @media (max-width: 340px) {
      .tiles,
      .skeletons {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s4);
      align-items: start;
    }
    /* Task lists: as many columns as fit, never wider than a comfortable list; a single list does not stretch across the page. */
    .grid--lists {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 21rem), 1fr));
      align-items: start;
    }
    .grid--narrow {
      max-width: 36rem;
    }
    @media (max-width: 900px) {
      .grid:not(.grid--lists) {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .skeleton {
      height: 6.25rem;
      background: var(--mf-surface-alt);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.55;
      }
    }
    .alert {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      padding: var(--mf-s3) var(--mf-s4);
      color: var(--mf-danger);
      background: var(--mf-danger-bg);
      border: 1px solid var(--mf-danger);
      border-radius: var(--mf-radius);
    }
    .empty-icon {
      display: block;
      margin-bottom: var(--mf-s2);
      font-size: 2rem;
      color: var(--mf-text-muted);
    }
    .empty {
      max-width: 40rem;
      padding: var(--mf-s6) var(--mf-s4);
      text-align: center;
      color: var(--mf-text-muted);
      background: var(--mf-surface);
      border: 1px dashed var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
    }
    .cta {
      display: inline-block;
      padding: var(--mf-s2) var(--mf-s4);
      color: #fff;
      background: var(--mf-primary);
      border-radius: var(--mf-radius);
      text-decoration: none;
    }
    .cta:hover {
      background: var(--mf-primary-hover);
    }
    @media (max-width: 560px) {
      .auto {
        display: none;
      }
    }
  `,
})
export class DashboardPage implements OnInit {
  private readonly api = inject(DashboardClient);
  private readonly queue = inject(TaskQueueClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly clock = inject(Clock);
  private readonly auth = inject(AuthStore);
  private readonly lookups = inject(LookupStore);
  private readonly prefs = inject(DashboardPrefs);
  private readonly undo = inject(UndoService);
  private readonly quiet = inject(QuietRequests);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly panelRefs = viewChildren(DashTaskList);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private focusRefreshWhenDone = false;
  private undoSeen = 0;
  private requestId = 0;
  private readonly listIds: Record<ListKind, number> = { unassigned: 0, overdue: 0, dueSoon: 0 };
  private countTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLoadedAt = 0;
  /** Counts the summary reads that were meant to refresh the lists; `listsSeq` is the one the lists on screen belong to. */
  private summarySeq = 0;
  private listsSeq = -1;

  protected readonly periods = PERIOD_PRESETS;
  protected readonly skeletonTiles = [1, 2, 3, 4, 5, 6, 7, 8];
  protected readonly panelId = panelId;
  protected readonly tabId = tabId;
  protected readonly period = this.prefs.period;
  protected readonly state = signal<LoadState>('loading');
  protected readonly data = signal<DashboardSummary | null>(null);
  protected readonly refreshing = signal(false);
  /** The Swimlane tab, when it is on screen: its refresh icon sits in the tab row. */
  protected readonly swimlane = viewChild(DashSwimlaneTab);
  /** The Users tab, when it is on screen: its refresh icon sits in the tab row too. */
  protected readonly users = viewChild(DashUsersTab);
  protected readonly refreshFailed = signal(false);
  /** Polite live region: what the last refresh or inline assignment did, for screen readers. */
  protected readonly live = signal('');

  private readonly lists = {
    unassigned: signal<ListData>(EMPTY_LIST),
    overdue: signal<ListData>(EMPTY_LIST),
    dueSoon: signal<ListData>(EMPTY_LIST),
  };

  /**
   * The tabs this person may open: Dashboard.View plus the tab's own permission (a tab permission alone has no effect), in display order.
   * The server enforces the same rules and redacts the payload; this only decides what is shown.
   */
  protected readonly visibleTabs = computed<DashTab[]>(() =>
    this.auth.has('Dashboard.View')
      ? DASHBOARD_TABS.filter((t) => this.auth.has(DASHBOARD_TAB_PERMISSIONS[t])).map((t) => ({
          key: t,
          label: DASHBOARD_TAB_LABELS[t],
        }))
      : [],
  );
  private readonly allowedTabs = computed(() =>
    this.visibleTabs().map((t) => t.key as DashboardTab),
  );
  /** Whether any shown tab reads the shared summary request. */
  private readonly needsSummary = computed(() =>
    this.allowedTabs().some((t) => SUMMARY_DATA_TABS.includes(t)),
  );
  protected readonly canSummary = computed(() => this.allowedTabs().includes('summary'));
  protected readonly canSeeMyWork = computed(() => this.auth.has('Task.View'));
  protected readonly canAssign = computed(() => this.auth.has('Task.Assign'));

  /** The `?tab=` of the address; the tab shown is this one, else Summary (a plain /dashboard link always opens the page that answers "what needs attention"). */
  private readonly tabParam = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('tab'))), {
    initialValue: this.route.snapshot.queryParamMap.get('tab'),
  });
  /** The tab shown: the one in the address when it is permitted, else the first permitted tab (a deep link to a forbidden tab falls back); null without any tab. */
  protected readonly activeTab = computed<DashboardTab | null>(() => {
    const fromUrl = this.tabParam();
    const allowed = this.allowedTabs();
    return isDashboardTab(fromUrl) && allowed.includes(fromUrl) ? fromUrl : (allowed[0] ?? null);
  });

  /**
   * The lists of "Tasks to act on". Part of the Summary tab (Dashboard.ViewSummary): the Unassigned queue (with Task.Assign), Overdue and Due soon.
   * Their own work is in My Work.
   */
  protected readonly panels = computed<PanelSpec[]>(() => {
    const unassigned = (query: string): PanelSpec => ({
      kind: 'unassigned',
      heading: 'Unassigned queue',
      emptyText: 'No unassigned tasks.',
      viewAllText: 'View all unassigned tasks',
      query,
    });
    if (!this.canSummary()) return [];
    const d = this.data();
    if (!d) return [];
    return [
      ...(this.canAssign() ? [unassigned(d.unassigned.query)] : []),
      {
        kind: 'overdue',
        heading: 'Overdue',
        emptyText: 'Nothing is overdue.',
        viewAllText: 'View all overdue tasks',
        query: d.overdue.query,
      },
      {
        kind: 'dueSoon',
        heading: 'Due soon',
        emptyText: 'Nothing is due in the next 2 days.',
        viewAllText: 'View all tasks due soon',
        query: d.dueSoon.query,
      },
    ];
  });
  /** Summary layout: the first list sits beside the tiles, the others (Overdue, Due soon) form a row below. */
  protected readonly mainPanels = computed(() => this.panels().slice(0, 1));
  protected readonly morePanels = computed(() => this.panels().slice(1));
  protected readonly lastKind = computed(() => this.panels().at(-1)?.kind ?? null);
  /** Whether there is anything to refresh. */
  protected readonly hasData = computed(() => this.data() !== null);

  /** The header's Refresh and "Updated" belong to the summary tabs; the Swimlane tab has its own, and Users none yet. */
  protected readonly showHeaderControls = computed(
    () => this.activeTab() !== 'swimlane' && this.activeTab() !== 'users',
  );
  protected readonly periodCaption = computed(() => presetOf(this.period()).caption);
  protected readonly updated = computed(() => {
    const d = this.data();
    return d ? mfDate(d.generatedAtUtc, this.zone, 'datetime') : null;
  });
  /**
   * Nothing open and nothing created or completed in the period. Only meaningful with the Summary tab (the counts are redacted to zero for
   * everyone else, which must not read as "no tasks"), and only when no board tab needs the tab list.
   */
  protected readonly isEmpty = computed(() => {
    const d = this.data();
    return (
      this.canSummary() &&
      !this.allowedTabs().some((t) => !SUMMARY_DATA_TABS.includes(t)) &&
      !!d &&
      d.open.count === 0 &&
      d.created.count === 0 &&
      d.completed.count === 0
    );
  });
  protected readonly types = computed(() => toBars(this.data()?.byTaskType ?? []));
  protected readonly statuses = computed(() => toBars(this.data()?.byStatus ?? []));
  /** In priority order (most urgent first, as the API sends them), coloured like the priority badges. */
  protected readonly priorities = computed<BarItem[]>(() => {
    const store = this.lookups.priorities();
    return (this.data()?.byPriority ?? []).map((i) => {
      const found = store.find((p) => p.id === i.id);
      const colors = priorityColors(found?.color);
      return {
        label: i.label,
        count: i.count,
        query: i.query ?? null,
        fill: colors.bg,
        outline: colors.fg,
      };
    });
  });
  protected readonly aging = computed<Segment[]>(() =>
    (this.data()?.aging ?? []).map((b) => ({ label: b.label, count: b.count, query: b.query })),
  );

  constructor() {
    void this.lookups.ensureLoaded();
    // An Undo of an assignment puts the task back in a list that had already dropped it: read the lists and counts again.
    this.undoSeen = this.undo.settled();
    effect(() => {
      const n = this.undo.settled();
      untracked(() => {
        if (n === this.undoSeen) return;
        this.undoSeen = n;
        if (this.state() === 'ready') this.load({ silent: true, fresh: true });
      });
    });
    // Keep the address in step with the tab shown: add a missing or unknown ?tab=, so a reload or a shared link lands here.
    effect(() => {
      const tab = this.activeTab();
      const param = this.tabParam();
      untracked(() => {
        if (tab && param !== tab) void this.navigateToTab(tab, true);
      });
    });
    // The lists belong to the Summary tab and are read when it is shown (not on the other tabs): arriving on it with older lists reads them.
    effect(() => {
      const tab = this.activeTab();
      const ready = this.state() === 'ready';
      untracked(() => {
        if (this.canSummary() && tab === 'summary' && ready && this.listsSeq !== this.summarySeq) {
          this.listsSeq = this.summarySeq;
          this.loadLists(true);
        }
      });
    });
    this.destroyRef.onDestroy(() => {
      if (this.countTimer) clearTimeout(this.countTimer);
    });
  }

  ngOnInit(): void {
    this.prefs.ensureLoaded();
    this.load();
    this.startAutoRefresh();
  }

  // ---- tabs

  protected selectTab(key: string): void {
    if (!isDashboardTab(key) || !this.allowedTabs().includes(key) || key === this.activeTab())
      return;
    // A user's tab change is a history entry (Back returns to the previous tab); only the normalising redirect replaces.
    void this.navigateToTab(key, false);
  }

  private navigateToTab(tab: DashboardTab, replace: boolean): Promise<boolean> {
    return this.router.navigate([], {
      relativeTo: this.route,
      // The Swimlane tab's own parameters (group, sort, filters...) do not follow the person to another tab.
      queryParams: {
        tab,
        ...(tab === 'swimlane' ? {} : clearedViewParams()),
        ...(tab === 'trends' ? {} : clearedTrendParams()),
        ...(tab === 'users' ? {} : clearedUsersParams()),
      },
      queryParamsHandling: 'merge',
      replaceUrl: replace,
    });
  }

  protected setPeriod(value: string): void {
    if (!isPeriodKey(value) || value === this.period()) return;
    this.prefs.setPeriod(value as PeriodKey);
    this.refreshNumbers();
  }

  /** Retry in the failed-refresh banner. When it works the banner (and the focused Retry) goes away, so focus goes back to Refresh. */
  protected retryRefresh(): void {
    this.focusRefreshWhenDone = true;
    this.refresh();
  }

  /** The Refresh button: reads everything again now, bypassing the short server cache, and keeps the page (and the focus) where it is. */
  protected refresh(): void {
    // aria-disabled, not disabled: a disabled button would drop the keyboard focus the press had.
    if (this.refreshing()) return;
    this.load({ silent: true, fresh: true, announce: true });
  }

  /** Counts after a period change; the lists do not depend on the period, and the page keeps what it shows until the answer arrives. */
  private refreshNumbers(lists = false): void {
    this.load({ silent: true, fresh: true, lists });
  }

  protected load(
    options: { silent?: boolean; fresh?: boolean; lists?: boolean; announce?: boolean } = {},
  ): void {
    const { silent = false, fresh = false, lists = true, announce = false } = options;
    if (!this.needsSummary()) {
      // Only the Swimlane and Users tabs: they read their own endpoints, there is no summary to load.
      this.state.set('ready');
      this.refreshFailed.set(false);
      return;
    }
    const id = ++this.requestId;
    const background = silent && !!this.data();
    if (background) this.refreshing.set(true);
    else {
      this.state.set('loading');
      this.refreshFailed.set(false);
    }
    const days = periodDays(this.period(), this.clock.now(), this.zone);
    // A background read reports its failure in the banner; the generic error toast would say the same thing again, elsewhere.
    const start = () =>
      this.api
        .getDashboard(days, fresh ? true : undefined)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (summary) => {
            if (id !== this.requestId) return;
            this.data.set(summary);
            this.state.set('ready');
            this.refreshing.set(false);
            this.refreshFailed.set(false);
            this.lastLoadedAt = this.clock.now().getTime();
            if (announce) this.live.set(`Dashboard refreshed. Updated ${this.updated()}.`);
            if (this.focusRefreshWhenDone) {
              this.focusRefreshWhenDone = false;
              afterNextRender(
                () => this.host.nativeElement.querySelector<HTMLElement>('[data-refresh]')?.focus(),
                { injector: this.injector },
              );
            }
            if (lists) {
              // The lists are part of the Summary tab: read them now when it is shown, else when it is next opened.
              this.summarySeq++;
              if (this.activeTab() === 'summary') {
                this.listsSeq = this.summarySeq;
                this.loadLists(silent);
              }
            }
          },
          error: () => {
            if (id !== this.requestId) return;
            this.refreshing.set(false);
            this.focusRefreshWhenDone = false;
            // A failed background refresh keeps the figures on screen; only a first load shows the error state.
            if (this.data()) this.refreshFailed.set(true);
            else this.state.set('error');
          },
        });
    if (background) this.quiet.run(start);
    else start();
  }

  // ---- lists

  protected listOf(kind: ListKind): ListData {
    return this.lists[kind]();
  }

  private loadLists(silent: boolean): void {
    for (const panel of this.panels()) this.fetchList(panel, silent);
  }

  protected reloadList(kind: ListKind): void {
    const panel = this.panels().find((p) => p.kind === kind);
    if (panel) this.fetchList(panel, false);
  }

  private fetchList(panel: PanelSpec, silent: boolean): void {
    const { kind, query } = panel;
    const list = this.lists[kind];
    const id = ++this.listIds[kind];
    const order = LIST_ORDER[kind];
    // A background refresh keeps the rows on screen; only a first load (or a retry) shows the skeleton.
    if (!silent || list().state !== 'ready') list.update((v) => ({ ...v, state: 'loading' }));
    this.queue
      .getTaskQueue(...queueArgsFor(query, order.sort, order.dir, LIST_SIZE[kind]))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          if (id === this.listIds[kind]) {
            list.set({ state: 'ready', rows: page.items, total: page.total });
          }
        },
        error: () => {
          if (id === this.listIds[kind]) {
            list.update((v) => (silent && v.rows.length > 0 ? v : { ...v, state: 'error' }));
          }
        },
      });
  }

  /**
   * An inline edit changed a row. While it is only the optimistic or rolled-back row it is shown in place. Once the server has accepted an
   * assignment (a new row version with a person on it) the task is no longer unassigned: it leaves the queue at once, the counts drop with
   * it, focus moves to the neighbouring row, and the counts and lists are read again shortly (several quick edits make one read).
   */
  protected onRowChange(kind: ListKind, row: TaskQueueRow): void {
    const list = this.lists[kind];
    const index = list().rows.findIndex((r) => r.taskId === row.taskId);
    if (index < 0) return;
    const before = list().rows[index];
    const committed = row.rowVersion !== before.rowVersion;
    if (kind === 'unassigned' && row.assignedUser && committed) {
      this.leaveQueue(kind, index, row);
    } else {
      list.update((v) => ({ ...v, rows: v.rows.map((r) => (r.taskId === row.taskId ? row : r)) }));
    }
    if (committed) this.scheduleRefresh();
  }

  private leaveQueue(kind: ListKind, index: number, row: TaskQueueRow): void {
    const list = this.lists[kind];
    list.update((v) => ({
      ...v,
      rows: v.rows.filter((r) => r.taskId !== row.taskId),
      total: Math.max(0, v.total - 1),
    }));
    // The tile follows at once; the fresh read a moment later replaces it with the server's number.
    this.data.update((d) =>
      d ? { ...d, unassigned: { ...d.unassigned, count: Math.max(0, d.unassigned.count - 1) } } : d,
    );
    const left = list().total;
    this.live.set(
      `${row.taskNumber} assigned to ${row.assignedUser?.displayName ?? 'someone'} and removed from the Unassigned queue. ${left} unassigned ${left === 1 ? 'task' : 'tasks'} left.`,
    );
    // The button that had focus is gone: put focus on the row that took its place (or the one above, or the list heading).
    afterNextRender(
      () =>
        this.panelRefs()
          .find((p) => p.kind() === kind)
          ?.focusNear(index),
      {
        injector: this.injector,
      },
    );
  }

  private scheduleRefresh(): void {
    if (this.countTimer) clearTimeout(this.countTimer);
    this.countTimer = setTimeout(() => {
      this.countTimer = null;
      this.refreshNumbers(true);
    }, COUNT_REFRESH_DELAY_MS);
  }

  // ---- automatic refresh

  private startAutoRefresh(): void {
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      // Do not swap rows under an open menu.
      if (typeof document !== 'undefined' && document.querySelector('mf-dash-task-list .im-pop')) {
        return;
      }
      if (this.state() === 'ready') this.load({ silent: true });
    };
    const timer = setInterval(tick, AUTO_REFRESH_MS);
    // Back on the tab after a long absence: catch up at once instead of waiting for the next tick.
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        this.clock.now().getTime() - this.lastLoadedAt >= AUTO_REFRESH_MS
      ) {
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    this.destroyRef.onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }
}
