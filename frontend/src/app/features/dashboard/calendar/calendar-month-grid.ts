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
import { CalDay } from './calendar-contract';
import {
  LEVELS,
  WEEKDAYS_SHORT,
  cellTooltip,
  dayAriaLabel,
  expectedShort,
  expectedText,
  longDay,
  outText,
} from './calendar-model';

interface Cell {
  date: string;
  num: number;
  inMonth: boolean;
  day: CalDay | null;
  muted: boolean;
}

/** The token family class of a level (`cv-good` ...); the neutral levels share `cv-none`. */
export const levelClass = (level: CalDay['level']): string => `cv-${LEVELS[level].key ?? 'none'}`;

/** The class of a calendar CELL or legend chip (CAL-11): a Good day is quiet (neutral, no fill, no label); only Watch, Low and Critical are coloured. */
export const cellClass = (level: CalDay['level']): string =>
  level === 'GOOD' ? 'cv-quiet' : levelClass(level);

/**
 * The Month view of the Dashboard Calendar (epic #1074, CAL-07): whole weeks, Sunday first. Each day is ONE button (a month is one tab stop; the arrow keys move between days
 * like My Matters, Home and End within the week, no new shortcuts) that prints the day number, the level as an icon and a word, "available of expected" ("26 of 36 expected",
 * "26/36" on a narrow cell), how many are out and the holiday chip. Colour is never the only signal. Weekends and non-working days are muted, today is filled, the selected day is
 * outlined. Days outside the month show their number only.
 */
@Component({
  selector: 'mf-cal-month',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './calendar-coverage.scss',
  host: { '(keydown)': 'onKey($event)' },
  template: `
    <div class="dow" aria-hidden="true">
      @for (d of dows; track d) {
        <span>{{ d }}</span>
      }
    </div>
    <div
      class="cgrid"
      role="grid"
      [attr.aria-label]="label()"
      [attr.aria-busy]="busy() ? 'true' : null"
    >
      @for (week of weeks(); track $index) {
        <div role="row" class="wk">
          @for (c of week; track c.date) {
            <div role="gridcell" class="cell" [class.out]="!c.inMonth">
              <button
                type="button"
                class="day"
                [class]="'day ' + cls(c)"
                [class.today]="c.date === today()"
                [class.sel]="c.date === selected()"
                [class.muted]="c.muted"
                [attr.data-day]="c.date"
                [attr.data-level]="c.day?.level ?? null"
                [attr.tabindex]="c.date === tabStop() ? 0 : -1"
                [attr.aria-label]="aria(c)"
                [attr.aria-pressed]="c.date === selected()"
                [attr.aria-haspopup]="'dialog'"
                [attr.title]="tip(c)"
                (click)="pick.emit(c.date)"
                (focus)="active.set(c.date)"
              >
                <span class="top">
                  <span class="num">{{ c.num }}</span>
                  @if (c.day && c.inMonth && !c.muted && c.day.level !== 'GOOD' && lv(c); as l) {
                    <span class="lv" aria-hidden="true"
                      ><i class="pi" [class]="l.icon"></i><span class="lw">{{ l.word }}</span></span
                    >
                  }
                </span>
                @if (c.day && c.inMonth) {
                  @if (!c.muted) {
                    <span
                      class="cnt"
                      [class.cnt--quiet]="c.day.level === 'GOOD'"
                      aria-hidden="true"
                    >
                      <b class="full">{{ full(c.day) }}</b>
                      <b class="short">{{ short(c.day) }}</b>
                    </span>
                    @if (c.day.outOfOffice > 0) {
                      <span class="out" aria-hidden="true"
                        ><i class="pi pi-user-minus"></i>{{ outOf(c.day) }}</span
                      >
                    }
                  }
                  @if (c.day.holidays.length > 0) {
                    <span class="hol" aria-hidden="true">
                      <span class="hchip" [class]="'hchip hc-' + c.day.holidays[0].colourKey"
                        ><i class="pi pi-flag"></i><span>{{ c.day.holidays[0].name }}</span></span
                      >
                      @if (c.day.holidays.length > 1) {
                        <span class="more">+{{ c.day.holidays.length - 1 }} more</span>
                      }
                    </span>
                  }
                }
              </button>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      flex: 1 1 0;
    }
    .dow {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      flex: none;
      background: var(--mf-surface-alt);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      text-transform: uppercase;
      border-top: 1px solid var(--mf-border);
    }
    .dow span {
      padding: var(--mf-s2) var(--mf-s3);
    }
    .cgrid {
      display: grid;
      grid-auto-rows: minmax(var(--mf-cal-row, 64px), 1fr);
      flex: 1 1 0;
      min-height: 0;
      overflow: auto;
    }
    .wk {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      min-height: var(--mf-cal-row, 64px);
    }
    .cell {
      min-width: 0;
      border-right: 1px solid var(--mf-border-soft);
      border-bottom: 1px solid var(--mf-border-soft);
      container-type: inline-size;
    }
    .cell.out .day {
      color: var(--mf-text-muted);
      background: var(--mf-surface-alt);
    }
    .day {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 2px;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      padding: var(--mf-s1) var(--mf-s2);
      border: 0;
      background: var(--cb, var(--mf-surface));
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
      overflow: hidden;
    }
    .day:hover {
      filter: brightness(0.97);
    }
    .day:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .day.sel {
      outline: 2px solid var(--mf-primary);
      outline-offset: -2px;
    }
    .day.sel:focus-visible {
      outline-color: var(--mf-focus);
    }
    .day.muted {
      color: var(--mf-text-muted);
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s1);
      min-height: 22px;
    }
    .num {
      font-weight: 700;
      font-size: var(--mf-fs-sm);
    }
    .today .num {
      display: inline-grid;
      place-items: center;
      min-width: 24px;
      height: 24px;
      border-radius: var(--mf-radius-pill);
      background: var(--mf-primary);
      color: var(--mf-primary-contrast);
    }
    .lv {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      color: var(--cf);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      white-space: nowrap;
    }
    .cnt {
      display: block;
      font-size: var(--mf-fs-sm);
      line-height: 1.25;
    }
    .cnt b {
      font-weight: 700;
    }
    /* A Good day says its count small and muted: the full figure is in the day panel and the cell's name. */
    .cnt--quiet {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .cnt--quiet b {
      font-weight: 500;
    }
    .cnt .short {
      display: none;
    }
    .out {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .hol {
      display: flex;
      align-items: center;
      gap: var(--mf-s1);
      min-width: 0;
      margin-top: auto;
    }
    .more {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
    }
    @container (max-width: 130px) {
      .cnt .full {
        display: none;
      }
      .cnt .short {
        display: block;
      }
      .lv--good .lw {
        display: none;
      }
    }
    @container (max-width: 90px) {
      .lw {
        display: none;
      }
      .out,
      .more {
        display: none;
      }
      .hchip {
        padding: 0 3px;
      }
      .hchip > span {
        display: none;
      }
    }
    @media (max-width: 767.98px) {
      :host {
        flex: none;
      }
      .cgrid {
        flex: none;
        overflow: visible;
        grid-auto-rows: minmax(64px, auto);
      }
      .dow span {
        padding: var(--mf-s1);
        text-align: center;
      }
      .day {
        padding: var(--mf-s1);
      }
    }
  `,
})
export class CalMonthGrid {
  readonly dates = input.required<readonly string[]>();
  /** `yyyy-mm`. */
  readonly month = input.required<string>();
  readonly days = input.required<ReadonlyMap<string, CalDay>>();
  readonly today = input.required<string>();
  readonly selected = input<string | null>(null);
  readonly busy = input(false);
  readonly label = input('Month');
  readonly pick = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly dows = WEEKDAYS_SHORT;
  protected readonly active = signal<string | null>(null);

  protected readonly weeks = computed<Cell[][]>(() => {
    const month = this.month();
    const cells: Cell[] = this.dates().map((date) => {
      const day = this.days().get(date) ?? null;
      return {
        date,
        num: Number(date.slice(8)),
        inMonth: date.startsWith(month),
        day,
        muted: day?.level === 'NON_WORKING',
      };
    });
    const out: Cell[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  });

  /** The one tab stop of the grid: the day last focused, else the selected day, today, the first of the month. */
  protected readonly tabStop = computed(() => {
    const dates = this.dates();
    for (const d of [this.active(), this.selected(), this.today()])
      if (d && dates.includes(d)) return d;
    return dates.find((d) => d.startsWith(this.month())) ?? dates[0];
  });

  protected cls(c: Cell): string {
    if (!c.day || !c.inMonth) return 'cv-none';
    return cellClass(c.day.level);
  }
  protected lv(c: Cell) {
    return c.day ? LEVELS[c.day.level] : null;
  }
  protected full = expectedText;
  protected short = expectedShort;
  protected outOf = outText;

  protected aria(c: Cell): string {
    return c.day && c.inMonth ? dayAriaLabel(c.day, this.today()) : longDay(c.date);
  }
  protected tip(c: Cell): string | null {
    return c.day && c.inMonth ? cellTooltip(c.day) : null;
  }

  /** Arrow keys move between days (a week up and down, a day left and right, Home and End within the week), as in My Matters. */
  protected onKey(e: KeyboardEvent): void {
    const cur = (document.activeElement as HTMLElement | null)?.dataset?.['day'];
    if (!cur || !this.host.contains(document.activeElement)) return;
    const dates = this.dates();
    const i = dates.indexOf(cur);
    let to = i;
    switch (e.key) {
      case 'ArrowLeft':
        to = i - 1;
        break;
      case 'ArrowRight':
        to = i + 1;
        break;
      case 'ArrowUp':
        to = i - 7;
        break;
      case 'ArrowDown':
        to = i + 7;
        break;
      case 'Home':
        to = i - (i % 7);
        break;
      case 'End':
        to = i - (i % 7) + 6;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (to < 0 || to >= dates.length) return;
    this.active.set(dates[to]);
    queueMicrotask(() =>
      this.host.querySelector<HTMLElement>(`[data-day="${dates[to]}"]`)?.focus(),
    );
  }
}
