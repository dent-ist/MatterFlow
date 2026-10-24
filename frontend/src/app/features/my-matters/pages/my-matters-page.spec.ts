import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NEVER, of, throwError } from 'rxjs';
import {
  ClientsClient,
  MatterManagersClient,
  MyMattersClient,
} from '../../../api/generated/api-client';
import { FakeMeApi, profileOf, provideFakeMe } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import { AuthStore } from '../../../core/auth/auth.store';
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

function health(items: object[] = [row(5, 'RED', ['OVERDUE'])]) {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 50,
    sort: 'nextDeadline',
    dir: 'asc',
    amberDueDays: 3,
    stuckOnHoldDays: 7,
    timeZone: 'America/New_York',
  };
}

function row(matterId: number, flag: string, reasons: string[]) {
  return {
    matterId,
    matterRef: `9000${matterId}-80001`,
    matterName: `Matter ${matterId}`,
    clientId: 2,
    clientNumber: '00002',
    clientName: 'Acme',
    open: 31,
    overdue: 4,
    dueThisWeek: 9,
    unassigned: 1,
    percentComplete: 62,
    nextDeadline: '2026-10-26',
    flag,
    flagReasons: reasons,
    query: `matter=${matterId}&status=NEW`,
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
  ) {
    api = {
      getMyMattersSummary: vi.fn().mockReturnValue(of(summary())),
      getMyMattersAttention: vi.fn().mockReturnValue(
        of({
          timeZone: 'x',
          asOfUtc: 'x',
          stuckOnHoldDays: 7,
          groups: [
            { kind: 'overdue', total: 9, query: 'managedByMe=true&overdue=true', items: [task(1)] },
            { kind: 'dueSoon', total: 0, query: 'q', items: [] },
            {
              kind: 'unassigned',
              total: 6,
              query: 'managedByMe=true&unassigned=true',
              items: [task(2, { factCode: 'NO_ASSIGNEE', factDays: undefined })],
            },
            { kind: 'stuckOnHold', total: 0, query: 'q', items: [] },
          ],
        }),
      ),
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
      getMyMattersHealth: vi
        .fn()
        .mockReturnValue(
          of(health([row(5, 'RED', ['OVERDUE']), row(6, 'GREEN', ['NO_OPEN_TASKS'])])),
        ),
      getMyMattersWorkload: vi.fn().mockReturnValue(
        of({
          timeZone: 'x',
          asOfUtc: 'x',
          open: 64,
          pods: [
            {
              podId: 1,
              podName: 'Processing Pod',
              open: 64,
              overdue: 5,
              onHold: 1,
              query: 'managedByMe=true&pod=1',
              people: [
                {
                  userId: 3,
                  displayName: 'Priya Rao',
                  isActive: true,
                  open: 9,
                  overdue: 0,
                  onHold: 0,
                  availability: {
                    isOutOfOffice: true,
                    state: 'OUT_OF_OFFICE',
                    until: '2026-10-30T00:00:00Z',
                  },
                  query: 'managedByMe=true&assignee=3',
                },
                {
                  userId: null,
                  displayName: null,
                  isActive: true,
                  open: 4,
                  overdue: 1,
                  onHold: 0,
                  query: 'managedByMe=true&unassigned=true&pod=1',
                },
              ],
            },
          ],
        }),
      ),
      getMyMattersActivity: vi.fn().mockReturnValue(of(activity())),
      markMyMattersActivitySeen: vi.fn().mockReturnValue(of({ seenEventId: 12, seenAtUtc: 'x' })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'my-matters', component: MyMattersPage },
          { path: '**', children: [] },
        ]),
        provideFakeMe(new FakeMeApi(profileOf({ permissions }))),
        { provide: MyMattersClient, useValue: api },
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

  it('shows the seven strip cells as links to the lists they count', async () => {
    const h = await open('/my-matters');
    const cells = Array.from(el(h).querySelectorAll<HTMLAnchorElement>('[data-strip-item]'));
    expect(cells.map((c) => c.getAttribute('data-strip-item'))).toEqual([
      'matters',
      'open',
      'overdue',
      'due3',
      'due7',
      'unassigned',
      'onHold',
    ]);
    expect(cells[0].getAttribute('href')).toBe('/matters?mine=true');
    expect(cells[2].getAttribute('href')).toBe('/tasks?managedByMe=true&overdue=true');
    expect(cells[1].getAttribute('href')).toContain('status=NEW&status=IN_PROGRESS&status=ON_HOLD');
    expect(cells[6].textContent).toContain('On hold, oldest 12 d');
    expect(cells[3].textContent).toContain('17');
    expect(el(h).querySelector('[data-strip]')!.getAttribute('aria-label')).toContain(
      'your matters',
    );
  });

  it('sends no date range to the strip and the other panels, only to Upcoming deadlines', async () => {
    await open('/my-matters?range=2w');
    expect(api['getMyMattersSummary']).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(api['getMyMattersDeadlines']).toHaveBeenCalledWith(
      14,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(api['getMyMattersHealth']).toHaveBeenCalledWith(
      undefined,
      undefined,
      1,
      50,
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

  it('shows Needs my attention groups with View all links and rows that open the task', async () => {
    const h = await open('/my-matters');
    const groups = Array.from(el(h).querySelectorAll('[data-group]')).map((g) =>
      g.getAttribute('data-group'),
    );
    expect(groups).toEqual(['overdue', 'unassigned']);
    const row1 = el(h).querySelector<HTMLAnchorElement>('[data-attention-row]')!;
    expect(row1.getAttribute('href')).toBe('/tasks/1?from=my-matters');
    expect(el(h).querySelector('[data-fact]')!.textContent).toContain('3 d overdue');
    expect(
      el(h)
        .querySelector<HTMLAnchorElement>('[data-group=overdue] [data-view-all]')!
        .getAttribute('href'),
    ).toBe('/tasks?managedByMe=true&overdue=true');
  });

  it('says so when nothing needs attention, with no manager-related item', async () => {
    const h = await open('/my-matters');
    api['getMyMattersAttention'].mockReturnValue(
      of({ timeZone: 'x', asOfUtc: 'x', stuckOnHoldDays: 7, groups: [] }),
    );
    TestBed.inject(Router).navigateByUrl('/my-matters?role=primary');
    await h.fixture.whenStable();
    h.detectChanges();
    expect(el(h).querySelector('[data-panel=attention] [data-empty]')!.textContent).toContain(
      'Nothing needs your attention.',
    );
    expect(el(h).textContent).not.toMatch(/no (project )?manager/i);
  });

  it('groups upcoming deadlines by day and the 2 / 4 week toggle changes the range', async () => {
    const h = await open('/my-matters');
    expect(
      Array.from(el(h).querySelectorAll('[data-day]')).map((d) => d.textContent!.trim()),
    ).toEqual(['Mon Oct 26', 'Tue Oct 27']);
    expect(el(h).querySelector('[data-range="4w"]')!.getAttribute('aria-pressed')).toBe('true');
    el(h).querySelector<HTMLButtonElement>('[data-range="2w"]')!.click();
    await h.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/my-matters?range=2w');
    expect(api['getMyMattersDeadlines']).toHaveBeenLastCalledWith(
      14,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(el(h).querySelector('[data-capped]')!.textContent).toContain('2 of 30');
  });

  it('draws the health table: sortable headers, flag as text, a separate New task button, a matter link', async () => {
    const h = await open('/my-matters');
    const table = el(h).querySelector('[data-health-table]')!;
    expect(table.querySelector('th[aria-sort=ascending] [data-sort=nextDeadline]')).not.toBeNull();
    const first = table.querySelector('[data-health-row]')!;
    expect(first.querySelector('[data-matter-link]')!.getAttribute('href')).toBe('/matters/5');
    expect(first.querySelector('[data-flag]')!.textContent).toContain('Red');
    const button = first.querySelector<HTMLButtonElement>('[data-new-task]')!;
    expect(button.getAttribute('aria-label')).toBe('New task for 90005-80001');
    expect(button.closest('a')).toBeNull();
    // the flag has its reasons in words for assistive technology and as a tooltip
    expect(first.querySelector('[data-flag-cell]')!.getAttribute('title')).toBe(
      'Red: a task is overdue',
    );
  });

  it('opens Create task with the matter and the way back when New task is pressed', async () => {
    const h = await open('/my-matters?role=primary');
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate');
    el(h).querySelector<HTMLButtonElement>('[data-new-task]')!.click();
    expect(navigate).toHaveBeenCalledWith(['/tasks/new'], {
      queryParams: { matterId: 5, returnTo: '/my-matters?role=primary' },
    });
  });

  it('hides New task without Task.Create (hidden, never disabled)', async () => {
    const h = await open('/my-matters', ['Matter.BeManager', 'Matter.View', 'Task.View']);
    expect(el(h).querySelector('[data-new-task]')).toBeNull();
  });

  it('sorts from the header: the sort and direction go to the address and the API', async () => {
    const h = await open('/my-matters');
    el(h).querySelector<HTMLButtonElement>('[data-sort=open]')!.click();
    await h.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/my-matters?sort=open');
    expect(api['getMyMattersHealth']).toHaveBeenLastCalledWith(
      'open',
      'asc',
      1,
      50,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    el(h).querySelector<HTMLButtonElement>('[data-sort=open]')!.click();
    await h.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/my-matters?sort=open&dir=desc');
  });

  it('shows a positive empty state for a manager with no matters, with a way to My Work', async () => {
    const h = await open('/my-matters');
    api['getMyMattersHealth'].mockReturnValue(of(health([])));
    await TestBed.inject(Router).navigateByUrl('/my-matters?sort=open');
    await h.fixture.whenStable();
    h.detectChanges();
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
    const h = await open('/my-matters', permissions);
    expect(el(h).querySelector('[data-scope=all]')).not.toBeNull();
    api['getMyMattersHealth'].mockReturnValue(of(health([])));
    await TestBed.inject(Router).navigateByUrl('/my-matters?sort=open');
    await h.fixture.whenStable();
    h.detectChanges();
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

  it('lists the workload by pod and person with the out-of-office chip and links to the Task Queue', async () => {
    const h = await open('/my-matters');
    const lines = Array.from(el(h).querySelectorAll('[data-workload-line]'));
    expect(lines.map((l) => l.querySelector('a')!.textContent!.trim())).toEqual([
      'Processing Pod',
      'Not assigned to a person',
      'Priya Rao',
    ]);
    expect(lines[2].querySelector('[data-availability-chip]')).not.toBeNull();
    expect(lines[2].querySelector('a')!.getAttribute('href')).toBe(
      '/tasks?managedByMe=true&assignee=3',
    );
    expect(el(h).textContent).not.toMatch(/overload/i);
  });

  it('shows unread events with the dot and the word, and Mark all as read moves them to read', async () => {
    const h = await open('/my-matters');
    const unread = el(h).querySelectorAll('[data-activity-row][data-unread=true]');
    expect(unread).toHaveLength(1);
    expect(unread[0].querySelector('[data-unread-word]')!.textContent).toBe('unread');
    el(h).querySelector<HTMLButtonElement>('[data-mark-all-read]')!.click();
    await h.fixture.whenStable();
    h.detectChanges();
    expect(api['markMyMattersActivitySeen']).toHaveBeenCalledWith({ upToEventId: 12 });
    expect(el(h).querySelectorAll('[data-unread-word]')).toHaveLength(0);
    expect(el(h).querySelector('[data-mark-all-read]')).toBeNull();
  });

  it('opening an unread event marks it read; viewing the panel never does', async () => {
    const h = await open('/my-matters');
    expect(api['markMyMattersActivitySeen']).not.toHaveBeenCalled();
    el(h)
      .querySelector<HTMLAnchorElement>(
        '[data-activity-row][data-unread=true] [data-activity-link]',
      )!
      .click();
    expect(api['markMyMattersActivitySeen']).toHaveBeenCalledWith({ upToEventId: 12 });
  });

  it('shows no comment text, only "commented on"', async () => {
    const h = await open('/my-matters');
    expect(el(h).textContent).toContain('Priya commented on "Review batch 4"');
  });

  it('a failing panel shows its own error with Retry and leaves the others alone', async () => {
    const h = await open('/my-matters');
    api['getMyMattersWorkload'].mockReturnValue(throwError(() => new Error('boom')));
    await TestBed.inject(Router).navigateByUrl('/my-matters?role=primary');
    await h.fixture.whenStable();
    h.detectChanges();
    expect(el(h).querySelector('[data-panel=workload] [data-panel-error]')).not.toBeNull();
    expect(el(h).querySelector('[data-panel=health] [data-health-table]')).not.toBeNull();
    api['getMyMattersWorkload'].mockClear();
    api['getMyMattersWorkload'].mockReturnValue(
      of({ timeZone: 'x', asOfUtc: 'x', open: 0, pods: [] }),
    );
    el(h).querySelector<HTMLButtonElement>('[data-panel=workload] [data-panel-retry]')!.click();
    await h.fixture.whenStable();
    h.detectChanges();
    expect(api['getMyMattersWorkload']).toHaveBeenCalledTimes(1);
    expect(el(h).querySelector('[data-panel=workload] [data-empty]')).not.toBeNull();
  });

  it('loads every panel on its own: a panel still waiting does not hold the others', async () => {
    const h = await open('/my-matters');
    api['getMyMattersAttention'].mockReturnValue(NEVER);
    await TestBed.inject(Router).navigateByUrl('/my-matters?role=secondary');
    await h.fixture.whenStable();
    h.detectChanges();
    expect(el(h).querySelector('[data-panel=attention] [data-loading]')).toBeNull(); // keeps the previous numbers
    expect(el(h).querySelector('[data-panel=activity] [data-activity-list]')).not.toBeNull();
  });
});
