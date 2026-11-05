import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** The accent of a tile (epic #893, issue #934). Red is reserved for Overdue and amber for At risk; the other hues carry no alarm meaning. */
export type TileTone = 'red' | 'amber' | 'violet' | 'slate' | 'blue' | 'teal';

/**
 * The solid icon chip of a count tile (issue #934, owner decision of 2026-10-28: a white tile, a plain thin border, the colour only in this chip): a rounded square in
 * the tile's accent with a white glyph from the icon set. It is decorative (`aria-hidden`): the number and the word beside it carry the meaning, so colour is never the
 * only signal. The fills are the `--mf-sem-*-solid` tokens; every one passes 4.5:1 against the white glyph (red 5.6, amber 5.0, violet 6.0, slate 7.6, blue 7.9, teal 5.5, checked by check-theme-contrast.mjs). A zero is muted: the chip turns into a light neutral square with a grey glyph, still readable.
 * Used by the My Matters tiles and the Data Area tiles, so both share one look.
 */
@Component({
  selector: 'mf-tile-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[attr.data-tone]': 'tone()', '[class.muted]': 'muted()' },
  styles: `
    :host {
      --chip: 24px;
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: var(--chip);
      height: var(--chip);
      border-radius: var(--mf-radius-lg);
      background: var(--tone, var(--mf-sem-neutral-solid));
      color: var(--mf-white);
    }
    :host([data-tone='red']) {
      --tone: var(--mf-sem-overdue-solid);
    }
    :host([data-tone='amber']) {
      --tone: var(--mf-sem-risk-solid);
    }
    :host([data-tone='violet']) {
      --tone: var(--mf-sem-person-solid);
    }
    :host([data-tone='slate']) {
      --tone: var(--mf-sem-neutral-solid);
    }
    :host([data-tone='blue']) {
      --tone: var(--mf-sem-info-solid);
    }
    :host([data-tone='teal']) {
      --tone: var(--mf-sem-healthy-solid);
    }
    :host(.muted) {
      background: var(--mf-surface-alt);
      color: var(--mf-text-muted);
    }
    i {
      font-size: calc(var(--chip) * 0.55);
      line-height: 1;
    }
  `,
  template: `<i class="pi" [class]="icon()" aria-hidden="true"></i>`,
})
export class TileChip {
  /** The primeicons class of the glyph, e.g. `pi-clock`. */
  readonly icon = input.required<string>();
  readonly tone = input<TileTone>('slate');
  /** The count is zero: a light neutral chip. */
  readonly muted = input(false);
}
