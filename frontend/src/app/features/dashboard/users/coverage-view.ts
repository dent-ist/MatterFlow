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
import { Badge } from '../../../shared/ui/badge';
import { CountChip } from '../../../shared/ui/count-chip';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  CoverageBoard,
  CoverageUser,
  DashboardBoardClient,
} from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { QuietRequests } from '../../../core/http/interceptors';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { mfDateLong } from '../../../core/time/time';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { DashboardPrefs } from '../dashboard-prefs';
import { Period, periodArgs, periodForTab, periodId, periodPhrase } from '../dashboard-period';
import { PeriodControl } from '../ui/period-control';
import { DashSkeleton } from '../ui/dash-skeleton';
import { DashState, focusAfterRetry } from '../ui/dash-state';
import { SearchBox } from '../../../shared/ui/search-box';
import { StateBlock } from '../../../shared/ui/state-block';
import { Tip } from '../../../shared/ui/tip';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { UsersFilterPopover } from './users-filter-popover';
import { CoverageDrawer, CoverageTarget } from './coverage-drawer';
import {
  DEFAULT_ORIENTATION,
  MATRIX_COLS,
  MATRIX_ROWS,
  Matrix,
  MatrixCell,
  ORIENTATION_PARAM,
  Orientation,
  RELATIVE_LABELS,
  STATUS_TEXT,
  STEP_COLORS,
  STEP_LABELS,
  Scale,
  Step,
  TYPE_ROW_ORDERS,
  TYPE_ROW_ORDER_LABELS,
  TypeOrder,
  TypeRowOrder,
  UserOrder,
  buildMatrix,
  buildTypeRows,
  cellLabel,
  isOrder,
  isOrientation,
  isScale,
  isTypeRowOrder,
  plural,
} from './coverage-model';
import { CoverageNotes } from './coverage-notes';
import { CoverageOrientation } from './coverage-orientation';
import { CoverageTypes, TypePick } from './coverage-types';
import { CoveragePrefs } from './coverage-prefs';
import { UsersFilters } from './users-model';
import { DashScope } from '../dash-scope';
import { IntPipe } from '../../../shared/ui/number-format';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

/**
 * The Coverage view of the Users tab, in two orientations (WP11): "By task type" (default; `CoverageTypes`: per task type who handled it, how many,
 * a status) and "Matrix" (`cov=matrix`): a heat map of how many tasks each person completed per task type, for planning training and
 * cross-coverage. The matrix is a real table (task types in the rows with their icon, people in the columns, totals at the end, "People who
 * handled it" per type). The number is written in every non-zero cell; a zero is blank (named for screen readers) and the possible training
 * gaps are outlined with an icon only while the "Training gaps" toggle is on. The five steps keep 4.5:1 for their numbers. Scale is relative to
 * the task type (default) or absolute. The person is the assignee of the completed task. Two statements above both orientations: types nobody
 * handled (neutral, collapsed) and types handled by only one person (amber, a status region).
 * Keyboard: the matrix is one tab stop; arrow keys, Home and End move between cells, Enter or Space opens the cell's tasks.
 * Bounded rendering: at first 30 people and 60 task types are drawn, "Show More" adds the same again.
 * Not a ranking: ordering by total is labelled neutrally, there is no score, and the heading says what the view is for.
 */
@Component({
  selector: 'mf-coverage-view',
  imports: [
    Badge,
    StateBlock,
    CountChip,
    IntPipe,
    PeriodControl,
    SearchBox,
    TaskTypeIcon,
    DashSkeleton,
    DashState,
    CoverageDrawer,
    CoverageTypes,
    CoverageNotes,
    CoverageOrientation,
    Dropdown,
    UsersFilterPopover,
    Tip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar" role="toolbar" aria-label="Coverage controls" data-coverage-toolbar>
      <ng-content />
      <mf-coverage-orientation [value]="orientation()" (valueChange)="setOrientation($event)" />
      <mf-period-control [period]="period()" [longWindows]="true" />
      <mf-search-box
        class="search"
        role="search"
        inputId="cv-q"
        [label]="searchLabel()"
        [placeholder]="searchLabel()"
        [hideLabel]="true"
        [hintOnFocus]="true"
        [leadingIcon]="true"
        [compact]="true"
        [value]="filters().q"
        (searchChange)="filtersChange.emit({ q: $event })"
      />
      <mf-users-filter-popover label="Display" icon="pi-sliders-h">
        @if (orientation() === 'type') {
          <div class="fl" data-display="order">
            <span>Order</span>
            <mf-dropdown
              buttonId="cv-order"
              label="Order"
              data-coverage-row-order
              [items]="rowOrderItems"
              [value]="rowOrder()"
              (valueChange)="onRowOrder($event)"
              [panelWidth]="260"
            />
          </div>
        } @else {
          <div class="fl" data-display="scale">
            <span>Color scale</span>
            <mf-dropdown
              buttonId="cv-scale"
              label="Color Scale"
              data-coverage-scale
              [items]="scaleItems"
              [value]="scale()"
              (valueChange)="onScale($event)"
              [panelWidth]="260"
            />
          </div>
          <div class="fl" data-display="types">
            <span>Task types</span>
            <mf-dropdown
              buttonId="cv-rows"
              label="Task Types"
              data-coverage-type-order
              [items]="nameTotalItems"
              [value]="typeOrder()"
              (valueChange)="onTypeOrder($event)"
              [panelWidth]="260"
            />
          </div>
          <div class="fl" data-display="people">
            <span>People</span>
            <mf-dropdown
              buttonId="cv-cols"
              label="People"
              data-coverage-user-order
              [items]="nameTotalItems"
              [value]="userOrder()"
              (valueChange)="onUserOrder($event)"
              [panelWidth]="260"
            />
          </div>
        }
      </mf-users-filter-popover>
      @if (orientation() === 'matrix') {
        <button
          type="button"
          class="mf-btn toggle"
          data-coverage-gaps
          [attr.aria-pressed]="showGaps()"
          (click)="showGaps.set(!showGaps())"
        >
          <i class="pi pi-flag" aria-hidden="true"></i>Training Gaps
        </button>
      }
      <span class="grow"></span>
      <button
        type="button"
        class="mf-btn mf-btn--icon info"
        data-coverage-help
        aria-label="How to read this view"
        [mfTip]="help()"
      >
        <i class="pi pi-info-circle" aria-hidden="true"></i>
      </button>
    </div>

    <h3 class="head" id="cv-h" data-coverage-heading>
      Task type coverage - use this to plan training and cross-coverage, not to rank people
    </h3>
    <p class="frame" data-coverage-frame>
      @if (orientation() === 'type') {
        <span>People who completed tasks of each type {{ phrase() }}.</span>
      } @else {
        <span>Tasks each person completed per type {{ phrase() }}.</span>
      }
    </p>

    <p class="sr-only" role="status" aria-live="polite" data-coverage-live>{{ live() }}</p>

    @if (refreshFailed()) {
      <mf-dash-state variant="stale" [updated]="updated()" (retry)="retry()" />
    }

    @switch (state()) {
      @case ('error') {
        <mf-dash-state
          variant="error"
          message="Couldn't load the task type coverage."
          (retry)="retry()"
        />
      }
      @case ('forbidden') {
        <div data-coverage-forbidden>
          <mf-state-block icon="pi-lock">
            You don't have access to the task type coverage.
            <span mfStateReason>Ask a Director.</span>
          </mf-state-block>
        </div>
      }
      @case ('loading') {
        <mf-dash-skeleton kind="coverage" label="Loading the coverage" data-coverage-loading />
      }
      @default {
        @if (board()) {
          <mf-coverage-notes [types]="board()!.taskTypes" />
        }
        @if (orientation() === 'type') {
          @if (board(); as b) {
            <ul class="strip" aria-label="Coverage summary" data-coverage-summary>
              <li class="sum" data-summary="types">
                <mf-count-chip>{{ typeRows().length }}</mf-count-chip> task
                {{ typeRows().length === 1 ? 'type' : 'types' }}
              </li>
              <li class="sum" data-summary="completed">
                <mf-count-chip>{{ typeCompleted() }}</mf-count-chip> completed
              </li>
              <li class="sum" data-summary="people">
                <mf-count-chip>{{ typePeople() }}</mf-count-chip>
                {{ typePeople() === 1 ? 'person' : 'people' }} handled them
              </li>
            </ul>
            @if (typeRows().length === 0) {
              <div data-coverage-empty>
                @if (filtered()) {
                  <mf-state-block icon="pi-table">
                    No task types or people match these filters.
                    <button
                      type="button"
                      mfStateAction
                      class="mf-btn"
                      data-coverage-clear
                      (click)="filtersChange.emit({ q: '' })"
                    >
                      Clear Filters
                    </button>
                  </mf-state-block>
                } @else {
                  <mf-state-block icon="pi-table">No coverage for this period.</mf-state-block>
                }
              </div>
            } @else {
              <mf-coverage-types
                [rows]="typeRows()"
                [roster]="b.scopePeople ?? null"
                [scopeLabel]="scopeLabel()"
                [phrase]="phrase()"
                (openTasks)="openPick($event)"
              />
            }
          }
        } @else if (matrix(); as m) {
          <ul class="strip" aria-label="Coverage summary" data-coverage-summary>
            <li class="sum" data-summary="people">
              <mf-count-chip>{{ m.cols.length }}</mf-count-chip>
              {{ m.cols.length === 1 ? 'person' : 'people' }}
            </li>
            <li class="sum" data-summary="types">
              <mf-count-chip>{{ m.rows.length }}</mf-count-chip> task
              {{ m.rows.length === 1 ? 'type' : 'types' }}
            </li>
            <li class="sum" data-summary="completed">
              <mf-count-chip>{{ m.grand }}</mf-count-chip> completed
            </li>
            @if (showGaps()) {
              <li class="sum" data-summary="gaps">
                <mf-count-chip>{{ m.gapCount | mfInt }}</mf-count-chip> possible training
                {{ m.gapCount === 1 ? 'gap' : 'gaps' }}
                <span class="sub">(0 for someone active)</span>
              </li>
            }
          </ul>

          <ul class="legend" aria-label="Color legend" data-coverage-legend>
            <li class="lg lg--zero">
              <span class="sw sw--zero" aria-hidden="true"></span>Blank = 0 in this period
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
              <span class="sw sw--gap" aria-hidden="true"
                ><i class="pi pi-exclamation-circle"></i></span
              >Outline = possible training gap (Training gaps toggle)
            </li>
          </ul>

          @if (m.rows.length === 0 || m.cols.length === 0) {
            <div data-coverage-empty>
              @if (filtered()) {
                <mf-state-block icon="pi-table">
                  No people match these filters.
                  <button
                    type="button"
                    mfStateAction
                    class="mf-btn"
                    data-coverage-clear
                    (click)="filtersChange.emit({ q: '' })"
                  >
                    Clear Filters
                  </button>
                </mf-state-block>
              } @else {
                <mf-state-block icon="pi-table">No coverage for this period.</mf-state-block>
              }
            </div>
          } @else {
            <div
              class="region"
              role="region"
              tabindex="0"
              aria-labelledby="cv-h"
              data-coverage-region
            >
              <table class="tbl" data-coverage-table [attr.data-gaps]="showGaps() ? 'on' : null">
                <caption class="sr-only">
                  Tasks completed per task type (rows) and person (columns)
                  {{
                    phrase()
                  }}. Showing
                  {{
                    visCols().length
                  }}
                  of
                  {{
                    m.cols.length
                  }}
                  people and
                  {{
                    visRows().length
                  }}
                  of
                  {{
                    m.rows.length
                  }}
                  task types.
                </caption>
                <thead>
                  <tr>
                    <th scope="col" class="corner">Task Type</th>
                    @for (u of visCols(); track u.userId) {
                      <th scope="col" class="person" [attr.data-person]="u.userId">
                        <span class="avatar" aria-hidden="true">{{ u.initials }}</span>
                        <span class="pname">{{ u.displayName }}</span>
                        @if (!u.isActive) {
                          <mf-badge data-inactive>Inactive</mf-badge>
                        }
                        @if (u.availability.state === 'OUT_OF_OFFICE') {
                          <mf-badge tone="warning" icon="pi-calendar-minus" data-ooo-marker
                            >Out of Office</mf-badge
                          >
                        }
                      </th>
                    }
                    <th scope="col" class="num">Total</th>
                    <th scope="col" class="num">People Who Handled It</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of visRows(); track r.type.taskTypeId; let ri = $index) {
                    <tr [attr.data-type]="r.type.taskTypeId" [attr.data-type-name]="r.type.name">
                      <th scope="row" class="ttype">
                        <span class="twrap">
                          <mf-task-type-icon [iconKey]="r.type.iconKey" size="sm" />
                          <span>{{ r.type.name }}</span>
                          @if (!r.type.isActive) {
                            <mf-badge>Inactive</mf-badge>
                          }
                        </span>
                      </th>
                      @for (
                        c of r.cells.slice(0, visCols().length);
                        track c.userId;
                        let ci = $index
                      ) {
                        <td
                          class="cell"
                          [class.cell--zero]="c.count === 0"
                          [class.cell--gap]="c.gap && showGaps()"
                          [attr.data-step]="c.step"
                          [attr.data-count]="c.count"
                          [attr.data-gap]="c.gap && showGaps() ? 'true' : null"
                          [style.background]="c.step > 0 ? colors[nz(c.step)].bg : null"
                          [style.color]="c.step > 0 ? colors[nz(c.step)].fg : null"
                        >
                          <button
                            type="button"
                            class="hit"
                            [class.hit--zero]="c.count === 0"
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
                            @if (c.count > 0) {
                              <span class="n">{{ c.count | mfInt }}</span>
                            }
                            @if (c.gap && showGaps()) {
                              <i class="pi pi-exclamation-circle mark" aria-hidden="true"></i>
                            }
                          </button>
                        </td>
                      }
                      <td class="num total" data-row-total>{{ r.total | mfInt }}</td>
                      <td class="num" data-people>
                        @if (r.status !== 'many') {
                          <span
                            class="handled"
                            [class.handled--one]="r.status === 'one'"
                            [attr.data-status]="r.status"
                          >
                            <i
                              class="pi"
                              [class]="
                                r.status === 'one' ? 'pi-exclamation-triangle' : 'pi-minus-circle'
                              "
                              aria-hidden="true"
                            ></i>
                            {{ statusText[r.status] }}
                          </span>
                        } @else {
                          {{ plural(r.people, 'person', 'people') }}
                        }
                      </td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" class="ttype">Total</th>
                    @for (t of visColTotals(); track $index) {
                      <td class="num total" data-col-total>{{ t }}</td>
                    }
                    <td class="num total" data-grand-total>{{ m.grand }}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
              @if (moreCols() > 0 || moreRows() > 0) {
                <div class="more" data-matrix-more>
                  @if (moreCols() > 0) {
                    <button type="button" class="mf-btn" data-cols-more (click)="showMoreCols()">
                      Show {{ Math.min(moreCols(), colsPage) }} more
                      {{ Math.min(moreCols(), colsPage) === 1 ? 'person' : 'people' }}
                    </button>
                  }
                  @if (moreRows() > 0) {
                    <button type="button" class="mf-btn" data-rows-more (click)="showMoreRows()">
                      Show {{ Math.min(moreRows(), rowsPage) }} more task
                      {{ Math.min(moreRows(), rowsPage) === 1 ? 'type' : 'types' }}
                    </button>
                  }
                  <span class="sub"
                    >{{ visCols().length }} of {{ m.cols.length }} people, {{ visRows().length }} of
                    {{ m.rows.length }} task types shown</span
                  >
                </div>
              }
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
    /* Fixed-height Dashboard (#137): the controls are pinned and the matrix fills the rest. */
    @media (min-width: 768px) and (min-height: 561px) {
      :host {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
      :host > * {
        flex: none;
      }
      :host > .region,
      :host > mf-coverage-types {
        flex: 1 1 0;
        max-height: none;
        min-height: 0;
      }
    }
    .head {
      margin: 0 0 var(--mf-s1);
      font-size: var(--mf-fs-lg, 1.125rem);
    }
    .frame {
      display: flex;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s3);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin-bottom: var(--mf-s3);
    }
    .fl {
      display: grid;
      gap: var(--mf-s1);
    }
    .grow {
      flex: 1;
    }
    .info:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    /* One control height on all three views (the shared token): the search box, the switches, the dropdowns and the icon buttons are the same height. */
    .bar .mf-btn {
      min-height: var(--mf-ctl-h);
    }
    .search ::ng-deep .sb__input {
      height: var(--mf-ctl-h);
      min-height: var(--mf-ctl-h);
      padding-block: 0;
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
    .sum {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    .more {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s3);
      padding: var(--mf-s3);
      position: sticky;
      left: 0;
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
    /* A zero is a blank cell on a light neutral background: no pattern, no dashed edge (C2, #135). */
    .sw--zero,
    .cell--zero {
      background: var(--mf-surface-alt);
    }
    /* A possible training gap: an inset outline (3:1) and an icon, only while the "Training gaps" toggle is on. */
    .sw--gap {
      display: inline-grid;
      color: var(--mf-warning);
      background: var(--mf-surface);
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
    .cell {
      min-width: 5.5rem;
      height: 2.75rem;
      text-align: center;
    }
    .cell--gap {
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
    .handled {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      color: var(--mf-text-muted);
      font-weight: 600;
    }
    .handled--one {
      padding: 0 var(--mf-s2);
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
      border: 1px solid var(--mf-warning);
      border-radius: 999px;
    }
    tfoot td,
    tfoot th {
      border-bottom: 0;
    }
    @media (max-width: 560px) {
      .search {
        flex-basis: 100%;
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
  private readonly clock = inject(Clock);
  private retrying = false;
  /** When the matrix on screen was last read successfully (epoch ms); the page shows "Updated N min ago" from it once it is old (P6). */
  readonly lastOkAt = signal<number | null>(null);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private requestId = 0;

  /** The name filter shared with the Workload view (it lives in the address). The Pod is the page-wide scope. */
  readonly filters = input.required<UsersFilters>();
  readonly filtersChange = output<Partial<UsersFilters>>();

  protected readonly steps: Exclude<Step, 0>[] = [1, 2, 3, 4];
  protected readonly colors = STEP_COLORS;
  protected readonly stepLabels = STEP_LABELS;
  protected readonly relativeLabels = RELATIVE_LABELS;
  protected readonly plural = plural;
  protected readonly Math = Math;
  protected readonly statusText = STATUS_TEXT;
  protected readonly colsPage = MATRIX_COLS;
  protected readonly rowsPage = MATRIX_ROWS;

  private readonly dashPrefs = inject(DashboardPrefs);
  private readonly scope = inject(DashScope);
  /** The page's shared period (Coverage also offers the 6 and 12 month windows). */
  protected readonly period = computed<Period>(() => periodForTab(this.dashPrefs.period(), true));
  protected readonly scale = this.prefs.scale;
  protected readonly typeOrder = this.prefs.typeOrder;
  protected readonly userOrder = this.prefs.userOrder;
  protected readonly rowOrder = this.prefs.rowOrder;
  /** By task type (default) or the matrix; the address carries `cov=matrix` only for the latter. */
  protected readonly orientation = signal<Orientation>(DEFAULT_ORIENTATION);
  /** The "Training gaps" toggle: outlines the possible gaps of the matrix (default off, C2). */
  protected readonly showGaps = signal(false);
  private readonly colLimit = signal(MATRIX_COLS);
  private readonly rowLimit = signal(MATRIX_ROWS);
  protected readonly state = signal<LoadState>('loading');
  protected readonly board = signal<CoverageBoard | null>(null);
  /** True while a refresh is running (the Dashboard's tab row shows it on its refresh icon). */
  readonly refreshing = signal(false);
  readonly refreshFailed = signal(false);
  protected readonly live = signal('');
  protected readonly activeR = signal(0);
  protected readonly activeC = signal(0);
  protected readonly target = signal<CoverageTarget | null>(null);

  protected readonly phrase = computed(() =>
    periodPhrase(this.board(), this.clock.now().getFullYear()),
  );
  protected readonly updated = computed(() => {
    const b = this.board();
    return b ? mfDateLong(b.generatedAtUtc, this.zone, 'datetime') : null;
  });
  protected readonly filtered = computed(() => this.filters().q !== '');
  protected readonly matrix = computed<Matrix | null>(() => {
    const b = this.board();
    return b
      ? buildMatrix(b, {
          q: this.filters().q,
          scale: this.scale(),
          typeOrder: this.typeOrder(),
          userOrder: this.userOrder(),
        })
      : null;
  });
  protected readonly typeRows = computed(() => {
    const b = this.board();
    if (!b || this.orientation() !== 'type') return [];
    // The search finds a task type or a person by name (it keeps the types whose name or one of whose people match).
    const term = this.filters().q.trim().toLowerCase();
    const rows = buildTypeRows(b, this.rowOrder());
    return term
      ? rows.filter(
          (r) =>
            r.type.name.toLowerCase().includes(term) ||
            r.people.some((p) => p.displayName.toLowerCase().includes(term)),
        )
      : rows;
  });
  protected readonly typeCompleted = computed(() =>
    this.typeRows().reduce((n, r) => n + r.type.total, 0),
  );
  /** The people who handled at least one of the types shown. */
  protected readonly typePeople = computed(
    () => new Set(this.typeRows().flatMap((r) => r.people.map((p) => p.userId))).size,
  );
  protected readonly searchLabel = computed(() =>
    this.orientation() === 'type' ? 'Search task types or people by name' : 'Search people by name',
  );
  /** The label of the page scope for "people in <pod> who have not handled this type". */
  protected readonly scopeLabel = computed(
    () => this.scope.options().find((o) => o.value === this.scope.scope())?.label ?? 'this pod',
  );
  // Bounded rendering: 500 people x 30 types is 15,000 cells, so the matrix draws the first people and task types and offers "Show More".
  protected readonly visCols = computed(() => this.matrix()?.cols.slice(0, this.colLimit()) ?? []);
  protected readonly visRows = computed(() => this.matrix()?.rows.slice(0, this.rowLimit()) ?? []);
  protected readonly visColTotals = computed(
    () => this.matrix()?.colTotals.slice(0, this.colLimit()) ?? [],
  );
  protected readonly moreCols = computed(
    () => (this.matrix()?.cols.length ?? 0) - this.visCols().length,
  );
  protected readonly moreRows = computed(
    () => (this.matrix()?.rows.length ?? 0) - this.visRows().length,
  );
  protected nz(step: Step): Exclude<Step, 0> {
    return (step === 0 ? 1 : step) as Exclude<Step, 0>;
  }

  constructor() {
    // The period is shared with Summary and Trends: a new one (the control, a link, Back) reads the matrix again.
    let lastPeriod: string | undefined;
    effect(() => {
      const id = periodId(this.period());
      untracked(() => {
        if (lastPeriod !== undefined && id !== lastPeriod) this.load({ silent: !!this.board() });
        lastPeriod = id;
      });
    });
    // The page-wide scope is part of the request: a new one (the control, a link, Back) reads the matrix again.
    let lastScope: string | undefined;
    effect(() => {
      const scope = this.scope.scope();
      untracked(() => {
        if (lastScope !== undefined && scope !== lastScope) this.load();
        lastScope = scope;
      });
    });
  }

  ngOnInit(): void {
    this.prefs.ensureLoaded();
    const asked = this.route.snapshot.queryParamMap.get(ORIENTATION_PARAM);
    if (isOrientation(asked)) this.orientation.set(asked);
    this.load();
  }

  // ---- display choices

  protected num(value: string): number | null {
    const n = Number(value);
    return value !== '' && Number.isInteger(n) && n > 0 ? n : null;
  }

  /** The rest of the explanation (it was a paragraph under the title): the info icon's tooltip. */
  protected readonly help = computed(() =>
    this.orientation() === 'type'
      ? `Each row lists the people who completed at least one task of that type ${this.phrase()}, in alphabetical order. A task counts for the person it was assigned to when it was completed. Cancelled tasks are not counted.`
      : `Each cell is the number of tasks of that type the person completed ${this.phrase()}. A task counts for the person it was assigned to when it was completed. Cancelled tasks are not counted.`,
  );
  protected readonly rowOrderItems: DropdownItem[] = TYPE_ROW_ORDERS.map((o) => ({
    value: o,
    label: TYPE_ROW_ORDER_LABELS[o],
  }));
  protected readonly scaleItems: DropdownItem[] = [
    { value: 'relative', label: 'Relative to the Task Type' },
    { value: 'absolute', label: 'Absolute' },
  ];
  protected readonly nameTotalItems: DropdownItem[] = [
    { value: 'name', label: 'By Name' },
    { value: 'total', label: 'By Total Completed' },
  ];

  protected onScale(value: string): void {
    if (isScale(value)) this.prefs.remember({ scale: value as Scale });
  }

  protected onTypeOrder(value: string): void {
    if (isOrder(value)) this.prefs.remember({ typeOrder: value as TypeOrder });
  }

  protected onRowOrder(value: string): void {
    if (isTypeRowOrder(value)) this.prefs.remember({ rowOrder: value as TypeRowOrder });
  }

  /** By task type or Matrix: reads the other payload (`groupBy=type` is small; the matrix is the detail view) and writes `cov=matrix` only for the matrix. */
  protected setOrientation(next: Orientation): void {
    if (next === this.orientation()) return;
    this.orientation.set(next);
    this.board.set(null);
    this.colLimit.set(MATRIX_COLS);
    this.rowLimit.set(MATRIX_ROWS);
    this.activeR.set(0);
    this.activeC.set(0);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [ORIENTATION_PARAM]: next === DEFAULT_ORIENTATION ? null : next },
      queryParamsHandling: 'merge',
    });
    this.load();
  }

  protected showMoreCols(): void {
    this.colLimit.update((n) => n + MATRIX_COLS);
  }

  protected showMoreRows(): void {
    this.rowLimit.update((n) => n + MATRIX_ROWS);
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
    const id = ++this.requestId;
    const background = silent && !!this.board();
    if (background) this.refreshing.set(true);
    else {
      this.state.set('loading');
      this.refreshFailed.set(false);
    }
    const args = periodArgs(this.period());
    const base = [
      args.period,
      args.from,
      args.to,
      undefined,
      undefined,
      undefined,
      this.scope.scope(),
    ] as const;
    const start = () =>
      (this.orientation() === 'type'
        ? this.api.getDashboardCoverage(...base, 'type')
        : this.api.getDashboardCoverage(...base)
      )
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (board) => {
            if (id !== this.requestId) return;
            this.board.set(board);
            this.state.set('ready');
            this.refreshing.set(false);
            this.refreshFailed.set(false);
            this.lastOkAt.set(this.clock.now().getTime());
            this.finishRetry('ready');
            if (announce) {
              this.live.set(
                `Coverage refreshed. ${plural(board.summary.users, 'person', 'people')}, ${plural(board.taskTypes.length, 'task type')}.`,
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
            this.finishRetry('failed');
          },
        });
    if (background) this.quiet.run(start);
    else this.quiet.runInline(start);
  }

  /** The Retry of the error or stale state: reads again and puts the focus where P7 says when the answer is in. */
  protected retry(): void {
    this.retrying = true;
    if (this.board()) this.refresh();
    else this.load();
  }

  private finishRetry(outcome: 'ready' | 'failed'): void {
    if (!this.retrying) return;
    this.retrying = false;
    focusAfterRetry(this.host.nativeElement, this.injector, outcome);
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
    // A zero opens nothing (it only announces its name); a count opens the tasks behind it.
    if (cell.count === 0) return;
    const user: CoverageUser = m.cols[c];
    this.target.set({ user, type: m.rows[r].type, from: b.from, to: b.to, count: cell.count });
  }

  /** A person's count in the By task type details. */
  protected openPick(pick: TypePick): void {
    const b = this.board();
    if (b) this.target.set({ ...pick, from: b.from, to: b.to });
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
          .querySelector<HTMLElement>(
            `[data-cell="${t.user.userId}:${t.type.taskTypeId}"], [data-count-for="${t.user.userId}:${t.type.taskTypeId}"]`,
          )
          ?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /** Arrow keys move between cells, Home and End to the row's ends, Ctrl+Home and Ctrl+End to the first and last cell. */
  protected onKey(event: KeyboardEvent, m: Matrix, r: number, c: number): void {
    const rows = this.visRows().length;
    const cols = this.visCols().length;
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
