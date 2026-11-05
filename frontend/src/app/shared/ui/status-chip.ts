import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Tip } from './tip';

export type StatusChipKind = 'task' | 'disposition';

interface ChipStyle {
  tone:
    | 'new'
    | 'progress'
    | 'hold'
    | 'done'
    | 'cancel'
    | 'disp-active'
    | 'disp-inactive'
    | 'disp-pending'
    | 'disp-disposed';
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
 * The four dispositions of an asset (kind `disposition`, TH-06 #988): the retention state of a record. Active is healthy teal with a check, Inactive neutral slate with a minus,
 * Pending disposition amber with a clock, Disposed red with a trash can. The same chip draws the Active / Inactive state of a client, matter or project (Active and Inactive
 * only; `label` changes the word, for example "Archived"). Colour is never the only signal: every chip has an icon and the word. Tokens: `--mf-sem-*` (healthy, neutral, risk,
 * overdue), whose text-on-tint contrast is checked by `check-theme-contrast.mjs`.
 */
export const DISPOSITION_CHIPS: Readonly<Record<string, ChipStyle>> = {
  ACTIVE: { tone: 'disp-active', icon: 'pi-check-circle', label: 'Active' },
  INACTIVE: { tone: 'disp-inactive', icon: 'pi-minus-circle', label: 'Inactive' },
  PENDING_DISPOSITION: { tone: 'disp-pending', icon: 'pi-clock', label: 'Pending Disposition' },
  DISPOSED: { tone: 'disp-disposed', icon: 'pi-trash', label: 'Disposed' },
};

/**
 * Task status chip (`mf-status-chip`, epic #953 UI-10): the status word with its icon, and for an In Progress task the workflow step ("step 3 of 5" as text, plus a segmented bar
 * where `showBar` is on). `detail` is the hover and focus text ("On hold for 6 days because Waiting for client data"); a chip with a detail is a tab stop so the keyboard reaches it.
 * `kind="disposition"` draws an asset disposition (or a record's Active / Inactive) in the same pill. It reads only the `--mf-status-*` and `--mf-sem-*` tokens.
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
        @if (kind() === 'task' && code() === 'NEW') {
          <span class="newic" aria-hidden="true"></span>
        } @else {
          <i class="pi" [class]="style().icon" aria-hidden="true"></i>
        }
        {{ text() }}
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
    /* Chip kind 1 (D-12, #1129): 26 px high, 0 8 padding, pill, 12 / 600, a 16 px icon and the word, tint -bg / -fg / -line. Never wraps. */
    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      flex: none;
      box-sizing: border-box;
      height: var(--mf-chip-h);
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      border: 1px solid var(--st-line, transparent);
      background: var(--st-bg);
      color: var(--st-fg);
      font-size: var(--mf-fs-chip);
      font-weight: var(--mf-fw-semibold);
      line-height: 1;
      white-space: nowrap;
    }
    .chip[tabindex] {
      cursor: help;
    }
    .chip .pi {
      font-size: var(--mf-icon-sm);
    }
    /* The New icon: a ring with a dot (the mockup's "not started"). */
    .newic {
      display: inline-block;
      box-sizing: border-box;
      flex: none;
      width: var(--mf-icon-sm);
      height: var(--mf-icon-sm);
      border: 1.5px solid currentColor;
      border-radius: 50%;
      background: radial-gradient(circle, currentColor 0 3px, transparent 3.5px);
    }
    .chip[data-tone='new'] {
      --st-bg: var(--mf-status-new-bg);
      --st-fg: var(--mf-status-new-fg);
      --st-line: var(--mf-status-new-line, var(--mf-border-strong));
    }
    .chip[data-tone='progress'] {
      --st-bg: var(--mf-status-progress-bg);
      --st-fg: var(--mf-status-progress-fg);
      --st-line: var(--mf-status-progress-line);
    }
    .chip[data-tone='hold'] {
      --st-bg: var(--mf-status-hold-bg);
      --st-fg: var(--mf-status-hold-fg);
      --st-line: var(--mf-status-hold-line);
    }
    .chip[data-tone='done'] {
      --st-bg: var(--mf-status-done-bg);
      --st-fg: var(--mf-status-done-fg);
      --st-line: var(--mf-status-done-line);
    }
    .chip[data-tone='cancel'] {
      --st-bg: var(--mf-status-cancel-bg);
      --st-fg: var(--mf-status-cancel-fg);
      --st-line: var(--mf-status-cancel-line);
    }
    .chip[data-tone='disp-active'] {
      --st-bg: var(--mf-sem-healthy-bg);
      --st-fg: var(--mf-sem-healthy-fg);
      --st-line: var(--mf-sem-healthy-line);
    }
    .chip[data-tone='disp-inactive'] {
      --st-bg: var(--mf-sem-neutral-bg);
      --st-fg: var(--mf-sem-neutral-fg);
      --st-line: var(--mf-sem-neutral-line);
    }
    .chip[data-tone='disp-pending'] {
      --st-bg: var(--mf-sem-risk-bg);
      --st-fg: var(--mf-sem-risk-fg);
      --st-line: var(--mf-sem-risk-line);
    }
    .chip[data-tone='disp-disposed'] {
      --st-bg: var(--mf-sem-overdue-bg);
      --st-fg: var(--mf-sem-overdue-fg);
      --st-line: var(--mf-sem-overdue-line);
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
      border-radius: var(--mf-radius);
      background: var(--mf-status-progress-bg);
    }
    .bar i.on {
      background: var(--mf-status-progress-fg);
    }
  `,
})
export class StatusChip {
  /** `task` (default): NEW, IN_PROGRESS, ON_HOLD, COMPLETED or CANCELLED. `disposition`: ACTIVE, INACTIVE, PENDING_DISPOSITION or DISPOSED. */
  readonly kind = input<StatusChipKind>('task');
  /** The status code of the kind (an unknown code is drawn in a neutral look with its own text). */
  readonly code = input.required<string>();
  /** Replaces the words of the chip ("Archived" for an inactive project); the accessible name follows. */
  readonly label = input<string | null | undefined>(null);
  /** The workflow step the task is on (1-based) and the number of steps; both must be set for the "step n of m" text. Only shown while the task is In Progress. */
  readonly stepNumber = input<number | null | undefined>(null);
  readonly stepTotal = input<number | null | undefined>(null);
  /** The segmented bar next to the text (wide grids only). */
  readonly showBar = input(false);
  /** The hover and focus text: the hold reason with its age, the completion date, the cancel reason. */
  readonly detail = input<string | null | undefined>(null);

  protected readonly style = computed<ChipStyle>(() => {
    const table = this.kind() === 'disposition' ? DISPOSITION_CHIPS : STATUS_CHIPS;
    const fallback = this.kind() === 'disposition' ? 'INACTIVE' : 'CANCELLED';
    return table[this.code()] ?? { ...table[fallback], label: this.code() };
  });
  /** The words on the chip: the page's own label, else the status word. */
  protected readonly text = computed(() => this.label() || this.style().label);
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
    const base = s ? `${this.text()}, step ${s.n} of ${s.total}` : this.text();
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
