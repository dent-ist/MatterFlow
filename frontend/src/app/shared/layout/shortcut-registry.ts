import { Injectable, computed, signal } from '@angular/core';

export type ShortcutGroupId = 'anywhere' | 'work-lists' | 'page' | 'menus' | 'tabs';

export interface ShortcutDef {
  /** Stable id; the handler and the help refer to it. */
  id: string;
  group: ShortcutGroupId;
  /** The key caps shown in the help (one per alternative key, not a chord). */
  keys: string[];
  /** What it does, in the help's words. */
  does: string;
  /** The handler's test for a keydown event (omitted for keys that belong to a widget, such as arrows in a menu). */
  matches?: (event: KeyboardEvent) => boolean;
}

export const SHORTCUT_GROUP_HEADINGS: Readonly<Record<ShortcutGroupId, string>> = {
  anywhere: 'Anywhere',
  'work-lists': 'Work lists (Task Queue, My Work, Pod Work)',
  page: 'This page',
  menus: 'Menus and lists',
  tabs: 'Tabs',
};

const GROUP_ORDER: readonly ShortcutGroupId[] = ['anywhere', 'work-lists', 'page', 'menus', 'tabs'];

const plain = (event: KeyboardEvent): boolean => !event.ctrlKey && !event.metaKey && !event.altKey;

/** Shortcuts that work on every screen. Add a shortcut here (or register it with `ShortcutRegistry`) in the same change that adds its handler. */
export const GLOBAL_SHORTCUTS: readonly ShortcutDef[] = [
  {
    id: 'search',
    group: 'anywhere',
    keys: ['Ctrl', 'K'],
    does: 'Search matters, clients, tasks and assets (Cmd + K on a Mac)',
    matches: (e) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k',
  },
  {
    id: 'help',
    group: 'anywhere',
    keys: ['?'],
    does: 'Show or hide this list',
    matches: (e) => e.key === '?' && plain(e),
  },
  {
    id: 'escape',
    group: 'anywhere',
    keys: ['Esc'],
    does: 'Close a menu, list or dialog and return to where you were',
  },
  {
    id: 'menu-open',
    group: 'menus',
    keys: ['Enter', 'Space'],
    does: 'Open a menu or choose the highlighted option',
  },
  {
    id: 'menu-move',
    group: 'menus',
    keys: ['↑', '↓'],
    does: 'Move through the options of a menu or search results',
  },
  { id: 'tabs-move', group: 'tabs', keys: ['←', '→'], does: 'Switch to the previous or next tab' },
  { id: 'tabs-ends', group: 'tabs', keys: ['Home', 'End'], does: 'Go to the first or last tab' },
];

/** `/` moves to the first text filter of a screen that has one. Registered by the filter bar while such a screen is open. */
export const FOCUS_FILTER_SHORTCUT = {
  id: 'focus-filter',
  keys: ['/'],
  matches: (e: KeyboardEvent) => e.key === '/' && plain(e),
} as const;

const BY_ID = new Map<string, ShortcutDef>(GLOBAL_SHORTCUTS.map((s) => [s.id, s]));

/** Whether a keydown event is the shortcut with this id: the handlers call this, so a key and its help line cannot drift apart. */
export function isShortcut(id: string, event: KeyboardEvent): boolean {
  const def = BY_ID.get(id);
  if (def) return def.matches?.(event) ?? false;
  return id === FOCUS_FILTER_SHORTCUT.id && FOCUS_FILTER_SHORTCUT.matches(event);
}

export interface ShortcutGroup {
  id: ShortcutGroupId;
  heading: string;
  items: ShortcutDef[];
}

/** Groups definitions in the help's order; empty groups are left out. */
export function groupShortcuts(defs: readonly ShortcutDef[]): ShortcutGroup[] {
  return GROUP_ORDER.map((id) => ({
    id,
    heading: SHORTCUT_GROUP_HEADINGS[id],
    items: defs.filter((d) => d.group === id),
  })).filter((g) => g.items.length > 0);
}

/**
 * The one list of keyboard shortcuts behind the `?` help. The global ones are constants; a screen's own shortcut (for example `/` for
 * the filter bar) registers while that screen is open, so a page that lacks a shortcut does not list it.
 */
@Injectable({ providedIn: 'root' })
export class ShortcutRegistry {
  private readonly dynamic = signal<readonly ShortcutDef[]>([]);

  /** Every shortcut that works right now. */
  readonly all = computed<readonly ShortcutDef[]>(() => [...GLOBAL_SHORTCUTS, ...this.dynamic()]);
  readonly groups = computed(() => groupShortcuts(this.all()));

  /** Lists a shortcut until the returned function is called. A second registration with the same id replaces the first. */
  register(def: ShortcutDef): () => void {
    this.dynamic.update((list) => [...list.filter((d) => d.id !== def.id), def]);
    return () =>
      this.dynamic.update((list) => (list.includes(def) ? list.filter((d) => d !== def) : list));
  }
}
