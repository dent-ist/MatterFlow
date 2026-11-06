import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DashboardCapacity, DashboardUnassignedGauge } from '../../../api/generated/api-client';
import { Tip } from '../../../shared/ui/tip';
import { BatteryView, batteryView } from './capacity-model';
import { arcPath } from './dash-gauge';
import { GaugeView, gaugeView, levelChange } from './gauge-model';
import { GAUGE_LEVEL_CSS } from './gauge-level-css';

const SEGMENTS = [0, 1, 2, 3, 4, 5] as const;

/**
 * The compact battery and gauge on the Needs Attention cards row while the Summary's right panel is hidden (#1233). Pure drawing: the page's full battery keeps reading the capacity
 * (this gets its last good read) and the gauge block is the summary's, so there is no new request. Same figures, colour steps and neutral words as the full widgets; colour is never the
 * only signal (the percentage, the free slots, the level number and the level word are text).
 *
 * - Battery (Dashboard.ViewUsers): about 112 x 36 px with the remaining percentage and the bolt inside, "50 free slots" beside it and the red "7 over" only above zero. Its tooltip is the
 *   whole Team Capacity summary. Not a button: the panel is shown again with the Show Panel button.
 * - Gauge (Dashboard.ViewSummary): a half circle with the level number, the level chip (icon and word) and the oldest wait. A click or Enter selects the Unassigned card longest waiting first,
 *   like the full gauge; its tooltip is the full description; `aria-live="polite"` speaks only when the level changes.
 *
 * In a row that is too narrow (container `top` of the Summary tab) the gauge drops its chip text first, then the battery text; the row never wraps or overflows.
 */
@Component({
  selector: 'mf-dash-compact',
  imports: [Tip, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-dash-compact-widgets]': '""' },
  template: `
    @if (bv(); as v) {
      <div
        class="cb"
        role="img"
        data-compact-battery
        [attr.aria-label]="batteryLabel(v)"
        [mfTip]="batteryTip(v)"
      >
        <div
          class="bat"
          [style.--mf-rem]="v.level === null ? null : 'var(--mf-rem-' + v.level + ')'"
          [style.--mf-rem-fg]="v.level === null ? null : 'var(--mf-rem-' + v.level + '-fg)'"
        >
          <div class="shell" [class.shell--neutral]="v.mode !== 'normal'">
            <div class="fill" [style.width.%]="v.charge"></div>
            <span
              class="val"
              [class.val--empty]="v.mode === 'normal' && v.charge < 28"
              [style.left]="
                v.mode === 'normal' && v.charge < 28
                  ? 'calc(' + v.charge + '% + var(--mf-s1))'
                  : null
              "
              data-compact-battery-big
            >
              @if (v.mode === 'normal') {
                <i class="pi pi-bolt" aria-hidden="true"></i>
              }
              {{ v.bigText }}
            </span>
          </div>
          <div class="cap"></div>
        </div>
        <span class="free" data-compact-free>{{ v.freeText }}</span>
        @if (v.overText) {
          <span class="over" data-compact-over>
            <i class="pi pi-exclamation-circle" aria-hidden="true"></i>{{ v.overCapacity }} over
          </span>
        }
      </div>
    }

    @if (gv(); as g) {
      <p class="sr-only" role="status" aria-live="polite" data-compact-gauge-live>
        {{ announcement() }}
      </p>
      @if (g.clear) {
        <div
          class="cg"
          role="img"
          data-compact-gauge
          [attr.aria-label]="g.ariaLabel"
          [mfTip]="gaugeTip(g)"
        >
          <ng-container [ngTemplateOutlet]="gaugeBody" />
        </div>
      } @else {
        <button
          type="button"
          class="cg cg--btn"
          data-compact-gauge
          [attr.aria-label]="g.ariaLabel + ' Show them, longest waiting first.'"
          [mfTip]="gaugeTip(g)"
          (click)="show.emit()"
        >
          <ng-container [ngTemplateOutlet]="gaugeBody" />
        </button>
      }
      <ng-template #gaugeBody>
        <span class="dial" aria-hidden="true">
          <svg viewBox="24 20 212 108" preserveAspectRatio="xMidYMax meet" focusable="false">
            @for (i of segments; track i) {
              <path
                class="seg"
                [attr.d]="seg(i)"
                [style.stroke]="'var(--mf-wait-' + i + ')'"
                [attr.opacity]="segOpacity(g, i)"
              />
            }
          </svg>
          <span class="lv" data-compact-gauge-level>{{ g.clear ? '0' : g.level }}</span>
        </span>
        <span class="lvl" [class]="'lvl L' + (g.clear ? 'c' : g.level)" data-compact-gauge-chip>
          <i
            class="pi"
            [class]="g.clear ? 'pi-check' : g.level >= 4 ? 'pi-exclamation-triangle' : 'pi-clock'"
            aria-hidden="true"
          ></i>
          <span class="lvl__t">{{ g.badge }}</span>
        </span>
        @if (!g.clear) {
          <span class="age" data-compact-gauge-age>{{ g.age }}</span>
        }
      </ng-template>
    }
  `,
  styles: [
    GAUGE_LEVEL_CSS,
    `
      :host {
        display: flex;
        min-width: 0;
        align-items: center;
        justify-content: flex-end;
        gap: var(--mf-s4);
      }
      .cb,
      .cg {
        display: flex;
        flex: none;
        align-items: center;
        gap: var(--mf-s2);
        min-width: 0;
        white-space: nowrap;
      }
      /* The battery: the shell is the same drawing as the full one, 112 x 36 px. */
      .bat {
        display: flex;
        flex: none;
        align-items: stretch;
        width: 112px;
        height: var(--mf-ctl-h);
      }
      .shell {
        position: relative;
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        padding: 2px;
        background: var(--mf-surface);
        border: 2px solid var(--mf-border-strong);
        border-radius: var(--mf-radius);
      }
      .shell--neutral {
        background: repeating-linear-gradient(
          45deg,
          var(--mf-p-slate-bg) 0 4px,
          var(--mf-p-slate-line) 4px 7px
        );
      }
      .fill {
        height: 100%;
        border-radius: var(--mf-radius);
        background: var(--mf-rem, transparent);
      }
      .val {
        position: absolute;
        top: 50%;
        left: var(--mf-s2);
        z-index: 1;
        display: inline-flex;
        align-items: center;
        gap: var(--mf-s1);
        transform: translateY(-50%);
        color: var(--mf-rem-fg, var(--mf-text));
        font-size: var(--mf-fs-md);
        font-weight: var(--mf-fw-bold);
        line-height: 1;
        white-space: nowrap;
      }
      .shell--neutral .val {
        right: var(--mf-s1);
        left: var(--mf-s1);
        justify-content: center;
        padding: 1px var(--mf-s1);
        color: var(--mf-text);
        background: var(--mf-surface);
        border-radius: var(--mf-radius);
        font-size: var(--mf-fs-xs);
      }
      .val--empty {
        color: var(--mf-text);
      }
      .cap {
        flex: none;
        width: 4px;
        margin: 10px 0;
        border-radius: 0 var(--mf-radius) var(--mf-radius) 0;
        background: var(--mf-border-strong);
      }
      .free {
        font-size: var(--mf-fs-md);
        font-weight: var(--mf-fw-semibold);
      }
      .over {
        display: inline-flex;
        align-items: center;
        gap: var(--mf-s1);
        color: var(--mf-danger);
        font-size: var(--mf-fs-sm);
        font-weight: var(--mf-fw-semibold);
      }
      /* The gauge: a small half circle with the level number in it, then the level chip and the oldest wait. */
      .cg {
        padding: 0;
        color: var(--mf-text);
        background: none;
        border: 0;
        font: inherit;
      }
      .cg--btn {
        cursor: pointer;
        border-radius: var(--mf-radius-lg);
      }
      .cg--btn:focus-visible {
        outline: var(--mf-focus-width) solid var(--mf-focus);
        outline-offset: var(--mf-focus-offset);
      }
      .dial {
        position: relative;
        display: block;
        flex: none;
        width: 64px;
        height: 40px;
      }
      .dial svg {
        display: block;
        width: 100%;
        height: 100%;
      }
      .seg {
        fill: none;
        stroke-width: 20;
      }
      .lv {
        position: absolute;
        right: 0;
        bottom: 0;
        left: 0;
        font-size: var(--mf-fs-lg);
        font-variant-numeric: tabular-nums;
        font-weight: var(--mf-fw-bold);
        line-height: 1;
        text-align: center;
      }
      .lvl {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: var(--mf-s1);
        padding: 3px 10px;
        border: 1px solid var(--lbd);
        border-radius: var(--mf-radius-pill);
        color: var(--lfg);
        background: var(--lbg);
        font-size: var(--mf-fs-sm);
        font-weight: var(--mf-fw-bold);
      }
      .age {
        font-size: var(--mf-fs-md);
        font-variant-numeric: tabular-nums;
        font-weight: var(--mf-fw-semibold);
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      /* A narrower cards row: the gauge drops its chip text first (the number in the dial and the age stay), then the battery its text (the red over count stays). */
      @container top (max-width: 1260px) {
        .lvl__t {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
        }
        .lvl {
          padding: 3px;
        }
      }
      @container top (max-width: 1060px) {
        .free {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
        }
      }
    `,
  ],
})
export class DashCompact {
  /** The last good capacity read of the page's battery (Dashboard.ViewUsers); null: no battery shows. */
  readonly capacity = input<DashboardCapacity | null>(null);
  /** The summary's gauge block (Dashboard.ViewSummary); null: no gauge shows. */
  readonly gauge = input<DashboardUnassignedGauge | null>(null);
  /** The gauge was pressed: select the Unassigned card, longest waiting first. */
  readonly show = output<void>();

  protected readonly segments = SEGMENTS;
  protected readonly bv = computed<BatteryView | null>(() => {
    const c = this.capacity();
    return c ? batteryView(c) : null;
  });
  protected readonly gv = computed<GaugeView | null>(() => {
    const g = this.gauge();
    return g ? gaugeView(g) : null;
  });
  /** The polite message: set only when the level changes, never on a refresh that keeps it. */
  protected readonly announcement = signal('');
  private previous: number | null = null;

  constructor() {
    effect(() => {
      const g = this.gauge();
      if (!g) return;
      untracked(() => {
        const change = levelChange(this.previous, g);
        this.previous = change.key;
        if (change.message !== null) this.announcement.set(change.message);
      });
    });
  }

  protected seg(i: number): string {
    return arcPath(180 + i * 30 + 1.5, 180 + (i + 1) * 30 - 1.5);
  }

  protected segOpacity(g: GaugeView, i: number): number {
    return g.clear ? 0.35 : i <= g.level ? 1 : 0.28;
  }

  /** The tooltip of the battery: the whole Team Capacity summary (the same facts as the full card). */
  protected batteryTip(v: BatteryView): string {
    const states = v.legend.map((l) => `${l.label} ${l.count}`).join(', ');
    return [
      `Team Capacity: ${v.tooltip}`,
      v.summaryLine,
      v.overText,
      `People: ${states}`,
      v.rateHint,
      v.formula,
    ]
      .filter((line): line is string => !!line)
      .join('\n');
  }

  protected batteryLabel(v: BatteryView): string {
    return `Team Capacity. ${v.ariaLabel} People: ${v.legend.map((l) => `${l.label} ${l.count}`).join(', ')}.`;
  }

  protected gaugeTip(g: GaugeView): string {
    return `Unassigned Wait: ${g.badge}\n${g.ariaLabel}\n${g.doLine}`;
  }
}
