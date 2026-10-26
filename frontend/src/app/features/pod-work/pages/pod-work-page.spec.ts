import { NotificationService } from '../../../core/notify/notification.service';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, defer, of, throwError } from 'rxjs';
import { PodWorkClient, TaskQueueRow, TasksClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { UndoService } from '../../../core/notify/undo.service';
import { Permission } from '../../../core/auth/permissions';
import { apiError } from '../../../core/lookups/lookups-testing';
import {
  aRow,
  pageOf,
  provideClock,
  provideLookups,
  provideQueueChoices,
} from '../../../shared/work-queue/work-queue-testing';
import { columnScope, saveColumns } from '../../../shared/work-queue/column-prefs';
import { SkipTarget } from '../../../shared/layout/skip-target';
import { PodWorkPage } from './pod-work-page';

/** Positions of the arguments of `getPodWork` (Pod and view first, then the shared filters). */
const ARG = { podId: 0, view: 1, q: 2, status: 3, pod: 5, assignee: 7, sort: 35, page: 37 };

const COUNTS = { memberCount: 3, openCount: 12, unassignedCount: 4, overdueCount: 0 };
const PODS = [
  { podId: 5, name: 'Pod A', isMember: true, isPrimary: true, ...COUNTS, memberCount: 23 },
  { podId: 6, name: 'Pod B', isMember: true, isPrimary: false, ...COUNTS, overdueCount: 2 },
  { podId: 7, name: 'Pod C', isMember: false, isPrimary: false, ...COUNTS, memberCount: 1 },
];

/** The pods of a person with no primary pod and two memberships: nothing opens by itself, so the list of pods shows. */
const NO_PRIMARY = PODS.map((p) => ({ ...p, isPrimary: false }));

function podPage(rows: TaskQueueRow[], extra: Record<string, unknown> = {}) {
  return pageOf(rows, {
    view: 'queue',
    pod: { podId: 5, name: 'Pod A', isActive: true },
    pods: PODS,
    summary: { unassignedToPerson: 6, assigned: 31, overdue: 3, onHold: 4, dueToday: 2, asap: 1 },
    counts: { queue: 6, members: 31, attention: 7, all: 37, membersWithWork: 7 },
    unassigned: 6,
    memberLoads: [
      {
        userId: 9,
        displayName: 'Tariq M.',
        isActive: true,
        isMember: true,
        open: 9,
        overdue: 1,
        onHold: 0,
      },
      {
        userId: 4,
        displayName: 'Sam K.',
        isActive: true,
        isMember: true,
        open: 0,
        overdue: 0,
        onHold: 0,
      },
    ],
    ...extra,
  });
}

describe('PodWorkPage', () => {
  let getPodWork: ReturnType<typeof vi.fn>;
  let assignTask: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;

  async function open(
    url: string,
    options: {
      rows?: TaskQueueRow[];
      permissions?: Permission[];
      response?: Observable<unknown>;
    } = {},
  ) {
    const rows = options.rows ?? [aRow({ assignedUser: undefined, status: 'NEW' })];
    getPodWork = vi.fn().mockReturnValue(options.response ?? of(podPage(rows)));
    assignTask = vi.fn().mockImplementation(() => {
      const row = rows[0];
      return of({
        taskId: row.taskId,
        taskNumber: row.taskNumber,
        status: row.status === 'NEW' ? 'IN_PROGRESS' : row.status,
        statusLabel: row.status === 'NEW' ? 'In Progress' : row.statusLabel,
        priority: row.priority,
        assignedPod: row.assignedPod,
        assignedUser: { userId: 1, displayName: 'Test User', isActive: true },
        rowVersion: 'BBBB',
      });
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'pods/work', component: PodWorkPage }]),
        provideFakeMe(
          new FakeMeApi(
            withPermissions(...(options.permissions ?? ['Task.View', 'Pod.View', 'Task.Assign'])),
          ),
        ),
        ...provideLookups(),
        ...provideQueueChoices(),
        ...provideClock('2026-10-14T15:00:00Z', 'UTC'),
        { provide: PodWorkClient, useValue: { getPodWork } },
        { provide: TasksClient, useValue: { assignTask } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, PodWorkPage);
    await settle();
    // Under load the first render can lag behind whenStable: wait for the page itself, never a fixed time.
    await vi.waitFor(() => {
      harness.detectChanges();
      expect(harness.routeNativeElement?.querySelector('mf-fixed-page')).not.toBeNull();
      expect(
        harness.routeNativeElement?.querySelector('[role="tab"], [data-empty], [data-pod-list]'),
      ).not.toBeNull();
    });
    return harness.routeNativeElement as HTMLElement;
  }

  async function settle() {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r));
      harness.detectChanges();
    }
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  const router = () => TestBed.inject(Router);
  const query = () => router().parseUrl(router().url).queryParams;
  const lastArgs = () => getPodWork.mock.calls[getPodWork.mock.calls.length - 1];
  const tab = (el: HTMLElement, label: string) =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((t) =>
      t.textContent?.includes(label),
    )!;

  afterEach(() => localStorage.clear());

  it('names the tab in the browser title, the table caption and the live region (M8)', async () => {
    const el = await open('/pods/work?view=all');
    expect(document.title).toBe('Pod Work: Pod A: All open - MatterFlow');
    expect(el.querySelector('caption')!.textContent!.trim()).toMatch(/^Pod Work: All open/);
    expect(el.querySelector('.wl-sr')!.textContent).toContain('All open: ');
  });

  it('asks for the default Pod (the server picks the primary one) and the Pod queue', async () => {
    const el = await open('/pods/work?x=1');
    expect(lastArgs()[ARG.podId]).toBeUndefined();
    expect(lastArgs()[ARG.view]).toBe('queue');
    expect(el.querySelector('mf-work-tabs')).not.toBeNull();
    expect(tab(el, 'Unassigned').getAttribute('aria-selected')).toBe('true');
  });

  it('shows the strip (Overdue, Due today, ASAP, On hold) and three tabs with counts (W5, W6, #561, #562)', async () => {
    const el = await open('/pods/work?x=1');
    const strip = el.querySelector('[data-strip]')!.textContent!.replace(/\s+/g, ' ');
    expect(strip).toContain('Overdue 3');
    expect(strip).toContain('Due today 2');
    expect(strip).toContain('ASAP 1');
    expect(strip).toContain('On hold 4');
    expect(strip).not.toContain('Assigned');
    expect(strip).not.toContain('Unassigned');

    const tabs = Array.from(el.querySelectorAll('[role="tab"]')).map((t) =>
      t.textContent?.replace(/\s+/g, ' ').trim(),
    );
    // By member counts the people with open work, not their tasks; Overdue and on hold is the strip's now.
    expect(tabs).toEqual(['Unassigned (6)', 'By member (7)', 'All open (37)']);
  });

  describe('the strip is four filters on All open (W5, #561)', () => {
    const item = (el: HTMLElement, key: string) =>
      el.querySelector<HTMLButtonElement>(`[data-strip-item="${key}"]`)!;

    it('is a toolbar of toggle buttons, one per item, for a read-only person too', async () => {
      const el = await open('/pods/work?podId=5', { permissions: ['Task.View', 'Pod.View'] });
      const keys = Array.from(el.querySelectorAll('[data-strip-item]')).map((e) =>
        e.getAttribute('data-strip-item'),
      );
      expect(keys).toEqual(['overdue', 'dueToday', 'asap', 'onHold']);
      for (const key of keys) expect(item(el, key!).getAttribute('aria-pressed')).toBe('false');
    });

    it('Overdue opens All open with the Overdue filter, keeps the pod, is pressed, and a second click switches it off', async () => {
      const el = await open('/pods/work?podId=5');
      item(el, 'overdue').click();
      await settle();
      expect(query()).toMatchObject({ podId: '5', view: 'all', overdue: 'true' });
      expect(lastArgs()[ARG.view]).toBe('all');
      expect(item(el, 'overdue').getAttribute('aria-pressed')).toBe('true');
      expect(tab(el, 'All open').getAttribute('aria-selected')).toBe('true');

      item(el, 'overdue').click();
      await settle();
      expect(query()['overdue']).toBeUndefined();
      expect(query()['view']).toBe('all');
      expect(item(el, 'overdue').getAttribute('aria-pressed')).toBe('false');
    });

    it("Due today is the due range of today (the viewer's day) and not overdue; ASAP and On hold are their own filters", async () => {
      const el = await open('/pods/work?podId=5');
      item(el, 'dueToday').click();
      await settle();
      expect(query()).toMatchObject({
        dueFrom: '2026-10-14',
        dueTo: '2026-10-14',
        overdue: 'false',
      });
      expect(item(el, 'dueToday').getAttribute('aria-pressed')).toBe('true');

      // One item at a time: another replaces the first.
      item(el, 'asap').click();
      await settle();
      expect(query()['asap']).toBe('true');
      expect(query()['dueFrom']).toBeUndefined();
      expect(query()['overdue']).toBeUndefined();
      expect(item(el, 'dueToday').getAttribute('aria-pressed')).toBe('false');

      item(el, 'onHold').click();
      await settle();
      expect(query()['status']).toBe('ON_HOLD');
      expect(query()['asap']).toBeUndefined();
      expect(item(el, 'onHold').getAttribute('aria-pressed')).toBe('true');
    });

    it("the counts are the pod's and never follow the grid filters", async () => {
      const el = await open('/pods/work?podId=5');
      const counts = () => el.querySelector('[data-strip]')!.textContent!.replace(/\s+/g, ' ');
      const before = counts();
      // A grid filter changes the rows asked for, never the summary numbers.
      getPodWork.mockReturnValue(
        of(
          podPage([], {
            counts: { queue: 0, members: 0, attention: 0, all: 0, membersWithWork: 0 },
          }),
        ),
      );
      await router().navigateByUrl('/pods/work?podId=5&view=all&q=zzz');
      await settle();
      expect(counts()).toBe(before);
    });
  });

  it('the old Overdue and on hold address opens All open with the Overdue filter, replacing the address (W6, BUG-7, #562)', async () => {
    const el = await open('/pods/work?podId=5&view=attention');
    expect(query()).toMatchObject({ podId: '5', view: 'all', overdue: 'true' });
    expect(tab(el, 'All open').getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('[data-strip-item="overdue"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
    // Never loaded as the retired view: the one request is for All open.
    expect(getPodWork).toHaveBeenCalledTimes(1);
    expect(lastArgs()[ARG.view]).toBe('all');
  });

  it('lists my Pods first, marks the primary one, then the other Pods', async () => {
    const el = await open('/pods/work?x=1');
    const groups = Array.from(el.querySelectorAll('#pw-pod optgroup')).map((g) => ({
      label: g.getAttribute('label'),
      options: Array.from(g.querySelectorAll('option')).map((o) => o.textContent?.trim()),
    }));
    expect(groups).toEqual([
      { label: 'Your pods', options: ['Pod A (primary)', 'Pod B'] },
      { label: 'Other pods', options: ['Pod C'] },
    ]);
    expect(el.querySelector<HTMLSelectElement>('#pw-pod')!.value).toBe('5');
  });

  it('changing the Pod goes through the URL and is remembered', async () => {
    const el = await open('/pods/work?x=1');
    const select = el.querySelector<HTMLSelectElement>('#pw-pod')!;
    select.value = '6';
    select.dispatchEvent(new Event('change'));
    await settle();

    expect(query()['podId']).toBe('6');
    expect(lastArgs()[ARG.podId]).toBe(6);
    expect(localStorage.getItem('mf.pod-work.last-pod.1')).toBe('5'); // the page saves what the server returned
  });

  it('opens on the last Pod used when the URL names none', async () => {
    localStorage.setItem('mf.pod-work.last-pod.1', '6');
    await open('/pods/work');
    expect(query()['podId']).toBe('6');
    expect(getPodWork).toHaveBeenCalledTimes(1);
    expect(lastArgs()[ARG.podId]).toBe(6);
  });

  it('opens on the only Pod of a user who is a member of exactly one', async () => {
    const only = [
      { podId: 6, name: 'Pod B', isMember: true, isPrimary: false, ...COUNTS },
      { podId: 7, name: 'Pod C', isMember: false, isPrimary: false, ...COUNTS },
    ];
    await open('/pods/work', {
      response: of(podPage([], { pod: undefined, pods: only })),
    });
    // The first answer names no Pod, so the page asks again for the user's only Pod.
    expect(query()['podId']).toBe('6');
    expect(getPodWork).toHaveBeenCalledTimes(2);
    expect(lastArgs()[ARG.podId]).toBe(6);
  });

  it('switches tabs through the URL and drops the member selection', async () => {
    const el = await open('/pods/work?podId=5&assignee=9');
    tab(el, 'All open').click();
    await settle();

    expect(query()['view']).toBe('all');
    expect(query()['assignee']).toBeUndefined();
    expect(lastArgs()[ARG.view]).toBe('all');
    expect(lastArgs()[ARG.podId]).toBe(5);
  });

  it('shows the workload per person as facts: the Not assigned row, people with work, idle members folded, View tasks per row (W1, #566)', async () => {
    const el = await open('/pods/work?podId=5&view=members');
    const cells = (r: Element) =>
      Array.from(r.querySelectorAll('th, td')).map((c) =>
        c.textContent?.replace(/\s+/g, ' ').trim(),
      );
    const rows = Array.from(el.querySelectorAll('[data-members] tbody tr')).map(cells);
    expect(rows[0].slice(0, 2)).toEqual(['Not assigned to a person', '6']);
    expect(rows[1].slice(0, 4)).toEqual(['Tariq M.', '9', '1', '0']);
    // Sam K. has nothing open: folded, one click away.
    expect(rows.map((r) => r[0]).join('|')).not.toContain('Sam K.');
    expect(rows[2][0]).toContain('Show 1 member with no open work');
    expect(el.querySelector('[data-members] caption')!.textContent).toContain('not a ranking');

    el.querySelector<HTMLButtonElement>('[data-member-row][data-user="9"] .pm-view')!.click();
    await settle();
    expect(query()['assignee']).toBe('9');
    expect(lastArgs()[ARG.assignee]).toEqual([9]);
    expect(
      el.querySelector('[data-member-row][data-user="9"] .pm-view')!.getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('"Not assigned to a person" goes to the Unassigned tab', async () => {
    const el = await open('/pods/work?podId=5&view=members');
    el.querySelector<HTMLButtonElement>('[data-member-row="unassigned"] .pm-view')!.click();
    await settle();
    expect(query()['view']).toBeUndefined();
    expect(tab(el, 'Unassigned').getAttribute('aria-selected')).toBe('true');
  });

  it('says "No members yet." once for a Pod with nobody in it, with Add members for Pod.ManageMembers and no grid (BUG-6, #555)', async () => {
    const el = await open('/pods/work?podId=5&view=members', {
      response: of(podPage([], { memberLoads: [] })),
      permissions: ['Task.View', 'Pod.View', 'Task.Assign', 'Pod.ManageMembers'],
    });
    expect(el.querySelector('[data-members-empty]')!.textContent).toContain('No members yet.');
    expect(el.textContent).not.toContain('Nobody in Pod A has open work');
    expect(el.querySelector('mf-work-list')).toBeNull();
    expect(el.querySelector('mf-filters-bar')).toBeNull();
    const add = el.querySelector<HTMLAnchorElement>('[data-add-members]')!;
    expect(add.textContent!.trim()).toBe('Add members');
    expect(add.getAttribute('href')).toBe('/admin/pods?pod=5');
  });

  it('has no Add members link without Pod.ManageMembers (hidden, not disabled)', async () => {
    const el = await open('/pods/work?podId=5&view=members', {
      response: of(podPage([], { memberLoads: [] })),
    });
    expect(el.querySelector('[data-members-empty]')).not.toBeNull();
    expect(el.querySelector('[data-add-members]')).toBeNull();
  });

  it('the other tabs of an empty pod keep their own messages and the grid', async () => {
    const el = await open('/pods/work?podId=5', {
      response: of(podPage([], { memberLoads: [] })),
    });
    expect(el.querySelector('[data-members-empty]')).toBeNull();
    expect(el.querySelector('tbody [data-empty]')!.textContent).toContain(
      'Nothing waiting in Pod A.',
    );
  });

  it('"Skip to member table" focuses the first member row on By member; the other tabs keep "Skip to task list" (BUG-5, #553)', async () => {
    const skip = () => TestBed.inject(SkipTarget);
    let el = await open('/pods/work?podId=5&view=members');
    expect(skip().target()?.label).toBe('Skip to member table');
    skip().target()!.focus();
    expect(document.activeElement).toBe(
      el.querySelector('[data-members] [data-member-row] button'),
    );

    TestBed.resetTestingModule();
    el = await open('/pods/work?podId=5');
    expect(skip().target()?.label).toBe('Skip to task list');
    skip().target()!.focus();
    expect(document.activeElement!.closest('[data-task]')).not.toBeNull();
  });

  const control = (el: HTMLElement, key: string) =>
    el.querySelector<HTMLElement>(`tr[data-filter-row] [data-filter="${key}"]`);

  it('never filters by Pod because the Pod selector already does', async () => {
    const el = await open('/pods/work?podId=5&pod=7');
    expect(control(el, 'pod')).toBeNull();
    expect(el.querySelector('[data-more-filters]')).not.toBeNull();
    expect(el.querySelector('[data-chip="pod"]')).toBeNull();
    expect(lastArgs()[ARG.pod]).toBeUndefined();
  });

  it('shows the filter row open, one control per shown column, with the open statuses only', async () => {
    const el = await open('/pods/work?podId=5');
    expect(el.querySelector('tr[data-filter-row]')).not.toBeNull();
    for (const key of ['q', 'matterText', 'priority', 'assignee', 'due', 'status']) {
      expect(control(el, key), key).not.toBeNull();
    }
    control(el, 'status')!.click();
    await settle();
    const options = Array.from(document.querySelectorAll('mf-filter-popover [data-option]')).map(
      (o) => o.getAttribute('data-option'),
    );
    expect(options).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']);
    document.querySelectorAll('mf-filter-popover').forEach((n) => n.remove());
  });

  it('shows Assignee disabled with the reason on the Unassigned tab, and usable on the others', async () => {
    let el = await open('/pods/work?podId=5&assignee=9');
    // Not an empty grey box: the cell says what the tab decides (as the My Work tabs do).
    expect(control(el, 'assignee')!.hasAttribute('data-filter-fixed')).toBe(true);
    expect(control(el, 'assignee')!.textContent).toContain('Unassigned');
    expect(
      control(el, 'assignee')!.closest('[data-filter-disabled]')!.getAttribute('title'),
    ).toContain('nobody holds');
    expect(lastArgs()[ARG.assignee]).toBeUndefined();

    TestBed.resetTestingModule();
    el = await open('/pods/work?podId=5&view=members&assignee=9');
    expect(control(el, 'assignee')!.hasAttribute('disabled')).toBe(false);
    expect(lastArgs()[ARG.assignee]).toEqual([9]);
  });

  it('filters by a column text without touching the tab counts it receives', async () => {
    const el = await open('/pods/work?podId=5');
    const input = control(el, 'matterText') as HTMLInputElement;
    input.value = '343';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
    expect(query()['matterText']).toBe('343');
    expect(query()['podId']).toBe('5');
    // The tabs keep the counts of the response, whatever the grid below says.
    const tabs = Array.from(el.querySelectorAll('[role="tab"]')).map((t) =>
      t.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(tabs[0]).toBe('Unassigned (6)');
  });

  const link = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('[data-assign-link]');

  it('has no Actions column: "Assign to me" sits in the Assignee cell, named with the task number (#199)', async () => {
    const el = await open('/pods/work?podId=5');
    expect(el.querySelector('th.wt-actions, td.wt-actions')).toBeNull();
    const button = link(el)!;
    expect(button.textContent!.trim()).toBe('Assign to me');
    expect(button.getAttribute('aria-label')).toBe('Assign TSK-1042 to me');
    expect(button.closest('td')!.getAttribute('data-col')).toBe('assignee');
    expect(button.closest('td')!.textContent).toContain('Unassigned');
  });

  it('assigns a task to me with the shared inline flow: row shows the user, Undo toast, counts refresh, no list reload', async () => {
    const el = await open('/pods/work?podId=5');
    getPodWork.mockReturnValue(
      of(podPage([], { counts: { queue: 5, members: 32, attention: 7, all: 37 } })),
    );
    link(el)!.click();
    await settle();

    expect(assignTask).toHaveBeenCalledWith(1042, { rowVersion: 'AAAA', podId: 5, userId: 1 });
    const offer = TestBed.inject(UndoService).current();
    expect(offer?.message).toContain('Assigned to you.');
    expect(offer?.detail).toBe('Task moved to In Progress.');
    // The row stays on screen (muted) with its new assignee, then leaves; the tab count already follows.
    expect(el.querySelector('tr[data-task="TSK-1042"]')!.textContent).toContain('Test User');
    expect(tab(el, 'Unassigned').textContent).toContain('(5)');
    expect(getPodWork).toHaveBeenCalledTimes(3);
  });

  it('does not say "moved to In Progress" for a task that is already in progress', async () => {
    const el = await open('/pods/work?podId=5', {
      rows: [aRow({ assignedUser: undefined, status: 'ON_HOLD' })],
    });
    link(el)!.click();
    await settle();
    expect(TestBed.inject(UndoService).current()?.message).toBe('Assigned to you.');
  });

  it('refreshes the row and says so when someone else changed the task first', async () => {
    const el = await open('/pods/work?podId=5');
    assignTask.mockReturnValue(
      throwError(() =>
        apiError(409, 'CONCURRENCY_CONFLICT', 'The task was changed by someone else.'),
      ),
    );
    link(el)!.click();
    await settle();

    expect(
      TestBed.inject(NotificationService)
        .toasts()
        .map((t) => [t.severity, t.summary]),
    ).toEqual([['error', 'Someone else changed this task. The row was refreshed.']]);
  });

  it('hides "Assign to me" without Task.Assign and on the By member tab', async () => {
    let el = await open('/pods/work?podId=5', { permissions: ['Task.View', 'Pod.View'] });
    expect(link(el)).toBeNull();

    TestBed.resetTestingModule();
    el = await open('/pods/work?podId=5&view=members');
    expect(link(el)).toBeNull();
  });

  it("the tab counts follow an assignment, with the same numbers as the server's (BUG-3, #552)", async () => {
    const el = await open('/pods/work?podId=5');
    expect(tab(el, 'Unassigned').textContent).toContain('(6)');
    expect(tab(el, 'By member').textContent).toContain('(7)');

    // The server's answer after the assignment: one fewer unassigned task, one more person holding work.
    getPodWork.mockReturnValue(
      of(
        podPage([aRow({ assignedUser: undefined, status: 'NEW' })], {
          summary: {
            unassignedToPerson: 5,
            assigned: 32,
            overdue: 3,
            onHold: 4,
            dueToday: 2,
            asap: 1,
          },
          counts: { queue: 5, members: 32, attention: 7, all: 37, membersWithWork: 8 },
        }),
      ),
    );
    link(el)!.click();
    await settle();

    expect(tab(el, 'Unassigned').textContent).toContain('(5)');
    expect(tab(el, 'By member').textContent).toContain('(8)');
  });

  describe('header (BUG-1, #548)', () => {
    it('keeps the title on one line and gives the Pod select its full name as a tooltip', async () => {
      const el = await open('/pods/work?podId=5');
      const h1 = el.querySelector('h1')!;
      expect(h1.textContent!.trim()).toBe('Pod Work');
      expect(h1.querySelector('.pw-title')).not.toBeNull();
      const select = el.querySelector<HTMLSelectElement>('#pw-pod')!;
      expect(select.getAttribute('title')).toBe('Pod A');
      expect(select.classList).toContain('pw-pod-select');
      // The label stays "Pod": the select's accessible name, and its value is the full Pod name.
      expect(el.querySelector('label[for="pw-pod"]')!.textContent!.trim()).toBe('Pod');
    });
  });

  describe('Unassigned tab in the tablet band (#550)', () => {
    /** A window `px` wide: every min-width query answers for it. */
    function windowOf(px: number) {
      vi.stubGlobal('matchMedia', (q: string) => {
        const min = Number(/min-width:\s*([\d.]+)px/.exec(q)?.[1] ?? 0);
        const max = Number(/max-width:\s*([\d.]+)px/.exec(q)?.[1] ?? Infinity);
        return {
          matches: px >= min && px <= max,
          media: q,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        };
      });
    }
    afterEach(() => vi.unstubAllGlobals());
    const headers = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('thead th')).map((t) => t.textContent!.trim());

    it('leaves Matter Number out of the default columns from 640 to 899 px and puts the link in view', async () => {
      windowOf(768);
      const el = await open('/pods/work?podId=5');
      expect(headers(el).join('|')).not.toContain('Matter Number');
      expect(headers(el).join('|')).toContain('Assignee');
      expect(el.querySelector('.pw-linkonly')).not.toBeNull();
      expect(link(el)).not.toBeNull();
    });

    it("keeps today's columns from 900 px, on the other tabs, and below 640 px", async () => {
      windowOf(1366);
      let el = await open('/pods/work?podId=5');
      expect(headers(el).join('|')).toContain('Matter Number');
      expect(el.querySelector('.pw-linkonly')).toBeNull();

      TestBed.resetTestingModule();
      windowOf(768);
      el = await open('/pods/work?podId=5&view=all');
      expect(headers(el).join('|')).toContain('Matter Number');
      expect(el.querySelector('.pw-linkonly')).toBeNull();
    });

    it('a column choice the person made wins over the default', async () => {
      windowOf(768);
      saveColumns(columnScope('pod-work', 'queue'), 1, [
        'ref',
        'title',
        'matter',
        'assignee',
        'status',
      ]);
      const el = await open('/pods/work?podId=5');
      expect(headers(el).join('|')).toContain('Matter Number');
    });
  });

  describe('context line and document title (W2, #557)', () => {
    const line = (el: HTMLElement) =>
      el.querySelector('[data-page-description]')!.textContent!.replace(/\s+/g, ' ').trim();

    it("says the pod, its member count and the viewer's membership in one muted line", async () => {
      const el = await open('/pods/work?podId=5');
      expect(line(el)).toBe('Pod A \u00b7 23 members \u00b7 you are a member (primary)');
      expect(el.querySelector('[data-page-description]')!.getAttribute('title')).toBe(line(el));
      expect(document.title).toBe('Pod Work: Pod A: Unassigned - MatterFlow');
    });

    it('says "you are not a member" for a pod the viewer is not in, without "(primary)", and "1 member" for one', async () => {
      const el = await open('/pods/work?podId=7', {
        response: of(podPage([], { pod: { podId: 7, name: 'Pod C', isActive: true } })),
      });
      expect(line(el)).toBe('Pod C \u00b7 1 member \u00b7 you are not a member');
    });

    it('leaves out the parts it cannot know instead of making them up', async () => {
      const el = await open('/pods/work?podId=9', {
        response: of(podPage([], { pod: { podId: 9, name: 'Pod Z', isActive: true } })),
      });
      expect(line(el)).toBe('Pod Z');
    });

    it('announces the pod politely in a live region without moving focus', async () => {
      const el = await open('/pods/work?podId=5');
      const live = el.querySelector('[data-pod-announce]')!;
      expect(live.getAttribute('aria-live')).toBe('polite');
      expect(live.textContent).toContain('Pod A');
    });

    it('has no context line while no pod is shown, and the title is just "Pod Work"', async () => {
      const el = await open('/pods/work?x=1', {
        response: of(podPage([], { pod: undefined, pods: NO_PRIMARY })),
      });
      expect(el.querySelector('[data-page-description]')!.textContent!.trim()).toBe('');
      expect(document.title).toBe('Pod Work - MatterFlow');
    });
  });

  describe('no pod chosen: the pods as a list (W3, #558)', () => {
    it('lists Your pods then Other pods, alphabetical, with member, unassigned and (above zero) overdue counts', async () => {
      const el = await open('/pods/work?x=1', {
        response: of(podPage([], { pod: undefined, pods: NO_PRIMARY })),
      });
      expect(el.textContent).not.toContain('Choose a Pod to see');
      const groups = Array.from(el.querySelectorAll('[data-pod-list] [role="group"]')).map((g) => ({
        label: g.querySelector('h2')!.textContent!.trim(),
        rows: Array.from(g.querySelectorAll('button')).map((b) =>
          b.textContent!.replace(/\s+/g, ' ').trim(),
        ),
      }));
      expect(groups).toEqual([
        {
          label: 'Your pods',
          rows: [
            'Pod A 23 members \u00b7 4 unassigned',
            'Pod B 3 members \u00b7 4 unassigned \u00b7 2 overdue',
          ],
        },
        { label: 'Other pods', rows: ['Pod C 1 member \u00b7 4 unassigned'] },
      ]);
      expect(el.querySelector('#pw-pod')).not.toBeNull();
    });

    it('choosing a pod sets podId in the address, loads it and moves focus to the title', async () => {
      const el = await open('/pods/work?x=1', {
        response: of(podPage([], { pod: undefined, pods: NO_PRIMARY })),
      });
      getPodWork.mockReturnValue(of(podPage([aRow({ assignedUser: undefined })])));
      el.querySelector<HTMLButtonElement>('[data-pod="6"]')!.click();
      await settle();
      expect(query()['podId']).toBe('6');
      expect(lastArgs()[ARG.podId]).toBe(6);
      await vi.waitFor(() => {
        harness.detectChanges();
        expect(document.activeElement).toBe(el.querySelector('[data-page-title]'));
      });
    });

    it('does not flash the list for a user whose primary pod opens by itself', async () => {
      // The first answer names no pod (the page then opens the primary one), the second has it.
      let calls = 0;
      const el = await open('/pods/work', {
        response: defer(() => of(calls++ === 0 ? podPage([], { pod: undefined }) : podPage([]))),
      });
      expect(calls).toBe(2);
      expect(el.querySelector('[data-pod-list]')).toBeNull();
      expect(el.querySelector('[role="tab"]')).not.toBeNull();
    });
  });

  describe('no pods at all (W3, #559)', () => {
    const none = (permissions: Permission[]) =>
      open('/pods/work?x=1', {
        permissions,
        response: of(podPage([], { pod: undefined, pods: [] })),
      });

    it('says "There are no pods yet." with Create a pod for Pod.Manage', async () => {
      const el = await none(['Task.View', 'Pod.View', 'Pod.Manage']);
      const box = el.querySelector('[data-empty="no-pods"]')!;
      expect(box.textContent).toContain('There are no pods yet.');
      expect(box.textContent).not.toContain("You aren't in a pod yet");
      const link = box.querySelector<HTMLAnchorElement>('[data-create-pod]')!;
      expect(link.textContent!.trim()).toBe('Create a pod');
      expect(link.getAttribute('href')).toBe('/admin/pods?pod=new');
      expect(box.textContent).not.toContain('Ask an administrator');
    });

    it('says "Ask an administrator to create one." and hides the link without Pod.Manage', async () => {
      const el = await none(['Task.View', 'Pod.View']);
      const box = el.querySelector('[data-empty="no-pods"]')!;
      expect(box.textContent).toContain('There are no pods yet.');
      expect(box.textContent).toContain('Ask an administrator to create one.');
      expect(box.querySelector('[data-create-pod]')).toBeNull();
      expect(el.querySelector('#pw-pod')).toBeNull();
    });
  });

  it('says what is waiting in the Pod when its queue is empty, and shows an error with Retry', async () => {
    let el = await open('/pods/work?podId=5', { response: of(podPage([])) });
    expect(el.querySelector('tbody [data-empty]')!.textContent).toContain(
      'Nothing waiting in Pod A.',
    );

    TestBed.resetTestingModule();
    el = await open('/pods/work?podId=5', { response: throwError(() => new Error('boom')) });
    expect(el.querySelector('tbody [data-error]')!.textContent).toContain("Couldn't load tasks");
  });
});
