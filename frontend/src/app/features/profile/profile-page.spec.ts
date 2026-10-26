import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MyAvailabilityClient, UserAvailabilityClient } from '../../api/generated/api-client';
import { FakeMeApi, profileOf, provideFakeMe } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { MeProfile } from '../../core/auth/me.models';
import { MyAvailability } from '../../core/availability/my-availability';
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
      'Availability',
    );
    expect(root.querySelector('mf-account-card')).not.toBeNull();
    expect(root.querySelectorAll('h1').length).toBe(1);
  });

  it('the header names the person, gives roles and primary Pod, the chip and ONE primary action (P11)', async () => {
    const { root } = await create();
    expect(text(root, 'h1')).toContain('Kim Admin');
    expect(root.querySelector('h1 [data-availability-chip]')?.textContent).toContain('Available');
    expect(text(root, '[data-page-description]')).toBe('Data Technician, Pod Lead \u00b7 Main Pod');
    const actions = root.querySelectorAll('[data-page-actions] button');
    expect(actions.length).toBe(1);
    expect(actions[0].textContent).toContain('Set out of office...');
  });

  it('with no display name the header shows the Windows account', async () => {
    const { root } = await create({ me: { displayName: '' } });
    expect(text(root, 'h1')).toContain('KE\\kekim');
  });

  it("the primary action flips to the I'm back action while out of office", async () => {
    const { fixture, root } = await create();
    TestBed.inject(MyAvailability).set(
      dto({
        status: 'OUT_OF_OFFICE',
        rowVersion: 'V2',
        current: { state: 'OUT_OF_OFFICE' },
      }) as never,
    );
    await settle(fixture);
    expect(root.querySelector('[data-primary-action] button')?.textContent).toContain("I'm back");
    expect(root.querySelector('h1 [data-availability-chip]')?.textContent).toContain(
      'Out of office',
    );
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
    expect(text(root, 'h1')).toContain('Kim Admin');
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
