import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MessageService } from 'primeng/api';
import { NEVER, of, throwError } from 'rxjs';
import {
  DashboardBoardClient,
  PodsClient,
  TaskQueueClient,
  TaskQueueRow,
  TasksClient,
  WorkloadBoard,
} from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { UndoService } from '../../../core/notify/undo.service';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { aRow, pageOf, provideLookups } from '../../../shared/work-queue/work-queue-testing';
import {
  LEGEND,
  OUT_UNTIL,
  aBoard,
  aCoverageBoard,
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
  let harness: RouterTestingHarness;
  let host: HTMLElement;

  async function open(
    response: unknown = of(board()),
    url = '/dashboard?tab=users',
    permissions = PERMS,
  ) {
    getWorkload = vi.fn().mockReturnValue(response);
    getCoverage = vi.fn().mockReturnValue(of(aCoverageBoard()));
    getQueue = vi.fn((...args: unknown[]) => {
      // positional: status is argument 2, assignee 6, unassigned 7
      const assignee = args[5] as number[] | undefined;
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
          : pageOf([unassigned(21, 1, 'Critical'), unassigned(22, 3, 'Normal')]),
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
      setTaskPriority: vi.fn(),
      changeTaskStatus: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'dashboard', component: DashUsersTab }]),
        provideFakeMe(new FakeMeApi({ ...withPermissions(...permissions), userId: 5 })),
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
        MessageService,
        ...provideLookups(),
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
        { provide: Clock, useValue: { now: () => new Date('2026-10-15T15:05:00Z') } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
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
    const select = q<HTMLSelectElement>(selector);
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle();
  };

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

  describe('cards', () => {
    it('asks the workload endpoint with the filters of the address', async () => {
      await open(of(board()), '/dashboard?tab=users&upod=2&uavail=out&uq=ann');
      expect(getWorkload).toHaveBeenCalledWith(2, 'out', 'ann');
      expect(q<HTMLSelectElement>('[data-filter="availability"]').value).toBe('out');
    });

    it('draws one card per person in the default order: available, off hours, out of office; lighter first', async () => {
      await open();
      expect(qa('[data-user-card]').map((c) => c.getAttribute('data-user'))).toEqual(order);
      expect(q('[data-users-grid]').getAttribute('aria-busy')).toBeNull();
    });

    it('colours a card by its highest priority, in words, and keeps the token for tests', async () => {
      await open();
      expect(card('Ann Lee').getAttribute('data-tone')).toBe('critical');
      expect(text(card('Ann Lee').querySelector('[data-band-text]'))).toBe(
        'Highest priority: Critical',
      );
      expect(card('Bob Ray').getAttribute('data-tone')).toBe('normal');
      expect(text(card('Bob Ray').querySelector('[data-band-text]'))).toBe(
        'Highest priority: Normal',
      );
      expect(card('Ann Lee').querySelector<HTMLElement>('[data-band]')!.style.background).toContain(
        '--mf-pr-critical-bg',
      );
    });

    it('shows the green free state with text and the hatched grey out-of-office state with the return date and note', async () => {
      await open();
      const free = card('Cy Tan');
      expect(free.getAttribute('data-state')).toBe('free');
      expect(text(free.querySelector('[data-band-text]'))).toBe('Available - no open tasks');
      expect(text(free.querySelector('[data-free]'))).toBe('No open tasks');
      expect(text(free.querySelector('[data-load-label]'))).toBe('Free');

      const ooo = card('Dee Fox');
      expect(ooo.getAttribute('data-state')).toBe('ooo');
      expect(ooo.getAttribute('data-availability')).toBe('OUT_OF_OFFICE');
      expect(text(ooo.querySelector('[data-band-text]'))).toBe('Not available');
      expect(text(ooo.querySelector('[data-avail-chip]'))).toBe('Out of office until Oct 20');
      expect(text(ooo.querySelector('[data-back]'))).toBe('Back on Oct 21');
      expect(text(ooo.querySelector('[data-note]'))).toBe('Annual leave');
      expect(OUT_UNTIL).toBeTruthy();
    });

    it('marks off hours with a soft chip and still counts the work', async () => {
      await open();
      const eve = card('Eve Kim');
      expect(text(eve.querySelector('[data-avail-chip]'))).toBe('Off hours');
      expect(eve.getAttribute('data-state')).toBe('busy');
    });

    it('shows a count badge per priority in rank order with zero counts muted', async () => {
      await open();
      const badges = qa('[data-priority-count]').filter((b) => card('Ann Lee').contains(b));
      expect(badges.map((b) => text(b))).toEqual(['Critical 1', 'High 2', 'Normal 0', 'Low 0']);
      expect(badges.map((b) => b.classList.contains('pc--zero'))).toEqual([
        false,
        false,
        true,
        true,
      ]);
    });

    it('shows open, overdue, due soon, on hold, next due, pods and the load label', async () => {
      await open();
      const ann = card('Ann Lee');
      expect(text(ann.querySelector('[data-open-total]'))).toBe('Open3');
      expect(text(ann.querySelector('[data-overdue]'))).toBe('Overdue2');
      expect(text(ann.querySelector('[data-due-soon]'))).toBe('Due soon1');
      expect(text(ann.querySelector('[data-hold]'))).toBe('On hold1');
      expect(text(ann.querySelector('[data-pods]'))).toBe('Pod A');
      expect(text(ann.querySelector('[data-load-label]'))).toBe('Light');
      const bob = card('Bob Ray');
      expect(text(bob.querySelector('[data-next-due]'))).toContain('TSK-55');
      expect(bob.querySelector('[data-next-due] a')!.getAttribute('href')).toBe('/tasks/55');
      expect(text(card('Hal Moe').querySelector('[data-load-label]'))).toBe('Heavy');
      expect(card('Hal Moe').getAttribute('data-load')).toBe('HEAVY');
    });

    it('draws the load bar segments in rank order and names it for assistive technology', async () => {
      await open();
      const bar = card('Bob Ray').querySelector('[data-load-bar]')!;
      expect(
        Array.from(bar.querySelectorAll('[data-segment]')).map((s) =>
          s.getAttribute('data-segment'),
        ),
      ).toEqual(['Normal', 'Low']);
      expect(bar.getAttribute('role')).toBe('img');
      expect(bar.getAttribute('aria-label')).toBe('Load: 6 open tasks (5 Normal, 1 Low). Normal.');
      expect(card('Cy Tan').querySelector('[data-load-bar]')!.getAttribute('aria-label')).toBe(
        'Load: 0 open tasks. Free.',
      );
    });

    it('names the open button with the visible name first and the state in words', async () => {
      await open();
      const label = card('Ann Lee').querySelector('[data-user-open]')!.getAttribute('aria-label')!;
      expect(label.startsWith('Ann Lee')).toBe(true);
      expect(label).toContain('3 open tasks, highest priority Critical, 2 overdue');
      expect(
        card('Dee Fox').querySelector('[data-user-open]')!.getAttribute('aria-label'),
      ).toContain('Not available');
    });
  });

  describe('summary strip', () => {
    it('counts available, busy, out of office and unassigned tasks and links the unassigned ones to the Task Queue', async () => {
      await open();
      const n = (k: string) => text(q(`[data-summary-tile="${k}"] [data-n]`));
      expect([n('available'), n('busy'), n('out'), n('unassigned')]).toEqual(['1', '4', '1', '4']);
      const href = q('[data-summary-unassigned]').getAttribute('href')!;
      expect(href).toContain('/tasks?');
      expect(href).toContain('unassigned=true');
      expect(href).toContain('status=NEW');
    });

    it('the out of office tile toggles the availability filter', async () => {
      await open();
      q<HTMLButtonElement>('[data-summary-out]').click();
      await settle();
      expect(getWorkload).toHaveBeenLastCalledWith(undefined, 'out', undefined);
      expect(url()).toContain('uavail=out');
      expect(q('[data-summary-out]').getAttribute('aria-pressed')).toBe('true');
      q<HTMLButtonElement>('[data-summary-out]').click();
      await settle();
      expect(getWorkload).toHaveBeenLastCalledWith(undefined, 'all', undefined);
      expect(url()).not.toContain('uavail');
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

    it('filters by pod, availability and name through the API and writes them to the address', async () => {
      await open();
      await choose('[data-filter="pod"]', '2');
      expect(getWorkload).toHaveBeenLastCalledWith(2, 'all', undefined);
      expect(url()).toContain('upod=2');
      await choose('[data-filter="availability"]', 'available');
      expect(getWorkload).toHaveBeenLastCalledWith(2, 'available', undefined);
      q<HTMLButtonElement>('[data-clear-filters]').click();
      await settle();
      expect(getWorkload).toHaveBeenLastCalledWith(undefined, 'all', undefined);
      expect(url()).not.toContain('upod');
    });

    it('switches to the table, remembers it, and the density', async () => {
      await open();
      q<HTMLButtonElement>('[data-layout="table"]').click();
      await settle();
      expect(q('[data-users-table]')).not.toBeNull();
      expect(qa('[data-user-card]').length).toBe(0);
      expect(qa('tbody tr').length).toBe(6);
      const row = q('[data-user-row="4"]');
      expect(row.getAttribute('data-state')).toBe('ooo');
      expect(text(row)).toContain('Out of office until Oct 20');
      expect(q('[data-layout="table"]').getAttribute('aria-pressed')).toBe('true');
      await choose('[data-density]', 'compact');
      expect(q('[data-users-table]').getAttribute('data-density')).toBe('compact');
      expect(JSON.parse(localStorage.getItem('mf.dashboard.users.v1.5')!)).toEqual({
        sort: 'load',
        density: 'compact',
        layout: 'table',
        view: 'workload',
      });
    });

    it('opens the legend with the card colours, load levels and the framing text', async () => {
      await open();
      expect(q('[data-legend]')).toBeNull();
      q<HTMLButtonElement>('[data-legend-toggle]').click();
      await settle();
      expect(q('[data-legend-toggle]').getAttribute('aria-expanded')).toBe('true');
      expect(text(q('[data-legend]'))).toContain('Highest priority: Critical');
      expect(text(q('[data-legend]'))).toContain('Not available');
      expect(text(q('[data-load-help]'))).toContain('Light: 1 to 3 open tasks.');
      expect(text(q('[data-load-help]'))).toContain('Heavy: more than 8 open tasks.');
      expect(text(q('[data-legend]'))).toContain('no completion');
      expect(text(q('[data-frame]'))).toContain('does not measure completed work');
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
      expect(text(q('[data-users-error]'))).toContain('could not be loaded');
      getWorkload.mockReturnValue(of(board()));
      q<HTMLButtonElement>('[data-users-retry]').click();
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
      expect(getWorkload).toHaveBeenLastCalledWith(undefined, 'all', undefined);
    });

    it('explains a team with nobody in it', async () => {
      await open(of(aBoard([])));
      expect(text(q('[data-users-empty]'))).toContain('no team members');
    });

    it('keeps the cards when a background refresh fails and says so with Retry', async () => {
      await open();
      getWorkload.mockReturnValue(throwError(() => new Error('down')));
      refreshTab();
      await settle();
      expect(qa('[data-user-card]').length).toBe(6);
      expect(text(q('[data-users-stale]'))).toContain('could not be refreshed');
      getWorkload.mockReturnValue(of(board()));
      q<HTMLButtonElement>('[data-users-stale-retry]').click();
      await settle();
      expect(q('[data-users-stale]')).toBeNull();
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
      expect(args[1]).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']);
      expect(args[5]).toEqual([1]);
      expect(args[22]).toBe('priority');
      expect(drawer.querySelectorAll('[data-drawer-tasks] li').length).toBe(2);
      expect(
        drawer.querySelector('[data-drawer-tasks] [data-field="priority"] [data-inline-trigger]'),
      ).not.toBeNull();
      const link = drawer.querySelector('[data-open-queue]')!.getAttribute('href')!;
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
      expect(args[1]).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']);
      expect(args[6]).toBe(true);
      expect(args[22]).toBe('priorityAge');
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
      expect(offer.message).toContain('Task moved to In Progress');
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
      expect(text(dialog().querySelector('[data-assign-empty]'))).toContain('no unassigned tasks');
      document.querySelector<HTMLButtonElement>('button[aria-label="Close assign work"]')!.click();
      await settle();
      getQueue.mockReturnValue(throwError(() => new Error('x')));
      await openPicker('Ann Lee');
      expect(dialog().querySelector('[data-assign-error]')).not.toBeNull();
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

    it('draws 60 people at first and the rest on request, in the cards and in the table', async () => {
      await open(of(many(130)));
      expect(qa('[data-user-card]').length).toBe(60);
      expect(text(q('[data-users-more]'))).toContain('Showing 60 of 130 people.');
      q<HTMLButtonElement>('[data-users-show-more]').click();
      await settle();
      expect(qa('[data-user-card]').length).toBe(120);
      q<HTMLButtonElement>('[data-users-show-all]').click();
      await settle();
      expect(qa('[data-user-card]').length).toBe(130);
      expect(q('[data-users-more]')).toBeNull();
      q<HTMLButtonElement>('[data-layout="table"]').click();
      await settle();
      expect(qa('tbody tr').length).toBe(130);
    });

    it('starts again from 60 after a new sort', async () => {
      await open(of(many(130)));
      q<HTMLButtonElement>('[data-users-show-all]').click();
      await settle();
      await choose('[data-sort]', 'name');
      expect(qa('[data-user-card]').length).toBe(60);
    });
  });

  describe('coverage view', () => {
    const COV: Permission[] = [...PERMS, 'Dashboard.ViewCoverage'];
    const coverage = () => open(of(board()), '/dashboard?tab=users&view=coverage', COV);
    const cell = (user: number, type: number) =>
      q<HTMLButtonElement>(`[data-cell="${user}:${type}"]`);
    const rowOf = (name: string) => q(`[data-type-name="${name}"]`);

    it('offers the Coverage view only with its own permission', async () => {
      await open();
      expect(q('[data-users-views]')).toBeNull();
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
      expect(getCoverage).toHaveBeenCalledWith(undefined, undefined, 30, undefined, undefined);
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
      expect(text(rowOf('Review').querySelector('[data-people]'))).toBe('1 person');
      expect(rowOf('Review').querySelector('[data-people]')!.classList.contains('thin')).toBe(true);
      expect(qa('[data-col-total]').map((c) => text(c))).toEqual(['10', '2', '11', '1', '0']);
      expect(text(q('[data-grand-total]'))).toBe('24');
      expect(q('thead th[data-person="4"] [data-inactive]')).not.toBeNull();
      expect(q('thead th[data-person="2"] [data-ooo-marker]')).not.toBeNull();
      expect(q('table caption')).not.toBeNull();
      expect(rowOf('Production').querySelector('th[scope="row"] mf-task-type-icon')).not.toBeNull();
    });

    it('writes the number in every cell, hatches the zeros and names each cell as a sentence', async () => {
      await coverage();
      expect(text(cell(1, 10))).toBe('7');
      const zero = cell(4, 10).closest('td')!;
      expect(text(zero)).toBe('0');
      expect(zero.classList.contains('cell--zero')).toBe(true);
      expect(zero.getAttribute('data-step')).toBe('0');
      expect(cell(1, 10).getAttribute('aria-label')).toBe(
        'Priya Shah: 7 Production tasks completed in the last 90 days'.replace('90', '30'),
      );
      expect(cell(1, 11).getAttribute('title')).toBe(cell(1, 11).getAttribute('aria-label'));
      expect(cell(2, 11).closest('td')!.getAttribute('data-gap')).toBe('true'); // 0 Review for someone who completed other work
      expect(cell(5, 11).closest('td')!.getAttribute('data-gap')).toBeNull(); // Vic completed nothing at all
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
      expect(text(q('[data-coverage-type-order]'))).toContain('By total completed');
      expect(text(q('[data-coverage-type-order]'))).not.toMatch(/best|worst|top|rank/i);
    });

    it('the Training gaps filter keeps the types and the people with a zero, and says when there is none', async () => {
      await coverage();
      q<HTMLButtonElement>('[data-coverage-gaps]').click();
      await settle();
      expect(q('[data-coverage-gaps]').getAttribute('aria-pressed')).toBe('true');
      expect(qa('thead th[data-person]').length).toBe(4); // Vic completed nothing and is not a training gap
      expect(qa('[data-gap="true"]').length).toBeGreaterThan(0);
      getCoverage.mockReturnValue(
        of(
          aCoverageBoard({
            users: aCoverageBoard().users.slice(0, 1),
            cells: [10, 11, 12].map((taskTypeId) => ({ userId: 1, taskTypeId, completed: 2 })),
          }),
        ),
      );
      refreshTab();
      await settle();
      expect(text(q('[data-coverage-empty]'))).toContain('No training gaps');
    });

    it('shows the summary strip with the coverage insight', async () => {
      await coverage();
      expect(text(q('[data-summary="thin"]'))).toContain(
        '2 task types have fewer than 2 people who handled them.',
      );
      expect(text(q('[data-summary="completed"]'))).toContain('24');
      expect(q('[data-summary="thin"]')!.classList.contains('chip--warn')).toBe(true);
    });

    it('changes the period (presets and a custom range) and writes it to the address', async () => {
      await coverage();
      await choose('[data-coverage-period]', '90');
      expect(getCoverage).toHaveBeenLastCalledWith(undefined, undefined, 90, undefined, undefined);
      expect(url()).toContain('cp=90');
      expect(text(q('[data-coverage-frame]'))).toContain('in the last 90 days');
      await choose('[data-coverage-period]', '365');
      expect(getCoverage).toHaveBeenLastCalledWith(undefined, undefined, 365, undefined, undefined);
      await choose('[data-coverage-period]', 'custom');
      expect(url()).toContain('cp=custom');
      expect(q('#cv-from')).not.toBeNull();
      await reopen(
        of(board()),
        '/dashboard?tab=users&view=coverage&cp=custom&cfrom=2026-01-01&cto=2026-02-01',
        COV,
      );
      expect(getCoverage).toHaveBeenLastCalledWith(
        '2026-01-01',
        '2026-02-01',
        undefined,
        undefined,
        undefined,
      );
    });

    it('filters by pod through the API and by name on the page', async () => {
      await coverage();
      await choose('[data-coverage-pod]', '2');
      expect(getCoverage).toHaveBeenLastCalledWith(undefined, undefined, 30, 2, undefined);
      expect(url()).toContain('upod=2');
      const calls = getCoverage.mock.calls.length;
      await reopen(of(board()), '/dashboard?tab=users&view=coverage&uq=tess', COV);
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
      expect(args[1]).toEqual(['COMPLETED']);
      expect(args[5]).toEqual([1]);
      expect(args[11]).toEqual([10]);
      expect(args[20]).toBe('2026-07-18');
      expect(args[21]).toBe('2026-10-15');
      expect(args[22]).toBe('completed');
      expect(drawer.querySelectorAll('[data-coverage-tasks] li').length).toBe(1);
      const link = drawer.querySelector('[data-open-queue]')!.getAttribute('href')!;
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
      expect(text(q('[data-coverage-stale]'))).toContain('could not be refreshed');
    });
  });

  it('lists the legend priorities so a renamed priority shows its new name', async () => {
    await open(
      of(
        board({
          priorities: LEGEND.map((p) => (p.priorityId === 1 ? { ...p, label: 'Rush' } : p)),
          users: [
            aUser(1, 'Ann Lee', [1, 0, 0, 0], {
              topPriority: { priorityId: 1, label: 'Rush', color: 'critical', rank: 1, count: 1 },
            }),
          ],
        }),
      ),
    );
    expect(text(q('[data-band-text]'))).toBe('Highest priority: Rush');
    expect(text(q('[data-priority-count]'))).toBe('Rush 1');
  });
});

const order = ['Cy Tan', 'Ann Lee', 'Bob Ray', 'Hal Moe', 'Eve Kim', 'Dee Fox'];
export type { TaskQueueRow };
