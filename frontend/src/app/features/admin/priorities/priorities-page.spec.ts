import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { PrioritiesClient, StatusLabelsClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { NotificationService } from '../../../core/notify/notification.service';
import {
  FakePrioritiesClient,
  FakeStatusLabelsClient,
  apiError,
} from '../../../core/lookups/lookups-testing';
import { PrioritiesPage } from './priorities-page';

describe('PrioritiesPage (#605, #609, #614, #618)', () => {
  let api: FakePrioritiesClient;
  let statusApi: FakeStatusLabelsClient;
  let fixture: ComponentFixture<PrioritiesPage>;
  const el = (): HTMLElement => fixture.nativeElement;
  const all = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = el()): T[] =>
    Array.from(root.querySelectorAll<T>(sel));
  const row = (label: string): HTMLElement =>
    el().querySelector<HTMLElement>(`[data-row="${label}"]`)!;
  const labels = (): string[] => all('[data-row]').map((r) => r.getAttribute('data-row')!);

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
    await fixture.whenStable();
  }

  /** A button inside an open dialog (dialogs render in the page body, not in the component). */
  function dialogButton(label: string): HTMLButtonElement {
    return Array.from(document.body.querySelectorAll<HTMLButtonElement>('.p-dialog button')).find(
      (b) => b.textContent!.trim() === label,
    )!;
  }

  async function click(target: Element | null): Promise<void> {
    (target as HTMLElement).click();
    await settle();
  }

  /** Opens the row menu of a priority and clicks one of its entries. */
  async function pick(label: string, action: string): Promise<void> {
    await click(row(label).querySelector('button[data-overflow]'));
    await click(row(label).querySelector(`[data-action="${action}"]`));
  }

  const menuIds = (label: string): string[] =>
    all('[data-action]', row(label)).map((b) => b.getAttribute('data-action')!);

  async function openMenu(label: string): Promise<void> {
    await click(row(label).querySelector('button[data-overflow]'));
  }

  /** The seeded priorities with the open-task counts of the Labels review: Critical 2, High 31, Normal 5 (the default), Low 0. */
  function withCounts(): void {
    const counts: Record<string, number> = { Critical: 2, High: 31, Normal: 5, Low: 0 };
    api.rows = api.rows.map((r) => ({ ...r, openTaskCount: counts[r.label] }));
  }

  async function open(withTasks: boolean, ...permissions: Permission[]): Promise<void> {
    api = new FakePrioritiesClient();
    statusApi = new FakeStatusLabelsClient();
    if (withTasks) withCounts();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: PrioritiesClient, useValue: api },
        { provide: StatusLabelsClient, useValue: statusApi },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(PrioritiesPage);
    await settle();
  }

  async function setEdit(value: string | undefined): Promise<void> {
    fixture.componentRef.setInput('edit', value);
    await settle();
  }

  describe('as a priority manager who may see tasks', () => {
    beforeEach(() => open(true, 'Priority.Manage', 'Task.View'));

    it('lists the priorities most urgent first on the grid contract: order, badge, Default badge, color, open tasks, status, one menu', () => {
      expect(labels()).toEqual(['Critical', 'High', 'Normal', 'Low']);
      const table = el().querySelector('table.mf-grid')!;
      expect(all('thead th', table).map((th) => th.textContent!.trim())).toEqual([
        'Order',
        'Priority',
        'Color',
        'Open tasks',
        'Status',
        'Actions',
      ]);
      expect(all('[data-order]').map((c) => c.textContent!.trim())).toEqual(['1', '2', '3', '4']);
      expect(all('[data-default]').length).toBe(1);
      expect(row('Normal').querySelector('[data-default]')!.textContent).toContain('Default');
      expect(row('Critical').querySelector('[data-color-cell]')!.textContent).toContain(
        'Critical red',
      );
      for (const r of all('[data-row]')) {
        expect(all('mf-action-menu', r).length).toBe(1);
        expect(all('button', r).length).toBe(1);
        expect(r.querySelector('mf-active-badge')!.textContent).toContain('Active');
      }
    });

    it('counts the open tasks per priority and links the number to the Task Queue', () => {
      expect(all('[data-open-tasks]').map((c) => c.textContent!.trim())).toEqual([
        '2',
        '31',
        '5',
        '0',
      ]);
      const link = row('High').querySelector<HTMLAnchorElement>('[data-open-tasks] a')!;
      expect(link.getAttribute('href')).toContain('/tasks?priority=2&status=NEW');
      expect(link.getAttribute('aria-label')).toBe('31 open tasks in High');
      expect(link.getAttribute('tabindex')).toBe('-1');
      expect(row('Low').querySelector('[data-open-tasks] a')).toBeNull();
    });

    it('has two Tab stops per row: the name link and the menu (the count is reached by the right arrow)', () => {
      const stops = all('a, button, input, select', row('High')).filter(
        (x) => x.getAttribute('tabindex') !== '-1',
      );
      expect(stops.map((s) => s.tagName + (s.hasAttribute('data-edit') ? ':edit' : ''))).toEqual([
        'A:edit',
        'BUTTON',
      ]);
    });

    it('opens Edit from the name link with ?edit=<id>', () => {
      const link = row('High').querySelector<HTMLAnchorElement>('[data-edit]')!;
      expect(link.getAttribute('href')).toContain('edit=2');
    });

    it('offers the actions in the menu: used rows can be deactivated but not deleted (LB3)', async () => {
      await openMenu('High');
      expect(menuIds('High')).toEqual(['edit', 'up', 'down', 'default', 'deactivate']);
      expect(el().querySelector('[data-action="delete"]')).toBeNull();
    });

    it('offers Delete only for an unused priority', async () => {
      await openMenu('Low');
      expect(menuIds('Low')).toEqual(['edit', 'up', 'down', 'default', 'deactivate', 'delete']);
    });

    it('shows the default row Deactivate and Delete as disabled entries with the reason on screen', async () => {
      await openMenu('Normal');
      expect(menuIds('Normal')).toEqual(['edit', 'up', 'down', 'deactivate', 'delete']);
      const reasons = all('[data-reason]', row('Normal')).map((r) => r.textContent!.trim());
      expect(reasons).toEqual([
        "The default priority can't be deactivated. Make another priority the default first.",
        "The default priority can't be deleted. Make another priority the default first.",
      ]);
      await click(row('Normal').querySelector('[data-action="deactivate"]'));
      expect(api.calls).not.toContain('update:3');
    });

    it('gives the first and last row a visible reason instead of a Move that cannot work', async () => {
      await openMenu('Critical');
      expect(row('Critical').querySelector('[data-action="up"]')!.textContent).toContain(
        'Already the most urgent.',
      );
      await openMenu('Low');
      expect(row('Low').querySelector('[data-action="down"]')!.textContent).toContain(
        'Already the least urgent.',
      );
    });

    it('moves a row with Move down, saves the order and announces the new position politely', async () => {
      await pick('Critical', 'down');

      expect(api.calls).toContain('reorder:2,1,3,4');
      expect(labels()).toEqual(['High', 'Critical', 'Normal', 'Low']);
      expect(el().querySelector('[data-announce]')!.textContent).toContain(
        'Critical moved to position 2 of 4',
      );
      expect(el().querySelector('[data-announce]')!.getAttribute('aria-live')).toBe('polite');
    });

    it('reorders by drag and drop as before', async () => {
      row('Critical').dispatchEvent(new Event('dragstart', { bubbles: true }));
      row('Normal').dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
      row('Normal').dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
      await settle();

      expect(api.calls).toContain('reorder:2,3,1,4');
      expect(labels()).toEqual(['High', 'Normal', 'Critical', 'Low']);
    });

    it('restores the order and explains when saving the order fails', async () => {
      api.failNext = apiError(500, 'INTERNAL_ERROR', 'Server error');

      await pick('High', 'up');

      expect(labels()).toEqual(['Critical', 'High', 'Normal', 'Low']);
      expect(el().querySelector('[data-failure]')!.textContent).toContain('Server error');
    });

    it('deactivates after a confirm that names the open tasks that keep the priority, and keeps showing the row', async () => {
      await pick('High', 'deactivate');
      const dialog = document.body.querySelector('.p-dialog')!;
      expect(dialog.textContent).toContain('Deactivate priority?');
      expect(dialog.textContent).toContain('31 open tasks keep this priority.');

      await click(dialogButton('Keep active'));
      expect(api.calls).not.toContain('update:2');

      await pick('High', 'deactivate');
      await click(dialogButton('Deactivate priority'));

      expect(api.calls).toContain('update:2');
      expect(row('High').textContent).toContain('Inactive');
      expect(TestBed.inject(LookupStore).priority(2)?.isActive).toBe(false);
      expect(el().querySelector('[data-announce]')!.textContent).toContain('High deactivated.');
    });

    it('activates at once, without a question', async () => {
      await pick('Low', 'deactivate');
      await click(dialogButton('Deactivate priority'));
      await pick('Low', 'activate');

      expect(document.body.querySelector('.p-dialog')).toBeNull();
      expect(row('Low').textContent).toContain('Active');
      expect(el().querySelector('[data-announce]')!.textContent).toContain('Low activated.');
    });

    it('makes another priority the default after a one-line confirm', async () => {
      await pick('High', 'default');
      const dialog = document.body.querySelector('.p-dialog')!;
      expect(dialog.textContent).toContain('Make High the default priority?');
      expect(dialog.textContent).toContain(
        'High is the default priority. New tasks start with it.',
      );
      expect(dialog.textContent).toContain('Normal stays available.');

      await click(dialogButton('Keep current default'));
      expect(api.calls).not.toContain('default:2');

      await pick('High', 'default');
      await click(dialogButton('Set as default'));

      expect(api.calls).toContain('default:2');
      expect(row('High').querySelector('[data-default]')).not.toBeNull();
      expect(row('Normal').querySelector('[data-default]')).toBeNull();
      expect(TestBed.inject(LookupStore).defaultPriority()?.label).toBe('High');
    });

    it('asks before deleting an unused priority and deletes it', async () => {
      await pick('Low', 'delete');
      const dialog = document.body.querySelector('.p-dialog')!;
      expect(dialog.textContent).toContain('Delete priority?');
      expect(dialog.textContent).toContain(
        "No task uses this priority. Deleting it can't be undone.",
      );

      await click(dialogButton('Keep priority'));
      expect(api.calls).not.toContain('delete:4');

      await pick('Low', 'delete');
      await click(dialogButton('Delete priority'));
      expect(labels()).not.toContain('Low');
      expect(el().querySelector('[data-announce]')!.textContent).toContain('Low deleted.');
    });

    it('reports a refused delete once, inline, and does not toast (a race, or closed tasks)', async () => {
      const toast = vi.spyOn(TestBed.inject(NotificationService), 'success');
      await pick('Low', 'delete');
      api.failNext = apiError(409, 'IN_USE', 'Tasks use this priority.');
      await click(dialogButton('Delete priority'));

      expect(labels()).toContain('Low');
      const failures = all('[data-failure]');
      expect(failures.length).toBe(1);
      expect(failures[0].textContent).toContain(
        "Tasks use Low, so it can't be deleted. Deactivate it instead.",
      );
      expect(toast).not.toHaveBeenCalled();
    });

    it('reloads and says so on a concurrency conflict', async () => {
      api.failNext = apiError(409, 'CONCURRENCY_CONFLICT', 'Changed');
      const listsBefore = api.calls.filter((c) => c === 'list').length;

      await pick('Low', 'deactivate');
      await click(dialogButton('Deactivate priority'));

      expect(el().querySelector('[data-failure]')!.textContent).toContain('Someone else changed');
      expect(api.calls.filter((c) => c === 'list').length).toBe(listsBefore + 1);
    });
  });

  describe('the New priority and Edit priority dialog (#609)', () => {
    beforeEach(() => open(true, 'Priority.Manage', 'Task.View'));

    const field = (): HTMLInputElement => document.body.querySelector('#priority-label')!;
    const dialog = (): HTMLElement => document.body.querySelector('mf-priority-dialog')!;

    async function type(input: HTMLInputElement, value: string): Promise<void> {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await settle();
    }

    async function save(): Promise<void> {
      await click(dialogButton('Save priority') ?? dialogButton('Add priority'));
    }

    it('opens Edit priority for ?edit=<id> with the name, the color, a live badge and the counter', async () => {
      await setEdit('2');

      expect(document.body.querySelector('[data-lookup-title]')!.textContent).toContain(
        'Edit priority',
      );
      expect(field().value).toBe('High');
      expect(document.body.querySelector('#priority-label-count')!.textContent).toContain('4 / 50');
      expect(document.body.querySelector<HTMLSelectElement>('#priority-color')!.value).toBe('high');
      await type(field(), 'Elevated');
      expect(dialog().querySelector('[data-preview] mf-priority-badge')!.textContent).toContain(
        'Elevated',
      );
      // The grid keeps its old name until the save.
      expect(labels()).toContain('High');
    });

    it('saves the name and the color together, updates the shared lookups and closes the dialog', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
      await setEdit('2');
      await type(field(), 'Elevated');
      const select = document.body.querySelector<HTMLSelectElement>('#priority-color')!;
      select.value = 'critical';
      select.dispatchEvent(new Event('change'));
      await settle();

      await save();

      expect(api.calls).toContain('update:2');
      expect(api.rows.find((r) => r.id === 2)).toMatchObject({
        label: 'Elevated',
        color: 'critical',
        isActive: true,
      });
      expect(labels()).toContain('Elevated');
      expect(TestBed.inject(LookupStore).priority(2)?.label).toBe('Elevated');
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ queryParams: { edit: null } }),
      );
    });

    it('does not save a color on its own: changing the select calls nothing', async () => {
      await setEdit('2');
      const select = document.body.querySelector<HTMLSelectElement>('#priority-color')!;
      select.value = 'critical';
      select.dispatchEvent(new Event('change'));
      await settle();

      expect(api.calls.filter((c) => c.startsWith('update'))).toEqual([]);
    });

    it('rejects a blank name with the summary and focus on the field, without calling the server', async () => {
      await setEdit('new');
      await save();

      expect(api.calls).not.toContain('create');
      expect(document.body.querySelector('[data-summary]')!.textContent).toContain('Enter a name.');
      expect(field().getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(field());
    });

    it('rejects an unreadable custom color (a mid gray: neither white nor dark text reaches 4.5:1) with the 4.5:1 message', async () => {
      await setEdit('new');
      await type(field(), 'Pastel');
      const select = document.body.querySelector<HTMLSelectElement>('#priority-color')!;
      select.value = 'custom';
      select.dispatchEvent(new Event('change'));
      await settle();
      const swatch = document.body.querySelector<HTMLInputElement>('input[type=color]')!;
      swatch.value = '#808080';
      swatch.dispatchEvent(new Event('input'));
      await settle();
      await save();

      expect(api.calls).not.toContain('create');
      expect(document.body.querySelector('[data-color-error]')!.textContent).toContain(
        'Text must be readable: 4.5:1 minimum',
      );
      expect(swatch.getAttribute('aria-invalid')).toBe('true');
    });

    it('adds a priority at the end with a 46 character name', async () => {
      await setEdit('new');
      expect(document.body.querySelector('[data-lookup-title]')!.textContent).toContain(
        'New priority',
      );
      const long = 'Wait for the client to confirm in writing x'.padEnd(46, 'y');
      await type(field(), long);
      await save();

      expect(api.calls).toContain('create');
      expect(labels()).toEqual(['Critical', 'High', 'Normal', 'Low', long]);
    });

    it('shows the duplicate-name message under the Name field and keeps the dialog open', async () => {
      await setEdit('2');
      await type(field(), 'Low');
      api.failNext = apiError(409, 'DUPLICATE_NAME', "A priority named 'Low' exists.", {
        label: [{ code: 'DUPLICATE', message: "A priority named 'Low' exists." }],
      });
      await save();

      expect(document.body.querySelector('#priority-label-error')!.textContent).toContain(
        "A priority named 'Low' exists.",
      );
      expect(labels()).toEqual(['Critical', 'High', 'Normal', 'Low']);
      expect(document.body.querySelector('[data-lookup-form]')).not.toBeNull();
      // Typing again clears the server's message.
      await type(field(), 'Lower');
      expect(document.body.querySelector('#priority-label-error')).toBeNull();
    });

    it('does not open for a priority that does not exist', async () => {
      await setEdit('999');
      expect(document.body.querySelector('[data-lookup-form]')).toBeNull();
    });
  });

  describe('as a priority manager without Task.View', () => {
    beforeEach(() => open(false, 'Priority.Manage'));

    it('has no Open tasks column and never offers Delete (the count is unknown)', async () => {
      expect(all('thead th').map((th) => th.textContent!.trim())).not.toContain('Open tasks');
      expect(el().querySelector('[data-open-tasks]')).toBeNull();
      await openMenu('Low');
      expect(menuIds('Low')).toEqual(['edit', 'up', 'down', 'default', 'deactivate']);
    });

    it('deactivates with a confirm that has no number in it', async () => {
      await pick('Low', 'deactivate');
      const dialog = document.body.querySelector('.p-dialog')!;
      expect(dialog.textContent).toContain("It won't be offered for new or changed tasks.");
      expect(dialog.textContent).not.toMatch(/\d+ open task/);
    });

    it('loads no status labels, and shows no error or tab strip of its own', () => {
      expect(statusApi.calls).toEqual([]);
      expect(el().querySelector('nav, [data-failure], [role="alert"]')).toBeNull();
      expect(labels().length).toBe(4);
    });
  });

  describe('without Priority.Manage', () => {
    beforeEach(() => open(true, 'Task.View'));

    it('is read-only: no menu entries, no dialog, no drag', async () => {
      expect(labels().length).toBe(4);
      expect(el().querySelector('mf-action-menu button')).toBeNull();
      expect(row('Critical').getAttribute('draggable')).toBe('false');
      await setEdit('2');
      expect(document.body.querySelector('[data-lookup-form]')).toBeNull();
    });
  });
});
