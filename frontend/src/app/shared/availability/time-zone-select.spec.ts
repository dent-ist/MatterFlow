import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Clock } from '../../core/time/clock';
import { settle } from '../testing/org-testing';
import { TimeZoneSelect } from './time-zone-select';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TimeZoneSelect],
  template: `<mf-time-zone-select [(value)]="zone" [zones]="zones" [saved]="saved()" />`,
})
class Host {
  readonly zone = signal('America/New_York');
  readonly saved = signal<string | null>(null);
  readonly zones = ['America/New_York', 'Asia/Tokyo', 'Europe/Berlin', 'UTC'];
}

describe('TimeZoneSelect (#540, #567)', () => {
  async function create(zone = 'America/New_York', saved: string | null = null) {
    TestBed.configureTestingModule({
      providers: [{ provide: Clock, useValue: { now: () => new Date('2026-10-15T13:41:00Z') } }],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.zone.set(zone);
    fixture.componentInstance.saved.set(saved);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, host: fixture.componentInstance };
  }
  const labels = (el: HTMLElement) =>
    [...el.querySelectorAll('option')].map((o) => o.textContent!.replace(/\s+/g, ' ').trim());

  afterEach(() => TestBed.resetTestingModule());

  it('lists the seven US zones with their IANA id, then Other zones...', async () => {
    const { el } = await create();
    const list = labels(el).filter((l) => !l.includes('browser'));
    expect(list).toEqual([
      'Eastern (America/New_York)',
      'Central (America/Chicago)',
      'Mountain (America/Denver)',
      'Pacific (America/Los_Angeles)',
      'Alaska (America/Anchorage)',
      'Hawaii (Pacific/Honolulu)',
      'Arizona (no daylight saving) (America/Phoenix)',
      'Other zones...',
    ]);
    expect(el.querySelector<HTMLSelectElement>('#av-tz')!.value).toBe('America/New_York');
    expect(el.querySelector('[data-tz-other]')).toBeNull();
  });

  it('a saved non-US zone is an extra first option and stays selected, never overwritten', async () => {
    const { el, host } = await create('Europe/Berlin', 'Europe/Berlin');
    expect(labels(el)[0]).toBe('Europe/Berlin (saved)');
    expect(el.querySelector<HTMLSelectElement>('#av-tz')!.value).toBe('Europe/Berlin');
    expect(host.zone()).toBe('Europe/Berlin');
  });

  it('Other zones... reveals the searchable list and a typed zone is the value', async () => {
    const { fixture, el, host } = await create();
    const select = el.querySelector<HTMLSelectElement>('#av-tz')!;
    select.value = '__other__';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
    const input = el.querySelector<HTMLInputElement>('[data-tz-other]')!;
    expect(input).not.toBeNull();
    expect(el.querySelectorAll('#av-tz-list option').length).toBe(4);
    input.value = 'Asia/Tokyo';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(host.zone()).toBe('Asia/Tokyo');
  });

  it('choosing a friendly zone sets it and announces the local time politely', async () => {
    const { fixture, el, host } = await create();
    const select = el.querySelector<HTMLSelectElement>('#av-tz')!;
    select.value = 'America/Chicago';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(host.zone()).toBe('America/Chicago');
    const live = el.querySelector('[data-tz-live]')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toContain('It is 8:41');
  });

  it('shows the local time there and the display-zone sentence', async () => {
    const { el } = await create('Asia/Tokyo');
    expect(el.querySelector('[data-tz-time]')!.textContent).toContain('It is 10:41 PM there now.');
    expect(el.querySelector('[data-tz-note]')!.textContent).toMatch(
      /Dates and times elsewhere in MatterFlow use your browser's time zone \(.+\)\./,
    );
    // The live region is not the clock: a tick is not announced.
    expect(el.querySelector('[data-tz-time]')!.getAttribute('aria-live')).toBeNull();
  });
});
