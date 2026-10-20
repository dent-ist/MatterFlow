import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LookupStore } from '../../core/lookups/lookup-store';
import { isHexColor, readableTextOn } from './color-contrast';

const TOKENS = new Set(['critical', 'high', 'normal', 'low']);

/** Number of level bars: 4 for the most urgent, down to 1 (UX 4.5); never a number. */
export function levelBars(rank: number | null | undefined): number {
  return rank == null ? 1 : Math.max(1, Math.min(4, 5 - rank));
}

/**
 * The badge colours of a priority tone (`critical`, `high`, `normal`, `low`, or `#RRGGBB`), as CSS values. Charts use the same pair as the
 * badge (fill and outline) so a priority looks the same everywhere.
 */
export function priorityColors(tone: string | null | undefined): { bg: string; fg: string } {
  const t = tone ?? 'neutral';
  if (TOKENS.has(t)) return { bg: `var(--mf-pr-${t}-bg)`, fg: `var(--mf-pr-${t}-fg)` };
  return isHexColor(t)
    ? { bg: t, fg: readableTextOn(t).color }
    : { bg: 'var(--mf-surface-alt)', fg: 'var(--mf-text)' };
}

/**
 * Priority badge (UX 4.5, `mf-priority-badge`): label text plus a level-bar glyph so it is not color-only. Pass `priorityId`
 * to follow the shared lookups (renames and recolors appear everywhere, deactivated priorities still display), or `label`,
 * `color` and `rank` directly for previews.
 */
@Component({
  selector: 'mf-priority-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (text(); as t) {
      <span
        class="badge"
        [style.background]="muted() ? 'transparent' : background()"
        [style.color]="muted() ? 'var(--mf-text-muted)' : foreground()"
        [class.muted]="muted()"
        [attr.data-priority]="t"
      >
        <span class="bars" aria-hidden="true">
          @for (on of bars(); track $index) {
            <span class="bar" [class.on]="on"></span>
          }
        </span>
        <span class="txt">{{ t }}</span>
      </span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      max-width: 100%;
    }
    .badge {
      display: inline-flex;
      min-width: 0;
      max-width: 100%;
      align-items: center;
      gap: var(--mf-s1);
      padding: 2px var(--mf-s2);
      border-radius: var(--mf-radius);
      border: 1px solid currentColor;
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      line-height: 1.5;
      white-space: nowrap;
    }
    /* A long label ends in an ellipsis inside a narrow cell instead of spilling out of the badge (admin lists, #605). */
    .txt {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .bars {
      display: inline-flex;
      flex: none;
      align-items: flex-end;
      gap: 1px;
      height: 10px;
    }
    .badge.muted {
      border-color: var(--mf-border);
    }
    .bar {
      width: 3px;
      border: 1px solid currentColor;
      box-sizing: border-box;
    }
    .bar:nth-child(1) {
      height: 4px;
    }
    .bar:nth-child(2) {
      height: 6px;
    }
    .bar:nth-child(3) {
      height: 8px;
    }
    .bar:nth-child(4) {
      height: 10px;
    }
    .bar.on {
      background: currentColor;
    }
  `,
})
export class PriorityBadge {
  private readonly store = inject(LookupStore);

  /** Id of a priority in the shared lookups. */
  readonly priorityId = input<number | null | undefined>(null);
  /** Overrides the looked-up label (previews). */
  readonly label = input<string | null | undefined>(null);
  /** Overrides the looked-up color: a token (critical, high, normal, low, neutral) or `#RRGGBB`. */
  readonly color = input<string | null | undefined>(null);
  /** Closed work: grey text, no fill, level glyph kept, so a closed Critical task does not draw the eye. */
  readonly muted = input(false);
  /** Overrides the looked-up 1-based rank (1 = most urgent). */
  readonly rank = input<number | null | undefined>(null);

  constructor() {
    void this.store.ensureLoaded();
  }

  private readonly found = computed(() => this.store.priority(this.priorityId()));

  protected readonly text = computed(() => this.label() ?? this.found()?.label ?? '');
  private readonly tone = computed(() => this.color() ?? this.found()?.color ?? 'neutral');
  protected readonly bars = computed(() => {
    const rank = this.rank() ?? this.store.priorityRank(this.priorityId());
    const n = levelBars(rank);
    return [0, 1, 2, 3].map((i) => i < n);
  });

  protected readonly background = computed(() => priorityColors(this.tone()).bg);
  protected readonly foreground = computed(() => priorityColors(this.tone()).fg);
}
