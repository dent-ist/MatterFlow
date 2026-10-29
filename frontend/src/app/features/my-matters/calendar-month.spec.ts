import { monthOf, monthTitle, parseMonth, shiftMonth, todayText } from './calendar-month';

describe('calendar month (#944)', () => {
  it('reads and shifts a month across the year edge', () => {
    expect(monthOf('2026-10-28')).toBe('2026-10');
    expect(shiftMonth('2026-10', 1)).toBe('2026-11');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-03', -14)).toBe('2025-01');
  });

  it('names a month the way people say it', () => {
    expect(monthTitle('2026-10')).toBe('October 2026');
    expect(monthTitle('2027-01')).toBe('January 2027');
  });

  it('takes only a yyyy-mm from the address', () => {
    expect(parseMonth('2026-10')).toBe('2026-10');
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('2026-00')).toBeNull();
    expect(parseMonth('Oct 2026')).toBeNull();
    expect(parseMonth(null)).toBeNull();
  });

  it("writes today in the viewer's zone", () => {
    const clock = { now: () => new Date('2026-10-29T02:30:00Z') } as never;
    expect(todayText(clock, 'America/New_York')).toBe('2026-10-28');
    expect(todayText(clock, 'UTC')).toBe('2026-10-29');
  });
});
