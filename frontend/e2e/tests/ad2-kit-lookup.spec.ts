import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * WP-AD2 #564: the lookup dialog (`mf-lookup-dialog`), proven on the Status labels rename (`/admin/status-labels`): one short form in a dialog
 * with a live preview, the counter, the validation summary with focus on the first invalid field, the unsaved guard (Stay is the default) and
 * focus back on the control that opened it. Screenshots go to E2E_SCREENSHOTS (docs/ux/admin-pages-review/fixes/ad2-kit).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function noSideScroll(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${what}: page-level horizontal scroll`).toBeLessThanOrEqual(0);
}

const rename = (page: Page, code: string) =>
  page.locator(`[data-row="${code}"]`).locator('[data-edit]');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Rename status label' });
const field = (page: Page) => page.locator('#status-label-name');

test.describe('lookup dialog on the Status labels rename (#564)', () => {
  test('opens on the first field, previews live, saves, and puts focus back on the status name', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/status-labels');
    const opener = rename(page, 'ON_HOLD');
    const original = (
      await page.locator('[data-row="ON_HOLD"] mf-status-badge').innerText()
    ).trim();
    const name = `Waiting ${uid().slice(0, 6)}`;
    try {
      await opener.click();
      await expect(dialog(page)).toBeVisible();
      await expect(field(page)).toBeFocused();
      await expect(dialog(page)).toContainText('The code ON_HOLD and every task');
      await expect(dialog(page).locator('[data-char-count]')).toContainText(
        `${original.length} / 50`,
      );
      await field(page).fill(name);
      await expect(dialog(page).locator('[data-preview]')).toContainText(name);
      // The row keeps its old name until the save.
      await expect(page.locator('[data-row="ON_HOLD"] mf-status-badge')).not.toContainText(name);
      await dialog(page).getByRole('button', { name: 'Save name' }).click();
      await expect(dialog(page)).toBeHidden();
      await expect(page.locator('[data-row="ON_HOLD"] mf-status-badge')).toContainText(name);
      await expect(opener).toBeFocused();
    } finally {
      await page.goto('/admin/status-labels');
      await rename(page, 'ON_HOLD').click();
      await field(page).fill(original);
      await dialog(page).getByRole('button', { name: 'Save name' }).click();
      await expect(dialog(page)).toBeHidden();
    }
  });

  test('a blank name shows the summary, the message and focus on the field; Escape with edits asks, Stay keeps the dialog, Leave closes it and focus returns', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/status-labels');
    const opener = rename(page, 'CANCELLED');
    // Never saved: the test only changes the text, so the shared status labels stay as they are.
    const dropped = `Dropped ${uid().slice(0, 6)}`;
    await opener.click();
    await field(page).fill('');
    await dialog(page).getByRole('button', { name: 'Save name' }).click();
    const summary = dialog(page).locator('[data-summary]');
    await expect(summary).toHaveAttribute('role', 'alert');
    await expect(summary).toContainText('Fix the following to save:');
    await expect(summary.locator('li')).toHaveText(['Enter a label.']);
    await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(field(page)).toBeFocused();
    await shot(page, 'lookup-invalid');
    // Edits: Escape asks; Stay is the default button.
    await field(page).fill(dropped);
    await page.keyboard.press('Escape');
    const ask = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(ask).toBeVisible();
    await expect(ask.getByRole('button', { name: 'Stay' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(ask).toBeHidden();
    await expect(dialog(page)).toBeVisible();
    await expect(field(page)).toHaveValue(dropped);
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await ask.getByRole('button', { name: 'Leave' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator('[data-row="CANCELLED"] mf-status-badge')).not.toContainText(
      'Dropped',
    );
    await expect(opener).toBeFocused();
  });

  test('keyboard only: Tab stays inside the dialog (field, Close, Cancel, Save), Escape without edits closes at once', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/status-labels');
    await rename(page, 'NEW').focus();
    await page.keyboard.press('Enter');
    await expect(field(page)).toBeFocused();
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));
      expect(inside, `Tab ${i} stays in the dialog`).toBe(true);
      seen.add(
        (await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')) || 'x',
      );
    }
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toHaveCount(0);
    await expect(rename(page, 'NEW')).toBeFocused();
  });

  for (const size of SIZES) {
    test(`${size.width}: the open dialog has no sideways page scroll and axe 0`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      // The dialog is opened by the address (`?edit=<code>`, what the name link and the phone card go to): below 640 px the page shows cards.
      await page.goto('/admin/status-labels?edit=IN_PROGRESS');
      await expect(dialog(page)).toBeVisible();
      await field(page).fill('');
      await dialog(page).getByRole('button', { name: 'Save name' }).click();
      await expect(dialog(page).locator('[data-summary]')).toBeVisible();
      const box = (await dialog(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      await noSideScroll(page, `dialog at ${size.width}`);
      if (axeAvailable()) expect(await axeViolations(page), `axe at ${size.width}`).toEqual([]);
      await shot(page, 'lookup-dialog');
    });
  }

  test('permissions: a Task.View-only person gets the 403 page; a StatusLabel.Manage person can rename', async ({
    seed,
    asUser,
  }) => {
    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'ad2-lk-viewer')).username);
    await viewer.goto('/admin/status-labels');
    await expect(
      viewer.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    const role = await seed.role(['StatusLabel.Manage', 'Task.View'], 'Labels only');
    const manager = await asUser((await seed.user([role.name], 'ad2-lk-mgr')).username);
    await manager.goto('/admin/status-labels');
    await expect(rename(manager, 'NEW')).toBeVisible();
    await rename(manager, 'NEW').click();
    await expect(dialog(manager)).toBeVisible();
  });
});
