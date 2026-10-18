import { Injectable, computed, signal } from '@angular/core';

export type ShortcutGroupId = 'anywhere' | 'work-lists' | 'page' | 'menus' | 'tabs';

export interface ShortcutDef {
  /** Stable id; the handler and the help refer to it. */
  id: string;
  group: ShortcutGroupId;
  /** The key caps shown in the help (one per alternative key, or the keys of a sequence in order). */
  keys: string[];
  /** The keys are pressed one after the other (`g` then `m`), not as alternatives. */
  sequence?: boolean;
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

const lower = (e: KeyboardEvent): string => e.key.toLowerCase();

/** Row shortcuts of the work lists (#181). They act only while focus is on a row of the grid and the user has shortcuts switched on. A screen registers them while its list is open. */
export const ROW_SHORTCUTS: readonly ShortcutDef[] = [
  {
    id: 'row-next',
    group: 'work-lists',
    keys: ['J', '↓'],
    does: 'Move to the next task in the list',
    matches: (e) => plain(e) && !e.shiftKey && (e.key === 'j' || e.key === 'ArrowDown'),
  },
  {
    id: 'row-prev',
    group: 'work-lists',
    keys: ['K', '↑'],
    does: 'Move to the previous task in the list',
    matches: (e) => plain(e) && !e.shiftKey && (e.key === 'k' || e.key === 'ArrowUp'),
  },
  {
    id: 'row-open',
    group: 'work-lists',
    keys: ['Enter'],
    does: 'Open the task you are on',
  },
  {
    id: 'row-status',
    group: 'work-lists',
    keys: ['S'],
    does: 'Open the Status menu of the task you are on',
    matches: (e) => plain(e) && !e.shiftKey && lower(e) === 's',
  },
  {
    id: 'row-priority',
    group: 'work-lists',
    keys: ['P'],
    does: 'Open the Priority menu of the task you are on (if you may change it)',
    matches: (e) => plain(e) && !e.shiftKey && lower(e) === 'p',
  },
  // Not single characters, so they stay on when "Keyboard shortcuts" is off (WCAG 2.1.4). Handled by the grid's header cells.
  {
    id: 'column-menu',
    group: 'work-lists',
    keys: ['Menu', 'Shift + F10'],
    does: 'Open the column menu (widen, narrow, fit, reset, hide, sort) of the column header you are on',
    matches: (e) =>
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)),
  },
];

/** `g` then a letter goes to a work page (#181); the second key must follow within `GO_SEQUENCE_MS`. */
export const GO_SEQUENCE_MS = 1500;
export const GO_START: Pick<ShortcutDef, 'id' | 'matches'> = {
  id: 'go-start',
  matches: (e) => plain(e) && !e.shiftKey && e.key === 'g',
};
export interface GoTarget {
  id: string;
  key: string;
  path: string;
  does: string;
  /** The permission that shows the page in the navigation. */
  permission: string;
}
export const GO_TARGETS: readonly GoTarget[] = [
  { id: 'go-my-work', key: 'm', path: '/my-work', does: 'Go to My Work', permission: 'Task.View' },
  { id: 'go-tasks', key: 't', path: '/tasks', does: 'Go to Task Queue', permission: 'Task.View' },
  {
    id: 'go-pod-work',
    key: 'p',
    path: '/pods/work',
    does: 'Go to Pod Work',
    permission: 'Pod.View',
  },
];
export const goShortcut = (t: GoTarget): ShortcutDef => ({
  id: t.id,
  group: 'anywhere',
  keys: ['G', t.key.toUpperCase()],
  sequence: true,
  does: t.does,
});

const BY_ID = new Map<string, ShortcutDef>(
  [...GLOBAL_SHORTCUTS, ...ROW_SHORTCUTS].map((s) => [s.id, s]),
);

/** Whether a keydown event is the shortcut with this id: the handlers call this, so a key and its help line cannot drift apart. */
export function isShortcut(id: string, event: KeyboardEvent): boolean {
  const def = BY_ID.get(id);
  if (def) return def.matches?.(event) ?? false;
  if (id === GO_START.id) return GO_START.matches!(event);
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
