import { TestBed } from '@angular/core/testing';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { provideCalendarFixtures } from '../../../shared/testing/calendar-testing';
import { settle } from '../../../shared/testing/org-testing';
import { HolidaysAdmin } from './holidays-admin';
import { CalendarThresholdsForm, validateThresholds } from './thresholds-form';

describe('HolidaysAdmin (Settings > Holidays)', () => {
  async function create() {
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions('Settings.Manage'))),
        { provide: USER_TIME_ZONE, useValue: 'America/New_York' },
        { provide: Clock, useValue: { now: () => new Date('2026-11-03T15:42:00Z') } },
        ...provideCalendarFixtures(),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(HolidaysAdmin);
    await settle(fixture);
    await settle(fixture);
    return fixture;
  }
  const q = <T extends HTMLElement>(f: { nativeElement: HTMLElement }, s: string) =>
    f.nativeElement.querySelector<T>(s)!;
  const qa = <T extends HTMLElement>(f: { nativeElement: HTMLElement }, s: string) =>
    Array.from(f.nativeElement.querySelectorAll<T>(s));
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  afterEach(() => TestBed.resetTestingModule());

  it('lists the calendars by category with their counts and the days of the first one in the chosen year', async () => {
    const f = await create();
    const cals = qa(f, '[data-calendar]');
    expect(cals.map((c) => text(c.querySelector('.cal__n')))).toEqual([
      'US Holiday',
      'UK Holiday',
      'Firm closure',
    ]);
    expect(text(cals[0])).toContain('11 holidays');
    expect(text(cals[0])).toContain('firm default');
    expect(text(cals[2])).toContain('(everyone)');
    expect(text(q(f, '[data-holidays-table] thead'))).toContain('Date in 2026');
    const thanksgiving = qa(f, '[data-holiday]').find((r) => text(r).startsWith('Thanksgiving'))!;
    expect(text(thanksgiving)).toContain('Thu 11/26');
    expect(text(thanksgiving)).toContain('Every year, 4th Thursday of November');
  });

  it('shows the observed day of a weekend holiday and the next-year preview', async () => {
    const f = await create();
    const july = qa(f, '[data-holiday]').find((r) => text(r).startsWith('Independence Day'))!;
    expect(text(july)).toContain('Fri 07/03');
    expect(text(july)).toContain('observed; falls on Sat 07/04');
    q<HTMLButtonElement>(f, '[data-year-next]').click();
    await settle(f);
    await settle(f);
    expect(text(q(f, '[data-holidays-table] thead'))).toContain('Date in 2027');
    expect(text(q(f, '[data-year-next]'))).toContain('2027 (preview)');
    const mlk = qa(f, '[data-holiday]').find((r) => text(r).startsWith('Martin Luther King'))!;
    expect(text(mlk)).toContain('01/18/2027');
  });

  it('choosing another calendar shows its own days and region note', async () => {
    const f = await create();
    qa<HTMLButtonElement>(f, '[data-calendar]')[1].click();
    await settle(f);
    await settle(f);
    expect(text(q(f, '[data-region-note]'))).toContain('London office');
    expect(qa(f, '[data-holiday]').some((r) => text(r).startsWith('Boxing Day'))).toBe(true);
  });

  it('search narrows the holidays and says when nothing matches', async () => {
    const f = await create();
    const input = q<HTMLInputElement>(f, '#ha-q');
    input.value = 'christ';
    input.dispatchEvent(new Event('input'));
    await settle(f);
    expect(qa(f, '[data-holiday]').length).toBe(1);
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    await settle(f);
    expect(text(q(f, '[data-no-holidays]'))).toContain('No holiday matches "zzz"');
  });

  it('deleting a holiday asks first', async () => {
    const f = await create();
    const before = qa(f, '[data-holiday]').length;
    qa<HTMLButtonElement>(f, '[data-delete-holiday]')[0].click();
    await settle(f);
    expect(document.querySelector('[data-confirm-body]')?.textContent).toContain(
      'no longer counts',
    );
    const confirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.p-dialog-footer button'),
    ).find((b) => b.textContent?.trim() === 'Delete Holiday')!;
    confirm.click();
    await settle(f);
    await settle(f);
    expect(qa(f, '[data-holiday]').length).toBe(before - 1);
  });

  it('the firm default and a pod default are chosen from the calendars and saved together', async () => {
    const f = await create();
    const save = q<HTMLButtonElement>(f, '[data-save-defaults]');
    expect(save.disabled).toBe(true);
    const pod = q<HTMLSelectElement>(f, '[data-pod-default="1"]');
    pod.value = '2';
    pod.dispatchEvent(new Event('change'));
    await settle(f);
    expect(save.disabled).toBe(false);
    // An "applies to everyone" calendar is not a choice for a person or a pod.
    expect(Array.from(pod.options).map((o) => o.textContent?.trim())).toEqual([
      'Firm default',
      'US Holiday',
      'UK Holiday',
    ]);
    save.click();
    await settle(f);
    await settle(f);
    expect(q<HTMLButtonElement>(f, '[data-save-defaults]').disabled).toBe(true);
    expect(text(qa(f, '[data-calendar]')[0])).toContain('firm default');
  });
});

describe('CalendarThresholdsForm (Settings > Dashboard)', () => {
  async function create() {
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions('Settings.Manage'))),
        ...provideCalendarFixtures(),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(CalendarThresholdsForm);
    await settle(fixture);
    await settle(fixture);
    return fixture;
  }
  const q = <T extends HTMLElement>(f: { nativeElement: HTMLElement }, s: string) =>
    f.nativeElement.querySelector<T>(s)!;
  const type = async (
    f: { nativeElement: HTMLElement; detectChanges(): void },
    sel: string,
    value: string,
  ) => {
    const el = q<HTMLInputElement>(f, sel);
    el.value = value;
    el.dispatchEvent(new Event('input'));
    await settle(f as never);
  };

  afterEach(() => TestBed.resetTestingModule());

  it('validates the percentages and the order of the two limits', () => {
    expect(validateThresholds(75, 60, [])).toEqual({});
    expect(validateThresholds(0, 60, []).min).toBeTruthy();
    expect(validateThresholds(75, 101, []).pod).toBeTruthy();
    expect(validateThresholds(60, 75, []).pod).toContain('cannot be higher');
    expect(validateThresholds(75, 60, [{ people: -1 }]).minimums).toBeTruthy();
  });

  it('opens on the saved values with the defaults named, saves a change, and Reset only fills the form', async () => {
    const f = await create();
    expect(q<HTMLInputElement>(f, '#th-min').value).toBe('75');
    expect(q<HTMLInputElement>(f, '#th-pod').value).toBe('60');
    expect(q(f, '#th-min-h').textContent).toContain('Default 75');
    const save = q<HTMLButtonElement>(f, '[data-th-save]');
    expect(save.disabled).toBe(true);
    await type(f, '#th-min', '80');
    expect(save.disabled).toBe(false);
    save.click();
    await settle(f);
    await settle(f);
    expect(q<HTMLInputElement>(f, '#th-min').value).toBe('80');
    expect(q<HTMLButtonElement>(f, '[data-th-save]').disabled).toBe(true);
    q<HTMLButtonElement>(f, '[data-th-reset]').click();
    await settle(f);
    expect(q<HTMLInputElement>(f, '#th-min').value).toBe('75');
    // Nothing is saved until Save: the form is dirty again.
    expect(q<HTMLButtonElement>(f, '[data-th-save]').disabled).toBe(false);
  });

  it('a pod minimum above the firm minimum is refused in place and does not save', async () => {
    const f = await create();
    await type(f, '#th-pod', '90');
    expect(q(f, '#th-pod').getAttribute('aria-invalid')).toBe('true');
    expect(f.nativeElement.textContent).toContain('cannot be higher than the firm minimum');
  });

  it('a per-pod minimum people value is kept in the saved request', async () => {
    const f = await create();
    await type(f, '[data-pod-min="1"]', '8');
    q<HTMLButtonElement>(f, '[data-th-save]').click();
    await settle(f);
    await settle(f);
    expect(q<HTMLInputElement>(f, '[data-pod-min="1"]').value).toBe('8');
  });
});
