import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LookupStore } from '../../core/lookups/lookup-store';
import { StatusChip } from './status-chip';

/**
 * Lifecycle status badge (`mf-status-badge`): the configurable label plus an icon, with the internal code kept in `data-status`. It is the shared
 * status chip (`mf-status-chip`, theme rollout TH-02) behind the selector and inputs every page already uses, so all pages show one look from the
 * `--mf-status-*` tokens. The label follows the shared lookups; `label` overrides it for previews. For a task with a workflow step or a hover text
 * use `mf-status-chip` itself.
 */
@Component({
  selector: 'mf-status-badge',
  imports: [StatusChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (text(); as t) {
      <mf-status-chip [code]="code()" [label]="t" />
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      max-width: 100%;
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
}
