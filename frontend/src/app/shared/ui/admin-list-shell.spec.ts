import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  DEMO_DEFS,
  FiltersTestHost,
  Mounted,
  cleanup,
  mountFilters,
} from '../filters/filters-testing';
import { SkipTarget } from '../layout/skip-target';
import { AdminListShell, ShellCounts, applyCounts } from './admin-list-shell';
import { MfTab } from './tabs';

const LONG =
  'This description is far too long to fit one line at 1366 pixels, so the shell must cut it after ninety characters.';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AdminListShell],
  template: `
    <mf-admin-list-shell
      heading="Asset Types"
      [description]="description()"
      [tabs]="tabs()"
      [tab]="'types'"
      [counts]="counts()"
      [filters]="withFilters() ? filters : null"
      controls="demo-row"
      [tableId]="tableId()"
      (tabChange)="chosen = $event"
    >
      <button mfPrimary type="button" data-new>New asset type</button>
      <p mfStrip data-strip>Strip</p>
      @if (showTable()) {
        <table id="demo-table" data-table>
          <tbody>
            <tr>
              <td><a href="#row" data-first-row>Row</a></td>
            </tr>
          </tbody>
        </table>
      } @else {
        <p data-empty>Nothing yet</p>
      }
    </mf-admin-list-shell>
  `,
})
class Host extends FiltersTestHost {
  readonly description = signal('One short line.');
  readonly tabs = signal<MfTab[]>([
    { key: 'types', label: 'Asset Types' },
    { key: 'link-roles', label: 'Link Roles' },
  ]);
  readonly counts = signal<ShellCounts | null>({ types: 12, 'link-roles': null });
  readonly withFilters = signal(true);
  readonly tableId = signal('demo-table');
  readonly showTable = signal(true);
  chosen = '';
}

describe('mf-admin-list-shell (#544)', { timeout: 20_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  let m: Mounted<Host>;
  const mount = async () => {
    m = await mountFilters(Host, { defs: DEMO_DEFS.filter((d) => d.column) });
  };
  const q = <T extends HTMLElement>(sel: string) => m.el.querySelector<T>(sel);

  it('draws the default crumb, the H1 and the description with the full text as the tooltip', async () => {
    await mount();
    expect(
      Array.from(m.el.querySelectorAll('nav[aria-label="Breadcrumb"] li')).map((l) =>
        l.textContent!.trim(),
      ),
    ).toEqual(['Administration', 'Asset Types']);
    expect(q('h1')!.textContent).toContain('Asset Types');
    expect(q('[data-page-description]')!.textContent!.trim()).toBe('One short line.');

    m.host.description.set(LONG);
    await m.settle();
    // The page header keeps the whole text and shows it as the tooltip (it clips to one line by style).
    const d = q('[data-page-description]')!;
    expect(d.textContent!.trim()).toBe(LONG);
    expect(d.getAttribute('title')).toBe(LONG);

    m.host.description.set('');
    await m.settle();
    expect(q('[data-page-description]')!.textContent!.trim()).toBe('');
  });

  it('puts Filters first and the primary action last in the header actions', async () => {
    await mount();
    const actions = q('[data-page-actions]')!;
    const ids = Array.from(actions.querySelectorAll('[data-filters-toggle], [data-new]')).map(
      (e) => (e.hasAttribute('data-new') ? 'new' : 'filters'),
    );
    expect(ids).toEqual(['filters', 'new']);
    expect(q('[data-page-actions] [data-filters-toggle]')).not.toBeNull();
  });

  it('shows one Clear filters, in the header, while the filter row is open and a filter is set', async () => {
    m = await mountFilters(Host, {
      url: '/list?name=acme',
      defs: DEMO_DEFS.filter((d) => d.column),
      options: { openByDefault: true },
    });
    expect(m.el.querySelectorAll('[data-clear-filters]')).toHaveLength(1);
    expect(q('[data-page-actions] [data-clear-filters]')).not.toBeNull();
    expect(q('[data-filter-count]')!.textContent).toBe('(1)');
  });

  it('has no Filters button without filters', async () => {
    await mount();
    m.host.withFilters.set(false);
    await m.settle();
    expect(q('[data-filters-toggle]')).toBeNull();
    expect(q('[data-new]')).not.toBeNull();
  });

  it('renders counted tabs, "--" while a count is unknown, and reports the tab that was chosen', async () => {
    await mount();
    const tabs = Array.from(m.el.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tabs.map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Asset Types (12)',
      'Link Roles (--)',
    ]);
    expect(tabs[0].getAttribute('aria-label')).toBe('Asset Types, 12 active');
    expect(q('[role="tabpanel"]')!.id).toBe('admin-list-panel');
    expect(q('[role="tabpanel"]')!.getAttribute('aria-labelledby')).toBe('admin-list-tab-types');
    tabs[1].click();
    await m.settle();
    expect(m.host.chosen).toBe('link-roles');
  });

  it('renders no tab strip for a single tab, but keeps the body', async () => {
    await mount();
    m.host.tabs.set([{ key: 'types', label: 'Asset Types' }]);
    await m.settle();
    expect(q('[role="tablist"]')).toBeNull();
    expect(q('[role="tabpanel"]')).toBeNull();
    expect(q('[data-shell-body] [data-table]')).not.toBeNull();
  });

  it('puts the strip above the body inside the body region', async () => {
    await mount();
    const body = q('[data-shell-body]')!;
    const kids = Array.from(body.children).map((c) => c.localName);
    expect(kids.indexOf('p')).toBeLessThan(kids.indexOf('table'));
    expect(body.querySelector('[data-strip]')).not.toBeNull();
  });

  it('offers "Skip to table" and moves focus to the table, made focusable and named', async () => {
    await mount();
    const skip = TestBed.inject(SkipTarget);
    expect(skip.target()?.label).toBe('Skip to table');
    skip.target()!.focus();
    const table = q('#demo-table')!;
    expect(document.activeElement).toBe(table);
    expect(table.getAttribute('tabindex')).toBe('-1');
    expect(table.getAttribute('aria-label')).toBe('Asset Types');
  });

  it('keeps the name a table already has, falls back to the empty message, and offers no link without tableId', async () => {
    await mount();
    const skip = TestBed.inject(SkipTarget);
    q('#demo-table')!.setAttribute('aria-label', 'Asset types in order');
    skip.target()!.focus();
    expect(q('#demo-table')!.getAttribute('aria-label')).toBe('Asset types in order');

    m.host.showTable.set(false);
    await m.settle();
    skip.target()!.focus();
    expect(document.activeElement).toBe(q('[data-empty]'));

    m.host.tableId.set('');
    await m.settle();
    expect(skip.target()).toBeNull();
  });

  it('takes the skip link away with the page', async () => {
    await mount();
    const skip = TestBed.inject(SkipTarget);
    expect(skip.target()).not.toBeNull();
    m.harness.fixture.destroy();
    expect(skip.target()).toBeNull();
  });
});

describe('shell helpers (#545)', () => {
  it('applyCounts shows the number, "--" while unknown, and leaves tabs without an entry alone', () => {
    const tabs: MfTab[] = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
      { key: 'c', label: 'C', count: 3 },
    ];
    expect(applyCounts(tabs, null)).toBe(tabs);
    const out = applyCounts(tabs, { a: 0, b: null });
    expect(out[0]).toMatchObject({ count: 0, name: 'A, 0 active' });
    expect(out[1]).toMatchObject({ count: '--' });
    expect(out[2]).toBe(tabs[2]);
  });
});
