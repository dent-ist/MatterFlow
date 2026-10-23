import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MyMattersClient } from '../../../api/generated/api-client';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone } from '../../../core/time/time';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';
import { factText, groupByDay } from '../facts';
import { MmFilters, MmRange, commonArgs, deadlineArgs, queryToParams } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { PanelBox } from './panel-box';
import { PANEL_LIST_STYLES } from './panel-styles';

/** `yyyy-mm-dd` of today in the viewer's zone. */
export function todayText(clock: Clock, zone: string): string {
  const d = calendarDayInZone(clock.now(), zone);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/**
 * Upcoming deadlines (README 6.5): open tasks due from today to two or four weeks ahead, grouped by day, with the matter and the assignee,
 * capped at 25 with "View all" opening the Task Queue sorted by due date. Overdue work is not here (it is in Needs my attention). The
 * panel's 2 / 4 week toggle is the page's date range (one state, kept in the address).
 */
@Component({
  selector: 'mf-mm-deadlines',
  imports: [PanelBox, RouterLink, RowLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    PANEL_LIST_STYLES,
    `
      .dl__toggle {
        display: inline-flex;
      }
      .dl__toggle .mf-btn[aria-pressed='true'] {
        border-color: var(--mf-primary);
        background: var(--mf-selected-bg);
        font-weight: 700;
      }
      .dl__day {
        margin: var(--mf-s2) 0 var(--mf-s1);
        font-size: var(--mf-fs-md);
        font-weight: 700;
      }
      .dl__note {
        margin: var(--mf-s2) 0 0;
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      @media (max-width: 639.98px) {
        .dl__toggle .mf-btn {
          min-height: 44px;
        }
      }
    `,
  ],
  template: `
    <mf-mm-panel
      name="deadlines"
      title="Upcoming deadlines"
      [state]="loader.state()"
      [busy]="loader.busy()"
      (retry)="loader.load()"
    >
      <div mfPanelActions class="dl__toggle" role="group" aria-label="Look ahead">
        <button
          type="button"
          class="mf-btn"
          data-range="2w"
          [attr.aria-pressed]="filters().range === '2w'"
          (click)="rangeChange.emit('2w')"
        >
          2 wk
        </button>
        <button
          type="button"
          class="mf-btn"
          data-range="4w"
          [attr.aria-pressed]="filters().range === '4w'"
          (click)="rangeChange.emit('4w')"
        >
          4 wk
        </button>
      </div>
      @if (days().length === 0) {
        <p class="pl__empty" data-empty>No deadlines in this period.</p>
      } @else {
        @for (d of days(); track d.key) {
          <h3 class="dl__day" data-day>{{ d.heading }}</h3>
          <ul class="pl__list">
            @for (t of d.items; track t.taskId) {
              <li class="pl__row">
                <a
                  class="pl__link"
                  data-deadline-row
                  mfRowLink="my-matters-deadlines"
                  [rowKey]="t.taskId"
                  [routerLink]="['/tasks', t.taskId]"
                  [queryParams]="origin.params('my-matters')"
                  [state]="origin.state()"
                  >{{ t.taskNumber }} {{ t.title }}</a
                >
                <span class="pl__meta">{{ t.matterRef }} {{ t.matterName }}</span>
                <span class="pl__fact">{{ t.assigneeName ?? 'Unassigned' }}</span>
              </li>
            }
          </ul>
        }
        <a class="pl__all" data-view-all routerLink="/tasks" [queryParams]="params()">
          View all{{ total() > shown() ? ' ' + total() : '' }}
        </a>
        @if (total() > shown()) {
          <p class="dl__note" data-capped>Showing the first {{ shown() }} of {{ total() }}.</p>
        }
      }
    </mf-mm-panel>
  `,
})
export class DeadlinesPanel {
  readonly filters = input.required<MmFilters>();
  readonly rangeChange = output<MmRange>();
  protected readonly origin = inject(TaskOriginLinks);
  private readonly api = inject(MyMattersClient);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly loader = panelLoader(
    () => this.filters(),
    () => {
      const f = this.filters();
      const a = commonArgs(f);
      const d = deadlineArgs(f, todayText(this.clock, this.zone));
      return this.api.getMyMattersDeadlines(
        d.days,
        a.scope,
        a.role,
        a.clientId,
        d.from,
        d.to,
        a.managerId,
      );
    },
  );

  constructor() {
    restoreRowFocus('my-matters-deadlines', () => this.loader.state() === 'ready');
  }

  protected readonly days = computed(() => groupByDay(this.loader.data()?.items ?? [], this.zone));
  protected readonly total = computed(() => this.loader.data()?.total ?? 0);
  protected readonly shown = computed(() => this.loader.data()?.items.length ?? 0);
  protected readonly params = computed(() => queryToParams(this.loader.data()?.query ?? ''));
  protected readonly fact = factText;
}
