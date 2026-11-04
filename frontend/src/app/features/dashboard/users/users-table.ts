import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  WorkloadPriority,
  WorkloadThresholds,
  WorkloadUser,
} from '../../../api/generated/api-client';
import { availabilityDisplay } from '../../../core/availability/availability';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { dueCellText, describeDueCell } from '../../../core/time/time';
import { priorityColors } from '../../../shared/ui/priority-badge';
import { backOnText, bandOf } from './users-card';
import {
  LOAD_ICONS,
  LOAD_LABELS,
  cardState,
  cardSummary,
  countsOf,
  loadLevelOf,
  segmentsOf,
  thresholdText,
  UserSort,
  toneOf,
} from './users-model';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';

/**
 * The compact table view of the Team workload: one row per person with the same facts as the card (state, highest priority, a count per
 * priority in rank order, open, overdue, due soon, on hold, next due, load). The name is the button that opens the person's tasks.
 * Workload is one element (the open-task count and a bar split by priority; the level word is in the tooltip and the accessible text). The Availability chip shows only when the person is not available, and zeros are a muted dash. A plain table, so the keyboard and screen reader model is the browser's own.
 */
@Component({
  selector: 'mf-users-table',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" tabindex="-1">
      <table class="tbl" data-users-table>
        <caption class="sr-only">
          Team workload, one row per person
        </caption>
        <thead>
          <tr>
            <th scope="col" class="person" [attr.aria-sort]="ariaSort('name')">
              <button type="button" class="sort" data-sort-key="name" (click)="sortBy('name')">
                Person<i class="pi" [class]="arrow('name')" aria-hidden="true"></i>
              </button>
            </th>
            <th scope="col" [attr.aria-sort]="ariaSort('open')">
              <button type="button" class="sort" data-sort-key="open" (click)="sortBy('open')">
                Workload<i class="pi" [class]="arrow('open')" aria-hidden="true"></i>
              </button>
            </th>
            <th scope="col" [attr.aria-sort]="ariaSort('priority')">
              <button
                type="button"
                class="sort"
                data-sort-key="priority"
                (click)="sortBy('priority')"
              >
                Highest priority<i class="pi" [class]="arrow('priority')" aria-hidden="true"></i>
              </button>
            </th>
            <th scope="col" [attr.aria-sort]="ariaSort('load')">
              <button
                type="button"
                class="sort"
                data-sort-key="availability"
                (click)="sortBy('load')"
              >
                Availability<i class="pi" [class]="arrow('load')" aria-hidden="true"></i>
              </button>
            </th>
            <th scope="col" class="num">Overdue</th>
            <th scope="col">Next due</th>
            @if (canAssign()) {
              <th scope="col" class="act"><span class="sr-only">Assign work</span></th>
            }
          </tr>
        </thead>
        <tbody>
          @for (u of users(); track u.userId) {
            <tr
              [attr.data-user-row]="u.userId"
              [attr.data-user]="u.displayName"
              [attr.data-state]="stateOf(u)"
              [attr.data-tone]="toneOf(u)"
              [class.ooo]="stateOf(u) === 'ooo'"
            >
              <th scope="row" class="person">
                <span class="pwrap">
                  <span class="avatar" aria-hidden="true">{{ u.initials }}</span>
                  <button
                    type="button"
                    class="link"
                    data-user-open
                    [id]="'wl-open-' + u.userId"
                    [attr.aria-label]="u.displayName + '. ' + summaryOf(u) + '. Open tasks'"
                    (click)="open.emit(u)"
                  >
                    {{ u.displayName }}
                  </button>
                </span>
              </th>
              <td class="loadcell">
                <span class="load" [attr.data-load-label]="levelOf(u)" data-priority-counts>
                  <strong class="cnt">{{ u.openTotal }}</strong>
                  <span class="track" aria-hidden="true" [attr.title]="countsTitle(u)">
                    @for (s of segmentsOf(u); track s.priorityId) {
                      <span
                        class="seg"
                        [style.width.%]="s.percent"
                        [style.background]="colors(s.color).bg"
                        [style.box-shadow]="'inset 0 0 0 1px ' + colors(s.color).fg"
                      ></span>
                    }
                  </span>
                  <span class="sr-only"
                    >{{ labels[levelOf(u)] }} load, {{ u.openTotal }} open tasks:
                    {{ countsText(u) }}</span
                  >
                </span>
              </td>
              <td>
                @if (u.openTotal > 0) {
                  @let b = bandOf(u);
                  <span
                    class="state"
                    [style.background]="b.bg"
                    [style.color]="b.fg"
                    [attr.title]="b.label"
                    [attr.aria-label]="stateOf(u) === 'busy' ? null : b.label"
                    [attr.role]="stateOf(u) === 'busy' ? null : 'img'"
                  >
                    <i class="pi" [class]="b.icon" aria-hidden="true"></i>
                    @if (stateOf(u) === 'busy') {
                      {{ u.topPriority?.label ?? '' }}
                    }
                  </span>
                }
              </td>
              <td>
                <!-- Quiet rows: only a person who is NOT available has a chip (Out of office, Off hours, Holiday). -->
                @if (u.availability.state !== 'AVAILABLE') {
                  @let a = availOf(u);
                  <span class="chip" [class]="'chip chip--' + a.tone">
                    <i class="pi" [class]="a.icon" aria-hidden="true"></i>{{ a.label }}
                  </span>
                  @if (u.availability.note) {
                    <span class="note" [attr.title]="u.availability.note">{{
                      u.availability.note
                    }}</span>
                  }
                }
              </td>
              <td class="num" [class.warn]="u.overdue > 0" [class.zero]="u.overdue === 0">
                {{ u.overdue > 0 ? u.overdue : '-' }}
                @if (u.overdue === 0) {
                  <span class="sr-only">0</span>
                }
              </td>
              <td>
                @if (u.nextDue; as n) {
                  <span
                    class="nd"
                    [class.nd--late]="n.isOverdue"
                    [attr.title]="n.ref + ' ' + nextDue(u)"
                  >
                    <a
                      class="mf-ref"
                      [routerLink]="['/tasks', n.taskId]"
                      [queryParams]="origin.params('dashboard')"
                      [state]="origin.state()"
                      >{{ n.ref }}</a
                    >
                    {{ nextDue(u) }}
                  </span>
                } @else {
                  <span class="zero">-</span>
                }
              </td>
              @if (canAssign()) {
                <td class="act">
                  <button
                    type="button"
                    class="mf-btn mf-btn--icon quiet"
                    data-assign-work
                    [attr.aria-label]="'Assign work to ' + u.displayName"
                    [attr.title]="
                      'Assign work to ' + u.displayName + ': choose an unassigned task for them'
                    "
                    (click)="assign.emit(u)"
                  >
                    <i class="pi pi-user-plus" aria-hidden="true"></i>
                  </button>
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    /* No horizontal scroll from 900 px up (the columns fit); below that the wrapper scrolls and the Person column stays. */
    .wrap {
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    @media (max-width: 899px) {
      .wrap {
        overflow-x: auto;
      }
      .tbl {
        min-width: 56rem;
      }
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .tbl {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--mf-fs-sm);
    }
    th,
    td {
      padding: var(--mf-s1) var(--mf-s2);
      height: 48px;
      text-align: left;
      vertical-align: middle;
      border-bottom: 1px solid var(--mf-border);
    }
    thead th {
      color: var(--mf-text-muted);
      background: var(--mf-surface-alt);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      /* The header row stays under the sticky tab row while the page scrolls. */
      position: sticky;
      top: var(--mf-dash-sticky-top, 0px);
      z-index: 2;
    }
    .sort {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 24px;
      padding: 0 2px;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      font-weight: 600;
      text-align: inherit;
      cursor: pointer;
    }
    .sort:hover {
      color: var(--mf-text);
    }
    .sort .pi {
      font-size: 0.75rem;
    }
    th[aria-sort='ascending'] .sort,
    th[aria-sort='descending'] .sort {
      color: var(--mf-text);
    }
    tbody tr:last-child > * {
      border-bottom: 0;
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .strong {
      font-weight: 700;
    }
    .zero {
      color: var(--mf-text-muted);
    }
    .warn {
      color: var(--mf-danger);
      font-weight: 700;
    }
    tr.ooo {
      background: var(--mf-warning-bg);
    }
    .person {
      font-weight: 600;
      white-space: nowrap;
      position: sticky;
      left: 0;
      z-index: 1;
      background: var(--mf-surface);
      max-width: 14rem;
    }
    thead th.person {
      z-index: 3;
      background: var(--mf-surface-alt);
    }
    tr.ooo .person {
      background: var(--mf-surface-alt);
    }
    /* A shadow on the sticky column appears only where the table scrolls sideways. */
    @media (max-width: 899px) {
      .person {
        box-shadow: var(--mf-shadow-edge);
      }
    }
    .stack {
      white-space: nowrap;
    }
    /* Next due is whole at normal widths (reference and date on one line) and red when it is overdue. */
    .nd {
      display: inline-block;
      white-space: nowrap;
      vertical-align: middle;
    }
    .nd--late {
      color: var(--mf-danger);
      font-weight: 600;
    }
    .act {
      width: 1%;
      text-align: right;
      white-space: nowrap;
    }
    /* A quiet icon button: no border until the row is hovered or the button has focus. */
    .quiet {
      border-color: transparent;
      background: transparent;
      color: var(--mf-text-muted);
    }
    tr:hover .quiet,
    .quiet:hover,
    .quiet:focus-visible {
      border-color: var(--mf-border-strong);
      background: var(--mf-surface);
      color: var(--mf-text);
    }
    .quiet:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    .pwrap {
      display: inline-flex;
      max-width: 100%;
      align-items: center;
      gap: var(--mf-s2);
    }
    .avatar {
      display: inline-grid;
      place-items: center;
      width: 1.75rem;
      height: 1.75rem;
      color: var(--mf-primary);
      background: var(--mf-selected-bg);
      border: 1px solid var(--mf-primary);
      border-radius: 50%;
      font-size: var(--mf-fs-xs);
      font-weight: 700;
    }
    .link {
      max-width: 8rem;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
    }
    .chip,
    .state {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 0 var(--mf-s2);
      border: 1px solid currentColor;
      border-radius: 999px;
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      white-space: nowrap;
    }
    .state {
      border-radius: var(--mf-radius);
    }
    .chip--success {
      color: var(--mf-success);
      background: var(--mf-success-bg);
    }
    .chip--warning {
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
    }
    .chip--neutral {
      color: var(--mf-text-muted);
      background: var(--mf-surface-alt);
      border-style: dashed;
    }
    .note {
      display: block;
      max-width: 8rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--mf-text-muted);
      font-style: italic;
    }
    .load {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      font-weight: 600;
      white-space: nowrap;
    }
    .cnt {
      min-width: 1.5rem;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .load[data-load-label='HEAVY'] .cnt {
      color: var(--mf-danger);
    }
    .load[data-load-label='HEAVY'] {
      color: var(--mf-danger);
    }
    .track {
      display: inline-flex;
      width: 5rem;
      height: 0.75rem;
      overflow: hidden;
      background: var(--mf-surface-alt);
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
    }
    .seg {
      flex: none;
      min-width: 2px;
      height: 100%;
    }
  `,
})
export class UsersTable {
  /** Task links carry `?from=dashboard` and this view's address, so the Task page can bring the person back (T9, #324). */
  protected readonly origin = inject(TaskOriginLinks);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly clock = inject(Clock);

  readonly users = input.required<readonly WorkloadUser[]>();
  readonly legend = input<readonly WorkloadPriority[]>([]);
  readonly thresholds = input<WorkloadThresholds | null>(null);
  readonly canAssign = input(false);
  /** The sort the toolbar select (and the header) hold, and whether the header reversed its order. */
  readonly sort = input<UserSort>('load');
  readonly reversed = input(false);

  readonly open = output<WorkloadUser>();
  readonly assign = output<WorkloadUser>();
  /** A header was clicked: the same column reverses, another column sorts by it. */
  readonly sortRequest = output<{ sort: UserSort; reversed: boolean }>();

  protected readonly icons = LOAD_ICONS;
  protected readonly labels = LOAD_LABELS;
  protected readonly toneOf = toneOf;
  protected readonly bandOf = bandOf;
  protected readonly stateOf = cardState;
  protected readonly levelOf = loadLevelOf;
  protected readonly legendTexts = computed(() => thresholdText(this.thresholds()));

  /** The natural direction of each sort: names A to Z, most open tasks first, most urgent first, then the availability-and-load order. */
  private static readonly NATURAL: Record<UserSort, 'ascending' | 'descending'> = {
    name: 'ascending',
    open: 'descending',
    fewest: 'ascending',
    priority: 'descending',
    load: 'ascending',
  };

  protected ariaSort(key: UserSort): 'ascending' | 'descending' | 'none' {
    if (this.sort() !== key) return 'none';
    const natural = UsersTable.NATURAL[key];
    if (!this.reversed()) return natural;
    return natural === 'ascending' ? 'descending' : 'ascending';
  }

  protected arrow(key: UserSort): string {
    const d = this.ariaSort(key);
    return d === 'none'
      ? 'pi-sort-alt'
      : d === 'ascending'
        ? 'pi-sort-amount-up-alt'
        : 'pi-sort-amount-down';
  }

  protected sortBy(key: UserSort): void {
    this.sortRequest.emit({ sort: key, reversed: this.sort() === key ? !this.reversed() : false });
  }

  /** "2 Critical, 5 High, 3 Normal, 0 Low": the accessible text of the stacked count cell. */
  protected countsText(u: WorkloadUser): string {
    return this.countsOf(u)
      .map((c) => `${c.count} ${c.priority.label}`)
      .join(', ');
  }

  /** The tooltip of the load bar: "Critical 2, High 5, Normal 3" (priorities with open tasks only). */
  protected countsTitle(u: WorkloadUser): string {
    const parts = this.countsOf(u)
      .filter((c) => c.count > 0)
      .map((c) => `${c.count} ${c.priority.label}`);
    return `${this.labels[this.levelOf(u)]}: ${u.openTotal} open (${parts.length > 0 ? parts.join(', ') : 'none'})`;
  }

  protected availOf(u: WorkloadUser) {
    return availabilityDisplay(u.availability, this.zone, this.clock.now());
  }
  protected summaryOf(u: WorkloadUser): string {
    return cardSummary(
      u,
      backOnText(u.availability.outUntil, this.zone, this.clock.now()) ?? this.availOf(u).label,
    );
  }
  protected countsOf(u: WorkloadUser) {
    return countsOf(u, this.legend());
  }
  protected segmentsOf(u: WorkloadUser) {
    return segmentsOf(u, this.legend(), this.thresholds());
  }
  protected colors(tone: string) {
    return priorityColors(tone);
  }
  protected nextDue(u: WorkloadUser): string {
    if (!u.nextDue) return '';
    return dueCellText(describeDueCell(u.nextDue, this.clock.now(), this.zone));
  }
}
