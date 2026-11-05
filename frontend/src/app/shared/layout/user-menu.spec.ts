import { NotificationService } from '../../core/notify/notification.service';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ABSENCE_API } from '../availability/absences/absence-api';
import { MyAvailabilityClient, UserAvailabilityDto } from '../../api/generated/api-client';
import { FakeMeApi, profileOf, provideFakeMe } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { USER_TIME_ZONE } from '../../core/time/clock';
import { ok, settle } from '../testing/org-testing';
import { UserMenu } from './user-menu';

const dto = (overrides: Partial<UserAvailabilityDto> = {}): UserAvailabilityDto => ({
  userId: 1,
  absences: [],
  holidayCalendar: undefined,
  nextHolidays: [],
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
  rowVersion: 'V1',
  ...overrides,
});

describe('UserMenu (header user area)', () => {
  let client: {
    getMyAvailability: ReturnType<typeof vi.fn>;
    saveMyAvailability: ReturnType<typeof vi.fn>;
  };
  // The Out of office entries (epic #1074): "I'm Back" ends the current one.
  let absences: { list: ReturnType<typeof vi.fn>; back: ReturnType<typeof vi.fn> };

  async function create(
    permissions: Permission[],
    current = dto(),
    who: { displayName?: string; windowsAccount?: string } = {},
  ) {
    client = {
      getMyAvailability: vi.fn().mockReturnValue(ok(current)),
      saveMyAvailability: vi.fn(),
    };
    absences = {
      list: vi.fn().mockResolvedValue([{ absenceId: 7, state: 'NOW' }]),
      back: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ABSENCE_API, useValue: absences },
        provideFakeMe(
          new FakeMeApi(
            profileOf({ displayName: 'Kim Admin', permissions, roles: ['Test'], ...who }),
          ),
        ),
        { provide: MyAvailabilityClient, useValue: client },
        { provide: USER_TIME_ZONE, useValue: 'America/New_York' },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(UserMenu);
    await settle(fixture);
    return fixture;
  }

  const trigger = (f: { nativeElement: HTMLElement }) =>
    f.nativeElement.querySelector<HTMLButtonElement>('.um-trigger')!;
  const items = (f: { nativeElement: HTMLElement }) =>
    Array.from(f.nativeElement.querySelectorAll<HTMLElement>('[role=menuitem]')).map((i) =>
      i.textContent!.trim(),
    );

  afterEach(() => TestBed.resetTestingModule());

  it('shows a name that differs from the account only by case once, and different names both (#592)', async () => {
    let fixture = await create(['Task.View'], dto(), {
      displayName: 'KE\\kekim',
      windowsAccount: 'ke\\kekim',
    });
    expect(fixture.nativeElement.querySelector('.um-account')).toBeNull();
    TestBed.resetTestingModule();
    fixture = await create(['Task.View'], dto(), {
      displayName: 'Kim Lee',
      windowsAccount: 'ke\\kekim',
    });
    expect(fixture.nativeElement.querySelector('.um-account').textContent.trim()).toBe('ke\\kekim');
  });

  it('carries the full name as tooltip and accessible name; the visible name is clamped by CSS (#592)', async () => {
    const long = 'A'.repeat(66);
    const fixture = await create(['Task.View'], dto(), { displayName: long });
    const button = trigger(fixture);
    expect(button.getAttribute('title')).toBe(long);
    expect(button.getAttribute('aria-label')).toContain(long);
  });

  it('is a menu button with the name; clicking opens My profile, Set out of office and Keyboard shortcuts', async () => {
    const fixture = await create(['Task.View']);
    const button = trigger(fixture);
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent).toContain('Kim Admin');

    button.click();
    await settle(fixture);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(items(fixture)).toEqual(['My Profile', 'Set Out of Office', 'Keyboard Shortcuts']);
    expect(document.activeElement?.textContent).toContain('My Profile');
  });

  it('moves with the arrow keys, wraps, and Escape closes and returns focus to the button', async () => {
    const fixture = await create(['Task.View']);
    const button = trigger(fixture);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await settle(fixture);
    const menu = fixture.nativeElement.querySelector('[role=menu]')!;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement?.textContent).toContain('Keyboard Shortcuts');
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement?.textContent).toContain('My Profile');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[role=menu]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('offers only Keyboard shortcuts to someone who cannot work Tasks (no availability API for them)', async () => {
    const fixture = await create([]);
    trigger(fixture).click();
    await settle(fixture);
    expect(items(fixture)).toEqual(['Keyboard Shortcuts']);
    expect(client.getMyAvailability).not.toHaveBeenCalled();
  });

  it('My profile navigates to /profile', async () => {
    const fixture = await create(['Task.View']);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    trigger(fixture).click();
    await settle(fixture);
    fixture.nativeElement.querySelector('[data-menu-item=profile]').click();
    expect(navigate).toHaveBeenCalledWith(['/profile']);
  });

  it('shows an out-of-office label next to the name and "I\'m back" instead of "Set out of office"', async () => {
    const out = dto({
      current: {
        state: 'OUT_OF_OFFICE',
        outUntilUtc: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        note: undefined,
        nextWorkStartUtc: undefined,
      },
    });
    const fixture = await create(['Task.View'], out);
    expect(fixture.nativeElement.querySelector('[data-ooo-label]').textContent).toContain(
      ' Out of Office until Nov 8 ',
    );
    expect(trigger(fixture).getAttribute('aria-label')).toContain('Out of Office until');
    trigger(fixture).click();
    await settle(fixture);
    expect(items(fixture)).toEqual(['My Profile', "I'm Back", 'Keyboard Shortcuts']);
  });

  describe('identity row and phone dot (#580, #578)', () => {
    const outDto = () =>
      dto({
        current: {
          state: 'OUT_OF_OFFICE',
          outUntilUtc: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          note: undefined,
          nextWorkStartUtc: undefined,
        },
      });

    it('starts with a non-interactive identity row: name, account when it adds information, the chip', async () => {
      const fixture = await create(['Task.View'], dto(), { windowsAccount: 'KE\\kekim' });
      trigger(fixture).click();
      await settle(fixture);
      const el = fixture.nativeElement as HTMLElement;
      const row = el.querySelector<HTMLElement>('[data-menu-identity]')!;
      expect(row.querySelector('.um-id__name')!.textContent).toBe('Kim Admin');
      expect(row.querySelector('.um-id__account')!.textContent).toBe('KE\\kekim');
      expect(row.querySelector('[data-availability-chip]')).not.toBeNull();
      expect(row.querySelector('button, a, [tabindex], [role=menuitem]')).toBeNull();
      // Outside the menuitems, read as the menu's description; the arrows never reach it.
      const menu = el.querySelector('[role=menu]')!;
      expect(menu.contains(row)).toBe(false);
      expect(menu.getAttribute('aria-describedby')).toBe(row.id);
      expect(items(fixture)).toEqual(['My Profile', 'Set Out of Office', 'Keyboard Shortcuts']);
      expect(menu.querySelector('[role=separator]')).not.toBeNull();
    });

    it('says "Out of office until ..." in the row while out, and shows the account once when it equals the name', async () => {
      const fixture = await create(['Task.View'], outDto(), { windowsAccount: 'kim admin' });
      trigger(fixture).click();
      await settle(fixture);
      const row = fixture.nativeElement.querySelector('[data-menu-identity]')!;
      expect(row.querySelector('[data-availability-chip]')!.textContent).toContain(
        'Out of Office until Nov 8',
      );
      expect(row.querySelector('.um-id__account')).toBeNull();
    });

    it('a person without Task.View gets the name only, and no chip', async () => {
      const fixture = await create([]);
      trigger(fixture).click();
      await settle(fixture);
      const row = fixture.nativeElement.querySelector('[data-menu-identity]')!;
      expect(row.querySelector('[data-availability-chip]')).toBeNull();
      expect(items(fixture)).toEqual(['Keyboard Shortcuts']);
      expect(fixture.nativeElement.querySelector('[role=separator]')).toBeNull();
    });

    it('the dot sits on the icon only while out of office, with a tooltip; the trigger name says so', async () => {
      const out = await create(['Task.View'], outDto());
      const dot = out.nativeElement.querySelector('[data-ooo-dot]');
      expect(dot?.getAttribute('title')).toBe('Out of Office');
      expect(trigger(out).getAttribute('aria-label')).toContain('Out of Office until');
      TestBed.resetTestingModule();
      const here = await create(['Task.View']);
      expect(here.nativeElement.querySelector('[data-ooo-dot]')).toBeNull();
    });
  });

  it('"I\'m back" ends the current entry, then the label goes away', async () => {
    const out = dto({
      current: {
        state: 'OUT_OF_OFFICE',
        outUntilUtc: '2027-01-01T05:00:00Z',
        note: 'Away',
        nextWorkStartUtc: undefined,
      },
    });
    const fixture = await create(['Task.View'], out);
    // After the entry ended the header reads the profile again: Available.
    client.getMyAvailability.mockReturnValue(ok(dto({ rowVersion: 'V2' })));
    const success = vi.spyOn(TestBed.inject(NotificationService), 'success');
    trigger(fixture).click();
    await settle(fixture);
    fixture.nativeElement.querySelector('[data-menu-item=back]').click();
    await settle(fixture);

    // The first call loads the Out of office module with a dynamic import: wait for the call.
    await vi.waitFor(() => expect(absences.back).toHaveBeenCalledWith(expect.any(Number), 7));
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[data-ooo-label]')).toBeNull();
    // #525: the toast carries the shared availability key, so a later one replaces it.
    expect(success).toHaveBeenCalledWith('Welcome back', expect.any(String), {
      key: 'availability',
    });
  });

  it('Keyboard shortcuts asks the shell to open the list', async () => {
    const fixture = await create(['Task.View']);
    let asked = 0;
    fixture.componentInstance.shortcuts.subscribe(() => asked++);
    trigger(fixture).click();
    await settle(fixture);
    fixture.nativeElement.querySelector('[data-menu-item=shortcuts]').click();
    expect(asked).toBe(1);
  });
});
