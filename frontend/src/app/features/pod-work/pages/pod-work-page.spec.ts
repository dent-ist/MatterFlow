import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MessageService } from 'primeng/api';
import { Observable, of, throwError } from 'rxjs';
import { PodWorkClient, TaskQueueRow, TasksClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import { apiError } from '../../../core/lookups/lookups-testing';
import {
  aRow,
  pageOf,
  provideClock,
  provideLookups,
} from '../../../shared/work-queue/work-queue-testing';
import { PodWorkPage } from './pod-work-page';

/** Positions of the arguments of `getPodWork` (Pod and view first, then the shared filters). */
const ARG = { podId: 0, view: 1, q: 2, status: 3, pod: 5, assignee: 7, sort: 24, page: 26 };

const PODS = [
  { podId: 5, name: 'Pod A', isMember: true, isPrimary: true },
  { podId: 6, name: 'Pod B', isMember: true, isPrimary: false },
  { podId: 7, name: 'Pod C', isMember: false, isPrimary: false },
];

function podPage(rows: TaskQueueRow[], extra: Record<string, unknown> = {}) {
  return pageOf(rows, {
    view: 'queue',
    pod: { podId: 5, name: 'Pod A', isActive: true },
    pods: PODS,
    summary: { unassignedToPerson: 6, assigned: 31, overdue: 3, onHold: 4 },
    counts: { queue: 6, members: 31, attention: 7, all: 37 },
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
  let toasts: { severity?: string; summary?: string }[];

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
    assignTask = vi.fn().mockReturnValue(of({}));
    toasts = [];
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'pods/work', component: PodWorkPage }]),
        MessageService,
        provideFakeMe(
          new FakeMeApi(
            withPermissions(...(options.permissions ?? ['Task.View', 'Pod.View', 'Task.Assign'])),
          ),
        ),
        ...provideLookups(),
        ...provideClock('2026-10-14T15:00:00Z', 'UTC'),
        { provide: PodWorkClient, useValue: { getPodWork } },
        { provide: TasksClient, useValue: { assignTask } },
      ],
    });
    TestBed.inject(MessageService).messageObserver.subscribe((m) => {
      const message = m as { severity?: string; summary?: string };
      toasts.push(message);
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, PodWorkPage);
    await settle();
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

  it('asks for the default Pod (the server picks the primary one) and the Pod queue', async () => {
    const el = await open('/pods/work?x=1');
    expect(lastArgs()[ARG.podId]).toBeUndefined();
    expect(lastArgs()[ARG.view]).toBe('queue');
    expect(el.querySelector('mf-work-tabs')).not.toBeNull();
    expect(tab(el, 'Unassigned').getAttribute('aria-selected')).toBe('true');
  });

  it('shows the Pod summary and a count on every tab', async () => {
    const el = await open('/pods/work?x=1');
    const summary = el.querySelector('[data-summary]')!.textContent!.replace(/\s+/g, ' ');
    expect(summary).toContain('Unassigned 6');
    expect(summary).toContain('Assigned 31');
    expect(summary).toContain('Overdue 3');
    expect(summary).toContain('On Hold 4');

    const tabs = Array.from(el.querySelectorAll('[role="tab"]')).map((t) =>
      t.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(tabs).toEqual([
      'Unassigned (6)',
      'By member (31)',
      'Overdue and on hold (7)',
      'All pod tasks (37)',
    ]);
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
      { podId: 6, name: 'Pod B', isMember: true, isPrimary: false },
      { podId: 7, name: 'Pod C', isMember: false, isPrimary: false },
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
    tab(el, 'Overdue and on hold').click();
    await settle();

    expect(query()['view']).toBe('attention');
    expect(query()['assignee']).toBeUndefined();
    expect(lastArgs()[ARG.view]).toBe('attention');
    expect(lastArgs()[ARG.podId]).toBe(5);
  });

  it('shows the workload per member as facts with a way to show their tasks', async () => {
    const el = await open('/pods/work?podId=5&view=members');
    const cells = (r: Element) =>
      Array.from(r.querySelectorAll('th, td')).map((c) => c.textContent?.trim());
    const rows = Array.from(el.querySelectorAll('[data-members] tbody tr')).map(cells);
    expect(rows[0].slice(0, 4)).toEqual(['Tariq M.', '9', '1', '0']);
    expect(rows[1].slice(0, 4)).toEqual(['Sam K.', '0', '0', '0']);
    expect(el.querySelector('[data-members] caption')!.textContent).toContain('not a ranking');

    el.querySelector<HTMLButtonElement>('[data-members] button')!.click();
    await settle();
    expect(query()['assignee']).toBe('9');
    expect(lastArgs()[ARG.assignee]).toEqual([9]);
    expect(el.querySelector('[data-members] button')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('says "No members yet." for a Pod with nobody in it', async () => {
    const el = await open('/pods/work?podId=5&view=members', {
      response: of(podPage([], { memberLoads: [] })),
    });
    expect(el.querySelector('[data-members-empty]')!.textContent).toContain('No members yet.');
  });

  it('never filters by Pod in the filter panel because the Pod selector already does', async () => {
    const el = await open('/pods/work?podId=5');
    el.querySelector<HTMLButtonElement>('.fb-button')!.click();
    harness.detectChanges();
    expect(el.querySelector('#fb-pod')).toBeNull();
    expect(lastArgs()[ARG.pod]).toBeUndefined();
  });

  it('assigns a task to me, says that a New task was started, and reloads', async () => {
    const el = await open('/pods/work?podId=5');
    el.querySelector<HTMLButtonElement>('.wt-action')!.click();
    await settle();

    expect(assignTask).toHaveBeenCalledWith(1042, { rowVersion: 'AAAA', podId: 5, userId: 1 });
    expect(toasts.map((t) => t.summary)).toEqual(['Assigned to you. Task moved to In Progress.']);
    expect(getPodWork).toHaveBeenCalledTimes(2);
  });

  it('does not say "moved to In Progress" for a task that is already in progress', async () => {
    const el = await open('/pods/work?podId=5', {
      rows: [aRow({ assignedUser: undefined, status: 'ON_HOLD' })],
    });
    el.querySelector<HTMLButtonElement>('.wt-action')!.click();
    await settle();
    expect(toasts.map((t) => t.summary)).toEqual(['Assigned to you.']);
  });

  it('refreshes and says so when someone else changed the task first', async () => {
    const el = await open('/pods/work?podId=5');
    assignTask.mockReturnValue(
      throwError(() =>
        apiError(409, 'CONCURRENCY_CONFLICT', 'The task was changed by someone else.'),
      ),
    );
    el.querySelector<HTMLButtonElement>('.wt-action')!.click();
    await settle();

    expect(toasts.map((t) => [t.severity, t.summary])).toEqual([
      ['error', 'Someone else changed this task. The list was refreshed.'],
    ]);
    expect(getPodWork).toHaveBeenCalledTimes(2);
  });

  it('hides "Assign to me" without Task.Assign and on the By member tab', async () => {
    let el = await open('/pods/work?podId=5', { permissions: ['Task.View', 'Pod.View'] });
    expect(el.querySelector('.wt-action')).toBeNull();

    TestBed.resetTestingModule();
    el = await open('/pods/work?podId=5&view=members');
    expect(el.querySelector('.wt-action')).toBeNull();
  });

  it('guides a user who is in no Pod', async () => {
    const el = await open('/pods/work?x=1', {
      response: of(podPage([], { pod: undefined, pods: [] })),
    });
    expect(el.querySelector('[data-empty="no-pod"]')!.textContent).toContain(
      "You aren't in a pod yet. Ask an administrator.",
    );
  });

  it('asks to choose a Pod when there are Pods but none is selected', async () => {
    const el = await open('/pods/work?x=1', {
      response: of(podPage([], { pod: undefined })),
    });
    expect(el.querySelector('[data-empty="choose"]')!.textContent).toContain('Choose a Pod');
    expect(el.querySelector('#pw-pod')).not.toBeNull();
  });

  it('says what is waiting in the Pod when its queue is empty, and shows an error with Retry', async () => {
    let el = await open('/pods/work?podId=5', { response: of(podPage([])) });
    expect(el.querySelector('[data-empty]')!.textContent).toContain('Nothing waiting in Pod A.');

    TestBed.resetTestingModule();
    el = await open('/pods/work?podId=5', { response: throwError(() => new Error('boom')) });
    expect(el.querySelector('[role="alert"]')!.textContent).toContain(
      'Something went wrong. Try again.',
    );
  });
});
