import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { MyAvailabilityClient, UserAvailabilityDto } from '../../api/generated/api-client';
import { FakeMeApi, profileOf, provideFakeMe } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { USER_TIME_ZONE } from '../../core/time/clock';
import { ok, settle } from '../testing/org-testing';
import { UserMenu } from './user-menu';

const dto = (overrides: Partial<UserAvailabilityDto> = {}): UserAvailabilityDto => ({
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
  rowVersion: 'V1',
  ...overrides,
});

describe('UserMenu (header user area)', () => {
  let client: {
    getMyAvailability: ReturnType<typeof vi.fn>;
    saveMyAvailability: ReturnType<typeof vi.fn>;
  };

  async function create(
    permissions: Permission[],
    current = dto(),
    who: { displayName?: string; windowsAccount?: string } = {},
  ) {
    client = {
      getMyAvailability: vi.fn().mockReturnValue(ok(current)),
      saveMyAvailability: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
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
    expect(items(fixture)).toEqual(['My profile', 'Set out of office...', 'Keyboard shortcuts']);
    expect(document.activeElement?.textContent).toContain('My profile');
  });

  it('moves with the arrow keys, wraps, and Escape closes and returns focus to the button', async () => {
    const fixture = await create(['Task.View']);
    const button = trigger(fixture);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await settle(fixture);
    const menu = fixture.nativeElement.querySelector('[role=menu]')!;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement?.textContent).toContain('Keyboard shortcuts');
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement?.textContent).toContain('My profile');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[role=menu]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('offers only Keyboard shortcuts to someone who cannot work Tasks (no availability API for them)', async () => {
    const fixture = await create([]);
    trigger(fixture).click();
    await settle(fixture);
    expect(items(fixture)).toEqual(['Keyboard shortcuts']);
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
      status: 'OUT_OF_OFFICE',
      current: {
        state: 'OUT_OF_OFFICE',
        outUntilUtc: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        note: undefined,
        nextWorkStartUtc: undefined,
      },
    });
    const fixture = await create(['Task.View'], out);
    expect(fixture.nativeElement.querySelector('[data-ooo-label]').textContent).toContain(
      'Out of office until',
    );
    expect(trigger(fixture).getAttribute('aria-label')).toContain('Out of office until');
    trigger(fixture).click();
    await settle(fixture);
    expect(items(fixture)).toEqual(['My profile', "I'm back", 'Keyboard shortcuts']);
  });

  it('"I\'m back" saves Available keeping the hours and zone, then the label goes away', async () => {
    const out = dto({
      status: 'OUT_OF_OFFICE',
      until: '2026-12-31',
      note: 'Away',
      current: {
        state: 'OUT_OF_OFFICE',
        outUntilUtc: '2027-01-01T05:00:00Z',
        note: 'Away',
        nextWorkStartUtc: undefined,
      },
    });
    const fixture = await create(['Task.View'], out);
    client.saveMyAvailability.mockReturnValue(ok(dto({ rowVersion: 'V2' })));
    trigger(fixture).click();
    await settle(fixture);
    fixture.nativeElement.querySelector('[data-menu-item=back]').click();
    await settle(fixture);

    expect(client.saveMyAvailability).toHaveBeenCalledWith({
      status: 'AVAILABLE',
      from: undefined,
      until: undefined,
      note: undefined,
      timeZoneId: 'America/New_York',
      workHours: undefined,
      rowVersion: 'V1',
    });
    expect(fixture.nativeElement.querySelector('[data-ooo-label]')).toBeNull();
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
