import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LookupStore } from '../../core/lookups/lookup-store';
import { PriorityPill } from './priority-pill';

/**
 * The priority of a task in a list or a card (`mf-priority-flag`, theme rollout TH-01): Critical and High are the pill of `mf-priority-pill` (icon and word),
 * Normal and Low are plain 14 px text like the other cells, because only what needs the eye gets a colour (the My Matters rule). `color` is the priority's tone from the API
 * (`critical`, `high`, `normal`, `low`; an admin colour in `#RRGGBB` is not drawn, it is plain text). Closed work (`muted`) is plain muted text too, so a closed
 * Critical task does not draw the eye. The word is always there, for a screen reader as well.
 */
@Component({
  selector: 'mf-priority-flag',
  imports: [PriorityPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pill(); as p) {
      <mf-priority-pill [kind]="p" [label]="label()" [attr.data-priority]="label()" />
    } @else if (label()) {
      <span class="plain" [class.plain--closed]="muted()" [attr.data-priority]="label()">{{
        label()
      }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      max-width: 100%;
    }
    .plain {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      /* The same 14 px text as every other cell (D-45, #1168); only closed work is muted. */
      font-size: var(--mf-fs-md);
      color: inherit;
    }
    .plain--closed {
      color: var(--mf-text-muted);
    }
  `,
})
export class PriorityFlag {
  /** The priority word ("Critical", "High", "Normal"; a renamed one is shown as it is). */
  readonly label = input<string | null | undefined>(null);
  /** The tone of the priority: `critical`, `high`, `normal`, `low` (anything else is plain text). */
  readonly color = input<string | null | undefined>(null);
  /** Closed work: plain text, no pill. */
  readonly muted = input(false);

  constructor() {
    // Like the badge it replaces: a priority on screen means the shared lookups (the menus, renames and the Filter lists) are loaded.
    void inject(LookupStore).ensureLoaded();
  }

  protected readonly pill = computed<'critical' | 'high' | null>(() => {
    if (this.muted()) return null;
    const tone = this.color();
    return tone === 'critical' ? 'critical' : tone === 'high' ? 'high' : null;
  });
}
