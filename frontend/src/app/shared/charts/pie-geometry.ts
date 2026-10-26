/**
 * Geometry and grouping of the hand-built SVG pie (no chart library). Lifted out of the Dashboard Breakdowns (epic #851, issue #874) so the report
 * charts and the Dashboard draw the same donut.
 */

/** "42%", or "<1%" for a small non-zero share; no decimals, so a list can add up to 99 or 101. */
export function sharePercent(count: number, total: number): string {
  if (total <= 0 || count <= 0) return '0%';
  const value = (count / total) * 100;
  return value < 1 ? '<1%' : `${Math.round(value)}%`;
}

/** What the geometry needs of a slice: its size and, optionally, the part of it drawn as a hatched outer ring segment (for example "overdue"). */
export interface SizedSlice {
  count: number;
  overdue?: number;
}

/** At most this many slices; the rest of a long list is grouped as "Other". */
export const MAX_SLICES = 8;

/**
 * Keeps the list to `max` slices: the largest `max - 1` stay in their order and the rest are added up as one "Other" slice made by `other`
 * (not linkable, grey). A list whose left-over part is a single row keeps that row as it is.
 */
export function groupSlices<T extends SizedSlice>(
  slices: readonly T[],
  other: (total: { count: number; overdue: number | undefined }) => T,
  max = MAX_SLICES,
): T[] {
  if (slices.length <= max) return [...slices];
  const keep = new Set(
    slices
      .map((s, i) => ({ i, c: s.count }))
      .sort((a, b) => b.c - a.c || a.i - b.i)
      .slice(0, max - 1)
      .map((x) => x.i),
  );
  const rest = slices.filter((_, i) => !keep.has(i));
  const kept = slices.filter((_, i) => keep.has(i));
  if (rest.length === 1) return [...kept, rest[0]];
  const hasOverdue = rest.some((s) => s.overdue !== undefined);
  return [
    ...kept,
    other({
      count: rest.reduce((n, s) => n + s.count, 0),
      overdue: hasOverdue ? rest.reduce((n, s) => n + (s.overdue ?? 0), 0) : undefined,
    }),
  ];
}

const TAU = Math.PI * 2;

/** Point on a circle; angle 0 is 12 o'clock and grows clockwise. */
export function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** SVG path of a ring sector between radii `r0` < `r1` from angle `a0` to `a1` (radians). A full turn is drawn as two halves. */
export function sectorPath(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
): string {
  const sweep = Math.min(a1 - a0, TAU);
  if (sweep <= 0) return '';
  if (sweep >= TAU - 1e-6) {
    const [ox, oy] = polar(cx, cy, r1, a0);
    const [ox2, oy2] = polar(cx, cy, r1, a0 + Math.PI);
    const [ix, iy] = polar(cx, cy, r0, a0);
    const [ix2, iy2] = polar(cx, cy, r0, a0 + Math.PI);
    return (
      `M${fmt(ox)} ${fmt(oy)}A${r1} ${r1} 0 1 1 ${fmt(ox2)} ${fmt(oy2)}A${r1} ${r1} 0 1 1 ${fmt(ox)} ${fmt(oy)}Z` +
      `M${fmt(ix)} ${fmt(iy)}A${r0} ${r0} 0 1 0 ${fmt(ix2)} ${fmt(iy2)}A${r0} ${r0} 0 1 0 ${fmt(ix)} ${fmt(iy)}Z`
    );
  }
  const large = sweep > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a0 + sweep);
  const [x2, y2] = polar(cx, cy, r0, a0 + sweep);
  const [x3, y3] = polar(cx, cy, r0, a0);
  return (
    `M${fmt(x0)} ${fmt(y0)}A${r1} ${r1} 0 ${large} 1 ${fmt(x1)} ${fmt(y1)}` +
    `L${fmt(x2)} ${fmt(y2)}A${r0} ${r0} 0 ${large} 0 ${fmt(x3)} ${fmt(y3)}Z`
  );
}

/** A slice with its angles and paths. */
export interface PieArc<T extends SizedSlice = SizedSlice> {
  index: number;
  slice: T;
  start: number;
  end: number;
  path: string;
  /** The overdue part: a thin outer ring segment ending where the slice ends (null: nothing overdue). */
  overduePath: string | null;
  /** Where the slice number is drawn, and whether the slice is big enough to carry it. */
  label: { x: number; y: number; show: boolean };
}

export const PIE = {
  size: 200,
  cx: 100,
  cy: 100,
  inner: 50,
  outer: 80,
  ringInner: 84,
  ringOuter: 93,
} as const;

/** Lays the slices out clockwise from 12 o'clock; zero-count slices get no arc. */
export function layoutPie<T extends SizedSlice>(slices: readonly T[]): PieArc<T>[] {
  const total = slices.reduce((n, s) => n + s.count, 0);
  let angle = 0;
  return slices.map((slice, index) => {
    const span = total > 0 ? (slice.count / total) * TAU : 0;
    const start = angle;
    const end = angle + span;
    angle = end;
    if (span <= 0) {
      return {
        index,
        slice,
        start,
        end,
        path: '',
        overduePath: null,
        label: { x: 0, y: 0, show: false },
      };
    }
    const od = slice.overdue ?? 0;
    const odSpan = slice.count > 0 && od > 0 ? Math.min(span, (od / slice.count) * span) : 0;
    const mid = (start + end) / 2;
    const [lx, ly] = polar(PIE.cx, PIE.cy, (PIE.inner + PIE.outer) / 2, mid);
    return {
      index,
      slice,
      start,
      end,
      path: sectorPath(PIE.cx, PIE.cy, PIE.inner, PIE.outer, start, end),
      overduePath:
        odSpan > 0
          ? sectorPath(PIE.cx, PIE.cy, PIE.ringInner, PIE.ringOuter, end - odSpan, end)
          : null,
      label: { x: lx, y: ly + 4, show: span >= 0.22 },
    };
  });
}
