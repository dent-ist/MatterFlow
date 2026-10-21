import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AssetLinkRolesClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { FakeAssetLinkRolesClient, apiError } from '../../../core/lookups/lookups-testing';
import { AssetLinkRolesPage } from './asset-link-roles-page';

describe('AssetLinkRolesPage (#640, #641, #642)', () => {
  let api: FakeAssetLinkRolesClient;
  let fixture: ComponentFixture<AssetLinkRolesPage>;
  const el = (): HTMLElement => fixture.nativeElement;
  const all = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = el()): T[] =>
    Array.from(root.querySelectorAll<T>(sel));
  const row = (name: string): HTMLElement =>
    el().querySelector<HTMLElement>(`[data-row="${name}"]`)!;
  const names = (): string[] => all('[data-row]').map((r) => r.getAttribute('data-row')!);

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

  async function pick(name: string, action: string): Promise<void> {
    await click(row(name).querySelector('button[data-overflow]'));
    await click(row(name).querySelector(`[data-action="${action}"]`));
  }

  const menuIds = (name: string): string[] =>
    all('[data-action]', row(name)).map((b) => b.getAttribute('data-action')!);

  /** The link counts of the Link Roles review: Source 14, Destination 3, Subject and Result unused. */
  function withCounts(): void {
    const counts: Record<string, number> = { Source: 14, Destination: 3, Subject: 0, Result: 0 };
    api.rows = api.rows.map((r) => ({ ...r, linkCount: counts[r.name] }));
  }

  async function open(known: boolean, ...permissions: Permission[]): Promise<void> {
    api = new FakeAssetLinkRolesClient();
    if (known) withCounts();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: AssetLinkRolesClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(AssetLinkRolesPage);
    await settle();
  }

  async function setEdit(value: string | undefined): Promise<void> {
    fixture.componentRef.setInput('edit', value);
    await settle();
  }

  const nameInput = (): HTMLInputElement =>
    document.body.querySelector<HTMLInputElement>('#link-role-name')!;

  async function type(value: string): Promise<void> {
    nameInput().value = value;
    nameInput().dispatchEvent(new Event('input'));
    await settle();
  }

  describe('as an asset type manager who may see tasks and assets', () => {
    beforeEach(() => open(true, 'AssetType.Manage', 'Task.View', 'Asset.View'));

    it('lists the roles in order on the grid contract: order, name, links, status, one menu', () => {
      expect(names()).toEqual(['Source', 'Destination', 'Subject', 'Result']);
      const table = el().querySelector('table.mf-grid')!;
      expect(all('thead th', table).map((th) => th.textContent!.trim())).toEqual([
        'Order',
        'Name',
        'Links',
        'Status',
        'Actions',
      ]);
      expect(all('[data-order]').map((c) => c.textContent!.trim())).toEqual(['1', '2', '3', '4']);
      expect(all('[data-links]').map((c) => c.textContent!.trim())).toEqual(['14', '3', '0', '0']);
      for (const r of all('[data-row]')) {
        expect(all('mf-action-menu', r).length).toBe(1);
        expect(all('button', r).length).toBe(1); // no inline Rename, Delete, move buttons or checkbox
        expect(r.querySelector('mf-active-badge')!.textContent).toContain('Active');
      }
      // No Add form under the table.
      expect(el().querySelector('[data-new-name], .add')).toBeNull();
    });

    it('clamps a long name (the whole name is the tooltip)', async () => {
      const long = 'L'.repeat(50);
      api.rows = [{ ...api.rows[0], name: long }, ...api.rows.slice(1)];
      fixture.destroy();
      fixture = TestBed.createComponent(AssetLinkRolesPage);
      await settle();
      const link = row(long).querySelector<HTMLElement>('.mf-name')!;
      expect(link.getAttribute('title')).toBe(long);
    });

    it('opens Rename from the name link with ?edit=<id>', () => {
      const link = row('Source').querySelector<HTMLAnchorElement>('[data-edit]')!;
      expect(link.getAttribute('href')).toBe('/admin/asset-types?tab=link-roles&edit=1');
    });

    it('offers Delete only for a role no link uses; a used role offers Deactivate (#641)', async () => {
      await click(row('Source').querySelector('button[data-overflow]'));
      expect(menuIds('Source')).toEqual(['rename', 'up', 'down', 'deactivate']);
      await click(row('Source').querySelector('button[data-overflow]')); // closes
      await click(row('Result').querySelector('button[data-overflow]'));
      expect(menuIds('Result')).toEqual(['rename', 'up', 'down', 'deactivate', 'delete']);
    });

    it('deactivates with the impact line "14 links keep this role"', async () => {
      await pick('Source', 'deactivate');
      expect(document.body.querySelector('.p-dialog')!.textContent).toContain(
        '14 links keep this role.',
      );
      await click(dialogButton('Deactivate link role'));
      expect(api.rows.find((r) => r.name === 'Source')!.isActive).toBe(false);
      expect(row('Source').textContent).toContain('Inactive');
      // Activating is one click, no question.
      await pick('Source', 'activate');
      expect(api.rows.find((r) => r.name === 'Source')!.isActive).toBe(true);
    });

    it('deletes an unused role after one confirmation and reports a server refusal once', async () => {
      await pick('Result', 'delete');
      expect(document.body.querySelector('.p-dialog')!.textContent).toContain('Delete link role?');
      expect(document.body.querySelector('.p-dialog')!.textContent).toContain(
        'No link uses this role.',
      );
      api.failNext = apiError(409, 'IN_USE', 'Links use this role.');
      await click(dialogButton('Delete link role'));
      expect(names()).toContain('Result');
      expect(all('[data-failure]')).toHaveLength(1);
      expect(el().querySelector('[data-failure]')!.textContent).toContain(
        "Links use Result, so it can't be deleted. Deactivate it instead.",
      );

      await pick('Result', 'delete');
      await click(dialogButton('Delete link role'));
      expect(names()).not.toContain('Result');
    });

    it('moves a role with Move up and Move down in the menu, and by drag and drop', async () => {
      await pick('Destination', 'up');
      expect(names()).toEqual(['Destination', 'Source', 'Subject', 'Result']);
      await pick('Destination', 'down');
      expect(names()).toEqual(['Source', 'Destination', 'Subject', 'Result']);

      row('Destination').dispatchEvent(new Event('dragstart', { bubbles: true }));
      row('Result').dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
      await settle();
      expect(names()).toEqual(['Source', 'Subject', 'Result', 'Destination']);
    });

    it('the first Move up and the last Move down say why they cannot', async () => {
      await click(row('Source').querySelector('button[data-overflow]'));
      expect(row('Source').querySelector('[data-action="up"]')!.textContent).toContain(
        'Already first.',
      );
      await click(row('Source').querySelector('button[data-overflow]'));
      await click(row('Result').querySelector('button[data-overflow]'));
      expect(row('Result').querySelector('[data-action="down"]')!.textContent).toContain(
        'Already last.',
      );
    });

    it('adds a role in the New link role dialog with a counter of 50, and shows the duplicate message with the field', async () => {
      await setEdit('new');
      expect(document.body.querySelector('.p-dialog')!.textContent).toContain('New link role');
      expect(document.body.querySelector('.p-dialog')!.textContent).toContain('0 / 50');
      await type('Related');
      await click(dialogButton('Add link role'));
      expect(names()).toEqual(['Source', 'Destination', 'Subject', 'Result', 'Related']);
      expect(api.calls).toContain('create');

      await setEdit('new');
      await type('source');
      api.failNext = apiError(409, 'DUPLICATE_NAME', "A link role named 'source' exists.", {
        name: [{ code: 'DUPLICATE', message: "A link role named 'source' exists." }],
      });
      await click(dialogButton('Add link role'));
      expect(document.body.querySelector('.p-dialog')!.textContent).toContain(
        "A link role named 'source' exists.",
      );
      expect(nameInput().getAttribute('aria-invalid')).toBe('true');
    });

    it('asks for a name before it sends anything', async () => {
      await setEdit('new');
      await click(dialogButton('Add link role'));
      expect(api.calls).not.toContain('create');
      expect(document.body.querySelector('.p-dialog')!.textContent).toContain('Enter a name.');
    });

    it('renames in the same dialog, starting from the current name', async () => {
      await setEdit('4');
      expect(document.body.querySelector('.p-dialog')!.textContent).toContain('Rename link role');
      expect(nameInput().value).toBe('Result');
      await type('Output');
      await click(dialogButton('Save name'));
      expect(names()).toContain('Output');
    });

    it('reports an unsaved name to the leave guard only while the dialog holds a change', async () => {
      const page = fixture.componentInstance;
      expect(page.hasUnsavedChanges()).toBe(false);
      await setEdit('new');
      expect(page.hasUnsavedChanges()).toBe(false);
      await type('Half typed');
      expect(page.hasUnsavedChanges()).toBe(true);
    });

    it('reports the active count to the tab and announces changes politely', async () => {
      await pick('Subject', 'deactivate');
      await click(dialogButton('Deactivate link role'));
      expect(el().querySelector('[data-announce]')!.textContent).toContain('Subject deactivated.');
      expect(el().querySelector('[data-announce]')!.getAttribute('aria-live')).toBe('polite');
    });
  });

  describe('without Task.View or Asset.View the page cannot know the count', () => {
    beforeEach(() => open(false, 'AssetType.Manage'));

    it('shows no Links column and no number, and offers no Delete (Deactivate only)', async () => {
      const table = el().querySelector('table.mf-grid')!;
      expect(all('thead th', table).map((th) => th.textContent!.trim())).toEqual([
        'Order',
        'Name',
        'Status',
        'Actions',
      ]);
      expect(el().querySelector('[data-links]')).toBeNull();
      await click(row('Result').querySelector('button[data-overflow]'));
      expect(menuIds('Result')).toEqual(['rename', 'up', 'down', 'deactivate']);
    });

    it('still says how many links keep the role only when it knows', async () => {
      await pick('Source', 'deactivate');
      const body = document.body.querySelector('.p-dialog')!.textContent!;
      expect(body).not.toMatch(/\d+ links? keep/);
      expect(body).toContain("It won't be offered for new links.");
    });
  });

  describe('without AssetType.Manage', () => {
    beforeEach(() => open(true, 'Task.View', 'Asset.View'));

    it('is read-only: no menu, no link to Rename, no dialog', async () => {
      expect(names().length).toBe(4);
      expect(el().querySelector('mf-action-menu button, [data-edit]')).toBeNull();
      await setEdit('new');
      expect(document.body.querySelector('.p-dialog')).toBeNull();
      expect(row('Source').getAttribute('draggable')).toBe('false');
    });
  });

  it('shows the error state with Retry that loads again', async () => {
    api = new FakeAssetLinkRolesClient();
    api.failNext = apiError(500, 'INTERNAL_ERROR', 'boom');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideFakeMe(new FakeMeApi(withPermissions('AssetType.Manage'))),
        { provide: AssetLinkRolesClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(AssetLinkRolesPage);
    await settle();
    expect(el().querySelector('[data-error]')).not.toBeNull();
    await click(el().querySelector('[data-error] button'));
    expect(names()).toHaveLength(4);
    expect(TestBed.inject(Router)).toBeTruthy();
  });
});
