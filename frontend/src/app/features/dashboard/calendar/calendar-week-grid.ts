import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CalDay, CoverageLevel, PodCoverage } from './calendar-contract';
import { cellClass } from './calendar-month-grid';
import {
  LEVELS,
  WEEKDAYS_SHORT,
  dayOfWeek,
  expectedShort,
  expectedText,
  longDay,
  podOn,
  weekPods,
} from './calendar-model';

interface Row {
  key: string;
  name: string;
  sub: string;
  cells: { date: string; text: string; spoken: string; level: CoverageLevel; out: number }[];
}

/**
 * The Week view of the Dashboard Calendar (epic #1074, CAL-07): pods by days, one table. The first row is everybody in view, then one row per pod; each cell says "available/expected",
 * the level as an icon and a word, and how many are out. The day headers are the buttons (one tab stop; Left and Right move between days, Home and End to the first and last day): a
 * click opens the day's panel. On a phone the table scrolls inside its own labelled region, never the page.
 */
@Component({
  selector: 'mf-cal-week',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './calendar-coverage.scss',
  host: { '(keydown)': 'onKey($event)' },
  template: `
    <div class="wrap" role="region" tabindex="0" aria-label="Week, pods by days" data-week-scroll>
      <table class="wt" [attr.aria-busy]="busy() ? 'true' : null">
        <caption class="sr-only">
          Available of expected people per pod and day. Choose a day heading to open its panel.
        </caption>
        <thead>
          <tr>
            <th scope="col" class="pod">Pod</th>
            @for (d of dates(); track d) {
              <th
                scope="col"
                class="dh"
                [class.today]="d === today()"
                [class.sel]="d === selected()"
                [class.wknd]="isOff(d)"
              >
                <button
                  type="button"
                  class="dbtn"
                  [attr.data-day]="d"
                  [attr.tabindex]="d === tabStop() ? 0 : -1"
                  [attr.aria-label]="longDay(d) + (d === today() ? ', today' : '')"
                  [attr.aria-pressed]="d === selected()"
                  [attr.aria-haspopup]="'dialog'"
                  (click)="pick.emit(d)"
                  (focus)="active.set(d)"
                >
                  <span class="dn">{{ dow(d) }}</span>
                  <span class="dd">{{ md(d) }}</span>
                </button>
                @for (h of holidays(d).slice(0, 1); track h.name) {
                  <span
                    class="hchip"
                    [class]="'hchip hc-' + h.colourKey"
                    [attr.title]="h.category + ': ' + h.name"
                    ><i class="pi pi-flag" aria-hidden="true"></i><span>{{ h.name }}</span></span
                  >
                }
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (r of rows(); track r.key) {
            <tr>
              <th scope="row" class="pod">
                <span class="pn">{{ r.name }}</span>
                <span class="ps">{{ r.sub }}</span>
              </th>
              @for (c of r.cells; track c.date) {
                <td
                  [class]="'c ' + cls(c.level)"
                  [class.sel]="c.date === selected()"
                  [class.today]="c.date === today()"
                  [attr.data-level]="c.level"
                >
                  @if (c.level === 'NON_WORKING') {
                    <span class="sr-only">Non-working</span>
                  } @else {
                    <span class="cnt" aria-hidden="true">{{ c.text }}</span>
                    @if (c.level !== 'GOOD') {
                      <span class="lv" aria-hidden="true"
                        ><i class="pi" [class]="icon(c.level)"></i
                        ><span class="lw">{{ word(c.level) }}</span></span
                      >
                    }
                    @if (c.out > 0) {
                      <span class="out" aria-hidden="true"
                        ><i class="pi pi-user-minus"></i>{{ c.out }} out</span
                      >
                    }
                    <span class="sr-only">{{ c.spoken }}, coverage {{ word(c.level) }}</span>
                  }
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      flex: 1 1 0;
    }
    .wrap {
      /* Positioned, so the visually hidden texts inside the table are clipped with it and never widen the page. */
      position: relative;
      flex: 1 1 0;
      min-height: 0;
      overflow: auto;
      border-top: 1px solid var(--mf-border);
    }
    .wrap:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .wt {
      width: 100%;
      min-width: 44rem;
      border-collapse: separate;
      border-spacing: 0;
      table-layout: fixed;
    }
    th,
    td {
      border-right: 1px solid var(--mf-border-soft);
      border-bottom: 1px solid var(--mf-border-soft);
      padding: 0;
      vertical-align: top;
      text-align: left;
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--mf-surface-alt);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      text-transform: uppercase;
    }
    .pod {
      width: 9rem;
      padding: var(--mf-s2) var(--mf-s3);
      background: var(--mf-surface);
      color: var(--mf-text);
      text-transform: none;
      position: sticky;
      left: 0;
      z-index: 1;
    }
    thead .pod {
      z-index: 3;
      background: var(--mf-surface-alt);
      color: var(--mf-text-muted);
      text-transform: uppercase;
    }
    .pn {
      display: block;
      font-weight: 700;
      font-size: var(--mf-fs-sm);
    }
    .ps {
      display: block;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 400;
    }
    .dh {
      padding: 0 0 var(--mf-s1);
    }
    .dh.wknd {
      background: var(--mf-cov-none-bg);
    }
    .dh.sel {
      box-shadow: inset 0 3px 0 var(--mf-primary);
      color: var(--mf-primary);
    }
    .dbtn {
      display: flex;
      align-items: baseline;
      gap: var(--mf-s2);
      width: 100%;
      min-height: 32px;
      padding: var(--mf-s1) var(--mf-s3);
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      font-weight: 700;
      text-transform: uppercase;
      cursor: pointer;
    }
    .dbtn:hover {
      background: var(--mf-selected-bg);
    }
    .dbtn:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .today .dd {
      display: inline-grid;
      place-items: center;
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-primary);
      color: var(--mf-primary-contrast);
    }
    .dh .hchip {
      margin: 0 var(--mf-s2);
      max-width: calc(100% - 16px);
    }
    .c {
      height: 64px;
      padding: var(--mf-s1) var(--mf-s2);
      background: var(--cb, var(--mf-surface));
    }
    .c.sel {
      box-shadow:
        inset 2px 0 0 var(--mf-primary),
        inset -2px 0 0 var(--mf-primary);
    }
    .cnt {
      display: block;
      font-weight: 700;
      font-size: var(--mf-fs-md);
    }
    .lv {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      color: var(--cf);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
    }
    .out {
      display: block;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    @media (max-width: 767.98px) {
      :host {
        flex: none;
      }
      .wrap {
        flex: none;
      }
    }
  `,
})
export class CalWeekGrid {
  readonly dates = input.required<readonly string[]>();
  readonly days = input.required<ReadonlyMap<string, CalDay>>();
  readonly today = input.required<string>();
  readonly selected = input<string | null>(null);
  readonly busy = input(false);
  readonly pick = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly active = signal<string | null>(null);
  protected readonly longDay = longDay;

  private readonly list = computed(() =>
    this.dates()
      .map((d) => this.days().get(d))
      .filter((d): d is CalDay => !!d),
  );

  protected readonly rows = computed<Row[]>(() => {
    const dates = this.dates();
    const all: Row = {
      key: 'all',
      name: 'All pods in view',
      sub: this.list()[0] ? `${this.list()[0].total} people` : '',
      cells: dates.map((date) => {
        const d = this.days().get(date);
        return d
          ? {
              date,
              text: expectedShort(d),
              spoken: expectedText(d),
              level: d.level,
              out: d.outOfOffice,
            }
          : { date, text: '', spoken: '', level: 'NON_WORKING' as CoverageLevel, out: 0 };
      }),
    };
    const pods = weekPods(this.list()).map<Row>((p) => {
      const sample = this.list()
        .map((d) => podOn(d, p.podId))
        .find((x): x is PodCoverage => !!x);
      return {
        key: `pod-${p.podId}`,
        name: p.name,
        sub: sample ? `min ${sample.minimum}` : '',
        cells: dates.map((date) => {
          const d = this.days().get(date);
          const pod = d ? podOn(d, p.podId) : null;
          return pod
            ? {
                date,
                text: `${pod.available}/${pod.expected}`,
                spoken: `${pod.available} of ${pod.expected} expected`,
                level: pod.level,
                out: pod.expected - pod.available,
              }
            : { date, text: '', spoken: '', level: 'NON_WORKING' as CoverageLevel, out: 0 };
        }),
      };
    });
    return [all, ...pods];
  });

  protected readonly tabStop = computed(() => {
    const dates = this.dates();
    for (const d of [this.active(), this.selected(), this.today()])
      if (d && dates.includes(d)) return d;
    return dates[1] ?? dates[0];
  });

  protected cls = (level: CoverageLevel): string => cellClass(level);
  protected icon = (level: CoverageLevel): string => LEVELS[level].icon;
  protected word = (level: CoverageLevel): string => LEVELS[level].word;
  protected dow = (date: string): string => WEEKDAYS_SHORT[dayOfWeek(date)];
  protected md = (date: string): string => `${date.slice(5, 7)}/${date.slice(8)}`;
  protected isOff = (date: string): boolean => this.days().get(date)?.level === 'NON_WORKING';
  protected holidays = (date: string) => this.days().get(date)?.holidays ?? [];

  /** Left and Right move between the day headings, Home and End to the first and last day. */
  protected onKey(e: KeyboardEvent): void {
    const cur = (document.activeElement as HTMLElement | null)?.dataset?.['day'];
    if (!cur || !this.host.contains(document.activeElement)) return;
    const dates = this.dates();
    const i = dates.indexOf(cur);
    let to = i;
    if (e.key === 'ArrowLeft') to = i - 1;
    else if (e.key === 'ArrowRight') to = i + 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = dates.length - 1;
    else return;
    e.preventDefault();
    if (to < 0 || to >= dates.length) return;
    this.active.set(dates[to]);
    queueMicrotask(() =>
      this.host.querySelector<HTMLElement>(`[data-day="${dates[to]}"]`)?.focus(),
    );
  }
}
