import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { USER_TIME_ZONE } from '../../../core/time/clock';
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
    await createWith(() => undefined, ...permissions);
  }

  async function createWith(
    prepare: (api: InMemoryIdentityAdminApi) => void,
    ...permissions: Permission[]
  ): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        { provide: USER_TIME_ZONE, useValue: 'America/New_York' },
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        InMemoryIdentityAdminApi,
        { provide: IdentityAdminApi, useExisting: InMemoryIdentityAdminApi },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    api = TestBed.inject(InMemoryIdentityAdminApi);
    prepare(api);
    fixture = TestBed.createComponent(UsersPage);
    await settle();
  }

  /** Picks a status in the filter next to the search box. */
  async function chooseStatus(value: string): Promise<void> {
    const select = q<HTMLSelectElement>('#users-status');
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle();
  }

  const statusOptions = (): string[] =>
    Array.from(el().querySelectorAll('#users-status option')).map((o) => o.textContent!.trim());

  const rows = (): string[] =>
    Array.from(el().querySelectorAll('tbody tr')).map((r) =>
      r.querySelector('td')!.textContent!.trim(),
    );

  it('opens on the pending queue with counts, and publishes the pending count for the nav badge', async () => {
    await create('User.View', 'User.Manage');

    expect(statusOptions()).toEqual(['Pending access (2)', 'Active', 'Inactive', 'All']);
    expect(q<HTMLSelectElement>('#users-status').value).toBe('pending');
    expect(rows()).toEqual(['Priya Patel', 'Tariq Mahmood']);
    expect(TestBed.inject(PendingUsersStore).count()).toBe(2);
  });

  it('opens on Active when no one is waiting, and shows no pending cue', async () => {
    await createWith(
      (a) => a.users.forEach((u) => u.roleIds.length === 0 && u.roleIds.push(6)),
      'User.View',
    );

    expect(q<HTMLSelectElement>('#users-status').value).toBe('active');
    expect(statusOptions()[0]).toBe('Pending access (0)');
    expect(el().querySelector('[data-pending-cue]')).toBeNull();
  });

  it('keeps a visible pending cue while another status is shown, and All lists everyone', async () => {
    await create('User.View');
    await chooseStatus('active');
    expect(q('[data-pending-cue]').textContent).toContain('2 waiting for access');

    await chooseStatus('all');
    expect(rows()).toEqual(expect.arrayContaining(['Priya Patel', 'Dana Director']));
    expect(TestBed.inject(Router).url).toContain('status=all');

    q('[data-pending-cue]').click();
    await settle();
    expect(q<HTMLSelectElement>('#users-status').value).toBe('pending');
  });

  it('shows the empty state when no one is waiting', async () => {
    await create('User.View');
    api.users.forEach((u) => u.roleIds.length === 0 && u.roleIds.push(6));
    await chooseStatus('active');
    await chooseStatus('pending');

    expect(q('[data-empty]').textContent).toContain('No one is waiting for access.');
  });

  it('searches and switches tabs', async () => {
    await create('User.View');
    await chooseStatus('active');
    expect(rows()).toContain('Dana Director');

    const input = q<HTMLInputElement>('#users-search');
    input.value = 'dana';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
    expect(rows()).toEqual(['Dana Director']);
  });

  it('grants a role to a pending user: the drawer saves, the queue shrinks', async () => {
    await create('User.View', 'User.Manage');

    await press('Grant access'); // first row: Priya Patel
    expect(q('[data-panel] h2').textContent).toContain('Priya Patel');
    expect(button('Save changes')!.disabled).toBe(true);

    const role = q<HTMLInputElement>('[data-role="5"]'); // Data Technician
    role.checked = true;
    role.dispatchEvent(new Event('change'));
    await settle();
    expect(button('Save changes')!.disabled).toBe(false);

    await press('Save changes');
    expect(api.users.find((u) => u.userId === 4)!.roleIds).toEqual([5]);
    expect(statusOptions()[0]).toBe('Pending access (1)');
    expect(TestBed.inject(PendingUsersStore).count()).toBe(1);
    expect(q('[data-panel]').textContent).toContain('Task.View'); // effective permissions refreshed
  });

  it('asks for confirmation before deactivating and then saves', async () => {
    await create('User.View', 'User.Manage');
    await chooseStatus('active');
    const row = el().querySelector('[data-user="2"]')!;
    row.querySelector<HTMLButtonElement>('button')!.click();
    await settle();

    q<HTMLInputElement>('[data-status-inactive]').click();
    await settle();
    await press('Save changes');
    expect(q('[data-confirm]').textContent).toContain('assigned until you reassign them');
    expect(api.users.find((u) => u.userId === 2)!.isActive).toBe(true);

    await press('Confirm and save');
    expect(api.users.find((u) => u.userId === 2)!.isActive).toBe(false);
  });

  it('shows the last-admin guard message instead of silently failing', async () => {
    await create('User.View', 'User.Manage');
    api.currentUserId = 99; // not the admin, so only the last-admin rule applies
    await chooseStatus('active');
    el().querySelector<HTMLButtonElement>('[data-user="1"] button')!.click(); // Kim Admin, the only admin
    await settle();

    const adminRole = q<HTMLInputElement>('[data-role="1"]');
    adminRole.checked = false;
    adminRole.dispatchEvent(new Event('change'));
    await settle();
    await press('Save changes');

    expect(q('[data-panel-error]').textContent).toContain('At least one active System Admin');
    expect(api.users.find((u) => u.userId === 1)!.roleIds).toEqual([1]);
  });

  it('is read-only without User.Manage', async () => {
    await create('User.View');
    await press('Open');

    expect(button('Save changes')).toBeUndefined();
    expect(q<HTMLInputElement>('[data-role="5"]').closest('fieldset')!.disabled).toBe(true);
  });

  describe('availability', () => {
    const chips = (): string[] =>
      Array.from(el().querySelectorAll('tbody tr')).map((r) =>
        r.querySelector('[data-availability-chip]')!.textContent!.trim(),
      );

    it('shows an availability chip per user: Available, Off hours, Out of office until a date', async () => {
      await createWith(
        (a) => {
          a.users[1].availability = {
            state: 'OUT_OF_OFFICE',
            outUntil: '2027-03-21T04:00:00Z',
            note: undefined,
          };
          a.users[0].availability = { state: 'OFF_HOURS', outUntil: undefined, note: undefined };
        },
        'User.View',
        'User.Manage',
      );
      await chooseStatus('active');
      expect(chips()).toEqual(['Out of office until Mar 20, 2027', 'Off hours']);
    });

    it('filters by availability and remembers the choice in the address', async () => {
      await createWith(
        (a) => {
          a.users[1].availability = {
            state: 'OUT_OF_OFFICE',
            outUntil: undefined,
            note: undefined,
          };
        },
        'User.View',
        'User.Manage',
      );
      await chooseStatus('all');
      expect(rows().length).toBeGreaterThan(2);

      const select = q<HTMLSelectElement>('#users-availability');
      expect(Array.from(select.options).map((o) => o.textContent!.trim())).toEqual([
        'All',
        'Available',
        'Out of office',
        'Off hours',
      ]);
      select.value = 'OUT_OF_OFFICE';
      select.dispatchEvent(new Event('change'));
      await settle();
      expect(rows()).toEqual(['Dana Director']);

      select.value = 'OFF_HOURS';
      select.dispatchEvent(new Event('change'));
      await settle();
      expect(el().textContent).toContain('No users match these filters.');
    });

    it('offers "Edit availability" only with User.Manage', async () => {
      await create('User.View');
      await chooseStatus('active');
      expect(el().querySelector('[data-edit-availability]')).toBeNull();
    });

    it('opens the availability dialog for the chosen user', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('active');
      el()
        .querySelector<HTMLButtonElement>('[data-user="2"] [data-edit-availability] button')!
        .click();
      await settle();
      const dialog = document.querySelector('.p-dialog');
      expect(dialog?.textContent).toContain('Availability of Dana Director');
    });
  });
});
