import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LookupStore } from '../../core/lookups/lookup-store';

interface StatusStyle {
  tone: string;
  icon: string;
}

/** Fixed per-code look (UX 4.4); only the label text is configurable. */
const STATUS_STYLES: Readonly<Record<string, StatusStyle>> = {
  NEW: { tone: 'new', icon: 'pi-circle-fill' },
  IN_PROGRESS: { tone: 'progress', icon: 'pi-play-circle' },
  ON_HOLD: { tone: 'hold', icon: 'pi-pause-circle' },
  COMPLETED: { tone: 'done', icon: 'pi-check-circle' },
  CANCELLED: { tone: 'cancel', icon: 'pi-times-circle' },
};

/**
 * Lifecycle status badge (UX 4.4, `mf-status-badge`): the configurable label plus an icon, with the internal code kept in
 * `data-status`. The label follows the shared lookups; `label` overrides it for previews.
 */
@Component({
  selector: 'mf-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (text(); as t) {
      <span
        class="badge"
        [style.background]="'var(--mf-st-' + style().tone + '-bg)'"
        [style.color]="'var(--mf-st-' + style().tone + '-fg)'"
        [attr.data-status]="code()"
      >
        <i class="pi" [class]="style().icon" aria-hidden="true"></i>
        {{ t }}
      </span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .badge {
      display: inline-flex;
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
    .pi {
      font-size: var(--mf-fs-xs);
    }
    .pi-circle-fill {
      font-size: 0.5rem;
    }
  `,
})
export class StatusBadge {
  private readonly store = inject(LookupStore);

  /** Internal status code: NEW, IN_PROGRESS, ON_HOLD, COMPLETED or CANCELLED. */
  readonly code = input.required<string>();
  /** Overrides the looked-up label (previews). */
  readonly label = input<string | null | undefined>(null);

  constructor() {
    void this.store.ensureLoaded();
  }

  protected readonly text = computed(() => this.label() ?? this.store.statusLabel(this.code()));
  protected readonly style = computed<StatusStyle>(
    () => STATUS_STYLES[this.code()] ?? STATUS_STYLES['CANCELLED'],
  );
}
