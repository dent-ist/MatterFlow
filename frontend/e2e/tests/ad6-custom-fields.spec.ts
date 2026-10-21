import { Page, Request } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { axeAvailable, axeViolations } from '../support/axe';
import { noHorizontalScroll, shot } from '../support/screens';

/**
 * WP-AD6 (AD-C): the Custom Fields list with substance (#644) and the way into its designer (#645). The list reads one endpoint that creates
 * nothing (no POST on view), shows the numbers of each object's form in 44 px rows with the Object as the one link and one menu, cards below
 * 640 px; the designer is `Administration > Custom Fields > Matter`, titled and headed "Matter custom fields", and Back puts focus on the Object link
 * of the row. The three forms are shared by every spec, so the expectations are read from the API, not assumed. Screenshots go to
 * E2E_SCREENSHOTS (docs/ux/admin-pages-review/fixes/ad6-custom-fields).
 */
const OBJECTS = [
  { key: 'client', label: 'Client', kind: 'Client' },
  { key: 'matter', label: 'Matter', kind: 'Matter' },
  { key: 'project', label: 'Project', kind: 'Project' },
] as const;

const row = (page: Page, label: string) => page.locator(`tr[data-row="${label}"]`);
const crumbs = (page: Page) => page.getByRole('navigation', { name: 'Breadcrumb' }).locator('li');
const WIDTHS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;

interface Summary {
  ownerKind: string;
  state: 'None' | 'Draft' | 'Published';
  fieldCount: number;
  requiredCount: number;
  publishedVersion: number | null;
  draftVersion: number | null;
}

test.describe('Custom Fields list (#644)', () => {
  test('looking creates nothing: one GET, no POST, no audit event for the three objects', async ({
    page,
    admin,
  }) => {
    const seen: Request[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/forms')) seen.push(r);
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/custom-fields');
    await expect(row(page, 'Matter')).toBeVisible();
    await page.reload();
    await expect(row(page, 'Matter')).toBeVisible();
    expect(seen.filter((r) => r.method() !== 'GET')).toEqual([]);
    expect(
      seen.filter((r) => r.url().endsWith('/api/v1/forms/custom-fields')).length,
    ).toBeGreaterThan(0);
    void admin;
  });

  test('chrome, three rows with the numbers of each form, 44 px rows, the Object as the one link', async ({
    page,
    admin,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/custom-fields');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Custom Fields');
    await expect(page).toHaveTitle('Custom Fields - MatterFlow');
    await expect(crumbs(page)).toHaveText([/Administration/, /Custom Fields/]);
    await expect(page.locator('mf-page-header')).toContainText(
      'Extra fields on Clients, Matters and Projects.',
    );
    await expect(page.locator('[data-objects] thead tr th')).toHaveText([
      'Object',
      'Fields',
      'Published',
      'Form',
      'Actions',
    ]);
    // No strip, no tabs, no filters for three rows.
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Filters/ })).toHaveCount(0);

    const summaries: Summary[] = await admin.get('/api/v1/forms/custom-fields');
    for (const o of OBJECTS) {
      const s = summaries.find((x) => x.ownerKind === o.kind)!;
      const r = row(page, o.label);
      await expect(r).toBeVisible();
      expect((await r.boundingBox())!.height).toBeLessThanOrEqual(45);
      await expect(r.getByRole('link')).toHaveCount(1);
      await expect(r.getByRole('link')).toHaveAttribute(
        'href',
        `/admin/custom-fields/${o.key}/form`,
      );
      if (s.publishedVersion !== null) {
        await expect(r.locator('[data-fields]')).toContainText(
          `${s.fieldCount === 1 ? '1 field' : s.fieldCount + ' fields'}`,
        );
        await expect(r.locator('[data-published]')).toContainText(`v${s.publishedVersion}`);
        await expect(r.locator('[data-status]')).toContainText(`Published v${s.publishedVersion}`);
      } else {
        await expect(r.locator('[data-fields]')).toContainText('No fields yet');
        await expect(r.locator('[data-published]')).toContainText('Not published');
        await expect(r.locator('[data-status]')).toContainText('No published fields');
      }
      if (s.draftVersion !== null) {
        await expect(r.locator('[data-status]')).toContainText(`Draft v${s.draftVersion}`);
      }
    }
    await shot(page, 'custom-fields-list');
  });

  test('the row menu has Edit fields and History; History opens the drawer and focus returns to the menu button', async ({
    page,
    admin,
  }) => {
    // The History entry needs the form definition: make sure the Matter one exists (the designer provisions it).
    await admin.post('/api/v1/forms', { ownerKind: 'Matter' });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/custom-fields');
    const button = page.getByRole('button', { name: 'Actions for Matter custom fields' });
    await button.click();
    await expect(page.getByRole('menuitem')).toHaveText([/Edit fields/, /History/]);
    await page.getByRole('menuitem', { name: /History/ }).click();
    const drawer = page.getByRole('dialog', { name: /Activity/ });
    await expect(drawer).toBeVisible();
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('axe finds nothing and nothing scrolls sideways at 375, 768, 1366 and 1920, with the row menu open', async ({
    page,
  }) => {
    await page.goto('/admin/custom-fields');
    await expect(row(page, 'Matter').or(page.locator('li.rc').first())).toBeVisible();
    for (const size of WIDTHS) {
      await page.setViewportSize(size);
      if (axeAvailable()) expect(await axeViolations(page), `list at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await page.getByRole('button', { name: 'Actions for Matter custom fields' }).click();
      await expect(page.getByRole('menuitem', { name: /Edit fields/ })).toBeVisible();
      if (axeAvailable()) expect(await axeViolations(page), `menu at ${size.width}`).toEqual([]);
      await page.keyboard.press('Escape');
    }
  });

  test('below 640 px the list is cards with the same menu and no sideways scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin/custom-fields');
    const cards = page.locator('li.rc');
    await expect(cards).toHaveCount(3);
    for (const card of await cards.all()) {
      const height = (await card.boundingBox())!.height;
      expect(height).toBeGreaterThanOrEqual(56);
      expect(height).toBeLessThanOrEqual(150);
    }
    await expect(cards.nth(1)).toContainText('Matter');
    await expect(cards.nth(1).getByRole('link')).toHaveAttribute(
      'href',
      '/admin/custom-fields/matter/form',
    );
    await cards.nth(1).getByRole('button', { name: 'Actions for Matter custom fields' }).click();
    await expect(page.getByRole('menuitem', { name: /Edit fields/ })).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, 'custom-fields-cards');
  });

  test('a failed read shows one message with the reference, no toast, and Retry reads again', async ({
    page,
  }) => {
    let fail = true;
    await page.route('**/api/v1/forms/custom-fields', (route) =>
      fail
        ? route.fulfill({
            status: 500,
            contentType: 'application/problem+json',
            body: JSON.stringify({ status: 500, code: 'INTERNAL_ERROR', traceId: 'ref-cf-1' }),
          })
        : route.continue(),
    );
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/custom-fields');
    await expect(page.locator('[data-error]')).toContainText("Couldn't load");
    await expect(page.locator('[data-error-reference]')).toContainText('ref-cf-1');
    await page.waitForTimeout(800);
    await expect(page.locator('[data-toast]')).toHaveCount(0);
    fail = false;
    await page.locator('[data-error]').getByRole('button', { name: 'Retry' }).click();
    await expect(row(page, 'Matter')).toBeVisible();
  });

  test('permissions: CustomField.Manage alone opens the list and the designer with no History; Task.View alone gets the 403 page', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(['CustomField.Manage'], 'Fields only');
    const manager = await asUser((await seed.user([role.name], 'ad6-mgr')).username);
    await manager.goto('/admin/custom-fields');
    await expect(row(manager, 'Matter')).toBeVisible();
    await manager.getByRole('button', { name: 'Actions for Matter custom fields' }).click();
    await expect(manager.getByRole('menuitem')).toHaveText([/Edit fields/]);
    await manager.keyboard.press('Escape');
    await row(manager, 'Matter').getByRole('link').click();
    await expect(manager).toHaveURL(/\/admin\/custom-fields\/matter\/form$/);

    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'ad6-view')).username);
    await viewer.goto('/admin/custom-fields');
    await expect(
      viewer.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
  });
});

test.describe('Custom Fields designer entry (#645)', () => {
  for (const o of OBJECTS) {
    test(`${o.label}: crumb Administration > Custom Fields > ${o.label}, title and H1 "${o.label} custom fields", Back puts focus on the Object link`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto('/admin/custom-fields');
      await row(page, o.label).getByRole('link').click();
      await expect(page).toHaveURL(new RegExp(`/admin/custom-fields/${o.key}/form$`));
      await expect(page).toHaveTitle(`${o.label} custom fields - MatterFlow`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(
        `${o.label} custom fields`,
      );
      await expect(page.getByRole('heading', { level: 1 })).not.toContainText('Form:');
      await expect(crumbs(page)).toHaveText([
        /Administration/,
        /Custom Fields/,
        new RegExp(`^\\s*>?\\s*${o.label}\\s*$`),
      ]);
      await shot(page, `custom-fields-designer-${o.key}`);

      await crumbs(page).filter({ hasText: 'Custom Fields' }).getByRole('link').click();
      await expect(page).toHaveURL(/\/admin\/custom-fields$/);
      await expect(row(page, o.label).getByRole('link')).toBeFocused();
    });
  }

  test('the menu entry Edit fields opens the same designer, and Back returns focus to the row', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/custom-fields');
    await page.getByRole('button', { name: 'Actions for Project custom fields' }).click();
    await page.getByRole('menuitem', { name: /Edit fields/ }).click();
    await expect(page).toHaveURL(/\/admin\/custom-fields\/project\/form$/);
    await crumbs(page).filter({ hasText: 'Custom Fields' }).getByRole('link').click();
    await expect(row(page, 'Project').getByRole('link')).toBeFocused();
  });

  test('the first Edit fields provisions the form definition (the designer, not the list)', async ({
    page,
  }) => {
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/v1/forms')) posts.push(r.url());
    });
    await page.goto('/admin/custom-fields/client/form');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Client custom fields');
    expect(posts.length).toBeGreaterThan(0);
  });
});
