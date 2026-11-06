import { ddSelect } from '../../../testing/dropdown-testing.spec-util';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NEVER, Subject, of, throwError } from 'rxjs';
import {
  DashboardBoardClient,
  DashboardClient,
  DashboardSummary,
  PodsClient,
  TaskQueueClient,
  TaskQueueRow,
  TasksClient,
  UsersLookupClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { QuietRequests } from '../../../core/http/interceptors';
import { UndoService } from '../../../core/notify/undo.service';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { aBoard } from '../users/users-testing';
import {
  aRow,
  pageOf,
  provideLookups,
  provideQueueChoices,
} from '../../../shared/work-queue/work-queue-testing';
import { aTrend } from '../ui/trend-testing';
import { capacityOf, somePeople } from '../summary/dash-testing';
import { aMemberChoices, aScopeChoices } from '../dash-scope-testing';
import { STALE_CHECK_MS } from '../dash-stale';
import { queueArgsFor } from '../dashboard-links';
import { AUTO_REFRESH_MS, DashboardPage } from './dashboard-page';

const OPEN = 'status=NEW&status=IN_PROGRESS&status=ON_HOLD';
const count = (n: number, query: string) => ({ count: n, query });

function summary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    period: { days: 30, from: '2026-09-15', to: '2026-10-14', key: '30d' },
    timeZone: 'UTC',
    generatedAtUtc: '2026-10-14T15:42:00Z',
    open: count(128, OPEN),
    unassigned: count(17, `${OPEN}&unassigned=true`),
    overdue: count(9, `${OPEN}&overdue=true`),
    overdueCritical: count(2, `${OPEN}&overdue=true&priority=1`),
    overdueHigh: count(3, `${OPEN}&overdue=true&priority=2`),
    onHold: count(12, 'status=ON_HOLD'),
    dueSoon: count(6, `${OPEN}&asap=false&overdue=false&dueTo=2026-10-16`),
    asapOpen: count(4, `${OPEN}&asap=true`),
    completed: count(94, 'status=COMPLETED&completedFrom=2026-09-15'),
    created: count(101, 'createdFrom=2026-09-15'),
    scope: { scope: 'all', podIds: [], unassignedNoPod: 0 },
    unassignedGauge: {
      count: 17,
      oldestSinceUtc: '2026-10-14T12:54:00Z',
      oldestAgeMinutes: 168,
      ageBasis: 'WORKING',
      level: 3,
      asOfUtc: '2026-10-14T15:42:00Z',
    },
    byTaskType: [
      {
        label: 'Data Processing',
        count: 50,
        id: 3,
        code: undefined,
        query: `${OPEN}&type=3`,
        overdue: 4,
        isOther: false,
      },
      {
        label: 'Other Task Types',
        count: 7,
        id: undefined,
        code: undefined,
        query: undefined,
        overdue: 0,
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
        overdue: 2,
        isOther: false,
      },
    ],
    byStatus: [
      {
        label: 'New',
        count: 80,
        id: undefined,
        code: 'NEW',
        query: 'status=NEW',
        overdue: 0,
        isOther: false,
      },
    ],
    aging: [
      {
        key: '0-2',
        label: '0-2 days',
        minDays: 0,
        maxDays: 2,
        count: 30,
        overdue: 3,
        query: `${OPEN}&createdFrom=2026-10-12&createdTo=2026-10-14`,
      },
      {
        key: '61+',
        label: 'More than 60 days',
        minDays: 61,
        maxDays: undefined,
        count: 10,
        overdue: 0,
        query: `${OPEN}&createdTo=2026-08-14`,
      },
    ],
    ...overrides,
  };
}

function emptyBoard() {
  const lane = (status: string, label: string) => ({
    status,
    label,
    count: 0,
    total: 0,
    truncated: false,
    cards: [],
  });
  return {
    timeZone: 'UTC',
    generatedAtUtc: '2026-10-14T15:42:00Z',
    completedDays: 7,
    completedFrom: '2026-10-08',
    groupBy: 'none',
    sort: 'priority',
    laneCap: 200,
    lanes: [
      lane('NEW', 'New'),
      lane('IN_PROGRESS', 'In Progress'),
      lane('ON_HOLD', 'On Hold'),
      lane('COMPLETED', 'Completed'),
    ],
    groups: [],
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
const secondUnassigned = aRow({
  taskId: 24,
  taskNumber: 'TSK-24',
  title: 'Second intake',
  assignedUser: undefined,
  status: 'NEW',
  statusLabel: 'New',
  createdAtUtc: '2026-10-05T12:00:00Z',
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

const TABS: Permission[] = [
  'Dashboard.ViewSummary',
  'Dashboard.ViewBreakdowns',
  'Dashboard.ViewTrends',
  'Dashboard.ViewSwimlane',
  'Dashboard.ViewUsers',
];
/** Every Dashboard right (the Director). */
const DASH: Permission[] = ['Dashboard.View', ...TABS];
/** The three tabs that read the summary payload. */
const DATA_TABS: Permission[] = ['Dashboard.View', ...TABS.slice(0, 3)];

/** Dashboard.ViewUnassigned with the right to assign: the Technician's queue. */
const TECH_QUEUE: Permission[] = [
  'Task.View',
  'Task.Assign',
  'Dashboard.View',
  'Dashboard.ViewUnassigned',
];

const ALL: Permission[] = ['Task.View', ...DASH, 'Task.Create', 'Task.Assign', 'Pod.View'];

describe('DashboardPage', () => {
  let unassignedRows: TaskQueueRow[];
  let getDashboard: ReturnType<typeof vi.fn>;
  const getDashboardSwimlane = vi.fn(() => of(emptyBoard()));
  let getDashboardTrend: ReturnType<typeof vi.fn>;
  let getDashboardScopes: ReturnType<typeof vi.fn>;
  let scopeChoices = aScopeChoices();
  const getDashboardWorkload = vi.fn(() => of(aBoard([])));
  let getTaskQueue: ReturnType<typeof vi.fn>;
  let assignTask: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;
  const T0 = Date.parse('2026-10-14T15:45:00Z');
  let clockMs = T0;

  async function open(
    response: unknown = of(summary()),
    permissions: Permission[] = ALL,
    url = '/dashboard',
  ) {
    getDashboard = vi.fn().mockReturnValue(response);
    getDashboardScopes = vi.fn(() => of(scopeChoices));
    getDashboardTrend = vi.fn((_p: string, _f: unknown, _t: unknown, _d: unknown, ids?: number[]) =>
      of(aTrend(ids ?? [])),
    );
    getTaskQueue = vi.fn((...args: unknown[]) =>
      of(
        args[7] === true
          ? pageOf(unassignedRows, { total: 17 })
          : args[19] === true
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
        {
          provide: DashboardClient,
          useValue: {
            getDashboard,
            getDashboardTrend,
            getDashboardScopes,
          },
        },
        {
          provide: DashboardBoardClient,
          useValue: {
            getDashboardSwimlane,
            getDashboardWorkload,
            getDashboardCapacity: () => of(capacityOf(somePeople())),
            getDashboardCapacityPeople: () => of(somePeople()),
          },
        },
        { provide: TaskQueueClient, useValue: { getTaskQueue } },
        { provide: TasksClient, useValue: { assignTask } },
        { provide: PodsClient, useValue: {} },
        { provide: UsersLookupClient, useValue: { lookupUsers: () => of([]) } },
        ...provideLookups(),
        ...provideQueueChoices({
          types: [
            { value: '3', label: 'Data Processing' },
            { value: '4', label: 'Redaction' },
          ],
        }),
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
        { provide: Clock, useValue: { now: () => new Date(clockMs) } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, DashboardPage);
    await settle();
    return harness.routeNativeElement as HTMLElement;
  }

  /** Opens the assignee menu of the first row under `scope` and picks its first choice, "Assign to Me". */
  function assignToMe(scope: Element) {
    scope.querySelector<HTMLButtonElement>('mf-row-edit [data-inline-trigger]')!.click();
    harness.detectChanges();
    scope.querySelector<HTMLButtonElement>('[data-lead]')!.click();
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
    clockMs = T0;
    scopeChoices = aScopeChoices();
    unassignedRows = [unassignedRow];
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  afterEach(() => vi.restoreAllMocks());

  describe('Summary v4 (epic #1063)', () => {
    const card = (el: HTMLElement, key: string) =>
      el.querySelector<HTMLButtonElement>(`[data-card="${key}"]`)!;
    const router = () => TestBed.inject(Router);

    it('shows three Needs attention cards (Overdue, Unassigned, On hold) with the counts, and no ASAP card, Overview or Period control', async () => {
      const el = await open();
      expect(getDashboard).toHaveBeenCalledWith(
        '30d',
        undefined,
        undefined,
        undefined,
        undefined,
        'all',
      );
      const cards = Array.from(el.querySelectorAll('[data-dash-cards] [data-card]'));
      expect(cards.map((c) => c.getAttribute('data-card'))).toEqual([
        'overdue',
        'unassigned',
        'onHold',
      ]);
      expect(cards.map((c) => text(c.querySelector('[data-card-count]')))).toEqual([
        '9',
        '17',
        '12',
      ]);
      expect(el.querySelector('[data-group="overview"], mf-stat-tile')).toBeNull();
      expect(el.querySelector('mf-dropdown[data-period]')).toBeNull();
      expect(el.textContent).not.toContain('ASAP open');
    });

    it('reads the grid from the Task Queue: the scope open tasks, then the card query when a card is pressed, and a second press clears it', async () => {
      const el = await open();
      const sizes = () => getTaskQueue.mock.calls.map((c) => c[7]);
      const calls = getTaskQueue.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      // No card: not the unassigned query.
      expect(sizes().at(-1)).not.toBe(true);

      card(el, 'unassigned').click();
      await settle();
      expect(router().url).toContain('card=unassigned');
      expect(card(el, 'unassigned').getAttribute('aria-pressed')).toBe('true');
      const last = getTaskQueue.mock.calls.at(-1)!;
      // The unassigned flag, and the order "longest waiting first".
      expect(last[7]).toBe(true);
      expect(last[35]).toBe('unassignedSince');
      expect(last[36]).toBe('asc');
      // The Unassigned for column joins the grid only while the card is on.
      expect(el.querySelector('th[data-col="unassignedFor"]')).not.toBeNull();
      expect(text(el.querySelector('[data-chip="card"]'))).toContain('Unassigned');

      card(el, 'unassigned').click();
      await settle();
      expect(router().url).not.toContain('card=');
      expect(card(el, 'unassigned').getAttribute('aria-pressed')).toBe('false');
      expect(el.querySelector('th[data-col="unassignedFor"]')).toBeNull();
    });

    it('opens on a card named in the address, and ignores an unknown one', async () => {
      let el = await open(of(summary()), ALL, '/dashboard?card=overdue');
      expect(card(el, 'overdue').getAttribute('aria-pressed')).toBe('true');
      expect(getTaskQueue.mock.calls.at(-1)![19]).toBe(true);
      TestBed.resetTestingModule();
      el = await open(of(summary()), ALL, '/dashboard?card=asap');
      expect(el.querySelector('[data-card][aria-pressed="true"]')).toBeNull();
    });

    it('sends the pod of the scope with the card query', async () => {
      scopeChoices = aMemberChoices();
      const scoped = summary({
        overdue: count(3, `${OPEN}&overdue=true&pod=1&pod=2`),
        scope: { scope: 'mine', podIds: [1, 2], unassignedNoPod: 0 },
      });
      const el = await open(of(scoped));
      card(el, 'overdue').click();
      await settle();
      expect(getTaskQueue.mock.calls.at(-1)![4]).toEqual([1, 2]);
    });

    it('draws the battery and the gauge in the right column for a Director, and the grid with the shared list toolbar', async () => {
      const el = await open();
      expect(el.querySelector('[data-dash-rcol] mf-dash-battery [data-battery]')).not.toBeNull();
      expect(el.querySelector('[data-dash-rcol] mf-dash-gauge [data-gauge]')).not.toBeNull();
      expect(el.querySelector('mf-dash-grid [data-list-toolbar]')).not.toBeNull();
      expect(el.querySelector('mf-dash-grid mf-grid-columns')).not.toBeNull();
    });

    it('leaves the battery out without Dashboard.ViewUsers and keeps the cards, the grid and the gauge', async () => {
      const el = await open(of(summary()), [
        'Task.View',
        'Dashboard.View',
        'Dashboard.ViewSummary',
      ]);
      expect(el.querySelector('mf-dash-battery')).toBeNull();
      expect(el.querySelector('[data-dash-cards]')).not.toBeNull();
      expect(el.querySelector('mf-dash-gauge')).not.toBeNull();
      expect(el.querySelector('mf-dash-grid')).not.toBeNull();
    });

    it('shows a Technician (View + ViewUnassigned) the queue only: no cards, battery, gauge or grid', async () => {
      const el = await open(of(summary()), TECH_QUEUE);
      expect(
        el.querySelector('[data-dash-cards], mf-dash-battery, mf-dash-gauge, mf-dash-grid'),
      ).toBeNull();
      expect(el.querySelector('[data-panel="unassigned"]')).not.toBeNull();
    });

    it('reads the summary again every minute while the gauge is on screen, without reading the grid again', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        await open();
        const reads = getDashboard.mock.calls.length;
        const rows = getTaskQueue.mock.calls.length;
        vi.advanceTimersByTime(60_000);
        await settle();
        expect(getDashboard.mock.calls.length).toBe(reads + 1);
        expect(getTaskQueue.mock.calls.length).toBe(rows);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('puts focus back on Refresh when Retry in the failed-refresh banner succeeds', async () => {
    const el = await open();
    document.body.appendChild(el);
    getDashboard.mockReturnValueOnce(throwError(() => new Error('down')));
    el.querySelector<HTMLButtonElement>('[data-refresh]')!.click();
    await settle();
    const retry = el.querySelector<HTMLButtonElement>(
      '[data-dash-state="stale"] [data-dash-retry]',
    )!;
    retry.focus();
    getDashboard.mockReturnValue(of(summary()));
    retry.click();
    await settle();
    expect(el.querySelector('[data-dash-state="stale"]')).toBeNull();
    expect(document.activeElement).toBe(el.querySelector('[data-refresh]'));
    el.remove();
  });

  it('has no Your work section, no pod breakdown and no recent-activity lists any more', async () => {
    let el = await open();
    expect(el.textContent).not.toMatch(/Your work|My open tasks|Created by me|Open by pod/);
    expect(el.querySelector('mf-recent-task-list')).toBeNull();
    TestBed.resetTestingModule();
    el = await open(of(summary()), ALL, '/dashboard?tab=breakdowns');
    expect(el.textContent).not.toContain('Open by pod');
    expect(el.textContent).not.toMatch(/Recently (created|completed)/);
  });

  describe('tabs', () => {
    const tabButtons = (el: HTMLElement) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const selectedTab = (el: HTMLElement) =>
      tabButtons(el).find((t) => t.getAttribute('aria-selected') === 'true')!;
    const key = (el: HTMLElement, name: string) =>
      selectedTab(el).dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

    it('is a WAI-ARIA tab list with Summary, Breakdowns, Trends, Swimlane and Users and one labelled panel for the selected tab', async () => {
      const el = await open();
      const list = el.querySelector('[role="tablist"]')!;
      expect(list.getAttribute('aria-label')).toBe('Dashboard views');
      expect(tabButtons(el).map((t) => text(t))).toEqual([
        'Summary',
        'Breakdowns',
        'Trends',
        'Swimlane',
        'Users',
      ]);
      const selected = selectedTab(el);
      expect(text(selected)).toBe('Summary');
      // Roving tabindex: only the selected tab is a tab stop.
      expect(tabButtons(el).map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1]);
      const panels = el.querySelectorAll('[role="tabpanel"]');
      expect(panels.length).toBe(1);
      expect(panels[0].getAttribute('aria-labelledby')).toBe(selected.id);
      expect(selected.getAttribute('aria-controls')).toBe(panels[0].id);
    });

    it('opens on Summary, leaves a plain address alone (P9) and the page header stays the only H1', async () => {
      const el = await open();
      expect(TestBed.inject(Router).url).toBe('/dashboard');
      expect(el.querySelectorAll('h1').length).toBe(1);
      expect(el.querySelector('[data-tabpanel="summary"]')).not.toBeNull();
    });

    it('shows the tab named by ?tab= and ignores an unknown one', async () => {
      let el = await open(of(summary()), ALL, '/dashboard?tab=trends');
      expect(text(selectedTab(el))).toBe('Trends');
      expect(el.querySelector('[data-tabpanel="trends"]')).not.toBeNull();
      expect(el.querySelector('[data-tabpanel="summary"]')).toBeNull();
      expect(TestBed.inject(Router).url).toBe('/dashboard?tab=trends');

      TestBed.resetTestingModule();
      el = await open(of(summary()), ALL, '/dashboard?tab=nonsense');
      expect(text(selectedTab(el))).toBe('Summary');
      expect(TestBed.inject(Router).url).toBe('/dashboard?tab=summary');
    });

    it('selects a tab by click: the address follows, the panel changes and only one panel exists', async () => {
      const el = await open();
      tabButtons(el)[1].click();
      await settle();
      expect(TestBed.inject(Router).url).toBe('/dashboard?tab=breakdowns');
      expect(text(selectedTab(el))).toBe('Breakdowns');
      expect(el.querySelectorAll('[role="tabpanel"]').length).toBe(1);
      expect(el.querySelector('[data-tabpanel="breakdowns"]')).not.toBeNull();
      expect(el.querySelector('[data-dash-cards]')).toBeNull();
    });

    it('moves with the arrow keys (wrapping), Home and End, moves focus with the selection and rolls the tab stop', async () => {
      const el = await open();
      document.body.appendChild(el);
      selectedTab(el).focus();
      key(el, 'ArrowRight');
      await settle();
      expect(text(selectedTab(el))).toBe('Breakdowns');
      expect(document.activeElement).toBe(selectedTab(el));
      expect(tabButtons(el).map((t) => t.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
      key(el, 'ArrowRight');
      await settle();
      expect(text(selectedTab(el))).toBe('Trends');
      key(el, 'ArrowRight');
      await settle();
      expect(text(selectedTab(el))).toBe('Swimlane');
      key(el, 'ArrowRight');
      await settle();
      expect(text(selectedTab(el))).toBe('Users');
      key(el, 'ArrowRight');
      await settle();
      expect(text(selectedTab(el))).toBe('Summary');
      key(el, 'ArrowLeft');
      await settle();
      expect(text(selectedTab(el))).toBe('Users');
      key(el, 'Home');
      await settle();
      expect(text(selectedTab(el))).toBe('Summary');
      key(el, 'End');
      await settle();
      expect(text(selectedTab(el))).toBe('Users');
      expect(document.activeElement).toBe(selectedTab(el));
      el.remove();
    });

    it('shows the Swimlane board and the Users placeholder in their own panels, loaded when their tab is chosen', async () => {
      const el = await open(of(summary()), ALL, '/dashboard?tab=swimlane');
      expect(text(selectedTab(el))).toBe('Swimlane');
      expect(el.querySelector('[data-tabpanel="swimlane"] mf-dash-swimlane-tab')).not.toBeNull();
      expect(el.querySelector('[data-tabpanel="swimlane"]')!.getAttribute('aria-labelledby')).toBe(
        'mf-dash-tab-swimlane',
      );
      // The refresh is one icon in the tab row, with no "Updated" text, on every tab.
      expect(el.querySelector('[data-page-actions] [data-refresh]')).not.toBeNull();
      expect(el.querySelectorAll('[data-refresh]').length).toBe(1);
      const icon = el.querySelector<HTMLButtonElement>('mf-dash-tabs [data-refresh]')!;
      expect(icon).not.toBeNull();
      expect(icon.getAttribute('aria-label')).toBe('Refresh');
      expect(icon.textContent!.trim()).toBe('');
      expect(icon.closest('mf-dash-tabs')!.querySelector('[role="tablist"]')).not.toBeNull();
      expect(el.querySelector('[data-updated]')).toBeNull();

      tabButtons(el)[4].click();
      await settle();
      expect(text(selectedTab(el))).toBe('Users');
      const panel = el.querySelector('[data-tabpanel="users"]')!;
      expect(panel.querySelector('mf-dash-users-tab')).not.toBeNull();
      const usersIcon = el.querySelector<HTMLButtonElement>('mf-dash-tabs [data-refresh]')!;
      expect(usersIcon.getAttribute('aria-label')).toBe('Refresh');
      expect(usersIcon.textContent!.trim()).toBe('');
      expect(el.querySelectorAll('[data-refresh]').length).toBe(1);
      expect(el.querySelector('[data-page-actions] [data-refresh]')).not.toBeNull();
      expect(el.querySelector('[data-tabpanel="swimlane"]')).toBeNull();

      tabButtons(el)[0].click();
      await settle();
      expect(el.querySelector('mf-dash-tabs [data-refresh]')).not.toBeNull();
      expect(el.querySelectorAll('[data-refresh]').length).toBe(1);
    });

    it('has one icon-only Refresh in the tab row on Summary, Breakdowns, Trends, Swimlane and Users, acting on the tab shown', async () => {
      const el = await open();
      const swimlaneRead = getDashboardSwimlane.mock.calls.length;
      const workloadRead = getDashboardWorkload.mock.calls.length;
      for (const [index, label] of [
        'Summary',
        'Breakdowns',
        'Trends',
        'Swimlane',
        'Users',
      ].entries()) {
        if (index > 0) {
          tabButtons(el)[index].click();
          await settle();
        }
        expect(text(selectedTab(el))).toBe(label);
        expect(el.querySelectorAll('[data-refresh]').length).toBe(1);
        const button = el.querySelector<HTMLButtonElement>('mf-dash-tabs [data-refresh]')!;
        expect(button.getAttribute('aria-label')).toBe('Refresh');
        expect(button.getAttribute('title')).toContain('Refresh');
        expect(button.textContent!.trim()).toBe('');
        expect(button.querySelector('.pi-refresh')).not.toBeNull();
      }
      // On Users the icon reads the workload again; on Swimlane the board.
      const usersRead = getDashboardWorkload.mock.calls.length;
      el.querySelector<HTMLButtonElement>('mf-dash-tabs [data-refresh]')!.click();
      await settle();
      expect(getDashboardWorkload.mock.calls.length).toBeGreaterThan(usersRead);
      expect(workloadRead).toBeLessThanOrEqual(usersRead);
      tabButtons(el)[3].click();
      await settle();
      const boardRead = getDashboardSwimlane.mock.calls.length;
      expect(boardRead).toBeGreaterThanOrEqual(swimlaneRead);
      el.querySelector<HTMLButtonElement>('mf-dash-tabs [data-refresh]')!.click();
      await settle();
      expect(getDashboardSwimlane.mock.calls.length).toBeGreaterThan(boardRead);
    });

    it('shows the spinner and aria-busy on the tab-row Refresh while the summary is read again', async () => {
      const el = await open();
      const again = new Subject<DashboardSummary>();
      getDashboard.mockReturnValueOnce(again);
      const button = el.querySelector<HTMLButtonElement>('mf-dash-tabs [data-refresh]')!;
      button.click();
      await settle();
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(button.querySelector('.pi-spinner')).not.toBeNull();
      again.next(summary());
      again.complete();
      await settle();
      expect(button.getAttribute('aria-busy')).toBeNull();
    });

    it('does not carry the Swimlane parameters (group, sort, filters) to another tab', async () => {
      const el = await open(
        of(summary()),
        ALL,
        '/dashboard?tab=swimlane&group=priority&sort=due&q=acme&mine=true',
      );
      expect(TestBed.inject(Router).url).toContain('group=priority');
      tabButtons(el)[1].click();
      await settle();
      expect(TestBed.inject(Router).url).toBe('/dashboard?tab=breakdowns');
    });

    it('does not remember the tab: a plain /dashboard link opens Summary even after a visit to Trends', async () => {
      let el = await open(of(summary()), ALL, '/dashboard?tab=breakdowns');
      tabButtons(el)[2].click();
      await settle();
      expect(JSON.parse(localStorage.getItem('mf.dashboard.v2.1') ?? '{}').tab).toBeUndefined();

      TestBed.resetTestingModule();
      el = await open();
      expect(text(selectedTab(el))).toBe('Summary');
      expect(TestBed.inject(Router).url).toBe('/dashboard');
    });

    it('adds a history entry for a tab change, so Back returns to the previous tab', async () => {
      const el = await open();
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate');
      tabButtons(el)[1].click();
      await settle();
      expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ replaceUrl: false }));
      expect(TestBed.inject(Router).url).toBe('/dashboard?tab=breakdowns');
    });

    it('follows the browser Back and Forward (the address is the source of truth)', async () => {
      const el = await open();
      await TestBed.inject(Router).navigateByUrl('/dashboard?tab=trends');
      await settle();
      expect(text(selectedTab(el))).toBe('Trends');
      await TestBed.inject(Router).navigateByUrl('/dashboard?tab=breakdowns');
      await settle();
      expect(text(selectedTab(el))).toBe('Breakdowns');
    });

    it('shares one summary request between the tabs and reads the grid only for Summary', async () => {
      const el = await open(of(summary()), ALL, '/dashboard?tab=breakdowns');
      expect(getDashboard).toHaveBeenCalledTimes(1);
      // Breakdowns needs no list: the Task Queue has not been asked anything.
      expect(getTaskQueue).not.toHaveBeenCalled();

      tabButtons(el)[2].click();
      await settle();
      expect(getDashboard).toHaveBeenCalledTimes(1);
      expect(getTaskQueue).not.toHaveBeenCalled();

      // Summary reads its grid (one request) when it is first shown, and the summary is not read again within a minute.
      tabButtons(el)[0].click();
      await settle();
      expect(getDashboard).toHaveBeenCalledTimes(1);
      expect(getTaskQueue).toHaveBeenCalledTimes(1);
    });

    it('shows the period control only on Trends: Summary no longer has an Overview, and Breakdowns never had one', async () => {
      const el = await open();
      expect(el.querySelector('mf-dropdown[data-period]')).toBeNull();
      expect(el.querySelector('[data-group="overview"]')).toBeNull();
      tabButtons(el)[1].click();
      await settle();
      expect(el.querySelector('mf-dropdown[data-period]')).toBeNull();
      tabButtons(el)[2].click();
      await settle();
      expect(el.querySelectorAll('mf-dropdown[data-period]').length).toBe(1);
      expect(el.querySelector('[data-section="trend"] mf-dropdown[data-period]')).not.toBeNull();
      expect(text(el.querySelector('mf-period-control .pc-lbl'))).toBe('Period');
    });
  });

  describe('permissions', () => {
    const tabLabels = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('[role="tab"]')).map((t) => text(t));
    const selected = (el: HTMLElement) =>
      text(el.querySelector('[role="tab"][aria-selected="true"]'));

    it('with Dashboard.View but no tab permission shows the friendly note with a link to My Work, no tabs and no requests', async () => {
      const el = await open(of(summary()), ['Task.View', 'Dashboard.View']);
      expect(el.querySelector('[role="tablist"]')).toBeNull();
      expect(el.querySelector('[data-group]')).toBeNull();
      expect(el.querySelector('[data-dash-state="error"], [data-empty]')).toBeNull();
      expect(text(el.querySelector('[data-no-tabs-note]'))).toBe(
        'No Dashboard tab is turned on for your role. Ask an administrator to add one (Summary, Breakdowns, Trends, Swimlane or Users) to your role. Your assigned tasks are in My Work.',
      );
      expect(text(el.querySelector('[data-no-tabs-note]'))).not.toContain('Department figures');
      expect(el.querySelector('[data-no-tabs-note] a')!.getAttribute('href')).toBe('/my-work');
      expect(el.querySelector('[data-refresh]')).toBeNull();
      expect(getDashboard).not.toHaveBeenCalled();
      expect(getTaskQueue).not.toHaveBeenCalled();
      expect(TestBed.inject(Router).url).toBe('/dashboard');
    });

    it('a tab permission without Dashboard.View shows nothing (the route guard sends such a user to 403)', async () => {
      const el = await open(of(summary()), ['Task.View', 'Dashboard.ViewSummary']);
      expect(el.querySelector('[role="tablist"]')).toBeNull();
      expect(el.querySelector('[data-no-tabs-note]')).not.toBeNull();
      expect(getDashboard).not.toHaveBeenCalled();
    });

    it('shows only the permitted tabs; the first one is the default and the address follows', async () => {
      const el = await open(of(summary()), [
        'Task.View',
        'Dashboard.View',
        'Dashboard.ViewTrends',
        'Dashboard.ViewBreakdowns',
      ]);
      expect(tabLabels(el)).toEqual(['Breakdowns', 'Trends']);
      expect(selected(el)).toBe('Breakdowns');
      expect(el.querySelector('[data-tabpanel="breakdowns"]')).not.toBeNull();
      expect(TestBed.inject(Router).url).toBe('/dashboard');
    });

    it('a deep link to a forbidden tab falls back to the first permitted tab', async () => {
      const el = await open(
        of(summary()),
        ['Task.View', 'Dashboard.View', 'Dashboard.ViewSummary', 'Dashboard.ViewTrends'],
        '/dashboard?tab=swimlane',
      );
      expect(tabLabels(el)).toEqual(['Summary', 'Trends']);
      expect(selected(el)).toBe('Summary');
      expect(el.querySelector('[data-tabpanel="swimlane"]')).toBeNull();
      expect(TestBed.inject(Router).url).toBe('/dashboard?tab=summary');
    });

    it('Swimlane and Users only: no summary request, the board tab opens at once', async () => {
      const el = await open(
        of(summary()),
        ['Dashboard.View', 'Dashboard.ViewSwimlane', 'Dashboard.ViewUsers'],
        '/dashboard?tab=users',
      );
      expect(tabLabels(el)).toEqual(['Swimlane', 'Users']);
      expect(selected(el)).toBe('Users');
      expect(el.querySelector('[data-tabpanel="users"]')).not.toBeNull();
      expect(getDashboard).not.toHaveBeenCalled();
      // The refresh icon belongs to the tab row, which the board tabs have too.
      expect(el.querySelectorAll('mf-dash-tabs [data-refresh]').length).toBe(1);
    });

    it('Dashboard.ViewUnassigned alone: Summary is only the Unassigned queue, no tiles, no Overdue or Due soon, and the queue is read', async () => {
      const el = await open(of(summary()), [
        'Task.View',
        'Dashboard.View',
        'Dashboard.ViewUnassigned',
      ]);
      // One tab: no tab list; the only content is the unassigned queue, and the heading says so (R3, S9).
      expect(tabLabels(el)).toEqual([]);
      expect(el.querySelector('h1')!.textContent).toContain('Unassigned work');
      expect(
        el.querySelector(
          '[data-dash-cards], mf-dash-gauge, mf-dash-battery, mf-dropdown[data-period]',
        ),
      ).toBeNull();
      expect(el.querySelector('.empty[data-empty]')).toBeNull();
      expect(
        Array.from(el.querySelectorAll('[data-panel]')).map((p) => p.getAttribute('data-panel')),
      ).toEqual(['unassigned']);
      expect(el.querySelector('[data-panel="unassigned"] [data-total]')!.textContent).toContain(
        '17',
      );
      // One queue read, no Overdue or Due soon reads.
      expect(getTaskQueue).toHaveBeenCalledTimes(1);
      expect(el.querySelectorAll('mf-dash-tabs [data-refresh]').length).toBe(1);
    });

    it('Dashboard.ViewUnassigned with other tabs: Summary is still the queue alone, the other tabs are unchanged', async () => {
      const el = await open(of(summary()), [
        'Task.View',
        'Dashboard.View',
        'Dashboard.ViewUnassigned',
        'Dashboard.ViewBreakdowns',
      ]);
      expect(tabLabels(el)).toEqual(['Summary', 'Breakdowns']);
      // Two tabs: the heading is "Dashboard" in the tab row and the panel is a tabpanel (R3 regression).
      expect(el.querySelector('h1')!.textContent).toContain('Dashboard');
      expect(el.querySelector('[data-dash-head] [role="tablist"]')).not.toBeNull();
      expect(el.querySelector('[role="tabpanel"]')).not.toBeNull();
      expect(el.querySelector('[data-dash-cards]')).toBeNull();
      expect(el.querySelectorAll('[data-panel]').length).toBe(1);
    });

    it('Breakdowns or Trends only do not read the task lists', async () => {
      await open(of(summary()), [
        'Task.View',
        'Task.Assign',
        'Dashboard.View',
        'Dashboard.ViewBreakdowns',
      ]);
      expect(getDashboard).toHaveBeenCalledTimes(1);
      expect(getTaskQueue).not.toHaveBeenCalled();
    });

    it('refreshes the Summary lists with the button and announces it', async () => {
      const el = await open(of(summary()), [
        'Task.View',
        'Task.Assign',
        'Dashboard.View',
        'Dashboard.ViewSummary',
      ]);
      const before = getTaskQueue.mock.calls.length;
      el.querySelector<HTMLButtonElement>('[data-refresh]')!.click();
      await settle();
      expect(getTaskQueue.mock.calls.length).toBeGreaterThan(before);
      expect(text(el.querySelector('[data-dash-live]'))).toContain('Dashboard refreshed');
    });
  });

  it('lists the unassigned tasks by priority then age with reference, title, matter, priority, age and the assignee editor', async () => {
    const el = await open(of(summary()), TECH_QUEUE);
    const panel = el.querySelector('[data-panel="unassigned"]')!;
    expect(text(panel.querySelector('h3'))).toBe('Unassigned');
    expect(text(panel.querySelector('[data-order]'))).toBe('Highest priority first, then oldest.');
    expect(text(panel.querySelector('[data-total]'))).toBe('17');
    const row = panel.querySelector('li')!;
    expect(row.querySelector('a.main')!.getAttribute('href')).toBe('/tasks/21?from=dashboard');
    expect(text(row.querySelector('.ref'))).toBe('TSK-21');
    expect(text(row.querySelector('.title'))).toBe('Unassigned intake');
    expect(text(row.querySelector('mf-matter-ref'))).toContain('00343-00012');
    // Row content (S7): task type icon with its name, client (matter number and name in the tooltip), due chip when there is a date.
    expect(row.querySelector('[data-type]')!.getAttribute('aria-label')).toBe(
      unassignedRow.taskTypeName,
    );
    expect(text(row.querySelector('[data-client]'))).toContain(unassignedRow.clientName);
    expect(row.querySelector('[data-client]')!.getAttribute('title')).toContain('00343-00012');
    expect(text(row.querySelector('mf-row-edit [data-inline-trigger]'))).toBe('Assign');
    expect(row.querySelector('mf-row-edit [data-inline-trigger]')!.getAttribute('aria-label')).toBe(
      'Assign TSK-21',
    );
    expect(row.querySelector('mf-priority-flag')!.textContent).toContain('Critical');
    // The creation age left the row (#213): it is the last line of the Due cell tooltip, and the cell is the grid's (inline layout).
    const due = row.querySelector('mf-due-cell[data-due]')!;
    expect(row.querySelector('[data-age]')).toBeNull();
    expect(due.querySelector('.dc--inline')).not.toBeNull();
    expect(due.querySelector('.dc')!.getAttribute('title')).toContain('Created 10 d ago');
    expect(row.querySelector('mf-row-edit [data-inline-trigger]')).not.toBeNull();
    // "Assign to Me" is the first choice of that menu, not a link of its own; the menu sits before the client column (the other lists' order plus the menu).
    expect(row.querySelector('[data-assign-me]')).toBeNull();
    const cells = Array.from(row.children).map((c) => c.className.split(' ')[0]);
    expect(cells).toEqual(['main', 'assign', 'client', 'prio', 'when']);
    expect(
      row.querySelector('mf-row-edit [data-inline-trigger]')!.getAttribute('aria-expanded'),
    ).toBe('false');
    row.querySelector<HTMLButtonElement>('mf-row-edit [data-inline-trigger]')!.click();
    harness.detectChanges();
    const lead = el.querySelector<HTMLButtonElement>('[data-lead]')!;
    expect(lead.getAttribute('aria-label')).toBe('Assign TSK-21 to me');
    expect(el.querySelector('.im-pop')!.firstElementChild).toBe(lead);
    expect(panel.querySelector<HTMLAnchorElement>('[data-view-all]')!.getAttribute('href')).toBe(
      '/tasks?status=NEW&status=IN_PROGRESS&status=ON_HOLD&unassigned=true&sort=priorityAge&dir=asc',
    );
    // The list asks the Task Queue for priority then age, 5 rows.
    const call = getTaskQueue.mock.calls.find((c) => c[7] === true)!;
    expect(call.slice(35)).toEqual(['priorityAge', 'asc', 1, 5]);
  });

  it('keeps the tab stops down: a row has one link and its actions, the matter reference is plain text', async () => {
    unassignedRows = [
      unassignedRow,
      secondUnassigned,
      { ...secondUnassigned, taskId: 25, taskNumber: 'TSK-25' },
    ];
    const el = await open(of(summary()), TECH_QUEUE);
    const row = el.querySelector('[data-panel="unassigned"] li')!;
    // Task link and the assignee menu ("Assign to Me" is inside it); no matter link and no copy button.
    expect(row.querySelectorAll('a').length).toBe(1);
    expect(row.querySelectorAll('button').length).toBe(1);
    expect(row.querySelector('mf-matter-ref a')).toBeNull();
  });

  it('moves an assigned task out of the unassigned queue at once, keeps counts consistent, moves focus to the next row and announces it', async () => {
    unassignedRows = [unassignedRow, secondUnassigned];
    const el = await open(of(summary()), TECH_QUEUE);
    document.body.appendChild(el);
    const panel = () => el.querySelector('[data-panel="unassigned"]')!;
    expect(text(panel().querySelector('[data-more]'))).toBe('Showing 2 of 17');

    // The server's next answer (after the quiet period): one task fewer.
    unassignedRows = [secondUnassigned];
    getDashboard.mockReturnValue(of(summary({ unassigned: count(16, `${OPEN}&unassigned=true`) })));
    assignToMe(panel());
    await settle();

    expect(assignTask).toHaveBeenCalledWith(21, { rowVersion: 'AAAA', podId: 5, userId: 1 });
    // The row is gone from the queue, the header and footer counts and the tile agree (16), before any re-read.
    expect(panel().querySelector('[data-task="TSK-21"]')).toBeNull();
    expect(panel().querySelectorAll('li').length).toBe(1);
    expect(text(panel().querySelector('[data-total]'))).toBe('16');
    expect(text(panel().querySelector('[data-more]'))).toBe('Showing 1 of 16');
    // Focus did not fall to the body: it is on the row that took its place.
    expect(document.activeElement).toBe(panel().querySelector('li a.main'));
    expect(text(el.querySelector('[data-dash-live]'))).toContain('TSK-21 assigned to Test User');
    expect(text(el.querySelector('[data-dash-live]'))).toContain('16 unassigned tasks left');
    // The toast says the task moved to In Progress.
    expect(TestBed.inject(UndoService).current()?.detail).toBe('Task moved to In Progress.');

    // A moment later the counts and the lists are read again, bypassing the cache.
    await new Promise((r) => setTimeout(r, 900));
    harness.detectChanges();
    expect(getDashboard).toHaveBeenCalledTimes(2);
    expect(getDashboard).toHaveBeenLastCalledWith(
      '30d',
      undefined,
      undefined,
      undefined,
      true,
      'all',
    );
    expect(getTaskQueue.mock.calls.filter((c) => c[7] === true).length).toBe(2);
    expect(text(panel().querySelector('[data-total]'))).toBe('17');
    el.remove();
  });

  it('puts the task back when the assignment is undone (the lists are read again)', async () => {
    const el = await open(of(summary()), TECH_QUEUE);
    assignToMe(el);
    await settle();
    expect(el.querySelector('[data-panel="unassigned"] [data-task="TSK-21"]')).toBeNull();
    const reads = getDashboard.mock.calls.length;
    const queueReads = getTaskQueue.mock.calls.length;

    // The Undo restores the assignee on the server; the page reads its data again because the row it knew is gone.
    const undo = TestBed.inject(UndoService);
    undo.offer('x', async () => undefined);
    await undo.run();
    await settle();
    expect(getDashboard.mock.calls.length).toBeGreaterThan(reads);
    expect(getDashboard).toHaveBeenLastCalledWith(
      '30d',
      undefined,
      undefined,
      undefined,
      true,
      'all',
    );
    expect(getTaskQueue.mock.calls.length).toBeGreaterThan(queueReads);
    expect(el.querySelector('[data-panel="unassigned"] [data-task="TSK-21"]')).not.toBeNull();
  });

  it('shows the breakdowns tab: priority, task type (with Other), status and age, with percent, badge colours and every row linked', async () => {
    const el = await open(of(summary()), ALL, '/dashboard?tab=breakdowns');
    const bars = el.querySelector('[data-section="breakdowns"]')!;
    const lists = Array.from(bars.querySelectorAll('mf-bar-list'));
    // One title per card (H3), under a visually hidden H2 "Open Tasks"; the unit is said once in the caption (Breakdowns B5).
    expect(lists.map((l) => text(l.querySelector('h3')))).toEqual([
      'Priority',
      'Status',
      'Task Type',
    ]);
    expect(text(bars.querySelector('mf-stacked-bar h3'))).toBe('Age');
    expect(text(bars.querySelector('h2.sr-only'))).toBe('Open Tasks');
    expect(bars.querySelectorAll('h2').length).toBe(1);
    expect(text(bars.querySelector('[data-bd-caption]'))).toContain(
      'Open tasks, now. Not affected by the period.',
    );
    expect(bars.textContent).not.toMatch(/Open by|Open tasks by/);
    expect(bars.textContent).not.toContain('Open by pod');
    // Reading order of the cards = DOM order (the three columns of the wide layout: Priority and Status, Task type, Age).
    expect(Array.from(bars.querySelectorAll('h3')).map((h) => h.textContent!.trim())).toEqual([
      'Priority',
      'Status',
      'Task Type',
      'Age',
    ]);

    // Every bar is split into not overdue and overdue: the text links to the queue with overdue=true.
    const critical0 = lists[0].querySelector('li')!;
    expect(text(critical0.querySelector('.od-text'))).toContain('2 overdue');
    expect(critical0.querySelector('.od-text')!.getAttribute('href')).toContain(
      'priority=1&overdue=true',
    );
    expect(lists[2].querySelectorAll('li')[1].querySelector('.od-text')).toBeNull();
    expect(text(bars.querySelector('mf-stacked-bar .od-text'))).toContain('3 overdue');
    expect(bars.querySelector('[data-bd-legend]')!.textContent).toContain('Overdue');

    const typeRows = Array.from(lists[2].querySelectorAll('li'));
    expect(
      typeRows.map((r) =>
        [
          r.querySelector('.name')?.textContent,
          r.querySelector('.count')?.textContent,
          r.querySelector('.pct')?.textContent,
        ].join(' '),
      ),
    ).toEqual(['Data Processing 50 88%', 'Other task types 7 12%']);
    expect(typeRows[0].querySelector('a')!.getAttribute('href')).toContain('type=3');

    const critical = lists[0].querySelector<HTMLElement>('.bar')!;
    expect(critical.style.background).toContain('--mf-pr-critical-bg');
    expect(hrefs(el, 'mf-stacked-bar a')[0]).toContain('/tasks?');

    expect(text(bars.querySelector('[data-bd-caption]'))).toContain(
      'informational, not a service-level target',
    );
    // Every chart has the Bars | Pie | Table switch in its header; each card starts as bars.
    expect(bars.querySelectorAll('[data-view-switch]').length).toBe(4);
    expect(
      Array.from(bars.querySelectorAll('[data-view-switch]')).map((g) =>
        g.getAttribute('aria-label'),
      ),
    ).toEqual(['View of Priority', 'View of Status', 'View of Task Type', 'View of Age']);
    expect(
      Array.from(bars.querySelectorAll('[data-view-switch] [aria-pressed="true"]')).map((b) =>
        b.getAttribute('data-view'),
      ),
    ).toEqual(['bars', 'bars', 'bars', 'bars']);
    // Priority and status rows carry a coloured icon tile, task types get the coloured type chip when the row has an icon.
    expect(lists[0].querySelectorAll('[data-row-tile]').length).toBeGreaterThan(0);
    expect(el.textContent).not.toMatch(/billing|revenue|productivity/i);
  });

  it('shows the daily trend with its legend and data table on the Trends tab, read with the period from its own request', async () => {
    const el = await open(of(summary()), ALL, '/dashboard?tab=trends');
    expect(getDashboardTrend).toHaveBeenCalledWith(
      '30d',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'all',
    );
    const trend = el.querySelector('[data-section="trend"] mf-dash-trends-tab')!;
    expect(trend.querySelector('[data-plot] svg')).not.toBeNull();
    expect(text(trend.querySelector('[data-legend="created"]'))).toBe('Created 9');
    expect(text(trend.querySelector('[data-legend="completed"]'))).toBe('Completed 6');
    // The header has two toggles (Hide backlog, View as table): the table one is the last.
    Array.from(trend.querySelectorAll<HTMLButtonElement>('.toggle')).pop()!.click();
    harness.detectChanges();
    expect(trend.querySelectorAll('tbody tr').length).toBe(3);
  });

  it('works when browser storage is blocked: tabs and the address still work', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const el = await open();
    expect(el.querySelector('[data-dash-cards]')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('[data-tab="trends"]')!.click();
    await settle();
    expect(el.querySelector('[data-tabpanel="trends"]')).not.toBeNull();
    expect(TestBed.inject(Router).url).toBe('/dashboard?tab=trends');
  });

  it('refreshes on the button without a loading state, bypassing the server cache', async () => {
    const el = await open();
    const before = el.querySelector('[data-dash-cards]');
    el.querySelector<HTMLButtonElement>('[data-refresh]')!.click();
    expect(el.querySelector('[aria-busy="true"][aria-label]')).toBeNull();
    await settle();
    expect(getDashboard).toHaveBeenLastCalledWith(
      '30d',
      undefined,
      undefined,
      undefined,
      true,
      'all',
    );
    expect(el.querySelector('[data-dash-cards]')).toBe(before);
  });

  it('keeps keyboard focus on Refresh while it works (aria-disabled, not disabled) and announces when it is done', async () => {
    const el = await open();
    document.body.appendChild(el);
    const pending = new Subject<DashboardSummary>();
    getDashboard.mockReturnValue(pending);
    const button = el.querySelector<HTMLButtonElement>('[data-refresh]')!;
    button.focus();
    button.click();
    harness.detectChanges();
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(button);

    // A second press while it is working does not start another read.
    button.click();
    expect(getDashboard).toHaveBeenCalledTimes(2);

    pending.next(summary());
    pending.complete();
    await settle();
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(text(el.querySelector('[data-dash-live]'))).toContain('Dashboard refreshed. Updated');
    el.remove();
  });

  it('refreshes by itself every five minutes while the tab is visible and keeps the page in place', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const el = await open();
    const tick = spy.mock.calls.find((c) => c[1] === AUTO_REFRESH_MS)![0] as () => void;
    expect(AUTO_REFRESH_MS).toBe(300_000);
    const before = el.querySelector('[data-lists]');

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    tick();
    await settle();
    expect(getDashboard).toHaveBeenCalledTimes(1);

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    tick();
    await settle();
    expect(getDashboard).toHaveBeenCalledTimes(2);
    expect(getDashboard).toHaveBeenLastCalledWith(
      '30d',
      undefined,
      undefined,
      undefined,
      undefined,
      'all',
    );
    expect(el.querySelector('[data-lists]')).toBe(before);
  });

  it('does not refresh by itself while an assignee menu is open, and refreshes only the shared summary on other tabs', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const el = await open(of(summary()), ALL, '/dashboard?tab=breakdowns');
    const tick = spy.mock.calls.find((c) => c[1] === AUTO_REFRESH_MS)![0] as () => void;
    const menu = document.createElement('mf-dash-task-list');
    menu.innerHTML = '<div class="im-pop"></div>';
    document.body.appendChild(menu);
    tick();
    await settle();
    expect(getDashboard).toHaveBeenCalledTimes(1);
    menu.remove();

    tick();
    await settle();
    // One summary read; the lists belong to the Summary tab, which is not shown.
    expect(getDashboard).toHaveBeenCalledTimes(2);
    expect(getTaskQueue).not.toHaveBeenCalled();
    expect(el.querySelector('[data-tabpanel="breakdowns"]')).not.toBeNull();
  });

  it('keeps the figures and says so in the banner when a background refresh fails, with Retry and without a second toast', async () => {
    const el = await open();
    const quiet = TestBed.inject(QuietRequests);
    const run = vi.spyOn(quiet, 'run');
    getDashboard.mockReturnValue(throwError(() => new Error('boom')));
    el.querySelector<HTMLButtonElement>('[data-refresh]')!.click();
    await settle();
    expect(el.querySelector('[data-dash-state="stale"]')!.textContent).toContain(
      "Couldn't refresh.",
    );
    expect(el.querySelector('[data-dash-state="error"]')).toBeNull();
    expect(el.querySelector('[data-dash-cards]')).not.toBeNull();
    // The refresh ran quietly (no generic error toast); the banner is the one message.
    expect(run).toHaveBeenCalledTimes(1);

    getDashboard.mockReturnValue(of(summary()));
    el.querySelector<HTMLButtonElement>('[data-dash-state="stale"] [data-dash-retry]')!.click();
    await settle();
    expect(el.querySelector('[data-dash-state="stale"]')).toBeNull();
  });

  it('shows the empty state only to people who can see department figures, with a create button only if they can create tasks', async () => {
    const empty = summary({
      open: count(0, OPEN),
      created: count(0, 'createdFrom=2026-09-15'),
      completed: count(0, 'status=COMPLETED&completedFrom=2026-09-15'),
    });
    // Without Dashboard.ViewSummary the server returns zeros for the counts: that must not read as "no tasks".
    let el = await open(of(empty), ['Task.View', 'Dashboard.View', 'Dashboard.ViewTrends']);
    expect(el.querySelector('[data-empty]')).toBeNull();
    // A role with one tab has no tab list: its name is the page heading and the panel is a labelled region (R3).
    expect(el.querySelector('[role="tablist"]')).toBeNull();
    expect(el.querySelector('h1')!.textContent).toContain('Trends');
    expect(el.querySelector('[role="tabpanel"]')).toBeNull();
    expect(el.querySelector('[data-refresh]')).not.toBeNull();

    TestBed.resetTestingModule();
    el = await open(of(empty), ['Task.View', ...DATA_TABS]);
    expect(el.querySelector('[data-empty]')!.textContent).toContain('No open tasks');
    expect(el.querySelector('[role="tablist"]')).toBeNull();
    expect(el.querySelector('a[href="/tasks/new"]')).toBeNull();

    TestBed.resetTestingModule();
    el = await open(of(empty), ['Task.View', 'Task.Create', ...DATA_TABS]);
    expect(el.querySelector('a[href="/tasks/new"]')!.textContent).toContain(
      'Create the First Task',
    );
  });

  it('shows a loading placeholder while waiting', async () => {
    const el = await open(NEVER);
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('keeps the same Refresh button, and the focus on it, when the first read finishes', async () => {
    const first = new Subject<DashboardSummary>();
    const el = await open(first);
    document.body.appendChild(el);
    const button = el.querySelector<HTMLButtonElement>('[data-refresh]')!;
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
    button.focus();

    first.next(summary());
    first.complete();
    await settle();

    expect(el.querySelector('[aria-busy="true"]')).toBeNull();
    expect(el.querySelector('[data-dash-cards]')).not.toBeNull();
    expect(el.querySelectorAll('[data-refresh]').length).toBe(1);
    expect(el.querySelector('[data-refresh]')).toBe(button);
    expect(document.activeElement).toBe(button);
    el.remove();
  });

  it('shows an error with Retry that loads again', async () => {
    const el = await open(throwError(() => new Error('boom')));
    expect(el.querySelector('[data-dash-state="error"]')!.textContent).toContain(
      "Couldn't load the dashboard.",
    );

    getDashboard.mockReturnValue(of(summary()));
    el.querySelector<HTMLButtonElement>('[data-dash-state="error"] [data-dash-retry]')!.click();
    await settle();
    expect(getDashboard).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-dash-state="error"]')).toBeNull();
    expect(el.querySelector('[data-dash-cards]')).not.toBeNull();
  });

  describe('shell foundations (UX review 2, WP1)', () => {
    const tabRow = (el: HTMLElement) => el.querySelector('mf-dash-tabs [role="tablist"]');
    const boom = () => throwError(() => new Error('boom'));

    it('P2: a failing summary does not blank Users or Swimlane, and they never ask for it', async () => {
      for (const tab of ['users', 'swimlane']) {
        TestBed.resetTestingModule();
        const el = await open(boom(), ALL, `/dashboard?tab=${tab}`);
        expect(getDashboard).not.toHaveBeenCalled();
        expect(tabRow(el)).not.toBeNull();
        expect(el.querySelector(`[data-tabpanel="${tab}"]`)).not.toBeNull();
        expect(el.querySelector('[data-dash-state="error"]')).toBeNull();
        expect(el.querySelector('mf-dash-tabs [data-refresh]')).not.toBeNull();
      }
    });

    it('P2/P7: a failing summary shows one inline error inside the Summary panel; tab row, Refresh and period stay; Retry loads again', async () => {
      const el = await open(boom());
      const panel = el.querySelector('[data-tabpanel="summary"]')!;
      expect(panel.querySelector('[data-dash-state="error"]')).not.toBeNull();
      expect(el.querySelectorAll('[role="alert"]').length).toBe(1);
      expect(tabRow(el)).not.toBeNull();
      expect(el.querySelector('mf-dash-tabs [data-refresh]')).not.toBeNull();
      expect(text(panel)).toContain("Couldn't load the dashboard.");
      // The other tabs are one click away and keep their own panels.
      getDashboard.mockReturnValue(of(summary()));
      el.querySelector<HTMLButtonElement>('[data-dash-state="error"] [data-dash-retry]')!.click();
      await settle();
      expect(el.querySelector('[data-dash-state="error"]')).toBeNull();
      expect(el.querySelector('[data-dash-cards]')).not.toBeNull();
    });

    it('P2: a deep link to Trends with a failing summary keeps its address and its tab row', async () => {
      const el = await open(boom(), ALL, '/dashboard?tab=trends&types=3');
      expect(el.querySelector('[data-tabpanel="trends"] [data-dash-state="error"]')).not.toBeNull();
      expect(tabRow(el)).not.toBeNull();
      expect(TestBed.inject(Router).url).toBe('/dashboard?tab=trends&types=3');
    });

    it('P2: Users and Swimlane can be reached from a failed Summary', async () => {
      const el = await open(boom());
      el.querySelector<HTMLButtonElement>('[data-tab="users"]')!.click();
      await settle();
      expect(el.querySelector('[data-tabpanel="users"]')).not.toBeNull();
      expect(el.querySelector('[data-dash-state="error"]')).toBeNull();
    });

    it('P2: Summary, Breakdowns and Trends share one payload: switching among them within a minute does not refetch', async () => {
      const el = await open();
      expect(getDashboard).toHaveBeenCalledTimes(1);
      for (const tab of ['breakdowns', 'trends', 'summary', 'breakdowns']) {
        el.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)!.click();
        await settle();
      }
      expect(getDashboard).toHaveBeenCalledTimes(1);
    });

    it('P2: coming back to a summary tab after a minute reads it again in the background, keeping the figures', async () => {
      const el = await open();
      el.querySelector<HTMLButtonElement>('[data-tab="users"]')!.click();
      await settle();
      clockMs += 61_000;
      el.querySelector<HTMLButtonElement>('[data-tab="breakdowns"]')!.click();
      await settle();
      expect(getDashboard).toHaveBeenCalledTimes(2);
      expect(el.querySelector('[data-tabpanel="breakdowns"]')).not.toBeNull();
    });

    it('P2: the five-minute timer reads the summary only while a summary tab is shown', async () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      const el = await open(of(summary()), ALL, '/dashboard?tab=users');
      const tick = spy.mock.calls.find((c) => c[1] === AUTO_REFRESH_MS)![0] as () => void;
      tick();
      await settle();
      expect(getDashboard).not.toHaveBeenCalled();
      el.querySelector<HTMLButtonElement>('[data-tab="breakdowns"]')!.click();
      await settle();
      expect(getDashboard).toHaveBeenCalledTimes(1);
      clockMs += AUTO_REFRESH_MS;
      tick();
      await settle();
      expect(getDashboard).toHaveBeenCalledTimes(2);
    });

    describe('P6: staleness text', () => {
      const ageText = (el: HTMLElement) => text(el.querySelector('[data-stale-age]'));
      async function openWithClock() {
        const spy = vi.spyOn(globalThis, 'setInterval');
        const el = await open();
        const check = spy.mock.calls.find((c) => c[1] === STALE_CHECK_MS)![0] as () => void;
        const advance = async (minutes: number) => {
          clockMs = T0 + minutes * 60_000;
          check();
          await settle();
        };
        return { el, advance };
      }

      it('shows nothing in a fresh session and at 9 minutes, "Updated 10 m ago" at 10', async () => {
        const { el, advance } = await openWithClock();
        expect(el.querySelector('[data-stale-age]')).toBeNull();
        await advance(9);
        expect(el.querySelector('[data-stale-age]')).toBeNull();
        expect(el.querySelector('[data-refresh]')!.getAttribute('aria-label')).toBe('Refresh');
        await advance(10);
        expect(ageText(el)).toBe('Updated 10 m ago');
        expect(el.querySelector('[data-stale-age] .pi')).not.toBeNull();
        expect(el.querySelector('[data-refresh]')!.getAttribute('aria-label')).toBe(
          'Refresh. Updated 10 m ago.',
        );
        await advance(14);
        expect(ageText(el)).toBe('Updated 14 m ago');
      });

      it('sits in a polite live region that exists before the text appears', async () => {
        const { el } = await openWithClock();
        const live = el.querySelector('[data-stale-age-live]')!;
        expect(live.getAttribute('role')).toBe('status');
        expect(live.getAttribute('aria-live')).toBe('polite');
      });

      it('disappears after a successful refresh', async () => {
        const { el, advance } = await openWithClock();
        await advance(12);
        expect(ageText(el)).toBe('Updated 12 m ago');
        el.querySelector<HTMLButtonElement>('[data-refresh]')!.click();
        await settle();
        expect(el.querySelector('[data-stale-age]')).toBeNull();
      });

      it('does not repeat itself while the failed-refresh banner is shown', async () => {
        const { el, advance } = await openWithClock();
        getDashboard.mockReturnValue(boom());
        await advance(12);
        el.querySelector<HTMLButtonElement>('[data-refresh]')!.click();
        await settle();
        expect(el.querySelector('[data-dash-state="stale"]')).not.toBeNull();
        expect(el.querySelector('[data-stale-age]')).toBeNull();
      });

      it('follows the tab shown: the Users tab starts its own clock', async () => {
        const { el, advance } = await openWithClock();
        el.querySelector<HTMLButtonElement>('[data-tab="users"]')!.click();
        await settle();
        await advance(11);
        expect(ageText(el)).toBe('Updated 11 m ago');
      });
    });

    describe('R1: note when a link points to a tab the role cannot see', () => {
      const POD_LEAD: Permission[] = [
        'Task.View',
        'Dashboard.View',
        'Dashboard.ViewSummary',
        'Dashboard.ViewSwimlane',
      ];
      const note = (el: HTMLElement) => el.querySelector('[data-dash-note]');

      it('names the forbidden tab, falls back to the first permitted one and rewrites the address', async () => {
        const el = await open(of(summary()), POD_LEAD, '/dashboard?tab=breakdowns');
        expect(text(note(el))).toBe('Breakdowns is not available for your role. Showing Summary.');
        expect(note(el)!.getAttribute('role')).toBe('status');
        expect(TestBed.inject(Router).url).toBe('/dashboard?tab=summary');
        expect(el.querySelector('[data-tabpanel="summary"]')).not.toBeNull();
      });

      it('says so for a tab that does not exist', async () => {
        const el = await open(of(summary()), POD_LEAD, '/dashboard?tab=xyz');
        expect(text(note(el))).toBe('That tab does not exist. Showing Summary.');
      });

      it('shows no note to a role that may open the tab, nor on a plain link', async () => {
        let el = await open(of(summary()), ALL, '/dashboard?tab=breakdowns');
        expect(note(el)).toBeNull();
        TestBed.resetTestingModule();
        el = await open(of(summary()), POD_LEAD);
        expect(note(el)).toBeNull();
      });

      it('can be dismissed, and goes away when another tab is chosen', async () => {
        const el = await open(of(summary()), POD_LEAD, '/dashboard?tab=breakdowns');
        el.querySelector<HTMLButtonElement>('[data-dash-note-close]')!.click();
        await settle();
        expect(note(el)).toBeNull();
        TestBed.resetTestingModule();
        const el2 = await open(of(summary()), POD_LEAD, '/dashboard?tab=trends');
        expect(note(el2)).not.toBeNull();
        el2.querySelector<HTMLButtonElement>('[data-tab="swimlane"]')!.click();
        await settle();
        expect(note(el2)).toBeNull();
      });

      it('names the first permitted tab when it is not Summary', async () => {
        const el = await open(
          of(summary()),
          ['Dashboard.View', 'Dashboard.ViewSwimlane'],
          '/dashboard?tab=users',
        );
        expect(text(note(el))).toBe('Users is not available for your role. Showing Swimlane.');
        expect(TestBed.inject(Router).url).toBe('/dashboard?tab=swimlane');
      });
    });

    it('P9: opening a Swimlane-only user at ?tab=swimlane leaves the address exactly as it was', async () => {
      const navigate = vi.spyOn(Router.prototype, 'navigate');
      await open(
        of(summary()),
        ['Dashboard.View', 'Dashboard.ViewSwimlane'],
        '/dashboard?tab=swimlane',
      );
      expect(TestBed.inject(Router).url).toBe('/dashboard?tab=swimlane');
      // Whatever the tab asks the router for removes defaults only: no parameter is added.
      for (const [, extras] of navigate.mock.calls) {
        expect(Object.values(extras?.queryParams ?? {}).every((v) => v === null)).toBe(true);
      }
    });

    it('P9: default values written explicitly are removed with replace, not push', async () => {
      const navigate = vi.spyOn(Router.prototype, 'navigate');
      await open(
        of(summary()),
        ['Dashboard.View', 'Dashboard.ViewSwimlane'],
        '/dashboard?tab=swimlane&group=none&sort=priority&days=7',
      );
      expect(TestBed.inject(Router).url).toBe('/dashboard?tab=swimlane');
      expect(navigate.mock.calls.every(([, extras]) => extras?.replaceUrl === true)).toBe(true);
    });

    it('P9: unknown parameters are dropped when the address is normalised', async () => {
      await open(of(summary()), ALL, '/dashboard?tab=breakdowns&utm_source=mail');
      expect(TestBed.inject(Router).url).toBe('/dashboard?tab=breakdowns');
    });
  });
  describe('page-wide Scope (P1)', () => {
    const router = () => TestBed.inject(Router);
    const select = (el: HTMLElement) => ddSelect(el, 'Scope');
    const pickScope = async (el: HTMLElement, value: string) => {
      const sel = select(el);
      sel.value = value;
      sel.dispatchEvent(new Event('change'));
      await settle();
    };

    it('someone in no pod gets All pods, sends podScope=all and has a labelled Scope select in the tab row, left of Refresh', async () => {
      const el = await open();
      expect(getDashboardScopes).toHaveBeenCalledTimes(1);
      const sel = select(el);
      expect(sel.value).toBe('all');
      expect(text(el.querySelector('.sc-lbl'))).toBe('Scope');
      expect(Array.from(sel.options).map((o) => o.textContent!.trim())).toEqual(['All Pods']);
      const row = el.querySelector('[data-dash-head]')!;
      expect(row.contains(sel.button)).toBe(true);
      const refresh = row.querySelector('[data-refresh]')!;
      expect(
        sel.button.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(getDashboard).toHaveBeenCalledWith(
        '30d',
        undefined,
        undefined,
        undefined,
        undefined,
        'all',
      );
      expect(router().url).toBe('/dashboard');
    });

    it('a member of a pod gets My pods by default (not written to the address), whatever their role', async () => {
      scopeChoices = aMemberChoices();
      const el = await open();
      expect(select(el).value).toBe('mine');
      expect(Array.from(select(el).options).map((o) => o.textContent!.trim())).toEqual([
        'All Pods',
        'My Pods',
        'Review Alpha',
        'Review Beta',
        'Processing',
      ]);
      expect(getDashboard).toHaveBeenCalledWith(
        '30d',
        undefined,
        undefined,
        undefined,
        undefined,
        'mine',
      );
      expect(router().url).toBe('/dashboard');
    });

    it('a link names the scope and wins over the memory, which it does not change', async () => {
      scopeChoices = aMemberChoices();
      localStorage.setItem('mf.dashboard.scope.v1.1', 'all');
      const el = await open(of(summary()), ALL, '/dashboard?tab=trends&pod=3');
      expect(select(el).value).toBe('3');
      expect(getDashboard).toHaveBeenCalledWith(
        '30d',
        undefined,
        undefined,
        undefined,
        undefined,
        '3',
      );
      expect(getDashboardTrend).toHaveBeenCalledWith(
        '30d',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        '3',
      );
      expect(router().url).toBe('/dashboard?tab=trends&pod=3');
      expect(localStorage.getItem('mf.dashboard.scope.v1.1')).toBe('all');
    });

    it('uses the remembered choice when the link names none', async () => {
      scopeChoices = aMemberChoices();
      localStorage.setItem('mf.dashboard.scope.v1.1', 'all');
      const el = await open();
      expect(select(el).value).toBe('all');
      expect(getDashboard).toHaveBeenCalledWith(
        '30d',
        undefined,
        undefined,
        undefined,
        undefined,
        'all',
      );
    });

    it('a pod the person may not see falls back to the default with a note, and the address loses the parameter', async () => {
      scopeChoices = aMemberChoices();
      const el = await open(of(summary()), ALL, '/dashboard?pod=99');
      expect(select(el).value).toBe('mine');
      expect(text(el.querySelector('mf-dash-note'))).toContain(
        'That pod is not available to you. Showing My Pods.',
      );
      expect(router().url).toBe('/dashboard');
      expect(getDashboard).toHaveBeenCalledWith(
        '30d',
        undefined,
        undefined,
        undefined,
        undefined,
        'mine',
      );
      expect(el.querySelector('[data-dash-state="error"]')).toBeNull();
    });

    it('reads the old Users pod filter once into pod and rewrites the address', async () => {
      scopeChoices = aMemberChoices();
      const el = await open(of(summary()), ALL, '/dashboard?tab=users&upod=3&uavail=out');
      expect(router().url).toBe('/dashboard?tab=users&pod=3&uavail=out');
      expect(select(el).value).toBe('3');
      // uavail=out is the Out of office state now, applied on the page: the API is asked for everyone.
      expect(getDashboardWorkload).toHaveBeenLastCalledWith(
        undefined,
        'all',
        undefined,
        '3',
        false,
      );
    });

    it('choosing a scope reads the figures and lists again for it, writes pod to the address, remembers it and announces it', async () => {
      scopeChoices = aMemberChoices();
      const el = await open();
      const readsBefore = getTaskQueue.mock.calls.length;
      await pickScope(el, '3');
      expect(getDashboard).toHaveBeenLastCalledWith(
        '30d',
        undefined,
        undefined,
        undefined,
        true,
        '3',
      );
      expect(getTaskQueue.mock.calls.length).toBeGreaterThan(readsBefore);
      expect(router().url).toBe('/dashboard?pod=3');
      expect(localStorage.getItem('mf.dashboard.scope.v1.1')).toBe('3');
      expect(text(el.querySelector('[data-dash-live]'))).toBe('Scope: Processing');

      // Back to the default: the parameter leaves the address.
      await pickScope(el, 'mine');
      expect(router().url).toBe('/dashboard');
      expect(text(el.querySelector('[data-dash-live]'))).toBe('Scope: My Pods');
    });

    it('shows the skeleton while the new scope is read, never the old numbers under the new label', async () => {
      scopeChoices = aMemberChoices();
      const el = await open();
      getDashboard.mockReturnValue(NEVER);
      await pickScope(el, '1');
      expect(
        el.querySelector(
          '[data-tabpanel="summary"] mf-dash-skeleton[aria-busy="true"] [role="status"]',
        ),
      ).not.toBeNull();
      expect(el.querySelector('mf-stat-tile')).toBeNull();
      expect(select(el).value).toBe('1');
    });

    it('keeps the scope when the tab changes and reads only the tab on screen', async () => {
      scopeChoices = aMemberChoices();
      const el = await open(of(summary()), ALL, '/dashboard?pod=2');
      el.querySelector<HTMLButtonElement>('[data-tab="users"]')!.click();
      await settle();
      expect(router().url).toBe('/dashboard?pod=2&tab=users');
      expect(getDashboardWorkload).toHaveBeenLastCalledWith(
        undefined,
        'all',
        undefined,
        '2',
        false,
      );
      const summaryReads = getDashboard.mock.calls.length;
      await pickScope(el, '1');
      expect(getDashboard.mock.calls.length).toBe(summaryReads);
      expect(getDashboardWorkload).toHaveBeenLastCalledWith(
        undefined,
        'all',
        undefined,
        '1',
        false,
      );
      expect(router().url).toBe('/dashboard?pod=1&tab=users');

      // Swimlane gets it too, and the summary tabs read it when opened.
      el.querySelector<HTMLButtonElement>('[data-tab="swimlane"]')!.click();
      await settle();
      expect(getDashboardSwimlane.mock.calls.at(-1)?.at(-1)).toBe('1');
      el.querySelector<HTMLButtonElement>('[data-tab="summary"]')!.click();
      await settle();
      expect(getDashboard).toHaveBeenLastCalledWith(
        '30d',
        undefined,
        undefined,
        undefined,
        true,
        '1',
      );
    });

    it('says how many unassigned tasks have no pod under a Pod scope, with a link that sets All pods; nothing under All pods', async () => {
      scopeChoices = aMemberChoices();
      const scoped = summary({ scope: { scope: 'mine', podIds: [1, 2], unassignedNoPod: 4 } });
      const el = await open(of(scoped));
      const hint = el.querySelector('[data-no-pod-hint]')!;
      expect(text(hint)).toBe('4 unassigned tasks have no pod. Show All Pods');
      getDashboard.mockReturnValue(of(summary()));
      (hint.querySelector('[data-show-all-pods]') as HTMLAnchorElement).click();
      await settle();
      expect(router().url).toBe('/dashboard?pod=all');
      expect(select(el).value).toBe('all');
      expect(el.querySelector('[data-no-pod-hint]')).toBeNull();
    });

    it('the singular and the zero case of the hint', async () => {
      scopeChoices = aMemberChoices();
      const one = await open(
        of(summary({ scope: { scope: 'mine', podIds: [1], unassignedNoPod: 1 } })),
      );
      expect(text(one.querySelector('[data-no-pod-hint]'))).toContain(
        '1 unassigned task has no pod.',
      );
      TestBed.resetTestingModule();
      const none = await open(
        of(summary({ scope: { scope: 'mine', podIds: [1], unassignedNoPod: 0 } })),
      );
      expect(none.querySelector('[data-no-pod-hint]')).toBeNull();
    });

    it('an empty pod still shows the tabs and the Scope select (only an empty department hides them)', async () => {
      scopeChoices = aMemberChoices();
      const empty = summary({
        open: count(0, OPEN),
        created: count(0, 'createdFrom=2026-09-15'),
        completed: count(0, 'status=COMPLETED'),
        unassigned: count(0, `${OPEN}&unassigned=true`),
        overdue: count(0, OPEN),
        dueSoon: count(0, OPEN),
        onHold: count(0, 'status=ON_HOLD'),
        asapOpen: count(0, OPEN),
        overdueCritical: count(0, OPEN),
        overdueHigh: count(0, OPEN),
        scope: { scope: 'mine', podIds: [1], unassignedNoPod: 0 },
      });
      const el = await open(of(empty));
      expect(el.querySelector('[data-empty]')).toBeNull();
      expect(el.querySelector('[role="tablist"]')).not.toBeNull();
      expect(select(el)).not.toBeNull();
    });

    it('the Technician variant (Unassigned only, no tab row) still has the control next to the heading and Refresh', async () => {
      const el = await open(of(summary()), [
        'Dashboard.View',
        'Dashboard.ViewUnassigned',
        'Task.View',
      ]);
      expect(el.querySelector('[role="tablist"]')).toBeNull();
      expect(select(el)).not.toBeNull();
      expect(el.querySelector('[data-refresh]')).not.toBeNull();
    });
  });

  describe('Technician Summary (S9)', () => {
    const TECH: Permission[] = ['Task.View', 'Dashboard.View', 'Dashboard.ViewUnassigned'];
    const router = () => TestBed.inject(Router);
    const mine = { open: 6, overdue: 1 };
    const unassignedArgs = (query: string) => queueArgsFor(query, 'priorityAge', 'asc', 5);

    it('is titled "Unassigned work", has no tab row, and tells the person their own load with a link to My Work', async () => {
      const el = await open(of(summary({ mine })), TECH);
      expect(el.querySelector('h1')!.textContent).toContain('Unassigned work');
      expect(el.querySelector('[role="tablist"]')).toBeNull();
      expect(text(el.querySelector('[data-own-work]'))).toBe(
        'You have 6 open, 1 overdue. Open My Work',
      );
      expect(el.querySelector('[data-my-work-link]')!.getAttribute('href')).toBe('/my-work');
      // The page Scope sits in the heading row; Priority and Task type are the filters of the foundation.
      expect(el.querySelector('[data-dash-head] mf-dropdown[data-scope]')).not.toBeNull();
      expect(
        Array.from(el.querySelectorAll('[data-tech-bar] [data-field]')).map((f) =>
          f.getAttribute('data-field'),
        ),
      ).toEqual(['sprio', 'stype']);
      expect(el.querySelector('[data-tech-bar] mf-filter-control')).not.toBeNull();
    });

    it('has no strip and no own-work line for a Director, or for ViewSummary together with ViewUnassigned', async () => {
      let el = await open(of(summary({ mine })));
      expect(el.querySelector('[data-tech-bar], [data-own-work]')).toBeNull();
      expect(el.querySelector('h1')!.textContent).toContain('Dashboard');
      TestBed.resetTestingModule();
      el = await open(of(summary({ mine })), [...TECH, 'Dashboard.ViewSummary']);
      expect(el.querySelector('[data-tech-bar], [data-own-work]')).toBeNull();
      expect(el.querySelector('[data-dash-cards]')).not.toBeNull();
    });

    it('leaves the line out when the API sent no own counts, and does not link to My Work without Task.View', async () => {
      let el = await open(of(summary()), TECH);
      expect(el.querySelector('[data-own-work]')).toBeNull();
      TestBed.resetTestingModule();
      el = await open(of(summary({ mine })), ['Dashboard.View', 'Dashboard.ViewUnassigned']);
      expect(text(el.querySelector('[data-own-work]'))).toBe('You have 6 open, 1 overdue.');
      expect(el.querySelector('[data-my-work-link]')).toBeNull();
    });

    it('reads the queue with the Priority and Task type of the address, and again from the first row when they change', async () => {
      const el = await open(of(summary({ mine })), TECH, '/dashboard?sprio=1,2&stype=3');
      const base = summary().unassigned.query;
      expect(getTaskQueue).toHaveBeenCalledWith(
        ...unassignedArgs(`${base}&priority=1&priority=2&type=3`),
      );
      expect(
        el.querySelector('[data-panel="unassigned"] [data-view-all]')!.getAttribute('href'),
      ).toContain('priority=1&priority=2&type=3');
      // Filter chips come from the foundation.
      expect(el.querySelector('mf-filter-chips')).not.toBeNull();
      getTaskQueue.mockClear();
      await router().navigate([], { queryParams: { sprio: '2' }, queryParamsHandling: 'merge' });
      await settle();
      expect(getTaskQueue).toHaveBeenCalledTimes(1);
      expect(getTaskQueue).toHaveBeenCalledWith(...unassignedArgs(`${base}&priority=2&type=3`));
      // Parameters that are not ids are dropped, not sent.
      getTaskQueue.mockClear();
      await router().navigate([], {
        queryParams: { sprio: 'x,0,5', stype: null },
        queryParamsHandling: 'merge',
      });
      await settle();
      expect(getTaskQueue).toHaveBeenCalledWith(...unassignedArgs(`${base}&priority=5`));
    });

    it('says when a filter hides everything and clears it, and when the scope does and widens it', async () => {
      unassignedRows = [];
      const none = () => of(pageOf([], { total: 0 }));
      let el = await open(of(summary({ mine })), TECH, '/dashboard?sprio=1&stype=3');
      getTaskQueue.mockImplementation(none);
      el.querySelector<HTMLButtonElement>('[data-dash-clear]');
      await router().navigate([], { queryParams: { sprio: '1' }, queryParamsHandling: 'merge' });
      await settle();
      expect(text(el.querySelector('[data-panel="unassigned"] [data-dash-state]'))).toContain(
        'No unassigned tasks match these filters.',
      );
      el.querySelector<HTMLButtonElement>('[data-dash-clear]')!.click();
      await settle();
      expect(router().url).toBe('/dashboard');

      TestBed.resetTestingModule();
      scopeChoices = aMemberChoices();
      el = await open(of(summary({ mine })), TECH);
      getTaskQueue.mockImplementation(none);
      await router().navigate([], { queryParams: { pod: '1' }, queryParamsHandling: 'merge' });
      await settle();
      await settle();
      expect(text(el.querySelector('[data-panel="unassigned"] [data-dash-state]'))).toContain(
        'Nothing is unassigned in Review Alpha.',
      );
      el.querySelector<HTMLButtonElement>('[data-dash-action]')!.click();
      await settle();
      expect(router().url).toBe('/dashboard?pod=all');
    });

    it('a person in no pod gets All pods with a quiet note; a pod member does not', async () => {
      let el = await open(of(summary({ mine })), TECH);
      expect(text(el.querySelector('[data-no-pod-note]'))).toBe(
        'You are not in a pod yet. Showing all pods.',
      );
      expect(ddSelect(el, 'Scope').value).toBe('all');
      TestBed.resetTestingModule();
      scopeChoices = aMemberChoices();
      el = await open(of(summary({ mine })), TECH);
      expect(el.querySelector('[data-no-pod-note]')).toBeNull();
      expect(ddSelect(el, 'Scope').value).toBe('mine');
    });
  });
});
