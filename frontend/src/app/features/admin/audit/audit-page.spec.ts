import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { AuditPage } from './audit-page';
import { auditObjectRoute, auditObjectText, groupByCorrelation } from './audit-links';

type Mock = ReturnType<typeof vi.fn>;

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
  let fixture: ComponentFixture<AuditPage>;
  const el = (): HTMLElement => fixture.nativeElement;

  async function create(
    permissions: Permission[],
    search: Observable<AuditSearchPage> = ok(pageOfEvents([anItem()])),
  ): Promise<void> {
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
          items: [{ userId: 4, displayName: 'Dana Director', email: 'dana@example.com' }],
          total: 1,
          page: 1,
          pageSize: 8,
        }),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: AuditSearchClient, useValue: api },
        { provide: UsersClient, useValue: users },
        { provide: USER_TIME_ZONE, useValue: 'America/Chicago' },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(AuditPage);
    await settle(fixture);
  }

  const set = (selector: string, value: string, event = 'input') => {
    const input = el().querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event(event));
  };
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
    expect(row.querySelector('time')?.textContent).toBe('Oct 14, 2026 10:05 AM CDT');
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/tasks/1042');
    expect(row.querySelector('a')?.textContent).toContain('TSK-1042 Process Smith custodians');
    expect(el().textContent).toContain('America/Chicago');
    expect(el().textContent).toContain("can't be exported");
  });

  it('fills the filter lists from the facets', async () => {
    await create(['Audit.View']);

    const types = Array.from(el().querySelectorAll('#au-object-type option')).map(
      (o) => o.textContent,
    );
    expect(types.map((t) => t?.trim())).toEqual(['Any', 'Matter', 'Task']);
    expect(el().querySelectorAll('#au-event-type option')).toHaveLength(3);
    expect(el().querySelector<HTMLInputElement>('#au-object-id')!.disabled).toBe(true);
  });

  it('sends every filter to the API when applied and resets them', async () => {
    await create(['Audit.View']);

    set('#au-object-type', 'Task', 'change');
    await settle(fixture);
    set('#au-object-id', ' 1042 ');
    set('#au-event-type', 'TASK_CREATED', 'change');
    set('#au-from', '2026-10-01');
    set('#au-to', '2026-10-14');
    set('#au-q', ' status ');
    click('[data-apply]');
    await settle(fixture);

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

    click('[data-reset]');
    await settle(fixture);
    expect(lastCall().slice(0, 9)).toEqual(Array(9).fill(undefined));
    expect(el().querySelector<HTMLInputElement>('#au-q')!.value).toBe('');
  });

  it('refuses a start date after the end date', async () => {
    await create(['Audit.View']);
    const calls = api.searchAuditEvents.mock.calls.length;

    set('#au-from', '2026-10-14');
    set('#au-to', '2026-10-01');
    click('[data-apply]');
    await settle(fixture);

    expect(el().querySelector('#au-date-error')?.textContent).toContain('must not be after');
    expect(api.searchAuditEvents.mock.calls.length).toBe(calls);
    expect(el().querySelector('#au-from')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('picks an actor from a user search (needs User.View) and filters by the user id', async () => {
    await create(['Audit.View', 'User.View']);

    set('#au-actor', 'Dan');
    await new Promise((r) => setTimeout(r, 300));
    await settle(fixture);
    expect(users.listUsers).toHaveBeenCalledWith('all', 'Dan', 1, 8);
    el().querySelector<HTMLElement>('#au-actor-list button')!.click();
    click('[data-apply]');
    await settle(fixture);

    expect(lastCall()[2]).toBe(4);
  });

  it('falls back to a user id field without User.View', async () => {
    await create(['Audit.View']);

    expect(el().querySelector('#au-actor')).toBeNull();
    set('#au-actor-id', '12');
    click('[data-apply]');
    await settle(fixture);

    expect(lastCall()[2]).toBe(12);
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

  it('groups the events of one operation on request and filters to one operation', async () => {
    const bulk = { correlationId: 'bulk', correlationEventCount: 3 };
    await create(
      ['Audit.View'],
      ok(
        pageOfEvents([
          anItem({ auditEventId: 12, ...bulk, summary: 'Step A completed (bulk)' }),
          anItem({ auditEventId: 11, ...bulk, summary: 'Step B completed (bulk)' }),
          anItem({ auditEventId: 10, ...bulk, summary: 'Task completed' }),
          anItem({ auditEventId: 9, correlationId: 'solo', summary: 'Title changed' }),
        ]),
      ),
    );
    expect(el().querySelectorAll('tr[data-event]')).toHaveLength(4);
    expect(el().querySelector('[data-group]')).toBeNull();

    click('[data-group-toggle]');
    await settle(fixture);

    expect(el().querySelector('[data-group="bulk"]')?.textContent).toContain(
      '3 events in one operation',
    );
    expect(el().querySelectorAll('tr[data-event]')).toHaveLength(1); // collapsed group + the single event

    el().querySelector<HTMLElement>('[data-group="bulk"] .au-toggle')!.click();
    await settle(fixture);
    expect(el().querySelectorAll('tr[data-event]')).toHaveLength(4);

    el().querySelector<HTMLElement>('[data-group="bulk"] button.au-link')!.click();
    await settle(fixture);
    expect(lastCall()[7]).toBe('bulk');
    expect(el().querySelector('[data-operation-banner]')).not.toBeNull();
  });

  it('pages with the cursor and appends older events', async () => {
    await create(['Audit.View'], ok(pageOfEvents([anItem({ auditEventId: 100 })], 100)));
    api.searchAuditEvents.mockReturnValue(
      ok(pageOfEvents([anItem({ auditEventId: 99, summary: 'Older' })])),
    );

    click('[data-load-more]');
    await settle(fixture);

    expect(lastCall()[8]).toBe(100);
    expect(el().querySelectorAll('tr[data-event]')).toHaveLength(2);
    expect(el().querySelector('[data-load-more]')).toBeNull();
    expect(el().querySelector('[data-end]')).not.toBeNull();
  });

  it('shows the empty states, with and without filters', async () => {
    await create(['Audit.View'], ok(pageOfEvents([])));
    expect(el().querySelector('[data-empty]')?.textContent).toContain('No audit events have been');

    set('#au-q', 'zzz');
    click('[data-apply]');
    await settle(fixture);
    expect(el().querySelector('[data-empty]')?.textContent).toContain('match these filters');
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
