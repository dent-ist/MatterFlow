import { contrastRatio } from '../../../shared/ui/color-contrast';
import {
  ALL_STYLE,
  LineStyle,
  MEASURE_STYLES,
  MEASURES,
  TYPE_STYLES,
  isHollow,
  markerPath,
} from './trend-model';

/**
 * The colours, dash patterns and markers of the Trends lines. Graphics need 3:1 against what they sit on (WCAG 1.4.11): the white card and
 * the weekend shade. Colour is never the only cue: every line that can share the chart has its own dash pattern and marker shape, and the
 * colours differ clearly from each other (checked in CIE Lab, and under simulated protanopia and deuteranopia as far as a colour can).
 */
const CARD = '#FFFFFF';
// --mf-surface-alt (#EEF0F4) at 70 % opacity over the card.
const WEEKEND = '#F2F3F6';

function lin(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function lab(hex: string): number[] {
  const [r, g, b] = rgb(hex).map(lin);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const distance = (a: string, b: string) => {
  const [x, y] = [lab(a), lab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

/** Machado et al. (2009) matrices, severity 1.0, applied in linear RGB. */
const PROTAN = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998],
];
const DEUTAN = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
];
function simulate(hex: string, m: number[][]): string {
  const c = rgb(hex).map(lin);
  const enc = (v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    return Math.round(
      255 * (clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055),
    );
  };
  return (
    '#' +
    m
      .map((row) =>
        enc(row[0] * c[0] + row[1] * c[1] + row[2] * c[2])
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

const key = (s: LineStyle) => `${s.dash}|${s.marker}`;

describe('trend line palette', () => {
  const typeStyles = [...TYPE_STYLES];
  const everyStyle = [ALL_STYLE, ...typeStyles, ...MEASURES.map((m) => MEASURE_STYLES[m])];

  it('has a slot for each of the eight task types the chart can show', () => {
    expect(TYPE_STYLES.length).toBe(8);
  });

  it('every line colour reaches 3:1 on the card and on the weekend shade', () => {
    for (const s of everyStyle) {
      expect(contrastRatio(s.color, CARD), s.color).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(s.color, WEEKEND), s.color).toBeGreaterThanOrEqual(3);
    }
  });

  it('lines that can share a chart differ in dash pattern and marker shape, not only in colour', () => {
    const compare = [ALL_STYLE, ...typeStyles];
    expect(new Set(compare.map((s) => s.dash)).size).toBe(compare.length);
    expect(new Set(compare.map((s) => s.marker)).size).toBe(compare.length);
    // The default chart: Created, Completed and the three Due dates lines.
    const measures = MEASURES.map((m) => MEASURE_STYLES[m]);
    expect(new Set(measures.map((s) => s.dash)).size).toBe(measures.length);
    expect(new Set(measures.map((s) => s.marker)).size).toBe(measures.length);
    // Each chart (the compared lines, the default measures) has no two lines alike in dash and marker together.
    for (const set of [compare, measures]) expect(new Set(set.map(key)).size).toBe(set.length);
  });

  it('colours within a chart are clearly different (Lab distance), and stay apart under colour blindness where the dash and marker do not decide', () => {
    for (const set of [[ALL_STYLE, ...typeStyles], MEASURES.map((m) => MEASURE_STYLES[m])]) {
      for (let i = 0; i < set.length; i++) {
        for (let j = i + 1; j < set.length; j++) {
          expect(
            distance(set[i].color, set[j].color),
            `${set[i].color} / ${set[j].color}`,
          ).toBeGreaterThanOrEqual(15);
          for (const m of [PROTAN, DEUTAN]) {
            const d = distance(simulate(set[i].color, m), simulate(set[j].color, m));
            // Pairs that collapse under a colour-vision deficiency are still told apart by their dash and marker (asserted above).
            expect(d, `${set[i].color} / ${set[j].color} (simulated)`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });

  it('the measure colours are the dashboard tokens', () => {
    expect(MEASURE_STYLES.created.color).toBe('#1F4E9C'); // --mf-primary
    expect(MEASURE_STYLES.completed.color).toBe('#0B5E55'); // --mf-st-progress-fg
    expect(MEASURE_STYLES.overdue.color).toBe('#B42318'); // --mf-danger
    expect(MEASURE_STYLES.onTime.color).toBe('#146C2E'); // --mf-success
    expect(MEASURE_STYLES.late.color).toBe('#8A4B00'); // --mf-warning
  });

  it('draws every marker shape as a path of its own', () => {
    // A filled and an outlined marker of the same outline (circle / ring, square / outlined square) differ in fill, the rest in their path.
    const shapes = new Set(everyStyle.map((s) => s.marker));
    const looks = new Set([...shapes].map((s) => markerPath(s, 10, 10, 3) + isHollow(s)));
    expect(looks.size).toBe(shapes.size);
    expect(isHollow('ring')).toBe(true);
    expect(isHollow('circle')).toBe(false);
  });
});
