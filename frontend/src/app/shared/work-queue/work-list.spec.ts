import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TaskQueueRow } from '../../api/generated/api-client';
import { WorkTab, WorkTabs } from './work-tabs';
import { WorkList } from './work-list';
import { aRow, provideClock, provideLookups } from './work-queue-testing';

describe('WorkList', () => {
  let fixture: ComponentFixture<WorkList>;
  const el = () => fixture.nativeElement as HTMLElement;

  async function create(rows: TaskQueueRow[], inputs: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), ...provideLookups(), ...provideClock('2026-10-14T15:00:00Z')],
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

  it('explains the default order and the way back from a header sort', async () => {
    await create([aRow()]);
    expect(el().querySelector('[data-sort-note]')!.textContent).toContain(
      'Default order: Priority, ASAP first, Due date, Oldest',
    );

    fixture.componentRef.setInput('sort', 'due');
    fixture.componentRef.setInput('dir', 'desc');
    fixture.detectChanges();
    const note = el().querySelector('[data-sort-note]')!;
    expect(note.textContent).toContain('Sorted by Due date (descending)');
    let reset = 0;
    fixture.componentInstance.resetSort.subscribe(() => reset++);
    note.querySelector<HTMLButtonElement>('button')!.click();
    expect(reset).toBe(1);
  });

  it('shows "Showing 1-50 of 312", rows per page and announces the range politely', async () => {
    await create([aRow()], { total: 312, page: 1, pageSize: 50 });
    expect(el().textContent).toContain('Showing 1-50 of 312');
    expect(el().querySelector('[role="status"]')!.textContent).toContain('Showing 1-50 of 312');

    const sizes = Array.from(el().querySelectorAll('.wl-size option')).map((o) =>
      o.textContent?.trim(),
    );
    expect(sizes).toEqual(['25', '50', '100']);
    const emitted: number[] = [];
    fixture.componentInstance.pageSizeChange.subscribe((n) => emitted.push(n));
    const select = el().querySelector<HTMLSelectElement>('.wl-size select')!;
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

  it('changes columns and density through the column chooser, never offering to hide Ref or Title', async () => {
    await create([aRow()], { columns: ['ref', 'title', 'status'] });
    el().querySelector<HTMLButtonElement>('.cc-button')!.click();
    fixture.detectChanges();

    const checks = Array.from(el().querySelectorAll<HTMLLabelElement>('.cc-check'));
    const find = (label: string) =>
      checks.find((c) => c.textContent?.includes(label))!.querySelector('input')!;
    expect(find('Ref').disabled).toBe(true);
    expect(find('Title').disabled).toBe(true);
    expect(find('Ref').checked).toBe(true);

    const columns: string[][] = [];
    const densities: string[] = [];
    fixture.componentInstance.columnsChange.subscribe((c) => columns.push(c));
    fixture.componentInstance.densityChange.subscribe((d) => densities.push(d));
    find('Client').click();
    find('Compact').click();
    expect(columns[0]).toEqual(['ref', 'title', 'client', 'status']);
    expect(densities).toEqual(['compact']);
  });
});

describe('WorkTabs', () => {
  let fixture: ComponentFixture<WorkTabs>;
  const tabs: WorkTab[] = [
    { key: 'a', label: 'Active', count: 7 },
    { key: 'b', label: 'Due Soon', count: 2 },
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
