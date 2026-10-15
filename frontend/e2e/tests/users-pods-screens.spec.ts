import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Screenshot run for docs/ux/users-pods (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/users-pods frontend/e2e/run-local.sh -g "users-pods screenshots"
 * Tabs, the Pods column, the popover, the primary flow and the read-only view at 1366x768 and 375x812.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { w: 1366, h: 768 },
  { w: 375, h: 812 },
];

test.describe('users-pods screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder to take the screenshots');

  test('takes the Users / Pods tab screenshots', async ({ page, seed, admin, asUser }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(OUT!, { recursive: true });
    const tag = uid();
    const names = [`Processing ${tag}`, `Review ${tag}`, `Intake ${tag}`, `Legacy ${tag}`];
    const ids: number[] = [];
    for (const name of names) ids.push((await seed.pod(name, [])).podId);
    const jamal = await seed.user(['Data Technician'], 'jamal');
    const priya = await seed.user([], 'priya');
    await admin.put(`/api/v1/users/${jamal.userId}/pods`, {
      podIds: [ids[0], ids[1]],
      primaryPodId: ids[0],
    });
    const legacyPod = await admin.get(`/api/v1/pods/${ids[3]}`);
    await admin.put(`/api/v1/users/${priya.userId}/pods`, { podIds: [ids[3]] });
    await admin.put(`/api/v1/pods/${ids[3]}`, {
      name: names[3],
      isActive: false,
      rowVersion: legacyPod.pod.rowVersion,
    });
    const auditor = await seed.user(['Compliance Auditor'], 'auditor');
    const shot = (p: Page, name: string, size: { w: number; h: number }) =>
      p.screenshot({ path: path.join(OUT!, `${name}-${size.w}x${size.h}.png`) });
    const grid = (p: Page) => p.goto(`/admin/users?status=all&q=${encodeURIComponent('e2e-')}`);

    for (const size of SIZES) {
      await page.setViewportSize({ width: size.w, height: size.h });
      await grid(page);
      await expect(page.locator(`tr[data-user="${jamal.userId}"]`)).toBeVisible();
      await shot(page, 'users-grid-pods-column', size);

      const row = page.locator(`tr[data-user="${jamal.userId}"]`);
      await row.locator('[data-pods-trigger]').click();
      await page.getByRole('textbox', { name: 'Search pods' }).fill(tag);
      await expect(page.locator('[data-pod-option]')).toHaveCount(3);
      await shot(page, 'popover-open', size);

      // Primary flow: untick the primary pod.
      await page.getByRole('checkbox', { name: names[0] }).uncheck();
      await expect(page.locator('[data-primary-required]')).toBeVisible();
      await shot(page, 'popover-primary-required', size);
      await page.keyboard.press('Escape');

      // After an Apply (adds Intake as an extra pod): chips and Undo toast.
      await row.locator('[data-pods-trigger]').click();
      await page.getByRole('textbox', { name: 'Search pods' }).fill(tag);
      await page.getByRole('checkbox', { name: names[2] }).check();
      await page.getByRole('button', { name: 'Apply' }).click();
      await expect(page.locator('[data-undo-toast]')).toBeVisible();
      await shot(page, 'after-apply-undo', size);
      await page.locator('[data-undo]').click();
      await expect(row.locator('[data-pod-chip]')).toHaveCount(2);

      await page.goto('/admin/pods');
      await expect(page.locator('table[data-pods]')).toBeVisible();
      await shot(page, 'pods-tab', size);
      await page.goto(`/admin/pods?pod=${ids[0]}`);
      await expect(page.getByRole('heading', { name: 'Edit pod' })).toBeVisible();
      await shot(page, 'pods-tab-editor', size);

      const ro = await asUser(auditor.username);
      await ro.setViewportSize({ width: size.w, height: size.h });
      await grid(ro);
      await expect(ro.locator(`tr[data-user="${jamal.userId}"]`)).toBeVisible();
      await shot(ro, 'read-only-chips', size);
      await ro.context().close();
    }
  });
});
