import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The "n / 100" counter under a limited text field (TE5, #386; the same look as the counter of `mf-title-area`). The count is always visible
 * text, never colour only; a polite status says "92 of 100 characters" from `announceFrom` (default: nine tenths of the limit) so a screen
 * reader hears the limit coming before the field silently stops. The field points at it with `aria-describedby="<id>"`.
 *
 *   <input maxlength="100" aria-describedby="tt-name-count" />  <mf-char-counter countId="tt-name-count" [value]="name" [max]="100" />
 */
@Component({
  selector: 'mf-char-counter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="cc" [id]="countId()" data-char-count>{{ value().length }} / {{ max() }}</span>
    <span class="mf-sr-only" role="status" aria-live="polite" data-char-count-live>{{
      announcement()
    }}</span>
  `,
  styles: `
    :host {
      display: flex;
      justify-content: flex-end;
    }
    .cc {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class CharCounter {
  /** The id the field's `aria-describedby` names. */
  readonly countId = input.required<string>();
  readonly value = input('');
  readonly max = input.required<number>();
  /** The length from which the count is announced; nine tenths of `max` when absent. */
  readonly announceFrom = input<number | null>(null);

  protected readonly announcement = computed(() => {
    const from = this.announceFrom() ?? Math.ceil(this.max() * 0.9);
    return this.value().length >= from ? `${this.value().length} of ${this.max()} characters` : '';
  });
}
