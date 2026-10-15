import {
  describeDue,
  formatDateOnly,
  formatInstant,
  parseDateOnly,
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

describe('describeDue', () => {
  it('shows ASAP, never overdue, when there is no due date', () => {
    const s = describeDue({ dueDate: null, dueAtUtc: null }, utc('2030-01-01T00:00:00Z'), NY);
    expect(s).toMatchObject({ kind: 'asap', label: 'ASAP', overdue: false });
    expect(describeDue(null, new Date(), NY).label).toBe('ASAP');
    expect(describeDue({}, new Date(), NY, 'NEW').overdue).toBe(false);
  });

  describe('date-only (floating) due dates', () => {
    const due = { dueDate: '2026-10-28' };

    it('is not overdue through 23:59:59 on the date in the viewer zone', () => {
      // 23:59:59 on Oct 28 in New York (EDT) = Oct 29 03:59:59Z
      const s = describeDue(due, utc('2026-10-29T03:59:59Z'), NY);
      expect(s.overdue).toBe(false);
      expect(s.kind).toBe('soon');
      expect(s.label).toBe('Oct 28, 2026 · Due today');
    });

    it('becomes overdue at local midnight', () => {
      const s = describeDue(due, utc('2026-10-29T04:00:00Z'), NY);
      expect(s.overdue).toBe(true);
      expect(s.label).toBe('Oct 28, 2026 · Overdue 1d');
    });

    it('two viewers near midnight may disagree (addendum M)', () => {
      const now = utc('2026-10-29T05:30:00Z'); // 1:30 AM Oct 29 in NY, 10:30 PM Oct 28 in LA
      expect(describeDue(due, now, NY).overdue).toBe(true);
      expect(describeDue(due, now, LA).overdue).toBe(false);
    });

    it('judges overdue correctly on the spring-forward day (23-hour day)', () => {
      const dst = { dueDate: '2026-03-08' };
      // End of Mar 8 in NY (EDT) = Mar 9 04:00Z
      expect(describeDue(dst, utc('2026-03-09T03:59:59Z'), NY).overdue).toBe(false);
      expect(describeDue(dst, utc('2026-03-09T04:00:00Z'), NY).overdue).toBe(true);
    });

    it('judges overdue correctly on the fall-back day (25-hour day)', () => {
      const dst = { dueDate: '2026-11-01' };
      // End of Nov 1 in NY (EST) = Nov 2 05:00Z
      expect(describeDue(dst, utc('2026-11-02T04:59:59Z'), NY).overdue).toBe(false);
      expect(describeDue(dst, utc('2026-11-02T05:00:00Z'), NY).overdue).toBe(true);
    });

    it('counts calendar days overdue', () => {
      const s = describeDue(due, utc('2026-11-02T12:00:00Z'), NY);
      expect(s.label).toBe('Oct 28, 2026 · Overdue 5d');
    });

    it('says "Due today", "Tomorrow" and then "Due soon", the words of the queues (UXR4-18)', () => {
      expect(describeDue(due, utc('2026-10-28T12:00:00Z'), NY).badge).toBe('Due today');
      expect(describeDue(due, utc('2026-10-27T12:00:00Z'), NY).label).toBe(
        'Oct 28, 2026 · Tomorrow',
      );
      expect(describeDue(due, utc('2026-10-26T12:00:00Z'), NY).badge).toBe('Due soon');
    });

    it('is "Due soon" within two days, plain beyond', () => {
      expect(describeDue(due, utc('2026-10-26T12:00:00Z'), NY).kind).toBe('soon');
      expect(describeDue(due, utc('2026-10-25T12:00:00Z'), NY)).toMatchObject({
        kind: 'future',
        label: 'Oct 28, 2026',
      });
    });
  });

  describe('timed (instant) due dates', () => {
    const due = { dueDate: '2026-10-28', dueAtUtc: '2026-10-28T20:00:00Z' };

    it('renders in the viewer zone with abbreviation', () => {
      expect(describeDue(due, utc('2026-10-01T00:00:00Z'), CHI).label).toBe(
        'Oct 28, 2026, 3:00 PM CDT',
      );
      expect(describeDue(due, utc('2026-10-01T00:00:00Z'), LA).label).toBe(
        'Oct 28, 2026, 1:00 PM PDT',
      );
    });

    it('is overdue the same for everyone once the instant passes', () => {
      const before = utc('2026-10-28T19:59:59Z');
      const after = utc('2026-10-28T20:00:01Z');
      for (const zone of [NY, CHI, LA]) {
        expect(describeDue(due, before, zone).overdue).toBe(false);
        expect(describeDue(due, after, zone).overdue).toBe(true);
      }
    });

    it('reports hours, then days overdue', () => {
      expect(describeDue(due, utc('2026-10-28T20:30:00Z'), NY).badge).toBe('Overdue <1h');
      expect(describeDue(due, utc('2026-10-28T23:00:00Z'), NY).badge).toBe('Overdue 3h');
      expect(describeDue(due, utc('2026-10-31T21:00:00Z'), NY).badge).toBe('Overdue 3d');
    });
  });

  it('shows closed tasks muted with no overdue styling', () => {
    const s = describeDue({ dueDate: '2026-01-01' }, utc('2026-10-28T00:00:00Z'), NY, 'COMPLETED');
    expect(s).toMatchObject({ kind: 'closed', overdue: false, label: 'Jan 1, 2026' });
    expect(describeDue({ dueDate: '2026-01-01' }, new Date(), NY, 'CANCELLED').overdue).toBe(false);
  });
});
