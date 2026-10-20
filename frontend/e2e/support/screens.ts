import fs from 'node:fs';
import path from 'node:path';
import { Page, expect } from '@playwright/test';
import { axeAvailable, axeViolations } from './axe';

/**
 * Screen checks the shell, system-page and header specs share (#596): the four sizes every UX acceptance names, screenshots into
 * `E2E_SCREENSHOTS` (a `docs/ux/**\/fixes/<package>` folder; unset, no pictures), "the page does not scroll sideways" and "axe finds nothing".
 */
export const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

export type Size = (typeof SIZES)[number];

const OUT = process.env['E2E_SCREENSHOTS'];

/** Photographs the page as `<name>-<width>x<height>.png` when E2E_SCREENSHOTS is set. */
export async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

/** The page has no page-level horizontal scroll (WCAG 1.4.10 reflow). */
export async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page-level horizontal scroll').toBeLessThanOrEqual(0);
}

/**
 * Runs `check` at each of the four sizes after resizing: axe (when available) finds nothing, no sideways scroll, and a screenshot at
 * 1366 and 375. `settle` runs after each resize (wait for the layout you assert on).
 */
export async function atEverySize(
  page: Page,
  name: string,
  settle?: (size: Size) => Promise<void>,
): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    if (settle) await settle(size);
    if (axeAvailable()) expect(await axeViolations(page), `${name} at ${size.width}`).toEqual([]);
    await noHorizontalScroll(page);
    if (size.width === 1366 || size.width === 375) await shot(page, name);
  }
}
