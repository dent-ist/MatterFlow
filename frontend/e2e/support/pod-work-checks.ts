import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page, expect } from '@playwright/test';
import { axeBestPractice, AxeViolation } from './axe';

/**
 * Checks every Pod Work spec after #547 shares (epic #546): the four sizes of the definition of done, axe at a size, "no page-level sideways
 * scroll", a screenshot into `E2E_SCREENSHOTS_PW` (the package folder under docs/ux/pod-work-review/fixes/, set per run) and the box of a
 * locator. axe is required: a spec calls `expect(axeAvailable())` first and the audits fail, never skip, when it is missing.
 */
export const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

export type Size = (typeof SIZES)[number];

const OUT = process.env['E2E_SCREENSHOTS_PW'];

/** Writes `<name>.png` into the screenshot folder when `E2E_SCREENSHOTS_PW` is set; nothing otherwise. */
export async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/** axe (WCAG 2.2 AA and best-practice) must find nothing of the page's own; skip-link and landmark findings belong to the app shell (#585). */
export async function axeClean(page: Page, what: string): Promise<void> {
  const found: AxeViolation[] = await axeBestPractice(page);
  const own = found.filter((v) => !['skip-link', 'region'].includes(v.id));
  expect(own, what).toEqual([]);
}

/** How many pixels the page (not an inner box) is wider than the window; 0 or less is no sideways scroll. */
export const pageSideScroll = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

export async function box(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not visible');
  return b;
}
