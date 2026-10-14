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
    expect(q('[data-role="5"]').textContent).toContain('1 members');
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

    await press('Save');
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

  it('filters permissions and copies from another role', async () => {
    await press('New role');
    await type('[data-filter]', 'pod.');
    const groups = Array.from(el().querySelectorAll('[data-group]')).map((g) =>
      g.getAttribute('data-group'),
    );
    expect(groups).toEqual(['Pod']);

    await type('[data-filter]', '');
    const select = q<HTMLSelectElement>('[data-copy]');
    select.value = '6'; // Data Scientist
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(q<HTMLInputElement>('[data-perm="Task.View"]').checked).toBe(true);
    expect(q('[data-note]').textContent).toContain('copied from Data Scientist');
  });

  it('requires a name and reports a duplicate name on the field', async () => {
    await press('New role');
    await press('Save');
    expect(q('[data-name-error]').textContent).toContain('Name is required');

    await type('[data-name]', 'Pod Lead');
    await press('Save');
    expect(q('[data-name-error]').textContent).toContain('already exists');
  });

  it('blocks deleting a role in use and deletes an unused one', async () => {
    q('[data-role="5"]').click(); // Data Technician has a member
    await settle();
    await press('Delete role');
    expect(q('[data-error]').textContent).toContain('Remove them first');
    expect(api.roles.some((r) => r.roleId === 5)).toBe(true);

    q('[data-role="4"]').click(); // Pod Lead has no members
    await settle();
    await press('Delete role');
    expect(api.roles.some((r) => r.roleId === 4)).toBe(false);
  });
});
