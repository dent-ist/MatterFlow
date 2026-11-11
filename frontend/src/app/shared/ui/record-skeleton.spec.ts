import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RecordSkeleton, recordTabLabel, recordTabs } from './record-skeleton';
import { RecordKind } from './record-state';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RecordSkeleton],
  template: `<mf-record-skeleton
    [kind]="kind()"
    [activeTab]="tab()"
    [foldHeader]="fold()"
    [assetStrip]="strip()"
    (retry)="retried = retried + 1"
  />`,
})
class Host {
  readonly kind = signal<RecordKind>('client');
  readonly tab = signal('details');
  readonly fold = signal(false);
  readonly strip = signal(false);
  retried = 0;
}

const noIcon = (tabs: object[]) =>
  tabs.map((t) => {
    const copy: Record<string, unknown> = { ...t };
    delete copy['icon'];
    return copy;
  });

describe('mf-record-skeleton (#247, #615)', () => {
  it('adds "Still loading... Retry" after 8 seconds and Retry is the page\'s own request again', async () => {
    vi.useFakeTimers();
    try {
      TestBed.configureTestingModule({ providers: [provideRouter([])] });
      const fixture = TestBed.createComponent(Host);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-still-loading]')).toBeNull();
      vi.advanceTimersByTime(8000);
      fixture.detectChanges();
      expect(el.querySelector('[data-still-loading]')!.textContent).toContain('Still loading...');
      // Outside the inert skeleton, so it can be reached with the keyboard.
      expect(el.querySelector('[inert] [data-still-loading-retry]')).toBeNull();
      el.querySelector<HTMLButtonElement>('[data-still-loading-retry]')!.click();
      expect(fixture.componentInstance.retried).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

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

  it('draws My profile (#532): the two columns of cards, no header and no tabs, "Loading profile"', async () => {
    const el = await render('profile');
    expect(el.querySelector('[data-profile-skeleton]')).not.toBeNull();
    expect(el.querySelectorAll('.rk__pf-col')).toHaveLength(2);
    expect(el.querySelectorAll('.rk__card').length).toBe(7); // the Holidays and Out of Office boxes are drawn too
    expect(el.querySelector('[data-record-header], mf-tabs')).toBeNull();
    expect(el.querySelector('[role=status]')?.textContent).toContain('Loading profile');
  });

  it('draws a matter with the real tab labels and -- for the counts', async () => {
    const el = await render('matter', 'projects');
    expect(el.querySelector('[role=status]')?.textContent).toContain('Loading matter');
    expect(labels(el)).toEqual([
      'Summary',
      'Tasks (--)',
      'Projects (--)',
      'Assets (--)',
      'Productions',
      'Notes',
      'Team (--)',
      'Activities',
    ]);
    expect(el.querySelector('[role=tab][aria-selected=true]')?.textContent).toContain('Projects');
  });

  it('keeps the room of the asset strip on the matter Summary tab, only when the person sees assets (#1367)', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.kind.set('matter');
    fixture.componentInstance.tab.set('summary');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-assets-skeleton]')).toBeNull();
    fixture.componentInstance.strip.set(true);
    await fixture.whenStable();
    expect(el.querySelector('[data-assets-skeleton]')).not.toBeNull();
    fixture.componentInstance.tab.set('tasks');
    await fixture.whenStable();
    expect(el.querySelector('[data-assets-skeleton]')).toBeNull();
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
    expect(labels(el)).toEqual(['Overview', 'Workflows (--)', 'Request Form']);
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
    expect(el.querySelector('nav a')?.textContent).toContain('Task Queue');
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
    expect(noIcon(recordTabs('client', { matters: 63 }))).toEqual([
      { key: 'details', label: 'Overview' },
      { key: 'matters', label: 'Matters', count: 63 },
    ]);
    expect(recordTabs('matter', { tasks: 3, projects: 40, assets: 6 })).toEqual([
      { key: 'summary', label: 'Summary', icon: 'pi-home' },
      { key: 'tasks', label: 'Tasks', icon: 'pi-check-square', count: 3 },
      { key: 'projects', label: 'Projects', icon: 'pi-folder', count: 40 },
      { key: 'assets', label: 'Assets', icon: 'pi-database', count: 6 },
      { key: 'productions', label: 'Productions', icon: 'pi-send' },
      { key: 'notes', label: 'Notes', icon: 'pi-file-edit' },
      { key: 'team', label: 'Team', icon: 'pi-address-book', count: 0 },
      { key: 'activities', label: 'Activities', icon: 'pi-history' },
    ]);
    expect(recordTabLabel('matter', 'tasks')).toBe('Tasks');
    expect(recordTabLabel('client', 'nonsense')).toBe('Overview');
  });

  it('draws no matter header when the Notes height choice is folded, but keeps the tab strip (#1342)', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.kind.set('matter');
    fixture.componentInstance.tab.set('notes');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-matter-header-skeleton]')).not.toBeNull();
    fixture.componentInstance.fold.set(true);
    await fixture.whenStable();
    expect(el.querySelector('[data-matter-header-skeleton]')).toBeNull();
    expect(el.querySelectorAll('[role=tab]').length).toBeGreaterThan(0);
  });
});
