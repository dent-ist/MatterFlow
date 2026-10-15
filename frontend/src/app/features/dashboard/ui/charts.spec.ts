import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardTrendPoint } from '../../../api/generated/api-client';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { BarItem, BarList, sharePercent } from './bar-list';
import { AGE_RAMP, Segment, StackedBar } from './stacked-bar';
import { StatTile } from './stat-tile';
import { TrendChart, niceMax } from './trend-chart';

function rgbOf(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
function toRgb(hex: string): string {
  return `rgb(${rgbOf(hex).join(', ')})`;
}

@Component({
  imports: [BarList, StackedBar, TrendChart, StatTile],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-bar-list heading="Open by priority" rowHeading="Priority" [items]="bars" />
    <mf-stacked-bar heading="Age of open tasks" rowHeading="Age" [segments]="segments" />
    <mf-trend-chart
      heading="Created and completed per day"
      [points]="points"
      createdQuery="createdFrom=2026-10-01"
      completedQuery="status=COMPLETED&completedFrom=2026-10-01"
    />
    <mf-stat-tile
      label="Overdue"
      tone="danger"
      icon="pi-exclamation-circle"
      [value]="value"
      query="overdue=true"
    />
  `,
})
class Host {
  value = 9;
  bars: BarItem[] = [
    {
      label: 'Critical',
      count: 6,
      query: 'priority=1',
      fill: 'var(--mf-pr-critical-bg)',
      outline: 'var(--mf-pr-critical-fg)',
    },
    { label: 'High', count: 3, query: 'priority=2' },
    { label: 'Low', count: 0, query: 'priority=4' },
  ];
  segments: Segment[] = [
    { label: '0-2 days', count: 30, query: 'createdFrom=2026-10-12' },
    { label: '3-7 days', count: 0, query: 'createdFrom=2026-10-07' },
    { label: '8-14 days', count: 10, query: 'createdFrom=2026-09-30' },
    { label: '15+ days', count: 60, query: 'createdTo=2026-09-29' },
  ];
  points: DashboardTrendPoint[] = [
    { date: '2026-10-01', created: 2, completed: 0 },
    { date: '2026-10-02', created: 5, completed: 4 },
    { date: '2026-10-03', created: 0, completed: 1 },
  ];
}

describe('dashboard charts', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: USER_TIME_ZONE, useValue: 'UTC' }],
    });
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  });

  it('formats a share of the total as a whole percent, "<1%" for a sliver', () => {
    expect(sharePercent(1, 4)).toBe('25%');
    expect(sharePercent(1, 1000)).toBe('<1%');
    expect(sharePercent(0, 10)).toBe('0%');
    expect(sharePercent(5, 0)).toBe('0%');
  });

  describe('bar list', () => {
    it('sizes each bar against the longest one and shows the share of the total as text', () => {
      const rows = Array.from(el.querySelectorAll('mf-bar-list li'));
      expect(rows.map((r) => r.querySelector('.pct')!.textContent)).toEqual(['67%', '33%', '0%']);
      expect(rows[0].querySelector<HTMLElement>('.bar')!.style.width).toBe('100%');
      expect(rows[1].querySelector<HTMLElement>('.bar')!.style.width).toBe('50%');
    });

    it('colours a bar with the given fill and outline, e.g. the priority badge colours', () => {
      const bar = el.querySelector<HTMLElement>('mf-bar-list li .bar')!;
      expect(bar.style.background).toContain('--mf-pr-critical-bg');
      expect(bar.style.borderColor).toContain('--mf-pr-critical-fg');
    });

    it('adds the share to the table view', () => {
      el.querySelector<HTMLButtonElement>('mf-bar-list .toggle')!.click();
      fixture.detectChanges();
      expect(
        Array.from(el.querySelectorAll('mf-bar-list thead th')).map((h) => h.textContent),
      ).toEqual(['Priority', 'Tasks', 'Share']);
      expect(el.querySelector('mf-bar-list tbody tr td:last-child')!.textContent).toBe('67%');
    });
  });

  describe('stacked bar', () => {
    it('draws one linked segment per non-empty band, sized by count, with the meaning in text', () => {
      const segs = Array.from(el.querySelectorAll<HTMLAnchorElement>('mf-stacked-bar .seg'));
      expect(segs.length).toBe(3);
      expect(segs.map((s) => s.getAttribute('aria-label'))).toEqual([
        '0-2 days: 30 tasks, 30%',
        '8-14 days: 10 tasks, 10%',
        '15+ days: 60 tasks, 60%',
      ]);
      expect(segs[2].getAttribute('href')).toBe('/tasks?createdTo=2026-09-29');
      expect(segs[0].style.flexGrow).toBe('30');
    });

    it('colours the bands as one blue scale from light to dark, with readable text on each', () => {
      const segs = Array.from(el.querySelectorAll<HTMLAnchorElement>('mf-stacked-bar .seg'));
      const fills = segs.map((s) => s.style.background);
      // 0-2, 8-14 and 15+ days are shown: the first, third and fourth steps of the ramp, never green, amber or red.
      expect(fills).toEqual([AGE_RAMP[0].bg, AGE_RAMP[2].bg, AGE_RAMP[3].bg].map(toRgb));
      expect(segs.map((s) => s.style.color)).toEqual(
        [AGE_RAMP[0].fg, AGE_RAMP[2].fg, AGE_RAMP[3].fg].map(toRgb),
      );
      for (const band of AGE_RAMP) {
        const [r, g, b] = rgbOf(band.bg);
        expect(b, band.bg).toBeGreaterThan(r); // blue-dominant
        expect(b, band.bg).toBeGreaterThanOrEqual(g);
      }
    });

    it('lists every band in a legend with label, count and percent (also the empty one)', () => {
      const rows = Array.from(el.querySelectorAll('mf-stacked-bar .legend li'));
      expect(
        rows.map((r) =>
          Array.from(r.querySelectorAll('span:not(.swatch)'))
            .map((c) => c.textContent)
            .join(' | '),
        ),
      ).toEqual([
        '0-2 days | 30 | 30%',
        '3-7 days | 0 | 0%',
        '8-14 days | 10 | 10%',
        '15+ days | 60 | 60%',
      ]);
      expect(rows[0].querySelector('a')!.getAttribute('aria-label')).toBe(
        '0-2 days: 30 tasks, 30%',
      );
    });

    it('is available as a table', () => {
      el.querySelector<HTMLButtonElement>('mf-stacked-bar .toggle')!.click();
      fixture.detectChanges();
      expect(el.querySelectorAll('mf-stacked-bar tbody tr').length).toBe(4);
      expect(el.querySelector('mf-stacked-bar .stack')).toBeNull();
    });
  });

  describe('trend chart', () => {
    it('draws a chart with a text summary and two differently styled series', () => {
      const plot = el.querySelector('mf-trend-chart [data-plot]')!;
      expect(plot.getAttribute('aria-roledescription')).toBe('chart');
      expect(plot.getAttribute('aria-label')).toContain('7 created, 5 completed');
      expect(plot.getAttribute('tabindex')).toBe('0');
      const svg = plot.querySelector('svg.chart')!;
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.querySelectorAll('polyline').length).toBe(2);
      expect(svg.querySelector('polyline.s-completed')).not.toBeNull();
      // Circles for created, squares for completed: not colour alone.
      expect(svg.querySelectorAll('circle.m-created').length).toBe(3);
      expect(svg.querySelectorAll('rect.m-completed').length).toBe(3);
    });

    it('shows the values of a day on hover and with the arrow keys, announcing keyboard moves', () => {
      const plot = el.querySelector<HTMLElement>('mf-trend-chart [data-plot]')!;
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
      expect(el.querySelectorAll('mf-trend-chart rect.weekend').length).toBe(1);
      expect(el.textContent).toContain('Shaded: weekends');
      expect(el.querySelector('mf-trend-chart polyline.partial')).toBeNull();
      expect(el.textContent).not.toContain('Dotted: today so far');
    });

    it('links the legend totals to the queue', () => {
      const created = el.querySelector<HTMLAnchorElement>('[data-legend="created"]')!;
      expect(created.textContent!.replace(/\s+/g, ' ').trim()).toBe('Created 7');
      expect(created.getAttribute('href')).toBe('/tasks?createdFrom=2026-10-01');
      expect(el.querySelector('[data-legend="completed"]')!.getAttribute('href')).toBe(
        '/tasks?status=COMPLETED&completedFrom=2026-10-01',
      );
    });

    it('offers every day as a table whose counts link to that day', () => {
      el.querySelector<HTMLButtonElement>('mf-trend-chart .toggle')!.click();
      fixture.detectChanges();
      const rows = Array.from(el.querySelectorAll('mf-trend-chart tbody tr'));
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
      expect(el.querySelector('mf-trend-chart svg.chart')).toBeNull();
    });

    it('rounds the axis up to a readable top', () => {
      expect([0, 1, 3, 7, 12, 40, 101, 4800].map(niceMax)).toEqual([
        1, 1, 5, 10, 20, 50, 200, 5000,
      ]);
    });
  });

  describe('trend chart with today in it', () => {
    it('draws the last segment dotted and says today is a partial day', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: USER_TIME_ZONE, useValue: 'UTC' },
          { provide: Clock, useValue: { now: () => new Date('2026-10-03T15:00:00Z') } },
        ],
      });
      const f = TestBed.createComponent(Host);
      f.detectChanges();
      await f.whenStable();
      const root = f.nativeElement as HTMLElement;
      expect(root.querySelectorAll('mf-trend-chart polyline.partial').length).toBe(2);
      expect(root.textContent).toContain('Dotted: today so far');
      // The solid lines stop the day before.
      const solid = root.querySelector('mf-trend-chart polyline.s-created:not(.partial)')!;
      expect(solid.getAttribute('points')!.split(' ').length).toBe(2);
      const plot = root.querySelector<HTMLElement>('mf-trend-chart [data-plot]')!;
      plot.dispatchEvent(new FocusEvent('focus'));
      f.detectChanges();
      expect(root.querySelector('[data-tip]')!.textContent).toContain('Today so far');
    });
  });

  describe('stat tile', () => {
    it('tints and marks a needs-attention tile only while the number is above zero', async () => {
      const link = () => el.querySelector<HTMLElement>('mf-stat-tile a')!;
      expect(link().getAttribute('data-tone')).toBe('danger');
      expect(link().querySelector('.pi-exclamation-circle')).not.toBeNull();
      fixture.componentInstance.value = 0;
      fixture = TestBed.createComponent(Host);
      fixture.componentInstance.value = 0;
      fixture.detectChanges();
      await fixture.whenStable();
      // At zero the tile is calm: no tint, and no link to an empty list.
      expect(fixture.nativeElement.querySelector('mf-stat-tile a')).toBeNull();
      expect(
        fixture.nativeElement.querySelector('mf-stat-tile [data-zero]').getAttribute('data-tone'),
      ).toBeNull();
    });
  });
});
