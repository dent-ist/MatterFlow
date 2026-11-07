import { provideCalendarFixtures } from '../../../shared/testing/calendar-testing';
import { ddSelect } from '../../../testing/dropdown-testing.spec-util';
import { NotificationService } from '../../../core/notify/notification.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom, throwError } from 'rxjs';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { ApiError } from '../../../core/http/api-error';
import { UndoService } from '../../../core/notify/undo.service';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { IdentityAdminApi } from '../../../core/identity-admin/identity-admin-api';
import { InMemoryIdentityAdminApi } from '../../../core/identity-admin/in-memory-identity-admin-api';
import { PendingUsersStore } from '../../../core/identity-admin/pending-users.store';
import { LeaveConfirmService } from '../../../shared/guards/unsaved-changes.guard';
import { SkipTarget } from '../../../shared/layout/skip-target';
import { UsersPage } from './users-page';

describe('UsersPage', () => {
  let fixture: ComponentFixture<UsersPage>;
  let api: InMemoryIdentityAdminApi;
  /** Address the page starts on (the filters are read from it). */
  let startUrl = '/admin/users';
  let width = 1920;
  const el = (): HTMLElement => fixture.nativeElement;
  /** The page, then the document: the user drawer is a dialog and PrimeNG puts it at the end of the body. */
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T =>
    (el().querySelector<T>(sel) ?? document.querySelector<T>(sel))!;

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
    await fixture.whenStable();
  }

  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('p-button button')).find(
      (b) => b.textContent!.trim() === label,
    );

  async function press(label: string): Promise<void> {
    button(label)!.click();
    await settle();
  }

  /** The Grant Access button of the first pending row (a 32 px button in the Roles cell). */
  async function grant(): Promise<void> {
    q<HTMLButtonElement>('[data-grant]').click();
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
    // A wide window: every column is on screen (the narrow-window drop rule is covered by its own test).
    Object.defineProperty(window, 'innerWidth', {
      value: width,
      configurable: true,
      writable: true,
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: USER_TIME_ZONE, useValue: 'America/New_York' },
        ...provideCalendarFixtures(),
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

  beforeEach(() => {
    startUrl = '/admin/users';
    width = 1920;
  });

  const control = <T extends HTMLElement = HTMLElement>(column: string): T =>
    q<T>(`[aria-label="Filter by ${column}"]`);

  /** Presses a status segment above the grid (the segments are the status choice, #429). */
  async function chooseStatus(value: string): Promise<void> {
    q(`[data-strip-item="${value}"]`).click();
    await settle();
  }

  const segment = (key: string): HTMLElement => q(`[data-strip-item="${key}"]`);
  const segmentText = (key: string): string =>
    segment(key).textContent!.replace(/\s+/g, ' ').trim();
  const pressed = (): string | undefined =>
    Array.from(el().querySelectorAll<HTMLElement>('[data-strip-item]')).find(
      (b) => b.getAttribute('aria-pressed') === 'true',
    )?.dataset['stripItem'];

  /** The names of the listed people (the name button is the one control of the Name cell). */
  const rows = (): string[] =>
    Array.from(el().querySelectorAll('tbody tr[data-record-id]')).map((r) =>
      r.querySelector('button[data-open]')!.textContent!.trim(),
    );

  /** The first row of the person: the name button that opens them. */
  const nameButton = (id: number): HTMLButtonElement =>
    q<HTMLButtonElement>(`[data-record-id="${id}"] button[data-open]`);

  /** Opens the row menu of a person. */
  async function openMenu(id: number): Promise<void> {
    q(`[data-record-id="${id}"] [data-overflow]`).click();
    await settle();
  }

  it('opens on the pending queue with counts, and publishes the pending count for the nav badge', async () => {
    await create('User.View', 'User.Manage');

    expect(segmentText('pending')).toBe('Pending Access 2');
    expect(pressed()).toBe('pending');
    // The default rule is written into the address, so a reload keeps it.
    expect(TestBed.inject(Router).url).toContain('status=pending');
    // The status is not a column filter: it is not counted.
    expect(el().querySelector('[data-filter-count]')).toBeNull();
    expect(rows()).toEqual(['Priya Patel', 'Tariq Mahmood']);
    expect(TestBed.inject(PendingUsersStore).count()).toBe(2);
  });

  it('puts the name over the Windows account, makes the name the one control of the cell, and names it with the account (#432)', async () => {
    await create('User.View', 'User.Manage');
    const cell = q('[data-record-id="4"] td.us-name');
    expect(cell.querySelector('button[data-open]')!.textContent!.trim()).toBe('Priya Patel');
    expect(cell.querySelector('[data-account]')!.textContent!.trim()).toBe('ppatel');
    expect(cell.querySelectorAll('a, button').length).toBe(1);
    // The name that opens a drawer is the shared text button with the name modifier (D-44m), never a private class (#1257).
    expect(Array.from(cell.querySelector('button[data-open]')!.classList)).toEqual([
      'mf-btn',
      'mf-btn--text',
      'mf-btn--name',
    ]);
    expect(cell.querySelector('button[data-open]')!.getAttribute('aria-label')).toBe(
      'Open Priya Patel (KE\\ppatel)',
    );
    // Email and First seen are not columns any more (they are in the panel; the filters stay).
    const headers = Array.from(el().querySelectorAll('thead th')).map((th) =>
      th.textContent!.trim(),
    );
    // The columns never come and go with the data (the shared grid keeps its headings in every state, #1197).
    expect(headers).toEqual([
      'Name',
      'Roles',
      'Pods',
      'Availability',
      'Last Seen',
      'Status',
      'Actions',
    ]);
    await chooseStatus('all');
    expect(
      Array.from(el().querySelectorAll('thead th')).map((th) => th.textContent!.trim()),
    ).toEqual(['Name', 'Roles', 'Pods', 'Availability', 'Last Seen', 'Status', 'Actions']);
  });

  describe('sorting and page size (#437)', () => {
    const header = (label: string): HTMLElement =>
      Array.from(el().querySelectorAll<HTMLElement>('thead th')).find(
        (th) => th.textContent!.trim() === label,
      )!;
    const url = (): string => TestBed.inject(Router).url;

    it('sorts by Name from the header: aria-sort, the address and the server order; a second press reverses', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('all');
      expect(header('Name').getAttribute('aria-sort')).toBe('none');
      header('Name').querySelector('button')!.click();
      await settle();
      expect(url()).toContain('sort=name');
      expect(header('Name').getAttribute('aria-sort')).toBe('ascending');
      const ascending = rows();
      expect(ascending).toEqual([...ascending].sort((a, b) => a.localeCompare(b)));
      header('Name').querySelector('button')!.click();
      await settle();
      expect(url()).toContain('sort=-name');
      expect(header('Name').getAttribute('aria-sort')).toBe('descending');
      expect(rows()).toEqual([...ascending].reverse());
    });

    it('keeps the sort in the address on a reload and ignores a field the server does not know', async () => {
      startUrl = '/admin/users?status=all&sort=-lastSeen';
      await create('User.View', 'User.Manage');
      expect(header('Last Seen').getAttribute('aria-sort')).toBe('descending');
      expect(header('Name').getAttribute('aria-sort')).toBe('none');
      fixture.destroy();
      TestBed.resetTestingModule();
      startUrl = '/admin/users?status=all&sort=bogus';
      await create('User.View', 'User.Manage');
      expect(header('Name').getAttribute('aria-sort')).toBe('none');
      expect(header('Last Seen').getAttribute('aria-sort')).toBe('none');
    });

    it('keeps the Last Seen column when no listed person has a last-seen time (the headings never move)', async () => {
      await createWith(
        (a) => a.users.forEach((u) => (u.lastLoginAtUtc = undefined)),
        'User.View',
        'User.Manage',
      );
      await chooseStatus('all');
      expect(
        Array.from(el().querySelectorAll('thead th')).map((th) => th.textContent!.trim()),
      ).toContain('Last Seen');
    });

    it('shows the day in the Last seen cell, the instant as its tooltip, and "Never" for a person who never signed in', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('all');
      const cell = q('[data-record-id="2"] [data-last-seen]');
      expect(cell.textContent!.trim()).toBe('10/14');
      expect(cell.getAttribute('title')).toContain('October 14, 2026');
      expect(q('[data-record-id="4"] [data-last-seen]').textContent!.trim()).toBe('Never');
    });

    it('offers 25, 50 and 100 rows per page and writes the choice into the address', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('all');
      const select = ddSelect(document.body, 'Rows per page');
      expect(Array.from(select.options).map((o) => o.value)).toEqual(['25', '50', '100']);
      // The default is 50 (LC-05): it is not written into the address, the other two are.
      expect(select.value).toBe('50');
      select.value = '25';
      select.dispatchEvent(new Event('change'));
      await settle();
      expect(url()).toContain('size=25');
      select.value = '50';
      select.dispatchEvent(new Event('change'));
      await settle();
      expect(url()).not.toContain('size=');
    });
  });

  it('marks the seeded administrator beside the account, not as a badge', async () => {
    await create('User.View', 'User.Manage');
    await chooseStatus('all');
    expect(q('[data-record-id="1"] [data-account]').textContent!.replace(/\s+/g, ' ')).toContain(
      'Seeded',
    );
  });

  it('shows a status badge only when the person is not simply Active', async () => {
    await create('User.View', 'User.Manage');
    await chooseStatus('all');
    expect(q('[data-record-id="4"] [data-status] mf-badge').textContent).toContain(
      'Pending Access',
    );
    expect(q('[data-record-id="5"] [data-status] mf-badge').textContent).toContain('Inactive');
    expect(el().querySelector('[data-record-id="2"] [data-status] mf-badge')).toBeNull();
    expect(q('[data-record-id="2"] [data-status]').textContent).toContain('Active'); // for a screen reader
  });

  it('opens on Active when no one is waiting, and the Pending segment is not tinted', async () => {
    await createWith(
      (a) => a.users.forEach((u) => u.roleIds.length === 0 && u.roleIds.push(6)),
      'User.View',
    );

    expect(pressed()).toBe('active');
    expect(TestBed.inject(Router).url).toContain('status=active');
    expect(segmentText('pending')).toBe('Pending Access 0');
    expect(el().querySelector('[data-pending-cue]')).toBeNull();
  });

  it('keeps the waiting count visible while another segment is pressed, tints it, and All lists everyone', async () => {
    await create('User.View');
    expect(segment('pending').getAttribute('aria-pressed')).toBe('true');
    await chooseStatus('active');
    expect(pressed()).toBe('active');
    expect(segmentText('pending')).toBe('Pending Access 2');
    expect(el().querySelector('[data-pending-cue]')).toBeNull();

    await chooseStatus('all');
    expect(rows()).toEqual(expect.arrayContaining(['Priya Patel', 'Dana Director']));
    expect(TestBed.inject(Router).url).toContain('status=all');

    await chooseStatus('pending');
    expect(pressed()).toBe('pending');
    expect(rows()).toEqual(['Priya Patel', 'Tariq Mahmood']);
  });

  it('counts each segment as the rows it lists, and All is their sum', async () => {
    await create('User.View');
    const counts = (await firstValueFrom(api.userCounts()))!;
    for (const key of ['pending', 'active', 'inactive'] as const) {
      expect(segmentText(key)).toContain(String(counts[key]));
      await chooseStatus(key);
      expect(rows().length).toBe(Math.min(25, counts[key]));
    }
    expect(segmentText('all')).toContain(String(counts.pending + counts.active + counts.inactive));
  });

  it('is one labelled group of status chips, each a toggle button with its count', async () => {
    await create('User.View');
    const bar = q('[data-strip]');
    expect(bar.getAttribute('role')).toBe('group');
    expect(bar.getAttribute('aria-label')).toBe('Users by status');
    const items = Array.from(el().querySelectorAll<HTMLElement>('[data-strip-item]'));
    expect(items.map((b) => b.dataset['stripItem'])).toEqual([
      'pending',
      'active',
      'inactive',
      'all',
    ]);
    expect(items.every((b) => b.tagName === 'BUTTON')).toBe(true);
    expect(items.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('keeps the segment when the filters are cleared', async () => {
    startUrl = '/admin/users?status=inactive&name=zz';
    await create('User.View');
    expect(pressed()).toBe('inactive');
    q('td[data-empty] button').click();
    await settle();
    expect(TestBed.inject(Router).url).toContain('status=inactive');
    expect(TestBed.inject(Router).url).not.toContain('name=');
    expect(pressed()).toBe('inactive');
  });

  it('shows the empty state when no one is waiting', async () => {
    await create('User.View');
    api.users.forEach((u) => u.roleIds.length === 0 && u.roleIds.push(6));
    await chooseStatus('active');
    await chooseStatus('pending');

    expect(q('td[data-empty]').textContent).toContain('No one is waiting for access.');
  });

  it('has column filters instead of a search box and two selects, open by default; the status is the segments, not a column filter', async () => {
    await create('User.View');

    expect(
      el().querySelector('#users-search, #users-status, #users-availability, mf-search-box'),
    ).toBeNull();
    expect(el().querySelector('[data-filter-row]')).not.toBeNull();
    // The filters of the columns on screen are in the row; Windows Account, First Seen and Email are optional columns (Columns button), there is no "Other Filters" button (#1197).
    for (const column of ['Name', 'Roles', 'Availability']) {
      expect(
        el().querySelector(`[aria-label^="Filter by ${column}"]`),
        `Filter by ${column}`,
      ).not.toBeNull();
    }
    for (const column of ['Windows Account', 'First Seen', 'Email']) {
      expect(el().querySelector(`[aria-label^="Filter by ${column}"]`), column).toBeNull();
    }
    expect(el().querySelector('[data-more-filters]')).toBeNull();
    expect(el().querySelector('[aria-label^="Filter by Status"]')).toBeNull();
    // Status is a column of the grid (a badge only when not Active).
    expect(
      Array.from(el().querySelectorAll('thead th')).map((th) => th.textContent!.trim()),
    ).toContain('Status');
    expect(q('[data-record-id="4"] [data-status]').textContent).toContain('Pending Access');
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
      pageSize: 50,
    });
    // The link opens the row with the values in it; the status is the pressed segment.
    expect(pressed()).toBe('all');
    expect(control<HTMLInputElement>('Name').value).toBe('ana');
    // The Windows account and Email filters are not columns of the grid: they show as chips.
    expect(el().querySelector('[data-filter-chips]')).not.toBeNull();
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

  /** The deactivation question: PrimeNG puts it at the end of the body. */
  const question = (): HTMLElement => q('[data-deactivate-text]').closest('.p-dialog')!;
  const questionButton = (label: string): HTMLButtonElement | undefined =>
    Array.from(question().querySelectorAll<HTMLButtonElement>('p-button button')).find(
      (b) => b.textContent!.trim() === label,
    );
  const urlOf = (): string => TestBed.inject(Router).url;
  const openRow = async (id: number): Promise<void> => {
    nameButton(id).click();
    await settle();
  };
  /** Esc, heard on the document by the drawer (it yields to any dialog above it). */
  const pressEsc = async (): Promise<void> => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
  };
  /** The page steps back over the entry it pushed, or rewrites the address after a short wait: let both happen. */
  const afterClose = async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 450));
    await settle();
  };

  it('grants a role to a pending user: the drawer saves, closes, offers Undo, and the queue shrinks', async () => {
    await create('User.View', 'User.Manage');

    await grant(); // first row: Priya Patel (the one action of a pending row)
    expect(q('[data-panel-heading]').textContent).toContain('Priya Patel');
    expect(urlOf()).toContain('user=4');
    expect(button('Save Changes')!.disabled).toBe(true);

    const role = q<HTMLInputElement>('[data-role="5"]'); // Data Technician
    role.checked = true;
    role.dispatchEvent(new Event('change'));
    await settle();
    expect(button('Save Changes')!.disabled).toBe(false);
    // The summary shows what the ticked roles give, grouped like the Roles tab, and says it applies after the save (#439).
    expect(q('[data-permissions-preview]').textContent).toContain('after you save');
    expect(q('[data-permissions]').textContent).toContain('Task (');

    await press('Save Changes');
    await settle();
    expect(api.users.find((u) => u.userId === 4)!.roleIds).toEqual([5]);
    expect(segmentText('pending')).toBe('Pending Access 1');
    expect(TestBed.inject(PendingUsersStore).count()).toBe(1);
    await afterClose();
    // A first grant closes the drawer (the person leaves the queue) and offers one Undo (#442).
    expect(document.querySelector('[data-panel]')).toBeNull();
    expect(urlOf()).not.toContain('user=');
    expect(TestBed.inject(UndoService).current()!.message).toBe(
      'Priya Patel now has access (Data Technician).',
    );

    await TestBed.inject(UndoService).run();
    await settle();
    expect(api.users.find((u) => u.userId === 4)!.roleIds).toEqual([]);
    expect(segmentText('pending')).toBe('Pending Access 2');
  });

  it('does not overwrite a change made by someone else when Undo of a grant runs (#442)', async () => {
    await create('User.View', 'User.Manage');
    await grant();
    const role = q<HTMLInputElement>('[data-role="5"]');
    role.checked = true;
    role.dispatchEvent(new Event('change'));
    await settle();
    await press('Save Changes');
    await settle();
    // Somebody else gives Priya another role in the meantime: the row version moves on.
    const stored = api.users.find((u) => u.userId === 4)!;
    await firstValueFrom(
      api.setUserRoles(4, [5, 6], (await firstValueFrom(api.getUser(4))).rowVersion),
    );
    expect(stored.roleIds).toEqual([5, 6]);
    await TestBed.inject(UndoService).run();
    await settle();
    expect(stored.roleIds).toEqual([5, 6]); // not undone
  });

  it('shows no success toast and keeps the drawer when the save of a grant fails (#442)', async () => {
    await create('User.View', 'User.Manage');
    await grant();
    const role = q<HTMLInputElement>('[data-role="5"]');
    role.checked = true;
    role.dispatchEvent(new Event('change'));
    await settle();
    api.setUserRoles = () =>
      throwError(
        () =>
          new ApiError(
            500,
            undefined,
            'Server error',
            undefined,
            new HttpErrorResponse({ status: 500 }),
          ),
      );
    await press('Save Changes');
    await settle();
    expect(TestBed.inject(UndoService).current()).toBeNull();
    expect(q('[data-panel-error]')).not.toBeNull();
    expect(q('[data-panel]')).not.toBeNull();
  });

  it('asks in a dialog before deactivating, and then deactivates at once', async () => {
    await create('User.View', 'User.Manage');
    await chooseStatus('active');
    await openRow(2);

    // No radio, no relabelled Save: the header has a Deactivate control and Save changes is untouched (#441).
    expect(el().querySelector('[data-status-inactive]')).toBeNull();
    expect(button('Save Changes')!.disabled).toBe(true);
    q('[data-deactivate]').click();
    await settle();
    expect(q('[data-deactivate-text]').textContent).toContain(
      'Dana Director can no longer sign in.',
    );
    expect(question().textContent).toContain('Deactivate User');
    expect(api.users.find((u) => u.userId === 2)!.isActive).toBe(true);

    questionButton('Deactivate User')!.click();
    await settle();
    expect(api.users.find((u) => u.userId === 2)!.isActive).toBe(false);
    // The drawer stays, now showing an Inactive person with Activate; the segment counts followed.
    expect(q('[data-panel]')).not.toBeNull();
    expect(q('[data-activate]')).not.toBeNull();
    expect(q('[data-deactivate]')).toBeNull();
    expect(segmentText('inactive')).toContain('2');
  });

  it('Cancel in the question changes nothing', async () => {
    await create('User.View', 'User.Manage');
    await chooseStatus('active');
    await openRow(2);
    q('[data-deactivate]').click();
    await settle();
    questionButton('Cancel')!.click();
    await settle();
    expect(api.users.find((u) => u.userId === 2)!.isActive).toBe(true);
    expect(q('[data-deactivate]')).not.toBeNull();
  });

  it('Activate needs no question: one press activates the person', async () => {
    await create('User.View', 'User.Manage');
    await chooseStatus('inactive');
    await openRow(5);
    q('[data-activate]').click();
    await settle();
    expect(api.users.find((u) => u.userId === 5)!.isActive).toBe(true);
    expect(q('[data-deactivate]')).not.toBeNull();
  });

  describe('open tasks (BUG-4)', () => {
    const open = async (id: number): Promise<void> => {
      await chooseStatus('active');
      await openRow(id);
    };
    const ask = async (): Promise<void> => {
      q('[data-deactivate]').click();
      await settle();
    };

    it('shows the count in the header, the extended sentence in the question and a View their tasks link for that person', async () => {
      await createWith(
        (a) => (a.users.find((u) => u.userId === 2)!.openTaskCount = 7),
        'User.View',
        'User.Manage',
      );
      await open(2);
      expect(q('[data-open-tasks]').textContent!.trim()).toBe('Open tasks: 7');
      const link = q<HTMLAnchorElement>('[data-view-tasks]');
      expect(link.textContent!.trim()).toBe('View their tasks');
      expect(link.getAttribute('href')).toBe(
        '/tasks?assignee=2&status=NEW&status=IN_PROGRESS&status=ON_HOLD',
      );
      await ask();
      expect(q('[data-deactivate-text]').textContent).toContain(
        'This user has 7 open tasks. They stay assigned until you reassign them one by one.',
      );
      // The question offers the same trip as its main button.
      expect(questionButton('View their tasks')).toBeDefined();
    });

    it('says "No open tasks" for zero and offers no link', async () => {
      await createWith(
        (a) => (a.users.find((u) => u.userId === 2)!.openTaskCount = 0),
        'User.View',
        'User.Manage',
      );
      await open(2);
      expect(q('[data-open-tasks]').textContent!.trim()).toBe('No open tasks');
      expect(el().querySelector('[data-view-tasks]')).toBeNull();
      await ask();
      expect(q('[data-deactivate-text]').textContent).toContain(
        'No open tasks are assigned to them.',
      );
      expect(questionButton('View their tasks')).toBeUndefined();
    });

    it('shows no number and no link when the API returned none (no Task.View), keeping the plain sentence', async () => {
      await create('User.View', 'User.Manage');
      await open(2);
      expect(document.querySelector('[data-open-tasks]')).toBeNull();
      await ask();
      expect(q('[data-deactivate-text]').textContent).toContain(
        'Their assigned tasks stay assigned until you reassign them one by one.',
      );
      expect(q('[data-deactivate-text]').textContent).not.toMatch(/\d+ open task|No open tasks/);
      expect(document.querySelector('[data-view-tasks]')).toBeNull();
    });

    it('says "1 open task" in the singular', async () => {
      await createWith(
        (a) => (a.users.find((u) => u.userId === 2)!.openTaskCount = 1),
        'User.View',
        'User.Manage',
      );
      await open(2);
      await ask();
      expect(q('[data-deactivate-text]').textContent).toContain('This user has 1 open task.');
    });
  });

  describe('the drawer: address, focus and Esc (#438, BUG-2)', () => {
    it('opens from the name, puts the person in the address and names the dialog by the heading', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('active');
      nameButton(2).focus();
      await openRow(2);
      expect(urlOf()).toContain('user=2');
      const dialog = q('.mf-user-drawer');
      expect(dialog.getAttribute('aria-labelledby')).toBe(q('[data-panel-heading]').id);
      expect(q('[data-panel-heading]').textContent).toContain('Dana Director');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
    });

    it('opens on load from ?user=<id> (a link, a reload, Back) and closes when the address loses it', async () => {
      startUrl = '/admin/users?status=active&user=2';
      await create('User.View', 'User.Manage');
      expect(q('[data-panel-heading]').textContent).toContain('Dana Director');
      expect(q('[data-panel-heading]').textContent).toContain('Dana Director');
      await TestBed.inject(Router).navigateByUrl('/admin/users?status=active');
      await settle();
      expect(document.querySelector('[data-panel]')).toBeNull();
    });

    it('shows a loading state and then a retryable error for a person that cannot be read', async () => {
      startUrl = '/admin/users?status=active&user=999';
      await create('User.View', 'User.Manage');
      expect(q('[data-panel-error]').textContent).toContain(
        "Couldn't load this user. Try again.Retry",
      );
      expect(q('[data-panel-retry]')).not.toBeNull();
    });

    it('closes with Esc, takes ?user out of the address and puts focus back on the row button', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('active');
      nameButton(2).focus();
      await openRow(2);
      await pressEsc();
      await afterClose();
      expect(document.querySelector('[data-panel]')).toBeNull();
      expect(urlOf()).not.toContain('user=');
      expect(document.activeElement).toBe(nameButton(2));
    });

    it('closes with Cancel (Close without User.Manage)', async () => {
      await create('User.View');
      await chooseStatus('active');
      await openRow(2);
      expect(button('Close')).toBeDefined();
      expect(button('Save Changes')).toBeUndefined();
      await press('Close');
      await afterClose();
      expect(document.querySelector('[data-panel]')).toBeNull();
    });

    it('asks before closing with unsaved edits and keeps the drawer when the answer is no', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('active');
      await openRow(2);
      const name = q<HTMLInputElement>('[data-name]');
      name.value = 'Someone Else';
      name.dispatchEvent(new Event('input'));
      await settle();

      const leave = TestBed.inject(LeaveConfirmService);
      await pressEsc();
      expect(leave.open()).toBe(true);
      leave.answer(false);
      await settle();
      expect(document.querySelector('[data-panel]')).not.toBeNull();

      await pressEsc();
      leave.answer(true);
      await afterClose();
      expect(document.querySelector('[data-panel]')).toBeNull();
    });
  });

  describe('the drawer sections (#439, #440, #443)', () => {
    const sections = (): string[] =>
      Array.from(document.querySelectorAll('[data-section]')).map(
        (x) => (x as HTMLElement).dataset['section']!,
      );

    it('has Access first, then Pods, Availability and Profile', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('active');
      await openRow(2);
      expect(sections()).toEqual(['access', 'pods', 'availability', 'profile']);
    });

    it('lists each role with its description and permission count, the name clamped with a tooltip', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('active');
      await openRow(2);
      const director = q('[data-role="2"]').closest('label')!;
      expect(director.querySelector('.ud-role-name')!.textContent!.trim()).toBe('Director');
      expect(director.querySelector('.ud-role-name')!.getAttribute('title')).toBe('Director');
      expect(director.querySelector('.ud-role-meta')!.textContent).toContain('Department head');
      expect(director.querySelector('.ud-role-meta')!.textContent).toMatch(/\d+ permissions/);
    });

    it('groups the effective permissions like the Roles tab: the counts add up to the saved set', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('active');
      await openRow(2);
      const saved = (await firstValueFrom(api.getUser(2))).effectivePermissions;
      const chips = Array.from(document.querySelectorAll('[data-permission-group]')).map((c) =>
        c.textContent!.trim(),
      );
      expect(chips.length).toBeGreaterThan(1);
      expect(chips.some((c) => /^Task \(\d+\)$/.test(c))).toBe(true);
      const total = chips.reduce((n, c) => n + Number(/\((\d+)\)/.exec(c)![1]), 0);
      expect(total).toBe(saved.length);
      expect(q('[data-permissions] h4').textContent).toContain(
        `Effective permissions (${saved.length})`,
      );
    });

    it('updates the summary as roles are ticked and labels it as applying after the save', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('active');
      await openRow(2);
      const before = q('[data-permissions] h4').textContent;
      const box = q<HTMLInputElement>('[data-role="1"]'); // System Admin: every permission
      box.checked = true;
      box.dispatchEvent(new Event('change'));
      await settle();
      expect(q('[data-permissions] h4').textContent).toContain('After you save');
      expect(q('[data-permissions] h4').textContent).not.toBe(before);
      const total = Array.from(document.querySelectorAll('[data-permission-group]')).reduce(
        (n, c) => n + Number(/\((\d+)\)/.exec(c.textContent!)![1]),
        0,
      );
      expect(total).toBe((await firstValueFrom(api.getRole(1))).permissionCodes.length);
      // One line, only while the System Admin role is ticked.
      expect(q('[data-sysadmin-warning]').textContent).toContain('holds every permission');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      await settle();
      expect(document.querySelector('[data-sysadmin-warning]')).toBeNull();
      expect(q('[data-permissions] h4').textContent).toContain('Effective permissions');
    });

    it('shows the availability sentence, and Edit availability opens the existing dialog', async () => {
      await createWith(
        (a) => {
          a.users[1].availability = {
            state: 'OUT_OF_OFFICE',
            outUntil: '2027-03-21T04:00:00Z',
            note: 'Conference',
          };
        },
        'User.View',
        'User.Manage',
      );
      await chooseStatus('active');
      await openRow(2);
      expect(q('[data-availability-sentence]').textContent).toContain(
        'Out of Office until 03/20/2027. Conference',
      );
      expect(q('[data-availability-sentence]').textContent).toContain('Conference');
      q('[data-edit-availability]').click();
      await settle();
      // The shared form dialog is drawn in the page body, not inside the component.
      expect(document.querySelector('.mf-formdlg')).not.toBeNull();
    });

    it('says in muted lines which parts save at once and which with Save changes', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('active');
      await openRow(2);
      expect(q('[data-pods-note]').textContent).toContain('saved as soon as you apply');
      expect(q('[data-availability-note]').textContent).toContain('own dialog');
      expect(q('[data-save-note]').textContent).toContain('Save changes saves the roles');
    });

    it('shows the profile: editable name and email, the account and first seen as plain facts', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('active');
      await openRow(2);
      expect(q<HTMLInputElement>('[data-name]').value).toBe('Dana Director');
      expect(q<HTMLInputElement>('[data-email]').value).toBe('dana@firm.test');
      expect(q('.ud-dl').textContent).toContain('KE\\ddirector');
      expect(q('[data-first-seen]').textContent).toContain('10/14');
    });

    describe('on a phone (#446)', () => {
      const original = window.matchMedia;
      beforeEach(() => {
        window.matchMedia = ((query: string) => ({
          matches: /max-width/.test(query),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        })) as never;
      });
      afterEach(() => {
        window.matchMedia = original;
        Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
      });

      it('opens with Access unfolded and the other sections a tap away, as buttons that say so', async () => {
        await create('User.View', 'User.Manage');
        await chooseStatus('active');
        await q('[data-record-id="2"] button, li.rc button[data-card-name]').click();
        await settle();
        const body = (id: string): HTMLElement => q(`#${id}-body`);
        expect(body('ud-access').hidden).toBe(false);
        expect(body('ud-pods').hidden).toBe(true);
        expect(body('ud-profile').hidden).toBe(true);
        const toggle = q('[data-section-toggle="pods"]');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.getAttribute('aria-controls')).toBe('ud-pods-body');
        toggle.click();
        await settle();
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(body('ud-pods').hidden).toBe(false);
        // Edits in a folded section are kept.
        q('[data-section-toggle="profile"]').click();
        await settle();
        const name = q<HTMLInputElement>('[data-name]');
        name.value = 'Typed While Open';
        name.dispatchEvent(new Event('input'));
        q('[data-section-toggle="profile"]').click();
        await settle();
        q('[data-section-toggle="profile"]').click();
        await settle();
        expect(q<HTMLInputElement>('[data-name]').value).toBe('Typed While Open');
      });

      it('follows the visual viewport, so the on-screen keyboard does not hide Save changes', async () => {
        const vv = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 });
        Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
        await create('User.View', 'User.Manage');
        await chooseStatus('active');
        await q('[data-record-id="2"] button, li.rc button[data-card-name]').click();
        await settle();
        const root = document.documentElement.style;
        expect(root.getPropertyValue('--ud-vh')).toBe('800px');
        vv.height = 420;
        vv.offsetTop = 12;
        vv.dispatchEvent(new Event('resize'));
        expect(root.getPropertyValue('--ud-vh')).toBe('420px');
        expect(root.getPropertyValue('--ud-top')).toBe('12px');
        fixture.destroy();
        expect(root.getPropertyValue('--ud-vh')).toBe('');
      });
    });

    describe('read-only variants (#443)', () => {
      it('User.View only: everything is read only with one reason, and the grid has no Grant access', async () => {
        await create('User.View');
        expect(document.querySelector('[data-grant]')).toBeNull();
        await chooseStatus('active');
        await openRow(2);
        expect(q('[data-readonly-reason]').textContent).toContain(
          'you can see this person but not change them',
        );
        expect(document.querySelector('[data-deactivate], [data-activate]')).toBeNull();
        expect(document.querySelector('[data-edit-availability]')).toBeNull();
        expect(button('Save Changes')).toBeUndefined();
        expect(button('Close')).toBeDefined();
        expect(q<HTMLInputElement>('[data-role="2"]').closest('fieldset')!.disabled).toBe(true);
        expect(q<HTMLInputElement>('[data-name]').closest('fieldset')!.disabled).toBe(true);
        // The pods are plain text: no button.
        expect(document.querySelector('[data-pods-trigger]')).toBeNull();
      });

      it('Pod.ManageMembers without User.Manage: pods are editable, everything else is read only, with the reason', async () => {
        await create('User.View', 'Pod.ManageMembers');
        await chooseStatus('active');
        await openRow(2);
        expect(q('[data-readonly-reason]').textContent).toContain('except pods');
        expect(document.querySelector('[data-pods-trigger]')).not.toBeNull();
        expect(q<HTMLInputElement>('[data-role="2"]').closest('fieldset')!.disabled).toBe(true);
        expect(document.querySelector('[data-deactivate]')).toBeNull();
        expect(document.querySelector('[data-edit-availability]')).toBeNull();
        expect(button('Save Changes')).toBeUndefined();
      });

      it('User.Manage: no reason line, all controls present', async () => {
        await create('User.View', 'User.Manage');
        await chooseStatus('active');
        await openRow(2);
        expect(document.querySelector('[data-readonly-reason]')).toBeNull();
        expect(document.querySelector('[data-deactivate]')).not.toBeNull();
        expect(document.querySelector('[data-edit-availability]')).not.toBeNull();
      });
    });
  });

  it('shows the last-admin guard message instead of silently failing', async () => {
    await create('User.View', 'User.Manage');
    api.currentUserId = 99; // not the admin, so only the last-admin rule applies
    await chooseStatus('active');
    el().querySelector<HTMLButtonElement>('[data-record-id="1"] button')!.click(); // Kim Admin, the only admin
    await settle();

    const adminRole = q<HTMLInputElement>('[data-role="1"]');
    adminRole.checked = false;
    adminRole.dispatchEvent(new Event('change'));
    await settle();
    await press('Save Changes');

    expect(q('[data-panel-error]').textContent).toContain('At least one active System Admin');
    expect(api.users.find((u) => u.userId === 1)!.roleIds).toEqual([1]);
  });

  it('is read-only without User.Manage', async () => {
    await create('User.View');
    nameButton(4).click(); // the first pending person
    await settle();

    expect(button('Save Changes')).toBeUndefined();
    expect(q<HTMLInputElement>('[data-role="5"]').closest('fieldset')!.disabled).toBe(true);
  });

  describe('availability', () => {
    const chips = (): string[] =>
      Array.from(el().querySelectorAll('tbody tr')).map((r) =>
        r.querySelector('[data-availability-cell]')!.textContent!.trim(),
      );

    it('shows the chip for Out of office (with the date) and Off hours, nothing for Pending or Inactive people (#434)', async () => {
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
      expect(chips()).toEqual(['Out of Office until 03/20/2027', 'Off Hours']);
      // Pending and Inactive people take no work: their cell is empty, even when the server reports Off hours.
      await chooseStatus('pending');
      expect(chips().every((c) => c === '')).toBe(true);
      expect(el().querySelector('tbody [data-availability-chip]')).toBeNull();
      await chooseStatus('inactive');
      expect(
        el().querySelector('tbody [data-availability-chip], tbody [data-availability-plain]'),
      ).toBeNull();
    });

    it('says a plain muted "Available" for an active person with nothing to report', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('active');
      expect(chips()[0]).toBe('Available');
      expect(el().querySelector('tbody [data-availability-chip]')).toBeNull();
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

      const select = ddSelect(document.body, 'Filter by Availability');
      expect(Array.from(select.options).map((o) => o.textContent!.trim())).toEqual([
        'Any',
        'Available',
        'Out of Office',
        'Off Hours',
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

    it('opens the availability dialog for the chosen user, from the row menu', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('active');
      await openMenu(2);
      q('[data-action="availability"]').click();
      await settle();
      const dialog = document.querySelector('.p-dialog');
      expect(dialog?.textContent).toContain('Availability of Dana Director');
    });
  });

  describe('Skip to table (#452)', () => {
    it("offers the link as the page's skip target and moves focus to the name of the first row", async () => {
      await create('User.View', 'User.Manage');
      const target = TestBed.inject(SkipTarget).target()!;
      expect(target.label).toBe('Skip to Table');
      target.focus();
      expect(document.activeElement).toBe(
        el().querySelector('tbody tr[data-record-id] button[data-open]'),
      );
    });

    it('lands on the empty message when no one is listed, and withdraws the link with the page', async () => {
      startUrl = '/admin/users?status=all&name=nobody-like-this';
      await create('User.View');
      TestBed.inject(SkipTarget).target()!.focus();
      // Focus moves into the page (the exact element is the empty message or its Clear filters button; the e2e checks it in a browser).
      expect(document.activeElement).not.toBe(document.body);
      fixture.destroy();
      expect(TestBed.inject(SkipTarget).target()).toBeNull();
    });
  });

  describe('row actions: one control for the name, one for the action (#432, #433)', () => {
    const menuItems = (): string[] =>
      Array.from(document.querySelectorAll('[role="menuitem"]')).map((i) =>
        i.textContent!.replace(/\s+/g, ' ').trim(),
      );

    it('has no "Scroll sideways" hint: the grid fits', async () => {
      await create('User.View');
      expect(el().querySelector('[data-scroll-hint]')).toBeNull();
      expect(el().textContent).not.toContain('Scroll sideways');
    });

    it('gives a pending person with User.Manage the one primary action, Grant access, and an account in its name', async () => {
      await create('User.View', 'User.Manage');
      const grant = q<HTMLButtonElement>('[data-record-id="4"] [data-grant]');
      expect(grant.getAttribute('aria-label')).toBe('Grant access to Priya Patel (KE\\ppatel)');
      expect(el().querySelector('[data-record-id="4"] [data-overflow]')).toBeNull();
      // Two Tab stops on the row: the name and the action.
      expect(
        el().querySelectorAll('[data-record-id="4"] button, [data-record-id="4"] a').length,
      ).toBe(2);
    });

    it('opens the menu of an active person: Open, Edit availability, Deactivate; the button names the person and the account', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('active');
      expect(q('[data-record-id="2"] [data-overflow]').getAttribute('aria-label')).toBe(
        'Actions for Dana Director (KE\\ddirector)',
      );
      await openMenu(2);
      expect(menuItems()).toEqual(['Open', 'Edit Availability', 'Deactivate']);
    });

    it('offers Activate for an inactive person', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('inactive');
      await openMenu(5);
      expect(menuItems()).toEqual(['Open', 'Edit Availability', 'Activate']);
    });

    it('offers only Open without User.Manage: nothing that edits, and no Grant access', async () => {
      await create('User.View');
      expect(el().querySelector('[data-grant]')).toBeNull();
      await openMenu(4);
      expect(menuItems()).toEqual(['Open']);
      expect(el().querySelector('[data-edit-availability]')).toBeNull();
    });

    it('Deactivate from the menu opens the person with the question on screen', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('active');
      await openMenu(2);
      q('[data-action="deactivate"]').click();
      await settle();
      expect(q('[data-panel-heading]').textContent).toContain('Dana Director');
      expect(q('[data-deactivate-text]')).not.toBeNull();
      expect(question().textContent).toContain('Deactivate User');
    });

    it('Activate from the menu activates the person at once (no question is needed)', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('inactive');
      await openMenu(5);
      q('[data-action="activate"]').click();
      await settle();
      expect(api.users.find((u) => u.userId === 5)!.isActive).toBe(true);
      expect(q('[data-deactivate]')).not.toBeNull();
    });

    it('Open from the menu opens the drawer, Esc closes it and focus goes back to the menu button', async () => {
      await create('User.View');
      await chooseStatus('active');
      q<HTMLButtonElement>('[data-record-id="2"] [data-overflow]').focus();
      await openMenu(2);
      q('[data-action="open"]').click();
      await settle();
      expect(q('[data-panel-heading]').textContent).toContain('Dana Director');
      await pressEsc();
      await afterClose();
      expect(document.activeElement).toBe(q('[data-record-id="2"] [data-overflow]'));
    });
  });

  describe('phone cards below 640 px (#445)', () => {
    const original = window.matchMedia;
    beforeEach(() => {
      // A phone: every max-width query is on.
      window.matchMedia = ((query: string) => ({
        matches: /max-width/.test(query),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })) as never;
    });
    afterEach(() => {
      window.matchMedia = original;
    });
    const cards = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('li.rc'));
    const cardOf = (name: string): HTMLElement =>
      cards().find((c) => c.querySelector('[data-card-name]')!.textContent!.trim() === name)!;

    it('shows one card per person instead of the table: name, account, badge, one summary line and the one primary action', async () => {
      await create('User.View', 'User.Manage');
      expect(el().querySelector('table')).toBeNull();
      expect(cards().length).toBe(2); // the two people waiting
      const priya = cardOf('Priya Patel');
      expect(priya.textContent).toContain('ppatel');
      expect(priya.textContent).toContain('Pending Access');
      expect(priya.querySelector('[data-card-summary]')!.textContent).toContain('None · No Pod');
      const grant = priya.querySelector<HTMLButtonElement>(
        '[data-card-primary] button, button[data-card-primary]',
      )!;
      expect(grant.getAttribute('aria-label')).toBe('Grant access to Priya Patel (KE\\ppatel)');
      expect(priya.querySelector('[data-overflow]')).toBeNull(); // Grant access is the action of a waiting person
    });

    it('the name is a button that opens the panel, the other people have the row menu and no badge when Active', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('active');
      const dana = cardOf('Dana Director');
      expect(dana.querySelector('mf-badge')).toBeNull();
      expect(dana.querySelector('[data-overflow]')!.getAttribute('aria-label')).toBe(
        'Actions for Dana Director (KE\\ddirector)',
      );
      expect(dana.querySelector('[data-card-primary]')).toBeNull();
      dana.querySelector<HTMLButtonElement>('button[data-card-name]')!.click();
      await settle();
      expect(q('[data-panel-heading]').textContent).toContain('Dana Director');
    });

    it('without User.Manage there is no Grant access, only the menu with Open', async () => {
      await create('User.View');
      expect(el().querySelector('[data-card-primary]')).toBeNull();
      expect(cardOf('Priya Patel').querySelector('[data-overflow]')).not.toBeNull();
    });

    it('says Inactive on the card of an inactive person and keeps the states of the list (empty message)', async () => {
      await create('User.View', 'User.Manage');
      await chooseStatus('inactive');
      expect(cardOf('Dee Disabled').textContent).toContain('Inactive');
      startUrl = '/admin/users?status=all&name=nobody-like-this';
      TestBed.resetTestingModule();
      await create('User.View');
      expect(el().textContent).toContain('No users match these filters');
    });
  });

  describe('narrow windows: no column leaves (LC-09)', () => {
    it('keeps Roles and Pods and their filters in the row at 1000 px: the frame scrolls sideways instead', async () => {
      width = 1000;
      startUrl = '/admin/users?status=all&roleId=2';
      await create('User.View');
      expect(el().querySelector('[aria-label^="Filter by Roles"]')).not.toBeNull();
      const heads = Array.from(el().querySelectorAll('thead tr:first-child th')).map((th) =>
        th.textContent!.trim(),
      );
      expect(heads).toEqual(expect.arrayContaining(['Roles', 'Pods']));
    });
  });

  describe('Pods column (inline assignment)', () => {
    const podCell = (userId: number): HTMLElement =>
      q(`[data-record-id="${userId}"] [data-pods-cell] mf-user-pods-cell`);
    /** Every pod of the person, by name: the chip of the grid's one-line cell (the primary pod) and the pods behind its "+n" tooltip. */
    const chipsOf = (userId: number): string[] => {
      const cell = podCell(userId);
      const shown = Array.from(cell.querySelectorAll('[data-pod-chip]')).map((c) =>
        c.textContent!.replace(/\s+/g, ' ').trim(),
      );
      const more = cell.querySelector('[data-pod-more]')?.getAttribute('title');
      return [...shown, ...(more ? more.split(', ') : [])].sort();
    };
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
      expect(podCell(4).textContent).toContain('No Pod');
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
      expect(podCell(4).textContent).toContain('No Pod');
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
          summary: "Couldn't save the pods.",
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
          summary: "Couldn't save the pods.",
          detail: 'The pods of Tariq Mahmood were changed by someone else. The list was refreshed.',
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
