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
    expect(labels(el)).toEqual(['Details', 'Matters']);
    expect(el.querySelectorAll('.rk__row')).toHaveLength(5);
  });

  it('draws a matter with the real tab labels and -- for the counts', async () => {
    const el = await render('matter', 'projects');
    expect(el.querySelector('[role=status]')?.textContent).toContain('Loading matter');
    expect(labels(el)).toEqual(['Details', 'Tasks (--)', 'Projects (--)', 'Assets']);
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

  it('selects the first tab of a project for a tab it does not have', async () => {
    const el = await render('project', 'nonsense');
    expect(el.querySelector('[role=tab][aria-selected=true]')?.textContent).toContain('Tasks');
  });

  it('hides the bars from assistive technology and from the keyboard', async () => {
    const el = await render('matter');
    const visual = el.querySelector('.rk__vis')!;
    expect(visual.getAttribute('aria-hidden')).toBe('true');
    expect(visual.hasAttribute('inert')).toBe(true);
  });

  it('builds the tab strips the pages use, so the labels cannot drift', () => {
    expect(recordTabs('client').map((t) => t.label)).toEqual(['Details', 'Matters']);
    expect(recordTabs('matter', { tasks: 3, projects: 40 })).toEqual([
      { key: 'details', label: 'Details' },
      { key: 'tasks', label: 'Tasks', count: 3 },
      { key: 'projects', label: 'Projects', count: 40 },
      { key: 'assets', label: 'Assets' },
    ]);
    expect(recordTabLabel('matter', 'tasks')).toBe('Tasks');
    expect(recordTabLabel('client', 'nonsense')).toBe('Details');
  });
});
