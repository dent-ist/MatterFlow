import { TestBed } from '@angular/core/testing';
import { DashboardCapacity, DashboardUnassignedGauge } from '../../../api/generated/api-client';
import { DashCompact } from './dash-compact';

const capacity = (over: Partial<DashboardCapacity> = {}): DashboardCapacity =>
  ({
    state: 'NORMAL',
    workers: 4,
    slotsPerPerson: 3,
    freeSlots: 5,
    freePercent: 50,
    usedPercent: 50,
    overCapacityTasks: 0,
    unassignedWaiting: 8,
    countOffHours: true,
    assignedLastHour: 2,
    states: [
      { state: 'AVAILABLE', count: 2 },
      { state: 'BUSY', count: 2 },
    ],
    ...over,
  }) as DashboardCapacity;

const gauge = (over: Partial<DashboardUnassignedGauge> = {}): DashboardUnassignedGauge =>
  ({
    count: 7,
    level: 5,
    oldestAgeMinutes: 1085,
    ageBasis: 'CLOCK',
    ...over,
  }) as DashboardUnassignedGauge;

function make(c: DashboardCapacity | null, g: DashboardUnassignedGauge | null) {
  const fixture = TestBed.createComponent(DashCompact);
  fixture.componentRef.setInput('capacity', c);
  fixture.componentRef.setInput('gauge', g);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, q: (s: string) => el.querySelector<HTMLElement>(s) };
}
const words = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('DashCompact (the compact battery and gauge, #1233)', () => {
  it('draws the battery with the remaining percentage and "N free slots", and the red over count only above zero', () => {
    const { q } = make(capacity(), null);
    expect(words(q('[data-compact-battery-big]'))).toBe('50%');
    expect(q('[data-compact-battery-big] .pi-bolt')).not.toBeNull();
    expect(words(q('[data-compact-free]'))).toBe('5 free slots');
    expect(q('[data-compact-over]')).toBeNull();
    const over = make(capacity({ overCapacityTasks: 7 }), null);
    expect(words(over.q('[data-compact-over]'))).toBe('7 over');
  });

  it('keeps the neutral words of the full battery', () => {
    const { q } = make(capacity({ state: 'ALL_OUT' }), null);
    expect(words(q('[data-compact-battery-big]'))).toBe('Everyone out');
    expect(q('[data-compact-battery-big] .pi-bolt')).toBeNull();
    expect(words(make(capacity({ state: 'HOLIDAY' }), null).q('[data-compact-battery-big]'))).toBe(
      'Holiday',
    );
    expect(
      words(make(capacity({ state: 'NO_WORKERS' }), null).q('[data-compact-battery-big]')),
    ).toBe('No workers');
  });

  it('names the whole Team Capacity summary for assistive tools and the tooltip', () => {
    const { q } = make(capacity({ overCapacityTasks: 2 }), null);
    const label = q('[data-compact-battery]')!.getAttribute('aria-label')!;
    expect(label).toContain('Team Capacity');
    expect(label).toContain('Remaining capacity 50 percent');
    expect(label).toContain('2 tasks over capacity');
    expect(label).toContain('Available 2');
  });

  it('draws nothing for a widget whose data the person may not see', () => {
    const { q } = make(null, gauge());
    expect(q('[data-compact-battery]')).toBeNull();
    expect(q('[data-compact-gauge]')).not.toBeNull();
    const none = make(capacity(), null);
    expect(none.q('[data-compact-gauge]')).toBeNull();
  });

  it('draws the gauge with the level number, the level chip (icon and words) and the oldest wait; a click asks to show the unassigned tasks', () => {
    const { fixture, q } = make(null, gauge());
    expect(words(q('[data-compact-gauge-level]'))).toBe('5');
    expect(words(q('[data-compact-gauge-chip]'))).toBe('Level 5 · Critical');
    expect(q('[data-compact-gauge-chip] .pi-exclamation-triangle')).not.toBeNull();
    expect(words(q('[data-compact-gauge-age]'))).toBe('18 h 05 m');
    let shown = 0;
    fixture.componentInstance.show.subscribe(() => shown++);
    const button = q('button[data-compact-gauge]')!;
    expect(button.getAttribute('aria-label')).toContain('Show them, longest waiting first');
    button.click();
    expect(shown).toBe(1);
  });

  it('is not a button while nothing is unassigned (All clear)', () => {
    const { q } = make(null, gauge({ count: 0, level: 0, oldestAgeMinutes: 0 }));
    expect(q('button[data-compact-gauge]')).toBeNull();
    expect(q('[data-compact-gauge]')!.getAttribute('role')).toBe('img');
    expect(words(q('[data-compact-gauge-chip]'))).toBe('All clear');
    expect(q('[data-compact-gauge-age]')).toBeNull();
  });

  it('speaks politely only when the level changes, never on a refresh that keeps it', () => {
    const { fixture, q } = make(null, gauge({ level: 2 }));
    expect(words(q('[data-compact-gauge-live]'))).toBe('');
    fixture.componentRef.setInput('gauge', gauge({ level: 2, count: 9 }));
    fixture.detectChanges();
    expect(words(q('[data-compact-gauge-live]'))).toBe('');
    fixture.componentRef.setInput('gauge', gauge({ level: 3 }));
    fixture.detectChanges();
    expect(words(q('[data-compact-gauge-live]'))).toContain('level is now 3');
  });
});
