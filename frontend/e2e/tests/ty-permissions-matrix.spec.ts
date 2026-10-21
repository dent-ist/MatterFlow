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
    { name: 'Asset type', url: `/admin/asset-types/${assetType.id}`, need: ['AssetType.Manage'] },
    {
      name: 'Asset type, Fields tab',
      url: `/admin/asset-types/${assetType.id}?tab=fields`,
      need: ['AssetType.Manage'],
    },
    { name: 'New asset type', url: '/admin/asset-types/new', need: ['AssetType.Manage'] },
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

/** The 403 page is shown (it keeps the address that was asked for, #598, so the URL no longer says `/403`). */
const isForbiddenPage = async (page: Page): Promise<boolean> =>
  (await page
    .getByRole('heading', { level: 1, name: "You don't have permission to view this." })
    .count()) > 0;

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
      personas,
      page: adminPage,
    }) => {
      test.setTimeout(480_000);
      let page = adminPage;
      if (role.perms !== null) {
        const user = await personas.create({ permissions: role.perms, label: `typ-${role.key}` });
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
          if (!(await isForbiddenPage(page)))
            problems.push(`${name} (${url}): expected the 403 page, got ${page.url()}`);
          return false;
        }
        if (await isForbiddenPage(page)) {
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
          if (await isForbiddenPage(page))
            problems.push(`${t.name}: action ${id} leads to the 403 page`);
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

/**
 * AD-D (#526, with #523 and #533): the same matrix for the Labels pages (Priorities, Status labels) and the Audit page. Roles are the
 * Priority.Manage alone, StatusLabel.Manage alone, both, Audit.View alone, Audit.View with Task.View, System Admin, Task.View alone and a
 * person with no admin permission. For each role the three addresses are opened: a permitted address opens with no refused request, no toast,
 * no error text; the other Labels tab falls back to the tab the person may use; a forbidden address shows the 403 page. The "Labels" menu
 * item opens the first allowed tab, the tab strip is offered only to a person who may use both tabs, and an audit object is a link only
 * when the person can open its target. Living file: later issues add rows for the pages they change.
 */
type LabelPerm =
  'Priority.Manage' | 'StatusLabel.Manage' | 'Audit.View' | 'Task.View' | 'Client.View';

interface LabelRole {
  key: string;
  label: string;
  perms: LabelPerm[] | null;
}

const LABEL_ROLES: LabelRole[] = [
  { key: 'admin', label: 'System Admin', perms: null },
  { key: 'pr', label: 'Priority.Manage only', perms: ['Priority.Manage'] },
  { key: 'sl', label: 'StatusLabel.Manage only', perms: ['StatusLabel.Manage'] },
  {
    key: 'both',
    label: 'both Labels permissions',
    perms: ['Priority.Manage', 'StatusLabel.Manage'],
  },
  { key: 'au', label: 'Audit.View only', perms: ['Audit.View'] },
  { key: 'au-tv', label: 'Audit.View and Task.View', perms: ['Audit.View', 'Task.View'] },
  { key: 'tv', label: 'Task.View only', perms: ['Task.View'] },
  { key: 'none', label: 'no admin permission (Client.View)', perms: ['Client.View'] },
];

const holds = (r: LabelRole, ...codes: LabelPerm[]): boolean =>
  r.perms === null || codes.some((c) => r.perms!.includes(c));

/** What an audit object link needs (null: not a link target of the audit page). */
function auditNeed(href: string): LabelPerm[] | null {
  if (href.startsWith('/tasks')) return ['Task.View'];
  if (/^\/(clients|matters|assets|projects)/.test(href) || href.startsWith('/admin/users'))
    return ['Client.View']; // none of these roles holds the other View permissions: a link here is always wrong for them
  return null;
}

test.describe('AD-D: permission matrix of the Labels and Audit pages', () => {
  test.beforeAll(async ({ seed }: { seed: Seeder }) => {
    // Audit rows with a Client and a Task object, so the object links can be examined.
    await seed.task(await seed.world());
  });

  for (const role of LABEL_ROLES) {
    test(`${role.label}: addresses, menu item, tab strip, audit links`, async ({
      asUser,
      personas,
      page: adminPage,
    }) => {
      test.setTimeout(240_000);
      let page = adminPage;
      if (role.perms !== null) {
        const user = await personas.create({ permissions: role.perms, label: `ad1-${role.key}` });
        page = await asUser(user.username);
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      const seen = watch(page);
      const problems: string[] = [];
      const canPr = holds(role, 'Priority.Manage');
      const canSl = holds(role, 'StatusLabel.Manage');
      const canAudit = holds(role, 'Audit.View');

      const visit = async (url: string) => {
        seen.failed.length = 0;
        await page.goto(url);
        await settle(page);
      };

      // The Labels addresses.
      for (const [url, mine, other, otherUrl] of [
        ['/admin/priorities', canPr, canSl, '/admin/status-labels'],
        ['/admin/status-labels', canSl, canPr, '/admin/priorities'],
      ] as const) {
        await visit(url);
        if (!mine && !other) {
          if (!(await isForbiddenPage(page))) problems.push(`${url}: expected the 403 page`);
          continue;
        }
        if (await isForbiddenPage(page))
          problems.push(`${url}: the 403 page for a permitted person`);
        const want = mine ? url : otherUrl;
        if (!page.url().endsWith(want)) problems.push(`${url}: expected ${want}, at ${page.url()}`);
        await expectQuiet(page, url).catch((e: Error) =>
          problems.push(`${url}: ${e.message.split('\n')[0]}`),
        );
        if (seen.failed.length > 0) problems.push(`${url}: refused ${seen.failed.join(', ')}`);
        const tabLinks = await page.locator('#mf-main [role="tab"]').count();
        if (mine && other ? tabLinks !== 2 : tabLinks !== 0)
          problems.push(`${url}: ${tabLinks} tab links for Priority=${canPr}, Status=${canSl}`);
        // The page lists its rows, so the data loaded (not an empty error state).
        await expect(page.locator('#mf-main table tbody tr').first(), `${url}: rows`).toBeVisible();
      }

      // The Labels menu item opens the first allowed tab.
      if (canPr || canSl) {
        await visit(
          role.perms === null || role.perms.includes('Task.View')
            ? '/dashboard'
            : '/admin/priorities',
        );
        const item = page
          .getByRole('list', { name: 'Administration' })
          .getByRole('link', { name: 'Labels' });
        await item.click();
        await settle(page);
        if (!page.url().endsWith(canPr ? '/admin/priorities' : '/admin/status-labels'))
          problems.push(`Labels menu item opened ${page.url()}`);
        if (await isForbiddenPage(page)) problems.push('Labels menu item: the 403 page');
        if (seen.failed.length > 0)
          problems.push(`Labels menu item: refused ${seen.failed.join(', ')}`);
      } else {
        await visit('/403');
        const count = await page
          .getByRole('list', { name: 'Administration' })
          .getByRole('link', { name: 'Labels' })
          .count();
        if (count > 0) problems.push('Labels menu item shown without a Labels permission');
      }

      // Audit.
      await visit('/admin/audit');
      if (!canAudit) {
        if (!(await isForbiddenPage(page))) problems.push('/admin/audit: expected the 403 page');
      } else {
        if (await isForbiddenPage(page))
          problems.push('/admin/audit: the 403 page for a permitted person');
        await expectQuiet(page, 'audit').catch((e: Error) =>
          problems.push(`audit: ${e.message.split('\n')[0]}`),
        );
        if (seen.failed.length > 0) problems.push(`audit: refused ${seen.failed.join(', ')}`);
        await expect(page.locator('#mf-main table tbody tr').first()).toBeVisible();
        const hrefs = [
          ...new Set(
            await page
              .locator('#mf-main table a.au-linkout')
              .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? '')),
          ),
        ];
        for (const href of hrefs) {
          if (href.startsWith('/tasks') && !holds(role, 'Task.View'))
            problems.push(`audit: link ${href} for a person without Task.View`);
          if (
            auditNeed(href)?.[0] === 'Client.View' &&
            !holds(role, 'Client.View') &&
            role.perms !== null
          )
            problems.push(`audit: link ${href} for a person who cannot open it`);
        }
        if (role.key === 'au' && hrefs.length > 0)
          problems.push(`audit: ${hrefs.length} object links for Audit.View only`);
        if (role.key === 'au-tv' && !hrefs.some((h) => h.startsWith('/tasks')))
          problems.push('audit: no task link for Audit.View with Task.View');
        // Every link that is offered opens (never the 403 page).
        for (const href of hrefs.slice(0, 6)) {
          await visit(href);
          if (await isForbiddenPage(page))
            problems.push(`audit link ${href} leads to the 403 page`);
        }
      }

      // Accessibility and widths on every page the person may use (screenshots of the narrowest roles when E2E_SCREENSHOTS is set).
      {
        const pages = [
          ...(canPr ? ['/admin/priorities'] : []),
          ...(canSl && !canPr ? ['/admin/status-labels'] : []),
          ...(canAudit ? ['/admin/audit'] : []),
        ];
        for (const width of [375, 768, 1366, 1920]) {
          await page.setViewportSize({ width, height: width < 700 ? 812 : 900 });
          for (const url of pages) {
            await visit(url);
            if (axeAvailable()) {
              const violations = await axeViolations(page);
              if (violations.length > 0)
                problems.push(
                  `${url} at ${width}: axe ${JSON.stringify(violations).slice(0, 300)}`,
                );
            }
            const overflow = await page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            if (overflow > 0)
              problems.push(`${url} at ${width}: page scrolls sideways by ${overflow}px`);
            if (OUT && ['pr', 'sl', 'au', 'au-tv'].includes(role.key)) {
              fs.mkdirSync(OUT, { recursive: true });
              await page.screenshot({
                path: path.join(OUT, `${role.key}-${url.split('/').pop()}-${width}.png`),
              });
            }
          }
        }
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
});
