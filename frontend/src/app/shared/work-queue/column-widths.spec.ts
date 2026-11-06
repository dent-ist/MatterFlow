import { WORK_COLUMNS } from './column-prefs';
import {
  columnWidthRem,
  fixedTitleRem,
  pxToRem,
  remToPx,
  tableMinRem,
  widthVars,
} from './column-widths';

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
    expect(columnWidthRem(def('due'))).toBe(152 / 14);
    expect(columnWidthRem(def('ref'))).toBe(100 / 14);
    expect(columnWidthRem(def('matter'))).toBe(142 / 14);
    expect(columnWidthRem(def('matterName'))).toBe(160 / 14);
    expect(def('due').minWidth).toBe(120);
  });

  it('clamps a stored width to the column limits and ignores the Title', () => {
    expect(columnWidthRem(def('due'), { due: 2 })).toBe(pxToRem(120));
    expect(columnWidthRem(def('due'), { due: 99 })).toBe(pxToRem(200));
    expect(columnWidthRem(def('due'), { due: 9 })).toBe(9);
    expect(Math.round(remToPx(columnWidthRem(def('due'))))).toBe(152);
    expect(columnWidthRem(def('title'), { title: 30 })).toBe(120 / 14);
    // The Title is fixed only once it was dragged (#1231), clamped to 96 and 1600 px.
    expect(fixedTitleRem(def('title'), undefined)).toBeUndefined();
    expect(fixedTitleRem(def('title'), { title: 20 })).toBe(20);
    expect(fixedTitleRem(def('title'), { title: 5 })).toBe(96 / 14);
    expect(fixedTitleRem(def('due'), { due: 9 })).toBeUndefined();
    expect(columnWidthRem(def('due'), { due: NaN })).toBe(152 / 14);
  });

  it('writes one custom property per fixed column, and for the Title only once it was dragged (#1231)', () => {
    expect(widthVars([def('title')], { title: 20 })).toEqual({ '--w-title': '20rem' });
    const vars = widthVars([def('ref'), def('title'), def('due')], { due: 9 });
    expect(vars).toEqual({
      '--w-ref': `${100 / 14}rem`,
      '--w-due': '9rem',
    });
  });

  it('the table minimum is the fixed columns plus the Title minimum', () => {
    expect(tableMinRem([def('ref'), def('title'), def('due')], undefined)).toBeCloseTo(
      (100 + 120 + 152) / 14,
      9,
    );
  });
});
