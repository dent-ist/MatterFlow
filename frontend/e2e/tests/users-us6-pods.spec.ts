import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * Users epic #422, WP-US6 #450 (U11 list, BUG-6): the Pods tab on the admin list kit.
 *  - the header has Filters with its count and the one Clear filters (open by default from 640 px), "Skip to table" is the first Tab stop;
 *  - rows are 44 px, the name is the one link of a row and puts the pod in the address (`?pod=`), there is no Edit link and no actions column;
 *  - "n inactive hidden - Show all": the count equals the inactive pods, Show all reveals them and the address records it;
 *  - the word is Inactive across the tab and the editor (the members' badge too); phone cards below 640 px;
 *  - axe 0 and no sideways scroll at four widths; permission variants.
 * Screenshots for docs/ux/users-review/fixes/us6-roles-pods/ are written when E2E_SCREENSHOTS is set to the output folder.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const TAG = `us6p${Math.floor(Math.random() * 90000) + 10000}`;
const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

let activePodId: number;
let inactiveName: string;
let inactivePodId: number;
let longPodName: string;

test.beforeAll(async ({ seed, admin, personas }) => {
  const member = await personas.create({ label: `${TAG}m`, roles: ['Data Technician'] });
  longPodName = `${TAG} ${'Document review and quality control '.repeat(4)}`.trim().slice(0, 100);
  const active = await seed.pod(longPodName, [member.userId]);
  activePodId = active.podId;
  await admin.put(`/api/v1/pods/${active.podId}`, {
    name: active.name,
    description: 'Processes incoming productions and checks them against the protocol.',
    isActive: true,
    rowVersion: active.rowVersion,
  });
  inactiveName = `Old ${TAG}`;
  const old = await seed.pod(inactiveName, [member.userId]);
  inactivePodId = old.podId;
  await admin.put(`/api/v1/pods/${old.podId}`, {
    name: old.name,
    description: null,
    isActive: false,
    rowVersion: old.rowVersion,
  });
  // The member is made inactive: the editor says Inactive for them, not Disabled.
  await admin.put(`/api/v1/users/${member.userId}/status`, {
    isActive: false,
    rowVersion: (await admin.get(`/api/v1/users/${member.userId}`)).rowVersion,
  });
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
  return (await axeViolations(page))
    .map((v) =>
      v.id === 'target-size'
        ? { ...v, nodes: v.nodes.filter((n) => !(n.why ?? '').includes('partially obscured')) }
        : v,
    )
    .filter((v) => v.nodes.length > 0);
}

const podRow = (page: Page, id: number) => page.locator(`tr[data-pod="${id}"]`);

test.describe('#450 Pods list on the kit', () => {
  for (const { width, height } of SIZES) {
    test(`header, grid or cards, one link per row, axe 0 and no sideways scroll at ${width}`, async ({
      page,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      await page.setViewportSize({ width, height });
      await page.goto(`/admin/pods?name=${TAG}&status=all`);
      await expect(page.getByRole('tab', { name: 'Pods' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.locator('mf-page-header [data-filters-toggle]')).toBeVisible();
      if (width >= 640) {
        const row = podRow(page, activePodId);
        await expect(row).toBeVisible();
        await expect(row.locator('a, button')).toHaveCount(1);
        await expect(row.locator('[data-edit]')).toHaveCount(0);
        await expect(page.locator('table[data-pods] thead tr').first().locator('th')).toHaveText([
          'Name',
          'Members',
          'Status',
        ]);
        const h = await row.evaluate((el) => el.getBoundingClientRect().height);
        expect(h).toBeGreaterThanOrEqual(43);
        expect(h).toBeLessThanOrEqual(45);
      } else {
        await expect(page.locator('li.rc').first()).toBeVisible();
        await expect(page.locator('table[data-pods]')).toHaveCount(0);
      }
      expect(await noSideScroll(page)).toBe(true);
      expect(await axeClean(page)).toEqual([]);
      await shot(page, 'pods-list', width, height);
    });
  }

  test('the filter row is open from 640 px, Filters and Clear filters are in the header, Clear resets the filters', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/pods?name=${TAG}&status=all`);
    await expect(page.locator('[data-filter-row]')).toBeVisible();
    const header = page.locator('mf-page-header');
    await expect(header.locator('[data-filter-count]')).toHaveText('(2)'); // Name and Status All
    await expect(page.locator('[data-clear-filters]')).toHaveCount(1);
    await page.locator('[data-clear-filters]').click();
    await expect(page).not.toHaveURL(/name=/);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator('[data-filter-row]')).toHaveCount(0);
  });

  test('"n inactive hidden - Show all": the count equals the inactive pods, Show all reveals them and the address records it', async ({
    page,
    admin,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const inactive = await admin.get<{ total: number }>('/api/v1/pods?active=false&pageSize=1');
    await page.goto('/admin/pods');
    const hint = page.locator('[data-hidden-hint]');
    await expect(hint).toContainText(`${inactive.total} inactive hidden`);
    await expect(podRow(page, inactivePodId)).toHaveCount(0);
    await hint.getByRole('button', { name: 'Show all' }).click();
    await expect(page).toHaveURL(/status=all/);
    await expect(page.locator('[data-hidden-hint]')).toHaveCount(0);
    await page.goto(`/admin/pods?status=all&name=${encodeURIComponent(inactiveName)}`);
    await expect(podRow(page, inactivePodId)).toBeVisible();
    await expect(podRow(page, inactivePodId)).toContainText('Inactive');
  });

  test('"Skip to table" is the first Tab stop and lands on the name of the first pod', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/pods?name=${TAG}&status=all`);
    await expect(podRow(page, activePodId)).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to table' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('tbody tr[data-pod] a').first()).toBeFocused();
  });

  test('the name puts the pod in the address and opens the editor; Back returns to the list', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/pods?name=${TAG}&status=all`);
    const link = podRow(page, activePodId).locator('a');
    await expect(link).toHaveAttribute('href', new RegExp(`pod=${activePodId}`));
    await link.click();
    await expect(page).toHaveURL(new RegExp(`pod=${activePodId}`));
    await expect(page.locator('[data-editor] [data-record-header]')).toBeVisible();
    // No Filters button while the editor replaces the list.
    await expect(page.locator('mf-page-header [data-filters-toggle]')).toHaveCount(0);
    // The members: Inactive, not Disabled (#450).
    await expect(page.locator('[data-members]')).toContainText('Inactive');
    await expect(page.locator('[data-members]')).not.toContainText('Disabled');
    if (axeAvailable()) expect(await axeClean(page)).toEqual([]);
    await shot(page, 'pod-editor-inactive-member', 1366, 768);
    await page.goBack();
    await expect(podRow(page, activePodId)).toBeVisible();
  });

  test('on a phone a pod is a card whose name opens the editor', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/admin/pods?name=${TAG}&status=all`);
    const card = page.locator('li.rc', { hasText: TAG }).first();
    await expect(card).toBeVisible();
    await expect(card.locator('a[data-card-name]')).toHaveAttribute('href', /pod=\d+/);
    await card.locator('a[data-card-name]').click();
    await expect(page.locator('[data-editor] [data-record-header]')).toBeVisible();
    await shot(page, 'pod-editor-phone', 375, 812);
  });

  test('a person with Pod.ManageMembers only has the list, the links and no New pod; a Task.View-only person has none of it', async ({
    personas,
    asUser,
  }) => {
    const lead = await personas.create({
      label: `${TAG}pm`,
      permissions: ['Pod.View', 'Pod.ManageMembers'],
    });
    const page = await asUser(lead.username);
    await page.goto(`/admin/pods?name=${TAG}&status=all`);
    await expect(podRow(page, activePodId).locator('a')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New pod' })).toHaveCount(0);

    const other = await personas.named('taskViewOnly');
    const denied = await asUser(other.username);
    await denied.goto('/admin/pods');
    await expect(denied.locator('table[data-pods]')).toHaveCount(0);
  });
});
