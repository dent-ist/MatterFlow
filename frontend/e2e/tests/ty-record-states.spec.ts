import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Task Types administration: not found, no access and failure states (#353). Task type, workflow, version, step and the two form
 * designer routes use the shared record state: one wording, the header kept, Retry only on a failure, no toast on top, the document
 * title names the state. Screenshots go to E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty1-foundations).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

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
    await shot(page, name);
  }
}

interface Route {
  key: string;
  noun: string;
  title: string;
  url: string;
  api: string;
  list: string;
  crumbs: string[];
}

const ROUTES: Route[] = [
  {
    key: 'task-type',
    noun: 'task type',
    title: 'Task type',
    url: '/admin/task-types/99999999',
    api: '**/api/v1/task-types/99999999',
    list: 'Task Types',
    crumbs: ['Administration', 'Task Types', 'Task type'],
  },
  {
    key: 'task-type-form',
    noun: 'task type',
    title: 'Task type',
    url: '/admin/task-types/99999999/form',
    api: '**/api/v1/task-types/99999999',
    list: 'Task Types',
    crumbs: ['Administration', 'Task Types', 'Task type'],
  },
  {
    key: 'workflow',
    noun: 'workflow',
    title: 'Workflow',
    url: '/admin/workflows/99999999',
    api: '**/api/v1/workflows/99999999',
    list: 'Workflows',
    crumbs: ['Administration', 'Task Types', 'Workflows', 'Workflow'],
  },
  {
    key: 'version',
    noun: 'workflow version',
    title: 'Workflow version',
    url: '/admin/workflows/99999999/versions/99999999',
    api: '**/api/v1/workflows/99999999{,/versions/99999999}',
    list: 'Workflows',
    crumbs: ['Administration', 'Task Types', 'Workflows', 'Version'],
  },
  {
    key: 'step',
    noun: 'step',
    title: 'Step',
    url: '/admin/steps/99999999',
    api: '**/api/v1/step-definitions/99999999',
    list: 'Workflow Steps',
    crumbs: ['Administration', 'Task Types', 'Workflow Steps', 'Step'],
  },
  {
    key: 'step-form',
    noun: 'step',
    title: 'Step',
    url: '/admin/steps/99999999/form',
    api: '**/api/v1/step-definitions/99999999',
    list: 'Workflow Steps',
    crumbs: ['Administration', 'Task Types', 'Workflow Steps', 'Step'],
  },
];

const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const noToast = async (page: Page) => {
  await expect(page.locator('.p-toast-message')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
};

test.describe('Task Types administration: not found, no access, failure (#353)', () => {
  for (const r of ROUTES) {
    test(`${r.key}: an unknown id says it was not found, with the header, a way back and no Retry`, async ({
      page,
    }) => {
      await page.goto(r.url);
      await expect(heading(page)).toHaveText(`We couldn't find that ${r.noun}.`);
      await expect(page.locator('body')).not.toContainText('99999999');
      await expect(page.getByRole('button', { name: /Retry|Try again/ })).toHaveCount(0);
      const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('listitem');
      await expect(crumbs).toHaveText(r.crumbs);
      await expect(page).toHaveTitle(`${r.title} not found - MatterFlow`);
      await expect(heading(page)).toBeFocused();
      await noToast(page);
      const back = page.getByRole('link', { name: `Go to ${r.list}` });
      await expect(back).toBeVisible();
      await atEverySize(page, `${r.key}-not-found`);
      await back.click();
      await expect(page).toHaveURL(/\/admin\/(task-types|workflows|steps)$/);
    });

    test(`${r.key}: 403 says no access and 500 shows the reference with Retry that recovers`, async ({
      page,
    }) => {
      let status = 403;
      const reference = `ref-${uid()}`;
      await page.route(r.api, (route) =>
        route.request().method() === 'GET' && status !== 0
          ? route.fulfill({
              status,
              contentType: 'application/problem+json',
              body: JSON.stringify({
                status,
                code: status === 403 ? 'PERMISSION_DENIED' : 'INTERNAL_ERROR',
                traceId: reference,
              }),
            })
          : route.continue(),
      );
      await page.goto(r.url);
      await expect(heading(page)).toHaveText(`You don't have access to this ${r.noun}.`);
      await expect(page).toHaveTitle(`No access to this ${r.noun} - MatterFlow`);
      await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
      await noToast(page);
      await atEverySize(page, `${r.key}-forbidden`);

      status = 500;
      await page.goto(r.url);
      await expect(heading(page)).toHaveText(`Couldn't load this ${r.noun}.`);
      await expect(page).toHaveTitle(`${r.title} could not be loaded - MatterFlow`);
      await expect(page.locator('[data-error-reference]')).toContainText(reference);
      await expect(page.locator('.p-toast-message')).toHaveCount(0);
      await atEverySize(page, `${r.key}-load-failed`);

      await page.setViewportSize({ width: 1366, height: 768 });
      const retry = page.getByRole('button', { name: 'Retry' });
      await retry.focus();
      await retry.click();
      await expect(retry).toBeFocused();
      // Retry reaches the real answer, a 404.
      status = 0;
      // The earlier 403 refreshes the permissions in the background, which can re-render the page once: click again if it did.
      await expect(async () => {
        await page.getByRole('button', { name: 'Retry' }).click({ timeout: 3000 });
        await expect(heading(page)).toHaveText(`We couldn't find that ${r.noun}.`, {
          timeout: 3000,
        });
      }).toPass({ timeout: 20000 });
    });

    test(`${r.key}: a lost connection shows Couldn't load with Retry`, async ({ page }) => {
      await page.route(r.api, (route) =>
        route.request().method() === 'GET' ? route.abort('connectionreset') : route.continue(),
      );
      await page.goto(r.url);
      await expect(heading(page)).toHaveText(`Couldn't load this ${r.noun}.`);
      await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    });
  }

  test('a missing version keeps its workflow in the crumb; the page names the state', async ({
    page,
    seed,
  }) => {
    const wf = await seed.workflow({ name: `Flow ${uid()}` });
    await page.goto(`/admin/workflows/${wf.workflowDefinitionId}/versions/99999999`);
    await expect(heading(page)).toHaveText("We couldn't find that workflow version.");
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('listitem');
    await expect(crumbs).toHaveText([
      'Administration',
      'Task Types',
      'Workflows',
      wf.name,
      'Version',
    ]);
    await expect(
      page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: wf.name }),
    ).toHaveAttribute('href', `/admin/workflows/${wf.workflowDefinitionId}`);
    await atEverySize(page, 'version-not-found-with-workflow');
  });

  test('a list that fails to load shows one message with the reference and no toast', async ({
    page,
  }) => {
    const reference = `ref-${uid()}`;
    for (const [route, api] of [
      ['/admin/task-types', '**/api/v1/task-types*'],
      ['/admin/workflows', '**/api/v1/workflows*'],
      ['/admin/steps', '**/api/v1/step-definitions*'],
    ]) {
      await page.route(api, (r) =>
        r.request().method() === 'GET' &&
        !/\/(tags|\d+)/.test(new URL(r.request().url()).pathname.replace('/api/v1', ''))
          ? r.fulfill({
              status: 500,
              contentType: 'application/problem+json',
              body: JSON.stringify({ status: 500, code: 'INTERNAL_ERROR', traceId: reference }),
            })
          : r.continue(),
      );
      await page.goto(route);
      await expect(page.locator('[data-error]')).toContainText("Couldn't load");
      await expect(page.locator('[data-error] [data-error-reference]')).toContainText(reference);
      await page.waitForTimeout(800); // a held toast would appear after 400 ms
      await expect(page.locator('.p-toast-message')).toHaveCount(0);
      await page.unroute(api);
    }
  });

  test('permissions: Task.View only gets the 403 page; each manager gets the 404 of their own pages', async ({
    seed,
    asUser,
  }) => {
    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'tt-viewer')).username);
    for (const r of ROUTES) {
      await viewer.goto(r.url);
      await expect(
        viewer.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();
    }

    const typeRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const typePage = await asUser((await seed.user([typeRole.name], 'tt-ttonly')).username);
    await typePage.goto('/admin/task-types/99999999');
    await expect(heading(typePage)).toHaveText("We couldn't find that task type.");
    await expect(typePage.getByRole('link', { name: 'Go to Task Types' })).toBeVisible();
    await typePage.goto('/admin/task-types/99999999/form');
    await expect(heading(typePage)).toHaveText("We couldn't find that task type.");
    await typePage.goto('/admin/workflows/99999999');
    await expect(
      typePage.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();

    const wfRole = await seed.role(['Workflow.Manage'], 'Workflow only');
    const wfPage = await asUser((await seed.user([wfRole.name], 'tt-wfonly')).username);
    for (const r of ROUTES.filter((x) => x.key !== 'task-type' && x.key !== 'task-type-form')) {
      await wfPage.goto(r.url);
      // GET /workflows/{id}/versions/{id} needs Task.View on the server (WorkflowPolicies.TaskView), so a Workflow.Manage-only
      // person is answered 403 there: the page says so instead of "couldn't load" (a server rule, recorded in the #353 report).
      await expect(heading(wfPage)).toHaveText(
        r.key === 'version'
          ? "You don't have access to this workflow version."
          : `We couldn't find that ${r.noun}.`,
      );
      await expect(wfPage.getByRole('link', { name: `Go to ${r.list}` })).toBeVisible();
    }
    await wfPage.goto('/admin/task-types/99999999');
    await expect(
      wfPage.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
  });
});
