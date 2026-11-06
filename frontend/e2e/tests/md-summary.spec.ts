import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * The redesigned Summary tab (MD-42, #1060): asset strip, one full-width Details card that fits its content, 3, 2 or 1 columns of fields, no Recent activity, the
 * page does not scroll. Screenshots go to E2E_SCREENSHOTS when it is set (1366x768, 1920x1080, 1366x600 and 375x812 for the comparison with the mockup).
 */
const SIZES = [
  { width: 1366, height: 768, columns: 2 },
  { width: 1920, height: 1080, columns: 3 },
  { width: 1366, height: 600, columns: 2 },
  { width: 768, height: 1024, columns: 1 },
  { width: 375, height: 812, columns: 1 },
] as const;

test('Summary: asset strip, fit-to-content Details in 3, 2 or 1 columns, no Recent activity, axe clean', async ({
  page,
  seed,
}) => {
  const world = await seed.world();
  await seed.asset(world.matter, 'Laptop one');
  const dir = process.env['E2E_SCREENSHOTS'];
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(`/matters/${world.matter.matterId}`);
    const details = page.locator('[data-summary-details]');
    await expect(details).toBeVisible();
    await expect(page.locator('[data-summary-assets]')).toBeVisible();
    await expect(page.getByText('Recent Activity')).toHaveCount(0);
    await page.waitForLoadState('networkidle');

    const m = await page.evaluate(() => {
      const card = document.querySelector('[data-summary-details]') as HTMLElement;
      const fields = document.querySelector('[data-summary-details] dl') as HTMLElement;
      const main = document.querySelector('main') as HTMLElement;
      return {
        columns: getComputedStyle(fields).gridTemplateColumns.split(' ').length,
        cardBottom: card.getBoundingClientRect().bottom,
        mainBottom: main.getBoundingClientRect().bottom,
        mainScroll: main.scrollHeight - main.clientHeight,
        cardWidth: card.getBoundingClientRect().width,
        mainWidth: main.getBoundingClientRect().width,
      };
    });
    expect(m.columns, `columns at ${size.width}`).toBe(size.columns);
    // Full width card; on a desktop the page never scrolls and the card ends inside the window.
    expect(m.cardWidth).toBeGreaterThan(m.mainWidth * 0.8);
    if (size.width >= 768 && size.height >= 561) {
      expect(m.mainScroll, `main scrolls at ${size.width}x${size.height}`).toBeLessThanOrEqual(1);
      expect(m.cardBottom).toBeLessThanOrEqual(m.mainBottom + 1);
    }
    if (dir) await page.screenshot({ path: `${dir}/summary-${size.width}x${size.height}.png` });
    if (axeAvailable()) expect(await axeViolations(page), `axe at ${size.width}`).toEqual([]);
  }
});
