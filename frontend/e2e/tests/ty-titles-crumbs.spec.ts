import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Task Types administration: document titles name the record (#359) and the crumb links keep a 24 px target (#360). Screenshots go to
 * E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty1-foundations).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

async function atEverySize(page: Page, name: string): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    if (axeAvailable()) expect(await axeViolations(page), `${name} at ${size.width}`).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${name}: page-level horizontal scroll at ${size.width}`).toBeLessThanOrEqual(
      0,
    );
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
    }
  }
}

test.describe('Document titles and crumb targets (#359, #360)', () => {
  test('every Task Types administration route names its record in the tab title', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const wf = await seed.workflow({ name: `Title flow ${token}` });
    const tt = await seed.taskType({
      name: `Title type ${token}`,
      workflows: [wf],
      fields: [{ key: 'ref', label: 'Reference', control: 'TEXT' }],
    });
    const step = await seed.step({ title: `Title step ${token}` });
    const versionId = (
      await seed.admin.get<{ versions: { workflowVersionId: number }[] }>(
        `/api/v1/workflows/${wf.workflowDefinitionId}`,
      )
    ).versions[0].workflowVersionId;

    const cases: [string, string][] = [
      ['/admin/task-types', 'Task Types - MatterFlow'],
      ['/admin/workflows', 'Task Types - Workflows - MatterFlow'],
      ['/admin/steps', 'Task Types - Workflow Steps - MatterFlow'],
      ['/admin/task-types/new', 'New task type - MatterFlow'],
      [`/admin/task-types/${tt.id}`, `${tt.name} - MatterFlow`],
      [`/admin/task-types/${tt.id}/form`, `Form: ${tt.name} - MatterFlow`],
      ['/admin/workflows/new', 'New workflow - MatterFlow'],
      [`/admin/workflows/${wf.workflowDefinitionId}`, `${wf.name}: Overview - MatterFlow`],
      [
        `/admin/workflows/${wf.workflowDefinitionId}/versions/${versionId}`,
        `${wf.name} v1 (Published) - MatterFlow`,
      ],
      ['/admin/steps/new', 'New step - MatterFlow'],
      [`/admin/steps/${step.id}`, `${step.title} - MatterFlow`],
      [`/admin/steps/${step.id}/form`, `Form: ${step.title} - MatterFlow`],
    ];
    for (const [url, title] of cases) {
      await page.goto(url);
      await expect(page, url).toHaveTitle(title);
    }
  });

  test('the title follows a rename after Save', async ({ page, seed }) => {
    const wf = await seed.workflow({});
    const tt = await seed.taskType({ workflows: [wf] });
    await page.goto(`/admin/task-types/${tt.id}`);
    await expect(page).toHaveTitle(`${tt.name} - MatterFlow`);
    const renamed = `${tt.name} renamed`;
    await page.locator('#tt-name').fill(renamed);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveTitle(`${renamed} - MatterFlow`);
  });

  test('a long record name is cut at 60 characters in the title and at 40 in the last crumb', async ({
    page,
    seed,
  }) => {
    const name = `Large Production Workflow With An Extremely Long Name ${uid()}`;
    const wf = await seed.workflow({ name });
    await page.goto(`/admin/workflows/${wf.workflowDefinitionId}`);
    await expect(page).toHaveTitle(`${name.slice(0, 60).trimEnd()}…: Overview - MatterFlow`);
    const crumb = page.locator('[data-crumb-current]');
    await expect(crumb).toHaveAttribute('title', name);
    await expect(crumb.locator('[aria-hidden="true"]')).toHaveText(
      `${name.slice(0, 39).trimEnd()}…`,
    );
    await atEverySize(page, 'workflow-long-crumb');
  });

  test('the crumb links of the version page and the designer pages meet the 24 px target at four widths', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const wf = await seed.workflow({ name: `Crumb flow ${token}` });
    const tt = await seed.taskType({ name: `Crumb type ${token}`, workflows: [wf] });
    const versionId = (
      await seed.admin.get<{ versions: { workflowVersionId: number }[] }>(
        `/api/v1/workflows/${wf.workflowDefinitionId}`,
      )
    ).versions[0].workflowVersionId;
    await page.goto(`/admin/workflows/${wf.workflowDefinitionId}/versions/${versionId}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Crumb flow');
    await atEverySize(page, 'version-crumb');
    await page.goto(`/admin/task-types/${tt.id}/form`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Form:');
    await atEverySize(page, 'form-crumb');
    await page.setViewportSize({ width: 375, height: 812 });
    for (const link of await page.locator('nav[aria-label="Breadcrumb"] a').all()) {
      const box = (await link.boundingBox())!;
      expect(box.height, 'crumb link height').toBeGreaterThanOrEqual(24);
    }
  });

  test('permission variants: each manager sees the record title on the pages they may open', async ({
    seed,
    asUser,
  }) => {
    const token = uid();
    const wf = await seed.workflow({ name: `Perm flow ${token}` });
    const tt = await seed.taskType({ name: `Perm type ${token}`, workflows: [wf] });
    const typeRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const typePage = await asUser((await seed.user([typeRole.name], 'tt-ttonly')).username);
    await typePage.goto(`/admin/task-types/${tt.id}/form`);
    await expect(typePage).toHaveTitle(`Form: ${tt.name} - MatterFlow`);
    const wfRole = await seed.role(['Workflow.Manage'], 'Workflow only');
    const wfPage = await asUser((await seed.user([wfRole.name], 'tt-wfonly')).username);
    await wfPage.goto(`/admin/workflows/${wf.workflowDefinitionId}`);
    await expect(wfPage).toHaveTitle(`${wf.name}: Overview - MatterFlow`);
    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'tt-viewer')).username);
    await viewer.goto(`/admin/task-types/${tt.id}`);
    await expect(
      viewer.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
  });
});
