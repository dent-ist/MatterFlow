import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import {
  DashboardBoardClient,
  UserHistory,
  UserHistoryType,
} from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { Segmented } from '../../../shared/ui/segmented';
import { Tip } from '../../../shared/ui/tip';
import { DashScope } from '../dash-scope';
import {
  comparisonOf,
  durationText,
  monthLong,
  monthShort,
  onTimeText,
} from './users-history-model';

type HistoryState = 'loading' | 'ready' | 'error' | 'missing';

/**
 * The "Task types" and "Trend" panels of the person drawer (US-03, #1093), read from `GET /dashboard/users/{id}/history` (the page scope applies; 3 or 12 months for the task
 * types). Task types: a table of what the person completed in the window with their median time next to the firm's, worded without judgement ("Longer than the firm median" with
 * an icon and the ratio; "Not enough tasks yet" under five tasks). Trend: completed per month for the last 12 months as small bars with their numbers, the on-time rate and a table
 * of the same figures. Durations are working time unless the server says clock time. Operational information for planning and coaching: no ranking of people.
 */
@Component({
  selector: 'mf-users-history',
  imports: [TaskTypeIcon, Segmented, Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state()) {
      @case ('loading') {
        <div class="bones" role="status" aria-busy="true" data-history-loading>
          <span class="sr-only">Loading history</span>
          @for (n of bones; track n) {
            <span class="bone" aria-hidden="true"></span>
          }
        </div>
      }
      @case ('error') {
        <div class="alert" role="alert" data-history-error>
          <span>Couldn't load the history.</span>
          <button type="button" class="mf-btn" data-history-retry (click)="load()">Retry</button>
        </div>
      }
      @case ('missing') {
        <p class="empty" data-history-missing>
          <i class="pi pi-info-circle" aria-hidden="true"></i>This person is not in the pods of this
          scope, so their history is not shown.
        </p>
      }
      @default {
        @if (data(); as h) {
          @if (panel() === 'types') {
            <div class="head">
              <div mfSegmented role="group" aria-label="Window" data-window>
                @for (m of windows; track m) {
                  <button
                    type="button"
                    class="mf-btn"
                    [attr.data-window]="m"
                    [attr.aria-pressed]="months() === m"
                    (click)="setMonths(m)"
                  >
                    {{ m }} months
                  </button>
                }
              </div>
              <p class="note" data-basis>
                Completed tasks, last {{ h.windowMonths }} months. Times are {{ basisWord() }}.
              </p>
            </div>
            @if (h.types.length === 0) {
              <p class="empty" data-types-empty>
                <i class="pi pi-inbox" aria-hidden="true"></i>
                {{ h.displayName }} has not completed any tasks in this window.
              </p>
            } @else {
              <div class="wrap">
                <table class="tbl" data-types-table>
                  <caption class="sr-only">
                    Task types completed by
                    {{
                      h.displayName
                    }}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Task type</th>
                      <th scope="col" class="num">Done</th>
                      <th scope="col">vs firm</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (t of h.types; track t.taskTypeId) {
                      @let c = compare(t);
                      <tr [attr.data-type-row]="t.taskTypeId">
                        <th scope="row">
                          <span class="tname">
                            <mf-task-type-icon [iconKey]="t.iconKey" size="sm" />
                            <span>{{ t.name }}</span>
                          </span>
                        </th>
                        <td class="num">{{ t.completed }}</td>
                        <td>
                          @if (c.tone !== 'none') {
                            <span
                              class="cmp"
                              [class]="'cmp cmp--' + c.tone"
                              data-compare
                              [mfTip]="detail(t)"
                              tabindex="0"
                            >
                              <i class="pi" [class]="c.icon" aria-hidden="true"></i>
                              <span data-compare-text>{{ c.short }}</span>
                              <span class="sr-only">. {{ c.word }}. {{ detail(t) }}</span>
                            </span>
                          } @else {
                            <span
                              class="muted"
                              data-too-few
                              mfTip="Too few completed tasks of this type for a fair comparison"
                              tabindex="0"
                              >Too few
                              <span class="sr-only"
                                >completed tasks of this type for a fair comparison.
                                {{ detail(t) }}</span
                              ></span
                            >
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <p class="foot">
                A median needs at least {{ h.minSampleSize }} completed tasks of a type. This is for
                planning and coaching, not a ranking of people.
              </p>
            }
          } @else {
            <section aria-labelledby="uh-trend">
              <h3 id="uh-trend" class="h">Completed per month</h3>
              <p class="note">
                {{ h.totalCompleted }} completed tasks in the last {{ h.windowMonths }} months; the
                bars show the last 12 months.
              </p>
              <ol class="bars" data-trend-bars>
                @for (m of h.months; track m.month) {
                  <li
                    class="bar"
                    [attr.aria-label]="monthLong(m.month) + ': ' + m.completed + ' completed'"
                  >
                    <span class="n">{{ m.completed }}</span>
                    <span class="col" aria-hidden="true"
                      ><span class="fill" [style.height.%]="barHeight(m.completed)"></span
                    ></span>
                    <span class="mo" aria-hidden="true">{{ short(m.month) }}</span>
                  </li>
                }
              </ol>
              <p class="ontime" data-ontime>
                <i class="pi pi-clock" aria-hidden="true"></i> {{ onTime() }}
              </p>
              <details class="tableview">
                <summary>Table of the same figures</summary>
                <table class="tbl" data-trend-table>
                  <caption class="sr-only">
                    Completed tasks per month
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Month</th>
                      <th scope="col" class="num">Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (m of h.months; track m.month) {
                      <tr>
                        <th scope="row">{{ monthLong(m.month) }}</th>
                        <td class="num">{{ m.completed }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </details>
            </section>
          }
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
      margin-bottom: var(--mf-s3);
    }
    .note,
    .foot,
    .muted {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .foot {
      margin-top: var(--mf-s3);
    }
    .h {
      margin: 0 0 var(--mf-s1);
      font-size: var(--mf-fs-md);
    }
    .wrap {
      overflow-x: auto;
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    .tbl {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--mf-fs-sm);
    }
    th,
    td {
      padding: var(--mf-s2);
      text-align: left;
      vertical-align: middle;
      border-bottom: 1px solid var(--mf-border);
    }
    thead th {
      color: var(--mf-text-muted);
      background: var(--mf-surface-alt);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
    }
    tbody tr:last-child > * {
      border-bottom: 0;
    }
    tbody th {
      font-weight: 600;
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .tname {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .sample {
      display: block;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .cmp {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      white-space: nowrap;
    }
    .cmp--longer {
      color: var(--mf-info);
      background: var(--mf-info-bg);
      border-color: var(--mf-info);
    }
    .cmp--shorter {
      color: var(--mf-text);
      background: var(--mf-surface-alt);
    }
    .cmp--same {
      color: var(--mf-text-muted);
      background: var(--mf-surface);
    }
    .bars {
      display: flex;
      gap: var(--mf-s1);
      align-items: flex-end;
      margin: var(--mf-s3) 0;
      padding: 0;
      list-style: none;
    }
    .bar {
      display: grid;
      flex: 1 1 0;
      min-width: 0;
      justify-items: center;
      gap: 2px;
    }
    .col {
      display: flex;
      align-items: flex-end;
      width: 100%;
      height: 6rem;
      background: var(--mf-surface-alt);
      border-radius: var(--mf-radius);
      overflow: hidden;
    }
    .fill {
      display: block;
      width: 100%;
      min-height: 2px;
      background: var(--mf-primary);
    }
    .n {
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .mo {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .ontime {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s3);
      font-weight: 600;
    }
    .tableview summary {
      min-height: 24px;
      cursor: pointer;
      color: var(--mf-link);
    }
    .empty,
    .alert {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      color: var(--mf-text-muted);
    }
    .alert {
      color: var(--mf-danger);
    }
    .bones {
      display: grid;
      gap: var(--mf-s2);
    }
    .bone {
      display: block;
      height: 2.5rem;
      background: var(--mf-surface-alt);
      border-radius: var(--mf-radius);
    }
  `,
})
export class UsersHistory {
  private readonly api = inject(DashboardBoardClient);
  private readonly scope = inject(DashScope);
  private readonly destroyRef = inject(DestroyRef);

  readonly userId = input.required<number>();
  /** `types` or `trend`: the two panels of the drawer. */
  readonly panel = input<'types' | 'trend'>('types');

  protected readonly windows = [3, 12] as const;
  protected readonly bones = [1, 2, 3, 4];
  protected readonly months = signal<3 | 12>(3);
  /** The Trend panel always reads 12 months; Task types reads the chosen window. */
  private readonly window = computed(() => (this.panel() === 'trend' ? 12 : this.months()));
  protected readonly state = signal<HistoryState>('loading');
  protected readonly data = signal<UserHistory | null>(null);
  private sub: Subscription | null = null;

  protected readonly monthLong = monthLong;
  protected readonly short = monthShort;
  protected readonly dur = durationText;
  protected readonly compare = comparisonOf;

  /** Medians and sample sizes for the tooltip and the screen reader text (US-08). */
  protected detail(t: UserHistoryType): string {
    const own =
      t.medianMinutes === null || t.medianMinutes === undefined
        ? 'Too few tasks for a median'
        : `Their median ${durationText(t.medianMinutes)} (${t.sampleSize} tasks)`;
    const firm =
      t.firmMedianMinutes === null || t.firmMedianMinutes === undefined
        ? 'no firm median'
        : `firm median ${durationText(t.firmMedianMinutes)} (${t.firmSampleSize} tasks)`;
    return `${own}; ${firm}`;
  }
  protected readonly basisWord = computed(() =>
    this.data()?.durationBasis === 'CLOCK' ? 'clock time' : 'working time',
  );
  protected readonly onTime = computed(() => {
    const h = this.data();
    return h ? onTimeText(h.onTime) : '';
  });
  private readonly peak = computed(() =>
    Math.max(1, ...(this.data()?.months ?? []).map((m) => m.completed)),
  );

  constructor() {
    effect(() => {
      this.userId();
      this.window();
      this.scope.scope();
      untracked(() => this.load());
    });
    this.destroyRef.onDestroy(() => this.sub?.unsubscribe());
  }

  protected barHeight(count: number): number {
    return count === 0 ? 0 : Math.max(4, Math.round((count / this.peak()) * 100));
  }

  protected setMonths(m: 3 | 12): void {
    this.months.set(m);
  }

  protected load(): void {
    this.sub?.unsubscribe();
    this.state.set('loading');
    this.sub = this.api
      .getDashboardUserHistory(this.userId(), this.window(), this.scope.scope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (h) => {
          this.data.set(h);
          this.state.set('ready');
        },
        error: (e: unknown) => {
          this.state.set(e instanceof ApiError && e.status === 404 ? 'missing' : 'error');
        },
      });
  }
}
