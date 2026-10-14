import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NEVER, of, throwError } from 'rxjs';
import { DashboardClient, DashboardSummary } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { DashboardPage } from './dashboard-page';

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

describe('DashboardPage', () => {
  let getDashboard: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;

  async function open(
    response: unknown = of(summary()),
    permissions: Permission[] = ['Task.View', 'Dashboard.ViewDepartment', 'Task.Create'],
  ) {
    getDashboard = vi.fn().mockReturnValue(response);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'dashboard', component: DashboardPage }]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: DashboardClient, useValue: { getDashboard } },
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
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

  it('shows the department tiles, each a link to the queue with the filters from the API', async () => {
    const el = await open();
    expect(getDashboard).toHaveBeenCalledWith(30);

    const tiles = Array.from(
      el.querySelectorAll<HTMLElement>('[data-section="department"] mf-stat-tile'),
    );
    expect(tiles.map((t) => t.querySelector('.label')!.textContent)).toEqual([
      'Open',
      'Unassigned',
      'Overdue',
      'On hold',
      'Due soon',
      'ASAP open',
      'Completed',
      'Created',
    ]);
    expect(tiles.map((t) => t.querySelector('.value')!.textContent)).toEqual([
      '128',
      '17',
      '9',
      '12',
      '6',
      '4',
      '94',
      '101',
    ]);
    expect(tiles[2].textContent).toContain('Excludes ASAP tasks');
    expect(tiles[1].querySelector('a')!.getAttribute('href')).toBe(
      '/tasks?status=NEW&status=IN_PROGRESS&status=ON_HOLD&unassigned=true',
    );
    expect(tiles[6].querySelector('a')!.getAttribute('href')).toBe(
      '/tasks?status=COMPLETED&completedFrom=2026-09-15',
    );
    expect(el.querySelector('[data-updated]')!.textContent).toContain('Updated 3:42 PM');
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

  it('shows breakdowns with text values, no link where the queue has no filter, and the recent lists', async () => {
    const el = await open();
    const bars = el.querySelector('[data-section="breakdowns"]')!;
    expect(bars.textContent).toContain('Open by Pod');
    expect(bars.textContent).toContain('Open by Priority');
    expect(bars.textContent).toContain('Open by Task Type');
    expect(bars.textContent).toContain('Open by Status');
    const podRows = Array.from(bars.querySelectorAll('mf-bar-list')[0].querySelectorAll('li'));
    expect(
      podRows.map((r) =>
        [r.querySelector('.name')?.textContent, r.querySelector('.count')?.textContent].join(' '),
      ),
    ).toEqual(['Pod A 40', 'No Pod 17']);
    expect(podRows[0].querySelector('a')!.getAttribute('href')).toContain('pod=1');
    expect(podRows[1].querySelector('a')).toBeNull();

    const activity = el.querySelector('[data-section="activity"]')!;
    expect(activity.textContent).toContain('Informational, not a service-level target');
    expect(hrefs(el, 'mf-recent-task-list a')).toEqual(['/tasks/5', '/tasks/4']);
    expect(el.textContent).not.toMatch(/billing|revenue|hours|productivity/i);
  });

  it('reloads for another period', async () => {
    const el = await open();
    const select = el.querySelector<HTMLSelectElement>('select')!;
    select.value = '90';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(getDashboard).toHaveBeenLastCalledWith(90);
    expect(el.textContent).toContain('Last 90 days');
  });

  it('hides the department sections from users without Dashboard.ViewDepartment', async () => {
    const el = await open(of(summary()), ['Task.View']);
    expect(el.querySelector('[data-section="mine"]')).not.toBeNull();
    expect(el.querySelector('[data-section="department"]')).toBeNull();
    expect(el.querySelector('[data-section="breakdowns"]')).toBeNull();
    expect(el.querySelector('[data-section="activity"]')).toBeNull();
  });

  it('shows the empty state with a create button only for users who can create tasks', async () => {
    const empty = summary({ open: count(0, OPEN), recentlyCreated: [], recentlyCompleted: [] });
    let el = await open(of(empty));
    expect(el.querySelector('[data-empty]')!.textContent).toContain('No tasks yet.');
    expect(el.querySelector('a[href="/tasks/new"]')!.textContent).toContain(
      'Create the first task',
    );
    expect(el.querySelector('[data-section="department"]')).toBeNull();

    TestBed.resetTestingModule();
    el = await open(of(empty), ['Task.View', 'Dashboard.ViewDepartment']);
    expect(el.querySelector('[data-empty]')).not.toBeNull();
    expect(el.querySelector('a[href="/tasks/new"]')).toBeNull();
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
