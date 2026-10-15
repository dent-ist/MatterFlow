import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { TrendChart, niceMax } from './trend-chart';
import { ALL_STYLE, ChartLine, MEASURE_STYLES, TYPE_STYLES } from './trend-model';

function line(partial: Partial<ChartLine> & Pick<ChartLine, 'key' | 'name' | 'values'>): ChartLine {
  return {
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

@Component({
  imports: [TrendChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-trend-chart
    heading="Tasks created and completed per day"
    [dates]="dates()"
    [lines]="lines()"
    [asTable]="asTable()"
    [measureNote]="note()"
  />`,
})
class Host {
  dates = signal<readonly string[]>(DATES);
  lines = signal<readonly ChartLine[]>([CREATED, COMPLETED]);
  asTable = signal(false);
  note = signal<string | null>(null);
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

  it('rounds the axis up to a readable top', () => {
    expect([0, 1, 3, 7, 12, 40, 101, 4800].map(niceMax)).toEqual([1, 1, 5, 10, 20, 50, 200, 5000]);
  });

  describe('default two-line chart', () => {
    beforeEach(() => open());

    it('draws a chart with a text summary and two differently styled lines and markers', () => {
      const plot = el.querySelector('[data-plot]')!;
      expect(plot.getAttribute('aria-roledescription')).toBe('chart');
      expect(plot.getAttribute('aria-label')).toContain('Created 7 created, Completed 5 completed');
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
      vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        width: 360,
        top: 0,
        height: 190,
      } as DOMRect);
      plot.dispatchEvent(
        Object.assign(new Event('pointermove', { bubbles: true }), { clientX: 188 }),
      );
      fixture.detectChanges();
      expect(el.querySelector('[data-tip]')!.textContent).toContain('Fri, Oct 2');

      // The day is taken from the drawing itself: a drawing that sits to the right of the left edge of its box (offset 220 px) maps
      // the pointer over ITS middle (x = 220 + 180) to the middle day, not the pointer over the middle of the box.
      plot.dispatchEvent(new Event('pointerleave'));
      fixture.detectChanges();
      vi.spyOn(plot.querySelector('svg')!, 'getBoundingClientRect').mockReturnValue({
        left: 220,
        width: 360,
        top: 0,
        height: 190,
      } as DOMRect);
      plot.dispatchEvent(
        Object.assign(new Event('pointermove', { bubbles: true }), { clientX: 400 }),
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
      await update((h) => h.lines.set([]));
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
        h.lines.set([ALL, ALPHA, BETA]);
        h.note.set('Created');
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
      expect(top()).toBe(10);
      await update((h) => h.lines.set([BETA]));
      expect(top()).toBe(2);
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
      await open();
      await update((h) => {
        h.lines.set([OVERDUE, LATE]);
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
    it('draws about eight markers per line instead of one per day', async () => {
      await open();
      const dates = Array.from({ length: 90 }, (_, i) => {
        const d = new Date(Date.UTC(2026, 6, 1 + i));
        return d.toISOString().slice(0, 10);
      });
      await update((h) => {
        h.dates.set(dates);
        h.lines.set([line({ key: 'a', name: 'A', values: dates.map((_, i) => i % 7) })]);
      });
      expect(el.querySelectorAll('path.marker').length).toBe(8);
    });
  });
});
