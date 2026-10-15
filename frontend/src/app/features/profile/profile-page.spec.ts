import { TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { provideRouter } from '@angular/router';
import { MyAvailabilityClient, UserAvailabilityClient } from '../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { iconForPath } from '../../shared/layout/section-icons';
import { ok, settle } from '../../shared/testing/org-testing';
import { PROFILE_ROUTES } from './profile.routes';
import { ProfilePage } from './profile-page';

describe('ProfilePage', () => {
  async function create() {
    const dto = {
      userId: 1,
      status: 'AVAILABLE',
      timeZoneId: 'America/New_York',
      effectiveTimeZoneId: 'America/New_York',
      usesDefaultWorkHours: true,
      workHours: [],
      current: { state: 'AVAILABLE' },
      rowVersion: 'NEW',
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions('Task.View'))),
        { provide: MyAvailabilityClient, useValue: { getMyAvailability: () => ok(dto) } },
        { provide: UserAvailabilityClient, useValue: {} },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(ProfilePage);
    await settle(fixture);
    return fixture;
  }

  it('has the page title, a section icon for the page header and the form', async () => {
    const fixture = await create();
    const root = fixture.nativeElement as HTMLElement;
    expect(PROFILE_ROUTES[0].title).toBe('My profile');
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('My profile');
    expect(iconForPath('/profile')).toBe('pi pi-user-edit');
    expect(root.querySelector('mf-availability-form fieldset legend')?.textContent).toBe('Status');
  });

  it('asks before leaving with unsaved edits, and not otherwise', async () => {
    const fixture = await create();
    const root = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    const start = root.querySelector<HTMLInputElement>('#av-day-1-start')!;
    start.value = '08:00';
    start.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    expect(PROFILE_ROUTES[0].canDeactivate?.length).toBe(1);
  });
});
