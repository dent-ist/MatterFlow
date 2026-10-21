import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MyAvailabilityClient,
  UserAvailabilityClient,
  UserAvailabilityDto,
} from '../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { MyAvailability } from '../../core/availability/my-availability';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { apiError, ok, settle } from '../testing/org-testing';
import { AvailabilityForm } from './availability-form';

const profile = (overrides: Partial<UserAvailabilityDto> = {}): UserAvailabilityDto => ({
  userId: 1,
  status: 'AVAILABLE',
  from: undefined,
  until: undefined,
  note: undefined,
  timeZoneId: 'America/New_York',
  effectiveTimeZoneId: 'America/New_York',
  usesDefaultWorkHours: true,
  workHours: [],
  current: {
    state: 'AVAILABLE',
    outUntilUtc: undefined,
    note: undefined,
    nextWorkStartUtc: undefined,
  },
  updatedAtUtc: undefined,
  updatedByUserId: undefined,
  rowVersion: 'NEW',
  ...overrides,
});

describe('AvailabilityForm', () => {
  let fixture: ComponentFixture<AvailabilityForm>;
  let mine: {
    getMyAvailability: ReturnType<typeof vi.fn>;
    saveMyAvailability: ReturnType<typeof vi.fn>;
  };
  let others: {
    getUserAvailability: ReturnType<typeof vi.fn>;
    saveUserAvailability: ReturnType<typeof vi.fn>;
  };
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;
  const saveButton = (): HTMLButtonElement => q<HTMLButtonElement>('[data-save] button');

  async function create(options: { userId?: number; initial?: UserAvailabilityDto } = {}) {
    mine = {
      getMyAvailability: vi.fn().mockReturnValue(ok(options.initial ?? profile())),
      saveMyAvailability: vi.fn(),
    };
    others = {
      getUserAvailability: vi.fn().mockReturnValue(ok(options.initial ?? profile({ userId: 9 }))),
      saveUserAvailability: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions('Task.View', 'User.Manage'))),
        { provide: MyAvailabilityClient, useValue: mine },
        { provide: UserAvailabilityClient, useValue: others },
        { provide: USER_TIME_ZONE, useValue: 'America/New_York' },
        { provide: Clock, useValue: { now: () => new Date('2026-10-15T14:00:00Z') } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(AvailabilityForm);
    if (options.userId !== undefined) {
      fixture.componentRef.setInput('userId', options.userId);
      fixture.componentRef.setInput('displayName', 'Dana Director');
    }
    await settle(fixture);
  }

  async function choose(selector: string): Promise<void> {
    q<HTMLInputElement>(selector).click();
    await settle(fixture);
  }

  async function type(selector: string, value: string): Promise<void> {
    const input = q<HTMLInputElement>(selector);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await settle(fixture);
  }

  const save = async (): Promise<void> => {
    saveButton().click();
    await settle(fixture);
  };

  afterEach(() => TestBed.resetTestingModule());

  it('opens on Available with the default Mon-Fri 9-5 week and the saved time zone, nothing to save yet', async () => {
    await create();
    expect(q<HTMLInputElement>('[data-status-available]').checked).toBe(true);
    expect(el().querySelector('[data-ooo-fields]')).toBeNull();
    expect(q<HTMLInputElement>('#av-day-1').checked).toBe(true);
    expect(q<HTMLInputElement>('#av-day-6').checked).toBe(false);
    expect(q<HTMLInputElement>('#av-day-1-start').value).toBe('09:00');
    expect(q<HTMLInputElement>('#av-tz').value).toBe('America/New_York');
    expect(saveButton().disabled).toBe(true);
  });

  it('preselects the browser time zone for a person who never chose one', async () => {
    await create({ initial: profile({ timeZoneId: undefined, effectiveTimeZoneId: 'UTC' }) });
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(q<HTMLInputElement>('#av-tz').value).toBe(browser);
  });

  it('shows the dates, note and the summary sentence for Out of office', async () => {
    await create();
    await choose('[data-status-ooo]');
    expect(q('[data-ooo-summary]').textContent).toContain(
      'You will show as out of office from now, until you set yourself available again.',
    );

    await type('#av-from', 'Oct 16, 2026');
    await type('#av-until', 'Oct 20, 2026');
    expect(q('[data-ooo-summary]').textContent!.trim()).toBe(
      'You will show as out of office from Oct 16 until Oct 20 and as available again on Oct 21.',
    );
  });

  it('writes one date-format hint under the From and Until pair, not one under each field (#428)', async () => {
    await create();
    await choose('[data-status-ooo]');
    expect(el().querySelectorAll('.di__hint').length).toBe(0);
    const help = q('[data-dates-help]');
    expect(help.textContent).toContain('Type a date such as Oct 12, 2026');
    expect(q('#av-from').getAttribute('aria-describedby')).toBe(help.id);
    expect(q('#av-until').getAttribute('aria-describedby')).toBe(help.id);
  });

  it('counts the note against 200 characters', async () => {
    await create();
    await choose('[data-status-ooo]');
    await type('#av-note', 'Back soon');
    expect(q('[data-note-count]').textContent!.replace(/\s+/g, ' ').trim()).toBe('9 / 200');
    expect(q('#av-note').getAttribute('maxlength')).toBe('200');
  });

  it('blocks saving with an error summary when Until is before From', async () => {
    await create();
    await choose('[data-status-ooo]');
    await type('#av-from', 'Oct 20, 2026');
    await type('#av-until', 'Oct 16, 2026');
    expect(q('[data-until-error]').textContent).toContain('Until must be on or after From.');

    await save();
    expect(mine.saveMyAvailability).not.toHaveBeenCalled();
    expect(q('[data-summary]').textContent).toContain('Until must be on or after From.');
  });

  it('validates the work hours per day, live', async () => {
    await create();
    await type('#av-day-2-end', '08:00');
    expect(q('[data-day-error]').textContent).toContain(
      'Tuesday: the end time must be after the start time.',
    );
    await type('#av-day-2-end', '17:00');
    expect(el().querySelector('[data-day-error]')).toBeNull();
  });

  it('copies Monday to all weekdays and resets to the default', async () => {
    await create();
    await type('#av-day-1-start', '08:00');
    await type('#av-day-1-end', '16:00');
    q<HTMLButtonElement>('[data-copy-weekdays] button').click();
    await settle(fixture);
    for (const day of [2, 3, 4, 5]) {
      expect(q<HTMLInputElement>(`#av-day-${day}-start`).value).toBe('08:00');
      expect(q<HTMLInputElement>(`#av-day-${day}-end`).value).toBe('16:00');
    }
    expect(el().querySelector('#av-day-6-start')).toBeNull(); // the weekend is untouched
    q<HTMLButtonElement>('[data-reset-hours] button').click();
    await settle(fixture);
    expect(q<HTMLInputElement>('#av-day-3-start').value).toBe('09:00');
  });

  it('rejects a time zone that is not in the list', async () => {
    await create();
    await type('#av-tz', 'Mars/Olympus');
    expect(q('[data-tz-error]').textContent).toContain('is not a time zone we know');
    await save();
    expect(mine.saveMyAvailability).not.toHaveBeenCalled();
  });

  it('saves out of office with dates, note, zone and the default hours as null, then shows the saved state', async () => {
    await create();
    const saved = profile({
      status: 'OUT_OF_OFFICE',
      from: '2026-10-16',
      until: '2026-10-20',
      note: 'Back Oct 21',
      rowVersion: 'V1',
    });
    mine.saveMyAvailability.mockReturnValue(ok(saved));
    const emitted: UserAvailabilityDto[] = [];
    fixture.componentInstance.saved.subscribe((d) => emitted.push(d));

    await choose('[data-status-ooo]');
    await type('#av-from', 'Oct 16, 2026');
    await type('#av-until', 'Oct 20, 2026');
    await type('#av-note', 'Back Oct 21');
    await save();

    expect(mine.saveMyAvailability).toHaveBeenCalledWith({
      status: 'OUT_OF_OFFICE',
      from: '2026-10-16',
      until: '2026-10-20',
      note: 'Back Oct 21',
      timeZoneId: 'America/New_York',
      workHours: undefined,
      rowVersion: 'NEW',
    });
    expect(emitted).toEqual([saved]);
    expect(TestBed.inject(MyAvailability).profile()).toEqual(saved);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('sends only the working days of an edited schedule', async () => {
    await create();
    mine.saveMyAvailability.mockReturnValue(ok(profile({ rowVersion: 'V1' })));
    await type('#av-day-1-start', '08:30');
    await save();
    expect(mine.saveMyAvailability.mock.calls[0][0].workHours).toEqual([
      { dayOfWeek: 1, start: '08:30', end: '17:00' },
      { dayOfWeek: 2, start: '09:00', end: '17:00' },
      { dayOfWeek: 3, start: '09:00', end: '17:00' },
      { dayOfWeek: 4, start: '09:00', end: '17:00' },
      { dayOfWeek: 5, start: '09:00', end: '17:00' },
    ]);
  });

  it('tracks unsaved changes, and discarding puts the saved values back', async () => {
    await create();
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    await type('#av-day-1-start', '08:30');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    const discard = Array.from(el().querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent!.trim() === 'Discard changes',
    )!;
    discard.click();
    await settle(fixture);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    expect(q<HTMLInputElement>('#av-day-1-start').value).toBe('09:00');
  });

  it('on a rowVersion conflict reloads the latest values and says nothing was saved', async () => {
    await create();
    mine.saveMyAvailability.mockReturnValue(
      apiError(409, { code: 'CONCURRENCY_CONFLICT', status: 409, detail: 'changed' }),
    );
    await type('#av-day-1-start', '08:30');
    await save();
    expect(q('[data-conflict]').textContent).toContain('your edits were not saved');
    expect(mine.getMyAvailability).toHaveBeenCalledTimes(2);
    expect(q<HTMLInputElement>('#av-day-1-start').value).toBe('09:00');
  });

  it('maps server validation codes to the field and the summary', async () => {
    await create();
    mine.saveMyAvailability.mockReturnValue(
      apiError(400, { code: 'OOO_RANGE_INVALID', status: 400, detail: 'Until is before From.' }),
    );
    await choose('[data-status-ooo]');
    await type('#av-until', 'Oct 20, 2026');
    await save();
    expect(q('[data-until-error]').textContent).toContain('Until is before From.');
    expect(q('[data-summary]').textContent).toContain('Until is before From.');
  });

  it('edits someone else (admin): their name in the copy, the firm zone kept, saved through the user endpoint', async () => {
    await create({
      userId: 9,
      initial: profile({
        userId: 9,
        timeZoneId: undefined,
        effectiveTimeZoneId: 'America/Chicago',
      }),
    });
    expect(others.getUserAvailability).toHaveBeenCalledWith(9);
    expect(q('[data-preview]').textContent).toContain("Dana Director's current status");
    expect(q<HTMLInputElement>('#av-tz').value).toBe('America/Chicago');

    others.saveUserAvailability.mockReturnValue(ok(profile({ userId: 9, rowVersion: 'V1' })));
    await choose('[data-status-ooo]');
    expect(q('[data-ooo-summary]').textContent).toContain(
      'Dana Director will show as out of office from now, until they are set available again.',
    );
    await save();
    expect(others.saveUserAvailability).toHaveBeenCalledWith(
      9,
      expect.objectContaining({
        status: 'OUT_OF_OFFICE',
        timeZoneId: undefined,
        rowVersion: 'NEW',
      }),
    );
    expect(mine.saveMyAvailability).not.toHaveBeenCalled();
  });

  it('previews the current status: the server value when clean, the edited draft when dirty', async () => {
    await create();
    expect(q('[data-preview-chip]').textContent!.trim()).toBe('Available');
    await choose('[data-status-ooo]');
    await type('#av-until', 'Oct 20, 2026');
    expect(q('[data-preview-chip]').textContent!.trim()).toBe('Out of office until Oct 20');
  });
});
