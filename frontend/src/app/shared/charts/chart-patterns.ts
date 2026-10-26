/**
 * Fill patterns of the charts: colour is never the only cue, so every slot of the palette also has its own hatch (slot 0 is solid). The SVG patterns
 * are drawn over a slice in the card colour at partial opacity; the same hatches exist as CSS gradients for bars and legend swatches.
 */

export interface HatchDef {
  n: number;
  w: number;
  h: number;
  rotate: number | null;
  rects: { x: number; y: number; w: number; h: number }[];
  circles: { cx: number; cy: number; r: number }[];
}

export const PATTERN_COUNT = 8;

/** The pattern slot of the i-th series (0 = solid). */
export const patternSlot = (index: number): number =>
  ((index % PATTERN_COUNT) + PATTERN_COUNT) % PATTERN_COUNT;

/** Hatches 1 to 7 as SVG pattern definitions (user space units). */
export const HATCHES: readonly HatchDef[] = [
  { n: 1, w: 6, h: 6, rotate: 45, rects: [{ x: 0, y: 0, w: 6, h: 2 }], circles: [] },
  { n: 2, w: 6, h: 6, rotate: -45, rects: [{ x: 0, y: 0, w: 6, h: 2 }], circles: [] },
  { n: 3, w: 6, h: 6, rotate: null, rects: [{ x: 0, y: 0, w: 6, h: 2 }], circles: [] },
  { n: 4, w: 6, h: 6, rotate: null, rects: [{ x: 0, y: 0, w: 2, h: 6 }], circles: [] },
  { n: 5, w: 6, h: 6, rotate: null, rects: [], circles: [{ cx: 3, cy: 3, r: 1.4 }] },
  {
    n: 6,
    w: 6,
    h: 6,
    rotate: null,
    rects: [
      { x: 0, y: 0, w: 6, h: 1.5 },
      { x: 0, y: 0, w: 1.5, h: 6 },
    ],
    circles: [],
  },
  { n: 7, w: 12, h: 12, rotate: 45, rects: [{ x: 0, y: 0, w: 12, h: 5 }], circles: [] },
];

const WHITE = 'rgba(255, 255, 255, 0.6)';

/** The same hatches as CSS backgrounds: add the class `pat-<slot>` to a box that has the series colour as its background colour. */
export const PATTERN_CSS = `
  .pat-1 { background-image: repeating-linear-gradient(45deg, ${WHITE} 0 2px, transparent 2px 6px); }
  .pat-2 { background-image: repeating-linear-gradient(-45deg, ${WHITE} 0 2px, transparent 2px 6px); }
  .pat-3 { background-image: repeating-linear-gradient(0deg, ${WHITE} 0 2px, transparent 2px 6px); }
  .pat-4 { background-image: repeating-linear-gradient(90deg, ${WHITE} 0 2px, transparent 2px 6px); }
  .pat-5 { background-image: radial-gradient(${WHITE} 1.4px, transparent 1.6px); background-size: 6px 6px; }
  .pat-6 { background-image: repeating-linear-gradient(0deg, ${WHITE} 0 1.5px, transparent 1.5px 6px), repeating-linear-gradient(90deg, ${WHITE} 0 1.5px, transparent 1.5px 6px); }
  .pat-7 { background-image: repeating-linear-gradient(45deg, ${WHITE} 0 5px, transparent 5px 12px); }
`;
