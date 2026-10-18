import { WORK_COLUMNS } from './column-prefs';
import { columnWidthRem, pxToRem, remToPx, tableMinRem, widthVars } from './column-widths';

const def = (key: string) => WORK_COLUMNS.find((c) => c.key === key)!;

describe('column widths (#200)', () => {
  it('every column declares a coherent width model', () => {
    for (const c of WORK_COLUMNS) {
      expect(c.minWidth).toBeLessThanOrEqual(c.width);
      expect(c.width).toBeLessThanOrEqual(c.maxWidth);
    }
    expect(WORK_COLUMNS.filter((c) => c.fill).map((c) => c.key)).toEqual(['title']);
  });

  it('uses the defaults of the issue in rem', () => {
    expect(columnWidthRem(def('due'))).toBe(136 / 14);
    expect(columnWidthRem(def('ref'))).toBe(112 / 14);
    expect(columnWidthRem(def('matter'))).toBe(160 / 14);
    expect(def('due').minWidth).toBe(120);
  });

  it('clamps a stored width to the column limits and ignores the Title', () => {
    expect(columnWidthRem(def('due'), { due: 2 })).toBe(pxToRem(120));
    expect(columnWidthRem(def('due'), { due: 99 })).toBe(pxToRem(200));
    expect(columnWidthRem(def('due'), { due: 9 })).toBe(9);
    expect(Math.round(remToPx(columnWidthRem(def('due'))))).toBe(136);
    expect(columnWidthRem(def('title'), { title: 30 })).toBe(160 / 14);
    expect(columnWidthRem(def('due'), { due: NaN })).toBe(136 / 14);
  });

  it('writes one custom property per fixed column and none for the Title', () => {
    const vars = widthVars([def('ref'), def('title'), def('due')], { due: 9 });
    expect(vars).toEqual({
      '--w-ref': `${112 / 14}rem`,
      '--w-due': '9rem',
    });
  });

  it('the table minimum is the fixed columns plus the Title minimum', () => {
    expect(tableMinRem([def('ref'), def('title'), def('due')], undefined)).toBeCloseTo(
      (112 + 160 + 136) / 14,
      9,
    );
  });
});
