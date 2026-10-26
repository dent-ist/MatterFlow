import { expect, test } from '../support/fixtures';
import { axeAvailable, axeViolations } from '../support/axe';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { openEditAvailability, userRow } from '../support/users-grid';

/**
 * My profile epic #520, WP-PF7: #589 (regression). Administration > Users "Edit availability" shares `mf-availability-form` with My profile:
 * the compact hours, the per-day grid, the Time zone select and the conflict handling must work there, the profile's two-column layout and
 * cards must not leak into the dialog, and the dialog must not scroll sideways. Screenshots for docs/ux/profile-review/fixes/pf7-audit/.
 */
test.describe('pf7-users-dialog: Edit availability with the shared form (#589)', () => {
  test('compact hours, grid, time zone select and Save for another person; the page layout is not forced into the dialog', async ({
    page,
    seed,
    admin,
  }) => {
    const { userId, username } = await seed.user(['Data Technician'], 'pf7dlg');
    const name = (await admin.get(`/api/v1/users/${userId}`)).displayName as string;
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/admin/users?status=active&name=${encodeURIComponent(name)}`);
      await openEditAvailability(userRow(page, userId, username));
      const dialog = page.getByRole('dialog', { name: `Availability of ${name}` });
      await expect(dialog.locator('[data-day-toggle]')).toHaveCount(7);
      // Flat sections and the "current status" line, not the page's cards, header preview or "No unsaved changes" text.
      await expect(dialog.locator('.av-form--page')).toHaveCount(0);
      await expect(dialog.locator('[data-preview]')).toContainText(`${name}'s current status`);
      await expect(dialog.locator('[data-actions-state]')).toHaveCount(0);
      await expect(dialog.locator('#av-tz')).toBeVisible();
      await noHorizontalScroll(page);
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
      if (axeAvailable()) expect(await axeViolations(page), `dialog at ${size.width}`).toEqual([]);
      await shot(page, 'pf7-users-dialog');
      await dialog.getByRole('button', { name: 'Different hours on some days' }).click();
      await expect(dialog.locator('[data-hours-grid]')).toBeVisible();
      await noHorizontalScroll(page);
      if (axeAvailable())
        expect(await axeViolations(page), `grid in dialog at ${size.width}`).toEqual([]);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/users?status=active&name=${encodeURIComponent(name)}`);
    await openEditAvailability(userRow(page, userId, username));
    const dialog = page.getByRole('dialog', { name: `Availability of ${name}` });
    await dialog.getByLabel('Start time', { exact: true }).fill('08:00');
    await dialog.getByRole('button', { name: 'Saturday', exact: true }).click();
    await dialog.locator('#av-tz').selectOption('America/Chicago');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();
    const saved = await admin.get(`/api/v1/users/${userId}/availability`);
    expect(saved.timeZoneId).toBe('America/Chicago');
    expect(saved.workHours.map((h: { dayOfWeek: number }) => h.dayOfWeek)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(saved.workHours[0].start.startsWith('08:00')).toBe(true);
  });

  test('a second editor gets the conflict text for another person and the latest values', async ({
    page,
    seed,
    admin,
  }) => {
    const { userId, username } = await seed.user(['Data Technician'], 'pf7conf');
    const name = (await admin.get(`/api/v1/users/${userId}`)).displayName as string;
    await page.goto(`/admin/users?status=active&name=${encodeURIComponent(name)}`);
    await openEditAvailability(userRow(page, userId, username));
    const dialog = page.getByRole('dialog', { name: `Availability of ${name}` });
    await expect(dialog.locator('[data-day-toggle]').first()).toBeVisible();
    await seed.outOfOffice(userId, { note: 'Changed elsewhere' });
    await dialog.getByLabel('Start time', { exact: true }).fill('07:00');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog.locator('[data-conflict]')).toContainText(
      `${name}'s availability was changed somewhere else`,
    );
    await expect(dialog.getByRole('radio', { name: /Out of office/ })).toBeChecked();
    await expect(dialog.getByLabel('Note (optional)')).toHaveValue('Changed elsewhere');
    await expect(dialog).toBeVisible();
  });
});
