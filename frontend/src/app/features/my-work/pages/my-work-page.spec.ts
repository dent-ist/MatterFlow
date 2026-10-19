import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { By } from '@angular/platform-browser';
import { Observable, of, throwError } from 'rxjs';
import { MyWorkClient, PodsClient } from '../../../api/generated/api-client';
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
import { WorkList } from '../../../shared/work-queue/work-list';
import { MyWorkPage, firstNonEmptyTab } from './my-work-page';

/** Positions of the arguments of `getMyWork` (the view comes first, then the shared filters). */
const ARG = {
  view: 0,
  closedWindow: 1,
  assignedFrom: 2,
  group: 3,
  newSince: 4,
  q: 5,
  status: 6,
  pod: 8,
  assignee: 10,
  unassigned: 11,
  creator: 12,
  dueFrom: 20,
  asap: 22,
  completedFrom: 25,
  matterText: 27,
  sort: 32,
  page: 34,
};

const COUNTS = { active: 7, dueSoon: 2, completed: 5, createdByMe: 3 };
const ATTENTION = { overdue: 9, dueToday: 3, asap: 14, onHold: 0 };

describe('MyWorkPage', () => {
  let getMyWork: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;

  async function open(
    url: string,
    options: {
      rows?: ReturnType<typeof aRow>[];
      permissions?: Permission[];
      response?: unknown;
    } = {},
  ) {
    const rows = options.rows ?? [aRow()];
    getMyWork = vi
      .fn()
      .mockReturnValue(
        options.response ??
          of(pageOf(rows, { view: 'active', counts: COUNTS, attention: ATTENTION })),
      );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'my-work', component: MyWorkPage }]),
        provideFakeMe(
          new FakeMeApi(withPermissions(...(options.permissions ?? ['Task.View', 'Pod.View']))),
        ),
        ...provideLookups(),
        ...provideQueueChoices(),
        ...provideClock('2026-10-14T15:00:00Z', 'UTC'),
        { provide: MyWorkClient, useValue: { getMyWork } },
        {
          provide: PodsClient,
          useValue: {
            listMyPods: () => of([{ podId: 5, name: 'Pod A', isActive: true, isPrimary: true }]),
            listPods: () => of({ items: [], total: 0, page: 1, pageSize: 100 }),
          },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, MyWorkPage);
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
  const lastArgs = () => getMyWork.mock.calls[getMyWork.mock.calls.length - 1];
  const tab = (el: HTMLElement, label: string) =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((t) =>
      t.textContent?.includes(label),
    )!;

  afterEach(() => localStorage.clear());

  it('opens on the Active tab and shows the count of every tab', async () => {
    const el = await open('/my-work');

    expect(lastArgs()[ARG.view]).toBe('active');
    const tabs = Array.from(el.querySelectorAll('[role="tab"]')).map((t) =>
      t.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(tabs).toEqual([
      'Active (7)',
      'Due soon and overdue (2)',
      'Closed (5)',
      'Created by me (3)',
    ]);
    expect(tab(el, 'Active').getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('[role="tabpanel"]')!.getAttribute('aria-labelledby')).toBe(
      'mw-tab-active',
    );
  });

  describe('needs-attention strip', () => {
    const item = (el: HTMLElement, key: string) =>
      el.querySelector<HTMLButtonElement>(`[data-strip-item="${key}"]`)!;

    it('shows the four counts above the tabs, a zero muted but present', async () => {
      const el = await open('/my-work');
      const strip = el.querySelector('[data-strip]')!;
      expect(strip.textContent!.replace(/\s+/g, ' ').trim()).toBe(
        'Overdue 9 Due today 3 ASAP 14 On hold 0',
      );
      expect(strip.getAttribute('title')).toBe(
        'All your open tasks, not affected by the filters below',
      );
      expect(item(el, 'onHold').classList).toContain('zero');
      expect(
        strip.compareDocumentPosition(el.querySelector('[data-tab-row]')!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('applies its filter on Active, replaces another strip item and toggles off on a second click', async () => {
      const el = await open('/my-work?view=completed');
      item(el, 'overdue').click();
      await settle();
      expect(query()['view']).toBeUndefined();
      expect(query()['overdue']).toBe('true');
      expect(item(el, 'overdue').getAttribute('aria-pressed')).toBe('true');

      item(el, 'dueToday').click();
      await settle();
      expect(query()['overdue']).toBe('false');
      expect(query()['dueFrom']).toBe('2026-10-14');
      expect(query()['dueTo']).toBe('2026-10-14');

      item(el, 'onHold').click();
      await settle();
      expect(query()['dueFrom']).toBeUndefined();
      expect(query()['status']).toBe('ON_HOLD');

      item(el, 'onHold').click();
      await settle();
      expect(query()['status']).not.toBe('ON_HOLD');
      expect(item(el, 'onHold').getAttribute('aria-pressed')).toBe('false');

      item(el, 'asap').click();
      await settle();
      expect(query()['asap']).toBe('true');
      expect(lastArgs()[ARG.asap]).toBe(true);
    });

    it('keeps the counts when a filter is on and shows -- while they are unknown', async () => {
      const el = await open('/my-work?asap=true');
      expect(item(el, 'asap').getAttribute('aria-pressed')).toBe('true');
      expect(item(el, 'overdue').textContent).toContain('9');
      TestBed.resetTestingModule();
      const bare = await open('/my-work', { response: of(pageOf([aRow()], { counts: COUNTS })) });
      expect(item(bare, 'overdue').textContent).toContain('--');
    });
  });

  it('opens on the tab the user last used when the URL names none, and says so', async () => {
    localStorage.setItem('mf.work-view.v1.my-work.1', JSON.stringify({ view: 'dueSoon' }));
    const el = await open('/my-work');
    expect(el.querySelector('[data-restored-notice]')!.textContent).toContain(
      'Restored your last view',
    );

    expect(query()['view']).toBe('dueSoon');
    expect(getMyWork).toHaveBeenCalledTimes(1);
    expect(lastArgs()[ARG.view]).toBe('dueSoon');
  });

  it('lists my tasks with priority, workflow progress, due and status (the matter reference is in the Matter column only, #196, #198)', async () => {
    const el = await open('/my-work');
    const headers = Array.from(el.querySelectorAll('thead th')).map((h) => h.textContent?.trim());
    expect(headers).toEqual([
      'Ref',
      'Title',
      'Matter Number',
      'Matter Name',
      'Workflow progress',
      'Priority',
      'Due',
      'Status',
    ]);
    const row = el.querySelector('tbody tr')!;
    // #348: the Matter Number cell shows the reference only; the matter name is its own column.
    expect(row.querySelector('td[data-col="matter"]')!.textContent).toContain('00343-00012');
    expect(row.querySelector('td[data-col="matter"]')!.textContent).not.toContain('Merger');
    expect(row.querySelector('td[data-col="matterName"]')!.textContent).toContain('Merger');
    expect(row.textContent).toContain('2 of 6 done');
    expect(row.textContent).toContain('Dedup');
    expect(row.textContent).toContain('ASAP');
    expect(row.textContent).toContain('In Progress');
  });

  it('switches tabs through the URL and loads that view', async () => {
    const el = await open('/my-work');
    tab(el, 'Due soon and overdue').click();
    await settle();

    expect(query()['view']).toBe('dueSoon');
    expect(lastArgs()[ARG.view]).toBe('dueSoon');
    expect(tab(el, 'Due soon and overdue').getAttribute('aria-selected')).toBe('true');
    // The help is behind an info button, not an always-visible paragraph (D4).
    expect(el.querySelector('[data-help]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-tab-help] button')!.click();
    await settle();
    expect(el.querySelector('[data-tab-help-text]')!.textContent).toContain(
      'ASAP tasks have no due date',
    );
    expect(el.querySelector('[data-tab-help] button')!.getAttribute('aria-label')).toBe(
      'About this tab',
    );

    tab(el, 'Active').click();
    await settle();
    expect(query()['view']).toBeUndefined();
  });

  it('opens a tab from a link and keeps the filters when switching', async () => {
    const el = await open('/my-work?view=createdByMe&priority=1');
    expect(lastArgs()[ARG.view]).toBe('createdByMe');
    tab(el, 'Closed').click();
    await settle();
    expect(query()['view']).toBe('completed');
    expect(query()['priority']).toBe('1');
  });

  it('limits the Closed tab to the last 90 days until the user asks for older tasks (all time, not a date)', async () => {
    const el = await open('/my-work?view=completed');
    // The 90-day window is the API's default: no date and no all-time flag is sent.
    expect(lastArgs()[ARG.completedFrom]).toBeUndefined();
    expect(lastArgs()[ARG.closedWindow]).toBeUndefined();
    el.querySelector<HTMLButtonElement>('[data-tab-help] button')!.click();
    await settle();
    expect(el.querySelector('[data-tab-help-text]')!.textContent).toContain('last 90 days');

    const older = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === 'Show older',
    )!;
    older.click();
    await settle();
    expect(query()['closed']).toBe('all');
    expect(query()['completedFrom']).toBeUndefined();
    expect(lastArgs()[ARG.closedWindow]).toBe('all');
    expect(lastArgs()[ARG.completedFrom]).toBeUndefined();
    expect(chips(el)).toContain('Closed: all time');
    expect(
      Array.from(el.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Show older'),
    ).toBe(false);
    el.querySelector<HTMLButtonElement>('[data-tab-help] button')!.click();
    await settle();
    expect(el.querySelector('[data-tab-help-text]')!.textContent).toContain('all time');

    // Removing the chip returns to the 90-day window.
    const chip = el.querySelector<HTMLElement>('[data-filter-chips] [data-chip]')!;
    chip.querySelector<HTMLButtonElement>('button')!.click();
    await settle();
    expect(query()['closed']).toBeUndefined();
    expect(lastArgs()[ARG.closedWindow]).toBeUndefined();
  });

  it('reads an old Show older link (completedFrom=2000-01-01) as the date it says', async () => {
    const el = await open('/my-work?view=completed&completedFrom=2000-01-01');
    expect(lastArgs()[ARG.completedFrom]).toBe('2000-01-01');
    expect(lastArgs()[ARG.closedWindow]).toBeUndefined();
    expect(chips(el)).toEqual(['Closed: from Jan 1, 2000']);
  });

  it('opens the Closed tab for the old view=completed link and names the tabs everywhere', async () => {
    const el = await open('/my-work?view=completed');
    expect(tab(el, 'Closed').getAttribute('aria-selected')).toBe('true');
    expect(document.title).toBe('My Work: Closed - MatterFlow');
    expect(el.querySelector('caption')!.textContent!.trim()).toBe('My Work: Closed');
    expect(el.querySelector('.wl-sr')!.textContent).toContain('Closed: ');
  });

  it('words the tab tooltips and the empty states from the one vocabulary', async () => {
    const el = await open('/my-work');
    const title = (name: string) => tab(el, name).getAttribute('title');
    expect(title('Active')).toBe('Open tasks assigned to you');
    expect(title('Due soon and overdue')).toBe(
      'Overdue plus due in the next 2 days. ASAP tasks have no due date and are listed under Active',
    );
    expect(title('Closed')).toBe(
      'Completed or cancelled in the last 90 days (use Show older for more)',
    );
    expect(title('Created by me')).toBe('Tasks you created, any status or assignee');
  });

  const chips = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-filter-chips] [data-chip]')).map((c) =>
      c.querySelector('.fch__text')!.textContent!.replace(/\s+/g, ' ').trim(),
    );
  const control = (el: HTMLElement, key: string) =>
    el.querySelector<HTMLElement>(`tr[data-filter-row] [data-filter="${key}"]`)!;

  it('applies filters and removes them with their chips', async () => {
    const el = await open('/my-work?pod=5&status=ON_HOLD');
    expect(lastArgs()[ARG.pod]).toEqual([5]);
    expect(lastArgs()[ARG.status]).toEqual(['ON_HOLD']);
    // The Status column is on screen, so its filter is in the row; Pod is not, so its filter is a chip.
    expect(chips(el)).toEqual(['Pod: Pod A (hidden column)']);
    expect(control(el, 'status').textContent).toContain('On Hold');

    el.querySelector<HTMLButtonElement>('[data-chip="pod"] .fch__x')!.click();
    await settle();
    expect(query()['pod']).toBeUndefined();
    expect(query()['status']).toBe('ON_HOLD');
  });

  it('has no default status: every status of the tab until one is chosen', async () => {
    await open('/my-work');
    expect(lastArgs()[ARG.status]).toBeUndefined();
  });

  it('shows the filter row open on the first visit with one control per shown column', async () => {
    const el = await open('/my-work');
    expect(el.querySelector('tr[data-filter-row]')).not.toBeNull();
    for (const key of ['q', 'priority', 'due', 'status']) {
      expect(control(el, key), key).not.toBeNull();
    }
    // Matter is a default column again (#198): its filter is in the row.
    expect(control(el, 'matterText')).not.toBeNull();
  });

  it('shows what each tab decides itself as disabled controls with the reason, and does not send them', async () => {
    // A customised set on the tabs this test visits (the column choice is per tab).
    for (const tab of ['active', 'dueSoon', 'createdByMe']) {
      localStorage.setItem(
        `mf.work-columns.v2.myWork.${tab}.1`,
        JSON.stringify(['ref', 'title', 'priority', 'assignee', 'creator', 'due', 'status']),
      );
    }
    let el = await open('/my-work?assignee=9&creator=3');
    // Active: Assignee is "me" by definition.
    expect(control(el, 'assignee').hasAttribute('data-filter-fixed')).toBe(true);
    expect(control(el, 'assignee').textContent).toContain('Me');
    expect(
      control(el, 'assignee').closest('[data-filter-disabled]')!.getAttribute('title'),
    ).toContain('assigned to you');
    expect(control(el, 'creator').hasAttribute('disabled')).toBe(false);
    expect(lastArgs()[ARG.assignee]).toBeUndefined();
    expect(lastArgs()[ARG.creator]).toEqual([3]);

    TestBed.resetTestingModule();
    el = await open('/my-work?view=createdByMe&assignee=9');
    // Created by me: Assignee is a filter, Creator is the tab.
    expect(control(el, 'assignee').hasAttribute('disabled')).toBe(false);
    expect(lastArgs()[ARG.assignee]).toEqual([9]);
    expect(lastArgs()[ARG.creator]).toBeUndefined();

    TestBed.resetTestingModule();
    el = await open('/my-work?view=dueSoon&dueFrom=2026-10-01&asap=true');
    // The cell says what the tab decides, not a stray "until" (BUG-10), and is no input.
    expect(control(el, 'due').hasAttribute('data-filter-fixed')).toBe(true);
    expect(control(el, 'due').textContent).toContain('Next 2 days and overdue');
    expect(control(el, 'due').textContent).toContain(
      'Due: Next 2 days and overdue, set by this tab',
    );
    expect(control(el, 'due').textContent).not.toContain('until');
    expect(control(el, 'due').tagName).not.toBe('INPUT');
    expect(chips(el)).toEqual([]);
    expect(lastArgs()[ARG.dueFrom]).toBeUndefined();
    expect(lastArgs()[ARG.asap]).toBeUndefined();
  });

  it('offers In Progress and On Hold only on Active and Due soon and overdue (an assigned task is never New)', async () => {
    for (const view of ['active', 'dueSoon', 'createdByMe']) {
      TestBed.resetTestingModule();
      const el = await open(`/my-work?view=${view}`);
      control(el, 'status').click();
      harness.detectChanges();
      await settle();
      const options = Array.from(document.querySelectorAll('mf-filter-popover [data-option]')).map(
        (o) => o.getAttribute('data-option'),
      );
      expect(options).toEqual(
        view === 'createdByMe'
          ? ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED']
          : ['IN_PROGRESS', 'ON_HOLD'],
      );
      document.querySelectorAll('mf-filter-popover').forEach((n) => n.remove());
    }
  });

  it('limits the Status choices to what the tab can show', async () => {
    const el = await open('/my-work?view=completed');
    control(el, 'status').click();
    harness.detectChanges();
    await settle();
    const options = Array.from(document.querySelectorAll('mf-filter-popover [data-option]')).map(
      (o) => o.getAttribute('data-option'),
    );
    expect(options).toEqual(['COMPLETED', 'CANCELLED']);
    document.querySelectorAll('mf-filter-popover').forEach((n) => n.remove());
  });

  it('changing tab drops the filters the new tab owns and the statuses it cannot show, and keeps the rest', async () => {
    const el = await open(
      '/my-work?view=createdByMe&assignee=9&priority=1&status=IN_PROGRESS&status=COMPLETED',
    );
    tab(el, 'Active').click();
    await settle();
    expect(query()['view']).toBeUndefined();
    expect(query()['assignee']).toBeUndefined();
    expect(query()['priority']).toBe('1');
    expect(query()['status']).toBe('IN_PROGRESS');

    tab(el, 'Due soon and overdue').click();
    await settle();
    expect(query()['status']).toBe('IN_PROGRESS');

    tab(el, 'Closed').click();
    await settle();
    // IN_PROGRESS cannot be on the Closed tab; an explicit empty status is not written when none is left.
    expect(query()['status']).toBeUndefined();
    expect(query()['priority']).toBe('1');
  });

  it('puts the tabs on their own row and the sort note, Columns and Filters in one bar above the grid', async () => {
    const el = await open('/my-work');
    await vi.waitFor(() => {
      harness.detectChanges();
      expect(el.querySelector('[data-grid-toolbar] [data-sort-note]')).not.toBeNull();
    });
    const tabRow = el.querySelector('[data-tab-row]')!;
    expect(tabRow.querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabRow.querySelector('[data-filters-toggle]')).toBeNull();
    // The bar is inside the tab panel: sort note, Columns and the Filters button together, directly above the grid.
    const bar = el.querySelector('[role="tabpanel"] [data-grid-toolbar]')!;
    expect(bar.querySelector('[data-sort-note]')!.textContent).toContain('Sorted by Priority');
    expect(bar.querySelector('.cc-button')).not.toBeNull();
    expect(bar.querySelector('[data-filters-toggle]')).not.toBeNull();
    expect(
      bar.compareDocumentPosition(el.querySelector('mf-work-list')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(el.querySelector('#fb-q')).toBeNull();
  });

  it('marks tasks assigned since the visit began as New and keeps them for the whole visit', async () => {
    const rows = [
      aRow({ taskId: 1, taskNumber: 'TSK-1', createdAtUtc: '2026-10-14T12:00:00Z' }),
      aRow({ taskId: 2, taskNumber: 'TSK-2', createdAtUtc: '2026-10-01T12:00:00Z' }),
    ];
    const response = () => of(pageOf(rows, { counts: COUNTS }));
    // First ever use: nothing is marked.
    let el = await open('/my-work', { rows, response: response() });
    expect(el.querySelectorAll('[data-new-dot]').length).toBe(0);
    const key = Object.keys(localStorage).find((k) => k.startsWith('mf.my-work.visit.v2'))!;
    const stored = () => JSON.parse(localStorage.getItem(key)!);
    expect(stored()).toEqual({
      lastActiveAt: new Date('2026-10-14T15:00:00Z').getTime(),
      visitSince: null,
    });

    // A visit that began on Oct 10: the task assigned after it is New, the older one is not.
    TestBed.resetTestingModule();
    const since = new Date('2026-10-10T00:00:00Z').getTime();
    localStorage.setItem(
      key,
      JSON.stringify({
        lastActiveAt: new Date('2026-10-14T14:50:00Z').getTime(),
        visitSince: since,
      }),
    );
    el = await open('/my-work', { rows, response: response() });
    expect(el.querySelectorAll('[data-new-dot]').length).toBe(1);
    expect(el.querySelector('[data-new-dot]')!.closest('tr')!.getAttribute('data-task')).toBe(
      'TSK-1',
    );

    // Opening a task and pressing Back (a new page instance in the same visit): the same marker, the visit did not move.
    TestBed.resetTestingModule();
    el = await open('/my-work', { rows, response: response() });
    expect(el.querySelectorAll('[data-new-dot]').length).toBe(1);
    expect(stored().visitSince).toBe(since);

    // More than 30 minutes later a new visit begins at the last activity: the markers are gone.
    TestBed.resetTestingModule();
    localStorage.setItem(
      key,
      JSON.stringify({
        lastActiveAt: new Date('2026-10-14T14:00:00Z').getTime(),
        visitSince: since,
      }),
    );
    el = await open('/my-work', { rows, response: response() });
    expect(el.querySelectorAll('[data-new-dot]').length).toBe(0);
    expect(stored().visitSince).toBe(new Date('2026-10-14T14:00:00Z').getTime());
  });

  describe('New (A5)', () => {
    const SINCE = new Date('2026-10-10T00:00:00Z').getTime();
    const newRows = () => [
      aRow({ taskId: 1, taskNumber: 'TSK-1', createdAtUtc: '2026-10-12T12:00:00Z' }),
      aRow({ taskId: 2, taskNumber: 'TSK-2', createdAtUtc: '2026-10-01T12:00:00Z' }),
    ];
    const withVisit = (visitSince: number | null) =>
      localStorage.setItem(
        'mf.my-work.visit.v2.1',
        JSON.stringify({ lastActiveAt: new Date('2026-10-14T14:50:00Z').getTime(), visitSince }),
      );
    const item = (el: HTMLElement) =>
      el.querySelector<HTMLButtonElement>('[data-strip-item="new"]');

    it('is hidden on the first visit and sends no instant', async () => {
      const el = await open('/my-work');
      expect(item(el)).toBeNull();
      expect(lastArgs()[ARG.newSince]).toBeUndefined();
      expect(lastArgs()[ARG.assignedFrom]).toBeUndefined();
      expect(el.querySelectorAll('[data-new-dot]').length).toBe(0);
    });

    it('shows the count after On hold and sends the visit start with every request', async () => {
      withVisit(SINCE);
      const el = await open('/my-work', {
        response: of(
          pageOf(newRows(), {
            counts: COUNTS,
            attention: { ...ATTENTION, new: 1 },
          }),
        ),
      });
      expect(el.querySelector('[data-strip]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
        'Overdue 9 Due today 3 ASAP 14 On hold 0 New 1',
      );
      expect(lastArgs()[ARG.newSince]).toBe(new Date(SINCE).toISOString());
      expect(lastArgs()[ARG.assignedFrom]).toBeUndefined();
      // The dot sits in the Ref cell of the row.
      expect(el.querySelectorAll('[data-new-dot]').length).toBe(1);
      const dot = el.querySelector('[data-new-dot]')!;
      expect(dot.getAttribute('aria-label')).toBe('New');
      expect(dot.closest('tr')!.getAttribute('data-task')).toBe('TSK-1');
      expect(dot.closest('td')!.getAttribute('data-col')).toBe('ref');
    });

    it('applies the filter as new=1 with the instant in assignedFrom, shows the chip and toggles off', async () => {
      withVisit(SINCE);
      const el = await open('/my-work?view=completed', {
        response: of(pageOf(newRows(), { counts: COUNTS, attention: { ...ATTENTION, new: 1 } })),
      });
      item(el)!.click();
      await settle();
      expect(query()['new']).toBe('1');
      expect(query()['view']).toBeUndefined();
      expect(JSON.stringify(query())).not.toContain('2026-10-10');
      expect(lastArgs()[ARG.assignedFrom]).toBe(new Date(SINCE).toISOString());
      expect(item(el)!.getAttribute('aria-pressed')).toBe('true');
      expect(el.querySelector('[data-chip]')?.textContent).toContain('New since your last visit');

      // Another strip item replaces it; the same item again switches it off.
      el.querySelector<HTMLButtonElement>('[data-strip-item="asap"]')!.click();
      await settle();
      expect(query()['new']).toBeUndefined();
      item(el)!.click();
      await settle();
      item(el)!.click();
      await settle();
      expect(query()['new']).toBeUndefined();
      expect(lastArgs()[ARG.assignedFrom]).toBeUndefined();
    });

    it('lists nothing for a shared new=1 link when the opener has no visit on record', async () => {
      const el = await open('/my-work?new=1');
      expect(item(el)).toBeNull();
      expect(lastArgs()[ARG.assignedFrom]).toBe('2026-10-14T15:00:00.000Z');
    });
  });

  it('restores Due soon and names the view and the filters in the notice', async () => {
    localStorage.setItem(
      'mf.work-view.v1.my-work.1',
      JSON.stringify({ view: 'dueSoon', priority: ['1', '2'] }),
    );
    const el = await open('/my-work');
    expect(query()['view']).toBe('dueSoon');
    expect(el.querySelector('[data-restored-text]')!.textContent).toMatch(
      /^Restored your last view: Due soon and overdue, Priority /,
    );
  });

  it.each(['completed', 'createdByMe'])(
    'does not restore the %s tab: a plain visit opens Active',
    async (view) => {
      localStorage.setItem('mf.work-view.v1.my-work.1', JSON.stringify({ view, sort: 'due' }));
      const el = await open('/my-work');
      expect(query()).toEqual({});
      expect(lastArgs()[ARG.view]).toBe('active');
      expect(el.querySelector('[data-restored-notice]')).toBeNull();
    },
  );

  it('Reset to default goes to the plain list, forgets the view and keeps the column preferences', async () => {
    localStorage.setItem('mf.work-view.v1.my-work.1', JSON.stringify({ view: 'dueSoon' }));
    localStorage.setItem(
      'mf.work-table.v3.my-work.1',
      JSON.stringify({ columns: ['ref', 'title'], density: 'compact' }),
    );
    const el = await open('/my-work');
    expect(query()['view']).toBe('dueSoon');
    el.querySelector<HTMLButtonElement>('[data-restored-notice] button')!.click();
    await settle();
    expect(query()).toEqual({});
    expect(lastArgs()[ARG.view]).toBe('active');
    expect(el.querySelector('[data-restored-notice]')).toBeNull();
    expect(el.querySelector('[data-sort-note]')).not.toBeNull();
    expect(document.activeElement?.hasAttribute('data-page-title')).toBe(true);
    expect(localStorage.getItem('mf.work-table.v3.my-work.1')).toContain('compact');

    // The next plain visit starts on Active with no notice.
    TestBed.resetTestingModule();
    const again = await open('/my-work');
    expect(query()).toEqual({});
    expect(again.querySelector('[data-restored-notice]')).toBeNull();
  });

  it('Dismiss only hides the notice: the view stays and is restored again', async () => {
    localStorage.setItem('mf.work-view.v1.my-work.1', JSON.stringify({ view: 'dueSoon' }));
    const el = await open('/my-work');
    el.querySelector<HTMLButtonElement>('[data-restored-notice] button[aria-label]')!.click();
    await settle();
    expect(el.querySelector('[data-restored-notice]')).toBeNull();
    expect(query()['view']).toBe('dueSoon');
    TestBed.resetTestingModule();
    await open('/my-work');
    expect(query()['view']).toBe('dueSoon');
  });

  describe('landing tab', () => {
    const counts = (c: Partial<typeof COUNTS>) => ({ ...COUNTS, ...c });
    it('picks Active, then Created by me, then Closed; Due soon never leads', () => {
      expect(firstNonEmptyTab(counts({}))).toBe('active');
      expect(firstNonEmptyTab(counts({ active: 0, createdByMe: 4 }))).toBe('createdByMe');
      expect(firstNonEmptyTab(counts({ active: 0, createdByMe: 0 }))).toBe('completed');
      expect(firstNonEmptyTab(counts({ active: 0, createdByMe: 0, completed: 0 }))).toBe('active');
      expect(
        firstNonEmptyTab(counts({ active: 0, dueSoon: 3, createdByMe: 0, completed: 0 })),
      ).toBe('active');
    });

    it('opens Created by me once, with a notice, when Active is empty (replace, not push)', async () => {
      const empty = of(pageOf([], { counts: counts({ active: 0 }) }));
      const el = await open('/my-work', { response: empty });
      expect(query()['view']).toBe('createdByMe');
      expect(lastArgs()[ARG.view]).toBe('createdByMe');
      expect(getMyWork).toHaveBeenCalledTimes(2);
      expect(el.querySelector('[data-restored-text]')!.textContent).toContain(
        'Nothing is assigned to you, so this opens Created by me.',
      );
      expect(el.querySelector('[data-restored-notice] button[aria-label]')).not.toBeNull();
      expect(el.querySelectorAll('[data-restored-notice] button').length).toBe(1);
      // Not stored as the last view, so it does not trap the person.
      expect(localStorage.getItem('mf.work-view.v1.my-work.1')).not.toContain('createdByMe');
      // Switching back to Active does not bounce again.
      tab(el, 'Active').click();
      await settle();
      expect(query()['view']).toBeUndefined();
      expect(getMyWork).toHaveBeenCalledTimes(3);
    });

    it('does not redirect a deep link or when every tab is empty', async () => {
      await open('/my-work?view=dueSoon', {
        response: of(pageOf([], { counts: counts({ active: 0 }) })),
      });
      expect(query()['view']).toBe('dueSoon');
      expect(getMyWork).toHaveBeenCalledTimes(1);
      TestBed.resetTestingModule();
      localStorage.clear();
      await open('/my-work', {
        response: of(
          pageOf([], { counts: { active: 0, dueSoon: 0, completed: 0, createdByMe: 0 } }),
        ),
      });
      expect(query()['view']).toBeUndefined();
      expect(getMyWork).toHaveBeenCalledTimes(1);
    });
  });

  describe('rows of another tab', () => {
    it('are cleared at once when the tab changes and the request fails; the counts stay', async () => {
      const el = await open('/my-work?view=dueSoon');
      expect(el.querySelectorAll('tr[data-task]').length).toBe(1);
      getMyWork.mockReturnValue(throwError(() => new Error('offline')));
      tab(el, 'Closed').click();
      await settle();
      expect(el.querySelectorAll('tr[data-task]').length).toBe(0);
      expect(el.querySelector('tbody [data-error], tbody [role="alert"]')).not.toBeNull();
      expect(el.querySelector('.wl-alert')).toBeNull();
      expect(tab(el, 'Active').textContent).toContain('(7)');
    });

    it('stay, dimmed, when only a filter changes, and a late response of an abandoned tab is ignored', async () => {
      const el = await open('/my-work');
      const pending: ((v: unknown) => void)[] = [];
      getMyWork.mockImplementation(
        () =>
          new Observable((sub) => {
            pending.push((v) => (sub.next(v), sub.complete()));
          }),
      );
      await router().navigate([], { queryParams: { q: 'x' }, queryParamsHandling: 'merge' });
      await settle();
      expect(el.querySelectorAll('tr[data-task]').length).toBe(1);

      tab(el, 'Due soon and overdue').click();
      await settle();
      expect(el.querySelectorAll('tr[data-task]').length).toBe(0);
      tab(el, 'Closed').click();
      await settle();
      const [, dueSoon, completed] = pending;
      completed(pageOf([aRow({ taskId: 9, taskNumber: 'TSK-C' })], { counts: COUNTS }));
      dueSoon(pageOf([aRow({ taskId: 8, taskNumber: 'TSK-D' })], { counts: COUNTS }));
      await settle();
      const shown = Array.from(el.querySelectorAll('tr[data-task]')).map((r) =>
        r.getAttribute('data-task'),
      );
      expect(shown).toEqual(['TSK-C']);
    });
  });

  it('closes a short list with a friendly line that links to Pod Work and the Task Queue', async () => {
    const el = await open('/my-work');
    const line = el.querySelector('[data-near-empty]')!;
    expect(line.textContent).toContain("That's everything on your plate.");
    // Inside the grid area, not in the footer row with the pager, and not a table row.
    expect(line.getAttribute('role')).toBe('note');
    expect(line.closest('table')).toBeNull();
    expect(line.closest('.wt-wrap')).not.toBeNull();
    const hrefs = Array.from(line.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/pods/work', '/tasks']);
  });

  it('says what an empty tab means and points to Pod Work from Active', async () => {
    let el = await open('/my-work', {
      rows: [],
      response: of(pageOf([], { counts: { active: 0, dueSoon: 0, completed: 0, createdByMe: 0 } })),
    });
    const empty = el.querySelector('tbody [data-empty]')!;
    expect(empty.textContent?.replace(/\s+/g, ' ')).toContain(
      'Nothing is assigned to you right now. Check Pod Work for unassigned tasks.',
    );
    expect(empty.querySelector('a')!.getAttribute('href')).toBe('/pods/work');

    TestBed.resetTestingModule();
    el = await open('/my-work', {
      permissions: ['Task.View'],
      response: of(pageOf([], { counts: COUNTS })),
    });
    expect(el.querySelector('tbody [data-empty] a')).toBeNull();
    expect(el.querySelector('tbody [data-empty]')!.textContent).not.toContain('Pod Work');
  });

  it('offers Create task on an empty Created by me only with Task.Create', async () => {
    const empty = { response: of(pageOf([], { counts: COUNTS })) };
    let el = await open('/my-work?view=createdByMe', {
      ...empty,
      permissions: ['Task.View', 'Task.Create'],
    });
    const link = el.querySelector<HTMLAnchorElement>('tbody [data-empty] a');
    expect(el.querySelector('tbody [data-empty]')!.textContent).toContain(
      'You have no open tasks you created.',
    );
    expect(link?.textContent).toContain('Create task');
    expect(link?.getAttribute('href')).toBe('/tasks/new');

    TestBed.resetTestingModule();
    el = await open('/my-work?view=createdByMe', {
      ...empty,
      permissions: ['Task.View'],
    });
    expect(el.querySelector('tbody [data-empty] a')).toBeNull();
  });

  describe('Created by me starts on Open (B2)', () => {
    const empty = { response: of(pageOf([], { counts: COUNTS })) };

    it('says Open without a chip, sends no status, and offers "Show closed tasks" when nothing is open', async () => {
      const el = await open('/my-work?view=createdByMe', empty);
      expect(lastArgs()[ARG.status]).toBeUndefined();
      expect(el.querySelector('tbody [data-empty]')!.textContent).toContain(
        'You have no open tasks you created.',
      );
      expect(el.querySelector('[data-chip]')).toBeNull();
      el.querySelector<HTMLElement>('[data-show-closed]')!.click();
      await settle();
      expect(query()['status']).toBe('');
      // "All" is written out for the API: every status, so the counts and rows include closed work.
      expect(lastArgs()[ARG.status]).toEqual([
        'NEW',
        'IN_PROGRESS',
        'ON_HOLD',
        'COMPLETED',
        'CANCELLED',
      ]);
      expect(el.querySelector('[data-show-closed]')).toBeNull();
      // "All" is a chosen filter with a chip: the filtered empty state applies (B4).
      expect(el.querySelector('tbody [data-empty]')!.textContent).toContain(
        'No tasks match these filters',
      );
    });

    it('sends the status of a link with other filters and none for it as every status', async () => {
      await open('/my-work?view=createdByMe&q=nda', empty);
      expect(lastArgs()[ARG.status]).toBeUndefined();
      expect(lastArgs()[ARG.q]).toBe('nda');
    });

    it('keeps the default off the other tabs and sends a plain Active request bare', async () => {
      const el = await open('/my-work', empty);
      expect(lastArgs()[ARG.status]).toBeUndefined();
      expect(el.querySelector('[data-show-closed]')).toBeNull();
    });
  });

  it('keeps a status the tab cannot show as a removable chip that reads "New"', async () => {
    localStorage.setItem(
      'mf.work-table.v3.my-work.1',
      JSON.stringify({ columns: ['ref', 'title', 'priority', 'due'], density: 'comfortable' }),
    );
    const el = await open('/my-work?status=NEW', {
      response: of(pageOf([], { counts: COUNTS })),
    });
    expect(chips(el)).toEqual(['Status: New (hidden column)']);
    expect(lastArgs()[ARG.status]).toEqual(['NEW']);
  });

  it('shows the filtered empty state and an error with Retry', async () => {
    let el = await open('/my-work?q=zzz', { response: of(pageOf([], { counts: COUNTS })) });
    expect(el.querySelector('tbody [data-empty]')!.textContent).toContain(
      'No tasks match these filters',
    );
    expect(el.querySelector('tr[data-filter-row]')).not.toBeNull();

    TestBed.resetTestingModule();
    el = await open('/my-work', { response: throwError(() => new Error('boom')) });
    expect(el.querySelector('tbody [data-error]')!.textContent).toContain("Couldn't load tasks");
    expect(el.querySelector('tr[data-filter-row]')).not.toBeNull();
    getMyWork.mockReturnValue(of(pageOf([aRow()], { counts: COUNTS })));
    Array.from(el.querySelectorAll<HTMLButtonElement>('tbody button'))
      .find((b) => b.textContent?.trim() === 'Retry')!
      .click();
    await settle();
    expect(el.querySelector('[data-error]')).toBeNull();
  });

  it('sorts and pages through the URL', async () => {
    const el = await open('/my-work');
    el.querySelector<HTMLElement>('th[data-col="priority"] button')!.click();
    await settle();
    expect(lastArgs()[ARG.sort]).toBe('priority');
    expect(query()['sort']).toBe('priority');
  });

  describe('a row that leaves the tab (BUG-9)', () => {
    const rowsOf = () => [
      aRow({ taskId: 1, taskNumber: 'TSK-1' }),
      aRow({ taskId: 2, taskNumber: 'TSK-2' }),
    ];
    const emit = (row: ReturnType<typeof aRow>) =>
      harness.fixture.debugElement
        .query(By.directive(WorkList))
        .componentInstance.rowChange.emit(row);
    const rowCount = (el: HTMLElement) => el.querySelectorAll('tbody tr[data-task]').length;

    afterEach(() => vi.useRealTimers());

    it('updates the tab counts at once, keeps the row 4 seconds, then removes it and the pager follows', async () => {
      const el = await open('/my-work', { rows: rowsOf() });
      getMyWork.mockReturnValue(
        of(pageOf(rowsOf(), { view: 'active', counts: { ...COUNTS, active: 6, completed: 6 } })),
      );
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      emit(aRow({ taskId: 1, taskNumber: 'TSK-1', status: 'CANCELLED', statusLabel: 'Cancelled' }));
      await vi.advanceTimersByTimeAsync(10);
      harness.detectChanges();
      expect(tab(el, 'Active').textContent).toContain('(6)');
      expect(tab(el, 'Closed').textContent).toContain('(6)');
      expect(rowCount(el)).toBe(2);
      expect(el.querySelector('tr[data-task="TSK-1"]')!.getAttribute('data-leaving')).toBe('true');

      await vi.advanceTimersByTimeAsync(4000);
      harness.detectChanges();
      expect(rowCount(el)).toBe(1);
      expect(el.querySelector('tr[data-task="TSK-1"]')).toBeNull();
      expect(el.querySelector('[data-range]')!.textContent).toContain('of 1');
      expect(el.querySelector('[role="status"]')!.textContent).toBeDefined();
    });

    it('a change that keeps the row in the tab (priority, Hold) does not remove it', async () => {
      const el = await open('/my-work', { rows: rowsOf() });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      emit(aRow({ taskId: 1, taskNumber: 'TSK-1', status: 'ON_HOLD', statusLabel: 'On Hold' }));
      await vi.advanceTimersByTimeAsync(6000);
      harness.detectChanges();
      expect(rowCount(el)).toBe(2);
    });

    it('a change that is put back (the save failed) keeps the row', async () => {
      const el = await open('/my-work', { rows: rowsOf() });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      emit(aRow({ taskId: 1, taskNumber: 'TSK-1', status: 'CANCELLED', statusLabel: 'Cancelled' }));
      emit(aRow({ taskId: 1, taskNumber: 'TSK-1' }));
      await vi.advanceTimersByTimeAsync(6000);
      harness.detectChanges();
      expect(rowCount(el)).toBe(2);
      expect(el.querySelector('tr[data-task="TSK-1"]')!.getAttribute('data-leaving')).toBeNull();
    });

    it('on Closed a reopened task leaves; on Created by me it leaves only when its status is no longer chosen', async () => {
      let el = await open('/my-work?view=completed', {
        rows: [aRow({ taskId: 1, taskNumber: 'TSK-1', status: 'COMPLETED' })],
      });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      emit(aRow({ taskId: 1, taskNumber: 'TSK-1', status: 'IN_PROGRESS' }));
      await vi.advanceTimersByTimeAsync(4100);
      harness.detectChanges();
      expect(rowCount(el)).toBe(0);
      vi.useRealTimers();
      TestBed.resetTestingModule();

      // With every status chosen nothing leaves; on the Open default a closed task does.
      el = await open('/my-work?view=createdByMe&status=', { rows: rowsOf() });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      emit(aRow({ taskId: 1, taskNumber: 'TSK-1', status: 'CANCELLED' }));
      await vi.advanceTimersByTimeAsync(6000);
      harness.detectChanges();
      expect(rowCount(el)).toBe(2);
      vi.useRealTimers();
      TestBed.resetTestingModule();

      el = await open('/my-work?view=createdByMe', { rows: rowsOf() });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      emit(aRow({ taskId: 1, taskNumber: 'TSK-1', status: 'CANCELLED' }));
      await vi.advanceTimersByTimeAsync(6000);
      harness.detectChanges();
      expect(rowCount(el)).toBe(1);
    });
  });

  it('shows the Closed column on the Closed tab, sorted newest first, and a header click flips it (C1)', async () => {
    const el = await open('/my-work?view=completed');
    const header = () => el.querySelector('th[data-col="closed"]')!;
    expect(header().getAttribute('aria-sort')).toBe('descending');
    // The API default applies (no sort sent) while the header shows it.
    expect(lastArgs()[ARG.sort]).toBeUndefined();
    el.querySelector<HTMLElement>('th[data-col="closed"] button')!.click();
    await settle();
    expect(query()['sort']).toBe('closed');
    expect(query()['dir']).toBe('asc');
    expect(lastArgs()[ARG.sort]).toBe('closed');
    expect(header().getAttribute('aria-sort')).toBe('ascending');
    el.querySelector<HTMLElement>('th[data-col="closed"] button')!.click();
    await settle();
    expect(query()['dir']).toBe('desc');
  });

  it('keeps a separate column choice per tab and resets only the current tab (X1)', async () => {
    const el = await open('/my-work');
    expect(el.querySelector('th[data-col="closed"]')).toBeNull();
    const choose = async (label: string) => {
      el.querySelector<HTMLElement>('.cc-button')!.click();
      await settle();
      const box = Array.from(el.querySelectorAll<HTMLInputElement>('.cc-check input')).find((i) =>
        i.closest('label')!.textContent!.includes(label),
      )!;
      box.click();
      await settle();
    };
    await choose('Workflow progress');
    el.querySelector<HTMLElement>('.cc-button')!.click(); // close the panel
    await settle();
    expect(el.querySelector('th[data-col="progress"]')).toBeNull();

    // Closed has its own set (Workflow progress is not in it).
    tab(el, 'Closed').click();
    await settle();
    expect(el.querySelector('th[data-col="progress"]')).toBeNull();
    expect(el.querySelector('th[data-col="closed"]')).not.toBeNull();

    // Back on Active the choice is kept; "Reset columns" brings the default back.
    tab(el, 'Active').click();
    await settle();
    expect(el.querySelector('th[data-col="progress"]')).toBeNull();
    el.querySelector<HTMLElement>('.cc-button')!.click();
    await settle();
    el.querySelector<HTMLElement>('[data-columns-reset]')!.click();
    await settle();
    expect(el.querySelector('th[data-col="progress"]')).not.toBeNull();
    expect(el.querySelector('.cc [role="status"]')!.textContent).toContain(
      'Columns reset to the default set.',
    );
  });

  describe('Group by: Due (M12.1)', () => {
    const BUCKETS = { asap: 2, overdue: 3, today: 1, tomorrow: 0, thisWeek: 0, later: 1 };
    const grouped = (rows = 7, extra: Record<string, unknown> = {}) =>
      of(
        pageOf(
          Array.from({ length: rows }, (_, n) =>
            aRow({ taskId: 100 + n, taskNumber: `TSK-${100 + n}`, title: `Task ${n}` }),
          ),
          {
            view: 'active',
            counts: COUNTS,
            attention: ATTENTION,
            bucketCounts: BUCKETS,
            total: 7,
            ...extra,
          },
        ),
      );
    const headers = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('tr.wt-group th')).map((h) =>
        h.textContent?.replace(/\s+/g, ' ').trim(),
      );

    it('is off by default and offers the control on Active only', async () => {
      const el = await open('/my-work');
      expect(lastArgs()[ARG.group]).toBeUndefined();
      expect(el.querySelector('tr.wt-group')).toBeNull();
      el.querySelector<HTMLElement>('.cc-button')!.click();
      await settle();
      expect(el.querySelector('[data-group-set]')).not.toBeNull();

      tab(el, 'Closed').click();
      await settle();
      expect(el.querySelector('[data-group-set]')).toBeNull();
    });

    it('sends group=due from the address and shows a header per bucket with the whole count', async () => {
      const el = await open('/my-work?group=due', { response: grouped() });
      expect(lastArgs()[ARG.group]).toBe('due');
      expect(headers(el)).toEqual([
        'ASAP (2 tasks)',
        'Overdue (3 tasks)',
        'Today (1 task)',
        'Later (1 task)',
      ]);
      expect(el.querySelector('[data-grouped-note]')!.textContent).toContain('Grouped by due');
      const th = el.querySelector('tr.wt-group th')!;
      expect(th.getAttribute('scope')).toBe('colgroup');
      expect(th.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
    });

    it('continues a bucket at the top of the next page', async () => {
      const el = await open('/my-work?group=due&page=3&pageSize=2', {
        response: grouped(2, { page: 3, pageSize: 2, total: 7 }),
      });
      // Global rows 4 and 5: the last Overdue row (the bucket began at row 2), then the one Today row.
      expect(headers(el)).toEqual(['Overdue (3 tasks), continued', 'Today (1 task)']);
    });

    it('collapses and expands a group with the button', async () => {
      const el = await open('/my-work?group=due', { response: grouped() });
      const rowsOf = () => Array.from(el.querySelectorAll<HTMLElement>('tbody tr[data-task]'));
      expect(rowsOf().filter((r) => !r.hidden)).toHaveLength(7);
      const asap = el.querySelector<HTMLButtonElement>('tr.wt-group[data-group="asap"] button')!;
      asap.click();
      await settle();
      expect(asap.getAttribute('aria-expanded')).toBe('false');
      expect(rowsOf().filter((r) => !r.hidden)).toHaveLength(5);
      asap.click();
      await settle();
      expect(rowsOf().filter((r) => !r.hidden)).toHaveLength(7);
    });

    it('is chosen in the Columns panel, goes to the address, is remembered and starts the next plain visit', async () => {
      let el = await open('/my-work');
      el.querySelector<HTMLElement>('.cc-button')!.click();
      await settle();
      el.querySelector<HTMLInputElement>('[data-group-due]')!.click();
      await settle();
      expect(query()['group']).toBe('due');
      expect(lastArgs()[ARG.group]).toBe('due');
      expect(localStorage.getItem('mf.work-group.v1.my-work.1')).toBe('due');
      TestBed.resetTestingModule();

      el = await open('/my-work');
      expect(query()['group']).toBe('due');
      expect(lastArgs()[ARG.group]).toBe('due');
    });

    it('is turned off, and forgotten, by a header sort', async () => {
      const el = await open('/my-work?group=due', { response: grouped() });
      localStorage.setItem('mf.work-group.v1.my-work.1', 'due');
      el.querySelector<HTMLButtonElement>('th[data-col="due"] button')!.click();
      await settle();
      expect(query()['group']).toBeUndefined();
      expect(query()['sort']).toBe('due');
      expect(localStorage.getItem('mf.work-group.v1.my-work.1')).toBeNull();
      expect(lastArgs()[ARG.group]).toBeUndefined();
    });

    it('ignores group on the other tabs', async () => {
      await open('/my-work?view=dueSoon&group=due');
      expect(lastArgs()[ARG.group]).toBeUndefined();
    });
  });
});
