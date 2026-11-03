import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DashboardUnassignedGauge } from '../../../api/generated/api-client';
import { DashGauge } from './dash-gauge';

const gauge = (over: Partial<DashboardUnassignedGauge> = {}): DashboardUnassignedGauge => ({
  count: 7,
  oldestSinceUtc: '2026-11-03T12:00:00Z',
  oldestAgeMinutes: 168,
  ageBasis: 'WORKING',
  level: 3,
  asOfUtc: '2026-11-03T15:00:00Z',
  ...over,
});

describe('DashGauge (DB-06)', () => {
  let fixture: ComponentFixture<DashGauge>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = (sel: string) => el().querySelector(sel)?.textContent?.trim();

  function create(g: DashboardUnassignedGauge = gauge(), reduced = false) {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: reduced && q.includes('prefers-reduced-motion'),
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    fixture = TestBed.createComponent(DashGauge);
    window.matchMedia = original;
    fixture.componentRef.setInput('gauge', g);
    fixture.detectChanges();
  }

  it.each([0, 1, 2, 3, 4, 5])('renders level %i with its word, badge and needle', (level) => {
    create(gauge({ level }));
    const words = ['Normal', 'Warning', 'Elevated', 'High', 'Severe', 'Critical'];
    expect(text('[data-gauge-badge]')).toBe(
      level === 0 ? 'Normal' : `Level ${level} · ${words[level]}`,
    );
    const needle = el().querySelector('.needle') as SVGElement;
    expect(needle.style.transform).toBe(`rotate(${level * 30 + 15}deg)`);
    expect(el().querySelector('[data-gauge]')?.getAttribute('data-level')).toBe(String(level));
    expect(text('[data-gauge-do]')?.length).toBeGreaterThan(10);
  });

  it('shows the count, the age with its basis, and a button that shows them longest waiting first', () => {
    create();
    expect(text('[data-gauge-count]')).toBe('7');
    expect(text('[data-gauge-age]')).toBe('2 h 48 m');
    expect(el().textContent).toContain('oldest, working hours');
    let shown = 0;
    fixture.componentInstance.show.subscribe(() => shown++);
    (el().querySelector('[data-gauge-go]') as HTMLButtonElement).click();
    (el().querySelector('[data-gauge-visual]') as HTMLButtonElement).click();
    expect(shown).toBe(2);
  });

  it('says All clear calmly, with no button, when nothing is unassigned', () => {
    create(gauge({ count: 0, oldestSinceUtc: undefined, oldestAgeMinutes: 0, level: 0 }));
    expect(text('[data-gauge-badge]')).toBe('All clear');
    expect(el().querySelector('[data-gauge-go]')).toBeNull();
    expect(text('[data-gauge-do]')).toBe('Nothing is waiting for an owner.');
  });

  it('announces politely once per level change and not on a refresh that keeps the level', () => {
    create(gauge({ level: 2 }));
    expect(text('[data-gauge-live]')).toBe('');
    fixture.componentRef.setInput('gauge', gauge({ level: 2, count: 9 }));
    fixture.detectChanges();
    expect(text('[data-gauge-live]')).toBe('');
    fixture.componentRef.setInput('gauge', gauge({ level: 3 }));
    fixture.detectChanges();
    expect(text('[data-gauge-live]')).toBe(
      'Unassigned wait level is now 3 of 5, High. 7 unassigned tasks.',
    );
    expect(el().querySelector('[data-gauge-live]')?.getAttribute('aria-live')).toBe('polite');
  });

  it('pulses at level 4 and 5, but not under reduced motion', () => {
    create(gauge({ level: 4 }));
    expect(el().querySelector('.lvl')?.classList.contains('pulse')).toBe(true);
    create(gauge({ level: 5 }), true);
    expect(el().querySelector('.lvl')?.classList.contains('pulse')).toBe(false);
    create(gauge({ level: 1 }));
    expect(el().querySelector('.lvl')?.classList.contains('pulse')).toBe(false);
  });
});
