import { expect, test } from '../support/fixtures';

/**
 * One shared icon scale (US-06, #1097): the tab strip and the segmented switch use `--mf-icon-lg` (20 px), buttons `--mf-icon-md` (18 px), chips and badges `--mf-icon-sm` (16 px).
 * The numbers are the tokens' values, read in the browser, so a change of the scale in docs/ux/tokens.css moves the app and this test together.
 */
test('tab and button icons use the shared icon tokens, and nothing scrolls sideways', async ({
  page,
}) => {
  for (const [width, height] of [
    [1366, 768],
    [375, 812],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto('/dashboard');
    await expect(page.locator('i.tab__icon').first()).toBeVisible();
    const sizes = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const px = (name: string) => root.getPropertyValue(name).trim();
      const of = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).fontSize : null;
      };
      return {
        lg: px('--mf-icon-lg'),
        md: px('--mf-icon-md'),
        tab: of('i.tab__icon'),
        button: of('.mf-btn .pi'),
      };
    });
    expect(sizes.lg).toBe('20px');
    expect(sizes.md).toBe('18px');
    expect(sizes.tab).toBe(sizes.lg);
    if (sizes.button) expect(sizes.button).toBe(sizes.md);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
});
