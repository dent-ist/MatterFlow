import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { pmSolo, pmThree } from '../support/pm-fixtures';
import { SIZES } from '../support/screens';

/**
 * My Matters, a calmer page: batch 4 of epic #893 (Release 2, "Calm details").
 *
 *  - #919 one toggle pattern (the scope switch and the tab toggles share one component, one look, one keyboard behaviour);
 *  - #922 the phone's first screen shows tasks (the first task row within 420 px at 375x812);
 *  - #921 one error banner and one Retry per page; a skeleton without toolbars;
 *  - #899 the Client and Role filters share one label style and plain wording;
 *  - #898 plain sort labels and the server's Priority order;
 *  - #901 the same right-hand detail pattern in every list.
 */
const settled = async (page: Page): Promise<void> => {
  await expect(page.locator('#mm-tab-overview')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-mm-tabpanel] >> text=/^Loading /')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
};

test.describe('One toggle pattern (#919)', () => {
  test('the scope switch is a segmented toggle: same height as the controls, a check mark on the pressed button, one Tab stop, arrow keys', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4a');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    const group = page.locator('[data-scope-switch]');
    await expect(group).toHaveAttribute('aria-label', 'Scope');
    const mine = group.locator('[data-scope=mine]');
    const all = group.locator('[data-scope=all]');
    await expect(mine).toHaveAttribute('aria-pressed', 'true');
    // The pressed state is not colour alone: a check mark before its words.
    const tick = (b: typeof mine) =>
      b.evaluate((el) => getComputedStyle(el, '::before').content.replace(/"/g, ''));
    expect(await tick(mine)).toBe('✓');
    expect(await tick(all)).toBe('none');
    // Same height as the other controls of the page header (32 px at this width).
    const heights = await group
      .locator('button')
      .evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)));
    expect(heights).toEqual([32, 32]);
    // One Tab stop: only the pressed button is in the Tab order; arrows move the focus, Enter presses.
    await expect(mine).toHaveAttribute('tabindex', '0');
    await expect(all).toHaveAttribute('tabindex', '-1');
    await mine.focus();
    await page.keyboard.press('ArrowRight');
    await expect(all).toBeFocused();
    await expect(mine).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/scope=all/);
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(all).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('Tab');
    expect(await group.evaluate((g) => g.contains(document.activeElement))).toBe(false);
  });

  test('the tab toggles use the same pattern and plain words, and no two controls of a tab share a label', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4b');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    for (const [tab, group, words] of [
      ['breakdown', 'Matters shown', ['By matter', 'All together']],
      ['trends', 'Weeks shown', ['8 weeks', '12 weeks', '26 weeks']],
    ] as const) {
      await page.goto(`/my-matters?tab=${tab}`);
      const g = page.locator(`[role=group][aria-label="${group}"]`);
      await expect(g).toBeVisible();
      await expect(g).toHaveClass(/mf-seg/);
      expect(await g.locator('button').allInnerTexts()).toEqual(words.map((w) => w));
      await expect(g.locator('button[aria-pressed=true]')).toHaveCount(1);
    }
    // "All matters" belongs to the scope switch only.
    await page.goto('/my-matters?tab=breakdown');
    await expect(page.getByRole('button', { name: 'All matters', exact: true })).toHaveCount(1);
    // Deadlines: List / Calendar sit behind Options and are the same component.
    await page.goto('/my-matters?tab=deadlines');
    await page.locator('[data-panel=deadlines-tab] [data-options-trigger]').click();
    const view = page.locator('[role=group][aria-label="Show deadlines as"]');
    await expect(view).toHaveClass(/mf-seg/);
    expect(await view.locator('button').allInnerTexts()).toEqual(['List', 'Calendar']);
  });

  test('Focus is the same menu as every Options button', async ({ seed, personas, asUser }) => {
    const p = await pmSolo(seed, personas, 'b4c');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    const focus = page.locator('[data-focus] [data-options-trigger]');
    await expect(focus).toContainText('Focus');
    expect(await focus.evaluate((e) => Math.round(e.getBoundingClientRect().height))).toBe(32);
    const options = page.locator('[data-panel=attention] [data-options-trigger]');
    expect(
      await options.evaluate((e) => Math.round(e.getBoundingClientRect().height)),
    ).toBeLessThanOrEqual(32);
    expect(await focus.evaluate((e) => getComputedStyle(e).borderRadius)).toBe(
      await options.evaluate((e) => getComputedStyle(e).borderRadius),
    );
  });

  for (const size of SIZES) {
    test(`axe is clean at ${size.width}x${size.height} with the toggles on screen`, async ({
      seed,
      personas,
      asUser,
    }) => {
      expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
      const p = await pmThree(seed, personas, `b4x${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize(size);
      for (const tab of ['', '?tab=breakdown', '?tab=trends']) {
        await page.goto(`/my-matters${tab}`);
        await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
        expect(await axeViolations(page), `${tab || 'overview'} at ${size.width}`).toEqual([]);
      }
    });
  }
});
