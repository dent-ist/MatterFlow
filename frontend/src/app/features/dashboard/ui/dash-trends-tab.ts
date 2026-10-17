import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardClient, DashboardTrend } from '../../../api/generated/api-client';
import { QuietRequests } from '../../../core/http/interceptors';
import { DashSkeleton } from './dash-skeleton';
import { DashState, focusAfterRetry } from './dash-state';
import { DASH_FIXED_QUERY, DASH_PHONE_QUERY, mediaMatch } from './dash-media';
import { DashScope } from '../dash-scope';
import { Period, periodArgs, periodId } from '../dashboard-period';
import { TrendChart } from './trend-chart';
import { TrendLegend } from './trend-legend';
import { MeasureOption, TrendMeasure } from './trend-measure';
import {
  BACKLOG_CHOICE_LABEL,
  BacklogChoice,
  DEFAULT_CHOICE,
  FLOW_CHOICE_LABEL,
  FlowChoice,
  LIMIT_MESSAGE,
  MAX_TYPES,
  PanelView,
  TrendChoice,
  backlogOptions,
  buildView,
  choiceFromParams,
  choiceToParams,
  flowOptions,
  freeSlot,
  granularityOf,
  hasTrendParams,
  isBacklogChoice,
  isFlowChoice,
  namesBacklog,
  normalizeChoice,
  sameChoice,
  toggleAllMode,
  totalMeasure,
  typeRows,
} from './trend-model';
import { TrendPrefs } from './trend-prefs';

type LoadState = 'loading' | 'ready' | 'error';

let nextId = 0;

/**
 * Dashboard > Trends tab: the daily lines of the whole department ("All task types") and of up to eight task types in two stacked panels
 * that share one x scale: flows (Created, Completed, On time, Completed late; 320 px) and backlog (Overdue at the end of the day; 200 px,
 * can be hidden). Each panel has its own segmented measure control; "Compare task types" is a list next to the chart that never disables
 * (picking a type turns a two-line measure into its first single measure and says so). The choices live in the address (`types`, `metric`,
 * `bmetric`, `all`; legacy `due`) so a link shares the view, and are remembered per user in this browser. The data is one request that
 * names the checked task types; checking a type already read needs no request. The period and the Refresh of the page drive it.
 * Operational counts only: no per-person figures.
 */
@Component({
  selector: 'mf-dash-trends-tab',
  imports: [DashSkeleton, TrendChart, TrendLegend, TrendMeasure, DashState, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <div class="card mf-fill" [attr.aria-busy]="busy() ? 'true' : null">
      <header>
        @if (caption(); as c) {
          <p class="note">{{ c }}</p>
        }
        <span class="tools">
          @if (data() && !noActivity()) {
            <button
              type="button"
              class="toggle"
              data-backlog-toggle
              [attr.aria-pressed]="backlogShown()"
              (click)="toggleBacklog()"
            >
              {{ backlogShown() ? 'Hide backlog' : 'Show backlog' }}
            </button>
          }
          @if (hasLines() && !noActivity()) {
            <button
              type="button"
              class="toggle"
              [attr.aria-pressed]="asTable()"
              (click)="toggleTable()"
            >
              {{ asTable() ? 'View as chart' : 'View as table'
              }}<span class="sr-only"> for {{ heading }}</span>
            </button>
          }
        </span>
      </header>

      @if (state() === 'error') {
        <mf-dash-state variant="error" message="The trend could not be loaded." (retry)="retry()" />
      } @else if (data(); as d) {
        <div class="layout">
          <div class="main">
            <mf-trend-chart
              [heading]="heading"
              [dates]="dates()"
              [granularity]="granularity()"
              [periodFrom]="d.period.from"
              [periodTo]="d.period.to"
              [panels]="panels()"
              [asTable]="asTable()"
              [fit]="fixed()"
              [emptyText]="emptyText()"
              [controls]="measureTpl"
            />
          </div>
          @if (phone()) {
            <div class="side compare">
              <button
                type="button"
                class="compare-btn"
                data-compare-toggle
                [attr.aria-expanded]="compareOpen()"
                [attr.aria-controls]="id + '-compare'"
                (click)="compareOpen.set(!compareOpen())"
              >
                <span
                  >Compare task types
                  @if (choice().types.length > 0) {
                    ({{ choice().types.length }})
                  }
                </span>
                <span class="chev" aria-hidden="true">{{
                  compareOpen() ? '&#9650;' : '&#9660;'
                }}</span>
              </button>
              <div [id]="id + '-compare'" [hidden]="!compareOpen()">
                @if (compareOpen()) {
                  <ng-container *ngTemplateOutlet="legendTpl" />
                }
              </div>
            </div>
          } @else {
            <ng-container *ngTemplateOutlet="legendTpl" />
          }
          <ng-template #legendTpl>
            <mf-trend-legend
              class="side"
              [choice]="choice()"
              [slots]="slots()"
              [data]="d"
              [message]="message()"
              (allChange)="toggleAll()"
              (typeChange)="toggleType($event)"
              (selectTop)="selectTop()"
              (clear)="clearTypes()"
              (limit)="message.set(limitMessage)"
            />
          </ng-template>
        </div>
      } @else {
        <mf-dash-skeleton kind="trends" label="Loading the trend" data-trend-loading />
      }
      <ng-template #measureTpl let-key>
        @if (key === 'flows') {
          <mf-trend-measure
            panel="flows"
            label="Measure of the created and completed panel"
            [options]="flowChoices()"
            [value]="choice().metric"
            (valueChange)="setMetric($event)"
          />
        } @else {
          <mf-trend-measure
            panel="backlog"
            label="Measure of the backlog panel"
            [options]="backlogChoices()"
            [value]="choice().bmetric"
            (valueChange)="setBacklogMetric($event)"
          />
        }
      </ng-template>
      <p class="sr-only" role="status" aria-live="polite" data-trend-live>{{ live() }}</p>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .card {
      box-sizing: border-box;
      padding: var(--mf-s4);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--mf-s3);
      margin-bottom: var(--mf-s3);
    }
    header .note {
      margin: 0;
    }
    .tools {
      display: inline-flex;
      margin-left: auto;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--mf-s1) var(--mf-s4);
    }
    .toggle {
      background: none;
      border: 0;
      padding: 0;
      min-height: var(--mf-target-min);
      color: var(--mf-link);
      font: inherit;
      font-size: var(--mf-fs-sm);
      cursor: pointer;
      text-decoration: underline;
      white-space: nowrap;
    }
    .note {
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    /* Chart column and control panel side by side from 1000 px: the panel is 300 to 340 px, a fixed 360 px from 1600 px (the chart gets the
       rest). Fixed-height Dashboard (#137): the layout fills the card, the two chart panels share the height of the chart column and the
       Task Types list is the only region that scrolls on the right; below 1000 px the list sits under the chart with its own height. */
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s5);
      align-items: stretch;
    }
    .main {
      min-width: 0;
    }
    .side {
      padding: var(--mf-s4) 0 0;
      border-top: 1px solid var(--mf-border);
    }
    /* A phone: the chart takes the whole width the page leaves (no card frame), #121. */
    @media (max-width: 480px) {
      .card {
        padding: var(--mf-s2) 0;
        background: transparent;
        border: 0;
        border-radius: 0;
      }
    }
    @media (min-width: 1000px) {
      .layout {
        grid-template-columns: minmax(0, 1fr) clamp(300px, 24vw, 340px);
      }
      .side {
        padding: 0 0 0 var(--mf-s4);
        border-top: 0;
        border-left: 1px solid var(--mf-border);
      }
    }
    @media (min-width: 1600px) {
      .layout {
        grid-template-columns: minmax(0, 1fr) 360px;
      }
    }
    @media (min-width: 768px) and (min-height: 561px) {
      .layout {
        flex: 1 1 0;
        min-height: 0;
        grid-template-rows: minmax(0, 1fr);
      }
      .main,
      .side {
        min-height: 0;
      }
    }
    @media (min-width: 768px) and (max-width: 999px) and (min-height: 561px) {
      .layout {
        grid-template-rows: minmax(0, 1fr) minmax(0, 40%);
        gap: var(--mf-s3);
      }
    }
    .compare {
      border-top: 1px solid var(--mf-border);
      padding-top: var(--mf-s2);
    }
    .compare-btn {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      min-height: 44px;
      padding: 0 var(--mf-s3);
      font: inherit;
      color: var(--mf-text);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      cursor: pointer;
    }
    .compare .side {
      padding-top: var(--mf-s3);
      border-top: 0;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class DashTrendsTab {
  private readonly api = inject(DashboardClient);
  private readonly scope = inject(DashScope);
  private readonly quiet = inject(QuietRequests);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly prefs = inject(TrendPrefs);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  /** The period of the page (shared with Summary and Coverage). */
  readonly period = input.required<Period>();
  readonly caption = input<string | null>(null);
  /** Changes whenever the page read its figures again (Refresh, the automatic refresh): the trend is read again with it. */
  readonly refreshKey = input<string | null>(null);

  protected readonly id = `mf-trends-${nextId++}`;
  /** The fixed-height layout is on: the chart panels fill the height of the tab (#137). */
  protected readonly fixed = mediaMatch(DASH_FIXED_QUERY);
  protected readonly limitMessage = LIMIT_MESSAGE;
  protected readonly choice = signal<TrendChoice>(DEFAULT_CHOICE);
  protected readonly slots = signal<ReadonlyMap<number, number>>(new Map());
  protected readonly data = signal<DashboardTrend | null>(null);
  protected readonly state = signal<LoadState>('loading');
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly live = signal('');
  protected readonly asTable = signal(false);

  private requestId = 0;
  private loadedGen: string | null = null;
  private retrying = false;
  private lastKey: string | null = null;
  private urlSeen = false;

  protected readonly heading = 'Tasks over time';
  protected readonly backlogChoices = computed<MeasureOption<BacklogChoice>[]>(() =>
    backlogOptions(this.choice()).map((value) => ({ value, label: BACKLOG_CHOICE_LABEL[value] })),
  );
  /** A phone (480 px and below): the "Compare task types" list is folded behind a button under the chart (#121). */
  protected readonly phone = mediaMatch(DASH_PHONE_QUERY);
  protected readonly compareOpen = signal(false);
  /** The user hid the backlog panel (remembered, not in the address). */
  protected readonly backlogHidden = signal(false);
  protected readonly backlogShown = computed(() => !this.backlogHidden());

  protected readonly view = computed(() => {
    const d = this.data();
    return buildView(this.choice(), d, this.slots(), d?.types ?? []);
  });
  protected readonly dates = computed(() => this.data()?.all.map((p) => p.date) ?? []);
  protected readonly granularity = computed(() => granularityOf(this.data()?.granularity));
  /** Nothing happened in the period (no created, completed, overdue or completed-with-due-date task at all). */
  protected readonly noActivity = computed(() => {
    const d = this.data();
    return (
      !!d &&
      this.choice().types.length === 0 &&
      d.all.every((p) => p.created + p.completed + p.overdue + p.open + p.onTime + p.late === 0)
    );
  });
  /** The panels the chart draws: flows, and backlog unless hidden. */
  protected readonly panels = computed<PanelView[]>(() => {
    const v = this.view();
    const none = this.noActivity();
    const strip = (p: PanelView): PanelView => (none ? { ...p, lines: [] } : p);
    return this.backlogHidden() ? [strip(v.flows)] : [strip(v.flows), strip(v.backlog)];
  });
  protected readonly hasLines = computed(() => this.panels().some((p) => p.lines.length > 0));
  protected readonly flowChoices = computed<MeasureOption<FlowChoice>[]>(() =>
    flowOptions(this.choice()).map((value) => ({ value, label: FLOW_CHOICE_LABEL[value] })),
  );
  protected readonly emptyText = computed(() =>
    this.noActivity()
      ? 'No tasks were created or completed in this period.'
      : 'Select a line in the list to draw it.',
  );

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  constructor() {
    // The address wins over what this browser remembers (a shared link), and the address is completed from what is remembered.
    const snapshot = this.route.snapshot.queryParamMap;
    // An address that asks for the backlog (legacy `due=overdue`, `metric=overdue`, `bmetric=`) shows it even if the user hid it.
    this.backlogHidden.set(this.prefs.backlogHidden() && !namesBacklog(snapshot));
    if (hasTrendParams(snapshot)) {
      this.applyChoice(choiceFromParams(snapshot), false);
    } else {
      const remembered = this.prefs.load();
      this.applyChoice(remembered, !sameChoice(remembered, DEFAULT_CHOICE));
    }

    // Back, Forward or a pasted link changed the address: follow it.
    effect(() => {
      const p = this.params();
      untracked(() => {
        if (!this.urlSeen) {
          this.urlSeen = true;
          return;
        }
        const named = hasTrendParams(p) ? choiceFromParams(p) : DEFAULT_CHOICE;
        if (!sameChoice(named, this.choice())) this.applyChoice(named, false);
      });
    });

    effect(() => {
      const period = this.period();
      const key = this.refreshKey();
      const ids = this.choice().types;
      // The page-wide scope is part of the request: a new one reads the series again.
      this.scope.scope();
      untracked(() => this.ensure(period, key, ids));
    });
  }

  // ---- choices

  protected toggleAll(): void {
    this.message.set('');
    this.applyChoice(toggleAllMode(this.choice()), true);
  }

  protected toggleType(id: number): void {
    const c = this.choice();
    if (c.types.includes(id)) {
      this.message.set('');
      this.applyChoice({ ...c, types: c.types.filter((t) => t !== id) }, true);
    } else if (c.types.length >= MAX_TYPES) {
      this.message.set(LIMIT_MESSAGE);
    } else {
      this.message.set('');
      this.applyChoice({ ...c, types: [...c.types, id] }, true);
    }
  }

  protected setMetric(value: string): void {
    if (isFlowChoice(value) && value !== this.choice().metric) {
      this.applyChoice({ ...this.choice(), metric: value }, true);
    }
  }

  protected setBacklogMetric(value: string): void {
    const bmetric = isBacklogChoice(value) ? value : null;
    if (bmetric && bmetric !== this.choice().bmetric) {
      this.applyChoice({ ...this.choice(), bmetric }, true);
    }
  }

  protected toggleBacklog(): void {
    const hidden = !this.backlogHidden();
    this.backlogHidden.set(hidden);
    this.prefs.saveBacklogHidden(hidden);
    this.live.set(hidden ? 'Backlog hidden.' : 'Backlog shown.');
  }

  /** Select all: the task types with the highest totals for the shown measure, up to the limit. */
  protected selectTop(): void {
    const d = this.data();
    if (!d) return;
    const c = this.choice();
    const rows = typeRows(d.types, totalMeasure(c));
    const ids = rows.slice(0, MAX_TYPES).map((r) => r.id);
    this.message.set(
      rows.length > MAX_TYPES
        ? `Selected the ${MAX_TYPES} task types with the highest totals. ${LIMIT_MESSAGE}.`
        : '',
    );
    this.applyChoice({ ...c, types: ids }, true);
  }

  protected clearTypes(): void {
    this.message.set('');
    this.applyChoice({ ...this.choice(), types: [] }, true);
  }

  protected toggleTable(): void {
    this.asTable.update((v) => !v);
  }

  /** Makes the choices current: keeps the colours of types that stay checked, remembers them and (for a user's change) puts them in the address. */
  private applyChoice(wanted: TrendChoice, userChange: boolean): void {
    const { choice: next, announcement } = normalizeChoice(wanted, this.choice());
    if (announcement && userChange) this.live.set(announcement);
    const slots = new Map<number, number>();
    for (const id of next.types) {
      const kept = this.slots().get(id);
      slots.set(
        id,
        kept !== undefined && ![...slots.values()].includes(kept) ? kept : freeSlot(slots),
      );
    }
    this.slots.set(slots);
    this.choice.set(next);
    this.prefs.save(next);
    if (userChange) {
      const current = hasTrendParams(this.route.snapshot.queryParamMap)
        ? choiceFromParams(this.route.snapshot.queryParamMap)
        : DEFAULT_CHOICE;
      if (!sameChoice(current, next)) {
        // Replace, not push: ticking boxes must not fill the history that Back walks through.
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: choiceToParams(next),
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    }
  }

  // ---- data

  protected retry(): void {
    this.retrying = true;
    this.loadedGen = null;
    this.ensure(this.period(), this.refreshKey(), this.choice().types);
  }

  private ensure(period: Period, key: string | null, ids: readonly number[]): void {
    const gen = `${periodId(period)}|${key}|${this.scope.scope()}`;
    const current = this.data();
    if (
      current &&
      this.loadedGen === gen &&
      ids.every((id) => current.byTaskType.some((s) => s.taskTypeId === id))
    ) {
      return;
    }
    // A later page refresh reads fresh figures; a first read, a new period or another task type may use the short server cache.
    const fresh = this.lastKey !== null && this.lastKey !== key;
    this.lastKey = key;
    this.fetch(gen, period, [...ids], fresh);
  }

  private fetch(gen: string, period: Period, ids: number[], fresh: boolean): void {
    const args = periodArgs(period);
    const id = ++this.requestId;
    if (this.data()) this.busy.set(true);
    else this.state.set('loading');
    const start = () =>
      this.api
        .getDashboardTrend(
          args.period,
          args.from,
          args.to,
          undefined,
          ids.length > 0 ? ids : undefined,
          undefined,
          fresh ? true : undefined,
          this.scope.scope(),
        )
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (trend) => {
            if (id !== this.requestId) return;
            this.data.set(trend);
            this.loadedGen = gen;
            this.state.set('ready');
            this.busy.set(false);
            this.finishRetry('ready');
            this.prune(trend);
          },
          error: (e: unknown) => {
            if (id !== this.requestId) return;
            this.busy.set(false);
            if ((e as { status?: number }).status === 400 && ids.length > 0) {
              // A remembered or shared task type that no longer exists: drop the selection and read the rest.
              this.applyChoice({ ...this.choice(), types: [] }, true);
              this.live.set('A selected task type no longer exists and was removed.');
              this.fetch(gen, period, [], fresh);
              return;
            }
            if (!this.data()) this.state.set('error');
            this.finishRetry('failed');
          },
        });
    // A first read shows its failure inline (no toast); a later refresh keeps the figures on screen and stays quiet.
    if (this.data()) this.quiet.run(start);
    else this.quiet.runInline(start);
  }

  private finishRetry(outcome: 'ready' | 'failed'): void {
    if (!this.retrying) return;
    this.retrying = false;
    focusAfterRetry(this.host.nativeElement, this.injector, outcome);
  }

  /** A checked type the legend no longer lists (inactive and without tasks in this period) leaves the selection. */
  private prune(trend: DashboardTrend): void {
    const c = this.choice();
    const listed = new Set(trend.types.map((t) => t.id));
    const kept = c.types.filter((t) => listed.has(t));
    if (kept.length === c.types.length) return;
    const dropped = c.types
      .filter((t) => !listed.has(t))
      .map((t) => `Task type ${t}`)
      .join(', ');
    this.applyChoice({ ...c, types: kept }, true);
    this.live.set(`${dropped} has no tasks in this period and was removed from the chart.`);
  }
}
