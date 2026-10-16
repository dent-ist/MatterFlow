import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Observable, throwError } from 'rxjs';
import {
  AuditSearchClient,
  AuditSearchItem,
  AuditSearchPage,
  UsersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import {
  FakeMeApi,
  fakeQuery,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { AuditPage } from './audit-page';
import { auditObjectRoute, auditObjectText, groupByCorrelation } from './audit-links';

type Mock = ReturnType<typeof vi.fn>;

const BULK = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function anItem(overrides: Partial<AuditSearchItem> = {}): AuditSearchItem {
  return {
    auditEventId: 100,
    occurredAtUtc: '2026-10-14T15:05:00Z',
    actor: { userId: 4, displayName: 'Dana Director' },
    eventType: 'TASK_STATUS_CHANGED',
    object: { type: 'Task', id: '1042', label: 'TSK-1042 Process Smith custodians' },
    matterId: 7,
    taskId: 1042,
    fieldKey: undefined,
    summary: 'Status changed from In Progress to On Hold',
    oldValue: 'IN_PROGRESS',
    newValue: 'ON_HOLD',
    oldValueTruncated: false,
    newValueTruncated: false,
    valuesRedacted: false,
    correlationId: 'aaaa',
    correlationEventCount: 1,
    taskLabel: undefined,
    ...overrides,
  };
}

const pageOfEvents = (items: AuditSearchItem[], nextCursor?: number): AuditSearchPage => ({
  items,
  nextCursor,
  pageSize: 50,
  timeZone: 'America/Chicago',
});

describe('AuditPage', () => {
  let api: { searchAuditEvents: Mock; getAuditFacets: Mock };
  let users: { listUsers: Mock };
  let query: ReturnType<typeof fakeQuery>;
  let navigate: Mock;
  let fixture: ComponentFixture<AuditPage>;
  const el = (): HTMLElement => fixture.nativeElement;

  async function create(
    permissions: Permission[],
    search: Observable<AuditSearchPage> = ok(pageOfEvents([anItem()])),
    params: Record<string, string> = {},
  ): Promise<void> {
    localStorage.clear();
    api = {
      searchAuditEvents: vi.fn().mockReturnValue(search),
      getAuditFacets: vi
        .fn()
        .mockReturnValue(
          ok({ objectTypes: ['Matter', 'Task'], eventTypes: ['FIELD_CHANGED', 'TASK_CREATED'] }),
        ),
    };
    users = {
      listUsers: vi.fn().mockReturnValue(
        ok({
          items: [
            { userId: 4, displayName: 'Dana Director', email: 'dana@example.com', isActive: true },
            { userId: 9, displayName: 'Old Timer', email: undefined, isActive: false },
          ],
          total: 2,
          page: 1,
          pageSize: 100,
        }),
      ),
    };
    query = fakeQuery();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: AuditSearchClient, useValue: api },
        { provide: UsersClient, useValue: users },
        { provide: USER_TIME_ZONE, useValue: 'America/Chicago' },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    query.set(params);
    fixture = TestBed.createComponent(AuditPage);
    await settle(fixture);
  }

  const control = <T extends HTMLElement>(name: string): T =>
    el().querySelector<T>(`[aria-label="Filter by ${name}"]`)!;
  async function openRow(): Promise<void> {
    el().querySelector<HTMLButtonElement>('[data-filters-toggle]')!.click();
    await settle(fixture);
  }

  const click = (selector: string) => el().querySelector<HTMLElement>(selector)!.click();
  const lastCall = () => api.searchAuditEvents.mock.calls.at(-1)!;

  it('shows nothing and loads nothing without Audit.View', async () => {
    await create(['Task.View']);

    expect(el().querySelector('[data-no-access]')).not.toBeNull();
    expect(api.searchAuditEvents).not.toHaveBeenCalled();
  });

  it('loads the newest events, shows the actor, a readable sentence and the time in the viewer zone', async () => {
    await create(['Audit.View']);

    expect(lastCall()[9]).toBe(50); // page size
    const row = el().querySelector('tr[data-event="100"]')!;
    expect(row.textContent).toContain('Dana Director');
    expect(row.textContent).toContain('Status changed from In Progress to On Hold');
    expect(row.querySelector('time')?.textContent).toBe('Oct 14, 2026, 10:05 AM CDT');
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/tasks/1042');
    expect(row.querySelector('a')?.textContent).toContain('TSK-1042 Process Smith custodians');
    expect(el().textContent).toContain('America/Chicago');
    expect(el().textContent).toContain("can't be exported");
  });

  it('has no filter form any more: the filters are column filters, closed by default', async () => {
    await create(['Audit.View']);

    expect(el().querySelector('form[role="search"], [data-apply], [data-reset]')).toBeNull();
    expect(el().querySelector('[data-filter-row]')).toBeNull();
    await openRow();
    expect(el().querySelector('[data-filter-row]')).not.toBeNull();
    // The event and object types come from the facets; the object id waits for a type.
    const events = Array.from(control<HTMLSelectElement>('Event type').options).map((o) =>
      o.textContent?.trim(),
    );
    expect(events).toEqual(['Any event', 'FIELD_CHANGED', 'TASK_CREATED']);
    const objects = Array.from(control<HTMLSelectElement>('Object type').options).map((o) =>
      o.textContent?.trim(),
    );
    expect(objects).toEqual(['Any object', 'Matter', 'Task']);
    expect(control<HTMLInputElement>('Object id').disabled).toBe(true);
    expect(control<HTMLInputElement>('Summary or field')).not.toBeNull();
  });

  it('sends every filter of the address to the API (live, no Apply button)', async () => {
    await create(['Audit.View'], ok(pageOfEvents([anItem()])), {
      objectType: 'Task',
      objectId: '1042',
      eventType: 'TASK_CREATED',
      from: '2026-10-01',
      to: '2026-10-14',
      q: ' status ',
    });

    expect(lastCall()).toEqual([
      'Task',
      '1042',
      undefined,
      'TASK_CREATED',
      '2026-10-01',
      '2026-10-14',
      'status',
      undefined,
      undefined,
      50,
    ]);
    // A link that carries filters opens the row with the values in it and counts them (the date range is one filter).
    expect(control<HTMLInputElement>('Object id').value).toBe('1042');
    expect(control<HTMLInputElement>('Summary or field').value).toBe('status');
    expect(el().querySelector('[data-filter-count]')?.textContent).toBe('(5)');
  });

  it('writes a changed filter to the address (and reloads when the address changes)', async () => {
    await create(['Audit.View']);
    await openRow();

    const type = control<HTMLSelectElement>('Event type');
    type.value = 'TASK_CREATED';
    type.dispatchEvent(new Event('change'));
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { eventType: 'TASK_CREATED', page: null },
      queryParamsHandling: 'merge',
    });

    query.set({ eventType: 'TASK_CREATED' });
    await settle(fixture);
    expect(lastCall()[3]).toBe('TASK_CREATED');
  });

  it('offers the people of the user list in Who (needs User.View) and filters by their ids', async () => {
    await create(['Audit.View', 'User.View'], ok(pageOfEvents([anItem()])), {
      actor: '4',
    });

    expect(users.listUsers).toHaveBeenCalledWith(
      'all',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      100,
    );
    expect(lastCall()[2]).toEqual([4]);
    // The link opens the row; the Who control names the person (the list is the user list, inactive people included).
    expect(
      el().querySelector('button[data-filter="actor"]')?.getAttribute('aria-label') ?? '',
    ).toContain('Dana Director');
  });

  it('falls back to a user id field without User.View', async () => {
    await create(['Audit.View'], ok(pageOfEvents([anItem()])), { actor: '12' });

    expect(users.listUsers).not.toHaveBeenCalled();
    expect(control<HTMLInputElement>('Who (user id)').value).toBe('12');
    expect(lastCall()[2]).toEqual([12]);
  });

  it('expands old and new values and the operation id, and marks hidden secrets', async () => {
    await create(
      ['Audit.View'],
      ok(
        pageOfEvents([
          anItem({
            fieldKey: 'api_token',
            oldValue: '[REDACTED]',
            newValue: '[REDACTED]',
            valuesRedacted: true,
            newValueTruncated: true,
            correlationEventCount: 3,
          }),
        ]),
      ),
    );
    const toggle = el().querySelector<HTMLButtonElement>('tr[data-event="100"] .au-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    await settle(fixture);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const detail = el().querySelector('#au-detail-100')!;
    expect(detail.querySelector('[data-old]')?.textContent).toBe('[REDACTED]');
    expect(detail.querySelector('[data-new]')?.textContent).toContain('(shortened)');
    expect(detail.textContent).toContain('Secret values are hidden');
    expect(detail.textContent).toContain('api_token');
    expect(detail.textContent).toContain('3 events');
    expect(toggle.getAttribute('aria-controls')).toBe('au-detail-100');
  });

  it('groups the events of one operation by default, with one line per operation and field changes on request', async () => {
    const bulk = { correlationId: BULK, correlationEventCount: 4 };
    await create(
      ['Audit.View'],
      ok(
        pageOfEvents([
          anItem({ auditEventId: 12, ...bulk, summary: 'Step A completed (bulk)' }),
          anItem({ auditEventId: 11, ...bulk, summary: 'Step B completed (bulk)' }),
          anItem({
            auditEventId: 10,
            ...bulk,
            eventType: 'FIELD_CHANGED',
            fieldKey: 'OwnerKind',
            summary: 'Owner kind set to StepInstance',
          }),
          anItem({
            auditEventId: 8,
            ...bulk,
            eventType: 'FIELD_CHANGED',
            fieldKey: 'form:billing_code',
            summary: 'Billing code set to B-7',
          }),
          anItem({ auditEventId: 9, correlationId: 'solo', summary: 'Title changed' }),
        ]),
      ),
    );
    // Grouped from the start: the operation is one line and the single event stands alone.
    const group = el().querySelector(`[data-group="${BULK}"]`)!;
    expect(group.querySelector('[data-headline]')?.textContent).toBe(
      'Step A completed (bulk) and 3 related changes',
    );
    expect(group.textContent).toContain('4 events in one operation');
    // The group row carries the Object of the first thing that happened (UXR4-15).
    expect(group.querySelector('[data-group-object]')!.textContent).toContain('Task');
    expect(el().querySelectorAll('tr[data-event]')).toHaveLength(1);

    // Opening the operation shows what happened; the field-level changes stay behind "View changes".
    group.querySelector<HTMLElement>('.au-toggle')!.click();
    await settle(fixture);
    expect(el().querySelectorAll('tr[data-event]')).toHaveLength(3);
    const viewChanges = el().querySelector<HTMLButtonElement>('[data-view-changes]')!;
    expect(viewChanges.textContent).toContain('View 2 field changes');

    viewChanges.click();
    await settle(fixture);
    expect(el().querySelectorAll('tr[data-event]')).toHaveLength(5);
    expect(el().textContent).toContain('Owner kind set to workflow step');
    expect(el().textContent).not.toContain('StepInstance');

    el().querySelector<HTMLElement>(`[data-group="${BULK}"] button.mf-btn--text`)!.click();
    // "Show only this operation" replaces the filters with the operation (one removable chip) and the address reloads the list.
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: expect.objectContaining({ correlationId: BULK, page: null }),
      queryParamsHandling: 'merge',
    });
    query.set({ correlationId: BULK });
    await settle(fixture);
    expect(lastCall()[7]).toBe(BULK);
    expect(el().querySelector('[data-operation-banner]')).not.toBeNull();
  });

  it('lists every event when grouping is switched off', async () => {
    const bulk = { correlationId: BULK, correlationEventCount: 2 };
    await create(
      ['Audit.View'],
      ok(
        pageOfEvents([
          anItem({ auditEventId: 12, ...bulk, summary: 'Step A completed (bulk)' }),
          anItem({ auditEventId: 11, ...bulk, summary: 'Step B completed (bulk)' }),
        ]),
      ),
    );
    expect(el().querySelector('[data-group]')).not.toBeNull();

    click('[data-group-toggle]');
    await settle(fixture);

    expect(el().querySelector('[data-group]')).toBeNull();
    expect(el().querySelectorAll('tr[data-event]')).toHaveLength(2);
  });

  it('names the parts of a Task by their Task, not by their number', () => {
    const item = (type: string, id: string, extra: Record<string, unknown> = {}) =>
      anItem({ object: { type, id, label: undefined }, ...extra });
    expect(
      auditObjectText(item('StepInstance', '40', { taskLabel: 'TSK-1042 Process Smith' })),
    ).toBe('Workflow step on TSK-1042 Process Smith');
    expect(auditObjectText(item('FormValueSet', '22'))).toBe('Form answers');
    expect(auditObjectText(item('Client', '12'))).toBe('Client #12');
  });

  it('pages with the cursor and appends older events', async () => {
    await create(['Audit.View'], ok(pageOfEvents([anItem({ auditEventId: 100 })], 100)));
    api.searchAuditEvents.mockReturnValue(
      ok(pageOfEvents([anItem({ auditEventId: 99, correlationId: 'older', summary: 'Older' })])),
    );

    click('[data-load-more]');
    await settle(fixture);

    expect(lastCall()[8]).toBe(100);
    expect(el().querySelectorAll('tr[data-event]')).toHaveLength(2);
    expect(el().querySelector('[data-load-more]')).toBeNull();
    expect(el().querySelector('[data-end]')).not.toBeNull();
  });

  it('shows the empty states inside the table, with and without filters, keeping the headers and the row', async () => {
    await create(['Audit.View'], ok(pageOfEvents([])));
    expect(el().querySelector('td[data-empty="none"]')?.textContent).toContain(
      'No audit events have been',
    );
    expect(el().querySelector('thead th')).not.toBeNull();

    query.set({ q: 'zzz' });
    await settle(fixture);
    expect(el().querySelector('td[data-empty="filtered"]')?.textContent).toContain(
      'match these filters',
    );
    expect(el().querySelector('[data-filter-row]')).not.toBeNull(); // opened by the address
    expect(el().querySelector('thead th')).not.toBeNull();
    expect(el().querySelector('[data-load-more], [data-end]')).toBeNull();
  });

  it('shows an error with Retry that reloads', async () => {
    await create(
      ['Audit.View'],
      throwError(() => new Error('boom')),
    );
    expect(el().querySelector('[data-error]')).not.toBeNull();

    api.searchAuditEvents.mockReturnValue(ok(pageOfEvents([anItem()])));
    el().querySelector<HTMLElement>('[data-error] button')!.click();
    await settle(fixture);

    expect(el().querySelector('[data-error]')).toBeNull();
    expect(el().querySelector('tr[data-event="100"]')).not.toBeNull();
  });
});

describe('audit links', () => {
  it('routes known objects and falls back to the owning task', () => {
    const route = (type: string, id: string, taskId?: number) =>
      auditObjectRoute(anItem({ object: { type, id, label: undefined }, taskId }));

    expect(route('Task', '5')).toEqual(['/tasks', '5']);
    expect(route('Matter', '7')).toEqual(['/matters', '7']);
    expect(route('Client', '1')).toEqual(['/clients', '1']);
    expect(route('Asset', '9')).toEqual(['/assets', '9']);
    expect(route('Project', '3')).toEqual(['/projects', '3']);
    expect(route('User', '4')).toEqual(['/admin/users']);
    expect(route('StepInstance', '55', 12)).toEqual(['/tasks', '12']);
    expect(route('Role', '2')).toBeNull();
    expect(route('Task', 'abc')).toBeNull();
  });

  it('labels an object by its resolved name or by type and id', () => {
    expect(auditObjectText(anItem())).toBe('Task: TSK-1042 Process Smith custodians');
    expect(auditObjectText(anItem({ object: { type: 'Role', id: '2', label: undefined } }))).toBe(
      'Role #2',
    );
  });

  it('groups only consecutive events of the same operation', () => {
    const groups = groupByCorrelation([
      anItem({ auditEventId: 4, correlationId: 'a' }),
      anItem({ auditEventId: 3, correlationId: 'a' }),
      anItem({ auditEventId: 2, correlationId: 'b' }),
      anItem({ auditEventId: 1, correlationId: 'a' }),
    ]);

    expect(groups.map((g) => g.items.length)).toEqual([2, 1, 1]);
  });
});
