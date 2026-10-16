import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Screenshot and accessibility run for docs/ux/task-types-tabs (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/task-types-tabs [E2E_AXE=/path/to/axe.min.js] frontend/e2e/run-local.sh -g "task types tabs screenshots"
 * Takes the three tabs, the workflow chips (default starred, +n more, No workflow) and the filtered Workflows tab (task type and step)
 * at 1366x768 and 375x812. With `E2E_AXE` (the path of axe-core's axe.min.js) every screen is also checked with axe and the run fails on
 * any violation.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const AXE = process.env['E2E_AXE'];

const SIZES = [
  { w: 1366, h: 768 },
  { w: 375, h: 812 },
];

async function axeViolations(page: Page): Promise<string[]> {
  if (!AXE) return [];
  // Evaluated through the protocol: the app's Content Security Policy blocks an injected script tag.
  await page.evaluate(fs.readFileSync(AXE, 'utf8'));
  return page.evaluate(async () => {
    const result = await (
      window as unknown as { axe: { run: () => Promise<{ violations: Violation[] }> } }
    ).axe.run();
    interface Violation {
      id: string;
      impact: string;
      nodes: { target: string[] }[];
    }
    return result.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    );
  });
}

test.describe('task types tabs screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, seed }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(OUT!, { recursive: true });
    const token = uid();
    const shared = await seed.step({ title: `Quality control pass ${token}`, tags: ['QC'] });
    const flows = [];
    for (const name of [
      'Standard processing',
      'Expedited processing',
      'Collection and review',
      'Production only',
      'Close-out',
    ]) {
      flows.push(
        await seed.workflow({
          name: `${name} ${token}`,
          steps: [{ stepDefinitionId: shared.id, title: shared.title }, { title: 'Load' }],
        }),
      );
    }
    const many = await seed.taskType({
      name: `Data processing ${token}`,
      workflows: flows,
      defaultIndex: 1,
    });
    await seed.taskType({
      name: `Data collection ${token}`,
      workflows: [flows[2], flows[0]],
    });
    await seed.taskType({ name: `Legal hold ${token}`, workflows: [] });
    const problems: string[] = [];

    for (const size of SIZES) {
      const at = (name: string) => path.join(OUT!, `${name}-${size.w}x${size.h}.png`);
      await page.setViewportSize({ width: size.w, height: size.h });
      const shoot = async (name: string) => {
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(250);
        await page.screenshot({ path: at(name) });
        for (const v of await axeViolations(page)) problems.push(`${name} ${size.w}: ${v}`);
      };

      await page.goto(`/admin/task-types?name=${token}`);
      await expect(page.locator('table[data-task-types] tbody tr').first()).toBeVisible();
      await shoot('tab-1-task-types');

      await page.goto(`/admin/workflows?name=${token}`);
      await expect(page.locator('table[data-workflows] tbody tr').first()).toBeVisible();
      await shoot('tab-2-workflows');

      await page.goto(`/admin/steps?title=${token}`);
      await expect(page.locator('table[data-steps] tbody tr').first()).toBeVisible();
      await shoot('tab-3-workflow-steps');

      await page.goto(`/admin/workflows?taskType=${many.id}`);
      await expect(page.locator('[data-filtered-by]')).toContainText(many.name);
      await expect(page.locator('table[data-workflows] tbody tr').first()).toBeVisible();
      await shoot('workflows-filtered-by-task-type');

      await page.goto(`/admin/workflows?step=${shared.id}`);
      await expect(page.locator('[data-filtered-by]')).toContainText(shared.title);
      await expect(page.locator('table[data-workflows] tbody tr').first()).toBeVisible();
      await shoot('workflows-filtered-by-step');

      await page.goto(`/admin/task-types?workflow=${flows[0].workflowDefinitionId}`);
      await expect(page.locator('[data-filtered-by]')).toContainText(flows[0].name);
      await expect(page.locator('table[data-task-types] tbody tr').first()).toBeVisible();
      await shoot('task-types-filtered-by-workflow');
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
