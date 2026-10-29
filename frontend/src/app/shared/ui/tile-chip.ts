import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** The accent of a tile (epic #893, issue #934). Red is reserved for Overdue and amber for At risk; the other hues carry no alarm meaning. */
export type TileTone = 'red' | 'amber' | 'violet' | 'slate' | 'blue' | 'teal';

/**
 * The solid icon chip of a count tile (issue #934, owner decision of 2026-10-28: a white tile, a plain thin border, the colour only in this chip): a rounded square in
 * the tile's accent with a white glyph from the icon set. It is decorative (`aria-hidden`): the number and the word beside it carry the meaning, so colour is never the
 * only signal. Every fill passes 4.5:1 against the white glyph (red 6.5, amber 5.0, violet 7.1, slate 7.6, blue 7.9, teal 5.5), so it reads the same in a light or dark
 * theme (the chip does not use a theme colour). A zero is muted: the chip turns into a light neutral square with a grey glyph, still readable.
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
      border-radius: 6px;
      background: var(--tone, #475569);
      color: #fff;
    }
    :host([data-tone='red']) {
      --tone: #b42318;
    }
    :host([data-tone='amber']) {
      --tone: #b45309;
    }
    :host([data-tone='violet']) {
      --tone: #6d28d9;
    }
    :host([data-tone='slate']) {
      --tone: #475569;
    }
    :host([data-tone='blue']) {
      --tone: #1f4e9c;
    }
    :host([data-tone='teal']) {
      --tone: #0f766e;
    }
    :host(.muted) {
      background: var(--mf-surface-alt, #eef0f4);
      color: var(--mf-text-muted, #4b5563);
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
