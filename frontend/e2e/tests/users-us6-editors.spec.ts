import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * Users epic #422, WP-US6: the Roles editor (#448 select all / none per group and the Changed (n) row, #449 the description) and the Pod editor
 * as a record page (#451).
 *  - each permission group has Select all and Select none buttons; a saved role shows Changed (n) with one undo per chip, cleared by Save;
 *  - the description is a two-row text area with a counter that holds the 500 characters of the API;
 *  - a pod opens as a record page: crumb Administration > Users > Pods > name, the name, the Active badge, Deactivate in the overflow; Back and
 *    the crumb return to the list as it was (filters) with focus on the row; an unknown pod is the not-found state; Pod.ManageMembers can change
 *    members but not the name or the status;
 *  - axe is required here (a missing axe-core fails the file); axe 0 and no sideways scroll at four widths with the editors open.
 * Screenshots for docs/ux/users-review/fixes/us6-roles-pods/ are written when E2E_SCREENSHOTS is set to the output folder.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const TAG = `us6e${Math.floor(Math.random() * 90000) + 10000}`;
const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

let roleName: string;
let roleId: number;
let podName: string;
let podId: number;

test.beforeAll(async ({ admin, seed, personas }) => {
  roleName = `Reviewer ${TAG}`;
  const role = await admin.post('/api/v1/roles', {
    name: roleName,
    description: 'Reads and comments.',
    permissionCodes: ['Task.View', 'Matter.View', 'Client.View'],
  });
  roleId = role.roleId;
  const member = await personas.create({ label: `${TAG}m`, roles: ['Data Technician'] });
  podName = `Editors ${TAG}`;
  const pod = await seed.pod(podName, [member.userId]);
  podId = pod.podId;
});

async function shot(page: Page, name: string, width: number, height: number): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}-${width}x${height}.png`) });
}

const noSideScroll = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

async function axeClean(page: Page) {
  expect(axeAvailable(), 'axe-core is required (set E2E_AXE_PATH)').toBe(true);
  return (await axeViolations(page))
    .map((v) =>
      v.id === 'target-size'
        ? { ...v, nodes: v.nodes.filter((n) => !(n.why ?? '').includes('partially obscured')) }
        : v,
    )
    .filter((v) => v.nodes.length > 0);
}

async function openRole(page: Page): Promise<void> {
  await page.goto('/admin/roles');
  await page.locator(`[data-role="${roleId}"]`).click();
  await expect(page.locator('[data-editor]')).toBeVisible();
}

test.describe('#448 select all / none and the Changed (n) row', () => {
  test('Select all and Select none work on one group, keep the others, and update the count', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openRole(page);
    const group = page.locator('[data-perm="Asset.View"]').locator('xpath=ancestor::fieldset');
    const label = (await group.getAttribute('data-group')) ?? '';
    const boxes = group.locator('input[type="checkbox"]');
    const total = await boxes.count();
    expect(total).toBeGreaterThan(1);
    await group.getByRole('button', { name: `Select all ${label} permissions` }).click();
    await expect(group.locator('input[type="checkbox"]:checked')).toHaveCount(total);
    await expect(page.locator('[data-note]')).toContainText(`All ${total} ${label} permissions`);
    await expect(page.locator('[data-perm="Task.View"]')).toBeChecked();
    await group.getByRole('button', { name: `Clear all ${label} permissions` }).click();
    await expect(group.locator('input[type="checkbox"]:checked')).toHaveCount(0);
    // The buttons are plain buttons: keyboard operable.
    await group.getByRole('button', { name: `Select all ${label} permissions` }).focus();
    await page.keyboard.press('Enter');
    await expect(group.locator('input[type="checkbox"]:checked')).toHaveCount(total);
  });

  test('Changed (n) lists what differs, each chip undoes itself, Save clears the row', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openRole(page);
    await expect(page.locator('[data-changes]')).toHaveCount(0);
    await page.locator('[data-perm="Asset.View"]').check();
    await page.locator('[data-perm="Matter.View"]').uncheck();
    const row = page.locator('[data-changes]');
    await expect(row).toContainText('Changed (');
    await expect(row.getByRole('button', { name: 'Undo: added Asset.View' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Undo: removed Matter.View' })).toBeVisible();
    await row.getByRole('button', { name: 'Undo: removed Matter.View' }).click();
    await expect(page.locator('[data-perm="Matter.View"]')).toBeChecked();
    await expect(row.getByRole('button', { name: 'Undo: removed Matter.View' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('[data-changes]')).toHaveCount(0);
    await expect(page.locator('[data-perm="Asset.View"]')).toBeChecked();
  });

  test('System Admin stays locked: no group buttons, no Changed row', async ({ page }) => {
    await page.goto('/admin/roles');
    await page.getByRole('button', { name: /^System Admin/ }).click();
    await expect(page.locator('[data-locked]')).toBeVisible();
    await expect(page.locator('[data-select-all]')).toHaveCount(0);
    await expect(page.locator('[data-changes]')).toHaveCount(0);
  });
});

test.describe('#449 the description', () => {
  test('holds 500 characters in a two-row box with a counter, and a long text stays editable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openRole(page);
    const box = page.locator('[data-description]');
    await expect(box).toHaveJSProperty('tagName', 'TEXTAREA');
    const text = 'Reviewer of the production sets. '.repeat(20).slice(0, 500);
    await box.fill(text);
    await expect(box).toHaveValue(text);
    await expect(page.locator('#role-description-count')).toHaveText('500 / 500');
    await expect(page.locator('[data-char-count-live]')).toHaveText('500 of 500 characters');
    // All 500 characters are visible: the box grew to fit (no inner scroll).
    expect(await box.evaluate((el) => el.scrollHeight <= el.clientHeight + 2)).toBe(true);
    await box.fill('Reads and comments.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('[data-changes]')).toHaveCount(0);
  });
});

test.describe('#451 the pod editor is a record page', () => {
  const list = () => `/admin/pods?status=all&name=${encodeURIComponent(TAG)}`;

  test('crumb, name, Active badge and Deactivate in the overflow; Back keeps the filters and focus returns to the row', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(list());
    const link = page.locator(`tr[data-pod="${podId}"] a`);
    await link.click();
    const header = page.locator('[data-record-header]');
    await expect(header).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(podName);
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs).toContainText('Administration');
    await expect(crumbs.getByRole('link', { name: 'Users' })).toHaveAttribute(
      'href',
      '/admin/users',
    );
    await expect(crumbs.getByRole('link', { name: 'Pods' })).toBeVisible();
    await expect(header.locator('[data-crumb-current]')).toContainText(podName);
    await expect(header).toContainText('Active');
    // The Users tabs are not drawn around a record page.
    await expect(page.getByRole('tablist')).toHaveCount(0);

    await header.getByRole('button', { name: /actions|more/i }).click();
    await expect(page.getByRole('menuitem', { name: 'Deactivate pod' })).toBeVisible();
    await page.keyboard.press('Escape');

    // The crumb returns to the list as it was: the Name filter and the status are still there, and focus is on the row.
    await crumbs.getByRole('link', { name: 'Pods' }).click();
    await expect(page.locator(`tr[data-pod="${podId}"]`)).toBeVisible();
    await expect(page).toHaveURL(/name=us6e/);
    await expect(page).toHaveURL(/status=all/);
    await expect(link).toBeFocused();
  });

  test('Deactivate pod asks first, then deactivates', async ({ page, seed }) => {
    const mine = await seed.pod(`Retire ${TAG}`, []);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/pods?pod=${mine.podId}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Retire ${TAG}`);
    await page
      .locator('[data-record-header]')
      .getByRole('button', { name: /actions|more/i })
      .click();
    await page.getByRole('menuitem', { name: 'Deactivate pod' }).click();
    const dialog = page.getByRole('dialog', { name: 'Deactivate pod?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Deactivate pod' }).click();
    await expect(page.locator('[data-record-header]')).toContainText('Inactive');
  });

  test('an unknown pod is the not-found state, with a link out', async ({ page }) => {
    await page.goto('/admin/pods?pod=99999999');
    await expect(page.locator('[data-record-state="notFound"]')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      "We couldn't find that pod.",
    );
    await expect(page.getByRole('link', { name: /Go to Pods/ })).toBeVisible();
  });

  test('Pod.ManageMembers: members can be changed, the name and the status cannot, and Deactivate is not offered', async ({
    personas,
    asUser,
  }) => {
    const lead = await personas.create({
      label: `${TAG}lead`,
      permissions: ['Pod.View', 'Pod.ManageMembers', 'User.View'],
    });
    const page = await asUser(lead.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/pods?pod=${podId}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(podName);
    await expect(page.locator('input[data-name]')).toBeDisabled();
    await expect(page.locator('[data-active]')).toBeDisabled();
    await expect(page.locator('[data-candidate-search]')).toBeVisible();
    // The overflow holds no Deactivate for this person (it may be absent altogether).
    const menu = page
      .locator('[data-record-header]')
      .getByRole('button', { name: /actions|more/i });
    if (await menu.count()) {
      await menu.click();
      await expect(page.getByRole('menuitem', { name: 'Deactivate pod' })).toHaveCount(0);
    }
  });
});

test.describe('axe and layout with the editors open', () => {
  for (const { width, height } of SIZES) {
    test(`role editor and pod record page at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openRole(page);
      const box = page.locator('[data-perm="Asset.View"]');
      // Earlier tests of this file saved Asset.View on or off: flip whichever it is now.
      if (await box.isChecked()) await box.uncheck();
      else await box.check();
      await expect(page.locator('[data-changes]')).toBeVisible();
      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);
      await shot(page, 'role-editor-changed', width, height);
      // Leave without saving (the guard asks): load the pod page fresh instead.
      await page.goto(`/admin/pods?pod=${podId}`).catch(() => undefined);
      const leave = page.getByRole('dialog', { name: 'Leave without saving?' });
      if (await leave.isVisible().catch(() => false)) {
        await leave.getByRole('button', { name: 'Leave' }).click();
      }
      await expect(page.getByRole('heading', { level: 1 })).toContainText(podName);
      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);
      await shot(page, 'pod-record-page', width, height);
    });
  }
});
