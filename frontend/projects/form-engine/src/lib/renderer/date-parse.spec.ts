import { formatDateTimeText, parseDateText, parseDateTimeText, parseTimeText } from './date-parse';

describe('date-parse', () => {
  it.each([
    ['2026-10-14', 2026, 10, 14],
    ['2026-1-4', 2026, 1, 4],
    ['2026/10/14', 2026, 10, 14],
    ['10/14/2026', 2026, 10, 14],
    ['9/14/2026', 2026, 9, 14],
    ['10/1/26', 2026, 10, 1],
    ['10-14-2026', 2026, 10, 14],
    ['Oct 14, 2026', 2026, 10, 14],
    ['Oct 1, 2026', 2026, 10, 1],
    ['October 14 2026', 2026, 10, 14],
    ['sept 3, 2026', 2026, 9, 3],
    ['14 Oct 2026', 2026, 10, 14],
    ['  2026-10-14  ', 2026, 10, 14],
  ])('accepts %s', (text, year, month, day) => {
    expect(parseDateText(text)).toEqual({ year, month, day });
  });

  it.each([
    '',
    'tomorrow',
    '2026-09-016',
    '2026-13-01',
    '2026-02-30',
    '13/1/2026',
    '10/14',
    'Foo 14, 2026',
    '2026-10-14x',
    '20261014',
  ])('rejects %j', (text) => {
    expect(parseDateText(text)).toBeNull();
  });

  it('parses times with and without AM/PM', () => {
    expect(parseTimeText('14:30')).toEqual({ hours: 14, minutes: 30, seconds: 0 });
    expect(parseTimeText('2:30 PM')).toEqual({ hours: 14, minutes: 30, seconds: 0 });
    expect(parseTimeText('12:05am')).toEqual({ hours: 0, minutes: 5, seconds: 0 });
    expect(parseTimeText('24:00')).toBeNull();
    expect(parseTimeText('13:00 PM')).toBeNull();
  });

  it('parses local dates and datetimes', () => {
    expect(parseDateTimeText('Oct 1, 2026', false)).toEqual(new Date(2026, 9, 1));
    expect(parseDateTimeText('2026-10-01 14:30', true)).toEqual(new Date(2026, 9, 1, 14, 30));
    expect(parseDateTimeText('2026-10-01T14:30', true)).toEqual(new Date(2026, 9, 1, 14, 30));
    expect(parseDateTimeText('Oct 1, 2026 2:30 PM', true)).toEqual(new Date(2026, 9, 1, 14, 30));
    expect(parseDateTimeText('Oct 1, 2026, 2:30 PM', true)).toEqual(new Date(2026, 9, 1, 14, 30));
    expect(parseDateTimeText('10/1/2026, 14:30', true)).toEqual(new Date(2026, 9, 1, 14, 30));
    expect(parseDateTimeText('2026-10-01', true)).toBeNull();
  });

  it('formats as yyyy-mm-dd', () => {
    expect(formatDateTimeText(new Date(2026, 8, 4, 7, 5), false)).toBe('2026-09-04');
    expect(formatDateTimeText(new Date(2026, 8, 4, 7, 5), true)).toBe('2026-09-04 07:05');
  });
});
