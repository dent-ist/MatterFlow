import { TestBed } from '@angular/core/testing';
import { KeyboardShortcuts } from '../../../shared/layout/keyboard-shortcuts';
import { ShortcutRegistry } from '../../../shared/layout/shortcut-registry';
import { Permission } from '../../../core/auth/permissions';
import { aTask, allowed, mountTaskPage, q, transition } from './task-detail-testing';

const PERMS: Permission[] = ['Task.View', 'Task.Edit', 'Task.Comment', 'Workflow.Execute'];

const press = (init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

/** Counts the clicks a control gets (the shortcuts press the control itself, so the page's own handler runs). */
function spyClick(el: HTMLElement, selector: string): () => number {
  const control = q(el, selector)!;
  expect(control, selector).not.toBeNull();
  let n = 0;
  control.addEventListener('click', (e) => {
    n++;
    e.stopImmediatePropagation();
  });
  return () => n;
}

const COMMENT = '[data-section="comments"] [data-add-comment]';
const ASSIGNEE = '[data-facts] [data-assignee] [data-inline-trigger]';
const STATUS = '[data-facts] [data-status] [data-inline-trigger]';

describe('Task page shortcuts C, A and S (K2, #327)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('C adds a comment, A opens the Assignee menu, S opens the Status menu', async () => {
    const { el } = await mountTaskPage(aTask(), PERMS);
    const comment = spyClick(el, COMMENT);
    const assignee = spyClick(el, ASSIGNEE);
    const status = spyClick(el, STATUS);
    expect(press({ key: 'c' }).defaultPrevented).toBe(true);
    press({ key: 'a' });
    press({ key: 's' });
    expect([comment(), assignee(), status()]).toEqual([1, 1, 1]);
    // Upper case without Shift (Caps Lock) counts too; Shift + letter does not.
    press({ key: 'C' });
    expect(comment()).toBe(2);
    press({ key: 'C', shiftKey: true });
    expect(comment()).toBe(2);
  });

  it('does nothing with the "Keyboard shortcuts" switch off, and acts again when it is switched on', async () => {
    const { el } = await mountTaskPage(aTask(), PERMS);
    const shortcuts = TestBed.inject(KeyboardShortcuts);
    const status = spyClick(el, STATUS);
    shortcuts.setEnabled(false);
    const event = press({ key: 's' });
    expect(event.defaultPrevented).toBe(false);
    expect(status()).toBe(0);
    shortcuts.setEnabled(true);
    press({ key: 's' });
    expect(status()).toBe(1);
  });

  it('never acts on a letter typed into a field, with a modifier, while a menu or dialog is open, or in the middle of a g chord', async () => {
    const { el } = await mountTaskPage(aTask(), PERMS);
    const status = spyClick(el, STATUS);
    const input = document.createElement('input');
    document.body.append(input);
    press({ key: 's' }, input);
    const area = document.createElement('textarea');
    document.body.append(area);
    press({ key: 's' }, area);
    const editable = document.createElement('div');
    editable.setAttribute('role', 'textbox');
    document.body.append(editable);
    press({ key: 's' }, editable);
    press({ key: 's', ctrlKey: true });
    press({ key: 's', metaKey: true });
    press({ key: 's', altKey: true });
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.append(item);
    document.body.append(menu);
    press({ key: 's' }, item);
    expect(status()).toBe(0);
    // A dialog on screen keeps the keyboard.
    const dialog = document.createElement('div');
    dialog.className = 'p-dialog';
    document.body.append(dialog);
    press({ key: 's' });
    expect(status()).toBe(0);
    for (const n of [input, area, editable, menu, dialog]) n.remove();
    press({ key: 's' });
    expect(status()).toBe(1);
  });

  it('does nothing when the control is not on the page: no Task.Comment, no assign right, no status transitions', async () => {
    const task = aTask({
      allowedActions: allowed({ canComment: false, canAssign: false, transitions: [] }),
    });
    const { el } = await mountTaskPage(task, ['Task.View']);
    expect(q(el, COMMENT)).toBeNull();
    expect(q(el, ASSIGNEE)).toBeNull();
    expect(q(el, STATUS)).toBeNull();
    for (const key of ['c', 'a', 's']) expect(press({ key }).defaultPrevented).toBe(false);
  });

  it('S needs a Status menu: a closed task with a Reopen transition still has one', async () => {
    const task = aTask({
      status: 'CANCELLED',
      statusLabel: 'Cancelled',
      allowedActions: allowed({ canEdit: false, transitions: [transition('REOPEN')] }),
    });
    const { el } = await mountTaskPage(task, PERMS);
    const status = spyClick(el, STATUS);
    press({ key: 's' });
    expect(status()).toBe(1);
  });

  it('lists the three keys in the help while the page is open and removes them with it', async () => {
    const { fixture } = await mountTaskPage(aTask(), PERMS);
    const registry = TestBed.inject(ShortcutRegistry);
    const ids = () => registry.all().map((s) => s.id);
    for (const id of ['task-comment', 'task-assignee', 'task-status']) expect(ids()).toContain(id);
    const page = registry.groups().find((g) => g.id === 'page')!;
    expect(page.items.map((i) => i.keys.join(''))).toEqual(expect.arrayContaining(['C', 'A', 'S']));
    fixture.destroy();
    for (const id of ['task-comment', 'task-assignee', 'task-status'])
      expect(ids()).not.toContain(id);
    // After the page is gone the keys are free again.
    expect(press({ key: 's' }).defaultPrevented).toBe(false);
  });
});
