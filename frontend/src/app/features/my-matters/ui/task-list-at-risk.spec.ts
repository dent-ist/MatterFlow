import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * D-44t (#1267): the At Risk pill is the 26 px clock-icon circle whenever the whole Task cell is narrower than 460 px, and the pill with its word at 460 px
 * and wider. The unit environment has no layout, so this spec reads the rule out of the component's styles and applies it to the three measured cells
 * (1366 with the side panel closed 446 px, 1366 with it open 304 px, 1920 708 px); the browser check is in e2e/tests/mm-ui-update.spec.ts.
 */
const source = readFileSync(join(__dirname, 'task-list.ts'), 'utf8');

/** The `@container tc (...)` condition of the stylesheet, as a test on the container width. */
function narrow(width: number): boolean {
  const m = /@container tc \((max-width|width <|min-width): ?([\d.]+)px\)/.exec(source);
  expect(m, 'a container rule named tc').not.toBeNull();
  const limit = Number(m![2]);
  return m![1] === 'min-width'
    ? width >= limit
    : m![1] === 'max-width'
      ? width <= limit
      : width < limit;
}

describe('My Matters Overview: At Risk in the Task cell (D-44t, #1267)', () => {
  it.each([
    [446, true],
    [304, true],
    [708, false],
    [459, true],
    [460, false],
  ])('a Task cell of %i px shows the clock icon: %s', (width, icon) => {
    expect(narrow(width)).toBe(icon);
  });

  it('the container is the whole Task cell wrapper, not the title room', () => {
    expect(source).toMatch(/\.tcw \{\s*container: tc \/ inline-size;/);
    expect(source).not.toMatch(/\.tmain \{[^}]*container:/);
    expect(source).not.toContain('260px');
    // The cell padding moved inside the wrapper so the container is as wide as the cell.
    expect(source).toMatch(/\.td-t \{[^}]*padding-inline: 0;/);
  });

  it('keeps the word as the accessible name of the icon', () => {
    expect(source).toMatch(/class="pi pi-clock risk__ico"[^>]*aria-label="At Risk"/);
    expect(source).toMatch(/\.risk__ico \{[^}]*width: var\(--mf-chip-h\);/);
  });
});
