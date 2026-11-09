import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CATALOGUE_IDLE_MS, CatalogueGroup, ListCatalogue } from './list-catalogue';

const GROUPS: CatalogueGroup[] = [
  {
    name: 'Matter',
    icon: 'pi-briefcase',
    items: [
      { key: 'matter-types', label: 'Matter Types', hint: 'Kind of matter', count: 6 },
      {
        key: 'current-states',
        label: 'Current States',
        hint: 'Where a matter stands',
        count: null,
      },
    ],
  },
  {
    name: 'Task',
    icon: 'pi-check-square',
    items: [{ key: 'priorities', label: 'Priorities', hint: 'Urgency of every task', count: 4 }],
  },
];

@Component({
  imports: [ListCatalogue],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-list-catalogue
      [groups]="groups()"
      [selected]="selected()"
      (pick)="picked.push($event); selected.set($event)"
    >
      <input mfCatalogueSearch aria-label="Find" />
      <p mfCatalogueEmpty>Nothing here.</p>
      <a mfCataloguePointer href="#x">Open Custom Fields</a>
    </mf-list-catalogue>
  `,
})
class Host {
  readonly groups = signal<CatalogueGroup[]>(GROUPS);
  readonly selected = signal<string | null>('matter-types');
  readonly picked: string[] = [];
}

describe('ListCatalogue (D-44y)', () => {
  async function start() {
    const f = TestBed.createComponent(Host);
    document.body.appendChild(f.nativeElement);
    f.detectChanges();
    await f.whenStable();
    return f;
  }
  const opts = (): HTMLElement[] =>
    Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
  const key = (k: string, el: HTMLElement) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

  afterEach(() => document.body.replaceChildren());

  it('is a named listbox of options in named groups inside a named aside', async () => {
    await start();
    expect(document.body.querySelector('aside')!.getAttribute('aria-label')).toBe('Lists');
    const box = document.body.querySelector('[role="listbox"]')!;
    expect(box.getAttribute('aria-label')).toBe('Lists');
    const groups = Array.from(box.querySelectorAll('[role="group"]'));
    expect(groups).toHaveLength(2);
    expect(groups[0].getAttribute('aria-labelledby')).toBeTruthy();
    expect(
      document.getElementById(groups[0].getAttribute('aria-labelledby')!)!.textContent,
    ).toContain('Matter');
    expect(opts().map((o) => o.getAttribute('aria-label'))).toEqual([
      'Matter Types, 6 active',
      'Current States, count not available',
      'Priorities, 4 active',
    ]);
    expect(opts().map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
  });

  it('shows -- for an unknown count and keeps the chip out of the accessibility tree', async () => {
    await start();
    const chips = Array.from(document.body.querySelectorAll<HTMLElement>('[data-count]'));
    expect(chips.map((c) => c.textContent!.trim())).toEqual(['6', '--', '4']);
    for (const c of chips) expect(c.getAttribute('aria-hidden')).toBe('true');
  });

  it('is one Tab stop: only the selected option has tabindex 0', async () => {
    await start();
    expect(opts().map((o) => o.tabIndex)).toEqual([0, -1, -1]);
  });

  it('falls back to the first option as the Tab stop when the search hides the selected one', async () => {
    const f = await start();
    f.componentInstance.groups.set([GROUPS[1]]);
    f.detectChanges();
    expect(opts().map((o) => o.tabIndex)).toEqual([0]);
  });

  it('selects at once on a click', async () => {
    const f = await start();
    opts()[2].click();
    f.detectChanges();
    expect(f.componentInstance.picked).toEqual(['priorities']);
  });

  it('moves with Up, Down, Home and End, selects after the idle time, and never on a letter', async () => {
    const f = await start();
    vi.useFakeTimers();
    try {
      key('ArrowDown', opts()[0]);
      key('ArrowDown', opts()[0]);
      f.detectChanges();
      // The highlight follows at once, the editor (the pick event) only after the idle time: one request, not one per key.
      expect(f.componentInstance.picked).toEqual([]);
      expect(opts().map((o) => o.getAttribute('aria-selected'))).toEqual([
        'false',
        'false',
        'true',
      ]);
      vi.advanceTimersByTime(CATALOGUE_IDLE_MS + 1);
      expect(f.componentInstance.picked).toEqual(['priorities']);
      key('Home', opts()[2]);
      vi.advanceTimersByTime(CATALOGUE_IDLE_MS + 1);
      expect(f.componentInstance.picked.at(-1)).toBe('matter-types');
      key('End', opts()[0]);
      vi.advanceTimersByTime(CATALOGUE_IDLE_MS + 1);
      expect(f.componentInstance.picked.at(-1)).toBe('priorities');
      key('Home', opts()[2]);
      vi.advanceTimersByTime(CATALOGUE_IDLE_MS + 1);
      const before = f.componentInstance.picked.length;
      key('p', opts()[0]);
      key('ArrowUp', opts()[0]); // already first: nothing moves
      vi.advanceTimersByTime(CATALOGUE_IDLE_MS + 1);
      expect(f.componentInstance.picked.length).toBe(before + 1);
      expect(f.componentInstance.picked.at(-1)).toBe('matter-types');
    } finally {
      vi.useRealTimers();
    }
  });

  it('announces the list and its count politely after the selection changes, and the number of lists after a search', async () => {
    const f = await start();
    const live = () => document.body.querySelector('[data-catalogue-live]')!;
    expect(live().getAttribute('aria-live')).toBe('polite');
    f.componentInstance.selected.set('priorities');
    f.detectChanges();
    expect(live().textContent!.trim()).toBe('Priorities, 4 active');
    f.componentInstance.groups.set([GROUPS[0]]);
    f.detectChanges();
    expect(live().textContent!.trim()).toBe('2 lists');
  });

  it('shows the no-match slot instead of the listbox when no list is left, and keeps the pointer', async () => {
    const f = await start();
    f.componentInstance.groups.set([]);
    f.detectChanges();
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(document.body.querySelector('[data-no-match]')!.textContent).toContain('Nothing here.');
    expect(document.body.querySelector('a[href="#x"]')).not.toBeNull();
  });
});
