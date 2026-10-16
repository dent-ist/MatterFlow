import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { BarItem, BarList, sharePercent } from './bar-list';
import { AGE_RAMP, Segment, StackedBar } from './stacked-bar';
import { StatTile } from './stat-tile';

function rgbOf(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
function toRgb(hex: string): string {
  return `rgb(${rgbOf(hex).join(', ')})`;
}

@Component({
  imports: [BarList, StackedBar, StatTile],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-bar-list heading="Open by priority" rowHeading="Priority" [items]="bars" />
    <mf-stacked-bar heading="Age of open tasks" rowHeading="Age" [segments]="segments" />
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
      overdue: 2,
    },
    { label: 'High', count: 3, query: 'priority=2', overdue: 0 },
    { label: 'Low', count: 0, query: 'priority=4' },
    { label: 'Other', count: 5, query: null, overdue: 2 },
  ];
  segments: Segment[] = [
    { label: '0-2 days', count: 30, query: 'createdFrom=2026-10-12', overdue: 6 },
    { label: '3-7 days', count: 0, query: 'createdFrom=2026-10-07' },
    { label: '8-14 days', count: 10, query: 'createdFrom=2026-09-30' },
    { label: '15-30 days', count: 60, query: 'createdFrom=2026-09-14&createdTo=2026-09-29' },
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
      expect(rows.map((r) => r.querySelector('.pct')!.textContent)).toEqual([
        '43%',
        '21%',
        '0%',
        '36%',
      ]);
      expect(rows[0].querySelector<HTMLElement>('.bar')!.style.width).toBe('100%');
      expect(rows[1].querySelector<HTMLElement>('.bar')!.style.width).toBe('50%');
    });

    it('colours a bar with the given fill and outline, e.g. the priority badge colours', () => {
      const bar = el.querySelector<HTMLElement>('mf-bar-list li .bar')!;
      expect(bar.style.background).toContain('--mf-pr-critical-bg');
      expect(bar.style.borderColor).toContain('--mf-pr-critical-fg');
    });

    it('adds the overdue count and the share to the table view', () => {
      el.querySelector<HTMLButtonElement>('mf-bar-list .toggle')!.click();
      fixture.detectChanges();
      expect(
        Array.from(el.querySelectorAll('mf-bar-list thead th')).map((h) => h.textContent),
      ).toEqual(['Priority', 'Tasks', 'Overdue', 'Share']);
      expect(el.querySelector('mf-bar-list tbody tr td:last-child')!.textContent).toBe('43%');
      const cells = Array.from(el.querySelectorAll('mf-bar-list tbody tr')).map((r) =>
        Array.from(r.querySelectorAll('td')).map((c) => c.textContent!.trim()),
      );
      expect(cells.map((c) => c[1])).toEqual(['2', '0', '0', '2']);
      // A row with overdue links to the queue with the row's filter plus overdue=true; none: plain 0.
      const links = Array.from(el.querySelectorAll('mf-bar-list tbody td a'));
      expect(links.map((a) => a.getAttribute('href'))).toEqual(['/tasks?priority=1&overdue=true']);
    });

    it('splits the bar into not overdue and overdue: the overdue segment is proportional, a link, and the row says "N overdue"', () => {
      const rows = Array.from(el.querySelectorAll<HTMLElement>('mf-bar-list li'));
      const od = rows[0].querySelector<HTMLElement>('.bar .od')!;
      // 2 of 6 are overdue: a third of the bar.
      expect(parseFloat(od.style.width)).toBeCloseTo(33.33, 1);
      expect(od.getAttribute('href')).toBe('/tasks?priority=1&overdue=true');
      const text = rows[0].querySelector('.od-text')!;
      expect(text.textContent!.replace(/\s+/g, ' ').trim()).toBe('2 overdue in Critical');
      expect(text.getAttribute('href')).toBe('/tasks?priority=1&overdue=true');
      // Nothing overdue: a plain bar, no text. No query (the Other row): the text is there but is not a link.
      expect(rows[1].querySelector('.od')).toBeNull();
      expect(rows[1].querySelector('.od-text')).toBeNull();
      expect(rows[3].querySelector('.od-text')!.tagName).toBe('SPAN');
    });
  });

  describe('stacked bar', () => {
    it('draws one linked segment per non-empty band, sized by count, with the meaning in text', () => {
      const segs = Array.from(el.querySelectorAll<HTMLElement>('mf-stacked-bar .seg'));
      const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('mf-stacked-bar .seglink'));
      expect(segs.length).toBe(3);
      // The segment is a list item with the meaning as its name; its link is a mouse target (the legend row is the keyboard link).
      expect(
        links.every((l) => l.getAttribute('aria-hidden') === 'true' && l.tabIndex === -1),
      ).toBe(true);
      expect(segs.map((s) => s.getAttribute('aria-label'))).toEqual([
        '0-2 days: 30 tasks, 30%',
        '8-14 days: 10 tasks, 10%',
        '15-30 days: 60 tasks, 60%',
      ]);
      expect(links[2].getAttribute('href')).toBe(
        '/tasks?createdFrom=2026-09-14&createdTo=2026-09-29',
      );
      expect(segs[0].style.flexGrow).toBe('30');
    });

    it('colours the bands as one blue scale from light to dark, with readable text on each', () => {
      const segs = Array.from(el.querySelectorAll<HTMLElement>('mf-stacked-bar .seg'));
      const fills = segs.map((s) => s.style.background);
      // 0-2, 8-14 and 15-30 days are shown: the first, third and fourth steps of the ramp, never green, amber or red.
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
          Array.from(r.querySelectorAll('.name, .count, .pct'))
            .map((c) => c.textContent)
            .join(' | '),
        ),
      ).toEqual([
        '0-2 days | 30 | 30%',
        '3-7 days | 0 | 0%',
        '8-14 days | 10 | 10%',
        '15-30 days | 60 | 60%',
      ]);
      expect(rows[0].querySelector('a')!.getAttribute('aria-label')).toBe(
        '0-2 days: 30 tasks, 30%',
      );
    });

    it('shows the overdue share of a band as a strip inside the band and as text in the legend', () => {
      const od = el.querySelector<HTMLElement>('mf-stacked-bar .seg .od')!;
      expect(parseFloat(od.style.width)).toBeCloseTo(20, 5);
      expect(od.getAttribute('href')).toBe('/tasks?createdFrom=2026-10-12&overdue=true');
      expect(el.querySelectorAll('mf-stacked-bar .seg .od').length).toBe(1);
      expect(el.querySelector('mf-stacked-bar .legend .od-text')!.textContent).toContain(
        '6 overdue',
      );
    });

    it('is available as a table', () => {
      el.querySelector<HTMLButtonElement>('mf-stacked-bar .toggle')!.click();
      fixture.detectChanges();
      expect(el.querySelectorAll('mf-stacked-bar tbody tr').length).toBe(4);
      expect(
        Array.from(el.querySelectorAll('mf-stacked-bar thead th')).map((h) => h.textContent),
      ).toEqual(['Age', 'Tasks', 'Overdue', 'Share']);
      expect(el.querySelector('mf-stacked-bar .stack')).toBeNull();
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
