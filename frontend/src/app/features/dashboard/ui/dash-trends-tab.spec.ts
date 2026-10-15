import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, of, throwError } from 'rxjs';
import { DashboardClient, DashboardTrend } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { PeriodKey } from '../dashboard-period';
import { DashTrendsTab } from './dash-trends-tab';
import { aTrend, manyTypes } from './trend-testing';

@Component({
  imports: [DashTrendsTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-dash-trends-tab
    [period]="period()"
    caption="Last 30 days"
    [refreshKey]="key()"
  />`,
})
class Host {
  period = signal<PeriodKey>('30d');
  key = signal('k1');
}

const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
const STORE_KEY = (id: number) => `mf.dashboard.trends.v1.${id}`;

describe('DashTrendsTab', () => {
  let getTrend: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;
  let el: HTMLElement;
  let extra = manyTypes(0);

  const respond = (_days: number, ids?: number[]): Observable<DashboardTrend> =>
    of(aTrend(ids ?? [], extra));

  async function open(url = '/trends', answer: typeof respond = respond) {
    getTrend = vi.fn(answer);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'trends', component: Host }]),
        provideFakeMe(new FakeMeApi(withPermissions('Task.View', 'Dashboard.ViewDepartment'))),
        { provide: DashboardClient, useValue: { getDashboardTrend: getTrend } },
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
        { provide: Clock, useValue: { now: () => new Date('2026-10-14T15:45:00Z') } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, Host);
    await settle();
    el = harness.routeNativeElement as HTMLElement;
  }

  async function settle() {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      harness.detectChanges();
    }
  }

  const box = (id: number) => el.querySelector<HTMLInputElement>(`[data-type-box="${id}"]`)!;
  async function check(id: number) {
    const b = box(id);
    b.checked = !b.checked;
    b.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  }
  const url = () => TestBed.inject(Router).url;
  const lines = () => Array.from(el.querySelectorAll('polyline.series:not(.partial)'));
  const stored = () => JSON.parse(localStorage.getItem(STORE_KEY(1)) ?? 'null');

  beforeEach(() => {
    extra = manyTypes(0);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });
  afterEach(() => vi.restoreAllMocks());

  it("starts as today's chart: All task types with Created and Completed, and every type listed unchecked", async () => {
    await open();
    expect(getTrend).toHaveBeenCalledTimes(1);
    expect(getTrend).toHaveBeenCalledWith(30, undefined, undefined, undefined);
    expect(text(el.querySelector('h3'))).toBe('Tasks created and completed per day');
    expect(lines().length).toBe(2);
    expect(el.querySelector<HTMLInputElement>('[data-all]')!.checked).toBe(true);
    expect(
      Array.from(el.querySelectorAll<HTMLInputElement>('[data-type-box]')).every((b) => !b.checked),
    ).toBe(true);
    expect(text(el.querySelector('[data-legend="created"]'))).toBe('Created 9');
    expect(text(el.querySelector('[data-legend="completed"]'))).toBe('Completed 6');
    // The measure selector waits for a task type.
    expect(el.querySelector<HTMLInputElement>('[data-metric="created"]')!.disabled).toBe(true);
    expect(text(el.querySelector('[data-show-disabled]'))).toContain(
      'until you select a task type',
    );
    // No search box for a short list.
    expect(el.querySelector('[data-search]')).toBeNull();
  });

  it('lists the task types largest first with icon, name and total, muting those without tasks and marking inactive ones', async () => {
    await open();
    const rows = Array.from(el.querySelectorAll('[data-type]'));
    expect(rows.map((r) => text(r.querySelector('.name')))).toEqual([
      'Alpha',
      'Beta',
      'Delta idle',
      'Gamma retired',
    ]);
    expect(rows.map((r) => text(r.querySelector('[data-total]')))).toEqual(['6', '3', '0', '0']);
    expect(rows.every((r) => r.querySelector('mf-task-type-icon') !== null)).toBe(true);
    expect(rows[2].classList.contains('muted')).toBe(true);
    expect(text(rows[3])).toContain('(inactive)');
    // The total opens the Task Queue with the type filter; a zero is not a link.
    expect(el.querySelector('[data-total="5"]')!.getAttribute('href')).toBe(
      '/tasks?createdFrom=2026-10-12&type=5',
    );
    expect(el.querySelector('[data-total="11"]')!.tagName).toBe('SPAN');
  });

  it('checking a task type switches to one metric for All and the type, reads it once, and puts the choice in the address and in storage', async () => {
    await open();
    await check(5);
    expect(getTrend).toHaveBeenLastCalledWith(30, [5], undefined, undefined);
    expect(lines().length).toBe(2);
    expect(text(el.querySelector('h3'))).toBe('Tasks created per day');
    expect(url()).toBe('/trends?types=5');
    expect(stored()).toEqual({ types: [5], showAll: true, metric: 'created', due: [] });
    // The measure selector is live now, the Due dates are not.
    expect(el.querySelector<HTMLInputElement>('[data-metric="created"]')!.disabled).toBe(false);
    expect(el.querySelector<HTMLInputElement>('[data-due="overdue"]')!.disabled).toBe(true);
    expect(el.querySelector('[data-due-disabled]')).not.toBeNull();
    // The legend rows carry a sample of their line; All task types has its own total.
    expect(box(5).closest('.row')!.querySelector('mf-trend-sample')).not.toBeNull();
    expect(text(el.querySelector('[data-total="all"]'))).toBe('9');

    // Another type needs one more read; unchecking needs none.
    await check(7);
    expect(getTrend).toHaveBeenLastCalledWith(30, [5, 7], undefined, undefined);
    expect(url()).toBe('/trends?types=5,7');
    expect(lines().length).toBe(3);
    const calls = getTrend.mock.calls.length;
    await check(7);
    expect(getTrend.mock.calls.length).toBe(calls);
    expect(lines().length).toBe(2);
    expect(url()).toBe('/trends?types=5');
  });

  it('keeps the colour of a type while it stays checked', async () => {
    await open();
    await check(5);
    await check(7);
    const colour = () =>
      Array.from(el.querySelectorAll('polyline.series:not(.partial)')).map((p) =>
        p.getAttribute('stroke'),
      );
    const before = colour();
    await check(5);
    const after = colour();
    expect(after[1]).toBe(before[2]);
  });

  it('switches the metric for every visible line without another read and keeps it in the address', async () => {
    await open();
    await check(5);
    const calls = getTrend.mock.calls.length;
    const radio = el.querySelector<HTMLInputElement>('[data-metric="overdue"]')!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(getTrend.mock.calls.length).toBe(calls);
    expect(text(el.querySelector('h3'))).toBe('Overdue tasks at the end of each day');
    expect(url()).toBe('/trends?types=5&metric=overdue');
    // The numbers on the rows follow the metric: overdue now, linking to the queue's overdue filter for that type.
    expect(text(el.querySelector('[data-total="5"]'))).toBe('2');
    expect(el.querySelector('[data-total="5"]')!.getAttribute('href')).toContain(
      'overdue=true&type=5',
    );
    expect(text(el.querySelector('[data-show] + .hint'))).toContain('Overdue now');
    // Types sort by the shown metric.
    expect(Array.from(el.querySelectorAll('[data-type] .name')).map((n) => text(n))[0]).toBe(
      'Alpha',
    );
  });

  it('refuses a ninth task type with a polite inline message and no read', async () => {
    extra = manyTypes(10);
    await open();
    // Search appears above eight task types.
    expect(el.querySelector('[data-search]')).not.toBeNull();
    for (let i = 0; i < 8; i++) await check(100 + i);
    expect(el.querySelectorAll('polyline.series:not(.partial)').length).toBe(9);
    const calls = getTrend.mock.calls.length;
    await check(108);
    expect(box(108).checked).toBe(false);
    expect(text(el.querySelector('[data-limit-msg]'))).toBe(
      'Pick up to 8 task types to keep the chart readable',
    );
    expect(getTrend.mock.calls.length).toBe(calls);
    expect(url().split('types=')[1].split(',').length).toBe(8);
    // Unchecking one clears the message and makes room.
    await check(100);
    expect(text(el.querySelector('[data-limit-msg]'))).toBe('');
    await check(108);
    expect(box(108).checked).toBe(true);
  });

  it('Select all picks the eight highest totals and says so; Clear unchecks the types', async () => {
    extra = manyTypes(10);
    await open();
    el.querySelector<HTMLButtonElement>('[data-select-all]')!.click();
    await settle();
    expect(el.querySelectorAll<HTMLInputElement>('[data-type-box]:checked').length).toBe(8);
    expect(text(el.querySelector('[data-limit-msg]'))).toContain(
      'Selected the 8 task types with the highest totals',
    );
    expect(box(100).checked).toBe(true);
    expect(box(109).checked).toBe(false);
    el.querySelector<HTMLButtonElement>('[data-clear]')!.click();
    await settle();
    expect(el.querySelectorAll<HTMLInputElement>('[data-type-box]:checked').length).toBe(0);
    expect(url()).toBe('/trends');
    expect(lines().length).toBe(2);
  });

  it('searches the task types by name', async () => {
    extra = manyTypes(10);
    await open();
    const search = el.querySelector<HTMLInputElement>('[data-search]')!;
    search.value = 'type 03';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(Array.from(el.querySelectorAll('[data-type] .name')).map((n) => text(n))).toEqual([
      'Type 03',
    ]);
    search.value = 'zzz';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(el.querySelector('[data-no-match]')).not.toBeNull();
  });

  it('can hide the All line and then has nothing to draw until a line is chosen', async () => {
    await open();
    const all = el.querySelector<HTMLInputElement>('[data-all]')!;
    all.checked = false;
    all.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(url()).toBe('/trends?all=0');
    expect(el.querySelector('[data-empty]')!.textContent).toContain('Select a line');
    expect(el.querySelector('[data-legend="created"]')).toBeNull();
    await check(5);
    expect(lines().length).toBe(1);
  });

  it('adds Overdue, On time and Completed late of All task types to the default chart from the Due dates group', async () => {
    await open();
    expect(text(el.querySelector('[data-group="due-dates"] h4'))).toBe('Due dates');
    expect(text(el.querySelector('[data-group="due-dates"] .hint'))).toContain(
      "Uses each task's current due date",
    );
    const tick = async (m: string) => {
      const b = el.querySelector<HTMLInputElement>(`[data-due="${m}"]`)!;
      b.checked = true;
      b.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
    };
    await tick('overdue');
    await tick('onTime');
    expect(lines().length).toBe(4);
    expect(url()).toBe('/trends?due=overdue,ontime');
    expect(text(el.querySelector('h3'))).toBe(
      'Tasks created, completed, overdue and on time per day',
    );
    expect(stored().due).toEqual(['overdue', 'onTime']);
    // Overdue now, with a link to the queue's overdue filter.
    expect(el.querySelector('[data-legend="overdue"]')!.getAttribute('href')).toContain(
      'overdue=true',
    );
    expect(text(el.querySelector('[data-legend="overdue"]'))).toBe('3');
    // No data request is needed: the lines come with the first answer.
    expect(getTrend).toHaveBeenCalledTimes(1);
  });

  it('lists the values of every visible line for a day in the tooltip and the table has a column per line', async () => {
    await open();
    await check(5);
    await check(7);
    const plot = el.querySelector<HTMLElement>('[data-plot]')!;
    plot.dispatchEvent(new FocusEvent('focus'));
    harness.detectChanges();
    const tip = text(el.querySelector('[data-tip]'));
    expect(tip).toContain('All task types 5');
    expect(tip).toContain('Alpha 3');
    expect(tip).toContain('Beta 2');
    el.querySelector<HTMLButtonElement>('.toggle')!.click();
    harness.detectChanges();
    expect(Array.from(el.querySelectorAll('thead th')).map((t) => text(t))).toEqual([
      'Day',
      'All task types',
      'Alpha',
      'Beta',
    ]);
    expect(el.querySelectorAll('tbody tr')[0].querySelectorAll('a')[1].getAttribute('href')).toBe(
      '/tasks?createdFrom=2026-10-12&createdTo=2026-10-12&type=5',
    );
  });

  describe('address and memory', () => {
    it('a shared address names the view and wins over what this browser remembers', async () => {
      localStorage.setItem(
        STORE_KEY(1),
        JSON.stringify({ types: [5], showAll: true, metric: 'created', due: [] }),
      );
      await open('/trends?types=7,5&metric=completed&all=0');
      expect(getTrend).toHaveBeenCalledWith(30, [7, 5], undefined, undefined);
      expect(box(7).checked).toBe(true);
      expect(box(5).checked).toBe(true);
      expect(el.querySelector<HTMLInputElement>('[data-all]')!.checked).toBe(false);
      expect(el.querySelector<HTMLInputElement>('[data-metric="completed"]')!.checked).toBe(true);
      expect(lines().length).toBe(2);
      expect(text(el.querySelector('h3'))).toBe('Tasks completed per day');
    });

    it('without parameters the remembered view is restored and the address completed', async () => {
      localStorage.setItem(
        STORE_KEY(1),
        JSON.stringify({ types: [7], showAll: true, metric: 'late', due: [] }),
      );
      await open('/trends');
      expect(getTrend).toHaveBeenCalledWith(30, [7], undefined, undefined);
      expect(box(7).checked).toBe(true);
      expect(url()).toBe('/trends?types=7&metric=late');
    });

    it('follows Back and Forward: the address changes the view', async () => {
      await open();
      await check(5);
      await harness.navigateByUrl('/trends?types=7', Host);
      await settle();
      expect(box(7).checked).toBe(true);
      expect(box(5).checked).toBe(false);
      await harness.navigateByUrl('/trends', Host);
      await settle();
      expect(box(7).checked).toBe(false);
    });

    it('ignores a broken stored value and works when browser storage is blocked', async () => {
      localStorage.setItem(STORE_KEY(1), '{nope');
      await open();
      expect(lines().length).toBe(2);
      TestBed.resetTestingModule();
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      await open();
      await check(5);
      expect(box(5).checked).toBe(true);
      expect(url()).toBe('/trends?types=5');
    });
  });

  describe('data', () => {
    it('reads again, fresh, when the page refreshed its figures, and for another period', async () => {
      await open();
      const host = harness.routeDebugElement!.componentInstance as Host;
      host.key.set('k2');
      harness.detectChanges();
      await settle();
      expect(getTrend).toHaveBeenLastCalledWith(30, undefined, undefined, true);
      host.period.set('week');
      harness.detectChanges();
      await settle();
      expect(getTrend).toHaveBeenLastCalledWith(3, undefined, undefined, undefined);
    });

    it('drops a remembered task type the server does not know and shows the rest', async () => {
      localStorage.setItem(
        STORE_KEY(1),
        JSON.stringify({ types: [999], showAll: true, metric: 'created', due: [] }),
      );
      await open('/trends', (_d, ids) =>
        ids && ids.includes(999) ? throwError(() => ({ status: 400 })) : of(aTrend([], extra)),
      );
      expect(getTrend).toHaveBeenCalledTimes(2);
      expect(lines().length).toBe(2);
      expect(url()).toBe('/trends');
      expect(text(el.querySelector('[data-trend-live]'))).toContain('no longer exists');
    });

    it('removes a checked inactive type that has no tasks once the period no longer lists it', async () => {
      localStorage.setItem(
        STORE_KEY(1),
        JSON.stringify({ types: [5, 77], showAll: true, metric: 'created', due: [] }),
      );
      await open('/trends');
      expect(box(5).checked).toBe(true);
      expect(url()).toBe('/trends?types=5');
      expect(text(el.querySelector('[data-trend-live]'))).toContain('Task type 77');
    });

    it('shows an error with Retry when the first read fails', async () => {
      let fail = true;
      await open('/trends', () => (fail ? throwError(() => ({ status: 500 })) : of(aTrend())));
      expect(el.querySelector('[data-trend-error]')).not.toBeNull();
      fail = false;
      el.querySelector<HTMLButtonElement>('[data-trend-retry]')!.click();
      await settle();
      expect(el.querySelector('[data-trend-error]')).toBeNull();
      expect(lines().length).toBe(2);
    });
  });
});
