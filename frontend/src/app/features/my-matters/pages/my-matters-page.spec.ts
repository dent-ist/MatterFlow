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

function health(items: object[] = [row(5, 4, 2, 1), row(6, 0, 0, 0)]) {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 8,
    sort: 'worst',
    dir: 'desc',
    amberDueDays: 3,
    stuckOnHoldDays: 7,
    timeZone: 'America/New_York',
  };
}

function row(matterId: number, overdue: number, atRisk: number, unassigned: number, clientId = 2) {
  return {
    matterId,
    matterRef: `9000${matterId}-80001`,
    matterName: `Matter ${matterId}`,
    clientId,
    clientNumber: `0000${clientId}`,
    clientName: `Client ${clientId}`,
    open: 31,
    overdue,
    dueThisWeek: 9,
    unassigned,
    atRisk,
    percentComplete: 62,
    nextDeadline: '2026-10-26',
    flag: overdue > 0 ? 'RED' : 'GREEN',
    flagReasons: overdue > 0 ? ['OVERDUE'] : ['NO_OPEN_TASKS'],
    query: `matter=${matterId}&status=NEW`,
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

/** The default answers of the grids: two tasks needing attention (of 25) and two due in the next 7 days (of 41). */
function defaultQueue(args: unknown[]) {
  const q = tqCall(args);
  return q['needsAttention']
    ? of(
        queuePage(
          [
            queueRow(1),
            queueRow(2, { assignedUser: { userId: 9, displayName: 'Dana', isActive: true } }),
          ],
          25,
        ),
      )
    : of(
        queuePage(
          [
            queueRow(3, { isOverdue: false, dueDate: '2026-10-27' }),
            queueRow(4, { isOverdue: false, dueDate: '2026-10-28' }),
          ],
          41,
        ),
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

function trends() {
  const week = (i: number) => ({
    weekStart: `2026-09-${String(7 + i * 7).padStart(2, '0')}`,
    weekEnd: `2026-09-${String(13 + i * 7).padStart(2, '0')}`,
    isCurrent: i === 3,
    created: 4 + i,
    closed: 3 + i,
    overdueAtWeekEnd: 2 + i,
    createdQuery: 'managedByMe=true&createdFrom=2026-09-07',
    closedQuery: 'managedByMe=true&status=COMPLETED',
  });
  return {
    timeZone: 'America/New_York',
    asOfUtc: '2026-10-23T12:00:00Z',
    weeks: 12,
    approximate: true,
    limitations: ['CURRENT_DUE_DATES', 'CURRENT_STATUS'],
    points: [0, 1, 2, 3].map(week),
    now: {
      open: 212,
      averageAgeDays: 9.4,
      onHold: 3,
      oldestOnHoldDays: 12,
      openQuery: 'managedByMe=true&status=NEW',
      onHoldQuery: 'managedByMe=true&status=ON_HOLD',
      overdueQuery: 'managedByMe=true&overdue=true',
    },
  };
}

describe('MyMattersPage', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  /** `getTaskQueue` of the two grids; a test overrides it with `tq.mockImplementation`. */
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
      getMyMattersDeadlines: vi.fn().mockReturnValue(
        of({
          timeZone: 'x',
          asOfUtc: 'x',
          days: 28,
          fromDate: '2026-10-23',
          toDate: '2026-11-20',
          total: 30,
          query: 'managedByMe=true&dueTo=2026-11-20&sort=due',
          items: [
            task(3, { factCode: 'DUE_IN_DAYS', factDays: 3 }),
            task(4, { dueDate: '2026-10-27' }),
          ],
        }),
      ),
      getMyMattersHealth: vi.fn().mockReturnValue(of(health())),
      getMyMattersSinceLastVisit: vi.fn().mockReturnValue(of(since())),
      getMyMattersTrends: vi.fn().mockReturnValue(of(trends())),
      getMyMattersBreakdown: vi.fn().mockImplementation((view: string) => of(breakdown(view))),
      getMyMattersActivity: vi.fn().mockReturnValue(of(activity())),
      markMyMattersActivitySeen: vi.fn().mockReturnValue(of({ seenEventId: 12, seenAtUtc: 'x' })),
    };
    tq = vi.fn<(...args: unknown[]) => unknown>((...args) => defaultQueue(args));
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

  it('shows six equal tiles in a fixed order, red only for Overdue and amber only for At risk, all buttons opening the lists they count (#927)', async () => {
    const h = await open('/my-matters');
    const chips = Array.from(el(h).querySelectorAll<HTMLButtonElement>('button[data-strip-item]'));
    expect(chips.map((c) => c.getAttribute('data-strip-item'))).toEqual([
      'overdue',
      'atRisk',
      'unassigned',
      'onHold',
      'due7',
      'open',
    ]);
    // The accessible name starts with the count; the oldest hold is said with the on-hold tile (never before the count, #821).
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
      '9 overdue',
      '5 at risk',
      '6 unassigned',
      '3 on hold, oldest 12 days',
      '41 due soon, within 7 days',
      '212 open tasks',
    ]);
    // A large number and a short word in every tile.
    expect(chips.map((c) => c.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '9 Overdue',
      '5 At risk',
      '6 Unassigned',
      '3 On hold',
      '41 Due soon',
      '212 Open',
    ]);
    expect(chips.every((c) => c.classList.contains('tile'))).toBe(true);
    expect(chips.every((c) => c.querySelector('.tile__n') && c.querySelector('.tile__l'))).toBe(
      true,
    );
    // Red only for Overdue and amber only for At risk; nothing else is loud.
    expect(chips.map((c) => c.classList.contains('tile--danger'))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(chips.map((c) => c.classList.contains('tile--warning'))).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
    // "Matters I manage" and "Due in 3 days" are gone.
    expect(el(h).querySelector('[data-strip-item=matters], [data-strip-item=due3]')).toBeNull();
    expect(el(h).querySelector('[data-mm-strip]')!.getAttribute('aria-label')).toContain(
      'your matters',
    );
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate');
    chips[0].click();
    expect(navigate).toHaveBeenCalledWith(['/tasks'], {
      queryParams: { managedByMe: 'true', overdue: 'true', sort: 'due', dir: 'asc' },
    });
    chips[1].click();
    expect(navigate.mock.calls[1][1]!.queryParams).toMatchObject({ atRisk: 'true' });
    chips[5].click();
    expect(navigate.mock.calls[2][1]!.queryParams!['status']).toEqual([
      'NEW',
      'IN_PROGRESS',
      'ON_HOLD',
    ]);
  });

  it('nothing late: a zero tile is muted but still a button, and no tile is red or amber (#927)', async () => {
    const h = await open('/my-matters', undefined, (a) => {
      a['getMyMattersSummary'].mockReturnValue(
        of({
          ...summary(),
          overdue: count(0, 'managedByMe=true&overdue=true'),
          atRisk: count(0, 'q'),
          unassigned: count(0, 'q'),
        }),
      );
    });
    const tile = (key: string) =>
      el(h).querySelector<HTMLButtonElement>(`button[data-strip-item=${key}]`)!;
    // All six tiles stay (the strip does not rearrange itself), the zeros are muted and not loud.
    expect(el(h).querySelectorAll('button[data-strip-item]').length).toBe(6);
    expect(tile('overdue').classList.contains('tile--zero')).toBe(true);
    expect(tile('overdue').classList.contains('tile--danger')).toBe(false);
    expect(tile('atRisk').classList.contains('tile--warning')).toBe(false);
    expect(tile('unassigned').classList.contains('tile--zero')).toBe(true);
    expect(tile('unassigned').disabled).toBe(false);
    expect(tile('onHold').classList.contains('tile--zero')).toBe(false);
    expect(el(h).querySelector('[data-headline-none]')).toBeNull();
  });

  it('sends no date range to the strip and the grids; Next 7 days asks for dueWithin=7, whatever the range, and the Overview does not read the deadlines endpoint (#896, #929)', async () => {
    await open('/my-matters?range=2w');
    expect(api['getMyMattersSummary']).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    const calls = tq.mock.calls.map((c) => tqCall(c));
    const next = calls.find((c) => c['dueWithin'] === 7)!;
    expect(next).toMatchObject({
      managedByMe: true,
      status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'],
      sort: 'due',
      dir: 'asc',
      page: 1,
      pageSize: 8,
    });
    expect(next['dueFrom']).toBeUndefined();
    expect(next['dueTo']).toBeUndefined();
    expect(api['getMyMattersDeadlines']).not.toHaveBeenCalled();
    expect(api['getMyMattersHealth']).toHaveBeenCalledWith(
      'worst',
      undefined,
      1,
      8,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it('keeps the filters in the address and restores them from it', async () => {
    const h = await open('/my-matters?role=primary&clientId=4');
    expect(api['getMyMattersSummary']).toHaveBeenCalledWith(
      undefined,
      'primary',
      4,
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
      'secondary',
      4,
      undefined,
      undefined,
      undefined,
    );
  });

  it('shows Needs my attention as the shared grid: the Tasks columns, five rows asked for, most urgent first, one View all N with the Task Queue filter (#929)', async () => {
    const h = await open('/my-matters');
    const panel = el(h).querySelector('[data-panel=attention]')!;
    expect(panel.querySelector('h2')!.textContent).toBe('Needs my attention');
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
    const asked = tqCall(tq.mock.calls.find((c) => tqCall(c)['needsAttention'])!);
    expect(asked).toMatchObject({
      managedByMe: true,
      needsAttention: true,
      status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'],
      sort: 'attention',
      dir: 'asc',
      page: 1,
      pageSize: 5,
    });
    const all = panel.querySelectorAll<HTMLAnchorElement>('[data-view-all]');
    expect(all).toHaveLength(1);
    expect(all[0].textContent!.trim()).toBe('View all 25');
    expect(all[0].getAttribute('href')).toBe(
      '/tasks?managedByMe=true&status=NEW&status=IN_PROGRESS&status=ON_HOLD&needsAttention=true&sort=attention&dir=asc',
    );
  });

  it('a click on a heading sorts the whole set on the server and announces it (aria-sort); the same heading again turns the order round (#929)', async () => {
    const h = await open('/my-matters');
    const panel = el(h).querySelector('[data-panel=attention]')!;
    const th = (col: string) => panel.querySelector(`th[data-col=${col}]`)!;
    const press = async (col: string) => {
      th(col).querySelector<HTMLButtonElement>('button.wt-sort')!.click();
      await h.fixture.whenStable();
      h.detectChanges();
      await h.fixture.whenStable();
      h.detectChanges();
    };
    const last = () => tqCall(tq.mock.calls.filter((c) => tqCall(c)['needsAttention']).at(-1)!);
    const urgency = () => panel.querySelector<HTMLButtonElement>('[data-sort-urgency]')!;
    // Urgency is the default order (issue #935): no heading is marked, the Urgency control is pressed.
    expect(last()).toMatchObject({ sort: 'attention', dir: 'asc' });
    expect(th('due').getAttribute('aria-sort')).toBe('none');
    expect(th('priority').getAttribute('aria-sort')).toBe('none');
    expect(urgency().textContent!.trim()).toBe('Urgency');
    expect(urgency().getAttribute('aria-pressed')).toBe('true');
    await press('due');
    expect(last()).toMatchObject({ sort: 'due', dir: 'asc', page: 1, pageSize: 5 });
    expect(th('due').getAttribute('aria-sort')).toBe('ascending');
    expect(urgency().getAttribute('aria-pressed')).toBe('false');
    await press('due');
    expect(last()).toMatchObject({ sort: 'due', dir: 'desc' });
    expect(th('due').getAttribute('aria-sort')).toBe('descending');
    await press('priority');
    expect(last()).toMatchObject({ sort: 'priority', dir: 'asc' });
    expect(th('priority').getAttribute('aria-sort')).toBe('ascending');
    expect(th('due').getAttribute('aria-sort')).toBe('none');
    // "View all" opens the Task Queue in the order in force.
    expect(
      panel.querySelector<HTMLAnchorElement>('[data-view-all]')!.getAttribute('href'),
    ).toContain('sort=priority&dir=asc');
    // The Urgency control brings the default order back.
    urgency().click();
    await h.fixture.whenStable();
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
    expect(last()).toMatchObject({ sort: 'attention', dir: 'asc' });
    expect(urgency().getAttribute('aria-pressed')).toBe('true');
    expect(
      panel.querySelector<HTMLAnchorElement>('[data-view-all]')!.getAttribute('href'),
    ).toContain('sort=attention&dir=asc');
    // The other grid is its own: its order did not change.
    expect(
      el(h).querySelector('[data-panel=deadlines] th[data-col=due]')!.getAttribute('aria-sort'),
    ).toBe('ascending');
  });

  it('every sortable heading of the grids is a button; the headings that cannot sort are not (#929)', async () => {
    const h = await open('/my-matters');
    const heads = Array.from(el(h).querySelectorAll('[data-panel=attention] thead th'));
    expect(heads.every((t) => t.querySelector('button.wt-sort') !== null)).toBe(true);
  });

  it('At risk and On hold show in the shared Due and Status cells', async () => {
    const h = await open('/my-matters', undefined, () =>
      tq.mockImplementation((...args: unknown[]) =>
        of(
          queuePage(
            tqCall(args)['needsAttention']
              ? [
                  queueRow(1, { atRisk: true, isOverdue: false, dueDate: '2099-01-01' }),
                  queueRow(2, { status: 'ON_HOLD', statusLabel: 'On Hold', isOverdue: false }),
                ]
              : [],
          ),
        ),
      ),
    );
    const rows = Array.from(el(h).querySelectorAll('[data-panel=attention] tbody tr[data-task]'));
    expect(rows[0].querySelector('[data-col=due]')!.textContent).toContain('At risk');
    expect(rows[1].querySelector('[data-col=status]')!.textContent).toContain('On Hold');
  });

  it('leaves a task out of Next 7 days when Needs my attention lists it: one task, once per screen (#905, #929)', async () => {
    const h = await open('/my-matters', undefined, () =>
      tq.mockImplementation((...args: unknown[]) =>
        tqCall(args)['needsAttention']
          ? of(queuePage([queueRow(3, { dueDate: '2026-10-23', isOverdue: false })], 1))
          : of(
              queuePage(
                [3, 4, 5, 6, 7].map((id) => queueRow(id, { isOverdue: false })),
                5,
              ),
            ),
      ),
    );
    const ids = Array.from(el(h).querySelectorAll('a.wt-title')).map((a) => a.getAttribute('href'));
    expect(ids.filter((x) => x === '/tasks/3?from=my-matters')).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    // Three rows are shown below it, the first not listed above.
    expect(
      Array.from(el(h).querySelectorAll('[data-panel=deadlines] tbody tr[data-task]')).map((r) =>
        r.getAttribute('data-task'),
      ),
    ).toEqual(['TSK-4', 'TSK-5', 'TSK-6']);
  });

  it('says so when nothing needs attention, with no manager-related item', async () => {
    const h = await open('/my-matters', undefined, () =>
      tq.mockImplementation((...args: unknown[]) =>
        tqCall(args)['needsAttention'] ? of(queuePage([], 0)) : defaultQueue(args),
      ),
    );
    const panel = el(h).querySelector('[data-panel=attention]')!;
    expect(panel.querySelector('[data-empty]')!.textContent).toContain(
      'Nothing needs your attention.',
    );
    expect(panel.querySelector('table, [data-view-all], mf-options-menu')).toBeNull();
    expect(el(h).textContent).not.toMatch(/no (project )?manager/i);
  });

  it('Next 7 days is a grid of its own with the same columns, no Options, and View all N opens the Task Queue with dueWithin=7 (#896, #929)', async () => {
    const h = await open('/my-matters');
    const panel = el(h).querySelector('[data-panel=deadlines]')!;
    expect(panel.querySelector('h2')!.textContent).toBe('Next 7 days');
    expect(
      Array.from(panel.querySelectorAll('thead th')).map((t) => t.getAttribute('data-col')),
    ).toEqual(['ref', 'title', 'matterName', 'priority', 'assignee', 'due', 'status']);
    expect(panel.querySelectorAll('tbody tr[data-task]')).toHaveLength(2);
    expect(panel.querySelector('mf-options-menu')).toBeNull();
    const all = panel.querySelector<HTMLAnchorElement>('[data-view-all]')!;
    expect(all.textContent!.trim()).toBe('View all 41');
    expect(all.getAttribute('href')).toBe(
      '/tasks?managedByMe=true&status=NEW&status=IN_PROGRESS&status=ON_HOLD&dueWithin=7&sort=due&dir=asc',
    );
  });

  it('Next 7 days shows at most three rows (owner decision of 2026-10-28) and says how many there are in all', async () => {
    const h = await open('/my-matters', undefined, () =>
      tq.mockImplementation((...args: unknown[]) =>
        tqCall(args)['needsAttention']
          ? of(queuePage([], 0))
          : of(
              queuePage(
                [10, 11, 12, 13, 14, 15, 16, 17].map((id) => queueRow(id, { isOverdue: false })),
                8,
              ),
            ),
      ),
    );
    const panel = el(h).querySelector('[data-panel=deadlines]')!;
    expect(panel.querySelectorAll('tbody tr[data-task]')).toHaveLength(3);
    expect(panel.querySelector('[data-view-all]')!.textContent).toContain('View all 8');
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
    expect(el(h).querySelector('[data-panel=attention]')).not.toBeNull();
  });

  it('the Calendar button swaps the two grids for the calendar and back, names what it does, and the choice is remembered (#929)', async () => {
    const h = await open('/my-matters');
    const toggle = () => el(h).querySelector<HTMLButtonElement>('[data-calendar-toggle]')!;
    const settle = async () => {
      await h.fixture.whenStable();
      h.detectChanges();
      await h.fixture.whenStable();
      h.detectChanges();
    };
    expect(toggle().getAttribute('aria-label')).toBe('Show calendar');
    // It lives in the heading of Needs my attention.
    expect(el(h).querySelector('[data-panel=attention]')!.contains(toggle())).toBe(true);
    toggle().click();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/my-matters?view=calendar');
    expect(el(h).querySelector('[data-panel=attention], [data-panel=deadlines]')).toBeNull();
    expect(el(h).querySelector('[data-panel=calendar]')).not.toBeNull();
    expect(el(h).querySelector('[data-calendar]')).not.toBeNull();
    expect(api['getMyMattersDeadlines']).toHaveBeenCalledWith(
      28,
      'day',
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
    expect(toggle().getAttribute('aria-label')).toBe('Show list');
    expect(el(h).querySelector('[data-panel=calendar]')!.contains(toggle())).toBe(true);
    expect(Object.values(localStorage)).toContain('calendar');
    toggle().click();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/my-matters');
    expect(el(h).querySelector('[data-panel=attention]')).not.toBeNull();
    expect(el(h).querySelector('[data-panel=calendar]')).toBeNull();
    expect(Object.values(localStorage)).not.toContain('calendar');
  });

  it('a visit with no view in the address opens the Calendar when that is what the person last used (#929)', async () => {
    localStorage.setItem('mf-my-matters-calendar-1', 'calendar');
    const h = await open('/my-matters');
    expect(TestBed.inject(Router).url).toBe('/my-matters?view=calendar');
    expect(el(h).querySelector('[data-panel=calendar]')).not.toBeNull();
  });

  it('lists the matters as one-line rows, worst first: counts instead of a Red / Amber / Green word, one row menu (#908)', async () => {
    const h = await open('/my-matters');
    const list = el(h).querySelector('[data-health-list]')!;
    expect(list.getAttribute('aria-label')).toBe('Matters, worst first');
    const rows = Array.from(list.querySelectorAll('[data-health-row]'));
    expect(rows.map((r) => r.getAttribute('data-matter-id'))).toEqual(['5', '6']);
    const first = rows[0];
    expect(first.querySelector('[data-matter-link]')!.getAttribute('href')).toBe('/matters/5');
    const over = (r: Element) => r.querySelector<HTMLElement>('[data-overdue]')!;
    expect(over(first).textContent!.replace(/\s+/g, ' ').trim()).toBe('4 overdue');
    expect(over(first).classList.contains('mh__chip--danger')).toBe(true);
    // Zero overdue is a muted chip, not a red one; at risk and unassigned appear only above zero.
    expect(over(rows[1]).textContent!.replace(/\s+/g, ' ').trim()).toBe('0 overdue');
    expect(over(rows[1]).classList.contains('mh__chip--danger')).toBe(false);
    expect(first.querySelector('[data-at-risk]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      '2 at risk',
    );
    expect(first.querySelector('[data-unassigned]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      '1 unassigned',
    );
    expect(rows[1].querySelector('[data-at-risk], [data-unassigned]')).toBeNull();
    expect(first.querySelector('[data-next]')!.textContent).toContain('Next deadline');
    expect(first.querySelector('[data-next]')!.textContent).toContain('next Oct 26');
    // No flag words, no table, no per-row New task button; one menu per row.
    expect(el(h).querySelector('[data-panel=health] [data-flag], [data-health-table]')).toBeNull();
    expect(
      el(h).querySelector('[data-panel=health] [data-sort], [data-panel=health] th'),
    ).toBeNull();
    expect(first.querySelector('[data-new-task]')).toBeNull();
    expect(first.querySelectorAll('[data-row-actions] button')).toHaveLength(1);
    // One client: no client name on the rows. The rule is in one place behind the info button.
    expect(first.querySelector('[data-client]')).toBeNull();
    expect(el(h).querySelector('[data-rule]')).toBeNull();
    el(h).querySelector<HTMLButtonElement>('[data-how]')!.click();
    h.detectChanges();
    expect(el(h).querySelector('[data-rule]')!.textContent).toContain('Worst first');
    expect(el(h).querySelector('[data-all-matters]')!.getAttribute('href')).toBe(
      '/matters?mine=true',
    );
    expect(el(h).querySelector('[data-all-matters]')!.textContent).toContain('All matters (2)');
  });

  it('names the client on a row only when the matters belong to two or more clients', async () => {
    const h = await open('/my-matters', undefined, (a) => {
      a['getMyMattersHealth'].mockReturnValue(of(health([row(5, 4, 0, 0, 2), row(6, 1, 0, 0, 3)])));
    });
    expect(
      Array.from(el(h).querySelectorAll('[data-client]')).map((c) => c.textContent!.trim()),
    ).toEqual(['Client 2', 'Client 3']);
  });

  it('draws no matters list for one matter: the strip names and links it (#908)', async () => {
    const h = await open(
      '/my-matters',
      undefined,
      (a) => {
        a['getMyMattersHealth'].mockReturnValue(of(health([row(5, 4, 2, 1)])));
        a['getMyMattersSummary'].mockReturnValue(
          of({ ...summary(), matters: count(1, 'isActive=true&managedByMe=true') }),
        );
      },
      [{ matterId: 5, clientId: 2, matterRef: '90005-80001', name: 'Matter 5' }],
    );
    expect(el(h).querySelector('[data-panel=health]')).toBeNull();
    expect(el(h).querySelector('[data-health-list], [data-new-task]')).toBeNull();
    const link = el(h).querySelector<HTMLAnchorElement>('[data-strip-matter]')!;
    expect(link.getAttribute('href')).toBe('/matters/5');
    expect(link.textContent).toContain('90005-80001 Matter 5');
  });

  it('opens Create task with the matter and the way back when New task is chosen in the row menu', async () => {
    const h = await open('/my-matters?role=primary');
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate');
    el(h).querySelector<HTMLButtonElement>('[data-row-actions] button')!.click();
    h.detectChanges();
    el(h).querySelector<HTMLButtonElement>('[data-action=new-task]')!.click();
    expect(navigate).toHaveBeenCalledWith(['/tasks/new'], {
      queryParams: { matterId: 5, returnTo: '/my-matters?role=primary' },
    });
  });

  it('has no New task in the row menu without Task.Create (absent, never disabled)', async () => {
    const h = await open('/my-matters', ['Matter.BeManager', 'Matter.View', 'Task.View']);
    el(h).querySelector<HTMLButtonElement>('[data-row-actions] button')!.click();
    h.detectChanges();
    expect(el(h).querySelector('[data-action=new-task]')).toBeNull();
    expect(el(h).querySelector('[data-action=open-tasks]')).not.toBeNull();
  });

  it('shows a positive empty state for a manager with no matters, with a way to My Work', async () => {
    const h = await open('/my-matters', undefined, (a) =>
      a['getMyMattersHealth'].mockReturnValue(of(health([]))),
    );
    const empty = el(h).querySelector('[data-panel=health] [data-empty]')!;
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
    const h = await open('/my-matters', permissions, (a) =>
      a['getMyMattersHealth'].mockReturnValue(of(health([]))),
    );
    expect(el(h).querySelector('[data-scope=all]')).not.toBeNull();
    el(h).querySelector<HTMLButtonElement>('[data-panel=health] [data-show-all]')!.click();
    await h.fixture.whenStable();
    expect(TestBed.inject(Router).url).toContain('scope=all');
    expect(api['getMyMattersSummary']).toHaveBeenLastCalledWith(
      'all',
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
    expect(el(h).querySelector('[data-panel=health]')).not.toBeNull();
  });

  it('a failing panel shows its own error with Retry and leaves the others alone', async () => {
    const h = await open('/my-matters');
    const failing = (...args: unknown[]) =>
      tqCall(args)['needsAttention'] ? throwError(() => new Error('boom')) : defaultQueue(args);
    tq.mockImplementation(failing);
    await TestBed.inject(Router).navigateByUrl('/my-matters?role=primary');
    await h.fixture.whenStable();
    h.detectChanges();
    expect(el(h).querySelector('[data-panel=attention] [data-panel-error]')).not.toBeNull();
    expect(el(h).querySelector('[data-panel=health] [data-health-list]')).not.toBeNull();
    tq.mockClear();
    tq.mockImplementation((...args: unknown[]) => defaultQueue(args));
    el(h).querySelector<HTMLButtonElement>('[data-panel=attention] [data-panel-retry]')!.click();
    await h.fixture.whenStable();
    h.detectChanges();
    expect(tq.mock.calls.filter((c) => tqCall(c)['needsAttention'])).toHaveLength(1);
    expect(el(h).querySelector('[data-panel=attention] table')).not.toBeNull();
  });

  it('two or more failed calls: ONE banner and ONE Retry for the page, a muted "not loaded" line in each section; Retry asks every failed call again (#921)', async () => {
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
    // No section keeps a Retry of its own, and each says "not loaded" without a button.
    expect(el(h).querySelectorAll('[data-panel-retry], [data-strip-retry]')).toHaveLength(0);
    expect(el(h).querySelector('[data-panel-error], [data-strip-error]')).toBeNull();
    expect(el(h).querySelector('[data-panel=attention] [data-panel-notloaded]')).not.toBeNull();
    expect(el(h).querySelector('[data-panel=deadlines] [data-panel-notloaded]')).not.toBeNull();
    expect(el(h).querySelector('[data-strip-notloaded]')).not.toBeNull();
    // The one Retry asks each failed call once; the sections that were fine are left alone.
    tq.mockClear();
    tq.mockImplementation((...args: unknown[]) => defaultQueue(args));
    api['getMyMattersSummary'].mockClear();
    api['getMyMattersSummary'].mockReturnValue(of(summary()));
    api['getMyMattersHealth'].mockClear();
    el(h).querySelector<HTMLButtonElement>('[data-page-retry]')!.click();
    await h.fixture.whenStable();
    h.detectChanges();
    expect(tq.mock.calls.filter((c) => tqCall(c)['needsAttention'])).toHaveLength(1);
    expect(tq.mock.calls.filter((c) => tqCall(c)['dueWithin'])).toHaveLength(1);
    expect(api['getMyMattersSummary']).toHaveBeenCalledTimes(1);
    expect(api['getMyMattersHealth']).not.toHaveBeenCalled();
    expect(el(h).querySelector('[data-page-error]')).toBeNull();
  });

  it('a panel that is still loading has no toolbar: its Options and View all appear with the data (#921)', async () => {
    const h = await open('/my-matters', undefined, () =>
      tq.mockImplementation((...args: unknown[]) =>
        tqCall(args)['needsAttention'] ? NEVER : defaultQueue(args),
      ),
    );
    const panel = el(h).querySelector('[data-panel=attention]')!;
    expect(panel.querySelector('[data-loading]')).not.toBeNull();
    expect(panel.querySelector('mf-options-menu, [data-view-all]')).toBeNull();
    // The skeleton stands for the five rows the list will have.
    expect(panel.querySelectorAll('.mmp__row')).toHaveLength(5);
  });

  it('Role says "I am" with plain choices (Primary or secondary, Primary, Secondary) (#899)', async () => {
    const h = await open('/my-matters?role=primary');
    const bar = el(h).querySelector('[data-mm-filters]')!;
    expect(bar.querySelector('label[for=mm-role]')!.textContent!.trim()).toBe('I am');
    expect(
      Array.from(bar.querySelectorAll('#mm-role option')).map((o) => o.textContent!.trim()),
    ).toEqual(['Primary or secondary', 'Primary', 'Secondary']);
  });

  it('loads every panel on its own: a panel still waiting does not hold the others', async () => {
    const h = await open('/my-matters');
    tq.mockImplementation((...args: unknown[]) =>
      tqCall(args)['needsAttention'] ? NEVER : defaultQueue(args),
    );
    await TestBed.inject(Router).navigateByUrl('/my-matters?role=secondary');
    await h.fixture.whenStable();
    h.detectChanges();
    expect(el(h).querySelector('[data-panel=attention] [data-loading]')).toBeNull(); // keeps the previous numbers
    expect(el(h).querySelector('[data-panel=health] [data-health-list]')).not.toBeNull();
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
      expect(tabs(h)).toEqual(['Overview', 'Breakdown', 'Data', 'Activity', 'Trends']);
    });

    it('has no Data tab without Asset.View, and its address opens Overview', async () => {
      const h = await open('/my-matters?tab=data');
      expect(tabs(h)).not.toContain('Data');
      expect(el(h).querySelector('[role=tab][aria-selected=true]')!.textContent).toContain(
        'Overview',
      );
    });

    it('has the four tabs (no Deadlines, #929), Overview selected, and the page as it was under it', async () => {
      const h = await open('/my-matters');
      expect(tabs(h)).toEqual(['Overview', 'Breakdown', 'Activity', 'Trends']);
      expect(el(h).querySelector('[role=tab][aria-selected=true]')!.textContent).toContain(
        'Overview',
      );
      const panel = el(h).querySelector('[role=tabpanel]')!;
      expect(panel.getAttribute('aria-labelledby')).toBe('mm-tab-overview');
      expect(panel.querySelector('[data-panel=since]')).toBeNull(); // on the Activity tab since 2026-10-28
      expect(panel.querySelector('[data-panel=attention]')).not.toBeNull();
      expect(panel.querySelector('[data-panel=health]')).not.toBeNull();
      expect(el(h).querySelector('[data-panel=deadlines-tab]')).toBeNull();
    });

    it('opens a tab from the address, loads only that tab and keeps the filters', async () => {
      const h = await open('/my-matters?tab=trends&role=primary');
      expect(el(h).querySelector('[role=tab][aria-selected=true]')!.textContent).toContain(
        'Trends',
      );
      expect(el(h).querySelector('[data-panel=trends]')).not.toBeNull();
      expect(el(h).querySelector('[data-panel=health]')).toBeNull();
      expect(api['getMyMattersTrends']).toHaveBeenCalled();
      expect(api['getMyMattersTrends'].mock.calls[0][2]).toBe('primary'); // weeks, scope, role
      expect(api['getMyMattersHealth']).not.toHaveBeenCalled();
      // The date control lives in the Deadlines tab, never in the filter bar; a role that is in force keeps its control.
      expect(el(h).querySelector('#mm-range')).toBeNull();
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

    it('the Breakdown tab is a real table of matters by task type with a totals row and cells that open the filtered queue (PV-11)', async () => {
      const h = await open('/my-matters?tab=breakdown');
      const root = el(h).querySelector('[data-panel=breakdown]')!;
      const table = root.querySelector('table[data-bd-table=matrix]')!;
      expect(table.querySelector('caption')).not.toBeNull();
      expect(
        Array.from(table.querySelectorAll('thead th')).map((t) => t.textContent!.trim()),
      ).toEqual(['Matter', 'Production', 'Review', 'Intake', 'All types']);
      const cell = table.querySelector<HTMLAnchorElement>('[data-bd-cell]')!;
      expect(cell.textContent!.trim()).toBe('6');
      expect(cell.getAttribute('href')).toBe('/tasks?matter=5&type=1&status=NEW');
      expect(cell.getAttribute('aria-label')).toBe('90001-80001, Production: 6 open, 2 overdue');
      expect(table.querySelector('[data-bd-overdue]')!.textContent).toContain('2 overdue');
      expect(table.querySelector('tbody th[scope=row]')!.textContent).toContain('Merger');
      const totals = table.querySelector('tfoot [data-bd-totals], tfoot tr')!;
      expect(totals.textContent).toContain('11');
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

    it('the Trends tab shows the limitation on the screen, a summary, a table on request and the figures', async () => {
      const h = await open('/my-matters?tab=trends');
      const root = el(h).querySelector('[data-panel=trends]')!;
      expect(root.querySelector('[data-approximate]')!.textContent).toContain('Approximate');
      // One line while closed (PV-12): the limitations sit behind the disclosure.
      expect(root.querySelector('[data-approximate]')!.tagName).toBe('DETAILS');
      expect(root.querySelector('[data-approximate]')!.hasAttribute('open')).toBe(false);
      expect(root.querySelector('[data-limitations]')!.textContent).toContain('re-dated');
      expect(root.querySelectorAll('svg[role=img]')).toHaveLength(2);
      expect(root.querySelector('[data-chart=overdue] [data-summary]')!.textContent).toContain(
        'Overdue tasks at the end of the week',
      );
      expect(root.querySelector('[data-age]')!.textContent).toContain('9.4 days');
      expect(root.querySelector('[data-hold]')!.textContent).toContain('3');
      expect(root.querySelector('[data-table=overdue]')).toBeNull();
      root.querySelector<HTMLButtonElement>('[data-chart=overdue] [data-show-table]')!.click();
      h.detectChanges();
      expect(root.querySelectorAll('[data-table=overdue] tbody tr')).toHaveLength(4);
      expect(root.querySelector('[data-how]')).not.toBeNull();
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

    it('several clients and both roles: Client and Role are offered, the header has New task and its Matter chooser', async () => {
      const h = await open('/my-matters', undefined, undefined, [
        matter(5, 2, 'primary'),
        matter(6, 3, 'secondary'),
      ]);
      expect(el(h).querySelector('[data-mm-filters]')).not.toBeNull();
      expect(el(h).querySelector('#mm-client')).not.toBeNull();
      expect(el(h).querySelector('#mm-role')).not.toBeNull();
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
      const create = el(h).querySelector('[data-header-new-task]')!;
      expect(create.querySelector('[data-new-task-go]')!.textContent!.trim()).toBe('New task');
      // The chooser only picks the matter for New task (no page filter): "Matter: choose" until one is picked or was used last.
      expect(create.textContent).toContain('Matter: choose');
      // The scope switch and the Focus checklist are inside the one Options menu of the title row.
      expect(el(h).querySelectorAll('[data-header-options]').length).toBe(1);
      expect(el(h).querySelector('[data-header-options] [data-focus-inline]')).not.toBeNull();
      expect(TestBed.inject(CreateTaskContext).matterId()).toBeNull();
    });

    it('one client and only Primary matters: neither Client nor Role; a role in the address brings its control back', async () => {
      const h = await open('/my-matters', undefined, undefined, [
        matter(5, 2, 'primary'),
        matter(6, 2, 'primary'),
      ]);
      expect(el(h).querySelector('[data-mm-filters]')).toBeNull();
      await TestBed.inject(Router).navigateByUrl('/my-matters?role=secondary');
      await h.fixture.whenStable();
      h.detectChanges();
      expect(el(h).querySelector('#mm-role')).not.toBeNull();
      expect(el(h).querySelector('[data-clear-filters]')).not.toBeNull();
      expect(el(h).querySelector('#mm-client')).toBeNull();
    });

    it('a failed read of the matters hides nothing', async () => {
      const h = await open('/my-matters');
      expect(el(h).querySelector('#mm-client')).not.toBeNull();
      expect(el(h).querySelector('#mm-role')).not.toBeNull();
    });

    it('the Dates control is in the Calendar and never in the filter bar (#906, #929)', async () => {
      const h = await open('/my-matters?view=calendar', undefined, undefined, [
        matter(5, 2, 'primary'),
        matter(6, 3, 'secondary'),
      ]);
      expect(el(h).querySelector('[data-mm-tabpanel] #mm-range')).not.toBeNull();
      expect(el(h).querySelector('[data-mm-filters] #mm-range')).toBeNull();
      expect(el(h).querySelector('[data-panel=calendar] [data-range]')).toBeNull(); // the old 2 / 4 week buttons
      // No grid is drawn behind it: the calendar IS the task area.
      expect(el(h).querySelector('[data-panel=attention], [data-panel=deadlines]')).toBeNull();
    });

    it('everything quiet: one line replaces the empty sections, the matters list stays', async () => {
      const h = await open('/my-matters', undefined, quiet, [
        matter(5, 2, 'primary'),
        matter(6, 2, 'primary'),
      ]);
      expect(el(h).querySelector('[data-all-quiet]')!.textContent).toContain(
        'Nothing is late and nothing is due in the next 7 days.',
      );
      for (const key of ['attention', 'deadlines']) {
        expect(el(h).querySelector(`[data-panel=${key}]`)!.closest('.mm__off'), key).not.toBeNull();
      }
      expect(el(h).querySelector('[data-panel=health]')!.closest('.mm__off')).toBeNull();
    });

    it('an empty list is one line with no toolbar when the others have work', async () => {
      const h = await open(
        '/my-matters',
        undefined,
        (a) => {
          quiet(a);
          tq.mockImplementation((...args: unknown[]) =>
            tqCall(args)['needsAttention'] ? of(queuePage([queueRow(1)], 1)) : of(queuePage([], 0)),
          );
        },
        [matter(5, 2, 'primary')],
      );
      expect(el(h).querySelector('[data-all-quiet]')).toBeNull();
      const deadlines = el(h).querySelector('[data-panel=deadlines]')!;
      expect(deadlines.textContent).toContain('Nothing is due in the next 7 days.');
      expect(deadlines.querySelector('button, select, a')).toBeNull();
      expect(deadlines.querySelector('.mmp--bare')).not.toBeNull();
    });

    it('a manager with no matter: only the Matter health message, no strip of zeros, one Clear filters at most', async () => {
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
        '/my-matters?role=primary',
        undefined,
        (a) => {
          quiet(a);
          a['getMyMattersSummary'].mockReturnValue(of(zero));
          a['getMyMattersHealth'].mockReturnValue(of(health([])));
        },
        [],
      );
      expect(el(h).querySelector('[data-mm-strip]')).toBeNull();
      expect(el(h).querySelector('[data-all-quiet]')).toBeNull();
      expect(el(h).querySelector('[data-empty-kind=filtered]')!.textContent).toContain(
        'No matters match these filters.',
      );
      expect(el(h).querySelectorAll('[data-clear-filters]').length).toBe(1);
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
    it('one column: Needs my attention, Next 7 days, Matters, in that order (the "since" line is on the Activity tab), with no two-column grid (#903)', async () => {
      const h = await open('/my-matters');
      const order = Array.from(el(h).querySelectorAll('[data-panel]')).map((p) =>
        p.getAttribute('data-panel'),
      );
      expect(order).toEqual(['attention', 'deadlines', 'health']);
      expect(el(h).querySelector('.mm__grid')).toBeNull();
      expect(el(h).querySelector('.mm__stack')).not.toBeNull();
      // The sections are flat (no card around each of them).
      for (const key of ['attention', 'deadlines', 'health']) {
        expect(
          el(h).querySelector(`[data-panel=${key}] .mmp`)!.classList.contains('mmp--flat'),
          key,
        ).toBe(true);
      }
    });

    it('Needs my attention has two controls of its own besides the grid: the Calendar button and Options with Export inside; no Views, Task types or Sort menu (#894, #907, #929)', async () => {
      const h = await open('/my-matters');
      const panel = el(h).querySelector('[data-panel=attention]')!;
      const options = panel.querySelectorAll('mf-options-menu');
      expect(options).toHaveLength(1);
      expect(options[0].querySelector('[data-options-trigger]')!.getAttribute('aria-label')).toBe(
        'Options for Needs my attention',
      );
      expect(options[0].querySelectorAll('[data-export]').length).toBe(2);
      expect(
        panel.querySelector('[data-views], [data-types-trigger], [data-sort], [data-dir]'),
      ).toBeNull();
      // Besides the grid, the Calendar button, the Urgency order (#935), the "View all" link and the Options button, nothing is a control of the section.
      const controls = Array.from(
        panel.querySelectorAll('a, button, select, input, summary'),
      ).filter((c) => !c.closest('mf-options-menu') && !c.closest('mf-task-table'));
      expect(
        controls.map(
          (c) =>
            c.getAttribute('data-calendar-toggle') ??
            c.getAttribute('data-sort-urgency') ??
            c.getAttribute('data-view-all'),
        ),
      ).toEqual(['', '', '']);
    });

    it('the matter is a column only for a person with several matters (#897, #929)', async () => {
      const one = await open('/my-matters', undefined, undefined, [matter(5, 2)]);
      expect(el(one).querySelector('[data-panel=attention] th[data-col=matterName]')).toBeNull();
      expect(el(one).querySelector('[data-panel=attention] tbody tr[data-task]')).not.toBeNull();
    });

    it('with several matters the Matter name is a column of both grids (#897, #929)', async () => {
      const h = await open('/my-matters', undefined, undefined, [matter(5, 2), matter(6, 2)]);
      for (const key of ['attention', 'deadlines']) {
        expect(
          el(h).querySelector(`[data-panel=${key}] th[data-col=matterName]`),
          key,
        ).not.toBeNull();
      }
      expect(
        Array.from(el(h).querySelectorAll('[data-panel=attention] td[data-col=matterName]')).map(
          (n) => n.textContent!.trim(),
        ),
      ).toEqual(['Merger', 'Merger']);
    });

    it('the Focus is the one task type filter of both grids (#907, #929)', async () => {
      const h = await open('/my-matters');
      TestBed.inject(MyMattersFocus).set([7, 9]);
      await h.fixture.whenStable();
      h.detectChanges();
      await h.fixture.whenStable();
      const last = (key: string) => tqCall(tq.mock.calls.filter((c) => tqCall(c)[key]).at(-1)!);
      expect(last('needsAttention')['type']).toEqual([7, 9]);
      expect(last('dueWithin')['type']).toEqual([7, 9]);
    });

    it('with a Focus that hides everything, the grid says so and offers Clear Focus', async () => {
      const h = await open('/my-matters', undefined, () =>
        tq.mockImplementation((...args: unknown[]) =>
          tqCall(args)['type'] ? of(queuePage([], 0)) : defaultQueue(args),
        ),
      );
      TestBed.inject(MyMattersFocus).set([7]);
      await h.fixture.whenStable();
      h.detectChanges();
      await h.fixture.whenStable();
      h.detectChanges();
      const panel = el(h).querySelector('[data-panel=attention]')!;
      expect(panel.querySelector('[data-filtered-empty]')!.textContent).toContain(
        'Nothing in your Focus needs your attention.',
      );
      expect(panel.querySelector('[data-show-all]')).not.toBeNull();
    });
  });
});
