import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { stickyBandProblems } from '../support/sticky-bands';

/**
 * Sticky header bands of the shared grid (#1259). Scrolled down and sideways, every heading and every filter cell of a list stays at the top
 * together, opaque, above the rows. The cause was a global `position: relative` on resizable headings that beat the sticky rule of the grid frame
 * (every heading but the first scrolled away) and a pinned first filter cell one layer under the pinned row cells (the Name filter was hidden).
 */
const toggle = (page: Page) => page.getByRole('button', { name: /^Filters/ });

async function setFilterRow(page: Page, open: boolean): Promise<void> {
  if ((await toggle(page).count()) === 0) return;
  const button = toggle(page).first();
  const pressed =
    (await button.getAttribute('aria-pressed')) ?? (await button.getAttribute('aria-expanded'));
  if ((pressed === 'true') !== open) await button.click();
}

const lists: [string, string][] = [
  ['Users', '/admin/users?status=all'],
  ['Pods', '/admin/pods?status=all'],
  ['Task Types', '/admin/task-types'],
  ['Workflows', '/admin/workflows'],
  ['Steps', '/admin/steps'],
  ['Asset Types', '/admin/asset-types'],
  ['Clients', '/clients'],
  ['Matters', '/matters'],
  ['Projects', '/projects'],
  ['Assets', '/assets'],
  ['Task Queue', '/tasks'],
  ['My Work', '/my-work'],
];

for (const width of [1366, 1920]) {
  test.describe(`header and filter bands stay together at ${width}`, () => {
    for (const [name, url] of lists) {
      for (const open of [true, false]) {
        test(`${name}, filter row ${open ? 'open' : 'closed'}`, async ({ page }) => {
          await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
          await page.goto(url);
          await expect(page.locator('main table tbody tr').nth(3)).toBeVisible();
          await setFilterRow(page, open);
          expect(await stickyBandProblems(page)).toEqual([]);
        });
      }
    }
  });
}
