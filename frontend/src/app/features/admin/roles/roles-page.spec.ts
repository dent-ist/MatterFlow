import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { IdentityAdminApi } from '../../../core/identity-admin/identity-admin-api';
import { InMemoryIdentityAdminApi } from '../../../core/identity-admin/in-memory-identity-admin-api';
import { RolesPage, prerequisiteOf } from './roles-page';

describe('prerequisiteOf', () => {
  const catalog = new Set(['Task.View', 'Task.Assign', 'Audit.View', 'Role.Manage']);

  it('requires View of the same group for other actions', () => {
    expect(prerequisiteOf('Task.Assign', catalog)).toBe('Task.View');
  });

  it('has no prerequisite for View itself or for groups without a View', () => {
    expect(prerequisiteOf('Task.View', catalog)).toBeUndefined();
    expect(prerequisiteOf('Role.Manage', catalog)).toBeUndefined();
  });
});

describe('RolesPage', () => {
  let fixture: ComponentFixture<RolesPage>;
  let api: InMemoryIdentityAdminApi;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
    await fixture.whenStable();
  }

  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('p-button button')).find(
      (b) => b.textContent!.trim() === label,
    );

  async function press(label: string): Promise<void> {
    button(label)!.click();
    await settle();
  }

  const check = async (code: string, checked: boolean): Promise<void> => {
    const box = q<HTMLInputElement>(`[data-perm="${code}"]`);
    box.checked = checked;
    box.dispatchEvent(new Event('change'));
    await settle();
  };

  const type = async (sel: string, value: string): Promise<void> => {
    const input = q<HTMLInputElement>(sel);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };

  /** The permission filter applies as you type. */
  const search = async (value: string): Promise<void> => {
    const input = q<HTMLInputElement>('#role-permission-search');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        InMemoryIdentityAdminApi,
        { provide: IdentityAdminApi, useExisting: InMemoryIdentityAdminApi },
      ],
    });
    api = TestBed.inject(InMemoryIdentityAdminApi);
    fixture = TestBed.createComponent(RolesPage);
    await settle();
  });

  it('lists the roles with member counts and marks System Admin as locked', async () => {
    const names = Array.from(el().querySelectorAll('.mf-role .mf-name')).map((n) => n.textContent);
    expect(names[0]).toBe('System Admin');
    expect(names).toContain('Data Scientist');
    expect(q('[data-role="1"]').textContent).toContain('Built-in, locked');
    expect(q('[data-role="5"]').textContent).toContain('1 member');
  });

  it('opens System Admin read-only with no save or delete', async () => {
    q('[data-role="1"]').click();
    await settle();

    expect(q('[data-locked]').textContent).toContain('cannot be edited or deleted');
    expect(q<HTMLInputElement>('[data-name]').disabled).toBe(true);
    expect(button('Save')).toBeUndefined();
    expect(button('Delete role')).toBeUndefined();
  });

  it('creates a role from the grouped catalog and auto-selects the View prerequisite', async () => {
    await press('New role');
    await type('[data-name]', 'Auditor');
    await check('Task.Assign', true);

    expect(q<HTMLInputElement>('[data-perm="Task.View"]').checked).toBe(true);
    expect(q('[data-note]').textContent).toContain('Task.View was also selected');

    await press('Create role');
    const created = api.roles.find((r) => r.name === 'Auditor')!;
    expect(created.permissionCodes.sort()).toEqual(['Task.Assign', 'Task.View']);
    expect(
      Array.from(el().querySelectorAll('.mf-role .mf-name')).map((n) => n.textContent),
    ).toContain('Auditor');
  });

  it('clearing View clears the dependent permissions of the group', async () => {
    q('[data-role="5"]').click(); // Data Technician: has Task.View and Task.Complete
    await settle();
    await check('Task.View', false);

    expect(q<HTMLInputElement>('[data-perm="Task.Complete"]').checked).toBe(false);
    expect(q('[data-note]').textContent).toContain('Task.Complete was also cleared');
  });

  it('selecting a Dashboard tab permission selects Dashboard.View; clearing View clears every tab with one short note', async () => {
    await press('New role');
    await check('Dashboard.ViewSwimlane', true);
    expect(q<HTMLInputElement>('[data-perm="Dashboard.View"]').checked).toBe(true);
    expect(q('[data-note]').textContent).toContain(
      'Dashboard.View was also selected because Dashboard.ViewSwimlane needs it.',
    );

    await check('Dashboard.ViewSummary', true);
    await check('Dashboard.ViewUsers', true);
    await check('Dashboard.View', false);

    for (const tab of ['Summary', 'Swimlane', 'Users', 'Breakdowns', 'Trends']) {
      expect(q<HTMLInputElement>(`[data-perm="Dashboard.View${tab}"]`).checked).toBe(false);
    }
    expect(q('[data-note]').textContent).toBe(
      'Dashboard.ViewSummary, Dashboard.ViewSwimlane, Dashboard.ViewUsers were also cleared because they need Dashboard.View.',
    );
  });

  it('keeps the Dashboard dependency rule independent of other groups', async () => {
    await press('New role');
    await check('Task.View', true);
    await check('Dashboard.ViewTrends', true);
    await check('Dashboard.View', false);
    expect(q<HTMLInputElement>('[data-perm="Task.View"]').checked).toBe(true);
    expect(q<HTMLInputElement>('[data-perm="Dashboard.ViewTrends"]').checked).toBe(false);
  });

  it('lines the form fields up in one column: same left edge and width for name, description, search and copy', async () => {
    await press('New role');
    const fields = ['[data-name]', '[data-description]', '#role-permission-search', '[data-copy]'];
    for (const sel of fields) expect(q(sel).classList.contains('mf-control')).toBe(true);
    // Every control sits in an .mf-fld whose label is a shared .mf-label above it.
    for (const sel of fields) {
      const wrap = q(sel).closest('.mf-fld')!;
      expect(wrap.querySelector('label.mf-label')).not.toBeNull();
    }
  });

  it('filters permissions and copies from another role', async () => {
    await press('New role');
    await search('pod.');
    const groups = Array.from(el().querySelectorAll('[data-group]')).map((g) =>
      g.getAttribute('data-group'),
    );
    expect(groups).toEqual(['Pod']);

    await search('');
    const select = q<HTMLSelectElement>('[data-copy]');
    select.value = '6'; // Data Scientist
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(q<HTMLInputElement>('[data-perm="Task.View"]').checked).toBe(true);
    expect(q('[data-note]').textContent).toContain('copied from Data Scientist');
  });

  it('requires a name and reports a duplicate name on the field', async () => {
    await press('New role');
    await press('Create role');
    expect(q('[data-name-error]').textContent).toContain('Enter a name.');
    expect(q('#role-name').getAttribute('aria-invalid')).toBe('true');
    expect(q('#role-name').getAttribute('aria-describedby')).toBe('role-name-error');

    await type('[data-name]', 'Pod Lead');
    await press('Create role');
    expect(q('[data-name-error]').textContent).toContain('already exists');
  });

  it('marks the name required, offers Cancel after the primary button and tracks unsaved edits', async () => {
    await press('New role');
    expect(q('label[for="role-name"]').textContent).toContain('(required)');
    const labels = Array.from(el().querySelectorAll('.mf-actions p-button')).map((b) =>
      b.textContent!.trim(),
    );
    expect(labels.slice(0, 2)).toEqual(['Create role', 'Cancel']);

    const page = fixture.componentInstance;
    expect(page.hasUnsavedChanges()).toBe(false);
    await type('[data-name]', 'Draft');
    expect(page.hasUnsavedChanges()).toBe(true);
    await press('Cancel');
    expect(el().querySelector('[data-editor]')).toBeNull();
    expect(page.hasUnsavedChanges()).toBe(false);
  });

  async function confirmDelete(): Promise<void> {
    await press('Delete role'); // opens the confirmation
    const confirm = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.p-dialog button'),
    ).find((b) => b.textContent!.trim() === 'Delete role')!;
    confirm.click();
    await settle();
  }

  it('asks for confirmation, blocks deleting a role in use and deletes an unused one', async () => {
    q('[data-role="5"]').click(); // Data Technician has a member
    await settle();
    await press('Delete role');
    expect(api.roles.some((r) => r.roleId === 5)).toBe(true);
    expect(document.body.querySelector('.p-dialog')?.textContent).toContain('Delete role?');
    await confirmDelete();
    expect(q('[data-error]').textContent).toMatch(
      /has this role\. Remove them from it before deleting/,
    );
    expect(api.roles.some((r) => r.roleId === 5)).toBe(true);

    q('[data-role="4"]').click(); // Pod Lead has no members
    await settle();
    await confirmDelete();
    expect(api.roles.some((r) => r.roleId === 4)).toBe(false);
  });
});
