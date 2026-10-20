import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { assetTypeWorld, customFieldWorld, stepWorld, typeWorld } from '../support/designer';
import { expect, test } from '../support/fixtures';
import { Seeder } from '../support/seed';
import { build, Setup, versionIds, VersionIds } from '../support/ty-workflow';

/**
 * Task Types UX epic #352, WP-TY10 (#416, #417): the permission matrix of the Task Types area.
 *
 * Every admin permission is enough to READ what it manages, and every denial follows one rule: a tab address falls back to the first allowed
 * tab, a create / edit / version / form address shows the 403 page. For each combination below (System Admin, each `*.Manage` alone, each with
 * and without Task.View, Task.View alone, no admin permission) the spec opens every admin route of the area (the three tab lists, the three
 * filtered views, the tab addresses of the record pages, the create / edit / version / form addresses, the Asset Type and Custom Field
 * pages and designers), collects every link in the page content and opens it, presses the visible header actions, and fails on:
 * any 401 / 403 / 404 answer from the API, an error alert or toast, a "no access" notice on a page the person may use, a dead link (a link
 * to a page the person may not open), or an action that leads to a refusal. It also records the Tab stops to the first row or field of each
 * page. Screenshots (the narrowest roles) and tab-stops.json go to E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty10-permissions).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

type Perm =
  | 'TaskType.Manage'
  | 'Workflow.Manage'
  | 'AssetType.Manage'
  | 'CustomField.Manage'
  | 'Task.View'
  | 'Client.View';

interface Role {
  key: string;
  label: string;
  /** Null: the System Admin (everything). */
  perms: Perm[] | null;
}

const ROLES: Role[] = [
  { key: 'admin', label: 'System Admin', perms: null },
  { key: 'tt', label: 'TaskType.Manage only', perms: ['TaskType.Manage'] },
  { key: 'tt-tv', label: 'TaskType.Manage and Task.View', perms: ['TaskType.Manage', 'Task.View'] },
  { key: 'wf', label: 'Workflow.Manage only', perms: ['Workflow.Manage'] },
  { key: 'wf-tv', label: 'Workflow.Manage and Task.View', perms: ['Workflow.Manage', 'Task.View'] },
  {
    key: 'tt-wf',
    label: 'TaskType.Manage and Workflow.Manage',
    perms: ['TaskType.Manage', 'Workflow.Manage'],
  },
  { key: 'at', label: 'AssetType.Manage only', perms: ['AssetType.Manage'] },
  {
    key: 'at-tv',
    label: 'AssetType.Manage and Task.View',
    perms: ['AssetType.Manage', 'Task.View'],
  },
  { key: 'cf', label: 'CustomField.Manage only', perms: ['CustomField.Manage'] },
  {
    key: 'cf-tv',
    label: 'CustomField.Manage and Task.View',
    perms: ['CustomField.Manage', 'Task.View'],
  },
  { key: 'tv', label: 'Task.View only', perms: ['Task.View'] },
  { key: 'none', label: 'no admin permission (Client.View)', perms: ['Client.View'] },
];

const has = (r: Role, ...codes: Perm[]): boolean =>
  r.perms === null || codes.some((c) => r.perms!.includes(c));

interface World {
  setup: Setup;
  versions: VersionIds;
  type: { id: number; url: string };
  step: { id: number; url: string };
  usedStepId: number;
  assetType: { id: number; url: string };
  customField: { url: string };
}
let world: World;

test.beforeAll(async ({ seed, admin }: { seed: Seeder; admin: Parameters<typeof build>[1] }) => {
  const setup = await build(seed, admin);
  const versions = await versionIds(admin, setup);
  const type = await typeWorld(seed, admin, { published: true, draft: true });
  const step = await stepWorld(seed, admin, { published: true, draft: true });
  const assetType = await assetTypeWorld(admin, { published: true, draft: true });
  const cf = await customFieldWorld(admin, 'client');
  world = {
    setup,
    versions,
    type: { id: type.id, url: type.url },
    step: { id: step.id, url: step.url },
    usedStepId: setup.workflow.stepIds[0],
    assetType: { id: assetType.id, url: assetType.url },
    customField: { url: cf.url },
  };
});

interface Target {
  /** The address as typed. */
  url: string;
  /** Permissions of which any opens it. */
  need: Perm[];
  /** The address is a tab address: a person without the permission lands on the first tab they may use. */
  tabs?: boolean;
  name: string;
}

function targets(): Target[] {
  const { setup, versions, type, step, usedStepId, assetType, customField } = world;
  const wfId = setup.workflow.workflowDefinitionId;
  const TT: Perm[] = ['TaskType.Manage'];
  const WF: Perm[] = ['Workflow.Manage'];
  const both: Perm[] = ['TaskType.Manage', 'Workflow.Manage'];
  return [
    { name: 'Task Types list', url: '/admin/task-types', need: both, tabs: true },
    { name: 'Workflows list', url: '/admin/workflows', need: both, tabs: true },
    { name: 'Steps list', url: '/admin/steps', need: both, tabs: true },
    {
      name: 'Task Types filtered by workflow',
      url: `/admin/task-types?workflow=${wfId}`,
      need: both,
      tabs: true,
    },
    {
      name: 'Workflows filtered by task type',
      url: `/admin/workflows?taskType=${setup.world.taskType.id}`,
      need: both,
      tabs: true,
    },
    {
      name: 'Workflows filtered by step',
      url: `/admin/workflows?step=${usedStepId}`,
      need: both,
      tabs: true,
    },
    { name: 'New task type', url: '/admin/task-types/new', need: TT },
    { name: 'Task type', url: `/admin/task-types/${type.id}`, need: TT },
    {
      name: 'Task type, Workflows tab',
      url: `/admin/task-types/${type.id}?tab=workflows`,
      need: TT,
    },
    { name: 'Task type, Request form tab', url: `/admin/task-types/${type.id}?tab=form`, need: TT },
    {
      name: 'Task type with workflows',
      url: `/admin/task-types/${setup.world.taskType.id}`,
      need: TT,
    },
    { name: 'Task type form', url: type.url, need: TT },
    { name: 'New workflow', url: '/admin/workflows/new', need: WF },
    { name: 'Workflow', url: `/admin/workflows/${wfId}`, need: WF },
    { name: 'Workflow, Versions tab', url: `/admin/workflows/${wfId}?tab=versions`, need: WF },
    { name: 'Workflow, Task types tab', url: `/admin/workflows/${wfId}?tab=task-types`, need: WF },
    {
      name: 'Published version',
      url: `/admin/workflows/${wfId}/versions/${versions.v2}`,
      need: WF,
    },
    { name: 'Retired version', url: `/admin/workflows/${wfId}/versions/${versions.v1}`, need: WF },
    { name: 'Draft version', url: `/admin/workflows/${wfId}/versions/${versions.v3}`, need: WF },
    {
      name: 'Version, Used by tab',
      url: `/admin/workflows/${wfId}/versions/${versions.v2}?tab=used-by`,
      need: WF,
    },
    { name: 'New step', url: '/admin/steps/new', need: WF },
    { name: 'Step', url: `/admin/steps/${step.id}`, need: WF },
    { name: 'Step, Inputs tab', url: `/admin/steps/${step.id}?tab=inputs`, need: WF },
    { name: 'Step, Used by tab', url: `/admin/steps/${usedStepId}?tab=used-by`, need: WF },
    { name: 'Step form', url: step.url, need: WF },
    { name: 'Asset Types', url: '/admin/asset-types', need: ['AssetType.Manage'] },
    {
      name: 'Asset Link Roles',
      url: '/admin/asset-types?tab=link-roles',
      need: ['AssetType.Manage'],
    },
    { name: 'Asset type form', url: assetType.url, need: ['AssetType.Manage'] },
    { name: 'Custom Fields', url: '/admin/custom-fields', need: ['CustomField.Manage'] },
    { name: 'Custom Fields form', url: customField.url, need: ['CustomField.Manage'] },
  ];
}

/** Failed API answers, collected while pages load. */
function watch(page: Page): { failed: string[] } {
  const seen = { failed: [] as string[] };
  page.on('response', (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/') && [401, 403, 404].includes(r.status())) {
      seen.failed.push(`${r.status()} ${url.pathname}`);
    }
  });
  return seen;
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-loading], [data-skeleton]')).toHaveCount(0);
}

const isForbiddenPage = (page: Page): boolean => /\/403(\?|$)/.test(page.url());

/** The links of the page content (not the navigation rail or the header search). */
async function contentLinks(page: Page): Promise<string[]> {
  const hrefs = await page
    .locator('#mf-main a[href]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  return hrefs.filter((h) => h.startsWith('/') && !h.startsWith('//') && !h.startsWith('/api/'));
}

/** No error alert, toast or "no access" notice on a page the person may use. */
async function expectQuiet(page: Page, what: string): Promise<void> {
  await expect(
    page.locator('#mf-main [role=alert], [data-toast]'),
    `${what}: error shown`,
  ).toHaveCount(0);
  await expect(page.locator('#mf-main')).not.toContainText(/don't have permission/i);
  await expect(page.locator('#mf-main')).not.toContainText(/couldn't (find|load)/i);
}

/** Which permission a link target needs (null: not part of the admin area). */
function needOf(href: string): Perm[] | null {
  const p = href.split('?')[0].split('#')[0];
  if (/^\/admin\/(task-types|workflows|steps)\/?$/.test(p))
    return ['TaskType.Manage', 'Workflow.Manage'];
  if (p.startsWith('/admin/task-types')) return ['TaskType.Manage'];
  if (p.startsWith('/admin/workflows') || p.startsWith('/admin/steps')) return ['Workflow.Manage'];
  if (p.startsWith('/admin/asset-types')) return ['AssetType.Manage'];
  if (p.startsWith('/admin/custom-fields')) return ['CustomField.Manage'];
  if (p === '/tasks' || p.startsWith('/tasks')) return ['Task.View'];
  return null;
}

/** The Tab stops from the top of the page to the first row link or field (recorded, not gated). */
async function tabStopsToFirst(page: Page, selector: string): Promise<number | null> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page
    .locator('body')
    .click({ position: { x: 1, y: 1 } })
    .catch(() => undefined);
  for (let n = 1; n <= 60; n++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(
      (sel) => !!document.activeElement && document.activeElement.matches(sel),
      selector,
    );
    if (hit) return n;
  }
  return null;
}

const FIRST: Record<string, string> = {
  '/admin/task-types': '#mf-main a[data-row-list], #mf-main tbody a',
  '/admin/workflows': '#mf-main a[data-row-list], #mf-main tbody a',
  '/admin/steps': '#mf-main a[data-row-list], #mf-main tbody a',
};

const stops: Record<string, Record<string, number | null>> = {};

test.describe('#417: permission matrix of the Task Types area', () => {
  for (const role of ROLES) {
    test(`${role.label}: every route, tab address, link and action`, async ({
      asUser,
      seed,
      page: adminPage,
    }) => {
      test.setTimeout(480_000);
      let page = adminPage;
      if (role.perms !== null) {
        const r = await seed.role(role.perms, `E2E ty-perm ${role.key}`);
        const user = await seed.user([r.name], `typ-${role.key}`);
        page = await asUser(user.username);
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      const seen = watch(page);
      const problems: string[] = [];
      const allowedTargets = (need: Perm[]) => has(role, ...need);
      const visited = new Set<string>();
      stops[role.key] = {};

      const open = async (url: string, name: string, need: Perm[], tabs = false) => {
        seen.failed.length = 0;
        await page.goto(url);
        await settle(page);
        if (!allowedTargets(need)) {
          // Designed denial: a create / edit / version / form address shows the 403 page; a tab address of a person with no tab at all too.
          if (!isForbiddenPage(page))
            problems.push(`${name} (${url}): expected the 403 page, got ${page.url()}`);
          return false;
        }
        if (isForbiddenPage(page)) {
          problems.push(`${name} (${url}): the 403 page for a permitted person`);
          return false;
        }
        if (tabs) {
          // A tab address falls back to the first allowed tab.
          const want = has(role, 'TaskType.Manage') ? null : '/admin/workflows';
          if (want && !page.url().includes(want) && !page.url().includes('/admin/steps')) {
            problems.push(`${name} (${url}): no fallback to ${want}, at ${page.url()}`);
          }
          if (!has(role, 'Workflow.Manage') && /\/admin\/(workflows|steps)/.test(page.url())) {
            problems.push(`${name} (${url}): a Workflow tab for a person without Workflow.Manage`);
          }
        }
        await expectQuiet(page, name).catch((e: Error) =>
          problems.push(`${name} (${url}): ${e.message.split('\n')[0]}`),
        );
        if (seen.failed.length > 0) problems.push(`${name} (${url}): ${seen.failed.join(', ')}`);
        return true;
      };

      for (const t of targets()) {
        if (!(await open(t.url, t.name, t.need, t.tabs))) continue;
        const links = [...new Set(await contentLinks(page))];
        const first = FIRST[t.url.split('?')[0]];
        if (first && t.url.indexOf('?') < 0)
          stops[role.key][t.url] = await tabStopsToFirst(page, first);
        if (
          axeAvailable() &&
          ['Task Types list', 'Task type', 'Workflow', 'Step', 'Published version'].includes(t.name)
        ) {
          const v = await axeViolations(page);
          if (v.length > 0) problems.push(`${t.name}: axe ${JSON.stringify(v).slice(0, 300)}`);
        }

        // Every link: its target must be reachable by this person (a link exists only when its target does).
        for (const href of links) {
          if (visited.has(href)) continue;
          visited.add(href);
          const need = needOf(href);
          if (!need) continue;
          if (!has(role, ...need)) {
            problems.push(`${t.name} (${t.url}): link to ${href} that this person cannot open`);
            continue;
          }
          await open(href, `link ${href} from ${t.name}`, need);
        }
      }

      // Header actions and overflow entries of the record pages: each one must lead somewhere the person may go.
      const records: Target[] = targets().filter((t) =>
        /^(Task type|Workflow|Published version|Draft version|Step)$/.test(t.name),
      );
      for (const t of records) {
        if (!allowedTargets(t.need)) continue;
        await open(t.url, t.name, t.need);
        const labels = await page
          .locator('#mf-main [data-record-header] [data-action]')
          .evaluateAll((els) => els.map((e) => e.getAttribute('data-action') ?? ''));
        for (const id of labels) {
          if (/deactivate|activate|retire|discard|publish|save/.test(id)) continue;
          await open(t.url, t.name, t.need);
          const button = page
            .locator(`#mf-main [data-record-header] [data-action="${id}"]`)
            .first();
          if (!(await button.isVisible())) continue;
          if (await button.isDisabled()) {
            if (
              !(await button.getAttribute('title')) &&
              !(await button.getAttribute('aria-describedby'))
            )
              problems.push(`${t.name}: ${id} is disabled without a reason`);
            continue;
          }
          seen.failed.length = 0;
          await button.click();
          await page.waitForTimeout(400);
          await settle(page);
          if (isForbiddenPage(page)) problems.push(`${t.name}: action ${id} leads to the 403 page`);
          if (seen.failed.length > 0)
            problems.push(`${t.name}: action ${id}: ${seen.failed.join(', ')}`);
          await expect(page.locator('[data-toast]'), `${t.name}: toast after ${id}`).toHaveCount(0);
        }
      }

      if (OUT && ['wf', 'tt', 'tv'].includes(role.key)) {
        fs.mkdirSync(OUT, { recursive: true });
        await page.goto(
          role.key === 'tt' ? `/admin/task-types/${world.type.id}` : '/admin/workflows',
        );
        await settle(page);
        await page.screenshot({ path: path.join(OUT, `matrix-${role.key}-1366x768.png`) });
        await page.setViewportSize({ width: 375, height: 812 });
        await page.screenshot({ path: path.join(OUT, `matrix-${role.key}-375x812.png`) });
      }
      if (OUT) {
        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(
          path.join(OUT, `tab-stops-${role.key}.json`),
          JSON.stringify(stops[role.key], null, 1),
        );
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
});
