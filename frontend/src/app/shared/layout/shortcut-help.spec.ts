import { TestBed } from '@angular/core/testing';
import { ShortcutHelp } from './shortcut-help';
import { ShortcutHelpState } from './shortcut-help-state';
import { FOCUS_FILTER_SHORTCUT, ShortcutRegistry } from './shortcut-registry';

describe('ShortcutHelp', () => {
  it('shows every registered shortcut, each under the heading of its group', async () => {
    const registry = TestBed.inject(ShortcutRegistry);
    registry.register({
      ...FOCUS_FILTER_SHORTCUT,
      keys: ['/'],
      group: 'work-lists',
      does: 'Focus the Title or Ref filter',
    });
    TestBed.inject(ShortcutHelpState).open.set(true);
    const fixture = TestBed.createComponent(ShortcutHelp);
    await fixture.whenStable();
    fixture.detectChanges();
    const text = document.body.querySelector('[data-shortcut-help]')!.textContent ?? '';
    for (const item of registry.all()) expect(text).toContain(item.does);
    const headings = Array.from(document.body.querySelectorAll('.sh__heading')).map((h) =>
      h.textContent?.trim(),
    );
    expect(headings).toContain('Work lists (Task Queue, My Work, Pod Work)');
    expect(headings).not.toContain('Task Queue');
    expect(headings).not.toContain('This page');
  });
});
