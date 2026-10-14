import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PrioritiesClient, StatusLabelsClient } from '../../api/generated/api-client';
import { LookupStore } from '../../core/lookups/lookup-store';
import { FakePrioritiesClient, FakeStatusLabelsClient } from '../../core/lookups/lookups-testing';
import { PriorityBadge, levelBars } from './priority-badge';
import { StatusBadge } from './status-badge';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PriorityBadge, StatusBadge],
  template: `
    <mf-priority-badge [priorityId]="priorityId()" />
    <mf-status-badge [code]="code()" />
  `,
})
class Host {
  readonly priorityId = signal<number | null>(1);
  readonly code = signal('ON_HOLD');
}

describe('shared badges', () => {
  let priorities: FakePrioritiesClient;
  let statuses: FakeStatusLabelsClient;

  beforeEach(() => {
    priorities = new FakePrioritiesClient();
    statuses = new FakeStatusLabelsClient();
    TestBed.configureTestingModule({
      providers: [
        { provide: PrioritiesClient, useValue: priorities },
        { provide: StatusLabelsClient, useValue: statuses },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, host: fixture.componentInstance };
  }

  it('maps rank to 1-4 level bars, never a number', () => {
    expect([1, 2, 3, 4, 5, 9].map(levelBars)).toEqual([4, 3, 2, 1, 1, 1]);
    expect(levelBars(null)).toBe(1);
  });

  it('shows the looked-up priority label with a glyph and token colors', async () => {
    const { el } = await render();
    const badge = el.querySelector<HTMLElement>('[data-priority]')!;

    expect(badge.textContent!.trim()).toBe('Critical');
    expect(badge.style.background).toContain('--mf-pr-critical-bg');
    expect(badge.style.color).toContain('--mf-pr-critical-fg');
    expect(badge.querySelectorAll('.bar.on').length).toBe(4);
    expect(badge.querySelector('.bars')!.getAttribute('aria-hidden')).toBe('true');
    expect(badge.textContent).not.toMatch(/\d/);
  });

  it('still displays an inactive priority and follows renames made in the admin screen', async () => {
    const { fixture, el, host } = await render();
    const store = TestBed.inject(LookupStore);

    host.priorityId.set(4);
    store.setPriorities(
      store
        .priorities()
        .map((p) => (p.id === 4 ? { ...p, isActive: false, label: 'Whenever' } : p)),
    );
    fixture.detectChanges();

    const badge = el.querySelector<HTMLElement>('[data-priority]')!;
    expect(badge.textContent!.trim()).toBe('Whenever');
    expect(badge.querySelectorAll('.bar.on').length).toBe(1);
  });

  it('renders nothing for an unknown priority and uses text color for a custom hex', async () => {
    const { fixture, el, host } = await render();
    host.priorityId.set(999);
    fixture.detectChanges();
    expect(el.querySelector('[data-priority]')).toBeNull();

    const preview = TestBed.createComponent(PriorityBadge);
    preview.componentRef.setInput('label', 'Custom');
    preview.componentRef.setInput('color', '#0B3D91');
    preview.componentRef.setInput('rank', 2);
    await preview.whenStable();
    const badge = (preview.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-priority]',
    )!;
    expect(badge.style.background).toBe('rgb(11, 61, 145)');
    expect(badge.style.color).toBe('rgb(255, 255, 255)');
    expect(badge.querySelectorAll('.bar.on').length).toBe(3);
  });

  it('shows the configurable status label with an icon and keeps the code in data-status', async () => {
    const { fixture, el, host } = await render();
    let badge = el.querySelector<HTMLElement>('[data-status]')!;
    expect(badge.getAttribute('data-status')).toBe('ON_HOLD');
    expect(badge.textContent!.trim()).toBe('On Hold');
    expect(badge.querySelector('.pi-pause-circle')).not.toBeNull();
    expect(badge.style.background).toContain('--mf-st-hold-bg');

    TestBed.inject(LookupStore).setStatusLabels(
      statuses.rows.map((s) => (s.code === 'ON_HOLD' ? { ...s, displayLabel: 'Waiting' } : s)),
    );
    fixture.detectChanges();
    badge = el.querySelector<HTMLElement>('[data-status]')!;
    expect(badge.textContent!.trim()).toBe('Waiting');
    expect(badge.getAttribute('data-status')).toBe('ON_HOLD');

    host.code.set('COMPLETED');
    fixture.detectChanges();
    expect(el.querySelector('[data-status]')!.querySelector('.pi-check-circle')).not.toBeNull();
  });
});
