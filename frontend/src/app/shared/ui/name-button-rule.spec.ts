import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard for D-44m (#1285): a name button (`mf-btn--name`) is clamped to two lines only in a cell that has no second line. Over an account or a sub line it is
 * one line, and the cell takes no vertical padding where the two lines would not fit the 44 px row (D-42). The shared sheet keeps the two lines and the 24 px
 * target; the page that stacks a second line under the name says so in its own sheet.
 */
const APP = join(process.cwd(), 'src', 'app');
const read = (file: string): string => readFileSync(join(APP, file), 'utf8');

describe('name button over a second line (D-44m, #1285)', () => {
  it('the Users grid cell takes no vertical padding and clamps the name to one line over the account line', () => {
    const css = read('features/admin/users/users-page.scss');
    expect(css).toMatch(/td\.us-name\s*\{[^}]*padding-block:\s*0\s*;/);
    expect(css).toMatch(/\.us-name\s+\.mf-btn--name\s*\{[^}]*-webkit-line-clamp:\s*1\s*;/);
    // the account line is the second line of that cell
    expect(read('features/admin/users/users-page.html')).toMatch(
      /class="us-name"[\s\S]*?mf-btn--name[\s\S]*?class="us-account/,
    );
  });

  it('the Productions and Specs grids clamp the name to one line when the cell has a small line under it', () => {
    const source = read('features/productions/productions-tab.ts');
    expect(source).toMatch(
      /td\.pt__name:has\(\.pt__sub\)\s+\.mf-btn--name\s*\{[^}]*-webkit-line-clamp:\s*1\s*;/,
    );
  });

  it('the shared name button keeps its two lines and its 24 px target for a cell with no second line', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'styles', '_buttons.scss'), 'utf8');
    const rule = /\.mf-btn--text\.mf-btn--name\s*\{([^}]*)\}/.exec(css)![1];
    expect(rule).toMatch(/-webkit-line-clamp:\s*2\s*;/);
    expect(rule).toMatch(/min-height:\s*var\(--mf-target-min\)\s*;/);
  });
});
