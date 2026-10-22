import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Api } from './api';
import { axeAvailable, axeViolations } from './axe';
import { expect } from './fixtures';
import { Seeder } from './seed';

/**
 * Helpers of the workflow version page specs (Task Types UX epic #352, WP-TY6). Screenshots go to the folder in E2E_SCREENSHOTS
 * (docs/ux/task-types-review/fixes/ty6-version) when it is set.
 */
export const OUT = process.env['E2E_SCREENSHOTS'];

export const SIZES = [
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
  { w: 768, h: 1024 },
  { w: 375, h: 812 },
];

export interface DraftWorld {
  wf: Awaited<ReturnType<Seeder['workflow']>>;
  draftId: number;
  url: string;
  publishedUrl: string;
}

/** A published workflow with `n` steps and an open draft copied from it (the draft has `n` steps too). */
export async function draftWorld(
  seed: Seeder,
  admin: Api,
  n = 13,
  steps?: Parameters<Seeder['workflow']>[0],
): Promise<DraftWorld> {
  const wf = await seed.workflow(steps ?? { stepCount: n });
  const draft = await admin.post(`/api/v1/workflows/${wf.workflowDefinitionId}/versions`, {});
  return {
    wf,
    draftId: draft.version.workflowVersionId as number,
    url: `/admin/workflows/${wf.workflowDefinitionId}/versions/${draft.version.workflowVersionId}`,
    publishedUrl: `/admin/workflows/${wf.workflowDefinitionId}/versions/${wf.versionId}`,
  };
}

export async function noSideScroll(page: Page): Promise<void> {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

export async function shoot(
  page: Page,
  name: string,
  size: { w: number; h: number },
): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}-${size.w}x${size.h}.png`) });
}

export async function expectNoViolations(page: Page, label: string): Promise<void> {
  if (!axeAvailable()) return;
  const found = await axeViolations(page);
  expect(found, `${label}: ${JSON.stringify(found)}`).toEqual([]);
}

/** The row of a step by its (full) title. */
export const stepRow = (page: Page, title: string) =>
  page
    .locator('[data-step-row]')
    .filter({ has: page.locator(`[data-step-title]`, { hasText: title }) });

/** The overflow button of a step row. */
export const rowMenu = (page: Page, title: string) =>
  page.getByRole('button', { name: `Actions for ${title}`, exact: true });

/**
 * Clicks a row's actions button after scrolling it into view and letting the pane come to rest. A click by Playwright may nudge a
 * scroll area by a few pixels to bring a button near its edge into view, and any scroll of the page or of a pane closes an open row menu
 * (by design: the menu is placed from the button's position). Scrolling first, then clicking a button that is already in view, leaves the
 * menu open (the menus test of ty6-version-editor failed in every full run).
 */
export async function clickRowMenu(page: Page, title: string): Promise<void> {
  const button = rowMenu(page, title);
  await button.scrollIntoViewIfNeeded();
  await expect(async () => {
    const tops = await button.evaluate(async (b) => {
      const read = () => Math.round(b.getBoundingClientRect().top * 10);
      const first = read();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return [first, read()];
    });
    expect(tops[1], 'the pane has stopped scrolling').toBe(tops[0]);
  }).toPass({ timeout: 10_000 });
  await button.click();
}

/** Tab stops (focusable controls that are reachable with Tab) inside an element. */
export async function tabStops(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate(
    (el) =>
      Array.from(
        el.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'),
      ).filter((e) => {
        const tab = e.getAttribute('tabindex');
        return (
          tab !== '-1' &&
          !(e as HTMLButtonElement).disabled &&
          e.getClientRects().length > 0 &&
          getComputedStyle(e).visibility !== 'hidden'
        );
      }).length,
  );
}
