import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Tip } from './tip';

interface ChipStyle {
  tone: 'new' | 'progress' | 'hold' | 'done' | 'cancel';
  icon: string;
  label: string;
}

/** The five task statuses of the app with their fixed icon and tone (colour is never the only signal: every chip has an icon and the word). */
export const STATUS_CHIPS: Readonly<Record<string, ChipStyle>> = {
  NEW: { tone: 'new', icon: 'pi-circle', label: 'New' },
  IN_PROGRESS: { tone: 'progress', icon: 'pi-play-circle', label: 'In Progress' },
  ON_HOLD: { tone: 'hold', icon: 'pi-pause-circle', label: 'On Hold' },
  COMPLETED: { tone: 'done', icon: 'pi-check-circle', label: 'Completed' },
  CANCELLED: { tone: 'cancel', icon: 'pi-times-circle', label: 'Cancelled' },
};

/**
 * Task status chip (`mf-status-chip`, epic #953 UI-10): the status word with its icon, and for an In Progress task the workflow step ("step 3 of 5" as text, plus a segmented bar
 * where `showBar` is on). `detail` is the hover and focus text ("On hold for 6 days because Waiting for client data"); a chip with a detail is a tab stop so the keyboard reaches it.
 * It reads only the `--mf-st-*` tokens.
 */
@Component({
  selector: 'mf-status-chip',
  imports: [Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="wrap">
      <span
        class="chip"
        [attr.data-status]="code()"
        [attr.data-tone]="style().tone"
        [attr.tabindex]="detail() || step() ? 0 : null"
        [attr.aria-label]="name()"
        [mfTip]="tipText()"
      >
        @if (code() === 'NEW') {
          <span class="newic" aria-hidden="true"></span>
        } @else {
          <i class="pi" [class]="style().icon" aria-hidden="true"></i>
        }
        {{ style().label }}
      </span>
      @if (step(); as s) {
        @if (showBar()) {
          <span class="bar" aria-hidden="true">
            @for (on of s.cells; track $index) {
              <i [class.on]="on"></i>
            }
          </span>
        }
      }
    </span>
  `,
  styles: `
    :host {
      display: inline-block;
      min-width: 0;
    }
    .wrap {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      flex: none;
      padding: 2px var(--mf-s3) 2px var(--mf-s2);
      border-radius: 999px;
      border: 1px solid var(--st-line, transparent);
      background: var(--st-bg);
      color: var(--st-fg);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      line-height: 18px;
      white-space: nowrap;
    }
    .chip[tabindex] {
      cursor: help;
    }
    .chip .pi {
      font-size: var(--mf-fs-xs);
    }
    /* The New icon: a ring with a dot (the mockup's "not started"). */
    .newic {
      display: inline-block;
      box-sizing: border-box;
      flex: none;
      width: 12px;
      height: 12px;
      border: 1.5px solid currentColor;
      border-radius: 50%;
      background: radial-gradient(circle, currentColor 0 2px, transparent 2.5px);
    }
    .chip[data-tone='new'] {
      --st-bg: var(--mf-status-new-bg);
      --st-fg: var(--mf-status-new-fg);
      --st-line: var(--mf-status-new-line, var(--mf-border-strong));
    }
    .chip[data-tone='progress'] {
      --st-bg: var(--mf-status-progress-bg);
      --st-fg: var(--mf-status-progress-fg);
    }
    .chip[data-tone='hold'] {
      --st-bg: var(--mf-status-hold-bg);
      --st-fg: var(--mf-status-hold-fg);
    }
    .chip[data-tone='done'] {
      --st-bg: var(--mf-status-done-bg);
      --st-fg: var(--mf-status-done-fg);
    }
    .chip[data-tone='cancel'] {
      --st-bg: var(--mf-status-cancel-bg);
      --st-fg: var(--mf-status-cancel-fg);
    }
    .bar {
      display: inline-flex;
      gap: 2px;
      flex: none;
    }
    .bar i {
      display: block;
      width: 6px;
      height: 11px;
      border-radius: 2px;
      background: var(--mf-status-progress-bg);
    }
    .bar i.on {
      background: var(--mf-status-progress-fg);
    }
  `,
})
export class StatusChip {
  /** NEW, IN_PROGRESS, ON_HOLD, COMPLETED or CANCELLED (an unknown code is drawn as Cancelled's neutral look with its own text). */
  readonly code = input.required<string>();
  /** The workflow step the task is on (1-based) and the number of steps; both must be set for the "step n of m" text. Only shown while the task is In Progress. */
  readonly stepNumber = input<number | null | undefined>(null);
  readonly stepTotal = input<number | null | undefined>(null);
  /** The segmented bar next to the text (wide grids only). */
  readonly showBar = input(false);
  /** The hover and focus text: the hold reason with its age, the completion date, the cancel reason. */
  readonly detail = input<string | null | undefined>(null);

  protected readonly style = computed<ChipStyle>(
    () => STATUS_CHIPS[this.code()] ?? { ...STATUS_CHIPS['CANCELLED'], label: this.code() },
  );
  /** The hover and focus text: the detail, else "Step 4 of 5" for an In Progress task. */
  protected readonly tipText = computed(() => {
    const s = this.step();
    return this.detail() ?? (s ? `Step ${s.n} of ${s.total}` : null);
  });
  /** The accessible name keeps every word: "In Progress, step 4 of 5" (and the detail, when there is one). */
  protected readonly name = computed(() => {
    const s = this.step();
    const detail = this.detail();
    if (!s && !detail) return null;
    const base = s ? `${this.style().label}, step ${s.n} of ${s.total}` : this.style().label;
    return detail && !detail.startsWith('Step ') ? `${base}. ${detail}` : base;
  });
  protected readonly step = computed(() => {
    const n = this.stepNumber();
    const total = this.stepTotal();
    if (this.code() !== 'IN_PROGRESS' || !n || !total || total < 1) return null;
    const at = Math.min(n, total);
    return { n: at, total, cells: Array.from({ length: total }, (_, i) => i < at) };
  });
}
