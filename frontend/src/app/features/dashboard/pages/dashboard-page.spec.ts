import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { RouterTestingHarness } from '@angular/router/testing';
import { NEVER, of, throwError } from 'rxjs';
import {
  DashboardClient,
  DashboardSummary,
  PodsClient,
  TaskQueueClient,
  TasksClient,
  UsersLookupClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { aRow, pageOf, provideLookups } from '../../../shared/work-queue/work-queue-testing';
import { AUTO_REFRESH_MS, DashboardPage } from './dashboard-page';

const OPEN = 'status=NEW&status=IN_PROGRESS&status=ON_HOLD';
const count = (n: number, query: string) => ({ count: n, query });

function summary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    period: { days: 30, from: '2026-09-15', to: '2026-10-14' },
    timeZone: 'UTC',
    generatedAtUtc: '2026-10-14T15:42:00Z',
    open: count(128, OPEN),
    unassigned: count(17, `${OPEN}&unassigned=true`),
    overdue: count(9, `${OPEN}&overdue=true`),
    onHold: count(12, 'status=ON_HOLD'),
    dueSoon: count(6, `${OPEN}&asap=false&overdue=false&dueTo=2026-10-16`),
    asapOpen: count(4, `${OPEN}&asap=true`),
    completed: count(94, 'status=COMPLETED&completedFrom=2026-09-15'),
    created: count(101, 'createdFrom=2026-09-15'),
    byPod: [
      { label: 'Pod A', count: 40, id: 1, code: undefined, query: `${OPEN}&pod=1`, isOther: false },
      {
        label: 'No Pod',
        count: 17,
        id: undefined,
        code: undefined,
        query: undefined,
        isOther: false,
      },
    ],
    byTaskType: [
      {
        label: 'Data Processing',
        count: 50,
        id: 3,
        code: undefined,
        query: `${OPEN}&type=3`,
        isOther: false,
      },
      {
        label: 'Other Task Types',
        count: 7,
        id: undefined,
        code: undefined,
        query: undefined,
        isOther: true,
      },
    ],
    byPriority: [
      {
        label: 'Critical',
        count: 6,
        id: 1,
        code: undefined,
        query: `${OPEN}&priority=1`,
        isOther: false,
      },
    ],
    byStatus: [
      { label: 'New', count: 80, id: undefined, code: 'NEW', query: 'status=NEW', isOther: false },
    ],
    aging: [
      {
        key: '0-2',
        label: '0-2 days',
        minDays: 0,
        maxDays: 2,
        count: 30,
        query: `${OPEN}&createdFrom=2026-10-12&createdTo=2026-10-14`,
      },
      {
        key: '15+',
        label: '15+ days',
        minDays: 15,
        maxDays: undefined,
        count: 10,
        query: `${OPEN}&createdTo=2026-09-29`,
      },
    ],
    trend: [
      { date: '2026-10-12', created: 4, completed: 2 },
      { date: '2026-10-13', created: 0, completed: 3 },
      { date: '2026-10-14', created: 5, completed: 1 },
    ],
    recentlyCreated: [
      {
        taskId: 5,
        taskNumber: 'TSK-1005',
        title: 'Process custodians',
        matterId: 1,
        matterRef: '00343-00012',
        matterName: 'Merger',
        status: 'NEW',
        statusLabel: 'New',
        atUtc: '2026-10-14T12:00:00Z',
      },
    ],
    recentlyCompleted: [
      {
        taskId: 4,
        taskNumber: 'TSK-1004',
        title: 'Deliver production',
        matterId: 1,
        matterRef: '00343-00012',
        matterName: 'Merger',
        status: 'COMPLETED',
        statusLabel: 'Completed',
        atUtc: '2026-10-13T12:00:00Z',
      },
    ],
    mine: {
      open: count(3, `${OPEN}&assignee=9`),
      overdue: count(1, `${OPEN}&assignee=9&overdue=true`),
      dueSoon: count(2, `${OPEN}&assignee=9&asap=false&overdue=false&dueTo=2026-10-16`),
      createdByMe: count(5, 'creator=9&createdFrom=2026-09-15'),
    },
    ...overrides,
  };
}

const unassignedRow = aRow({
  taskId: 21,
  taskNumber: 'TSK-21',
  title: 'Unassigned intake',
  assignedUser: undefined,
  status: 'NEW',
  statusLabel: 'New',
  createdAtUtc: '2026-10-04T12:00:00Z',
});
const overdueRow = aRow({
  taskId: 22,
  taskNumber: 'TSK-22',
  title: 'Overdue review',
  dueDate: '2026-10-10',
  dueAtUtc: undefined,
  isAsap: false,
  isOverdue: true,
});
const soonRow = aRow({
  taskId: 23,
  taskNumber: 'TSK-23',
  title: 'Soon production',
  dueDate: '2026-10-15',
  dueAtUtc: undefined,
  isAsap: false,
});

const ALL: Permission[] = [
  'Task.View',
  'Dashboard.ViewDepartment',
  'Task.Create',
  'Task.Assign',
  'Pod.View',
];

describe('DashboardPage', () => {
  let getDashboard: ReturnType<typeof vi.fn>;
  let getTaskQueue: ReturnType<typeof vi.fn>;
  let assignTask: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;

  async function open(response: unknown = of(summary()), permissions: Permission[] = ALL) {
    getDashboard = vi.fn().mockReturnValue(response);
    getTaskQueue = vi.fn((...args: unknown[]) =>
      of(
        args[5] === true
          ? pageOf([unassignedRow], { total: 17 })
          : args[17] === true
            ? pageOf([overdueRow], { total: 9 })
            : pageOf([soonRow], { total: 6 }),
      ),
    );
    assignTask = vi.fn().mockReturnValue(
      of({
        ...aRow({ taskId: 21 }),
        priority: unassignedRow.priority,
        assignedUser: { userId: 1, displayName: 'Test User', isActive: true },
        assignedPod: unassignedRow.assignedPod,
        status: 'IN_PROGRESS',
        statusLabel: 'In Progress',
        isAsap: true,
        isOverdue: false,
        rowVersion: 'BBBB',
        modifiedAtUtc: undefined,
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'dashboard', component: DashboardPage }]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: DashboardClient, useValue: { getDashboard } },
        { provide: TaskQueueClient, useValue: { getTaskQueue } },
        { provide: TasksClient, useValue: { assignTask } },
        { provide: PodsClient, useValue: {} },
        { provide: UsersLookupClient, useValue: { lookupUsers: () => of([]) } },
        MessageService,
        ...provideLookups(),
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
        { provide: Clock, useValue: { now: () => new Date('2026-10-14T15:45:00Z') } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard', DashboardPage);
    await settle();
    return harness.routeNativeElement as HTMLElement;
  }

  async function settle() {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      harness.detectChanges();
    }
  }

  const hrefs = (el: HTMLElement, selector: string) =>
    Array.from(el.querySelectorAll<HTMLAnchorElement>(selector)).map((a) => a.getAttribute('href'));
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  afterEach(() => vi.restoreAllMocks());

  it('puts Needs attention first: overdue, unassigned, on hold and ASAP, each with a count, an icon and a link that says what it opens', async () => {
    const el = await open();
    expect(getDashboard).toHaveBeenCalledWith(30, undefined);

    const group = el.querySelector('[data-group="attention"]')!;
    expect(text(group.querySelector('h3'))).toBe('Needs attention');
    const tiles = Array.from(group.querySelectorAll<HTMLElement>('mf-stat-tile'));
    expect(tiles.map((t) => text(t.querySelector('.label')))).toEqual([
      'Overdue',
      'Unassigned',
      'On hold',
      'ASAP open',
    ]);
    expect(tiles.map((t) => text(t.querySelector('.value')))).toEqual(['9', '17', '12', '4']);
    expect(tiles.map((t) => text(t.querySelector('.go')))).toEqual([
      'View overdue tasks',
      'View unassigned tasks',
      'View tasks on hold',
      'View ASAP tasks',
    ]);
    // An icon next to every label, so the tone is never the only signal.
    for (const t of tiles) expect(t.querySelector('.label .pi')).not.toBeNull();
    expect(tiles[1].querySelector('a')!.getAttribute('href')).toBe(
      '/tasks?status=NEW&status=IN_PROGRESS&status=ON_HOLD&unassigned=true',
    );
    expect(tiles[0].textContent).toContain('Excludes ASAP tasks');
  });

  it('shows the quieter overview row: open, due soon, completed and created, with the period on the last two', async () => {
    const el = await open();
    const tiles = Array.from(
      el.querySelectorAll<HTMLElement>('[data-group="overview"] mf-stat-tile'),
    );
    expect(tiles.map((t) => text(t.querySelector('.label')))).toEqual([
      'Open',
      'Due soon',
      'Completed',
      'Created',
    ]);
    expect(tiles.map((t) => text(t.querySelector('.value')))).toEqual(['128', '6', '94', '101']);
    expect(tiles[2].textContent).toContain('Last 30 days');
    expect(tiles[3].textContent).toContain('Last 30 days');
    expect(tiles[2].querySelector('a')!.getAttribute('href')).toBe(
      '/tasks?status=COMPLETED&completedFrom=2026-09-15',
    );
    expect(el.querySelector('[data-updated]')!.textContent).toContain(
      'Updated Oct 14, 2026, 3:42 PM',
    );
  });

  it('shows the Your work tiles with links to the queue', async () => {
    const el = await open();
    const mine = el.querySelector('[data-section="mine"]')!;
    expect(mine.textContent).toContain('My open tasks');
    expect(hrefs(el, '[data-section="mine"] mf-stat-tile a')[1]).toBe(
      '/tasks?status=NEW&status=IN_PROGRESS&status=ON_HOLD&assignee=9&overdue=true',
    );
    expect(mine.querySelector('a[href="/my-work"]')).not.toBeNull();
  });

  it('orders the sections by role: department first for managers, only Your work for technicians', async () => {
    let el = await open();
    const names = (host: HTMLElement) =>
      Array.from(host.querySelectorAll('[data-section]')).map((s) =>
        s.getAttribute('data-section'),
      );
    expect(names(el)).toEqual(['department', 'lists', 'mine', 'trend', 'breakdowns', 'recent']);

    TestBed.resetTestingModule();
    el = await open(of(summary()), ['Task.View']);
    expect(names(el)).toEqual(['mine']);
    expect(getTaskQueue).not.toHaveBeenCalled();
  });

  it('lists the oldest unassigned tasks with reference, title, matter, priority, age and the assignee editor', async () => {
    const el = await open();
    const panel = el.querySelector('[data-panel="unassigned"]')!;
    expect(text(panel.querySelector('h3'))).toBe('Unassigned queue');
    expect(text(panel.querySelector('[data-total]'))).toBe('17');
    const row = panel.querySelector('li')!;
    expect(row.querySelector('a.ref')!.getAttribute('href')).toBe('/tasks/21');
    expect(text(row.querySelector('.title'))).toBe('Unassigned intake');
    expect(text(row.querySelector('mf-matter-ref'))).toContain('00343-00012');
    expect(row.querySelector('mf-priority-badge')!.textContent).toContain('Critical');
    expect(text(row.querySelector('[data-age]'))).toBe('10 days old');
    expect(row.querySelector('mf-row-edit [data-inline-trigger]')).not.toBeNull();
    expect(row.querySelector('[data-assign-me]')).not.toBeNull();
    expect(panel.querySelector<HTMLAnchorElement>('[data-view-all]')!.getAttribute('href')).toBe(
      '/tasks?status=NEW&status=IN_PROGRESS&status=ON_HOLD&unassigned=true&sort=created&dir=asc',
    );
    // The list asks the Task Queue for the oldest first, 8 rows.
    const call = getTaskQueue.mock.calls.find((c) => c[5] === true)!;
    expect(call.slice(21)).toEqual(['created', 'asc', 1, 8]);
  });

  it('does not offer assignment to people who may not assign', async () => {
    const el = await open(of(summary()), ['Task.View', 'Dashboard.ViewDepartment']);
    const row = el.querySelector('[data-panel="unassigned"] li')!;
    expect(row.querySelector('mf-row-edit')).toBeNull();
    expect(row.querySelector('[data-assign-me]')).toBeNull();
    expect(text(row.querySelector('.assign'))).toBe('Unassigned');
  });

  it('assigns a task to me from the list, updates the row and reads the counts again', async () => {
    const el = await open();
    el.querySelector<HTMLButtonElement>('[data-assign-me]')!.click();
    await settle();
    expect(assignTask).toHaveBeenCalledWith(21, {
      rowVersion: 'AAAA',
      podId: 5,
      userId: 1,
    });
    const row = el.querySelector('[data-panel="unassigned"] li')!;
    expect(row.textContent).toContain('Test User');
    expect(row.querySelector('[data-assign-me]')).toBeNull();

    await new Promise((r) => setTimeout(r, 900));
    harness.detectChanges();
    expect(getDashboard).toHaveBeenCalledTimes(2);
    expect(getDashboard).toHaveBeenLastCalledWith(30, true);
  });

  it('lists overdue and due-soon tasks with their due dates and "View all" links to the sorted queue', async () => {
    const el = await open();
    const overdue = el.querySelector('[data-panel="overdue"]')!;
    expect(text(overdue.querySelector('[data-due]'))).toContain('Oct 10, 2026');
    expect(text(overdue.querySelector('[data-due]'))).toContain('Overdue 4d');
    expect(overdue.querySelector<HTMLAnchorElement>('[data-view-all]')!.getAttribute('href')).toBe(
      '/tasks?status=NEW&status=IN_PROGRESS&status=ON_HOLD&overdue=true&sort=due&dir=asc',
    );

    const soon = el.querySelector('[data-panel="dueSoon"]')!;
    expect(text(soon.querySelector('[data-due]'))).toContain('Oct 15, 2026');
    expect(
      soon.querySelector<HTMLAnchorElement>('[data-view-all]')!.getAttribute('href'),
    ).toContain('dueTo=2026-10-16&sort=due&dir=asc');
    expect(text(soon.querySelector('[data-total]'))).toBe('6');
  });

  it('shows the lists as calm empty messages, not zero rows', async () => {
    const el = await open();
    getTaskQueue.mockImplementation(() => of(pageOf([], { total: 0 })));
    el.querySelector<HTMLButtonElement>('[data-refresh]')!.click();
    await settle();
    expect(text(el.querySelector('[data-panel="overdue"] [data-empty]'))).toBe(
      'Nothing is overdue.',
    );
    expect(el.querySelector('[data-panel="overdue"] [data-view-all]')).toBeNull();
  });

  it('shows breakdowns with percent, priority order and badge colours, no link where the queue has no filter', async () => {
    const el = await open();
    const bars = el.querySelector('[data-section="breakdowns"]')!;
    expect(bars.textContent).toContain('Open by pod');
    expect(bars.textContent).toContain('Open by priority');
    expect(bars.textContent).toContain('Open by task type');
    expect(bars.textContent).toContain('Open by status');
    const podRows = Array.from(bars.querySelectorAll('mf-bar-list')[0].querySelectorAll('li'));
    expect(
      podRows.map((r) =>
        [
          r.querySelector('.name')?.textContent,
          r.querySelector('.count')?.textContent,
          r.querySelector('.pct')?.textContent,
        ].join(' '),
      ),
    ).toEqual(['Pod A 40 70%', 'No pod 17 30%']);
    expect(podRows[0].querySelector('a')!.getAttribute('href')).toContain('pod=1');
    expect(podRows[1].querySelector('a')).toBeNull();

    const critical = bars.querySelectorAll('mf-bar-list')[1].querySelector<HTMLElement>('.bar')!;
    expect(critical.style.background).toContain('--mf-pr-critical-bg');

    expect(text(bars.querySelector('mf-stacked-bar'))).toContain(
      'Informational, not a service-level target',
    );
    expect(hrefs(el, 'mf-recent-task-list a')).toEqual(['/tasks/5', '/tasks/4']);
    expect(el.textContent).not.toMatch(/billing|revenue|productivity/i);
  });

  it('shows the daily trend with its data table', async () => {
    const el = await open();
    const trend = el.querySelector('[data-section="trend"] mf-trend-chart')!;
    expect(trend.querySelector('svg[role="img"]')).not.toBeNull();
    expect(text(trend.querySelector('[data-legend="created"]'))).toBe('Created 9');
    expect(text(trend.querySelector('[data-legend="completed"]'))).toBe('Completed 6');
    trend.querySelector<HTMLButtonElement>('.toggle')!.click();
    harness.detectChanges();
    expect(trend.querySelectorAll('tbody tr').length).toBe(3);
  });

  it('offers period presets that apply to created and completed only', async () => {
    const el = await open();
    const select = el.querySelector<HTMLSelectElement>('select[data-period]')!;
    expect(Array.from(select.options).map((o) => o.textContent!.trim())).toEqual([
      'This week',
      'This month',
      'Last 30 days',
      'Last quarter',
    ]);
    expect(el.textContent).toContain('Created and completed');

    // 14 Oct 2026 is a Wednesday: the week so far is 3 days, the month 14.
    select.value = 'week';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(getDashboard).toHaveBeenLastCalledWith(3, true);
    expect(el.querySelector('[data-group="overview"]')!.textContent).toContain('This week');

    select.value = 'month';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(getDashboard).toHaveBeenLastCalledWith(14, true);

    select.value = 'quarter';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(getDashboard).toHaveBeenLastCalledWith(90, true);
    // Changing the period does not reload the lists (they do not depend on it).
    expect(getTaskQueue).toHaveBeenCalledTimes(3);
  });

  it('remembers the period and the collapsed sections per user', async () => {
    let el = await open();
    const toggle = () =>
      el.querySelector<HTMLButtonElement>('[data-section="lists"] [data-section-toggle]')!;
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    toggle().click();
    await settle();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toContain('Show');
    expect(el.querySelector('[data-lists]')).toBeNull();
    const select = el.querySelector<HTMLSelectElement>('select[data-period]')!;
    select.value = 'quarter';
    select.dispatchEvent(new Event('change'));
    await settle();

    TestBed.resetTestingModule();
    el = await open();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(getDashboard).toHaveBeenCalledWith(90, undefined);
    toggle().click();
    await settle();
    expect(el.querySelector('[data-lists]')).not.toBeNull();
  });

  it('works when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const el = await open();
    expect(el.querySelector('[data-section="department"]')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('[data-section="lists"] [data-section-toggle]')!.click();
    await settle();
    expect(el.querySelector('[data-lists]')).toBeNull();
  });

  it('refreshes on the button without a loading state, bypassing the server cache', async () => {
    const el = await open();
    const before = el.querySelector('[data-section="department"]');
    el.querySelector<HTMLButtonElement>('[data-refresh]')!.click();
    expect(el.querySelector('[aria-busy="true"][aria-label]')).toBeNull();
    await settle();
    expect(getDashboard).toHaveBeenLastCalledWith(30, true);
    expect(el.querySelector('[data-section="department"]')).toBe(before);
  });

  it('refreshes by itself every five minutes while the tab is visible and keeps the page in place', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const el = await open();
    const tick = spy.mock.calls.find((c) => c[1] === AUTO_REFRESH_MS)![0] as () => void;
    expect(AUTO_REFRESH_MS).toBe(300_000);
    const before = el.querySelector('[data-section="lists"]');

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    tick();
    await settle();
    expect(getDashboard).toHaveBeenCalledTimes(1);

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    tick();
    await settle();
    expect(getDashboard).toHaveBeenCalledTimes(2);
    expect(getDashboard).toHaveBeenLastCalledWith(30, undefined);
    expect(el.querySelector('[data-section="lists"]')).toBe(before);
  });

  it('keeps the figures and says so when a background refresh fails', async () => {
    const el = await open();
    getDashboard.mockReturnValue(throwError(() => new Error('boom')));
    el.querySelector<HTMLButtonElement>('[data-refresh]')!.click();
    await settle();
    expect(el.querySelector('[data-stale]')!.textContent).toContain('could not be refreshed');
    expect(el.querySelector('[data-error]')).toBeNull();
    expect(el.querySelector('[data-section="department"]')).not.toBeNull();
  });

  it('says "Nothing assigned to you" with a link to Pod Work instead of zero tiles', async () => {
    const none = summary({
      mine: {
        open: count(0, `${OPEN}&assignee=9`),
        overdue: count(0, ''),
        dueSoon: count(0, ''),
        createdByMe: count(0, ''),
      },
    });
    let el = await open(of(none));
    const mine = el.querySelector('[data-section="mine"]')!;
    expect(text(mine.querySelector('[data-nothing-assigned]'))).toContain(
      'Nothing assigned to you.',
    );
    expect(mine.querySelector('a[href="/pods/work"]')).not.toBeNull();
    expect(mine.querySelector('mf-stat-tile')).toBeNull();

    TestBed.resetTestingModule();
    el = await open(of(none), ['Task.View']);
    expect(el.querySelector('[data-nothing-assigned] a[href="/pods/work"]')).toBeNull();
    expect(el.querySelector('[data-nothing-assigned] a[href="/tasks"]')).not.toBeNull();
  });

  it('hides the department sections from users without Dashboard.ViewDepartment', async () => {
    const el = await open(of(summary()), ['Task.View']);
    expect(el.querySelector('[data-section="mine"]')).not.toBeNull();
    expect(el.querySelector('[data-section="department"]')).toBeNull();
    expect(el.querySelector('[data-section="breakdowns"]')).toBeNull();
    expect(el.querySelector('[data-section="trend"]')).toBeNull();
    expect(el.querySelector('[data-section="recent"]')).toBeNull();
  });

  it('shows the empty state only to people who can see department figures, with a create button only if they can create tasks', async () => {
    const empty = summary({ open: count(0, OPEN), recentlyCreated: [], recentlyCompleted: [] });
    // Without Dashboard.ViewDepartment the server returns zeros for the department: that must not read as "no tasks yet".
    let el = await open(of(empty), ['Task.View']);
    expect(el.querySelector('[data-empty]')).toBeNull();
    expect(el.querySelector('[data-section="mine"]')).not.toBeNull();

    TestBed.resetTestingModule();
    el = await open(of(empty), ['Task.View', 'Dashboard.ViewDepartment']);
    expect(el.querySelector('[data-empty]')!.textContent).toContain('No tasks yet.');
    expect(el.querySelector('a[href="/tasks/new"]')).toBeNull();

    TestBed.resetTestingModule();
    el = await open(of(empty), ['Task.View', 'Task.Create', 'Dashboard.ViewDepartment']);
    expect(el.querySelector('a[href="/tasks/new"]')!.textContent).toContain(
      'Create the first task',
    );
  });

  it('shows a loading placeholder while waiting', async () => {
    const el = await open(NEVER);
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('shows an error with Retry that loads again', async () => {
    const el = await open(throwError(() => new Error('boom')));
    expect(el.querySelector('[data-error]')!.textContent).toContain(
      'The dashboard could not be loaded.',
    );

    getDashboard.mockReturnValue(of(summary()));
    el.querySelector<HTMLButtonElement>('[data-error] button')!.click();
    await settle();
    expect(getDashboard).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-error]')).toBeNull();
    expect(el.querySelector('[data-section="department"]')).not.toBeNull();
  });
});
