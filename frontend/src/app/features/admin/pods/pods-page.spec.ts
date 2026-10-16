import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
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
        MessageService,
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

  async function openEditor(podId = 1): Promise<void> {
    await click(`[data-edit="${podId}"]`);
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

  it('lists pods with member counts and status, and offers New pod to managers only', async () => {
    await create('Pod.View', 'Pod.Manage', 'Pod.ManageMembers');

    expect(text('[data-pod="1"]')).toContain('Pod A');
    expect(text('[data-pod="1"]')).toContain('2');
    expect(text('[data-pod="1"]')).toContain('Active');
    expect(text('[data-pod="2"]')).toContain('Inactive');
    expect(el().textContent).toContain('New pod');
    expect(el().textContent).toContain('Pod leads are a role');
  });

  it('hides New pod, Save and member controls without the manage permissions', async () => {
    await create('Pod.View');

    expect(el().textContent).not.toContain('New pod');
    await openEditor();
    expect(q<HTMLInputElement>('[data-name]').disabled).toBe(true);
    expect(el().textContent).not.toContain('Save');
    expect(el().querySelector('[data-remove]')).toBeNull();
    expect(el().querySelector('[data-candidate-search]')).toBeNull();
    expect(q<HTMLButtonElement>('[data-primary]').disabled).toBe(true);
  });

  it('lists active pods first and sends the URL state (name, status, page size, sort) to the API', async () => {
    await create('Pod.View', 'Pod.Manage');
    expect(api.listPods).toHaveBeenLastCalledWith(undefined, undefined, true, 1, 25, undefined);

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

  it('has the Name and Status column filters instead of a search box and a status select, closed by default', async () => {
    await create('Pod.View', 'Pod.Manage');

    expect(el().querySelector('#pods-search, #pods-status, mf-search-box')).toBeNull();
    expect(el().querySelector('[data-filter-row]')).toBeNull();
    await click('[data-filters-toggle]');
    expect(q('[aria-label="Filter by Name"]')).not.toBeNull();
    // Active is the default: shown in its cell, not counted.
    expect(q<HTMLSelectElement>('[aria-label="Filter by Status"]').value).toBe('active');
    expect(el().querySelector('[data-filter-count]')).toBeNull();
  });

  it('writes name, status and sort changes to the URL', async () => {
    await create('Pod.View', 'Pod.Manage');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await click('[data-filters-toggle]');

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

    await type('[data-name]', '  Pod C ');
    await type('[data-description]', 'New work');
    await click('.pods__actions p-button');

    expect(api.createPod).toHaveBeenCalledWith({ name: 'Pod C', description: 'New work' });
    expect(text('#pods-editor-title')).toBe('Edit pod');
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
    await type('[data-name]', 'Pod A');

    await click('.pods__actions p-button');

    expect(text('[data-name-error]')).toBe("A pod named 'Pod A' already exists.");
    expect(q('[data-name]').getAttribute('aria-invalid')).toBe('true');
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
    await type('[data-name]', 'Pod Alpha');

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

    await type('[data-name]', 'Changed');
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
