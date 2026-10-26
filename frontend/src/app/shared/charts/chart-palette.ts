/**
 * The shared palette of the hand-built SVG charts (Trends lines, pies, bars): colours that keep 3:1 against the card, plus a dash pattern and a marker
 * shape per slot so no series relies on colour alone. Lifted out of the Dashboard Trends model (epic #851, issue #874); the Trends and the report
 * charts take their slots from here.
 */

export type MarkerShape =
  | 'circle'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'triangleDown'
  | 'cross'
  | 'plus'
  | 'ring'
  | 'ringSquare';

export interface LineStyle {
  /** `#RRGGBB`, at least 3:1 against the card (trend-palette spec). */
  color: string;
  /** SVG stroke-dasharray; empty is a solid line. */
  dash: string;
  marker: MarkerShape;
}

/**
 * One slot per task type line (a type keeps its slot while it stays checked). Colours follow Okabe-Ito / Tol hues darkened to at least 3:1
 * on white and on the weekend shade; each slot also has its own dash pattern and marker shape, so no line relies on colour alone.
 */
export const TYPE_STYLES: readonly LineStyle[] = [
  { color: '#0072B2', dash: '8 4', marker: 'square' },
  { color: '#C2410C', dash: '2 3', marker: 'triangle' },
  { color: '#00795A', dash: '10 3 2 3', marker: 'diamond' },
  { color: '#B0306F', dash: '4 4', marker: 'triangleDown' },
  { color: '#8A6A00', dash: '14 5', marker: 'cross' },
  { color: '#6B3FA0', dash: '1 5', marker: 'plus' },
  { color: '#2F8FBF', dash: '9 3 2 3 2 3', marker: 'ring' },
  { color: '#6B7280', dash: '3 2 6 2', marker: 'ringSquare' },
];

/** The SVG path of a marker centred at (x, y) with half-size r. */
export function markerPath(shape: MarkerShape, x: number, y: number, r: number): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  switch (shape) {
    case 'circle':
    case 'ring':
      return `M${f(x - r)},${f(y)}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0z`;
    case 'square':
    case 'ringSquare':
      return `M${f(x - r)},${f(y - r)}h${2 * r}v${2 * r}h${-2 * r}z`;
    case 'triangle':
      return `M${f(x)},${f(y - r - 0.5)}L${f(x + r + 0.5)},${f(y + r)}L${f(x - r - 0.5)},${f(y + r)}z`;
    case 'triangleDown':
      return `M${f(x)},${f(y + r + 0.5)}L${f(x + r + 0.5)},${f(y - r)}L${f(x - r - 0.5)},${f(y - r)}z`;
    case 'diamond':
      return `M${f(x)},${f(y - r - 1)}L${f(x + r + 1)},${f(y)}L${f(x)},${f(y + r + 1)}L${f(x - r - 1)},${f(y)}z`;
    case 'cross':
      return `M${f(x - r)},${f(y - r)}L${f(x + r)},${f(y + r)}M${f(x + r)},${f(y - r)}L${f(x - r)},${f(y + r)}`;
    case 'plus':
      return `M${f(x - r - 0.5)},${f(y)}h${2 * r + 1}M${f(x)},${f(y - r - 0.5)}v${2 * r + 1}`;
  }
}

/** True for markers drawn as an outline or strokes only (filled with the card colour, or no fill). */
export function isHollow(shape: MarkerShape): boolean {
  return shape === 'ring' || shape === 'ringSquare' || shape === 'cross' || shape === 'plus';
}
