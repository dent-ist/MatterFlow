import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NEVER, of, throwError } from 'rxjs';
import {
  ClientsClient,
  MatterManagersClient,
  MatterResponse,
  MattersClient,
  MyMattersClient,
  TaskQueueClient,
  TaskQueueRow,
} from '../../../api/generated/api-client';
import { FakeMeApi, profileOf, provideFakeMe } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import { AuthStore } from '../../../core/auth/auth.store';
import { CreateTaskContext } from '../../../shared/layout/create-task-context';
import { MyMattersFocus } from '../focus';
import { MyMattersPage } from './my-matters-page';

const count = (n: number, query: string) => ({ count: n, query });

function summary() {
  return {
    timeZone: 'America/New_York',
    asOfUtc: '2026-10-23T12:00:00Z',
    scope: 'mine',
    role: 'both',
    matters: count(14, 'isActive=true&managedByMe=true'),
    openTasks: count(212, 'managedByMe=true&status=NEW&status=IN_PROGRESS&status=ON_HOLD'),
    overdue: count(9, 'managedByMe=true&overdue=true'),
    dueIn3Days: count(17, 'managedByMe=true&dueWithin=3'),
    dueIn7Days: count(41, 'managedByMe=true&dueWithin=7'),
    unassigned: count(6, 'managedByMe=true&unassigned=true'),
    onHold: count(3, 'managedByMe=true&status=ON_HOLD'),
    atRisk: count(5, 'managedByMe=true&status=NEW&status=IN_PROGRESS&atRisk=true'),
    oldestHoldDays: 12,
    oldestHoldSinceUtc: '2026-10-11T12:00:00Z',
  };
}

const task = (id: number, over: object = {}) => ({
  taskId: id,
  taskNumber: `TSK-${id}`,
  title: `Task ${id}`,
  matterId: 5,
  matterRef: '90001-80001',
  matterName: 'Merger',
  clientName: 'Acme',
  factCode: 'OVERDUE',
  factDays: 3,
  dueDate: '2026-10-26',
  ...over,
});

/** One month of the Calendar: every day, with a task on the 26th (overdue) and two on the 28th (one due). */
function calendar(month: string) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: last }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    const items =
      i + 1 === 26
        ? [task(11, { factCode: 'OVERDUE', dueDate: date })]
        : i + 1 === 28
          ? [
              task(12, { factCode: 'DUE_IN_DAYS', dueDate: date }),
              task(13, { factCode: 'DUE_IN_DAYS', dueDate: date }),
            ]
          : [];
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return {
      date,
      isWeekend: weekday === 0 || weekday === 6,
      isToday: false,
      count: items.length,
      query: `managedByMe=true&status=NEW&dueFrom=${date}&dueTo=${date}`,
      items,
    };
  });
  return {
    timeZone: 'America/New_York',
    asOfUtc: '2026-10-23T12:00:00Z',
    month,
    fromDate: `${month}-01`,
    toDate: `${month}-${last}`,
    today: '2026-10-23',
    total: 3,
    overdue: 1,
    days,
  };
}

/** The arguments of `getTaskQueue`, by name, in the order of the generated client. */
const TQ_ARGS = [
  'group',
  'q',
  'status',
  'priority',
  'pod',
  'noPod',
  'assignee',
  'unassigned',
  'creator',
  'client',
  'matter',
  'project',
  'type',
  'workflow',
  'createdFrom',
  'createdTo',
  'dueFrom',
  'dueTo',
  'asap',
  'overdue',
  'requestor',
  'completedFrom',
  'completedTo',
  'matterText',
  'clientText',
  'projectText',
  'updatedFrom',
  'updatedTo',
  'managedByMe',
  'managerId',
  'role',
  'dueWithin',
  'atRisk',
  'needsAttention',
  'onHoldReason',
  'sort',
  'dir',
  'page',
  'pageSize',
] as const;

function tqCall(args: unknown[]): Record<string, unknown> {
  return Object.fromEntries(TQ_ARGS.map((k, i) => [k, args[i]]));
}

/** One row of the Task Queue, with the fields the shared table reads. */
const queueRow = (id: number, over: Partial<TaskQueueRow> = {}): TaskQueueRow => ({
  taskId: id,
  taskNumber: `TSK-${id}`,
  title: `Task ${id}`,
  matterId: 5,
  matterRef: '90001-80001',
  matterName: 'Merger',
  matterIsSensitive: false,
  matterIsActive: true,
  clientId: 2,
  clientName: 'Acme',
  projectId: undefined,
  projectName: undefined,
  taskTypeId: 1,
  taskTypeName: 'Review',
  taskTypeIconKey: 'file-text',
  workflowDefinitionId: 1,
  workflowName: 'Standard',
  priority: { priorityId: 3, label: 'Normal', color: '#667085', sortOrder: 3 },
  status: 'NEW',
  statusLabel: 'New',
  assignedPod: undefined,
  assignedUser: undefined,
  createdBy: undefined,
  requestorName: 'Rita',
  dueDate: '2026-10-26',
  dueAtUtc: undefined,
  isAsap: false,
  isOverdue: true,
  createdAtUtc: '2026-10-01T12:00:00Z',
  assignedAtUtc: undefined,
  updatedAtUtc: undefined,
  completedAtUtc: undefined,
  statusChangedAtUtc: '2026-10-01T12:00:00Z',
  closedAtUtc: undefined,
  workflow: {
    stepsTotal: 0,
    stepsResolved: 0,
    currentStepNumber: undefined,
    currentStepName: undefined,
  },
  rowVersion: 'AAAA',
  holdReasonTruncated: false,
  matterCanOpen: true,
  atRisk: false,
  ...over,
});

/** A page of the Task Queue. */
function queuePage(items: TaskQueueRow[], total = items.length) {
  return { items, total, page: 1, pageSize: items.length, sort: 'due', dir: 'asc' };
}

/** The default answer of the grid: two open tasks, the second assigned. */
function defaultQueue() {
  return of(
    queuePage([
      queueRow(1),
      queueRow(2, { assignedUser: { userId: 9, displayName: 'Dana', isActive: true } }),
    ]),
  );
}

function activity(unread = 2) {
  return {
    timeZone: 'America/New_York',
    asOfUtc: '2026-10-23T12:00:00Z',
    sinceUtc: '2026-10-16T12:00:00Z',
    seenEventId: 10,
    latestEventId: 12,
    unreadCount: unread,
    total: 2,
    hasMore: false,
    items: [
      {
        eventId: 12,
        occurredAtUtc: '2026-10-23T13:42:00Z',
        kind: 'STATUS_CHANGED',
        actorName: 'Dana',
        matterId: 5,
        matterRef: '90001-80001',
        matterName: 'Merger',
        clientName: 'Acme',
        taskId: 7,
        taskTitle: 'Privilege log',
        to: 'ON_HOLD',
        isUnread: unread > 0,
      },
      {
        eventId: 9,
        occurredAtUtc: '2026-10-22T13:42:00Z',
        kind: 'COMMENTED',
        actorName: 'Priya',
        matterId: 5,
        matterRef: '90001-80001',
        matterName: 'Merger',
        clientName: 'Acme',
        taskId: 8,
        taskTitle: 'Review batch 4',
        isUnread: false,
      },
    ],
  };
}

function since(empty = false) {
  const c = (n: number, query: string, target = 'activity') => ({
    count: empty ? 0 : n,
    query,
    target,
  });
  return {
    timeZone: 'America/New_York',
    asOfUtc: '2026-10-23T12:00:00Z',
    sinceUtc: '2026-10-19T13:12:00Z',
    hasMarker: true,
    seenEventId: 10,
    counts: {
      newTasks: c(0, 'kind=TASK_CREATED&unread=true'),
      completed: c(7, 'kind=COMPLETED&unread=true'),
      becameOverdue: c(4, 'managedByMe=true&overdue=true&dueFrom=2026-10-19&sort=due', 'taskQueue'),
      reassigned: c(2, 'kind=REASSIGNED&unread=true'),
      putOnHold: c(1, 'kind=ON_HOLD&unread=true'),
      comments: c(3, 'kind=COMMENTED&unread=true'),
      newUnassigned: c(
        3,
        'managedByMe=true&unassigned=true&createdFrom=2026-10-19&sort=created',
        'taskQueue',
      ),
    },
    items: empty
      ? []
      : [
          { kind: 'BECAME_OVERDUE', task: task(1) },
          {
            kind: 'ON_HOLD',
            event: { ...activity().items[0], isUnread: true },
          },
        ],
  };
}

function breakdown(view = 'matrix') {
  const type = (id: number, name: string, open: number, overdue: number) => ({
    taskTypeId: id,
    name,
    iconKey: 'file-text',
    colourKey: null,
    open,
    overdue,
    onHold: 1,
    atRisk: 2,
    query: `managedByMe=true&type=${id}&status=NEW`,
    overdueQuery: `managedByMe=true&type=${id}&overdue=true`,
  });
  return {
    timeZone: 'America/New_York',
    asOfUtc: '2026-10-23T12:00:00Z',
    view,
    status: 'open',
    types: [type(1, 'Production', 7, 2), type(2, 'Review', 3, 0), type(3, 'Intake', 1, 0)],
    typeTotal: 3,
    rows:
      view === 'types'
        ? []
        : [
            {
              matterId: 5,
              matterRef: '90001-80001',
              matterName: 'Merger',
              clientName: 'Acme',
              open: 8,
              overdue: 2,
              onHold: 0,
              atRisk: 1,
              cells: [
                {
                  taskTypeId: 1,
                  open: 6,
                  overdue: 2,
                  onHold: 0,
                  atRisk: 1,
                  query: 'matter=5&type=1&status=NEW',
                  overdueQuery: 'matter=5&type=1&overdue=true',
                },
                {
                  taskTypeId: 2,
                  open: 2,
                  overdue: 0,
                  onHold: 0,
                  atRisk: 0,
                  query: 'matter=5&type=2&status=NEW',
                  overdueQuery: 'matter=5&type=2&overdue=true',
                },
              ],
            },
          ],
    matterTotal: 1,
    page: 1,
    pageSize: 50,
    totals: {
      open: 11,
      overdue: 2,
      onHold: 3,
      atRisk: 6,
      query: 'managedByMe=true&status=NEW',
      overdueQuery: 'managedByMe=true&overdue=true',
    },
  };
}

describe('MyMattersPage', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  /** `getTaskQueue` of the grid; a test overrides it with `tq.mockImplementation`. */
  let tq: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;

  async function open(
    url: string,
    permissions: Permission[] = [
      'Matter.BeManager',
      'Matter.View',
      'Task.View',
      'Task.Create',
      'Client.View',
    ],
    configure?: (api: Record<string, ReturnType<typeof vi.fn>>) => void,
    /** The matters the person manages (the answer of the Matters list); omitted: the read fails, so every filter is offered as it was. */
    managed?: Partial<MatterResponse>[],
  ) {
    api = {
      getMyMattersSummary: vi.fn().mockReturnValue(of(summary())),
      getMyMattersCalendar: vi
        .fn()
        .mockImplementation((month?: string) => of(calendar(month ?? '2026-10'))),
      getMyMattersSinceLastVisit: vi.fn().mockReturnValue(of(since())),
      getMyMattersBreakdown: vi.fn().mockImplementation((view: string) => of(breakdown(view))),
      getMyMattersActivity: vi.fn().mockReturnValue(of(activity())),
      markMyMattersActivitySeen: vi.fn().mockReturnValue(of({ seenEventId: 12, seenAtUtc: 'x' })),
    };
    tq = vi.fn<(...args: unknown[]) => unknown>(() => defaultQueue());
    configure?.(api);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: TaskQueueClient,
          useValue: { getTaskQueue: (...args: unknown[]) => tq(...args) },
        },
        provideRouter([
          { path: 'my-matters', component: MyMattersPage },
          { path: '**', children: [] },
        ]),
        provideFakeMe(new FakeMeApi(profileOf({ permissions }))),
        { provide: MyMattersClient, useValue: api },
        {
          provide: MattersClient,
          useValue: {
            listMatters: vi
              .fn()
              .mockReturnValue(
                managed
                  ? of({ items: managed, total: managed.length })
                  : throwError(() => new Error('no matters')),
              ),
          },
        },
        {
          provide: ClientsClient,
          useValue: {
            listClients: vi.fn().mockReturnValue(of({ items: [], total: 0 })),
            getClient: vi
              .fn()
              .mockReturnValue(of({ clientId: 4, clientNumber: '00004', name: 'Acme Corp' })),
          },
        },
        {
          provide: MatterManagersClient,
          useValue: {
            lookupMatterManagers: vi
              .fn()
              .mockReturnValue(of([{ userId: 7, displayName: 'Alex Kim' }])),
          },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, MyMattersPage);
    await harness.fixture.whenStable();
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness;
  }

  const el = (h: { fixture: { nativeElement: unknown } }) => h.fixture.nativeElement as HTMLElement;

  beforeEach(() => localStorage.clear());

  /** Lets the page, the grid and the counts settle after a click or a navigation. */
  const settle = async (h: {
    detectChanges: () => void;
    fixture: { whenStable: () => Promise<unknown> };
  }) => {
    await h.fixture.whenStable();
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  };
  const prefilter = (h: { fixture: { nativeElement: unknown } }) =>
    el(h).querySelector<HTMLSelectElement>('select[data-prefilter]')!;
  const lastGrid = () => tqCall(tq.mock.calls.at(-1)!);

  it('has no tiles: the pre-filter dropdown has the six choices, each with its count in the option, All open first and chosen (#942)', async () => {
    const h = await open('/my-matters');
    expect(el(h).querySelector('[data-mm-strip], button[data-strip-item], .tile')).toBeNull();
    const select = prefilter(h);
    expect(select.getAttribute('aria-label')).toBe('Show tasks');
    const options = Array.from(select.querySelectorAll('option'));
    // The count is part of each option's name; the summary's six counts are the totals of the grid for that choice.
    expect(options.map((o) => o.textContent!.trim())).toEqual([
      'All open (212)',
      'Overdue (9)',
      'At risk (5)',
      'Unassigned (6)',
      'On hold (3)',
      'Due soon (within 7 days) (41)',
    ]);
    expect(options.map((o) => o.getAttribute('data-prefilter-option'))).toEqual([
      'open',
      'overdue',
      'atRisk',
      'unassigned',
      'onHold',
      'dueSoon',
    ]);
    expect(select.value).toBe('open');
    // No filter is announced and none can be cleared while All open is chosen.
    expect(el(h).querySelector('[data-grid-status], [data-clear-prefilter]')).toBeNull();
  });

  it('a zero stays selectable but muted (#942)', async () => {
    const h = await open('/my-matters', undefined, (a) => {
      a['getMyMattersSummary'].mockReturnValue(
        of({ ...summary(), overdue: count(0, 'q'), atRisk: count(0, 'q') }),
      );
    });
    const option = (key: string) =>
      el(h).querySelector<HTMLOptionElement>(`option[data-prefilter-option=${key}]`)!;
    expect(option('overdue').textContent!.trim()).toBe('Overdue (0)');
    expect(option('overdue').classList.contains('pf__zero')).toBe(true);
    expect(option('overdue').disabled).toBe(false);
    expect(option('unassigned').classList.contains('pf__zero')).toBe(false);
  });

  it('choosing a pre-filter filters the grid in place: no jump to the Tasks page, the address keeps it, the grid says what it shows and Clear filter brings All open back (#942)', async () => {
    const h = await open('/my-matters');
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate');
    const choose = async (key: string) => {
      prefilter(h).value = key;
      prefilter(h).dispatchEvent(new Event('change'));
      await settle(h);
    };
    // Every choice is one filter of the Task Queue, on top of the open statuses (On hold is that one status).
    const expected: Record<string, Record<string, unknown>> = {
      overdue: { overdue: true },
      atRisk: { atRisk: true },
      unassigned: { unassigned: true },
      onHold: { status: ['ON_HOLD'] },
      dueSoon: { dueWithin: 7 },
    };
    for (const [key, filter] of Object.entries(expected)) {
      await choose(key);
      expect(router.url, key).toBe(`/my-matters?show=${key}`);
      expect(lastGrid(), key).toMatchObject({
        managedByMe: true,
        sort: 'attention',
        page: 1,
        ...filter,
      });
      expect(prefilter(h).value).toBe(key);
    }
    // The grid says what it shows, with the count the dropdown has, and offers one way back.
    tq.mockImplementation(() => of(queuePage([queueRow(1)], 16)));
    await choose('overdue');
    expect(el(h).querySelector('[data-grid-status]')!.textContent).toContain('16 overdue tasks');
    expect(el(h).querySelectorAll('[data-clear-prefilter]')).toHaveLength(1);
    el(h).querySelector<HTMLButtonElement>('[data-clear-prefilter]')!.click();
    await settle(h);
    expect(router.url).toBe('/my-matters');
    expect(prefilter(h).value).toBe('open');
    expect(el(h).querySelector('[data-grid-status]')).toBeNull();
    // It never left the page for the Task Queue.
    expect(navigate.mock.calls.every((c) => (c[0] as string[])[0] !== '/tasks')).toBe(true);
  });

  it('the remembered pre-filter comes back with the visit, and an address wins over it (#942)', async () => {
    localStorage.setItem('mf-my-matters-filters-1', 'show=unassigned');
    const h = await open('/my-matters');
    expect(TestBed.inject(Router).url).toBe('/my-matters?show=unassigned');
    expect(prefilter(h).value).toBe('unassigned');
    expect(lastGrid()).toMatchObject({ unassigned: true });
  });

  it('a pre-filter in the address wins over the remembered one (#942)', async () => {
    localStorage.setItem('mf-my-matters-filters-1', 'show=unassigned');
    const h = await open('/my-matters?show=onHold');
    expect(prefilter(h).value).toBe('onHold');
    expect(TestBed.inject(Router).url).toBe('/my-matters?show=onHold');
  });

  it('the counts follow the Client filter and the Focus, so they stay the totals of the grid (#942)', async () => {
    const h = await open('/my-matters?clientId=4');
    expect(api['getMyMattersSummary']).toHaveBeenLastCalledWith(
      undefined,
      undefined,
      undefined,
      4,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    TestBed.inject(MyMattersFocus).set([7, 9]);
    await settle(h);
    expect(api['getMyMattersSummary']).toHaveBeenLastCalledWith(
      [7, 9],
      undefined,
      undefined,
      4,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(lastGrid()['type']).toEqual([7, 9]);
  });

  it('keeps the filters in the address and restores them from it', async () => {
    const h = await open('/my-matters?role=primary&clientId=4');
    expect(api['getMyMattersSummary']).toHaveBeenCalledWith(
      undefined,
      undefined,
      'primary',
      4,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    const role = el(h).querySelector<HTMLSelectElement>('[data-filter=role]')!;
    expect(role.value).toBe('primary');
    role.value = 'secondary';
    role.dispatchEvent(new Event('change'));
    await h.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/my-matters?role=secondary&clientId=4');
    expect(api['getMyMattersSummary']).toHaveBeenLastCalledWith(
      undefined,
      undefined,
      'secondary',
      4,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it('shows ONE grid of the open tasks: one heading, the Tasks columns, 25 a page, urgency order, no second grid and no View all (#943)', async () => {
    const h = await open('/my-matters');
    const panels = Array.from(el(h).querySelectorAll('[data-panel]')).map((p) =>
      p.getAttribute('data-panel'),
    );
    expect(panels).toEqual(['tasks']);
    const panel = el(h).querySelector('[data-panel=tasks]')!;
    expect(el(h).querySelectorAll('[data-mm-tabpanel] h2')).toHaveLength(1);
    expect(panel.querySelector('h2')!.textContent).toBe('Open tasks');
    // The same table as the Tasks pages, not a list of its own.
    const table = panel.querySelector('mf-task-table table.wt')!;
    expect(
      Array.from(table.querySelectorAll('thead th')).map((t) => t.getAttribute('data-col')),
    ).toEqual(['ref', 'title', 'matterName', 'priority', 'assignee', 'due', 'status']);
    const rows = Array.from(table.querySelectorAll('tbody tr[data-task]'));
    expect(rows.map((r) => r.getAttribute('data-task'))).toEqual(['TSK-1', 'TSK-2']);
    expect(rows[0].querySelector<HTMLAnchorElement>('a.wt-title')!.getAttribute('href')).toBe(
      '/tasks/1?from=my-matters',
    );
    // Read-only here: Status, Priority and Assignee are text and badges, not editors.
    expect(table.querySelector('mf-row-edit, [data-inline-trigger]')).toBeNull();
    expect(rows[1].querySelector('[data-col=assignee]')!.textContent).toContain('Dana');
    expect(rows[0].querySelector('[data-col=assignee]')!.textContent).toContain('Unassigned');
    // Server side: all open tasks, the urgency order, 25 on the first page.
    expect(lastGrid()).toMatchObject({
      managedByMe: true,
      status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'],
      sort: 'attention',
      dir: 'asc',
      page: 1,
      pageSize: 25,
    });
    expect(lastGrid()['needsAttention']).toBeUndefined();
    expect(lastGrid()['dueWithin']).toBeUndefined();
    expect(el(h).querySelector('[data-view-all]')).toBeNull();
    // Two tasks do not need a pager.
    expect(el(h).querySelector('mf-pager')).toBeNull();
  });

  it('pages 25 at a time with a keyboard-reachable page control, and a task is listed once (#943)', async () => {
    const rowsOf = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => queueRow(from + i, { isOverdue: false }));
    const h = await open('/my-matters', undefined, () =>
      tq.mockImplementation((...args: unknown[]) => {
        const q = tqCall(args);
        return of(queuePage(q['page'] === 2 ? rowsOf(26, 17) : rowsOf(1, 25), 42));
      }),
    );
    const pager = () => el(h).querySelector('mf-pager')!;
    expect(el(h).querySelectorAll('tbody tr[data-task]')).toHaveLength(25);
    expect(pager().textContent).toContain('Page 1 of 2');
    // No size select: the page size is fixed.
    expect(pager().querySelector('select')).toBeNull();
    const next = Array.from(pager().querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent!.trim() === 'Next',
    )!;
    expect(next.disabled).toBe(false);
    next.click();
    await settle(h);
    expect(lastGrid()).toMatchObject({ page: 2, pageSize: 25, sort: 'attention' });
    expect(el(h).querySelectorAll('tbody tr[data-task]')).toHaveLength(17);
    expect(pager().textContent).toContain('Page 2 of 2');
    // A new filter starts at the first page again.
    prefilter(h).value = 'overdue';
    prefilter(h).dispatchEvent(new Event('change'));
    await settle(h);
    expect(lastGrid()).toMatchObject({ page: 1, overdue: true });
    const titles = Array.from(el(h).querySelectorAll('a.wt-title')).map((a) =>
      a.getAttribute('href'),
    );
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('a click on a heading sorts the whole set on the server and announces it (aria-sort); the same heading again turns the order round; Urgency brings the default back (#929, #935)', async () => {
    const h = await open('/my-matters');
    const panel = el(h).querySelector('[data-panel=tasks]')!;
    const th = (col: string) => panel.querySelector(`th[data-col=${col}]`)!;
    const press = async (col: string) => {
      th(col).querySelector<HTMLButtonElement>('button.wt-sort')!.click();
      await settle(h);
    };
    const urgency = () => panel.querySelector<HTMLButtonElement>('[data-sort-urgency]')!;
    // Urgency is the default order (issue #935): no heading is marked, the Urgency control is pressed.
    expect(lastGrid()).toMatchObject({ sort: 'attention', dir: 'asc' });
    expect(th('due').getAttribute('aria-sort')).toBe('none');
    expect(th('priority').getAttribute('aria-sort')).toBe('none');
    expect(urgency().textContent!.trim()).toBe('Urgency');
    expect(urgency().getAttribute('aria-pressed')).toBe('true');
    await press('due');
    expect(lastGrid()).toMatchObject({ sort: 'due', dir: 'asc', page: 1, pageSize: 25 });
    expect(th('due').getAttribute('aria-sort')).toBe('ascending');
    expect(urgency().getAttribute('aria-pressed')).toBe('false');
    await press('due');
    expect(lastGrid()).toMatchObject({ sort: 'due', dir: 'desc' });
    expect(th('due').getAttribute('aria-sort')).toBe('descending');
    await press('priority');
    expect(lastGrid()).toMatchObject({ sort: 'priority', dir: 'asc' });
    expect(th('priority').getAttribute('aria-sort')).toBe('ascending');
    expect(th('due').getAttribute('aria-sort')).toBe('none');
    // The pre-filter keeps the order the person chose.
    prefilter(h).value = 'overdue';
    prefilter(h).dispatchEvent(new Event('change'));
    await settle(h);
    expect(lastGrid()).toMatchObject({ sort: 'priority', dir: 'asc', overdue: true });
    urgency().click();
    await settle(h);
    expect(lastGrid()).toMatchObject({ sort: 'attention', dir: 'asc', overdue: true });
    expect(urgency().getAttribute('aria-pressed')).toBe('true');
  });

  it('every sortable heading of the grid is a button (#929)', async () => {
    const h = await open('/my-matters');
    const heads = Array.from(el(h).querySelectorAll('[data-panel=tasks] thead th'));
    expect(heads.every((t) => t.querySelector('button.wt-sort') !== null)).toBe(true);
  });

  it('At risk and On hold show in the shared Due and Status cells', async () => {
    const h = await open('/my-matters', undefined, () =>
      tq.mockImplementation(() =>
        of(
          queuePage([
            queueRow(1, { atRisk: true, isOverdue: false, dueDate: '2099-01-01' }),
            queueRow(2, { status: 'ON_HOLD', statusLabel: 'On Hold', isOverdue: false }),
          ]),
        ),
      ),
    );
    const rows = Array.from(el(h).querySelectorAll('[data-panel=tasks] tbody tr[data-task]'));
    expect(rows[0].querySelector('[data-col=due]')!.textContent).toContain('At risk');
    expect(rows[1].querySelector('[data-col=status]')!.textContent).toContain('On Hold');
  });

  it('says so when there is nothing open, in one line with no toolbar, and the Calendar button stays; with no manager-related item (#920)', async () => {
    const h = await open('/my-matters', undefined, () =>
      tq.mockImplementation(() => of(queuePage([], 0))),
    );
    const panel = el(h).querySelector('[data-panel=tasks]')!;
    expect(panel.querySelector('[data-empty]')!.textContent).toContain('No open tasks.');
    expect(panel.querySelector('table, mf-options-menu, select, [data-sort-urgency]')).toBeNull();
    expect(panel.querySelector('[data-calendar-toggle]')).not.toBeNull();
    expect(el(h).textContent).not.toMatch(/no (project )?manager/i);
  });

  it('a pre-filter with no task says so and keeps the dropdown, so the person can choose again (#942)', async () => {
    const h = await open('/my-matters?show=overdue', undefined, () =>
      tq.mockImplementation(() => of(queuePage([], 0))),
    );
    const panel = el(h).querySelector('[data-panel=tasks]')!;
    expect(panel.querySelector('[data-empty]')!.textContent).toContain('No overdue tasks.');
    expect(panel.querySelector('select[data-prefilter]')).not.toBeNull();
    expect(panel.querySelectorAll('[data-clear-prefilter]')).toHaveLength(1);
  });

  it('the Deadlines tab is gone: its address opens the Overview, and the tab strip has no Deadlines (#929)', async () => {
    const h = await open('/my-matters?tab=deadlines&role=primary');
    expect(TestBed.inject(Router).url).toBe('/my-matters?role=primary');
    expect(el(h).querySelector('[role=tab][aria-selected=true]')!.textContent).toContain(
      'Overview',
    );
    expect(
      Array.from(el(h).querySelectorAll('[role=tab]')).map((t) => t.textContent!.trim()),
    ).not.toContain('Deadlines');
    expect(el(h).querySelector('[data-panel=deadlines-tab]')).toBeNull();
    expect(el(h).querySelector('[data-panel=tasks]')).not.toBeNull();
  });

  it('the Trends tab is gone: ?tab=trends opens the Overview and keeps the filters (#947)', async () => {
    const h = await open('/my-matters?tab=trends&role=primary');
    expect(TestBed.inject(Router).url).toBe('/my-matters?role=primary');
    expect(el(h).querySelector('[role=tab][aria-selected=true]')!.textContent).toContain(
      'Overview',
    );
    expect(
      Array.from(el(h).querySelectorAll('[role=tab]')).map((t) => t.textContent!.trim()),
    ).not.toContain('Trends');
    expect(el(h).querySelector('[data-panel=trends]')).toBeNull();
  });

  it('the Calendar button swaps the grid for the calendar and back, names what it does, and the choice is remembered (#929)', async () => {
    const h = await open('/my-matters');
    const toggle = () => el(h).querySelector<HTMLButtonElement>('[data-calendar-toggle]')!;
    expect(toggle().getAttribute('aria-label')).toBe('Show calendar');
    // It lives in the heading of the grid.
    expect(el(h).querySelector('[data-panel=tasks]')!.contains(toggle())).toBe(true);
    toggle().click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/my-matters?view=calendar');
    expect(el(h).querySelector('[data-panel=tasks]')).toBeNull();
    expect(el(h).querySelector('[data-panel=calendar]')).not.toBeNull();
    expect(el(h).querySelector('[data-calendar]')).not.toBeNull();
    expect(toggle().getAttribute('aria-label')).toBe('Show list');
    expect(el(h).querySelector('[data-panel=calendar]')!.contains(toggle())).toBe(true);
    expect(Object.values(localStorage)).toContain('calendar');
    toggle().click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/my-matters');
    expect(el(h).querySelector('[data-panel=tasks]')).not.toBeNull();
    expect(el(h).querySelector('[data-panel=calendar]')).toBeNull();
    expect(Object.values(localStorage)).not.toContain('calendar');
  });

  describe('the Calendar is one month (epic #893, #944)', () => {
    const grid = (h: { fixture: { nativeElement: unknown } }) =>
      el(h).querySelector<HTMLElement>('[data-panel=calendar] table[data-calendar]')!;
    const day = (h: { fixture: { nativeElement: unknown } }, date: string) =>
      el(h).querySelector<HTMLElement>(`td[data-day="${date}"]`)!;
    const key = (target: HTMLElement, k: string) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
      );
    const addressMonth = () => {
      const router = TestBed.inject(Router);
      return router.parseUrl(router.url).queryParams['month'];
    };

    it('shows the month by name with Previous, Next and Today, an ARIA grid with one tab stop, and asks the server for that month only', async () => {
      const h = await open('/my-matters?view=calendar&month=2026-10');
      expect(el(h).querySelector('[data-cal-month]')!.textContent!.trim()).toBe('October 2026');
      expect(api['getMyMattersCalendar']).toHaveBeenCalledWith(
        '2026-10',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      expect(grid(h).getAttribute('role')).toBe('grid');
      expect(grid(h).getAttribute('aria-label')).toBe('October 2026');
      expect(
        Array.from(grid(h).querySelectorAll('thead th')).map((t) => t.textContent!.trim()),
      ).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
      expect(grid(h).querySelectorAll('td[data-day]')).toHaveLength(31);
      // ONE tab stop in the grid (the other days and the task links are reached by arrows).
      expect(grid(h).querySelectorAll('td[tabindex="0"]')).toHaveLength(1);
      expect(grid(h).querySelectorAll('a[tabindex="0"], a:not([tabindex])')).toHaveLength(0);
      expect(el(h).querySelector('[data-calendar-summary]')!.textContent).toContain(
        'October 2026: 3 tasks due, 1 overdue.',
      );
      // The month's buttons name where they go.
      expect(el(h).querySelector('[data-cal-prev]')!.getAttribute('aria-label')).toBe(
        'Previous month, September 2026',
      );
      expect(el(h).querySelector('[data-cal-next]')!.getAttribute('aria-label')).toBe(
        'Next month, November 2026',
      );
    });

    it('Previous, Next and Today change the month in the address and ask for it; no Dates choice is left (#944)', async () => {
      const h = await open('/my-matters?view=calendar&month=2026-10');
      const press = async (selector: string) => {
        el(h).querySelector<HTMLButtonElement>(selector)!.click();
        await settle(h);
      };
      await press('[data-cal-next]');
      expect(addressMonth()).toBe('2026-11');
      expect(el(h).querySelector('[data-cal-month]')!.textContent!.trim()).toBe('November 2026');
      expect(api['getMyMattersCalendar'].mock.calls.at(-1)![0]).toBe('2026-11');
      expect(grid(h).querySelectorAll('td[data-day]')).toHaveLength(30);
      await press('[data-cal-prev]');
      await press('[data-cal-prev]');
      expect(addressMonth()).toBe('2026-09');
      expect(el(h).querySelector('[data-cal-today]')).not.toBeNull();
      await press('[data-cal-today]');
      expect(addressMonth()).toBeUndefined();
      expect(el(h).querySelector('#mm-range, [data-mm-dates]')).toBeNull();
    });

    it('an overdue task carries a warning icon and the word Overdue (for screen readers and as its tooltip), on its own due date; the others carry none (#944)', async () => {
      const h = await open('/my-matters?view=calendar&month=2026-10');
      const late = day(h, '2026-10-26');
      expect(late.querySelector('[data-overdue-icon]')).not.toBeNull();
      expect(late.querySelector('.mf-sr-only')!.textContent).toContain('Overdue');
      expect(late.querySelector('a[data-deadline-row]')!.getAttribute('title')).toBe(
        'Overdue: TSK-11 Task 11',
      );
      expect(late.getAttribute('aria-label')).toBe('Mon Oct 26: 1 task due, 1 overdue');
      const due = day(h, '2026-10-28');
      expect(due.querySelectorAll('a[data-deadline-row]')).toHaveLength(2);
      expect(due.querySelector('[data-overdue-icon]')).toBeNull();
      expect(due.getAttribute('aria-label')).toBe('Wed Oct 28: 2 tasks due');
    });

    it('a busy day shows its first three tasks and "+N more", which opens the day in the Task Queue (#944)', async () => {
      const h = await open('/my-matters?view=calendar&month=2026-10', undefined, (a) =>
        a['getMyMattersCalendar'].mockImplementation((month: string) => {
          const c = calendar(month);
          c.days[27] = {
            ...c.days[27],
            count: 6,
            items: [21, 22, 23, 24, 25].map((id) => task(id, { dueDate: '2026-10-28' })),
          } as never;
          return of(c);
        }),
      );
      const busy = day(h, '2026-10-28');
      expect(busy.querySelectorAll('a[data-deadline-row]')).toHaveLength(3);
      const more = busy.querySelector<HTMLAnchorElement>('a[data-day-more]')!;
      expect(more.textContent!.trim()).toBe('+3 more');
      expect(more.getAttribute('href')).toContain('/tasks?');
      expect(more.getAttribute('href')).toContain('dueFrom=2026-10-28');
    });

    it('the Matter, the pre-filter and the Focus go to the month (#944)', async () => {
      await open('/my-matters?view=calendar&month=2026-10&matterId=7&show=overdue&clientId=4');
      expect(api['getMyMattersCalendar']).toHaveBeenLastCalledWith(
        '2026-10',
        'overdue',
        undefined,
        undefined,
        undefined,
        4,
        undefined,
        undefined,
        undefined,
        undefined,
        7,
      );
    });

    it('arrows move between days of the month, Home and End to the ends of the week, and the tab stop follows (#944, #420: keys of the control only)', async () => {
      const h = await open('/my-matters?view=calendar&month=2026-10');
      const start = day(h, '2026-10-14'); // a Wednesday
      start.focus();
      key(start, 'ArrowRight');
      expect(document.activeElement).toBe(day(h, '2026-10-15'));
      key(document.activeElement as HTMLElement, 'ArrowDown');
      expect(document.activeElement).toBe(day(h, '2026-10-22'));
      key(document.activeElement as HTMLElement, 'ArrowUp');
      key(document.activeElement as HTMLElement, 'ArrowLeft');
      expect(document.activeElement).toBe(day(h, '2026-10-14'));
      key(document.activeElement as HTMLElement, 'Home');
      expect(document.activeElement).toBe(day(h, '2026-10-12'));
      key(document.activeElement as HTMLElement, 'End');
      expect(document.activeElement).toBe(day(h, '2026-10-18'));
      // One tab stop, now on the day the person reached.
      h.detectChanges();
      expect(grid(h).querySelectorAll('td[tabindex="0"]')).toHaveLength(1);
      expect(day(h, '2026-10-18').getAttribute('tabindex')).toBe('0');
    });

    it('Page Down and an arrow past the end of the month go to the next month, and the focus follows the day (#944)', async () => {
      const h = await open('/my-matters?view=calendar&month=2026-10');
      const start = day(h, '2026-10-29');
      start.focus();
      key(start, 'PageDown');
      await settle(h);
      expect(addressMonth()).toBe('2026-11');
      expect(document.activeElement).toBe(day(h, '2026-11-29'));
      key(document.activeElement as HTMLElement, 'ArrowDown');
      await settle(h);
      expect(addressMonth()).toBe('2026-12');
      expect(document.activeElement).toBe(day(h, '2026-12-06'));
      key(document.activeElement as HTMLElement, 'PageUp');
      await settle(h);
      expect(addressMonth()).toBe('2026-11');
      expect(document.activeElement).toBe(day(h, '2026-11-06'));
    });

    it('Enter goes into a day with tasks, Up and Down move between its tasks, Escape comes back to the day (#944)', async () => {
      const h = await open('/my-matters?view=calendar&month=2026-10');
      const cell = day(h, '2026-10-28');
      cell.focus();
      key(cell, 'Enter');
      const links = Array.from(cell.querySelectorAll<HTMLElement>('a'));
      expect(links).toHaveLength(2);
      expect(document.activeElement).toBe(links[0]);
      key(links[0], 'ArrowDown');
      expect(document.activeElement).toBe(links[1]);
      key(links[1], 'ArrowUp');
      expect(document.activeElement).toBe(links[0]);
      key(links[0], 'Escape');
      expect(document.activeElement).toBe(cell);
      // A day with no task: Enter does nothing.
      const empty = day(h, '2026-10-14');
      empty.focus();
      key(empty, 'Enter');
      expect(document.activeElement).toBe(empty);
    });
  });

  it('a visit with no view in the address opens the Calendar when that is what the person last used (#929)', async () => {
    localStorage.setItem('mf-my-matters-calendar-1', 'calendar');
    const h = await open('/my-matters');
    expect(TestBed.inject(Router).url).toBe('/my-matters?view=calendar');
    expect(el(h).querySelector('[data-panel=calendar]')).not.toBeNull();
  });

  it('shows a positive empty state for a manager with no matters, with a way to My Work', async () => {
    const h = await open('/my-matters', undefined, undefined, []);
    const empty = el(h).querySelector('[data-empty-kind=none]')!;
    expect(empty.getAttribute('data-empty-kind')).toBe('none');
    expect(empty.textContent).toContain('You are not the project manager of any matter yet.');
    expect(empty.textContent).toContain('Ask a director to assign you.');
    expect(empty.querySelector('[data-to-my-work]')).not.toBeNull();
    expect(empty.querySelector('[data-show-all]')).toBeNull();
  });

  it('offers Show all matters to a holder of Matter.AssignManagers, and the scope switch', async () => {
    const permissions: Permission[] = [
      'Matter.BeManager',
      'Matter.AssignManagers',
      'Matter.View',
      'Task.View',
    ];
    const h = await open('/my-matters', permissions, undefined, []);
    expect(el(h).querySelector('[data-scope=all]')).not.toBeNull();
    el(h).querySelector<HTMLButtonElement>('[data-empty-kind=none] [data-show-all]')!.click();
    await h.fixture.whenStable();
    expect(TestBed.inject(Router).url).toContain('scope=all');
    expect(api['getMyMattersSummary']).toHaveBeenLastCalledWith(
      undefined,
      'all',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it('never shows the scope switch to a manager without Matter.AssignManagers, and ignores scope=all in the address', async () => {
    const h = await open('/my-matters?scope=all&managerId=7');
    expect(el(h).querySelector('[data-scope]')).toBeNull();
    expect(api['getMyMattersSummary']).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it('has no Recent activity on the Overview and never reads the events there: the Activity tab holds them (#909)', async () => {
    const h = await open('/my-matters');
    expect(el(h).querySelector('[data-panel=activity], [data-activity-row]')).toBeNull();
    expect(el(h).textContent).not.toContain('Recent activity');
    expect(api['getMyMattersActivity']).not.toHaveBeenCalled();
    expect(el(h).textContent).not.toContain('commented on');
  });

  it('?tab=workload is Overview (the Workload tab was removed, #826)', async () => {
    const h = await open('/my-matters?tab=workload');
    expect(el(h).querySelector('[role=tab][aria-selected=true]')!.textContent).toContain(
      'Overview',
    );
    expect(el(h).querySelector('[data-panel=workload]')).toBeNull();
    expect(el(h).querySelector('[data-panel=tasks]')).not.toBeNull();
  });

  it('a failing grid shows its own error with Retry; the counts are left alone (#921)', async () => {
    const h = await open('/my-matters');
    tq.mockImplementation(() => throwError(() => new Error('boom')));
    await TestBed.inject(Router).navigateByUrl('/my-matters?role=primary');
    await h.fixture.whenStable();
    h.detectChanges();
    expect(el(h).querySelector('[data-panel=tasks] [data-panel-error]')).not.toBeNull();
    expect(el(h).querySelector('[data-page-error]')).toBeNull();
    expect(el(h).querySelector('[data-prefilter-error]')).toBeNull();
    tq.mockClear();
    tq.mockImplementation(() => defaultQueue());
    el(h).querySelector<HTMLButtonElement>('[data-panel=tasks] [data-panel-retry]')!.click();
    await h.fixture.whenStable();
    h.detectChanges();
    expect(tq).toHaveBeenCalledTimes(1);
    expect(el(h).querySelector('[data-panel=tasks] table')).not.toBeNull();
  });

  it('failing counts alone say so next to the dropdown with their own Retry; the dropdown still works without numbers (#942, #921)', async () => {
    const h = await open('/my-matters', undefined, (a) =>
      a['getMyMattersSummary'].mockReturnValue(throwError(() => new Error('boom'))),
    );
    expect(el(h).querySelector('[data-prefilter-error]')!.textContent).toContain(
      'Counts not loaded.',
    );
    expect(el(h).querySelectorAll('[data-prefilter-retry]')).toHaveLength(1);
    expect(
      Array.from(prefilter(h).querySelectorAll('option')).map((o) => o.textContent!.trim()),
    ).toEqual([
      'All open',
      'Overdue',
      'At risk',
      'Unassigned',
      'On hold',
      'Due soon (within 7 days)',
    ]);
    expect(el(h).querySelector('[data-panel=tasks] table')).not.toBeNull();
    api['getMyMattersSummary'].mockReturnValue(of(summary()));
    el(h).querySelector<HTMLButtonElement>('[data-prefilter-retry]')!.click();
    await settle(h);
    expect(el(h).querySelector('[data-prefilter-error]')).toBeNull();
    expect(prefilter(h).querySelector('option')!.textContent!.trim()).toBe('All open (212)');
  });

  it('two or more failed calls: ONE banner and ONE Retry for the page, a muted "not loaded" line in the grid; Retry asks every failed call again (#921)', async () => {
    const h = await open('/my-matters');
    tq.mockImplementation(() => throwError(() => new Error('boom')));
    api['getMyMattersSummary'].mockReturnValue(throwError(() => new Error('boom')));
    await TestBed.inject(Router).navigateByUrl('/my-matters?role=primary');
    await h.fixture.whenStable();
    h.detectChanges();
    expect(el(h).querySelectorAll('[data-page-error]')).toHaveLength(1);
    expect(el(h).querySelector('[data-page-error]')!.textContent).toContain(
      "Couldn't load My Matters.",
    );
    // No section keeps a Retry of its own, and the grid says "not loaded" without a button.
    expect(el(h).querySelectorAll('[data-panel-retry], [data-prefilter-retry]')).toHaveLength(0);
    expect(el(h).querySelector('[data-panel-error], [data-prefilter-error]')).toBeNull();
    expect(el(h).querySelector('[data-panel=tasks] [data-panel-notloaded]')).not.toBeNull();
    // The one Retry asks each failed call once.
    tq.mockClear();
    tq.mockImplementation(() => defaultQueue());
    api['getMyMattersSummary'].mockClear();
    api['getMyMattersSummary'].mockReturnValue(of(summary()));
    el(h).querySelector<HTMLButtonElement>('[data-page-retry]')!.click();
    await h.fixture.whenStable();
    h.detectChanges();
    expect(tq).toHaveBeenCalledTimes(1);
    expect(api['getMyMattersSummary']).toHaveBeenCalledTimes(1);
    expect(el(h).querySelector('[data-page-error]')).toBeNull();
  });

  it('a grid that is still loading has no toolbar: its Options and Urgency appear with the data (#921)', async () => {
    const h = await open('/my-matters', undefined, () => tq.mockImplementation(() => NEVER));
    const panel = el(h).querySelector('[data-panel=tasks]')!;
    expect(panel.querySelector('[data-loading]')).not.toBeNull();
    expect(panel.querySelector('mf-options-menu, [data-sort-urgency], select')).toBeNull();
    // The skeleton stands for the rows the grid will have.
    expect(panel.querySelectorAll('.mmp__row')).toHaveLength(6);
  });

  it('Role says "I am" with plain choices (Primary or secondary, Primary, Secondary) (#899)', async () => {
    const h = await open('/my-matters?role=primary');
    const bar = el(h).querySelector('[data-mm-filters]')!;
    expect(bar.querySelector('label[for=mm-role]')!.textContent!.trim()).toBe('I am');
    expect(
      Array.from(bar.querySelectorAll('#mm-role option')).map((o) => o.textContent!.trim()),
    ).toEqual(['Primary or secondary', 'Primary', 'Secondary']);
  });

  it('loads the grid and the counts on their own: a grid still waiting does not hold the counts (#921)', async () => {
    const h = await open('/my-matters');
    tq.mockImplementation(() => NEVER);
    await TestBed.inject(Router).navigateByUrl('/my-matters?role=secondary');
    await h.fixture.whenStable();
    h.detectChanges();
    // The grid keeps the previous rows while the new ones are on their way; the counts follow the filter at once.
    expect(el(h).querySelector('[data-panel=tasks] [data-loading]')).toBeNull();
    expect(api['getMyMattersSummary']).toHaveBeenLastCalledWith(
      undefined,
      undefined,
      'secondary',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  describe('tabs (epic #758, PX-18)', () => {
    const tabs = (h: { fixture: { nativeElement: unknown } }) =>
      // The label only: the Activity tab's small badge (the changes since the last visit) is not part of it.
      Array.from(el(h).querySelectorAll<HTMLElement>('[role=tab]')).map((t) =>
        t.textContent!.replace(t.querySelector('[data-tab-badge]')?.textContent ?? '', '').trim(),
      );

    it('offers the Data tab, between Breakdown and Activity, to a person who may see assets', async () => {
      const permissions: Permission[] = [
        'Matter.BeManager',
        'Matter.View',
        'Task.View',
        'Task.Create',
        'Client.View',
        'Asset.View',
      ];
      const h = await open('/my-matters', permissions, (a) => {
        a['getMyMattersData'] = vi.fn().mockReturnValue(NEVER);
        a['getMyMattersDataVolume'] = vi.fn().mockReturnValue(NEVER);
      });
      expect(tabs(h)).toEqual(['Overview', 'Breakdown', 'Data', 'Activity']);
    });

    it('has no Data tab without Asset.View, and its address opens Overview', async () => {
      const h = await open('/my-matters?tab=data');
      expect(tabs(h)).not.toContain('Data');
      expect(el(h).querySelector('[role=tab][aria-selected=true]')!.textContent).toContain(
        'Overview',
      );
    });

    it('has the tabs (no Deadlines, #929, no Trends, #947), Overview selected, and the page as it was under it', async () => {
      const h = await open('/my-matters');
      expect(tabs(h)).toEqual(['Overview', 'Breakdown', 'Activity']);
      expect(el(h).querySelector('[role=tab][aria-selected=true]')!.textContent).toContain(
        'Overview',
      );
      const panel = el(h).querySelector('[role=tabpanel]')!;
      expect(panel.getAttribute('aria-labelledby')).toBe('mm-tab-overview');
      expect(panel.querySelector('[data-panel=since]')).toBeNull(); // on the Activity tab since 2026-10-28
      expect(panel.querySelector('[data-panel=tasks]')).not.toBeNull();
      expect(el(h).querySelector('[data-panel=deadlines-tab]')).toBeNull();
    });

    it('opens a tab from the address, loads only that tab and keeps the filters', async () => {
      const h = await open('/my-matters?tab=breakdown&role=primary');
      expect(el(h).querySelector('[role=tab][aria-selected=true]')!.textContent).toContain(
        'Breakdown',
      );
      expect(api['getMyMattersBreakdown']).toHaveBeenCalled();
      expect(el(h).querySelector('[data-filter=role]')).not.toBeNull();
    });

    it('an unknown tab is Overview; choosing a tab changes the address and keeps the filters, Overview leaves the address', async () => {
      const h = await open('/my-matters?tab=nonsense&clientId=4');
      expect(el(h).querySelector('[role=tab][aria-selected=true]')!.textContent).toContain(
        'Overview',
      );
      el(h).querySelector<HTMLElement>('[data-tab=activity]')!.click();
      await h.fixture.whenStable();
      h.detectChanges();
      const router = TestBed.inject(Router);
      expect(router.parseUrl(router.url).queryParams).toMatchObject({
        tab: 'activity',
        clientId: '4',
      });
      el(h).querySelector<HTMLElement>('[data-tab=overview]')!.click();
      await h.fixture.whenStable();
      expect(router.parseUrl(router.url).queryParams['tab']).toBeUndefined();
      expect(router.parseUrl(router.url).queryParams['clientId']).toBe('4');
    });

    it('the Breakdown tab is a real table of matters by task type, one number per cell, and no "All matters" row for one matter (PV-11, #911)', async () => {
      const h = await open('/my-matters?tab=breakdown');
      const root = el(h).querySelector('[data-panel=breakdown]')!;
      const table = root.querySelector('table[data-bd-table=matrix]')!;
      expect(table.querySelector('caption')).not.toBeNull();
      expect(
        Array.from(table.querySelectorAll('thead th')).map((t) => t.textContent!.trim()),
      ).toEqual(['Matter', 'Production', 'Review', 'Intake', 'Total']);
      const cell = table.querySelector<HTMLAnchorElement>('[data-bd-cell]')!;
      expect(cell.textContent!.replace(/\s+/g, '')).toBe('6!');
      expect(cell.getAttribute('href')).toBe('/tasks?matter=5&type=1&status=NEW');
      expect(cell.getAttribute('aria-label')).toBe('90001-80001, Production: 6 open, 2 overdue');
      // The overdue part is a mark in the same link, never a second link in the cell.
      expect(table.querySelectorAll('tbody td:nth-child(2) a')).toHaveLength(1);
      expect(table.querySelector('tbody th[scope=row]')!.textContent).toContain('Merger');
      expect(table.querySelector('tfoot')).toBeNull();
      expect(api['getMyMattersBreakdown'].mock.calls[0][0]).toBe('matrix');
    });

    it('the Breakdown tab switches to all matters: per type counts and no average turnaround (#930)', async () => {
      const h = await open('/my-matters?tab=breakdown&bview=types');
      const root = el(h).querySelector('[data-panel=breakdown]')!;
      expect(api['getMyMattersBreakdown'].mock.calls[0][0]).toBe('types');
      const rows = Array.from(root.querySelectorAll('[data-bd-type]'));
      expect(rows).toHaveLength(3);
      expect(root.querySelector('[data-bd-turnaround]')).toBeNull();
      expect(root.textContent).not.toMatch(/turnaround|average/i);
      expect(root.querySelectorAll('thead th')).toHaveLength(5);
    });
  });

  describe('What changed: one line on the Activity tab, its count a badge (epic #893, issues #909 and #895, owner decision of 2026-10-28)', () => {
    it('is one line of the four counts that need a decision, each a link, and Mark as read at its end', async () => {
      const h = await open('/my-matters?tab=activity');
      const line = el(h).querySelector('[data-panel=since]')!;
      expect(line.getAttribute('aria-label')).toBe('Since your last visit');
      const figures = Array.from(line.querySelectorAll('[data-since-figures] a')).map((a) =>
        a.textContent!.replace(/\s+/g, ' ').trim(),
      );
      // Reassigned, comments and new tasks are not decisions: not counted here.
      expect(figures).toEqual([
        '4 became overdue',
        '1 put on hold',
        '7 completed',
        '3 new unassigned',
      ]);
      expect(line.querySelector('[data-figure=becameOverdue]')!.getAttribute('href')).toContain(
        '/tasks?',
      );
      expect(line.querySelector('[data-figure=newUnassigned]')!.getAttribute('href')).toContain(
        'unassigned=true',
      );
      expect(line.querySelector('[data-figure=putOnHold]')!.getAttribute('href')).toContain(
        'tab=activity',
      );
      expect(line.querySelector('[data-since-period]')!.textContent).toContain(
        'Since your last visit:',
      );
      expect(line.querySelector('[data-mark-read]')!.textContent).toContain('Mark as read');
      // Opening the page never moves the marker.
      expect(line.querySelector('[data-since-item], [data-since-toggle]')).toBeNull();
      expect(api['markMyMattersActivitySeen']).not.toHaveBeenCalled();
    });

    it('the Overview does not draw it: the Activity tab carries the four figures added up as a small badge', async () => {
      const h = await open('/my-matters');
      expect(el(h).querySelector('[data-panel=since]')).toBeNull();
      expect(el(h).querySelector('mf-mm-since')).toBeNull();
      const tab = el(h).querySelector<HTMLElement>('[data-tab=activity]')!;
      expect(tab.querySelector('[data-tab-badge]')!.textContent!.trim()).toBe('15'); // 4 + 1 + 7 + 3
      expect(tab.getAttribute('aria-label')).toBe('Activity, 15 changes since your last visit');
      // The line itself (and Mark as read) are on the Activity tab.
      expect(el(h).querySelector('[data-mark-read]')).toBeNull();
    });

    it('no badge when none of the four changed', async () => {
      const h = await open('/my-matters', undefined, (a) => {
        const s = since();
        const zero = { count: 0, query: 'q', target: 'activity' };
        a['getMyMattersSinceLastVisit'].mockReturnValue(
          of({
            ...s,
            counts: {
              ...s.counts,
              becameOverdue: zero,
              putOnHold: zero,
              completed: zero,
              newUnassigned: zero,
            },
          }),
        );
      });
      expect(el(h).querySelector('[data-tab=activity] [data-tab-badge]')).toBeNull();
      expect(el(h).querySelector('[data-tab=activity]')!.getAttribute('aria-label')).toBeNull();
    });

    it('says the last 7 days when there is no marker yet', async () => {
      const h = await open('/my-matters?tab=activity', undefined, (a) =>
        a['getMyMattersSinceLastVisit'].mockReturnValue(of({ ...since(), hasMarker: false })),
      );
      expect(el(h).querySelector('[data-since-period]')!.textContent).toContain(
        'In the last 7 days:',
      );
    });

    it('draws nothing when none of the four changed, even if comments and reassignments did', async () => {
      const h = await open('/my-matters?tab=activity', undefined, (a) => {
        const s = since();
        const zero = { count: 0, query: 'q', target: 'activity' };
        a['getMyMattersSinceLastVisit'].mockReturnValue(
          of({
            ...s,
            counts: {
              ...s.counts,
              becameOverdue: zero,
              putOnHold: zero,
              completed: zero,
              newUnassigned: zero,
            },
          }),
        );
      });
      expect(el(h).querySelector('[data-panel=since]')).toBeNull();
      expect(el(h).querySelector('[data-mark-read]')).toBeNull();
      expect(el(h).querySelector('mf-mm-since')!.textContent!.trim()).toBe('');
    });

    it('Mark as read moves the marker once, says so, and the line goes away', async () => {
      const h = await open('/my-matters?tab=activity');
      const before = api['getMyMattersSinceLastVisit'].mock.calls.length;
      api['getMyMattersSinceLastVisit'].mockReturnValue(of(since(true)));
      el(h).querySelector<HTMLButtonElement>('[data-mark-read]')!.click();
      await h.fixture.whenStable();
      h.detectChanges();
      await h.fixture.whenStable();
      h.detectChanges();
      expect(api['markMyMattersActivitySeen']).toHaveBeenCalledTimes(1);
      expect(api['markMyMattersActivitySeen']).toHaveBeenCalledWith({});
      expect(api['getMyMattersSinceLastVisit'].mock.calls.length).toBe(before + 1);
      expect(el(h).querySelector('[data-panel=since]')).toBeNull();
      expect(el(h).querySelector('[data-since-announce]')!.textContent).toContain(
        'Marked as read.',
      );
    });
  });

  describe('a calmer page (epic #893, batch 1)', () => {
    const matter = (
      id: number,
      clientId: number,
      role: 'primary' | 'secondary',
    ): Partial<MatterResponse> => ({
      matterId: id,
      clientId,
      clientNumber: `9000${clientId}`,
      clientName: `Client ${clientId}`,
      matterRef: `9000${clientId}-8000${id}`,
      name: `Matter ${id}`,
      // The signed-in person is user 1 (profileOf's default).
      primaryManager:
        role === 'primary'
          ? { userId: 1, displayName: 'Me', isActive: true }
          : { userId: 9, displayName: 'Other', isActive: true },
      secondaryManager:
        role === 'secondary' ? { userId: 1, displayName: 'Me', isActive: true } : undefined,
    });
    const quiet = (a: Record<string, ReturnType<typeof vi.fn>>) => {
      tq.mockImplementation(() => of(queuePage([], 0)));
      a['getMyMattersSinceLastVisit'].mockReturnValue(of(since(true)));
    };

    it('one matter: no filter bar, no create button of its own (the shell button starts with that matter), no sentence drawn', async () => {
      const h = await open('/my-matters', undefined, undefined, [matter(5, 2, 'primary')]);
      expect(el(h).querySelector('[data-mm-filters]')).toBeNull();
      expect(el(h).querySelector('[data-filters-open]')).toBeNull();
      expect(el(h).querySelector('[data-header-new-task]')).toBeNull();
      expect(TestBed.inject(CreateTaskContext).matterId()).toBe(5);
      // The sentence is in the page for screen readers (the page's styles hide it at every width), not as a visible line.
      expect(el(h).querySelector('[data-page-description]')!.textContent).toContain(
        'The matters you manage as primary or secondary project manager.',
      );
    });

    it('several clients and both roles: Client, Matter and Role are offered, none with a visible label; the header has New task and no matter chooser (#941)', async () => {
      const h = await open('/my-matters', undefined, undefined, [
        matter(5, 2, 'primary'),
        matter(6, 3, 'secondary'),
      ]);
      expect(el(h).querySelector('[data-mm-filters]')).not.toBeNull();
      expect(el(h).querySelector('#mm-client')).not.toBeNull();
      expect(el(h).querySelector('#mm-matter')).not.toBeNull();
      expect(el(h).querySelector('#mm-role')).not.toBeNull();
      // Client and Matter have no label of their own: the placeholder says what they are and an aria-label names them.
      const bar = el(h).querySelector('[data-mm-filters]')!;
      expect(bar.querySelector('label[for=mm-client], label[for=mm-matter]')).toBeNull();
      expect(bar.querySelector('#mm-client')!.getAttribute('aria-label')).toBe('Client');
      expect(bar.querySelector('#mm-matter')!.getAttribute('aria-label')).toBe('Matter');
      // The Client filter is a searchable dropdown of the clients of the person's matters (issue #928): it lists them when it is opened and narrows as they type.
      const client = el(h).querySelector<HTMLInputElement>('#mm-client')!;
      expect(client.getAttribute('role')).toBe('combobox');
      expect(client.value).toBe('All clients');
      client.dispatchEvent(new Event('focus'));
      h.detectChanges();
      const listed = (): string[] =>
        Array.from(el(h).querySelectorAll('[role=option]')).map((o) => o.textContent!.trim());
      expect(listed()).toEqual(['All clients', '90002 Client 2', '90003 Client 3']);
      client.value = 'client 3';
      client.dispatchEvent(new Event('input'));
      h.detectChanges();
      expect(listed()).toEqual(['90003 Client 3']);
      // The Matter filter is the same component, "All matters" until one is chosen.
      const matterBox = el(h).querySelector<HTMLInputElement>('#mm-matter')!;
      expect(matterBox.getAttribute('role')).toBe('combobox');
      expect(matterBox.value).toBe('All matters');
      const create = el(h).querySelector('[data-header-new-task]')!;
      expect(create.querySelector('[data-new-task-go]')!.textContent!.trim()).toBe('New task');
      // The old chooser "Matter: ..." is gone; New task asks for the matter itself while none is chosen.
      expect(create.textContent).not.toContain('Matter:');
      expect(el(h).querySelector('[data-header-new-task] mf-action-menu')).toBeNull();
      // The scope switch and the Focus checklist are inside the one Options menu of the title row.
      expect(el(h).querySelectorAll('[data-header-options]').length).toBe(1);
      expect(el(h).querySelector('[data-header-options] [data-focus-inline]')).not.toBeNull();
      expect(TestBed.inject(CreateTaskContext).matterId()).toBeNull();
    });

    it('one client and only Primary matters: no Client and no Role, but the Matter dropdown (two matters); a role in the address brings its control back', async () => {
      const h = await open('/my-matters', undefined, undefined, [
        matter(5, 2, 'primary'),
        matter(6, 2, 'primary'),
      ]);
      expect(el(h).querySelector('#mm-client')).toBeNull();
      expect(el(h).querySelector('#mm-role')).toBeNull();
      expect(el(h).querySelector('#mm-matter')).not.toBeNull();
      await TestBed.inject(Router).navigateByUrl('/my-matters?role=secondary');
      await h.fixture.whenStable();
      h.detectChanges();
      expect(el(h).querySelector('#mm-role')).not.toBeNull();
      expect(el(h).querySelector('[data-clear-filters]')).not.toBeNull();
      expect(el(h).querySelector('#mm-client')).toBeNull();
    });

    it('the Matter filter is a page filter: it lists the matters of the chosen client, goes to the address, the grid, the counts and the New task button (#941)', async () => {
      const h = await open('/my-matters?clientId=2', undefined, undefined, [
        matter(5, 2, 'primary'),
        matter(6, 3, 'secondary'),
        matter(7, 2, 'primary'),
      ]);
      const box = el(h).querySelector<HTMLInputElement>('#mm-matter')!;
      box.dispatchEvent(new Event('focus'));
      h.detectChanges();
      const options = () =>
        Array.from(el(h).querySelectorAll('#mm-matter-list [role=option]')).map((o) =>
          o.textContent!.trim(),
        );
      // Only the matters of Client 2 (and the way back to all).
      expect(options()).toEqual(['All matters', '90002-80005 Matter 5', '90002-80007 Matter 7']);
      el(h)
        .querySelector<HTMLElement>('#mm-matter-list [data-option="7"]')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await settle(h);
      const router = TestBed.inject(Router);
      expect(router.parseUrl(router.url).queryParams).toEqual({
        clientId: '2',
        matterId: '7',
        dm: '7',
      });
      // The grid, the counts and the shell's Create task follow.
      expect(lastGrid()).toMatchObject({ matter: 7, client: 2, managedByMe: true });
      expect(api['getMyMattersSummary']).toHaveBeenLastCalledWith(
        undefined,
        undefined,
        undefined,
        2,
        undefined,
        undefined,
        undefined,
        undefined,
        7,
      );
      expect(TestBed.inject(CreateTaskContext).matterId()).toBe(7);
      const go = el(h).querySelector<HTMLButtonElement>('[data-new-task-go]')!;
      expect(go.getAttribute('aria-label')).toBe('New task for 90002-80007 Matter 7');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
      go.click();
      expect(navigate.mock.calls.at(-1)![1]!.queryParams).toMatchObject({ matterId: 7 });
      expect((box as HTMLInputElement).value).toBe('90002-80007 Matter 7');
      // One Clear filters clears the matter with the others.
      el(h).querySelector<HTMLButtonElement>('[data-clear-filters]')!.click();
      await settle(h);
      expect(TestBed.inject(Router).url).toBe('/my-matters');
    });

    it('choosing a client clears a matter of another client, and keeps one of that client (#941)', async () => {
      const h = await open('/my-matters?matterId=6', undefined, undefined, [
        matter(5, 2, 'primary'),
        matter(6, 3, 'secondary'),
      ]);
      const client = el(h).querySelector<HTMLInputElement>('#mm-client')!;
      const choose = async (id: number) => {
        client.dispatchEvent(new Event('focus'));
        h.detectChanges();
        el(h)
          .querySelector<HTMLElement>(`#mm-client-list [data-option="${id}"]`)!
          .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        await settle(h);
      };
      const router = TestBed.inject(Router);
      await choose(3);
      expect(router.parseUrl(router.url).queryParams).toEqual({ clientId: '3', matterId: '6' });
      await choose(2);
      expect(router.parseUrl(router.url).queryParams).toEqual({ clientId: '2' });
    });

    it('a failed read of the matters hides nothing', async () => {
      const h = await open('/my-matters');
      expect(el(h).querySelector('#mm-client')).not.toBeNull();
      expect(el(h).querySelector('#mm-role')).not.toBeNull();
    });

    it('the Calendar has no Dates choice at all: a month with Previous, Next and Today, and no grid behind it (#906, #929, #944)', async () => {
      const h = await open('/my-matters?view=calendar', undefined, undefined, [
        matter(5, 2, 'primary'),
        matter(6, 3, 'secondary'),
      ]);
      expect(el(h).querySelector('#mm-range, [data-mm-dates], [data-range]')).toBeNull();
      expect(el(h).querySelector('[data-cal-prev]')).not.toBeNull();
      expect(el(h).querySelector('[data-cal-next]')).not.toBeNull();
      expect(el(h).querySelector('[data-cal-today]')).not.toBeNull();
      // No grid is drawn behind it: the calendar IS the task area.
      expect(el(h).querySelector('[data-panel=tasks]')).toBeNull();
    });

    it('a manager with no matter: only the positive line with the way on, no strip of zeros, no quiet line', async () => {
      const zero = {
        ...summary(),
        matters: count(0, 'q'),
        openTasks: count(0, 'q'),
        overdue: count(0, 'q'),
        dueIn3Days: count(0, 'q'),
        dueIn7Days: count(0, 'q'),
        unassigned: count(0, 'q'),
        onHold: count(0, 'q'),
        atRisk: count(0, 'q'),
      };
      const h = await open(
        '/my-matters',
        undefined,
        (a) => {
          quiet(a);
          a['getMyMattersSummary'].mockReturnValue(of(zero));
        },
        [],
      );
      expect(el(h).querySelector('[data-mm-strip]')).toBeNull();
      expect(el(h).querySelector('[data-all-quiet]')).toBeNull();
      expect(el(h).querySelector('[data-empty-kind=none]')!.textContent).toContain(
        'You are not the project manager of any matter yet.',
      );
    });
  });
  describe('a calmer Overview (epic #893, batch 3: #894, #896, #897, #903)', () => {
    const matter = (id: number, clientId: number): Partial<MatterResponse> => ({
      matterId: id,
      clientId,
      matterRef: `9000${clientId}-8000${id}`,
      name: `Matter ${id}`,
      primaryManager: { userId: 1, displayName: 'Me', isActive: true },
    });
    it('one column with ONE section, the grid of open tasks, and no two-column grid; it is flat, without a card (#903, #943)', async () => {
      const h = await open('/my-matters');
      const order = Array.from(el(h).querySelectorAll('[data-panel]')).map((p) =>
        p.getAttribute('data-panel'),
      );
      expect(order).toEqual(['tasks']);
      expect(el(h).querySelector('.mm__grid')).toBeNull();
      expect(el(h).querySelector('.mm__stack')).not.toBeNull();
      expect(el(h).querySelector('[data-panel=tasks] .mmp')!.classList.contains('mmp--flat')).toBe(
        true,
      );
    });

    it('the grid has the controls of its heading row and nothing else besides the table: the dropdown, the Calendar button, Urgency and Options with Export inside; no Views, Task types, Sort or View all (#894, #907, #929, #942)', async () => {
      const h = await open('/my-matters');
      const panel = el(h).querySelector('[data-panel=tasks]')!;
      const options = panel.querySelectorAll('mf-options-menu');
      expect(options).toHaveLength(1);
      expect(options[0].querySelector('[data-options-trigger]')!.getAttribute('aria-label')).toBe(
        'Options for Open tasks',
      );
      expect(options[0].querySelectorAll('[data-export]').length).toBe(2);
      expect(
        panel.querySelector(
          '[data-views], [data-types-trigger], [data-sort], [data-dir], [data-view-all]',
        ),
      ).toBeNull();
      const controls = Array.from(
        panel.querySelectorAll('a, button, select, input, summary'),
      ).filter((c) => !c.closest('mf-options-menu') && !c.closest('mf-task-table'));
      expect(
        controls.map(
          (c) =>
            c.getAttribute('data-calendar-toggle') ??
            c.getAttribute('data-sort-urgency') ??
            (c.tagName === 'SELECT' ? 'select' : 'other'),
        ),
      ).toEqual(['select', '', '']);
    });

    it('the matter is a column only for a person with several matters (#897, #929)', async () => {
      const one = await open('/my-matters', undefined, undefined, [matter(5, 2)]);
      expect(el(one).querySelector('[data-panel=tasks] th[data-col=matterName]')).toBeNull();
      expect(el(one).querySelector('[data-panel=tasks] tbody tr[data-task]')).not.toBeNull();
    });

    it('with several matters the Matter name is a column of the grid (#897, #929)', async () => {
      const h = await open('/my-matters', undefined, undefined, [matter(5, 2), matter(6, 2)]);
      expect(el(h).querySelector('[data-panel=tasks] th[data-col=matterName]')).not.toBeNull();
      expect(
        Array.from(el(h).querySelectorAll('[data-panel=tasks] td[data-col=matterName]')).map((n) =>
          n.textContent!.trim(),
        ),
      ).toEqual(['Merger', 'Merger']);
    });

    it('the Focus is the one task type filter of the grid (#907, #929)', async () => {
      const h = await open('/my-matters');
      TestBed.inject(MyMattersFocus).set([7, 9]);
      await h.fixture.whenStable();
      h.detectChanges();
      await h.fixture.whenStable();
      expect(tqCall(tq.mock.calls.at(-1)!)['type']).toEqual([7, 9]);
    });

    it('with a Focus that hides everything, the grid says so and offers Clear Focus', async () => {
      const h = await open('/my-matters', undefined, () =>
        tq.mockImplementation((...args: unknown[]) =>
          tqCall(args)['type'] ? of(queuePage([], 0)) : defaultQueue(),
        ),
      );
      TestBed.inject(MyMattersFocus).set([7]);
      await h.fixture.whenStable();
      h.detectChanges();
      await h.fixture.whenStable();
      h.detectChanges();
      const panel = el(h).querySelector('[data-panel=tasks]')!;
      expect(panel.querySelector('[data-filtered-empty]')!.textContent).toContain(
        'Nothing in your Focus is open.',
      );
      expect(panel.querySelector('[data-show-all]')).not.toBeNull();
    });
  });
});
