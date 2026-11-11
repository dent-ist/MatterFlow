import { TestBed } from '@angular/core/testing';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { provideCalendarFixtures } from '../../../shared/testing/calendar-testing';
import { settle } from '../../../shared/testing/org-testing';
import { HOLIDAY_API } from './holiday-api';
import { FixtureHolidayApi } from './holiday-fixtures';
import { UserCalendarField } from './user-calendar-field';

/** The Holiday Calendar field of the user drawer for a person who manages users (#1362): the picker lists the calendars; the preview of next holidays needs Settings.Manage. */
describe('UserCalendarField', () => {
  async function create(...permissions: Permission[]) {
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: USER_TIME_ZONE, useValue: 'America/New_York' },
        { provide: Clock, useValue: { now: () => new Date('2026-11-03T15:42:00Z') } },
        ...provideCalendarFixtures(),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const api = TestBed.inject(HOLIDAY_API) as FixtureHolidayApi;
    const calendars = vi.spyOn(api, 'calendars');
    const preview = vi.spyOn(api, 'preview');
    const fixture = TestBed.createComponent(UserCalendarField);
    fixture.componentRef.setInput('userId', 3);
    fixture.componentRef.setInput('canManage', true);
    await settle(fixture);
    await settle(fixture);
    return { fixture, calendars, preview, api };
  }
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  afterEach(() => TestBed.resetTestingModule());

  it('shows the picker with the calendars to a person with User.Manage only, and asks for no preview', async () => {
    const { fixture, calendars, preview } = await create('User.View', 'User.Manage');
    const el: HTMLElement = fixture.nativeElement;
    expect(calendars).toHaveBeenCalledTimes(1);
    expect(preview).not.toHaveBeenCalled();
    expect(el.querySelector('[data-user-calendar-select]')).not.toBeNull();
    expect(text(el.querySelector('[data-user-calendar-select]'))).not.toBe('');
    expect(el.querySelector('[data-next-holidays]')).toBeNull();
    // The label is never alone: the help line is there too.
    expect(text(el.querySelector('.uc__h'))).toContain('One calendar per person');
  });

  it('adds the next holidays for a person who also holds Settings.Manage', async () => {
    const { fixture, preview } = await create('User.View', 'User.Manage', 'Settings.Manage');
    expect(preview).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-next-holidays]')).not.toBeNull();
  });

  it('keeps the picker when the preview fails', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions('User.Manage', 'Settings.Manage'))),
        { provide: USER_TIME_ZONE, useValue: 'America/New_York' },
        { provide: Clock, useValue: { now: () => new Date('2026-11-03T15:42:00Z') } },
        ...provideCalendarFixtures(),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    vi.spyOn(TestBed.inject(HOLIDAY_API) as FixtureHolidayApi, 'preview').mockRejectedValue(
      new Error('403'),
    );
    const fixture = TestBed.createComponent(UserCalendarField);
    fixture.componentRef.setInput('userId', 3);
    fixture.componentRef.setInput('canManage', true);
    await settle(fixture);
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[data-user-calendar-select]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-next-holidays]')).toBeNull();
  });
});
