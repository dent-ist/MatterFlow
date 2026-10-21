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
import {
  auditObjectLink,
  auditObjectRoute,
  auditObjectText,
  groupByCorrelation,
} from './audit-links';

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

  const click = (selector: string) => el().querySelector<HTMLElement>(selector)!.click();
  const lastCall = () => api.searchAuditEvents.mock.calls.at(-1)!;

  it('shows plain text for every object to an Audit.View-only person, and links to the ones they may open', async () => {
    await create(['Audit.View']);
    expect(el().querySelectorAll('a.au-linkout').length).toBe(0);
    expect(el().textContent).toContain('Task: TSK-1042 Process Smith custodians');
    TestBed.resetTestingModule();

    await create(['Audit.View', 'Task.View']);
    expect(el().querySelectorAll('a.au-linkout').length).toBeGreaterThan(0);
  });

  it('shows nothing and loads nothing without Audit.View', async () => {
    await create(['Task.View']);

    expect(el().querySelector('[data-no-access]')).not.toBeNull();
    expect(api.searchAuditEvents).not.toHaveBeenCalled();
  });

  it('loads the newest events, shows the actor, a readable sentence and the time in the viewer zone', async () => {
    await create(['Audit.View', 'Task.View']);

    expect(lastCall()[9]).toBe(50); // page size
    const row = el().querySelector('tr[data-event="100"]')!;
    expect(row.textContent).toContain('Dana Director');
    expect(row.textContent).toContain('Status changed from In Progress to On Hold');
    // The time alone in the row (the day is the divider above it); the whole stamp with the zone is the tooltip.
    expect(row.querySelector('time')?.textContent).toBe('10:05 AM');
    expect(row.querySelector('time')?.getAttribute('title')).toBe('Oct 14, 2026, 10:05 AM CDT');
    expect(el().querySelector('tr.au-day')?.textContent).toContain('Oct 14');
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/tasks/1042');
    expect(row.querySelector('a')?.textContent).toContain('TSK-1042 Process Smith custodians');
    expect(el().querySelector('th[title*="America/Chicago"]')?.textContent).toContain('When');
    expect(el().textContent).toContain('Every recorded change, newest first. Read only.');
  });

  it('has no filter form: the filters are column filters, and the row is open from the start (#646)', async () => {
    await create(['Audit.View']);

    expect(el().querySelector('form[role="search"], [data-apply], [data-reset]')).toBeNull();
    expect(el().querySelector('[data-filter-row]')).not.toBeNull();
    expect(el().querySelector('[data-filters-toggle]')).not.toBeNull(); // the Filters button is in the page header
    // The event and object types come from the facets; the object id waits for a type.
    const events = Array.from(control<HTMLSelectElement>('Event type').options).map((o) =>
      o.textContent?.trim(),
    );
    expect(events).toEqual(['Any event', 'Field changed', 'Task created']); // the code stays the value (#650)
    expect(
      Array.from(control<HTMLSelectElement>('Event type').options).map((o) => o.value),
    ).toEqual(['', 'FIELD_CHANGED', 'TASK_CREATED']);
    const objects = Array.from(control<HTMLSelectElement>('Object type').options).map((o) =>
      o.textContent?.trim(),
    );
    expect(objects).toEqual([
      'Any object',
      'Configuration changes',
      'Access changes',
      'Matter',
      'Task',
    ]);
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

  it('offers the people present in the loaded events in Who without User.View, and sends the id (#656)', async () => {
    await create(
      ['Audit.View'],
      ok(
        pageOfEvents([
          anItem({ auditEventId: 3, actor: { userId: 4, displayName: 'Dana Director' } }),
          anItem({ auditEventId: 2, actor: { userId: 12, displayName: 'Casey Clerk' } }),
          anItem({ auditEventId: 1, actor: { userId: undefined, displayName: 'System' } }),
        ]),
      ),
      { actor: '12' },
    );

    expect(users.listUsers).not.toHaveBeenCalled(); // no user lookup without User.View
    expect(lastCall()[2]).toEqual([12]);
    expect(el().querySelector('input[aria-label="Filter by Who (user id)"]')).toBeNull();
    const who = el().querySelector('button[data-filter="actor"]')!;
    expect(who.getAttribute('aria-label') ?? who.textContent).toContain('Casey Clerk');
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
    expect(detail.querySelector('[data-new]')?.textContent).toBe('[REDACTED]');
    expect(detail.textContent).toContain('The log keeps only the start of this value');
    expect(detail.textContent).toContain('Secret values are hidden');
    expect(detail.querySelector('[data-field]')?.textContent).toBe('Api token');
    expect(detail.querySelector('[data-show-operation]')?.textContent).toContain('3 events');
    expect(toggle.getAttribute('aria-controls')).toBe('au-detail-100');
    // The code, field key and operation id wait behind "Technical details" (#652).
    expect(detail.querySelector('[data-tech]')).toBeNull();
    expect(detail.textContent).not.toContain('TASK_STATUS_CHANGED');
    detail.querySelector<HTMLButtonElement>('[data-tech-toggle]')!.click();
    await settle(fixture);
    expect(detail.querySelector('[data-tech]')?.textContent).toContain('TASK_STATUS_CHANGED');
    expect(detail.querySelector('[data-tech]')?.textContent).toContain('api_token');
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

    // "Show only this operation" is in the details of an event (and the row menu), not repeated on every group row (#651).
    expect(el().querySelector(`[data-group="${BULK}"] button.mf-btn--text`)).toBeNull();
    el().querySelector<HTMLElement>('tr[data-event="12"] .au-toggle')!.click();
    await settle(fixture);
    el().querySelector<HTMLElement>('[data-show-operation]')!.click();
    // "Show only this operation" replaces the filters with the operation (one removable chip) and the address reloads the list.
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: expect.objectContaining({ correlationId: BULK, page: null }),
      queryParamsHandling: 'merge',
    });
    query.set({ correlationId: BULK });
    await settle(fixture);
    expect(lastCall()[7]).toBe(BULK);
    expect(el().querySelector('[data-operation-banner]')).toBeNull(); // the chip and the header's Clear are enough
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

  it('puts a day divider above the first event of each day and shows only the time in the row (#655)', async () => {
    await create(
      ['Audit.View'],
      ok(
        pageOfEvents([
          anItem({ auditEventId: 5, occurredAtUtc: '2026-10-14T20:00:00Z', correlationId: 'e' }),
          anItem({ auditEventId: 4, occurredAtUtc: '2026-10-14T15:00:00Z', correlationId: 'd' }),
          // 02:30 UTC on Oct 14 is 9:30 PM on Oct 13 in Chicago: the day boundary is the viewer's.
          anItem({ auditEventId: 3, occurredAtUtc: '2026-10-14T02:30:00Z', correlationId: 'c' }),
          anItem({ auditEventId: 2, occurredAtUtc: '2025-12-31T18:00:00Z', correlationId: 'b' }),
        ]),
      ),
    );

    const days = Array.from(el().querySelectorAll('tr.au-day th')).map((th) =>
      th.textContent?.trim(),
    );
    expect(days).toEqual(['Oct 14', 'Oct 13', 'Dec 31, 2025']);
    expect(el().querySelector('tr.au-day th')?.getAttribute('scope')).toBe('row');
    expect(el().querySelector('tr[data-event="3"] time')?.textContent).toBe('9:30 PM');
  });

  it('sets the quick views as address filters, marks the pressed one and clears it again (#654)', async () => {
    await create(['Audit.View']);
    const view = (key: string) => el().querySelector<HTMLButtonElement>(`[data-view="${key}"]`)!;
    expect(view('today').getAttribute('aria-pressed')).toBe('false');

    view('config').click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: expect.objectContaining({
        objectType:
          'AssetType,AssetLinkRole,Priority,StatusLabel,TaskType,WorkflowDefinition,StepDefinition,FormDefinition,FormVersion',
      }),
      queryParamsHandling: 'merge',
    });

    query.set({ objectType: 'User,Role,Pod,PodMember' });
    await settle(fixture);
    expect(view('access').getAttribute('aria-pressed')).toBe('true');
    expect(view('config').getAttribute('aria-pressed')).toBe('false');
    expect(lastCall()[0]).toBe('User,Role,Pod,PodMember');

    view('access').click(); // pressing the pressed view clears it
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: expect.objectContaining({ objectType: null }),
      queryParamsHandling: 'merge',
    });
  });

  it('counts the loaded events politely and suggests narrowing the dates after 1,000 (#653)', async () => {
    await create(
      ['Audit.View'],
      ok(pageOfEvents([anItem({ auditEventId: 1 }), anItem({ auditEventId: 2 })], 1)),
    );
    const count = el().querySelector('[data-loaded]')!;
    expect(count.textContent).toContain('2 events loaded');
    expect(count.getAttribute('aria-live')).toBe('polite');
    expect(count.querySelector('[data-many]')).toBeNull();
    TestBed.resetTestingModule();

    const many = Array.from({ length: 1000 }, (_, i) =>
      anItem({ auditEventId: 2000 - i, correlationId: `c${i}` }),
    );
    await create(['Audit.View'], ok(pageOfEvents(many)));
    const hint = el().querySelector('[data-loaded]')!;
    expect(hint.textContent).toContain('1,000 events loaded');
    expect(hint.querySelector('[data-many]')?.textContent).toContain(
      'Narrow the date range to find older events',
    );
  });

  it('names the toggle by what happened and who did it, and shows the Old -> New pair of a field change (#652)', async () => {
    await create(
      ['Audit.View'],
      ok(
        pageOfEvents([
          anItem({
            eventType: 'FIELD_CHANGED',
            fieldKey: 'Description',
            summary: 'Description changed',
            oldValue: undefined,
            newValue: 'x'.repeat(300),
          }),
        ]),
      ),
    );
    const toggle = el().querySelector<HTMLButtonElement>('tr[data-event="100"] .au-toggle')!;
    expect(toggle.getAttribute('aria-label')).toBe(
      'Show details: Description changed by Dana Director',
    );
    toggle.click();
    await settle(fixture);

    const detail = el().querySelector('#au-detail-100')!;
    expect(detail.querySelector('[data-sentence]')?.textContent).toContain(
      'Description changed by Dana Director, Oct 14, 2026, 10:05 AM CDT.',
    );
    expect(detail.querySelector('[data-field]')?.textContent).toBe('Description');
    expect(detail.querySelector('[data-old]')?.textContent).toBe('(empty)');
    // A long value starts clamped and "Show full" opens it.
    expect(detail.querySelector('[data-new]')?.classList.contains('au-clamped')).toBe(true);
    detail.querySelector<HTMLButtonElement>('[data-show-full="new"]')!.click();
    await settle(fixture);
    expect(detail.querySelector('[data-new]')?.classList.contains('au-clamped')).toBe(false);
    expect(detail.querySelector('[data-show-full="new"]')?.getAttribute('aria-expanded')).toBe(
      'true',
    );
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
    expect(el().querySelector('[data-filter-row]')).not.toBeNull();
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
  const ALL = () => true;
  const route = (type: string, id: string, taskId?: number, can: (p: string) => boolean = ALL) =>
    auditObjectRoute(anItem({ object: { type, id, label: undefined }, taskId }), can);

  it('routes known objects and falls back to the owning task', () => {
    expect(route('Task', '5')).toEqual(['/tasks', '5']);
    expect(route('Matter', '7')).toEqual(['/matters', '7']);
    expect(route('Client', '1')).toEqual(['/clients', '1']);
    expect(route('Asset', '9')).toEqual(['/assets', '9']);
    expect(route('Project', '3')).toEqual(['/projects', '3']);
    expect(route('User', '4')).toEqual(['/admin/users']);
    expect(route('StepInstance', '55', 12)).toEqual(['/tasks', '12']);
    expect(route('Role', '2')).toEqual(['/admin/roles']);
    expect(route('Role', '2', undefined, (p) => p === 'Audit.View')).toBeNull();
    expect(route('Task', 'abc')).toBeNull();
  });

  it('links an object only when the viewer holds the permission to open it (every type x permission)', () => {
    const cases: [string, string, string, string[]][] = [
      ['Task', '5', 'Task.View', ['/tasks', '5']],
      ['Matter', '7', 'Matter.View', ['/matters', '7']],
      ['Client', '1', 'Client.View', ['/clients', '1']],
      ['Asset', '9', 'Asset.View', ['/assets', '9']],
      ['Project', '3', 'Project.View', ['/projects', '3']],
      ['User', '4', 'User.View', ['/admin/users']],
    ];
    for (const [type, id, needed, expected] of cases) {
      expect(route(type, id, undefined, (p) => p === needed)).toEqual(expected);
      expect(route(type, id, undefined, (p) => p !== needed)).toBeNull();
      expect(route(type, id, undefined, () => false)).toBeNull();
    }
    // Parts of a task open the task, so they need Task.View.
    expect(route('StepInstance', '55', 12, (p) => p === 'Task.View')).toEqual(['/tasks', '12']);
    expect(route('StepInstance', '55', 12, (p) => p !== 'Task.View')).toBeNull();
  });

  it('links the configuration objects only with the matching Manage permission (every object x permission)', () => {
    const cases: [string, string, string, string[], Record<string, string> | undefined][] = [
      ['AssetType', '6', 'AssetType.Manage', ['/admin/asset-types', '6'], undefined],
      ['AssetLinkRole', '3', 'AssetType.Manage', ['/admin/asset-types'], { tab: 'link-roles' }],
      ['Priority', '8', 'Priority.Manage', ['/admin/priorities'], undefined],
      ['StatusLabel', 'ON_HOLD', 'StatusLabel.Manage', ['/admin/status-labels'], undefined],
      ['Role', '2', 'Role.Manage', ['/admin/roles'], undefined],
      ['TaskType', '5', 'TaskType.Manage', ['/admin/task-types', '5'], undefined],
      ['WorkflowDefinition', '4', 'Workflow.Manage', ['/admin/workflows', '4'], undefined],
      ['StepDefinition', '9', 'Workflow.Manage', ['/admin/steps', '9'], undefined],
    ];
    for (const [type, id, needed, commands, queryParams] of cases) {
      const item = anItem({ object: { type, id, label: undefined }, taskId: undefined });
      const link = auditObjectLink(item, (p) => p === needed);
      expect(link?.commands, type).toEqual(commands);
      expect(link?.queryParams, type).toEqual(queryParams);
      expect(
        auditObjectLink(item, (p) => p !== needed),
        `${type} without ${needed}`,
      ).toBeNull();
      expect(
        auditObjectLink(item, () => false),
        type,
      ).toBeNull();
      // Audit.View alone, and Task.View alone, never make a dead link.
      expect(
        auditObjectLink(item, (p) => p === 'Audit.View'),
        type,
      ).toBeNull();
    }
  });

  it('labels an object by its resolved name or by type and id', () => {
    expect(auditObjectText(anItem())).toBe('Task: TSK-1042 Process Smith custodians');
    expect(auditObjectText(anItem({ object: { type: 'Role', id: '2', label: undefined } }))).toBe(
      'Role #2',
    );
    expect(
      auditObjectText(
        anItem({ object: { type: 'AssetType', id: '6', label: 'Relativity Workspace' } }),
      ),
    ).toBe('Asset type: Relativity Workspace');
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
