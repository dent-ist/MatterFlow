import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Wide grids scroll sideways inside their frame (epic #1037, LC-09 #1052, owner decision 2026-11-02): every chosen column stays, the frame is a named,
 * focusable scroll region with a visible horizontal scrollbar above the pager, the header row stays while the rows scroll, the page itself never scrolls
 * sideways (also at 200% and 400% zoom), and the phone keeps its cards.
 */
interface Screen {
  name: string;
  url: string;
  region: string;
  /** Header texts that must all be there whatever the width (the old rules dropped some of them). */
  headers: string[];
}

const SCREENS: Screen[] = [
  {
    name: 'Task Queue',
    url: '/tasks',
    region: 'Task Queue list, scrollable',
    headers: ['Ref', 'Type', 'Title', 'CM Number', 'Priority', 'Status'],
  },
  {
    name: 'Matters',
    url: '/matters',
    region: 'Matters list, scrollable',
    headers: ['CM Number', 'Matter Name', 'Client', 'Matter Type', 'Current State'],
  },
  {
    name: 'Assets',
    url: '/assets',
    region: 'Assets list, scrollable',
    headers: ['Type', 'Name', 'CM Number', 'Size', 'External Reference', 'Disposition'],
  },
];

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('Wide grids scroll inside the frame (LC-09)', () => {
  test.beforeEach(async ({ seed }) => {
    // Something to list on a fresh database.
    const token = uid();
    const client = await seed.client({ name: `Scroll Client ${token}` });
    const matter = await seed.matter({ client, number: '00001', name: `Scroll Matter ${token}` });
    await seed.asset(matter, `Scroll Asset ${token}`);
    await seed.task(await seed.world(), { title: `Scroll task ${token}` });
  });

  for (const s of SCREENS) {
    test(`${s.name} at 200% zoom (683 px wide) keeps the table and the page does not scroll sideways`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 683, height: 600 });
      await page.goto(s.url);
      const region = page.getByRole('region', { name: s.region });
      await expect(region).toBeVisible();
      await expect(region.locator('tbody tr').first()).toBeVisible();
      expect(await pageOverflow(page), `${s.name} at 200%`).toBeLessThanOrEqual(0);
    });
  }
});
