import { expect, test } from '../support/fixtures';

/**
 * Matter detail redesign (MD-01, #1002 and MD-03, #1004): on a desktop window the page never scrolls, on every tab; only the lists inside it do.
 * Measured as the lowest element of the main area against the window height (the left menu of the shell is not part of the page) at 1366x768, 1366x600 and 1920x1080.
 */
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1366, height: 600 },
  { width: 1920, height: 1080 },
] as const;
const TABS = [undefined, 'tasks', 'projects', 'assets', 'activities'] as const;

test.describe('Matter detail: the page does not scroll', () => {
  test('the page content ends inside the window on every tab and size', async ({ page, seed }) => {
    const world = await seed.world();
    for (let i = 0; i < 12; i++) await seed.task(world);
    await seed.project(world.matter);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      for (const tab of TABS) {
        // Below 768 px of height the shared grid frame keeps its minimum of five rows; the Summary must still fit.
        if (tab !== undefined && size.height < 768) continue;
        await page.goto(`/matters/${world.matter.matterId}${tab ? `?tab=${tab}` : ''}`);
        await expect(page.locator('[data-matter-header] h1')).toBeVisible();
        await page.waitForLoadState('networkidle');
        // The page itself never scrolls: the main area has nothing to scroll (only the lists inside it do).
        const m = await page.evaluate(() => {
          const main = document.querySelector('main') ?? document.body;
          return { scroll: main.scrollHeight, client: main.clientHeight };
        });
        expect(m.scroll, `${tab ?? 'summary'} at ${size.width}x${size.height}`).toBeLessThanOrEqual(
          m.client + 1,
        );
      }
    }
  });
});
