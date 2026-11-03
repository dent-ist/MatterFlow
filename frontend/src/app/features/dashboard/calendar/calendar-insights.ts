import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CalSummary } from './calendar-contract';
import { Tip } from '../../../shared/ui/tip';
import { LEVELS, WEEKDAYS_SHORT, addDays, dayOfWeek } from './calendar-model';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 1 to 7" (or "Oct 27 to Nov 2" across a month end): the seven days from a week's first day. */
export function weekRangeText(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const m = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1];
  const d = (iso: string) => Number(iso.slice(8, 10));
  return m(weekStart) === m(end)
    ? `${m(weekStart)} ${d(weekStart)} to ${d(end)}`
    : `${m(weekStart)} ${d(weekStart)} to ${m(end)} ${d(end)}`;
}

/** The words of the free-capacity forecast (the battery's formula, decision AS): 50 % and more Healthy, 25 to 49 Limited, under 25 Low. */
export function forecastWord(percent: number | null): {
  word: string;
  icon: string;
  tone: 'good' | 'watch' | 'crit' | 'none';
} {
  if (percent === null) return { word: 'Nobody in', icon: 'pi-minus-circle', tone: 'none' };
  if (percent >= 50) return { word: 'Healthy', icon: 'pi-check-circle', tone: 'good' };
  if (percent >= 25) return { word: 'Limited', icon: 'pi-exclamation-triangle', tone: 'watch' };
  return { word: 'Low', icon: 'pi-ban', tone: 'crit' };
}

/** The sentence of the 30-day coverage-risk banner. */
export function riskSentence(risk: CalSummary['risk']): string {
  if (risk.daysAtRisk === 0) return `No risk days in the next ${risk.windowDays} days.`;
  const n = `${risk.daysAtRisk} risk ${risk.daysAtRisk === 1 ? 'day' : 'days'} in the next ${risk.windowDays} days.`;
  if (!risk.firstRiskDate) return n;
  const wd = WEEKDAYS_SHORT[dayOfWeek(risk.firstRiskDate)];
  const md = `${risk.firstRiskDate.slice(5, 7)}/${risk.firstRiskDate.slice(8, 10)}`;
  const level = risk.firstRiskLevel ? ` (${LEVELS[risk.firstRiskLevel].word})` : '';
  const pod = risk.worstPod ? ` Thinnest pod: ${risk.worstPod.name}.` : '';
  return `${n} First: ${wd} ${md}${level}.${pod}`;
}

/**
 * The two summary strips of the Calendar (epic #1074, CAL-07): the coverage-risk banner for the next 30 days with "Show risk days" (goes to the first risk day and opens it) and the
 * free-capacity forecast for the next four weeks as a row of small tiles (numbers only). On a phone the forecast is a disclosure. Both come from one summary read.
 */
@Component({
  selector: 'mf-cal-insights',
  imports: [Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './calendar-coverage.scss',
  template: `
    <div class="in">
      @if (summary(); as s) {
        @if (s.risk.daysAtRisk > 0) {
          <div class="risk cv-watch" data-risk-banner>
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            <p class="risk__t">{{ sentence() }}</p>
            @if (s.risk.firstRiskDate) {
              <button
                type="button"
                class="mf-btn risk__b"
                data-show-risk
                (click)="showRisk.emit(s.risk.firstRiskDate!)"
              >
                Show risk days
              </button>
            }
          </div>
        } @else {
          <!-- No risk day: nothing is drawn, the status is still spoken. -->
          <p class="sr-only" role="status" data-risk-banner>{{ sentence() }}</p>
        }
        <section
          class="fc"
          [class.fc--open]="open()"
          aria-label="Free task slots, next 4 weeks"
          data-forecast
        >
          <button
            type="button"
            class="fc__h"
            [attr.aria-expanded]="open()"
            aria-controls="cal-fc-tiles"
            (click)="open.set(!open())"
          >
            <i class="pi pi-chart-line" aria-hidden="true"></i>
            <span
              mfTip="Measures free task slots (open task capacity), not how many people are present."
              >Free task slots, next 4 weeks</span
            >
            <i
              class="pi fc__chev"
              [class]="open() ? 'pi-chevron-up' : 'pi-chevron-down'"
              aria-hidden="true"
            ></i>
          </button>
          <ul class="fc__tiles" id="cal-fc-tiles">
            @for (f of s.forecast; track f.weekStart) {
              <li [class]="'tile cv-' + tone(f.freePercent)" [attr.data-week]="f.weekStart">
                <span class="tile__p">{{
                  f.freePercent === null ? 'n/a' : f.freePercent + '%'
                }}</span>
                <span class="tile__w"
                  ><i class="pi" [class]="word(f.freePercent).icon" aria-hidden="true"></i
                  >{{ word(f.freePercent).word }}</span
                >
                <span class="tile__d">{{ range(f.weekStart) }}</span>
                <span class="sr-only"
                  >{{ range(f.weekStart) }}:
                  {{
                    f.freePercent === null ? 'nobody available' : f.freePercent + ' percent free'
                  }}, {{ f.availablePeople }} people on average.</span
                >
              </li>
            }
          </ul>
        </section>
      } @else if (error()) {
        <p class="soft" role="status" data-insights-error>
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i> The risk banner and the
          forecast could not be loaded.
          <button type="button" class="mf-btn mf-btn--text" (click)="retry.emit()">Retry</button>
        </p>
      } @else {
        <div class="skel" aria-hidden="true"><span></span><span></span></div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      flex: none;
    }
    .in {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      align-items: stretch;
    }
    .risk {
      display: flex;
      flex: 0 1 auto;
      align-self: center;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
      padding: 2px var(--mf-s3);
      border: 1px solid var(--cs);
      border-radius: var(--mf-radius-pill);
      background: var(--cb);
      color: var(--cf);
    }
    .risk__b {
      min-height: 28px;
      padding-block: 0;
    }
    .risk__t {
      flex: 1 1 auto;
      margin: 0;
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .fc {
      flex: 1 1 26rem;
      min-width: 0;
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
    }
    .fc__h {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      width: 100%;
      padding: var(--mf-s1) var(--mf-s3);
      border: 0;
      background: none;
      color: var(--mf-text-muted);
      font: inherit;
      font-size: var(--mf-fs-sm);
      font-weight: 700;
      text-align: left;
      cursor: default;
    }
    .fc__chev {
      display: none;
      margin-left: auto;
    }
    .fc__tiles {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--mf-s2);
      margin: 0;
      padding: 0 var(--mf-s3) var(--mf-s2);
      list-style: none;
    }
    .tile {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0 var(--mf-s2);
      min-width: 0;
    }
    .tile__d {
      flex: 1 1 100%;
    }
    .tile__p {
      font-size: var(--mf-fs-lg);
      font-weight: 700;
      line-height: 1.2;
    }
    .tile__w {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      color: var(--cf);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
    }
    .tile__d {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .soft {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .skel {
      display: flex;
      flex: 1 1 100%;
      gap: var(--mf-s2);
    }
    .skel span {
      flex: 1;
      height: 48px;
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface-alt);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    /* A phone, or a window under 700 px high: the forecast folds into a disclosure so the grid keeps the room. */
    @media (max-width: 767.98px), (max-height: 700px) {
      .fc__h {
        cursor: pointer;
      }
      .fc__chev {
        display: inline;
      }
      .fc:not(.fc--open) .fc__tiles {
        display: none;
      }
      .fc__tiles {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .fc {
        align-self: flex-start;
      }
    }
    @media (max-width: 767.98px) {
      .fc__h {
        min-height: 44px;
      }
      .risk {
        flex-wrap: wrap;
        border-radius: var(--mf-radius-xl);
      }
    }
  `,
})
export class CalInsights {
  readonly summary = input<CalSummary | null>(null);
  readonly error = input(false);
  readonly showRisk = output<string>();
  readonly retry = output<void>();

  protected readonly open = signal(false);
  protected readonly sentence = computed(() => {
    const s = this.summary();
    return s ? riskSentence(s.risk) : '';
  });
  protected word = forecastWord;
  protected range = weekRangeText;
  protected tone = (p: number | null): string => {
    const t = forecastWord(p).tone;
    return t === 'none' ? 'none' : t === 'crit' ? 'crit' : t;
  };
}
