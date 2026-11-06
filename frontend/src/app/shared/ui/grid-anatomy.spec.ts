import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { LocalPaging } from './local-paging';
import { ZeroDash } from './zero-dash';

const source = (file: string): string => readFileSync(join(process.cwd(), 'src', file), 'utf8');

/** The body of the first rule in `css` that starts with `selector`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('one grid anatomy (D-42, #1152)', () => {
  const admin = source('styles/_admin-lists.scss');
  const page = source('app/shared/ui/page.scss');
  const work = source('app/shared/work-queue/task-table.scss');

  it('the header row is 40 px (--mf-grid-head-h) in the admin grid and the record list grid', () => {
    expect(rule(admin, '.mf-grid th {')).toContain('height: var(--mf-grid-head-h)');
    expect(rule(page, '.pg-table th {')).toContain('height: var(--mf-grid-head-h)');
  });

  it('a row is 44 px including its line: border-box cells, the row token, the soft line', () => {
    expect(admin).toMatch(
      /\.mf-grid td \{\s*(\/\*[^*]*\*\/\s*)?box-sizing: border-box;\s*height: var\(--mf-grid-row-h, 44px\)/,
    );
    expect(page).toMatch(/\.pg-table td \{\s*box-sizing: border-box/);
    expect(rule(work, '.wt th,\n.wt td {')).toContain(
      'border-bottom: 1px solid var(--mf-border-soft)',
    );
  });

  it('hover is --mf-row-hover and selected is --mf-selected-bg, never a zebra', () => {
    expect(rule(admin, '.mf-grid tbody tr:hover > td {')).toContain('var(--mf-row-hover)');
    expect(admin).toContain("tr:is(.mf-selected, [aria-selected='true']) > td");
    expect(admin).not.toContain('nth-child(even)');
  });

  it('the Dashboard Users table and the Skills matrix use the row and header tokens, not 48 px / 3 rem', () => {
    const users = source('app/features/dashboard/users/users-table.ts');
    expect(users).toContain('height: var(--mf-grid-row-h)');
    expect(users).not.toContain('height: 48px');
    const skills = source('app/features/dashboard/users/skills-view.ts');
    expect(skills).toContain('height: var(--mf-grid-row-h)');
    expect(skills).not.toContain('height: 3rem');
  });

  it('the row action cell is 48 px wide: the token --mf-col-actions-w, defined once as 48px (#1245)', () => {
    expect(
      rule(source('styles/_tables.scss'), 'table th:is(.mf-col-actions, .mf-col-menu)'),
    ).toContain('width: var(--mf-col-actions-w)');
    const tokens = readFileSync(join(process.cwd(), '..', 'docs', 'ux', 'tokens.css'), 'utf8');
    expect(tokens).toMatch(/--mf-col-actions-w:\s*48px;/);
  });

  it('the "..." of a table cell is a quiet 36 px icon button: no border, muted at rest, full colour on row hover or focus (#1153)', () => {
    const menu = source('app/shared/ui/action-menu.scss');
    const quiet = rule(menu, ':host-context(td) button.am__trigger:not(.am__trigger--text) {');
    expect(quiet).toContain('width: var(--mf-ctl-h)');
    expect(quiet).toContain('border: 0');
    expect(quiet).toContain('color: var(--mf-text-muted)');
    expect(menu).toContain(':host-context(tr:hover) button.am__trigger');
    expect(menu).toContain(':host-context(tr:focus-within) button.am__trigger');
  });
});

describe('the grids #1152 missed (#1214)', () => {
  it('the pager keeps one row in a narrow frame: below 760 px of its own width the "Rows per page" label goes, the select keeps the name', () => {
    const pager = source('app/shared/ui/pager.ts');
    expect(pager).toContain('container-type: inline-size');
    expect(pager).toMatch(
      /@container \(max-width: 759\.98px\) \{\s*\.mf-pager__size-lbl \{\s*display: none/,
    );
    expect(pager).toContain('label="Rows per page"');
  });

  it('Matter Activities uses the record grid (pg-table, 44 px rows, 40 px header) and stops the What cell at two lines', () => {
    const ts = source('app/features/matters/ui/matter-activities.ts');
    expect(ts).toContain('<mf-record-grid'); // the shared grid draws the pg-table (44 px rows, 40 px header; #1269)
    expect(ts).toContain("styleUrl: '../../../shared/ui/page.scss'");
    expect(ts).toContain('class="pg-name"');
  });

  it('Pod Work By Member and Settings > Holidays use the row and heading tokens', () => {
    const pod = source('app/features/pod-work/ui/pod-member-table.scss');
    expect(pod).toMatch(
      /\.pm-table td \{\s*box-sizing: border-box;\s*height: var\(--mf-grid-row-h\)/,
    );
    expect(rule(pod, '.pm-table thead th {')).toContain('height: var(--mf-grid-head-h)');
    const ha = source('app/features/admin/holidays/holidays-admin.ts');
    expect(rule(ha, '.ha__t td,')).toContain('height: var(--mf-grid-row-h)');
    expect(rule(ha, '.ha__t thead th {')).toContain('height: var(--mf-grid-head-h)');
  });
});

describe('LocalPaging (the small Administration lists)', () => {
  const rows = Array.from({ length: 120 }, (_, i) => i);

  it('shows 50 rows by default and offers 25, 50 and 100', () => {
    const p = new LocalPaging();
    expect(p.sizes).toEqual([25, 50, 100]);
    expect(p.slice(rows).length).toBe(50);
    expect(p.offset()).toBe(0);
  });

  it('moves between pages and back to page 1 when the size changes', () => {
    const p = new LocalPaging();
    p.goTo(3);
    expect(p.slice(rows)).toEqual(rows.slice(100, 120));
    expect(p.offset()).toBe(100);
    p.setSize(25);
    expect(p.page()).toBe(1);
    expect(p.slice(rows).length).toBe(25);
  });

  it('a page past the end (after a delete) shows the last page', () => {
    const p = new LocalPaging();
    p.goTo(3);
    expect(p.slice(rows.slice(0, 60))).toEqual(rows.slice(50, 60));
    expect(p.page()).toBe(2);
  });
});

describe('zero in an Overdue, Due Soon or On Hold column (D-42, #1152)', () => {
  it('shows a muted dash and says "0" to a screen reader', () => {
    const fixture = TestBed.createComponent(ZeroDash);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const dash = el.querySelector('[data-zero-dash]')!;
    expect(dash.textContent).toBe('-');
    expect(dash.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.mf-sr-only')!.textContent).toBe('0');
  });

  it('speaks the srText instead of "0" where the dash stands for a missing value (#1275)', () => {
    const fixture = TestBed.createComponent(ZeroDash);
    fixture.componentRef.setInput('srText', 'No project');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-zero-dash]')!.textContent).toBe('-');
    expect(el.querySelector('.mf-sr-only')!.textContent).toBe('No project');
  });
});
