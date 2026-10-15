import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TaskQueueRow } from '../../api/generated/api-client';
import { WorkTab, WorkTabs } from './work-tabs';
import { WorkList } from './work-list';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { aRow, provideClock, provideLookups } from './work-queue-testing';

describe('WorkList', () => {
  let fixture: ComponentFixture<WorkList>;
  const el = () => fixture.nativeElement as HTMLElement;

  async function create(rows: TaskQueueRow[], inputs: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions())),
        ...provideLookups(),
        ...provideClock('2026-10-14T15:00:00Z'),
      ],
    });
    fixture = TestBed.createComponent(WorkList);
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('columns', ['ref', 'title', 'status']);
    fixture.componentRef.setInput('state', 'ready');
    fixture.componentRef.setInput('total', rows.length);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows "Showing 1-50 of 312", rows per page and announces the range politely', async () => {
    await create([aRow()], { total: 312, page: 1, pageSize: 50 });
    expect(el().textContent).toContain('Showing 1-50 of 312');
    expect(el().querySelector('[role="status"]')!.textContent).toContain('Showing 1-50 of 312');

    const sizes = Array.from(el().querySelectorAll('.mf-pager__size option')).map((o) =>
      o.textContent?.trim(),
    );
    expect(sizes).toEqual(['25', '50', '100']);
    const emitted: number[] = [];
    fixture.componentInstance.pageSizeChange.subscribe((n) => emitted.push(n));
    const select = el().querySelector<HTMLSelectElement>('.mf-pager__size select')!;
    select.value = '100';
    select.dispatchEvent(new Event('change'));
    expect(emitted).toEqual([100]);
  });

  it('says there are no tasks yet when nothing is filtered', async () => {
    await create([], { emptyText: 'No tasks yet.' });
    expect(el().querySelector('[data-empty]')!.textContent).toContain('No tasks yet.');
    expect(el().querySelector('table')).toBeNull();
  });

  it('says no tasks match the filters and offers to clear them', async () => {
    await create([], { filtered: true });
    expect(el().querySelector('[data-empty]')!.textContent).toContain(
      'No tasks match these filters.',
    );
    let cleared = 0;
    fixture.componentInstance.clearFilters.subscribe(() => cleared++);
    el().querySelector<HTMLButtonElement>('[data-empty] button')!.click();
    expect(cleared).toBe(1);
  });

  it('shows five skeleton rows while loading', async () => {
    await create([], { state: 'loading' });
    expect(el().querySelectorAll('tr.wt-skeleton').length).toBe(5);
    expect(el().querySelector('[role="status"]')!.textContent).toContain('Loading');
  });

  it('shows an alert with Retry and keeps the previous rows on error', async () => {
    await create([aRow()], { state: 'error' });
    const alert = el().querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Something went wrong. Try again.');
    expect(el().querySelectorAll('tbody tr').length).toBe(1);

    let retried = 0;
    fixture.componentInstance.retry.subscribe(() => retried++);
    alert.querySelector<HTMLButtonElement>('button')!.click();
    expect(retried).toBe(1);
  });

  it('adds a friendly line below a short list, only when nothing is filtered', async () => {
    await create([aRow()]);
    expect(el().querySelector('[data-near-empty]')).not.toBeNull();
    fixture.componentRef.setInput('filtered', true);
    fixture.detectChanges();
    expect(el().querySelector('[data-near-empty]')).toBeNull();
  });

  it('leaves out the friendly line from five rows on', async () => {
    await create([1, 2, 3, 4, 5].map((n) => aRow({ taskId: n, taskNumber: `TSK-${n}` })));
    expect(el().querySelector('[data-near-empty]')).toBeNull();
  });
});

describe('WorkTabs', () => {
  let fixture: ComponentFixture<WorkTabs>;
  const tabs: WorkTab[] = [
    { key: 'a', label: 'Active', count: 7, emphasize: true },
    { key: 'b', label: 'Due Soon', count: 2, emphasize: true },
    { key: 'c', label: 'Completed' },
  ];

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(WorkTabs);
    fixture.componentRef.setInput('tabs', tabs);
    fixture.componentRef.setInput('selected', 'a');
    fixture.componentRef.setInput('idPrefix', 'x');
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const buttons = () =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );

  it('is a tablist with counts, a selected tab and a roving tab stop', () => {
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="tablist"]')).not.toBeNull();
    expect(buttons().map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Active (7)',
      'Due Soon (2)',
      'Completed',
    ]);
    expect(buttons().map((b) => b.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(buttons().map((b) => b.tabIndex)).toEqual([0, -1, -1]);
    expect(buttons()[0].getAttribute('aria-controls')).toBe('x-panel');
  });

  it('mutes zero counts and bolds only the counts that ask for it while above zero', () => {
    fixture.componentRef.setInput('tabs', [
      { key: 'a', label: 'Active', count: 7, emphasize: true },
      { key: 'b', label: 'Due Soon', count: 0, emphasize: true },
      { key: 'c', label: 'Done', count: 4 },
      { key: 'd', label: 'Mine', count: 0 },
    ]);
    fixture.detectChanges();
    const counts = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.count'),
    ).map((c) => [c.classList.contains('count--strong'), c.classList.contains('count--zero')]);
    expect(counts).toEqual([
      [true, false],
      [false, true],
      [false, false],
      [false, true],
    ]);
  });

  it('selects on click and moves with the arrow keys, Home and End', () => {
    const emitted: string[] = [];
    fixture.componentInstance.selectedChange.subscribe((k) => emitted.push(k));
    buttons()[1].click();
    buttons()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    buttons()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    buttons()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    buttons()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    buttons()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    expect(emitted).toEqual(['b', 'b', 'c', 'c', 'a']);
  });
});
