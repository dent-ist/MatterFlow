import { toSignal } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AssetDataTypeRow,
  AssetUnitValue,
  AssetTypeResponse,
  AssetTypesClient,
  MattersClient,
  MyMattersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { QuietRequests } from '../../../core/http/interceptors';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { ViewStateService } from '../../../core/views/view-state.service';
import { ChartPanel } from '../../../shared/charts/chart-panel';
import { ChartKind, ChartRow } from '../../../shared/charts/chart-types';
import { ColumnChart } from '../../../shared/charts/column-chart';
import {
  RecordCard,
  RecordCardDef,
  RecordCardList,
  phoneCards,
} from '../../../shared/ui/record-card-list';
import { StatTile } from '../../../shared/ui/stat-tile';
import { formatSize } from '../../assets/disposition/asset-size';
import { DataPeriodControl, PeriodChoice } from '../data/data-period';
import { DataPick, PickOption } from '../data/data-pick';
import { DataSizePick, sizeGroups } from '../data/data-size-pick';
import { DataStatus, VolumeRow, sizeText, volumeChartRows, volumeRows } from '../data-model';
import {
  DEFAULT_SELECTION,
  DataSelection,
  DataView,
  SizeChoice,
  fromRemembered,
  hasExplicitSelection,
  isEverything,
  listIsExact,
  listParams,
  parseSelection,
  parseStatus,
  parseView,
  rememberedOf,
  selectionArgs,
  selectionToParams,
  sizeOf,
  countOf,
  typeChartRows,
  unitsOf,
} from '../data-selection';
import { ManagedMatters } from '../managed-matters';
import { MmFilters, commonArgs } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { Segmented } from '../../../shared/ui/segmented';
import { PanelBox } from '../panels/panel-box';
import { todayText } from '../panels/calendar-panel';

const COUNT = new Intl.NumberFormat('en-US');
/** The months the volume looks back over; the period of the selection narrows the assets, not this window. */
const VOLUME_MONTHS = 24;
/** How many matters one look into the matter list asks for. */
const MATTER_PAGE = 50;

/** The four disposition columns of a table or card, in the order of a record's life. */
const DISPOSITION_COLUMNS: readonly {
  key: 'active' | 'inactive' | 'pendingDisposition' | 'disposed';
  status: DataStatus;
  label: string;
  noun: string;
}[] = [
  { key: 'active', status: 'active', label: 'Active', noun: 'active' },
  { key: 'inactive', status: 'inactive', label: 'Inactive', noun: 'inactive' },
  {
    key: 'pendingDisposition',
    status: 'pending',
    label: 'Pending disposition',
    noun: 'pending disposition',
  },
  { key: 'disposed', status: 'disposed', label: 'Disposed', noun: 'disposed' },
];

/** One headline tile of the Data Area. */
interface DataTile {
  key: string;
  label: string;
  value: string;
  unit: string;
  note: string;
  muted: boolean;
  /** The status a press filters the grid to; null: not a button. */
  status: DataStatus | null;
}

function plural(n: number, one: string, many: string): string {
  return `${COUNT.format(n)} ${n === 1 ? one : many}`;
}

/**
 * Data tab of My Matters (epic #851, PV-19 #870 and PV-20 #871): how much data the matters hold and in what state. Tables first (real tables with
 * a caption and header scopes, cards below 640 px): assets by matter and by asset type with count and size, split by disposition (Active, Inactive,
 * Pending disposition, Disposed), the two warnings (not active but still linked to open tasks; awaiting disposition) and, below, the volume held
 * month by month. Every count and warning opens the Assets list with exactly the assets it counts. The size is the asset type's designated number
 * field; the Project Manager may measure another number field of one type in this view (not stored; kept in the address). The scope is the page's
 * (My matters or All matters); the sensitive-matter rule is the server's. The volume over time is derived from the month each asset was created, which the
 * screen says. Loaded lazily with the tab; the chart is a further lazy chunk.
 */
@Component({
  selector: 'mf-mm-data-tab',
  imports: [
    ChartPanel,
    ColumnChart,
    DataPeriodControl,
    DataPick,
    DataSizePick,
    PanelBox,
    RecordCard,
    RecordCardDef,
    RecordCardList,
    RouterLink,
    Segmented,
    StatTile,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: grid;
      gap: var(--mf-s3);
      min-width: 0;
    }
    /* The selection bar: Matters, Asset types, Size fields, Period, left to right; on a phone one under the other. */
    .dt__controls {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: var(--mf-s2) var(--mf-s3);
      margin-bottom: var(--mf-s3);
    }
    .dt__field {
      display: grid;
      /* One column that may shrink: a very long name must not make a control, and the page, wider than a phone (PV-38). */
      grid-template-columns: minmax(0, 1fr);
      gap: 2px;
      min-width: 0;
    }
    .dt__field label {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .dt__field select {
      max-width: 100%;
    }
    .dt__info {
      min-width: 32px;
      padding-inline: var(--mf-s2);
    }
    .dt__rule {
      margin: 0 0 var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt, var(--mf-surface));
    }
    .dt__rule p {
      margin: 0 0 var(--mf-s1);
    }
    .dt__rule p:last-child {
      margin-bottom: 0;
    }
    .dt__note {
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    /* The headline numbers: tiles that stand out, a row of six on a desktop, two across on a phone. */
    .dt__tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s3);
      padding: 0;
      list-style: none;
    }
    .dt__tiles li {
      min-width: 0;
    }
    /* Amber is for "at risk" only (issue #918): a warning about assets is neutral text with its icon. */
    .dt__warn {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s3);
    }
    .dt__show {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      color: var(--mf-link);
      text-decoration: underline;
    }
    .dt__area {
      min-width: 0;
    }
    .dt__filter {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s2);
    }
    .dt__scroll {
      max-width: 100%;
      overflow-x: auto;
    }
    .dt__table {
      width: 100%;
      border-collapse: collapse;
    }
    .dt__table th,
    .dt__table td {
      padding: var(--mf-s1) var(--mf-s2);
      border-top: 1px solid var(--mf-border);
      text-align: left;
      vertical-align: middle;
    }
    .dt__table thead th {
      border-top: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .dt__table tbody th {
      font-weight: 400;
    }
    .dt__table .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .dt__unit {
      display: block;
    }
    /* A zero says "none": quiet. */
    .dt__zero {
      color: var(--mf-text-muted);
    }
    .dt__table td a {
      display: inline-block;
      min-width: 24px;
      min-height: 24px;
      line-height: 24px;
      color: var(--mf-link);
      text-decoration: underline;
    }
    .dt__muted {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .dt__chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .dt__chips a {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      color: var(--mf-link);
      text-decoration: underline;
    }
    .dt__empty {
      display: grid;
      gap: var(--mf-s2);
      justify-items: start;
      margin: 0;
      padding: var(--mf-s2) 0;
    }
    .dt__empty p {
      margin: 0;
    }
    @media (max-width: 639.98px) {
      .dt__controls {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        align-items: stretch;
      }
      .dt__controls select,
      .dt__empty .mf-btn,
      .dt__clear {
        min-height: 44px;
      }
      .dt__info,
      .dt__show {
        min-height: 44px;
      }
      .dt__tiles {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `,
  template: `
    <mf-mm-panel
      name="data"
      title="Data"
      [state]="loader.state()"
      [busy]="loader.busy()"
      [bare]="bare()"
      (retry)="loader.load()"
    >
      @if (!bare()) {
        <button
          mfPanelActions
          type="button"
          class="mf-btn dt__info"
          data-how
          aria-label="How these numbers are made"
          aria-controls="dt-info"
          [attr.aria-expanded]="infoOpen()"
          (click)="infoOpen.set(!infoOpen())"
          (keydown.escape)="infoOpen.set(false)"
        >
          <i class="pi pi-info-circle" aria-hidden="true"></i>
        </button>
      }
      @if (!bare()) {
        <div class="dt__controls" data-data-controls role="group" aria-label="What the Data shows">
          @if (showMatters()) {
            <mf-data-pick
              label="Matters"
              allText="All matters"
              one="matter"
              many="matters"
              data-pick-matters
              [options]="matterOptions()"
              [chosen]="chosenMatters()"
              [selected]="selection().matterIds"
              [searchable]="true"
              [remote]="true"
              [loading]="mattersLoading()"
              [wide]="cards()"
              (opened)="loadMatters('')"
              (query)="searchMatters($event)"
              (changed)="pickMatters($event)"
            />
          }
          @if (showTypes()) {
            <mf-data-pick
              label="Asset types"
              allText="All asset types"
              one="asset type"
              many="asset types"
              data-pick-types
              [options]="typeOptions()"
              [chosen]="typeOptions()"
              [selected]="selection().typeIds"
              [searchable]="typeOptions().length > 8"
              [wide]="cards()"
              (changed)="pickTypes($event)"
            />
          }
          @if (showSizes()) {
            <mf-data-size-pick
              data-pick-sizes
              [types]="sizeRows()"
              [choices]="selection().sizeFields"
              [wide]="cards()"
              (changed)="pickSizes($event)"
            />
          }
          <mf-data-period
            data-pick-period
            [period]="selection().period"
            [from]="selection().from"
            [to]="selection().to"
            (changed)="pickPeriod($event)"
          />
        </div>
        @if (infoOpen()) {
          <div class="dt__rule" id="dt-info" data-info>
            <p>
              The numbers are the assets added in the period you chose, on the matters and asset
              types you chose. Nothing chosen means all of them.
            </p>
            <p data-info-size>
              Size is the number field chosen for each asset type:
              @for (t of data()?.types ?? []; track t.assetTypeId; let last = $last) {
                {{ t.name }} ({{ measured(t) }}){{ last ? '.' : ';' }}
              }
              An asset without a value adds nothing. Sizes in different units are never added
              together; B, KB, MB, GB and TB are added up and shown in GB.
            </p>
            @if (!exactRows()) {
              <p data-info-links>
                With several matters or a period, the numbers do not open the Assets list: it cannot
                show exactly those assets.
              </p>
            }
            @if (showVolume()) {
              <p data-info-volume>{{ volume.data()?.limitation }}</p>
            }
          </div>
        }
      }
      @if (filters().clientId !== null || filters().managerId !== null) {
        <p class="dt__note" data-filters-note>
          The Client and Project manager filters do not apply to Data. Use Matters above.
        </p>
      }

      @if (data(); as d) {
        @if (d.totals.assets === 0) {
          <div class="dt__empty" data-empty>
            @if (!everything()) {
              <p data-no-match>No assets match this selection.</p>
              <button type="button" class="mf-btn" data-clear-selection (click)="clearSelection()">
                Clear the selection
              </button>
            } @else if (filters().scope === 'all') {
              <p>There are no assets on these matters yet.</p>
            } @else {
              <p>There are no assets on the matters you manage yet.</p>
              @if (canAll()) {
                <button type="button" class="mf-btn" data-show-all (click)="showAll.emit()">
                  Show all matters
                </button>
              }
            }
          </div>
        } @else {
          <ul class="dt__tiles" data-tiles aria-label="Totals of this selection">
            @for (t of tiles(); track t.key) {
              <li>
                <mf-stat-tile
                  [attr.data-tile]="t.key"
                  [value]="t.value"
                  [unit]="t.unit"
                  [label]="t.label"
                  [note]="t.note"
                  [muted]="t.muted"
                  [pressable]="t.status !== null"
                  [pressed]="t.status !== null && t.status === status()"
                  (pick)="pickStatus(t.status)"
                />
              </li>
            }
          </ul>

          @if (d.warnings.inactiveLinked.assets > 0) {
            <p class="dt__warn" data-warning="inactive-linked">
              <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
              <span>{{ inactiveLinkedText(d.warnings.inactiveLinked.assets) }}</span>
              @if (exactWhole()) {
                <a
                  class="dt__show"
                  routerLink="/assets"
                  [queryParams]="link(d.warnings.inactiveLinked.query)"
                  [attr.aria-label]="
                    'Show the ' +
                    plural(d.warnings.inactiveLinked.assets, 'asset', 'assets') +
                    ' that are not active but still linked to open tasks, in the Assets list'
                  "
                  >Show</a
                >
              }
            </p>
          }

          <section class="dt__area" data-data-area aria-label="Assets by asset type">
            @if (status(); as s) {
              <p class="dt__filter" data-status-filter>
                Showing {{ statusWord(s) }} assets only.
                <button
                  type="button"
                  class="mf-btn dt__clear"
                  data-clear-status
                  (click)="pickStatus(null)"
                >
                  Show all
                </button>
              </p>
            }
            <mf-chart-panel
              heading="Assets by asset type"
              labelHeader="Asset type"
              [valueHeader]="valueHeader()"
              [rows]="chartData()"
              [unit]="measureUnit()"
              [format]="chartFormat()"
              [customTable]="true"
              [kind]="view()"
              (kindChange)="setView($event)"
              emptyText="Nothing to show."
            >
              @if (view() !== 'table' && measureOptions().length > 1) {
                <div
                  mfChartControls
                  mfSegmented
                  role="group"
                  aria-label="The chart shows"
                  data-chart-measure
                >
                  @for (m of measureOptions(); track m) {
                    <button
                      type="button"
                      class="mf-btn"
                      [attr.data-measure]="m"
                      [attr.aria-pressed]="m === measureShown()"
                      (click)="measure.set(m)"
                    >
                      {{ m === 'assets' ? 'Assets' : 'Size in ' + m }}
                    </button>
                  }
                </div>
              }
              @if (cards()) {
                <mf-record-card-list
                  state="ready"
                  noun="asset types"
                  label="Assets by asset type"
                  [empty]="false"
                  data-type-cards
                >
                  <ng-template [mfRecordCard]="d.types" let-t>
                    <mf-record-card
                      [name]="t.name"
                      [link]="['/assets']"
                      [queryParams]="link(t.query, 'all')"
                      list="my-matters-data-types"
                      [rowKey]="t.assetTypeId"
                    >
                      <ng-container mfCardMeta>
                        <p class="rc-line" data-card-numbers>
                          <span class="rc-text"
                            >{{ plural(shownCount(t), 'asset', 'assets') }}
                            {{ sizePart(shownSize(t)) }}</span
                          >
                        </p>
                      </ng-container>
                      @if (!status()) {
                        <ng-container mfCardCounts>
                          <ul class="dt__chips">
                            @for (c of columns; track c.key) {
                              @if (t.counts[c.key] > 0) {
                                <li>
                                  @if (exactRows()) {
                                    <a
                                      routerLink="/assets"
                                      [queryParams]="link(t.query, c.status)"
                                      [attr.aria-label]="cellName(t.counts[c.key], c.noun, t.name)"
                                      >{{ c.label }} {{ count(t.counts[c.key]) }}</a
                                    >
                                  } @else {
                                    <span>{{ c.label }} {{ count(t.counts[c.key]) }}</span>
                                  }
                                </li>
                              }
                            }
                          </ul>
                        </ng-container>
                      }
                    </mf-record-card>
                  </ng-template>
                </mf-record-card-list>
              } @else {
                <div
                  class="dt__scroll"
                  role="region"
                  aria-label="Assets by asset type"
                  tabindex="0"
                >
                  <table class="dt__table" data-types-table>
                    <caption class="mf-sr-only">
                      Assets by asset type: how many, how much data and in what state.
                      {{
                        scopeWords()
                      }}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Asset type</th>
                        <th scope="col" class="num">
                          {{ status() ? statusLabel(status()!) : 'Assets' }}
                        </th>
                        <th scope="col" class="num">Size</th>
                        @if (!status()) {
                          @for (c of tableColumns(); track c.key) {
                            <th scope="col" class="num">{{ c.label }}</th>
                          }
                        }
                      </tr>
                    </thead>
                    <tbody>
                      @for (t of d.types; track t.assetTypeId) {
                        <tr data-type-row>
                          <th scope="row">{{ t.name }}</th>
                          <td class="num" [class.dt__zero]="shownCount(t) === 0">
                            @if (exactRows() && shownCount(t) > 0) {
                              <a
                                routerLink="/assets"
                                [queryParams]="link(t.query, status() ?? 'all')"
                                [attr.aria-label]="
                                  cellName(
                                    shownCount(t),
                                    status() ? statusNoun(status()!) : 'asset',
                                    t.name
                                  )
                                "
                                >{{ count(shownCount(t)) }}</a
                              >
                            } @else {
                              {{ count(shownCount(t)) }}
                            }
                          </td>
                          <td class="num" data-size-cell>
                            @for (s of shownSize(t); track s.unit) {
                              <span class="dt__unit">{{ sizeOne(s) }}</span>
                            } @empty {
                              <span class="dt__muted">No size</span>
                            }
                          </td>
                          @if (!status()) {
                            @for (c of tableColumns(); track c.key) {
                              <td class="num" [class.dt__zero]="t.counts[c.key] === 0">
                                @if (exactRows() && t.counts[c.key] > 0) {
                                  <a
                                    routerLink="/assets"
                                    [queryParams]="link(t.query, c.status)"
                                    [attr.aria-label]="cellName(t.counts[c.key], c.noun, t.name)"
                                    >{{ count(t.counts[c.key]) }}</a
                                  >
                                } @else {
                                  {{ count(t.counts[c.key]) }}
                                }
                              </td>
                            }
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </mf-chart-panel>
          </section>
        }
      }
    </mf-mm-panel>

    @if (showVolume()) {
      <mf-mm-panel
        name="data-volume"
        title="Data volume over time"
        [state]="volume.state()"
        [busy]="volume.busy()"
        (retry)="volume.load()"
      >
        <div class="dt__controls" data-volume-controls>
          @if (volumeUnits().length > 1) {
            <div class="dt__field">
              <label for="dv-unit">Unit</label>
              <select
                id="dv-unit"
                class="mf-control mf-control--compact"
                data-volume-unit
                (change)="volumeUnit.set($any($event.target).value)"
              >
                @for (u of volumeUnits(); track u) {
                  <option [value]="u" [selected]="u === unitShown()">{{ u }}</option>
                }
              </select>
            </div>
          }
          <div mfSegmented role="group" aria-label="Show the volume as">
            <button
              type="button"
              class="mf-btn"
              data-volume-as-chart
              [attr.aria-pressed]="!asTable()"
              (click)="asTable.set(false)"
            >
              Chart
            </button>
            <button
              type="button"
              class="mf-btn"
              data-volume-as-table
              [attr.aria-pressed]="asTable()"
              (click)="asTable.set(true)"
            >
              Table
            </button>
          </div>
        </div>
        @if (volume.data(); as v) {
          @if (!hasVolume()) {
            <p class="dt__muted" data-volume-empty>
              No size is recorded for the assets in this view, so there is no volume to show.
            </p>
          } @else if (asTable()) {
            <div class="dt__scroll" role="region" aria-label="Data volume by month" tabindex="0">
              <table class="dt__table" data-volume-table>
                <caption class="mf-sr-only">
                  Data volume by month, in
                  {{
                    unitShown()
                  }}: the size held at the end of each month and what came in and went out during
                  it.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col" class="num">Assets held</th>
                    <th scope="col" class="num">Size held ({{ unitShown() }})</th>
                    <th scope="col" class="num">Added</th>
                    <th scope="col" class="num">Disposed</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of volumeTable(); track r.month) {
                    <tr>
                      <th scope="row">{{ r.label }}</th>
                      <td class="num">{{ count(r.assets) }}</td>
                      <td class="num">{{ fmt(r.held) }}</td>
                      <td class="num">{{ fmt(r.added) }}</td>
                      <td class="num">{{ fmt(r.removed) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            @defer (on immediate) {
              <mf-column-chart
                heading="Size held at the end of each month"
                [rows]="chartRows()"
                [unit]="unitShown()"
                [format]="fmtFn"
                emptyText="Nothing to show."
              />
            } @placeholder {
              <p class="dt__muted" role="status">Loading the chart</p>
            }
          }
        }
      </mf-mm-panel>
    }
  `,
})
export class DataTab {
  readonly filters = input.required<MmFilters>();
  readonly canAll = input(false);
  /** The person asked for All matters from the empty state. */
  readonly showAll = output<void>();

  private readonly api = inject(MyMattersClient);
  private readonly typesApi = inject(AssetTypesClient);
  private readonly mattersApi = inject(MattersClient);
  private readonly views = inject(ViewStateService);
  private readonly quiet = inject(QuietRequests);
  private readonly auth = inject(AuthStore);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly managed = inject(ManagedMatters, { optional: true });
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly cards = phoneCards();
  protected readonly columns = DISPOSITION_COLUMNS;
  protected readonly plural = plural;
  protected readonly fmtFn = (v: number): string => this.fmt(v);

  /** What was remembered for this person (the browser's copy at first, the server's once it answers); the address wins over it. */
  private readonly remembered = signal(fromRemembered(this.views.cached('my-matters.data')));

  /** The four choices of the selection bar: the address when it says anything, else what was remembered. */
  protected readonly selection = computed<DataSelection>(() =>
    hasExplicitSelection(this.query()) ? parseSelection(this.query()) : this.remembered().selection,
  );
  protected readonly view = computed<DataView>(() =>
    hasExplicitSelection(this.query()) ? parseView(this.query()) : this.remembered().view,
  );
  protected readonly status = computed(() => parseStatus(this.query()));
  protected readonly everything = computed(() => isEverything(this.selection()));

  private today(): string {
    return todayText(this.clock, this.zone);
  }

  protected readonly loader = panelLoader(
    () => [this.filters(), this.selection()],
    () => {
      const a = commonArgs(this.filters());
      const s = selectionArgs(this.selection(), this.today());
      return this.api.getMyMattersData(
        a.scope,
        a.role,
        s.matterIds,
        s.assetTypeIds,
        s.sizeFields,
        s.from,
        s.to,
      );
    },
  );
  protected readonly data = computed(() => this.loader.data());
  /** No asset on these matters at all and nothing chosen: one muted line, no controls (issue #920). */
  protected readonly bare = computed(
    () => !!this.data() && this.data()!.totals.assets === 0 && this.everything(),
  );

  protected readonly volume = panelLoader(
    () => [this.filters(), this.selection()],
    () => {
      const a = commonArgs(this.filters());
      const s = selectionArgs(this.selection(), this.today());
      return this.api.getMyMattersDataVolume(
        a.scope,
        a.role,
        s.matterIds,
        s.assetTypeIds,
        s.sizeFields,
        s.from,
        s.to,
        VOLUME_MONTHS,
      );
    },
  );
  protected readonly asTable = signal(false);
  protected readonly volumeUnit = signal('');
  protected readonly volumeUnits = computed(() => this.volume.data()?.units ?? []);
  protected readonly unitShown = computed(() => {
    const units = this.volumeUnits();
    return units.includes(this.volumeUnit()) ? this.volumeUnit() : (units[0] ?? '');
  });
  protected readonly volumeTable = computed<VolumeRow[]>(() =>
    volumeRows(this.volume.data()?.points ?? [], this.unitShown()),
  );
  protected readonly chartRows = computed(() => volumeChartRows(this.volumeTable()));
  /** True when some month holds a size or something came in: a view without any size has nothing to chart. */
  protected readonly hasVolume = computed(() =>
    this.volumeTable().some((r) => r.held !== 0 || r.added !== 0 || r.removed !== 0),
  );

  protected readonly warningCount = computed(() => {
    const w = this.data()?.warnings;
    return (w?.inactiveLinked.assets ? 1 : 0) + (w?.awaitingDisposition.assets ? 1 : 0);
  });

  // ---- the choices of the bar

  protected readonly types = signal<AssetTypeResponse[]>([]);
  protected readonly typeOptions = computed<PickOption[]>(() =>
    this.types().map((t) => ({ id: t.assetTypeId, label: t.name })),
  );
  protected readonly showTypes = computed(
    () => this.types().length > 1 || this.selection().typeIds.length > 0,
  );

  /** Matters are not offered to a person who manages exactly one (there is nothing to choose). */
  protected readonly showMatters = computed(
    () =>
      this.selection().matterIds.length > 0 ||
      !(this.filters().scope === 'mine' && this.managed?.only()),
  );
  protected readonly matterOptions = signal<PickOption[]>([]);
  protected readonly mattersLoading = signal(false);
  /** Names of matters seen so far (the list, the answers), so a ticked matter keeps its name. */
  private readonly matterNames = signal<ReadonlyMap<number, PickOption>>(new Map());
  protected readonly chosenMatters = computed<PickOption[]>(() => {
    const names = this.matterNames();
    const fromAnswer = new Map(
      (this.data()?.selectedMatters ?? []).map((m) => [
        m.matterId,
        { id: m.matterId, label: `${m.matterRef} ${m.matterName}` },
      ]),
    );
    return this.selection().matterIds.map(
      (id) => fromAnswer.get(id) ?? names.get(id) ?? { id, label: `Matter ${id}` },
    );
  });

  /** The type rows seen so far that offer a choice of size fields; a type that a period or a matter leaves out of the answer stays choosable. */
  private readonly knownRows = signal<readonly AssetDataTypeRow[]>([]);
  protected readonly sizeRows = computed(() => this.knownRows());
  protected readonly showSizes = computed(
    () => sizeGroups(this.knownRows()).length > 0 || this.selection().sizeFields.length > 0,
  );

  constructor() {
    void this.loadTypes();
    // The server's remembered choices replace the browser's copy, unless the address already says something.
    void this.views.load('my-matters.data').then((state) => {
      if (state) this.remembered.set(fromRemembered(state));
    });
    // The rows that offer size fields are kept across answers; a change of scope starts them over.
    effect(() => {
      this.filters();
      untracked(() => {
        this.knownRows.set([]);
        this.matterOptions.set([]);
      });
    });
    effect(() => {
      const rows = this.data()?.types;
      if (!rows) return;
      untracked(() =>
        this.knownRows.update((known) => {
          const merged = new Map(known.map((r) => [r.assetTypeId, r]));
          for (const r of rows)
            if (r.numberFields.some((f) => !f.isDefault)) merged.set(r.assetTypeId, r);
          return [...merged.values()];
        }),
      );
    });
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));
  }

  private async loadTypes(): Promise<void> {
    try {
      const page = await firstValueFrom(
        this.typesApi.listAssetTypes(undefined, undefined, undefined, 1, 100, undefined),
      );
      this.types.set(page.items);
    } catch {
      this.types.set([]); // the asset type choice is then not offered; the tab still works
    }
  }

  // ---- matters: asked for from the server as the person types (a manager of many matters, or All matters)

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private matterTurn = 0;

  protected searchMatters(text: string): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.loadMatters(text), 250);
  }

  protected async loadMatters(text: string): Promise<void> {
    const mine = ++this.matterTurn;
    const f = this.filters();
    const me = this.auth.profile()?.userId;
    const byRole =
      f.scope === 'mine'
        ? f.role === 'primary'
          ? { primary: me }
          : f.role === 'secondary'
            ? { secondary: me }
            : { managed: true }
        : { manager: f.managerId ?? undefined };
    this.mattersLoading.set(true);
    try {
      const page = await this.quiet.run(() =>
        firstValueFrom(
          this.mattersApi.listMatters(
            text.trim() || undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            'primary' in byRole ? byRole.primary : undefined,
            'secondary' in byRole ? byRole.secondary : undefined,
            'manager' in byRole ? byRole.manager : undefined,
            'managed' in byRole ? true : undefined,
            undefined,
            undefined,
            undefined,
            1,
            MATTER_PAGE,
            undefined,
          ),
        ),
      );
      if (mine !== this.matterTurn) return;
      const options = page.items.map((m) => ({
        id: m.matterId,
        label: `${m.matterRef} ${m.name}`,
        hint: m.clientName,
      }));
      this.matterOptions.set(options);
      this.matterNames.update((known) => {
        const next = new Map(known);
        for (const o of options) next.set(o.id, o);
        return next;
      });
    } catch {
      if (mine === this.matterTurn) this.matterOptions.set([]);
    } finally {
      if (mine === this.matterTurn) this.mattersLoading.set(false);
    }
  }

  // ---- changes: the address is the truth, and the choice is remembered for next time

  private go(queryParams: Params): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
    });
  }

  private choose(next: DataSelection): void {
    this.go(selectionToParams(next));
    this.views.save('my-matters.data', rememberedOf(next, this.view()));
  }

  protected pickMatters(ids: number[]): void {
    this.choose({ ...this.selection(), matterIds: ids });
  }

  protected pickTypes(ids: number[]): void {
    // A size field of a type that is no longer chosen goes with it.
    const sizeFields = ids.length
      ? this.selection().sizeFields.filter((c) => ids.includes(c.typeId))
      : this.selection().sizeFields;
    this.choose({ ...this.selection(), typeIds: ids, sizeFields });
  }

  protected pickSizes(sizeFields: SizeChoice[]): void {
    this.choose({ ...this.selection(), sizeFields });
  }

  protected pickPeriod(p: PeriodChoice): void {
    this.choose({ ...this.selection(), period: p.period, from: p.from, to: p.to });
  }

  protected clearSelection(): void {
    this.choose(DEFAULT_SELECTION);
  }

  // ---- words and links

  protected inactiveLinkedText(n: number): string {
    return `${plural(n, 'asset is', 'assets are')} not active but still linked to open tasks.`;
  }

  protected awaitingText(w: { assets: number; oldestDays?: number }): string {
    const age =
      w.oldestDays === undefined ? '' : ` (oldest ${plural(w.oldestDays, 'day', 'days')})`;
    return `${plural(w.assets, 'asset waits', 'assets wait')} for disposition${age}.`;
  }

  protected count(n: number): string {
    return COUNT.format(n);
  }

  protected fmt(n: number): string {
    return formatSize(n, '');
  }

  protected sizeOne(u: AssetUnitValue): string {
    return formatSize(u.value, u.unit);
  }

  /** The size in a card's line: ". 640.2 GB" or nothing; units are listed one after the other, never added. */
  protected sizePart(size: readonly AssetUnitValue[]): string {
    const s = sizeText(size);
    return s ? `. ${s.replace(/ \+ /g, '; ')}` : '';
  }

  protected measured(t: AssetDataTypeRow): string {
    return t.measures.length
      ? t.measures.map((m) => `${m.label} (${m.unit})`).join(', ')
      : 'No size field set';
  }

  protected scopeWords(): string {
    return this.filters().scope === 'all'
      ? 'Every matter you may see.'
      : 'The matters you manage, closed ones included.';
  }

  /** "15 active assets on 90001-80001, open in the Assets list" (the visible number is the start of the name). */
  protected cellName(n: number, noun: string, whose: string): string {
    const what =
      noun === 'asset'
        ? plural(n, 'asset', 'assets')
        : `${COUNT.format(n)} ${noun} ${n === 1 ? 'asset' : 'assets'}`;
    return `${what} on ${whose}, open in the Assets list`;
  }

  /** The Assets list address for a query the API handed out (see `assetsParams`). */
  protected link(query: string, status: DataStatus | null = null): Params {
    return listParams(query, this.filters().scope, this.selection(), status);
  }

  // ---- the grid, the chart and the tiles of the status filter

  protected readonly infoOpen = signal(false);

  /** Whether a count may be a link: the Assets list can show one matter and no period. */
  protected readonly exactRows = computed(() => listIsExact(this.selection()));
  protected readonly exactWhole = computed(() => listIsExact(this.selection(), true));

  /** What the bar or pie measures: the number of assets or one unit of size (units are never added together). */
  protected readonly measure = signal('assets');
  protected readonly measureOptions = computed(() => {
    const d = this.data();
    return d ? ['assets', ...unitsOf(d)] : ['assets'];
  });
  protected readonly measureShown = computed(() =>
    this.measureOptions().includes(this.measure()) ? this.measure() : 'assets',
  );
  protected readonly measureUnit = computed(() => this.measureShown());
  protected readonly valueHeader = computed(() =>
    this.measureShown() === 'assets' ? 'Assets' : `Size (${this.measureShown()})`,
  );
  protected readonly chartFormat = computed(() => {
    const m = this.measureShown();
    return m === 'assets' ? (v: number) => COUNT.format(v) : (v: number) => formatSize(v, m);
  });
  protected readonly chartData = computed<ChartRow[]>(() => {
    const d = this.data();
    if (!d) return [];
    const exact = this.exactRows();
    const status = this.status();
    return typeChartRows(d, this.measureShown(), status, (t) =>
      exact ? { commands: ['/assets'], queryParams: this.link(t.query, status ?? 'all') } : null,
    );
  });

  /** The Inactive column appears only when some asset is inactive. */
  protected readonly tableColumns = computed(() =>
    DISPOSITION_COLUMNS.filter(
      (c) => c.key !== 'inactive' || (this.data()?.totals.inactive ?? 0) > 0,
    ),
  );

  protected shownCount(t: AssetDataTypeRow): number {
    return countOf(t.counts, this.status());
  }

  protected shownSize(t: AssetDataTypeRow): AssetUnitValue[] {
    return sizeOf(t, this.status()).filter((s) => s.assets > 0);
  }

  protected statusLabel(s: DataStatus): string {
    return DISPOSITION_COLUMNS.find((c) => c.status === s)?.label ?? 'Assets';
  }

  /** "pending disposition" as a noun for a link's name. */
  protected statusNoun(s: DataStatus): string {
    return DISPOSITION_COLUMNS.find((c) => c.status === s)?.noun ?? 'asset';
  }

  protected statusWord(s: DataStatus): string {
    return this.statusNoun(s);
  }

  protected setView(kind: ChartKind): void {
    this.go({ dv: kind === 'table' ? null : kind, dp: this.selection().period });
    this.views.save('my-matters.data', rememberedOf(this.selection(), kind));
  }

  protected pickStatus(status: DataStatus | null): void {
    this.go({ dstatus: status === null || status === this.status() ? null : status });
  }

  /** The volume over time is drawn only when assets were added over at least three different months: before that it would be a flat line (README, Q9). */
  protected readonly showVolume = computed(
    () =>
      this.volume.state() === 'ready' &&
      (this.volume.data()?.points.filter((p) => p.assetsAdded > 0).length ?? 0) >= 3,
  );

  /**
   * The headline numbers: total assets, total size (one tile per unit when units meet, so they are never added together), then the four states. A status
   * tile with something in it is a button that filters the grid; a zero is muted and quiet.
   */
  protected readonly tiles = computed<DataTile[]>(() => {
    const d = this.data();
    if (!d) return [];
    const t = d.totals;
    const sizes = t.size.filter((s) => s.assets > 0);
    const out: DataTile[] = [
      {
        key: 'assets',
        label: 'Total assets',
        value: this.count(t.assets),
        unit: '',
        note: '',
        muted: t.assets === 0,
        status: null,
      },
    ];
    if (sizes.length <= 1) {
      const one = sizes[0];
      out.push({
        key: 'size',
        label: 'Total size',
        value: one ? this.fmt(one.value) : 'None',
        unit: one?.unit ?? '',
        note: one ? '' : 'no size recorded',
        muted: !one,
        status: null,
      });
    } else {
      for (const u of sizes) {
        out.push({
          key: `size-${u.unit}`,
          label: `Total size in ${u.unit}`,
          value: this.fmt(u.value),
          unit: '',
          note: '',
          muted: false,
          status: null,
        });
      }
    }
    const oldest = d.warnings.awaitingDisposition.oldestDays;
    for (const c of DISPOSITION_COLUMNS) {
      const n = t[c.key];
      out.push({
        key: c.status,
        label: c.label,
        value: this.count(n),
        unit: '',
        note:
          c.status === 'pending' && n > 0 && oldest !== undefined
            ? `oldest ${plural(oldest, 'day', 'days')}`
            : '',
        muted: n === 0,
        status: n > 0 || this.status() === c.status ? c.status : null,
      });
    }
    return out;
  });
}
