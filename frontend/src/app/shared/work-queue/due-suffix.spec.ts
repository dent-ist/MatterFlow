import { ageText, dashDue, suffixWords } from './due-suffix';

const ZONE = 'America/New_York';
const NOW = new Date('2026-11-03T15:42:00Z'); // 10:42 AM in New York

const at = (iso: string) => ({ dueAtUtc: iso });

describe('dashDue (decision AS item 3)', () => {
  it('shows the date and +9d on one line for a timed due nine days ago', () => {
    const d = dashDue(at('2026-10-25T14:00:00Z'), NOW, ZONE, 'IN_PROGRESS');
    expect(d.dateText).toBe('10/25 10:00 AM');
    expect(d.suffix).toBe('+9d');
    expect(d.words).toBe('9 days overdue');
    expect(d.overdue).toBe(true);
    expect(d.name).toContain('9 days overdue');
    expect(d.tooltip).toContain('9 days overdue');
  });

  it('counts hours under a day: +7h, and +<1h under an hour', () => {
    expect(dashDue(at('2026-11-03T08:40:00Z'), NOW, ZONE).suffix).toBe('+7h');
    expect(dashDue(at('2026-11-03T15:10:00Z'), NOW, ZONE).suffix).toBe('+<1h');
    expect(dashDue(at('2026-11-03T15:10:00Z'), NOW, ZONE).words).toBe('less than 1 hour overdue');
  });

  it('floors at the day boundary: 23 h 59 m is +23h, 24 h is +1d', () => {
    expect(dashDue(at('2026-11-02T15:43:00Z'), NOW, ZONE).suffix).toBe('+23h');
    expect(dashDue(at('2026-11-02T15:42:00Z'), NOW, ZONE).suffix).toBe('+1d');
    expect(dashDue(at('2026-11-02T15:42:00Z'), NOW, ZONE).words).toBe('1 day overdue');
  });

  it('measures instants in UTC, so the clock change on 2026-03-08 does not shorten nine days', () => {
    const march = new Date('2026-03-10T12:00:00Z');
    expect(dashDue(at('2026-03-01T12:00:00Z'), march, ZONE).suffix).toBe('+9d');
  });

  it('judges a date-only due by the viewer calendar day and shows MM/DD', () => {
    const d = dashDue({ dueDate: '2026-10-31' }, NOW, ZONE);
    expect(d.dateText).toBe('10/31');
    expect(d.suffix).toBe('+3d');
  });

  it('has no suffix today, tomorrow or later', () => {
    expect(dashDue(at('2026-11-03T20:00:00Z'), NOW, ZONE).suffix).toBeNull();
    expect(dashDue(at('2026-11-04T15:00:00Z'), NOW, ZONE).suffix).toBeNull();
    expect(dashDue(at('2026-12-20T15:00:00Z'), NOW, ZONE).suffix).toBeNull();
    expect(dashDue(at('2026-12-20T15:00:00Z'), NOW, ZONE).words).toBeNull();
  });

  it('never marks a closed task overdue', () => {
    const d = dashDue(at('2026-10-01T15:00:00Z'), NOW, ZONE, 'COMPLETED');
    expect(d.suffix).toBeNull();
    expect(d.overdue).toBe(false);
  });

  it('says ASAP for a task without a due date and does not fail on null', () => {
    expect(dashDue({}, NOW, ZONE).dateText).toBe('ASAP');
    expect(dashDue(null, NOW, ZONE).suffix).toBeNull();
  });

  it('puts the year in a due outside the current year', () => {
    expect(dashDue(at('2025-12-05T17:00:00Z'), NOW, ZONE).dateText).toBe('12/05/2025 12:00 PM');
  });

  it('spells the suffix words', () => {
    expect(suffixWords('+1d')).toBe('1 day overdue');
    expect(suffixWords('+2h')).toBe('2 hours overdue');
  });

  it('writes ages', () => {
    expect(ageText(12)).toBe('12 m');
    expect(ageText(60)).toBe('1 h 00 m');
    expect(ageText(26 * 60 + 5)).toBe('1 d 2 h');
  });
});
