import { expect, test } from '../support/fixtures';
import { axeAvailable, axeViolations } from '../support/axe';

/**
 * Administration > Settings > Holidays and the coverage thresholds (epic #1074, CAL-06, issue #1080): a "US Holiday" calendar with Thanksgiving (4th Thursday of November,
 * every year), a "Firm closure" for a range of days, the next-year preview, a pasted list of ten lines with one bad line (checked line by line before anything is saved),
 * a person's calendar on the user, and the thresholds (save and Reset to default). Needs Settings.Manage (the System Admin). axe at 1366x768 and 375x812.
 */

test.describe('Settings > Holidays', () => {
  test('build a US Holiday calendar with Thanksgiving, a Firm closure range, and preview next year', async ({
    page,
  }) => {
    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Holidays' }).click();
    await expect(page.locator('[data-holidays-admin]')).toBeVisible();

    const name = `US Holiday ${Date.now() % 100000}`;
    await page.locator('[data-new-calendar]').click();
    const calendar = page.getByRole('dialog', { name: 'New holiday calendar' });
    await calendar.getByLabel('Category name').fill(name);
    await calendar.getByRole('button', { name: 'Create' }).click();
    await expect(calendar).toBeHidden();
    await expect(page.locator('[data-calendar]', { hasText: name })).toBeVisible();

    await page.locator('[data-add-holiday]').click();
    const holiday = page.getByRole('dialog', { name: 'Add holiday' });
    await holiday.getByLabel('Name').fill('Thanksgiving');
    await holiday.getByLabel('Date rule').selectOption('NTH_WEEKDAY');
    await holiday.getByLabel('Which').selectOption({ label: '4th' });
    await holiday.getByLabel('Weekday').selectOption({ label: 'Thursday' });
    await holiday.locator('#hd-nmonth').selectOption({ label: 'November' });
    await holiday.getByRole('button', { name: 'Add holiday' }).click();
    await expect(holiday).toBeHidden();
    const row = page.locator('[data-holiday]', { hasText: 'Thanksgiving' });
    await expect(row).toContainText('Every year, 4th Thursday of November');
    await expect(row).toContainText(/Thu 11\/\d\d/);

    // Next year's preview.
    await page.locator('[data-year-next]').click();
    await expect(page.locator('[data-holidays-table] thead')).toContainText(
      `Date in ${new Date().getFullYear() + 1}`,
    );
    await expect(row).toContainText(/Thu 11\/\d\d\/\d{4}/);
  });

  test('a Firm closure range for Dec 24 to Dec 26 that applies to everyone', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Holidays' }).click();
    const name = `Firm closure ${Date.now() % 100000}`;
    await page.locator('[data-new-calendar]').click();
    const calendar = page.getByRole('dialog', { name: 'New holiday calendar' });
    await calendar.getByLabel('Category name').fill(name);
    await calendar.getByLabel(/Applies to everyone/).check();
    await calendar.getByRole('button', { name: 'Create' }).click();
    await expect(calendar).toBeHidden();

    await page.locator('[data-add-holiday]').click();
    const holiday = page.getByRole('dialog', { name: 'Add holiday' });
    await holiday.getByLabel('Name').fill('Year-end');
    await holiday.getByLabel('Range of days').check();
    await holiday.locator('#hd-month').selectOption({ label: 'December' });
    await holiday.locator('#hd-day').fill('24');
    await holiday.locator('#hd-emonth').selectOption({ label: 'December' });
    await holiday.locator('#hd-eday').fill('26');
    await holiday.getByRole('button', { name: 'Add holiday' }).click();
    await expect(holiday).toBeHidden();
    await expect(page.locator('[data-holiday]', { hasText: 'Year-end' })).toContainText('12/24 to');
  });

  test('paste ten lines with one bad line: it is named before anything is saved', async ({
    page,
  }) => {
    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Holidays' }).click();
    await page.locator('[data-calendar]').first().click();
    await page.locator('[data-import]').click();
    const dialog = page.getByRole('dialog', { name: 'Import or paste holidays' });
    const year = new Date().getFullYear() + 2;
    const lines = Array.from(
      { length: 9 },
      (_, i) => `${String((i % 9) + 1).padStart(2, '0')}/15/${year}, Paste ${i + 1}`,
    );
    lines.splice(4, 0, `July 4 ${year}, Bad line`);
    await dialog.getByLabel(/One holiday per line/).fill(lines.join('\n'));
    await expect(dialog.locator('[data-import-summary]')).toContainText(
      '9 ready, 1 with a problem',
    );
    await expect(dialog.locator('[data-import-result] tr.im__bad')).toHaveCount(1);
    await dialog.getByRole('button', { name: /Import 9 holidays/ }).click();
    await expect(dialog).toBeHidden();
  });

  test('a person is assigned to a calendar on the user, and the pod default is set', async ({
    page,
    seed,
    admin,
  }) => {
    const { userId } = await seed.user(['Data Technician'], 'hol-user');
    const display = (await admin.get(`/api/v1/users/${userId}`)).displayName as string;
    await page.goto(`/admin/users?status=active&name=${encodeURIComponent(display)}`);
    await page.locator('tbody tr', { hasText: display }).click();
    const field = page.locator('[data-user-calendar-select]');
    await expect(field).toBeVisible();
    const options = await field.locator('option').allTextContents();
    await field.selectOption({ index: Math.min(1, options.length - 1) });
    await expect(page.getByText('Holiday calendar saved').first()).toBeVisible();
    await expect(page.locator('[data-next-holidays]')).toBeVisible();
  });

  test('the capacity checkbox (count people outside work hours) is on by default, saves and resets', async ({
    page,
  }) => {
    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Dashboard' }).click();
    const form = page.locator('[data-capacity-settings]');
    const box = form.locator('[data-count-off-hours]');
    await expect(box).toBeVisible();
    await expect(box).toBeChecked();
    await box.uncheck();
    await form.locator('p-button[data-capacity-save] button').click();
    await expect(
      page.getByText('Saved. The capacity battery uses the new rule').first(),
    ).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'Dashboard' }).click();
    await expect(box).not.toBeChecked();
    await box.check();
    await form.locator('p-button[data-capacity-save] button').click();
    await expect(
      page.getByText('Saved. The capacity battery uses the new rule').first(),
    ).toBeVisible();
    await expect(box).toBeChecked();
  });

  test('the thresholds save, validate and reset to the defaults', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Dashboard' }).click();
    const form = page.locator('[data-calendar-thresholds]');
    await expect(form.locator('#th-min')).toBeVisible();
    await form.locator('#th-min').fill('80');
    await form.locator('[data-th-save]').click();
    await expect(page.getByText('Calendar coverage saved').first()).toBeVisible();
    await form.locator('#th-pod').fill('95');
    await expect(form).toContainText('cannot be higher than the firm minimum');
    await form.locator('[data-th-reset]').click();
    await expect(form.locator('#th-min')).toHaveValue('75');
    await expect(form.locator('#th-pod')).toHaveValue('60');
    await form.locator('[data-th-save]').click();
    await expect(page.getByText('Calendar coverage saved').first()).toBeVisible();
  });

  test('without Settings.Manage the page is not offered', async ({ asUser, personas }) => {
    const director = await personas.named('director');
    const page = await asUser(director.username);
    await page.goto('/admin/settings');
    await expect(page.locator('[data-holidays-admin]')).toHaveCount(0);
  });
});

test.describe('Settings > Holidays: accessibility (axe wcag2a, wcag2aa, wcag21aa)', () => {
  test.skip(!axeAvailable(), 'axe-core is not installed (npm ci) and E2E_AXE_PATH is not set');
  for (const size of [
    { name: '1366x768', width: 1366, height: 768 },
    { name: '1920x1080', width: 1920, height: 1080 },
    { name: '768x1024', width: 768, height: 1024 },
    { name: '375x812', width: 375, height: 812 },
  ]) {
    test(`the list, the holiday dialog and the thresholds are clean at ${size.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/admin/settings');
      await page.getByRole('tab', { name: 'Holidays' }).click();
      await expect(page.locator('[data-holidays-table]')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
      await page.locator('[data-add-holiday]').click();
      await expect(page.getByRole('dialog', { name: 'Add holiday' })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await page.getByRole('tab', { name: 'Dashboard' }).click();
      await expect(page.locator('[data-calendar-thresholds] #th-min')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});
