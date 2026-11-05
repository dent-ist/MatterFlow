import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MyMattersClient } from '../../../api/generated/api-client';
import { TaskTypeChip } from '../../../shared/ui/task-type-chip';
import { MyMattersFocus } from '../focus';
import { MmFilters, commonArgs } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { MmApi } from './mm-api';
import { ZeroDash } from '../../../shared/ui/zero-dash';

const STATUS_BAR = [
  { key: 'new', label: 'New', status: 'new', c: 'var(--mf-status-new-line)' },
  { key: 'inProgress', label: 'In Progress', status: 'progress', c: 'var(--mf-sem-info-solid)' },
  { key: 'onHold', label: 'On Hold', status: 'hold', c: 'var(--mf-sem-neutral-solid)' },
  { key: 'completed', label: 'Completed', status: 'completed', c: 'var(--mf-sem-healthy-solid)' },
  { key: 'cancelled', label: 'Cancelled', status: 'cancelled', c: 'var(--mf-status-cancel-line)' },
] as const;

const ATTENTION = [
  { key: 'overdue', label: 'Overdue', tone: 'over' },
  { key: 'risk', label: 'At Risk', tone: 'risk' },
  { key: 'unassigned', label: 'Unassigned', tone: '' },
  { key: 'critical', label: 'Critical', tone: '' },
  { key: 'due7', label: 'Due in 7 days', tone: '' },
] as const;

/**
 * Metrics, Work view (`mf-mm-metrics-work`, epic #953 UI-21): where is my work and where is it late, in three small things: the status mix, "Needs attention" counts (the Show filter's
 * numbers) and a table by task type with the task type chip (open, overdue, at risk, on hold). No averages, nothing per person, no trend. Every
 * number is a button that opens the Overview with the matching filters (status, Show, task type or creation range, the chosen client and matter) as removable chips.
 */
@Component({
  selector: 'mf-mm-metrics-work',
  imports: [ZeroDash, TaskTypeChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loads.state() === 'error') {
      <p class="msg" role="alert">
        Couldn't load the metrics.
        <button type="button" class="lnk" (click)="loads.load()">Retry</button>
      </p>
    }
    <div class="grid">
      <section class="card" aria-labelledby="mw-st">
        <h3 id="mw-st">Status Mix</h3>
        @if (mix(); as m) {
          <div class="bar" role="img" [attr.aria-label]="m.name">
            @for (s of m.parts; track s.key) {
              @if (s.n > 0) {
                <i [style.flex]="s.n + ' 1 0'" [style.background]="s.c"></i>
              }
            }
          </div>
          <ul class="legend">
            @for (s of m.parts; track s.key) {
              <li>
                <i class="sw" [style.background]="s.c" aria-hidden="true"></i>
                <button
                  type="button"
                  class="num"
                  [attr.data-drill]="'status-' + s.status"
                  [disabled]="s.n === 0"
                  (click)="drill.emit({ status: s.status })"
                >
                  {{ s.n }}
                </button>
                <span>{{ s.label }}</span>
              </li>
            }
          </ul>
        } @else {
          <p class="msg">Loading</p>
        }
      </section>

      <section class="card" aria-labelledby="mw-att">
        <h3 id="mw-att">Needs Attention</h3>
        <ul class="tiles">
          @for (a of attention(); track a.key) {
            <li [class]="'tile ' + a.tone">
              <button
                type="button"
                class="big"
                [attr.data-drill]="'show-' + a.key"
                [disabled]="a.n === 0"
                (click)="drill.emit({ show: a.key })"
              >
                {{ a.n }}
                <span>{{ a.label }}</span>
              </button>
            </li>
          }
        </ul>
      </section>

      <section class="card wide" aria-labelledby="mw-ty">
        <h3 id="mw-ty">Open Work By Task Type</h3>
        @if (types().length === 0) {
          <p class="msg">{{ typesLoad.state() === 'loading' ? 'Loading' : 'No open tasks.' }}</p>
        } @else {
          <table class="tt2">
            <thead>
              <tr>
                <th scope="col">Task Type</th>
                <th scope="col" class="n">Open</th>
                <th scope="col" class="n">Overdue</th>
                <th scope="col" class="n">At Risk</th>
                <th scope="col" class="n">On Hold</th>
              </tr>
            </thead>
            <tbody>
              @for (t of types(); track t.taskTypeId) {
                <tr [attr.data-type-row]="t.taskTypeId">
                  <td>
                    <span class="tycell">
                      <mf-task-type-chip
                        size="sm"
                        [iconKey]="t.iconKey"
                        [colourKey]="t.colourKey"
                        [typeId]="t.taskTypeId"
                        [name]="t.name"
                        [decorative]="true"
                      />
                      {{ t.name }}
                    </span>
                  </td>
                  <td class="n">
                    <button
                      type="button"
                      class="num"
                      [disabled]="t.open === 0"
                      (click)="drill.emit({ ttype: '' + t.taskTypeId })"
                    >
                      {{ t.open }}
                    </button>
                  </td>
                  <td class="n">
                    <button
                      type="button"
                      class="num over"
                      [disabled]="t.overdue === 0"
                      (click)="drill.emit({ ttype: '' + t.taskTypeId, show: 'overdue' })"
                    >
                      @if (t.overdue === 0) {
                        <mf-zero-dash />
                      } @else {
                        {{ t.overdue }}
                      }
                    </button>
                  </td>
                  <td class="n">
                    <button
                      type="button"
                      class="num risk"
                      [disabled]="t.atRisk === 0"
                      (click)="drill.emit({ ttype: '' + t.taskTypeId, show: 'risk' })"
                    >
                      @if (t.atRisk === 0) {
                        <mf-zero-dash />
                      } @else {
                        {{ t.atRisk }}
                      }
                    </button>
                  </td>
                  <td class="n">
                    <button
                      type="button"
                      class="num"
                      [disabled]="t.onHold === 0"
                      (click)="drill.emit({ ttype: '' + t.taskTypeId, status: 'hold' })"
                    >
                      @if (t.onHold === 0) {
                        <mf-zero-dash />
                      } @else {
                        {{ t.onHold }}
                      }
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s4);
    }
    .card {
      min-width: 0;
      padding: var(--mf-s4);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
    }
    .wide {
      grid-column: 1 / -1;
    }
    h3 {
      margin: 0 0 var(--mf-s3);
      font-size: var(--mf-fs-md);
      font-weight: 700;
    }
    .msg {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .lnk {
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      cursor: pointer;
    }
    .bar {
      display: flex;
      height: 14px;
      overflow: hidden;
      gap: 1px;
      border-radius: 7px;
      background: var(--mf-surface-alt);
    }
    .bar i {
      display: block;
      min-width: 3px;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2) var(--mf-s4);
      margin: var(--mf-s3) 0 0;
      padding: 0;
      list-style: none;
    }
    .legend li {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    .sw {
      width: 10px;
      height: 10px;
      border-radius: 3px;
    }
    .num {
      min-width: 28px;
      height: 28px;
      padding: 0 var(--mf-s2);
      border: 0;
      border-radius: var(--mf-radius-lg);
      background: none;
      color: var(--mf-link);
      font: inherit;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
    }
    .num:hover:not(:disabled) {
      font-variant-numeric: tabular-nums;
      background: var(--mf-selected-bg);
      text-decoration: underline;
    }
    .num:disabled {
      font-variant-numeric: tabular-nums;
      color: var(--mf-text-muted);
      font-weight: 400;
      cursor: default;
    }
    .num.over:not(:disabled) {
      font-variant-numeric: tabular-nums;
      color: var(--mf-sem-overdue-fg);
    }
    .num.risk:not(:disabled) {
      font-variant-numeric: tabular-nums;
      color: var(--mf-sem-risk-fg);
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .tile {
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    .tile.over {
      background: var(--mf-sem-overdue-bg);
      border-color: var(--mf-sem-overdue-line);
    }
    .tile.risk {
      background: var(--mf-sem-risk-bg);
      border-color: var(--mf-sem-risk-line);
    }
    .big {
      font-variant-numeric: tabular-nums;
      display: flex;
      flex-direction: column;
      width: 100%;
      min-height: 64px;
      padding: var(--mf-s2) var(--mf-s3);
      border: 0;
      background: none;
      color: var(--mf-text);
      font: inherit;
      font-size: 22px;
      font-weight: 700;
      text-align: left;
      cursor: pointer;
    }
    .tile.over .big {
      font-variant-numeric: tabular-nums;
      color: var(--mf-sem-overdue-fg);
    }
    .tile.risk .big {
      font-variant-numeric: tabular-nums;
      color: var(--mf-sem-risk-fg);
    }
    .big span {
      font-variant-numeric: tabular-nums;
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .big:disabled {
      font-variant-numeric: tabular-nums;
      color: var(--mf-text-muted);
      cursor: default;
    }
    .tt2 {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--mf-fs-md);
    }
    .tt2 th {
      padding: var(--mf-s2) var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      letter-spacing: 0.03em;
      text-align: left;
      text-transform: uppercase;
    }
    .tt2 td {
      padding: var(--mf-s1) var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
    }
    .tt2 .n {
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
    .tycell {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    @media (max-width: 767.98px) {
      .grid {
        grid-template-columns: 1fr;
      }
      .num {
        font-variant-numeric: tabular-nums;
        min-width: 44px;
        height: 44px;
      }
      .tt2 {
        font-size: var(--mf-fs-sm);
      }
    }
  `,
})
export class MmMetricsWork {
  private readonly api = inject(MmApi);
  private readonly my = inject(MyMattersClient);
  private readonly focus = inject(MyMattersFocus);

  readonly filters = input.required<MmFilters>();
  /** A number was chosen: the page opens the Overview with these address parameters. */
  readonly drill = output<Record<string, string>>();

  protected readonly loads = panelLoader(
    () => this.filters(),
    () => this.api.taskCounts(this.filters(), ['open'], 'everything'),
  );
  protected readonly typesLoad = panelLoader(
    () => [this.filters(), this.focus.types()],
    () => {
      const a = commonArgs(this.filters());
      const focus = this.focus.types();
      return this.my.getMyMattersBreakdown(
        'types',
        'open',
        focus.length ? [...focus] : undefined,
        undefined,
        undefined,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
        undefined,
        a.matterId,
      );
    },
  );
  protected readonly mix = computed(() => {
    const c = this.loads.data()?.byStatus;
    if (!c) return null;
    const parts = STATUS_BAR.map((s) => ({ ...s, n: c[s.key] }));
    return { parts, name: `Status mix: ${parts.map((p) => `${p.label} ${p.n}`).join(', ')}` };
  });
  protected readonly attention = computed(() => {
    const c = this.loads.data()?.byShow;
    return ATTENTION.map((a) => ({ ...a, n: c ? c[a.key] : 0 }));
  });
  protected readonly types = computed(() =>
    (this.typesLoad.data()?.types ?? []).filter((t) => t.open > 0 || t.onHold > 0),
  );
}
