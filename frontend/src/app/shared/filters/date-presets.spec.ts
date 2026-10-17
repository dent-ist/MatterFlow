import {
  DATE_PRESETS,
  DUE_PRESETS,
  addDays,
  matchingPreset,
  presetRange,
  rangeReversed,
  todayInZone,
  weekdayMonday,
} from './date-presets';

describe('date presets', () => {
  // Thursday, 15 October 2026.
  const thursday = { year: 2026, month: 10, day: 15 };

  it('starts the week on Monday and ends it on Sunday', () => {
    expect(weekdayMonday(thursday)).toBe(3);
    expect(presetRange('thisWeek', thursday)).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    // On a Monday the week starts that day; on a Sunday it started six days earlier.
    expect(presetRange('thisWeek', { year: 2026, month: 10, day: 12 })).toEqual({
      from: '2026-10-12',
      to: '2026-10-18',
    });
    expect(presetRange('thisWeek', { year: 2026, month: 10, day: 18 })).toEqual({
      from: '2026-10-12',
      to: '2026-10-18',
    });
  });

  it('works out the other presets from today', () => {
    expect(presetRange('today', thursday)).toEqual({ from: '2026-10-15', to: '2026-10-15' });
    expect(presetRange('last7', thursday)).toEqual({ from: '2026-10-09', to: '2026-10-15' });
    expect(presetRange('last30', thursday)).toEqual({ from: '2026-09-16', to: '2026-10-15' });
    expect(presetRange('next7', thursday)).toEqual({ from: '2026-10-15', to: '2026-10-21' });
    expect(presetRange('thisMonth', thursday)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('thisMonth', { year: 2026, month: 2, day: 10 })).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(presetRange('thisMonth', { year: 2026, month: 12, day: 31 })).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
    expect(presetRange('nope', thursday)).toBeNull();
  });

  it('crosses month and year ends', () => {
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
    expect(presetRange('last7', { year: 2027, month: 1, day: 3 })).toEqual({
      from: '2026-12-28',
      to: '2027-01-03',
    });
  });

  it("uses the viewer's time zone to decide what today is", () => {
    // 23:30 UTC on 15 Oct is already 16 Oct in Auckland and still 15 Oct in Los Angeles.
    const now = new Date('2026-10-15T23:30:00Z');
    expect(todayInZone(now, 'Pacific/Auckland')).toMatchObject({ month: 10, day: 16 });
    expect(todayInZone(now, 'America/Los_Angeles')).toMatchObject({ month: 10, day: 15 });
  });

  it('finds the preset a range came from and spots a reversed range', () => {
    const keys = DATE_PRESETS.map((p) => p.key);
    expect(matchingPreset({ from: '2026-10-12', to: '2026-10-18' }, thursday, keys)).toBe(
      'thisWeek',
    );
    expect(matchingPreset({ from: '2026-10-01', to: '2026-10-02' }, thursday, keys)).toBeNull();
    expect(rangeReversed({ from: '2026-10-05', to: '2026-10-01' })).toBe(true);
    expect(rangeReversed({ from: '2026-10-05', to: '' })).toBe(false);
  });
});

describe('Due presets (G2)', () => {
  const wednesday = { year: 2026, month: 10, day: 14 };

  it('offers Today, Tomorrow, Next 7 days, This week, Next week, This month and no Overdue', () => {
    expect([...DUE_PRESETS]).toEqual([
      'today',
      'tomorrow',
      'next7',
      'thisWeek',
      'nextWeek',
      'thisMonth',
    ]);
    expect(DUE_PRESETS).not.toContain('overdue');
    for (const key of DUE_PRESETS) {
      expect(DATE_PRESETS.some((p) => p.key === key)).toBe(true);
    }
  });

  it('works out Tomorrow, Next 7 days (today included) and Next week (Monday to Sunday)', () => {
    expect(presetRange('tomorrow', wednesday)).toEqual({ from: '2026-10-15', to: '2026-10-15' });
    expect(presetRange('next7', wednesday)).toEqual({ from: '2026-10-14', to: '2026-10-20' });
    expect(presetRange('nextWeek', wednesday)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    // On a Monday and a Sunday the next week is still the one after this week.
    expect(presetRange('nextWeek', { year: 2026, month: 10, day: 12 })).toEqual({
      from: '2026-10-19',
      to: '2026-10-25',
    });
    expect(presetRange('nextWeek', { year: 2026, month: 10, day: 18 })).toEqual({
      from: '2026-10-19',
      to: '2026-10-25',
    });
  });

  it('crosses month, year and the DST change without drifting', () => {
    expect(presetRange('tomorrow', { year: 2026, month: 12, day: 31 })).toEqual({
      from: '2027-01-01',
      to: '2027-01-01',
    });
    expect(presetRange('nextWeek', { year: 2026, month: 12, day: 30 })).toEqual({
      from: '2027-01-04',
      to: '2027-01-10',
    });
    // US clocks change on 2026-11-01 and EU clocks on 2026-10-25: calendar arithmetic is unaffected.
    expect(presetRange('next7', { year: 2026, month: 10, day: 30 })).toEqual({
      from: '2026-10-30',
      to: '2026-11-05',
    });
    expect(presetRange('nextWeek', { year: 2026, month: 10, day: 21 })).toEqual({
      from: '2026-10-26',
      to: '2026-11-01',
    });
  });
});
