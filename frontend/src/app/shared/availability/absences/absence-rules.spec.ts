import { AbsenceEntry } from './absence-contract';
import { addDays, groupAbsences, validateAbsence } from './absence-rules';

const entry = (id: number, state: AbsenceEntry['state'], startDate: string): AbsenceEntry => ({
  absenceId: id,
  userId: 1,
  type: 'VACATION',
  startDate,
  endDate: null,
  note: null,
  state,
  workingDays: null,
  rowVersion: 'v',
});

describe('groupAbsences', () => {
  it('puts Now and Upcoming earliest first and Past most recent first', () => {
    const g = groupAbsences([
      entry(1, 'UPCOMING', '2026-12-01'),
      entry(2, 'PAST', '2026-01-01'),
      entry(3, 'UPCOMING', '2026-11-20'),
      entry(4, 'PAST', '2026-06-01'),
      entry(5, 'NOW', '2026-11-02'),
    ]);
    expect(g.now.map((e) => e.absenceId)).toEqual([5]);
    expect(g.upcoming.map((e) => e.absenceId)).toEqual([3, 1]);
    expect(g.past.map((e) => e.absenceId)).toEqual([4, 2]);
  });
});

describe('addDays', () => {
  it('moves across month ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('validateAbsence', () => {
  const ctx = { today: '2026-11-03', canBackdate: false };
  const base = {
    type: 'VACATION' as const,
    startDate: '2026-11-10',
    endDate: '2026-11-12',
    note: null,
  };

  it('accepts a clean future entry and an open-ended one', () => {
    expect(validateAbsence(base, ctx, false)).toEqual({});
    expect(validateAbsence({ ...base, endDate: null }, ctx, false)).toEqual({});
  });
  it('needs a first day', () => {
    expect(validateAbsence({ ...base, startDate: '' }, ctx, false).startDate).toBeTruthy();
  });
  it('refuses an end before the start', () => {
    expect(validateAbsence({ ...base, endDate: '2026-11-09' }, ctx, false).endDate).toBeTruthy();
    expect(validateAbsence({ ...base, endDate: '2026-11-10' }, ctx, false).endDate).toBeUndefined();
  });
  it('refuses a start in the past, except a Sick day up to 14 days back and managers', () => {
    const past = { ...base, startDate: '2026-11-01', endDate: null };
    expect(validateAbsence(past, ctx, false).startDate).toBeTruthy();
    expect(validateAbsence({ ...past, type: 'SICK' }, ctx, false).startDate).toBeUndefined();
    expect(
      validateAbsence({ ...past, type: 'SICK', startDate: '2026-10-10' }, ctx, false).startDate,
    ).toBeTruthy();
    expect(validateAbsence(past, { ...ctx, canBackdate: true }, false).startDate).toBeUndefined();
  });
  it('does not re-check the start of an entry being edited', () => {
    expect(
      validateAbsence({ ...base, startDate: '2026-10-30' }, ctx, true).startDate,
    ).toBeUndefined();
  });
  it('limits the note to 200 characters', () => {
    expect(validateAbsence({ ...base, note: 'x'.repeat(201) }, ctx, false).note).toBeTruthy();
    expect(validateAbsence({ ...base, note: 'x'.repeat(200) }, ctx, false).note).toBeUndefined();
  });
});
