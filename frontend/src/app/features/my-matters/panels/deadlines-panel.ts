import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MyMattersClient } from '../../../api/generated/api-client';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone } from '../../../core/time/time';
import { TaskTypeBadge } from '../../../shared/task-type/task-type-badge';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';
import { groupByDay } from '../facts';
import { MmFilters, MmRange, commonArgs, deadlineArgs, queryToParams } from '../my-matters-filters';
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
  imports: [PanelBox, RouterLink, RowLink, SectionToolbar, TaskTypeBadge],
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
      <mf-mm-section-toolbar
        label="Upcoming deadlines"
        [options]="typeChoices.options()"
        [types]="pref.value().types"
        [sort]="pref.value().sort"
        [dir]="pref.value().dir"
        (typesChange)="pref.setTypes($event)"
        (sortChange)="pref.setSort($event)"
        (dirChange)="pref.setDir($event)"
      />
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
                <span class="pl__meta"
                  >{{ t.matterRef }} {{ t.matterName }}
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
  protected readonly origin = inject(TaskOriginLinks);
  private readonly api = inject(MyMattersClient);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly typeChoices = inject(SectionTypes);
  protected readonly pref = sectionPref('my-matters.deadlines', { sort: true });
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

  constructor() {
    this.typeChoices.ensure();
    restoreRowFocus('my-matters-deadlines', () => this.loader.state() === 'ready');
  }

  protected readonly days = computed(() => {
    const items = this.loader.data()?.items ?? [];
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
