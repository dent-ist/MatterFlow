import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RecordSkeleton, recordTabLabel, recordTabs } from './record-skeleton';
import { RecordKind } from './record-state';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RecordSkeleton],
  template: `<mf-record-skeleton [kind]="kind()" [activeTab]="tab()" />`,
})
class Host {
  readonly kind = signal<RecordKind>('client');
  readonly tab = signal('details');
}

describe('mf-record-skeleton (#247)', () => {
  async function render(kind: RecordKind, tab = 'details') {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.kind.set(kind);
    fixture.componentInstance.tab.set(tab);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }
  const labels = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[role=tab]')).map((t) => t.textContent!.trim());

  it('draws a client: crumb with a bar, real tab labels, five 44 px rows, one polite message', async () => {
    const el = await render('client');
    expect(el.querySelector('[data-record-skeleton]')?.getAttribute('aria-busy')).toBe('true');
    expect(el.querySelectorAll('[role=status]')).toHaveLength(1);
    expect(el.querySelector('[role=status]')?.textContent).toContain('Loading client');
    expect(el.querySelector('nav a')?.textContent).toContain('Clients');
    expect(el.querySelectorAll('[data-crumb-skeleton]')).toHaveLength(1);
    expect(labels(el)).toEqual(['Overview', 'Matters (--)']);
    expect(el.querySelectorAll('.rk__row')).toHaveLength(5);
  });

  it('draws a matter with the real tab labels and -- for the counts', async () => {
    const el = await render('matter', 'projects');
    expect(el.querySelector('[role=status]')?.textContent).toContain('Loading matter');
    expect(labels(el)).toEqual(['Overview', 'Tasks (--)', 'Projects (--)', 'Assets (--)']);
    expect(el.querySelector('[role=tab][aria-selected=true]')?.textContent).toContain('Projects');
  });

  it('draws a project with Tasks first (count --) and Details', async () => {
    const el = await render('project', 'details');
    expect(labels(el)).toEqual(['Tasks (--)', 'Details']);
    expect(el.querySelector('[role=tab][aria-selected=true]')?.textContent).toContain('Details');
    expect(el.querySelector('mf-detail-layout')).toBeNull();
    expect(el.querySelectorAll('[data-crumb-skeleton]')).toHaveLength(2);
    expect(el.querySelector('[role=status]')?.textContent).toContain('Loading project');
  });

  it('draws a task type (#380): Administration and Task Types crumbs, its three tabs, "Loading task type"', async () => {
    const el = await render('taskType', 'workflows');
    expect(el.querySelector('[role=status]')?.textContent).toContain('Loading task type');
    expect(labels(el)).toEqual(['Overview', 'Workflows (--)', 'Request form']);
    expect(el.querySelector('[role=tab][aria-selected=true]')?.textContent).toContain('Workflows');
    expect(el.querySelector('nav a')?.textContent).toContain('Task Types');
    expect(el.querySelector('nav')?.textContent).toContain('Administration');
  });

  it('selects the first tab of a project for a tab it does not have', async () => {
    const el = await render('project', 'nonsense');
    expect(el.querySelector('[role=tab][aria-selected=true]')?.textContent).toContain('Tasks');
  });

  it('draws a task: crumb with bars, title bar, facts strip, two columns, no tabs (#292)', async () => {
    const el = await render('task');
    expect(el.querySelector('[data-record-skeleton]')?.getAttribute('data-kind')).toBe('task');
    expect(el.querySelectorAll('[role=status]')).toHaveLength(1);
    expect(el.querySelector('[role=status]')?.textContent).toContain('Loading task');
    expect(el.querySelector('nav a')?.textContent).toContain('Tasks');
    expect(el.querySelectorAll('[data-crumb-skeleton]')).toHaveLength(2);
    expect(el.querySelector('[data-title-skeleton]')).not.toBeNull();
    // The same boxes as the page: the record header (back link, crumb, title row, context bar) and a facts strip of six tiles.
    expect(el.querySelector('[data-record-header][data-kind="task"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-facts-skeleton] .mf-facts__tile')).toHaveLength(6);
    expect(el.querySelector('mf-detail-layout')).not.toBeNull();
    expect(el.querySelector('[role=tab]')).toBeNull();
  });

  it('hides the bars from assistive technology and from the keyboard', async () => {
    const el = await render('matter');
    const visual = el.querySelector('.rk__vis')!;
    expect(visual.getAttribute('aria-hidden')).toBe('true');
    expect(visual.hasAttribute('inert')).toBe(true);
  });

  it('builds the tab strips the pages use, so the labels cannot drift', () => {
    expect(recordTabs('client', { matters: 63 })).toEqual([
      { key: 'details', label: 'Overview' },
      { key: 'matters', label: 'Matters', count: 63 },
    ]);
    expect(recordTabs('matter', { tasks: 3, projects: 40, assets: 6 })).toEqual([
      { key: 'details', label: 'Overview' },
      { key: 'tasks', label: 'Tasks', count: 3 },
      { key: 'projects', label: 'Projects', count: 40 },
      { key: 'assets', label: 'Assets', count: 6 },
    ]);
    expect(recordTabLabel('matter', 'tasks')).toBe('Tasks');
    expect(recordTabLabel('client', 'nonsense')).toBe('Overview');
  });
});
