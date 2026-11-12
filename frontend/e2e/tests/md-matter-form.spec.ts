import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * One matter form for the New Matter page (epic #1368; it was a pop-up) and the Edit pop-up (MD-43, #1061): the same fields in the same order, the CM Number as a read-only preview, Client and Matter number locked in Edit,
 * the matter number unlocked only after a confirmation and confirmed again on Save with its result. axe at both desktop sizes. Screenshots to E2E_SCREENSHOTS when set.
 */
const SIZES = [
  [1366, 768],
  [1920, 1080],
] as const;

const fieldLabels = async (page: Page, scope: string) =>
  (await page.locator(scope).locator('.mf-label, .mf-field__label').allTextContents()).map((t) =>
    t
      .replace(/\(required\)/, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );

test.describe('Matter form (MD-43)', () => {
  test('New and Edit show the same fields; the CM Number follows the inputs and is never typed; axe is clean at both desktop sizes', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Form ${uid()}` });
    const matter = await seed.matter({ client, name: `Form matter ${uid()}` });
    const dir = process.env['E2E_SCREENSHOTS'];

    // New Matter is a full page (epic #1368, #1371); Edit stays the pop-up. Both hold the same matter form.
    await page.goto(`/matters/new?clientId=${client.clientId}`);
    const form = page.locator('[data-matter-form]');
    await expect(page.getByRole('heading', { level: 1, name: 'New Matter' })).toBeVisible();
    const created = await fieldLabels(page, '[data-matter-form]');
    expect(created.slice(0, 4)).toEqual(['Client', 'Matter Number', 'CM Number', 'Matter Name']);
    expect(created).toContain('Matter Types');
    expect(created).toContain('Matter Category');
    await expect(form.locator('[data-cm-value]')).toHaveJSProperty('tagName', 'OUTPUT');
    await form.locator('#matter-number').fill('12');
    await expect(form.locator('[data-cm-value]')).toHaveText(`${client.clientNumber}-00012`);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      if (dir) await page.screenshot({ path: `${dir}/matter-form-new-${w}x${h}.png` });
      if (axeAvailable()) expect(await axeViolations(page), `New matter axe at ${w}`).toEqual([]);
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${matter.matterId}`);
    await page.locator('[data-edit-matter]').click();
    const dialog = page.locator('[data-matter-form]');
    await expect(page.getByRole('heading', { level: 1, name: 'Edit Matter' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/matters/${matter.matterId}/edit$`));
    expect(await fieldLabels(page, '[data-matter-form]')).toEqual(created);
    // Client and Matter number are in the same places, locked; the CM Number shows the current one.
    await expect(dialog.locator('#matter-number')).toBeDisabled();
    await expect(dialog.locator('[data-cm-value]')).toHaveText(matter.matterRef);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      if (dir) await page.screenshot({ path: `${dir}/matter-form-edit-${w}x${h}.png` });
      if (axeAvailable()) expect(await axeViolations(page), `Edit matter axe at ${w}`).toEqual([]);
    }
  });

  test('changing the matter number: unlock confirmation, then the result is confirmed on Save and the CM Number changes', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Num ${uid()}` });
    const matter = await seed.matter({ client, number: '00021', name: `Num matter ${uid()}` });
    await page.goto(`/matters/${matter.matterId}`);
    await page.locator('[data-edit-matter]').click();
    const dialog = page.locator('[data-matter-form]');
    await expect(dialog.locator('#matter-number')).toBeDisabled();

    // Cancel keeps it locked.
    await dialog.locator('[data-change-number]').click();
    await page
      .getByRole('dialog', { name: 'Unlock Matter Number' })
      .getByRole('button', { name: 'Cancel' })
      .click();
    await expect(dialog.locator('#matter-number')).toBeDisabled();

    await dialog.locator('[data-change-number]').click();
    await page
      .getByRole('dialog', { name: 'Unlock Matter Number' })
      .getByRole('button', { name: 'Unlock Matter Number' })
      .click();
    await expect(dialog.locator('#matter-number')).toBeEnabled();
    await dialog.locator('#matter-number').fill('00022');
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    const confirm = page.getByRole('dialog', { name: 'Change CM Number' });
    await expect(confirm).toContainText(`from ${matter.matterRef} to ${client.clientNumber}-00022`);
    await confirm.getByRole('button', { name: 'Change CM Number' }).click();
    await expect(page.locator('[data-summary-details] .mf-ref')).toHaveText(
      `${client.clientNumber}-00022`,
    );
  });

  test('without Matter.EditNumber the matter number stays locked with no Change button', async ({
    page,
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const role = await seed.role(
      ['Matter.View', 'Matter.Edit', 'Client.View'],
      'E2E editor no number',
    );
    const user = await seed.user([role.name], 'editor-no-number');
    const p = await asUser(user.username);
    await p.goto(`/matters/${world.matter.matterId}`);
    await p.locator('[data-edit-matter]').click();
    await expect(p.locator('[data-matter-form] #matter-number')).toBeDisabled();
    await expect(p.locator('[data-matter-form] [data-change-number]')).toHaveCount(0);
    void page;
  });
});
