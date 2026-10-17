import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DashSkeleton, DashSkeletonKind } from './dash-skeleton';

@Component({
  imports: [DashSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-dash-skeleton [kind]="kind()" [label]="label()" />`,
})
class Host {
  readonly kind = signal<DashSkeletonKind>('summary');
  readonly label = signal('Loading');
}

function render(kind: DashSkeletonKind, label = 'Loading') {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.kind.set(kind);
  fixture.componentInstance.label.set(label);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { el, host: el.querySelector('mf-dash-skeleton') as HTMLElement };
}

const count = (el: HTMLElement, selector: string) => el.querySelectorAll(selector).length;

describe('mf-dash-skeleton', () => {
  it('summary: two tile groups of four tiles and three list panels of five rows', () => {
    const { el } = render('summary');
    expect(count(el, '.grp')).toBe(2);
    expect(count(el, '.bone--tile')).toBe(8);
    expect(count(el, '.list')).toBe(3);
    expect(count(el, '.list .bone--row')).toBe(15);
  });

  it('breakdowns: four cards of four bar rows', () => {
    const { el } = render('breakdowns');
    expect(count(el, '.card')).toBe(4);
    expect(count(el, '.card .bone--bar')).toBe(16);
  });

  it('trends: two chart frames with an axis line each, and the panel', () => {
    const { el } = render('trends');
    expect(count(el, '.frame')).toBe(2);
    expect(count(el, '.frame .axis')).toBe(2);
    expect(count(el, '.trend-side')).toBe(1);
  });

  it('swimlane: four lanes of three cards; lane: three cards', () => {
    const lanes = render('swimlane');
    expect(count(lanes.el, '.lane')).toBe(4);
    expect(count(lanes.el, '.bone--card')).toBe(12);
    TestBed.resetTestingModule();
    const lane = render('lane');
    expect(count(lane.el, '.bone--card')).toBe(3);
  });

  it('users: a grid of small tiles; coverage: table rows', () => {
    const users = render('users');
    expect(count(users.el, '.grid .bone--user')).toBeGreaterThanOrEqual(12);
    TestBed.resetTestingModule();
    const coverage = render('coverage');
    expect(count(coverage.el, '.rows .bone--line')).toBe(5);
  });

  it('is decorative and busy, with exactly one polite Loading status', () => {
    const { el, host } = render('summary', 'Loading the dashboard');
    expect(host.getAttribute('aria-busy')).toBe('true');
    expect(host.getAttribute('data-skeleton')).toBe('summary');
    expect(el.querySelector('.sil')!.getAttribute('aria-hidden')).toBe('true');
    const statuses = el.querySelectorAll('[role="status"]');
    expect(statuses.length).toBe(1);
    expect(statuses[0].textContent).toBe('Loading the dashboard');
    expect(statuses[0].closest('[aria-hidden="true"]')).toBeNull();
  });
});
