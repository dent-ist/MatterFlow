import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActionMenu } from './action-menu';
import { RowActionSpec, rowActions } from './row-actions';

const run = () => undefined;
const everyone = { can: () => true };

const specs: RowActionSpec[] = [
  { id: 'delete', label: 'Delete', danger: true, run },
  { id: 'deactivate', label: 'Deactivate', kind: 'state', run },
  { id: 'rename', label: 'Rename', run },
  { id: 'up', label: 'Move up', run },
];

describe('rowActions (#554)', () => {
  it('names the menu "Actions for <name>" and cuts a very long name in that name only', () => {
    expect(rowActions('Source', specs, everyone).label).toBe('Actions for Source');
    const long = rowActions('x'.repeat(200), specs, everyone).label;
    expect(long).toBe('Actions for ' + 'x'.repeat(79) + '…');
  });

  it('orders primary entries, then the state change, then the danger entry, whatever the order given', () => {
    const { items } = rowActions('Source', specs, everyone);
    expect(items.map((i) => i.id)).toEqual(['rename', 'up', 'deactivate', 'delete']);
  });

  it('marks the danger entry (and only it) as danger, with the divider above it', () => {
    const { items } = rowActions('Source', specs, everyone);
    expect(items.map((i) => !!i.danger)).toEqual([false, false, false, true]);
    expect(items.map((i) => !!i.separated)).toEqual([false, false, false, true]);
    // No divider when the danger entry would be the only one.
    const only = rowActions('Source', [specs[0]], everyone).items;
    expect(only[0].separated).toBeUndefined();
  });

  it('turns a reason into a disabled entry whose reason is carried with it', () => {
    const { items } = rowActions(
      'Normal',
      [
        { id: 'delete', label: 'Delete', danger: true, reason: 'Used by 31 open tasks', run },
        { id: 'rename', label: 'Rename', run },
      ],
      everyone,
    );
    const del = items.find((i) => i.id === 'delete')!;
    expect(del.disabled).toBe(true);
    expect(del.reason).toBe('Used by 31 open tasks');
    expect(items.find((i) => i.id === 'rename')!.disabled).toBeUndefined();
  });

  it("does not offer an entry nobody in the person's position may use", () => {
    const manageOnly = {
      can: (p: string) => p === 'Priority.Manage',
    };
    const out = rowActions(
      'Normal',
      [
        { id: 'a', label: 'Edit', permission: 'Priority.Manage', run },
        { id: 'b', label: 'Audit trail', permission: ['Audit.View', 'Audit.Admin'], run },
        { id: 'c', label: 'Open', run },
        { id: 'd', label: 'Delete', danger: true, permission: 'Priority.Delete', run },
      ],
      manageOnly,
    );
    expect(out.items.map((i) => i.id)).toEqual(['a', 'c']);
    // No entries at all: an empty menu (the menu component then renders nothing).
    expect(
      rowActions('x', [{ id: 'a', label: 'Edit', permission: 'Nope', run }], manageOnly).items,
    ).toEqual([]);
  });

  it('keeps the run callback of each entry', () => {
    const spy = vi.fn();
    const { items } = rowActions('x', [{ id: 'a', label: 'Edit', run: spy }], everyone);
    items[0].run();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActionMenu],
  template: `<mf-action-menu [floating]="true" [label]="menu.label" [items]="menu.items" />`,
})
class Host {
  readonly menu = rowActions(
    'Source',
    [
      { id: 'delete', label: 'Delete', danger: true, reason: 'Used by 31 tasks', run },
      { id: 'deactivate', label: 'Deactivate', kind: 'state', run },
      { id: 'rename', label: 'Rename', run },
    ],
    everyone,
  );
}

describe('rowActions in mf-action-menu (#554)', () => {
  async function open() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('[data-overflow]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    return el;
  }

  it('has one Tab stop named "Actions for <name>", entries in order, danger last in red', async () => {
    const el = await open();
    const trigger = el.querySelector('[data-overflow]')!;
    expect(trigger.getAttribute('aria-label')).toBe('Actions for Source');
    expect(el.querySelector('[role="menu"]')!.getAttribute('aria-label')).toBe(
      'Actions for Source',
    );
    const items = Array.from(el.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    expect(items.map((i) => i.dataset['action'])).toEqual(['rename', 'deactivate', 'delete']);
    // Every item is out of the Tab order: the menu is one stop.
    expect(items.every((i) => i.getAttribute('tabindex') === '-1')).toBe(true);
    expect(items[2].classList.contains('am__item--danger')).toBe(true);
    expect(items[0].classList.contains('am__item--danger')).toBe(false);
  });

  it('shows the reason of a disabled entry as text, not as a tooltip', async () => {
    const el = await open();
    const del = el.querySelector<HTMLElement>('[data-action="delete"]')!;
    expect(del.getAttribute('aria-disabled')).toBe('true');
    expect(del.getAttribute('title')).toBeNull();
    const reason = del.querySelector('[data-reason]')!;
    expect(reason.textContent!.trim()).toBe('Used by 31 tasks');
    expect(del.getAttribute('aria-describedby')).toBe(reason.id);
  });
});
