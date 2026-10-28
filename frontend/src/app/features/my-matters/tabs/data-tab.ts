import { toSignal } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
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
  AssetDataCounts,
  AssetDataMatterRow,
  AssetDataTypeRow,
  AssetTypeResponse,
  AssetReportsClient,
  AssetTypesClient,
  MyMattersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ColumnChart } from '../../../shared/charts/column-chart';
import { Badge } from '../../../shared/ui/badge';
import { matterLinkOf } from '../../../shared/ui/matter-link';
import {
  RecordCard,
  RecordCardDef,
  RecordCardList,
  phoneCards,
} from '../../../shared/ui/record-card-list';
import { formatSize } from '../../assets/disposition/asset-size';
import {
  DataStatus,
  SIZE_UNITS,
  VolumeRow,
  assetsParams,
  sizeText,
  volumeChartRows,
  volumeRows,
} from '../data-model';
import { MmFilters, commonArgs } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { Segmented } from '../../../shared/ui/segmented';
import { PanelBox } from '../panels/panel-box';

const COUNT = new Intl.NumberFormat('en-US');
const MONTH_CHOICES = [12, 24, 36] as const;

/** The four disposition columns of a table or card, in the order of a record's life. */
const DISPOSITION_COLUMNS: readonly {
  key: 'active' | 'inactive' | 'pendingDisposition' | 'disposed';
  status: DataStatus;
  label: string;
  noun: string;
}[] = [
  { key: 'active', status: 'active', label: 'Active', noun: 'active' },
  { key: 'inactive', status: 'inactive', label: 'Inactive', noun: 'inactive' },
  { key: 'pendingDisposition', status: 'pending', label: 'Pending', noun: 'pending disposition' },
  { key: 'disposed', status: 'disposed', label: 'Disposed', noun: 'disposed' },
];

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
    Badge,
    ColumnChart,
    PanelBox,
    RecordCard,
    RecordCardDef,
    RecordCardList,
    RouterLink,
    Segmented,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: grid;
      gap: var(--mf-s3);
      min-width: 0;
    }
    .dt__controls {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: var(--mf-s2) var(--mf-s3);
      margin-bottom: var(--mf-s3);
    }
    .dt__field {
      display: grid;
      /* One column that may shrink: an asset type with a very long name must not make the select, and the page, wider than a phone (PV-38). */
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
    .dt__note {
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .dt__note--tight {
      margin: var(--mf-s2) 0 0;
    }
    .dt__h3 {
      margin: var(--mf-s3) 0 var(--mf-s1);
      font-size: var(--mf-fs-md);
      font-weight: 700;
    }
    .dt__warn {
      margin: 0 0 var(--mf-s3);
      padding: 0;
      list-style: none;
      display: grid;
      gap: var(--mf-s1);
    }
    .dt__warn li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt, var(--mf-surface));
    }
    .dt__warn .pi {
      color: var(--mf-warning-text, var(--mf-text));
    }
    .dt__warn a,
    .dt__show {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      color: var(--mf-link);
      text-decoration: underline;
    }
    .dt__strip {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2) var(--mf-s4, 1.5rem);
      margin: 0 0 var(--mf-s3);
      padding: 0;
    }
    .dt__strip div {
      min-width: 0;
    }
    .dt__strip dt {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .dt__strip dd {
      margin: 0;
      font-size: var(--mf-fs-lg);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .dt__strip dd a {
      display: inline-block;
      min-width: 24px;
      min-height: 24px;
      color: var(--mf-link);
      text-decoration: underline;
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
    .dt__table tfoot th,
    .dt__table tfoot td {
      border-top: 2px solid var(--mf-border-strong);
      font-weight: 700;
    }
    .dt__table .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .dt__table td a,
    .dt__table th a {
      display: inline-block;
      min-width: 24px;
      min-height: 24px;
      line-height: 24px;
      color: var(--mf-link);
      text-decoration: underline;
    }
    .dt__client,
    .dt__muted {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .dt__client {
      display: block;
    }
    .dt__closed {
      margin-left: var(--mf-s1);
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
      .dt__controls select,
      .dt__empty .mf-btn {
        min-height: 44px;
      }
      .dt__show {
        min-height: 44px;
      }
      .dt__controls .dt__field {
        flex: 1 1 100%;
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
        <div class="dt__controls" data-data-controls>
          <div class="dt__field">
            <label for="dt-type">Asset type</label>
            <select
              id="dt-type"
              class="mf-control"
              data-data-type
              (change)="pickType($any($event.target).value)"
            >
              <option value="" [selected]="typeId() === null">All asset types</option>
              @for (t of types(); track t.assetTypeId) {
                <option [value]="t.assetTypeId" [selected]="t.assetTypeId === typeId()">
                  {{ t.name }}
                </option>
              }
            </select>
          </div>
          @if (typeId() !== null) {
            <div class="dt__field">
              <label for="dt-field">Size field</label>
              <select
                id="dt-field"
                class="mf-control"
                data-data-field
                (change)="pickField($any($event.target).value)"
              >
                <option value="" [selected]="!fieldKey()">{{ defaultLabel() }}</option>
                @for (f of numberFields(); track f.key) {
                  <option [value]="f.key" [selected]="f.key === fieldKey()">
                    {{ f.label }} ({{ f.key }})
                  </option>
                }
              </select>
            </div>
            @if (needsUnit()) {
              <div class="dt__field">
                <label for="dt-unit">Unit of this field</label>
                <select
                  id="dt-unit"
                  class="mf-control"
                  data-data-unit
                  (change)="pickUnit($any($event.target).value)"
                >
                  <option value="" [selected]="!unit()">Choose a unit</option>
                  @for (u of units; track u) {
                    <option [value]="u" [selected]="u === unit()">{{ u }}</option>
                  }
                </select>
              </div>
            }
          }
        </div>
      }
      @if (needsUnit() && !unit()) {
        <p class="dt__note" data-unit-needed>
          Choose the unit of this field to measure it. Until then the size is the asset type's
          default.
        </p>
      }
      @if (filters().clientId !== null || filters().managerId !== null) {
        <p class="dt__note" data-filters-note>
          The Client and Project manager filters do not apply to Data. Choose a matter in the table.
        </p>
      }

      @if (data(); as d) {
        @if (d.totals.assets === 0) {
          <div class="dt__empty" data-empty>
            @if (filters().scope === 'all') {
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
          <section aria-labelledby="dt-warn-h" data-warnings>
            <h3 class="dt__h3" id="dt-warn-h">Warnings ({{ warningCount() }})</h3>
            @if (warningCount() === 0) {
              <p class="dt__note" data-no-warnings>
                <i class="pi pi-check-circle" aria-hidden="true"></i>
                No warnings: no asset that is not active is linked to an open task, and none waits
                for disposition.
              </p>
            } @else {
              <ul class="dt__warn">
                @if (d.warnings.inactiveLinked.assets > 0) {
                  <li data-warning="inactive-linked">
                    <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                    <span>{{ inactiveLinkedText(d.warnings.inactiveLinked.assets) }}</span>
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
                  </li>
                }
                @if (d.warnings.awaitingDisposition.assets > 0) {
                  <li data-warning="awaiting-disposition">
                    <i class="pi pi-clock" aria-hidden="true"></i>
                    <span>{{ awaitingText(d.warnings.awaitingDisposition) }}</span>
                    <a
                      class="dt__show"
                      routerLink="/assets"
                      [queryParams]="link(d.warnings.awaitingDisposition.query)"
                      [attr.aria-label]="
                        'Show the ' +
                        plural(d.warnings.awaitingDisposition.assets, 'asset', 'assets') +
                        ' that wait for disposition, in the Assets list'
                      "
                      >Show</a
                    >
                  </li>
                }
              </ul>
            }
          </section>

          <dl class="dt__strip" data-totals>
            <div>
              <dt>Assets</dt>
              <dd>
                <a
                  routerLink="/assets"
                  [queryParams]="link(d.scopeQuery, 'all')"
                  data-total-assets
                  >{{ count(d.totals.assets) }}</a
                >
              </dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd data-total-size>{{ size(d.totals) }}</dd>
            </div>
            @for (c of columns; track c.key) {
              <div>
                <dt>{{ c.label }}</dt>
                <dd>{{ count(d.totals[c.key]) }}</dd>
              </div>
            }
          </dl>
          @if (d.unitsWarning) {
            <p class="dt__note" data-units-warning>
              <i class="pi pi-info-circle" aria-hidden="true"></i> {{ d.unitsWarning }}
            </p>
          }

          <h3 class="dt__h3" id="dt-matters-h">By matter</h3>
          @if (cards()) {
            <mf-record-card-list
              state="ready"
              noun="matters"
              label="Assets by matter"
              [empty]="false"
              data-matter-cards
            >
              <ng-template [mfRecordCard]="d.matters" let-m>
                <mf-record-card
                  [name]="m.matterRef + ' ' + m.matterName"
                  [link]="matterLink(m) ?? ['/assets']"
                  [queryParams]="matterQuery(m)"
                  list="my-matters-data"
                  [rowKey]="m.matterId"
                >
                  <span mfCardBadges>
                    @if (!m.matterIsActive) {
                      <mf-badge tone="neutral" icon="pi-lock">Closed</mf-badge>
                    }
                  </span>
                  <ng-container mfCardMeta>
                    <p class="rc-line">
                      <span class="rc-text">{{ m.clientName }}</span>
                    </p>
                    <p class="rc-line" data-card-numbers>
                      <span class="rc-text"
                        >{{ plural(m.counts.assets, 'asset', 'assets') }}
                        {{ sizePart(m.counts) }}</span
                      >
                    </p>
                  </ng-container>
                  <ng-container mfCardCounts>
                    <ul class="dt__chips">
                      @for (c of columns; track c.key) {
                        @if (m.counts[c.key] > 0) {
                          <li>
                            <a
                              routerLink="/assets"
                              [queryParams]="link(m.query, c.status)"
                              [attr.aria-label]="cellName(m.counts[c.key], c.noun, m.matterRef)"
                              >{{ c.label }} {{ count(m.counts[c.key]) }}</a
                            >
                          </li>
                        }
                      }
                    </ul>
                  </ng-container>
                </mf-record-card>
              </ng-template>
            </mf-record-card-list>
          } @else {
            <div class="dt__scroll" role="region" aria-label="Assets by matter" tabindex="0">
              <table class="dt__table" data-matters-table>
                <caption class="mf-sr-only">
                  Assets by matter: how many, how much data and in what state.
                  {{
                    scopeWords()
                  }}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Matter</th>
                    <th scope="col" class="num">Assets</th>
                    <th scope="col" class="num">Size</th>
                    @for (c of columns; track c.key) {
                      <th scope="col" class="num">{{ c.label }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (m of d.matters; track m.matterId) {
                    <tr data-matter-row>
                      <th scope="row">
                        @if (matterLink(m); as l) {
                          <a [routerLink]="l" [queryParams]="matterQuery(m)"
                            >{{ m.matterRef }} {{ m.matterName }}</a
                          >
                        } @else {
                          {{ m.matterRef }} {{ m.matterName }}
                        }
                        @if (!m.matterIsActive) {
                          <span class="dt__muted dt__closed">(closed)</span>
                        }
                        <span class="dt__client">{{ m.clientName }}</span>
                      </th>
                      <td class="num">
                        <a
                          routerLink="/assets"
                          [queryParams]="link(m.query, 'all')"
                          [attr.aria-label]="cellName(m.counts.assets, 'asset', m.matterRef)"
                          >{{ count(m.counts.assets) }}</a
                        >
                      </td>
                      <td class="num">{{ size(m.counts) }}</td>
                      @for (c of columns; track c.key) {
                        <td class="num">
                          @if (m.counts[c.key] > 0) {
                            <a
                              routerLink="/assets"
                              [queryParams]="link(m.query, c.status)"
                              [attr.aria-label]="cellName(m.counts[c.key], c.noun, m.matterRef)"
                              >{{ count(m.counts[c.key]) }}</a
                            >
                          } @else {
                            0
                          }
                        </td>
                      }
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr data-matters-total>
                    <th scope="row">
                      {{ filters().scope === 'all' ? 'All matters' : 'All my matters' }}
                    </th>
                    <td class="num">{{ count(d.totals.assets) }}</td>
                    <td class="num">{{ size(d.totals) }}</td>
                    @for (c of columns; track c.key) {
                      <td class="num">{{ count(d.totals[c.key]) }}</td>
                    }
                  </tr>
                </tfoot>
              </table>
            </div>
          }

          <h3 class="dt__h3" id="dt-types-h">By asset type</h3>
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
                        >{{ plural(t.counts.assets, 'asset', 'assets') }}
                        {{ sizePart(t.counts) }}</span
                      >
                    </p>
                    <p class="rc-line">
                      <span class="rc-text">{{ measured(t) }}</span>
                    </p>
                  </ng-container>
                  <ng-container mfCardCounts>
                    <ul class="dt__chips">
                      @for (c of columns; track c.key) {
                        @if (t.counts[c.key] > 0) {
                          <li>
                            <a
                              routerLink="/assets"
                              [queryParams]="link(t.query, c.status)"
                              [attr.aria-label]="cellName(t.counts[c.key], c.noun, t.name)"
                              >{{ c.label }} {{ count(t.counts[c.key]) }}</a
                            >
                          </li>
                        }
                      }
                    </ul>
                  </ng-container>
                </mf-record-card>
              </ng-template>
            </mf-record-card-list>
          } @else {
            <div class="dt__scroll" role="region" aria-label="Assets by asset type" tabindex="0">
              <table class="dt__table" data-types-table>
                <caption class="mf-sr-only">
                  Assets by asset type, with the size field each is measured by.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Asset type</th>
                    <th scope="col" class="num">Assets</th>
                    <th scope="col" class="num">Size</th>
                    <th scope="col">Measured by</th>
                    @for (c of columns; track c.key) {
                      <th scope="col" class="num">{{ c.label }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (t of d.types; track t.assetTypeId) {
                    <tr data-type-row>
                      <th scope="row">{{ t.name }}</th>
                      <td class="num">
                        <a
                          routerLink="/assets"
                          [queryParams]="link(t.query, 'all')"
                          [attr.aria-label]="cellName(t.counts.assets, 'asset', t.name)"
                          >{{ count(t.counts.assets) }}</a
                        >
                      </td>
                      <td class="num">{{ size(t.counts) }}</td>
                      <td class="dt__muted">{{ measured(t) }}</td>
                      @for (c of columns; track c.key) {
                        <td class="num">
                          @if (t.counts[c.key] > 0) {
                            <a
                              routerLink="/assets"
                              [queryParams]="link(t.query, c.status)"
                              [attr.aria-label]="cellName(t.counts[c.key], c.noun, t.name)"
                              >{{ count(t.counts[c.key]) }}</a
                            >
                          } @else {
                            0
                          }
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          <p class="dt__note dt__note--tight">
            Size is the number field each asset type is measured by (set on the asset type). Assets
            without a value add nothing to the size. Each number opens the Assets list with exactly
            those assets.
          </p>
        }
      }
    </mf-mm-panel>

    @if (!bare()) {
      <mf-mm-panel
        name="data-volume"
        title="Data volume over time"
        [state]="volume.state()"
        [busy]="volume.busy()"
        (retry)="volume.load()"
      >
        <div class="dt__controls" data-volume-controls>
          <div class="dt__field">
            <label for="dv-matter">Matter</label>
            <select
              id="dv-matter"
              class="mf-control"
              data-volume-matter
              (change)="pickMatter($any($event.target).value)"
            >
              <option value="" [selected]="matterId() === null">
                {{ filters().scope === 'all' ? 'All matters' : 'All my matters' }}
              </option>
              @for (m of data()?.matters ?? []; track m.matterId) {
                <option [value]="m.matterId" [selected]="m.matterId === matterId()">
                  {{ m.matterRef }} {{ m.matterName }}
                </option>
              }
            </select>
          </div>
          <div class="dt__field">
            <label for="dv-months">Period</label>
            <select
              id="dv-months"
              class="mf-control"
              data-volume-months
              (change)="pickMonths($any($event.target).value)"
            >
              @for (n of monthChoices; track n) {
                <option [value]="n" [selected]="n === months()">Last {{ n }} months</option>
              }
            </select>
          </div>
          @if (volumeUnits().length > 1) {
            <div class="dt__field">
              <label for="dv-unit">Unit</label>
              <select
                id="dv-unit"
                class="mf-control"
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
              data-show-chart
              [attr.aria-pressed]="!asTable()"
              (click)="asTable.set(false)"
            >
              Chart
            </button>
            <button
              type="button"
              class="mf-btn"
              data-show-table
              [attr.aria-pressed]="asTable()"
              (click)="asTable.set(true)"
            >
              Table
            </button>
          </div>
        </div>
        @if (volume.data(); as v) {
          @if (v.units.length > 1 && v.unitsWarning) {
            <p class="dt__note" data-volume-units-warning>
              <i class="pi pi-info-circle" aria-hidden="true"></i> {{ v.unitsWarning }}
            </p>
          }
          @if (!hasVolume()) {
            <p class="dt__muted" data-volume-empty>
              No size is recorded for the assets in this view, so there is no volume to show. Set a
              size field on the asset type.
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
          <p class="dt__note dt__note--tight" data-volume-limit>{{ v.limitation }}</p>
          <p class="dt__note dt__note--tight">
            The size held leaves out disposed assets; the table above counts them.
          </p>
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
  private readonly reportsApi = inject(AssetReportsClient);
  private readonly auth = inject(AuthStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly cards = phoneCards();
  protected readonly columns = DISPOSITION_COLUMNS;
  protected readonly units = SIZE_UNITS;
  protected readonly monthChoices = MONTH_CHOICES;
  protected readonly plural = plural;
  protected readonly fmtFn = (v: number): string => this.fmt(v);

  /** The size override of this view, in the address: `?dataType=&dataField=&dataUnit=`. */
  protected readonly typeId = computed<number | null>(() => {
    const n = Number(this.query().get('dataType'));
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  protected readonly fieldKey = computed(() =>
    this.typeId() === null ? '' : (this.query().get('dataField') ?? ''),
  );
  protected readonly unit = computed(() => {
    const u = this.query().get('dataUnit') ?? '';
    return (SIZE_UNITS as readonly string[]).includes(u) ? u : '';
  });
  protected readonly types = signal<AssetTypeResponse[]>([]);
  protected readonly numberFields = signal<{ key: string; label: string }[]>([]);
  private readonly selectedType = computed(
    () => this.types().find((t) => t.assetTypeId === this.typeId()) ?? null,
  );
  /** A field other than the type's default needs its unit. */
  protected readonly needsUnit = computed(
    () => this.fieldKey() !== '' && this.fieldKey() !== this.selectedType()?.sizeFieldKey,
  );
  protected readonly defaultLabel = computed(() => {
    const t = this.selectedType();
    return t?.sizeFieldKey
      ? `Default: ${t.sizeFieldKey} (${t.sizeUnit ?? 'no unit'})`
      : 'Default: this type has no size field';
  });

  /** What the Data request measures: the type's default, or a chosen field with its unit once both are chosen. */
  private readonly measure = computed(() => {
    const type = this.typeId();
    if (type === null) return { type: undefined, field: undefined, unit: undefined };
    const field = this.fieldKey();
    if (!field) return { type, field: undefined, unit: undefined };
    if (!this.needsUnit()) return { type, field, unit: undefined };
    return this.unit()
      ? { type, field, unit: this.unit() }
      : { type, field: undefined, unit: undefined };
  });

  protected readonly matterId = signal<number | null>(null);
  protected readonly months = signal<number>(12);
  protected readonly asTable = signal(false);
  protected readonly volumeUnit = signal('');

  protected readonly loader = panelLoader(
    () => [this.filters(), this.measure()],
    () => {
      const a = commonArgs(this.filters());
      const m = this.measure();
      return this.api.getMyMattersData(a.scope, a.role, m.type, m.field, m.unit);
    },
  );
  protected readonly data = computed(() => this.loader.data());
  /** No asset on these matters at all (and no asset type chosen): one muted line, no controls (issue #920). */
  protected readonly bare = computed(
    () => !!this.data() && this.data()!.totals.assets === 0 && this.typeId() === null,
  );

  protected readonly volume = panelLoader(
    () => [this.filters(), this.measure(), this.matterId(), this.months()],
    () => {
      const a = commonArgs(this.filters());
      const m = this.measure();
      return this.api.getMyMattersDataVolume(
        a.scope,
        a.role,
        m.type,
        m.field,
        m.unit,
        this.matterId() ?? undefined,
        this.months(),
      );
    },
  );
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

  constructor() {
    void this.loadTypes();
    // The chosen type's number fields are the choices for the size field.
    effect(() => {
      const id = this.typeId();
      untracked(() => void this.loadFields(id));
    });
    // A matter of the other scope is not in this one: the chart goes back to all of them.
    effect(() => {
      this.filters(); // a change of scope (or any filter) drops the chosen matter
      untracked(() => this.matterId.set(null));
    });
  }

  private fieldsTurn = 0;

  private async loadFields(id: number | null): Promise<void> {
    const mine = ++this.fieldsTurn;
    if (id === null) {
      this.numberFields.set([]);
      return;
    }
    try {
      // The report builder's field list (Asset.View): the number fields of the published form, no form administration needed.
      const fields = await firstValueFrom(this.reportsApi.getAssetReportFields(id));
      if (mine !== this.fieldsTurn) return;
      this.numberFields.set(fields.numberFields.map((f) => ({ key: f.key, label: f.label })));
    } catch {
      // A type without a published form has no number fields; the size is then the type's default.
      if (mine === this.fieldsTurn) this.numberFields.set([]);
    }
  }

  private async loadTypes(): Promise<void> {
    try {
      const page = await firstValueFrom(
        this.typesApi.listAssetTypes(undefined, undefined, undefined, 1, 100, undefined),
      );
      this.types.set(page.items);
    } catch {
      this.types.set([]); // the size override is then not offered; the tab still works
    }
  }

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

  protected size(c: AssetDataCounts): string {
    return sizeText(c.size) || 'No size';
  }

  /** The size in a card's line: ", 640.2 GB" or nothing. */
  protected sizePart(c: AssetDataCounts): string {
    const s = sizeText(c.size);
    return s ? `. ${s}` : '';
  }

  protected measured(t: AssetDataTypeRow): string {
    return t.sizeFieldKey ? `${t.sizeFieldKey} (${t.sizeUnit ?? 'no unit'})` : 'No size field set';
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
    return assetsParams(query, this.filters().scope, status);
  }

  protected matterLink(m: AssetDataMatterRow): ['/matters', number] | null {
    return matterLinkOf(this.auth, m.matterId);
  }

  protected matterQuery(m: AssetDataMatterRow): Params {
    return this.matterLink(m) ? { tab: 'assets' } : this.link(m.query, 'all');
  }

  private go(queryParams: Params): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
    });
  }

  protected pickType(value: string): void {
    this.go({ dataType: value || null, dataField: null, dataUnit: null });
  }

  protected pickField(value: string): void {
    this.go({ dataField: value || null, dataUnit: null });
  }

  protected pickUnit(value: string): void {
    this.go({ dataUnit: value || null });
  }

  protected pickMatter(value: string): void {
    const id = Number(value);
    this.matterId.set(Number.isInteger(id) && id > 0 ? id : null);
  }

  protected pickMonths(value: string): void {
    const n = Number(value);
    if ((MONTH_CHOICES as readonly number[]).includes(n)) this.months.set(n);
  }
}
