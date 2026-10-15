import { expect, test } from '../support/fixtures';

/**
 * The shared form designer page (`TaskTypeFormPage`) is reached through the real router from Custom Fields, Task Types & Forms and
 * Workflow Steps. A route without the `parentCrumbs` data key used to leave that input `undefined` and the page threw
 * ("this.parentCrumbs is not a function or its return value is not iterable"), so "Edit fields" did nothing.
 */
test.describe('Form designer pages open from their lists', () => {
  test('Custom Fields: Edit fields opens the designer without a page error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto('/admin/custom-fields');
    await page
      .getByRole('link', { name: /Edit fields/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/custom-fields\/.+\/form/);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    expect(errors.filter((e) => /parentCrumbs|not iterable|ERROR/.test(e))).toEqual([]);
  });
});
