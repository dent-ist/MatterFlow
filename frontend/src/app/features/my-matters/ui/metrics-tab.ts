import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { AuthStore } from '../../../core/auth/auth.store';
import { ScrollRegion } from '../../../shared/ui/scroll-region';
import { MmFilters } from '../my-matters-filters';
import { BreakdownTab } from '../tabs/breakdown-tab';
import { DataTab } from '../tabs/data-tab';
import { MetricsView } from './mm-scope';

/**
 * The Metrics tab (`mf-mm-metrics-tab`, epic #953 UI-17): one tab with a small toggle, Breakdown (matters by task type, a number opens those tasks) and Data (group by, the
 * volume tiles, Table, Bar and Pie). The two views are the existing, tested Breakdown and Data components, so nothing from them is lost; they follow the client and matter chosen
 * at the top. Data is for people who may see assets (`Asset.View`). The view is in the address (`?mview=data`). The body scrolls inside its frame.
 */
@Component({
  selector: 'mf-mm-metrics-tab',
  imports: [BreakdownTab, DataTab, ScrollRegion],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <section class="mt" aria-label="Metrics">
      <div class="hd">
        <h2>Metrics</h2>
        @if (canData()) {
          <div class="seg" role="group" aria-label="Metrics view">
            <button
              type="button"
              data-view="breakdown"
              [attr.aria-pressed]="view() === 'breakdown'"
              (click)="viewChange.emit('breakdown')"
            >
              Breakdown
            </button>
            <button
              type="button"
              data-view="data"
              [attr.aria-pressed]="view() === 'data'"
              (click)="viewChange.emit('data')"
            >
              Data
            </button>
          </div>
        }
      </div>
      <div class="body" mfScrollRegion="Metrics details">
        @if (view() === 'data' && canData()) {
          @defer (on immediate) {
            <mf-mm-data-tab [filters]="filters()" [canAll]="canAll()" />
          } @placeholder {
            <p class="msg" role="status">Loading data</p>
          }
        } @else {
          @defer (on immediate) {
            <mf-mm-breakdown-tab [filters]="filters()" />
          } @placeholder {
            <p class="msg" role="status">Loading breakdown</p>
          }
        }
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
    }
    .mt {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 300px;
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-card);
      overflow: hidden;
    }
    .hd {
      display: flex;
      align-items: center;
      gap: var(--mf-s4);
      padding: var(--mf-s3) var(--mf-s4);
      border-bottom: 1px solid var(--mf-border);
      flex: none;
      flex-wrap: wrap;
    }
    h2 {
      margin: 0;
      font-size: var(--mf-fs-lg);
      font-weight: 700;
    }
    .seg {
      display: inline-flex;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      overflow: hidden;
    }
    .seg button {
      min-height: 36px;
      padding: 0 var(--mf-s4);
      border: 0;
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .seg button + button {
      border-left: 1px solid var(--mf-border-strong);
    }
    .seg button[aria-pressed='true'] {
      background: var(--mf-primary);
      color: var(--mf-primary-contrast);
    }
    .body {
      flex: 1 1 0;
      min-height: 0;
      overflow: auto;
      padding: var(--mf-s3) var(--mf-s4);
    }
    .msg {
      color: var(--mf-text-muted);
    }
    @media (max-width: 767.98px) {
      .mt {
        height: auto;
      }
      .body {
        overflow: visible;
      }
      .seg button {
        min-height: 44px;
      }
    }
  `,
})
export class MmMetricsTab {
  private readonly auth = inject(AuthStore);
  readonly filters = input.required<MmFilters>();
  readonly view = input<MetricsView>('breakdown');
  readonly viewChange = output<MetricsView>();
  protected readonly canData = computed(() => this.auth.has('Asset.View'));
  protected readonly canAll = computed(() => this.auth.has('Matter.AssignManagers'));
}
