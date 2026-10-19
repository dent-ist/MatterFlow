import { DestroyRef, inject } from '@angular/core';
import {
  KeyboardShortcuts,
  isEditable,
  overlayOpen,
} from '../../../shared/layout/keyboard-shortcuts';
import {
  ShortcutRegistry,
  TASK_SHORTCUTS,
  isShortcut,
} from '../../../shared/layout/shortcut-registry';
import { AuthStore } from '../../../core/auth/auth.store';
import { TaskDetailStore } from './task-detail.store';

/** What a Task shortcut does: the control it clicks, found by the hooks the page already has (so a missing control means "not allowed"). */
const TARGETS: Readonly<Record<string, string>> = {
  'task-assignee': '[data-facts] [data-assignee] [data-inline-trigger]',
  'task-status': '[data-facts] [data-status] [data-inline-trigger]',
};

/** Inside a menu, list or dialog the letter keys belong to it (typeahead, search); so do the Activity drawer and the Edit form. */
const OWNED =
  '[role="menu"], [role="listbox"], [role="dialog"], [role="combobox"], .p-overlay, .im-pop';

/** The app header covers the top of the window; a button under it counts as out of view. */
const HEADER_CLEARANCE_PX = 72;

/** Whether the control is wholly inside the window, below the app header. */
function inView(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  // A control that has no box (not laid out, as in a unit test) cannot be scrolled to.
  if (r.width === 0 && r.height === 0) return true;
  return r.top >= HEADER_CLEARANCE_PX && r.bottom <= window.innerHeight;
}

/** Scrolls the control into the middle of the window and presses it once the scrolling has ended (an inline menu closes on any scroll). */
function pressAfterScroll(control: HTMLElement): void {
  let done = false;
  const press = (): void => {
    if (done) return;
    done = true;
    document.removeEventListener('scrollend', press, true);
    clearTimeout(fallback);
    control.click();
  };
  // `scrollend` where the browser has it; otherwise (or when nothing moved) a short wait.
  const fallback = setTimeout(press, 250);
  document.addEventListener('scrollend', press, true);
  control.scrollIntoView({ block: 'center' });
}

/**
 * The Task page's single-key shortcuts (K2, #327): `C` (opens the Comments tab and focuses the composer), `A` and `S`. They are listed in the `?` help while the page is open and act only
 * while the person's "Keyboard shortcuts" switch is on (WCAG 2.1.4), no modifier is held, focus is not in a field, menu or dialog, and the
 * `g` chord is not pending. A key whose control is not on the page (no Task.Comment, Task.Assign or status right; a closed task) does
 * nothing. Call it once, from the Task page's constructor.
 */
export function registerTaskShortcuts(): void {
  const store = inject(TaskDetailStore);
  const shortcuts = inject(KeyboardShortcuts);
  const registry = inject(ShortcutRegistry);
  const auth = inject(AuthStore);

  const offs = TASK_SHORTCUTS.map((def) => registry.register(def));
  const onKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    if (!shortcuts.enabled() || shortcuts.sequencePending()) return;
    const id = TASK_SHORTCUTS.find((d) => isShortcut(d.id, event))?.id;
    if (!id || store.state() !== 'ready') return;
    const target = event.target as HTMLElement | null;
    if (isEditable(target) || target?.closest(OWNED) || overlayOpen() || store.editing()) return;
    // C: the Comments tab opens and the cursor goes to the composer (there is no button to press; without Task.Comment there is no composer).
    if (id === 'task-comment') {
      if (!auth.has('Task.Comment')) return;
      event.preventDefault();
      store.openComposer();
      return;
    }
    const control = document.querySelector<HTMLElement>(TARGETS[id]);
    if (
      !control ||
      control.hasAttribute('disabled') ||
      control.getAttribute('aria-disabled') === 'true'
    )
      return;
    event.preventDefault();
    // A menu anchored off screen would open out of sight, and the scroll that brings it in would close it: bring the button into view first.
    if (!inView(control)) {
      pressAfterScroll(control);
      return;
    }
    control.click();
  };
  // Capture phase: a Status, Priority or Assignee button keeps its keys from reaching the document (they must not move a table row), and the
  // person who has just closed one of these menus is standing on it.
  document.addEventListener('keydown', onKey, true);
  inject(DestroyRef).onDestroy(() => {
    document.removeEventListener('keydown', onKey, true);
    offs.forEach((off) => off());
  });
}
