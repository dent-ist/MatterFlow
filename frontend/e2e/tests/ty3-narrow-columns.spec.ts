import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { LISTS, ListKind, seedMix } from '../support/admin-lists';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * WP-TY3 narrow-window columns of the three Administration lists (#374 Task Types, #375 Workflows and Workflow Steps): the table's columns
 * drop in a fixed order so the grid never scrolls sideways and the row menu stays in view. The phone card tests of this file were deleted
 * with the phone layout (D-82, #1268). Screenshots go to E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty3-lists).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;
const KINDS: ListKind[] = ['types', 'workflows', 'steps'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

async function noSideways(page: Page, what: string): Promise<void> {
  const widths = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(widths.doc, `${what}: page scrolls sideways`).toBeLessThanOrEqual(widths.inner);
}

const tableRows = (page: Page) => page.locator('table tbody tr:is([data-row], [data-record-id])');

test.describe('narrow-window columns: the grid never scrolls sideways and the row menu stays in view (#374, #375)', () => {
  for (const kind of KINDS) {
    const info = LISTS[kind];
    test(`${kind}: at 1024, 1280, 1366 and 1920 px the table fits its box, the filter row is open and the menu is on screen`, async ({
      page,
      admin,
    }) => {
      const token = uid();
      await seedMix(admin, kind, token, 4, 0);
      for (const width of [1024, 1280, 1366, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => localStorage.clear()).catch(() => undefined);
        await page.goto(`${info.list}?${info.filter}=${token}`);
        await expect(tableRows(page).first()).toBeVisible();
        const fit = await page.locator('.mf-table-wrap').evaluate((el) => ({
          scroll: el.scrollWidth,
          client: el.clientWidth,
        }));
        expect(fit.scroll, `${kind} at ${width}: the table scrolls sideways`).toBeLessThanOrEqual(
          fit.client,
        );
        const menu = (await tableRows(page)
          .first()
          .locator('button[data-overflow]')
          .boundingBox())!;
        expect(menu.x + menu.width, `${kind} at ${width}: menu on screen`).toBeLessThanOrEqual(
          width,
        );
        await expect(page.locator(info.row)).toBeVisible();
        await noSideways(page, `${kind} at ${width}`);
        await axeClean(page, `${kind} at ${width}`);
        if (SIZES.some((s) => s.width === width)) await shot(page, `p374-${kind}-table`);
      }
    });
  }
});
