import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SectionPanel } from './section-panel';

@Component({
  imports: [SectionPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-section-panel
      title="Team"
      key="team"
      [count]="count()"
      [empty]="count() === 0"
      emptyText="No members"
      [(expanded)]="open"
    >
      <span mfPanelChip data-extra-chip>1 Blacklisted</span>
      <button mfPanelAction type="button" class="mf-btn mf-btn--text" data-action>Edit</button>
      <p data-row>A row</p>
    </mf-section-panel>
  `,
})
class Host {
  readonly count = signal(3);
  readonly open = signal(true);
}

describe('SectionPanel (epic #1373, #1376)', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, host: fixture.componentInstance };
  }

  it('is one mf-card with a toggle button, the title, the count chip, the extra chip and the action', () => {
    const { el } = render();
    expect(el.querySelectorAll('section.mf-card')).toHaveLength(1);
    expect(el.querySelector('mf-section-panel')!.getAttribute('data-section-panel')).toBe('team');
    const toggle = el.querySelector<HTMLButtonElement>('[data-panel-toggle]')!;
    expect(toggle.closest('h3')).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Collapse Team');
    expect(toggle.getAttribute('aria-controls')).toBe(el.querySelector('[data-panel-body]')!.id);
    expect(toggle.querySelector('[data-panel-title]')!.textContent).toBe('Team');
    expect(toggle.querySelector('mf-count-chip')!.textContent!.trim()).toBe('3');
    expect(toggle.querySelector('[data-extra-chip]')).not.toBeNull();
    expect(toggle.querySelector('.pi-chevron-down')).not.toBeNull();
    expect(el.querySelector('[data-action]')).not.toBeNull();
    expect(el.querySelector('[data-row]')).not.toBeNull();
  });

  it('folds to the header only (the count and the chip stay) and opens again', () => {
    const { fixture, el, host } = render();
    const toggle = el.querySelector<HTMLButtonElement>('[data-panel-toggle]')!;
    toggle.click();
    fixture.detectChanges();
    expect(host.open()).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Expand Team');
    expect(toggle.querySelector('.pi-chevron-right')).not.toBeNull();
    expect(el.querySelector('[data-row]')).toBeNull();
    expect(el.querySelector('[data-panel-count]')!.textContent!.trim()).toBe('3');
    expect(el.querySelector('[data-extra-chip]')).not.toBeNull();
    toggle.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-row]')).not.toBeNull();
  });

  it('an empty panel is one line: the title, a 0 chip, the muted words and the action, with no toggle and no body', () => {
    const { fixture, el, host } = render();
    host.count.set(0);
    fixture.detectChanges();
    expect(el.querySelector('[data-panel-toggle]')).toBeNull();
    expect(el.querySelector('[data-panel-body]')).toBeNull();
    expect(el.querySelector('[data-panel-title]')!.textContent).toBe('Team');
    expect(el.querySelector('[data-panel-count]')!.textContent!.trim()).toBe('0');
    expect(el.querySelector('[data-panel-empty]')!.textContent).toBe('No members');
    expect(el.querySelector('[data-action]')).not.toBeNull();
  });
});
