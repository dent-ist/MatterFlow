import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Which flags the grid draws as a pill: only what needs the eye (High, Critical, On hold, At risk); Normal and Low are plain text. */
export type PillKind = 'critical' | 'high' | 'hold' | 'risk' | 'overdue';

const PILLS: Readonly<Record<PillKind, { icon: string; label: string }>> = {
  critical: { icon: 'pi-exclamation-triangle', label: 'Critical' },
  high: { icon: 'pi-arrow-up', label: 'High' },
  hold: { icon: 'pi-pause', label: 'On hold' },
  risk: { icon: 'pi-clock', label: 'At risk' },
  overdue: { icon: 'pi-exclamation-circle', label: 'Overdue' },
};

/**
 * A small flag pill (`mf-priority-pill`, epic #953 UI-10): icon plus word, never colour alone. Critical, High, At risk, Overdue and On hold share one look; the colours
 * are the `--mf-pr-*` and `--mf-due-*` tokens. `label` overrides the word (a lookup rename).
 */
@Component({
  selector: 'mf-priority-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="pill" [attr.data-kind]="kind()"
    ><i class="pi" [class]="def().icon" aria-hidden="true"></i>{{ text() }}</span
  >`,
  styles: `
    :host {
      display: inline-block;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 1px var(--mf-s2);
      border-radius: 999px;
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      line-height: 18px;
      white-space: nowrap;
      background: var(--p-bg);
      color: var(--p-fg);
    }
    .pill .pi {
      font-size: 0.7rem;
    }
    .pill[data-kind='critical'] {
      --p-bg: var(--mf-pr-critical-bg);
      --p-fg: var(--mf-pr-critical-fg);
    }
    .pill[data-kind='high'] {
      --p-bg: var(--mf-pr-high-bg);
      --p-fg: var(--mf-pr-high-fg);
    }
    .pill[data-kind='hold'] {
      --p-bg: var(--mf-status-hold-bg);
      --p-fg: var(--mf-status-hold-fg);
    }
    .pill[data-kind='risk'] {
      --p-bg: var(--mf-sem-risk-bg);
      --p-fg: var(--mf-sem-risk-fg);
    }
    .pill[data-kind='overdue'] {
      --p-bg: var(--mf-sem-overdue-bg);
      --p-fg: var(--mf-sem-overdue-fg);
    }
  `,
})
export class PriorityPill {
  readonly kind = input.required<PillKind>();
  readonly label = input<string | null | undefined>(null);
  protected readonly def = computed(() => PILLS[this.kind()]);
  protected readonly text = computed(() => this.label() ?? this.def().label);
}
