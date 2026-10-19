import {
  dueCellText,
  describeDueCell,
  formatDateOnly,
  formatInstant,
  parseDateOnly,
  formatStatusStamp,
  zoneAbbreviation,
  zonedLocalToUtc,
} from './time';

const NY = 'America/New_York';
const CHI = 'America/Chicago';
const LA = 'America/Los_Angeles';
const utc = (iso: string) => new Date(iso);

describe('formatInstant', () => {
  it('renders UTC in the viewer zone with the zone abbreviation', () => {
    expect(formatInstant('2026-10-28T20:00:00Z', CHI)).toBe('Oct 28, 2026, 3:00 PM CDT');
    expect(formatInstant('2026-10-28T20:00:00Z', LA)).toBe('Oct 28, 2026, 1:00 PM PDT');
    expect(formatInstant('2026-10-28T20:00:00Z', 'UTC')).toBe('Oct 28, 2026, 8:00 PM UTC');
  });

  it('moves to the next local day when the zone is past midnight', () => {
    expect(formatInstant('2026-10-29T03:30:00Z', NY)).toBe('Oct 28, 2026, 11:30 PM EDT');
    expect(formatInstant('2026-10-29T03:30:00Z', 'Asia/Tokyo')).toBe(
      'Oct 29, 2026, 12:30 PM GMT+9',
    );
  });

  it('switches abbreviation across the spring-forward DST boundary', () => {
    // 2026-03-08 07:00Z is the instant New York jumps 2:00 EST -> 3:00 EDT.
    expect(formatInstant('2026-03-08T06:59:00Z', NY)).toBe('Mar 8, 2026, 1:59 AM EST');
    expect(formatInstant('2026-03-08T07:00:00Z', NY)).toBe('Mar 8, 2026, 3:00 AM EDT');
  });

  it('switches abbreviation across the fall-back DST boundary', () => {
    // 2026-11-01 06:00Z is the instant New York falls back 2:00 EDT -> 1:00 EST.
    expect(formatInstant('2026-11-01T05:30:00Z', NY)).toBe('Nov 1, 2026, 1:30 AM EDT');
    expect(formatInstant('2026-11-01T06:30:00Z', NY)).toBe('Nov 1, 2026, 1:30 AM EST');
  });
});

describe('formatStatusStamp (T3 status note)', () => {
  const NOW = new Date('2026-10-19T16:00:00Z');
  it('is "Oct 18, 4:03 PM" in the viewer zone, in two zones', () => {
    expect(formatStatusStamp('2026-10-18T20:03:00Z', NY, NOW)).toBe('Oct 18, 4:03 PM');
    expect(formatStatusStamp('2026-10-18T20:03:00Z', 'Asia/Tokyo', NOW)).toBe('Oct 19, 5:03 AM');
  });
  it('adds the year outside the current year of the viewer zone', () => {
    expect(formatStatusStamp('2025-12-31T23:30:00Z', NY, NOW)).toBe('Dec 31, 2025, 6:30 PM');
    expect(formatStatusStamp('2025-12-31T23:30:00Z', 'Asia/Tokyo', NOW)).toBe(
      'Jan 1, 8:30 AM',
    );
  });
});

describe('zoneAbbreviation', () => {
  it('is DST aware', () => {
    expect(zoneAbbreviation('2026-01-15T12:00:00Z', NY)).toBe('EST');
    expect(zoneAbbreviation('2026-07-15T12:00:00Z', NY)).toBe('EDT');
    expect(zoneAbbreviation('2026-07-15T12:00:00Z', 'America/Phoenix')).toBe('MST');
  });
});

describe('date-only values', () => {
  it('parses and formats without any zone conversion', () => {
    expect(formatDateOnly('2026-10-28')).toBe('Oct 28, 2026');
    expect(formatDateOnly('2026-01-01')).toBe('Jan 1, 2026');
  });

  it('rejects impossible dates', () => {
    expect(parseDateOnly('2026-02-30')).toBeNull();
    expect(parseDateOnly('10/28/2026')).toBeNull();
    expect(formatDateOnly('nonsense')).toBe('nonsense');
  });
});

describe('zonedLocalToUtc', () => {
  it('converts local midnight across DST', () => {
    expect(zonedLocalToUtc({ year: 2026, month: 3, day: 9 }, NY).toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
    expect(zonedLocalToUtc({ year: 2026, month: 3, day: 7 }, NY).toISOString()).toBe(
      '2026-03-07T05:00:00.000Z',
    );
  });
});

describe('describeDueCell (#208)', () => {
  const AKL = 'Pacific/Auckland';
  const NOW = utc('2026-10-17T16:00:00Z'); // Oct 17 12:00 NY, Oct 17 09:00 LA, Oct 18 05:00 Auckland
  const timed = (iso: string) => ({ dueDate: null, dueAtUtc: iso });
  const cell = (d: object, zone = NY, status?: string, now = NOW) =>
    describeDueCell(d, now, zone, status);

  it('ASAP', () => {
    expect(cell({})).toMatchObject({
      tone: 'asap',
      line1: 'ASAP',
      line2: '',
      sentence: 'No due date, ASAP',
    });
  });

  it('overdue timed and date-only, hours then days, no week cap', () => {
    expect(cell(timed('2026-10-17T10:00:00Z'))).toMatchObject({
      tone: 'overdue',
      line1: 'Oct 17, 6:00 AM',
      dateText: 'Oct 17',
      line2: 'Overdue 6h',
      sentence: 'Due Oct 17 at 6:00 AM, overdue 6 hours',
      tooltip: 'Oct 17, 2026, 6:00 AM EDT',
    });
    expect(cell({ dueDate: '2026-10-13' })).toMatchObject({
      line1: 'Oct 13',
      line2: 'Overdue 4d',
      sentence: 'Due Oct 13, overdue 4 days',
    });
    expect(cell({ dueDate: '2026-08-15' }).line2).toBe('Overdue 63d');
    expect(cell(timed('2026-10-17T15:30:00Z')).sentence).toContain('less than 1 hour');
    expect(cell(timed('2026-10-17T15:00:00Z')).sentence).toContain('overdue 1 hour');
  });

  it('today, tomorrow, in 2 days, later', () => {
    expect(cell(timed('2026-10-18T03:59:00Z'))).toMatchObject({
      tone: 'today',
      line1: 'Oct 17, 11:59 PM',
      line2: 'Due today',
      sentence: 'Due today, Oct 17 at 11:59 PM',
    });
    expect(cell({ dueDate: '2026-10-17' })).toMatchObject({
      line1: 'Oct 17',
      sentence: 'Due today, Oct 17',
    });
    expect(cell(timed('2026-10-18T19:00:00Z'))).toMatchObject({
      tone: 'soon',
      line1: 'Oct 18, 3:00 PM',
      line2: 'Tomorrow',
      sentence: 'Due tomorrow, Oct 18 at 3:00 PM',
    });
    expect(cell(timed('2026-10-19T13:00:00Z'))).toMatchObject({
      tone: 'soon',
      line1: 'Oct 19, 9:00 AM',
      line2: 'In 2 days',
      sentence: 'Due Oct 19 at 9:00 AM, in 2 days',
      tooltip: 'Oct 19, 2026, 9:00 AM EDT',
    });
    expect(cell({ dueDate: '2026-10-28' })).toMatchObject({
      tone: 'none',
      line1: 'Oct 28',
      line2: '',
      sentence: 'Due Oct 28',
    });
    expect(cell({ dueDate: '2026-10-20' }).line2).toBe('');
  });

  it('closed tasks are muted with no line 2', () => {
    for (const s of ['COMPLETED', 'CANCELLED']) {
      expect(cell({ dueDate: '2026-10-13' }, NY, s)).toMatchObject({
        tone: 'closed',
        line1: 'Oct 13',
        line2: '',
        sentence: 'Was due Oct 13',
        overdue: false,
      });
    }
  });

  it('shows the year only outside the current calendar year', () => {
    expect(cell({ dueDate: '2027-01-05' }).line1).toBe('Jan 5, 2027');
    expect(cell({ dueDate: '2027-01-05' }).sentence).toBe('Due Jan 5, 2027');
    expect(cell({ dueDate: '2025-12-31' }).line1).toBe('Dec 31, 2025');
    // New Year's Eve in New York is already next year in Auckland.
    const nye = utc('2026-12-31T20:00:00Z');
    expect(cell({ dueDate: '2026-12-31' }, NY, undefined, nye).line1).toBe('Dec 31');
    expect(cell({ dueDate: '2026-12-31' }, AKL, undefined, nye).line1).toBe('Dec 31, 2026');
  });

  it('a timed task has the same tone and relative text in New York, Los Angeles and Auckland', () => {
    const t = timed('2026-10-19T13:00:00Z');
    const cells = [NY, LA, AKL].map((z) => cell(t, z));
    // 09:00 EDT Oct 19 / 06:00 PDT Oct 19 / 02:00 NZDT Oct 20
    expect(cells.map((c) => c.line1)).toEqual([
      'Oct 19, 9:00 AM',
      'Oct 19, 6:00 AM',
      'Oct 20, 2:00 AM',
    ]);
    expect(cells.map((c) => c.line2)).toEqual(['In 2 days', 'In 2 days', 'In 2 days']);
    // Overdue is the same moment for all: 5 hours past.
    const od = timed('2026-10-17T11:00:00Z');
    expect([NY, LA, AKL].map((z) => cell(od, z).line2)).toEqual([
      'Overdue 5h',
      'Overdue 5h',
      'Overdue 5h',
    ]);
  });

  it('a date-only task is judged in the viewer zone and may differ by a day', () => {
    const d = { dueDate: '2026-10-18' };
    expect(cell(d, NY).line2).toBe('Tomorrow');
    expect(cell(d, LA).line2).toBe('Tomorrow');
    expect(cell(d, AKL).line2).toBe('Due today');
  });

  it('survives a DST day and the midnight boundary', () => {
    // Spring forward in New York (Mar 8 2026): the 24 h day is 23 h long.
    const before = utc('2026-03-08T04:59:00Z'); // 11:59 PM EST Mar 7
    expect(cell({ dueDate: '2026-03-08' }, NY, undefined, before).line2).toBe('Tomorrow');
    expect(cell({ dueDate: '2026-03-09' }, NY, undefined, before).line2).toBe('In 2 days');
    expect(cell({ dueDate: '2026-03-08' }, NY, undefined, utc('2026-03-08T05:00:00Z')).line2).toBe(
      'Due today',
    );
    // Midnight: date-only due is today until 04:00Z, overdue from then.
    const d = { dueDate: '2026-10-28' };
    expect(cell(d, NY, undefined, utc('2026-10-29T03:59:59Z')).line2).toBe('Due today');
    expect(cell(d, NY, undefined, utc('2026-10-29T04:00:00Z')).line2).toBe('Overdue 1d');
  });

  it('every task the Dashboard Due soon tile counts has a line 2', () => {
    for (let n = 0; n <= 2; n++) {
      const day = `2026-10-${17 + n}`;
      expect(cell({ dueDate: day }).line2).not.toBe('');
      expect(cell({ dueDate: day }).daysUntil).toBe(n);
    }
  });
});

describe('dueCellText', () => {
  it('is the one-line wording of the inline cell: ASAP, date, or date and relative text', () => {
    const now = utc('2026-10-14T12:00:00Z');
    expect(dueCellText(describeDueCell(null, now, NY))).toBe('ASAP');
    expect(dueCellText(describeDueCell({ dueDate: '2026-10-12' }, now, NY))).toBe(
      'Oct 12 · Overdue 2d',
    );
    expect(dueCellText(describeDueCell({ dueDate: '2026-10-16' }, now, NY))).toBe(
      'Oct 16 · In 2 days',
    );
    expect(dueCellText(describeDueCell({ dueDate: '2026-11-20' }, now, NY))).toBe('Nov 20');
  });
});
