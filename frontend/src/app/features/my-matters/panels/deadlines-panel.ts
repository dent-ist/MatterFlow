import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MyMattersClient, MyMattersTaskItem } from '../../../api/generated/api-client';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone } from '../../../core/time/time';
import { restoreRowFocus } from '../../../shared/ui/row-nav';
import { dayHeading, dueDay } from '../facts';
import { MyMattersFocus } from '../focus';
import { MmFilters, commonArgs } from '../my-matters-filters';
import { OverviewStates } from '../overview-states';
import { panelLoader } from '../panel-loader';
import { MmTaskRow } from '../task-row';
import { PanelBox } from './panel-box';
import { PANEL_LIST_STYLES } from './panel-styles';

/** `yyyy-mm-dd` of today in the viewer's zone. */
export function todayText(clock: Clock, zone: string): string {
  const d = calendarDayInZone(clock.now(), zone);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/** `yyyy-mm-dd` plus `days` calendar days (date arithmetic on the text, no zone involved). */
export function addDaysText(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** How many tasks the Overview preview shows. */
export const NEXT_DAYS_ROWS = 5;

/**
 * Next 7 days (epic #893 issues #896 and #894; README 5): a short preview of what falls due from today to seven days ahead, at most five rows, soonest first,
 * the due day as the first column and the assignee on the right. It never lists a task that Needs my attention already lists (a task is listed once per
 * screen, in its most urgent place), has no toolbar of its own (no range, sort, saved views or task-type filter: the Deadlines tab owns the range and the
 * person's Focus is the one type filter) and "All deadlines" opens the Deadlines tab. Nothing due, or everything due already listed above: one muted line.
 */
@Component({
  selector: 'mf-mm-deadlines',
  imports: [MmTaskRow, PanelBox, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    PANEL_LIST_STYLES,
    `
      .dl__all {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        color: var(--mf-link);
        font-weight: 600;
      }
      @media (max-width: 639.98px) {
        .dl__all {
          min-height: 44px;
        }
      }
    `,
  ],
  template: `
    <mf-mm-panel
      name="deadlines"
      title="Next 7 days"
      [flat]="true"
      [skeleton]="3"
      [state]="loader.state()"
      [busy]="loader.busy()"
      [bare]="bare()"
      (retry)="loader.load()"
    >
      @if (!bare()) {
        <a
          mfPanelActions
          class="dl__all"
          data-view-all
          routerLink="/my-matters"
          [queryParams]="{ tab: 'deadlines' }"
          >All deadlines{{ more() > 0 ? ' (' + (shown() + more()) + ')' : '' }}</a
        >
      }
      @if (rows().length === 0) {
        @if (focused()) {
          <p class="pl__empty" data-empty data-filtered-empty>
            Nothing in your Focus is due in the next 7 days.
            <button type="button" class="mf-btn mf-btn--text" data-show-all (click)="focus.clear()">
              Clear Focus
            </button>
          </p>
        } @else if (leftOut() > 0) {
          <p class="pl__empty" data-empty data-all-above>
            Everything due in the next 7 days is listed under Needs my attention.
          </p>
        } @else {
          <p class="pl__empty" data-empty>Nothing is due in the next 7 days.</p>
        }
      } @else {
        <ul class="pl__list" data-deadlines-list>
          @for (t of rows(); track t.taskId) {
            <li
              mfMmTaskRow
              kind="deadline"
              rowScope="my-matters-deadlines"
              [task]="t"
              [showMatter]="showMatter()"
              [lead]="dayOf(t)"
              [status]="t.assigneeName ?? 'no assignee'"
              [tone]="'plain'"
            ></li>
          }
        </ul>
      }
    </mf-mm-panel>
  `,
})
export class DeadlinesPanel {
  readonly filters = input.required<MmFilters>();
  /** Task ids already listed in Needs my attention: a task is listed once per screen, in its most urgent place (issue #905), so they are left out here. */
  readonly exclude = input<readonly number[]>([]);
  /** The matter's name is drawn on each row: the person has several matters. */
  readonly showMatter = input(false);
  private readonly api = inject(MyMattersClient);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly focus = inject(MyMattersFocus);
  protected readonly focused = computed(() => this.focus.types().length > 0);

  protected readonly loader = panelLoader(
    () => [this.filters(), this.focus.types()],
    () => {
      const a = commonArgs(this.filters());
      const types = this.focus.types();
      const today = todayText(this.clock, this.zone);
      return this.api.getMyMattersDeadlines(
        14,
        undefined,
        types.length > 0 ? types : undefined,
        undefined,
        undefined,
        a.scope,
        a.role,
        a.clientId,
        today,
        addDaysText(today, 7),
        a.managerId,
      );
    },
  );

  private readonly states = inject(OverviewStates, { optional: true });
  /** Nothing is due in the seven days and no Focus hides anything: one muted line, no link (issue #920). */
  protected readonly bare = computed(
    () => this.loader.state() === 'ready' && this.all().length === 0 && !this.focused(),
  );

  constructor() {
    this.focus.ensure();
    restoreRowFocus('my-matters-deadlines', () => this.loader.state() === 'ready');
    effect(() => this.states?.report('deadlines', this.bare() ? 'empty' : 'content'));
  }

  /** The rows the API returned, before the ones listed above are left out. */
  private readonly all = computed(() => this.loader.data()?.items ?? []);
  /** How many of them are already listed in Needs my attention. */
  protected readonly leftOut = computed(() => {
    const skip = new Set(this.exclude());
    return this.all().filter((t) => skip.has(t.taskId)).length;
  });
  /** The tasks that are due and not listed above, soonest first. */
  private readonly fresh = computed(() => {
    const skip = new Set(this.exclude());
    return this.all().filter((t) => !skip.has(t.taskId));
  });
  protected readonly rows = computed(() => this.fresh().slice(0, NEXT_DAYS_ROWS));
  protected readonly shown = computed(() => this.rows().length);
  /** Tasks due in the seven days that are neither shown here nor listed above. */
  protected readonly more = computed(() => this.fresh().length - this.rows().length);

  /** "Wed Oct 28": the first column of a row. */
  protected dayOf(t: MyMattersTaskItem): string {
    const day = dueDay(t, this.zone);
    return day ? dayHeading(day) : '';
  }
}
