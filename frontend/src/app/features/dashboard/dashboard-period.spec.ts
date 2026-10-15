import { PERIOD_PRESETS, isPeriodKey, periodDays, presetOf } from './dashboard-period';

describe('period presets', () => {
  // Wednesday 14 October 2026, 15:45 UTC.
  const now = new Date('2026-10-14T15:45:00Z');

  it('offers this week, this month, last 30 days and last quarter', () => {
    expect(PERIOD_PRESETS.map((p) => p.label)).toEqual([
      'This week',
      'This month',
      'Last 30 days',
      'Last quarter',
    ]);
  });

  it('counts this week from Monday and this month from the 1st, including today', () => {
    expect(periodDays('week', now, 'UTC')).toBe(3);
    expect(periodDays('month', now, 'UTC')).toBe(14);
    expect(periodDays('30d', now, 'UTC')).toBe(30);
    expect(periodDays('quarter', now, 'UTC')).toBe(90);
  });

  it('starts the week on Monday: Monday is day 1, Sunday day 7', () => {
    expect(periodDays('week', new Date('2026-10-12T12:00:00Z'), 'UTC')).toBe(1);
    expect(periodDays('week', new Date('2026-10-18T12:00:00Z'), 'UTC')).toBe(7);
  });

  it('uses the viewer zone to decide what today is', () => {
    // 01:30 UTC on Thursday 15 Oct is still Wednesday 14 Oct in New York and already Thursday in Auckland.
    const instant = new Date('2026-10-15T01:30:00Z');
    expect(periodDays('month', instant, 'America/New_York')).toBe(14);
    expect(periodDays('month', instant, 'Pacific/Auckland')).toBe(15);
    expect(periodDays('week', instant, 'America/New_York')).toBe(3);
    expect(periodDays('week', instant, 'Pacific/Auckland')).toBe(4);
  });

  it('recognises only known keys and falls back to 30 days', () => {
    expect(isPeriodKey('quarter')).toBe(true);
    expect(isPeriodKey('90')).toBe(false);
    expect(presetOf('month').label).toBe('This month');
  });
});
