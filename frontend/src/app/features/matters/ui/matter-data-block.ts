import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MyMattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ColumnChart } from '../../../shared/charts/column-chart';
import { formatSize } from '../../assets/disposition/asset-size';
import { assetsParams, sizeText, volumeChartRows, volumeRows } from '../../my-matters/data-model';
import { panelLoader } from '../../my-matters/panel-loader';

/** The chart shows the last twelve months. */
const MONTHS = 12;

/**
 * The Data block of the matter Overview (PM v2, #882): how many assets the matter holds, their size, what waits for a disposition and a small chart of the
 * size held month by month. The numbers are the ones of My Matters > Data (`GET /my-matters/data` and `/data/volume`, the shared lazy column chart), so the two
 * places cannot disagree; the Data API answers for the matters the person manages, so for another matter the block is simply absent. Needs Asset.View and Task.View and the right to manage matters.
 * Every count opens the Assets list of this matter with exactly the assets it counts.
 */
@Component({
  selector: 'mf-matter-data-block',
  imports: [ColumnChart, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }
    .db {
      min-width: 0;
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }
    .db__title {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-lg);
      font-weight: 700;
    }
    .db__facts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s4);
      margin: 0 0 var(--mf-s2);
      padding: 0;
      list-style: none;
    }
    .db__facts b {
      margin-right: 0.3em;
      font-variant-numeric: tabular-nums;
    }
    .db__facts a {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      color: var(--mf-link);
    }
    .db__note {
      margin: var(--mf-s1) 0 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    @media (max-width: 639.98px) {
      .db__facts a {
        min-height: 44px;
      }
    }
  `,
  template: `
    @if (row(); as r) {
      <section class="db" aria-labelledby="mo-data" data-section="data">
        <h3 class="db__title" id="mo-data">Data</h3>
        <ul class="db__facts" data-data-facts>
          <li>
            <a routerLink="/assets" [queryParams]="params('all')" data-data-assets
              ><b>{{ r.counts.assets }}</b
              >{{ ' ' }}{{ r.counts.assets === 1 ? 'asset' : 'assets' }}</a
            >
          </li>
          <li data-data-size>
            @if (size(); as s) {
              <b>{{ s }}</b>
            } @else {
              <span class="db__note">No size recorded</span>
            }
          </li>
          @if (r.counts.pendingDisposition > 0) {
            <li>
              <a routerLink="/assets" [queryParams]="params('pending')" data-data-pending
                ><b>{{ r.counts.pendingDisposition }}</b
                >{{ ' ' }}pending disposition</a
              >
            </li>
          }
          @if (r.counts.inactive > 0) {
            <li>
              <a routerLink="/assets" [queryParams]="params('inactive')" data-data-inactive
                ><b>{{ r.counts.inactive }}</b
                >{{ ' ' }}inactive</a
              >
            </li>
          }
        </ul>
        @if (chartRows().length > 0 && hasVolume()) {
          @defer (on immediate) {
            <mf-column-chart
              heading="Size held at the end of each month"
              [rows]="chartRows()"
              [unit]="unit()"
              [format]="fmtFn"
              chartHeight="3.5rem"
              tableHint=""
              emptyText="Nothing to show."
            />
          } @placeholder {
            <p class="db__note" role="status">Loading the chart</p>
          }
          <p class="db__note" data-data-chart-note>
            Size held at the end of each month, {{ unit() }}.
          </p>
        }
      </section>
    }
  `,
})
export class MatterDataBlock {
  readonly matterId = input.required<number>();
  readonly reload = input(0);

  /** Looked up when the first request goes out (Asset.View), not at construction. */
  private readonly injector = inject(Injector);
  private get api(): MyMattersClient {
    return this.injector.get(MyMattersClient);
  }
  private readonly auth = inject(AuthStore);
  /** The Data API is for people who manage matters (or assign managers) and may see tasks and assets, My Matters' own rule; anybody else gets no block and no request. */
  private readonly allowed = computed(
    () =>
      this.auth.has('Asset.View') &&
      this.auth.has('Task.View') &&
      (this.auth.has('Matter.BeManager') || this.auth.has('Matter.AssignManagers')),
  );

  private readonly data = panelLoader(
    () => [this.matterId(), this.reload()],
    () => this.api.getMyMattersData('mine'),
    { enabled: () => this.allowed() },
  );
  /** The matter's row; the block is absent when the Data API has none (a matter the person does not manage, or one without assets). */
  protected readonly row = computed(() => {
    const id = this.matterId();
    return this.data.data()?.matters.find((m) => m.matterId === id) ?? null;
  });

  private readonly volume = panelLoader(
    () => [this.matterId(), this.reload(), this.row() !== null],
    () =>
      this.api.getMyMattersDataVolume(
        'mine',
        undefined,
        undefined,
        undefined,
        undefined,
        this.matterId(),
        MONTHS,
      ),
    { enabled: () => this.allowed() && this.row() !== null },
  );
  protected readonly unit = computed(() => this.volume.data()?.units[0] ?? '');
  protected readonly rows = computed(() =>
    volumeRows(this.volume.data()?.points ?? [], this.unit()),
  );
  protected readonly chartRows = computed(() => volumeChartRows(this.rows()));
  protected readonly hasVolume = computed(() =>
    this.rows().some((r) => r.held !== 0 || r.added !== 0 || r.removed !== 0),
  );
  protected readonly fmtFn = (v: number): string => formatSize(v, this.unit());

  protected size(): string {
    const r = this.row();
    return r ? sizeText(r.counts.size) : '';
  }

  protected params(status: 'all' | 'pending' | 'inactive') {
    return assetsParams(this.row()?.query ?? '', 'mine', status);
  }
}
