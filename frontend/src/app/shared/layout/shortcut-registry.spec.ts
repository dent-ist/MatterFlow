import { TestBed } from '@angular/core/testing';
import {
  FOCUS_FILTER_SHORTCUT,
  GLOBAL_SHORTCUTS,
  ShortcutRegistry,
  isShortcut,
} from './shortcut-registry';

describe('ShortcutRegistry', () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

  it('matches the keys the handlers act on', () => {
    expect(isShortcut('help', key({ key: '?' }))).toBe(true);
    expect(isShortcut('help', key({ key: '?', ctrlKey: true }))).toBe(false);
    expect(isShortcut('search', key({ key: 'K', metaKey: true }))).toBe(true);
    expect(isShortcut('search', key({ key: 'k' }))).toBe(false);
    expect(isShortcut('focus-filter', key({ key: '/' }))).toBe(true);
    expect(isShortcut('focus-filter', key({ key: '/', altKey: true }))).toBe(false);
  });

  it('lists "/" under Work lists once it is registered, and drops it again', () => {
    const registry = TestBed.inject(ShortcutRegistry);
    expect(registry.all().some((s) => s.id === 'focus-filter')).toBe(false);
    const off = registry.register({
      ...FOCUS_FILTER_SHORTCUT,
      keys: ['/'],
      group: 'work-lists',
      does: 'Focus the Title or Ref filter',
    });
    const group = registry.groups().find((g) => g.id === 'work-lists')!;
    expect(group.heading).toBe('Work lists (Task Queue, My Work, Pod Work)');
    expect(group.items.map((i) => i.does)).toEqual(['Focus the Title or Ref filter']);
    off();
    expect(registry.groups().some((g) => g.id === 'work-lists')).toBe(false);
  });

  it('puts every registered shortcut into some group (the help is built from the same list)', () => {
    const registry = TestBed.inject(ShortcutRegistry);
    const listed = registry.groups().flatMap((g) => g.items.map((i) => i.id));
    expect(listed.sort()).toEqual(GLOBAL_SHORTCUTS.map((s) => s.id).sort());
  });

  it('a shortcut with a handler test has a key cap to show', () => {
    for (const s of GLOBAL_SHORTCUTS) expect(s.keys.length).toBeGreaterThan(0);
  });
});
