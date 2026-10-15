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
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { DateInput } from 'form-engine';
import {
  CoverageBoard,
  CoverageUser,
  DashboardBoardClient,
} from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { QuietRequests } from '../../../core/http/interceptors';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { mfDate } from '../../../core/time/time';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { SearchBox } from '../../../shared/ui/search-box';
import { CoverageDrawer, CoverageTarget } from './coverage-drawer';
import {
  CoveragePeriod,
  DEFAULT_PERIOD,
  Matrix,
  MatrixCell,
  PERIODS,
  PeriodKey,
  RELATIVE_LABELS,
  STEP_COLORS,
  STEP_LABELS,
  Scale,
  Step,
  TypeOrder,
  UserOrder,
  buildMatrix,
  cellLabel,
  isOrder,
  isPeriodKey,
  isScale,
  periodArgs,
  periodFromParams,
  periodPhrase,
  periodToParams,
  plural,
  thinText,
} from './coverage-model';
import { CoveragePrefs } from './coverage-prefs';
import { UsersFilters } from './users-model';
import { PodOption } from './users-toolbar';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

/** The longest period the API accepts, in days. */
const MAX_DAYS = 366;

const dayNumber = (iso: string) => Date.parse(iso + 'T00:00:00Z') / 86_400_000;

/**
 * The Coverage view of the Users tab: a heat map of how many tasks each person completed per task type in a period, for planning training
 * and cross-coverage. It is a real table (task types in the rows with their icon, people in the columns, totals at the end, "People who
 * handled it" per type). The number is written in every cell and a zero is hatched, so colour is never the only cue; the five steps keep
 * 4.5:1 for their numbers. Scale is relative to the task type (default) or absolute. The person is the assignee of the completed task.
 * Keyboard: the matrix is one tab stop; arrow keys, Home and End move between cells, Enter or Space opens the cell's tasks.
 * Not a ranking: ordering by total is labelled neutrally, there is no score, and the heading says what the view is for.
 */
@Component({
  selector: 'mf-coverage-view',
  imports: [DateInput, SearchBox, TaskTypeIcon, ErrorReference, CoverageDrawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3 class="head" id="cv-h" data-coverage-heading>
      Task type coverage - use this to plan training and cross-coverage, not to rank people
    </h3>
    <p class="frame" data-coverage-frame>
      <i class="pi pi-info-circle" aria-hidden="true"></i>
      <span>
        Each cell is the number of tasks of that type the person completed {{ phrase() }}. A task
        counts for the person it was assigned to when it was completed. Cancelled tasks are not
        counted.
      </span>
    </p>

    <div class="bar" role="toolbar" aria-label="Coverage controls">
      <div class="fld">
        <label class="lbl" for="cv-period">Period</label>
        <select
          id="cv-period"
          class="mf-control mf-control--compact"
          data-coverage-period
          [value]="period().period"
          (change)="onPeriod($any($event.target).value)"
        >
          @for (p of periods; track p.key) {
            <option [value]="p.key" [selected]="p.key === period().period">{{ p.label }}</option>
          }
          <option value="custom" [selected]="period().period === 'custom'">Custom range</option>
        </select>
      </div>
      @if (period().period === 'custom') {
        <div class="fld">
          <label class="lbl" for="cv-from">From</label>
          <mf-date-input
            inputId="cv-from"
            label="from"
            [commitOnly]="true"
            [isoValue]="period().from"
            (isoChange)="setCustom({ from: $event })"
          />
        </div>
        <div class="fld">
          <label class="lbl" for="cv-to">To</label>
          <mf-date-input
            inputId="cv-to"
            label="to"
            [commitOnly]="true"
            [isoValue]="period().to"
            (isoChange)="setCustom({ to: $event })"
          />
        </div>
      }
      @if (pods().length > 0 || filters().pod !== null) {
        <div class="fld">
          <label class="lbl" for="cv-pod">Pod</label>
          <select
            id="cv-pod"
            class="mf-control mf-control--compact"
            data-coverage-pod
            (change)="filtersChange.emit({ pod: num($any($event.target).value) })"
          >
            <option value="">All pods</option>
            @for (p of pods(); track p.id) {
              <option [value]="p.id" [selected]="filters().pod === p.id">{{ p.label }}</option>
            }
          </select>
        </div>
      }
      <mf-search-box
        class="search"
        role="search"
        inputId="cv-q"
        label="Search people by name"
        placeholder="Search people by name"
        [hideLabel]="true"
        [hintOnFocus]="true"
        [value]="filters().q"
        (searchChange)="filtersChange.emit({ q: $event })"
      />
      <div class="fld">
        <label class="lbl" for="cv-scale">Colour scale</label>
        <select
          id="cv-scale"
          class="mf-control mf-control--compact"
          data-coverage-scale
          [value]="scale()"
          (change)="onScale($any($event.target).value)"
        >
          <option value="relative" [selected]="scale() === 'relative'">
            Relative to the task type
          </option>
          <option value="absolute" [selected]="scale() === 'absolute'">Absolute</option>
        </select>
      </div>
      <div class="fld">
        <label class="lbl" for="cv-rows">Task types</label>
        <select
          id="cv-rows"
          class="mf-control mf-control--compact"
          data-coverage-type-order
          [value]="typeOrder()"
          (change)="onTypeOrder($any($event.target).value)"
        >
          <option value="name" [selected]="typeOrder() === 'name'">By name</option>
          <option value="total" [selected]="typeOrder() === 'total'">By total completed</option>
        </select>
      </div>
      <div class="fld">
        <label class="lbl" for="cv-cols">People</label>
        <select
          id="cv-cols"
          class="mf-control mf-control--compact"
          data-coverage-user-order
          [value]="userOrder()"
          (change)="onUserOrder($any($event.target).value)"
        >
          <option value="name" [selected]="userOrder() === 'name'">By name</option>
          <option value="total" [selected]="userOrder() === 'total'">By total completed</option>
        </select>
      </div>
      <button
        type="button"
        class="mf-btn toggle"
        data-coverage-gaps
        [attr.aria-pressed]="gapsOnly()"
        (click)="gapsOnly.set(!gapsOnly())"
      >
        <i class="pi pi-filter" aria-hidden="true"></i>Training gaps
      </button>
      <span class="grow"></span>
    </div>

    @if (rangeProblem(); as problem) {
      <p class="alert" role="alert" data-coverage-range>{{ problem }}</p>
    }

    <p class="sr-only" role="status" aria-live="polite" data-coverage-live>{{ live() }}</p>

    @if (refreshFailed()) {
      <div class="stale" role="status" data-coverage-stale>
        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
        <span>
          The coverage could not be refreshed. Showing the figures from {{ updated() }}.
          <mf-error-reference />
        </span>
        <button type="button" class="mf-btn" data-coverage-stale-retry (click)="refresh()">
          Retry
        </button>
      </div>
    }

    @switch (state()) {
      @case ('error') {
        <div class="alert" role="alert" data-coverage-error>
          <span>The task type coverage could not be loaded.</span>
          <mf-error-reference />
          <button type="button" class="mf-btn" data-coverage-retry (click)="load()">Retry</button>
        </div>
      }
      @case ('forbidden') {
        <p class="empty" role="status" data-coverage-forbidden>
          <i class="pi pi-lock" aria-hidden="true"></i>
          <span>You do not have access to the task type coverage. Ask a Director.</span>
        </p>
      }
      @case ('loading') {
        <div
          class="bones"
          role="status"
          aria-busy="true"
          aria-label="Loading the coverage"
          data-coverage-loading
        >
          @for (n of bones; track n) {
            <span class="bone" aria-hidden="true"></span>
          }
        </div>
      }
      @default {
        @if (matrix(); as m) {
          <ul class="strip" aria-label="Coverage summary" data-coverage-summary>
            <li class="chip" data-summary="people">
              <strong>{{ m.cols.length }}</strong> {{ m.cols.length === 1 ? 'person' : 'people' }}
            </li>
            <li class="chip" data-summary="types">
              <strong>{{ m.rows.length }}</strong> task
              {{ m.rows.length === 1 ? 'type' : 'types' }} shown
            </li>
            <li class="chip" data-summary="completed">
              <strong>{{ m.grand }}</strong> completed
            </li>
            <li class="chip" [class.chip--warn]="m.thinTypes > 0" data-summary="thin">
              <i
                class="pi"
                [class]="m.thinTypes > 0 ? 'pi-exclamation-triangle' : 'pi-check-circle'"
                aria-hidden="true"
              ></i>
              {{ thin(m.thinTypes) }}
            </li>
            <li class="chip" data-summary="gaps">
              <strong>{{ m.gapCount }}</strong> training {{ m.gapCount === 1 ? 'gap' : 'gaps' }}
              <span class="sub">(0 for someone active)</span>
            </li>
          </ul>

          <ul class="legend" aria-label="Colour legend" data-coverage-legend>
            <li class="lg lg--zero">
              <span class="sw sw--zero" aria-hidden="true">0</span>None (0)
            </li>
            @for (s of steps; track s) {
              <li class="lg">
                <span
                  class="sw"
                  aria-hidden="true"
                  [style.background]="colors[s].bg"
                  [style.color]="colors[s].fg"
                  >{{ s }}</span
                >
                {{ scale() === 'absolute' ? stepLabels[s] : relativeLabels[s] }}
              </li>
            }
            <li class="lg lg--gap">
              <span class="sw sw--gap" aria-hidden="true">0</span>Training gap (0 for someone who
              completed other types)
            </li>
          </ul>

          @if (m.rows.length === 0 || m.cols.length === 0) {
            <div class="empty" data-coverage-empty>
              <i class="pi pi-table" aria-hidden="true"></i>
              @if (gapsOnly()) {
                <span
                  >No training gaps {{ phrase() }}. Everyone active completed every task type
                  shown.</span
                >
              } @else if (filtered()) {
                <span>No people match these filters.</span>
              } @else {
                <span>There is nothing to show for this period.</span>
              }
            </div>
          } @else {
            <div class="region" role="region" aria-labelledby="cv-h" data-coverage-region>
              <table class="tbl" data-coverage-table>
                <caption class="sr-only">
                  Tasks completed per task type (rows) and person (columns)
                  {{
                    phrase()
                  }}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" class="corner">Task type</th>
                    @for (u of m.cols; track u.userId) {
                      <th scope="col" class="person" [attr.data-person]="u.userId">
                        <span class="avatar" aria-hidden="true">{{ u.initials }}</span>
                        <span class="pname">{{ u.displayName }}</span>
                        @if (!u.isActive) {
                          <span class="tag" data-inactive>Inactive</span>
                        }
                        @if (u.availability.state === 'OUT_OF_OFFICE') {
                          <span class="tag tag--ooo" data-ooo-marker>
                            <i class="pi pi-calendar-minus" aria-hidden="true"></i>Out of office
                          </span>
                        }
                      </th>
                    }
                    <th scope="col" class="num">Total</th>
                    <th scope="col" class="num">People who handled it</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of m.rows; track r.type.taskTypeId; let ri = $index) {
                    <tr [attr.data-type]="r.type.taskTypeId" [attr.data-type-name]="r.type.name">
                      <th scope="row" class="ttype">
                        <span class="twrap">
                          <mf-task-type-icon [iconKey]="r.type.iconKey" size="sm" />
                          <span>{{ r.type.name }}</span>
                          @if (!r.type.isActive) {
                            <span class="tag">Retired</span>
                          }
                        </span>
                      </th>
                      @for (c of r.cells; track c.userId; let ci = $index) {
                        <td
                          class="cell"
                          [class.cell--zero]="c.count === 0"
                          [class.cell--gap]="c.gap"
                          [attr.data-step]="c.step"
                          [attr.data-count]="c.count"
                          [attr.data-gap]="c.gap ? 'true' : null"
                          [style.background]="c.step > 0 ? colors[nz(c.step)].bg : null"
                          [style.color]="c.step > 0 ? colors[nz(c.step)].fg : null"
                        >
                          <button
                            type="button"
                            class="hit"
                            [attr.data-cell]="c.userId + ':' + c.taskTypeId"
                            [attr.data-r]="ri"
                            [attr.data-c]="ci"
                            [attr.tabindex]="ri === activeR() && ci === activeC() ? 0 : -1"
                            [attr.aria-label]="label(m, ri, ci)"
                            [attr.title]="label(m, ri, ci)"
                            (click)="openCell(m, ri, ci)"
                            (focus)="setActive(ri, ci)"
                            (keydown)="onKey($event, m, ri, ci)"
                          >
                            <span class="n">{{ c.count }}</span>
                            @if (c.gap) {
                              <i class="pi pi-exclamation-circle mark" aria-hidden="true"></i>
                            }
                          </button>
                        </td>
                      }
                      <td class="num total" data-row-total>{{ r.total }}</td>
                      <td class="num" [class.thin]="r.thin" data-people>
                        @if (r.thin) {
                          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                        }
                        {{ r.people === 0 ? 'No one' : plural(r.people, 'person', 'people') }}
                      </td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" class="ttype">Total</th>
                    @for (t of m.colTotals; track $index) {
                      <td class="num total" data-col-total>{{ t }}</td>
                    }
                    <td class="num total" data-grand-total>{{ m.grand }}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          }
        }
      }
    }

    <mf-coverage-drawer [target]="target()" (closed)="closeCell()" />
  `,
  styles: `
    :host {
      display: block;
    }
    .head {
      margin: 0 0 var(--mf-s1);
      font-size: var(--mf-fs-lg, 1.125rem);
    }
    .frame {
      display: flex;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--mf-s2) var(--mf-s3);
      margin-bottom: var(--mf-s3);
    }
    .fld {
      display: grid;
      gap: 2px;
    }
    .lbl {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
    }
    .grow {
      flex: 1;
    }
    .search {
      min-width: 14rem;
      flex: 0 1 16rem;
    }
    .toggle[aria-pressed='true'] {
      background: var(--mf-selected-bg);
      border-color: var(--mf-primary);
      color: var(--mf-primary);
      font-weight: 600;
    }
    /* The search input is as tall as the other (compact) controls on the line. */
    .search ::ng-deep .sb__input {
      min-height: var(--mf-row-h-compact);
      height: var(--mf-row-h-compact);
      padding-block: 0;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .strip,
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s2);
      padding: 0;
      list-style: none;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 2px var(--mf-s3);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: 999px;
      font-size: var(--mf-fs-sm);
    }
    .chip--warn {
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
      border-color: var(--mf-warning);
      font-weight: 600;
    }
    .sub {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .lg {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      font-size: var(--mf-fs-xs);
    }
    .sw {
      display: inline-grid;
      place-items: center;
      width: 1.5rem;
      height: 1.5rem;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      font-weight: 700;
    }
    .sw--zero,
    .cell--zero {
      color: var(--mf-text);
      background: repeating-linear-gradient(
        135deg,
        var(--mf-surface) 0 5px,
        var(--mf-border) 5px 7px
      );
    }
    .sw--zero {
      border-style: dashed;
    }
    /* A dashed inner edge marks a zero without changing the table's own borders. */
    .cell--zero {
      outline: 1px dashed var(--mf-border-strong);
      outline-offset: -3px;
    }
    .sw--gap {
      color: var(--mf-text);
      background: repeating-linear-gradient(
        135deg,
        var(--mf-warning-bg) 0 5px,
        var(--mf-border) 5px 7px
      );
      border: 2px solid var(--mf-warning);
    }
    .region {
      max-height: calc(100vh - 20rem);
      min-height: 14rem;
      overflow: auto;
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    .tbl {
      border-collapse: separate;
      border-spacing: 0;
      font-size: var(--mf-fs-sm);
    }
    th,
    td {
      padding: 0;
      border-right: 1px solid var(--mf-border);
      border-bottom: 1px solid var(--mf-border);
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      padding: var(--mf-s2);
      color: var(--mf-text);
      background: var(--mf-surface-alt);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      vertical-align: bottom;
    }
    .corner {
      left: 0;
      z-index: 3;
      min-width: 14rem;
      text-align: left;
    }
    .ttype {
      position: sticky;
      left: 0;
      z-index: 1;
      min-width: 14rem;
      max-width: 18rem;
      padding: var(--mf-s2) var(--mf-s3);
      background: var(--mf-surface);
      text-align: left;
      font-weight: 600;
    }
    tfoot .ttype {
      background: var(--mf-surface-alt);
    }
    .twrap {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .person {
      min-width: 5.5rem;
      max-width: 7rem;
      text-align: center;
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
    .pname {
      display: block;
      overflow-wrap: anywhere;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 0 var(--mf-s1);
      color: var(--mf-text-muted);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-xs);
      font-weight: 400;
    }
    .tag--ooo {
      color: var(--mf-warning);
    }
    .cell {
      min-width: 5.5rem;
      height: 2.75rem;
      text-align: center;
    }
    .cell--gap {
      background: repeating-linear-gradient(
        135deg,
        var(--mf-warning-bg) 0 5px,
        var(--mf-border) 5px 7px
      );
      box-shadow: inset 0 0 0 2px var(--mf-warning);
    }
    .hit {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      width: 100%;
      height: 100%;
      min-height: 2.75rem;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
    }
    .cell--zero .n,
    .cell--gap .n {
      padding: 0 6px;
      color: var(--mf-text);
      background: var(--mf-surface);
      border-radius: var(--mf-radius);
    }
    .mark {
      color: var(--mf-warning);
      background: var(--mf-surface);
      border-radius: 50%;
    }
    .hit:focus-visible {
      outline: 3px solid var(--mf-focus);
      outline-offset: -3px;
    }
    .num {
      padding: var(--mf-s2) var(--mf-s3);
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .total {
      font-weight: 700;
      background: var(--mf-surface-alt);
    }
    .thin {
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
      font-weight: 600;
    }
    tfoot td,
    tfoot th {
      border-bottom: 0;
    }
    .empty {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s3);
      margin: 0;
      padding: var(--mf-s4);
      color: var(--mf-text-muted);
      background: var(--mf-surface);
      border: 1px dashed var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
    }
    .bones {
      display: grid;
      gap: var(--mf-s2);
    }
    .bone {
      display: block;
      height: 2.75rem;
      background: var(--mf-surface-alt);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.55;
      }
    }
    .stale {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s3);
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
    .alert {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s3);
      margin: 0 0 var(--mf-s3);
      padding: var(--mf-s3) var(--mf-s4);
      color: var(--mf-danger);
      background: var(--mf-danger-bg);
      border: 1px solid var(--mf-danger);
      border-radius: var(--mf-radius);
    }
    @media (max-width: 560px) {
      .search {
        flex-basis: 100%;
      }
      .fld {
        flex: 1 1 8rem;
      }
      .fld select {
        width: 100%;
      }
      .corner,
      .ttype {
        min-width: 9rem;
        max-width: 10rem;
      }
    }
  `,
})
export class CoverageView implements OnInit {
  private readonly api = inject(DashboardBoardClient);
  private readonly prefs = inject(CoveragePrefs);
  private readonly quiet = inject(QuietRequests);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private requestId = 0;

  /** The pod and name filters shared with the Workload view (they live in the address). */
  readonly filters = input.required<UsersFilters>();
  readonly pods = input<PodOption[]>([]);
  readonly filtersChange = output<Partial<UsersFilters>>();
  /** Read once the board arrives: the tab learns the pods seen. */
  readonly podsSeen = output<Map<number, string>>();

  protected readonly periods = PERIODS;
  protected readonly steps: Exclude<Step, 0>[] = [1, 2, 3, 4];
  protected readonly colors = STEP_COLORS;
  protected readonly stepLabels = STEP_LABELS;
  protected readonly relativeLabels = RELATIVE_LABELS;
  protected readonly bones = [1, 2, 3, 4, 5];
  protected readonly plural = plural;

  protected readonly period = signal<CoveragePeriod>(DEFAULT_PERIOD);
  protected readonly scale = this.prefs.scale;
  protected readonly typeOrder = this.prefs.typeOrder;
  protected readonly userOrder = this.prefs.userOrder;
  protected readonly gapsOnly = signal(false);
  protected readonly state = signal<LoadState>('loading');
  protected readonly board = signal<CoverageBoard | null>(null);
  /** True while a refresh is running (the Dashboard's tab row shows it on its refresh icon). */
  readonly refreshing = signal(false);
  protected readonly refreshFailed = signal(false);
  protected readonly live = signal('');
  protected readonly activeR = signal(0);
  protected readonly activeC = signal(0);
  protected readonly target = signal<CoverageTarget | null>(null);

  protected readonly phrase = computed(() => periodPhrase(this.period(), this.board()));
  protected readonly updated = computed(() => {
    const b = this.board();
    return b ? mfDate(b.generatedAtUtc, this.zone, 'datetime') : null;
  });
  protected readonly filtered = computed(
    () => this.filters().q !== '' || this.filters().pod !== null,
  );
  protected readonly matrix = computed<Matrix | null>(() => {
    const b = this.board();
    return b
      ? buildMatrix(b, {
          q: this.filters().q,
          scale: this.scale(),
          typeOrder: this.typeOrder(),
          userOrder: this.userOrder(),
          gapsOnly: this.gapsOnly(),
        })
      : null;
  });
  protected readonly rangeProblem = computed(() => {
    const p = this.period();
    if (p.period !== 'custom') return null;
    if (!p.from || !p.to) return 'Choose both dates of the custom range.';
    if (p.from > p.to) return 'The start of the period is after its end.';
    if (dayNumber(p.to) - dayNumber(p.from) + 1 > MAX_DAYS) {
      return `The period can be at most ${MAX_DAYS} days.`;
    }
    return null;
  });

  protected nz(step: Step): Exclude<Step, 0> {
    return (step === 0 ? 1 : step) as Exclude<Step, 0>;
  }

  protected thin(n: number): string {
    return thinText(n);
  }

  private lastPod: number | null | undefined;

  constructor() {
    // The pod is part of the request: a change of the pod filter (made here or by Back in the address) reads the matrix again.
    effect(() => {
      const pod = this.filters().pod;
      untracked(() => {
        if (this.lastPod === undefined || pod === this.lastPod) return;
        this.lastPod = pod;
        this.reload();
      });
    });
  }

  ngOnInit(): void {
    this.lastPod = this.filters().pod;
    this.prefs.ensureLoaded();
    const params = this.route.snapshot.queryParamMap;
    this.period.set(periodFromParams((k) => params.get(k), this.prefs.period()));
    void this.writeUrl();
    this.load();
  }

  // ---- the period

  protected onPeriod(value: string): void {
    if (!isPeriodKey(value)) return;
    if (value === 'custom') {
      const b = this.board();
      this.period.set({ period: 'custom', from: b?.from ?? null, to: b?.to ?? null });
    } else {
      this.period.set({ period: value, from: null, to: null });
      this.prefs.remember({ period: value });
    }
    void this.writeUrl();
    this.reload();
  }

  protected setCustom(patch: { from?: string | null; to?: string | null }): void {
    this.period.update((p) => ({ ...p, period: 'custom' as PeriodKey, ...patch }));
    void this.writeUrl();
    this.reload();
  }

  private reload(): void {
    if (this.rangeProblem()) return;
    this.load({ silent: !!this.board() });
  }

  private writeUrl(): Promise<boolean> {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: periodToParams(this.period()),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ---- display choices

  protected num(value: string): number | null {
    const n = Number(value);
    return value !== '' && Number.isInteger(n) && n > 0 ? n : null;
  }

  protected onScale(value: string): void {
    if (isScale(value)) this.prefs.remember({ scale: value as Scale });
  }

  protected onTypeOrder(value: string): void {
    if (isOrder(value)) this.prefs.remember({ typeOrder: value as TypeOrder });
  }

  protected onUserOrder(value: string): void {
    if (isOrder(value)) this.prefs.remember({ userOrder: value as UserOrder });
  }

  // ---- loading

  /** Reads the matrix again now; the Dashboard's refresh icon (in the tab row) and the failed-refresh Retry call this. */
  refresh(): void {
    if (this.refreshing()) return;
    this.load({ silent: true, announce: true });
  }

  protected load(options: { silent?: boolean; announce?: boolean } = {}): void {
    const { silent = false, announce = false } = options;
    if (this.rangeProblem()) return;
    const id = ++this.requestId;
    const background = silent && !!this.board();
    if (background) this.refreshing.set(true);
    else {
      this.state.set('loading');
      this.refreshFailed.set(false);
    }
    const args = periodArgs(this.period());
    const start = () =>
      this.api
        .getDashboardCoverage(
          args.from,
          args.to,
          args.periodDays,
          this.filters().pod ?? undefined,
          undefined,
        )
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (board) => {
            if (id !== this.requestId) return;
            this.board.set(board);
            this.state.set('ready');
            this.refreshing.set(false);
            this.refreshFailed.set(false);
            this.podsSeen.emit(
              new Map(board.users.flatMap((u) => u.pods.map((p) => [p.podId, p.name] as const))),
            );
            if (announce) {
              this.live.set(
                `Coverage refreshed. ${plural(board.users.length, 'person', 'people')}, ${plural(board.taskTypes.length, 'task type')}.`,
              );
            }
          },
          error: (error: unknown) => {
            if (id !== this.requestId) return;
            this.refreshing.set(false);
            if (error instanceof ApiError && error.status === 403) {
              this.state.set('forbidden');
              return;
            }
            if (this.board()) this.refreshFailed.set(true);
            else this.state.set('error');
          },
        });
    if (background) this.quiet.run(start);
    else start();
  }

  // ---- cells

  protected label(m: Matrix, r: number, c: number): string {
    return cellLabel(m.cols[c], m.rows[r].type, m.rows[r].cells[c].count, this.phrase());
  }

  protected setActive(r: number, c: number): void {
    this.activeR.set(r);
    this.activeC.set(c);
  }

  protected openCell(m: Matrix, r: number, c: number): void {
    const b = this.board();
    if (!b) return;
    const cell: MatrixCell = m.rows[r].cells[c];
    const user: CoverageUser = m.cols[c];
    this.target.set({ user, type: m.rows[r].type, from: b.from, to: b.to, count: cell.count });
  }

  protected closeCell(): void {
    const t = this.target();
    this.target.set(null);
    if (!t) return;
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active && active !== document.body && !active.closest('.p-dialog-mask')) return;
        this.host.nativeElement
          .querySelector<HTMLElement>(`[data-cell="${t.user.userId}:${t.type.taskTypeId}"]`)
          ?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /** Arrow keys move between cells, Home and End to the row's ends, Ctrl+Home and Ctrl+End to the first and last cell. */
  protected onKey(event: KeyboardEvent, m: Matrix, r: number, c: number): void {
    const rows = m.rows.length;
    const cols = m.cols.length;
    let nr = r;
    let nc = c;
    switch (event.key) {
      case 'ArrowRight':
        nc = Math.min(cols - 1, c + 1);
        break;
      case 'ArrowLeft':
        nc = Math.max(0, c - 1);
        break;
      case 'ArrowDown':
        nr = Math.min(rows - 1, r + 1);
        break;
      case 'ArrowUp':
        nr = Math.max(0, r - 1);
        break;
      case 'Home':
        nc = 0;
        if (event.ctrlKey) nr = 0;
        break;
      case 'End':
        nc = cols - 1;
        if (event.ctrlKey) nr = rows - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.setActive(nr, nc);
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>(`[data-r="${nr}"][data-c="${nc}"]`)
          ?.focus(),
      { injector: this.injector },
    );
  }
}
