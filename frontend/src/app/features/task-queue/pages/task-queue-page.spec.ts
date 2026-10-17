import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MessageService } from 'primeng/api';
import { Observable, Subject, of, throwError } from 'rxjs';
import { PodsClient, TaskQueueClient, TaskQueueRow } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import {
  aRow,
  pageOf,
  provideClock,
  provideLookups,
  provideQueueChoices,
} from '../../../shared/work-queue/work-queue-testing';
import { TaskQueuePage } from './task-queue-page';

/** Positions of the arguments of `getTaskQueue`. */
const ARG = {
  q: 0,
  status: 1,
  priority: 2,
  pod: 3,
  noPod: 4,
  assignee: 5,
  unassigned: 6,
  creator: 7,
  overdue: 18,
  matterText: 22,
  clientText: 23,
  projectText: 24,
  updatedFrom: 25,
  updatedTo: 26,
  sort: 27,
  dir: 28,
  page: 29,
  pageSize: 30,
};

const OPEN = ['NEW', 'IN_PROGRESS', 'ON_HOLD'];

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
        ...provideQueueChoices(),
        ...provideClock('2026-10-14T15:00:00Z'),
        { provide: TaskQueueClient, useValue: { getTaskQueue } },
        { provide: PodsClient, useValue: pods },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, TaskQueuePage);
    await settle();
    // Under load the first render can lag behind whenStable: wait for the page itself (the table is there in every state), never a fixed time.
    await vi.waitFor(() => {
      harness.detectChanges();
      expect(harness.routeNativeElement?.querySelector('table')).not.toBeNull();
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
  const lastArgs = () => getTaskQueue.mock.calls[getTaskQueue.mock.calls.length - 1];
  const chips = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-filter-chips] [data-chip]')).map((c) =>
      c.querySelector('.fch__text')!.textContent!.replace(/\s+/g, ' ').trim(),
    );
  const filterInput = (el: HTMLElement, key: string) =>
    el.querySelector<HTMLInputElement>(`tr[data-filter-row] input[data-filter="${key}"]`)!;

  /** Types into a column text filter and presses Enter, which applies at once. */
  async function typeFilter(el: HTMLElement, key: string, text: string) {
    const input = filterInput(el, key);
    input.value = text;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
  }

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
      '/tasks?q=dedup&priority=1&priority=2&pod=5&assignee=9&unassigned=true&creator=3&matterText=343-12&clientText=Acme&projectText=Phase&updatedFrom=2026-10-01&updatedTo=2026-10-07&sort=due&dir=desc&page=2&pageSize=25',
    );
    const args = lastArgs();
    expect(args[ARG.q]).toBe('dedup');
    expect(args[ARG.priority]).toEqual([1, 2]);
    expect(args[ARG.pod]).toEqual([5]);
    expect(args[ARG.assignee]).toEqual([9]);
    expect(args[ARG.unassigned]).toBe(true);
    expect(args[ARG.creator]).toEqual([3]);
    expect([args[ARG.matterText], args[ARG.clientText], args[ARG.projectText]]).toEqual([
      '343-12',
      'Acme',
      'Phase',
    ]);
    expect([args[ARG.updatedFrom], args[ARG.updatedTo]]).toEqual(['2026-10-01', '2026-10-07']);
    expect([args[ARG.sort], args[ARG.dir], args[ARG.page], args[ARG.pageSize]]).toEqual([
      'due',
      'desc',
      2,
      25,
    ]);
  });

  it('a link with filters and no status asks for every status, as such links always did', async () => {
    await open('/tasks?assignee=9&priority=2');
    expect(lastArgs()[ARG.status]).toBeUndefined();
  });

  it('starts a bare /tasks on the open statuses without touching the address, with one request', async () => {
    const el = await open('/tasks');

    expect(query()).toEqual({});
    expect(getTaskQueue).toHaveBeenCalledTimes(1);
    expect(lastArgs()[ARG.status]).toEqual(OPEN);
    // The default is shown in its cell and is neither counted nor a chip.
    expect(el.querySelector('tr[data-filter-row] [data-filter="status"]')!.textContent).toContain(
      'Open',
    );
    expect(el.querySelector('[data-filters-toggle]')!.textContent).not.toContain('(');
    expect(chips(el)).toEqual([]);
    expect(el.querySelector('[data-restored-notice]')).toBeNull();
  });

  it('opens a bare /tasks on the view the user last used, says so, and loads once', async () => {
    localStorage.setItem(
      'mf.work-view.v1.queue.1',
      JSON.stringify({ status: ['NEW'], overdue: 'true', sort: 'due', dir: 'desc' }),
    );
    const el = await open('/tasks');

    expect(query()['status']).toBe('NEW');
    expect(query()['overdue']).toBe('true');
    expect(getTaskQueue).toHaveBeenCalledTimes(1);
    expect(lastArgs()[ARG.status]).toEqual(['NEW']);
    expect(lastArgs()[ARG.sort]).toBe('due');
    expect(el.querySelector('[data-restored-text]')!.textContent).toMatch(
      /^Restored your last view: .*Status/,
    );

    // Reset to default goes back to the plain link and the open statuses, and forgets the view.
    el.querySelector<HTMLButtonElement>('[data-restored-notice] button')!.click();
    await settle();
    expect(query()).toEqual({});
    expect(lastArgs()[ARG.status]).toEqual(OPEN);
    expect(el.querySelector('[data-restored-notice]')).toBeNull();
    TestBed.resetTestingModule();
    const again = await open('/tasks');
    expect(query()).toEqual({});
    expect(again.querySelector('[data-restored-notice]')).toBeNull();
  });

  it('does not call the default view "restored": a remembered default is just the page', async () => {
    localStorage.setItem('mf.work-view.v1.queue.1', JSON.stringify({ status: OPEN }));
    const el = await open('/tasks');
    expect(query()).toEqual({});
    expect(el.querySelector('[data-restored-notice]')).toBeNull();
  });

  it('remembers the view it loaded, but not the search text', async () => {
    await open('/tasks?status=NEW&q=abc&priority=2');

    const saved = JSON.parse(localStorage.getItem('mf.work-view.v1.queue.1')!);
    expect(saved).toEqual({ status: ['NEW'], priority: ['2'] });
  });

  it('lists the rows, opens the task from the title and shows the filter row open with the chips of the URL', async () => {
    const el = await open('/tasks?status=NEW&status=IN_PROGRESS&status=ON_HOLD&priority=1');

    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(el.querySelector('tbody a')!.getAttribute('href')).toBe('/tasks/1042');
    expect(el.textContent).toContain('Showing 1-2 of 2');
    // The row is open on this screen, so only filters on hidden columns would also show as chips; the default Open is never a chip.
    expect(el.querySelector('tr[data-filter-row]')).not.toBeNull();
    expect(el.querySelector('[data-filters-toggle]')!.textContent).toContain('(1)');
    expect(chips(el)).toEqual([]);
  });

  it('shows a filter on a hidden column as a chip, and the chip removes it', async () => {
    const el = await open('/tasks?status=NEW&clientText=Acme&creator=2');
    // Client and Creator are not in the default columns.
    expect(chips(el)).toEqual([
      'Client: Acme (hidden column)',
      'Creator: Pat Partner (hidden column)',
    ]);

    el.querySelector<HTMLButtonElement>('[data-chip="clientText"] .fch__x')!.click();
    await settle();
    expect(query()['clientText']).toBeUndefined();
    expect(query()['creator']).toBe('2');
    expect(lastArgs()[ARG.clientText]).toBeUndefined();
  });

  it('typing in a column filter writes the address, resets the page and reloads once', async () => {
    const el = await open('/tasks?status=NEW&page=3');
    const before = getTaskQueue.mock.calls.length;

    await typeFilter(el, 'matterText', '343-12');
    expect(query()['matterText']).toBe('343-12');
    expect(query()['page']).toBeUndefined();
    expect(getTaskQueue.mock.calls.length).toBe(before + 1);
    expect(lastArgs()[ARG.matterText]).toBe('343-12');
    expect(lastArgs()[ARG.status]).toEqual(['NEW']);
  });

  it('a filter chosen on a plain /tasks keeps the open statuses in the address, so the list does not widen', async () => {
    const el = await open('/tasks');
    await typeFilter(el, 'q', 'dedup');

    expect(query()['q']).toBe('dedup');
    expect(query()['status']).toEqual(OPEN);
    expect(lastArgs()[ARG.status]).toEqual(OPEN);
    expect(lastArgs()[ARG.q]).toBe('dedup');
  });

  it('removing a chip and Clear filters update the address and reload; clearing returns to the plain link', async () => {
    const el = await open('/tasks?status=NEW&priority=1&overdue=true&clientText=Acme');
    el.querySelector<HTMLButtonElement>('[data-chip="clientText"] .fch__x')!.click();
    await settle();
    expect(query()['clientText']).toBeUndefined();
    expect(query()['priority']).toBe('1');

    el.querySelector<HTMLButtonElement>('[data-clear-filters]')!.click();
    await settle();
    expect(query()).toEqual({});
    expect(lastArgs()[ARG.overdue]).toBeUndefined();
    expect(lastArgs()[ARG.status]).toEqual(OPEN);
    expect(getTaskQueue).toHaveBeenCalledTimes(3);
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

    el.querySelector<HTMLButtonElement>('[data-sort-note] button')!.click();
    await settle();
    expect(query()['sort']).toBeUndefined();
    expect(lastArgs()[ARG.sort]).toBeUndefined();
  });

  it('sorting on a plain /tasks keeps the open statuses', async () => {
    const el = await open('/tasks');
    el.querySelector<HTMLElement>('thead th[data-col="due"] button')!.click();
    await settle();
    expect(lastArgs()[ARG.status]).toEqual(OPEN);
    expect(lastArgs()[ARG.sort]).toBe('due');
  });

  it('applies a quick view as a preset that replaces the filters', async () => {
    const el = await open('/tasks?q=old&priority=2');
    const view = (key: string) => el.querySelector<HTMLButtonElement>(`[data-view="${key}"]`)!;

    view('overdue').click();
    await settle();
    expect(query()).toEqual({ status: OPEN, overdue: 'true' });
    expect(view('overdue').getAttribute('aria-pressed')).toBe('true');
    expect(chips(el)).toEqual(['Overdue: Overdue only']);

    view('unassigned').click();
    await settle();
    expect(query()['unassigned']).toBe('true');
    expect(query()['overdue']).toBeUndefined();

    // All open is the plain link; a manual change un-presses a view.
    view('allOpen').click();
    await settle();
    expect(query()).toEqual({});
    expect(view('allOpen').getAttribute('aria-pressed')).toBe('true');
    await typeFilter(el, 'q', 'x');
    expect(view('allOpen').getAttribute('aria-pressed')).toBe('false');
  });

  it('"My Pod" filters on the primary Pod and is disabled without one', async () => {
    let el = await open('/tasks?status=NEW', { primaryPod: 5 });
    const myPod = () => el.querySelector<HTMLButtonElement>('[data-view="myPod"]')!;
    expect(myPod().disabled).toBe(false);
    myPod().click();
    await settle();
    expect(query()['pod']).toBe('5');
    expect(lastArgs()[ARG.pod]).toEqual([5]);

    TestBed.resetTestingModule();
    el = await open('/tasks?status=NEW', { primaryPod: null });
    expect(myPod().disabled).toBe(true);
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

    const size = el.querySelector<HTMLSelectElement>('.mf-pager__size select')!;
    size.value = '25';
    size.dispatchEvent(new Event('change'));
    await settle();
    expect(query()['pageSize']).toBe('25');
    expect(query()['page']).toBeUndefined();
  });

  it('keeps the headers and the filter row while loading, with the loading state as a row of the body', async () => {
    const pending = new Subject<unknown>();
    const el = await open('/tasks?status=NEW', { response: pending });
    expect(
      el.querySelector('tbody[mfgridbody] [data-loading], tbody [data-loading]'),
    ).not.toBeNull();
    expect(el.querySelectorAll('thead th').length).toBeGreaterThan(3);
    expect(el.querySelector('tr[data-filter-row]')).not.toBeNull();
    expect(el.querySelector('table')!.getAttribute('aria-busy')).toBe('true');

    pending.next(pageOf([aRow()]));
    pending.complete();
    await settle();
    expect(el.querySelector('[data-loading]')).toBeNull();
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('shows the error as a row of the body with Retry, keeping the headers and the filter row', async () => {
    const el = await open('/tasks?status=NEW', { response: throwError(() => new Error('boom')) });
    expect(el.querySelector('tbody [data-error]')!.textContent).toContain("Couldn't load tasks");
    expect(el.querySelector('tr[data-filter-row]')).not.toBeNull();

    getTaskQueue.mockReturnValue(of(pageOf([aRow()])));
    Array.from(el.querySelectorAll<HTMLButtonElement>('tbody [data-error] button, tbody button'))
      .find((b) => b.textContent?.trim() === 'Retry')!
      .click();
    await settle();
    expect(getTaskQueue).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-error]')).toBeNull();
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('says "No open tasks." with Create task when permitted, and "No tasks match these filters" with Clear filters when filtered', async () => {
    let el = await open('/tasks?status=NEW', { rows: [] });
    // Filters are set, so the filtered message applies.
    let empty = el.querySelector('tbody [data-empty]')!;
    expect(empty.getAttribute('data-empty')).toBe('filtered');
    expect(empty.textContent).toContain('No tasks match these filters');
    expect(el.querySelector('tr[data-filter-row]')).not.toBeNull();

    TestBed.resetTestingModule();
    el = await open('/tasks?sort=due', { rows: [] });
    empty = el.querySelector('tbody [data-empty]')!;
    expect(empty.getAttribute('data-empty')).toBe('none');
    expect(empty.textContent).toContain('No open tasks.');
    expect(empty.textContent).toContain('Create task');
  });

  it('leaves the one global Create task button to the app header (UXR-23)', async () => {
    const el = await open('/tasks?status=NEW');
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
    // The Client filter now sits in the row, under its column.
    await settle();
    expect(filterInput(el, 'clientText')).not.toBeNull();
    expect(el.querySelector('table')!.classList).toContain('wt--compact');

    TestBed.resetTestingModule();
    el = await open('/tasks?status=NEW');
    expect(el.querySelector('th[data-col="client"]')).not.toBeNull();
    expect(el.querySelector('table')!.classList).toContain('wt--compact');
  });

  it('puts one filter control under each column, Title or Ref across two', async () => {
    const el = await open('/tasks');
    const cells = Array.from(el.querySelectorAll('tr[data-filter-row] td'));
    expect(cells[0].getAttribute('colspan')).toBe('2');
    expect(filterInput(el, 'q').getAttribute('aria-label')).toBe('Filter by Title or Ref');
    expect(filterInput(el, 'matterText').getAttribute('aria-label')).toBe('Filter by Matter');
    for (const key of ['priority', 'assignee', 'due', 'status']) {
      expect(el.querySelector(`tr[data-filter-row] [data-filter="${key}"]`), key).not.toBeNull();
    }
  });

  it('focuses the Title or Ref filter on "/" unless typing in a field', async () => {
    const el = await open('/tasks?status=NEW');
    document.body.appendChild(el);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', cancelable: true }));
    await settle();
    expect(document.activeElement).toBe(filterInput(el, 'q'));
    (document.activeElement as HTMLElement).blur();

    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();
    other.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(document.activeElement).toBe(other);
    other.remove();
  });
});
