import { provideCalendarFixtures } from '../../shared/testing/calendar-testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MyAvailabilityClient, UserAvailabilityClient } from '../../api/generated/api-client';
import { FakeMeApi, profileOf, provideFakeMe } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { MeProfile } from '../../core/auth/me.models';
import { iconForPath } from '../../shared/layout/section-icons';
import { apiError, ok, settle } from '../../shared/testing/org-testing';
import { PROFILE_ROUTES } from './profile.routes';
import { ProfilePage } from './profile-page';

const dto = (over: Record<string, unknown> = {}) => ({
  userId: 1,
  status: 'AVAILABLE',
  timeZoneId: 'America/New_York',
  effectiveTimeZoneId: 'America/New_York',
  usesDefaultWorkHours: true,
  workHours: [],
  current: { state: 'AVAILABLE' },
  rowVersion: 'NEW',
  ...over,
});

describe('ProfilePage', () => {
  async function create(options: { me?: Partial<MeProfile>; get?: ReturnType<typeof vi.fn> } = {}) {
    const get = options.get ?? vi.fn().mockReturnValue(ok(dto()));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(
          new FakeMeApi(
            profileOf({
              displayName: 'Kim Admin',
              windowsAccount: 'KE\\kekim',
              permissions: ['Task.View'],
              roles: ['Pod Lead', 'Data Technician'],
              pods: [
                { podId: 1, name: 'Alpha Pod', isActive: true, isPrimary: false },
                { podId: 2, name: 'Main Pod', isActive: true, isPrimary: true },
              ],
              ...options.me,
            }),
          ),
        ),
        { provide: MyAvailabilityClient, useValue: { getMyAvailability: get } },
        { provide: UserAvailabilityClient, useValue: {} },
        ...provideCalendarFixtures(),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(ProfilePage);
    await settle(fixture);
    return { fixture, root: fixture.nativeElement as HTMLElement, get };
  }
  const text = (root: HTMLElement, sel: string) =>
    root.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();

  afterEach(() => TestBed.resetTestingModule());

  it('has the page title, a section icon, the form and the Account card', async () => {
    const { root } = await create();
    expect(PROFILE_ROUTES[0].title).toBe('My profile');
    expect(iconForPath('/profile')).toBe('pi pi-user-edit');
    expect(root.querySelector('mf-availability-form fieldset legend')?.textContent).toContain(
      'Work hours',
    );
    expect(root.querySelector('mf-absence-list [data-absence-list]')).not.toBeNull();
    expect(root.querySelector('mf-account-card')).not.toBeNull();
    expect(root.querySelectorAll('h1').length).toBe(1);
  });

  it('the header names the person, gives roles and primary Pod and the chip (P11)', async () => {
    const { root } = await create();
    // The title is the page ("My profile"); the person's name, availability chip, roles and Pod are the context line under it (#1135).
    expect(text(root, 'h1')).toBe('My profile');
    expect(text(root, '[data-profile-who] [data-name]')).toBe('Kim Admin');
    expect(
      root.querySelector('[data-profile-who] [data-availability-chip]')?.textContent,
    ).toContain('Available');
    expect(text(root, '[data-profile-context]')).toBe('Data Technician, Pod Lead \u00b7 Main Pod');
    // The Out of office list has its own Add button; the header carries no action.
    expect(root.querySelectorAll('[data-page-actions] button').length).toBe(0);
  });

  it('with no display name the header shows the Windows account', async () => {
    const { root } = await create({ me: { displayName: '' } });
    expect(text(root, '[data-profile-who] [data-name]')).toBe('KE\\kekim');
  });

  it('lists the out of office entries (several, grouped) and the holiday card beside them', async () => {
    const { root } = await create();
    await new Promise((r) => setTimeout(r));
    expect(root.querySelectorAll('[data-absence]').length).toBeGreaterThanOrEqual(2);
    expect(root.querySelector('[data-group="upcoming"]')).not.toBeNull();
    expect(root.querySelector('[data-holiday-calendar]')?.textContent).toContain('US Holiday');
  });

  it('the Add button of the list opens the Add dialog', async () => {
    const { fixture, root } = await create();
    root.querySelector<HTMLButtonElement>('[data-add-absence]')!.click();
    await settle(fixture);
    expect(document.querySelector('[data-absence-dialog]')).not.toBeNull();
  });

  it('shows the skeleton while loading and the page when it is ready (P14)', async () => {
    let release!: (v: unknown) => void;
    const { of } = await import('rxjs');
    const { switchMap } = await import('rxjs/operators');
    const gate = new Promise((r) => (release = r));
    const get = vi.fn().mockReturnValue(of(0).pipe(switchMap(() => gate.then(() => dto()))));
    const { fixture, root } = await create({ get });
    expect(root.querySelector('[data-profile-skeleton]')).not.toBeNull();
    expect(root.querySelector('[data-profile-grid]')?.classList.contains('pp--off')).toBe(true);
    release(null);
    await settle(fixture);
    expect(root.querySelector('[data-profile-skeleton]')).toBeNull();
    expect(root.querySelector('[data-profile-grid]')?.classList.contains('pp--off')).toBe(false);
  });

  it('a failed load shows the shared record state with Retry; Retry restores the page and says Loaded (P14)', async () => {
    const get = vi
      .fn()
      .mockReturnValueOnce(apiError(500, { status: 500 }))
      .mockReturnValue(ok(dto()));
    const { fixture, root } = await create({ get });
    expect(root.querySelector('[data-record-state]')).not.toBeNull();
    expect(text(root, 'h1')).toBe('My profile');
    expect(text(root, '[data-page-description]')).toBe("Couldn't load this profile.");
    expect(root.querySelector('[data-primary-action]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-retry] button, button[data-retry]')!.click();
    await settle(fixture);
    expect(root.querySelector('[data-record-state]')).toBeNull();
    expect(text(root, '[data-page-live]')).toBe('Loaded');
    expect(text(root, '[data-profile-who] [data-name]')).toBe('Kim Admin');
  });

  it('asks before leaving with unsaved edits, and not otherwise', async () => {
    const { fixture, root } = await create();
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    const start = root.querySelector<HTMLInputElement>('#av-hours-start')!;
    start.value = '08:00';
    start.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    expect(PROFILE_ROUTES[0].canDeactivate?.length).toBe(1);
  });
});
