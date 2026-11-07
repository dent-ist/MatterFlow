import {
  COLUMN_WIDTHS,
  cellText,
  cellTitle,
  decimalScale,
  formatDate,
  formatDateTime,
  gridColumnDefs,
  kindOf,
  resultColumns,
} from './report-column-defs';

const cols = (...types: [string, string][]) =>
  resultColumns(types.map(([name, type]) => ({ name, type })));

describe('report column definitions (#720)', () => {
  it('reads the types of the server and takes anything else for text', () => {
    expect(
      ['text', 'integer', 'decimal', 'boolean', 'date', 'dateTime', 'blob'].map(kindOf),
    ).toEqual(['text', 'integer', 'decimal', 'boolean', 'date', 'dateTime', 'text']);
  });

  it('gives each column an id for sort and filter and a unique grid key even for two columns of one name', () => {
    const c = cols(['Name', 'text'], ['Name', 'text'], ['Count', 'integer']);
    expect(c.map((x) => x.id)).toEqual(['c0', 'c1', 'c2']);
    expect(c.map((x) => x.key)).toEqual(['Name', 'Name (2)', 'Count']);
  });

  describe('widths (spec 4.5)', () => {
    it('uses the default width and minimum of each type', () => {
      const c = cols(
        ['A', 'boolean'],
        ['B', 'integer'],
        ['C', 'decimal'],
        ['D', 'date'],
        ['E', 'dateTime'],
        ['F', 'text'],
      );
      const defs = gridColumnDefs(c);
      expect(defs.map((d) => d.width)).toEqual([
        '96px',
        '112px',
        '128px',
        '128px',
        '176px',
        undefined,
      ]);
      expect(defs.map((d) => d.minWidth)).toEqual(
        c
          .slice(0, 5)
          .map((x) => `${COLUMN_WIDTHS[x.kind].min}px`)
          .concat('200px'),
      );
    });

    it('lets the last text column take the room that is left and keeps the others at their width', () => {
      const defs = gridColumnDefs(cols(['Matter', 'text'], ['Open', 'integer'], ['Note', 'text']));
      expect(defs.map((d) => d.width)).toEqual(['200px', '112px', undefined]);
    });

    it('widens a text column to 280 when one of the first rows holds more than 40 characters', () => {
      const c = cols(['Matter', 'text'], ['Note', 'text']);
      const defs = gridColumnDefs(c, [['short', 'x'.repeat(41)]]);
      expect(defs[0].width).toBe('200px');
      expect(defs[1].minWidth).toBe('280px');
      expect(gridColumnDefs(c, [['x'.repeat(41), 'ok']])[0].width).toBe('280px');
    });

    it('makes a column as wide as its header needs (words plus 56 px), at most 320', () => {
      const defs = gridColumnDefs(
        cols(
          ['Estimated hours remaining on the matter', 'integer'],
          ['An extremely long column name that goes on and on and on', 'integer'],
        ),
      );
      expect(parseInt(defs[0].width!)).toBeGreaterThan(112);
      expect(defs[1].width).toBe('320px');
    });

    it('right aligns numbers and sorts by the column id', () => {
      const defs = gridColumnDefs(cols(['N', 'integer'], ['D', 'decimal'], ['T', 'text']));
      expect(defs.map((d) => d.num)).toEqual([true, true, false]);
      expect(defs.map((d) => d.sort)).toEqual(['c0', 'c1', 'c2']);
    });
  });

  describe('cell text (spec 4.4)', () => {
    it('leaves a null empty, for every type', () => {
      for (const kind of ['text', 'integer', 'decimal', 'boolean', 'date', 'dateTime'] as const) {
        expect(cellText(null, kind)).toBe('');
      }
    });

    it('shows integers with a thousands comma and a minus sign', () => {
      expect(cellText(1234, 'integer')).toBe('1,234');
      expect(cellText(-1234567, 'integer')).toBe('-1,234,567');
      expect(cellText(0, 'integer')).toBe('0');
    });

    it('shows decimals with the scale of the column, at least the value own digits, at most 4', () => {
      expect(cellText(1234.5, 'decimal', 2)).toBe('1,234.50');
      expect(cellText(1234.5678, 'decimal', 2)).toBe('1,234.5678');
      expect(cellText(1.123456, 'decimal', 0)).toBe('1.1235');
      expect(cellText(12, 'decimal', 0)).toBe('12');
    });

    it('takes the scale of a decimal column from the rows, at most 4', () => {
      expect(decimalScale([[1.5], [2.25]], 0)).toBe(2);
      expect(decimalScale([[1.123456]], 0)).toBe(4);
      expect(decimalScale([[3]], 0)).toBe(0);
      expect(decimalScale([[null]], 0)).toBe(0);
    });

    it('shows Yes and No', () => {
      expect(cellText(true, 'boolean')).toBe('Yes');
      expect(cellText(false, 'boolean')).toBe('No');
    });

    it('shows dates as MM/DD/YYYY, always with the year', () => {
      expect(cellText('2026-03-31', 'date')).toBe('03/31/2026');
      expect(formatDate('2026-11-07')).toBe('11/07/2026');
      expect(formatDate('not a date')).toBe('not a date');
    });

    it('shows date-times as MM/DD/YYYY hh:mm AM/PM, as the server sent the clock', () => {
      expect(formatDateTime('2026-03-31T14:05:09.1234567')).toBe('03/31/2026 02:05 PM');
      expect(formatDateTime('2026-03-31T00:00:00')).toBe('03/31/2026 12:00 AM');
      expect(formatDateTime('2026-03-31T12:30:00')).toBe('03/31/2026 12:30 PM');
    });

    it('gives a date-time its long form as the tooltip and no other type any', () => {
      expect(cellTitle('2026-03-31T14:05:09', 'dateTime')).toBe('March 31, 2026 2:05 PM');
      expect(cellTitle('2026-03-31', 'date')).toBeNull();
      expect(cellTitle('abc', 'text')).toBeNull();
    });

    it('shows text as it is with its white space collapsed, never as markup', () => {
      expect(cellText('  two   words\n and <b>more</b>', 'text')).toBe('two words and <b>more</b>');
    });
  });
});
