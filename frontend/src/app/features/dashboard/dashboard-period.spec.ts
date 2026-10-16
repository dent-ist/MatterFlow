import {
  ALL_PRESETS,
  CORE_PRESETS,
  DEFAULT_PERIOD,
  customProblem,
  isPeriodKey,
  migrateStoredPeriod,
  periodArgs,
  periodForTab,
  periodFromParams,
  periodPhrase,
  periodToParams,
  presetsFor,
  rangeText,
  resolveRange,
} from './dashboard-period';

describe('the period vocabulary', () => {
  it('offers 7, 30 and 90 days, this month and last month, and Coverage appends 6 and 12 months', () => {
    expect(CORE_PRESETS.map((p) => p.label)).toEqual([
      '7 days',
      '30 days',
      '90 days',
      'This month',
      'Last month',
    ]);
    expect(presetsFor(false)).toBe(CORE_PRESETS);
    expect(presetsFor(true).map((p) => p.label)).toEqual([
      ...CORE_PRESETS.map((p) => p.label),
      'Last 6 months',
      'Last 12 months',
    ]);
    expect(ALL_PRESETS.some((p) => p.label === 'This week')).toBe(false);
  });

  it('recognises only the current keys', () => {
    for (const k of ['7d', '30d', '90d', 'this-month', 'last-month', '6m', '12m', 'custom']) {
      expect(isPeriodKey(k)).toBe(true);
    }
    for (const k of ['week', 'month', 'quarter', '90', '180', '', null, undefined]) {
      expect(isPeriodKey(k)).toBe(false);
    }
  });

  it('shows the long windows as the default on tabs that do not offer them', () => {
    expect(periodForTab({ key: '12m', from: null, to: null }, false)).toEqual(DEFAULT_PERIOD);
    expect(periodForTab({ key: '12m', from: null, to: null }, true).key).toBe('12m');
    expect(periodForTab({ key: '90d', from: null, to: null }, false).key).toBe('90d');
  });
});

describe('stored values from the old list', () => {
  it('migrates This week, This month, Last 30 days and Last quarter', () => {
    expect(migrateStoredPeriod('week')).toBe('7d');
    expect(migrateStoredPeriod('month')).toBe('this-month');
    expect(migrateStoredPeriod('30d')).toBe('30d');
    expect(migrateStoredPeriod('quarter')).toBe('90d');
  });

  it('keeps current keys and drops custom and unknown values', () => {
    expect(migrateStoredPeriod('last-month')).toBe('last-month');
    expect(migrateStoredPeriod('custom')).toBeNull();
    expect(migrateStoredPeriod('bogus')).toBeNull();
    expect(migrateStoredPeriod(7)).toBeNull();
    expect(migrateStoredPeriod(undefined)).toBeNull();
  });
});

describe('resolving a period in the viewer zone', () => {
  // Wednesday 14 October 2026, 15:45 UTC.
  const now = new Date('2026-10-14T15:45:00Z');
  const of = (key: Parameters<typeof resolveRange>[0]['key'], at = now, zone = 'UTC') =>
    resolveRange({ key, from: null, to: null }, at, zone);

  it('ends rolling windows today and counts today as day one', () => {
    expect(of('7d')).toEqual({ from: '2026-10-08', to: '2026-10-14', days: 7 });
    expect(of('30d')).toEqual({ from: '2026-09-15', to: '2026-10-14', days: 30 });
    expect(of('90d')).toEqual({ from: '2026-07-17', to: '2026-10-14', days: 90 });
    expect(of('6m').days).toBe(183);
    expect(of('12m').days).toBe(365);
  });

  it('runs This month from the 1st to today and Last month over the whole previous month', () => {
    expect(of('this-month')).toEqual({ from: '2026-10-01', to: '2026-10-14', days: 14 });
    expect(of('last-month')).toEqual({ from: '2026-09-01', to: '2026-09-30', days: 30 });
  });

  it('handles month and year edges, including a leap February', () => {
    expect(of('last-month', new Date('2027-01-01T12:00:00Z'))).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
      days: 31,
    });
    expect(of('last-month', new Date('2028-03-01T12:00:00Z'))).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
      days: 29,
    });
    expect(of('this-month', new Date('2026-03-01T12:00:00Z')).days).toBe(1);
  });

  it('uses the viewer zone to decide what today is', () => {
    // 02:30 UTC on 1 November is still 31 October in New York and already 1 November in Kiritimati.
    const instant = new Date('2026-11-01T02:30:00Z');
    expect(of('this-month', instant, 'America/New_York').from).toBe('2026-10-01');
    expect(of('this-month', instant, 'America/New_York').to).toBe('2026-10-31');
    expect(of('this-month', instant, 'Pacific/Kiritimati')).toEqual({
      from: '2026-11-01',
      to: '2026-11-01',
      days: 1,
    });
    expect(of('last-month', instant, 'Pacific/Kiritimati').from).toBe('2026-10-01');
  });

  it('counts calendar days across a daylight saving change', () => {
    // New York leaves daylight time on 1 November 2026 (a 25-hour day): 7 days ending 3 November start on 28 October.
    expect(of('7d', new Date('2026-11-03T15:00:00Z'), 'America/New_York')).toEqual({
      from: '2026-10-28',
      to: '2026-11-03',
      days: 7,
    });
  });

  it('keeps both ends of a custom range', () => {
    const r = resolveRange({ key: 'custom', from: '2026-10-01', to: '2026-10-03' }, now, 'UTC');
    expect(r).toEqual({ from: '2026-10-01', to: '2026-10-03', days: 3 });
  });
});

describe('range text', () => {
  it('reads "Sep 17 to Oct 16" inside the current year and adds years outside it', () => {
    expect(rangeText({ from: '2026-09-17', to: '2026-10-16', days: 30 }, 2026)).toBe(
      'Sep 17 to Oct 16',
    );
    expect(rangeText({ from: '2025-12-20', to: '2026-01-03', days: 15 }, 2026)).toBe(
      'Dec 20, 2025 to Jan 3, 2026',
    );
    expect(rangeText({ from: '2026-10-16', to: '2026-10-16', days: 1 }, 2026)).toBe('Oct 16');
    expect(periodPhrase({ from: '2026-09-17', to: '2026-10-16', days: 30 }, 2026)).toBe(
      'from Sep 17 to Oct 16',
    );
    expect(periodPhrase(null, 2026)).toBe('in the chosen period');
  });
});

describe('custom ranges', () => {
  it('accepts a range up to 366 days, both ends included', () => {
    expect(customProblem('2026-10-01', '2026-10-01')).toBeNull();
    expect(customProblem('2025-10-14', '2026-10-14')).toBeNull(); // 366 days
  });

  it('rejects a reversed, an over-long, an incomplete or a malformed range', () => {
    expect(customProblem('2026-10-05', '2026-10-04')).toMatch(/after its end/);
    expect(customProblem('2025-10-13', '2026-10-14')).toMatch(/at most 366 days/);
    expect(customProblem('2026-10-05', null)).toMatch(/both dates/);
    expect(customProblem('2026-13-05', '2026-10-05')).toMatch(/yyyy-mm-dd/);
  });
});

describe('the address', () => {
  const get = (q: Record<string, string>) => (k: string) => q[k] ?? null;

  it('round-trips every key, leaves the default out and writes the dates only for a custom range', () => {
    for (const key of ['7d', '90d', 'this-month', 'last-month', '6m', '12m'] as const) {
      const params = periodToParams({ key, from: null, to: null });
      expect(params).toEqual({ period: key, from: null, to: null });
      expect(periodFromParams(get({ period: key }))).toEqual({ key, from: null, to: null });
    }
    expect(periodToParams(DEFAULT_PERIOD)).toEqual({ period: null, from: null, to: null });
    const custom = { key: 'custom', from: '2026-10-01', to: '2026-10-09' } as const;
    expect(periodToParams(custom)).toEqual({
      period: 'custom',
      from: '2026-10-01',
      to: '2026-10-09',
    });
    expect(
      periodFromParams(get({ period: 'custom', from: '2026-10-01', to: '2026-10-09' })),
    ).toEqual(custom);
  });

  it('ignores a missing, unknown or invalid period so the remembered one applies', () => {
    expect(periodFromParams(get({}))).toBeNull();
    expect(periodFromParams(get({ period: 'quarter' }))).toBeNull();
    expect(periodFromParams(get({ period: 'custom' }))).toBeNull();
    expect(
      periodFromParams(get({ period: 'custom', from: '2026-10-09', to: '2026-10-01' })),
    ).toBeNull();
    expect(
      periodFromParams(get({ period: 'custom', from: '2024-01-01', to: '2026-10-01' })),
    ).toBeNull();
  });

  it('turns a period into API arguments', () => {
    expect(periodArgs({ key: 'this-month', from: null, to: null })).toEqual({
      period: 'this-month',
    });
    expect(periodArgs({ key: 'custom', from: '2026-10-01', to: '2026-10-09' })).toEqual({
      period: 'custom',
      from: '2026-10-01',
      to: '2026-10-09',
    });
  });
});
