import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EVENT_TYPES, EventIcon, eventType } from './event-type';
import { FilterChip, FilterChips } from './filter-chips';
import { GridFrame } from './grid-frame';
import { PriorityPill } from './priority-pill';
import { SidePanel, SideSection } from './side-panel';
import { StatusChip } from './status-chip';
import { Tree, TreeNode, filterTree } from './tree';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusChip, PriorityPill, EventIcon, FilterChips, SidePanel, Tree, GridFrame],
  template: `
    <mf-status-chip id="s1" code="IN_PROGRESS" [stepNumber]="3" [stepTotal]="5" [showBar]="true" />
    <mf-status-chip id="s2" code="ON_HOLD" detail="On hold for 6 days because Waiting" />
    <mf-status-chip id="s3" code="NEW" [stepNumber]="1" [stepTotal]="4" />
    <mf-priority-pill id="p1" kind="critical" />
    <mf-event-icon id="e1" type="TRIAL" [chip]="true" />
    <mf-filter-chips
      id="fc"
      label="Status"
      [chips]="chips"
      [value]="chip()"
      emptyKey="all"
      (valueChange)="chip.set($event)"
    />
    <mf-side-panel id="sp" [(open)]="open" [sections]="sections" label="Events and activity">
      <section data-section="events"><button data-section-focus>Events</button></section>
    </mf-side-panel>
    <mf-tree
      id="tr"
      [nodes]="nodes"
      [selectedId]="selected()"
      [(expanded)]="expanded"
      [filter]="filter()"
      (choose)="selected.set($event)"
    />
    <mf-grid-frame id="gf" scrollLabel="Task list"
      ><div frameHead>H</div>
      rows</mf-grid-frame
    >
  `,
})
class Host {
  readonly chips: FilterChip[] = [
    { key: 'all', label: 'All open', count: 5 },
    { key: 'new', label: 'New', count: 2 },
  ];
  readonly chip = signal('all');
  readonly open = signal(true);
  readonly sections: SideSection[] = [
    { key: 'events', label: 'Upcoming events', icon: 'pi-calendar', count: 3 },
    { key: 'activity', label: 'Recent activity', icon: 'pi-bell', count: 0 },
  ];
  readonly nodes: TreeNode[] = [
    {
      id: 'c1',
      label: 'Northwind',
      count: 2,
      countLabel: 'matters',
      children: [
        { id: 'm1', label: 'Patent case', dot: 'active', alert: 2, count: 4 },
        { id: 'm2', label: 'Qui Tam', lock: true, dot: 'quiet' },
      ],
    },
    { id: 'c2', label: 'Orion', children: [{ id: 'm3', label: 'Audit' }] },
  ];
  readonly selected = signal<string | null>(null);
  readonly expanded = signal<ReadonlySet<string>>(new Set(['c1']));
  readonly filter = signal('');
}

describe('shared building blocks (UI-10)', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const flush = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      await Promise.resolve();
    };
    return { fixture, el, host: fixture.componentInstance, flush };
  }

  it('the status chip writes the word, an icon and "step n of m" for In Progress only', async () => {
    const { el } = await setup();
    expect(el.querySelector('#s1')!.textContent).toContain('In Progress');
    expect(el.querySelector('#s1')!.textContent).toContain('step 3 of 5');
    expect(el.querySelectorAll('#s1 .bar i.on').length).toBe(3);
    expect(el.querySelector('#s3')!.textContent).not.toContain('step');
  });

  it('a status chip with a detail is a tab stop whose name carries the detail', async () => {
    const { el } = await setup();
    const chip = el.querySelector<HTMLElement>('#s2 .chip')!;
    expect(chip.tabIndex).toBe(0);
    expect(chip.getAttribute('aria-label')).toBe('On Hold. On hold for 6 days because Waiting');
    chip.dispatchEvent(new Event('focus'));
    expect(document.body.querySelector('[role=tooltip]')?.textContent).toContain('6 days');
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.body.querySelector('[role=tooltip]')).toBeNull();
  });

  it('the pill and the event icon write their words', async () => {
    const { el } = await setup();
    expect(el.querySelector('#p1')!.textContent).toContain('Critical');
    expect(el.querySelector('#e1')!.textContent).toContain('Trial');
    expect(EVENT_TYPES.length).toBe(8);
    expect(eventType('nope').code).toBe('OTHER');
  });

  it('the filter chips toggle with aria-pressed and the chosen one clears to emptyKey', async () => {
    const { el, host, flush } = await setup();
    const btn = (k: string) => el.querySelector<HTMLButtonElement>(`#fc [data-key="${k}"]`)!;
    expect(btn('all').getAttribute('aria-pressed')).toBe('true');
    btn('new').click();
    await flush();
    expect(host.chip()).toBe('new');
    btn('new').click();
    await flush();
    expect(host.chip()).toBe('all');
  });

  it('the side panel collapses to a rail with count badges and reopens on its section', async () => {
    const { el, host, flush } = await setup();
    const toggle = () => el.querySelector<HTMLButtonElement>('#sp [data-side-toggle]')!;
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    toggle().click();
    await flush();
    expect(host.open()).toBe(false);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('#sp [data-rail="events"] .badge')!.textContent).toContain('3');
    expect(el.querySelector('#sp [data-rail="activity"] .badge')).toBeNull();
    el.querySelector<HTMLButtonElement>('#sp [data-rail="events"]')!.click();
    await flush();
    expect(host.open()).toBe(true);
  });

  it('the tree has the tree roles, levels and expanded state, and the marks are in the name', async () => {
    const { el } = await setup();
    const items = el.querySelectorAll<HTMLElement>('#tr [role=treeitem]');
    expect(el.querySelector('#tr [role=tree]')).not.toBeNull();
    expect(items.length).toBe(4); // c1, its two matters, c2
    expect(items[0].getAttribute('aria-expanded')).toBe('true');
    expect(items[3].getAttribute('aria-expanded')).toBe('false');
    expect(items[1].getAttribute('aria-level')).toBe('2');
    expect(items[1].getAttribute('aria-label')).toBe('Patent case, active, 2 overdue, 4');
    expect(items[2].getAttribute('aria-label')).toBe('Qui Tam, sensitive matter, quiet');
    expect(items[2].querySelector('.pi-lock')).not.toBeNull();
  });

  it('the tree keys: arrows, Right and Left, Home and End, Enter and type-ahead', async () => {
    const { el, host, flush } = await setup();
    const tree = el.querySelector<HTMLElement>('#tr [role=tree]')!;
    const key = async (k: string) => {
      tree.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      await flush();
    };
    const stop = () =>
      el.querySelector<HTMLElement>('#tr [role=treeitem][tabindex="0"]')!.dataset['id'];
    expect(stop()).toBe('c1');
    await key('ArrowDown');
    expect(stop()).toBe('m1');
    await key('End');
    expect(stop()).toBe('c2');
    await key('ArrowRight'); // opens c2
    expect(host.expanded().has('c2')).toBe(true);
    await key('ArrowLeft'); // closes c2
    expect(host.expanded().has('c2')).toBe(false);
    await key('Home');
    await key('ArrowRight'); // open parent: first child
    expect(stop()).toBe('m1');
    await key('ArrowLeft'); // to the parent
    expect(stop()).toBe('c1');
    await key('ArrowLeft'); // closes c1
    expect(host.expanded().has('c1')).toBe(false);
    await key('o'); // type-ahead to Orion
    expect(stop()).toBe('c2');
    await key('Enter');
    expect(host.selected()).toBe('c2');
  });

  it('the tree search keeps matches with their parents open', async () => {
    const { el, host, flush } = await setup();
    host.filter.set('audit');
    await flush();
    const ids = Array.from(el.querySelectorAll<HTMLElement>('#tr [role=treeitem]')).map(
      (i) => i.dataset['id'],
    );
    expect(ids).toEqual(['c2', 'm3']);
    expect(filterTree(host.nodes, 'northwind').length).toBe(1);
    expect(filterTree(host.nodes, 'zzz')).toEqual([]);
  });

  it('the grid frame has a named scroll region and pinned head', async () => {
    const { el } = await setup();
    const scroll = el.querySelector<HTMLElement>('#gf .scroll')!;
    expect(scroll.getAttribute('aria-label')).toBe('Task list, scrollable');
    expect(el.querySelector('#gf [frameHead]')!.textContent).toBe('H');
  });
});
