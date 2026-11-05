import {
  formatDisplayDate,
  formatDisplayDateTime,
  formatStoredDate,
  formatStoredInstant,
} from './date-format';

const NOW = new Date(2026, 10, 5, 12, 0);

describe('date display formats', () => {
  it('formats a local date as MM/DD/YYYY and a local date-time with a 12-hour clock and a leading zero', () => {
    expect(formatDisplayDate(new Date(2026, 9, 12))).toBe('10/12/2026');
    expect(formatDisplayDateTime(new Date(2026, 9, 12, 22, 23))).toBe('10/12/2026 10:23 PM');
    expect(formatDisplayDateTime(new Date(2026, 0, 3, 0, 5))).toBe('01/03/2026 12:05 AM');
    expect(formatDisplayDateTime(new Date(2026, 0, 3, 12, 0))).toBe('01/03/2026 12:00 PM');
    expect(formatDisplayDateTime(new Date(2026, 0, 3, 9, 7))).toBe('01/03/2026 09:07 AM');
  });

  it('formats a stored calendar date as MM/DD (MM/DD/YYYY in another year) without any zone conversion and echoes unreadable text', () => {
    expect(formatStoredDate('2026-10-12', NOW)).toBe('10/12');
    expect(formatStoredDate('2025-10-12', NOW)).toBe('10/12/2025');
    expect(formatStoredDate('2026-02-30', NOW)).toBe('2026-02-30');
    expect(formatStoredDate('soon', NOW)).toBe('soon');
  });

  it('formats an instant in the viewer zone as MM/DD hh:mm AM/PM, no month name and no zone name', () => {
    const instant = new Date('2026-10-13T02:23:00Z');
    expect(formatStoredInstant(instant, 'America/New_York', NOW)).toBe('10/12 10:23 PM');
    expect(formatStoredInstant(instant, 'America/Los_Angeles', NOW)).toBe('10/12 07:23 PM');
    expect(formatStoredInstant(instant, 'UTC', new Date('2027-01-05T00:00:00Z'))).toBe(
      '10/13/2026 02:23 AM',
    );
  });
});
