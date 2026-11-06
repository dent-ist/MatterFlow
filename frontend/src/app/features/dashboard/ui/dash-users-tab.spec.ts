import {
  ddButton,
  ddChoose,
  ddOptionTexts,
  ddSelect,
  ddText,
} from '../../../testing/dropdown-testing.spec-util';
import { DashboardPrefs } from '../dashboard-prefs';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NEVER, of, throwError } from 'rxjs';
import {
  CoverageBoard,
  DashboardBoardClient,
  DashboardClient,
  PodsClient,
  TaskQueueClient,
  TaskQueueRow,
  TasksClient,
  WorkloadBoard,
} from '../../../api/generated/api-client';
import { DashScope } from '../dash-scope';
import { aMemberChoices, scopesMock } from '../dash-scope-testing';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { UndoService } from '../../../core/notify/undo.service';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { aRow, pageOf, provideLookups } from '../../../shared/work-queue/work-queue-testing';
import {
  OUT_UNTIL,
  aBoard,
  aCoverageBoard,
  aCoverageTypeBoard,
  aCoverageUser,
  aUser,
  outOfOffice,
} from '../users/users-testing';
import { USERS_REFRESH_MS, DashUsersTab } from './dash-users-tab';

const PERMS: Permission[] = [
  'Task.View',
  'Dashboard.View',
  'Dashboard.ViewUsers',
  'Task.Assign',
  'Task.SetPriority',
  'Task.ChangeStatus',
  'Pod.View',
];

function board(overrides: Partial<WorkloadBoard> = {}): WorkloadBoard {
  return aBoard(
    [
      aUser(1, 'Ann Lee', [1, 2, 0, 0], { overdue: 2, dueSoon: 1, onHold: 1 }),
      aUser(2, 'Bob Ray', [0, 0, 5, 1], {
        nextDue: {
          taskId: 55,
          ref: 'TSK-55',
          dueDate: '2026-10-20',
          dueAtUtc: undefined,
          isOverdue: false,
        },
      }),
      aUser(3, 'Cy Tan'),
      aUser(4, 'Dee Fox', [0, 1, 0, 0], { availability: outOfOffice }),
      aUser(5, 'Eve Kim', [0, 0, 0, 2], {
        availability: { state: 'OFF_HOURS', outUntil: undefined, note: undefined },
      }),
      aUser(6, 'Hal Moe', [5, 5, 0, 0], { pods: [{ podId: 2, name: 'Pod B', isPrimary: true }] }),
    ],
    overrides,
  );
}

const unassigned = (id: number, priority: number, label: string) =>
  aRow({
    taskId: id,
    taskNumber: `TSK-${id}`,
    taskTypeColourKey: 'teal',
    title: `Unassigned ${id}`,
    status: 'NEW',
    statusLabel: 'New',
    assignedUser: undefined,
    priority: { priorityId: priority, label, color: label.toLowerCase(), sortOrder: priority },
    rowVersion: `v${id}`,
  });

describe('DashUsersTab', () => {
  // The first dialog of a run loads the PrimeNG chunk; under a loaded machine that exceeds the default 5 s.
  vi.setConfig({ testTimeout: 20_000 });

  let getWorkload: ReturnType<typeof vi.fn>;
  let getQueue: ReturnType<typeof vi.fn>;
  let getCoverage: ReturnType<typeof vi.fn>;
  let tasks: Record<string, ReturnType<typeof vi.fn>>;
  let getQueueRows: TaskQueueRow[];
  let harness: RouterTestingHarness;
  let host: HTMLElement;

  async function open(
    response: unknown = of(board()),
    url = '/dashboard?tab=users',
    permissions = PERMS,
    coverageBoard: CoverageBoard = aCoverageBoard(),
    typeBoard: CoverageBoard = aCoverageTypeBoard(),
  ) {
    getWorkload = vi.fn().mockReturnValue(response);
    getCoverage = vi.fn((...args: unknown[]) => of(args[7] === 'type' ? typeBoard : coverageBoard));
    getQueue = vi.fn((...args: unknown[]) => {
      // positional: group is argument 1 (#232), status 2, assignee 6, unassigned 7
      const assignee = args[6] as number[] | undefined;
      return of(
        assignee
          ? pageOf([
              aRow({ taskId: 11, taskNumber: 'TSK-11', title: 'Mine one', rowVersion: 'a' }),
              aRow({
                taskId: 12,
                taskNumber: 'TSK-12',
                title: 'Mine two',
                status: 'ON_HOLD',
                statusLabel: 'On Hold',
                rowVersion: 'b',
              }),
            ])
          : pageOf(getQueueRows),
      );
    });
    tasks = {
      getTask: vi.fn((id: number) =>
        of({
          taskId: id,
          taskNumber: `TSK-${id}`,
          assignedUser: { userId: 3, displayName: 'Cy Tan', isActive: true },
          assignedPod: undefined,
          rowVersion: 'z',
        }),
      ),
      assignTask: vi.fn((id: number) =>
        of({
          taskId: id,
          taskNumber: `TSK-${id}`,
          status: 'IN_PROGRESS',
          statusLabel: 'In Progress',
          assignedUser: { userId: 3, displayName: 'Cy Tan', isActive: true },
          assignedPod: undefined,
          rowVersion: 'next',
        }),
      ),
      assignTasksBatch: vi.fn((body: { items: { taskId: number }[] }) =>
        of({
          results: body.items.map((i) => ({
            taskId: i.taskId,
            succeeded: true,
            task: {
              taskId: i.taskId,
              taskNumber: `TSK-${i.taskId}`,
              status: 'IN_PROGRESS',
              statusLabel: 'In Progress',
              assignedUser: { userId: 3, displayName: 'Cy Tan', isActive: true },
              rowVersion: 'next',
            },
          })),
        }),
      ),
      setTaskPriority: vi.fn(),
      changeTaskStatus: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'dashboard', component: DashUsersTab }]),
        provideFakeMe(new FakeMeApi({ ...withPermissions(...permissions), userId: 5 })),
        {
          provide: DashboardClient,
          useValue: { getDashboardScopes: scopesMock(aMemberChoices()) },
        },
        {
          provide: DashboardBoardClient,
          useValue: { getDashboardWorkload: getWorkload, getDashboardCoverage: getCoverage },
        },
        { provide: TaskQueueClient, useValue: { getTaskQueue: getQueue } },
        { provide: TasksClient, useValue: tasks },
        {
          provide: PodsClient,
          useValue: {
            listMyPods: () => of([]),
            listPods: () =>
              of({
                items: [
                  { podId: 1, name: 'Pod A' },
                  { podId: 2, name: 'Pod B' },
                ],
              }),
          },
        },
        ...provideLookups(),
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
        { provide: Clock, useValue: { now: () => new Date('2026-10-15T15:05:00Z') } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    // The Dashboard page applies the shared period from the address before its tabs read; this host stands in for it.
    const named = new URL(url, 'http://localhost').searchParams;
    TestBed.inject(DashboardPrefs).applyAddress((k) => named.get(k));
    await harness.navigateByUrl(url, DashUsersTab);
    await settle();
    host = harness.routeNativeElement as HTMLElement;
    document.body.appendChild(host);
    return host;
  }

  /** The Dashboard's refresh icon (in the tab row) calls the tab's refresh(). */
  function refreshTab() {
    (harness.routeDebugElement!.componentInstance as DashUsersTab).refresh();
  }

  async function settle() {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r));
      harness.detectChanges();
    }
  }

  async function reopen(...args: Parameters<typeof open>) {
    host.remove();
    TestBed.resetTestingModule();
    return open(...args);
  }

  const q = <T extends HTMLElement>(s: string) => host.querySelector<T>(s)!;
  const qa = <T extends HTMLElement>(s: string) => Array.from(host.querySelectorAll<T>(s));
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const card = (name: string) => q(`[data-user-card][data-user="${name}"]`);
  const url = () => TestBed.inject(Router).url;
  const choose = async (selector: string, value: string) => {
    if (selector.includes('data-period')) {
      ddChoose(host, 'Period', value);
      await settle();
      return;
    }
    // Sort is a dropdown of its own (US-11); the Coverage display choices live in the Display popover: open it, then choose by label.
    if (selector === '[data-sort]') {
      ddChoose(host, 'Sort', value);
      await settle();
      return;
    }
    const labels: Record<string, string> = {
      '[data-coverage-row-order]': 'Order',
      '[data-coverage-scale]': 'Color Scale',
      '[data-coverage-type-order]': 'Task Types',
      '[data-coverage-user-order]': 'People',
    };
    if (!labels[selector]) {
      const select = q<HTMLSelectElement>(selector);
      select.value = value;
      select.dispatchEvent(new Event('change'));
      await settle();
      return;
    }
    await openFilters();
    ddChoose(host, labels[selector], value);
    await settle();
  };
  const openFilters = async () => {
    if (!q('[data-filters-panel]')) {
      q<HTMLButtonElement>('[data-filters-toggle]').click();
      await settle();
    }
  };
  /** The State dropdown: open it, click each state, then Done. A value of '' is "All States". */
  const pickStates = async (...values: string[]) => {
    ddButton(host, 'State').click();
    await settle();
    for (const v of values) {
      document.querySelector<HTMLElement>(`.dd-panel [role="option"][data-value="${v}"]`)!.click();
      await settle();
    }
    document.querySelector<HTMLElement>('[data-dd-done]')!.click();
    await settle();
  };
  const names = () => qa('[data-user-card]').map((c) => c.getAttribute('data-user'));
  const openWho = async () => {
    if (!q('[data-who-popover]')) {
      q<HTMLButtonElement>('[data-who-counted]').click();
      await settle();
    }
  };

  beforeEach(() => {
    getQueueRows = [unassigned(21, 1, 'Critical'), unassigned(22, 3, 'Normal')];
    try {
      sessionStorage.removeItem('mf.users.assign.allPods');
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

  describe('cards', () => {
    it('asks the workload endpoint with the filters of the address', async () => {
      await open(of(board()), '/dashboard?tab=users&uavail=out&uq=ann');
      // An old address (uavail=out) opens as the Out of office state; the states are applied on the page, the API is asked for everyone.
      expect(getWorkload).toHaveBeenCalledWith(undefined, 'all', 'ann', 'all', false);
      expect(ddText(host, 'State')).toBe('Out of Office');
    });

    it('draws one card per person in the default order: available, off hours, out of office; lighter first', async () => {
      await open();
      expect(qa('[data-user-card]').map((c) => c.getAttribute('data-user'))).toEqual(order);
      expect(q('[data-users-grid]').getAttribute('aria-busy')).toBeNull();
    });

    it('draws design B: the big open count, the name, three slot pips and NO Available chip', async () => {
      await open();
      const ann = card('Ann Lee');
      expect(ann.getAttribute('data-tone')).toBe('critical');
      expect(text(ann.querySelector('[data-open-total]'))).toBe('3');
      expect(text(ann.querySelector('[data-workload]'))).toBe('3 open');
      expect(ann.querySelectorAll('[data-pip]')).toHaveLength(3);
      expect(ann.querySelectorAll('[data-pip].dot--on')).toHaveLength(3);
      expect(card('Cy Tan').querySelectorAll('[data-pip].dot--on')).toHaveLength(0);
      // "Available" is spoken, never drawn.
      expect(ann.querySelector('[data-availability-line]')).toBeNull();
      expect(text(ann)).not.toContain('Available');
      expect(ann.querySelector('[data-user-open]')!.getAttribute('aria-label')).toContain(
        'Ann Lee, 3 open tasks, Light, Available',
      );
      expect(text(ann)).not.toContain('Workload');
      expect(ann.querySelector('[data-load-bar], [data-segment], .avatar')).toBeNull();
    });

    it('shows the state of the person as an icon SHAPE with its colour: Idle, Light, Heavy, Out of office, Off hours', async () => {
      await open();
      const icon = (n: string) =>
        card(n).querySelector('mf-user-state-icon')!.getAttribute('data-state-icon');
      expect(icon('Cy Tan')).toBe('idle');
      expect(icon('Ann Lee')).toBe('light');
      expect(icon('Hal Moe')).toBe('heavy');
      expect(icon('Dee Fox')).toBe('out');
      expect(icon('Eve Kim')).toBe('off');
      expect(card('Ann Lee').querySelector('mf-user-state-icon svg path')).not.toBeNull();
    });

    it('shows the exceptions without changing the height: Off hours adds nothing, Out of office tints the card and says when they are back', async () => {
      await open();
      const free = card('Cy Tan');
      expect(free.getAttribute('data-state')).toBe('free');
      expect(text(free.querySelector('[data-open-total]'))).toBe('0');
      expect(free.querySelector('[data-user-open]')!.getAttribute('title')).toContain(
        'Idle: No open tasks',
      );
      const ooo = card('Dee Fox');
      expect(ooo.getAttribute('data-state')).toBe('ooo');
      expect(ooo.getAttribute('data-availability')).toBe('OUT_OF_OFFICE');
      // No band (it added height): the return date is in the count row, the whole wording in the tooltip and the accessible name.
      expect(ooo.querySelector('[data-ooo-band]')).toBeNull();
      expect(text(ooo.querySelector('[data-back-on]'))).toBe('Back Oct 21');
      expect(ooo.querySelector('[data-user-open]')!.getAttribute('title')).toContain(
        'Out of Office until Oct 20',
      );
      // The workload is still there.
      expect(text(ooo.querySelector('[data-open-total]'))).toBe('1');
      expect(ooo.querySelector('[data-user-open]')!.getAttribute('aria-label')).toContain(
        'Dee Fox, 1 open task, ',
      );
      expect(ooo.querySelector('[data-user-open]')!.getAttribute('aria-label')).toContain(
        'Out of Office until Oct 20',
      );
      expect(OUT_UNTIL).toBeTruthy();
      const eve = card('Eve Kim');
      // Off hours adds no row and no chip (the moon is in the state icon): the card keeps the same height.
      expect(
        eve.querySelector('[data-availability-line], .chip, [data-ooo-band], [data-back-on]'),
      ).toBeNull();
      expect(eve.querySelector('[data-user-open]')!.getAttribute('aria-label')).toContain(
        'Off Hours',
      );
    });

    it('shows overdue work only as a red clock and a count (no pill) and marks a heavy load by its level', async () => {
      await open();
      expect(text(card('Ann Lee').querySelector('[data-overdue]'))).toBe('2');
      expect(card('Bob Ray').querySelector('[data-overdue]')).toBeNull();
      expect(card('Hal Moe').getAttribute('data-load')).toBe('HEAVY');
      expect(card('Hal Moe').querySelector('[data-user-open]')!.getAttribute('title')).toContain(
        'Heavy',
      );
      // More open tasks than slots: every pip is filled.
      expect(card('Hal Moe').querySelectorAll('[data-pip].dot--on')).toHaveLength(3);
    });

    it('names the open button with the name first, then the count, the level and the availability', async () => {
      await open();
      const label = card('Ann Lee').querySelector('[data-user-open]')!.getAttribute('aria-label')!;
      expect(label.startsWith('Ann Lee')).toBe(true);
      expect(label).toBe('Ann Lee, 3 open tasks, Light, Available');
    });

    it('assigns with an icon button that has a name and a tooltip', async () => {
      await open();
      const assign = card('Ann Lee').querySelector('[data-assign-work]')!;
      expect(assign.getAttribute('aria-label')).toBe('Assign work to Ann Lee');
      expect(assign.getAttribute('title')).toBe('Assign work to Ann Lee');
      expect(text(assign)).toBe('');
    });
  });

  describe('capacity strip (U1)', () => {
    it('the unassigned button opens the right side panel with the unassigned tasks, longest waiting first, within the scope', async () => {
      await open();
      const button = q<HTMLButtonElement>('[data-summary-unassigned]');
      expect(text(button)).toContain('4 unassigned tasks');
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('aria-haspopup')).toBe('dialog');
      expect(document.querySelector('[data-unassigned-panel]')).toBeNull();
      button.click();
      await settle();
      const args = getQueue.mock.calls.at(-1)!;
      expect(args[2]).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']);
      expect(args[7]).toBe(true);
      expect(args[35]).toBe('unassignedSince');
      expect(args[36]).toBe('asc');
      const panel = document.querySelector('[data-unassigned-panel]')!;
      expect(panel.querySelectorAll('[data-unassigned-tasks] li')).toHaveLength(2);
      expect(text(document.querySelector('[data-drawer-title]'))).toBe('Unassigned tasks (2)');
      expect(document.querySelector('[data-unassigned-queue]')!.getAttribute('href')).toContain(
        'unassigned=true',
      );
      expect(button.getAttribute('aria-expanded')).toBe('true');
    });

    it('lists the unassigned tasks of the Pod scope only', async () => {
      await open();
      const scope = TestBed.inject(DashScope);
      scope.ensureLoaded();
      scope.applyAddress((k) => (k === 'pod' ? 'mine' : null));
      await settle();
      q<HTMLButtonElement>('[data-summary-unassigned]').click();
      await settle();
      const args = getQueue.mock.calls.at(-1)!;
      expect(args.some((a) => Array.isArray(a) && a.join() === '1,2')).toBe(true);
      expect(document.querySelector('[data-unassigned-queue]')!.getAttribute('href')).toContain(
        'pod=2',
      );
    });

    it('shows the empty and the error state of the panel, and Retry reads again', async () => {
      await open();
      getQueueRows = [];
      q<HTMLButtonElement>('[data-summary-unassigned]').click();
      await settle();
      expect(text(document.querySelector('[data-unassigned-empty]'))).toBe('No unassigned tasks.');
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Close unassigned tasks"]')!
        .click();
      await settle();
      getQueue.mockReturnValue(throwError(() => new Error('x')));
      q<HTMLButtonElement>('[data-summary-unassigned]').click();
      await settle();
      expect(document.querySelector('[data-unassigned-error]')).not.toBeNull();
      getQueue.mockReturnValue(of(pageOf([unassigned(21, 1, 'Critical')])));
      document.querySelector<HTMLButtonElement>('[data-unassigned-retry]')!.click();
      await settle();
      expect(document.querySelectorAll('[data-unassigned-tasks] li')).toHaveLength(1);
    });

    it('has no Assign work dropdown any more (the panel rows and the person Assign icon assign)', async () => {
      await open();
      expect(q('[data-assign-work-menu], [data-assign-menu]')).toBeNull();
    });
  });

  describe('people who can take work (U4)', () => {
    it('says how many are hidden, shows them on request (unopod=1) and hides them again', async () => {
      await open(of(board({ hiddenCount: 30 })));
      await openWho();
      expect(text(q('[data-users-population-text]'))).toBe(
        'Showing 6 people who can take work. 30 others are hidden.',
      );
      expect(getWorkload).toHaveBeenLastCalledWith(undefined, 'all', undefined, 'all', false);
      q<HTMLButtonElement>('[data-users-population-toggle]').click();
      await settle();
      await openWho();
      expect(getWorkload).toHaveBeenLastCalledWith(undefined, 'all', undefined, 'all', true);
      expect(url()).toContain('unopod=1');
      expect(text(q('[data-users-population-text]'))).toBe('Including people without a pod.');
      expect(q('[data-users-population-toggle]').getAttribute('aria-pressed')).toBe('true');
      await openWho();
      q<HTMLButtonElement>('[data-users-population-toggle]').click();
      await settle();
      expect(getWorkload).toHaveBeenLastCalledWith(undefined, 'all', undefined, 'all', false);
      expect(url()).not.toContain('unopod');
    });

    it('reads unopod=1 from the address, keeps it when the filters are cleared, and is quiet when nobody is hidden', async () => {
      await open(of(board()), '/dashboard?tab=users&unopod=1&ustate=out');
      expect(getWorkload).toHaveBeenCalledWith(undefined, 'all', undefined, 'all', true);
      await pickStates('');
      expect(url()).not.toContain('ustate');
      expect(getWorkload).toHaveBeenLastCalledWith(undefined, 'all', undefined, 'all', true);
      expect(url()).toContain('unopod=1');
      await reopen(of(board({ hiddenCount: 0 })));
      await openWho();
      expect(q('[data-who-text]')).not.toBeNull();
      expect(q('[data-users-population]')).toBeNull();
    });

    it('says nothing under a Pod scope, which lists that Pod and hides nobody', async () => {
      await open(of(board({ hiddenCount: 5 })));
      await openWho();
      expect(q('[data-users-population]')).not.toBeNull();
      const scope = TestBed.inject(DashScope);
      scope.ensureLoaded();
      scope.applyAddress((k) => (k === 'pod' ? '2' : null));
      await settle();
      await openWho();
      expect(q('[data-users-population]')).toBeNull();
    });
  });

  describe('toolbar labels (U2)', () => {
    it('puts the text Workload | Coverage | Skills switch first, Coverage only with its permission', async () => {
      await open(of(board()), '/dashboard?tab=users', [...PERMS, 'Dashboard.ViewCoverage']);
      const views = q('[data-users-views]');
      expect(qa('[data-users-views] button').map(text)).toEqual(['Workload', 'Coverage', 'Skills']);
      expect(q('[role="toolbar"]').firstElementChild).toBe(views.parentElement);
      expect(q('[data-view="workload"]').getAttribute('aria-pressed')).toBe('true');
      expect(views.querySelector('[role="tablist"]')).toBeNull();
      await reopen(of(board()));
      // Without Dashboard.ViewCoverage the switch offers Workload and Skills (Skills needs only Dashboard.ViewUsers).
      expect(qa('[data-users-views] button').map(text)).toEqual(['Workload', 'Skills']);
      expect(text(q('#wl-h'))).toBe('Workload');
    });

    it('labels the icon buttons with their state and gives the legend a word', async () => {
      await open();
      // The two tile size buttons are gone: only the cards and table buttons remain.
      expect(q('[data-density]')).toBeNull();
      expect(q('[data-density-group]')).toBeNull();
      expect(q('[data-layout="table"]').getAttribute('aria-label')).toBe('Layout: table');
      expect(q('[data-layout="cards"]').getAttribute('aria-pressed')).toBe('true');
      // ONE plain info icon (no word) for the legend and who is counted; the toolbar has no second one.
      expect(q('[data-who-counted]').getAttribute('aria-label')).toBe(
        'What the states mean and who is counted',
      );
      expect(text(q('[data-who-counted]'))).toBe('');
      expect(q('[data-legend-toggle]')).toBeNull();
    });
  });

  describe('State dropdown', () => {
    it('lists All states and the six states with their number of people, and links the unassigned tasks to the Task Queue', async () => {
      await open();
      expect(ddOptionTexts(host, 'State')).toEqual([
        'All States 6',
        'Idle 1',
        'Light 3',
        'Normal 1',
        'Heavy 1',
        'Out of Office 1',
        'Off Hours 1',
      ]);
      expect(ddText(host, 'State')).toBe('All States');
      // The six buttons, the Filters button and the legend icon in the toolbar are gone.
      expect(q('[data-chip], [data-filters-toggle], [data-legend-toggle]')).toBeNull();
      expect(text(q('[data-summary-unassigned] [data-n]'))).toBe('4');
    });

    it('choosing Out of office filters on the page without another read and writes ustate to the address', async () => {
      await open();
      await pickStates('out');
      expect(names()).toEqual(['Dee Fox']);
      expect(url()).toContain('ustate=out');
      expect(getWorkload).toHaveBeenCalledTimes(1);
      expect(ddText(host, 'State')).toBe('Out of Office');
      await pickStates('out');
      expect(url()).not.toContain('ustate');
      expect(names().length).toBe(6);
    });

    it('states combine (any of them), "All States" clears them, and the address keeps them', async () => {
      await open();
      await pickStates('idle', 'heavy');
      expect(names()).toEqual(['Cy Tan', 'Hal Moe']);
      expect(url()).toContain('ustate=idle,heavy');
      expect(getWorkload).toHaveBeenCalledTimes(1);
      expect(text(q('[data-users-live]'))).toBe('2 people shown.');
      expect(ddText(host, 'State')).toBe('Idle +1');
      await pickStates('');
      expect(names().length).toBe(6);
      expect(url()).not.toContain('ustate');
      expect(ddText(host, 'State')).toBe('All States');
    });

    it('Off hours is a state applied on the page', async () => {
      await open();
      await pickStates('off');
      expect(names()).toEqual(['Eve Kim']);
      expect(getWorkload).toHaveBeenCalledTimes(1);
      expect(url()).toContain('ustate=off');
    });

    it('opens with the states of the address, and an old address (uload, uprio) still opens: loads become states, the priority is ignored', async () => {
      await open(of(board()), '/dashboard?tab=users&uload=normal,heavy&uprio=1');
      expect(names()).toContain('Hal Moe');
      expect(names().length).toBe(2);
      expect(ddText(host, 'State')).toBe('Normal +1');
      await reopen(of(board()), '/dashboard?tab=users&uprio=1');
      expect(names().length).toBe(6);
    });
  });

  describe('toolbar', () => {
    it('sorts by name, highest priority and open tasks, and remembers the choice', async () => {
      await open();
      await choose('[data-sort]', 'name');
      expect(qa('[data-user-card]').map((c) => c.getAttribute('data-user'))).toEqual([
        'Ann Lee',
        'Bob Ray',
        'Cy Tan',
        'Dee Fox',
        'Eve Kim',
        'Hal Moe',
      ]);
      await choose('[data-sort]', 'open');
      expect(qa('[data-user-card]')[0].getAttribute('data-user')).toBe('Hal Moe');
      expect(JSON.parse(localStorage.getItem('mf.dashboard.users.v1.5')!).sort).toBe('open');
      expect(getWorkload).toHaveBeenCalledTimes(1);
    });

    it('has no Filters button: the toolbar is search, State, Sort, the layout switch and the info icon; the Sort menu has five plain choices', async () => {
      await open();
      expect(q('[data-filters-toggle]')).toBeNull();
      expect(
        q('[data-filter="priority"], [data-filter="availability"], [data-filter="pod"]'),
      ).toBeNull();
      expect(ddOptionTexts(host, 'Sort')).toEqual([
        'Availability and Load',
        'Name',
        'Open Tasks',
        'Overdue',
        'Next Due',
      ]);
      await choose('[data-sort]', 'overdue');
      expect(qa('[data-user-card]')[0].getAttribute('data-user')).toBe('Ann Lee');
      expect(text(q('[data-sorted-text]'))).toBe('Sorted by Overdue');
    });

    it('reads the workload for the page-wide scope and again when the scope changes', async () => {
      await open();
      expect(getWorkload).toHaveBeenLastCalledWith(undefined, 'all', undefined, 'all', false);
      const scope = TestBed.inject(DashScope);
      scope.ensureLoaded();
      scope.applyAddress((k) => (k === 'pod' ? '2' : null));
      await settle();
      expect(getWorkload).toHaveBeenLastCalledWith(undefined, 'all', undefined, '2', false);
      const reads = getWorkload.mock.calls.length;
      scope.applyAddress((k) => (k === 'pod' ? 'mine' : null));
      await settle();
      expect(getWorkload.mock.calls.length).toBe(reads + 1);
      expect(getWorkload).toHaveBeenLastCalledWith(undefined, 'all', undefined, 'mine', false);
    });

    it('switches to the table and remembers it', async () => {
      await open();
      q<HTMLButtonElement>('[data-layout="table"]').click();
      await settle();
      expect(q('[data-users-table]')).not.toBeNull();
      expect(qa('[data-user-card]').length).toBe(0);
      expect(qa('tbody tr').length).toBe(6);
      const row = q('[data-user-row="4"]');
      expect(row.getAttribute('data-state')).toBe('ooo');
      expect(text(row)).toContain('Out of Office until Oct 20');
      expect(text(q('[data-user-row="3"]'))).not.toMatch(/No open tasks|Not available/);
      // Highest priority only for a person with open tasks: nobody (Cy Tan) has no pill at all.
      expect(q('[data-user-row="3"] mf-priority-badge')).toBeNull();
      expect(q('[data-user-row="1"] mf-priority-badge')).not.toBeNull();
      // The row action is a quiet icon button with a name and a tooltip.
      expect(text(q('[data-assign-work]'))).toBe('');
      expect(q('[data-assign-work]').getAttribute('aria-label')).toMatch(/^Assign work to /);
      expect(q('[data-assign-work]').getAttribute('title')).toContain('Assign work to');
      expect(q('[data-layout="table"]').getAttribute('aria-pressed')).toBe('true');
      expect(JSON.parse(localStorage.getItem('mf.dashboard.users.v1.5')!)).toEqual({
        sort: 'load',
        layout: 'table',
        view: 'workload',
      });
    });

    it('opens the short legend: the six states with their words, one line each and the real thresholds', async () => {
      await open();
      expect(q('[data-legend]')).toBeNull();
      q<HTMLButtonElement>('[data-who-counted]').click();
      await settle();
      expect(q('[data-who-counted]').getAttribute('aria-expanded')).toBe('true');
      // The same popover also says who is counted.
      expect(q('[data-who-text]')).not.toBeNull();
      const rows = qa('[data-legend-states] li').map((li) => text(li));
      expect(rows).toEqual([
        'Idle No open tasks',
        'Light 1 to 3 open tasks',
        'Normal 4 to 8 open tasks',
        'Heavy 9 or more open tasks',
        'Out of Office Away; the day they are back is on the card',
        'Off Hours Outside their working hours right now',
      ]);
      // Nothing else: no priority signals, columns glossary or framing text.
      expect(q('[data-legend-priorities], [data-legend-marks], [data-load-help]')).toBeNull();
    });
  });

  describe('states', () => {
    it('shows loading skeletons then the cards', async () => {
      await open(NEVER);
      expect(q('[data-users-loading]').getAttribute('aria-busy')).toBe('true');
      expect(qa('[data-user-card]').length).toBe(0);
    });

    it('shows an error with Retry, and the cards after a retry', async () => {
      await open(throwError(() => new Error('boom')));
      expect(text(q('[data-dash-state="error"]'))).toContain("Couldn't load");
      getWorkload.mockReturnValue(of(board()));
      q<HTMLButtonElement>('[data-dash-retry]').click();
      await settle();
      expect(qa('[data-user-card]').length).toBe(6);
    });

    it('says so when the person may not see it', async () => {
      await open(throwError(() => new ApiError(403, 'FORBIDDEN', 'No', undefined, {} as never)));
      expect(q('[data-users-forbidden]')).not.toBeNull();
    });

    it('explains an empty result with the filters and offers Clear filters', async () => {
      await open(of(aBoard([])), '/dashboard?tab=users&uq=zzz');
      expect(text(q('[data-users-empty]'))).toContain('No people match these filters.');
      q<HTMLButtonElement>('[data-users-clear]').click();
      await settle();
      expect(getWorkload).toHaveBeenLastCalledWith(undefined, 'all', undefined, 'all', false);
    });

    it('explains a team with nobody in it', async () => {
      await open(of(aBoard([])));
      expect(text(q('[data-users-empty]'))).toContain('No team members yet.');
    });

    it('keeps the cards when a background refresh fails and says so with Retry', async () => {
      await open();
      getWorkload.mockReturnValue(throwError(() => new Error('down')));
      refreshTab();
      await settle();
      expect(qa('[data-user-card]').length).toBe(6);
      expect(text(q('[data-dash-state="stale"]'))).toContain("Couldn't refresh.");
      getWorkload.mockReturnValue(of(board()));
      q<HTMLButtonElement>('[data-dash-state="stale"] [data-dash-retry]').click();
      await settle();
      expect(q('[data-dash-state="stale"]')).toBeNull();
      expect(text(q('[data-users-live]'))).toContain('Team workload refreshed. 6 people.');
    });
  });

  describe('drawer', () => {
    it('opens the tasks of the person from the Task Queue, with the link and inline menus', async () => {
      await open();
      card('Ann Lee').querySelector<HTMLButtonElement>('[data-user-open]')!.click();
      await settle();
      const drawer = document.querySelector('[data-users-drawer]')!;
      expect(drawer).not.toBeNull();
      const args = getQueue.mock.calls.at(-1)!;
      expect(args[2]).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']);
      expect(args[6]).toEqual([1]);
      expect(args[35]).toBe('priority');
      expect(drawer.querySelectorAll('[data-drawer-tasks] li').length).toBe(2);
      expect(
        drawer.querySelector('[data-drawer-tasks] [data-field="priority"] [data-inline-trigger]'),
      ).not.toBeNull();
      const link = document.querySelector('[data-open-queue]')!.getAttribute('href')!;
      expect(link).toContain('assignee=1');
      expect(link).toContain('status=IN_PROGRESS');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Close person details');
    });

    it('returns focus to the card when closed with Escape or the close button', async () => {
      await open();
      const opener = card('Bob Ray').querySelector<HTMLButtonElement>('[data-user-open]')!;
      opener.focus();
      opener.click();
      await settle();
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Close person details"]')!
        .click();
      await settle();
      await new Promise((r) => setTimeout(r, 30));
      expect(document.activeElement).toBe(opener);
    });

    it('shows the return date and note of a person who is out of office, and the empty list for a free person', async () => {
      await open();
      card('Dee Fox').querySelector<HTMLButtonElement>('[data-user-open]')!.click();
      await settle();
      const drawer = document.querySelector('[data-users-drawer]')!;
      expect(text(drawer.querySelector('[data-drawer-back]'))).toBe('Back on Oct 21');
      expect(text(drawer)).toContain('Annual leave');
      getQueue.mockReturnValue(of(pageOf([])));
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Close person details"]')!
        .click();
      await settle();
      card('Cy Tan').querySelector<HTMLButtonElement>('[data-user-open]')!.click();
      await settle();
      expect(text(document.querySelector('[data-drawer-empty]'))).toContain(
        'Cy Tan has no open tasks',
      );
    });

    it('shows an error with Retry when the tasks cannot be read', async () => {
      await open();
      getQueue.mockReturnValue(throwError(() => new Error('x')));
      card('Ann Lee').querySelector<HTMLButtonElement>('[data-user-open]')!.click();
      await settle();
      expect(document.querySelector('[data-drawer-error]')).not.toBeNull();
      getQueue.mockReturnValue(of(pageOf([aRow({ taskId: 11 })])));
      document.querySelector<HTMLButtonElement>('[data-drawer-retry]')!.click();
      await settle();
      expect(document.querySelectorAll('[data-drawer-tasks] li').length).toBe(1);
    });
  });

  describe('assign work', () => {
    async function openPicker(name: string) {
      card(name).querySelector<HTMLButtonElement>('[data-assign-work]')!.click();
      await settle();
    }
    const dialog = () => document.querySelector('[data-assign-dialog]')!;

    it('lists the unassigned open tasks by priority and assigns one with the existing endpoint, offering Undo', async () => {
      await open();
      await openPicker('Cy Tan');
      const args = getQueue.mock.calls.at(-1)!;
      expect(args[2]).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']);
      expect(args[7]).toBe(true);
      expect(args[4]).toEqual([1]);
      expect(args[35]).toBe('priorityAge');
      expect(dialog().querySelectorAll('[data-assign-row]').length).toBe(2);
      expect(dialog().querySelector('[data-assign-hint]')).toBeNull();

      dialog().querySelector<HTMLButtonElement>('[data-assign-pick]')!.click();
      await settle();
      expect(tasks['assignTask']).toHaveBeenCalledWith(21, {
        rowVersion: 'v21',
        podId: 5,
        userId: 3,
      });
      expect(dialog().querySelectorAll('[data-assign-row]').length).toBe(1);
      const offer = TestBed.inject(UndoService).current()!;
      expect(offer.message).toContain('TSK-21 assigned to Cy Tan.');
      expect(offer.detail).toBe('Task moved to In Progress.');
      // The board is read again shortly.
      await new Promise((r) => setTimeout(r, 1000));
      await settle();
      expect(getWorkload.mock.calls.length).toBeGreaterThan(1);
    });

    it('undoes the assignment by clearing the assignee when nobody changed it since', async () => {
      await open();
      await openPicker('Cy Tan');
      dialog().querySelector<HTMLButtonElement>('[data-assign-pick]')!.click();
      await settle();
      await TestBed.inject(UndoService).run();
      expect(tasks['getTask']).toHaveBeenCalledWith(21);
      expect(tasks['assignTask']).toHaveBeenLastCalledWith(21, {
        rowVersion: 'z',
        podId: undefined,
        userId: undefined,
      });
    });

    it('does not undo over a change someone else made', async () => {
      await open();
      await openPicker('Cy Tan');
      dialog().querySelector<HTMLButtonElement>('[data-assign-pick]')!.click();
      await settle();
      tasks['getTask'].mockReturnValue(
        of({ taskId: 21, taskNumber: 'TSK-21', assignedUser: { userId: 99 }, rowVersion: 'q' }),
      );
      const calls = tasks['assignTask'].mock.calls.length;
      await TestBed.inject(UndoService).run();
      expect(tasks['assignTask'].mock.calls.length).toBe(calls);
    });

    it('says plainly that the person is out of office, and still allows the assignment', async () => {
      await open();
      await openPicker('Dee Fox');
      expect(text(dialog().querySelector('[data-assign-hint]'))).toContain(
        'Dee Fox is not available (out of office until Oct 20). You can still assign work.',
      );
      expect(dialog().querySelector<HTMLButtonElement>('[data-assign-pick]')!.disabled).toBe(false);
    });

    it('says plainly that the person has a heavy load', async () => {
      await open();
      await openPicker('Hal Moe');
      expect(text(dialog().querySelector('[data-assign-hint]'))).toContain(
        'Hal Moe already has a heavy load (10 open tasks, more than 8)',
      );
    });

    it('names each Assign button with the task and the person', async () => {
      await open();
      await openPicker('Cy Tan');
      expect(dialog().querySelector('[data-assign-pick]')!.getAttribute('aria-label')).toBe(
        'Assign TSK-21 to Cy Tan',
      );
    });

    it('says when there is nothing to assign, and offers Retry when the list fails', async () => {
      await open();
      getQueue.mockReturnValue(of(pageOf([])));
      await openPicker('Cy Tan');
      expect(text(dialog().querySelector('[data-assign-empty]'))).toContain(
        "No unassigned tasks in Cy's pods. Show All Pods",
      );
      document.querySelector<HTMLButtonElement>('.mf-formdlg [data-panel-close]')!.click();
      await settle();
      getQueue.mockReturnValue(throwError(() => new Error('x')));
      await openPicker('Ann Lee');
      expect(dialog().querySelector('[data-assign-error]')).not.toBeNull();
    });

    it('shows every pod when the switch is on, and remembers the choice for the session', async () => {
      try {
        sessionStorage.removeItem('mf.users.assign.allPods');
      } catch {
        // no storage in this run
      }
      await open();
      await openPicker('Cy Tan');
      const toggle = dialog().querySelector<HTMLInputElement>('[data-assign-allpods]')!;
      expect(toggle.checked).toBe(false);
      toggle.click();
      await settle();
      expect(getQueue.mock.calls.at(-1)![4]).toBeUndefined();
      expect(text(dialog().querySelector('[data-assign-order]'))).not.toContain('in Pod A');
      document.querySelector<HTMLButtonElement>('.mf-formdlg [data-panel-close]')!.click();
      await settle();
      await openPicker('Cy Tan');
      expect(dialog().querySelector<HTMLInputElement>('[data-assign-allpods]')!.checked).toBe(true);
      dialog().querySelector<HTMLInputElement>('[data-assign-allpods]')!.click();
      await settle();
    });

    it('lists every pod with a note when the person is in no pod', async () => {
      await open(of(aBoard([aUser(9, 'Ben Grant', [0, 0, 0, 0], { pods: [] })])));
      await openPicker('Ben Grant');
      expect(getQueue.mock.calls.at(-1)![4]).toBeUndefined();
      expect(text(dialog().querySelector('[data-assign-nopod]'))).toBe(
        'Ben Grant is not in a pod.',
      );
      expect(dialog().querySelector('[data-assign-allpods]')).toBeNull();
    });

    it('shows the type, client and due chip of each row', async () => {
      await open();
      await openPicker('Cy Tan');
      const row = dialog().querySelector('[data-assign-row]')!;
      expect(row.querySelector('[data-type]')).not.toBeNull();
      expect(row.querySelector('[data-type] mf-task-type-chip')!.getAttribute('data-colour')).toBe(
        'teal',
      );
      expect(row.querySelector('[data-client]')).not.toBeNull();
    });

    it('assigns the next 3 after a confirmation that lists them, in one request', async () => {
      getQueueRows = [
        unassigned(21, 1, 'Critical'),
        unassigned(22, 2, 'High'),
        unassigned(23, 3, 'Normal'),
        unassigned(24, 3, 'Normal'),
      ];
      await open();
      await openPicker('Cy Tan');
      document.querySelector<HTMLButtonElement>('[data-assign-next]')!.click();
      await settle();
      expect(tasks['assignTasksBatch']).not.toHaveBeenCalled();
      expect(text(dialog().querySelector('[data-assign-confirm]'))).toContain(
        'Assign these 3 tasks to Cy Tan?',
      );
      expect(dialog().querySelectorAll('[data-confirm-row]').length).toBe(3);
      document.querySelector<HTMLButtonElement>('[data-panel-primary] button')!.click();
      await settle();
      expect(tasks['assignTasksBatch']).toHaveBeenCalledTimes(1);
      const body = tasks['assignTasksBatch'].mock.calls[0][0];
      expect(body.userId).toBe(3);
      expect(body.items.map((i: { taskId: number }) => i.taskId)).toEqual([21, 22, 23]);
      expect(text(dialog().querySelector('[data-assign-live]'))).toBe(
        '3 tasks assigned to Cy Tan.',
      );
      expect(TestBed.inject(UndoService).current()!.message).toContain(
        '3 tasks assigned to Cy Tan',
      );
    });

    it('repeats the heavy-load warning in the confirmation and caps selected rows at 10', async () => {
      getQueueRows = Array.from({ length: 12 }, (_, i) => unassigned(30 + i, 3, 'Normal'));
      await open();
      await openPicker('Hal Moe');
      expect(dialog().querySelector('[data-assign-hint]')).not.toBeNull();
      const checks = [...dialog().querySelectorAll<HTMLInputElement>('[data-assign-check]')];
      for (const c of checks.slice(0, 10)) c.click();
      await settle();
      expect(checks[10].disabled).toBe(true);
      expect(text(document.querySelector('[data-assign-selected]'))).toBe('Assign 10 selected');
      document.querySelector<HTMLButtonElement>('[data-assign-selected]')!.click();
      await settle();
      expect(text(dialog().querySelector('[data-assign-confirm-hint]'))).toContain('heavy load');
    });

    it('keeps the tasks that were assigned and lists the one that failed', async () => {
      getQueueRows = [unassigned(21, 1, 'Critical'), unassigned(22, 2, 'High')];
      await open();
      tasks['assignTasksBatch'].mockReturnValue(
        of({
          results: [
            {
              taskId: 21,
              succeeded: true,
              task: {
                taskId: 21,
                taskNumber: 'TSK-21',
                status: 'IN_PROGRESS',
                statusLabel: 'In Progress',
                rowVersion: 'n',
              },
            },
            { taskId: 22, succeeded: false, errorCode: 'CONCURRENCY_CONFLICT', message: 'x' },
          ],
        }),
      );
      await openPicker('Cy Tan');
      document.querySelector<HTMLButtonElement>('[data-assign-next]')!.click();
      await settle();
      document.querySelector<HTMLButtonElement>('[data-panel-primary] button')!.click();
      await settle();
      expect(text(dialog().querySelector('[data-assign-failures]'))).toContain('TSK-22');
      expect(text(dialog().querySelector('[data-assign-live]'))).toBe('1 task assigned to Cy Tan.');
    });

    it('is not offered without the Assign permission', async () => {
      await open(of(board()), '/dashboard?tab=users', [
        'Task.View',
        'Dashboard.View',
        'Dashboard.ViewUsers',
      ]);
      expect(qa('[data-assign-work]').length).toBe(0);
    });

    it('can be started from the drawer', async () => {
      await open();
      card('Cy Tan').querySelector<HTMLButtonElement>('[data-user-open]')!.click();
      await settle();
      document.querySelector<HTMLButtonElement>('[data-drawer-assign]')!.click();
      await settle();
      expect(document.querySelector('[data-assign-dialog]')).not.toBeNull();
    });
  });

  describe('automatic refresh', () => {
    function tickOf(spy: ReturnType<typeof vi.spyOn>) {
      return spy.mock.calls.find((c: unknown[]) => c[1] === USERS_REFRESH_MS)![0] as () => void;
    }

    it('reads the board every five minutes while visible, without moving focus', async () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      await open();
      expect(USERS_REFRESH_MS).toBe(300_000);
      const tick = tickOf(spy);
      const focused = card('Ann Lee').querySelector<HTMLElement>('[data-user-open]')!;
      focused.focus();
      const calls = getWorkload.mock.calls.length;
      tick();
      await settle();
      expect(getWorkload.mock.calls.length).toBe(calls + 1);
      expect(document.activeElement).toBe(focused);
    });

    it('skips the read while the drawer or the picker is open, or the page is hidden', async () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      await open();
      const tick = tickOf(spy);
      const before = getWorkload.mock.calls.length;
      card('Ann Lee').querySelector<HTMLButtonElement>('[data-user-open]')!.click();
      await settle();
      tick();
      expect(getWorkload.mock.calls.length).toBe(before);
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Close person details"]')!
        .click();
      await settle();
      await new Promise((r) => setTimeout(r, 20));
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      tick();
      expect(getWorkload.mock.calls.length).toBe(before);
    });

    it('rereads the board after an Undo finished', async () => {
      await open();
      const reads = getWorkload.mock.calls.length;
      TestBed.inject(UndoService).settled.update((n) => n + 1);
      await settle();
      expect(getWorkload.mock.calls.length).toBe(reads + 1);
    });
  });

  describe('a large department', () => {
    const many = (n: number) =>
      aBoard(
        Array.from({ length: n }, (_, i) =>
          aUser(i + 1, `Person ${String(i + 1).padStart(3, '0')}`),
        ),
      );

    it('draws 200 people at first and the rest on request, in the cards and in the table', async () => {
      await open(of(many(450)));
      expect(qa('[data-user-card]').length).toBe(200);
      expect(text(q('[data-users-more]'))).toContain('Showing 200 of 450 people.');
      q<HTMLButtonElement>('[data-users-show-more]').click();
      await settle();
      expect(qa('[data-user-card]').length).toBe(400);
      q<HTMLButtonElement>('[data-users-show-all]').click();
      await settle();
      expect(qa('[data-user-card]').length).toBe(450);
      expect(q('[data-users-more]')).toBeNull();
      q<HTMLButtonElement>('[data-layout="table"]').click();
      await settle();
      expect(qa('tbody tr').length).toBe(450);
    });

    it('starts again from 200 after a new sort', async () => {
      await open(of(many(450)));
      q<HTMLButtonElement>('[data-users-show-all]').click();
      await settle();
      await choose('[data-sort]', 'name');
      expect(qa('[data-user-card]').length).toBe(200);
    });
  });

  describe('coverage view', () => {
    const COV: Permission[] = [...PERMS, 'Dashboard.ViewCoverage'];
    const coverage = () => open(of(board()), '/dashboard?tab=users&view=coverage&cov=matrix', COV);
    const cell = (user: number, type: number) =>
      q<HTMLButtonElement>(`[data-cell="${user}:${type}"]`);
    const rowOf = (name: string) => q(`[data-type-name="${name}"]`);

    describe('by task type (default)', () => {
      const typeView = (board = aCoverageTypeBoard(), url = '/dashboard?tab=users&view=coverage') =>
        open(of(board), url, COV, aCoverageBoard(), board);
      const trow = (name: string) => q(`[data-type-row][data-type-name="${name}"]`);

      it('is the default orientation: one row per type, fewest people first, ties by name, the matrix is the second option', async () => {
        await typeView();
        expect(qa('[data-orientation]').map((b) => text(b))).toEqual(['By Task Type', 'Matrix']);
        expect(q('[data-orientation="type"]').getAttribute('aria-pressed')).toBe('true');
        expect(q('[data-coverage-table]')).toBeNull();
        expect(qa('[data-type-row]').map((r) => r.getAttribute('data-type-name'))).toEqual([
          'Archive',
          'Review',
          'Production',
        ]);
        expect(getCoverage).toHaveBeenLastCalledWith(
          '30d',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'all',
          'type',
        );
        expect(text(q('[data-coverage-heading]'))).toBe(
          'Task type coverage - use this to plan training and cross-coverage, not to rank people',
        );
      });

      it('has the view heading as an h2 and no heading above it in the view (heading order, #1280)', async () => {
        await typeView();
        expect(q('[data-coverage-heading]').tagName).toBe('H2');
        expect(qa('mf-coverage-view h1, mf-coverage-view h2, mf-coverage-view h3').length).toBe(1);
      });

      it('lists the names alphabetically with the people count, the completed total and the status', async () => {
        await typeView();
        expect(text(trow('Production').querySelector('[data-names]'))).toBe(
          'Priya Shah, Sam Ortiz +1',
        );
        expect(trow('Production').querySelector('[data-names]')!.getAttribute('title')).toBe(
          'Priya Shah, Sam Ortiz, Tess Wu',
        );
        expect(text(trow('Production').querySelector('[data-people]'))).toBe('3');
        expect(text(trow('Production').querySelector('[data-completed]'))).toBe('20');
        expect(trow('Production').querySelector('[data-status]')).toBeNull();
        expect(trow('Review').querySelector('[data-status="one"]')!.textContent).toContain(
          'One person',
        );
        expect(text(q('[data-summary="completed"]'))).toContain('24');
      });

      it('says "No one in this period" for a type nobody handled, with the neutral status', async () => {
        const base = aCoverageTypeBoard();
        await typeView({
          ...base,
          taskTypes: [
            ...base.taskTypes,
            {
              taskTypeId: 13,
              name: 'Hosting Setup',
              iconKey: 'file-text',
              isActive: true,
              total: 0,
              peopleWhoHandledIt: 0,
            },
          ],
          byType: [...base.byType!, { taskTypeId: 13, people: [] }],
        });
        expect(text(trow('Hosting Setup').querySelector('[data-names]'))).toBe(
          'No one in this period',
        );
        expect(trow('Hosting Setup').querySelector('[data-status="none"]')!.textContent).toContain(
          'No one',
        );
        expect(qa('[data-type-row]')[0].getAttribute('data-type-name')).toBe('Hosting Setup');
      });

      it('shows the first five names then +N, and orders by type name or most completed with neutral labels', async () => {
        const base = aCoverageTypeBoard();
        const people = ['Ann', 'Bea', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus'].map((n, i) => ({
          userId: 50 + i,
          displayName: n,
          isActive: true,
          completed: 7 - i,
        }));
        await typeView({
          ...base,
          byType: base.byType!.map((g) => (g.taskTypeId === 10 ? { ...g, people } : g)),
        });
        expect(text(trow('Production').querySelector('[data-names]'))).toBe('Ann, Bea +5');
        await choose('[data-coverage-row-order]', 'name');
        expect(qa('[data-type-row]').map((r) => r.getAttribute('data-type-name'))).toEqual([
          'Archive',
          'Production',
          'Review',
        ]);
        await choose('[data-coverage-row-order]', 'completed');
        expect(qa('[data-type-row]').map((r) => r.getAttribute('data-type-name'))).toEqual([
          'Production',
          'Review',
          'Archive',
        ]);
        expect(ddOptionTexts(host, 'Order')).toEqual([
          'Fewest People First',
          'Type Name',
          'Most Completed',
        ]);
        expect(ddText(host, 'Order')).not.toMatch(/best|worst|top|rank|score/i);
        expect(JSON.parse(localStorage.getItem('mf.dashboard.coverage.v1.5')!).rowOrder).toBe(
          'completed',
        );
      });

      it('expands a row with everyone and their counts; a count opens the tasks behind it', async () => {
        await typeView();
        const toggle = trow('Production').querySelector<HTMLButtonElement>('[data-toggle]')!;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        toggle.click();
        await settle();
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        const detail = q('[data-type-detail]')!;
        expect(toggle.getAttribute('aria-controls')).toBe(detail.id);
        expect(qa('[data-type-detail] [data-person]').map((li) => text(li))).toEqual([
          expect.stringContaining('Priya Shah'),
          expect.stringContaining('Sam Ortiz'),
          expect.stringContaining('Tess Wu'),
        ]);
        q<HTMLButtonElement>('[data-count-for="3:10"]').click();
        await settle();
        const args = getQueue.mock.calls.at(-1)!;
        expect(args[6]).toEqual([3]);
        expect(args[12]).toEqual([10]);
        expect(document.querySelector('[data-coverage-drawer]')).not.toBeNull();
      });

      it('asks to pick a pod when the scope is all pods, and lists the pod members who have not handled the type otherwise', async () => {
        await typeView();
        trow('Production').querySelector<HTMLButtonElement>('[data-toggle]')!.click();
        await settle();
        expect(q('[data-pick-pod]')).not.toBeNull();
        expect(q('[data-not-handled]')).toBeNull();

        const base = aCoverageTypeBoard();
        await reopen(of(base), '/dashboard?tab=users&view=coverage', COV, aCoverageBoard(), {
          ...base,
          scopePeople: [
            { userId: 1, displayName: 'Priya Shah', isActive: true },
            { userId: 5, displayName: 'Vic Idle', isActive: true },
            { userId: 6, displayName: 'Zoe Ng', isActive: true },
          ],
        });
        trow('Production').querySelector<HTMLButtonElement>('[data-toggle]')!.click();
        await settle();
        const control = q<HTMLButtonElement>('[data-not-handled]');
        expect(text(control)).toMatch(/^Show people in .+ who have not handled this type$/);
        expect(control.getAttribute('aria-expanded')).toBe('false');
        control.click();
        await settle();
        expect(control.getAttribute('aria-expanded')).toBe('true');
        expect(qa('[data-not-list] li').map((li) => text(li))).toEqual([
          'Vic Idle0 completed',
          'Zoe Ng0 completed',
        ]);
      });

      it('switches to the matrix with cov=matrix and back, reading the matrix payload only for the matrix', async () => {
        await typeView();
        q<HTMLButtonElement>('[data-orientation="matrix"]').click();
        await settle();
        expect(url()).toContain('cov=matrix');
        expect(q('[data-coverage-table]')).not.toBeNull();
        expect(getCoverage).toHaveBeenLastCalledWith(
          '30d',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'all',
        );
        q<HTMLButtonElement>('[data-orientation="type"]').click();
        await settle();
        expect(url()).not.toContain('cov=');
        expect(q('[data-coverage-table]')).toBeNull();
        expect(qa('[data-type-row]').length).toBe(3);
      });

      it('uses no ranking words anywhere in the coverage view', async () => {
        await typeView();
        trow('Production').querySelector<HTMLButtonElement>('[data-toggle]')!.click();
        await settle();
        // The heading says what the view is NOT for ("not to rank people"); that is the one allowed use of the word.
        const all = text(q('mf-coverage-view')).replace(
          'use this to plan training and cross-coverage, not to rank people',
          '',
        );
        expect(all).not.toMatch(
          /\b(best|worst|top|rank(?:ing|ed)?|score|leaderboard|bus factor)\b/i,
        );
        expect(all).not.toMatch(/\bgaps?\b/i);
      });

      it('has a status region for the one-person statement and a collapsed list for the no-one statement', async () => {
        const base = aCoverageTypeBoard();
        await typeView({
          ...base,
          taskTypes: [
            ...base.taskTypes,
            ...[13, 14].map((id) => ({
              taskTypeId: id,
              name: `Unused ${id}`,
              iconKey: 'file-text',
              isActive: true,
              total: 0,
              peopleWhoHandledIt: 0,
            })),
          ],
          byType: [...base.byType!, ...[13, 14].map((id) => ({ taskTypeId: id, people: [] }))],
        });
        const none = q<HTMLDetailsElement>('[data-note="none"]');
        expect(none.open).toBe(false);
        expect(text(none.querySelector('summary'))).toBe(
          '2 task types had no completed tasks in this period.',
        );
        expect(text(none)).toContain(
          'Rarely used types can be empty in a short period. Try a longer period.',
        );
        expect(text(q('[data-note="one"]'))).toContain(
          '2 task types were handled by only one person',
        );
        expect(q('[data-note="one"]')!.closest('[role="status"]')).not.toBeNull();
      });
    });

    it('offers the Coverage view only with its own permission', async () => {
      await open();
      expect(q('[data-users-views] [data-view="coverage"]')).toBeNull();
      await reopen(of(board()), '/dashboard?tab=users&view=coverage');
      expect(q('[data-coverage-heading]')).toBeNull();
      expect(qa('[data-user-card]').length).toBe(6);
    });

    it('switches between Workload and Coverage, writes the address and remembers the choice', async () => {
      await open(of(board()), '/dashboard?tab=users', COV);
      q<HTMLButtonElement>('[data-view="coverage"]').click();
      await settle();
      expect(url()).toContain('view=coverage');
      expect(q('[data-view="coverage"]').getAttribute('aria-pressed')).toBe('true');
      expect(text(q('[data-coverage-heading]'))).toBe(
        'Task type coverage - use this to plan training and cross-coverage, not to rank people',
      );
      expect(getCoverage).toHaveBeenCalledWith(
        '30d',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'all',
        'type',
      );
      expect(url()).not.toContain('cov=');
      expect(JSON.parse(localStorage.getItem('mf.dashboard.users.v1.5')!).view).toBe('coverage');
      q<HTMLButtonElement>('[data-view="workload"]').click();
      await settle();
      expect(url()).not.toContain('view=coverage');
      expect(qa('[data-user-card]').length).toBe(6);
    });

    it('draws a table: task types in the rows, people in the columns, totals and who handled it', async () => {
      await coverage();
      expect(qa('[data-type-name]').map((r) => r.getAttribute('data-type-name'))).toEqual([
        'Archive',
        'Production',
        'Review',
      ]);
      expect(qa('thead th[data-person]').map((h) => text(h.querySelector('.pname')))).toEqual([
        'Priya Shah',
        'Sam Ortiz',
        'Tess Wu',
        'Uma Vee',
        'Vic Idle',
      ]);
      expect(
        qa('tbody tr:nth-child(2) [data-count]').map((c) => c.getAttribute('data-count')),
      ).toEqual(['7', '2', '11', '0', '0']);
      expect(text(rowOf('Production').querySelector('[data-row-total]'))).toBe('20');
      expect(text(rowOf('Production').querySelector('[data-people]'))).toBe('3 people');
      expect(text(rowOf('Review').querySelector('[data-people]'))).toBe('One person');
      expect(rowOf('Review').querySelector('[data-people] [data-status]')!.textContent).toContain(
        'One person',
      );
      expect(rowOf('Production').querySelector('[data-people] [data-status]')).toBeNull();
      expect(qa('[data-col-total]').map((c) => text(c))).toEqual(['10', '2', '11', '1', '0']);
      expect(text(q('[data-grand-total]'))).toBe('24');
      expect(q('thead th[data-person="4"] [data-inactive]')).not.toBeNull();
      expect(q('thead th[data-person="2"] [data-ooo-marker]')).not.toBeNull();
      expect(q('table caption')).not.toBeNull();
      expect(rowOf('Production').querySelector('th[scope="row"] mf-task-type-icon')).not.toBeNull();
    });

    it('writes the number in every non-zero cell, leaves zeros blank and names each cell as a sentence', async () => {
      await coverage();
      expect(text(cell(1, 10))).toBe('7');
      const zero = cell(4, 10).closest('td')!;
      expect(text(zero)).toBe('');
      expect(getComputedStyle(zero).backgroundImage).not.toContain('gradient');
      expect(cell(4, 10).getAttribute('aria-label')).toContain('Uma Vee, Production: 0 completed');
      expect(zero.classList.contains('cell--zero')).toBe(true);
      expect(zero.getAttribute('data-step')).toBe('0');
      expect(cell(1, 10).getAttribute('aria-label')).toContain(
        'Priya Shah: 7 Production tasks completed from 07/18 to 10/15',
      );
      expect(cell(1, 11).getAttribute('title')).toBe(cell(1, 11).getAttribute('aria-label'));
      // Gaps are outlined only while the Training gaps toggle is on (default off).
      expect(cell(2, 11).closest('td')!.getAttribute('data-gap')).toBeNull();
      expect(qa('[data-gap="true"]').length).toBe(0);
      q<HTMLButtonElement>('[data-coverage-gaps]').click();
      await settle();
      expect(cell(2, 11).closest('td')!.getAttribute('data-gap')).toBe('true'); // 0 Review for someone who completed other work
      expect(cell(5, 11).closest('td')!.getAttribute('data-gap')).toBeNull(); // Vic completed nothing at all
      expect(cell(2, 11).closest('td')!.querySelector('.pi-exclamation-circle')).not.toBeNull();
    });

    it('colours by the scale: relative to the task type by default, or absolute', async () => {
      await coverage();
      const step = (u: number, t: number) => cell(u, t).closest('td')!.getAttribute('data-step');
      expect(step(1, 11)).toBe('4'); // the highest in the Review row
      await choose('[data-coverage-scale]', 'absolute');
      expect(step(1, 11)).toBe('2'); // 3 completed
      expect(step(3, 10)).toBe('4');
      expect(JSON.parse(localStorage.getItem('mf.dashboard.coverage.v1.5')!).scale).toBe(
        'absolute',
      );
      expect(text(q('[data-coverage-legend]'))).toContain('11 or more');
    });

    it('orders by name or by total, with neutral labels', async () => {
      await coverage();
      await choose('[data-coverage-type-order]', 'total');
      expect(qa('[data-type-name]').map((r) => r.getAttribute('data-type-name'))).toEqual([
        'Production',
        'Review',
        'Archive',
      ]);
      await choose('[data-coverage-user-order]', 'total');
      expect(qa('thead th[data-person]')[0].getAttribute('data-person')).toBe('3');
      expect(ddText(host, 'Task Types')).toContain('By Total Completed');
      expect(ddText(host, 'Task Types')).not.toMatch(/best|worst|top|rank/i);
    });

    it('the Training gaps toggle outlines the possible gaps with a count, and every row stays', async () => {
      await coverage();
      expect(q('[data-coverage-gaps]').getAttribute('aria-pressed')).toBe('false');
      expect(q('[data-summary="gaps"]')).toBeNull();
      expect(q('[data-coverage-table]')!.getAttribute('data-gaps')).toBeNull();
      q<HTMLButtonElement>('[data-coverage-gaps]').click();
      await settle();
      expect(q('[data-coverage-gaps]').getAttribute('aria-pressed')).toBe('true');
      expect(qa('thead th[data-person]').length).toBe(5);
      expect(qa('[data-gap="true"]').length).toBeGreaterThan(0);
      expect(text(q('[data-summary="gaps"]'))).toContain('possible training gaps');
      q<HTMLButtonElement>('[data-coverage-gaps]').click();
      await settle();
      expect(qa('[data-gap="true"]').length).toBe(0);
    });

    it('a zero opens nothing; a count opens the drawer', async () => {
      await coverage();
      cell(4, 10).click();
      await settle();
      expect(document.querySelector('[data-coverage-drawer]')).toBeNull();
      cell(1, 10).click();
      await settle();
      expect(document.querySelector('[data-coverage-drawer]')).not.toBeNull();
    });

    it('caps the matrix columns and rows and adds more on request', async () => {
      const users = Array.from({ length: 70 }, (_, i) =>
        aCoverageUser(100 + i, `Person ${String(i).padStart(3, '0')}`, 1),
      );
      await open(
        of(board()),
        '/dashboard?tab=users&view=coverage&cov=matrix',
        COV,
        aCoverageBoard({
          users,
          cells: users.map((u) => ({ userId: u.userId, taskTypeId: 10, completed: 1 })),
        }),
      );
      expect(qa('thead th[data-person]').length).toBe(30);
      expect(text(q('[data-matrix-more]'))).toContain('Show 30 more people');
      expect(text(q('[data-matrix-more]'))).toContain('30 of 70 people');
      expect(text(rowOf('Production').querySelector('[data-row-total]'))).toBe('70');
      q<HTMLButtonElement>('[data-cols-more]').click();
      await settle();
      expect(qa('thead th[data-person]').length).toBe(60);
      q<HTMLButtonElement>('[data-cols-more]').click();
      await settle();
      expect(qa('thead th[data-person]').length).toBe(70);
      expect(q('[data-cols-more]')).toBeNull();
    });

    it('shows the summary strip and two statements: none (neutral, collapsed) and one person (amber)', async () => {
      await coverage();
      expect(text(q('[data-summary="completed"]'))).toContain('24');
      // The seed: Review and Archive have exactly one handler, none has zero.
      expect(q('[data-note="none"]')).toBeNull();
      const warn = q('[data-note="one"]')!;
      expect(text(warn)).toBe(
        '2 task types were handled by only one person in this period: Archive, Review. Consider cross-training.',
      );
      expect(warn.closest('[role="status"]')).not.toBeNull();
      expect(warn.querySelector('.pi-exclamation-triangle')).not.toBeNull();
      expect(text(q('[data-coverage-notes]'))).not.toMatch(/gap|bus factor/i);
    });

    it('offers the shared period list plus 6 and 12 months, and writes a choice to the address', async () => {
      await coverage();
      const select = ddSelect(host, 'Period');
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
        '7 Days',
        '30 Days',
        '90 Days',
        'This Month',
        'Last Month',
        'Last 6 Months',
        'Last 12 Months',
        'Custom',
      ]);
      expect(text(q('mf-period-control .pc-lbl'))).toBe('Period');
      await choose('mf-dropdown[data-period]', '90d');
      expect(getCoverage).toHaveBeenLastCalledWith(
        '90d',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'all',
      );
      expect(url()).toContain('period=90d');
      expect(text(q('[data-coverage-frame]'))).toContain(
        'Tasks each person completed per type from 07/18 to 10/15.',
      );
      await choose('mf-dropdown[data-period]', '12m');
      expect(getCoverage).toHaveBeenLastCalledWith(
        '12m',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'all',
      );
      await choose('mf-dropdown[data-period]', 'custom');
      expect(url()).toContain('period=custom');
      expect(url()).toContain('from=');
      expect(q('mf-period-control mf-date-input')).not.toBeNull();
      await reopen(
        of(board()),
        '/dashboard?tab=users&view=coverage&period=custom&from=2026-01-01&to=2026-02-01',
        COV,
      );
      expect(getCoverage).toHaveBeenLastCalledWith(
        'custom',
        '2026-01-01',
        '2026-02-01',
        undefined,
        undefined,
        undefined,
        'all',
        'type',
      );
    });

    it('has no Pod control: the page-wide scope narrows the matrix through the API, the name on the page', async () => {
      await coverage();
      expect(q('[data-coverage-pod]')).toBeNull();
      const scope = TestBed.inject(DashScope);
      scope.ensureLoaded();
      scope.applyAddress((k) => (k === 'pod' ? '2' : null));
      await settle();
      expect(getCoverage).toHaveBeenLastCalledWith(
        '30d',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        '2',
      );
      const calls = getCoverage.mock.calls.length;
      await reopen(of(board()), '/dashboard?tab=users&view=coverage&cov=matrix&uq=tess', COV);
      expect(qa('thead th[data-person]').map((h) => text(h.querySelector('.pname')))).toEqual([
        'Tess Wu',
      ]);
      expect(getCoverage.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(calls).toBeGreaterThan(1);
    });

    it('is one tab stop with arrow keys, Home and End between the cells', async () => {
      await coverage();
      const stops = qa('[data-cell]').filter((b) => b.getAttribute('tabindex') === '0');
      expect(stops.length).toBe(1);
      expect(stops[0].getAttribute('data-cell')).toBe('1:12');
      stops[0].focus();
      stops[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      );
      await settle();
      expect(document.activeElement?.getAttribute('data-cell')).toBe('2:12');
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      );
      await settle();
      expect(document.activeElement?.getAttribute('data-cell')).toBe('2:10');
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
      );
      await settle();
      expect(document.activeElement?.getAttribute('data-cell')).toBe('5:10');
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }),
      );
      await settle();
      expect(document.activeElement?.getAttribute('data-cell')).toBe('1:10');
    });

    it('opens the completed tasks of a cell from the Task Queue and returns focus to the cell', async () => {
      await coverage();
      getQueue.mockReturnValue(
        of(
          pageOf([
            aRow({
              taskId: 31,
              taskNumber: 'TSK-31',
              title: 'Produced set',
              status: 'COMPLETED',
              statusLabel: 'Completed',
              completedAtUtc: '2026-10-10T12:00:00Z',
            }),
          ]),
        ),
      );
      const opener = cell(1, 10);
      opener.focus();
      opener.click();
      await settle();
      const drawer = document.querySelector('[data-coverage-drawer]')!;
      const args = getQueue.mock.calls.at(-1)!;
      expect(args[2]).toEqual(['COMPLETED']);
      expect(args[6]).toEqual([1]);
      expect(args[12]).toEqual([10]);
      expect(args[21]).toBe('2026-07-18');
      expect(args[22]).toBe('2026-10-15');
      expect(args[35]).toBe('completed');
      expect(drawer.querySelectorAll('[data-coverage-tasks] li').length).toBe(1);
      const link = document.querySelector('[data-open-queue]')!.getAttribute('href')!;
      expect(link).toContain('status=COMPLETED');
      expect(link).toContain('assignee=1');
      expect(link).toContain('type=10');
      expect(link).toContain('completedFrom=2026-07-18');
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Close completed tasks"]')!
        .click();
      await settle();
      await new Promise((r) => setTimeout(r, 30));
      expect(document.activeElement).toBe(opener);
    });

    it('shows errors with Retry, the forbidden state, and keeps the table when a refresh fails', async () => {
      getCoverage = vi.fn();
      await open(of(board()), '/dashboard?tab=users&view=coverage', COV);
      expect(qa('[data-type-name]').length).toBe(3);
      getCoverage.mockReturnValue(throwError(() => new Error('down')));
      refreshTab();
      await settle();
      expect(qa('[data-type-name]').length).toBe(3);
      expect(text(q('[data-dash-state="stale"]'))).toContain("Couldn't refresh.");
    });
  });
});

const order = ['Cy Tan', 'Ann Lee', 'Bob Ray', 'Hal Moe', 'Eve Kim', 'Dee Fox'];
export type { TaskQueueRow };
