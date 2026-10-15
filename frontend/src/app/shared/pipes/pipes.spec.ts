import { TestBed } from '@angular/core/testing';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { DueLabelPipe, DueStatePipe } from './due-label.pipe';
import { MfDatePipe } from './mf-date.pipe';
import { MatterRefPipe, normalizeNumber } from './matter-ref.pipe';

describe('normalizeNumber / matterRef', () => {
  const pipe = new MatterRefPipe();

  it('pads 1-5 digit numbers to five digits', () => {
    expect(normalizeNumber('343')).toBe('00343');
    expect(normalizeNumber(12)).toBe('00012');
    expect(normalizeNumber('00343')).toBe('00343');
    expect(normalizeNumber('123456')).toBeNull();
    expect(normalizeNumber('12a')).toBeNull();
    expect(normalizeNumber(null)).toBeNull();
  });

  it('formats parts, strings and API refs as 00343-00012', () => {
    expect(pipe.transform({ clientNumber: '343', matterNumber: '12' })).toBe('00343-00012');
    expect(pipe.transform({ matterRef: '00343-00012' })).toBe('00343-00012');
    expect(pipe.transform('343-12')).toBe('00343-00012');
    expect(pipe.transform(343, 12)).toBe('00343-00012');
    expect(pipe.transform('00343', '00012')).toBe('00343-00012');
  });

  it('is safe on empty or malformed input', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
    expect(pipe.transform('')).toBe('');
    expect(pipe.transform('abc')).toBe('abc');
    expect(pipe.transform({ clientNumber: 'x', matterNumber: '1' })).toBe('');
  });
});

describe('dueLabel / dueState / mfDate pipes', () => {
  function setup(zone: string, nowIso: string) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: USER_TIME_ZONE, useValue: zone },
        { provide: Clock, useValue: { now: () => new Date(nowIso) } },
      ],
    });
    return TestBed.runInInjectionContext(() => ({
      due: new DueLabelPipe(),
      state: new DueStatePipe(),
      local: new MfDatePipe(),
    }));
  }

  it('shows ASAP when there is no due date', () => {
    const { due } = setup('America/Chicago', '2026-10-14T12:00:00Z');
    expect(due.transform(null)).toBe('ASAP');
    expect(due.transform({ dueDate: null, dueAtUtc: null })).toBe('ASAP');
  });

  it('renders a floating date unchanged regardless of zone', () => {
    const { due } = setup('Pacific/Auckland', '2026-10-14T12:00:00Z');
    expect(due.transform({ dueDate: '2026-10-28' })).toBe('Oct 28, 2026');
  });

  it('renders an instant in the viewer zone with abbreviation', () => {
    const { due } = setup('America/Chicago', '2026-10-14T12:00:00Z');
    expect(due.transform({ dueDate: '2026-10-28', dueAtUtc: '2026-10-28T20:00:00Z' })).toBe(
      'Oct 28, 2026, 3:00 PM CDT',
    );
  });

  it('computes Overdue in the viewer zone, not UTC', () => {
    // 02:00Z on Oct 29 is still Oct 28 in Chicago (9 PM): not overdue there, overdue in UTC.
    const chicago = setup('America/Chicago', '2026-10-29T02:00:00Z');
    expect(chicago.due.transform({ dueDate: '2026-10-28' })).toBe('Oct 28, 2026 · Due today');
    const utc = setup('UTC', '2026-10-29T02:00:00Z');
    expect(utc.due.transform({ dueDate: '2026-10-28' })).toBe('Oct 28, 2026 · Overdue 1d');
  });

  it('suppresses overdue for completed tasks and exposes state', () => {
    const { due, state } = setup('UTC', '2027-01-01T00:00:00Z');
    expect(due.transform({ dueDate: '2026-10-28' }, 'COMPLETED')).toBe('Oct 28, 2026');
    expect(state.transform({ dueDate: '2026-10-28' }, 'IN_PROGRESS').kind).toBe('overdue');
    expect(state.transform(null).tooltip).toBe('No due date set. Handle promptly.');
  });

  it('mfDate renders UTC timestamps in local time with the zone abbreviation', () => {
    const { local } = setup('America/Los_Angeles', '2026-10-14T12:00:00Z');
    expect(local.transform('2026-10-14T14:05:00Z')).toBe('Oct 14, 2026, 7:05 AM PDT');
    expect(local.transform('2026-10-14T14:05:00Z', 'date')).toBe('Oct 14, 2026');
    expect(local.transform(null)).toBe('');
    expect(local.transform('garbage')).toBe('');
  });

  it('mfDate shows a calendar date as Oct 12, 2026 in every zone and never shifts it', () => {
    for (const zone of ['Pacific/Auckland', 'America/Los_Angeles', 'UTC']) {
      const { local } = setup(zone, '2026-10-14T12:00:00Z');
      expect(local.transform('2026-10-12')).toBe('Oct 12, 2026');
      expect(local.transform('2026-10-12', 'datetime')).toBe('Oct 12, 2026');
    }
    const { local } = setup('America/New_York', '2026-10-14T12:00:00Z');
    expect(local.transform('2026-02-30')).toBe('');
    expect(local.transform(new Date('2026-10-12T22:23:00-04:00'))).toBe(
      'Oct 12, 2026, 10:23 PM EDT',
    );
  });
});
