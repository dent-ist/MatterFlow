import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { assetTypeWorld, customFieldWorld } from '../support/designer';
import { expect, test } from '../support/fixtures';

/**
 * WP-AD2 #588: document titles and breadcrumbs name the record on all nine administration routes of the five areas, and the menu item for the
 * Asset Types page is called Asset Types. Screenshots go to E2E_SCREENSHOTS (docs/ux/admin-pages-review/fixes/ad2-kit).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;

const crumbs = (page: Page) => page.getByRole('navigation', { name: 'Breadcrumb' }).locator('li');

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

test.describe('titles and crumbs on the administration routes (#588)', () => {
  const LISTS: [string, string, string, string[]][] = [
    ['/admin/audit', 'Audit Logs - MatterFlow', 'Audit Logs', ['Administration', 'Audit Logs']],
    [
      '/admin/priorities',
      'Labels - Priorities - MatterFlow',
      'Labels',
      ['Administration', 'Labels'],
    ],
    [
      '/admin/status-labels',
      'Labels - Status labels - MatterFlow',
      'Labels',
      ['Administration', 'Labels'],
    ],
    [
      '/admin/asset-types',
      'Asset Types - MatterFlow',
      'Asset Types',
      ['Administration', 'Asset Types'],
    ],
    [
      '/admin/asset-types?tab=link-roles',
      'Asset Types - Link Roles - MatterFlow',
      'Asset Types',
      ['Administration', 'Asset Types'],
    ],
    [
      '/admin/custom-fields',
      'Custom Fields - MatterFlow',
      'Custom Fields',
      ['Administration', 'Custom Fields'],
    ],
  ];

  for (const [url, title, heading, trail] of LISTS) {
    test(`${url}: title "${title}", H1 "${heading}" and the crumb ${trail.join(' > ')}`, async ({
      page,
    }) => {
      await page.setViewportSize(SIZES[1]);
      await page.goto(url);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect(page).toHaveTitle(title);
      await expect(crumbs(page)).toHaveText(trail.map((t) => new RegExp(`^\\s*>?\\s*${t}\\s*$`)));
    });
  }

  test('the designers name the record: "<asset type>: Fields" and "Matter custom fields", with Administration > Section > Record crumbs', async ({
    page,
    admin,
  }) => {
    const at = await assetTypeWorld(admin, { published: true, draft: false });
    await page.setViewportSize(SIZES[1]);
    await page.goto(at.url);
    await expect(page).toHaveTitle(`${at.name}: Fields - MatterFlow`);
    await expect(crumbs(page)).toHaveText([
      /Administration/,
      /Asset Types/,
      new RegExp(at.name),
      /Fields/,
    ]);
    await expect(
      page
        .getByRole('navigation', { name: 'Breadcrumb' })
        .getByRole('link', { name: 'Asset Types' }),
    ).toHaveAttribute('href', '/admin/asset-types');
    await shot(page, 'titles-asset-designer');

    await customFieldWorld(admin, 'matter');
    await page.goto('/admin/custom-fields/matter/form');
    await expect(page).toHaveTitle('Matter custom fields - MatterFlow');
    await expect(crumbs(page)).toHaveText([/Administration/, /Custom Fields/, /Matter/]);
    await expect(
      page
        .getByRole('navigation', { name: 'Breadcrumb' })
        .getByRole('link', { name: 'Custom Fields' }),
    ).toHaveAttribute('href', '/admin/custom-fields');
    await shot(page, 'titles-custom-designer');
  });

  test('the Administration menu has one item called Asset types (and the data list is still Assets)', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/asset-types');
    const nav = page.getByRole('navigation', { name: /main|primary|sidebar/i }).first();
    await expect(
      page.getByRole('link', { name: 'Asset types', exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Assets', exact: true })).toHaveCount(1);
    void nav;
  });

  for (const size of SIZES) {
    test(`${size.width}: the crumb rows pass axe and nothing scrolls the page sideways`, async ({
      page,
      admin,
    }) => {
      const at = await assetTypeWorld(admin, { published: true, draft: false });
      await page.setViewportSize(size);
      for (const url of ['/admin/audit', '/admin/asset-types', at.url, '/admin/custom-fields']) {
        await page.goto(url);
        await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
        if (axeAvailable())
          expect(await axeViolations(page), `${url} at ${size.width}`).toEqual([]);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${url}: page-level horizontal scroll`).toBeLessThanOrEqual(0);
      }
    });
  }
});
