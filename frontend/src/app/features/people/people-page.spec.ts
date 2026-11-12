import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NEVER, Observable } from 'rxjs';
import { PeopleClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { NotificationService } from '../../core/notify/notification.service';
import { UndoService } from '../../core/notify/undo.service';
import { ddSelect } from '../../testing/dropdown-testing.spec-util';
import { aPerson } from '../../shared/testing/people-testing';
import {
  FakeMeApi,
  apiError,
  fakeQuery,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../shared/testing/org-testing';
import { PeoplePage } from './people-page';

const page = (...items: ReturnType<typeof aPerson>[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 50,
});

describe('PeoplePage', () => {
  let api: {
    listPeople: ReturnType<typeof vi.fn>;
    updatePerson: ReturnType<typeof vi.fn>;
    getPerson: ReturnType<typeof vi.fn>;
    lookupPeople: ReturnType<typeof vi.fn>;
    findSimilarPeople: ReturnType<typeof vi.fn>;
    createPerson: ReturnType<typeof vi.fn>;
  };
  let query: ReturnType<typeof fakeQuery>;

  const laura = aPerson();
  const maria = aPerson({
    personId: 12,
    firstName: 'Maria',
    lastName: 'Alvarez',
    displayName: 'Maria Alvarez',
    personType: 'INTERNAL',
    title: 'Project Manager',
    email: 'maria.alvarez@lawfirm.example',
    companyName: undefined,
    userId: 3,
    isSystemUser: true,
    userIsActive: true,
  });
  const helen = aPerson({
    personId: 13,
    firstName: 'Helen',
    lastName: 'Park',
    displayName: 'Helen Park',
    personType: 'INTERNAL',
    title: 'Partner',
    email: undefined,
    companyName: undefined,
  });

  async function create(
    permissions: Permission[] = ['People.View', 'People.Manage'],
    params: Record<string, string> = {},
    listResult: Observable<unknown> = ok(page(laura, maria, helen)),
  ) {
    localStorage.clear();
    api = {
      listPeople: vi.fn().mockReturnValue(listResult),
      updatePerson: vi.fn(),
      getPerson: vi.fn(),
      lookupPeople: vi.fn().mockReturnValue(ok([])),
      findSimilarPeople: vi.fn().mockReturnValue(ok([])),
      createPerson: vi.fn(),
    };
    query = fakeQuery();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: PeopleClient, useValue: api },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    query.set(params);
    const fixture = TestBed.createComponent(PeoplePage);
    await settle(fixture);
    return fixture;
  }

  const rows = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('tbody tr[data-row-key], tbody tr'));
  /** Calls of the list itself (the hidden-inactive count asks for one row). */
  const listCalls = (size: number) =>
    api.listPeople.mock.calls.filter((c: unknown[]) => c[4] === size).length;
  const menuItem = (id: string) =>
    document.body.querySelector<HTMLElement>(`[role=menuitem][data-action="${id}"]`);

  it('shows "-" in the count chip while the list loads and the total once it is there', async () => {
    const loading = await create(['People.View'], {}, NEVER);
    const chip = (loading.nativeElement as HTMLElement).querySelector(
      'mf-page-header [data-list-count]',
    )!;
    expect(chip.hasAttribute('data-count-pending')).toBe(true);
    TestBed.resetTestingModule();
    const ready = await create();
    expect(
      (ready.nativeElement as HTMLElement).querySelector('mf-page-header [data-list-count]')!
        .textContent,
    ).toContain('3');
  });

  it('is the People page: header with the description, then a grid of Name, Type, Title or Role, Company and Status', async () => {
    const f = await create();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('h1')!.textContent).toContain('People');
    expect(el.querySelector('mf-page-header')!.textContent).toContain(
      'The shared address book for matter teams and vendor contacts.',
    );
    const heads = Array.from(el.querySelectorAll('thead th')).map((h) => h.textContent!.trim());
    expect(heads).toEqual(
      expect.arrayContaining(['Name', 'Type', 'Title or Role', 'Company', 'Status']),
    );
    expect(api.listPeople).toHaveBeenCalledWith(undefined, undefined, true, 1, 50, undefined);
  });

  it('shows the name button with the email under it, the type badge, the title and the company', async () => {
    const f = await create();
    const el: HTMLElement = f.nativeElement;
    const [first, second, third] = rows(el);
    expect(first.querySelector('[data-person-name]')!.textContent!.trim()).toBe('Laura Whitfield');
    expect(first.querySelector('[data-person-name]')!.className).toContain('mf-btn--name');
    expect(first.querySelector('[data-person-email]')!.textContent).toContain(
      'laura.whitfield@northbridge.example',
    );
    expect(first.querySelector('[data-person-kind]')!.getAttribute('data-person-kind')).toBe(
      'external',
    );
    expect(first.querySelector('[data-person-company]')!.textContent).toContain(
      'Northbridge eDiscovery',
    );
    expect(second.querySelector('[data-person-kind]')!.getAttribute('data-person-kind')).toBe(
      'system',
    );
    expect(second.querySelector('[data-person-company]')!.textContent).toContain('Law firm');
    expect(third.querySelector('[data-person-kind]')!.getAttribute('data-person-kind')).toBe(
      'internal',
    );
    expect(third.querySelector('[data-person-email]')).toBeNull();
    expect(first.textContent).toContain('Active');
  });

  it('searches, filters by type and status, and sorts through the API', async () => {
    const f = await create(undefined, { q: 'laura', type: 'EXTERNAL', status: 'inactive' });
    expect(api.listPeople).toHaveBeenCalledWith('laura', 'EXTERNAL', false, 1, 50, undefined);
    f.componentRef.setInput('sort', '-title');
    await settle(f);
    expect(api.listPeople).toHaveBeenLastCalledWith('laura', 'EXTERNAL', false, 1, 50, '-title');
    const el: HTMLElement = f.nativeElement;
    expect(ddSelect(el, 'Filter by Type').value).toBe('EXTERNAL');
    expect(ddSelect(el, 'Filter by Status').value).toBe('inactive');
    expect((el.querySelector('[data-list-search] input') as HTMLInputElement).value).toBe('laura');
  });

  it('says how many inactive people the default hides', async () => {
    const f = await create();
    const el: HTMLElement = f.nativeElement;
    api.listPeople.mockImplementation((...args: unknown[]) =>
      ok(
        args[2] === false ? { items: [laura], total: 4, page: 1, pageSize: 1 } : page(laura, maria),
      ),
    );
    f.componentRef.setInput('sort', 'name');
    await settle(f);
    expect(el.querySelector('[data-hidden-hint]')?.textContent).toContain('4 inactive hidden');
  });

  describe('permissions', () => {
    it('People.Manage: New Person in the header, a "..." menu per row, and the name opens Edit Person', async () => {
      const f = await create();
      const el: HTMLElement = f.nativeElement;
      expect(el.querySelector('[data-new-person]')).not.toBeNull();
      expect(el.querySelectorAll('[data-row-actions] [data-overflow]')).toHaveLength(3);
      el.querySelector<HTMLButtonElement>('[data-person-name]')!.click();
      await settle(f);
      expect(document.body.querySelector('[data-panel-title]')!.textContent).toContain(
        'Edit Person',
      );
      expect(document.body.textContent).toContain('Laura Whitfield');
    });

    it('People.View only: no New Person, no row menu, the name opens a read-only view with one Close button', async () => {
      const f = await create(['People.View']);
      const el: HTMLElement = f.nativeElement;
      expect(el.querySelector('[data-new-person]')).toBeNull();
      expect(el.querySelector('[data-row-actions]')).toBeNull();
      el.querySelector<HTMLButtonElement>('[data-person-name]')!.click();
      await settle(f);
      const dialog = document.body.querySelector('.mf-formdlg')!;
      expect(dialog.querySelector('[data-panel-title]')!.textContent).toContain('Person');
      expect(dialog.querySelector('[data-person-form] input')).toBeNull();
      expect(dialog.querySelector('[data-plain-field="first"]')!.textContent).toContain('Laura');
      expect(dialog.textContent).toContain('Close');
      expect(dialog.textContent).not.toContain('Save Changes');
    });

    it('offers New Person in the empty list only with People.Manage', async () => {
      const manage = await create(undefined, {}, ok(page()));
      expect(
        (manage.nativeElement as HTMLElement).querySelector('[data-empty-new-person]'),
      ).not.toBeNull();
      TestBed.resetTestingModule();
      const view = await create(['People.View'], {}, ok(page()));
      expect(
        (view.nativeElement as HTMLElement).querySelector('[data-empty-new-person]'),
      ).toBeNull();
    });
  });

  describe('row menu', () => {
    async function openMenu(f: Awaited<ReturnType<typeof create>>, index: number) {
      const trigger = (f.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '[data-row-actions] [data-overflow]',
      )[index];
      trigger.click();
      await settle(f);
    }

    it('has Edit Person and Deactivate Person for a person, and only Edit Person for a system user', async () => {
      const f = await create();
      await openMenu(f, 0);
      expect(menuItem('edit')).not.toBeNull();
      expect(menuItem('deactivate')).not.toBeNull();
      TestBed.resetTestingModule();
      const g = await create();
      await openMenu(g, 1);
      expect(menuItem('edit')).not.toBeNull();
      expect(menuItem('deactivate')).toBeNull();
    });

    it('deactivates without a question, reloads, and offers Undo that reactivates', async () => {
      const f = await create();
      const undo = TestBed.inject(UndoService);
      api.updatePerson.mockReturnValue(ok({ ...laura, isActive: false, rowVersion: 'RV2' }));
      await openMenu(f, 0);
      menuItem('deactivate')!.click();
      await settle(f);
      expect(api.updatePerson).toHaveBeenCalledWith(11, {
        firstName: 'Laura',
        lastName: 'Whitfield',
        personType: 'EXTERNAL',
        title: 'Account Executive',
        email: 'laura.whitfield@northbridge.example',
        comments: undefined,
        companyName: 'Northbridge eDiscovery',
        isActive: false,
        rowVersion: 'RV1',
      });
      expect(undo.current()!.message).toBe('Laura Whitfield deactivated.');
      expect(listCalls(50)).toBe(2);
      api.updatePerson.mockReturnValue(ok({ ...laura, isActive: true, rowVersion: 'RV3' }));
      await undo.run();
      expect(api.updatePerson).toHaveBeenLastCalledWith(
        11,
        expect.objectContaining({ isActive: true, rowVersion: 'RV2' }),
      );
    });

    it('reactivates an inactive person from the menu', async () => {
      const f = await create(undefined, { status: 'all' }, ok(page({ ...laura, isActive: false })));
      const notify = vi.spyOn(TestBed.inject(NotificationService), 'success');
      api.updatePerson.mockReturnValue(ok({ ...laura, isActive: true }));
      await openMenu(f, 0);
      expect(menuItem('deactivate')).toBeNull();
      menuItem('reactivate')!.click();
      await settle(f);
      expect(notify).toHaveBeenCalledWith(
        'Person reactivated',
        'Laura Whitfield is offered in pickers again.',
      );
    });

    it('says so when the change fails', async () => {
      const f = await create();
      const notify = vi.spyOn(TestBed.inject(NotificationService), 'error');
      api.updatePerson.mockReturnValue(
        apiError(409, { status: 409, code: 'CONCURRENCY_CONFLICT' }),
      );
      await openMenu(f, 0);
      menuItem('deactivate')!.click();
      await settle(f);
      expect(notify).toHaveBeenCalled();
      expect(notify.mock.calls[0][0]).toBe("Couldn't deactivate the person.");
    });
  });

  it('opens New Person from the header and saves through POST /people', async () => {
    const f = await create();
    api.createPerson.mockReturnValue(
      ok(
        aPerson({
          personId: 50,
          firstName: 'Dana',
          lastName: 'Whitaker',
          displayName: 'Dana Whitaker',
        }),
      ),
    );
    (f.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-new-person] button')!
      .click();
    await settle(f);
    expect(document.body.querySelector('[data-panel-title]')!.textContent).toContain('New Person');
    const set = (id: string, value: string) => {
      const input = document.body.querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    set('person-first', 'Dana');
    set('person-last', 'Whitaker');
    await settle(f);
    document.body
      .querySelector<HTMLButtonElement>('[data-panel-primary] button, button[data-panel-primary]')!
      .click();
    await settle(f);
    expect(api.createPerson).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Dana', lastName: 'Whitaker', personType: 'EXTERNAL' }),
    );
    expect(listCalls(50)).toBe(2);
  });
});
