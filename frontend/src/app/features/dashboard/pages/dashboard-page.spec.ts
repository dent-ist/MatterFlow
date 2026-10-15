import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
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

const ALL: Permission[] = ['Task.View', ...DASH, 'Task.Create', 'Task.Assign', 'Pod.View'];

describe('DashboardPage', () => {
  let unassignedRows: TaskQueueRow[];
  let getDashboard: ReturnType<typeof vi.fn>;
  const getDashboardSwimlane = vi.fn(() => of(emptyBoard()));
  let getTaskQueue: ReturnType<typeof vi.fn>;
  let assignTask: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;

  async function open(
    response: unknown = of(summary()),
    permissions: Permission[] = ALL,
    url = '/dashboard',
  ) {
    getDashboard = vi.fn().mockReturnValue(response);
    getTaskQueue = vi.fn((...args: unknown[]) =>
      of(
        args[6] === true
          ? pageOf(unassignedRows, { total: 17 })
          : args[18] === true
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
        { provide: DashboardBoardClient, useValue: { getDashboardSwimlane } },
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
    await harness.navigateByUrl(url, DashboardPage);
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
    unassignedRows = [unassignedRow];
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  afterEach(() => vi.restoreAllMocks());

  it('puts Needs attention first: overdue, unassigned and on hold, each with a count, an icon and a link that says what it opens', async () => {
    const el = await open();
    expect(getDashboard).toHaveBeenCalledWith(30, undefined);

    const group = el.querySelector('[data-group="attention"]')!;
    expect(text(group.querySelector('h2'))).toBe('Needs attention');
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
    // Colour follows the pattern standard: On hold is the warning amber of its badge, Unassigned is neutral, ASAP is the quiet blue outline
    // (never the red of Overdue, and a smaller number than the three attention tiles).
    expect(tiles.map((t) => t.querySelector('a')!.getAttribute('data-tone'))).toEqual([
      'danger',
      'strong',
      'warning',
      'asap',
    ]);
    expect(tiles[3].querySelector('a')!.getAttribute('data-emphasis')).toBe('quiet');
    expect(tiles[3].querySelector('a')!.getAttribute('href')).toContain('asap=true');
    expect(tiles[0].querySelector('a')!.getAttribute('data-emphasis')).toBe('attention');
  });

  it('shows the quieter overview row (no ASAP tile: it is in Needs attention) and the period control beside it', async () => {
    const el = await open();
    const group = el.querySelector('[data-group="overview"]')!;
    const tiles = Array.from(group.querySelectorAll<HTMLElement>('mf-stat-tile'));
    expect(tiles.map((t) => text(t.querySelector('.label')))).toEqual([
      'Open',
      'Due soon',
      'Completed',
      'Created',
    ]);
    expect(tiles.map((t) => text(t.querySelector('.value')))).toEqual(['128', '6', '94', '101']);
    expect(tiles[2].textContent).toContain('Last 30 days');
    expect(tiles[3].textContent).toContain('Last 30 days');
    // Every tile has its own small icon next to the label.
    for (const t of tiles) expect(t.querySelector('.label .pi')).not.toBeNull();
    expect(tiles[2].querySelector('a')!.getAttribute('href')).toBe(
      '/tasks?status=COMPLETED&completedFrom=2026-09-15',
    );
    // The period control sits in the Overview row, named for what it changes, not in the page header.
    expect(group.querySelector('select[data-period]')).not.toBeNull();
    expect(text(group.querySelector('label.period'))).toContain('Completed and created in');
    expect(el.querySelector('mf-page-header select[data-period]')).toBeNull();
    expect(el.querySelector('[data-updated]')!.textContent).toContain(
      'Updated Oct 14, 2026, 3:42 PM',
    );
  });

  it('lays Summary out as tiles beside the unassigned queue with Overdue and Due soon in a row below, in this order', async () => {
    const el = await open();
    const panel = el.querySelector('[data-tabpanel="summary"] .summary')!;
    const parts = Array.from(panel.children).map((c) => c.className.split(' ')[0] || c.tagName);
    expect(parts).toEqual(['summary-tiles', 'summary-main', 'summary-more']);
    expect(
      Array.from(panel.querySelectorAll('.summary-main [data-panel]')).map((p) =>
        p.getAttribute('data-panel'),
      ),
    ).toEqual(['unassigned']);
    expect(
      Array.from(panel.querySelectorAll('.summary-more [data-panel]')).map((p) =>
        p.getAttribute('data-panel'),
      ),
    ).toEqual(['overdue', 'dueSoon']);
    // The two tile groups are the first thing in the tile column: Needs attention, then Overview.
    expect(
      Array.from(panel.querySelectorAll('.summary-tiles > [data-group]')).map((g) =>
        g.getAttribute('data-group'),
      ),
    ).toEqual(['attention', 'overview']);
  });

  it('puts focus back on Refresh when Retry in the failed-refresh banner succeeds', async () => {
    const el = await open();
    document.body.appendChild(el);
    getDashboard.mockReturnValueOnce(throwError(() => new Error('down')));
    el.querySelector<HTMLButtonElement>('[data-refresh]')!.click();
    await settle();
    const retry = el.querySelector<HTMLButtonElement>('[data-stale-retry]')!;
    retry.focus();
    getDashboard.mockReturnValue(of(summary()));
    retry.click();
    await settle();
    expect(el.querySelector('[data-stale]')).toBeNull();
    expect(document.activeElement).toBe(el.querySelector('[data-refresh]'));
    el.remove();
  });

  it('shows a tile that counts zero as calm text, not a link', async () => {
    const el = await open(of(summary({ overdue: count(0, `${OPEN}&overdue=true`) })));
    const tile = el.querySelector('[data-group="attention"] mf-stat-tile')!;
    expect(tile.querySelector('a')).toBeNull();
    expect(text(tile)).toContain('Overdue');
    expect(text(tile.querySelector('.value'))).toBe('0');
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

    it('opens on Summary, puts ?tab= in the address and the page header stays the only H1', async () => {
      const el = await open();
      expect(TestBed.inject(Router).url).toBe('/dashboard?tab=summary');
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
      expect(el.querySelector('[data-group="attention"]')).toBeNull();
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
      // The page header's Refresh (summary figures) steps aside; the board's refresh is an icon in the tab row, with no "Updated" text.
      expect(el.querySelector('mf-page-header [data-refresh]')).toBeNull();
      const icon = el.querySelector<HTMLButtonElement>('mf-dash-tabs [data-refresh-board]')!;
      expect(icon).not.toBeNull();
      expect(icon.getAttribute('aria-label')).toBe('Refresh board');
      expect(icon.textContent!.trim()).toBe('');
      expect(icon.closest('mf-dash-tabs')!.querySelector('[role="tablist"]')).not.toBeNull();
      expect(el.querySelector('[data-updated]')).toBeNull();

      tabButtons(el)[4].click();
      await settle();
      expect(text(selectedTab(el))).toBe('Users');
      const panel = el.querySelector('[data-tabpanel="users"]')!;
      expect(text(panel.querySelector('[data-users-soon]'))).toBe('Team workload is coming soon.');
      expect(el.querySelector('mf-page-header [data-refresh]')).toBeNull();
      expect(el.querySelector('[data-tabpanel="swimlane"]')).toBeNull();

      tabButtons(el)[0].click();
      await settle();
      expect(el.querySelector('mf-page-header [data-refresh]')).not.toBeNull();
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
      expect(TestBed.inject(Router).url).toBe('/dashboard?tab=summary');
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

    it('shares one summary request between the tabs and reads the lists only for Summary', async () => {
      const el = await open(of(summary()), ALL, '/dashboard?tab=breakdowns');
      expect(getDashboard).toHaveBeenCalledTimes(1);
      // Breakdowns needs no list: the Task Queue has not been asked anything.
      expect(getTaskQueue).not.toHaveBeenCalled();

      tabButtons(el)[2].click();
      await settle();
      expect(getDashboard).toHaveBeenCalledTimes(1);
      expect(getTaskQueue).not.toHaveBeenCalled();

      // Summary reads its three lists when it is first shown, and not again when it is shown again with nothing newer.
      tabButtons(el)[0].click();
      await settle();
      expect(getDashboard).toHaveBeenCalledTimes(1);
      expect(getTaskQueue).toHaveBeenCalledTimes(3);
      tabButtons(el)[1].click();
      await settle();
      tabButtons(el)[0].click();
      await settle();
      expect(getTaskQueue).toHaveBeenCalledTimes(3);
    });

    it('reads the lists again when Summary is shown after a refresh that happened on another tab', async () => {
      const el = await open();
      expect(getTaskQueue).toHaveBeenCalledTimes(3);
      tabButtons(el)[1].click();
      await settle();
      el.querySelector<HTMLButtonElement>('[data-refresh]')!.click();
      await settle();
      expect(getDashboard).toHaveBeenCalledTimes(2);
      // The refresh on Breakdowns did not read the lists.
      expect(getTaskQueue).toHaveBeenCalledTimes(3);
      tabButtons(el)[0].click();
      await settle();
      expect(getTaskQueue).toHaveBeenCalledTimes(6);
    });

    it('shows the period control only where it is used: the Overview row on Summary and the Trends tab, not on Breakdowns', async () => {
      const el = await open();
      expect(el.querySelectorAll('select[data-period]').length).toBe(1);
      expect(el.querySelector('[data-group="overview"] select[data-period]')).not.toBeNull();
      tabButtons(el)[1].click();
      await settle();
      expect(el.querySelector('select[data-period]')).toBeNull();
      tabButtons(el)[2].click();
      await settle();
      expect(el.querySelectorAll('select[data-period]').length).toBe(1);
      expect(el.querySelector('[data-section="trend"] select[data-period]')).not.toBeNull();
      expect(text(el.querySelector('label.period'))).toContain('Completed and created in');
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
      expect(el.querySelector('[data-error], [data-empty]')).toBeNull();
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
      expect(TestBed.inject(Router).url).toBe('/dashboard?tab=breakdowns');
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
      expect(el.querySelector('[data-refresh]')).toBeNull();
    });

    it('Summary tab with Task.Assign shows the Unassigned queue; without it only Overdue and Due soon', async () => {
      let el = await open(of(summary()), [
        'Task.View',
        'Task.Assign',
        'Dashboard.View',
        'Dashboard.ViewSummary',
      ]);
      expect(
        Array.from(el.querySelectorAll('[data-panel]')).map((p) => p.getAttribute('data-panel')),
      ).toEqual(['unassigned', 'overdue', 'dueSoon']);
      TestBed.resetTestingModule();
      el = await open(of(summary()), ['Task.View', 'Dashboard.View', 'Dashboard.ViewSummary']);
      expect(
        Array.from(el.querySelectorAll('[data-panel]')).map((p) => p.getAttribute('data-panel')),
      ).toEqual(['overdue', 'dueSoon']);
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
    const el = await open();
    const panel = el.querySelector('[data-panel="unassigned"]')!;
    expect(text(panel.querySelector('h3'))).toBe('Unassigned queue');
    expect(text(panel.querySelector('[data-order]'))).toBe('Highest priority first, then oldest.');
    expect(text(panel.querySelector('[data-total]'))).toBe('17');
    const row = panel.querySelector('li')!;
    expect(row.querySelector('a.main')!.getAttribute('href')).toBe('/tasks/21');
    expect(text(row.querySelector('.ref'))).toBe('TSK-21');
    expect(text(row.querySelector('.title'))).toBe('Unassigned intake');
    expect(text(row.querySelector('mf-matter-ref'))).toContain('00343-00012');
    expect(row.querySelector('mf-priority-badge')!.textContent).toContain('Critical');
    expect(text(row.querySelector('[data-age]'))).toBe('10 days old');
    expect(row.querySelector('mf-row-edit [data-inline-trigger]')).not.toBeNull();
    expect(row.querySelector('[data-assign-me]')).not.toBeNull();
    expect(panel.querySelector<HTMLAnchorElement>('[data-view-all]')!.getAttribute('href')).toBe(
      '/tasks?status=NEW&status=IN_PROGRESS&status=ON_HOLD&unassigned=true&sort=priorityAge&dir=asc',
    );
    // The list asks the Task Queue for priority then age, 8 rows.
    const call = getTaskQueue.mock.calls.find((c) => c[6] === true)!;
    expect(call.slice(22)).toEqual(['priorityAge', 'asc', 1, 8]);
  });

  it('keeps the tab stops down: a row has one link and its actions, the matter reference is plain text, and a list can be skipped', async () => {
    unassignedRows = [
      unassignedRow,
      secondUnassigned,
      { ...secondUnassigned, taskId: 25, taskNumber: 'TSK-25' },
    ];
    const el = await open();
    const row = el.querySelector('[data-panel="unassigned"] li')!;
    // Task link, the assignee menu and Assign to me; no matter link and no copy button.
    expect(row.querySelectorAll('a').length).toBe(1);
    expect(row.querySelectorAll('button').length).toBe(2);
    expect(row.querySelector('mf-matter-ref a')).toBeNull();
    const overdueRow = el.querySelector('[data-panel="overdue"] li')!;
    expect(overdueRow.querySelectorAll('a, button').length).toBe(1);

    // "Skip ... list" is the first stop of a long list and moves focus to the next list's heading.
    const skip = el.querySelector<HTMLButtonElement>('[data-panel="unassigned"] [data-skip]')!;
    expect(text(skip)).toBe('Skip Unassigned queue list');
    skip.click();
    expect(document.activeElement).toBe(el.querySelector('[data-section="lists-more"] h2'));
    // A one-row list has nothing to skip.
    expect(el.querySelector('[data-panel="overdue"] [data-skip]')).toBeNull();
  });

  it('shows the Unassigned queue only to people who may assign, and then with the assignee editor', async () => {
    const el = await open(of(summary()), ['Task.View', ...DASH]);
    expect(el.querySelector('[data-panel="unassigned"]')).toBeNull();
    expect(
      Array.from(el.querySelectorAll('[data-panel]')).map((p) => p.getAttribute('data-panel')),
    ).toEqual(['overdue', 'dueSoon']);
    // The Unassigned tile (a count and a link to the queue) stays.
    expect(el.querySelector('[data-group="attention"]')!.textContent).toContain('Unassigned');
    // The first list of a page can be skipped; the last one has nothing after it to skip to.
    const rows = [overdueRow, { ...overdueRow, taskId: 31, taskNumber: 'TSK-31' }];
    getTaskQueue.mockImplementation(() => of(pageOf([...rows, ...rows.slice(0, 1)], { total: 3 })));
    el.querySelector<HTMLButtonElement>('[data-refresh]')!.click();
    await settle();
    expect(el.querySelector('[data-panel="overdue"] [data-skip]')).not.toBeNull();
    expect(el.querySelector('[data-panel="dueSoon"] [data-skip]')).toBeNull();
  });

  it('moves an assigned task out of the unassigned queue at once, keeps counts consistent, moves focus to the next row and announces it', async () => {
    unassignedRows = [unassignedRow, secondUnassigned];
    const el = await open(of(summary()), ALL);
    document.body.appendChild(el);
    const panel = () => el.querySelector('[data-panel="unassigned"]')!;
    const tile = () =>
      text(el.querySelector('[data-group="attention"] mf-stat-tile:nth-child(2) .value'));
    expect(text(panel().querySelector('[data-more]'))).toBe('Showing 2 of 17.');
    expect(tile()).toBe('17');

    // The server's next answer (after the quiet period): one task fewer.
    unassignedRows = [secondUnassigned];
    getDashboard.mockReturnValue(of(summary({ unassigned: count(16, `${OPEN}&unassigned=true`) })));
    panel().querySelector<HTMLButtonElement>('[data-assign-me]')!.click();
    await settle();

    expect(assignTask).toHaveBeenCalledWith(21, { rowVersion: 'AAAA', podId: 5, userId: 1 });
    // The row is gone from the queue, the header and footer counts and the tile agree (16), before any re-read.
    expect(panel().querySelector('[data-task="TSK-21"]')).toBeNull();
    expect(panel().querySelectorAll('li').length).toBe(1);
    expect(text(panel().querySelector('[data-total]'))).toBe('16');
    expect(text(panel().querySelector('[data-more]'))).toBe('Showing 1 of 16.');
    expect(tile()).toBe('16');
    // Focus did not fall to the body: it is on the row that took its place.
    expect(document.activeElement).toBe(panel().querySelector('li a.main'));
    expect(text(el.querySelector('[data-dash-live]'))).toContain('TSK-21 assigned to Test User');
    expect(text(el.querySelector('[data-dash-live]'))).toContain('16 unassigned tasks left');
    // The toast says the task moved to In Progress.
    expect(TestBed.inject(UndoService).current()?.message).toContain('Task moved to In Progress');

    // A moment later the counts and the lists are read again, bypassing the cache.
    await new Promise((r) => setTimeout(r, 900));
    harness.detectChanges();
    expect(getDashboard).toHaveBeenCalledTimes(2);
    expect(getDashboard).toHaveBeenLastCalledWith(30, true);
    expect(getTaskQueue.mock.calls.filter((c) => c[6] === true).length).toBe(2);
    expect(text(panel().querySelector('[data-total]'))).toBe('17');
    el.remove();
  });

  it('puts the task back when the assignment is undone (the lists are read again)', async () => {
    const el = await open();
    el.querySelector<HTMLButtonElement>('[data-assign-me]')!.click();
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
    expect(getDashboard).toHaveBeenLastCalledWith(30, true);
    expect(getTaskQueue.mock.calls.length).toBeGreaterThan(queueReads);
    expect(el.querySelector('[data-panel="unassigned"] [data-task="TSK-21"]')).not.toBeNull();
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
    // Due within two days: a relative cue next to the date (today is Oct 14).
    expect(text(soon.querySelector('[data-due]'))).toContain('Tomorrow');
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

  it('shows the breakdowns tab: priority, task type (with Other), status and age, with percent, badge colours and every row linked', async () => {
    const el = await open(of(summary()), ALL, '/dashboard?tab=breakdowns');
    const bars = el.querySelector('[data-section="breakdowns"]')!;
    const lists = Array.from(bars.querySelectorAll('mf-bar-list'));
    expect(lists.map((l) => text(l.querySelector('h3')))).toEqual([
      'Open by priority',
      'Open by task type',
      'Open by status',
    ]);
    expect(text(bars.querySelector('mf-stacked-bar h3'))).toBe('Age of open tasks');
    expect(bars.textContent).not.toContain('Open by pod');

    const typeRows = Array.from(lists[1].querySelectorAll('li'));
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

    expect(text(bars.querySelector('mf-stacked-bar'))).toContain(
      'Informational, not a service-level target',
    );
    // Every chart can be viewed as a table.
    expect(bars.querySelectorAll('.toggle').length).toBe(4);
    expect(el.textContent).not.toMatch(/billing|revenue|productivity/i);
  });

  it('shows the daily trend with its data table on the Trends tab', async () => {
    const el = await open(of(summary()), ALL, '/dashboard?tab=trends');
    const trend = el.querySelector('[data-section="trend"] mf-trend-chart')!;
    expect(trend.querySelector('[data-plot] svg')).not.toBeNull();
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
    expect(select.closest('[data-group="overview"]')).not.toBeNull();
    expect(el.textContent).toContain('Completed and created in');

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

  it('remembers the period per user and shows the same period on the Trends tab', async () => {
    let el = await open();
    const select = el.querySelector<HTMLSelectElement>('select[data-period]')!;
    select.value = 'quarter';
    select.dispatchEvent(new Event('change'));
    await settle();

    TestBed.resetTestingModule();
    el = await open(of(summary()), ALL, '/dashboard?tab=trends');
    expect(getDashboard).toHaveBeenCalledWith(90, undefined);
    expect(el.querySelector<HTMLSelectElement>('select[data-period]')!.value).toBe('quarter');
    expect(text(el.querySelector('[data-section="trend"]'))).toContain('Last quarter');
  });

  it('works when browser storage is blocked: tabs and the address still work', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const el = await open();
    expect(el.querySelector('[data-group="attention"]')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('[data-tab="trends"]')!.click();
    await settle();
    expect(el.querySelector('[data-tabpanel="trends"]')).not.toBeNull();
    expect(TestBed.inject(Router).url).toBe('/dashboard?tab=trends');
  });

  it('refreshes on the button without a loading state, bypassing the server cache', async () => {
    const el = await open();
    const before = el.querySelector('[data-group="attention"]');
    el.querySelector<HTMLButtonElement>('[data-refresh]')!.click();
    expect(el.querySelector('[aria-busy="true"][aria-label]')).toBeNull();
    await settle();
    expect(getDashboard).toHaveBeenLastCalledWith(30, true);
    expect(el.querySelector('[data-group="attention"]')).toBe(before);
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
    expect(getDashboard).toHaveBeenLastCalledWith(30, undefined);
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
    expect(el.querySelector('[data-stale]')!.textContent).toContain('could not be refreshed');
    expect(el.querySelector('[data-error]')).toBeNull();
    expect(el.querySelector('[data-group="attention"]')).not.toBeNull();
    // The refresh ran quietly (no generic error toast); the banner is the one message.
    expect(run).toHaveBeenCalledTimes(1);

    getDashboard.mockReturnValue(of(summary()));
    el.querySelector<HTMLButtonElement>('[data-stale-retry]')!.click();
    await settle();
    expect(el.querySelector('[data-stale]')).toBeNull();
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
    expect(el.querySelector('[role="tablist"]')).not.toBeNull();

    TestBed.resetTestingModule();
    el = await open(of(empty), ['Task.View', ...DATA_TABS]);
    expect(el.querySelector('[data-empty]')!.textContent).toContain('No open tasks');
    // A quiet period is not "no tasks ever": the period can be widened right there.
    expect(el.querySelector('[data-empty] select[data-period]')).not.toBeNull();
    expect(el.querySelector('[role="tablist"]')).toBeNull();
    expect(el.querySelector('a[href="/tasks/new"]')).toBeNull();

    TestBed.resetTestingModule();
    el = await open(of(empty), ['Task.View', 'Task.Create', ...DATA_TABS]);
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
    expect(el.querySelector('[data-group="attention"]')).not.toBeNull();
  });
});
