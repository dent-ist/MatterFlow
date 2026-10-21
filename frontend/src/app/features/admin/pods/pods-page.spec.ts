import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import {
  PagedResultOfPodSummary,
  PodDetail,
  PodMemberDto,
  PodsClient,
  PodSummary,
} from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { ApiError } from '../../../core/http/api-error';
import { fakeQuery } from '../../../shared/testing/org-testing';
import { SkipTarget } from '../../../shared/layout/skip-target';
import { AdminShellFilters } from '../task-types/shell-filters';
import { PodsPage } from './pods-page';

const summary = (podId: number, name: string, extra: Partial<PodSummary> = {}): PodSummary => ({
  podId,
  name,
  description: undefined,
  isActive: true,
  memberCount: 0,
  rowVersion: `rv${podId}`,
  ...extra,
});

const member = (userId: number, displayName: string, extra: Partial<PodMemberDto> = {}) => ({
  userId,
  displayName,
  email: undefined,
  isActive: true,
  isPrimary: false,
  roles: [],
  ...extra,
});

const detailOf = (pod: PodSummary, members: PodMemberDto[] = []): PodDetail => ({
  pod: { ...pod, memberCount: members.length },
  members,
});

describe('PodsPage', () => {
  let fixture: ComponentFixture<PodsPage>;
  let query: ReturnType<typeof fakeQuery>;
  let api: {
    [K in keyof PodsClient]: ReturnType<typeof vi.fn>;
  };
  const podA = summary(1, 'Pod A', { memberCount: 2, description: 'Processing' });
  const podB = summary(2, 'Pod B', { isActive: false });

  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;

  async function settle(ms = 0): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, ms));
      fixture.detectChanges();
    }
    await fixture.whenStable();
  }

  async function click(sel: string): Promise<void> {
    const target = q(sel);
    (target.tagName === 'BUTTON' ? target : target.querySelector('button')!).click();
    await settle();
  }

  async function type(sel: string, value: string, wait = 0): Promise<void> {
    const input = q<HTMLInputElement | HTMLTextAreaElement>(sel);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle(wait);
  }

  const text = (sel: string): string => q(sel).textContent!.replace(/\s+/g, ' ').trim();

  async function create(...permissions: Permission[]): Promise<void> {
    localStorage.clear();
    query = fakeQuery();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: PodsClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(PodsPage);
    await settle();
  }

  /** The name link of the list puts `?pod=` in the address; the page follows its `pod` input. */
  async function openEditor(podId = 1): Promise<void> {
    fixture.componentRef.setInput('pod', String(podId));
    await settle();
  }

  beforeEach(() => {
    const page: PagedResultOfPodSummary = { items: [podA, podB], total: 2, page: 1, pageSize: 25 };
    api = {
      listPods: vi.fn(() => of(page)),
      getPod: vi.fn((id: number) =>
        of(
          detailOf(id === 1 ? podA : podB, [
            member(7, 'Tariq M.', { roles: ['Data Technician', 'Pod Lead'], isPrimary: true }),
            member(8, 'Sam K.'),
          ]),
        ),
      ),
      createPod: vi.fn((body: { name: string }) => of(detailOf(summary(3, body.name)))),
      updatePod: vi.fn((id: number, body: { name: string; isActive: boolean }) =>
        of(detailOf(summary(id, body.name, { isActive: body.isActive }))),
      ),
      addPodMembers: vi.fn(() =>
        of(detailOf(podA, [member(7, 'Tariq M.'), member(9, 'Priya L.')])),
      ),
      removePodMember: vi.fn(() => of(undefined)),
      setPrimaryPod: vi.fn(() => of(detailOf(podA, [member(7, 'Tariq M.', { isPrimary: false })]))),
      findPodMemberCandidates: vi.fn(() =>
        of([
          { userId: 7, displayName: 'Tariq M.', email: undefined },
          { userId: 9, displayName: 'Priya L.', email: 'priya@example.com' },
        ]),
      ),
      listUserPods: vi.fn(),
      listMyPods: vi.fn(),
    } as typeof api;
  });

  describe('the editor as a record page (#451)', () => {
    it('shows the record header with the crumb Administration > Users > Pods > name, the name and the Active badge', async () => {
      await create('Pod.View', 'Pod.Manage', 'Pod.ManageMembers', 'User.View');
      await openEditor(1);
      const header = q('[data-record-header]');
      expect(header.getAttribute('data-kind')).toBe('pod');
      expect(text('[data-page-title]')).toContain('Pod A');
      const crumbs = Array.from(header.querySelectorAll('.rh__trail li')).map((li) =>
        li.textContent!.replace(/\s+/g, ' ').trim(),
      );
      expect(crumbs.slice(0, 3)).toEqual(['Administration', 'Users', 'Pods']);
      expect(header.querySelector('.rh__trail a[href="/admin/users"]')).not.toBeNull();
      expect(text('[data-crumb-current]')).toContain('Pod A');
      expect(header.textContent).toContain('Active');
      // The old section title is gone: the record header's h1 is the page's heading.
      expect(el().querySelector('#pods-editor-title')).toBeNull();
      expect(el().querySelectorAll('h1').length).toBe(1);
    });

    it('the Users step of the crumb is text for a person who may not open the Users page', async () => {
      await create('Pod.View', 'Pod.ManageMembers');
      await openEditor(1);
      expect(
        q('[data-record-header]').querySelector('.rh__trail a[href="/admin/users"]'),
      ).toBeNull();
    });

    it('offers Deactivate pod in the header overflow only with Pod.Manage, and it asks first', async () => {
      await create('Pod.View', 'Pod.Manage', 'Pod.ManageMembers');
      await openEditor(1);
      q('[data-record-header] [data-overflow]').click();
      await settle();
      const item = document.querySelector<HTMLElement>('[data-action="deactivate"]');
      expect(item?.textContent).toContain('Deactivate pod');
      item!.click();
      await settle();
      expect(api.updatePod).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain('Deactivate pod?');
    });

    it('has no Deactivate for Pod.ManageMembers alone, and the name and status stay read only', async () => {
      await create('Pod.View', 'Pod.ManageMembers');
      await openEditor(1);
      expect(q('[data-record-header]').querySelector('[data-overflow]')).toBeNull();
      expect(q<HTMLInputElement>('input[data-name]').disabled).toBe(true);
      expect(q<HTMLInputElement>('[data-active]').disabled).toBe(true);
    });

    it('shows the not-found state for an unknown pod, with no editor and a link out', async () => {
      api.getPod.mockReturnValue(
        throwError(
          () =>
            new ApiError(
              404,
              'NOT_FOUND',
              'No such pod',
              undefined,
              new HttpErrorResponse({ status: 404 }),
            ),
        ),
      );
      await create('Pod.View', 'Pod.Manage', 'Pod.ManageMembers');
      await openEditor(999);
      expect(q('[data-record-state]').getAttribute('data-record-state')).toBe('notFound');
      expect(el().textContent).toContain("We couldn't find that pod.");
      expect(el().querySelector('[data-editor]')).toBeNull();
    });

    it('shows the failure state with Retry for a pod that cannot be read, and Retry loads it', async () => {
      api.getPod.mockReturnValueOnce(
        throwError(
          () =>
            new ApiError(500, undefined, 'boom', undefined, new HttpErrorResponse({ status: 500 })),
        ),
      );
      await create('Pod.View', 'Pod.Manage', 'Pod.ManageMembers');
      await openEditor(1);
      expect(q('[data-record-state]').getAttribute('data-record-state')).toBe('error');
      await click('[data-retry]');
      await settle();
      expect(el().querySelector('[data-editor]')).not.toBeNull();
    });

    it('?pod=new is the 403 state without Pod.Manage and the editor with it', async () => {
      await create('Pod.View', 'Pod.ManageMembers');
      fixture.componentRef.setInput('pod', 'new');
      await settle();
      expect(q('[data-record-state]').getAttribute('data-record-state')).toBe('forbidden');
      expect(el().querySelector('[data-editor]')).toBeNull();
    });

    it('Back to the list goes to the address the list had and leaves the editor', async () => {
      await create('Pod.View', 'Pod.Manage', 'Pod.ManageMembers');
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      await openEditor(1);
      await click('[data-editor] .mf-form-actions p-button:last-of-type');
      expect(navigate).toHaveBeenCalled();
      const back = navigate.mock.calls.find((c) => (c[1] as { state?: unknown })?.state);
      expect(String(back![0])).toContain('/admin/pods');
      expect(back![1]).toEqual({ state: { restoreFocus: true } });
    });
  });

  it('lists pods with member counts and status, and offers New pod to managers only', async () => {
    await create('Pod.View', 'Pod.Manage', 'Pod.ManageMembers');

    expect(text('[data-pod="1"]')).toContain('Pod A');
    expect(text('[data-pod="1"]')).toContain('2');
    expect(text('[data-pod="1"]')).toContain('Active');
    expect(text('[data-pod="2"]')).toContain('Inactive');
    expect(el().textContent).toContain('New pod');
    expect(el().textContent).toContain('Pod leads are a role');
  });

  it('the name is the one link of the row, there is no Edit link and no actions column, and Inactive is the word for the inactive state (#450)', async () => {
    await create('Pod.View', 'Pod.Manage', 'Pod.ManageMembers');
    const row = q('[data-pod="1"]');
    const links = Array.from(row.querySelectorAll('a, button'));
    expect(links.length).toBe(1);
    expect(links[0].textContent!.trim()).toBe('Pod A');
    expect(links[0].getAttribute('href')).toContain('pod=1');
    expect(row.querySelector('[data-edit]')).toBeNull();
    expect(
      Array.from(el().querySelectorAll('thead tr:first-child th')).map((th) =>
        th.textContent!.trim(),
      ),
    ).toEqual(['Name', 'Members', 'Status']);
    expect(text('[data-pod="2"]')).toContain('Inactive');
    expect(el().textContent).not.toContain('Disabled');
    expect(q('[data-pod="1"] .mf-desc').textContent).toContain('Processing');
  });

  it('says how many inactive pods the default Active hides and Show all reaches them (#450)', async () => {
    api['listPods'].mockImplementation((_q, _n, active, _p, size) =>
      of({
        items: active === false ? [podB] : [podA],
        total: active === false ? 3 : 1,
        page: 1,
        pageSize: size ?? 25,
      }),
    );
    await create('Pod.View', 'Pod.Manage');
    expect(el().textContent).toContain('3 inactive hidden');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const showAll = Array.from(el().querySelectorAll('button')).find((b) =>
      b.textContent!.includes('Show all'),
    )!;
    showAll.click();
    await settle();
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ status: 'all' }) }),
    );
  });

  it('follows the address: Back (the bare list) closes the editor, unless there are unsaved edits (#450)', async () => {
    await create('Pod.View', 'Pod.Manage');
    await openEditor(1);
    expect(el().querySelector('[data-editor]')).not.toBeNull();
    fixture.componentRef.setInput('pod', undefined);
    await settle();
    expect(el().querySelector('[data-editor]')).toBeNull();
    expect(el().querySelector('[data-pods]')).not.toBeNull();

    await openEditor(1);
    await type('input[data-name]', 'Pod A renamed');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.componentRef.setInput('pod', undefined);
    await settle();
    // Unsaved edits: the editor stays and the address says so again.
    expect(el().querySelector('[data-editor]')).not.toBeNull();
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { pod: '1' } }),
    );
  });

  it('offers "Skip to table" and lands on the name of the first pod (#450)', async () => {
    await create('Pod.View', 'Pod.Manage');
    const target = TestBed.inject(SkipTarget).target()!;
    expect(target.label).toBe('Skip to table');
    target.focus();
    expect(document.activeElement).toBe(q('[data-pod="1"] a'));
  });

  it('puts its filters in the page header registry while the list is open and takes them away with the editor (#450)', async () => {
    const registry = new AdminShellFilters();
    localStorage.clear();
    query = fakeQuery();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        { provide: AdminShellFilters, useValue: registry },
        provideFakeMe(new FakeMeApi(withPermissions('Pod.View', 'Pod.Manage'))),
        { provide: PodsClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(PodsPage);
    await settle();
    expect(registry.current()?.controls).toBe('pods-filter-row');
    await openEditor();
    expect(registry.current()).toBeNull();
    fixture.destroy();
  });

  it('hides New pod, Save and member controls without the manage permissions', async () => {
    await create('Pod.View');

    expect(el().textContent).not.toContain('New pod');
    await openEditor();
    expect(q<HTMLInputElement>('input[data-name]').disabled).toBe(true);
    expect(el().textContent).not.toContain('Save');
    expect(el().querySelector('[data-remove]')).toBeNull();
    expect(el().querySelector('[data-candidate-search]')).toBeNull();
    expect(q<HTMLButtonElement>('[data-primary]').disabled).toBe(true);
  });

  it('lists active pods first and sends the URL state (name, status, page size, sort) to the API', async () => {
    await create('Pod.View', 'Pod.Manage');
    expect(api.listPods).toHaveBeenCalledWith(undefined, undefined, true, 1, 25, undefined);
    // And one row of the other side of the default Active status, for the "n inactive hidden" hint.
    expect(api.listPods).toHaveBeenCalledWith(undefined, undefined, false, 1, 1);

    query.set({ name: ' alp ', status: 'inactive' });
    fixture.componentRef.setInput('size', '50');
    fixture.componentRef.setInput('sort', '-memberCount');
    await settle();
    expect(api.listPods).toHaveBeenLastCalledWith(undefined, 'alp', false, 1, 50, '-memberCount');

    query.set({ status: 'all' });
    await settle();
    expect(api.listPods).toHaveBeenLastCalledWith(
      undefined,
      'alp',
      undefined,
      1,
      50,
      '-memberCount',
    );
  });

  it('has the Name and Status column filters instead of a search box and a status select, open by default (#450)', async () => {
    await create('Pod.View', 'Pod.Manage');

    expect(el().querySelector('#pods-search, #pods-status, mf-search-box')).toBeNull();
    expect(el().querySelector('[data-filter-row]')).not.toBeNull();
    // The Filters button and Clear filters are in the page header (the Users shell), not in the list.
    expect(el().querySelector('[data-filters-toggle]')).toBeNull();
    expect(q('[aria-label="Filter by Name"]')).not.toBeNull();
    // Active is the default: shown in its cell, not counted.
    expect(q<HTMLSelectElement>('[aria-label="Filter by Status"]').value).toBe('active');
    expect(el().querySelector('[data-filter-count]')).toBeNull();
  });

  it('writes name, status and sort changes to the URL', async () => {
    await create('Pod.View', 'Pod.Manage');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    await type('[aria-label="Filter by Name"]', 'alp', 350);
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { name: 'alp', page: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    const select = q<HTMLSelectElement>('[aria-label="Filter by Status"]');
    select.value = 'inactive';
    select.dispatchEvent(new Event('change'));
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { status: 'inactive', page: null },
      queryParamsHandling: 'merge',
    });

    q<HTMLButtonElement>('th[aria-sort] button').click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { sort: '-name', page: null },
      queryParamsHandling: 'merge',
    });
  });

  it('shows the filtered empty state inside the table: headers and filter row stay, Clear filters restores the list', async () => {
    api['listPods'].mockReturnValue(of({ items: [], total: 0, page: 1, pageSize: 25 }));
    await create('Pod.View', 'Pod.Manage');
    query.set({ name: 'nothing' });
    await settle();

    expect(el().querySelector('td[data-empty="filtered"]')?.textContent).toContain(
      'No pods match these filters',
    );
    expect(el().querySelector('thead th')).not.toBeNull();
    expect(el().querySelector('[data-filter-row]')).not.toBeNull(); // opened by the address
    expect(el().querySelector('mf-pager')).toBeNull();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await click('td[data-empty] p-button');
    expect(navigate).toHaveBeenCalled();
  });

  it('requires a name, then creates the pod and opens it for member management', async () => {
    await create('Pod.View', 'Pod.Manage', 'Pod.ManageMembers');
    await click('p-button');

    expect(text('label[for="pod-name"]')).toBe('Name (required)'); // "(required)", not an asterisk
    expect(q('#pod-name').classList).toContain('mf-control');
    expect(el().textContent).not.toContain('*');
    expect(
      Array.from(el().querySelectorAll('.pods__actions p-button')).map((b) =>
        b.textContent!.trim(),
      ),
    ).toEqual(['Create pod', 'Cancel']);

    await click('.pods__actions p-button');
    expect(text('[data-name-error]')).toBe('Enter a pod name.');
    expect(api.createPod).not.toHaveBeenCalled();

    await type('input[data-name]', '  Pod C ');
    await type('[data-description]', 'New work');
    await click('.pods__actions p-button');

    expect(api.createPod).toHaveBeenCalledWith({ name: 'Pod C', description: 'New work' });
    expect(text('[data-page-title]')).toContain('Pod C');
    expect(text('[data-live]')).toBe(''); // the toast confirms the save; no second message
    expect(text('[data-no-members]')).toBe('No members yet.');
  });

  it('maps a duplicate-name conflict to the name field', async () => {
    api['createPod'].mockReturnValueOnce(
      throwError(
        () =>
          new ApiError(
            409,
            'DUPLICATE_NAME',
            'A pod named x already exists.',
            undefined,
            new HttpErrorResponse({ status: 409 }),
          ),
      ),
    );
    await create('Pod.View', 'Pod.Manage');
    await click('p-button');
    await type('input[data-name]', 'Pod A');

    await click('.pods__actions p-button');

    expect(text('[data-name-error]')).toBe("A pod named 'Pod A' already exists.");
    expect(q('input[data-name]').getAttribute('aria-invalid')).toBe('true');
  });

  it('shows members with their roles as read-only chips and no lead control', async () => {
    await create('Pod.View', 'Pod.Manage', 'Pod.ManageMembers');
    await openEditor();

    const row = q('[data-member="7"]');
    expect(Array.from(row.querySelectorAll('[data-role]')).map((r) => r.textContent)).toEqual([
      'Data Technician',
      'Pod Lead',
    ]);
    expect(q('[data-primary]').getAttribute('aria-pressed')).toBe('true');
    expect(el().textContent!.toLowerCase()).not.toContain('make lead');
  });

  it('removes a member and sets or clears a primary pod', async () => {
    await create('Pod.View', 'Pod.Manage', 'Pod.ManageMembers');
    await openEditor();

    await click('[data-member="7"] [data-primary]');
    expect(api.setPrimaryPod).toHaveBeenCalledWith(1, 7, { isPrimary: false });

    await click('[data-remove="7"]');
    expect(api.removePodMember).toHaveBeenCalledWith(1, 7);
    expect(api.getPod).toHaveBeenCalledTimes(2);
  });

  it('adds several members found by typeahead, skipping people already in the pod', async () => {
    api['getPod'].mockReturnValueOnce(of(detailOf(podA, [member(7, 'Tariq M.')])));
    await create('Pod.View', 'Pod.Manage', 'Pod.ManageMembers');
    await openEditor();

    await type('[data-candidate-search]', 'ri', 250);
    expect(api.findPodMemberCandidates).toHaveBeenCalledWith('ri');
    expect(el().querySelector('[data-candidate="7"]')).toBeNull();

    q<HTMLInputElement>('[data-candidate="9"]').click();
    await settle();
    await click('.pods__add p-button');

    expect(api.addPodMembers).toHaveBeenCalledWith(1, { userIds: [9] });
    expect(text('[data-live]')).toBe('Member added.');
    expect(el().querySelector('[data-candidates]')).toBeNull();
  });

  it('asks before deactivating, then sends the row version with isActive false', async () => {
    await create('Pod.View', 'Pod.Manage', 'Pod.ManageMembers');
    await openEditor();

    q<HTMLInputElement>('[data-active]').click();
    await settle();
    expect(text('[data-deactivate-note]')).toContain('keeps its members and history');

    await click('.pods__actions p-button');
    expect(api.updatePod).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Deactivate pod?');
    expect(document.body.textContent).toContain('Keep active');

    const confirm = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Deactivate pod' && b.closest('p-dialog, .p-dialog'),
    );
    expect(confirm).toBeDefined();
    confirm!.click();
    await settle();
    expect(api.updatePod).toHaveBeenCalledWith(1, {
      name: 'Pod A',
      description: 'Processing',
      isActive: false,
      rowVersion: 'rv1',
    });
    expect(document.body.textContent).not.toContain('Deactivate pod?');
  });

  it('does not allow adding members to an inactive pod', async () => {
    await create('Pod.View', 'Pod.Manage', 'Pod.ManageMembers');
    await openEditor(2);

    expect(text('[data-inactive-note]')).toContain('Reactivate it to add members');
    expect(el().querySelector('[data-candidate-search]')).toBeNull();
  });

  it('offers a reload after a concurrency conflict', async () => {
    api['updatePod'].mockReturnValueOnce(
      throwError(
        () =>
          new ApiError(
            409,
            'CONCURRENCY_CONFLICT',
            'changed',
            undefined,
            new HttpErrorResponse({ status: 409 }),
          ),
      ),
    );
    await create('Pod.View', 'Pod.Manage');
    await openEditor();
    await type('input[data-name]', 'Pod Alpha');

    await click('.pods__actions p-button');
    expect(text('[data-failure]')).toContain('Someone else changed this pod');

    await click('[data-failure] p-button');
    expect(api.getPod).toHaveBeenCalledTimes(2);
    expect(el().querySelector('[data-failure]')).toBeNull();
  });

  it('reports unsaved edits through the leave guard contract', async () => {
    await create('Pod.View', 'Pod.Manage');
    await openEditor();
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);

    await type('input[data-name]', 'Changed');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
  });

  it('shows a retryable error when the list cannot be loaded', async () => {
    api['listPods'].mockReturnValueOnce(throwError(() => new Error('down')));
    await create('Pod.View');

    expect(el().querySelector('[data-error]')).not.toBeNull();
    await click('[data-error] p-button');
    expect(el().querySelector('[data-error]')).toBeNull();
    expect(el().querySelector('[data-pod="1"]')).not.toBeNull();
  });
});
