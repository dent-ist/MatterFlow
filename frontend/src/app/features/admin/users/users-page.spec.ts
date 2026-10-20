import { NotificationService } from '../../../core/notify/notification.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { ApiError } from '../../../core/http/api-error';
import { UndoService } from '../../../core/notify/undo.service';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { IdentityAdminApi } from '../../../core/identity-admin/identity-admin-api';
import { InMemoryIdentityAdminApi } from '../../../core/identity-admin/in-memory-identity-admin-api';
import { PendingUsersStore } from '../../../core/identity-admin/pending-users.store';
import { UsersPage } from './users-page';

describe('UsersPage', () => {
  let fixture: ComponentFixture<UsersPage>;
  let api: InMemoryIdentityAdminApi;
  /** Address the page starts on (the filters are read from it). */
  let startUrl = '/admin/users';
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
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: USER_TIME_ZONE, useValue: 'America/New_York' },
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        InMemoryIdentityAdminApi,
        { provide: IdentityAdminApi, useExisting: InMemoryIdentityAdminApi },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    api = TestBed.inject(InMemoryIdentityAdminApi);
    prepare(api);
    await TestBed.inject(Router).navigateByUrl(startUrl);
    fixture = TestBed.createComponent(UsersPage);
    await settle();
  }

  beforeEach(() => (startUrl = '/admin/users'));

  /** Opens the filter row (it is closed by default). */
  async function openRow(): Promise<void> {
    if (el().querySelector('[data-filter-row]')) return;
    q('[data-filters-toggle]').click();
    await settle();
  }

  const control = <T extends HTMLElement = HTMLElement>(column: string): T =>
    q<T>(`[aria-label="Filter by ${column}"]`);

  /** Picks a status in the Status column filter. */
  async function chooseStatus(value: string): Promise<void> {
    await openRow();
    const select = control<HTMLSelectElement>('Status');
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle();
  }

  const statusOptions = (): string[] =>
    Array.from(control<HTMLSelectElement>('Status').options).map((o) => o.textContent!.trim());

  const rows = (): string[] =>
    Array.from(el().querySelectorAll('tbody tr')).map((r) =>
      r.querySelector('td')!.textContent!.trim(),
    );

  it('opens on the pending queue with counts, and publishes the pending count for the nav badge', async () => {
    await create('User.View', 'User.Manage');
    await openRow();

    expect(statusOptions()).toEqual(['Pending access (2)', 'Active', 'Inactive', 'All']);
    expect(control<HTMLSelectElement>('Status').value).toBe('pending');
    // The default is shown, not counted.
    expect(el().querySelector('[data-filter-count]')).toBeNull();
    expect(rows()).toEqual(['Priya Patel', 'Tariq Mahmood']);
    expect(TestBed.inject(PendingUsersStore).count()).toBe(2);
  });

  it('shows First seen as the day only on one line, with the full time as its tooltip (the time made every row five lines high)', async () => {
    await create('User.View', 'User.Manage');
    const cell = q('tbody tr td.us-seen');
    expect(cell.textContent!.trim()).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(cell.getAttribute('title')).toMatch(/\d{1,2}:\d{2}\s?[AP]M/);
  });

  it('opens on Active when no one is waiting, and shows no pending cue', async () => {
    await createWith(
      (a) => a.users.forEach((u) => u.roleIds.length === 0 && u.roleIds.push(6)),
      'User.View',
    );

    await openRow();
    expect(control<HTMLSelectElement>('Status').value).toBe('active');
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
    expect(control<HTMLSelectElement>('Status').value).toBe('pending');
  });

  it('shows the empty state when no one is waiting', async () => {
    await create('User.View');
    api.users.forEach((u) => u.roleIds.length === 0 && u.roleIds.push(6));
    await chooseStatus('active');
    await chooseStatus('pending');

    expect(q('td[data-empty]').textContent).toContain('No one is waiting for access.');
  });

  it('has column filters instead of a search box and two selects, closed by default', async () => {
    await create('User.View');

    expect(
      el().querySelector('#users-search, #users-status, #users-availability, mf-search-box'),
    ).toBeNull();
    expect(el().querySelector('[data-filter-row]')).toBeNull();
    await openRow();
    for (const column of [
      'Name',
      'Windows account',
      'First seen',
      'Email',
      'Roles',
      'Availability',
      'Status',
    ]) {
      expect(
        el().querySelector(`[aria-label^="Filter by ${column}"]`),
        `Filter by ${column}`,
      ).not.toBeNull();
    }
    // Status is a column now.
    expect(
      Array.from(el().querySelectorAll('thead th')).map((th) => th.textContent!.trim()),
    ).toContain('Status');
    expect(q('[data-user="4"] [data-status]').textContent).toContain('Pending access');
  });

  it('filters by name, as you type or on Enter, and writes it to the address', async () => {
    await create('User.View');
    await chooseStatus('active');
    expect(rows()).toContain('Dana Director');

    const input = control<HTMLInputElement>('Name');
    input.value = 'dana';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
    expect(rows()).toEqual(['Dana Director']);
    expect(TestBed.inject(Router).url).toContain('name=dana');
    expect(q('[data-filter-count]').textContent).toBe('(2)'); // Name, and Status changed from the default
  });

  it('sends the column filters of the address to the server: name, account, email, roles, availability, first seen', async () => {
    startUrl =
      '/admin/users?status=all&name=%20ana&account=dd&email=firm&roleId=2&roleId=5&availability=OFF_HOURS&registeredFrom=2026-10-01&registeredTo=2026-10-31';
    const list = vi.fn();
    await createWith((a) => {
      const real = a.listUsers.bind(a);
      a.listUsers = (query) => {
        list(query);
        return real(query);
      };
    }, 'User.View');

    expect(list).toHaveBeenLastCalledWith({
      status: 'all',
      name: 'ana',
      account: 'dd',
      email: 'firm',
      roleIds: [2, 5],
      availability: 'OFF_HOURS',
      registeredFrom: '2026-10-01',
      registeredTo: '2026-10-31',
      page: 1,
      pageSize: 25,
    });
    // The link opens the row with the values in it: all seven filters count, the status is a change from the default.
    expect(control<HTMLInputElement>('Name').value).toBe('ana');
    expect(control<HTMLInputElement>('Windows account').value).toBe('dd');
    expect(q('[data-filter-count]').textContent).toBe('(7)');
  });

  it('shows the filtered empty state inside the table with Clear filters, keeping the headers and the row', async () => {
    startUrl = '/admin/users?status=all&name=nobody-like-this';
    await create('User.View');

    expect(q('td[data-empty="filtered"]').textContent).toContain('No users match these filters');
    expect(el().querySelector('thead th')).not.toBeNull();
    expect(el().querySelector('[data-filter-row]')).not.toBeNull();
    expect(el().querySelector('mf-pager')).toBeNull();
    q('td[data-empty] button').click();
    await settle();
    expect(TestBed.inject(Router).url).not.toContain('name=');
    expect(rows().length).toBeGreaterThan(0);
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
    await openRow();
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

      const select = control<HTMLSelectElement>('Availability');
      expect(Array.from(select.options).map((o) => o.textContent!.trim())).toEqual([
        'Any',
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
      expect(el().textContent).toContain('No users match these filters');
    });

    it('offers "Edit availability" only with User.Manage', async () => {
      await create('User.View');
      await chooseStatus('active');
      expect(el().querySelector('[data-edit-availability]')).toBeNull();
    });

    it('says "Scroll sideways" only while the list is wider than its box (the Availability column can be out of sight)', async () => {
      const callbacks: (() => void)[] = [];
      const original = globalThis.ResizeObserver;
      globalThis.ResizeObserver = class {
        constructor(callback: () => void) {
          callbacks.push(callback);
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      } as unknown as typeof ResizeObserver;
      try {
        await create('User.View');
        await chooseStatus('active');
        const hint = q('[data-scroll-hint]');
        expect(hint.hidden).toBe(true);
        const area = q('.mf-table-wrap');
        Object.defineProperty(area, 'clientWidth', { value: 600, configurable: true });
        Object.defineProperty(area, 'scrollWidth', { value: 1000, configurable: true });
        callbacks.forEach((c) => c());
        fixture.detectChanges();
        expect(hint.hidden).toBe(false);
        expect(hint.textContent).toContain('Scroll sideways to see every column.');
        Object.defineProperty(area, 'scrollWidth', { value: 600, configurable: true });
        callbacks.forEach((c) => c());
        fixture.detectChanges();
        expect(hint.hidden).toBe(true);
      } finally {
        globalThis.ResizeObserver = original;
      }
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

  describe('Pods column (inline assignment)', () => {
    const podCell = (userId: number): HTMLElement =>
      q(`[data-user="${userId}"] [data-pods-cell] mf-user-pods-cell`);
    const chipsOf = (userId: number): string[] =>
      Array.from(podCell(userId).querySelectorAll('[data-pod-chip]')).map((c) =>
        c.textContent!.replace(/\s+/g, ' ').trim(),
      );
    const trigger = (userId: number): HTMLButtonElement =>
      podCell(userId).querySelector<HTMLButtonElement>('[data-pods-trigger]')!;
    const popover = (): HTMLElement => q('[data-pods-popover]');
    async function pick(userId: number, ...podIds: number[]): Promise<void> {
      trigger(userId).click();
      await settle();
      for (const id of podIds) {
        q(`[data-pod-option="${id}"]`).click();
        await settle();
      }
    }

    async function applyPicked(): Promise<void> {
      q('[data-pods-apply]').click();
      await settle();
    }

    const withPods = (a: InMemoryIdentityAdminApi): void => {
      a.pods.push(
        { podId: 1, name: 'Processing', isActive: true },
        { podId: 2, name: 'Review', isActive: true },
        { podId: 3, name: 'Intake', isActive: true },
        { podId: 4, name: 'Legacy', isActive: false },
      );
      a.users[2].podIds = [1, 2];
      a.users[2].primaryPodId = 1;
    };

    it("shows each user's pods as chips with the primary pod starred, and No pod when empty", async () => {
      await createWith(withPods, 'User.View');
      expect(chipsOf(3)).toEqual(['Processing Primary', 'Review']);
      expect(podCell(4).textContent).toContain('No pod');
      expect(
        Array.from(el().querySelectorAll('thead th')).map((th) => th.textContent!.trim()),
      ).toContain('Pods');
    });

    it('is read-only without Pod.ManageMembers (chips only)', async () => {
      await createWith(withPods, 'User.View', 'User.Manage', 'Pod.Manage');
      expect(el().querySelector('[data-pods-trigger]')).toBeNull();
      expect(chipsOf(3)).toEqual(['Processing Primary', 'Review']);
    });

    it('gives the button a name with the visible pods and the person', async () => {
      await createWith(withPods, 'User.View', 'Pod.ManageMembers');
      expect(trigger(3).getAttribute('aria-label')).toBe(
        'Pods: Processing (primary), Review, change pods of Tariq Mahmood',
      );
      expect(trigger(4).getAttribute('aria-label')).toBe('Pods: none, change pods of Priya Patel');
    });

    it('assigns two pods in one request, makes the first the primary and offers one Undo', async () => {
      await createWith(withPods, 'User.View', 'Pod.ManageMembers');
      const call = vi.spyOn(api, 'setUserPods');
      await pick(4, 1, 3); // Priya has no pods yet
      await applyPicked();

      expect(call).toHaveBeenCalledTimes(1);
      expect(call).toHaveBeenCalledWith(4, {
        podIds: [1, 3],
        primaryPodId: 1,
        expectedPodIds: [],
        expectedPrimaryPodId: undefined,
      });
      expect(chipsOf(4)).toEqual(['Intake', 'Processing Primary']);
      const offer = TestBed.inject(UndoService).current();
      expect(offer?.message).toBe('Pods of Priya Patel set to Intake, Processing (primary).');
      expect(document.activeElement).toBe(trigger(4));
    });

    it('Undo puts the previous pods back in one request', async () => {
      await createWith(withPods, 'User.View', 'Pod.ManageMembers');
      await pick(4, 1);
      await applyPicked();
      expect(chipsOf(4)).toEqual(['Processing Primary']);

      const call = vi.spyOn(api, 'setUserPods');
      await TestBed.inject(UndoService).run();
      await settle();
      expect(call).toHaveBeenCalledTimes(1);
      expect(call.mock.calls[0][1]).toMatchObject({ podIds: [], primaryPodId: undefined });
      expect(chipsOf(4)).toEqual([]);
      expect(podCell(4).textContent).toContain('No pod');
    });

    it('asks for the new primary when the primary pod is removed and blocks Apply until it is chosen', async () => {
      await createWith(withPods, 'User.View', 'Pod.ManageMembers');
      const call = vi.spyOn(api, 'setUserPods');
      await pick(3, 1); // untick Processing (primary)
      expect(q('[data-primary-required]')).not.toBeNull();
      await applyPicked();
      expect(call).not.toHaveBeenCalled();

      q('[data-pod-primary="2"]').click();
      await settle();
      await applyPicked();
      expect(call).toHaveBeenCalledWith(
        3,
        expect.objectContaining({ podIds: [2], primaryPodId: 2 }),
      );
      expect(chipsOf(3)).toEqual(['Review Primary']);
    });

    it('loads the active pods only when an editor is first opened', async () => {
      await createWith(withPods, 'User.View', 'Pod.ManageMembers');
      const list = vi.spyOn(api, 'listActivePods');
      expect(list).not.toHaveBeenCalled();
      await pick(4);
      await pick(4); // closes
      trigger(4).click();
      await settle();
      expect(list).toHaveBeenCalledTimes(1);
      // The inactive pod is not offered to Priya.
      expect(el().querySelector('[data-pod-option="4"]')).toBeNull();
      expect(popover().textContent).toContain('Processing');
    });

    it('puts the old pods back and says so when the save fails', async () => {
      await createWith(withPods, 'User.View', 'Pod.ManageMembers');
      vi.spyOn(api, 'setUserPods').mockReturnValue(throwError(() => new Error('boom')));
      const notify = TestBed.inject(NotificationService);
      await pick(3, 2);
      await applyPicked();
      expect(chipsOf(3)).toEqual(['Processing Primary', 'Review']);
      expect(notify.toasts()).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          summary: "We couldn't save the pods. Try again.",
        }),
      );
      expect(TestBed.inject(UndoService).current()).toBeNull();
    });

    it('refreshes the list and explains a 409 (someone else changed the pods)', async () => {
      await createWith(withPods, 'User.View', 'Pod.ManageMembers');
      const conflict = new ApiError(
        409,
        'CONCURRENCY_CONFLICT',
        'changed',
        { code: 'CONCURRENCY_CONFLICT', detail: 'changed', status: 409 },
        new HttpErrorResponse({ status: 409 }),
      );
      vi.spyOn(api, 'setUserPods').mockReturnValue(throwError(() => conflict));
      const list = vi.spyOn(api, 'listUsers');
      const notify = TestBed.inject(NotificationService);
      await pick(3, 2);
      await applyPicked();
      expect(notify.toasts()).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          summary:
            'The pods of Tariq Mahmood were changed by someone else. The list was refreshed.',
        }),
      );
      expect(list).toHaveBeenCalled();
      expect(chipsOf(3)).toEqual(['Processing Primary', 'Review']);
    });

    it('lets a pending user without a role be assigned', async () => {
      await createWith(withPods, 'User.View', 'Pod.ManageMembers');
      expect(api.users[3].roleIds).toEqual([]);
      await pick(4, 2);
      await applyPicked();
      expect(chipsOf(4)).toEqual(['Review Primary']);
    });
  });
});
