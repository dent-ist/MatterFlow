import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { emptyFilters } from '../../../shared/work-queue/queue-filters';
import {
  PodStripKey,
  PodWorkStrip,
  activePodStripKey,
  podStripPatch,
  withoutStripFilters,
} from './pod-work-strip';

const TODAY = '2026-10-14';

describe('the filters of the Pod Work strip items (#561)', () => {
  it('Overdue, ASAP and On hold are the filters My Work uses', () => {
    expect(podStripPatch('overdue', TODAY)).toEqual({ overdue: true });
    expect(podStripPatch('asap', TODAY)).toEqual({ asap: true });
    expect(podStripPatch('onHold', TODAY)).toEqual({ status: ['ON_HOLD'] });
  });

  it('Due today is today as the due range and not overdue', () => {
    expect(podStripPatch('dueToday', TODAY)).toEqual({
      dueFrom: TODAY,
      dueTo: TODAY,
      overdue: false,
    });
  });

  it('every item reads back as the pressed one, and no other filter does', () => {
    const keys: PodStripKey[] = ['overdue', 'dueToday', 'asap', 'onHold'];
    for (const key of keys) {
      const f = { ...emptyFilters(), ...podStripPatch(key, TODAY) };
      expect(activePodStripKey(f, TODAY)).toBe(key);
    }
    expect(activePodStripKey(emptyFilters(), TODAY)).toBeNull();
    expect(activePodStripKey({ ...emptyFilters(), q: 'x' }, TODAY)).toBeNull();
    // Due today of another day, or On hold with another status, is not the strip's.
    const other = { ...emptyFilters(), ...podStripPatch('dueToday', '2026-10-13') };
    expect(activePodStripKey(other, TODAY)).toBeNull();
    expect(activePodStripKey({ ...emptyFilters(), status: ['ON_HOLD', 'NEW'] }, TODAY)).toBeNull();
  });

  it('withoutStripFilters takes the strip filters out and keeps every other one', () => {
    const f = {
      ...emptyFilters(),
      q: 'lease',
      assignee: [4],
      ...podStripPatch('dueToday', TODAY),
    };
    const cleared = withoutStripFilters(f);
    expect(cleared).toMatchObject({
      q: 'lease',
      assignee: [4],
      overdue: null,
      asap: null,
      dueFrom: null,
      dueTo: null,
    });
    const hold = withoutStripFilters({ ...emptyFilters(), ...podStripPatch('onHold', TODAY) });
    expect(hold.status).toEqual([]);
    // A status choice of the person (not the On hold item's) stays.
    const status = withoutStripFilters({ ...emptyFilters(), status: ['NEW', 'IN_PROGRESS'] });
    expect(status.status).toEqual(['NEW', 'IN_PROGRESS']);
  });
});

@Component({
  imports: [PodWorkStrip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-pod-work-strip
    [summary]="summary()"
    [active]="active()"
    (pick)="picked.push($event)"
  />`,
})
class Host {
  readonly summary = signal<{
    unassignedToPerson: number;
    assigned: number;
    overdue: number;
    onHold: number;
    dueToday: number;
    asap: number;
  } | null>({ unassignedToPerson: 6, assigned: 31, overdue: 4, onHold: 6, dueToday: 2, asap: 3 });
  readonly active = signal<PodStripKey | null>(null);
  readonly picked: string[] = [];
}

describe('PodWorkStrip', () => {
  function mount() {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }
  const el = (f: ReturnType<typeof mount>) => f.nativeElement as HTMLElement;

  it("shows Overdue, Due today, ASAP and On hold with the pod's counts, as one chip row", () => {
    const f = mount();
    const text = el(f).querySelector('[data-strip]')!.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Overdue 4');
    expect(text).toContain('Due today 2');
    expect(text).toContain('ASAP 3');
    expect(text).toContain('On hold 6');
    expect(el(f).querySelector('[data-strip]')!.classList).toContain('row');
  });

  it('every item is a toggle button that reports its key; the active one is pressed', () => {
    const f = mount();
    f.componentInstance.active.set('asap');
    f.detectChanges();
    const buttons = Array.from(
      el(f).querySelectorAll<HTMLButtonElement>('button[data-strip-item]'),
    );
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ]);
    buttons[1].click();
    expect(f.componentInstance.picked).toEqual(['dueToday']);
  });

  it('shows -- while the summary is not known', () => {
    const f = mount();
    f.componentInstance.summary.set(null);
    f.detectChanges();
    expect(el(f).querySelector('[data-strip]')!.textContent).toContain('--');
  });
});
