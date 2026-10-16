import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Screenshot run for docs/ux/column-filters (Batch 4 screens; not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/column-filters/screenshots frontend/e2e/run-local.sh -g "column filters admin screenshots"
 * Users, Pods, Task Types, Workflows, Workflow Steps, Asset Types and Audit Logs at 1366x768 (row closed, open, filtered, empty) and
 * 375x812 (the sheet).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

test.describe('column filters admin screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, seed, admin }) => {
    test.setTimeout(900_000);
    const token = uid();
    // A handful of people (roles, one out of office, one waiting), pods, workflows, steps and a task type to filter.
    const tech = await seed.user(['Data Technician'], `shot-tech-${token}`);
    const away = await seed.user(['Data Scientist'], `shot-away-${token}`);
    await seed.user([], `shot-wait-${token}`);
    await seed.outOfOffice(away.userId, { note: 'Away' });
    await seed.pod(`Intake ${token}`, [tech.userId]);
    await seed.pod(`Review ${token}`, [away.userId]);
    const one = await seed.step({ title: `Collect ${token}`, tags: ['Intake', 'Relativity'] });
    await seed.step({ title: `Review ${token}`, tags: ['QC'] });
    const flow = await seed.workflow({
      name: `Standard ${token}`,
      steps: [{ stepDefinitionId: one.id, title: one.title }],
    });
    const second = await seed.workflow({ name: `Expedited ${token}`, stepCount: 2 });
    await admin.post(`/api/v1/workflows/${second.workflowDefinitionId}/versions`, {});
    await seed.taskType({
      name: `Collection ${token}`,
      workflows: [flow],
      fields: [{ key: 'note', label: 'Note', control: 'TEXT' }],
    });
    await seed.taskType({ name: `Production ${token}`, workflows: [flow, second] });
    await admin.post('/api/v1/asset-types', { name: `Source system ${token}`, sortOrder: 40 });

    fs.mkdirSync(OUT!, { recursive: true });
    const shot = async (p: Page, name: string) => {
      await p.waitForLoadState('networkidle');
      await p.waitForTimeout(300);
      const size = p.viewportSize()!;
      await p.screenshot({ path: path.join(OUT!, `${name}-${size.width}x${size.height}.png`) });
    };
    const toggle = page.getByRole('button', { name: /^Filters/ });
    const first = (region: string) =>
      page
        .getByRole('region', { name: `${region}, scrollable` })
        .locator('tbody tr')
        .first();

    await page.setViewportSize({ width: 1366, height: 768 });

    // Users
    await page.goto(`/admin/users?status=all&account=${token}`);
    await expect(first('Users list')).toBeVisible();
    await page.getByRole('button', { name: /^Filters/ }).click(); // opened by the address: close it for the first shot
    await shot(page, 'admin-users-filters-closed');
    await toggle.click();
    await shot(page, 'admin-users-filters-open');
    await page.getByRole('button', { name: /^Filter by Roles/ }).click();
    await page.getByRole('checkbox', { name: 'Data Technician' }).check();
    await shot(page, 'admin-users-roles-multiselect');
    await page.getByRole('button', { name: 'Done' }).click();
    await page.goto(`/admin/users?status=all&account=${token}&availability=OUT_OF_OFFICE`);
    await expect(first('Users list')).toBeVisible();
    await shot(page, 'admin-users-filters-active');
    await page.goto(`/admin/users?status=all&account=${token}&email=no-such-mail`);
    await expect(page.locator('td[data-empty="filtered"]')).toBeVisible();
    await shot(page, 'admin-users-empty-filtered');

    // Pods
    await page.goto(`/admin/pods?name=${token}`);
    await expect(first('Pods list')).toBeVisible();
    await shot(page, 'admin-pods-filters-active');

    // Task Types, Workflows, Workflow Steps
    await page.goto(`/admin/task-types?name=${token}`);
    await expect(first('Task types list')).toBeVisible();
    await shot(page, 'admin-task-types-filters-active');
    await page.goto(`/admin/workflows?name=${token}`);
    await expect(first('Workflows list')).toBeVisible();
    await shot(page, 'admin-workflows-filters-active');
    await page.goto(`/admin/steps?title=${token}`);
    await expect(first('Steps list')).toBeVisible();
    await shot(page, 'admin-steps-filters-active');
    await page.getByRole('button', { name: /^Filter by Tags/ }).click();
    await shot(page, 'admin-steps-tags-multiselect');
    await page.keyboard.press('Escape');
    await page.goto(`/admin/steps?title=${token}&tags=Intake&tags=QC&tagMatch=any`);
    await expect(first('Steps list')).toBeVisible();
    await shot(page, 'admin-steps-tags-match-any');

    // Asset Types
    await page.goto('/admin/asset-types');
    await expect(first('Asset types list')).toBeVisible();
    await toggle.click();
    await shot(page, 'admin-asset-types-filters-open');
    await page.goto(`/admin/asset-types?name=${token}`);
    await expect(first('Asset types list')).toBeVisible();
    await shot(page, 'admin-asset-types-filters-active');

    // Audit Logs
    await page.goto('/admin/audit');
    await expect(first('Audit events list')).toBeVisible();
    await shot(page, 'admin-audit-filters-closed');
    await toggle.click();
    await shot(page, 'admin-audit-filters-open');
    await page.getByRole('button', { name: /^Filter by When/ }).click();
    await page.getByRole('button', { name: 'Last 7 days' }).click();
    await shot(page, 'admin-audit-when-presets');
    await page.keyboard.press('Escape');
    await page.goto(`/admin/audit?eventType=CLIENT_CREATED&q=${token}`);
    await shot(page, 'admin-audit-filters-active');
    await page.goto(`/admin/audit?q=${token}-nothing`);
    await expect(page.locator('td[data-empty="filtered"]')).toBeVisible();
    await shot(page, 'admin-audit-empty-filtered');

    // The sheet at phone width
    await page.setViewportSize({ width: 375, height: 812 });
    for (const [name, url, region] of [
      ['admin-users', `/admin/users?status=all&account=${token}`, 'Users list'],
      ['admin-pods', `/admin/pods?name=${token}`, 'Pods list'],
      ['admin-steps', `/admin/steps?title=${token}`, 'Steps list'],
      ['admin-audit', '/admin/audit', 'Audit events list'],
    ] as const) {
      await page.goto(url);
      await expect(first(region)).toBeVisible();
      await shot(page, `${name}-closed`);
      await page.getByRole('button', { name: /^Filters/ }).click();
      await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
      await shot(page, `${name}-sheet`);
    }
  });
});
