import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { contrastRatio } from '../ui/color-contrast';
import { TaskTypeBadge } from './task-type-badge';
import { TASK_TYPE_COLOURS, TASK_TYPE_COLOUR_NEUTRAL } from './task-type-colours';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TaskTypeBadge],
  template: `
    <mf-task-type-badge
      #tt
      iconKey="package-export"
      colourKey="teal"
      name="Production (Outgoing)"
    />
    <a href="/tasks/1" [attr.aria-describedby]="tt.descriptionId">TSK-1 Review batch 4</a>
    <mf-task-type-badge iconKey="cpu-2" name="Data Processing" variant="wide" data-wide />
  `,
})
class Host {}

describe('TaskTypeBadge (#854)', () => {
  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  it('names the type for assistive technology, shows it as the tooltip and never relies on colour alone', async () => {
    const el = await render();
    const chip = el.querySelector<HTMLElement>('[data-type-badge]')!;
    expect(chip.getAttribute('role')).toBe('img');
    expect(chip.getAttribute('aria-label')).toBe('Task type: Production (Outgoing)');
    expect(chip.getAttribute('title')).toBe('Production (Outgoing)');
    expect(chip.querySelector('svg[data-icon="package-export"]')).not.toBeNull();
    expect(chip.style.background).not.toBe('');
  });

  it('gives the focusable owner a description it can point at', async () => {
    const el = await render();
    const description = el.querySelector<HTMLElement>('[data-type-description]')!;
    expect(description.textContent).toBe('Task type: Production (Outgoing)');
    expect(el.querySelector('a')!.getAttribute('aria-describedby')).toBe(description.id);
  });

  it('shows the visible name in the wide variant and hides the chip from assistive technology', async () => {
    const el = await render();
    const wide = el.querySelector<HTMLElement>('[data-wide]')!;
    expect(wide.querySelector('[data-type-name]')!.textContent).toBe('Data Processing');
    expect(wide.querySelector('.tt-chip')!.getAttribute('aria-hidden')).toBe('true');
    expect(wide.querySelector('[role="img"]')).toBeNull();
  });

  it('keeps every palette pair readable: 4.5:1 for text and 3:1 for the icon', () => {
    for (const c of [...TASK_TYPE_COLOURS, { key: 'neutral', ...TASK_TYPE_COLOUR_NEUTRAL }]) {
      expect(contrastRatio(c.bg, c.fg), c.key).toBeGreaterThanOrEqual(4.5);
    }
  });
});
