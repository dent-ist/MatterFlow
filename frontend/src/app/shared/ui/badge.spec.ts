import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActiveBadge, Badge, SensitiveBadge, workflowStatusTone } from './badge';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActiveBadge, Badge, SensitiveBadge],
  template: `
    <mf-badge tone="info" icon="pi-lock" data-plain>Hello</mf-badge>
    <mf-active-badge [active]="active()" inactiveLabel="Archived" data-state />
    <mf-sensitive-badge />
  `,
})
class Host {
  readonly active = signal(true);
}

describe('mf-badge family', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, host: fixture.componentInstance };
  }

  it('renders the tone and the optional icon, never colour alone', async () => {
    const { el } = await render();
    const badge = el.querySelector('[data-plain] .badge') as HTMLElement;
    expect(badge.dataset['tone']).toBe('info');
    expect(badge.textContent).toContain('Hello');
    expect(badge.querySelector('i.pi-lock')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows Active in green and the inactive wording in grey', async () => {
    const { el, host, fixture } = await render();
    const state = () => el.querySelector('[data-state] .badge') as HTMLElement;
    expect(state().dataset['tone']).toBe('success');
    expect(state().textContent).toContain('Active');
    host.active.set(false);
    fixture.detectChanges();
    expect(state().dataset['tone']).toBe('neutral');
    expect(state().textContent).toContain('Archived');
  });

  it('marks a sensitive matter with an amber badge that says so', async () => {
    const { el } = await render();
    const badge = el.querySelector('mf-sensitive-badge .badge') as HTMLElement;
    expect(badge.dataset['tone']).toBe('warning');
    expect(badge.textContent).toContain('Sensitive');
  });

  it('maps workflow version statuses to tones', () => {
    expect(workflowStatusTone('Published')).toBe('success');
    expect(workflowStatusTone('Draft')).toBe('warning');
    expect(workflowStatusTone('Retired')).toBe('neutral');
    expect(workflowStatusTone(undefined)).toBe('neutral');
  });
});
