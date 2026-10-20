import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { Api, Json } from './api';
import { expect } from './fixtures';
import { uid } from './seed';

/** Shared helpers of the WP-AD3 Labels specs (`ad3-*`): the four widths of the acceptance criteria, screenshots, the reflow check. */
export const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;

const OUT = process.env['E2E_SCREENSHOTS'];

export async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

export async function noSideScroll(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${what}: page-level horizontal scroll`).toBeLessThanOrEqual(0);
}

/** Adds `n` priorities named `<prefix> <i>` (least urgent last) and returns a function that deletes them again. */
export async function addPriorities(
  admin: Api,
  n: number,
  prefix = `ad3 ${uid().slice(0, 5)}`,
): Promise<{ made: Json[]; cleanup: () => Promise<void> }> {
  const made: Json[] = [];
  for (let i = 1; i <= n; i++) {
    made.push(
      await admin.post('/api/v1/priorities', {
        label: `${prefix} ${i}`,
        color: 'low',
        isActive: true,
      }),
    );
  }
  return {
    made,
    cleanup: async () => {
      for (const p of made) await admin.raw('DELETE', `/api/v1/priorities/${p.id}`);
    },
  };
}

/** The table row or the phone card of a priority, found by the exact name of its link (a name that merely contains the text is another row). */
export const priorityRow = (page: Page, name: string) =>
  page
    .locator('tbody tr[data-row], li.rc')
    .filter({ has: page.getByRole('link', { name, exact: true }) });

/**
 * Opens the row menu of `trigger` (the "Actions for ..." button). A row far down the list is scrolled into view first and the page is given
 * a moment to settle: the floating menu closes when its list scrolls, so a click that lands during a scroll leaves it shut; then it is clicked again.
 */
export async function openRowMenu(page: Page, trigger: Locator): Promise<void> {
  await trigger.scrollIntoViewIfNeeded();
  await expect(async () => {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}
