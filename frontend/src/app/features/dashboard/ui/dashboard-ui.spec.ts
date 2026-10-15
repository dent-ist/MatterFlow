import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { BarItem, BarList } from './bar-list';
import { RecentTaskList } from './recent-task-list';
import { StatTile } from './stat-tile';

@Component({
  imports: [BarList, RecentTaskList, StatTile],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-stat-tile
      label="Unassigned"
      [value]="17"
      query="status=NEW&status=IN_PROGRESS&unassigned=true"
      caption="No person assigned"
    />
    <mf-bar-list heading="Open by Pod" rowHeading="Pod" [items]="items" />
    <mf-recent-task-list
      heading="Recently created"
      [tasks]="[
        {
          taskId: 5,
          taskNumber: 'TSK-1005',
          title: 'Process custodians',
          matterId: 1,
          matterRef: '00343-00012',
          matterName: 'Merger',
          status: 'NEW',
          statusLabel: 'New',
          atUtc: '2026-10-14T15:00:00Z',
        },
      ]"
    />
  `,
})
class Host {
  items: BarItem[] = [
    { label: 'Pod A', count: 40, query: 'status=NEW&pod=1' },
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
    expect(tile.getAttribute('aria-label')).toContain('Unassigned: 17');
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

  it('swaps the bars for a table of the same numbers', async () => {
    const el = await render();
    const toggle = () => el.querySelector<HTMLButtonElement>('mf-bar-list .toggle')!;
    expect(toggle().textContent).toContain('View as table');
    toggle().click();
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

  it('lists recent tasks with number, title, matter reference and a link to the task', async () => {
    const el = await render();
    const link = el.querySelector<HTMLAnchorElement>('mf-recent-task-list a')!;
    expect(link.getAttribute('href')).toBe('/tasks/5');
    expect(link.textContent).toContain('TSK-1005');
    expect(link.textContent).toContain('Process custodians');
    expect(link.textContent).toContain('00343-00012');
    expect(link.textContent).toContain('Oct 14, 2026');
  });

  it('draws no bar for a zero count, titles each label and names the table link by its list', async () => {
    const el = await render();
    const rows = Array.from(el.querySelectorAll('mf-bar-list li'));
    expect(rows[3].querySelector('.bar')).toBeNull();
    expect(rows[3].textContent).toContain('0');
    expect(rows[0].querySelector('.bar')).not.toBeNull();
    expect(rows[0].querySelector('.name')!.getAttribute('title')).toBe('Pod A');
    const toggle = el.querySelector('mf-bar-list .toggle')!;
    expect(toggle.textContent!.replace(/\s+/g, ' ').trim()).toBe('View as table for Open by Pod');
  });
});
