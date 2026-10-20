import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Screenshot and accessibility run for docs/ux/workflow-tabs-tags (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/workflow-tabs-tags [E2E_AXE=/path/to/axe.min.js] frontend/e2e/run-local.sh -g "workflow tabs and tags screenshots"
 * Takes the Workflows tab, the Workflow Steps tab (with tags and the open tag filter), the step editor with the tag input and the workflow
 * designer's step picker at 1366x768 and 375x812. With `E2E_AXE` (the path of axe-core's axe.min.js) every screen is also checked with axe
 * and the run fails on any violation.
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

test.describe('workflow tabs and tags screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, seed, admin }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(OUT!, { recursive: true });
    const token = uid();
    const tagged = await seed.step({
      title: 'Load to Relativity workspace',
      tags: ['Relativity', 'Processing', 'QC', 'Production', 'Review'],
    });
    await seed.step({ title: 'Collect custodian data', tags: ['Collection', 'Intake'] });
    await seed.step({ title: 'Quality control pass', tags: ['QC', 'Review'] });
    const created = await admin.post('/api/v1/workflows', {
      name: `Standard processing ${token}`,
      description: 'Intake to production',
      isOrdered: true,
    });
    const workflowId = created.workflow.workflowDefinitionId;
    const draftId = created.versions[0].workflowVersionId;
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

      await page.goto('/admin/workflows');
      await expect(page.getByRole('tab', { name: 'Workflows' })).toBeVisible();
      await expect(page.locator('table[data-workflows] tbody tr').first()).toBeVisible();
      await shoot('workflows-tab');

      await page.goto('/admin/steps');
      await expect(page.locator('table[data-steps] tbody tr').first()).toBeVisible();
      await shoot('workflow-steps-tab');

      await page.goto('/admin/steps?tags=QC&tags=Review');
      await expect(page.locator('table[data-steps] tbody tr').first()).toBeVisible();
      // The filters are column filters (#79): the Tags dropdown in the filter row, or the tag checkboxes in the sheet at phone width.
      const tagsFilter = page.getByRole('button', { name: /^Filter by Tags,/ });
      if (!(await tagsFilter.isVisible())) {
        await page.getByRole('button', { name: /^Filters/ }).click();
      }
      if (await tagsFilter.isVisible()) await tagsFilter.click();
      await expect(page.getByRole('checkbox', { name: /^QC / })).toBeVisible();
      await shoot('workflow-steps-tab-tag-filter');
      await page.keyboard.press('Escape');

      await page.goto(`/admin/steps/${tagged.id}`);
      await expect(page.locator('.ti__chip').first()).toBeVisible();
      await page.getByRole('combobox', { name: 'Tags' }).fill('co');
      await expect(page.getByRole('option').first()).toBeVisible();
      await shoot('step-edit-tag-input');
      await page.keyboard.press('Escape');

      await page.goto(`/admin/workflows/${workflowId}/versions/${draftId}`);
      const library = page.locator('[data-library]');
      // The library shows the first 50 of every step in the database: search for the tagged steps of this run instead of hoping they
      // are among them. Below 1280 px the library is a drawer opened from Add step.
      const search = page.getByPlaceholder('Title, description or tag');
      if (!(await search.isVisible()))
        await page.getByRole('button', { name: /^Add step/ }).click();
      await search.fill('Relativity');
      await expect(library.locator('[data-lib]').first()).toBeVisible();
      await expect(library.locator('[data-tag]').first()).toBeVisible();
      await shoot('designer-step-picker');
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
