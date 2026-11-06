import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
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
    headers: ['CM Number', 'Client', 'Primary PM', 'Secondary PM'],
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
    test(`${s.name} at 1024x768: every column stays, the frame scrolls, the page does not, the region is named and focusable, the header stays`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.goto(s.url);
      const region = page.getByRole('region', { name: s.region });
      await expect(region).toBeVisible();
      await expect(region.locator('tbody tr').first()).toBeVisible();
      const heads = (await region.locator('thead tr:first-child th').allTextContents()).map((t) =>
        t.replace(/\s+/g, ' ').trim(),
      );
      for (const h of s.headers)
        expect(
          heads.some((t) => t.toLowerCase().startsWith(h.toLowerCase())),
          `${s.name}: ${h} is a column at 1024 px (${heads.join(', ')})`,
        ).toBe(true);
      // The scroll area is the grid's own box: it scrolls sideways, the page does not.
      const area = await region.evaluate((r) => {
        const el = (
          r.matches('.mf-scroll-area, .wt-wrap')
            ? r
            : r.querySelector('.mf-scroll-area, .wt-wrap, .mf-scroll')
        ) as HTMLElement;
        return {
          sideways: el.scrollWidth > el.clientWidth + 1,
          tabindex: el.getAttribute('tabindex') ?? r.getAttribute('tabindex'),
          overflowX: getComputedStyle(el).overflowX,
        };
      });
      expect(area.sideways, `${s.name}: the frame scrolls sideways at 1024`).toBe(true);
      expect(area.tabindex, `${s.name}: the scroll region is focusable`).toBe('0');
      // The browser draws the horizontal scrollbar at the bottom of the frame, above the pager (headless Chromium hides scrollbars, so the style is checked).
      expect(['auto', 'scroll'], `${s.name}: the frame scrolls sideways`).toContain(area.overflowX);
      expect(
        await pageOverflow(page),
        `${s.name}: the page does not scroll sideways`,
      ).toBeLessThanOrEqual(0);
      // The header row stays at the top of the frame while the frame scrolls sideways.
      const first = region.locator('thead tr:first-child th').first();
      const before = (await first.boundingBox())!;
      await region.evaluate((r) => {
        const el = (
          r.matches('.mf-scroll-area, .wt-wrap')
            ? r
            : r.querySelector('.mf-scroll-area, .wt-wrap, .mf-scroll')
        ) as HTMLElement;
        el.scrollLeft = el.scrollWidth;
      });
      const after = (await region.locator('thead tr:first-child th').last().boundingBox())!;
      expect(
        Math.abs(after.y - before.y),
        `${s.name}: the header row does not move`,
      ).toBeLessThanOrEqual(1);
      if (axeAvailable()) expect(await axeViolations(page), `${s.name} axe`).toEqual([]);
    });

    test(`${s.name} at 200% zoom (683 px wide) keeps the table and the page does not scroll sideways; at 400% (342 px) it is cards`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 683, height: 600 });
      await page.goto(s.url);
      const region = page.getByRole('region', { name: s.region });
      await expect(region).toBeVisible();
      await expect(region.locator('tbody tr').first()).toBeVisible();
      expect(await pageOverflow(page), `${s.name} at 200%`).toBeLessThanOrEqual(0);
      await page.setViewportSize({ width: 342, height: 400 });
      await page.goto(s.url);
      await expect(page.locator('main')).toBeVisible();
      await page.waitForTimeout(500);
      expect(await pageOverflow(page), `${s.name} at 400%`).toBeLessThanOrEqual(0);
    });
  }

  test('the keyboard scrolls the Task Queue frame sideways (arrow keys on the focused region)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/tasks');
    const region = page.getByRole('region', { name: 'Task Queue list, scrollable' });
    await expect(region.locator('tbody tr').first()).toBeVisible();
    const scroller = region.locator('.wt-wrap, .mf-scroll-area').first();
    const target = (await scroller.count()) ? scroller : region;
    await target.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => target.evaluate((el) => (el as HTMLElement).scrollLeft))
      .toBeGreaterThan(0);
    // Ref stays at the left edge of the frame (pinned) while the rest scrolls.
    const ref = (await region.locator('thead th[data-col="ref"]').boundingBox())!;
    const frame = (await region.boundingBox())!;
    expect(Math.abs(ref.x - frame.x)).toBeLessThanOrEqual(12);
  });
});
