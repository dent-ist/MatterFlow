import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { atEverySize } from '../support/screens';
import { uid } from '../support/seed';

/**
 * The form designer of an unknown asset type or custom-field object says it could not find it, with the header kept; 403 and failures keep the
 * header too and offer Retry only when it can help (#541, BUG-5, AD-C). Screenshots go to E2E_SCREENSHOTS
 * (docs/ux/admin-pages-review/fixes/ad1-first-release).
 */
const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const crumbs = (page: Page) =>
  page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('listitem');
const noToast = async (page: Page) => {
  await expect(page.locator('[data-toast]')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
};

interface DesignerRoute {
  key: string;
  noun: string;
  title: string;
  url: string;
  /** The request whose failure the page turns into 403 / 500. */
  api: string;
  method: 'GET' | 'POST';
  list: string;
  crumbs: string[];
  listUrl: RegExp;
}

const ROUTES: DesignerRoute[] = [
  {
    key: 'asset-type-form',
    noun: 'asset type',
    title: 'Asset type',
    url: '/admin/asset-types/99999999/form',
    api: '**/api/v1/asset-types/99999999',
    method: 'GET',
    list: 'Asset Types',
    crumbs: ['Administration', 'Asset Types', 'Asset type'],
    listUrl: /\/admin\/asset-types$/,
  },
  {
    key: 'custom-field-form',
    noun: 'object',
    title: 'Object',
    url: '/admin/custom-fields/nothing/form',
    // The page asks no API for an address that names no object; the known objects' forms provision through this call.
    api: '**/api/v1/forms',
    method: 'POST',
    list: 'Custom Fields',
    crumbs: ['Administration', 'Custom Fields', 'Object'],
    listUrl: /\/admin\/custom-fields$/,
  },
];

test.describe('Designer not found, no access and failure states (#541)', () => {
  for (const r of ROUTES) {
    test(`${r.key}: an unknown address says it was not found, with the header, a way back and no Retry`, async ({
      page,
    }) => {
      await page.goto(r.url);
      await expect(heading(page)).toHaveText(`We couldn't find that ${r.noun}.`);
      await expect(page.locator('body')).not.toContainText('99999999');
      await expect(page.getByRole('button', { name: /Retry|Try again/ })).toHaveCount(0);
      await expect(crumbs(page)).toHaveText(r.crumbs);
      await expect(page).toHaveTitle(`${r.title} not found - MatterFlow`);
      await expect(heading(page)).toBeFocused();
      await noToast(page);
      const back = page.getByRole('link', { name: `Go to ${r.list}` });
      await expect(back).toBeVisible();
      await atEverySize(page, `${r.key}-not-found`);
      await back.click();
      await expect(page).toHaveURL(r.listUrl);
    });
  }

  test('asset type form: 403 says no access, a failure shows the reference with a Retry that recovers', async ({
    page,
  }) => {
    const r = ROUTES[0];
    let status = 403;
    const reference = `ref-${uid()}`;
    // The page reads the asset type and the form of the type side by side: both answer the same.
    for (const api of [r.api, '**/api/v1/forms/by-owner*']) {
      await page.route(api, (route) =>
        route.request().method() === 'GET' && status !== 0
          ? route.fulfill({
              status,
              contentType: 'application/problem+json',
              body: JSON.stringify({
                status,
                code: status === 403 ? 'PERMISSION_DENIED' : 'INTERNAL_ERROR',
                traceId: reference,
              }),
            })
          : route.continue(),
      );
    }
    await page.goto(r.url);
    await expect(heading(page)).toHaveText("You don't have access to this asset type.");
    await expect(page).toHaveTitle('No access to this asset type - MatterFlow');
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await noToast(page);
    await atEverySize(page, `${r.key}-forbidden`);

    status = 500;
    await page.goto(r.url);
    await expect(heading(page)).toHaveText("Couldn't load this asset type.");
    await expect(page).toHaveTitle('Asset type could not be loaded - MatterFlow');
    await expect(page.locator('[data-error-reference]')).toContainText(reference);
    await expect(page.locator('[data-toast]')).toHaveCount(0);
    await atEverySize(page, `${r.key}-load-failed`);

    await page.setViewportSize({ width: 1366, height: 768 });
    const retry = page.getByRole('button', { name: 'Retry' });
    await retry.focus();
    await retry.click();
    await expect(retry).toBeFocused();
    status = 0; // Retry now reaches the real answer, a 404
    await expect(async () => {
      await page.getByRole('button', { name: 'Retry' }).click({ timeout: 3000 });
      await expect(heading(page)).toHaveText("We couldn't find that asset type.", {
        timeout: 3000,
      });
    }).toPass({ timeout: 20000 });
  });

  test('custom fields form: 403 and a failure of the forms call keep the header; a lost connection offers Retry', async ({
    page,
  }) => {
    const r = ROUTES[1];
    let status = 403;
    const reference = `ref-${uid()}`;
    await page.route(r.api, (route) =>
      route.request().method() === 'POST' && status !== 0
        ? route.fulfill({
            status,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              status,
              code: status === 403 ? 'PERMISSION_DENIED' : 'INTERNAL_ERROR',
              traceId: reference,
            }),
          })
        : route.continue(),
    );
    await page.goto('/admin/custom-fields/matter/form');
    await expect(heading(page)).toHaveText("You don't have access to this object.");
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await expect(crumbs(page)).toHaveText(r.crumbs);
    await noToast(page);

    status = 500;
    await page.goto('/admin/custom-fields/matter/form');
    await expect(heading(page)).toHaveText("Couldn't load this object.");
    await expect(page.locator('[data-error-reference]')).toContainText(reference);
    status = 0;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(heading(page)).toContainText('Matter custom fields');
    await expect(page.getByRole('button', { name: 'Create new draft' })).toBeVisible();
  });

  test('permissions: Task.View only gets the 403 page; each manager gets the 404 of their own designer', async ({
    seed,
    asUser,
  }) => {
    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'ad1-viewer')).username);
    for (const r of ROUTES) {
      await viewer.goto(r.url);
      await expect(
        viewer.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();
    }

    const typeRole = await seed.role(['AssetType.Manage'], 'Asset types only');
    const typePage = await asUser((await seed.user([typeRole.name], 'ad1-types')).username);
    await typePage.goto(ROUTES[0].url);
    await expect(heading(typePage)).toHaveText("We couldn't find that asset type.");
    await expect(typePage.getByRole('link', { name: 'Go to Asset Types' })).toBeVisible();
    await typePage.goto(ROUTES[1].url);
    await expect(
      typePage.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();

    const fieldRole = await seed.role(['CustomField.Manage'], 'Custom fields only');
    const fieldPage = await asUser((await seed.user([fieldRole.name], 'ad1-fields')).username);
    await fieldPage.goto(ROUTES[1].url);
    await expect(heading(fieldPage)).toHaveText("We couldn't find that object.");
    await expect(fieldPage.getByRole('link', { name: 'Go to Custom Fields' })).toBeVisible();
  });
});
