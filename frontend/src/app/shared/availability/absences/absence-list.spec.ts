import { TestBed } from '@angular/core/testing';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { provideCalendarFixtures } from '../../testing/calendar-testing';
import { settle } from '../../testing/org-testing';
import { AbsenceList } from './absence-list';

describe('AbsenceList (Profile > Out of office)', () => {
  async function create(self = true) {
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions('Task.View'))),
        { provide: USER_TIME_ZONE, useValue: 'America/New_York' },
        { provide: Clock, useValue: { now: () => new Date('2026-11-03T15:42:00Z') } },
        ...provideCalendarFixtures(),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(AbsenceList);
    fixture.componentRef.setInput('userId', 5);
    fixture.componentRef.setInput('displayName', 'Dana');
    fixture.componentRef.setInput('self', self);
    await settle(fixture);
    await settle(fixture);
    return fixture;
  }
  const q = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const typeInto = async (f: { detectChanges(): void }, sel: string, value: string) => {
    const el = q<HTMLInputElement>(sel);
    el.value = value;
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('blur'));
    await new Promise((r) => setTimeout(r));
    f.detectChanges();
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-03T15:42:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('groups several entries (upcoming first, past collapsed) with type, dates, working days and note', async () => {
    const f = await create();
    const el = f.nativeElement as HTMLElement;
    const upcoming = Array.from(el.querySelectorAll('[data-group="upcoming"] [data-absence]'));
    expect(upcoming.length).toBe(2);
    expect(text(upcoming[0])).toContain('Vacation');
    expect(text(upcoming[0])).toContain('11/17 to 11/21');
    expect(text(upcoming[0])).toContain('4 working days');
    expect(text(upcoming[0])).toContain('Back on the 25th. Dana covers.');
    expect(text(upcoming[1])).toContain('Training');
    // Past entries sit behind a toggle and have no actions.
    expect(el.querySelector('[data-group="past"]')).toBeNull();
    (el.querySelector('[data-toggle-past]') as HTMLButtonElement).click();
    await settle(f);
    const past = el.querySelectorAll('[data-group="past"] [data-absence]');
    expect(past.length).toBe(2);
    expect(past[0].querySelector('[data-absence-edit]')).toBeNull();
    expect(past[0].querySelector('[data-absence-delete]')).toBeNull();
  });

  it('Add opens the dialog (Cancel on the left); an overlapping entry is refused naming the other one', async () => {
    const f = await create();
    (f.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-add-absence]')!
      .click();
    await settle(f);
    expect(q('[data-absence-dialog]')).not.toBeNull();
    const buttons = Array.from(document.querySelectorAll('.p-dialog-footer button')).map((b) =>
      text(b),
    );
    expect(buttons[0]).toBe('Cancel');
    expect(buttons[buttons.length - 1]).toBe('Add Out of Office');
    await typeInto(f, '#ad-start', '2026-11-18');
    await typeInto(f, '#ad-end', '2026-11-19');
    Array.from(document.querySelectorAll<HTMLButtonElement>('.p-dialog-footer button'))
      .pop()!
      .click();
    await settle(f);
    await settle(f);
    expect(text(q('[data-ad-overlap]'))).toContain(
      'overlap another entry: Vacation, 11/17 to 11/21',
    );
    expect(q('[data-absence-dialog]')).not.toBeNull();
  });

  it('a non-overlapping entry is added and the list shows it', async () => {
    const f = await create();
    (f.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-add-absence]')!
      .click();
    await settle(f);
    await typeInto(f, '#ad-start', '2026-12-07');
    await typeInto(f, '#ad-end', '2026-12-08');
    Array.from(document.querySelectorAll<HTMLButtonElement>('.p-dialog-footer button'))
      .pop()!
      .click();
    await settle(f);
    await settle(f);
    await settle(f);
    expect(
      (f.nativeElement as HTMLElement).querySelectorAll('[data-group="upcoming"] [data-absence]')
        .length,
    ).toBe(3);
  });

  it('refuses a first day in the past on the form (Sick may go back 14 days)', async () => {
    const f = await create();
    (f.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-add-absence]')!
      .click();
    await settle(f);
    await typeInto(f, '#ad-start', '2026-10-20');
    Array.from(document.querySelectorAll<HTMLButtonElement>('.p-dialog-footer button'))
      .pop()!
      .click();
    await settle(f);
    expect(text(q('[data-ad-start-error]'))).toContain('cannot be in the past');
  });

  it('Delete asks first and removes the entry', async () => {
    const f = await create();
    const el = f.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('[data-absence-delete]')!.click();
    await settle(f);
    expect(text(q('[data-confirm-body]'))).toContain('Vacation');
    Array.from(document.querySelectorAll<HTMLButtonElement>('.p-dialog-footer button'))
      .find((b) => text(b) === 'Delete Out of Office')!
      .click();
    await settle(f);
    await settle(f);
    await settle(f);
    expect(el.querySelectorAll('[data-group="upcoming"] [data-absence]').length).toBe(1);
  });
});
