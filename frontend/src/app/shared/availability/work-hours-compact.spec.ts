import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DayHours, defaultWeek } from '../../core/availability/availability-edit';
import { settle } from '../testing/org-testing';
import { WorkHoursCompact } from './work-hours-compact';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WorkHoursCompact],
  template: `<mf-work-hours-compact [(week)]="week" />`,
})
class Host {
  readonly week = signal<DayHours[]>(defaultWeek());
}

describe('WorkHoursCompact (#534)', () => {
  async function create() {
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement, host: fixture.componentInstance };
  }
  afterEach(() => TestBed.resetTestingModule());

  it('seven toggles named by the full day, pressed for the working days, and one pair of times', async () => {
    const { el } = await create();
    const toggles = [...el.querySelectorAll<HTMLButtonElement>('[data-day-toggle]')];
    expect(toggles.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(toggles.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'true',
      'true',
      'true',
      'true',
      'false',
      'false',
    ]);
    expect(el.querySelectorAll('input[type=time]')).toHaveLength(2);
    expect(el.querySelectorAll('button, input')).toHaveLength(9);
  });

  it('a day switched on takes the pair; switched off keeps the others', async () => {
    const { fixture, el, host } = await create();
    const start = el.querySelector<HTMLInputElement>('#av-hours-start')!;
    start.value = '08:00';
    start.dispatchEvent(new Event('input'));
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-day-toggle="6"]')!.click();
    el.querySelector<HTMLButtonElement>('[data-day-toggle="1"]')!.click();
    await settle(fixture);
    const w = host.week();
    expect(w[5]).toMatchObject({ working: true, start: '08:00', end: '17:00' });
    expect(w[0].working).toBe(false);
    expect(w[1]).toMatchObject({ working: true, start: '08:00' });
  });

  it('with no working day it says so and keeps the pair', async () => {
    const { fixture, el, host } = await create();
    host.week.update((w) => w.map((d) => ({ ...d, working: false })));
    await settle(fixture);
    expect(el.querySelector('[data-no-days]')).not.toBeNull();
    expect(el.querySelector<HTMLInputElement>('#av-hours-start')!.value).toBe('09:00');
  });
});
