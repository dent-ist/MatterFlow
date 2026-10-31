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
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AssetTypesClient } from '../../../api/generated/api-client';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { GridFrame } from '../../../shared/ui/grid-frame';
import { Pager } from '../../../shared/ui/pager';
import { StatusChip } from '../../../shared/ui/status-chip';
import { MmFilters } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { AssetQuery, MmApi } from './mm-api';
import { AssetRow, AssetStatusCode } from './mm-models';

const PAGE_SIZE = 25;

export const ASSET_STATUS: Readonly<Record<AssetStatusCode, { label: string; icon: string }>> = {
  ACTIVE: { label: 'Active', icon: 'pi-check-circle' },
  INACTIVE: { label: 'Inactive', icon: 'pi-minus-circle' },
  PENDING_DISPOSITION: { label: 'Pending disposition', icon: 'pi-clock' },
  DISPOSED: { label: 'Disposed', icon: 'pi-trash' },
};

const HEADS = [
  { label: 'Client', sort: 'client', cls: 'c-cl' },
  { label: 'Matter', sort: 'matter', cls: 'c-ma' },
  { label: 'Asset type', sort: 'assetType', cls: 'c-ty' },
  { label: 'Created', sort: 'created', cls: 'c-cr' },
  { label: 'Updated', sort: 'updated', cls: 'c-up' },
  { label: 'Status', sort: 'status', cls: 'c-st' },
] as const;

/**
 * The Assets tab (`mf-mm-assets-tab`, epic #953 UI-16): the assets of the person's matters in a grid with the columns client, matter, asset type (the name on the first line,
 * the type under it), created, updated and status (Active, Inactive, Pending disposition, Disposed). There is NO comment column: comments exist only on tasks. A search box and
 * filters for type, status and the two date ranges narrow it; every heading sorts (`aria-sort`); 25 a page inside a frame that scrolls. A row opens the side panel: the fields, the
 * size, the dates, a link to the asset, and the linked tasks with the latest comment of each task. An asset item of the activity feed opens this tab with `?asset=` set.
 */
@Component({
  selector: 'mf-mm-assets-tab',
  imports: [GridFrame, MfDatePipe, Pager, RouterLink, StatusChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <div class="as" [class.with-side]="assetId() !== null">
      <mf-grid-frame scrollLabel="Assets" [resetKey]="resetKey()">
        <div frameHead class="hd">
          <h2 class="ttl">
            Assets <span class="tot">{{ total() }}</span>
          </h2>
          <label class="srch">
            <span class="sr">Search assets</span>
            <i class="pi pi-search" aria-hidden="true"></i>
            <input
              type="search"
              data-asset-search
              placeholder="Search assets"
              [value]="q()"
              (input)="setQ($any($event.target).value)"
            />
          </label>
        </div>
        <div frameStatus class="flt" role="group" aria-label="Asset filters">
          <label
            >Type
            <select data-f-type [value]="type()" (change)="type.set($any($event.target).value)">
              <option value="">All types</option>
              @for (t of types(); track t.id) {
                <option [value]="t.id">{{ t.name }}</option>
              }
            </select>
          </label>
          <label
            >Status
            <select
              data-f-status
              [value]="status()"
              (change)="status.set($any($event.target).value)"
            >
              <option value="">All statuses</option>
              @for (s of statusKeys; track s) {
                <option [value]="s">{{ statusMap[s].label }}</option>
              }
            </select>
          </label>
          <button
            type="button"
            class="lnk dt"
            data-dates
            [attr.aria-expanded]="dates()"
            (click)="dates.set(!dates())"
          >
            <i class="pi pi-calendar" aria-hidden="true"></i> Dates
            <i
              class="pi"
              [class]="dates() ? 'pi-angle-up' : 'pi-angle-down'"
              aria-hidden="true"
            ></i>
          </button>
          @if (dates()) {
            <label
              >Created from
              <input
                type="date"
                [value]="createdFrom()"
                (change)="createdFrom.set($any($event.target).value)"
            /></label>
            <label
              >to
              <input
                type="date"
                [value]="createdTo()"
                (change)="createdTo.set($any($event.target).value)"
            /></label>
            <label
              >Updated from
              <input
                type="date"
                [value]="updatedFrom()"
                (change)="updatedFrom.set($any($event.target).value)"
            /></label>
            <label
              >to
              <input
                type="date"
                [value]="updatedTo()"
                (change)="updatedTo.set($any($event.target).value)"
            /></label>
          }
          @if (filtered()) {
            <button type="button" class="lnk" data-clear-filters (click)="clearFilters()">
              Clear filters
            </button>
          }
        </div>

        @if (list.state() === 'error') {
          <p class="msg" role="alert">
            Couldn't load assets.
            <button type="button" class="lnk" (click)="list.load()">Retry</button>
          </p>
        } @else if (list.state() === 'loading' && rows().length === 0) {
          <p class="msg" role="status">Loading assets</p>
        } @else if (rows().length === 0) {
          <p class="msg" data-empty>
            {{ filtered() ? 'No assets match these filters.' : 'No assets on these matters yet.' }}
          </p>
        } @else {
          <table class="tt" [attr.aria-busy]="list.busy()">
            <caption class="sr">
              Assets
            </caption>
            <thead>
              <tr>
                @for (h of heads; track h.sort) {
                  <th scope="col" [class]="h.cls" [attr.aria-sort]="ariaSort(h.sort)">
                    <button
                      type="button"
                      class="sort"
                      [attr.data-sort]="h.sort"
                      (click)="sortBy(h.sort)"
                    >
                      {{ h.label }} <i class="pi" [class]="sortIcon(h.sort)" aria-hidden="true"></i>
                    </button>
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (a of rows(); track a.assetId) {
                <tr [class.sel]="a.assetId === assetId()" [attr.data-asset]="a.assetId">
                  <td class="c-cl">{{ a.clientName }}</td>
                  <td class="c-ma">{{ a.matterRef }} {{ a.matterName }}</td>
                  <td class="c-ty">
                    <button
                      type="button"
                      class="open"
                      [attr.data-open]="a.assetId"
                      [attr.aria-pressed]="a.assetId === assetId()"
                      (click)="assetChange.emit(a.assetId)"
                    >
                      <b>{{ a.name }}</b
                      ><span class="m">{{ a.assetTypeName }}</span>
                    </button>
                  </td>
                  <td class="c-cr">{{ a.createdAtUtc | mfDate: 'date' }}</td>
                  <td class="c-up">
                    {{ a.updatedAtUtc ? (a.updatedAtUtc | mfDate: 'date') : 'Never' }}
                  </td>
                  <td class="c-st">
                    <span class="ast" [attr.data-status]="a.statusCode"
                      ><i class="pi" [class]="statusMap[a.statusCode].icon" aria-hidden="true"></i
                      >{{ statusMap[a.statusCode].label }}</span
                    >
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
        <div frameFoot>
          @if (total() > pageSize) {
            <mf-pager
              [page]="page()"
              [pageSize]="pageSize"
              [pageSizes]="[]"
              [total]="total()"
              (pageChange)="pageChange.emit($event)"
            />
          }
        </div>
      </mf-grid-frame>

      @if (assetId() !== null) {
        <aside class="side" aria-label="Asset details" data-asset-panel>
          <div class="sh">
            <h2 tabindex="-1" data-side-title>{{ detail.data()?.name ?? 'Asset' }}</h2>
            <button
              type="button"
              class="x"
              data-close-asset
              aria-label="Close the asset details"
              (click)="assetChange.emit(null)"
            >
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </div>
          @if (detail.state() === 'error') {
            <p class="msg" role="alert">This asset is not available.</p>
          } @else if (detail.data(); as d) {
            <dl class="kv">
              <dt>Client</dt>
              <dd>{{ d.clientName }}</dd>
              <dt>Matter</dt>
              <dd>{{ d.matterRef }} {{ d.matterName }}</dd>
              <dt>Asset type</dt>
              <dd>{{ d.assetTypeName }}</dd>
              <dt>Status</dt>
              <dd>
                <span class="ast" [attr.data-status]="d.statusCode"
                  ><i class="pi" [class]="statusMap[d.statusCode].icon" aria-hidden="true"></i
                  >{{ statusMap[d.statusCode].label }}</span
                >
              </dd>
              <dt>Created</dt>
              <dd>{{ d.createdAtUtc | mfDate }} by {{ d.createdByName }}</dd>
              <dt>Updated</dt>
              <dd>{{ d.updatedAtUtc ? (d.updatedAtUtc | mfDate) : 'Never' }}</dd>
              @if (d.sizeValue) {
                <dt>Size</dt>
                <dd>{{ d.sizeValue }} {{ d.sizeUnit }}</dd>
              }
              @if (d.externalReference) {
                <dt>Reference</dt>
                <dd>{{ d.externalReference }}</dd>
              }
              @if (d.description) {
                <dt>Description</dt>
                <dd>{{ d.description }}</dd>
              }
            </dl>
            <p><a class="lnk" [routerLink]="['/assets', d.assetId]">Open the asset</a></p>
            <h3>Linked tasks</h3>
            @if (d.linkedTasks.length === 0) {
              <p class="msg">No tasks are linked to this asset.</p>
            } @else {
              <ul class="lt">
                @for (t of d.linkedTasks; track t.taskId) {
                  <li>
                    <div class="l1">
                      <a class="lnk" [routerLink]="['/tasks', t.taskId]"
                        >{{ t.taskNumber }} {{ t.title }}</a
                      >
                      <mf-status-chip [code]="t.statusCode" />
                    </div>
                    <div class="m">
                      @if (t.isOverdue) {
                        <span class="od"
                          ><i class="pi pi-exclamation-circle" aria-hidden="true"></i> Overdue</span
                        >
                        ·
                      }
                      @if (t.dueDate) {
                        due {{ t.dueDate | mfDate }}
                      } @else {
                        no due date
                      }
                      @if (t.assigneeName) {
                        · {{ t.assigneeName }}
                      }
                    </div>
                    @if (t.latestComment; as c) {
                      <blockquote class="cm">
                        <span class="m"
                          >{{ c.authorName }}, {{ c.createdAtUtc | mfDate: 'date' }}</span
                        >
                        {{ c.excerpt }}
                      </blockquote>
                    }
                  </li>
                }
              </ul>
            }
          } @else {
            <p class="msg" role="status">Loading</p>
          }
        </aside>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
    }
    .as {
      display: flex;
      gap: var(--mf-s3);
      height: 100%;
      min-height: 0;
    }
    mf-grid-frame {
      flex: 1 1 0;
      min-width: 0;
    }
    .hd {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--mf-s2) var(--mf-s4);
      padding: var(--mf-s3) var(--mf-s4);
    }
    .ttl {
      margin: 0;
      font-size: var(--mf-fs-lg);
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .tot {
      padding: 0 var(--mf-s2);
      border-radius: 999px;
      background: var(--mf-surface-alt);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .srch {
      position: relative;
      margin-left: auto;
      min-width: 220px;
    }
    .srch .pi {
      position: absolute;
      left: var(--mf-s3);
      top: 50%;
      transform: translateY(-50%);
      color: var(--mf-text-muted);
    }
    .srch input {
      box-sizing: border-box;
      width: 100%;
      min-height: 36px;
      padding: 0 var(--mf-s3) 0 34px;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    .flt {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s4);
      padding: var(--mf-s2) var(--mf-s4) var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
      font-size: var(--mf-fs-sm);
    }
    .flt label {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      color: var(--mf-text-muted);
      font-weight: 600;
    }
    select,
    .flt input {
      min-height: 32px;
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    .lnk {
      color: var(--mf-link);
      background: none;
      border: 0;
      padding: 0;
      font: inherit;
      cursor: pointer;
      text-decoration: none;
    }
    .dt {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-height: 32px;
    }
    .lnk:hover {
      text-decoration: underline;
    }
    .msg {
      margin: var(--mf-s4);
      color: var(--mf-text-muted);
    }
    .tt td {
      height: 48px;
      padding: 0 var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
      vertical-align: middle;
    }
    tr.sel td {
      background: var(--mf-selected-bg);
    }
    .open {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .open b {
      font-weight: 600;
    }
    .m {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 400;
    }
    .ast {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 2px var(--mf-s2);
      border-radius: 999px;
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      white-space: nowrap;
      background: var(--a-bg);
      color: var(--a-fg);
    }
    .ast[data-status='ACTIVE'] {
      --a-bg: var(--mf-sem-healthy-bg);
      --a-fg: var(--mf-sem-healthy-fg);
    }
    .ast[data-status='INACTIVE'] {
      --a-bg: var(--mf-surface-alt);
      --a-fg: var(--mf-text-muted);
    }
    .ast[data-status='PENDING_DISPOSITION'] {
      --a-bg: var(--mf-sem-risk-bg);
      --a-fg: var(--mf-sem-risk-fg);
    }
    .ast[data-status='DISPOSED'] {
      --a-bg: var(--mf-status-cancel-bg);
      --a-fg: var(--mf-status-cancel-fg);
    }
    .tt {
      table-layout: fixed;
    }
    th.c-cl,
    th.c-ma {
      width: 22%;
    }
    th.c-ty {
      width: 28%;
    }
    th.c-cr,
    th.c-up {
      width: 112px;
    }
    th.c-st {
      width: 170px;
    }
    .c-cl,
    .c-ma {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .c-cl,
    .c-cr {
      display: none;
    }
    @container gc (min-width: 760px) {
      .c-cr {
        display: table-cell;
      }
    }
    @container gc (min-width: 900px) {
      .c-cl {
        display: table-cell;
      }
    }
    .flt input[type='date'] {
      width: 9.5rem;
    }
    .side {
      flex: 0 0 360px;
      width: 360px;
      box-sizing: border-box;
      min-height: 0;
      overflow: auto;
      padding: var(--mf-s3) var(--mf-s4);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-card);
    }
    .sh {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
    }
    .sh h2 {
      margin: 0;
      font-size: var(--mf-fs-lg);
      overflow-wrap: anywhere;
    }
    .x {
      display: grid;
      place-items: center;
      flex: none;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 50%;
      background: none;
      color: var(--mf-text);
      cursor: pointer;
    }
    .kv {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--mf-s1) var(--mf-s3);
      margin: var(--mf-s3) 0;
      font-size: var(--mf-fs-sm);
    }
    .kv dt {
      color: var(--mf-text-muted);
      font-weight: 600;
    }
    .kv dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    h3 {
      font-size: var(--mf-fs-md);
      margin: var(--mf-s3) 0 var(--mf-s2);
    }
    .lt {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--mf-s3);
    }
    .l1 {
      display: flex;
      gap: var(--mf-s2);
      align-items: center;
      flex-wrap: wrap;
    }
    .cm {
      margin: var(--mf-s1) 0 0;
      padding: var(--mf-s2) var(--mf-s3);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface-alt);
      font-size: var(--mf-fs-sm);
    }
    .cm .m {
      display: block;
    }
    .od {
      color: var(--mf-sem-overdue-fg);
      font-weight: 700;
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    @media (max-width: 767.98px) {
      .as {
        flex-direction: column;
        height: auto;
      }
      mf-grid-frame {
        flex: none;
      }
      .side {
        flex: none;
        width: auto;
      }
      .tt,
      .tt tbody {
        display: block;
        width: 100%;
      }
      .tt thead {
        display: none;
      }
      .tt tr {
        display: grid;
        gap: var(--mf-s1);
        padding: var(--mf-s3) var(--mf-s4);
        border-bottom: 1px solid var(--mf-border);
      }
      .tt td {
        display: block;
        height: auto;
        padding: 0;
        border: 0;
        max-width: none;
        white-space: normal;
      }
      .c-cr,
      .c-cl {
        display: block;
      }
      .tt {
        table-layout: auto;
      }
      .open {
        min-height: 44px;
      }
    }
  `,
})
export class MmAssetsTab {
  private readonly api = inject(MmApi);
  private readonly typesApi = inject(AssetTypesClient);

  readonly filters = input.required<MmFilters>();
  readonly assetId = input<number | null>(null);
  readonly page = input(1);
  readonly assetChange = output<number | null>();
  readonly pageChange = output<number>();

  protected readonly heads = HEADS;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly statusMap = ASSET_STATUS;
  protected readonly statusKeys = Object.keys(ASSET_STATUS) as AssetStatusCode[];

  protected readonly dates = signal(false);
  protected readonly q = signal('');
  protected readonly type = signal('');
  protected readonly status = signal('');
  protected readonly createdFrom = signal('');
  protected readonly createdTo = signal('');
  protected readonly updatedFrom = signal('');
  protected readonly updatedTo = signal('');
  protected readonly sort = signal('updated');
  protected readonly dir = signal<'asc' | 'desc'>('desc');
  protected readonly types = signal<{ id: number; name: string }[]>([]);
  private timer: ReturnType<typeof setTimeout> | undefined;

  protected readonly filtered = computed(
    () =>
      !!(
        this.q() ||
        this.type() ||
        this.status() ||
        this.createdFrom() ||
        this.createdTo() ||
        this.updatedFrom() ||
        this.updatedTo()
      ),
  );
  protected readonly resetKey = computed(() => JSON.stringify([this.filters(), this.query()]));

  private readonly query = computed<AssetQuery>(() => ({
    q: this.q() || undefined,
    assetTypeId: this.type() ? [Number(this.type())] : undefined,
    status: this.status() ? [this.status() as AssetStatusCode] : undefined,
    createdFrom: this.createdFrom() || undefined,
    createdTo: this.createdTo() || undefined,
    updatedFrom: this.updatedFrom() || undefined,
    updatedTo: this.updatedTo() || undefined,
    sort: this.sort(),
    dir: this.dir(),
    page: this.page(),
    pageSize: PAGE_SIZE,
  }));

  protected readonly list = panelLoader(
    () => [this.filters(), this.query()],
    () => this.api.assets(this.filters(), this.query()),
  );
  protected readonly detail = panelLoader(
    () => this.assetId(),
    () => this.api.asset(this.assetId() ?? 0),
    { enabled: () => this.assetId() !== null },
  );
  protected readonly rows = computed<AssetRow[]>(() => this.list.data()?.items ?? []);
  protected readonly total = computed(() => this.list.data()?.total ?? 0);

  constructor() {
    void firstValueFrom(this.typesApi.listAssetTypes(undefined, undefined, undefined, 1, 100))
      .then((r) => this.types.set(r.items.map((t) => ({ id: t.assetTypeId, name: t.name }))))
      .catch(() => undefined);
    // A side panel that was opened moves focus to its title; closing returns to the row.
    let last: number | null = null;
    effect(() => {
      const id = this.assetId();
      untracked(() => {
        if (id !== null && id !== last)
          setTimeout(() => document.querySelector<HTMLElement>('[data-side-title]')?.focus(), 0);
        last = id;
      });
    });
  }

  protected setQ(v: string): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.q.set(v), 250);
  }

  protected clearFilters(): void {
    this.q.set('');
    this.type.set('');
    this.status.set('');
    this.createdFrom.set('');
    this.createdTo.set('');
    this.updatedFrom.set('');
    this.updatedTo.set('');
  }

  protected sortBy(field: string): void {
    if (this.sort() === field) this.dir.set(this.dir() === 'asc' ? 'desc' : 'asc');
    else {
      this.sort.set(field);
      this.dir.set(field === 'created' || field === 'updated' ? 'desc' : 'asc');
    }
  }
  protected ariaSort(field: string): 'ascending' | 'descending' | 'none' {
    return this.sort() === field ? (this.dir() === 'asc' ? 'ascending' : 'descending') : 'none';
  }
  protected sortIcon(field: string): string {
    return this.sort() === field
      ? this.dir() === 'asc'
        ? 'pi-sort-amount-up-alt'
        : 'pi-sort-amount-down'
      : 'pi-sort-alt';
  }
}
