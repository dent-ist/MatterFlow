import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { mmWorld } from '../support/my-matters-fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * MM-20 (#1053, epic #1037): My Matters has one way to choose a client and matter, the Client and Matters tree. No dropdowns, the tree is open by default,
 * the scope is a removable chip beside the title (also while the tree is on its rail), and under 1100 px one Scope button opens the tree (a sheet on a phone).
 */
test.describe('My Matters scope without dropdowns (#1053)', () => {
  test.setTimeout(240_000);

  test('desktop: tree open by default, a pick shows the chip, collapse keeps the chip, x clears it; the address keeps working', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'mm20a');
    const a = await w.matter('Alpha');
    await w.matterInOtherClient('Beta');
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    const tree = page.getByRole('tree', { name: 'Client and Matters' });
    await expect(tree).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Client and Matters' })).toBeVisible();
    await expect(page.locator('#mm-client, #mm-matter')).toHaveCount(0);
    await expect(page.locator('[data-scope-chip]')).toHaveCount(0);
    await expect(page.locator('[data-browse]')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
    ).toBeLessThanOrEqual(1);
    await shot(page, 'mm20-default');

    await tree.getByRole('treeitem', { name: new RegExp(a.name) }).click();
    await expect(page).toHaveURL(/matterId=\d+/);
    const clientId = new URL(page.url()).searchParams.get('clientId');
    const chip = page.locator('[data-scope-chip]');
    await expect(chip).toContainText(a.name);
    await expect(tree).toBeVisible();
    const h1 = (await page.getByRole('heading', { name: 'My Matters', level: 1 }).boundingBox())!;
    const c = (await chip.boundingBox())!;
    expect(c.x).toBeGreaterThan(h1.x + h1.width - 1);
    expect(Math.abs(c.y + c.height / 2 - (h1.y + h1.height / 2))).toBeLessThan(20);
    await shot(page, 'mm20-chip');

    await page.getByRole('button', { name: 'Collapse the tree to a thin rail' }).click();
    await expect(page.locator('mf-mm-tree-rail')).toBeVisible();
    await expect(chip).toBeVisible();
    await page.reload();
    await expect(page.locator('mf-mm-tree-rail')).toBeVisible(); // the person's own collapse is remembered
    await expect(chip).toContainText(a.name);
    await page.getByRole('button', { name: /^Clear scope/ }).click();
    await expect(page).not.toHaveURL(/matterId=|clientId=/);
    await expect(chip).toHaveCount(0);
    // An address with a client keeps working.
    await page.goto(`/my-matters?clientId=${clientId}`);
    await expect(chip).toContainText('all matters');
  });

  for (const size of SIZES) {
    test(`axe is clean and nothing scrolls sideways at ${size.width}x${size.height}; Scope button where the tree is not docked`, async ({
      seed,
      personas,
      asUser,
    }) => {
      expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
      const w = await mmWorld(seed, personas, `mm20b${size.width}`);
      const a = await w.matter('Alpha');
      await w.matterInOtherClient('Beta');
      const page = await asUser(w.pm.username);
      await page.setViewportSize(size);
      await page.goto(`/my-matters?matterId=${a.matterId}`);
      await expect(page.locator('[data-scope-chip]')).toContainText(a.name);
      await noHorizontalScroll(page);
      expect(await axeViolations(page), `page at ${size.width}`).toEqual([]);
      if (size.width < 1100) {
        const scope = page.locator('[data-browse]');
        await expect(scope).toBeVisible();
        await expect(scope).toHaveText(/Scope/);
        await scope.click();
        const dialog = page.getByRole('dialog', { name: 'Client and Matters' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('tree', { name: 'Client and Matters' })).toBeVisible();
        expect(await axeViolations(page), `Scope sheet at ${size.width}`).toEqual([]);
        await shot(page, 'mm20-scope-sheet');
        await dialog.getByRole('treeitem').first().click();
        await expect(dialog).toHaveCount(0);
      } else {
        await expect(page.getByRole('tree', { name: 'Client and Matters' })).toBeVisible();
      }
      await shot(page, 'mm20-page');
    });
  }
});
