import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivityDrawer } from './activity-drawer';

describe('ActivityDrawer title', () => {
  let fixture: ComponentFixture<ActivityDrawer>;
  const longName = 'TSK-123 ' + 'Process and load the supplemental custodian data '.repeat(4);

  beforeEach(async () => {
    fixture = TestBed.createComponent(ActivityDrawer);
    fixture.componentRef.setInput('name', longName);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('shows "Activity: <name>" with the whole text in the tooltip and as the dialog name', () => {
    const title = document.body.querySelector<HTMLElement>('[data-drawer-title]')!;
    expect(title.textContent).toBe('Activity: ' + longName);
    expect(title.getAttribute('title')).toBe('Activity: ' + longName);
    const dialog = document.body.querySelector('.mf-drawer')!;
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
  });

  it('clamps the title to 2 lines', () => {
    const title = document.body.querySelector<HTMLElement>('[data-drawer-title]')!;
    const style = getComputedStyle(title);
    expect(style.overflow).toBe('hidden');
    expect(style.webkitLineClamp || style.getPropertyValue('line-clamp')).toBe('2');
  });
});
