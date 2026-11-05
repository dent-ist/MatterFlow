import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = (file: string): string => readFileSync(join(process.cwd(), 'src', file), 'utf8');

/** The body of the first rule in `css` whose selector list contains `selector`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('one link style (D-13, #1131)', () => {
  const global = styles('styles.scss');

  it('a plain anchor and .mf-link share one rule: link colour, regular weight, 1 px underline at offset 2, a 24 px target', () => {
    expect(global).toContain('a:not([class]),\n.mf-link {');
    const body = rule(global, 'a:not([class]),\n.mf-link {');
    expect(body).toContain('color: var(--mf-link)');
    expect(body).toContain('font-weight: 400');
    expect(body).toContain('text-decoration: underline');
    expect(body).toContain('text-underline-offset: 2px');
    expect(body).toContain('padding-block: 4px');
    expect(body).toContain('margin-block: -4px');
  });

  it('hover uses the primary hover colour and a visited link keeps the link colour', () => {
    expect(rule(global, 'a:not([class]):hover,\n.mf-link:hover {')).toContain(
      'color: var(--mf-primary-hover)',
    );
    expect(rule(global, 'a:not([class]):visited,\n.mf-link:visited {')).toContain(
      'color: var(--mf-link)',
    );
  });

  it('an identifier link adds the mono font', () => {
    expect(rule(global, '.mf-link--id {')).toContain('font-family: var(--mf-font-mono)');
  });

  it('navigation links have no underline; the breadcrumb underlines on hover', () => {
    expect(rule(global, '.mf-nav a:not([class]),')).toContain('text-decoration: none');
    expect(rule(global, '.ph__crumbs a:not([class]):hover,')).toContain(
      'text-decoration: underline',
    );
  });

  it('a text button (an action) has no underline at rest and underlines on hover', () => {
    const buttons = styles('styles/_buttons.scss');
    expect(rule(buttons, '.mf-btn--text {')).toContain('text-decoration: none');
    expect(rule(buttons, ".mf-btn--text:hover:not(:disabled, [aria-disabled='true']) {")).toContain(
      'text-decoration: underline',
    );
  });

  it('grid title links are regular weight like the Matter Name link', () => {
    const table = styles('app/shared/work-queue/task-table.scss');
    expect(rule(table, '\n.wt-title {')).toContain('font-weight: 400');
  });
});
