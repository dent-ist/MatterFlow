import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { ShortcutHelp } from './shortcut-help';
import { ShortcutHelpState } from './shortcut-help-state';
import { KeyboardShortcuts } from './keyboard-shortcuts';
import {
  FOCUS_FILTER_SHORTCUT,
  GO_TARGETS,
  ROW_SHORTCUTS,
  ShortcutRegistry,
  goShortcut,
} from './shortcut-registry';

describe('ShortcutHelp', () => {
  afterEach(() => localStorage.clear());
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideFakeMe(new FakeMeApi(withPermissions()))],
    }),
  );

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

  it('has a Keyboard shortcuts on/off switch that is remembered (#181, WCAG 2.1.4)', async () => {
    localStorage.clear();
    const keyboard = TestBed.inject(KeyboardShortcuts);
    TestBed.inject(ShortcutHelpState).open.set(true);
    const fixture = TestBed.createComponent(ShortcutHelp);
    await fixture.whenStable();
    fixture.detectChanges();
    const input = document.body.querySelector<HTMLInputElement>('[data-shortcuts-switch]')!;
    expect(input.getAttribute('role')).toBe('switch');
    expect(input.checked).toBe(true);
    expect(document.body.querySelector('.sh__switchlabel')!.textContent).toContain(
      'Keyboard shortcuts: on',
    );
    input.click();
    fixture.detectChanges();
    expect(keyboard.enabled()).toBe(false);
    expect(document.body.querySelector('.sh__switchlabel')!.textContent).toContain(
      'Keyboard shortcuts: off',
    );
    expect(localStorage.getItem('mf.keyboard-shortcuts.v1.anon')).toBe('0');
  });

  it('lists the grid keys and the g sequences when a work list registered them', async () => {
    const registry = TestBed.inject(ShortcutRegistry);
    for (const def of ROW_SHORTCUTS) registry.register(def);
    registry.register(goShortcut(GO_TARGETS[0]));
    TestBed.inject(ShortcutHelpState).open.set(true);
    const fixture = TestBed.createComponent(ShortcutHelp);
    await fixture.whenStable();
    fixture.detectChanges();
    const text = document.body.querySelector('[data-shortcut-help]')!.textContent ?? '';
    expect(text).toContain('Move to the next task in the list');
    expect(text).toContain('Open the Priority menu of the task you are on');
    expect(text).toContain('Go to My Work');
    expect(document.body.querySelector('.sh__then')).not.toBeNull();
  });
});
