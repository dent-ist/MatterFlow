import { axeBestPractice, axeAvailable } from '../support/axe';
import { mmWorld } from '../support/my-matters-fixtures';
import { expect, test } from '../support/fixtures';
import { SIZES } from '../support/screens';

/**
 * The shared tooltip (`mfTip`, #1268): the tip element sits on `body`, outside every landmark, so axe reported one "region" violation (moderate,
 * best-practice) on any page while a tooltip was visible. The tip is now `aria-hidden="true"`; the owner's `aria-describedby` still points at it.
 * Desktop only (D-82): 1366x768 and 1920x1080.
 */
test.describe('Tooltip open, axe 0 (#1268)', () => {
  for (const size of SIZES) {
    test(`tooltip open at ${size.width}: axe 0 (including the best-practice region rule) and the owner keeps aria-describedby`, async ({
      seed,
      personas,
      asUser,
    }) => {
      expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
      const w = await mmWorld(seed, personas, 'tip1268');
      const a = await w.matter('Alpha');
      await w.task(a, { title: 'Tip task' });
      const page = await asUser(w.pm.username);
      await page.setViewportSize(size);
      await page.goto('/my-matters');
      const owner = page.locator('[data-tree-collapse]');
      await expect(owner).toBeVisible();
      await owner.hover();
      const tip = page.locator('[role="tooltip"]');
      await expect(tip).toHaveText('Collapse to rail');
      await expect(tip).toHaveAttribute('aria-hidden', 'true');
      const id = await tip.getAttribute('id');
      await expect(owner).toHaveAttribute('aria-describedby', id!);
      expect(await axeBestPractice(page), 'tooltip open').toEqual([]);
    });
  }
});
