import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noSideScroll } from '../support/labels';
import { uid } from '../support/seed';

/**
 * Epic #1298 / #1301: the Matter page Team tab (grid, Add / Edit Team Member, remove confirm, duplicate email) and the Details card fields
 * (Matter Type, Current State, DMS Path, DFS Path with Copy). Needs the API with the matter-fields backend (#1300) and the Dev auth admin.
 */
test.describe('Matter page: Team tab and Details fields (#1301)', () => {
  test('Team tab: add, edit, duplicate email, remove; the tab count follows', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const admin = seed.admin;
    const title = await admin.post('/api/v1/team-titles', {
      name: `Attorney ${token}`,
      isActive: true,
    });
    const client = await seed.client({ name: `Team Client ${token}` });
    const matter = await seed.matter({ client, number: '00001', name: `Team Matter ${token}` });
    await page.setViewportSize(SIZES[1]);
    await page.goto(`/matters/${matter.matterId}?tab=team`);
    await expect(page.getByRole('tab', { name: /^Team/ })).toContainText('(0)');
    await expect(page.locator('[data-state-block]')).toContainText('No team members yet.');

    await page
      .locator('[data-empty-add-member] button, button[data-empty-add-member]')
      .first()
      .click();
    const dialog = page.locator('.mf-formdlg');
    await expect(dialog.locator('[data-panel-title]')).toContainText('Add Team Member'); // the title carries the CM Number as its subtitle
    await dialog.getByRole('button', { name: 'Add Member' }).click();
    await expect(dialog).toContainText('Enter a name.');
    await expect(dialog).toContainText('Enter an email address.');
    await expect(dialog).toContainText('Choose a title.');

    await dialog.locator('#member-name').fill('Ann Lee');
    await dialog.locator('#member-email').fill('ann.lee@firm.example');
    await dialog.locator('#member-title').click();
    await page.getByRole('option', { name: `Attorney ${token}` }).click();
    if (axeAvailable()) expect(await axeViolations(page), 'Add Team Member dialog').toEqual([]);
    await dialog.getByRole('button', { name: 'Add Member' }).click();
    await expect(page.getByText('Team member added')).toBeVisible();
    await expect(page.locator('[data-member-name]')).toHaveText(['Ann Lee']);
    await expect(page.getByRole('tab', { name: /^Team/ })).toContainText('(1)');

    // The same email again (letter case ignored) is refused with the field message.
    await page.locator('[data-add-member]').click();
    await dialog.locator('#member-name').fill('Ann Again');
    await dialog.locator('#member-email').fill('ANN.LEE@firm.example');
    await dialog.locator('#member-title').click();
    await page.getByRole('option', { name: `Attorney ${token}` }).click();
    await dialog.getByRole('button', { name: 'Add Member' }).click();
    await expect(dialog.locator('#member-email-error')).toContainText(
      'This email is already on the team.',
    );
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    // The dialog is dirty: Cancel asks "You have unsaved changes. Discard them?" (spec 4.3) before it closes.
    await dialog.getByRole('button', { name: 'Discard Changes' }).click();
    await expect(dialog).toHaveCount(0);

    // Edit through the name button.
    await page.locator('button[data-member-name]').click();
    await expect(dialog.locator('[data-panel-title]')).toContainText('Edit Team Member');
    await dialog.locator('#member-name').fill('Ann B. Lee');
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByText('Team member updated')).toBeVisible();
    await expect(page.locator('[data-member-name]')).toHaveText(['Ann B. Lee']);

    // Remove with the confirm.
    await page.getByRole('button', { name: 'Remove Ann B. Lee' }).click();
    await expect(page.locator('[data-remove-body]')).toContainText(
      "Ann B. Lee will be removed from this matter's team. You can add them again later.",
    );
    await page.getByRole('button', { name: 'Remove Team Member' }).last().click();
    await expect(page.getByText('Team member removed')).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Team/ })).toContainText('(0)');
    await noSideScroll(page, 'Team tab at 1366');
  });

  test('Details card shows Matter Type, Current State, DMS Path and DFS Path with Copy and a link for web addresses', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const admin = seed.admin;
    const type = await admin.post('/api/v1/matter-types', {
      name: `Type ${token}`,
      isActive: true,
    });
    const state = await admin.post('/api/v1/current-states', {
      name: `State ${token}`,
      isActive: true,
    });
    const client = await seed.client({ name: `Fields Client ${token}` });
    const matter = await seed.matter({ client, number: '00001', name: `Fields Matter ${token}` });
    const fresh = await admin.get(`/api/v1/matters/${matter.matterId}`);
    await admin.put(`/api/v1/matters/${matter.matterId}`, {
      name: fresh.name,
      isSensitive: fresh.isSensitive,
      rowVersion: fresh.rowVersion,
      matterTypeId: type.id,
      currentStateId: state.id,
      dmsPath: '\\\\fs01\\dms\\Matters\\1234\\Acme v. Beta',
      dfsPath: 'https://dfs.example.com/matters/1234/0056',
    });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/matters/${matter.matterId}`);
      const card = page.locator('[data-summary-details]');
      await expect(card.locator('[data-matter-type]')).toHaveText(`Type ${token}`);
      await expect(card.locator('[data-current-state]')).toHaveText(`State ${token}`);
      await expect(card.locator('[data-dms-path] [data-path-unc]')).toContainText('\\\\fs01\\dms');
      await expect(card.locator('[data-dms-path] a')).toHaveCount(0);
      const link = card.locator('[data-dfs-path] a');
      await expect(link).toHaveAttribute('href', 'https://dfs.example.com/matters/1234/0056');
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(card.getByRole('button', { name: 'Copy DMS Path' })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Copy DFS Path' })).toBeVisible();
      await noSideScroll(page, `Summary at ${size.width}`);
      if (axeAvailable()) expect(await axeViolations(page), `axe at ${size.width}`).toEqual([]);
    }
  });

  test('a matter without values shows "Not set" and no Copy button', async ({ page, seed }) => {
    const token = uid();
    const client = await seed.client({ name: `Blank Client ${token}` });
    const matter = await seed.matter({ client, number: '00001', name: `Blank Matter ${token}` });
    await page.setViewportSize(SIZES[1]);
    await page.goto(`/matters/${matter.matterId}`);
    const card = page.locator('[data-summary-details]');
    await expect(card.locator('[data-matter-type]')).toHaveText('Not set');
    await expect(card.locator('[data-current-state]')).toHaveText('Not set');
    await expect(card.locator('[data-path-none]')).toHaveCount(2);
    await expect(card.getByRole('button', { name: /^Copy D[MF]S Path$/ })).toHaveCount(0);
  });
});
