import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MessageService } from 'primeng/api';
import { NEVER, of, throwError } from 'rxjs';
import {
  DashboardBoardClient,
  DashboardClient,
  PodsClient,
  SwimlaneBoard,
  SwimlaneCard,
  SwimlaneGroup,
  TaskCommentsClient,
  TasksClient,
  UsersLookupClient,
} from '../../../api/generated/api-client';
import { scopesMock } from '../dash-scope-testing';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import { AuthStore } from '../../../core/auth/auth.store';
import { UndoService } from '../../../core/notify/undo.service';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { provideLookups } from '../../../shared/work-queue/work-queue-testing';
import { aCard, aLane } from '../swimlane/swimlane-testing';
import { LANE_PAGE } from '../swimlane/swimlane-lane';
import { SWIMLANE_REFRESH_MS, DashSwimlaneTab } from './dash-swimlane-tab';

const PERMS: Permission[] = [
  'Task.View',
  'Dashboard.View',
  'Dashboard.ViewSwimlane',
  'Task.Assign',
  'Task.SetPriority',
  'Task.ChangeStatus',
  'Task.Complete',
  'Task.Cancel',
  'Pod.View',
];

const counts = (n: number, i = 0, h = 0, c = 0) => ({
  new: n,
  inProgress: i,
  onHold: h,
  completed: c,
});
const group = (
  g: Partial<SwimlaneGroup> & Pick<SwimlaneGroup, 'key' | 'kind' | 'label'>,
): SwimlaneGroup => ({
  id: undefined,
  clientNumber: undefined,
  matterRef: undefined,
  color: undefined,
  rank: undefined,
  count: 0,
  counts: counts(0),
  children: [],
  ...g,
});

const OOO = {
  userId: 9,
  displayName: 'Tariq Malik',
  isActive: true,
  availability: { state: 'OUT_OF_OFFICE', outUntil: undefined, note: 'Leave' },
};

function board(overrides: Partial<SwimlaneBoard> = {}): SwimlaneBoard {
  return {
    timeZone: 'UTC',
    generatedAtUtc: '2026-10-15T15:00:00Z',
    completedDays: 7,
    completedFrom: '2026-10-09',
    groupBy: 'none',
    sort: 'priority',
    laneCap: 200,
    groups: [],
    lanes: [
      aLane('NEW', [
        aCard({
          taskId: 1,
          ref: 'TSK-1',
          title: 'Unassigned intake',
          dueDate: '2026-10-10',
          isOverdue: true,
          isAsap: false,
        }),
        aCard({
          taskId: 2,
          ref: 'TSK-2',
          title: 'Second intake',
          matterId: 101,
          matterRef: '00010-00002',
          matterName: 'Audit',
        }),
      ]),
      aLane('IN_PROGRESS', [
        aCard({
          taskId: 3,
          ref: 'TSK-3',
          title: 'Out of office owner',
          status: 'IN_PROGRESS',
          statusLabel: 'In Progress',
          assignee: OOO,
          priority: { priorityId: 1, label: 'Critical', color: 'critical', rank: 1 },
        }),
      ]),
      aLane('ON_HOLD', [
        aCard({
          taskId: 4,
          ref: 'TSK-4',
          title: 'Held',
          status: 'ON_HOLD',
          statusLabel: 'On Hold',
          assignee: OOO,
        }),
      ]),
      aLane('COMPLETED', []),
    ],
    ...overrides,
  } as SwimlaneBoard;
}

const taskOf = (card: SwimlaneCard, patch: Record<string, unknown> = {}) => ({
  taskId: card.taskId,
  taskNumber: card.ref,
  title: card.title,
  description: '<p>Collect and process the custodians.</p>',
  status: card.status,
  statusLabel: card.statusLabel,
  priority: {
    priorityId: card.priority.priorityId,
    label: card.priority.label,
    color: card.priority.color,
    sortOrder: card.priority.rank,
  },
  assignedPod: undefined,
  assignedUser: undefined,
  isAsap: true,
  isOverdue: false,
  statusChangedAtUtc: '2026-10-15T12:00:00Z',
  rowVersion: 'NEXT',
  workflow: {
    progress: {
      total: 2,
      resolved: 1,
      pending: 1,
      inProgress: 0,
      completed: 1,
      skipped: 0,
      resolvedCount: 1,
    },
    steps: [
      { stepInstanceId: 1, sequenceNo: 1, title: 'Collect', status: 'COMPLETED', isCurrent: false },
      { stepInstanceId: 2, sequenceNo: 2, title: 'Review', status: 'PENDING', isCurrent: true },
    ],
  },
  ...patch,
});

describe('DashSwimlaneTab', () => {
  // PrimeNG dialogs and long lanes are slow on a loaded machine; the default 5 s made the suite flaky.
  vi.setConfig({ testTimeout: 20_000 });
  let getBoard: ReturnType<typeof vi.fn>;
  let tasks: Record<string, ReturnType<typeof vi.fn>>;
  let harness: RouterTestingHarness;
  let host: HTMLElement;

  async function open(
    response: unknown = of(board()),
    url = '/dashboard?tab=swimlane',
    permissions = PERMS,
  ) {
    getBoard = vi.fn().mockReturnValue(response);
    const cardOf = (id: number) =>
      board()
        .lanes.flatMap((l) => l.cards)
        .find((c) => c.taskId === id) ?? aCard({ taskId: id });
    tasks = {
      getTask: vi.fn((id: number) => of(taskOf(cardOf(id)))),
      changeTaskStatus: vi.fn((id: number) =>
        of(
          taskOf(cardOf(id), {
            status: 'IN_PROGRESS',
            statusLabel: 'In Progress',
            rowVersion: 'V2',
          }),
        ),
      ),
      setTaskPriority: vi.fn((id: number) =>
        of(
          taskOf(cardOf(id), {
            priority: { priorityId: 3, label: 'Normal', color: 'normal', sortOrder: 3 },
            rowVersion: 'V3',
          }),
        ),
      ),
      assignTask: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'dashboard', component: DashSwimlaneTab }]),
        provideFakeMe(new FakeMeApi({ ...withPermissions(...permissions), userId: 5 })),
        { provide: DashboardBoardClient, useValue: { getDashboardSwimlane: getBoard } },
        { provide: DashboardClient, useValue: { getDashboardScopes: scopesMock() } },
        { provide: TasksClient, useValue: tasks },
        {
          provide: TaskCommentsClient,
          useValue: {
            listTaskComments: () =>
              of({
                items: [
                  {
                    commentId: 1,
                    author: { displayName: 'Pat Partner' },
                    createdAtUtc: '2026-10-14T10:00:00Z',
                    bodyHtml: '<p>Please <b>hurry</b></p>',
                  },
                ],
                total: 1,
              }),
          },
        },
        {
          provide: PodsClient,
          useValue: { listMyPods: () => of([]), listPods: () => of({ items: [] }) },
        },
        { provide: UsersLookupClient, useValue: { lookupUsers: () => of([]) } },
        MessageService,
        ...provideLookups(),
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
        { provide: Clock, useValue: { now: () => new Date('2026-10-15T15:05:00Z') } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, DashSwimlaneTab);
    await settle();
    host = harness.routeNativeElement as HTMLElement;
    document.body.appendChild(host);
    return host;
  }

  async function settle() {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r));
      harness.detectChanges();
    }
  }

  const q = <T extends HTMLElement>(s: string) => host.querySelector<T>(s)!;
  const qa = <T extends HTMLElement>(s: string) => Array.from(host.querySelectorAll<T>(s));
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const lane = (code: string) => q(`[data-lane="${code}"]`);
  const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
    );
  const choose = async (selector: string, value: string) => {
    const select = q<HTMLSelectElement>(selector);
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle();
  };
  const url = () => TestBed.inject(Router).url;

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });
  afterEach(() => {
    host?.remove();
    document.querySelectorAll('.p-dialog-mask').forEach((e) => e.remove());
    vi.restoreAllMocks();
  });

  it('reads the board with the default view and keeps the defaults out of the address (P9)', async () => {
    await open();
    expect(getBoard).toHaveBeenCalledWith(
      7,
      'none',
      'priority',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'all',
    );
    expect(url()).not.toContain('group=');
    expect(url()).not.toContain('sort=');
    expect(url()).not.toContain('days=');
    expect(url()).toContain('tab=swimlane');
  });

  it('opens a link that writes the defaults explicitly and normalises it without a new history entry (P9)', async () => {
    const navigate = vi.spyOn(Router.prototype, 'navigate');
    await open(of(board()), '/dashboard?tab=swimlane&group=none&sort=priority&days=7');
    expect(url()).toBe('/dashboard?tab=swimlane');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ replaceUrl: true }));
  });

  it('keeps a non-default parameter in the address and drops the default ones (P9)', async () => {
    await open(of(board()), '/dashboard?tab=swimlane&group=assignee&sort=priority');
    expect(url()).toBe('/dashboard?tab=swimlane&group=assignee');
  });

  it('does not touch the address of a plain Swimlane link (P9)', async () => {
    const navigate = vi.spyOn(Router.prototype, 'navigate');
    await open(of(board()), '/dashboard?tab=swimlane');
    expect(url()).toBe('/dashboard?tab=swimlane');
    const changed = navigate.mock.calls.filter(
      ([, extras]) =>
        extras?.queryParams && Object.values(extras.queryParams).some((v) => v !== null),
    );
    expect(changed).toEqual([]);
  });

  it('shows the four lanes as columns with the exact count, the lane hint and the age of the oldest card', async () => {
    await open();
    const lanes = qa('[data-lane]');
    expect(lanes.map((l) => l.getAttribute('data-lane'))).toEqual([
      'NEW',
      'IN_PROGRESS',
      'ON_HOLD',
      'COMPLETED',
    ]);
    expect(lanes.map((l) => text(l.querySelector('h3')))).toEqual([
      'New 2',
      'In Progress 1',
      'On Hold 1',
      'Completed 0',
    ]);
    expect(text(lane('NEW').querySelector('[data-oldest]'))).toContain('oldest 5d');
    expect(q('[data-lane-empty]')).not.toBeNull();
    expect(text(lane('COMPLETED').querySelector('[data-lane-empty]'))).toContain(
      'Nothing completed in this period',
    );
    expect(q('[data-board]').getAttribute('aria-busy')).toBeNull();
    // The refresh icon lives in the Dashboard's tab row; the toolbar has neither a Refresh button nor an Updated line.
    expect(q('[data-updated]')).toBeNull();
    expect(q('[data-refresh-board]')).toBeNull();
  });

  it('draws a card with priority text and icon, ref link, title, client, matter link, due chip, assignee and progress', async () => {
    await open();
    const card = lane('IN_PROGRESS').querySelector('mf-swimlane-card')!;
    expect(text(card.querySelector('[data-field="priority"]'))).toContain('Critical');
    expect(card.querySelector('[data-field="priority"] .bars')).not.toBeNull();
    expect(card.querySelector('.bar')!.getAttribute('aria-hidden')).toBe('true');
    expect(card.querySelector('[data-card-ref]')!.getAttribute('href')).toBe('/tasks/3');
    expect(text(card.querySelector('.title'))).toBe('Out of office owner');
    expect(text(card.querySelector('[data-client]'))).toBe('Acme Corp');
    expect(card.querySelector('mf-matter-ref a')!.getAttribute('href')).toBe('/matters/100');
    expect(text(card.querySelector('[data-due]'))).toContain('ASAP');
    expect(text(card.querySelector('[data-field="assignee"]'))).toContain('Tariq Malik');
    expect(text(card.querySelector('[data-ooo]'))).toBe('Out of office');
    expect(card.querySelector('[data-ooo]')!.getAttribute('title')).toBe('Out of office: Leave');
    expect(card.querySelector('[data-progress] [role="img"]')!.getAttribute('aria-label')).toBe(
      'Workflow steps: 1 of 4 done',
    );
    // An overdue card says so in words, with an icon.
    const overdue = lane('NEW').querySelector('mf-swimlane-card')!;
    expect(text(overdue.querySelector('[data-due]'))).toContain('Overdue 5d');
    expect(overdue.querySelector('[data-due] .pi-exclamation-circle')).not.toBeNull();
    expect(overdue.querySelector('.card--overdue')).not.toBeNull();
  });

  it('shows loading skeletons first, and an error with Retry and the reference when the first read fails', async () => {
    await open(NEVER);
    expect(q('[data-board]').getAttribute('aria-busy')).toBe('true');
    expect(qa('[data-lane] .bone').length).toBe(12);
    host.remove();
    TestBed.resetTestingModule();

    await open(throwError(() => new Error('down')));
    const alert = q('[data-dash-state="error"]');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(text(alert)).toContain('could not be loaded');
    getBoard.mockReturnValue(of(board()));
    alert.querySelector<HTMLButtonElement>('[data-dash-retry]')!.click();
    await settle();
    expect(q('[data-dash-state="error"]')).toBeNull();
    expect(qa('mf-swimlane-card').length).toBe(4);
  });

  it('keeps the board on screen when a background refresh fails and says so with Retry', async () => {
    await open();
    getBoard.mockReturnValue(throwError(() => new Error('down')));
    (harness.routeDebugElement!.componentInstance as DashSwimlaneTab).refresh();
    await settle();
    expect(qa('mf-swimlane-card').length).toBe(4);
    expect(text(q('[data-dash-state="stale"]'))).toContain('Could not refresh.');
    getBoard.mockReturnValue(of(board()));
    q<HTMLButtonElement>('[data-dash-state="stale"] [data-dash-retry]').click();
    await settle();
    expect(q('[data-dash-state="stale"]')).toBeNull();
    expect(text(q('[data-swimlane-live]'))).toContain('Board refreshed. 4 tasks.');
  });

  describe('toolbar, address and remembered choices', () => {
    it('opens a link with every parameter set, and sends them to the server', async () => {
      await open(
        of(board()),
        '/dashboard?tab=swimlane&group=assignee&sort=created&days=14&q=acme&assignee=unassigned&type=7&priority=2&overdue=true&mine=true',
      );
      expect(getBoard).toHaveBeenCalledWith(
        14,
        'assignee',
        'created',
        undefined,
        'unassigned',
        7,
        2,
        'acme',
        true,
        true,
        'all',
      );
      expect(q<HTMLSelectElement>('[data-group-by]').value).toBe('assignee');
      expect(q<HTMLSelectElement>('[data-days]').value).toBe('14');
      expect(q('[data-mine]').getAttribute('aria-pressed')).toBe('true');
      // assignee, type, priority and overdue are the four data filters (the pod is the page-wide scope); "Only mine" has its own toggle.
      expect(text(q('[data-filter-count]'))).toBe('(4)');
      q<HTMLButtonElement>('[data-filters]').click();
      await settle();
      expect(q<HTMLSelectElement>('[data-filter="priority"]').value).toBe('2');
      expect(q<HTMLInputElement>('[data-filter="overdue"]').checked).toBe(true);
    });

    it('changes group, sort and window: new read, new address, remembered for the next visit', async () => {
      await open();
      await choose('[data-group-by]', 'clientMatter');
      expect(getBoard).toHaveBeenLastCalledWith(
        7,
        'clientMatter',
        'priority',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'all',
      );
      await choose('[data-sort]', 'due');
      await choose('[data-days]', '30');
      expect(url()).toContain('group=clientMatter');
      expect(url()).toContain('sort=due');
      expect(url()).toContain('days=30');
      const stored = JSON.parse(localStorage.getItem('mf.dashboard.swimlane.v1.5')!);
      expect(stored).toMatchObject({ groupBy: 'clientMatter', sort: 'due', days: 30 });
      await choose('[data-density]', 'compact');
      expect(q('[data-board]').getAttribute('data-density')).toBe('compact');
      expect(JSON.parse(localStorage.getItem('mf.dashboard.swimlane.v1.5')!).density).toBe(
        'compact',
      );

      host.remove();
      TestBed.resetTestingModule();
      await open();
      expect(getBoard).toHaveBeenLastCalledWith(
        30,
        'clientMatter',
        'due',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'all',
      );
      expect(url()).toContain('group=clientMatter');
      expect(q('[data-board]').getAttribute('data-density')).toBe('compact');
    });

    it('lets the address win over what is remembered, and does not remember the data filters', async () => {
      localStorage.setItem(
        'mf.dashboard.swimlane.v1.5',
        JSON.stringify({ groupBy: 'priority', sort: 'due', days: 14, density: 'comfortable' }),
      );
      await open(of(board()), '/dashboard?tab=swimlane&group=assignee&mine=true');
      expect(getBoard).toHaveBeenCalledWith(
        14,
        'assignee',
        'due',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        'all',
      );
      expect(JSON.parse(localStorage.getItem('mf.dashboard.swimlane.v1.5')!).mine).toBeUndefined();
    });

    it('toggles Only mine and Overdue only, counts them as filters and clears everything', async () => {
      await open();
      q<HTMLButtonElement>('[data-mine]').click();
      await settle();
      expect(getBoard).toHaveBeenLastCalledWith(
        7,
        'none',
        'priority',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        'all',
      );
      expect(url()).toContain('mine=true');
      q<HTMLButtonElement>('[data-filters]').click();
      await settle();
      const overdue = q<HTMLInputElement>('[data-filter="overdue"]');
      overdue.checked = true;
      overdue.dispatchEvent(new Event('change'));
      await settle();
      expect(url()).toContain('overdue=true');
      expect(text(q('[data-filter-count]'))).toBe('(1)');
      q<HTMLButtonElement>('[data-clear-filters]').click();
      await settle();
      expect(url()).not.toContain('overdue');
      expect(url()).not.toContain('mine');
      expect(q('[data-filter-count]')).toBeNull();
    });

    it('follows the address when it changes (Back, a pasted link)', async () => {
      await open();
      await TestBed.inject(Router).navigateByUrl(
        '/dashboard?tab=swimlane&group=priority&sort=due&days=7',
      );
      await settle();
      expect(q<HTMLSelectElement>('[data-group-by]').value).toBe('priority');
      expect(getBoard).toHaveBeenLastCalledWith(
        7,
        'priority',
        'due',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'all',
      );
    });

    it('offers the people and task types it has seen as filter options, and hides the Pod filter without Pod.View', async () => {
      await open(
        of(board()),
        '/dashboard?tab=swimlane',
        PERMS.filter((p) => p !== 'Pod.View'),
      );
      q<HTMLButtonElement>('[data-filters]').click();
      await settle();
      expect(qa('[data-filter="assignee"] option').map((o) => text(o))).toEqual([
        'Anyone',
        'Unassigned',
        'Tariq Malik',
      ]);
      expect(qa('[data-filter="type"] option').map((o) => text(o))).toEqual([
        'Any type',
        'Data Processing',
      ]);
      expect(q('[data-filter="pod"]')).toBeNull();
      expect(qa('[data-filter="priority"] option').length).toBeGreaterThan(2);
    });
  });

  describe('truncation and long lanes', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        aCard({ taskId: 1000 + i, ref: `TSK-${1000 + i}`, title: `Task ${i}` }),
      );

    it('draws a lane in pages of cards and shows the rest on request', async () => {
      await open(
        of(
          board({
            lanes: [
              aLane('NEW', many(LANE_PAGE + 15)),
              aLane('IN_PROGRESS', []),
              aLane('ON_HOLD', []),
              aLane('COMPLETED', []),
            ],
          }),
        ),
      );
      expect(lane('NEW').querySelectorAll('mf-swimlane-card').length).toBe(LANE_PAGE);
      const more = lane('NEW').querySelector<HTMLButtonElement>('[data-show-more]')!;
      expect(text(more)).toBe('Show 15 more of 15 hidden');
      more.click();
      await settle();
      expect(lane('NEW').querySelectorAll('mf-swimlane-card').length).toBe(LANE_PAGE + 15);
      expect(lane('NEW').querySelector('[data-show-more]')).toBeNull();
      expect(text(lane('NEW').querySelector('h3'))).toBe(`New ${LANE_PAGE + 15}`);
    });

    it('says "Showing 200 of N" with a link to the Task Queue under the same filters when a lane is capped', async () => {
      await open(
        of(
          board({
            lanes: [
              aLane('NEW', many(3), { count: 230, total: 230, truncated: true }),
              aLane('IN_PROGRESS', []),
              aLane('ON_HOLD', []),
              aLane(
                'COMPLETED',
                many(1).map((c) => ({ ...c, status: 'COMPLETED' })),
                { count: 260, total: 260, truncated: true },
              ),
            ],
          }),
        ),
        '/dashboard?tab=swimlane&q=acme&priority=2',
      );
      const note = lane('NEW').querySelector('[data-truncated]')!;
      expect(text(note)).toContain('Showing 3 of 230.');
      const link = note.querySelector<HTMLAnchorElement>('a')!;
      expect(text(link)).toBe('Open the Task Queue');
      expect(link.getAttribute('href')).toBe('/tasks?status=NEW&q=acme&priority=2');
      expect(lane('COMPLETED').querySelector('[data-open-queue]')!.getAttribute('href')).toContain(
        'status=COMPLETED&status=CANCELLED&completedFrom=2026-10-09',
      );
      expect(lane('IN_PROGRESS').querySelector('[data-truncated]')).toBeNull();
    });
  });

  describe('grouping', () => {
    const tree = (): SwimlaneBoard =>
      board({
        groupBy: 'clientMatter',
        groups: [
          group({
            key: 'client:10',
            kind: 'client',
            id: 10,
            label: 'Acme Corp',
            clientNumber: '00010',
            count: 2,
            counts: counts(2, 1, 1),
            children: [
              group({
                key: 'matter:100',
                kind: 'matter',
                id: 100,
                label: 'Merger',
                clientNumber: '00010',
                matterRef: '00010-00001',
                count: 3,
                counts: counts(1, 1, 1),
              }),
              group({
                key: 'matter:101',
                kind: 'matter',
                id: 101,
                label: 'Audit',
                clientNumber: '00010',
                matterRef: '00010-00002',
                count: 1,
                counts: counts(1),
              }),
            ],
          }),
        ],
      });

    it('shows the client > matter tree with tree roles, levels, expanded state and counts on every node', async () => {
      await open(of(tree()), '/dashboard?tab=swimlane&group=clientMatter');
      const t = lane('NEW').querySelector('[role="tree"]')!;
      expect(t.getAttribute('aria-label')).toBe('New tasks by client and matter');
      const items = Array.from(t.querySelectorAll('[role="treeitem"]'));
      expect(items.map((i) => i.getAttribute('aria-level'))).toEqual(['1', '2', '3', '2', '3']);
      expect(items.map((i) => i.getAttribute('aria-expanded'))).toEqual([
        'true',
        'true',
        null,
        'true',
        null,
      ]);
      expect(items[0].getAttribute('aria-label')).toBe('Acme Corp, client 00010, 2 tasks');
      expect(items[1].getAttribute('aria-label')).toBe('Merger, matter 00010-00001, 1 task');
      // Only the first item is a tab stop.
      expect(items.map((i) => i.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1']);
      expect(text(items[0].querySelector('.count'))).toBe('2');
      // Cards of the tree are items, not tab stops of their own.
      expect(items[2].querySelector('[data-card-open]')!.getAttribute('tabindex')).toBe('-1');
      // The other lanes have their own trees.
      expect(lane('IN_PROGRESS').querySelectorAll('[role="treeitem"][aria-level="3"]').length).toBe(
        1,
      );
    });

    it('collapses and expands nodes by click, and everything with Collapse all and Expand all', async () => {
      await open(of(tree()), '/dashboard?tab=swimlane&group=clientMatter');
      const first = () =>
        lane('NEW').querySelector<HTMLElement>('[role="treeitem"][aria-level="1"]')!;
      first().click();
      await settle();
      expect(first().getAttribute('aria-expanded')).toBe('false');
      expect(lane('NEW').querySelectorAll('[role="treeitem"]').length).toBe(1);
      // The node is collapsed in every lane (the keys are shared).
      expect(lane('IN_PROGRESS').querySelectorAll('[role="treeitem"]').length).toBe(1);
      q<HTMLButtonElement>('[data-expand-all]').click();
      await settle();
      expect(lane('NEW').querySelectorAll('[role="treeitem"]').length).toBe(5);
      q<HTMLButtonElement>('[data-collapse-all]').click();
      await settle();
      expect(lane('NEW').querySelectorAll('[role="treeitem"]').length).toBe(1);
      expect(text(q('[data-swimlane-live]'))).toBe('All groups collapsed.');
    });

    it('moves through the tree with the arrow keys: Down, Right (open or step in), Left (close or step out), Home and End', async () => {
      await open(of(tree()), '/dashboard?tab=swimlane&group=clientMatter');
      const items = () =>
        Array.from(lane('NEW').querySelectorAll<HTMLElement>('[role="treeitem"]'));
      items()[0].focus();
      key(document.activeElement!, 'ArrowDown');
      expect(document.activeElement).toBe(items()[1]);
      key(document.activeElement!, 'ArrowDown');
      expect(document.activeElement).toBe(items()[2]);
      expect(items()[2].getAttribute('aria-level')).toBe('3');
      key(document.activeElement!, 'ArrowLeft'); // card -> its matter
      expect(document.activeElement).toBe(items()[1]);
      key(document.activeElement!, 'ArrowLeft'); // closes the matter
      await settle();
      expect(items()[1].getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(items()[1]);
      key(document.activeElement!, 'ArrowRight'); // opens it
      await settle();
      expect(items()[1].getAttribute('aria-expanded')).toBe('true');
      key(document.activeElement!, 'ArrowRight'); // steps into the first card
      expect(document.activeElement).toBe(items()[2]);
      key(document.activeElement!, 'End');
      expect(document.activeElement).toBe(items().at(-1));
      key(document.activeElement!, 'Home');
      expect(document.activeElement).toBe(items()[0]);
      key(document.activeElement!, 'ArrowLeft'); // closes the client
      await settle();
      expect(items()[0].getAttribute('aria-expanded')).toBe('false');
      expect(items().length).toBe(1);
    });

    it('groups by priority in rank order with a coloured, labelled header, and by assignee with an Out of office chip', async () => {
      const b = board({
        groupBy: 'priority',
        groups: [
          group({
            key: 'priority:1',
            kind: 'priority',
            id: 1,
            label: 'Critical',
            color: 'critical',
            rank: 1,
            count: 1,
            counts: counts(0, 1, 1),
          }),
          group({
            key: 'priority:2',
            kind: 'priority',
            id: 2,
            label: 'High',
            color: 'high',
            rank: 2,
            count: 3,
            counts: counts(2, 0, 0),
          }),
        ],
      });
      await open(of(b), '/dashboard?tab=swimlane&group=priority');
      const heads = qa('[data-lane="NEW"] .grp-btn');
      expect(heads.map((h) => text(h.querySelector('.grp-title')))).toEqual(['High']);
      expect(heads[0].getAttribute('aria-expanded')).toBe('true');
      expect(heads[0].style.background).toContain('--mf-pr-high-bg');
      expect(text(heads[0].querySelector('.count'))).toBe('2');
      heads[0].click();
      await settle();
      expect(qa('[data-lane="NEW"] mf-swimlane-card').length).toBe(0);
      expect(qa('[data-lane="NEW"] .grp-btn')[0].getAttribute('aria-expanded')).toBe('false');

      host.remove();
      TestBed.resetTestingModule();
      const byAssignee = board({
        groupBy: 'assignee',
        groups: [
          group({
            key: 'assignee:9',
            kind: 'assignee',
            id: 9,
            label: 'Tariq Malik',
            count: 2,
            counts: counts(0, 1, 1),
          }),
          group({
            key: 'assignee:unassigned',
            kind: 'assignee',
            label: 'Unassigned',
            count: 2,
            counts: counts(2),
          }),
        ],
      });
      await open(of(byAssignee), '/dashboard?tab=swimlane&group=assignee');
      expect(text(lane('IN_PROGRESS').querySelector('.grp-btn'))).toContain('Out of office');
      expect(text(lane('NEW').querySelector('.grp-btn'))).toContain('Unassigned');
    });
  });

  describe('keyboard between cards', () => {
    const opener = (lane_: string, i: number) =>
      lane(lane_).querySelectorAll<HTMLElement>('[data-card-open]')[i];

    it('has one tab stop per lane and moves with Up, Down, Home, End and Left and Right between lanes at the same position', async () => {
      await open();
      expect(qa('[data-card-open]').map((b) => b.getAttribute('tabindex'))).toEqual([
        '0',
        '-1',
        '0',
        '0',
      ]);
      opener('NEW', 0).focus();
      key(document.activeElement!, 'ArrowDown');
      await settle();
      expect(document.activeElement).toBe(opener('NEW', 1));
      expect(opener('NEW', 1).getAttribute('tabindex')).toBe('0');
      expect(opener('NEW', 0).getAttribute('tabindex')).toBe('-1');
      key(document.activeElement!, 'ArrowUp');
      expect(document.activeElement).toBe(opener('NEW', 0));
      key(document.activeElement!, 'End');
      expect(document.activeElement).toBe(opener('NEW', 1));
      key(document.activeElement!, 'Home');
      key(document.activeElement!, 'ArrowRight');
      expect(document.activeElement).toBe(opener('IN_PROGRESS', 0));
      key(document.activeElement!, 'ArrowRight');
      expect(document.activeElement).toBe(opener('ON_HOLD', 0));
      // The Completed lane is empty: Right stays where it is, Left goes back.
      key(document.activeElement!, 'ArrowRight');
      expect(document.activeElement).toBe(opener('ON_HOLD', 0));
      key(document.activeElement!, 'ArrowLeft');
      expect(document.activeElement).toBe(opener('IN_PROGRESS', 0));
    });

    it('opens the status menu of the focused card with m', async () => {
      await open();
      opener('IN_PROGRESS', 0).focus();
      key(document.activeElement!, 'm');
      await settle();
      expect(q('[role="menu"]')).not.toBeNull();
      expect(q('.im-pop')).not.toBeNull();
      expect(qa('[role="menuitemradio"]').map((o) => text(o).replace(/\s+/g, ''))).toEqual([
        'PutonholdOnHold',
        'CompleteCompleted',
        'CanceltaskCancelled',
      ]);
    });

    it('lets a skip button jump to the next lane', async () => {
      await open();
      lane('NEW').querySelector<HTMLButtonElement>('[data-skip-lane]')!.click();
      await settle();
      expect(document.activeElement).toBe(opener('IN_PROGRESS', 0));
    });
  });

  describe('inline menus', () => {
    const trigger = (code: string, field: string) =>
      lane(code).querySelector<HTMLButtonElement>(`[data-field="${field}"] [data-inline-trigger]`)!;
    const pick = async (id: string) => {
      q<HTMLButtonElement>(`.im-pop [data-option="${id}"]`).click();
      await settle();
    };

    it('shows the Status, Priority and Assignee menus on the card for people who may use them', async () => {
      await open();
      expect(trigger('IN_PROGRESS', 'status')).not.toBeNull();
      expect(trigger('IN_PROGRESS', 'priority').getAttribute('aria-label')).toBe(
        'Critical, change priority of TSK-3',
      );
      expect(trigger('NEW', 'assignee').getAttribute('aria-label')).toBe(
        'Unassigned, change assignee of TSK-1',
      );
      host.remove();
      TestBed.resetTestingModule();
      await open(of(board()), '/dashboard?tab=swimlane', [
        'Task.View',
        'Dashboard.View',
        'Dashboard.ViewSwimlane',
      ]);
      expect(host.querySelector('[data-inline-trigger]')).toBeNull();
      expect(text(lane('IN_PROGRESS').querySelector('[data-field="priority"]'))).toContain(
        'Critical',
      );
    });

    it('moves the card to the new lane when a status change is accepted, updates both counts and reads the board again', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
      try {
        await open();
        trigger('ON_HOLD', 'status').click();
        await settle();
        await pick('RESUME');
        expect(tasks['changeTaskStatus']).toHaveBeenCalledWith(4, {
          rowVersion: 'AAAA',
          status: 'IN_PROGRESS',
        });
        expect(
          Array.from(lane('IN_PROGRESS').querySelectorAll('[data-task]')).map((c) =>
            c.getAttribute('data-task'),
          ),
        ).toEqual(['TSK-4', 'TSK-3']);
        expect(lane('ON_HOLD').querySelector('mf-swimlane-card')).toBeNull();
        expect(text(lane('ON_HOLD').querySelector('h3'))).toBe('On Hold 0');
        expect(text(lane('IN_PROGRESS').querySelector('h3'))).toBe('In Progress 2');
        await settle();
        expect(text(q('[data-swimlane-live]'))).toBe('TSK-4 moved to In Progress.');
        const reads = getBoard.mock.calls.length;
        await vi.advanceTimersByTimeAsync(1000);
        await settle();
        expect(getBoard.mock.calls.length).toBe(reads + 1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('sets the priority in place, offers Undo, and the card keeps its lane', async () => {
      await open();
      const undo = TestBed.inject(UndoService);
      trigger('IN_PROGRESS', 'priority').click();
      await settle();
      await pick('3');
      expect(tasks['setTaskPriority']).toHaveBeenCalledWith(3, {
        rowVersion: 'AAAA',
        priorityId: 3,
      });
      expect(text(lane('IN_PROGRESS').querySelector('[data-field="priority"]'))).toContain(
        'Normal',
      );
      expect(undo.current()?.message).toBe('TSK-3 priority set to Normal.');
      expect(lane('IN_PROGRESS').querySelectorAll('mf-swimlane-card').length).toBe(1);
    });
  });

  describe('drawer', () => {
    const opener = () => lane('IN_PROGRESS').querySelector<HTMLButtonElement>('[data-card-open]')!;

    it('opens a peek with the task, its steps and latest comments, and Open full task', async () => {
      await open();
      opener().focus();
      opener().click();
      await settle();
      await settle();
      const peek = document.querySelector('[data-peek]')!;
      expect(peek).not.toBeNull();
      expect(tasks['getTask']).toHaveBeenCalledWith(3);
      expect(text(peek)).toContain('Out of office owner');
      expect(text(peek.querySelector('[data-peek-status]'))).toContain('In Progress');
      expect(text(peek.querySelector('[data-peek-assignee]'))).toContain('Out of office');
      expect(
        Array.from(peek.querySelectorAll('[data-peek-steps] li')).map(
          (li) =>
            `${text(li.querySelector('.step-title'))}:${text(li.querySelector('.step-state'))}`,
        ),
      ).toEqual(['Collect:Done', 'Review:Next']);
      expect(text(peek.querySelector('[data-peek-comments]'))).toContain('Pat Partner');
      expect(text(peek.querySelector('[data-peek-comments]'))).toContain('Please hurry');
      expect(peek.querySelector('[data-open-task]')!.getAttribute('href')).toBe('/tasks/3');
      expect(document.querySelector('.mf-swl-drawer')).not.toBeNull();
    });

    it('closes with its close button and returns focus to the card that opened it', async () => {
      await open();
      opener().focus();
      opener().click();
      await settle();
      await settle();
      document.querySelector<HTMLButtonElement>('button[aria-label="Close task details"]')!.click();
      await settle();
      await new Promise((r) => setTimeout(r, 20));
      await settle();
      expect(document.querySelector('[data-peek]')).toBeNull();
      expect(document.activeElement).toBe(opener());
    });

    it('shows an error with Retry when the task cannot be read', async () => {
      await open();
      tasks['getTask'].mockReturnValue(throwError(() => new Error('down')));
      opener().click();
      await settle();
      await settle();
      expect(document.querySelector('[data-peek-error]')).not.toBeNull();
      tasks['getTask'].mockReturnValue(of(taskOf(aCard({ taskId: 3, status: 'IN_PROGRESS' }))));
      document.querySelector<HTMLButtonElement>('[data-peek-retry]')!.click();
      await settle();
      await settle();
      expect(document.querySelector('[data-peek-steps]')).not.toBeNull();
    });
  });

  describe('automatic refresh', () => {
    function tickOf(spy: ReturnType<typeof vi.spyOn>) {
      return spy.mock.calls.find((c: unknown[]) => c[1] === SWIMLANE_REFRESH_MS)![0] as () => void;
    }

    it('reads the board every five minutes while visible, without moving focus', async () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      await open();
      expect(SWIMLANE_REFRESH_MS).toBe(300_000);
      const tick = tickOf(spy);
      const focused = lane('IN_PROGRESS').querySelector<HTMLElement>('[data-card-open]')!;
      focused.focus();
      const calls = getBoard.mock.calls.length;
      tick();
      await settle();
      expect(getBoard.mock.calls.length).toBe(calls + 1);
      expect(document.activeElement).toBe(focused);
      expect(qa('mf-swimlane-card').length).toBe(4);
    });

    it('skips the read while a menu or the drawer is open, or the page is hidden', async () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      await open();
      const tick = tickOf(spy);
      const calls = () => getBoard.mock.calls.length;
      const before = calls();

      lane('IN_PROGRESS')
        .querySelector<HTMLButtonElement>('[data-field="status"] [data-inline-trigger]')!
        .click();
      await settle();
      tick();
      expect(calls()).toBe(before);
      key(q('.im-pop'), 'Escape');
      await settle();
      expect(q('.im-pop')).toBeNull();

      lane('IN_PROGRESS').querySelector<HTMLButtonElement>('[data-card-open]')!.click();
      await settle();
      tick();
      expect(calls()).toBe(before);
      document.querySelector<HTMLButtonElement>('button[aria-label="Close task details"]')!.click();
      await settle();
      await new Promise((r) => setTimeout(r, 20));

      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      tick();
      expect(calls()).toBe(before);
    });
  });

  it('rereads the board after an Undo finished', async () => {
    await open();
    const reads = getBoard.mock.calls.length;
    TestBed.inject(UndoService).settled.update((n) => n + 1);
    await settle();
    expect(getBoard.mock.calls.length).toBe(reads + 1);
  });
});
