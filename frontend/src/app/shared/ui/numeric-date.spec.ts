import {
  NUMERIC_DATE,
  numericDate,
  numericDateAndTime,
  numericDay,
  numericInstant,
  numericInstantFull,
  numericTime,
  readableDate,
  readableInstant,
} from './numeric-date';

const NOW = new Date('2026-10-31T15:00:00Z');
const NY = 'America/New_York';

describe('numeric date format (UI-23)', () => {
  it('is one pattern', () => {
    expect(NUMERIC_DATE.pattern).toBe('MM/DD hh:mm AM/PM');
  });

  it('a date with no time is MM/DD, in another year MM/DD/YYYY', () => {
    expect(numericDate('2026-10-26', NOW, NY)).toBe('10/26');
    expect(numericDate('2026-01-05', NOW, NY)).toBe('01/05');
    expect(numericDate('2027-01-05', NOW, NY)).toBe('01/05/2027');
    expect(numericDate('2025-12-31', NOW, NY)).toBe('12/31/2025');
    expect(numericDay({ year: 2026, month: 3, day: 9 }, 2026)).toBe('03/09');
  });

  it('a date with a time adds hh:mm AM/PM with a leading zero and a space', () => {
    expect(numericDateAndTime('2026-10-26', '16:00', NOW, NY)).toBe('10/26 04:00 PM');
    expect(numericDateAndTime('2026-10-26', '09:05', NOW, NY)).toBe('10/26 09:05 AM');
    expect(numericDateAndTime('2027-02-01', '16:00', NOW, NY)).toBe('02/01/2027 04:00 PM');
    expect(numericDateAndTime('2026-10-26', null, NOW, NY)).toBe('10/26');
  });

  it('midnight is 12:00 AM and noon is 12:00 PM', () => {
    expect(numericTime(0, 0)).toBe('12:00 AM');
    expect(numericTime(12, 0)).toBe('12:00 PM');
    expect(numericTime(0, 30)).toBe('12:30 AM');
    expect(numericTime(23, 59)).toBe('11:59 PM');
  });

  it("an instant is shown in the person's zone, also across the clock change", () => {
    // 20:00 UTC on 31 October 2026 is 04:00 PM in New York (EDT, UTC-4).
    expect(numericInstant('2026-10-26T20:00:00Z', NOW, NY)).toBe('10/26 04:00 PM');
    // After the clock change on 1 November 2026 the same UTC time is 03:00 PM (EST, UTC-5).
    expect(numericInstant('2026-11-02T20:00:00Z', NOW, NY)).toBe('11/02 03:00 PM');
    // Just after midnight UTC is still the evening before in New York.
    expect(numericInstant('2026-11-02T03:30:00Z', NOW, NY)).toBe('11/01 10:30 PM');
    expect(numericInstant('2026-03-08T06:59:00Z', NOW, NY)).toBe('03/08 01:59 AM');
    expect(numericInstant('2026-03-08T07:00:00Z', NOW, NY)).toBe('03/08 03:00 AM'); // 02:00 does not exist on the spring-forward day
    expect(numericInstant('2026-10-26T20:00:00Z', NOW, 'Asia/Tokyo')).toBe('10/27 05:00 AM');
    expect(numericInstant('2026-10-26T20:00:00Z', NOW, NY, false)).toBe('10/26');
  });

  it('the current year follows the zone at the turn of the year', () => {
    const lateDec = new Date('2026-12-31T23:30:00Z'); // already 2027 in Tokyo
    expect(numericDate('2027-01-02', lateDec, 'Asia/Tokyo')).toBe('01/02');
    expect(numericDate('2027-01-02', lateDec, NY)).toBe('01/02/2027');
  });

  it('text that is not a date is left alone', () => {
    expect(numericDate('ASAP', NOW, NY)).toBe('ASAP');
    expect(numericDate(null, NOW, NY)).toBe('');
  });

  it('accessible text spells the month out', () => {
    expect(readableDate('2026-10-26')).toBe('October 26, 2026');
    expect(readableDate('2026-10-26', '16:00')).toBe('October 26, 2026, 4:00 PM');
    expect(readableInstant('2026-10-26T20:00:00Z', NY)).toBe('October 26, 2026, 4:00 PM');
  });
});

describe('numericInstantFull (MD-42)', () => {
  it('always has the year and the 12-hour clock', () => {
    expect(numericInstantFull('2026-10-26T20:00:00Z', NY)).toBe('10/26/2026 04:00 PM');
    expect(numericInstantFull('2025-01-02T05:05:00Z', 'UTC')).toBe('01/02/2025 05:05 AM');
  });
});
