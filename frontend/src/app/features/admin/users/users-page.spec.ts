import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { IdentityAdminApi } from '../../../core/identity-admin/identity-admin-api';
import { InMemoryIdentityAdminApi } from '../../../core/identity-admin/in-memory-identity-admin-api';
import { PendingUsersStore } from '../../../core/identity-admin/pending-users.store';
import { UsersPage } from './users-page';

describe('UsersPage', () => {
  let fixture: ComponentFixture<UsersPage>;
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

  async function create(...permissions: Permission[]): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        InMemoryIdentityAdminApi,
        { provide: IdentityAdminApi, useExisting: InMemoryIdentityAdminApi },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    api = TestBed.inject(InMemoryIdentityAdminApi);
    fixture = TestBed.createComponent(UsersPage);
    await settle();
  }

  const rows = (): string[] =>
    Array.from(el().querySelectorAll('tbody tr')).map((r) =>
      r.querySelector('td')!.textContent!.trim(),
    );

  it('opens on the pending queue with counts, and publishes the pending count for the nav badge', async () => {
    await create('User.View', 'User.Manage');

    expect(q('[data-tab="pending"]').textContent).toContain('Pending access (2)');
    expect(q('[data-tab="active"]').textContent).toContain('Active (4)');
    expect(q('[data-tab="inactive"]').textContent).toContain('Inactive (1)');
    expect(rows()).toEqual(['Priya Patel', 'Tariq Mahmood']);
    expect(TestBed.inject(PendingUsersStore).count()).toBe(2);
  });

  it('shows the empty state when no one is waiting', async () => {
    await create('User.View');
    api.users.forEach((u) => u.roleIds.length === 0 && u.roleIds.push(6));
    q('[data-tab="active"]').click();
    await settle();
    q('[data-tab="pending"]').click();
    await settle();

    expect(q('[data-empty]').textContent).toContain('No one is waiting for access.');
  });

  it('searches and switches tabs', async () => {
    await create('User.View');
    q('[data-tab="active"]').click();
    await settle();
    expect(rows()).toContain('Dana Director');

    const input = q<HTMLInputElement>('[data-search]');
    input.value = 'tariq';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
    expect(rows()).toEqual(['Tariq Mahmood']);
  });

  it('grants a role to a pending user: the drawer saves, the queue shrinks', async () => {
    await create('User.View', 'User.Manage');

    await press('Grant access'); // first row: Priya Patel
    expect(q('[data-panel] h2').textContent).toContain('Priya Patel');
    expect(button('Save')!.disabled).toBe(true);

    const role = q<HTMLInputElement>('[data-role="5"]'); // Data Technician
    role.checked = true;
    role.dispatchEvent(new Event('change'));
    await settle();
    expect(button('Save')!.disabled).toBe(false);

    await press('Save');
    expect(api.users.find((u) => u.userId === 4)!.roleIds).toEqual([5]);
    expect(q('[data-tab="pending"]').textContent).toContain('Pending access (1)');
    expect(TestBed.inject(PendingUsersStore).count()).toBe(1);
    expect(q('[data-panel]').textContent).toContain('Task.View'); // effective permissions refreshed
  });

  it('asks for confirmation before deactivating and then saves', async () => {
    await create('User.View', 'User.Manage');
    q('[data-tab="active"]').click();
    await settle();
    const row = el().querySelector('[data-user="2"]')!;
    row.querySelector<HTMLButtonElement>('button')!.click();
    await settle();

    q<HTMLInputElement>('[data-status-inactive]').click();
    await settle();
    await press('Save');
    expect(q('[data-confirm]').textContent).toContain('assigned until you reassign them');
    expect(api.users.find((u) => u.userId === 2)!.isActive).toBe(true);

    await press('Confirm and save');
    expect(api.users.find((u) => u.userId === 2)!.isActive).toBe(false);
  });

  it('shows the last-admin guard message instead of silently failing', async () => {
    await create('User.View', 'User.Manage');
    api.currentUserId = 99; // not the admin, so only the last-admin rule applies
    q('[data-tab="active"]').click();
    await settle();
    el().querySelector<HTMLButtonElement>('[data-user="1"] button')!.click(); // Kim Admin, the only admin
    await settle();

    const adminRole = q<HTMLInputElement>('[data-role="1"]');
    adminRole.checked = false;
    adminRole.dispatchEvent(new Event('change'));
    await settle();
    await press('Save');

    expect(q('[data-panel-error]').textContent).toContain('At least one active System Admin');
    expect(api.users.find((u) => u.userId === 1)!.roleIds).toEqual([1]);
  });

  it('is read-only without User.Manage', async () => {
    await create('User.View');
    await press('Open');

    expect(button('Save')).toBeUndefined();
    expect(q<HTMLInputElement>('[data-role="5"]').closest('fieldset')!.disabled).toBe(true);
  });
});
