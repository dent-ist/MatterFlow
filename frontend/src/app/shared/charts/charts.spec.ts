import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BarChart } from './bar-chart';
import { ChartPanel, MAX_BARS } from './chart-panel';
import { ChartTable } from './chart-table';
import { ColumnChart } from './column-chart';
import { ChartKind, ChartRow, ChartSlice } from './chart-types';
import { PieChart } from './pie-chart';

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

const row = (label: string, value: number, link = false): ChartRow => ({
  label,
  value,
  link: link ? { commands: ['/assets'], queryParams: { disposition: label } } : null,
});

@Component({
  imports: [ChartPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-chart-panel
    heading="Assets by disposition"
    labelHeader="Disposition"
    valueHeader="Assets"
    unit="assets"
    [rows]="rows()"
    [(kind)]="kind"
    [showShare]="true"
  />`,
})
class PanelHost {
  rows = signal<ChartRow[]>([
    row('Active', 12, true),
    row('Pending disposition', 3),
    row('Disposed', 1),
  ]);
  kind = signal<ChartKind>('table');
}

describe('ChartPanel', () => {
  let fixture: ComponentFixture<PanelHost>;
  let host: PanelHost;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fixture = TestBed.createComponent(PanelHost);
    host = fixture.componentInstance;
    await settle(fixture);
  });

  it('starts as a table with caption, header scopes, a share column and a total', () => {
    expect(q('table').querySelector('caption')!.textContent).toContain('Assets by disposition');
    expect(
      Array.from(el().querySelectorAll('thead th')).map((h) => h.getAttribute('scope')),
    ).toEqual(['col', 'col', 'col']);
    expect(el().querySelectorAll('tbody tr')).toHaveLength(3);
    expect(q('[data-table-total]').textContent!.trim()).toBe('16');
    expect(el().textContent).toContain('75%');
    expect(q('[data-show-table]').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows a pie with patterns, then a bar, and goes back to the table', async () => {
    q<HTMLButtonElement>('[data-show-pie]').click();
    await settle(fixture);
    expect(host.kind()).toBe('pie');
    expect(el().querySelector('mf-pie-chart svg')).not.toBeNull();
    expect(el().querySelectorAll('[data-slice]')).toHaveLength(3);
    expect(el().querySelectorAll('[data-slice-pattern]')).toHaveLength(2); // slot 0 is solid
    expect(el().querySelector('table')).toBeNull();

    q<HTMLButtonElement>('[data-show-bar]').click();
    await settle(fixture);
    expect(el().querySelectorAll('[data-bar]')).toHaveLength(3);
    expect(el().querySelector('[data-bar] .value')!.textContent).toContain('12');

    q<HTMLButtonElement>('[data-show-table]').click();
    await settle(fixture);
    expect(el().querySelector('table')).not.toBeNull();
    expect(el().querySelector('mf-bar-chart')).toBeNull();
  });

  it('offers no chart for values below zero or a total of zero and says so', async () => {
    host.rows.set([row('A', -1), row('B', 2)]);
    await settle(fixture);
    expect(q<HTMLButtonElement>('[data-show-pie]').disabled).toBe(true);
    expect(q<HTMLButtonElement>('[data-show-bar]').disabled).toBe(true);
    expect(q('[data-chart-unavailable]').textContent).toContain('values of zero or more');
    host.rows.set([row('A', 0)]);
    await settle(fixture);
    expect(q<HTMLButtonElement>('[data-show-pie]').disabled).toBe(true);
  });

  it('falls back to the table when the data stops being chartable while a chart is shown', async () => {
    host.kind.set('pie');
    await settle(fixture);
    expect(el().querySelector('mf-pie-chart')).not.toBeNull();
    host.rows.set([row('A', -3)]);
    await settle(fixture);
    expect(el().querySelector('table')).not.toBeNull();
    expect(el().querySelector('mf-pie-chart')).toBeNull();
  });

  it('combines the small rows of a long list as Other in the pie and the bars, and says so', async () => {
    host.rows.set(Array.from({ length: 30 }, (_, i) => row(`Group ${i}`, 100 - i)));
    host.kind.set('pie');
    await settle(fixture);
    expect(el().querySelectorAll('[data-slice]')).toHaveLength(8);
    expect(q('[data-pie-other]').textContent).toContain('largest 7');
    expect(el().textContent).toContain('Other');

    host.kind.set('bar');
    await settle(fixture);
    expect(el().querySelectorAll('[data-bar]')).toHaveLength(MAX_BARS);
    expect(q('[data-bar-other]').textContent).toContain('largest 24');
  });
});

describe('BarChart', () => {
  it('scales every bar to the largest value, writes the value at its end and links a row', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(BarChart);
    fixture.componentRef.setInput('heading', 'Size');
    fixture.componentRef.setInput('unit', 'GB');
    fixture.componentRef.setInput('rows', [row('Big', 50, true), row('Small', 5), row('None', 0)]);
    await settle(fixture);
    const fills = Array.from(fixture.nativeElement.querySelectorAll('.fill')) as HTMLElement[];
    expect(fills.map((f) => f.style.width)).toEqual(['100%', '10%', '0%']);
    const values = Array.from(fixture.nativeElement.querySelectorAll('.value')).map((v) =>
      (v as HTMLElement).textContent!.trim(),
    );
    expect(values).toEqual(['50', '5', '0']);
    const link = fixture.nativeElement.querySelector('a.link') as HTMLAnchorElement;
    expect(link.getAttribute('aria-label')).toBe('Big: 50 GB');
    expect(fixture.nativeElement.querySelector('.track')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('says so when there is nothing to draw', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(BarChart);
    fixture.componentRef.setInput('heading', 'Size');
    fixture.componentRef.setInput('rows', []);
    fixture.componentRef.setInput('emptyText', 'No assets.');
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[data-bars-empty]').textContent).toContain(
      'No assets.',
    );
  });
});

describe('ChartTable', () => {
  it('hides the total row when its label is empty (an average has no total) and formats values', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ChartTable);
    fixture.componentRef.setInput('caption', 'Average size');
    fixture.componentRef.setInput('rows', [row('A', 1234.5)]);
    fixture.componentRef.setInput('totalLabel', '');
    fixture.componentRef.setInput('format', (v: number) => `${v.toFixed(1)} GB`);
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('tfoot')).toBeNull();
    expect(fixture.nativeElement.querySelector('tbody td').textContent).toContain('1234.5 GB');
    expect(fixture.nativeElement.querySelector('[role=region]').getAttribute('tabindex')).toBe('0');
  });
});

describe('PieChart', () => {
  const slices: ChartSlice[] = [
    { label: 'Active', count: 12, link: { commands: ['/assets'] }, fill: '#0072B2', outline: null },
    { label: 'Disposed', count: 4, overdue: 1, link: null, fill: '#C2410C', outline: null },
  ];

  it('has no pattern overlays unless asked, and gives the SVG a text summary with the secondary part', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(PieChart);
    fixture.componentRef.setInput('heading', 'Disposition');
    fixture.componentRef.setInput('slices', slices);
    fixture.componentRef.setInput('unit', 'assets');
    fixture.componentRef.setInput('secondaryLabel', 'flagged');
    await settle(fixture);
    expect(fixture.nativeElement.querySelectorAll('[data-slice-pattern]')).toHaveLength(0);
    const label = fixture.nativeElement.querySelector('svg').getAttribute('aria-label') as string;
    expect(label).toContain('Disposition, pie chart: Active 12 (75%); Disposed 4 (25%)');
    expect(label).toContain('16 assets, 1 flagged');
    expect(fixture.nativeElement.querySelector('[data-pie-centre]').textContent).toContain('16');
  });
});

describe('ColumnChart', () => {
  async function make(rows: ChartRow[]): Promise<ComponentFixture<ColumnChart>> {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(ColumnChart);
    fixture.componentRef.setInput('heading', 'Size held');
    fixture.componentRef.setInput('unit', 'GB');
    fixture.componentRef.setInput('rows', rows);
    await settle(fixture);
    return fixture;
  }

  it('scales the columns to the largest value, labels about four months and ends on the last', async () => {
    const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
    const fixture = await make(labels.map((l, i) => row(l, (i + 1) * 5)));
    const bars = Array.from(fixture.nativeElement.querySelectorAll('.cc__bar')) as HTMLElement[];
    expect(bars).toHaveLength(8);
    expect(bars[7].style.height).toBe('100%');
    expect(bars[0].style.height).toBe('12.5%');
    const shown = Array.from(fixture.nativeElement.querySelectorAll('.cc__label'))
      .map((l) => (l as HTMLElement).textContent!.trim())
      .filter(Boolean);
    expect(shown).toEqual(['Feb', 'Apr', 'Jun', 'Aug']);
    expect(fixture.nativeElement.querySelector('.cc__top').textContent).toContain('Highest 40');
  });

  it('gives a screen reader one sentence instead of the decorative columns', async () => {
    const fixture = await make([row('Jan', 10), row('Feb', 30), row('Mar', 20)]);
    const summary = fixture.nativeElement.querySelector('[data-columns-summary]') as HTMLElement;
    expect(summary.textContent).toContain('from Jan (10 GB) to Mar (20 GB); highest Feb (30 GB)');
    expect(fixture.nativeElement.querySelector('.cc__cols').getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('draws nothing but says so when every value is zero or there are no months', async () => {
    const zero = await make([row('Jan', 0), row('Feb', 0)]);
    expect((zero.nativeElement.querySelector('.cc__bar') as HTMLElement).style.height).toBe('0%');
    const none = await make([]);
    expect(none.nativeElement.querySelector('[data-columns-empty]')).not.toBeNull();
  });
});
