import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { pmFixtures } from '../support/pm-fixtures';
import { SIZES, noHorizontalScroll } from '../support/screens';

/**
 * Search stays global and labels the results outside the person's matters (epic #758, #774): "Other matter" in words, only for a person who
 * can be a project manager and only on results that are not on a matter they manage.
 */
test.describe('Search stays global and labels results outside my matters', () => {
  test('a result outside my matters says "Other matter"; mine and everybody else\'s carry no label', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    await page.goto('/my-matters');
    const box = page.getByRole('combobox', { name: /Search/ });
    await box.fill(`Bravo solo ${fx.token}`);
    const option = page.getByRole('option').filter({ hasText: 'Bravo solo' }).first();
    await expect(option).toBeVisible();
    await expect(option.locator('[data-other-matter]')).toHaveText(/Other matter/);
    await expect(option).toHaveAccessibleName(/Other matter/);
    await box.fill(`Alpha primary ${fx.token}`);
    const mine = page.getByRole('option').filter({ hasText: 'Alpha primary' }).first();
    await expect(mine).toBeVisible();
    await expect(mine.locator('[data-other-matter]')).toHaveCount(0);

    // The Director cannot be a manager: the flag is absent and so is the label.
    const director = await asUser(fx.director.username);
    await director.goto('/matters?name=' + fx.token);
    await director.getByRole('combobox', { name: /Search/ }).fill(`Bravo solo ${fx.token}`);
    await expect(
      director.getByRole('option').filter({ hasText: 'Bravo solo' }).first(),
    ).toBeVisible();
    await expect(director.locator('[data-other-matter]')).toHaveCount(0);
  });

  test('the results page carries the label too, and axe is clean at four widths', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.skip(!axeAvailable(), 'axe-core is not installed');
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/search?q=${encodeURIComponent('Bravo solo ' + fx.token)}`);
      await expect(page.locator('[data-other-matter]').first()).toBeVisible();
      expect(await axeViolations(page), `search at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
    }
  });
});
