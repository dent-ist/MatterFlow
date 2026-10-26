import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BarItem, BarList } from './bar-list';
import { BreakdownPrefs, NEXT_MODE, nextModeLabel } from './breakdown-view';
import { MAX_SLICES } from '../../../shared/charts/pie-geometry';
import { PieSlice, groupSlices, paletteColor } from './breakdown-slices';
import { Segment, StackedBar } from './stacked-bar';

const slice = (label: string, count: number, overdue?: number): PieSlice => ({
  label,
  count,
  overdue,
  query: `type=${label}`,
  fill: 'red',
  outline: null,
});

describe('breakdown view cycle', () => {
  it('walks table, bars, pie and back, and names the next view', () => {
    expect(NEXT_MODE.table).toBe('bars');
    expect(NEXT_MODE.bars).toBe('pie');
    expect(NEXT_MODE.pie).toBe('table');
    expect(nextModeLabel('table')).toBe('View as bars');
    expect(nextModeLabel('bars')).toBe('View as pie');
    expect(nextModeLabel('pie')).toBe('View as table');
  });
});

describe('groupSlices', () => {
  it('keeps up to eight slices as they are', () => {
    const list = Array.from({ length: MAX_SLICES }, (_, i) => slice(`T${i}`, i + 1));
    expect(groupSlices(list)).toEqual(list);
  });

  it('keeps the largest seven in their order and adds up the rest as one "Other"', () => {
    const list = Array.from({ length: 11 }, (_, i) => slice(`T${i}`, 20 - i, i % 2));
    const out = groupSlices(list);
    expect(out).toHaveLength(MAX_SLICES);
    expect(out.slice(0, 7).map((s) => s.label)).toEqual(['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
    const other = out[7];
    expect(other.label).toBe('Other');
    expect(other.query).toBeNull();
    expect(other.count).toBe(list.slice(7).reduce((n, s) => n + s.count, 0));
    expect(other.overdue).toBe(list.slice(7).reduce((n, s) => n + (s.overdue ?? 0), 0));
    expect(out.reduce((n, s) => n + s.count, 0)).toBe(list.reduce((n, s) => n + s.count, 0));
  });

  it('keeps a list of eight with its grouped row ("Other task types") as it is', () => {
    const list = [
      ...Array.from({ length: 7 }, (_, i) => slice(`T${i}`, 50 - i)),
      slice('Other task types', 1),
    ];
    expect(groupSlices(list)).toEqual(list);
  });
});

describe('paletteColor', () => {
  it('has palette colours that repeat after eight', () => {
    expect(paletteColor(0)).toBe(paletteColor(8));
    expect(paletteColor(0)).not.toBe(paletteColor(1));
  });
});

@Component({
  imports: [BarList, StackedBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-bar-list
      cardKey="task-type"
      heading="Task type"
      rowHeading="Task type"
      [items]="types"
      emptyText="No open tasks."
    />
    <mf-bar-list cardKey="status" heading="Status" [items]="none" emptyText="No open tasks." />
    <mf-stacked-bar cardKey="age" heading="Age" [segments]="ages" />
  `,
})
class Host {
  types: BarItem[] = Array.from({ length: 10 }, (_, i) => ({
    label: `Type ${i}`,
    count: 30 - i * 2,
    query: `type=${i}`,
    overdue: i === 0 ? 4 : 0,
  }));
  none: BarItem[] = [{ label: 'New', count: 0, query: 'status=NEW', tone: 'NEW' }];
  ages: Segment[] = [
    { label: '0-2 days', count: 3, query: 'createdFrom=2026-10-15', overdue: 1 },
    { label: '3-7 days', count: 1, query: 'createdFrom=2026-10-10' },
  ];
}

describe('breakdown pie view', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;

  const toggle = (card: string) =>
    el.querySelector<HTMLButtonElement>(`${card} [data-view-toggle]`)!;
  async function click(card: string): Promise<void> {
    toggle(card).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => localStorage.clear());

  it('cycles bars -> pie -> table -> bars and labels the link with the next view', async () => {
    const label = () => toggle('mf-bar-list').textContent!.replace(/\s+/g, ' ').trim();
    expect(label()).toBe('View as pie for Task type');
    await click('mf-bar-list');
    expect(el.querySelector('mf-bar-list [data-pie]')).not.toBeNull();
    expect(label()).toBe('View as table for Task type');
    await click('mf-bar-list');
    expect(el.querySelector('mf-bar-list table')).not.toBeNull();
    expect(label()).toBe('View as bars for Task type');
    await click('mf-bar-list');
    expect(el.querySelector('mf-bar-list .bars')).not.toBeNull();
    expect(label()).toBe('View as pie for Task type');
  });

  it('draws at most eight slices, an image with a text summary, and a legend whose counts equal the bars', async () => {
    const total = (fixture.componentInstance.types as BarItem[]).reduce((n, t) => n + t.count, 0);
    const barRows = el.querySelectorAll('mf-bar-list:first-of-type li').length;
    expect(barRows).toBe(10);
    await click('mf-bar-list');
    const svg = el.querySelector('mf-bar-list svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toContain(`${total} tasks`);
    expect(svg.getAttribute('aria-label')).toContain('4 overdue');
    expect(el.querySelectorAll('mf-bar-list [data-slice]')).toHaveLength(8);
    const legend = Array.from(el.querySelectorAll('mf-bar-list [data-pie-legend] li'));
    expect(legend).toHaveLength(8);
    const counts = legend.map((r) => Number(r.querySelector('.count')!.textContent));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
    expect(legend[7].querySelector('.name')!.textContent).toBe('Other');
    // The first row links to the queue like the bar does, and so does its overdue text.
    expect(legend[0].querySelector('a.rowlink')!.getAttribute('href')).toBe('/tasks?type=0');
    expect(legend[0].querySelector('.od-text')!.getAttribute('href')).toBe(
      '/tasks?type=0&overdue=true',
    );
    expect(legend[0].querySelector('.od-text')!.textContent).toContain('4 overdue');
    expect(el.querySelector('mf-bar-list [data-pie-centre]')!.textContent!.trim()).toBe(
      String(total),
    );
    expect(el.querySelector('mf-bar-list [data-overdue-ring]')).not.toBeNull();
  });

  it('shows the hovered or focused row in the middle and below the pie', async () => {
    await click('mf-bar-list');
    const row = el.querySelector<HTMLElement>('mf-bar-list [data-pie-legend] li')!;
    row.dispatchEvent(new Event('focusin', { bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('mf-bar-list [data-pie-centre]')!.textContent!.trim()).toBe('30');
    expect(el.querySelector('mf-bar-list [data-pie-tip]')!.textContent).toContain(
      'Type 0: 30 tasks',
    );
    expect(el.querySelector('mf-bar-list [data-slice].on')).not.toBeNull();
    row.dispatchEvent(new Event('focusout', { bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('mf-bar-list [data-slice].on')).toBeNull();
  });

  it('says so when the total is zero', async () => {
    await click('mf-bar-list:nth-of-type(2)');
    expect(el.querySelector('mf-bar-list:nth-of-type(2) [data-pie-empty]')!.textContent).toContain(
      'No open tasks.',
    );
  });

  it('draws the age bands as a pie too', async () => {
    await click('mf-stacked-bar');
    expect(el.querySelectorAll('mf-stacked-bar [data-slice]')).toHaveLength(2);
    expect(el.querySelector('mf-stacked-bar [data-pie-centre]')!.textContent!.trim()).toBe('4');
  });

  it('remembers the view per card and per user, and starts as bars without a remembered choice', async () => {
    await click('mf-bar-list');
    await click('mf-stacked-bar');
    await click('mf-stacked-bar');
    const prefs = TestBed.inject(BreakdownPrefs);
    expect(prefs.load('task-type')).toBe('pie');
    expect(prefs.load('age')).toBe('table');
    expect(prefs.load('status')).toBe('bars');
    // A new page load restores it.
    const again = TestBed.createComponent(Host);
    again.detectChanges();
    await again.whenStable();
    const root = again.nativeElement as HTMLElement;
    expect(root.querySelector('mf-stacked-bar table')).not.toBeNull();
    expect(root.querySelectorAll('mf-bar-list')[0].querySelector('.bars')).toBeNull();
  });
});
