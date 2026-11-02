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
        await page.goto(`/matters/${world.matter.matterId}${tab ? `?tab=${tab}` : ''}`);
        await expect(page.locator('[data-matter-header] h1')).toBeVisible();
        await page.waitForLoadState('networkidle');
        const m = await page.evaluate(() => {
          const win = window.innerHeight;
          // Name the element that reaches furthest below the window, so a failure says what to fix.
          let worst = '';
          let bottom = 0;
          for (const e of Array.from(
            (document.querySelector('main') ?? document.body).querySelectorAll('*'),
          )) {
            const r = e.getBoundingClientRect();
            if (r.height > 0 && r.bottom > bottom) {
              bottom = r.bottom;
              worst = `${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).slice(0, 60)}`;
            }
          }
          return {
            doc: document.documentElement.scrollHeight,
            bottom: Math.round(bottom),
            win,
            worst: `${worst} @${Math.round(bottom)}`,
          };
        });
        expect(
          m.bottom,
          `${tab ?? 'summary'} at ${size.width}x${size.height}; lowest element in the page ${m.worst}, document ${m.doc}`,
        ).toBeLessThanOrEqual(m.win);
      }
    }
  });
});
