import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DashboardUnassignedGauge } from '../../../api/generated/api-client';
import { GaugeView, gaugeView, levelChange } from './gauge-model';
import { IntPipe } from '../../../shared/ui/number-format';
import { GAUGE_LEVEL_CSS } from './gauge-level-css';

const SEGMENTS = [0, 1, 2, 3, 4, 5] as const;
const CX = 130;
const CY = 122;
const R = 96;

/** The path of one segment of the half circle (angles in degrees, 180 is the left end, 360 the right end). */
export function arcPath(a0: number, a1: number): string {
  const at = (a: number): string => {
    const rad = (a * Math.PI) / 180;
    return `${(CX + R * Math.cos(rad)).toFixed(1)} ${(CY + R * Math.sin(rad)).toFixed(1)}`;
  };
  return `M${at(a0)} A${R} ${R} 0 0 1 ${at(a1)}`;
}

/**
 * The unassigned-wait gauge, design A of the approved mockup (epic #1063, DB-06): a half circle with a needle on a 0 to 5 scale, fed by the `unassignedGauge` block of the summary.
 * Under it: the count, the age of the oldest unassigned task, the level word and one "what to do" line. The level is the server's; this only draws it. Colour is never the only
 * signal: each segment has its number, the badge says the level in words, and the segments up to the current level are solid tints with the number inside. A level CHANGE (not a refresh that
 * keeps the level) is announced politely; the soft pulse of levels 4 and 5 and the needle's movement are off under `prefers-reduced-motion`. The visual and the button both
 * ask the page to show the unassigned tasks, longest waiting first.
 */
@Component({
  selector: 'mf-dash-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let v = view();
    <section
      class="panel"
      data-gauge
      [attr.data-level]="v.clear ? -1 : v.level"
      aria-labelledby="dg-h"
    >
      <p class="sr-only" role="status" aria-live="polite" data-gauge-live>{{ announcement() }}</p>
      <div class="ph">
        <h2 id="dg-h"><i class="pi pi-gauge" aria-hidden="true"></i>Unassigned Wait</h2>
        <span
          class="lvl"
          [class]="'lvl L' + (v.clear ? 'c' : v.level)"
          [class.pulse]="v.pulses && !reduced()"
          data-gauge-badge
        >
          <i
            class="pi"
            [class]="v.clear ? 'pi-check' : v.level >= 4 ? 'pi-exclamation-triangle' : 'pi-clock'"
            aria-hidden="true"
          ></i>
          {{ v.badge }}
        </span>
      </div>
      @if (v.clear) {
        <div class="vis" role="img" [attr.aria-label]="v.ariaLabel">
          <ng-container [ngTemplateOutlet]="dial" />
        </div>
      } @else {
        <button
          type="button"
          class="vis vis--btn"
          [attr.aria-label]="v.ariaLabel + ' Show them, longest waiting first.'"
          data-gauge-visual
          (click)="show.emit()"
        >
          <ng-container [ngTemplateOutlet]="dial" />
        </button>
      }
      <div class="stats">
        <div>
          <span class="gcount" data-gauge-count>{{ v.count | mfInt }}</span>
          <small>unassigned</small>
        </div>
        <div>
          <span class="gcount" data-gauge-age>{{ v.age }}</span>
          <small>{{ v.ageLabel }}</small>
        </div>
      </div>
      <p class="gdo" data-gauge-do>{{ v.doLine }}</p>
      @if (!v.clear) {
        <button type="button" class="mf-btn go" data-gauge-go (click)="show.emit()">
          <i class="pi pi-user-minus" aria-hidden="true"></i>Show Them, Longest Waiting First
        </button>
      }
    </section>

    <ng-template #dial>
      <svg viewBox="0 0 260 134" aria-hidden="true" focusable="false">
        @for (i of segments; track i) {
          <path
            class="seg"
            [attr.d]="seg(i)"
            [style.stroke]="reached(i) ? 'var(--mf-wait-' + i + ')' : 'var(--mf-surface-alt)'"
          />
          <text
            class="num"
            [class.num--reached]="reached(i)"
            [class.num--light]="i === 1"
            [attr.x]="numX(i)"
            [attr.y]="numY(i)"
            text-anchor="middle"
          >
            {{ i }}
          </text>
        }
        <g class="needle" [style.transform]="'rotate(' + view().needleDeg + 'deg)'">
          <line x1="130" y1="122" x2="50" y2="122" />
        </g>
        <circle cx="130" cy="122" r="7" class="hub" />
      </svg>
    </ng-template>
  `,
  imports: [IntPipe, NgTemplateOutlet],
  styles: [
    GAUGE_LEVEL_CSS,
    `
      :host {
        display: block;
        flex: none;
      }
      .panel {
        padding: var(--mf-s3) var(--mf-s4);
        background: var(--mf-surface);
        border: 1px solid var(--mf-border-soft);
        border-radius: var(--mf-radius-xl);
      }
      .ph {
        display: flex;
        align-items: center;
        gap: var(--mf-s2);
        margin-bottom: var(--mf-s2);
      }
      h2 {
        display: flex;
        align-items: center;
        gap: var(--mf-s2);
        margin: 0;
        font-size: var(--mf-fs-lg);
        font-weight: 600;
        white-space: nowrap;
      }
      .lvl {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: var(--mf-s1);
        margin-left: auto;
        padding: 3px 10px;
        border: 1px solid var(--lbd);
        border-radius: 999px;
        color: var(--lfg);
        background: var(--lbg);
        font-size: 13px;
        font-weight: 700;
        white-space: nowrap;
      }
      .lvl.pulse::after {
        position: absolute;
        inset: -3px;
        border: 2px solid var(--lbd);
        border-radius: 999px;
        opacity: 0;
        content: '';
        animation: dg-pulse 2.4s ease-out infinite;
      }
      @keyframes dg-pulse {
        0% {
          opacity: 0.7;
          transform: scale(0.96);
        }
        100% {
          opacity: 0;
          transform: scale(1.12);
        }
      }
      .vis {
        display: block;
        width: 100%;
        padding: 0;
        border: 0;
        background: none;
      }
      .vis--btn {
        cursor: pointer;
        border-radius: var(--mf-radius-lg);
      }
      .vis--btn:focus-visible {
        outline: 2px solid var(--mf-focus);
        outline-offset: 2px;
      }
      svg {
        display: block;
        width: 100%;
        max-width: 215px;
        margin: 0 auto;
      }
      .seg {
        fill: none;
        stroke-width: 20;
      }
      /* The number sits inside its segment: white on the dark solid tints, dark text on the light amber one (segment 1), muted on a segment the level has not reached. */
      .num {
        font-variant-numeric: tabular-nums;
        fill: var(--mf-text-muted);
        font-size: var(--mf-fs-xs);
        font-weight: 700;
      }
      .num--reached {
        fill: var(--mf-white);
      }
      .num--reached.num--light {
        fill: var(--mf-text);
      }
      .needle {
        transform-origin: 130px 122px;
        transition: transform 0.4s ease;
      }
      .needle line {
        stroke: var(--mf-text);
        stroke-width: 4;
        stroke-linecap: round;
      }
      .hub {
        fill: var(--mf-text);
      }
      .stats {
        display: flex;
        justify-content: center;
        gap: 28px;
        margin-top: var(--mf-s2);
        text-align: center;
      }
      .gcount {
        display: block;
        font-size: var(--mf-fs-figure);
        font-weight: 700;
        line-height: 1;
      }
      .stats small {
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-xs);
      }
      .gdo {
        margin: var(--mf-s2) 0 0;
        font-size: 13px;
        text-align: center;
      }
      .go {
        width: 100%;
        margin-top: var(--mf-s2);
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      @media (prefers-reduced-motion: reduce) {
        .lvl.pulse::after {
          animation: none;
          opacity: 0;
        }
        .needle {
          transition: none;
        }
      }
    `,
  ],
})
export class DashGauge {
  readonly gauge = input.required<DashboardUnassignedGauge>();
  /** Show the unassigned tasks, longest waiting first (the Unassigned card on, sorted by `unassignedSince`). */
  readonly show = output<void>();

  protected readonly segments = SEGMENTS;
  protected readonly view = computed<GaugeView>(() => gaugeView(this.gauge()));
  /** The polite message: set only when the level changes, never on a refresh that keeps it. */
  protected readonly announcement = signal('');
  /** `prefers-reduced-motion: reduce` (the CSS rules above say the same; this also stops the pulse class). */
  protected readonly reduced = signal(false);
  private previous: number | null = null;

  constructor() {
    if (typeof matchMedia === 'function') {
      const query = matchMedia('(prefers-reduced-motion: reduce)');
      this.reduced.set(query.matches);
      const follow = (e: MediaQueryListEvent): void => this.reduced.set(e.matches);
      query.addEventListener?.('change', follow);
      inject(DestroyRef).onDestroy(() => query.removeEventListener?.('change', follow));
    }
    effect(() => {
      const g = this.gauge();
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

  /** A segment is drawn in its solid tint up to the current level; the rest (and a clear gauge) is the neutral track. */
  protected reached(i: number): boolean {
    const v = this.view();
    return !v.clear && i <= v.level;
  }

  protected numX(i: number): string {
    return (CX + R * Math.cos(((180 + i * 30 + 15) * Math.PI) / 180)).toFixed(1);
  }

  protected numY(i: number): string {
    return (CY + 4 + R * Math.sin(((180 + i * 30 + 15) * Math.PI) / 180)).toFixed(1);
  }
}
