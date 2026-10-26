import { MAX_SLICES, PIE, groupSlices, layoutPie, sectorPath, sharePercent } from './pie-geometry';

interface Slice {
  label: string;
  count: number;
  overdue?: number;
}

const slice = (label: string, count: number, overdue?: number): Slice => ({
  label,
  count,
  overdue,
});

describe('sharePercent', () => {
  it('rounds to whole percents and says <1% for a small share', () => {
    expect(sharePercent(1, 3)).toBe('33%');
    expect(sharePercent(1, 1000)).toBe('<1%');
    expect(sharePercent(0, 10)).toBe('0%');
    expect(sharePercent(5, 0)).toBe('0%');
  });
});

describe('groupSlices (shared)', () => {
  const other = (t: { count: number; overdue: number | undefined }): Slice => ({
    label: 'Other',
    ...t,
  });

  it('keeps eight or fewer slices as they are', () => {
    const list = Array.from({ length: MAX_SLICES }, (_, i) => slice(`T${i}`, i + 1));
    expect(groupSlices(list, other)).toEqual(list);
  });

  it('keeps the largest seven in their order and adds the rest up as one Other', () => {
    const list = Array.from({ length: 11 }, (_, i) => slice(`T${i}`, 20 - i));
    const out = groupSlices(list, other);
    expect(out).toHaveLength(MAX_SLICES);
    expect(out[7]).toEqual({
      label: 'Other',
      count: list.slice(7).reduce((n, s) => n + s.count, 0),
      overdue: undefined,
    });
  });
});

describe('layoutPie', () => {
  it("lays slices out clockwise from 12 o'clock in proportion to their counts and skips empty ones", () => {
    const arcs = layoutPie([slice('a', 1), slice('b', 0), slice('c', 3)]);
    expect(arcs[0].start).toBe(0);
    expect(arcs[0].end).toBeCloseTo(Math.PI / 2, 6);
    expect(arcs[1].path).toBe('');
    expect(arcs[2].end).toBeCloseTo(Math.PI * 2, 6);
  });

  it('draws the overdue part as an outer ring segment that ends where the slice ends', () => {
    const arcs = layoutPie([slice('a', 2, 1), slice('b', 2, 0)]);
    expect(arcs[0].overduePath).toContain(`A${PIE.ringOuter} ${PIE.ringOuter}`);
    expect(arcs[1].overduePath).toBeNull();
  });

  it('draws one slice that is the whole total as a closed ring', () => {
    const path = sectorPath(PIE.cx, PIE.cy, PIE.inner, PIE.outer, 0, Math.PI * 2);
    expect(path.match(/Z/g)).toHaveLength(2);
  });
});
