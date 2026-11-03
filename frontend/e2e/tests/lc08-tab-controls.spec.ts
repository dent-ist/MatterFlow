import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * The Matter detail tab controls (epic #1037, LC-08 #1051; theme guide 11.2): one tab strip (icon, label, count) and, in every tab that lists things, one
 * control row under it: Search first, the primary "+ New ..." at the right end, on one line, with controls of the same height. Activities has the Kind
 * dropdown only; Summary has no list controls. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/matter-detail/tab-controls).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const DESKTOP = { width: 1366, height: 768 };
const PHONE = { width: 375, height: 812 };

interface TabCase {
  key: string;
  search: string | null;
  primary: string | null;
}

const TABS: TabCase[] = [
  { key: 'tasks', search: 'Search tasks', primary: 'New Task' },
  { key: 'projects', search: 'Search projects', primary: 'New Project' },
  { key: 'assets', search: 'Search assets', primary: 'New Asset' },
  { key: 'productions', search: 'Search productions', primary: 'New Production' },
  { key: 'notes', search: 'Search title and text', primary: 'New Note' },
  { key: 'activities', search: null, primary: null },
  { key: 'summary', search: null, primary: null },
];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

const box = async (l: Locator) => (await l.first().boundingBox())!;

test.describe('Matter detail tab controls (LC-08)', () => {
  let matterId: number;
  test.beforeEach(async ({ seed }) => {
    const token = uid();
    const client = await seed.client({ name: `Tabs Client ${token}` });
    const matter = await seed.matter({ client, number: '00001', name: `Tabs Matter ${token}` });
    await seed.project(matter, `Tabs Project ${token}`);
    await seed.asset(matter, `Tabs Asset ${token}`);
    matterId = matter.matterId as number;
  });

  test('every tab has the same strip, and the list tabs have Search first and the primary action last on one line', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    const heights: Record<string, number[]> = { search: [], primary: [] };
    for (const t of TABS) {
      await page.goto(`/matters/${matterId}?tab=${t.key}`);
      const tabs = page.getByRole('tab');
      await expect(tabs).toHaveCount(7);
      // The strip is the shared one: every tab has its icon, the selected one is marked.
      await expect(tabs.locator('i.tab__icon')).toHaveCount(7);
      await expect(page.locator(`[role="tab"][data-tab="${t.key}"]`)).toHaveAttribute(
        'aria-selected',
        'true',
      );
      if (t.search && t.primary) {
        const search = page.getByPlaceholder(t.search, { exact: true });
        const primary = page.getByRole('button', { name: new RegExp(`${t.primary}$`) }).first();
        await expect(search).toBeVisible();
        await expect(primary).toBeVisible();
        const s = await box(search);
        const p = await box(primary);
        // Search first (left), the primary action at the right end, both on the same line.
        expect(s.x, `${t.key}: Search is left of the primary action`).toBeLessThan(p.x);
        expect(
          Math.abs(s.y + s.height / 2 - (p.y + p.height / 2)),
          `${t.key}: Search and the primary action share a line`,
        ).toBeLessThan(24);
        expect(p.x + p.width, `${t.key}: the primary action ends the row`).toBeGreaterThan(
          DESKTOP.width - 120,
        );
        heights['search'].push(Math.round(s.height));
        heights['primary'].push(Math.round(p.height));
        // The control row sits between the strip and the grid: nothing but the row is above the grid.
        const strip = await box(page.getByRole('tablist'));
        expect(s.y, `${t.key}: Search is right under the strip`).toBeLessThan(
          strip.y + strip.height + 40,
        );
      }
      await shot(page, `tab-${t.key}`);
    }
    // The same control height in every tab.
    expect(new Set(heights['primary']).size, 'primary buttons: one height').toBe(1);
    expect(
      Math.max(...heights['search']) - Math.min(...heights['search']),
      'Search boxes: one height (Notes keeps its larger one)',
    ).toBeLessThanOrEqual(8);
  });

  test('Activities has the Kind dropdown above the frame and no heading inside it; Summary has no list controls', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`/matters/${matterId}?tab=activities`);
    const kind = page.getByRole('button', { name: /^Kind/ });
    await expect(kind).toBeVisible();
    const frame = await box(page.getByRole('region', { name: 'Matter activities, scrollable' }));
    const k = await box(kind);
    expect(k.y + k.height, 'the Kind dropdown is above the frame').toBeLessThanOrEqual(frame.y + 2);
    await expect(page.getByRole('heading', { name: 'Activities', level: 2 })).toBeAttached();
    await page.goto(`/matters/${matterId}?tab=summary`);
    await expect(
      page.getByPlaceholder(/^Search (tasks|projects|assets|productions|specs)/),
    ).toHaveCount(0);
  });

  test('axe finds nothing in any tab at 1366x768 and 375x812', async ({ page }) => {
    test.skip(!axeAvailable(), 'axe-core is not available');
    test.setTimeout(240_000);
    for (const size of [DESKTOP, PHONE]) {
      await page.setViewportSize(size);
      for (const t of TABS) {
        await page.goto(`/matters/${matterId}?tab=${t.key}`);
        await expect(page.locator(`[role="tab"][data-tab="${t.key}"]`)).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await page.waitForTimeout(400);
        expect(await axeViolations(page), `${t.key} at ${size.width}`).toEqual([]);
        const doc = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(
          doc,
          `${t.key} at ${size.width}: the page does not scroll sideways`,
        ).toBeLessThanOrEqual(0);
        if (size === PHONE) await shot(page, `tab-${t.key}`);
      }
    }
  });
});
