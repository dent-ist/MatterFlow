import { TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { MyAvailabilityClient, UserAvailabilityDto } from '../../api/generated/api-client';
import { MyAvailability } from '../../core/availability/my-availability';
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
        MessageService,
        { provide: MyAvailabilityClient, useValue: client },
        { provide: USER_TIME_ZONE, useValue: 'America/New_York' },
        { provide: Clock, useValue: { now: () => new Date('2026-10-15T14:00:00Z') } },
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

  afterEach(() => TestBed.resetTestingModule());

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
    await type(fixture, '#ooo-until', 'Oct 20, 2026');
    await type(fixture, '#ooo-note', 'Covering: Dana');
    q<HTMLButtonElement>('[data-ooo-confirm] button, button[data-ooo-confirm]').click();
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
    expect(TestBed.inject(MyAvailability).isOut()).toBe(true);
    expect(fixture.componentInstance.visible()).toBe(false);
  });
});
