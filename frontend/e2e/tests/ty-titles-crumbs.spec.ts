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
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

async function atEverySize(page: Page, name: string, settle?: () => Promise<void>): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    if (settle) await settle();
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
      ['/admin/task-types', 'Task Types - LPT Hub'],
      ['/admin/workflows', 'Task Types: Workflows - LPT Hub'],
      ['/admin/steps', 'Task Types: Workflow Steps - LPT Hub'],
      ['/admin/task-types/new', 'New Task Type - LPT Hub'],
      [`/admin/task-types/${tt.id}`, `${tt.name} - LPT Hub`],
      [`/admin/task-types/${tt.id}/form`, `${tt.name} Form - LPT Hub`],
      ['/admin/workflows/new', 'Task Types: New Workflow - LPT Hub'],
      [`/admin/workflows/${wf.workflowDefinitionId}`, `${wf.name}: Overview - LPT Hub`],
      [
        `/admin/workflows/${wf.workflowDefinitionId}/versions/${versionId}`,
        `${wf.name} v1 (Published) - LPT Hub`,
      ],
      ['/admin/steps/new', 'New Step - LPT Hub'],
      [`/admin/steps/${step.id}`, `${step.title} - LPT Hub`],
      [`/admin/steps/${step.id}/form`, `${step.title} Form - LPT Hub`],
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
    await expect(page).toHaveTitle(`${tt.name} - LPT Hub`);
    const renamed = `${tt.name} renamed`;
    await page.locator('#tt-name').fill(renamed);
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page).toHaveTitle(`${renamed} - LPT Hub`);
  });

  test('a long record name is cut at 60 characters in the title and at 40 in the last crumb', async ({
    page,
    seed,
  }) => {
    const name = `Large Production Workflow With An Extremely Long Name ${uid()}`;
    const wf = await seed.workflow({ name });
    await page.goto(`/admin/workflows/${wf.workflowDefinitionId}`);
    await expect(page).toHaveTitle(`${name.slice(0, 60).trimEnd()}…: Overview - LPT Hub`);
    const crumb = page.locator('[data-crumb-current]');
    await expect(crumb).toHaveAttribute('title', name);
    await expect(crumb.locator('[aria-hidden="true"]')).toHaveText(
      `${name.slice(0, 39).trimEnd()}…`,
    );
    await atEverySize(page, 'workflow-long-crumb');
  });

  test('the crumb links of the version page and the designer pages meet the 24 px target rule (axe target size) at both desktop sizes', async ({
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
    // The crumb links are 16 px inline text links (UI2), no longer 24 px boxes: the 24 px rule (WCAG 2.5.8, #360) is met by the space around each link, which is
    // what axe's target-size rule measures. So the check is that rule on the crumb trail itself, with a trail to measure.
    const crumbTargets = async (what: string): Promise<void> => {
      const crumb = 'nav[aria-label="Breadcrumb"]';
      expect(
        await page.locator(`${crumb} a:visible`).count(),
        `${what}: crumb links`,
      ).toBeGreaterThan(0);
      if (axeAvailable()) {
        const found = await axeViolations(page, crumb);
        expect(found, `${what}: crumb link target size`).toEqual([]);
      }
    };
    await page.goto(`/admin/workflows/${wf.workflowDefinitionId}/versions/${versionId}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Crumb flow');
    await atEverySize(page, 'version-crumb', () => crumbTargets('version page'));
    await page.goto(`/admin/task-types/${tt.id}/form`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(' Form');
    await atEverySize(page, 'form-crumb', () => crumbTargets('form page'));
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
    await expect(typePage).toHaveTitle(`${tt.name} Form - LPT Hub`);
    const wfRole = await seed.role(['Workflow.Manage'], 'Workflow only');
    const wfPage = await asUser((await seed.user([wfRole.name], 'tt-wfonly')).username);
    await wfPage.goto(`/admin/workflows/${wf.workflowDefinitionId}`);
    await expect(wfPage).toHaveTitle(`${wf.name}: Overview - LPT Hub`);
    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'tt-viewer')).username);
    await viewer.goto(`/admin/task-types/${tt.id}`);
    await expect(viewer.getByRole('heading', { name: "You don't have access." })).toBeVisible();
  });
});
