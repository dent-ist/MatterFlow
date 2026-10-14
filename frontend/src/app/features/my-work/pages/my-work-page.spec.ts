import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { MyWorkClient, PodsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import {
  aRow,
  pageOf,
  provideClock,
  provideLookups,
} from '../../../shared/work-queue/work-queue-testing';
import { MyWorkPage } from './my-work-page';

/** Positions of the arguments of `getMyWork` (the view comes first, then the shared filters). */
const ARG = { view: 0, q: 1, status: 2, pod: 4, completedFrom: 20, sort: 22, page: 24 };

const COUNTS = { active: 7, dueSoon: 2, completed: 5, createdByMe: 3 };

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
      .mockReturnValue(options.response ?? of(pageOf(rows, { view: 'active', counts: COUNTS })));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'my-work', component: MyWorkPage }]),
        provideFakeMe(
          new FakeMeApi(withPermissions(...(options.permissions ?? ['Task.View', 'Pod.View']))),
        ),
        ...provideLookups(),
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
    expect(tabs).toEqual(['Active (7)', 'Due Soon (2)', 'Completed (5)', 'Created by Me (3)']);
    expect(tab(el, 'Active').getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('[role="tabpanel"]')!.getAttribute('aria-labelledby')).toBe(
      'mw-tab-active',
    );
  });

  it('lists my tasks with priority, matter, workflow progress, due and status', async () => {
    const el = await open('/my-work');
    const headers = Array.from(el.querySelectorAll('thead th')).map((h) => h.textContent?.trim());
    expect(headers).toEqual(
      expect.arrayContaining([
        'Ref',
        'Title',
        'Matter',
        'Priority',
        'Workflow progress',
        'Due',
        'Status',
      ]),
    );
    const row = el.querySelector('tbody tr')!;
    expect(row.textContent).toContain('00343-00012');
    expect(row.textContent).toContain('Step 3/6: Dedup');
    expect(row.textContent).toContain('ASAP');
    expect(row.textContent).toContain('In Progress');
  });

  it('switches tabs through the URL and loads that view', async () => {
    const el = await open('/my-work');
    tab(el, 'Due Soon').click();
    await settle();

    expect(query()['view']).toBe('dueSoon');
    expect(lastArgs()[ARG.view]).toBe('dueSoon');
    expect(tab(el, 'Due Soon').getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('[data-help]')!.textContent).toContain('ASAP');

    tab(el, 'Active').click();
    await settle();
    expect(query()['view']).toBeUndefined();
  });

  it('opens a tab from a link and keeps the filters when switching', async () => {
    const el = await open('/my-work?view=createdByMe&priority=1');
    expect(lastArgs()[ARG.view]).toBe('createdByMe');
    tab(el, 'Completed').click();
    await settle();
    expect(query()['view']).toBe('completed');
    expect(query()['priority']).toBe('1');
  });

  it('limits the Completed tab to the last 90 days until the user asks for older tasks', async () => {
    const el = await open('/my-work?view=completed');
    expect(lastArgs()[ARG.completedFrom]).toBe('2026-07-16');
    expect(el.querySelector('[data-help]')!.textContent).toContain('last 90 days');

    el.querySelector<HTMLButtonElement>('[data-help] button')!.click();
    await settle();
    expect(query()['completedFrom']).toBe('2000-01-01');
    expect(lastArgs()[ARG.completedFrom]).toBe('2000-01-01');
    expect(el.querySelector('[data-help]')!.textContent).not.toContain('last 90 days');
  });

  it('applies filters and removes them with their chips', async () => {
    const el = await open('/my-work?pod=5&status=ON_HOLD');
    expect(lastArgs()[ARG.pod]).toEqual([5]);
    expect(lastArgs()[ARG.status]).toEqual(['ON_HOLD']);
    const chips = Array.from(el.querySelectorAll('.fb-chip')).map((c) => c.textContent?.trim());
    expect(chips).toEqual(['Status: On Hold', 'Pod: Pod A']);

    el.querySelector<HTMLButtonElement>('.fb-chip-x')!.click();
    await settle();
    expect(query()['status']).toBeUndefined();
    expect(query()['pod']).toBe('5');
  });

  it('keeps the Pod filter and the status filter but never offers an assignee filter', async () => {
    const el = await open('/my-work');
    el.querySelector<HTMLButtonElement>('.fb-button')!.click();
    harness.detectChanges();
    expect(el.querySelector('#fb-pod')).not.toBeNull();
    expect(el.querySelector('#fb-assignee')).toBeNull();
  });

  it('says what an empty tab means and points to Pod Work from Active', async () => {
    let el = await open('/my-work', {
      rows: [],
      response: of(pageOf([], { counts: { active: 0, dueSoon: 0, completed: 0, createdByMe: 0 } })),
    });
    const empty = el.querySelector('[data-empty]')!;
    expect(empty.textContent).toContain(
      'Nothing assigned to you right now. Check Pod Work for unassigned tasks.',
    );
    expect(empty.querySelector('a')!.getAttribute('href')).toBe('/pods/work');

    TestBed.resetTestingModule();
    el = await open('/my-work', {
      permissions: ['Task.View'],
      response: of(pageOf([], { counts: COUNTS })),
    });
    expect(el.querySelector('[data-empty] a')).toBeNull();
  });

  it('shows the filtered empty state and an error with Retry', async () => {
    let el = await open('/my-work?q=zzz', { response: of(pageOf([], { counts: COUNTS })) });
    expect(el.querySelector('[data-empty]')!.textContent).toContain(
      'No tasks match these filters.',
    );

    TestBed.resetTestingModule();
    el = await open('/my-work', { response: throwError(() => new Error('boom')) });
    expect(el.querySelector('[role="alert"]')!.textContent).toContain(
      'Something went wrong. Try again.',
    );
    getMyWork.mockReturnValue(of(pageOf([aRow()], { counts: COUNTS })));
    el.querySelector<HTMLButtonElement>('.wl-retry')!.click();
    await settle();
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('sorts and pages through the URL', async () => {
    const el = await open('/my-work');
    el.querySelector<HTMLElement>('th[data-col="priority"] button')!.click();
    await settle();
    expect(lastArgs()[ARG.sort]).toBe('priority');
    expect(query()['sort']).toBe('priority');
  });
});
