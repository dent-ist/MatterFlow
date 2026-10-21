import { availabilityDisplay, outOfOfficeText } from './availability';
import {
  defaultWeek,
  isDefaultWeek,
  outOfOfficeSummary,
  presetUntil,
  previewDisplay,
  timeZoneList,
  validateRange,
  validateWeek,
  weekFromServer,
  workHoursForSave,
} from './availability-edit';

const NY = 'America/New_York';

describe('availability', () => {
  describe('outOfOfficeText / availabilityDisplay', () => {
    it('names the last day out of office, one minute before the instant the absence ends', () => {
      // Until Oct 20 in New York ends at the start of Oct 21 (04:00 UTC).
      const text = outOfOfficeText(
        { state: 'OUT_OF_OFFICE', outUntil: '2026-10-21T04:00:00Z' },
        NY,
        new Date('2026-10-15T12:00:00Z'),
      );
      expect(text).toBe('Out of office until Oct 20');
    });

    it('adds the year when it is not this year, and says plain "Out of office" when open-ended', () => {
      expect(
        outOfOfficeText(
          { state: 'OUT_OF_OFFICE', outUntil: '2027-01-03T05:00:00Z' },
          NY,
          new Date('2026-10-15T12:00:00Z'),
        ),
      ).toBe('Out of office until Jan 2, 2027');
      expect(outOfOfficeText({ state: 'OUT_OF_OFFICE' }, NY)).toBe('Out of office');
      expect(outOfOfficeText({ state: 'AVAILABLE' }, NY)).toBeNull();
    });

    it('has an icon, a tone and text for every state; a missing state reads as Available', () => {
      expect(availabilityDisplay({ state: 'AVAILABLE' }, NY)).toMatchObject({
        label: 'Available',
        tone: 'success',
      });
      expect(availabilityDisplay({ state: 'OFF_HOURS' }, NY)).toMatchObject({
        label: 'Off hours',
        tone: 'neutral',
        icon: 'pi-moon',
      });
      expect(availabilityDisplay({ state: 'OUT_OF_OFFICE' }, NY)).toMatchObject({
        label: 'Out of office',
        tone: 'warning',
      });
      expect(availabilityDisplay(undefined, NY).label).toBe('Available');
    });
  });

  describe('outOfOfficeSummary', () => {
    const today = { year: 2026, month: 10, day: 15 };

    it('says when the person shows as out of office and when they are available again', () => {
      expect(outOfOfficeSummary('2026-10-16', '2026-10-20', { today })).toBe(
        'You will show as out of office from Oct 16 until Oct 20 and as available again on Oct 21.',
      );
    });

    it('rolls over month and year ends', () => {
      expect(outOfOfficeSummary(null, '2026-12-31', { today })).toBe(
        'You will show as out of office from now until Dec 31 and as available again on Jan 1, 2027.',
      );
    });

    it('handles open-ended absences, for yourself and for someone else', () => {
      expect(outOfOfficeSummary('2026-10-16', null, { today })).toBe(
        'You will show as out of office from Oct 16, until you set yourself available again.',
      );
      expect(outOfOfficeSummary(null, null, { self: false, name: 'Dana Director', today })).toBe(
        'Dana Director will show as out of office from now, until they are set available again.',
      );
    });
  });

  describe('validation', () => {
    it('rejects an Until before From and a note over 200 characters', () => {
      expect(validateRange('2026-10-20', '2026-10-16', '').until).toBe(
        'Until must be on or after From.',
      );
      expect(validateRange('2026-10-16', '2026-10-16', '')).toEqual({});
      expect(validateRange(null, null, 'x'.repeat(201)).note).toContain('200');
    });

    it('needs an end time after the start time on every working day', () => {
      const week = defaultWeek();
      week[1] = { ...week[1], start: '10:00', end: '09:00' };
      week[2] = { ...week[2], start: '', end: '17:00' };
      week[5] = { ...week[5], working: false, start: '12:00', end: '11:00' };
      const problems = validateWeek(week);
      expect(problems[2]).toBe('Tuesday: the end time must be after the start time.');
      expect(problems[3]).toBe('Wednesday: enter a start and an end time.');
      expect(problems[6]).toBeUndefined(); // a day off is not checked
      expect(Object.keys(problems)).toHaveLength(2);
    });
  });

  describe('work hours', () => {
    it('treats the untouched grid as the default schedule (null) and an empty one as no working days', () => {
      expect(isDefaultWeek(defaultWeek())).toBe(true);
      expect(workHoursForSave(defaultWeek())).toBeNull();
      const none = defaultWeek().map((d) => ({ ...d, working: false }));
      expect(workHoursForSave(none)).toEqual([]);
    });

    it('sends only the working days of a changed schedule', () => {
      const week = defaultWeek();
      week[0] = { ...week[0], start: '08:30' };
      week[4] = { ...week[4], working: false };
      expect(workHoursForSave(week)).toEqual([
        { dayOfWeek: 1, start: '08:30', end: '17:00' },
        { dayOfWeek: 2, start: '09:00', end: '17:00' },
        { dayOfWeek: 3, start: '09:00', end: '17:00' },
        { dayOfWeek: 4, start: '09:00', end: '17:00' },
      ]);
    });

    it('reads a saved schedule back into the grid', () => {
      const week = weekFromServer([{ dayOfWeek: 6, start: '10:00:00', end: '14:00' }]);
      expect(week.filter((d) => d.working).map((d) => d.day)).toEqual([6]);
      expect(week[5]).toMatchObject({ start: '10:00', end: '14:00' });
      expect(weekFromServer([]).some((d) => d.working)).toBe(false);
    });
  });

  describe('previewDisplay', () => {
    const base = { from: null, until: null, timeZone: NY, week: defaultWeek() };

    it('is out of office on every day of the range, in the person zone', () => {
      // Oct 15, 2026 10:00 in New York.
      const now = new Date('2026-10-15T14:00:00Z');
      expect(
        previewDisplay({ ...base, status: 'OUT_OF_OFFICE', until: '2026-10-20' }, now)?.label,
      ).toBe('Out of office until Oct 20');
      expect(
        previewDisplay(
          { ...base, status: 'OUT_OF_OFFICE', from: '2026-10-16', until: '2026-10-20' },
          now,
        )?.label,
      ).toBe('Available'); // starts tomorrow
      expect(
        previewDisplay({ ...base, status: 'OUT_OF_OFFICE', until: '2026-10-14' }, now)?.label,
      ).toBe('Available'); // already over
    });

    it('is available inside work hours (end exclusive) and off hours outside them', () => {
      const draft = { ...base, status: 'AVAILABLE' };
      expect(previewDisplay(draft, new Date('2026-10-15T14:00:00Z'))?.label).toBe('Available');
      expect(previewDisplay(draft, new Date('2026-10-15T21:00:00Z'))?.label).toBe('Off hours'); // 17:00
      expect(previewDisplay(draft, new Date('2026-10-17T15:00:00Z'))?.label).toBe('Off hours'); // Saturday
    });

    it('gives nothing for a time zone the browser does not know', () => {
      expect(
        previewDisplay({ ...base, status: 'AVAILABLE', timeZone: 'Nope/Nowhere' }, new Date()),
      ).toBeNull();
    });
  });

  it('lists the browser time zones and always includes the extra ones', () => {
    const zones = timeZoneList('Mars/Olympus', null);
    expect(zones).toContain('Mars/Olympus');
    expect(zones.length).toBeGreaterThan(50);
    expect(zones).toContain('America/New_York');
  });

  describe('presetUntil (Set out of office quick choices)', () => {
    const day = (iso: string) => {
      const [year, month, d] = iso.split('-').map(Number);
      return { year, month, day: d };
    };
    const all = (iso: string) =>
      (['today', 'tomorrow', 'monday', 'week'] as const).map((id) => presetUntil(id, day(iso)));

    it('counts from a Friday: Until Monday is three days on', () => {
      // 2026-10-16 is a Friday.
      expect(all('2026-10-16')).toEqual(['2026-10-16', '2026-10-17', '2026-10-19', '2026-10-23']);
    });

    it('Saturday and Sunday both reach the very next Monday', () => {
      expect(presetUntil('monday', day('2026-10-17'))).toBe('2026-10-19');
      expect(presetUntil('monday', day('2026-10-18'))).toBe('2026-10-19');
    });

    it('on a Monday, Until Monday means the following Monday (the next one after today)', () => {
      expect(presetUntil('monday', day('2026-10-19'))).toBe('2026-10-26');
    });

    it('crosses the end of a month and the end of a year', () => {
      expect(all('2026-10-31')).toEqual(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-07']);
      expect(all('2026-12-31')).toEqual(['2026-12-31', '2027-01-01', '2027-01-04', '2027-01-07']);
    });

    it('is plain calendar arithmetic on the change-of-clocks days (fall back Nov 1, spring forward Mar 8 2026)', () => {
      expect(all('2026-11-01')).toEqual(['2026-11-01', '2026-11-02', '2026-11-02', '2026-11-08']);
      expect(all('2026-03-08')).toEqual(['2026-03-08', '2026-03-09', '2026-03-09', '2026-03-15']);
    });

    it('handles a leap day', () => {
      expect(presetUntil('week', day('2028-02-25'))).toBe('2028-03-03');
    });
  });
});
