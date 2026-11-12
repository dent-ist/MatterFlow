import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * The Summary tab (MD-42, #1060; reworked in #1376): the asset strip, then the Details card at the left (fields in groups under quiet sub-headings, two columns of groups, the
 * Created and Last Updated line as its footer) and the 340 px side column at the right (the Team panel first); no Recent activity, the page does not scroll and, with this
 * ordinary matter, the Details card does not scroll inside itself either at 1366x768. Screenshots go to E2E_SCREENSHOTS when it is set (1366x768 and 1920x1080).
 */
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

test('Summary: asset strip, Details in groups beside the 340 px side column, no Recent activity, axe clean', async ({
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
    await expect(page.locator('[data-section-panel="team"]')).toBeVisible();
    await page.waitForLoadState('networkidle');

    const m = await page.evaluate(() => {
      const card = document.querySelector('[data-summary-details]') as HTMLElement;
      const body = document.querySelector('[data-summary-details] [role=region]') as HTMLElement;
      const side = document.querySelector('[data-summary-side]') as HTMLElement;
      const main = document.querySelector('main') as HTMLElement;
      return {
        cardBottom: card.getBoundingClientRect().bottom,
        cardRight: card.getBoundingClientRect().right,
        sideLeft: side.getBoundingClientRect().left,
        sideWidth: side.getBoundingClientRect().width,
        mainBottom: main.getBoundingClientRect().bottom,
        mainScroll: main.scrollHeight - main.clientHeight,
        bodyScroll: body.scrollHeight - body.clientHeight,
      };
    });
    expect(Math.round(m.sideWidth), `side column at ${size.width}`).toBe(340);
    expect(m.sideLeft).toBeGreaterThanOrEqual(m.cardRight);
    expect(m.mainScroll, `main scrolls at ${size.width}x${size.height}`).toBeLessThanOrEqual(1);
    expect(m.cardBottom).toBeLessThanOrEqual(m.mainBottom + 1);
    expect(m.bodyScroll, `Details scrolls inside itself at ${size.width}`).toBeLessThanOrEqual(1);
    if (dir) await page.screenshot({ path: `${dir}/summary-${size.width}x${size.height}.png` });
    if (axeAvailable()) expect(await axeViolations(page), `axe at ${size.width}`).toEqual([]);
  }
});
