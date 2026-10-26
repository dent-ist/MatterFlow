import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, shot } from '../support/screens';
import { toasts } from '../support/toasts';
import { uid } from '../support/seed';

/**
 * Assets UX review, WP-AS6 (#515): the permission matrix and the denial rule of the Assets area. Over the list, the record page (three tabs),
 * New and Edit, for each kind of person: no link to a page the person cannot open, no failing request (4xx or 5xx) on any page they may open,
 * no error toast; a tab the person cannot see falls back to Details; `/assets/new` and `/assets/:id/edit` without the permission, and the
 * whole area without Asset.View, show the 403 page. Screenshots: E2E_SCREENSHOTS=docs/ux/assets-review/fixes/as6-keyboard-permissions.
 */
const FORBIDDEN = "You don't have permission to view this.";

interface Variant {
  label: string;
  permissions: string[];
  /** The pages that open (the others show the 403 page). */
  opens: { list: boolean; record: boolean; create: boolean; edit: boolean };
}

const VARIANTS: Variant[] = [
  {
    label: 'assetview',
    permissions: ['Asset.View'],
    opens: { list: true, record: true, create: false, edit: false },
  },
  {
    label: 'assetfull',
    permissions: ['Asset.View', 'Matter.View', 'Client.View', 'Task.View'],
    opens: { list: true, record: true, create: false, edit: false },
  },
  {
    label: 'assetcreate',
    permissions: ['Asset.View', 'Asset.Create', 'Matter.View'],
    opens: { list: true, record: true, create: true, edit: false },
  },
  {
    label: 'assetedit',
    permissions: ['Asset.View', 'Asset.Edit', 'Matter.View'],
    opens: { list: true, record: true, create: false, edit: true },
  },
  {
    label: 'editonly',
    permissions: ['Asset.Edit'],
    opens: { list: false, record: false, create: false, edit: false },
  },
  {
    label: 'createonly',
    permissions: ['Asset.Create'],
    opens: { list: false, record: false, create: false, edit: false },
  },
  {
    label: 'noassets',
    permissions: ['Task.View', 'Matter.View'],
    opens: { list: false, record: false, create: false, edit: false },
  },
];

/** The requests of the page that failed (status 400 and up on the API); a page the person may open has none. */
function watchFailures(page: Page): string[] {
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) {
      failed.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
    }
  });
  return failed;
}

/** The links on the page that lead somewhere the person cannot open. */
async function deadLinks(page: Page, permissions: string[]): Promise<string[]> {
  const hrefs = await page
    .locator('main a[href]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
  const needs = (href: string): string | null => {
    if (/^\/matters\/\d+/.test(href)) return 'Matter.View';
    if (/^\/clients\/\d+/.test(href)) return 'Client.View';
    if (/^\/tasks\/\d+/.test(href)) return 'Task.View';
    if (href === '/assets/new') return 'Asset.Create';
    if (/^\/assets\/\d+\/edit/.test(href)) return 'Asset.Edit';
    return null;
  };
  return hrefs.filter((h) => {
    const p = needs(h);
    return p !== null && !permissions.includes(p);
  });
}

test.describe('Assets permission matrix (WP-AS6)', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  async function world(seed: import('../support/seed').Seeder) {
    const w = await seed.world();
    const token = uid();
    const asset = await seed.asset(w.matter, `Matrix ${token}`);
    for (let i = 0; i < 2; i++) {
      const t = await seed.task(w);
      await seed.admin.post(`/api/v1/tasks/${t.taskId}/assets`, { assetId: asset.assetId });
    }
    return { token, asset, matter: w.matter };
  }

  for (const variant of VARIANTS) {
    test(`${variant.label}: ${variant.permissions.join(' + ')}: every page opens or shows the 403 page, no dead link, no failing request, no error toast`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const { token, asset, matter } = await world(seed);
      const person = await personas.create({
        label: variant.label,
        permissions: variant.permissions,
      });
      const page = await asUser(person.username);
      const failed = watchFailures(page);
      await page.setViewportSize({ width: 1366, height: 768 });

      const forbidden = page.getByRole('heading', { name: FORBIDDEN });
      const settled = async () => {
        await expect(page.locator('main h1').first()).toBeVisible();
        await page.waitForLoadState('networkidle');
      };

      // The list.
      await page.goto(`/assets?name=${token}`);
      await settled();
      if (variant.opens.list) {
        await expect(page.locator('tbody tr[data-asset-id]')).toHaveCount(1);
        await expect(forbidden).toHaveCount(0);
        expect(await deadLinks(page, variant.permissions), 'dead links in the list').toEqual([]);
        // The Linked tasks column and the New asset button follow the permissions.
        await expect(page.getByRole('columnheader', { name: 'Linked tasks' })).toHaveCount(
          variant.permissions.includes('Task.View') ? 1 : 0,
        );
        await expect(page.getByRole('button', { name: 'New asset' })).toHaveCount(
          variant.permissions.includes('Asset.Create') ? 1 : 0,
        );
      } else {
        await expect(forbidden).toBeVisible();
      }

      // The record page and its three tabs.
      for (const tab of [undefined, 'tasks', 'history']) {
        await page.goto(`/assets/${asset.assetId}` + (tab ? `?tab=${tab}` : ''));
        await settled();
        if (!variant.opens.record) {
          await expect(forbidden).toBeVisible();
          continue;
        }
        await expect(forbidden).toHaveCount(0);
        // History without Audit.View falls back to Details (it has no tab either).
        const expected = tab === 'tasks' ? 'Linked tasks' : 'Details';
        await expect(page.getByRole('tab', { selected: true })).toContainText(expected);
        await expect(page.getByRole('tab', { name: 'History' })).toHaveCount(0);
        if (tab === 'tasks') {
          if (variant.permissions.includes('Task.View')) {
            await expect(page.locator('[data-tasks-tab] tbody tr')).toHaveCount(2);
          } else {
            await expect(page.locator('[data-no-access="linked-tasks"]')).toBeVisible();
          }
        }
        // The matter is a link only with Matter.View.
        await expect(page.locator('[data-record-header] [data-matter] a')).toHaveCount(
          variant.permissions.includes('Matter.View') ? 1 : 0,
        );
        expect(
          await deadLinks(page, variant.permissions),
          `dead links on ${tab ?? 'details'}`,
        ).toEqual([]);
      }

      // New and Edit.
      await page.goto(`/assets/new?matterId=${matter.matterId}`);
      await settled();
      if (variant.opens.create) await expect(forbidden).toHaveCount(0);
      else await expect(forbidden).toBeVisible();
      await page.goto(`/assets/${asset.assetId}/edit`);
      await settled();
      if (variant.opens.edit) await expect(forbidden).toHaveCount(0);
      else await expect(forbidden).toBeVisible();

      expect(failed, `failing requests as ${variant.label}`).toEqual([]);
      await expect(toasts(page)).toHaveCount(0);
    });
  }

  test('the System Admin opens everything and History is a tab', async ({ page, seed }) => {
    const { token, asset } = await world(seed);
    const failed = watchFailures(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets?name=${token}`);
    await expect(page.locator('tbody tr[data-asset-id]')).toHaveCount(1);
    await page.goto(`/assets/${asset.assetId}?tab=history`);
    await expect(page.getByRole('tab', { selected: true })).toContainText('History');
    await page.goto(`/assets/new`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.goto(`/assets/${asset.assetId}/edit`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(failed).toEqual([]);
    await expect(toasts(page)).toHaveCount(0);
  });

  test('the 403 page for a person without Asset.View: axe finds nothing and nothing scrolls sideways at four sizes', async ({
    seed,
    personas,
    asUser,
  }) => {
    const { asset } = await world(seed);
    const person = await personas.create({ label: 'noassets2', permissions: ['Task.View'] });
    const page = await asUser(person.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/assets/${asset.assetId}`);
      await expect(page.getByRole('heading', { name: FORBIDDEN })).toBeVisible();
      expect(await axeViolations(page), `403 at ${size.width}`).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await shot(page, 'as6-403');
    }
  });

  test('an Asset.View-only person gets the record page and no request that must fail: no schema, no task list, no history', async ({
    seed,
    personas,
    asUser,
  }) => {
    const { asset } = await world(seed);
    const person = await personas.create({ label: 'viewonly2', permissions: ['Asset.View'] });
    const page = await asUser(person.username);
    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/')) requests.push(new URL(r.url()).pathname);
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets/${asset.assetId}?tab=history`);
    await expect(page.getByRole('tab', { selected: true })).toContainText('Details');
    await page.waitForLoadState('networkidle');
    expect(requests.filter((p) => /linked-tasks|audit|forms\/versions/.test(p))).toEqual([]);
    await shot(page, 'as6-viewonly-record');
  });
});
