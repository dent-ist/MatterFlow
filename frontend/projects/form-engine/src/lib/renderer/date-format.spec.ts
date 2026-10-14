import {
  formatDisplayDate,
  formatDisplayDateTime,
  formatStoredDate,
  formatStoredInstant,
} from './date-format';

describe('date display formats', () => {
  it('formats a local date as Oct 12, 2026 and a local date-time with a 12-hour clock', () => {
    expect(formatDisplayDate(new Date(2026, 9, 12))).toBe('Oct 12, 2026');
    expect(formatDisplayDateTime(new Date(2026, 9, 12, 22, 23))).toBe('Oct 12, 2026, 10:23 PM');
    expect(formatDisplayDateTime(new Date(2026, 0, 3, 0, 5))).toBe('Jan 3, 2026, 12:05 AM');
    expect(formatDisplayDateTime(new Date(2026, 0, 3, 12, 0))).toBe('Jan 3, 2026, 12:00 PM');
  });

  it('formats a stored calendar date without any zone conversion and echoes unreadable text', () => {
    expect(formatStoredDate('2026-10-12')).toBe('Oct 12, 2026');
    expect(formatStoredDate('2026-02-30')).toBe('2026-02-30');
    expect(formatStoredDate('soon')).toBe('soon');
  });

  it('formats an instant in the viewer zone with its abbreviation (same as the app mfDate)', () => {
    const instant = new Date('2026-10-13T02:23:00Z');
    expect(formatStoredInstant(instant, 'America/New_York')).toBe('Oct 12, 2026, 10:23 PM EDT');
    expect(formatStoredInstant(instant, 'America/Los_Angeles')).toBe('Oct 12, 2026, 7:23 PM PDT');
  });
});
