import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { BarItem, BarList } from './bar-list';
import { StatTile } from './stat-tile';

@Component({
  imports: [BarList, StatTile],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-stat-tile
      label="Unassigned"
      [value]="17"
      query="status=NEW&status=IN_PROGRESS&unassigned=true"
      caption="No person assigned"
      linkText="View unassigned tasks"
    />
    <mf-stat-tile
      label="Created by me"
      [value]="0"
      query="creator=9"
      linkText="View tasks I created"
    />
    <mf-bar-list heading="Open by Pod" rowHeading="Pod" [items]="items" />
  `,
})
class Host {
  items: BarItem[] = [
    { label: 'Pod A', count: 40, query: 'status=NEW&pod=1', iconKey: 'users' },
    { label: 'Pod B', count: 10, query: 'status=NEW&pod=2' },
    { label: 'Other Pods', count: 5, query: null, muted: true },
    { label: 'Empty Pod', count: 0, query: 'status=NEW&pod=3' },
  ];
}

describe('dashboard UI', () => {
  let fixture: ComponentFixture<Host>;

  async function render() {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: USER_TIME_ZONE, useValue: 'UTC' }],
    });
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders a tile as one link to the queue with the repeated filter parameters', async () => {
    const el = await render();
    const tile = el.querySelector<HTMLAnchorElement>('mf-stat-tile a')!;
    expect(tile.textContent).toContain('Unassigned');
    expect(tile.textContent).toContain('17');
    expect(tile.textContent).toContain('No person assigned');
    expect(tile.getAttribute('href')).toBe('/tasks?status=NEW&status=IN_PROGRESS&unassigned=true');
    // The accessible name is the visible content, so it contains what a voice-control user reads on screen (WCAG 2.5.3).
    expect(tile.getAttribute('aria-label')).toBeNull();
    expect(tile.textContent!.replace(/\s+/g, ' ')).toContain('View unassigned tasks');
  });

  it('renders a tile that counts zero as plain text, not as a link to an empty list', async () => {
    const el = await render();
    const tiles = el.querySelectorAll('mf-stat-tile');
    expect(tiles[1].querySelector('a')).toBeNull();
    expect(tiles[1].textContent).toContain('Created by me');
    expect(tiles[1].textContent).not.toContain('View tasks I created');
    expect(tiles[1].querySelector('[data-zero]')).not.toBeNull();
  });

  it('shows every bar with its label and number as text, linking only rows that have a query', async () => {
    const el = await render();
    const rows = Array.from(el.querySelectorAll('mf-bar-list li'));
    expect(
      rows.map((r) =>
        [r.querySelector('.name')?.textContent, r.querySelector('.count')?.textContent].join(' '),
      ),
    ).toEqual(['Pod A 40', 'Pod B 10', 'Other Pods 5', 'Empty Pod 0']);
    expect(rows[0].querySelector('a')!.getAttribute('href')).toBe('/tasks?status=NEW&pod=1');
    expect(rows[2].querySelector('a')).toBeNull();
  });

  it('draws a task type icon before the label of a row that has one, in neutral colour', async () => {
    const el = await render();
    const rows = Array.from(el.querySelectorAll('mf-bar-list li'));
    const icon = rows[0].querySelector('mf-task-type-icon svg')!;
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.getAttribute('stroke')).toBe('currentColor');
    expect(rows[1].querySelector('mf-task-type-icon')).toBeNull();
  });

  it('scales the bars to the longest one and prints the share of the total beside them', async () => {
    const el = await render();
    const rows = Array.from(el.querySelectorAll('mf-bar-list li'));
    const widths = rows.map((r) => r.querySelector<HTMLElement>('.bar')?.style.width ?? null);
    // 40 is the longest (a full track), 10 is a quarter of it; the percentages stay shares of 55.
    expect(widths.slice(0, 2)).toEqual(['100%', '25%']);
    expect(rows.map((r) => r.querySelector('.pct')!.textContent)).toEqual([
      '73%',
      '18%',
      '9%',
      '0%',
    ]);
  });

  it('swaps the bars for a table of the same numbers', async () => {
    const el = await render();
    const toggle = () => el.querySelector<HTMLButtonElement>('mf-bar-list .toggle')!;
    expect(toggle().textContent).toContain('View as pie');
    toggle().click(); // bars -> pie
    fixture.detectChanges();
    expect(toggle().textContent).toContain('View as table');
    toggle().click(); // pie -> table
    fixture.detectChanges();
    const rows = Array.from(el.querySelectorAll('mf-bar-list tbody tr'));
    expect(
      rows.map((r) =>
        [
          r.querySelector('th')?.textContent?.trim(),
          r.querySelector('td')?.textContent?.trim(),
        ].join(' '),
      ),
    ).toEqual(['Pod A 40', 'Pod B 10', 'Other Pods 5', 'Empty Pod 0']);
    expect(el.querySelector('mf-bar-list .bars')).toBeNull();
    expect(toggle().textContent).toContain('View as bars');
  });

  it('draws no bar for a zero count, titles each label and names the table link by its list', async () => {
    const el = await render();
    const rows = Array.from(el.querySelectorAll('mf-bar-list li'));
    expect(rows[3].querySelector('.bar')).toBeNull();
    expect(rows[3].textContent).toContain('0');
    expect(rows[0].querySelector('.bar')).not.toBeNull();
    // Names wrap to two lines (three on a phone); the full name is the title, the link label and the table view.
    expect(rows[0].querySelector('.name')!.getAttribute('title')).toBe('Pod A');
    const toggle = el.querySelector('mf-bar-list .toggle')!;
    expect(toggle.textContent!.replace(/\s+/g, ' ').trim()).toBe('View as pie for Open by Pod');
  });
});
