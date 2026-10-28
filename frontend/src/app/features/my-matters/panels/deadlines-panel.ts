import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MyMattersClient } from '../../../api/generated/api-client';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone } from '../../../core/time/time';
import { TaskTypeBadge } from '../../../shared/task-type/task-type-badge';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { ViewsMenu } from '../../../shared/ui/views-menu';
import { ViewState } from '../../../core/views/view-state';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';
import { groupByDay } from '../facts';
import { MmFilters, MmRange, commonArgs, deadlineArgs, queryToParams } from '../my-matters-filters';
import { OverviewStates } from '../overview-states';
import { panelLoader } from '../panel-loader';
import { sectionPref } from '../section-prefs';
import { SectionToolbar } from '../section-toolbar';
import { SectionTypes } from '../section-types';
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
  imports: [PanelBox, RouterLink, RowLink, SectionToolbar, TaskTypeBadge, ViewsMenu],
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
      [bare]="bare()"
      (retry)="loader.load()"
    >
      @if (!bare()) {
        <mf-views-menu
          mfPanelActions
          surface="my-matters.deadlines"
          [defaults]="false"
          [capture]="captureView"
          [apply]="pref.restore"
        />
      }
      @if (!bare()) {
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
      }
      @if (!bare()) {
        <mf-mm-section-toolbar
          label="Upcoming deadlines"
          [options]="typeChoices.options()"
          [types]="pref.value().types"
          [focused]="pref.focused()"
          [sort]="pref.value().sort"
          [dir]="pref.value().dir"
          (typesChange)="pref.setTypes($event)"
          (sortChange)="pref.setSort($event)"
          (dirChange)="pref.setDir($event)"
        />
      }
      @if (days().length === 0) {
        @if (filtered()) {
          <p class="pl__empty" data-empty data-filtered-empty>
            No deadlines of the selected types in this period.
            <button
              type="button"
              class="mf-btn mf-btn--text"
              data-show-all
              (click)="pref.showAll()"
            >
              Show all types
            </button>
          </p>
        } @else if (leftOut() > 0) {
          <p class="pl__empty" data-empty data-all-above>
            Everything due in this period is listed under Needs my attention.
          </p>
        } @else {
          <p class="pl__empty" data-empty>No deadlines in this period.</p>
        }
      } @else {
        @for (d of days(); track d.key) {
          @if (!flat()) {
            <h3 class="dl__day" data-day>{{ d.heading }}</h3>
          }
          <ul class="pl__list">
            @for (t of d.items; track t.taskId) {
              <li class="pl__row">
                <span class="pl__line">
                  <mf-task-type-badge
                    #tt
                    [iconKey]="t.taskTypeIconKey"
                    [colourKey]="t.taskTypeColourKey"
                    [name]="t.taskTypeName"
                  />
                  <a
                    class="pl__link"
                    data-deadline-row
                    mfRowLink="my-matters-deadlines"
                    [rowKey]="t.taskId"
                    [routerLink]="['/tasks', t.taskId]"
                    [queryParams]="origin.params('my-matters')"
                    [state]="origin.state()"
                    [attr.aria-describedby]="tt.descriptionId"
                    >{{ t.taskNumber }} {{ t.title }}</a
                  >
                </span>
                <span class="pl__meta pl__meta--flex"
                  ><span class="pl__matter" [attr.title]="t.matterRef + ' ' + t.matterName"
                    >{{ t.matterRef }} {{ t.matterName }}</span
                  >
                  <span class="pl__prio" data-priority>{{ t.priorityName }}</span>
                  @if (t.atRisk) {
                    <span class="pl__risk" data-at-risk
                      ><i class="pi pi-clock" aria-hidden="true"></i> At risk</span
                    >
                  }
                </span>
                <span class="pl__fact">{{ t.assigneeName ?? 'Unassigned' }}</span>
              </li>
            }
          </ul>
        }
        <a class="pl__all" data-view-all routerLink="/tasks" [queryParams]="params()">
          View all{{ total() > shown() ? ' ' + total() : '' }}
        </a>
        @if (total() > shown()) {
          <p class="dl__note" data-capped>
            Showing the first {{ shown() }} of {{ total()
            }}{{ unfiltered() !== null ? ' (' + unfiltered() + ' without the type filter)' : '' }}.
          </p>
        }
      }
    </mf-mm-panel>
  `,
})
export class DeadlinesPanel {
  readonly filters = input.required<MmFilters>();
  readonly rangeChange = output<MmRange>();
  /** Task ids already listed in Needs my attention: a task is listed once per screen, in its most urgent place (issue #905), so they are left out here. */
  readonly exclude = input<readonly number[]>([]);
  protected readonly origin = inject(TaskOriginLinks);
  private readonly api = inject(MyMattersClient);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly typeChoices = inject(SectionTypes);
  protected readonly pref = sectionPref('my-matters.deadlines', { sort: true });

  /** The state a saved view keeps (PV-29): the section's own filter and sort. */
  protected readonly captureView = (): ViewState => {
    const p = this.pref.value();
    return { types: p.types, sort: p.sort, dir: p.dir };
  };
  protected readonly filtered = computed(() => this.pref.value().types.length > 0);
  /** The day headings only make sense while the list runs in date order. */
  protected readonly flat = computed(() => {
    const sort = this.pref.value().sort;
    return sort !== '' && sort !== 'due';
  });

  protected readonly loader = panelLoader(
    () => [this.filters(), this.pref.value()],
    () => {
      const f = this.filters();
      const a = commonArgs(f);
      const p = this.pref.value();
      const d = deadlineArgs(f, todayText(this.clock, this.zone));
      return this.api.getMyMattersDeadlines(
        d.days,
        undefined,
        p.types.length > 0 ? p.types : undefined,
        p.sort || undefined,
        p.sort ? p.dir : undefined,
        a.scope,
        a.role,
        a.clientId,
        d.from,
        d.to,
        a.managerId,
      );
    },
  );

  private readonly states = inject(OverviewStates, { optional: true });
  /** Nothing is due in the widest window, no type filter hides anything: one muted line, no toolbar (issue #920). */
  protected readonly bare = computed(
    () =>
      this.loader.state() === 'ready' &&
      this.rows().length === 0 &&
      !this.filtered() &&
      this.filters().range === '4w',
  );

  constructor() {
    this.typeChoices.ensure();
    restoreRowFocus('my-matters-deadlines', () => this.loader.state() === 'ready');
    effect(() => this.states?.report('deadlines', this.bare() ? 'empty' : 'content'));
  }

  /** The rows the API returned, before the ones listed above are left out. */
  private readonly rows = computed(() => this.loader.data()?.items ?? []);
  /** How many of them are already listed in Needs my attention. */
  protected readonly leftOut = computed(() => {
    const skip = new Set(this.exclude());
    return this.rows().filter((t) => skip.has(t.taskId)).length;
  });

  protected readonly days = computed(() => {
    const skip = new Set(this.exclude());
    const items = this.rows().filter((t) => !skip.has(t.taskId));
    return this.flat()
      ? items.length > 0
        ? [{ key: 'flat', heading: '', items }]
        : []
      : groupByDay(items, this.zone);
  });
  protected readonly unfiltered = computed(() => this.loader.data()?.totalUnfiltered ?? null);
  protected readonly total = computed(() => this.loader.data()?.total ?? 0);
  protected readonly shown = computed(() => this.loader.data()?.items.length ?? 0);
  protected readonly params = computed(() => queryToParams(this.loader.data()?.query ?? ''));
}
