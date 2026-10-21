import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MyAvailabilityClient, UserAvailabilityDto } from '../../api/generated/api-client';
import { MyAvailability } from '../../core/availability/my-availability';
import { NotificationService } from '../../core/notify/notification.service';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { ok, settle } from '../testing/org-testing';
import { SetOutOfOfficeDialog } from './set-out-of-office-dialog';

const dto = (overrides: Partial<UserAvailabilityDto> = {}): UserAvailabilityDto => ({
  userId: 1,
  status: 'AVAILABLE',
  from: undefined,
  until: undefined,
  note: undefined,
  timeZoneId: 'America/New_York',
  effectiveTimeZoneId: 'America/New_York',
  usesDefaultWorkHours: false,
  workHours: [{ dayOfWeek: 1, start: '08:00', end: '12:00' }],
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

/** "Today" for the dialog and for the browser's clock: Oct 15, 2026, 10:00 in New York. */
const NOW = new Date('2026-10-15T14:00:00Z');

describe('SetOutOfOfficeDialog', () => {
  async function open() {
    const client = {
      getMyAvailability: vi.fn().mockReturnValue(ok(dto())),
      saveMyAvailability: vi.fn().mockReturnValue(
        ok(
          dto({
            status: 'OUT_OF_OFFICE',
            until: '2026-10-20',
            rowVersion: 'V2',
            current: {
              state: 'OUT_OF_OFFICE',
              outUntilUtc: '2026-10-21T04:00:00Z',
              note: 'Covering: Dana',
              nextWorkStartUtc: undefined,
            },
          }),
        ),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'profile', children: [] }]),
        { provide: MyAvailabilityClient, useValue: client },
        { provide: USER_TIME_ZONE, useValue: 'America/New_York' },
        { provide: Clock, useValue: { now: () => NOW } },
      ],
    });
    const fixture = TestBed.createComponent(SetOutOfOfficeDialog);
    fixture.componentRef.setInput('visible', true);
    await settle(fixture);
    return { fixture, client };
  }

  const q = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
  async function type(fixture: { detectChanges(): void }, selector: string, value: string) {
    const input = q<HTMLInputElement>(selector);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }

  // The dialog's "today" is the injected Clock; the browser's own clock is pinned to the same instant too, so nothing else it touches (the date
  // input, the overlay) can depend on the real date (the spec's Until date, Oct 20, 2026, is in the past from Oct 21 on). Only Date is faked,
  // so the timers the helpers await still run.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('asks only for an until date and a note, with the summary sentence', async () => {
    const { fixture } = await open();
    expect(q('[data-ooo-summary]').textContent).toContain(
      'You will show as out of office from now, until you set yourself available again.',
    );
    await type(fixture, '#ooo-until', 'Oct 20, 2026');
    expect(q('[data-ooo-summary]').textContent).toContain(
      'until Oct 20 and as available again on Oct 21',
    );
  });

  it('refuses an Until date in the past', async () => {
    const { fixture } = await open();
    await type(fixture, '#ooo-until', 'Oct 10, 2026');
    expect(q('[data-until-error]').textContent).toContain('on or after');
    expect(
      q<HTMLButtonElement>('[data-ooo-confirm] button, button[data-ooo-confirm]').disabled,
    ).toBe(true);
  });

  it('saves out of office from now, keeping the work hours and time zone', async () => {
    const { fixture, client } = await open();
    const success = vi.spyOn(TestBed.inject(NotificationService), 'success');
    await type(fixture, '#ooo-until', 'Oct 20, 2026');
    await type(fixture, '#ooo-note', 'Covering: Dana');
    q<HTMLButtonElement>('[data-ooo-confirm] button, button[data-ooo-confirm]').click();
    // The first save loads the API client module with a dynamic import (MyAvailability.client), which a fixed number of timer ticks does not
    // always outlast on a busy machine: wait for the call instead of for a moment.
    await vi.waitFor(() => expect(client.saveMyAvailability).toHaveBeenCalled());
    await settle(fixture);

    expect(client.saveMyAvailability).toHaveBeenCalledWith({
      status: 'OUT_OF_OFFICE',
      from: undefined,
      until: '2026-10-20',
      note: 'Covering: Dana',
      timeZoneId: 'America/New_York',
      workHours: [{ dayOfWeek: 1, start: '08:00', end: '12:00' }],
      rowVersion: 'V1',
    });
    await vi.waitFor(() => expect(fixture.componentInstance.visible()).toBe(false));
    expect(TestBed.inject(MyAvailability).isOut()).toBe(true);
    // #525: the toast carries the shared availability key, so "I'm back" replaces it.
    expect(success).toHaveBeenCalledWith('You are out of office', expect.any(String), {
      key: 'availability',
    });
  });

  it('opens again, with empty fields, after it closed itself (Esc, Cancel, the X): the header menu item must not go dead (UXR5-15)', async () => {
    const { fixture } = await open();
    await type(fixture, '#ooo-until', 'Oct 20, 2026');
    await type(fixture, '#ooo-note', 'Back soon');
    // The dialog closes by writing its own `visible` model, which is what ComponentRef.setInput('visible', true) cannot undo.
    fixture.componentInstance.visible.set(false);
    await settle(fixture);
    expect(document.querySelector('[data-ooo-dialog]')).toBeNull();

    fixture.componentInstance.open();
    await settle(fixture);

    expect(fixture.componentInstance.visible()).toBe(true);
    expect(q<HTMLInputElement>('#ooo-until').value).toBe('');
    expect(q<HTMLTextAreaElement>('#ooo-note').value).toBe('');
  });

  describe('quick choices and focus (#538, #539)', () => {
    const chip = (id: string) => q<HTMLButtonElement>(`[data-preset="${id}"]`);

    it('each chip fills Until, is pressed while it matches, and the sentence names the return day', async () => {
      const { fixture } = await open();
      // Oct 15, 2026 is a Thursday.
      const cases: [string, string, string][] = [
        ['today', '2026-10-15', 'until Oct 15 and as available again on Oct 16'],
        ['tomorrow', '2026-10-16', 'until Oct 16 and as available again on Oct 17'],
        ['monday', '2026-10-19', 'until Oct 19 and as available again on Oct 20'],
        ['week', '2026-10-22', 'until Oct 22 and as available again on Oct 23'],
      ];
      for (const [id, iso, sentence] of cases) {
        chip(id).click();
        await settle(fixture);
        expect(fixture.componentInstance['until']()).toBe(iso);
        expect(chip(id).getAttribute('aria-pressed')).toBe('true');
        expect(q('[data-ooo-summary]').textContent).toContain(sentence);
        for (const other of cases.filter((c) => c[0] !== id)) {
          expect(chip(other[0]).getAttribute('aria-pressed')).toBe('false');
        }
      }
    });

    it('typing a date clears the pressed chip; Pick a date focuses the date field and presses nothing', async () => {
      const { fixture } = await open();
      chip('tomorrow').click();
      await settle(fixture);
      await type(fixture, '#ooo-until', 'Oct 20, 2026');
      expect(chip('tomorrow').getAttribute('aria-pressed')).toBe('false');
      expect(q('[data-ooo-summary]').textContent).toContain('until Oct 20');

      chip('pick').click();
      await settle(fixture);
      expect(document.activeElement).toBe(q('#ooo-until'));
      expect(chip('pick').getAttribute('aria-pressed')).toBeNull();
    });

    it('saves the chosen date, and the chips are a labelled group of real buttons', async () => {
      const { fixture, client } = await open();
      const group = q('[data-ooo-presets]');
      expect(group.getAttribute('role')).toBe('group');
      expect(group.getAttribute('aria-labelledby')).toBe('ooo-until-label');
      expect([...group.querySelectorAll('button')].map((b) => b.textContent!.trim())).toEqual([
        'Rest of today',
        'Until tomorrow',
        'Until Monday',
        '1 week',
        'Pick a date',
      ]);
      chip('monday').click();
      await settle(fixture);
      q<HTMLButtonElement>('[data-ooo-confirm] button, button[data-ooo-confirm]').click();
      await vi.waitFor(() => expect(client.saveMyAvailability).toHaveBeenCalled());
      expect(client.saveMyAvailability).toHaveBeenCalledWith(
        expect.objectContaining({ until: '2026-10-19' }),
      );
    });

    it('computes the days in the profile time zone, not the browser zone', async () => {
      const { fixture } = await open();
      // 2026-10-15T14:00Z is already Oct 16 in Auckland.
      TestBed.inject(MyAvailability).set(
        dto({ timeZoneId: 'Pacific/Auckland', effectiveTimeZoneId: 'Pacific/Auckland' }),
      );
      await settle(fixture);
      chip('today').click();
      await settle(fixture);
      expect(fixture.componentInstance['until']()).toBe('2026-10-16');
    });

    it('opens on the heading, not on the date field, and has the link to My profile', async () => {
      await open();
      await new Promise((r) => setTimeout(r, 50));
      const title = q('.p-dialog-title');
      expect(document.activeElement).toBe(title);
      expect(title.getAttribute('tabindex')).toBe('-1');
      expect(document.activeElement).not.toBe(q('#ooo-until'));
      expect(q('[data-ooo-more]').getAttribute('href')).toBe('/profile');
      expect(q('[data-ooo-more]').textContent).toContain('More options on My profile');
    });

    it('the link closes the dialog', async () => {
      const { fixture } = await open();
      q<HTMLAnchorElement>('[data-ooo-more]').click();
      await settle(fixture);
      expect(fixture.componentInstance.visible()).toBe(false);
    });
  });
});
