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
import {
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
import { formatCalendarDay, mfDate, parseDateOnly } from '../../../core/time/time';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { FixedPage } from '../../../shared/ui/fixed-page';
import {
  DUE_SOON_CAPTION,
  DUE_SOON_WINDOW,
  LIST_ORDER,
  ListKind,
  dueSoonThrough,
  queueArgsFor,
} from '../dashboard-links';
import {
  PERIOD_SCOPE_NOTE,
  Period,
  periodArgs,
  periodForTab,
  periodId,
  rangeText,
  resolveRange,
} from '../dashboard-period';
import { TileDelta, YESTERDAY, previousBasis, tileDelta, yesterdayHint } from '../dashboard-deltas';
import { PeriodControl } from '../ui/period-control';
import { DashScope } from '../dash-scope';
import {
  TECH_HEADING,
  TECH_PARAMS,
  hasTechFilters,
  techFilterQuery,
  withTechFilters,
} from '../dash-technician';
import { ScopeControl } from '../ui/scope-control';
import {
  DASHBOARD_TABS,
  DASHBOARD_TAB_LABELS,
  DASHBOARD_TAB_PERMISSIONS,
  DashboardPrefs,
  DashboardTab,
  SUMMARY_DATA_TABS,
  isDashboardTab,
} from '../dashboard-prefs';
import { DashBreakdownsTab } from '../ui/dash-breakdowns-tab';
import { canonicalParams, clearedTabParams, sameParams, tabFallback } from '../dash-url-state';
import { FRESH_FOR_MS, STALE_CHECK_MS, staleAgeText } from '../dash-stale';
import { DASH_FIXED_QUERY, DASH_FIXED_WIDE_QUERY, mediaMatch } from '../ui/dash-media';
import { DashNote } from '../ui/dash-note';
import { DashState, focusAfterRetry } from '../ui/dash-state';
import { DashSection } from '../ui/dash-section';
import { DashSwimlaneTab } from '../ui/dash-swimlane-tab';
import { DashTab, DashTabs, panelId, tabId } from '../ui/dash-tabs';
import { DashUsersTab } from '../ui/dash-users-tab';
import { StatTile } from '../ui/stat-tile';
import { DashTaskList, PanelEmptyState, PanelState } from '../ui/task-list-panel';
import { DashTechnicianBar } from '../ui/dash-technician-bar';
import { DashTrendsTab } from '../ui/dash-trends-tab';

type LoadState = 'loading' | 'ready' | 'error';

/** One list panel of the Summary tab: what it is called and the Task Queue query behind it. */
interface PanelSpec {
  kind: ListKind;
  heading: string;
  emptyText: string;
  viewAllText: string;
  viewAllTitle: string;
  query: string;
  emptyState?: PanelEmptyState | null;
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

/** Rows per list on the Summary (one line each, review S1); the list's total decides "Showing 5 of N" and the "View all" link. */
const LIST_SIZE: Record<ListKind, number> = { unassigned: 5, overdue: 5, dueSoon: 5 };
const EMPTY_LIST: ListData = { state: 'loading', rows: [], total: 0 };

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
    FixedPage,
    DashState,
    DashNote,
    DashBreakdownsTab,
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
    PeriodControl,
    ScopeControl,
    DashTechnicianBar,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-fixed-page class="dash" [class.dash--wide]="wide()" [attr.data-dash-tab]="activeTab()">
      <p class="sr-only" role="status" aria-live="polite" data-dash-live>{{ live() }}</p>

      <!-- One outlet for the header row (heading, tab list, Refresh) in every state, so the Refresh button is the same element while the page loads and after: a second
         outlet in each branch made Angular replace the button when the first read finished, and the keyboard focus on it was lost. -->
      <ng-container *ngTemplateOutlet="tabList" />

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
        @if (notice(); as note) {
          <mf-dash-note [text]="note" (dismiss)="notice.set(null)" />
        }
        @if (summaryTab() && refreshFailed()) {
          <mf-dash-state variant="stale" [updated]="updated()" (retry)="retryRefresh()" />
        }
        @switch (viewState()) {
          @case ('board') {
            <!-- Swimlane and Users read their own endpoints: nothing here waits for, or dies with, the shared summary request. -->
            <ng-container *ngTemplateOutlet="boardPanel" />
          }
          @case ('loading') {
            <div
              class="panel mf-fill"
              [attr.role]="panelRole()"
              [attr.data-tabpanel]="activeTab()"
              [id]="panelId(activeTab()!)"
              [attr.aria-labelledby]="labelledBy()"
            >
              <div
                class="skeletons"
                role="status"
                aria-busy="true"
                aria-label="Loading the dashboard"
              >
                @for (n of skeletonTiles; track n) {
                  <div class="skeleton"></div>
                }
              </div>
            </div>
          }
          @case ('error') {
            <div
              class="panel mf-fill"
              [attr.role]="panelRole()"
              [attr.data-tabpanel]="activeTab()"
              [id]="panelId(activeTab()!)"
              [attr.aria-labelledby]="labelledBy()"
            >
              <mf-dash-state
                variant="error"
                message="The dashboard could not be loaded."
                (retry)="retryFirstLoad()"
              />
            </div>
          }
          @default {
            @if (data(); as d) {
              @if (isEmpty()) {
                <div class="empty" data-empty>
                  <i class="pi pi-inbox empty-icon" aria-hidden="true"></i>
                  <p>No open tasks, and none were created or completed in this period.</p>
                  <div class="empty-period"><mf-period-control [period]="period()" /></div>
                  <a *mfHasPermission="'Task.Create'" class="cta" routerLink="/tasks/new">
                    Create the first task
                  </a>
                </div>
              } @else {
                @switch (activeTab()) {
                  @case ('summary') {
                    <div
                      class="panel mf-fill"
                      [attr.role]="panelRole()"
                      data-tabpanel="summary"
                      [id]="panelId('summary')"
                      [attr.aria-labelledby]="labelledBy()"
                    >
                      <div
                        class="summary"
                        [class.summary--queue]="!fullSummary()"
                        [attr.role]="summaryScrolls() ? 'region' : null"
                        [attr.tabindex]="summaryScrolls() ? 0 : null"
                        [attr.aria-label]="summaryScrolls() ? 'Summary, scrollable' : null"
                      >
                        @if (fullSummary()) {
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
                                  [sort]="overdueOrder"
                                  caption="Excludes ASAP tasks"
                                  [delta]="overdueDelta()"
                                  [hint]="overdueHint()"
                                  [detail]="overdueSeverity(d)"
                                  detailIcon="pi-flag-fill"
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
                                  caption="Waiting on client, custodian or internal"
                                />
                                <mf-stat-tile
                                  label="ASAP open"
                                  icon="pi-bolt"
                                  tone="asap"
                                  emphasis="quiet"
                                  linkText="View ASAP tasks"
                                  [value]="d.asapOpen.count"
                                  [query]="d.asapOpen.query"
                                  caption="No due date"
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
                                <mf-period-control [period]="period()" [scopeNote]="scopeNote" />
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
                                  [delta]="openDelta()"
                                  [hint]="openHint()"
                                />
                                <mf-stat-tile
                                  label="Due soon"
                                  icon="pi-clock"
                                  emphasis="quiet"
                                  linkText="View tasks due soon"
                                  [value]="d.dueSoon.count"
                                  [query]="d.dueSoon.query"
                                  [caption]="dueSoonCaption"
                                  [hint]="dueSoonHint(d)"
                                />
                                <mf-stat-tile
                                  label="Completed"
                                  icon="pi-check-circle"
                                  emphasis="quiet"
                                  linkText="View completed tasks"
                                  [value]="d.completed.count"
                                  [query]="d.completed.query"
                                  [caption]="periodCaption()"
                                  [delta]="completedDelta()"
                                  [hint]="previousHint(d.completedPrevious, 'completed')"
                                />
                                <mf-stat-tile
                                  label="Created"
                                  icon="pi-plus-circle"
                                  emphasis="quiet"
                                  linkText="View created tasks"
                                  [value]="d.created.count"
                                  [query]="d.created.query"
                                  [caption]="periodCaption()"
                                  [delta]="createdDelta()"
                                  [hint]="previousHint(d.createdPrevious, 'created')"
                                />
                              </div>
                            </div>
                          </div>
                        }
                        @if (technician()) {
                          <!-- S9: the Technician's strip (Priority and Task type filters, own work); loaded only for this variant. -->
                          @defer (on immediate) {
                            <mf-dash-technician-bar
                              [mine]="d.mine"
                              [canMyWork]="canSeeMyWork()"
                              [notInPod]="scope.ready() && !scope.inPod()"
                            />
                          }
                        }
                        @if (panels().length > 0) {
                          <!-- No section headings: each list heading names its list (Unassigned, Overdue, Due soon). -->
                          <div
                            class="summary-lists"
                            role="group"
                            aria-label="Unassigned, overdue and due soon tasks"
                            data-lists
                          >
                            @if (noPodHint(); as hint) {
                              <!-- Tasks with no pod are in no scope but All pods: a quiet line so they cannot be lost. -->
                              <p class="no-pod" data-no-pod-hint>
                                {{ hint.text }}
                                <a
                                  href="#"
                                  class="no-pod-link"
                                  data-show-all-pods
                                  (click)="showAllPods($event)"
                                  >Show all pods</a
                                >
                              </p>
                            }
                            @for (panel of panels(); track panel.kind) {
                              <mf-dash-task-list
                                [kind]="panel.kind"
                                [heading]="panel.heading"
                                [emptyText]="panel.emptyText"
                                [viewAllText]="panel.viewAllText"
                                [viewAllTitle]="panel.viewAllTitle"
                                [rows]="listOf(panel.kind).rows"
                                [total]="listOf(panel.kind).total"
                                [state]="listOf(panel.kind).state"
                                [query]="panel.query"
                                [emptyState]="panel.emptyState ?? null"
                                (emptyClear)="clearTechFilters()"
                                (emptyAction)="showAllPods()"
                                [skippable]="panel.kind !== lastKind()"
                                [scroll]="fixedWide()"
                                (rowChange)="onRowChange(panel.kind, $event)"
                                (retry)="reloadList(panel.kind)"
                              />
                            }
                          </div>
                        }
                      </div>
                    </div>
                  }
                  @case ('breakdowns') {
                    <div
                      class="panel mf-fill"
                      [attr.role]="panelRole()"
                      data-tabpanel="breakdowns"
                      [id]="panelId('breakdowns')"
                      [attr.aria-labelledby]="labelledBy()"
                    >
                      <mf-dash-breakdowns [summary]="data()" />
                    </div>
                  }
                  @case ('trends') {
                    <div
                      class="panel mf-fill"
                      [attr.role]="panelRole()"
                      data-tabpanel="trends"
                      [id]="panelId('trends')"
                      [attr.aria-labelledby]="labelledBy()"
                    >
                      <mf-dash-section class="mf-fill" heading="Tasks over time" name="trend">
                        <span mfSectionActions class="head-period" data-trend-period>
                          <mf-period-control [period]="period()" />
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
                }
              }
            }
          }
        }
      }

      <ng-template #boardPanel>
        @switch (activeTab()) {
          @case ('swimlane') {
            <div
              class="panel mf-fill"
              [attr.role]="panelRole()"
              data-tabpanel="swimlane"
              [id]="panelId('swimlane')"
              [attr.aria-labelledby]="labelledBy()"
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
              class="panel mf-fill"
              [attr.role]="panelRole()"
              data-tabpanel="users"
              [id]="panelId('users')"
              [attr.aria-labelledby]="labelledBy()"
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
          [heading]="heading()"
          [showTabs]="tabRow()"
          (tabChange)="selectTab($event)"
        >
          @if (activeTab() && showTabs()) {
            <!-- Only when the figures are 10 minutes old: the age as text (warning style, icon and words), announced once when it appears. At 375 px it is read, not shown. -->
            <span class="age" role="status" aria-live="polite" data-stale-age-live>
              @if (staleText(); as text) {
                <span class="age-text" data-stale-age>
                  <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>{{ text }}
                </span>
              }
            </span>
            <!-- The page-wide Scope (P1): All pods, My pods or one Pod, for every tab; left of Refresh. -->
            @if (scope.ready()) {
              <mf-dash-scope (scopeChange)="live.set($event)" />
            }
            <!-- One icon-only Refresh for every tab, acting on the tab shown; the time of the last read is its tooltip, not visible text. -->
            <button
              type="button"
              class="mf-btn mf-btn--icon"
              data-refresh
              [attr.aria-label]="refreshLabel()"
              [attr.title]="refreshTip()"
              [attr.aria-disabled]="refreshBusy() ? 'true' : null"
              [attr.aria-busy]="refreshBusy() ? 'true' : null"
              (click)="refreshActive()"
            >
              <i
                class="pi"
                [class]="refreshBusy() ? 'pi-spin pi-spinner' : 'pi-refresh'"
                aria-hidden="true"
              ></i>
            </button>
          }
        </mf-dash-tabs>
      </ng-template>
    </mf-fixed-page>
  `,
  styles: `
    /* A readable measure on wide monitors: the page is left-aligned and stops at 1360px instead of stretching every card. Swimlane, Users
       (Workload and Coverage) and Trends use the whole content area from 1600 px (P5); the left edge and the gutter do not move. */
    :host {
      display: block;
    }
    /* Positioned, so absolutely placed helpers inside (visually hidden text, skip links) are clipped with the page and never add document scroll. */
    .dash {
      position: relative;
      max-width: 1360px;
    }
    @media (min-width: 1600px) {
      .dash--wide {
        max-width: none;
      }
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
    /* Summary: tiles on the left and the three lists (one line per row) in a column beside them from 1280px; stacked below the tiles under that. */
    .summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      column-gap: var(--mf-s5);
      align-items: start;
    }
    .summary-lists {
      display: grid;
      gap: var(--mf-s2);
      min-width: 0;
    }
    @media (min-width: 1280px) {
      .summary:not(.summary--queue) {
        grid-template-columns: minmax(0, clamp(360px, 27vw, 452px)) minmax(0, 1fr);
      }
    }
    /* Fixed-height layout (#137, window at least 768 x 561): the header row stays, the tab panel fills the rest and only regions inside scroll.
       Summary: from 1280 px the tiles stay (they scroll only on a very short window) and each list scrolls inside its panel; under 1280 px
       the lists sit under the tiles and the Summary scrolls as one region. */
    @media (min-width: 768px) and (min-height: 561px) {
      .summary {
        flex: 1 1 0;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .summary:focus-visible {
        outline: 2px solid var(--mf-focus);
        outline-offset: -2px;
      }
    }
    @media (min-width: 1280px) and (min-height: 561px) {
      .summary {
        overflow: visible;
        grid-template-rows: minmax(0, 1fr);
        align-items: stretch;
      }
      .summary-tiles {
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      /* Two tiles across in the tile column: both groups fit a 768 px window without scrolling. */
      .summary-tiles .tiles {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--mf-s2);
      }
      .summary-lists {
        display: flex;
        flex-direction: column;
        min-height: 0;
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
    .no-pod {
      margin: 0;
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .no-pod-link {
      display: inline-block;
      min-height: 24px;
      line-height: 24px;
      color: var(--mf-link);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    .age {
      display: inline-flex;
      min-width: 0;
    }
    .age-text {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      color: var(--mf-warning);
      font-size: var(--mf-fs-sm);
      white-space: nowrap;
    }
    @media (max-width: 480px) {
      .age-text {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
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
    @media (max-width: 900px) {
      .grid {
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
  protected readonly scope = inject(DashScope);
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
  /** The period (`periodId`) the summary on screen was read for. */
  private dataPeriod: string | null = null;
  /** The scope the summary on screen was read for. */
  private dataScope: string | null = null;
  private inflight = false;
  private retrying = false;
  /** When the summary on screen was last read successfully (epoch ms). */
  private readonly summaryOkAt = signal<number | null>(null);
  /** The clock for the age text; moved on every 30 s check and whenever a read succeeds or the tab becomes visible. */
  private readonly now = signal(0);
  /** Counts the summary reads that were meant to refresh the lists; `listsSeq` is the one the lists on screen belong to. */
  private summarySeq = 0;
  private listsSeq = -1;

  /** The fixed-height layout (#137) is on: the page fills the window and never scrolls itself. */
  protected readonly fixed = mediaMatch(DASH_FIXED_QUERY);
  /** Fixed layout and wide enough for the lists beside the tiles: each list scrolls inside its own panel. */
  protected readonly fixedWide = mediaMatch(DASH_FIXED_WIDE_QUERY);
  /** Fixed layout with the lists under the tiles (under 1280 px): the Summary scrolls as one region. */
  protected readonly summaryScrolls = computed(() => this.fixed() && !this.fixedWide());
  protected readonly scopeNote = PERIOD_SCOPE_NOTE;
  protected readonly skeletonTiles = [1, 2, 3, 4, 5, 6, 7, 8];
  protected readonly panelId = panelId;
  protected readonly tabId = tabId;
  /** The period of Summary and Trends: the shared one (address, else memory); the long Coverage windows read as the default here. */
  protected readonly period = computed<Period>(() => periodForTab(this.prefs.period(), false));
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
      ? DASHBOARD_TABS.filter((t) => this.auth.hasAny(DASHBOARD_TAB_PERMISSIONS[t])).map((t) => ({
          key: t,
          label: DASHBOARD_TAB_LABELS[t],
        }))
      : [],
  );
  private readonly allowedTabs = computed(() =>
    this.visibleTabs().map((t) => t.key as DashboardTab),
  );
  /** The Summary tab is shown (Dashboard.ViewSummary or Dashboard.ViewUnassigned). */
  protected readonly canSummary = computed(() => this.allowedTabs().includes('summary'));
  /** The department-wide part of Summary: the tiles and the Overdue / Due soon lists. Without it (Dashboard.ViewUnassigned only) Summary is the unassigned queue alone. */
  protected readonly fullSummary = computed(
    () => this.canSummary() && this.auth.has('Dashboard.ViewSummary'),
  );
  /** The Technician's Summary (S9): the unassigned queue alone, with its own filters and the own-work line. Never the full Summary. */
  protected readonly technician = computed(() => this.canSummary() && !this.fullSummary());
  /** The filters of the technician's queue as Task Queue terms; a change reads the queue again (page 1). */
  private readonly techQuery = computed(() =>
    this.technician() ? techFilterQuery(this.queryParams()) : '',
  );
  /** Why the technician's queue is empty, when a filter or the scope is the reason (S9 empty states). */
  private technicianEmpty(): PanelEmptyState | null {
    if (hasTechFilters(this.queryParams())) {
      return { kind: 'filtered', message: 'No unassigned tasks match these filters.' };
    }
    if (!this.scope.isAll()) {
      return {
        kind: 'scope',
        message: `Nothing is unassigned in ${this.scope.label()}.`,
        actionLabel: 'Show all pods',
      };
    }
    return null;
  }
  protected readonly canSeeMyWork = computed(() => this.auth.has('Task.View'));
  protected readonly canAssign = computed(() => this.auth.has('Task.Assign'));

  /** The `?tab=` of the address; the tab shown is this one, else Summary (a plain /dashboard link always opens the page that answers "what needs attention"). */
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly tabParam = computed(() => this.queryParams().get('tab'));
  /** The tab shown: the one in the address when it is permitted, else the first permitted tab (a deep link to a forbidden tab falls back); null without any tab. */
  protected readonly activeTab = computed<DashboardTab | null>(() => {
    const fromUrl = this.tabParam();
    const allowed = this.allowedTabs();
    return isDashboardTab(fromUrl) && allowed.includes(fromUrl) ? fromUrl : (allowed[0] ?? null);
  });

  /** Summary, Breakdowns and Trends read the shared summary request; Swimlane and Users never do (P2). */
  protected readonly summaryTab = computed(() => {
    const tab = this.activeTab();
    return tab !== null && SUMMARY_DATA_TABS.includes(tab);
  });
  /** What the page body shows: the board tabs never wait on the summary (P2); the others follow the state of the shared summary read. */
  protected readonly viewState = computed<LoadState | 'board'>(() => {
    // Nothing is read before the scope is known, so the first read already has it.
    if (!this.scope.ready()) return 'loading';
    return this.summaryTab() ? this.state() : 'board';
  });
  /** A one-line note under the tab row: why the tab shown is not the one in the link (R1). Dropped when the person moves to another tab. */
  protected readonly notice = signal<string | null>(null);

  /**
   * The lists of the Summary tab: the Unassigned queue (with Dashboard.ViewUnassigned, or Dashboard.ViewSummary and Task.Assign),
   * and with Dashboard.ViewSummary also Overdue and Due soon.
   * Their own work is in My Work.
   */
  protected readonly panels = computed<PanelSpec[]>(() => {
    const unassigned = (query: string): PanelSpec => ({
      kind: 'unassigned',
      heading: 'Unassigned',
      emptyText: 'No unassigned tasks.',
      viewAllText: 'View all',
      viewAllTitle: 'View all unassigned tasks',
      query,
    });
    // The Technician's queue (S9): the filters of the address are part of its query, so the list, its total and "View all" are the Task Queue's for the same filter.
    const technicianQueue = (query: string): PanelSpec => ({
      ...unassigned(withTechFilters(query, this.queryParams())),
      emptyState: this.technicianEmpty(),
    });
    if (!this.canSummary()) return [];
    const d = this.data();
    if (!d) return [];
    // Dashboard.ViewUnassigned alone: the queue is the whole Summary tab.
    if (!this.fullSummary()) return [technicianQueue(d.unassigned.query)];
    return [
      ...(this.canAssign() || this.auth.has('Dashboard.ViewUnassigned')
        ? [unassigned(d.unassigned.query)]
        : []),
      {
        kind: 'overdue',
        heading: 'Overdue',
        emptyText: 'Nothing is overdue.',
        viewAllText: 'View all',
        viewAllTitle: 'View all overdue tasks',
        query: d.overdue.query,
      },
      {
        kind: 'dueSoon',
        heading: 'Due soon',
        emptyText: 'Nothing is due today or in the next 2 days.',
        viewAllText: 'View all',
        viewAllTitle: `View all tasks due soon: ${DUE_SOON_WINDOW.toLowerCase()}`,
        query: d.dueSoon.query,
      },
    ];
  });
  /** "N unassigned tasks have no pod." under a Pod scope (null under All pods, or when there are none). */
  protected readonly noPodHint = computed(() => {
    const d = this.data();
    const n = d?.scope?.unassignedNoPod ?? 0;
    if (this.scope.isAll() || n === 0 || !this.panels().some((p) => p.kind === 'unassigned')) {
      return null;
    }
    return { text: `${n} unassigned ${n === 1 ? 'task has' : 'tasks have'} no pod.` };
  });
  protected readonly lastKind = computed(() => this.panels().at(-1)?.kind ?? null);

  /** The refresh button in the tab row is busy while the data of the tab shown is being read again. */
  protected readonly refreshBusy = computed(() => {
    switch (this.activeTab()) {
      case 'swimlane':
        return this.swimlane()?.refreshing() ?? false;
      case 'users':
        return this.users()?.refreshing() ?? false;
      default:
        return this.refreshing();
    }
  });
  /** The refresh button's tooltip: it names the time of the last read of the tab shown (the 'Updated' text is not shown on the page). */
  protected readonly refreshTip = computed(() => {
    const tab = this.activeTab();
    const at =
      tab === 'swimlane'
        ? this.swimlane()?.updated()
        : tab === 'users'
          ? this.users()?.updated()
          : this.updated();
    return at ? `Refresh. Updated ${at}. Refreshes itself every 5 minutes.` : 'Refresh';
  });
  /** The last successful read of the tab shown (epoch ms), for the age text (P6). */
  private readonly activeOkAt = computed(() => {
    switch (this.activeTab()) {
      case 'swimlane':
        return this.swimlane()?.lastOkAt() ?? null;
      case 'users':
        return this.users()?.lastOkAt() ?? null;
      default:
        return this.summaryOkAt();
    }
  });
  /** A failed refresh of the tab shown: its banner already says so, so the age text stays away (it must not say the same thing twice). */
  private readonly activeFailed = computed(() => {
    switch (this.activeTab()) {
      case 'swimlane':
        return this.swimlane()?.refreshFailed() ?? false;
      case 'users':
        return this.users()?.failed() ?? false;
      default:
        return this.refreshFailed();
    }
  });
  /** "Updated 14 min ago" once the figures on screen are 10 minutes old (two missed refreshes); null in a normal session (P6, decision S stays). */
  protected readonly staleText = computed(() =>
    this.activeFailed() ? null : staleAgeText(this.activeOkAt(), this.now()),
  );
  protected readonly refreshLabel = computed(() => {
    const text = this.staleText();
    return text ? `Refresh. ${text}.` : 'Refresh';
  });
  /** The resolved range under the Summary tiles and the Trends heading ("Sep 17 to Oct 16"): the server's answer when it is for this period, else worked out here. */
  protected readonly periodCaption = computed(() => {
    const period = this.period();
    const d = this.data()?.period;
    const answered =
      d &&
      d.key === period.key &&
      (period.key !== 'custom' || (d.from === period.from && d.to === period.to));
    const now = this.clock.now();
    const range = answered
      ? { from: d.from, to: d.to, days: d.days }
      : resolveRange(period, now, this.zone);
    return rangeText(range, now.getFullYear());
  });
  // ---- change since before (S3)

  /** The words for the period Completed and Created were compared with ("previous 30 days", "same days last month"); null without one. */
  private readonly basis = computed(() => {
    const d = this.data();
    return d ? previousBasis(d.previousPeriod, d.period.days) : null;
  });
  protected readonly overdueDelta = computed<TileDelta | null>(() => {
    const d = this.data();
    return d ? tileDelta(d.overdue.count, d.overdueYesterday, YESTERDAY, true) : null;
  });
  protected readonly openDelta = computed<TileDelta | null>(() => {
    const d = this.data();
    return d ? tileDelta(d.open.count, d.openYesterday, YESTERDAY) : null;
  });
  protected readonly completedDelta = computed<TileDelta | null>(() => {
    const d = this.data();
    return d ? tileDelta(d.completed.count, d.completedPrevious, this.basis()) : null;
  });
  protected readonly createdDelta = computed<TileDelta | null>(() => {
    const d = this.data();
    return d ? tileDelta(d.created.count, d.createdPrevious, this.basis()) : null;
  });
  protected readonly overdueHint = computed(() => {
    const d = this.data();
    return d && this.overdueDelta() ? yesterdayHint(d.overdueYesterday) : null;
  });
  protected readonly openHint = computed(() => {
    const d = this.data();
    return d && this.openDelta() ? yesterdayHint(d.openYesterday) : null;
  });

  /** Tooltip and description of Completed and Created: the period compared with and its figure ("Sep 1 to Sep 14: 59 completed"). */
  protected previousHint(value: number | null | undefined, noun: string): string | null {
    const prev = this.data()?.previousPeriod;
    if (!prev || value === null || value === undefined) return null;
    const range = rangeText(
      { from: prev.from, to: prev.to, days: this.data()?.period.days ?? 0 },
      this.clock.now().getFullYear(),
    );
    return `Compared with ${range}: ${value} ${noun}.`;
  }

  protected readonly updated = computed(() => {
    const d = this.data();
    return d ? mfDate(d.generatedAtUtc, this.zone, 'datetime') : null;
  });
  /** The tab list is drawn only with two or more permitted tabs (R3); with one, its name is the page heading and Refresh stays. */
  protected readonly tabRow = computed(() => this.showTabs() && this.visibleTabs().length > 1);
  /** The page heading (H1): "Dashboard", or the name of the only permitted tab (R3). */
  protected readonly heading = computed(() => {
    const tabs = this.visibleTabs();
    // The only content is the unassigned queue: the page says so (S9).
    if (tabs.length === 1 && tabs[0].key === 'summary' && this.technician()) return TECH_HEADING;
    return tabs.length === 1 ? tabs[0].label : 'Dashboard';
  });
  /** Panels are `tabpanel`s of the tab list; with no tab list they are regions named by the heading (no orphan tabpanel). */
  protected readonly panelRole = computed(() => (this.tabRow() ? 'tabpanel' : 'region'));
  protected readonly labelledBy = computed(() => {
    const tab = this.activeTab();
    return this.tabRow() && tab ? tabId(tab) : 'mf-dash-h1';
  });
  /** Tabs whose content uses the whole width from 1600 px (Swimlane, Users with Coverage, Trends); Summary and Breakdowns keep the reading cap (P5). */
  protected readonly wide = computed(() => {
    const tab = this.activeTab();
    return tab === 'swimlane' || tab === 'users' || tab === 'trends';
  });
  /** The tab row is always there (P2/P7: an error stays inside the tab), except on the empty Summary, which has no other tab to offer. */
  protected readonly showTabs = computed(
    () => !(this.summaryTab() && this.state() === 'ready' && !!this.data() && this.isEmpty()),
  );
  /**
   * Nothing open and nothing created or completed in the period. Only meaningful with the whole Summary tab (Dashboard.ViewSummary; the counts are redacted to zero for
   * everyone else, which must not read as "no tasks"), and only when no board tab needs the tab list.
   */
  protected readonly isEmpty = computed(() => {
    const d = this.data();
    return (
      this.fullSummary() &&
      this.scope.isAll() &&
      !this.allowedTabs().some((t) => !SUMMARY_DATA_TABS.includes(t)) &&
      !!d &&
      d.open.count === 0 &&
      d.created.count === 0 &&
      d.completed.count === 0
    );
  });
  constructor() {
    void this.lookups.ensureLoaded();
    // The shared period (P3) is the address when it names one, else the remembered choice; settled before the first read.
    this.prefs.applyAddress((k) => this.route.snapshot.queryParamMap.get(k));
    // The page-wide scope (P1): the address, else the remembered choice, else the default the server names for this person.
    this.scope.ensureLoaded();
    this.scope.applyAddress((k) => this.route.snapshot.queryParamMap.get(k));
    effect(() => {
      const params = this.queryParams();
      untracked(() => {
        this.prefs.applyAddress((k) => params.get(k));
        this.scope.applyAddress((k) => params.get(k));
      });
    });
    // A new scope (the control, a pasted link, Back) reads everything the tab on screen shows again, with the skeleton and not the figures of the old scope;
    // the other tabs read it when opened.
    effect(() => {
      const scope = this.scope.scope();
      const ready = this.scope.ready();
      untracked(() => {
        if (ready && this.data() && this.summaryTab() && scope !== this.dataScope)
          this.refreshScope();
      });
    });
    // An address that names a Pod the person may not see shows the default scope and says so (R1 for the scope).
    effect(() => {
      const bad = this.scope.rejected();
      untracked(() => {
        if (bad !== null) {
          this.notice.set(
            `That pod is not available to you. Showing ${this.scope.labelOf(this.scope.defaultScope())}.`,
          );
        }
      });
    });
    // A new period (the control, a pasted link, Back) reads the counts again when a tab that shows them is on screen; the other tabs read when opened.
    effect(() => {
      const id = periodId(this.period());
      untracked(() => {
        if (this.data() && this.summaryTab() && id !== this.dataPeriod) this.refreshNumbers();
      });
    });
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
    // Keep the address in step with the tab shown (P9, R1): a link to a tab the person cannot open (or that does not exist) shows the first
    // permitted tab with a note, and the address is rewritten once, replacing the entry: defaults and unknown parameters leave it, a plain
    // link or one that already says the right thing is not touched.
    effect(() => {
      const tab = this.activeTab();
      const params = this.queryParams();
      const requested = this.tabParam();
      const allowed = this.allowedTabs();
      const ready = this.scope.ready();
      // Tracked: the address is normalised again once the scope choices are known.
      const rule = ready
        ? { isValid: (v: string) => this.scope.isValid(v), defaultValue: this.scope.defaultScope() }
        : null;
      untracked(() => {
        if (!tab) return;
        const fallback = tabFallback(requested, allowed);
        if (fallback) {
          this.notice.set(
            fallback.kind === 'forbidden'
              ? `${DASHBOARD_TAB_LABELS[fallback.tab]} is not available for your role. Showing ${DASHBOARD_TAB_LABELS[tab]}.`
              : `That tab does not exist. Showing ${DASHBOARD_TAB_LABELS[tab]}.`,
          );
        }
        const canonical = canonicalParams(params, tab, rule);
        if (!sameParams(params, canonical)) {
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: canonical,
            replaceUrl: true,
          });
        }
      });
    });
    // The note belongs to the navigation that caused it: another tab (a click, Back) drops it.
    let shownTab: DashboardTab | null | undefined;
    effect(() => {
      const tab = this.activeTab();
      untracked(() => {
        if (shownTab !== undefined && shownTab !== tab) this.notice.set(null);
        shownTab = tab;
      });
    });
    // Summary, Breakdowns and Trends read the shared summary when one of them is shown; a payload read under a minute ago is reused (P2).
    effect(() => {
      const shown = this.summaryTab();
      const ready = this.scope.ready();
      untracked(() => {
        if (shown && ready) this.ensureSummary();
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
    // A change of the technician's Priority or Task type filter reads the queue again from the first row (the first read is part of the lists' own load).
    let seenTech: string | null = null;
    effect(() => {
      const query = this.techQuery();
      untracked(() => {
        const changed = seenTech !== null && seenTech !== query;
        seenTech = query;
        if (changed && this.state() === 'ready' && this.activeTab() === 'summary') {
          this.reloadList('unassigned');
        }
      });
    });
    // While the page scrolls (below 768 px or on a very short window) the header row sticks to the top from 600 px: a focused element
    // is scrolled clear of it (WCAG 2.2 SC 2.4.11).
    const root = typeof document === 'undefined' ? null : document.documentElement;
    root?.style.setProperty('scroll-padding-top', '4rem');
    this.destroyRef.onDestroy(() => {
      root?.style.removeProperty('scroll-padding-top');
      if (this.countTimer) clearTimeout(this.countTimer);
    });
  }

  ngOnInit(): void {
    this.prefs.ensureLoaded();
    this.now.set(this.clock.now().getTime());
    this.startAutoRefresh();
  }

  // ---- tabs

  protected selectTab(key: string): void {
    if (!isDashboardTab(key) || !this.allowedTabs().includes(key) || key === this.activeTab())
      return;
    this.notice.set(null);
    // A user's tab change is a history entry (Back returns to the previous tab); only the normalising redirect replaces.
    void this.navigateToTab(key, false);
  }

  private navigateToTab(tab: DashboardTab, replace: boolean): Promise<boolean> {
    return this.router.navigate([], {
      relativeTo: this.route,
      // The parameters of the tab left do not follow the person to another tab.
      queryParams: { tab, ...clearedTabParams(tab) },
      queryParamsHandling: 'merge',
      replaceUrl: replace,
    });
  }

  /** Retry in the failed-refresh banner. When it works the banner (and the focused Retry) goes away, so focus goes back to Refresh. */
  protected retryRefresh(): void {
    this.focusRefreshWhenDone = true;
    this.refresh();
  }

  /** The one Refresh icon of the tab row: acts on the tab shown (the board tabs read their own endpoints; the others the shared summary). */
  protected refreshActive(): void {
    const tab = this.activeTab();
    if (tab === 'swimlane') this.swimlane()?.refresh();
    else if (tab === 'users') this.users()?.refresh();
    else this.refresh();
  }

  /** Reads the summary tabs again now, bypassing the short server cache, and keeps the page (and the focus) where it is. */
  protected refresh(): void {
    // aria-disabled, not disabled: a disabled button would drop the keyboard focus the press had.
    if (this.refreshing()) return;
    this.load({ silent: true, fresh: true, announce: true });
  }

  /** A new scope: the figures and the lists of the tab on screen are read again (the page shows the skeleton meanwhile, never the old scope's numbers under the new label). */
  private refreshScope(): void {
    this.load({ fresh: true });
  }

  protected showAllPods(event?: Event): void {
    event?.preventDefault();
    this.scope.choose('all');
    this.live.set('Scope: All pods');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { pod: this.scope.addressValue('all') },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** "Clear filters" of the technician's empty state: removes `sprio` and `stype` from the address. */
  protected clearTechFilters(): void {
    const cleared: Record<string, null> = {};
    for (const key of TECH_PARAMS) cleared[key] = null;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: cleared,
      queryParamsHandling: 'merge',
    });
  }

  /** Counts after a period change; the lists do not depend on the period, and the page keeps what it shows until the answer arrives. */
  private refreshNumbers(lists = false): void {
    this.load({ silent: true, fresh: true, lists });
  }

  protected load(
    options: { silent?: boolean; fresh?: boolean; lists?: boolean; announce?: boolean } = {},
  ): void {
    const { silent = false, fresh = false, lists = true, announce = false } = options;
    // Swimlane and Users read their own endpoints and never ask for the summary (P2).
    if (!this.summaryTab()) return;
    const id = ++this.requestId;
    this.inflight = true;
    const background = silent && !!this.data();
    if (background) this.refreshing.set(true);
    else {
      this.state.set('loading');
      this.refreshFailed.set(false);
    }
    const args = periodArgs(this.period());
    const readFor = periodId(this.period());
    const readScope = this.scope.scope();
    // A background read reports its failure in the banner; the generic error toast would say the same thing again, elsewhere.
    const start = () =>
      this.api
        .getDashboard(
          args.period,
          args.from,
          args.to,
          undefined,
          fresh ? true : undefined,
          readScope,
        )
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (summary) => {
            if (id !== this.requestId) return;
            this.inflight = false;
            this.dataPeriod = readFor;
            this.dataScope = readScope;
            this.data.set(summary);
            this.state.set('ready');
            this.refreshing.set(false);
            this.refreshFailed.set(false);
            this.lastLoadedAt = this.clock.now().getTime();
            this.summaryOkAt.set(this.lastLoadedAt);
            this.now.set(this.lastLoadedAt);
            this.finishRetry('ready');
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
            this.inflight = false;
            this.refreshing.set(false);
            this.focusRefreshWhenDone = false;
            // A failed background refresh keeps the figures on screen; only a first load shows the error state.
            if (this.data()) this.refreshFailed.set(true);
            else this.state.set('error');
            this.finishRetry('failed');
          },
        });
    // A first load shows its failure inline in the tab (no toast, the reference goes to the alert); a background one in the stale banner.
    if (background) this.quiet.run(start);
    else this.quiet.runInline(start);
  }

  /**
   * Called when Summary, Breakdowns or Trends is shown: reads the summary unless one is on its way or the payload on screen is under a
   * minute old (switching among the three tabs, or back from another tab, must not refetch).
   */
  private ensureSummary(): void {
    if (this.inflight) return;
    const data = this.data();
    if (!data) {
      this.load();
      return;
    }
    if (this.dataScope !== this.scope.scope()) {
      this.refreshScope();
      return;
    }
    if (this.dataPeriod !== periodId(this.period())) {
      this.refreshNumbers();
      return;
    }
    if (this.clock.now().getTime() - this.lastLoadedAt < FRESH_FOR_MS) return;
    this.load({ silent: true });
  }

  /** Retry in the error state of a tab: reads again; focus follows the P7 rule when the answer is in. */
  protected retryFirstLoad(): void {
    this.retrying = true;
    this.load();
  }

  private finishRetry(outcome: 'ready' | 'failed'): void {
    if (!this.retrying) return;
    this.retrying = false;
    focusAfterRetry(this.host.nativeElement, this.injector, outcome);
  }

  // ---- lists

  /** The order "View overdue tasks" opens in: the same as the Overdue list. */
  protected readonly overdueOrder = {
    sort: LIST_ORDER.overdue.sort,
    dir: LIST_ORDER.overdue.dir,
  };

  protected readonly dueSoonCaption = DUE_SOON_CAPTION;

  /** Tooltip and description of the Due soon tile: the window in words and its last day ("through Oct 18"). */
  protected dueSoonHint(d: DashboardSummary): string | null {
    const to = dueSoonThrough(d.dueSoon.query);
    const day = to ? parseDateOnly(to) : null;
    return day ? `${DUE_SOON_CAPTION}, through ${formatCalendarDay(day)}` : null;
  }

  /** The severity line of the Overdue tile, for example "11 Critical, 30 High" (null when neither is overdue). */
  protected overdueSeverity(d: DashboardSummary): string | null {
    const parts: string[] = [];
    if (d.overdueCritical.count > 0) parts.push(`${d.overdueCritical.count} Critical`);
    if (d.overdueHigh.count > 0) parts.push(`${d.overdueHigh.count} High`);
    return parts.length ? parts.join(', ') : null;
  }

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
      // The timer acts on the tab on screen only: Swimlane and Users refresh themselves, a hidden tab does no work.
      if (this.summaryTab() && this.state() === 'ready') this.load({ silent: true });
    };
    const timer = setInterval(tick, AUTO_REFRESH_MS);
    const ageTimer = setInterval(() => this.now.set(this.clock.now().getTime()), STALE_CHECK_MS);
    // Back on the tab after a long absence: catch up at once instead of waiting for the next tick.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      this.now.set(this.clock.now().getTime());
      if (this.clock.now().getTime() - this.lastLoadedAt >= AUTO_REFRESH_MS) tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    this.destroyRef.onDestroy(() => {
      clearInterval(timer);
      clearInterval(ageTimer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }
}
