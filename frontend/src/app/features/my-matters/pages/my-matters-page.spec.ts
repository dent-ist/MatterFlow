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
} from '../../../api/generated/api-client';
import { FakeMeApi, profileOf, provideFakeMe } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import { AuthStore } from '../../../core/auth/auth.store';
import { CreateTaskContext } from '../../../shared/layout/create-task-context';
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

/** The ranked Needs my attention answer (issue #905): one list, total counts each task once. */
function attention(
  items: object[] = [task(1), task(2, { factCode: 'NO_ASSIGNEE', factDays: undefined })],
  total = 25,
) {
  return {
    timeZone: 'x',
    asOfUtc: 'x',
    stuckOnHoldDays: 7,
    total,
    query:
      'managedByMe=true&status=NEW&status=IN_PROGRESS&status=ON_HOLD&needsAttention=true&sort=due',
    items,
  };
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
  const type = (id: number, name: string, open: number, overdue: number, avg: number | null) => ({
    taskTypeId: id,
    name,
    iconKey: 'file-text',
    colourKey: null,
    targetDays: 5,
    open,
    overdue,
    onHold: 1,
    atRisk: 2,
    avgDaysDone: avg,
    doneCount: avg === null ? 0 : 12,
    query: `managedByMe=true&type=${id}&status=NEW`,
    overdueQuery: `managedByMe=true&type=${id}&overdue=true`,
  });
  return {
    timeZone: 'America/New_York',
    asOfUtc: '2026-10-23T12:00:00Z',
    view,
    status: 'open',
    types: [
      type(1, 'Production', 7, 2, 4.2),
      type(2, 'Review', 3, 0, 6.5),
      type(3, 'Intake', 1, 0, null),
    ],
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
    avgWindowDays: 90,
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
      getMyMattersAttention: vi.fn().mockReturnValue(of(attention())),
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
    configure?.(api);
    TestBed.configureTestingModule({
      providers: [
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

  it('shows five chips that are buttons opening the lists they count, then a muted open count (#902)', async () => {
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
    // The accessible name carries the count; the oldest hold is said with the on-hold chip (never before the count, #821).
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
      '9 overdue',
      '5 at risk',
      '6 unassigned',
      '3 on hold, oldest 12 days',
      '41 due in 7 days',
      '212 open tasks',
    ]);
    expect(chips[0].textContent?.replace(/\s+/g, ' ').trim()).toBe('9 overdue');
    expect(chips[0].classList.contains('ms__chip--danger')).toBe(true);
    expect(chips[1].classList.contains('ms__chip--warning')).toBe(true);
    // "Matters I manage" and "Due in 3 days" are gone.
    expect(el(h).querySelector('[data-strip-item=matters], [data-strip-item=due3]')).toBeNull();
    expect(el(h).querySelector('[data-strip-open]')!.textContent).toContain(
      '212 open on 14 matters',
    );
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

  it('mutes a chip that counts nothing and keeps it reachable; only Overdue and At risk are loud, and only above zero', async () => {
    const h = await open('/my-matters', undefined, (a) => {
      a['getMyMattersSummary'].mockReturnValue(
        of({
          ...summary(),
          overdue: count(0, 'managedByMe=true&overdue=true'),
          atRisk: count(0, 'q'),
        }),
      );
    });
    const chip = (key: string) =>
      el(h).querySelector<HTMLButtonElement>(`button[data-strip-item=${key}]`)!;
    expect(chip('overdue').classList.contains('ms__chip--zero')).toBe(true);
    expect(chip('overdue').classList.contains('ms__chip--danger')).toBe(false);
    expect(chip('overdue').disabled).toBe(false);
    expect(chip('atRisk').classList.contains('ms__chip--warning')).toBe(false);
    expect(chip('unassigned').classList.contains('ms__chip--zero')).toBe(false);
  });

  it('sends no date range to the strip and the other panels; Next 7 days asks for today to seven days ahead, whatever the range (#896)', async () => {
    await open('/my-matters?range=2w');
    expect(api['getMyMattersSummary']).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    const day = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/);
    expect(api['getMyMattersDeadlines']).toHaveBeenCalledWith(
      14,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      day,
      day,
      undefined,
    );
    const [, , , , , , , , from, to] = api['getMyMattersDeadlines'].mock.calls[0];
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBe(7);
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

  it('shows Needs my attention as ONE ranked list: a reason on every row, one View all N, no group headings (#905)', async () => {
    const h = await open('/my-matters');
    expect(el(h).querySelector('[data-group], [data-repeated], [data-also-tag]')).toBeNull();
    const rows = Array.from(el(h).querySelectorAll('[data-attention-item]'));
    expect(rows).toHaveLength(2);
    const row1 = el(h).querySelector<HTMLAnchorElement>('[data-attention-row]')!;
    expect(row1.getAttribute('href')).toBe('/tasks/1?from=my-matters');
    // The link keeps the task, the matter and the reason in its name.
    expect(row1.getAttribute('aria-label')).toBe(
      'TSK-1 Task 1, 90001-80001 Merger, No assignee, 3 d overdue',
    );
    // Two right-hand columns (issue #901): who, then when. An unassigned task's reason is "No assignee" in the who column, its time text is its due day.
    expect(rows.map((r) => r.querySelector('[data-row-who]')!.textContent!.trim())).toEqual([
      'No assignee',
      'No assignee',
    ]);
    expect(rows.map((r) => r.querySelector('[data-fact]')!.textContent!.trim())).toEqual([
      '3 d overdue',
      'due Mon Oct 26',
    ]);
    const all = el(h).querySelectorAll<HTMLAnchorElement>('[data-panel=attention] [data-view-all]');
    expect(all).toHaveLength(1);
    expect(all[0].textContent!.trim()).toBe('View all 25');
    expect(all[0].getAttribute('href')).toBe(
      '/tasks?managedByMe=true&status=NEW&status=IN_PROGRESS&status=ON_HOLD&needsAttention=true&sort=due',
    );
    // Not a sort, not a group: the ranking is the server's.
    expect(el(h).querySelector('[data-panel=attention] [data-sort]')).toBeNull();
    expect(api['getMyMattersAttention']).toHaveBeenCalledWith(
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

  it('At risk is a row with its own reason, and an at-risk task due today still shows the At risk pill', async () => {
    const h = await open('/my-matters', undefined, (a) => {
      a['getMyMattersAttention'].mockReturnValue(
        of(
          attention(
            [
              task(1, { factCode: 'AT_RISK', factDays: undefined, atRisk: true }),
              task(2, { factCode: 'DUE_TODAY', factDays: 0, atRisk: true }),
              task(3, {
                factCode: 'ON_HOLD_DAYS',
                factDays: 12,
                onHold: { reasonName: 'Waiting', days: 12 },
              }),
            ],
            3,
          ),
        ),
      );
    });
    const rows = Array.from(el(h).querySelectorAll('[data-attention-item]'));
    expect(rows.map((r) => r.getAttribute('data-reason'))).toEqual([
      'atRisk',
      'dueToday',
      'onHold',
    ]);
    expect(rows.map((r) => r.querySelector('[data-fact]')!.textContent!.trim())).toEqual([
      'at risk',
      'due today',
      'on hold 12 d',
    ]);
    expect(rows[0].querySelector('[data-at-risk]')).toBeNull(); // the reason says it already
    expect(rows[1].querySelector('[data-at-risk]')).not.toBeNull();
    // The reason of a hold is the tooltip of the one status text, not a second piece of text on the row (issue #897).
    expect(rows[2].querySelector('[data-fact]')!.getAttribute('title')).toBe('Waiting');
    expect(rows[2].querySelector('[data-hold-pill]')).toBeNull(); // the status says it already
  });

  it('leaves a task out of Next 7 days when Needs my attention lists it: one task, once per screen (#905)', async () => {
    const h = await open('/my-matters', undefined, (a) => {
      a['getMyMattersAttention'].mockReturnValue(
        of(attention([task(3, { factCode: 'DUE_TODAY', factDays: 0 })], 1)),
      );
    });
    const ids = Array.from(el(h).querySelectorAll('a[href^="/tasks/"]')).map((a) =>
      a.getAttribute('href'),
    );
    expect(ids.filter((x) => x === '/tasks/3?from=my-matters')).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      el(h).querySelector('[data-panel=deadlines] [data-deadline-row]')!.getAttribute('href'),
    ).toBe('/tasks/4?from=my-matters');
  });

  it('says so when nothing needs attention, with no manager-related item', async () => {
    const h = await open('/my-matters');
    api['getMyMattersAttention'].mockReturnValue(of(attention([], 0)));
    TestBed.inject(Router).navigateByUrl('/my-matters?role=primary');
    await h.fixture.whenStable();
    h.detectChanges();
    expect(el(h).querySelector('[data-panel=attention] [data-empty]')!.textContent).toContain(
      'Nothing needs your attention.',
    );
    expect(el(h).textContent).not.toMatch(/no (project )?manager/i);
  });

  it('Next 7 days is a short flat list with who and the due day on the right and no controls of its own; All deadlines opens the Deadlines tab (#896, #894, #901)', async () => {
    const h = await open('/my-matters');
    const panel = el(h).querySelector('[data-panel=deadlines]')!;
    expect(panel.querySelector('h2')!.textContent).toBe('Next 7 days');
    // The same two right-hand columns as Needs my attention (issue #901): who, then when (here the due day).
    expect(
      Array.from(panel.querySelectorAll('[data-fact]')).map((d) => d.textContent!.trim()),
    ).toEqual(['Mon Oct 26', 'Tue Oct 27']);
    expect(panel.querySelectorAll('[data-row-who]')).toHaveLength(2);
    expect(panel.querySelector('[data-day]')).toBeNull(); // no day headings
    // No 2 / 4 week buttons, no Views, no Sort, no Task types, no Options: the Deadlines tab owns the range and Focus is the one type filter.
    expect(panel.querySelector('[data-range], select, details, button')).toBeNull();
    const all = panel.querySelector<HTMLAnchorElement>('[data-view-all]')!;
    expect(all.textContent).toContain('All deadlines');
    expect(all.getAttribute('href')).toBe('/my-matters?tab=deadlines');
  });

  it('Next 7 days shows at most five rows and says how many there are in all', async () => {
    const h = await open('/my-matters', undefined, (a) => {
      a['getMyMattersAttention'].mockReturnValue(of(attention([], 0)));
      a['getMyMattersDeadlines'].mockReturnValue(
        of({
          timeZone: 'x',
          asOfUtc: 'x',
          days: 14,
          fromDate: '2026-10-23',
          toDate: '2026-10-30',
          total: 8,
          query: 'q',
          items: [10, 11, 12, 13, 14, 15, 16, 17].map((id) => task(id, { dueDate: '2026-10-26' })),
        }),
      );
    });
    const panel = el(h).querySelector('[data-panel=deadlines]')!;
    expect(panel.querySelectorAll('[data-deadline-row]')).toHaveLength(5);
    expect(panel.querySelector('[data-view-all]')!.textContent).toContain('All deadlines (8)');
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
    api['getMyMattersAttention'].mockReturnValue(throwError(() => new Error('boom')));
    await TestBed.inject(Router).navigateByUrl('/my-matters?role=primary');
    await h.fixture.whenStable();
    h.detectChanges();
    expect(el(h).querySelector('[data-panel=attention] [data-panel-error]')).not.toBeNull();
    expect(el(h).querySelector('[data-panel=health] [data-health-list]')).not.toBeNull();
    api['getMyMattersAttention'].mockClear();
    api['getMyMattersAttention'].mockReturnValue(of(attention()));
    el(h).querySelector<HTMLButtonElement>('[data-panel=attention] [data-panel-retry]')!.click();
    await h.fixture.whenStable();
    h.detectChanges();
    expect(api['getMyMattersAttention']).toHaveBeenCalledTimes(1);
    expect(el(h).querySelector('[data-panel=attention] [data-attention-list]')).not.toBeNull();
  });

  it('two or more failed calls: ONE banner and ONE Retry for the page, a muted "not loaded" line in each section; Retry asks every failed call again (#921)', async () => {
    const h = await open('/my-matters');
    for (const name of ['getMyMattersAttention', 'getMyMattersDeadlines', 'getMyMattersSummary'])
      api[name].mockReturnValue(throwError(() => new Error('boom')));
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
    for (const name of ['getMyMattersAttention', 'getMyMattersDeadlines', 'getMyMattersSummary']) {
      api[name].mockClear();
      api[name].mockReturnValue(
        of(
          name === 'getMyMattersSummary'
            ? summary()
            : name === 'getMyMattersAttention'
              ? attention()
              : { items: [], total: 0, query: '' },
        ),
      );
    }
    api['getMyMattersHealth'].mockClear();
    el(h).querySelector<HTMLButtonElement>('[data-page-retry]')!.click();
    await h.fixture.whenStable();
    h.detectChanges();
    expect(api['getMyMattersAttention']).toHaveBeenCalledTimes(1);
    expect(api['getMyMattersDeadlines']).toHaveBeenCalledTimes(1);
    expect(api['getMyMattersSummary']).toHaveBeenCalledTimes(1);
    expect(api['getMyMattersHealth']).not.toHaveBeenCalled();
    expect(el(h).querySelector('[data-page-error]')).toBeNull();
  });

  it('a panel that is still loading has no toolbar: its Options and View all appear with the data (#921)', async () => {
    const h = await open('/my-matters', undefined, (a) =>
      a['getMyMattersAttention'].mockReturnValue(NEVER),
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
    api['getMyMattersAttention'].mockReturnValue(NEVER);
    await TestBed.inject(Router).navigateByUrl('/my-matters?role=secondary');
    await h.fixture.whenStable();
    h.detectChanges();
    expect(el(h).querySelector('[data-panel=attention] [data-loading]')).toBeNull(); // keeps the previous numbers
    expect(el(h).querySelector('[data-panel=health] [data-health-list]')).not.toBeNull();
  });

  describe('tabs (epic #758, PX-18)', () => {
    const tabs = (h: { fixture: { nativeElement: unknown } }) =>
      Array.from(el(h).querySelectorAll<HTMLElement>('[role=tab]')).map((t) =>
        t.textContent!.trim(),
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
      expect(tabs(h)).toEqual(['Overview', 'Deadlines', 'Breakdown', 'Data', 'Activity', 'Trends']);
    });

    it('has no Data tab without Asset.View, and its address opens Overview', async () => {
      const h = await open('/my-matters?tab=data');
      expect(tabs(h)).not.toContain('Data');
      expect(el(h).querySelector('[role=tab][aria-selected=true]')!.textContent).toContain(
        'Overview',
      );
    });

    it('has the four tabs, Overview selected, and the page as it was under it', async () => {
      const h = await open('/my-matters');
      expect(tabs(h)).toEqual(['Overview', 'Deadlines', 'Breakdown', 'Activity', 'Trends']);
      expect(el(h).querySelector('[role=tab][aria-selected=true]')!.textContent).toContain(
        'Overview',
      );
      const panel = el(h).querySelector('[role=tabpanel]')!;
      expect(panel.getAttribute('aria-labelledby')).toBe('mm-tab-overview');
      expect(panel.querySelector('[data-panel=since]')).not.toBeNull();
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

    it('the Breakdown tab switches to all matters: per type counts and the average turnaround against the target (PV-27)', async () => {
      const h = await open('/my-matters?tab=breakdown&bview=types');
      const root = el(h).querySelector('[data-panel=breakdown]')!;
      expect(api['getMyMattersBreakdown'].mock.calls[0][0]).toBe('types');
      const rows = Array.from(root.querySelectorAll('[data-bd-type]'));
      expect(rows).toHaveLength(3);
      expect(rows[0].querySelector('[data-bd-turnaround]')!.textContent).toContain(
        '4.2 d average, 5 d target: within target (12 done)',
      );
      expect(rows[1].querySelector('[data-bd-turnaround]')!.textContent).toContain('over target');
      expect(rows[2].querySelector('[data-bd-turnaround]')!.textContent).toContain(
        'No tasks completed in the last 90 days',
      );
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

  describe('What changed: one line (epic #893, issues #909 and #895)', () => {
    it('is one line of the four counts that need a decision, each a link, and Mark as read at its end', async () => {
      const h = await open('/my-matters');
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
      // No event is listed on the Overview, and opening the page never moves the marker.
      expect(line.querySelector('[data-since-item], [data-since-toggle]')).toBeNull();
      expect(api['markMyMattersActivitySeen']).not.toHaveBeenCalled();
    });

    it('says the last 7 days when there is no marker yet', async () => {
      const h = await open('/my-matters', undefined, (a) =>
        a['getMyMattersSinceLastVisit'].mockReturnValue(of({ ...since(), hasMarker: false })),
      );
      expect(el(h).querySelector('[data-since-period]')!.textContent).toContain(
        'In the last 7 days:',
      );
    });

    it('draws nothing when none of the four changed, even if comments and reassignments did', async () => {
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
      expect(el(h).querySelector('[data-panel=since]')).toBeNull();
      expect(el(h).querySelector('[data-mark-read]')).toBeNull();
      expect(el(h).querySelector('mf-mm-since')!.textContent!.trim()).toBe('');
    });

    it('Mark as read moves the marker once, says so, and the line goes away', async () => {
      const h = await open('/my-matters');
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
      a['getMyMattersAttention'].mockReturnValue(of(attention([], 0)));
      a['getMyMattersDeadlines'].mockReturnValue(
        of({
          timeZone: 'x',
          asOfUtc: 'x',
          days: 28,
          fromDate: 'a',
          toDate: 'b',
          total: 0,
          query: '',
          items: [],
        }),
      );
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

    it('several clients and both roles: Client and Role are offered, the create menu is the small "Task on a matter"', async () => {
      const h = await open('/my-matters', undefined, undefined, [
        matter(5, 2, 'primary'),
        matter(6, 3, 'secondary'),
      ]);
      expect(el(h).querySelector('[data-mm-filters]')).not.toBeNull();
      expect(el(h).querySelector('#mm-client')).not.toBeNull();
      expect(el(h).querySelector('#mm-role')).not.toBeNull();
      expect(el(h).querySelector('[data-header-new-task]')!.textContent).toContain(
        'Task on a matter',
      );
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

    it('the Dates control is in the Deadlines tab and never in the filter bar', async () => {
      const h = await open(
        '/my-matters?tab=deadlines',
        undefined,
        (a) =>
          a['getMyMattersDeadlines'].mockReturnValue(
            of({
              timeZone: 'x',
              asOfUtc: 'x',
              days: 28,
              fromDate: '2026-10-23',
              toDate: '2026-11-20',
              total: 1,
              matterTotal: 1,
              query: 'q',
              items: [],
              byMatter: [
                {
                  matterId: 5,
                  matterRef: '90001-80001',
                  matterName: 'Merger',
                  clientName: 'Acme',
                  total: 1,
                  nextDueDate: '2026-10-30',
                  items: [task(3)],
                  query: 'matter=5',
                },
              ],
            }),
          ),
        [matter(5, 2, 'primary'), matter(6, 3, 'secondary')],
      );
      const panel = el(h).querySelector('[data-panel=deadlines-tab]')!;
      expect(el(h).querySelector('[data-mm-tabpanel] #mm-range')).not.toBeNull();
      expect(el(h).querySelector('[data-mm-filters] #mm-range')).toBeNull();
      expect(panel.querySelector('[data-range]')).toBeNull(); // the old 2 / 4 week buttons
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
          a['getMyMattersAttention'].mockReturnValue(of(attention([task(1)], 1)));
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
    const rich = (id: number, over: object = {}) =>
      task(id, {
        taskTypeId: 1,
        taskTypeName: 'Review',
        taskTypeIconKey: 'file-text',
        taskTypeColourKey: 'green',
        priorityName: 'Normal',
        priorityRank: 3,
        statusCode: 'NEW',
        ...over,
      });

    it('one column: since, Needs my attention, Next 7 days, Matters, in that order, with no two-column grid (#903)', async () => {
      const h = await open('/my-matters');
      const order = Array.from(el(h).querySelectorAll('[data-panel]')).map((p) =>
        p.getAttribute('data-panel'),
      );
      expect(order).toEqual(['since', 'attention', 'deadlines', 'health']);
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

    it('Needs my attention has one control of its own, Options, with Export inside; no Views, Task types or Sort (#894, #907)', async () => {
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
      // Besides the rows, the "View all" link and the Options button, nothing is a control of the list.
      const controls = Array.from(
        panel.querySelectorAll('a, button, select, input, summary'),
      ).filter((c) => !c.closest('mf-options-menu') && !c.closest('[mfMmTaskRow]'));
      expect(controls.map((c) => c.getAttribute('data-view-all'))).toEqual(['']);
    });

    it('the matter name is not on a row for one matter (#897)', async () => {
      const h = await open('/my-matters', undefined, undefined, [matter(5, 2)]);
      expect(el(h).querySelector('[data-attention-item]')).not.toBeNull();
      expect(el(h).querySelector('[data-row-matter]')).toBeNull();
    });

    it('the matter name follows the title as short text when the person has several matters (#897)', async () => {
      const h = await open('/my-matters', undefined, undefined, [matter(5, 2), matter(6, 2)]);
      const names = Array.from(
        el(h).querySelectorAll('[data-attention-item] [data-row-matter]'),
      ).map((n) => n.textContent!.trim());
      expect(names).toEqual(['Merger', 'Merger']);
    });

    it('a priority pill only for High and Critical; the link keeps the matter, priority and status for a screen reader (#897)', async () => {
      const h = await open('/my-matters', undefined, (a) => {
        a['getMyMattersAttention'].mockReturnValue(
          of(
            attention(
              [
                rich(1, { priorityName: 'Critical', priorityRank: 1 }),
                rich(2, { priorityName: 'High', priorityRank: 2 }),
                rich(3, { priorityName: 'Normal', priorityRank: 3 }),
                rich(4, { priorityName: 'Low', priorityRank: 4 }),
              ],
              4,
            ),
          ),
        );
      });
      const rows = Array.from(el(h).querySelectorAll('[data-attention-item]'));
      expect(
        rows.map((r) => r.querySelector('[data-priority]')?.textContent?.trim() ?? null),
      ).toEqual(['Critical', 'High', null, null]);
      const link = rows[2].querySelector('a[data-attention-row]')!;
      expect(link.textContent!.trim()).toBe('TSK-3 Task 3');
      expect(link.getAttribute('aria-label')).toBe(
        'TSK-3 Task 3, 90001-80001 Merger, Normal priority, No assignee, 3 d overdue',
      );
    });

    it('the type icon is the large coloured badge, one status text sits on the right, an At risk or On hold task gets its pill (#897)', async () => {
      const h = await open('/my-matters', undefined, (a) => {
        a['getMyMattersAttention'].mockReturnValue(
          of(
            attention(
              [
                rich(1, { atRisk: true }),
                rich(2, { statusCode: 'ON_HOLD', onHold: { reasonName: 'Waiting', days: 2 } }),
              ],
              2,
            ),
          ),
        );
      });
      const rows = Array.from(el(h).querySelectorAll('[data-attention-item]'));
      expect(rows[0].querySelector('mf-task-type-badge.tt--large')).not.toBeNull();
      expect(rows[0].querySelector('[data-at-risk]')).not.toBeNull();
      expect(rows[1].querySelector('[data-hold-pill]')).not.toBeNull();
      for (const r of rows) expect(r.querySelectorAll('[data-fact]')).toHaveLength(1);
    });
  });
});
