import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  DashboardBreakdownItem,
  DashboardClient,
  DashboardSummary,
} from '../../../api/generated/api-client';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { formatInstantTime } from '../../../core/time/time';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { BarItem, BarList } from '../ui/bar-list';
import { RecentTaskList } from '../ui/recent-task-list';
import { StatTile } from '../ui/stat-tile';

type LoadState = 'loading' | 'ready' | 'error';

interface PeriodOption {
  days: number;
  label: string;
}

const PERIODS: readonly PeriodOption[] = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last 12 months' },
];

const DEFAULT_PERIOD = 30;

function toBars(items: readonly DashboardBreakdownItem[]): BarItem[] {
  return items.map((i) => ({
    label: i.label,
    count: i.count,
    query: i.query ?? null,
    tone: i.code ?? null,
    muted: i.isOther,
  }));
}

/**
 * Dashboard (UX S01, ticket 51): operational counts with drill-through to the Task Queue. Everything the user can see here is a link to
 * `/tasks` carrying the query the API computed for that number. Department figures need `Dashboard.ViewDepartment`; the "Your work"
 * tiles are for everyone. Operational facts only: no billing, hours or per-person scores.
 */
@Component({
  selector: 'mf-dashboard-page',
  imports: [BarList, HasPermissionDirective, RecentTaskList, RouterLink, StatTile],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h1>Dashboard</h1>
      <div class="controls">
        <label class="period">
          <span>Period</span>
          <select [value]="period()" (change)="setPeriod($any($event.target).value)">
            @for (p of periods; track p.days) {
              <option [value]="p.days" [selected]="p.days === period()">{{ p.label }}</option>
            }
          </select>
        </label>
        <button type="button" class="refresh" (click)="load()" [disabled]="state() === 'loading'">
          <i class="pi pi-refresh" aria-hidden="true"></i> Refresh
        </button>
        @if (updated(); as u) {
          <span class="updated" data-updated>Updated {{ u }}</span>
        }
      </div>
    </header>

    @switch (state()) {
      @case ('loading') {
        <div class="skeletons" role="status" aria-busy="true" aria-label="Loading the dashboard">
          @for (n of skeletonTiles; track n) {
            <div class="skeleton"></div>
          }
        </div>
      }
      @case ('error') {
        <div class="alert" role="alert" data-error>
          <span>The dashboard could not be loaded.</span>
          <button type="button" (click)="load()">Retry</button>
        </div>
      }
      @default {
        @if (data(); as d) {
          @if (isEmpty()) {
            <div class="empty" data-empty>
              <p>No tasks yet.</p>
              <a *mfHasPermission="'Task.Create'" class="cta" routerLink="/tasks/new">
                Create the first task
              </a>
            </div>
          } @else {
            <section aria-labelledby="mine-h" class="block" data-section="mine">
              <div class="block-head">
                <h2 id="mine-h">Your work</h2>
                <a routerLink="/my-work">Go to My Work</a>
              </div>
              <div class="tiles">
                <mf-stat-tile
                  label="My open tasks"
                  [value]="d.mine.open.count"
                  [query]="d.mine.open.query"
                />
                <mf-stat-tile
                  label="My overdue"
                  [value]="d.mine.overdue.count"
                  [query]="d.mine.overdue.query"
                  caption="Excludes ASAP tasks"
                />
                <mf-stat-tile
                  label="My due soon"
                  [value]="d.mine.dueSoon.count"
                  [query]="d.mine.dueSoon.query"
                  caption="Due in the next 2 days"
                />
                <mf-stat-tile
                  label="Created by me"
                  [value]="d.mine.createdByMe.count"
                  [query]="d.mine.createdByMe.query"
                  [caption]="periodLabel()"
                />
              </div>
            </section>

            <ng-container *mfHasPermission="'Dashboard.ViewDepartment'">
              <section aria-labelledby="dept-h" class="block" data-section="department">
                <h2 id="dept-h">Department</h2>
                <div class="tiles">
                  <mf-stat-tile label="Open" [value]="d.open.count" [query]="d.open.query" />
                  <mf-stat-tile
                    label="Unassigned"
                    [value]="d.unassigned.count"
                    [query]="d.unassigned.query"
                    caption="No person assigned"
                  />
                  <mf-stat-tile
                    label="Overdue"
                    [value]="d.overdue.count"
                    [query]="d.overdue.query"
                    caption="Excludes ASAP tasks"
                  />
                  <mf-stat-tile label="On hold" [value]="d.onHold.count" [query]="d.onHold.query" />
                  <mf-stat-tile
                    label="Due soon"
                    [value]="d.dueSoon.count"
                    [query]="d.dueSoon.query"
                    caption="Next 2 days, excludes ASAP"
                  />
                  <mf-stat-tile
                    label="ASAP open"
                    [value]="d.asapOpen.count"
                    [query]="d.asapOpen.query"
                  />
                  <mf-stat-tile
                    label="Completed"
                    [value]="d.completed.count"
                    [query]="d.completed.query"
                    [caption]="periodLabel()"
                  />
                  <mf-stat-tile
                    label="Created"
                    [value]="d.created.count"
                    [query]="d.created.query"
                    [caption]="periodLabel()"
                  />
                </div>
              </section>

              <section aria-label="Open tasks by" class="grid" data-section="breakdowns">
                <mf-bar-list
                  heading="Open by Pod"
                  rowHeading="Pod"
                  [items]="pods()"
                  emptyText="No open tasks."
                />
                <mf-bar-list
                  heading="Open by Priority"
                  rowHeading="Priority"
                  [items]="priorities()"
                  emptyText="No open tasks."
                />
                <mf-bar-list
                  heading="Open by Task Type"
                  rowHeading="Task Type"
                  [items]="types()"
                  emptyText="No open tasks."
                />
                <mf-bar-list
                  heading="Open by Status"
                  rowHeading="Status"
                  [items]="statuses()"
                  emptyText="No open tasks."
                />
              </section>

              <section aria-label="Age and recent tasks" class="grid" data-section="activity">
                <mf-bar-list
                  heading="Age of open tasks"
                  rowHeading="Age"
                  [items]="aging()"
                  note="Days since the task was created. Informational, not a service-level target."
                />
                <mf-recent-task-list
                  heading="Recently created"
                  [tasks]="d.recentlyCreated"
                  emptyText="No tasks created yet."
                />
                <mf-recent-task-list
                  heading="Recently completed"
                  [tasks]="d.recentlyCompleted"
                  emptyText="No tasks completed yet."
                />
              </section>
            </ng-container>
          }
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s3);
      margin-bottom: var(--mf-s4);
    }
    h1 {
      margin: 0;
      font-size: var(--mf-fs-h1);
    }
    h2 {
      margin: 0 0 var(--mf-s3);
      font-size: var(--mf-fs-h3);
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s3);
    }
    .period {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    select,
    .refresh,
    .alert button {
      min-height: 32px;
      padding: 0 var(--mf-s3);
      font: inherit;
      color: var(--mf-text);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      cursor: pointer;
    }
    .refresh:disabled {
      color: var(--mf-text-disabled);
      cursor: default;
    }
    .updated {
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .block {
      margin-bottom: var(--mf-s5);
    }
    .block-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--mf-s3);
    }
    .block-head a {
      font-size: var(--mf-fs-sm);
      color: var(--mf-link);
    }
    .tiles,
    .skeletons {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
      gap: var(--mf-s3);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
      gap: var(--mf-s4);
      margin-bottom: var(--mf-s5);
    }
    .skeleton {
      height: 7rem;
      background: var(--mf-surface-alt);
      border-radius: var(--mf-radius-lg);
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
    .empty {
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(USER_TIME_ZONE);
  private requestId = 0;

  protected readonly periods = PERIODS;
  protected readonly skeletonTiles = [1, 2, 3, 4, 5, 6, 7, 8];
  protected readonly period = signal(DEFAULT_PERIOD);
  protected readonly state = signal<LoadState>('loading');
  protected readonly data = signal<DashboardSummary | null>(null);

  protected readonly periodLabel = computed(
    () => PERIODS.find((p) => p.days === this.period())?.label ?? `Last ${this.period()} days`,
  );
  protected readonly updated = computed(() => {
    const d = this.data();
    return d ? formatInstantTime(d.generatedAtUtc, this.zone) : null;
  });
  /** No tasks at all: nothing created yet and nothing open (the recent list is not limited to the period). */
  protected readonly isEmpty = computed(() => {
    const d = this.data();
    return !!d && d.recentlyCreated.length === 0 && d.open.count === 0;
  });
  protected readonly pods = computed(() => toBars(this.data()?.byPod ?? []));
  protected readonly priorities = computed(() => toBars(this.data()?.byPriority ?? []));
  protected readonly types = computed(() => toBars(this.data()?.byTaskType ?? []));
  protected readonly statuses = computed(() => toBars(this.data()?.byStatus ?? []));
  protected readonly aging = computed<BarItem[]>(() =>
    (this.data()?.aging ?? []).map((b) => ({ label: b.label, count: b.count, query: b.query })),
  );

  ngOnInit(): void {
    this.load();
  }

  protected setPeriod(value: string): void {
    const days = Number(value);
    if (!PERIODS.some((p) => p.days === days) || days === this.period()) return;
    this.period.set(days);
    this.load();
  }

  protected load(): void {
    const id = ++this.requestId;
    this.state.set('loading');
    this.api
      .getDashboard(this.period())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => {
          if (id !== this.requestId) return;
          this.data.set(summary);
          this.state.set('ready');
        },
        error: () => {
          if (id === this.requestId) this.state.set('error');
        },
      });
  }
}
