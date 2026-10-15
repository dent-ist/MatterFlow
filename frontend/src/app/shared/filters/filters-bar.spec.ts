import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FiltersBar } from './filters-bar';
import { FiltersTestHost, Mounted, cleanup, mountFilters } from './filters-testing';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FiltersBar],
  template: `
    <mf-filters-bar
      [filters]="filters"
      controls="row"
      [clearAlso]="['q']"
      (showColumn)="shown = $event"
    >
      <span class="extra">Sorted by Name</span>
    </mf-filters-bar>
  `,
})
class Host extends FiltersTestHost {}

describe('filters bar', { timeout: 20_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  let m: Mounted<Host>;
  const toggle = () => m.el.querySelector<HTMLButtonElement>('[data-filters-toggle]')!;
  const chips = () =>
    Array.from(m.el.querySelectorAll('[data-chip-id]')).map((c) => c.getAttribute('data-chip-id'));
  const clearButton = () => m.el.querySelector<HTMLButtonElement>('[data-clear-filters]');

  async function mount(url = '/list', extra: Record<string, unknown> = {}) {
    m = await mountFilters(Host, { url, ...extra });
  }

  describe('Filters toggle', () => {
    it('has the filter icon, the name, the count of active filters and the toggle state', async () => {
      await mount();
      expect(toggle().textContent).toContain('Filters');
      expect(toggle().querySelector('.pi-filter')).not.toBeNull();
      expect(toggle().getAttribute('aria-pressed')).toBe('false');
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(toggle().getAttribute('aria-controls')).toBe('row');
      expect(toggle().querySelector('[data-filter-count]')).toBeNull();
      expect(toggle().getAttribute('title')).toBe('Show filters');

      toggle().click();
      await m.settle();
      expect(toggle().getAttribute('aria-pressed')).toBe('true');
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(toggle().getAttribute('title')).toBe('Hide filters');
    });

    it('does not count a default but counts everything else, and opens the row for a deep link', async () => {
      await mount('/list?status=active&name=a&priority=1&priority=2');
      expect(toggle().querySelector('[data-filter-count]')?.textContent).toBe('(2)');
      expect(m.filters.rowVisible()).toBe(true);
    });

    it('sits in the bar the page placed the extras in, right aligned after them', async () => {
      await mount();
      const order = Array.from(m.el.querySelector('.fbar')!.children).map((c) =>
        c.classList.contains('extra') ? 'extra' : c.tagName.toLowerCase(),
      );
      expect(order.at(-1)).toBe('mf-filters-toggle');
      expect(order.indexOf('extra')).toBeLessThan(order.indexOf('mf-filters-toggle'));
    });
  });

  describe('Clear filters', () => {
    it('shows only while something other than the default is active and goes back to the defaults', async () => {
      await mount();
      expect(clearButton()).toBeNull();
      await m.go('/list?name=a&status=all&q=old&sort=name');
      expect(clearButton()?.textContent).toContain('Clear filters');
      clearButton()!.click();
      await m.settle();
      expect(m.router.url).toBe('/list?sort=name');
      expect(clearButton()).toBeNull();
    });
  });

  describe('chips', () => {
    it('show every active value while the row is closed, with a remove button that names the filter', async () => {
      await mount('/list?priority=1&priority=2&name=a');
      m.filters.open.set(false);
      await m.settle();
      expect(chips()).toEqual(['name', 'priority:1', 'priority:2']);
      const remove = m.el.querySelector<HTMLButtonElement>('[data-chip-id="priority:1"] .fch__x')!;
      expect(remove.getAttribute('aria-label')).toBe('Remove filter Priority: Critical');
      remove.click();
      await m.settle();
      expect(m.filters.list('priority')).toEqual(['2']);
    });

    it('hide while the row shows the values, except for a hidden column or a filter without a column', async () => {
      await mount('/list?priority=1&sensitive=true', {
        columns: ['name', 'type', 'due', 'status'],
      });
      expect(m.filters.rowVisible()).toBe(true);
      expect(chips()).toEqual(['priority:1', 'sensitive']);
      expect(m.el.querySelector('[data-chip-id="priority:1"]')?.textContent).toContain(
        '(hidden column)',
      );
      expect(m.el.querySelector('[data-chip-id="sensitive"]')?.textContent).not.toContain(
        '(hidden column)',
      );
    });

    it('offer the hidden column back', async () => {
      await mount('/list?priority=1', { columns: ['name'] });
      const asked: string[] = [];
      const bar = m.harness.fixture.debugElement.query((d) => d.name === 'mf-filters-bar');
      bar.componentInstance.showColumn.subscribe((c: string) => asked.push(c));
      m.el.querySelector<HTMLButtonElement>('[data-chip-id="priority:1"] .fch__act')!.click();
      expect(asked).toEqual(['priority']);
    });

    it('fold into "+N more" beyond five and expand', async () => {
      await mount(
        '/list?priority=1&priority=2&name=a&type=4&dueFrom=2026-10-01&sensitive=true&status=all',
      );
      m.filters.open.set(false);
      await m.settle();
      expect(chips()).toHaveLength(5);
      const more = m.el.querySelector<HTMLButtonElement>('.fch__more')!;
      expect(more.textContent).toContain('+2 more');
      more.click();
      await m.settle();
      expect(chips()).toHaveLength(7);
      expect(m.el.querySelector('.fch__more')?.textContent).toContain('Show fewer');
    });

    it('are listed as "Active filters"', async () => {
      await mount('/list?name=a');
      m.filters.open.set(false);
      await m.settle();
      expect(m.el.querySelector('ul.fch')?.getAttribute('aria-label')).toBe('Active filters');
    });
  });

  describe('More filters', () => {
    it('lists the filters that have no cell and opens the chosen control', async () => {
      await mount('/list', { columns: ['name', 'status'] });
      const more = m.el.querySelector<HTMLButtonElement>('[data-more-filters]')!;
      expect(more.getAttribute('aria-haspopup')).toBe('dialog');
      more.click();
      await m.settle();
      expect(
        Array.from(m.el.querySelectorAll('[data-more-filter]')).map((b) =>
          b.getAttribute('data-more-filter'),
        ),
      ).toEqual(['type', 'priority', 'due', 'sensitive']);
      m.el.querySelector<HTMLButtonElement>('[data-more-filter=sensitive]')!.click();
      await m.settle();
      const tri = m.el.querySelector<HTMLSelectElement>('mf-filter-popover select')!;
      expect(tri.getAttribute('aria-label')).toBe('Filter by Sensitive');
      tri.value = 'true';
      tri.dispatchEvent(new Event('change'));
      await m.settle();
      expect(m.router.url).toContain('sensitive=true');
      expect(chips()).toContain('sensitive');
    });

    it('is not offered when every filter has a cell', async () => {
      await mount('/list', {
        defs: [{ key: 'name', label: 'Name', column: 'name', type: 'text' }],
      });
      expect(m.el.querySelector('[data-more-filters]')).toBeNull();
    });
  });

  describe('live region and print line', () => {
    it('announces the result count after a filter change, politely', async () => {
      await mount();
      const live = m.el.querySelector('[data-filter-live]')!;
      expect(live.getAttribute('role')).toBe('status');
      expect(live.getAttribute('aria-live')).toBe('polite');
      m.filters.reportResults(40);
      await m.go('/list?name=a');
      m.filters.reportResults(23);
      await m.settle();
      expect(live.textContent!.replace(/[\s\u200b]+/g, ' ').trim()).toBe('23 things');
    });

    it('prints a "Filters: ..." line that is hidden on screen and shown in print', async () => {
      await mount('/list?name=acme&priority=1');
      const line = m.el.querySelector<HTMLElement>('[data-filter-print]')!;
      expect(line.textContent).toBe('Filters: Name acme, Priority Critical, Status Active');
      expect(getComputedStyle(line).display).toBe('none');
    });

    it('prints nothing when no filter limits the grid', async () => {
      await mount('/list', {
        defs: [{ key: 'name', label: 'Name', column: 'name', type: 'text' }],
      });
      expect(m.el.querySelector('[data-filter-print]')).toBeNull();
    });
  });

  describe('the / shortcut', () => {
    const press = (target: EventTarget = document.body) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }),
      );

    it('opens a closed row (the page renders it, the first text filter gets focus there)', async () => {
      await mount();
      expect(m.filters.rowVisible()).toBe(false);
      press();
      await m.settle();
      expect(m.filters.rowVisible()).toBe(true);
    });

    it('leaves the key alone while the user is typing, with a modifier, or when no filter is text', async () => {
      await mount();
      const input = document.createElement('input');
      document.body.appendChild(input);
      press(input);
      expect(m.filters.rowVisible()).toBe(false);
      input.remove();
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true }),
      );
      expect(m.filters.rowVisible()).toBe(false);
    });

    it('does nothing on a screen without a text filter', async () => {
      await mount('/list', {
        defs: [{ key: 's', label: 'S', column: 's', type: 'select', options: [] }],
      });
      press();
      expect(m.filters.rowVisible()).toBe(false);
    });
  });

  describe('restored last view', () => {
    it('shows a polite notice with Reset to default and Dismiss', async () => {
      await mount('/list?name=a');
      expect(m.el.querySelector('[data-restored-notice]')).toBeNull();
      m.filters.markRestored();
      await m.settle();
      const notice = m.el.querySelector('[data-restored-notice]')!;
      expect(notice.getAttribute('role')).toBe('status');
      expect(notice.textContent).toContain('Restored your last view');
      Array.from(notice.querySelectorAll('button'))
        .find((b) => b.textContent!.includes('Dismiss'))!
        .click();
      await m.settle();
      expect(m.el.querySelector('[data-restored-notice]')).toBeNull();

      m.filters.markRestored();
      await m.settle();
      Array.from(m.el.querySelectorAll<HTMLButtonElement>('[data-restored-notice] button'))
        .find((b) => b.textContent!.includes('Reset to default'))!
        .click();
      await m.settle();
      expect(m.router.url).toBe('/list');
      expect(m.el.querySelector('[data-restored-notice]')).toBeNull();
    });
  });
});
