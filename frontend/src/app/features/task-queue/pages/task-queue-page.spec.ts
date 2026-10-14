import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MessageService } from 'primeng/api';
import { Observable, Subject, of, throwError } from 'rxjs';
import { PodsClient, TaskQueueClient, TaskQueueRow } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import { SEARCH_DEBOUNCE_MS } from '../../../shared/work-queue/work-filter-bar';
import {
  aRow,
  pageOf,
  provideClock,
  provideLookups,
} from '../../../shared/work-queue/work-queue-testing';
import { TaskQueuePage } from './task-queue-page';

/** Positions of the filter arguments of `getTaskQueue`. */
const ARG = {
  q: 0,
  status: 1,
  priority: 2,
  pod: 3,
  assignee: 4,
  unassigned: 5,
  creator: 6,
  overdue: 17,
  sort: 21,
  dir: 22,
  page: 23,
  pageSize: 24,
};

describe('TaskQueuePage', () => {
  let getTaskQueue: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;

  async function open(
    url: string,
    options: {
      rows?: TaskQueueRow[];
      total?: number;
      permissions?: Permission[];
      response?: Observable<unknown>;
      primaryPod?: number | null;
    } = {},
  ) {
    const rows = options.rows ?? [
      aRow(),
      aRow({ taskId: 1043, taskNumber: 'TSK-1043', title: 'Second' }),
    ];
    getTaskQueue = vi
      .fn()
      .mockReturnValue(
        options.response ?? of(pageOf(rows, { total: options.total ?? rows.length })),
      );
    const pods = {
      listMyPods: () =>
        of(
          options.primaryPod === null
            ? []
            : [{ podId: options.primaryPod ?? 5, name: 'Pod A', isActive: true, isPrimary: true }],
        ),
      listPods: () =>
        of({ items: [{ podId: 6, name: 'Pod B' }], total: 1, page: 1, pageSize: 100 }),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'tasks', component: TaskQueuePage }]),
        MessageService,
        provideFakeMe(
          new FakeMeApi(
            withPermissions(...(options.permissions ?? ['Task.View', 'Task.Create', 'Pod.View'])),
          ),
        ),
        ...provideLookups(),
        ...provideClock('2026-10-14T15:00:00Z'),
        { provide: TaskQueueClient, useValue: { getTaskQueue } },
        { provide: PodsClient, useValue: pods },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, TaskQueuePage);
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
  const lastArgs = () => getTaskQueue.mock.calls[getTaskQueue.mock.calls.length - 1];

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('turns a dashboard deep link into the matching API request', async () => {
    await open('/tasks?overdue=true&status=NEW&status=IN_PROGRESS');

    expect(getTaskQueue).toHaveBeenCalledTimes(1);
    const args = lastArgs();
    expect(args[ARG.status]).toEqual(['NEW', 'IN_PROGRESS']);
    expect(args[ARG.overdue]).toBe(true);
    expect(args[ARG.page]).toBe(1);
    expect(args[ARG.pageSize]).toBe(50);
    expect(args[ARG.sort]).toBeUndefined();
  });

  it('passes every filter parameter of a deep link through with the same meaning', async () => {
    await open(
      '/tasks?q=dedup&priority=1&priority=2&pod=5&assignee=9&unassigned=true&creator=3&sort=due&dir=desc&page=2&pageSize=25',
    );
    const args = lastArgs();
    expect(args[ARG.q]).toBe('dedup');
    expect(args[ARG.priority]).toEqual([1, 2]);
    expect(args[ARG.pod]).toEqual([5]);
    expect(args[ARG.assignee]).toEqual([9]);
    expect(args[ARG.unassigned]).toBe(true);
    expect(args[ARG.creator]).toEqual([3]);
    expect([args[ARG.sort], args[ARG.dir], args[ARG.page], args[ARG.pageSize]]).toEqual([
      'due',
      'desc',
      2,
      25,
    ]);
  });

  it('starts a bare /tasks on the All open view, with one request', async () => {
    await open('/tasks');

    expect(query()['status']).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']);
    expect(getTaskQueue).toHaveBeenCalledTimes(1);
    expect(lastArgs()[ARG.status]).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']);
  });

  it('lists the rows with the range, opens the task from the title and shows the chips of the URL', async () => {
    const el = await open('/tasks?status=NEW&status=IN_PROGRESS&status=ON_HOLD&priority=1');

    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(el.querySelector('tbody a')!.getAttribute('href')).toBe('/tasks/1042');
    expect(el.textContent).toContain('Showing 1-2 of 2');
    const chips = Array.from(el.querySelectorAll('.fb-chip')).map((c) => c.textContent?.trim());
    expect(chips).toEqual(['Status: Open', 'Priority: Critical']);
  });

  it('removing a chip and Clear all filters update the URL and reload; clearing does not bounce back to All open', async () => {
    const el = await open('/tasks?status=NEW&priority=1&overdue=true');
    el.querySelector<HTMLButtonElement>('.fb-chip-x')!.click(); // Status: New
    await settle();
    expect(query()).toEqual({ priority: '1', overdue: 'true' });
    expect(lastArgs()[ARG.status]).toBeUndefined();

    el.querySelector<HTMLButtonElement>('.fb-clear')!.click();
    await settle();
    expect(query()).toEqual({});
    expect(getTaskQueue).toHaveBeenCalledTimes(3);
    expect(lastArgs()[ARG.overdue]).toBeUndefined();
    expect(router().url).toBe('/tasks');
  });

  it('sorts by a column header, flips the direction, and resets to the default order', async () => {
    const el = await open('/tasks?status=NEW');
    const header = (col: string) =>
      el.querySelector<HTMLElement>(`thead th[data-col="${col}"] button`)!;

    header('priority').click();
    await settle();
    expect(query()['sort']).toBe('priority');
    expect(query()['dir']).toBe('asc');
    expect([lastArgs()[ARG.sort], lastArgs()[ARG.dir]]).toEqual(['priority', 'asc']);
    expect(el.querySelector('th[data-col="priority"]')!.getAttribute('aria-sort')).toBe(
      'ascending',
    );

    header('priority').click();
    await settle();
    expect(query()['dir']).toBe('desc');
    expect(el.querySelector('th[data-col="priority"]')!.getAttribute('aria-sort')).toBe(
      'descending',
    );

    el.querySelector<HTMLButtonElement>('[data-sort-note] button')!.click();
    await settle();
    expect(query()['sort']).toBeUndefined();
    expect(lastArgs()[ARG.sort]).toBeUndefined();
  });

  it('sorts a date column newest first the first time', async () => {
    const el = await open('/tasks?status=NEW');
    el.querySelector<HTMLElement>('th[data-col="due"] button')!.click();
    await settle();
    expect([query()['sort'], query()['dir']]).toEqual(['due', 'asc']);
  });

  it('applies a quick view, replacing the filters', async () => {
    const el = await open('/tasks?q=old&priority=2');
    const view = (label: string) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('.fb-view')).find(
        (b) => b.textContent?.trim() === label,
      )!;

    view('Overdue').click();
    await settle();
    expect(query()).toEqual({ status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'], overdue: 'true' });
    expect(view('Overdue').getAttribute('aria-pressed')).toBe('true');

    view('Unassigned').click();
    await settle();
    expect(query()['unassigned']).toBe('true');
    expect(query()['overdue']).toBeUndefined();
  });

  it('"My Pod" filters on the primary Pod and is disabled without one', async () => {
    let el = await open('/tasks?status=NEW', { primaryPod: 5 });
    const myPod = () =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('.fb-view')).find(
        (b) => b.textContent?.trim() === 'My pod',
      )!;
    expect(myPod().disabled).toBe(false);
    myPod().click();
    await settle();
    expect(query()['pod']).toBe('5');
    expect(lastArgs()[ARG.pod]).toEqual([5]);

    TestBed.resetTestingModule();
    el = await open('/tasks?status=NEW', { primaryPod: null });
    expect(myPod().disabled).toBe(true);
  });

  it('searches after a pause, from page 1', async () => {
    const el = await open('/tasks?status=NEW&page=3');
    vi.useFakeTimers();
    const box = el.querySelector<HTMLInputElement>('#fb-q')!;
    box.value = 'dedup';
    box.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    vi.useRealTimers();
    await settle();
    expect(query()['q']).toBe('dedup');
    expect(query()['page']).toBeUndefined();
    expect(lastArgs()[ARG.q]).toBe('dedup');
  });

  it('pages with Previous and Next and changes the page size', async () => {
    const el = await open('/tasks?status=NEW', { total: 120 });
    expect(el.textContent).toContain('Showing 1-50 of 120');
    const next = Array.from(el.querySelectorAll<HTMLButtonElement>('mf-pager button')).find(
      (b) => b.textContent?.trim() === 'Next',
    )!;
    next.click();
    await settle();
    expect(query()['page']).toBe('2');
    expect(lastArgs()[ARG.page]).toBe(2);

    const size = el.querySelector<HTMLSelectElement>('.wl-size select')!;
    size.value = '25';
    size.dispatchEvent(new Event('change'));
    await settle();
    expect(query()['pageSize']).toBe('25');
    expect(query()['page']).toBeUndefined();
  });

  it('shows skeleton rows while loading, then the rows', async () => {
    const pending = new Subject<unknown>();
    const el = await open('/tasks?status=NEW', { response: pending });
    expect(el.querySelectorAll('tr.wt-skeleton').length).toBe(5);
    expect(el.querySelector('table')!.getAttribute('aria-busy')).toBe('true');

    pending.next(pageOf([aRow()]));
    pending.complete();
    await settle();
    expect(el.querySelectorAll('tr.wt-skeleton').length).toBe(0);
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('shows an error alert with Retry that reloads', async () => {
    const el = await open('/tasks?status=NEW', { response: throwError(() => new Error('boom')) });
    expect(el.querySelector('[role="alert"]')!.textContent).toContain(
      'Something went wrong. Try again.',
    );

    getTaskQueue.mockReturnValue(of(pageOf([aRow()])));
    el.querySelector<HTMLButtonElement>('.wl-retry')!.click();
    await settle();
    expect(getTaskQueue).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('says "No tasks yet." with Create task when permitted, and "No tasks match these filters." when filtered', async () => {
    let el = await open('/tasks?status=NEW', { rows: [] });
    // Filters are set, so the filtered message applies.
    expect(el.querySelector('[data-empty]')!.textContent).toContain(
      'No tasks match these filters.',
    );

    TestBed.resetTestingModule();
    el = await open('/tasks?sort=due', { rows: [] });
    const empty = el.querySelector('[data-empty]')!;
    expect(empty.textContent).toContain('No tasks yet.');
    expect(empty.textContent).toContain('Create task');
  });

  it('shows Create task only with Task.Create', async () => {
    let el = await open('/tasks?status=NEW');
    expect(el.querySelector('mf-page-header')!.textContent).toContain('Create task');

    TestBed.resetTestingModule();
    el = await open('/tasks?status=NEW', { permissions: ['Task.View'] });
    expect(el.querySelector('mf-page-header')!.textContent).not.toContain('Create task');
  });

  it('remembers the chosen columns and density for the user', async () => {
    let el = await open('/tasks?status=NEW');
    el.querySelector<HTMLButtonElement>('.cc-button')!.click();
    harness.detectChanges();
    const input = (label: string) =>
      Array.from(el.querySelectorAll<HTMLLabelElement>('.cc-check'))
        .find((l) => l.textContent?.includes(label))!
        .querySelector('input')!;
    input('Client').click();
    input('Compact').click();
    harness.detectChanges();
    expect(el.querySelector('th[data-col="client"]')).not.toBeNull();
    expect(el.querySelector('table')!.classList).toContain('wt--compact');

    TestBed.resetTestingModule();
    el = await open('/tasks?status=NEW');
    expect(el.querySelector('th[data-col="client"]')).not.toBeNull();
    expect(el.querySelector('table')!.classList).toContain('wt--compact');
  });

  it('focuses the search box on "/" unless typing in a field', async () => {
    const el = await open('/tasks?status=NEW');
    const box = el.querySelector<HTMLInputElement>('#fb-q')!;
    document.body.appendChild(el);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    expect(document.activeElement).toBe(box);
    box.blur();

    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();
    other.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(document.activeElement).toBe(other);
    other.remove();
  });
});
