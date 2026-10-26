import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { TrendChart } from './trend-chart';
import { TYPE_STYLES } from '../../../shared/charts/chart-palette';
import { ALL_STYLE, ChartLine, MEASURE_STYLES, PanelView } from './trend-model';

function line(partial: Partial<ChartLine> & Pick<ChartLine, 'key' | 'name' | 'values'>): ChartLine {
  return {
    panel: 'flows',
    tipName: null,
    valueWord: 'created',
    style: MEASURE_STYLES.created,
    iconKey: null,
    measure: 'created',
    typeId: null,
    approximate: false,
    ...partial,
  };
}

const DATES = ['2026-10-01', '2026-10-02', '2026-10-03'];
const CREATED = line({ key: 'all-created', name: 'Created', values: [2, 5, 0] });
const COMPLETED = line({
  key: 'all-completed',
  name: 'Completed',
  values: [0, 4, 1],
  valueWord: 'completed',
  measure: 'completed',
  style: MEASURE_STYLES.completed,
});

const panel = (
  key: 'flows' | 'backlog',
  lines: readonly ChartLine[],
  note: string | null = null,
): PanelView => ({
  key,
  title: key === 'flows' ? 'Created and completed' : 'Backlog at end of day',
  lines: [...lines],
  height: key === 'flows' ? 320 : 200,
  measureNote: note,
});

@Component({
  imports: [TrendChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-trend-chart
    heading="Tasks over time"
    [dates]="dates()"
    [granularity]="granularity()"
    [periodFrom]="from()"
    [periodTo]="to()"
    [panels]="panels()"
    [asTable]="asTable()"
  />`,
})
class Host {
  dates = signal<readonly string[]>(DATES);
  panels = signal<readonly PanelView[]>([panel('flows', [CREATED, COMPLETED])]);
  asTable = signal(false);
  granularity = signal<'day' | 'week'>('day');
  from = signal<string | null>(null);
  to = signal<string | null>(null);
  /** Sets the lines of the (only) flows panel. */
  setLines(lines: readonly ChartLine[], note: string | null = null) {
    this.panels.set([panel('flows', lines, note)]);
  }
}

const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('trend chart', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;

  async function open(now = new Date('2026-12-01T12:00:00Z')) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
        { provide: Clock, useValue: { now: () => now } },
      ],
    });
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  }

  async function update(fn: (h: Host) => void) {
    fn(fixture.componentInstance);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  describe('default two-line chart', () => {
    beforeEach(() => open());

    it('draws a chart with a text summary and two differently styled lines and markers', () => {
      const plot = el.querySelector('[data-plot]')!;
      expect(plot.getAttribute('aria-roledescription')).toBe('chart');
      expect(plot.getAttribute('aria-label')).toContain('Created 7 created, Completed 5 completed');
      expect(el.querySelector('h3')!.textContent).toBe('Created and completed');
      expect(plot.getAttribute('tabindex')).toBe('0');
      const svg = plot.querySelector('svg.chart')!;
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      const lines = Array.from(svg.querySelectorAll('polyline'));
      expect(lines.length).toBe(2);
      expect(lines[0].getAttribute('stroke')).toBe(MEASURE_STYLES.created.color);
      expect(lines[0].getAttribute('stroke-dasharray')).toBeNull();
      expect(lines[1].getAttribute('stroke-dasharray')).toBe(MEASURE_STYLES.completed.dash);
      // One marker per day and line, of different shapes (circle arcs vs a square).
      const markers = Array.from(svg.querySelectorAll('path.marker'));
      expect(markers.length).toBe(6);
      expect(markers[0].getAttribute('d')).toContain('a3,3');
      expect(markers[3].getAttribute('d')).not.toContain('a3,3');
    });

    it('shows the values of a day on hover and with the arrow keys, announcing keyboard moves', () => {
      const plot = el.querySelector<HTMLElement>('[data-plot]')!;
      expect(el.querySelector('[data-tip]')).toBeNull();
      plot.dispatchEvent(new FocusEvent('focus'));
      fixture.detectChanges();
      // Focus starts on the last day.
      expect(el.querySelector('[data-tip]')!.textContent).toContain('Sat, Oct 3');
      expect(el.querySelector('[data-tip]')!.textContent).toContain('0 created');
      expect(el.querySelector('[data-tip]')!.textContent).toContain('1 completed');
      expect(el.querySelector('[data-readout]')!.textContent).toContain(
        'Sat, Oct 3: 0 created, 1 completed',
      );

      plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      fixture.detectChanges();
      expect(el.querySelector('[data-tip]')!.textContent).toContain('Fri, Oct 2');
      expect(el.querySelector('[data-tip]')!.textContent).toContain('5 created');
      expect(el.querySelector('[data-readout]')!.textContent).toContain(
        'Fri, Oct 2: 5 created, 4 completed',
      );

      plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      fixture.detectChanges();
      expect(el.querySelector('[data-tip]')!.textContent).toContain('Thu, Oct 1');

      plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      fixture.detectChanges();
      expect(el.querySelector('[data-tip]')!.textContent).toContain('Sat, Oct 3');

      plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(el.querySelector('[data-tip]')).toBeNull();

      // A pointer over the middle of the plot picks the middle day.
      const panelPlot = el.querySelector<HTMLElement>('.panel-plot')!;
      // The drawing is 640 px wide (the default without a measured size) and the axis labels take 34 px at the left and 14 at the right.
      vi.spyOn(plot.querySelector('svg')!, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        width: 640,
        top: 0,
        height: 320,
      } as DOMRect);
      panelPlot.dispatchEvent(
        Object.assign(new Event('pointermove', { bubbles: true }), { clientX: 327 }),
      );
      fixture.detectChanges();
      expect(el.querySelector('[data-tip]')!.textContent).toContain('Fri, Oct 2');

      // The day is taken from the drawing itself: a drawing that sits to the right of the left edge of its box (offset 220 px) maps
      // the pointer over ITS middle (x = 220 + 180) to the middle day, not the pointer over the middle of the box.
      panelPlot.dispatchEvent(new Event('pointerleave'));
      fixture.detectChanges();
      vi.spyOn(plot.querySelector('svg')!, 'getBoundingClientRect').mockReturnValue({
        left: 220,
        width: 640,
        top: 0,
        height: 320,
      } as DOMRect);
      panelPlot.dispatchEvent(
        Object.assign(new Event('pointermove', { bubbles: true }), { clientX: 547 }),
      );
      fixture.detectChanges();
      expect(el.querySelector('[data-tip]')!.textContent).toContain('Fri, Oct 2');
    });

    it('marks weekends, and marks today as a partial day only when the series ends today', () => {
      // 1 Oct 2026 is a Thursday: the 3rd is a Saturday.
      expect(el.querySelectorAll('rect.weekend').length).toBe(1);
      expect(el.textContent).toContain('Shaded: weekends');
      expect(el.querySelector('polyline.partial')).toBeNull();
      expect(el.textContent).not.toContain('Dotted: today so far');
    });

    it('offers every day as a table with one column per visible line whose counts link to that day', async () => {
      await update((h) => h.asTable.set(true));
      const heads = Array.from(el.querySelectorAll('thead th')).map((t) => text(t));
      expect(heads).toEqual(['Day', 'Created', 'Completed']);
      const rows = Array.from(el.querySelectorAll('tbody tr'));
      expect(rows.map((r) => r.querySelector('th')!.textContent)).toEqual([
        'Oct 1, 2026',
        'Oct 2, 2026',
        'Oct 3, 2026',
      ]);
      expect(rows[1].querySelectorAll('a')[0].getAttribute('href')).toBe(
        '/tasks?createdFrom=2026-10-02&createdTo=2026-10-02',
      );
      expect(rows[1].querySelectorAll('a')[1].getAttribute('href')).toBe(
        '/tasks?status=COMPLETED&completedFrom=2026-10-02&completedTo=2026-10-02',
      );
      // A zero is plain text, not a link to an empty list.
      expect(rows[2].querySelectorAll('a').length).toBe(1);
      expect(el.querySelector('svg.chart')).toBeNull();
    });

    it('says what there is to draw when no line is visible', async () => {
      await update((h) => h.setLines([]));
      expect(el.querySelector('[data-empty]')!.textContent).toContain('Select a line');
      expect(el.querySelector('[data-plot]')).toBeNull();
    });
  });

  describe('several lines', () => {
    const ALL = line({
      key: 'all',
      name: 'All task types',
      tipName: 'All task types',
      valueWord: '',
      style: ALL_STYLE,
      values: [3, 8, 2],
    });
    const ALPHA = line({
      key: 'type-5',
      name: 'Alpha',
      tipName: 'Alpha',
      valueWord: '',
      style: TYPE_STYLES[0],
      values: [1, 6, 0],
      typeId: 5,
    });
    const BETA = line({
      key: 'type-7',
      name: 'Beta',
      tipName: 'Beta',
      valueWord: '',
      style: TYPE_STYLES[1],
      values: [2, 2, 2],
      typeId: 7,
    });

    beforeEach(async () => {
      await open();
      await update((h) => {
        h.setLines([ALL, ALPHA, BETA], 'Created');
      });
    });

    it('draws each line in its own colour, dash pattern and marker', () => {
      const polylines = Array.from(el.querySelectorAll('polyline'));
      expect(polylines.map((p) => p.getAttribute('stroke'))).toEqual([
        ALL_STYLE.color,
        TYPE_STYLES[0].color,
        TYPE_STYLES[1].color,
      ]);
      expect(polylines.map((p) => p.getAttribute('stroke-dasharray'))).toEqual([
        null,
        TYPE_STYLES[0].dash,
        TYPE_STYLES[1].dash,
      ]);
      const shapes = new Set(
        Array.from(el.querySelectorAll('path.marker')).map(
          (m) => m.getAttribute('d')!.charAt(0) + m.getAttribute('d')!.length,
        ),
      );
      expect(shapes.size).toBeGreaterThan(1);
    });

    it('lists the value of every visible line in the tooltip and the live read-out', () => {
      const plot = el.querySelector<HTMLElement>('[data-plot]')!;
      plot.dispatchEvent(new FocusEvent('focus'));
      plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      fixture.detectChanges();
      const tip = text(el.querySelector('[data-tip]'));
      expect(tip).toContain('Fri, Oct 2');
      expect(tip).toContain('Created');
      expect(tip).toContain('All task types 8');
      expect(tip).toContain('Alpha 6');
      expect(tip).toContain('Beta 2');
      expect(text(el.querySelector('[data-readout]'))).toBe(
        'Fri, Oct 2, created: All task types 8, Alpha 6, Beta 2.',
      );
    });

    it('scales the axis to the highest visible line', async () => {
      const top = () =>
        Math.max(
          ...Array.from(el.querySelectorAll('text.tick'))
            .map((t) => Number(t.textContent))
            .filter((n) => !isNaN(n)),
        );
      // Peak 8 (+5 percent) gives an axis to 10 in steps of 2; peak 2 gives the minimum axis of 4.
      expect(top()).toBe(10);
      await update((h) => h.setLines([BETA]));
      expect(top()).toBe(4);
    });

    it('has a table column per visible line with links that carry the task type', async () => {
      await update((h) => h.asTable.set(true));
      expect(Array.from(el.querySelectorAll('thead th')).map((t) => text(t))).toEqual([
        'Day',
        'All task types',
        'Alpha',
        'Beta',
      ]);
      const row = el.querySelectorAll('tbody tr')[1];
      const links = Array.from(row.querySelectorAll('a')).map((a) => a.getAttribute('href'));
      expect(links).toEqual([
        '/tasks?createdFrom=2026-10-02&createdTo=2026-10-02',
        '/tasks?createdFrom=2026-10-02&createdTo=2026-10-02&type=5',
        '/tasks?createdFrom=2026-10-02&createdTo=2026-10-02&type=7',
      ]);
      // Alpha has none on the 3rd: plain 0, no link.
      expect(el.querySelectorAll('tbody tr')[2].querySelectorAll('a').length).toBe(2);
    });
  });

  describe('due-date lines', () => {
    const OVERDUE = line({
      key: 'all-overdue',
      name: 'Overdue',
      valueWord: 'overdue',
      measure: 'overdue',
      style: MEASURE_STYLES.overdue,
      values: [1, 4, 2],
      approximate: true,
    });
    const LATE = line({
      key: 'all-late',
      name: 'Completed late',
      valueWord: 'completed late',
      measure: 'late',
      style: MEASURE_STYLES.late,
      values: [0, 1, 1],
      approximate: true,
    });

    it('links Overdue to the open tasks due by that day (today: the queue overdue filter) and says what the links list', async () => {
      await open(new Date('2026-10-03T15:00:00Z'));
      await update((h) => {
        h.setLines([OVERDUE, LATE]);
        h.asTable.set(true);
      });
      const rows = Array.from(el.querySelectorAll('tbody tr'));
      expect(rows[0].querySelectorAll('a')[0].getAttribute('href')).toBe(
        '/tasks?status=NEW&status=IN_PROGRESS&status=ON_HOLD&dueTo=2026-10-01',
      );
      expect(rows[2].querySelectorAll('a')[0].getAttribute('href')).toBe(
        '/tasks?status=NEW&status=IN_PROGRESS&status=ON_HOLD&overdue=true',
      );
      expect(rows[1].querySelectorAll('a')[1].getAttribute('href')).toBe(
        '/tasks?status=COMPLETED&completedFrom=2026-10-02&completedTo=2026-10-02',
      );
      const foot = text(el.querySelector('.foot'));
      expect(foot).toContain("using each task's current due date");
      expect(foot).toContain('still open');
      expect(foot).toContain('every task completed that day');
    });
  });

  describe('with today in it', () => {
    it('draws the last segment dotted and says today is a partial day', async () => {
      await open(new Date('2026-10-03T15:00:00Z'));
      expect(el.querySelectorAll('polyline.partial').length).toBe(2);
      expect(el.textContent).toContain('Dotted: today so far');
      // The solid lines stop the day before.
      const solid = el.querySelector('polyline.series:not(.partial)')!;
      expect(solid.getAttribute('points')!.split(' ').length).toBe(2);
      el.querySelector<HTMLElement>('[data-plot]')!.dispatchEvent(new FocusEvent('focus'));
      fixture.detectChanges();
      expect(el.querySelector('[data-tip]')!.textContent).toContain('Today so far');
    });
  });

  describe('a long period', () => {
    it('draws markers only at the first and last point of a line with more than 14 points', async () => {
      await open();
      const dates = Array.from({ length: 90 }, (_, i) => {
        const d = new Date(Date.UTC(2026, 6, 1 + i));
        return d.toISOString().slice(0, 10);
      });
      await update((h) => {
        h.dates.set(dates);
        h.setLines([line({ key: 'a', name: 'A', values: dates.map((_, i) => i % 7) })]);
      });
      expect(el.querySelectorAll('path.marker').length).toBe(2);
    });
  });

  describe('two panels', () => {
    const OVERDUE = line({
      key: 'backlog-all-overdue',
      panel: 'backlog',
      name: 'Overdue',
      valueWord: 'overdue',
      measure: 'overdue',
      style: MEASURE_STYLES.overdue,
      values: [120, 152, 140],
      approximate: true,
    });

    beforeEach(async () => {
      await open();
      await update((h) =>
        h.panels.set([panel('flows', [CREATED, COMPLETED]), panel('backlog', [OVERDUE])]),
      );
    });

    it('gives each panel its own title and axis: the flows keep their scale next to a stock of 152', () => {
      const panels = Array.from(el.querySelectorAll('[data-panel]'));
      expect(panels.map((p) => p.getAttribute('data-panel'))).toEqual(['flows', 'backlog']);
      expect(panels.map((p) => text(p.querySelector('h3')))).toEqual([
        'Created and completed',
        'Backlog at end of day',
      ]);
      const top = (p: Element) =>
        Math.max(
          ...Array.from(p.querySelectorAll('text.tick'))
            .map((t) => Number(t.textContent))
            .filter((n) => !isNaN(n)),
        );
      expect(top(panels[0])).toBe(6); // flows peak 5 (+5 percent) -> 6
      expect(top(panels[1])).toBe(200); // overdue peak 152 -> 200
      // Heights are the contract of the layout: 320 and 200 px.
      const heights = panels.map(
        (p) => p.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[3],
      );
      expect(heights).toEqual(['320', '200']);
    });

    it('shares one x scale: the same day is at the same x in both panels', () => {
      const flows = el.querySelector('[data-panel=flows] polyline')!.getAttribute('points')!;
      const backlog = el.querySelector('[data-panel=backlog] polyline')!.getAttribute('points')!;
      const xs = (pts: string) => pts.split(' ').map((p) => p.split(',')[0]);
      expect(xs(backlog)).toEqual(xs(flows));
      // Only the lower panel carries the day labels.
      expect(el.querySelectorAll('[data-panel=flows] text.tick').length).toBe(
        el.querySelectorAll('[data-panel=flows] line.grid').length,
      );
      expect(el.querySelectorAll('[data-panel=backlog] text.tick').length).toBeGreaterThan(
        el.querySelectorAll('[data-panel=backlog] line.grid').length,
      );
    });

    it('shows the cursor in both panels and lists the lines of both in the tooltip, grouped by panel', () => {
      const plot = el.querySelector<HTMLElement>('[data-plot]')!;
      plot.dispatchEvent(new FocusEvent('focus'));
      plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      fixture.detectChanges();
      expect(el.querySelectorAll('line.rule').length).toBe(2);
      expect(el.querySelectorAll('[data-tip]').length).toBe(1);
      const tip = text(el.querySelector('[data-tip]'));
      expect(tip).toContain('Created and completed');
      expect(tip).toContain('5 created');
      expect(tip).toContain('Backlog at end of day');
      expect(tip).toContain('152 overdue');
      expect(text(el.querySelector('[data-readout]'))).toBe(
        'Fri, Oct 2: 5 created, 4 completed; Backlog at end of day: 152 overdue.',
      );
      expect(plot.getAttribute('aria-label')).toContain('Backlog at end of day: Overdue 140 now');
    });

    it('does not take the arrow keys of the controls inside the chart', () => {
      const plot = el.querySelector<HTMLElement>('[data-plot]')!;
      const heading = el.querySelector('h3')!;
      heading.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      fixture.detectChanges();
      expect(el.querySelector('[data-tip]')).toBeNull();
      expect(plot).toBeTruthy();
    });

    it('has one table with a group header per panel and a column per line', async () => {
      await update((h) => h.asTable.set(true));
      expect(
        Array.from(el.querySelectorAll('thead th[scope=colgroup]')).map((t) => text(t)),
      ).toEqual(['Created and completed', 'Backlog at end of day']);
      expect(Array.from(el.querySelectorAll('thead th[data-col]')).map((t) => text(t))).toEqual([
        'Created',
        'Completed',
        'Overdue',
      ]);
      expect(el.querySelectorAll('tbody tr')[1].querySelectorAll('td').length).toBe(3);
    });
  });

  describe('size', () => {
    it('draws at the measured width in real pixels and redraws on resize', async () => {
      let callback: ResizeObserverCallback = () => undefined;
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(cb: ResizeObserverCallback) {
            callback = cb;
          }
          observe(): void {
            /* the test drives the callback */
          }
          disconnect(): void {
            /* nothing to release */
          }
        },
      );
      try {
        await open();
        const viewBox = () => el.querySelector('svg.chart')!.getAttribute('viewBox');
        expect(viewBox()).toBe('0 0 640 320');
        callback([{ contentRect: { width: 1002 } } as ResizeObserverEntry], {} as ResizeObserver);
        fixture.detectChanges();
        expect(viewBox()).toBe('0 0 1002 320');
        // A tiny or zero width (a hidden tab) is ignored.
        callback([{ contentRect: { width: 0 } } as ResizeObserverEntry], {} as ResizeObserver);
        fixture.detectChanges();
        expect(viewBox()).toBe('0 0 1002 320');
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('all zero', () => {
    it('keeps a readable axis from 0 to 4 and says there is nothing to count', async () => {
      await open();
      await update((h) => h.setLines([line({ key: 'z', name: 'Created', values: [0, 0, 0] })]));
      const ticks = Array.from(el.querySelectorAll('text.tick'))
        .map((t) => text(t))
        .filter((t) => /^\d+$/.test(t));
      expect(ticks).toEqual(['0', '1', '2', '3', '4']);
      expect(text(el.querySelector('[data-zero]'))).toBe('Nothing to count in this period.');
    });
  });

  describe('markers and hover (T4)', () => {
    it('keeps a marker on every point up to 14 points and adds the hovered day beyond it', async () => {
      await open();
      const dates = Array.from(
        { length: 14 },
        (_, i) => `2026-09-${String(10 + i).padStart(2, '0')}`,
      );
      await update((h) => {
        h.dates.set(dates);
        h.setLines([line({ key: 'a', name: 'A', values: dates.map((_, i) => i) })]);
      });
      expect(el.querySelectorAll('path.marker').length).toBe(14);
      const more = [...dates, '2026-09-24'];
      await update((h) => {
        h.dates.set(more);
        h.setLines([line({ key: 'a', name: 'A', values: more.map((_, i) => i) })]);
      });
      expect(el.querySelectorAll('path.marker').length).toBe(2);
      el.querySelector<HTMLElement>('[data-plot]')!.dispatchEvent(new FocusEvent('focus'));
      fixture.detectChanges();
      // The focused day gets its marker (and the highlight band) on top of the two at the ends.
      expect(el.querySelectorAll('path.marker').length).toBe(3);
      expect(el.querySelectorAll('rect.hover-band').length).toBe(1);
    });
  });

  describe('direct labels (T4)', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        line({
          key: `type-${i}`,
          name: `Type ${i}`,
          tipName: `Type ${i}`,
          valueWord: '',
          style: TYPE_STYLES[i % TYPE_STYLES.length],
          values: [i, i + 1, 5],
          typeId: i + 1,
        }),
      );

    it('names each of up to 4 lines at its last point with its value, aria-hidden, in a 96 px right margin', async () => {
      await open();
      const labels = Array.from(el.querySelectorAll('[data-end-label]'));
      expect(labels.map((l) => text(l))).toEqual(['Created 0', 'Completed 1']);
      expect(labels.every((l) => l.getAttribute('aria-hidden') === 'true')).toBe(true);
      // The plot stops 96 px before the right edge: the last point sits at 640 - 96.
      const points = el.querySelector('polyline.series')!.getAttribute('points')!.split(' ');
      expect(Number(points[points.length - 1].split(',')[0])).toBeCloseTo(640 - 96, 0);
      // The live read-out and the summary still carry the values.
      expect(el.querySelector('[data-plot]')!.getAttribute('aria-label')).toContain(
        'Created 7 created',
      );
    });

    it('spreads labels of lines that end at nearly the same value at least 12 px apart, inside the plot', async () => {
      await open();
      await update((h) =>
        h.setLines(
          [4, 4, 5].map((v, i) =>
            line({ key: `c${i}`, name: `Line ${i}`, values: [1, 2, v], style: TYPE_STYLES[i] }),
          ),
        ),
      );
      const ys = Array.from(el.querySelectorAll('[data-end-label] text')).map((t) =>
        Number(t.getAttribute('y')),
      );
      expect(ys).toHaveLength(3);
      const sorted = [...ys].sort((a, b) => a - b);
      expect(sorted[1] - sorted[0]).toBeGreaterThanOrEqual(12);
      expect(sorted[2] - sorted[1]).toBeGreaterThanOrEqual(12);
      for (const y of ys) {
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(320 - 30 + 4);
      }
    });

    it('draws no end labels with 5 or more lines (8 type lines), and keeps the narrow right margin', async () => {
      await open();
      await update((h) => h.setLines(many(8)));
      expect(el.querySelectorAll('[data-end-label]').length).toBe(0);
      const points = el.querySelector('polyline.series')!.getAttribute('points')!.split(' ');
      expect(Number(points[points.length - 1].split(',')[0])).toBeCloseTo(640 - 14, 0);
      await update((h) => h.setLines(many(4)));
      expect(el.querySelectorAll('[data-end-label]').length).toBe(4);
    });

    it('labels both panels, each by its own line count', async () => {
      await open();
      await update((h) =>
        h.panels.set([
          panel('flows', many(5)),
          panel('backlog', [
            line({
              key: 'o',
              panel: 'backlog',
              name: 'Open',
              measure: 'open',
              values: [10, 20, 30],
              style: MEASURE_STYLES.open,
            }),
          ]),
        ]),
      );
      expect(el.querySelectorAll('[data-panel=flows] [data-end-label]').length).toBe(0);
      expect(text(el.querySelector('[data-panel=backlog] [data-end-label]'))).toBe('Open 30');
      // One x scale: the margin is the same in both panels.
      const lastX = (k: string) => {
        const pts = el
          .querySelector(`[data-panel=${k}] polyline.series`)!
          .getAttribute('points')!
          .split(' ');
        return pts[pts.length - 1].split(',')[0];
      };
      expect(lastX('backlog')).toBe(lastX('flows'));
    });
  });

  describe('weekly points (T7, T5)', () => {
    const WEEKS = [
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
    ];
    const weekly = line({
      key: 'backlog-all-open',
      panel: 'backlog',
      name: 'Open',
      valueWord: 'open',
      measure: 'open',
      style: MEASURE_STYLES.open,
      values: [100, 110, 120, 130, 140, 150],
    });

    beforeEach(async () => {
      await open(new Date('2026-10-14T12:00:00Z'));
      await update((h) => {
        h.dates.set(WEEKS);
        h.granularity.set('week');
        h.from.set('2026-09-10');
        h.to.set('2026-10-14');
        h.panels.set([
          panel('flows', [line({ key: 'f', name: 'Created', values: [5, 6, 7, 8, 9, 2] })]),
          panel('backlog', [weekly]),
        ]);
      });
    });

    it('says per week, has no weekend shading and shows the Monday of each week on the axis', () => {
      expect(el.querySelectorAll('[data-per-week]').length).toBe(2);
      expect(el.querySelectorAll('rect.weekend').length).toBe(0);
      expect(el.textContent).not.toContain('Shaded: weekends');
      const ticks = Array.from(el.querySelectorAll('text[data-xtick]')).map((t) => text(t));
      expect(ticks[0]).toBe('Sep 7');
      expect(ticks[ticks.length - 1]).toBe('Oct 12');
      expect(text(el.querySelector('.foot'))).toContain('Each point is a week, Monday to Sunday');
      expect(text(el.querySelector('.foot'))).toContain('not replayed');
    });

    it('the current week is dotted and the tooltip, read-out and summary say Week of', () => {
      expect(el.querySelectorAll('polyline.partial').length).toBe(2);
      expect(el.textContent).toContain('Dotted: this week so far');
      const plot = el.querySelector<HTMLElement>('[data-plot]')!;
      plot.dispatchEvent(new FocusEvent('focus'));
      fixture.detectChanges();
      expect(text(el.querySelector('[data-tip-heading]'))).toBe('Week of Oct 12');
      expect(el.querySelector('[data-tip]')!.textContent).toContain('This week so far');
      expect(text(el.querySelector('[data-readout]'))).toContain('Week of Oct 12: 2 created');
      plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      fixture.detectChanges();
      expect(text(el.querySelector('[data-readout]'))).toContain(
        'Week of Oct 5: 9 created; Backlog at end of day: 140 open',
      );
      expect(plot.getAttribute('aria-label')).toContain('per week');
      expect(plot.getAttribute('aria-label')).toContain('Open 150 now');
    });

    it('the table has a Week column, week labels and links over the weeks cut to the period', async () => {
      await update((h) => h.asTable.set(true));
      expect(text(el.querySelector('thead th'))).toBe('Week');
      const rows = Array.from(el.querySelectorAll('tbody tr'));
      expect(text(rows[0].querySelector('th'))).toBe('Week of Sep 7');
      // The first week holds only 10 to 13 Sep of the period.
      expect(rows[0].querySelectorAll('a')[0].getAttribute('href')).toBe(
        '/tasks?createdFrom=2026-09-10&createdTo=2026-09-13',
      );
      expect(rows[2].querySelectorAll('a')[0].getAttribute('href')).toBe(
        '/tasks?createdFrom=2026-09-21&createdTo=2026-09-27',
      );
      // A stock is read at the end of its week; the current week is today: the queue's open filter.
      expect(rows[2].querySelectorAll('a')[1].getAttribute('href')).toBe(
        '/tasks?status=NEW&status=IN_PROGRESS&status=ON_HOLD&createdTo=2026-09-27',
      );
      expect(rows[5].querySelectorAll('a')[1].getAttribute('href')).toBe(
        '/tasks?status=NEW&status=IN_PROGRESS&status=ON_HOLD',
      );
    });
  });

  describe('phones (T8)', () => {
    it('draws the panels 16:9 and at least 220 px tall at the full width of a 375 px screen', async () => {
      let callback: ResizeObserverCallback = () => undefined;
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(cb: ResizeObserverCallback) {
            callback = cb;
          }
          observe(): void {
            /* the test drives the callback */
          }
          disconnect(): void {
            /* nothing to release */
          }
        },
      );
      try {
        await open();
        callback([{ contentRect: { width: 343 } } as ResizeObserverEntry], {} as ResizeObserver);
        fixture.detectChanges();
        expect(el.querySelector('svg.chart')!.getAttribute('viewBox')).toBe('0 0 343 220');
        callback([{ contentRect: { width: 480 } } as ResizeObserverEntry], {} as ResizeObserver);
        fixture.detectChanges();
        // 480 x 9 / 16 = 270.
        expect(el.querySelector('svg.chart')!.getAttribute('viewBox')).toBe('0 0 480 270');
        callback([{ contentRect: { width: 481 } } as ResizeObserverEntry], {} as ResizeObserver);
        fixture.detectChanges();
        expect(el.querySelector('svg.chart')!.getAttribute('viewBox')).toBe('0 0 481 320');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('a tap on a day shows the tooltip and keeps it after the finger lifts; a tap elsewhere or Escape dismisses it', async () => {
      await open();
      const host = el.querySelector<HTMLElement>('[data-panel-plot=flows]')!;
      const svg = host.querySelector('svg')!;
      svg.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width: 640,
        height: 320,
        right: 640,
        bottom: 320,
        x: 0,
        y: 0,
        toJSON: () => '',
      });
      const at = (type: string, x: number, pointerType = 'touch') => {
        const e = new Event(type, { bubbles: true });
        Object.assign(e, { clientX: x, clientY: 100, pointerType });
        host.dispatchEvent(e);
      };
      at('pointerdown', 40); // the first day (the plot starts at the axis)
      fixture.detectChanges();
      expect(el.querySelector('[data-tip]')!.textContent).toContain('Thu, Oct 1');
      at('pointerleave', 40);
      fixture.detectChanges();
      expect(el.querySelector('[data-tip]')).not.toBeNull();
      // A tap outside the chart dismisses it.
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      fixture.detectChanges();
      expect(el.querySelector('[data-tip]')).toBeNull();
      // A mouse still hides it when it leaves.
      at('pointermove', 40, 'mouse');
      fixture.detectChanges();
      expect(el.querySelector('[data-tip]')).not.toBeNull();
      at('pointerleave', 40, 'mouse');
      fixture.detectChanges();
      expect(el.querySelector('[data-tip]')).toBeNull();
    });
  });
});
