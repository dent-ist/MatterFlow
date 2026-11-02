import { expect, test } from '../support/fixtures';

/**
 * Matter detail redesign (MD-01, #1002 and MD-03, #1004): on a desktop window the page never scrolls, on every tab; only the lists inside it do.
 * Measured as the document's scroll height against the window height at 1366x768, 1366x600 and 1920x1080.
 */
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1366, height: 600 },
  { width: 1920, height: 1080 },
] as const;
const TABS = [undefined, 'tasks', 'projects', 'assets', 'activities'] as const;

test.describe('Matter detail: the page does not scroll', () => {
  test('document height equals the window height on every tab and size', async ({ page, seed }) => {
    const world = await seed.world();
    for (let i = 0; i < 12; i++) await seed.task(world);
    await seed.project(world.matter);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      for (const tab of TABS) {
        await page.goto(`/matters/${world.matter.matterId}${tab ? `?tab=${tab}` : ''}`);
        await expect(page.locator('[data-matter-header] h1')).toBeVisible();
        await page.waitForLoadState('networkidle');
        const m = await page.evaluate(() => ({
          doc: document.documentElement.scrollHeight,
          win: window.innerHeight,
        }));
        expect(m.doc, `${tab ?? 'summary'} at ${size.width}x${size.height}`).toBeLessThanOrEqual(
          m.win,
        );
      }
    }
  });
});
