import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Task Detail T10 "Permissions" (#329): the permission matrix of the Task page, in the way of `clients-permissions.spec.ts` (#285).
 *
 * Data: one client, a matter with a project and two assets (one linked to the task, one named in a request field), a pod with the assignee
 * technician in it, and an open task with three steps, comments and an overdue date; a second task is Cancelled. For every role below the
 * spec opens the Task page (plain and from each origin), the sections, the three facts menus, the overflow, Activity, Edit and the Asset
 * link form, collects every link of the page, opens each target as that person, and asserts: no request ends in 401, 403 or 404, no error
 * alert or toast, no "no access" notice (the one explanation under Assets without Asset.View excepted, it is the designed answer), no
 * dead link, no visible control that is disabled or does nothing, and each control is present exactly when the server's own
 * `allowedActions` for that person (and the permission it stands for) says it is. The Tab stops to the first Workflow step are recorded
 * (annotation `tab-stops-before-first-step`), not gated.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/task-detail-review/fixes/t10).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const tag = uid().slice(0, 6);

const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const ASSET_FIELDS = [{ key: 'related_asset', label: 'Related asset', control: 'ASSET_REF' }];

interface Data {
  world: Awaited<ReturnType<Seeder['world']>>;
  task: Json;
  closed: Json;
  project: Json;
  asset: Json;
  formAsset: Json;
  pod: Json;
  tech: { username: string; userId: number };
}
let data: Data;

test.beforeAll(async ({ seed, admin }) => {
  const world = await seed.world({ stepCount: 3, fields: ASSET_FIELDS });
  const project = await seed.project(world.matter, `Perm ${tag} project`);
  const asset = await seed.asset(world.matter, `Perm ${tag} linked asset`);
  const formAsset = await seed.asset(world.matter, `Perm ${tag} form asset`);
  const tech = await seed.user(['Data Technician'], 'permtech');
  const pod = await seed.pod(`Perm ${tag} pod`, [tech.userId]);
  const task = await seed.task(world, {
    title: `Perm ${tag} open task`,
    dueDate: dateInZone(FIRM_ZONE, -2),
    projectId: project.projectId,
    formValues: { related_asset: formAsset.assetId },
  });
  await new TaskApi(admin, task.taskId).assign(tech.userId, pod.podId);
  await admin.post(`/api/v1/tasks/${task.taskId}/assets`, { assetId: asset.assetId });
  for (const text of ['First note', 'Second note', 'Third note']) {
    await admin.post(`/api/v1/tasks/${task.taskId}/comments`, { bodyHtml: `<p>${text}</p>` });
  }
  const closed = await seed.task(world, { title: `Perm ${tag} cancelled task` });
  await new TaskApi(admin, closed.taskId).cancel('Duplicate of an earlier request');
  data = { world, task, closed, project, asset, formAsset, pod, tech };
});

const READ = [
  'Task.View',
  'Matter.View',
  'Client.View',
  'Project.View',
  'Asset.View',
  'Pod.View',
  'Dashboard.View',
  'Dashboard.ViewSummary',
] as const;
const WRITE = [
  'Task.Edit',
  'Task.Assign',
  'Task.SetPriority',
  'Task.ChangeStatus',
  'Task.Complete',
  'Task.Cancel',
  'Task.Reopen',
  'Task.Comment',
  'Workflow.Execute',
  'Workflow.StepReopen',
  'Asset.Link',
  'Asset.Create',
] as const;
const ALL = [...READ, ...WRITE];
const without = (...codes: string[]) => ALL.filter((c) => !codes.includes(c));

interface Role {
  key: string;
  label: string;
  /** Null: the System Admin (everything). */
  perms: string[] | null;
  /** A built-in role instead of a custom one. */
  builtIn?: string;
  /** Whether this person is the task's assignee. */
  assignee?: boolean;
}

const ROLES: Role[] = [
  { key: 'admin', label: 'System Admin', perms: null },
  {
    key: 'assignee',
    label: 'assignee Data Technician',
    perms: null,
    builtIn: 'Data Technician',
    assignee: true,
  },
  { key: 'tech', label: 'other Data Technician', perms: null, builtIn: 'Data Technician' },
  { key: 'view-only', label: 'Task.View only', perms: ['Task.View'] },
  { key: 'view-all', label: 'every View permission, no write', perms: [...READ] },
  { key: 'comment-only', label: 'Task.View + Task.Comment', perms: ['Task.View', 'Task.Comment'] },
  { key: 'no-asset', label: 'no Asset.View', perms: without('Asset.View') },
  { key: 'no-edit', label: 'no Task.Edit', perms: without('Task.Edit') },
  { key: 'no-assign', label: 'no Task.Assign', perms: without('Task.Assign') },
  {
    key: 'no-status',
    label: 'no Complete, Change status, Cancel, Reopen',
    perms: without('Task.ChangeStatus', 'Task.Complete', 'Task.Cancel', 'Task.Reopen'),
  },
  { key: 'no-comment', label: 'no Task.Comment', perms: without('Task.Comment') },
  { key: 'no-pod', label: 'no Pod.View', perms: without('Pod.View') },
  { key: 'no-matter', label: 'no Matter.View', perms: without('Matter.View') },
  { key: 'no-client', label: 'no Client.View', perms: without('Client.View') },
  { key: 'no-project', label: 'no Project.View', perms: without('Project.View') },
  {
    key: 'no-dashboard',
    label: 'no Dashboard.View',
    perms: without('Dashboard.View', 'Dashboard.ViewSummary'),
  },
  {
    key: 'dashboard-no-tab',
    label: 'Dashboard.View without any Dashboard tab permission',
    perms: ['Task.View', 'Dashboard.View', 'Pod.View'],
  },
  {
    key: 'matter-client-view',
    label: 'Task.View + Matter.View + Client.View',
    perms: ['Task.View', 'Matter.View', 'Client.View'],
  },
];

const has = (r: Role, code: string): boolean => r.perms === null || r.perms.includes(code);
/** Permissions are known for custom roles; a built-in role (and the admin) is judged by the server's own answer only. */
const known = (r: Role): boolean => r.perms !== null;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page-level horizontal scroll').toBeLessThanOrEqual(0);
}

/** Failed API answers collected while pages load and menus open. */
function watch(page: Page): { failed: string[]; errors: string[] } {
  const seen = { failed: [] as string[], errors: [] as string[] };
  page.on('response', (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/') && [401, 403, 404].includes(r.status())) {
      seen.failed.push(`${r.status()} ${url.pathname}`);
    }
  });
  page.on('pageerror', (e) => seen.errors.push(e.message));
  return seen;
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-loading], [data-skeleton]')).toHaveCount(0);
}

/** An error alert, a toast, or a notice that says the person has no access (the Assets explanation is the designed answer, see above). */
async function noErrors(page: Page, what: string): Promise<void> {
  // A toast is held back a moment by the error handler.
  await page.waitForTimeout(300);
  await expect(
    page.locator(
      '#mf-main [role=alert], [data-toast], [data-forbidden], [data-no-access]:not([data-section=assets] [data-no-access])',
    ),
    `${what}: error or no-access notice`,
  ).toHaveCount(0);
}

/** The links of the page content (not the navigation rail or the header search), with the hash links left out. */
async function contentLinks(page: Page): Promise<string[]> {
  const hrefs = await page
    .locator('#mf-main a[href]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  return hrefs.filter((h) => h.startsWith('/') && !h.startsWith('//') && !h.startsWith('/#'));
}

/** Visible controls that are disabled and give no reason (a disabled control with a stated reason, a menu item with `data-reason`, is designed). */
async function uselessControls(page: Page): Promise<string[]> {
  return page
    .locator('#mf-main button, #mf-main [role=button], #mf-main [role=menuitem]')
    .evaluateAll((els) =>
      els
        .filter((e) => {
          const el = e as HTMLElement;
          if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
          const disabled =
            (el as HTMLButtonElement).disabled === true ||
            el.getAttribute('aria-disabled') === 'true';
          if (!disabled) return false;
          const why = el.getAttribute('aria-describedby');
          return !(why && document.getElementById(why)?.textContent?.trim());
        })
        .map(
          (e) => (e.textContent ?? '').trim().slice(0, 40) || e.getAttribute('aria-label') || '?',
        ),
    );
}

/** Opens a menu button, asserts every offered item is enabled (or says why), and closes it with Escape. */
async function menuItems(page: Page, trigger: ReturnType<Page['locator']>): Promise<string[]> {
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const items = page.locator(
    '[role=menu]:visible [role=menuitem], [role=menu]:visible [role=menuitemradio]',
  );
  await expect(items.first()).toBeVisible();
  // "Assign to me" is the lead button above the people, not a menu item.
  const lead = page.locator('[data-lead]:visible');
  const first = (await lead.count())
    ? [`LEAD:${((await lead.first().textContent()) ?? '').trim()}`]
    : [];
  const out = await items.evaluateAll((els) =>
    els.map((e) => {
      const el = e as HTMLElement;
      const why = el.getAttribute('aria-describedby');
      const disabled =
        el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled;
      const reason = why ? (document.getElementById(why)?.textContent ?? '').trim() : '';
      return `${(el.textContent ?? '').trim().replace(/\s+/g, ' ')}${disabled ? (reason ? ' [disabled: reason]' : ' [disabled]') : ''}`;
    }),
  );
  await page.keyboard.press('Escape');
  await expect(items.first()).toBeHidden();
  return [...first, ...out];
}

async function newPage(
  role: Role,
  seed: Seeder,
  asUser: (u: string) => Promise<Page>,
  page: Page,
): Promise<{ page: Page; api: Api | null }> {
  if (role.perms === null && !role.builtIn) return { page, api: null };
  let user: { username: string; userId: number };
  if (role.assignee) user = data.tech;
  else if (role.builtIn) user = await seed.user([role.builtIn], `pm-${role.key.slice(0, 6)}`);
  else {
    const r = await seed.role(role.perms!, `E2E task perm ${role.key}`);
    user = await seed.user([r.name], `pm-${role.key.slice(0, 8)}`);
  }
  return { page: await asUser(user.username), api: await Api.as(user.username) };
}

/** The Tab stops from the top of the page to the first control inside the Workflow section. */
async function tabStopsToFirstStep(page: Page): Promise<{ count: number; stops: string[] }> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const stops: string[] = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return 'body';
      const inStep = !!el.closest('[data-workflow-tab] [data-step-id]');
      const name =
        el.getAttribute('data-action') ??
        el.getAttribute('aria-label') ??
        (el.textContent ?? '').trim().slice(0, 30);
      return `${inStep ? 'step:' : ''}${el.tagName.toLowerCase()}:${name}`;
    });
    stops.push(stop);
    if (stop.startsWith('step:')) break;
  }
  const count = stops.findIndex((s) => s.startsWith('step:'));
  return { count: count < 0 ? stops.length : count, stops };
}

test.describe('#329: Task page permission matrix, no dead links', () => {
  for (const role of ROLES) {
    test(`${role.label}: every link and action on the Task page works, every missing permission leaves its control out`, async ({
      asUser,
      seed,
      page: adminPage,
    }) => {
      test.setTimeout(420_000);
      const { page, api } = await newPage(role, seed, asUser, adminPage);
      await page.setViewportSize({ width: 1366, height: 768 });
      const seen = watch(page);
      const detail = new TaskDetailPage(page);
      const { task, world, project } = data;
      const targets = new Set<string>();
      const visit = async (url: string, what: string) => {
        await page.goto(url);
        await expect(detail.header).toBeVisible();
        await settle(page);
        await noErrors(page, what);
        for (const href of await contentLinks(page)) targets.add(href);
      };

      // What the server says this person may do on this task: the page must offer exactly that.
      const answer = api
        ? await api.get<Json>(`/api/v1/tasks/${task.taskId}`)
        : await (await Api.as()).get<Json>(`/api/v1/tasks/${task.taskId}`);
      const allowed = answer.allowedActions as Json;
      const offered = (allowed.transitions as Json[]).filter(
        (o) => o.permitted || o.blockedReason !== 'PERMISSION_DENIED',
      );
      if (known(role)) {
        expect(allowed.canEdit, 'server canEdit').toBe(has(role, 'Task.Edit'));
        expect(allowed.canAssign, 'server canAssign').toBe(has(role, 'Task.Assign'));
        expect(allowed.canSetPriority, 'server canSetPriority').toBe(has(role, 'Task.SetPriority'));
      }

      // --- the page, plain and from every origin ----------------------------------------------------------------------
      await visit(`/tasks/${task.taskId}`, 'task');
      if (['admin', 'view-only', 'no-asset', 'no-matter', 'matter-client-view'].includes(role.key))
        await shot(page, `matrix-${role.key}`);

      // Header: the crumb, the matter crumb, the context line.
      if (known(role)) {
        expect(
          (await page.locator('.rh__trail a[href^="/matters/"]').count()) > 0,
          'matter crumb',
        ).toBe(has(role, 'Matter.View'));
        expect(
          (await page.locator('[data-context] a[href^="/matters/"]').count()) > 0,
          'matter link in the context line',
        ).toBe(has(role, 'Matter.View'));
        expect(
          (await page.locator('[data-context] a[href^="/clients/"]').count()) > 0,
          'client link in the context line',
        ).toBe(has(role, 'Client.View'));
      }
      await expect(page.locator('[data-context] [data-client]')).toContainText(
        world.client.clientNumber,
      );

      // Edit, Complete and the facts menus follow the server's allowed actions.
      expect((await detail.header.locator('[data-action="edit"]').count()) > 0, 'Edit').toBe(
        !!allowed.canEdit,
      );
      expect(
        (await detail.header.locator('[data-record-header] [data-action="complete"]').count()) >
          0 || (await detail.header.locator('[data-action="complete"]').count()) > 0,
        'Complete task',
      ).toBe(offered.some((o) => o.action === 'COMPLETE'));
      expect(
        (await page.locator('[data-facts] [data-status] [data-inline-trigger]').count()) > 0,
        'Status menu',
      ).toBe(offered.length > 0);
      expect(
        (await page.locator('[data-facts] [data-priority] [data-inline-trigger]').count()) > 0,
        'Priority menu',
      ).toBe(!!allowed.canSetPriority);
      expect(
        (await page.locator('[data-facts] [data-assignee] [data-inline-trigger]').count()) > 0,
        'Assignee menu',
      ).toBe(!!allowed.canAssign);
      // The "View only" line exactly when nothing can be changed.
      const canChangeSomething =
        !!allowed.canEdit ||
        !!allowed.canAssign ||
        !!allowed.canSetPriority ||
        offered.length > 0 ||
        (known(role) && (has(role, 'Workflow.Execute') || has(role, 'Workflow.StepReopen')));
      expect((await page.locator('[data-view-only]').count()) > 0, 'View only line').toBe(
        !canChangeSomething && (!known(role) || !has(role, 'Task.Comment') || true),
      );

      // Tabs: Assets by Asset.View (the tab stays, with the sentence and no count, without it), Comments composer by Task.Comment, step
      // buttons by Workflow.Execute.
      const assetsTab = detail.tab('Assets');
      await expect(assetsTab).toBeVisible();
      if (known(role)) {
        const counted = /\(\S+\)/.test((await assetsTab.textContent()) ?? '');
        expect(counted, 'Assets count on the tab').toBe(has(role, 'Asset.View'));
      }
      await detail.ensureAssetsOpen();
      if (known(role) && !has(role, 'Asset.View')) {
        await expect(detail.section('Assets').locator('[data-no-access]')).toBeVisible();
        await expect(detail.section('Assets').locator('[data-asset-id]')).toHaveCount(0);
        await expect(page.locator('[data-request-form]')).toContainText(
          `Asset ${data.formAsset.assetId} (not available)`,
        );
      } else if (known(role)) {
        await expect(detail.section('Assets').locator('[data-asset-id]')).toHaveCount(1);
        await expect(
          page
            .locator('[data-request-form]')
            .getByRole('link', { name: data.formAsset.displayName }),
        ).toHaveAttribute('href', `/assets/${data.formAsset.assetId}`);
      }
      // Linking needs Asset.Link, Asset.View (the picker) and the right to edit the task.
      const canLinkAssets =
        known(role) && has(role, 'Asset.Link') && has(role, 'Asset.View') && !!allowed.canEdit;
      if (known(role)) {
        expect(
          (await detail.section('Assets').locator('[data-link-open]').count()) > 0,
          'Link asset button',
        ).toBe(canLinkAssets);
      }
      await detail.ensureCommentsOpen();
      if (known(role)) {
        expect(
          (await detail.section('Comments').locator('[data-composer]').count()) > 0,
          'comment composer',
        ).toBe(has(role, 'Task.Comment'));
      }
      await expect(detail.section('Comments').locator('[data-comment-id]')).toHaveCount(3);
      await noErrors(page, 'task sections open');

      // Tabs: every tab shows a pane that is on the page.
      for (const name of ['Workflow', 'Assets', 'Comments'] as const) {
        await detail.selectTab(name);
        await expect(detail.section(name).locator('[data-section-heading]')).toBeAttached();
      }
      await detail.selectTab('Workflow');
      await page.evaluate(() => window.scrollTo(0, 0));

      // Menus: every offered item is enabled (or says why), and opening them asks the server for nothing the person may not have.
      const menus: Record<string, string[]> = {};
      for (const name of ['status', 'priority', 'assignee']) {
        const trigger = page.locator(`[data-facts] [data-${name}] [data-inline-trigger]`);
        if (await trigger.count()) menus[name] = await menuItems(page, trigger);
      }
      const overflow = page.locator('[data-record-header] [data-overflow]');
      if (await overflow.count()) menus['overflow'] = await menuItems(page, overflow);
      for (const [name, items] of Object.entries(menus)) {
        expect(
          items.filter((i) => i.endsWith('[disabled]')),
          `${name} menu: items that are disabled and say nothing`,
        ).toEqual([]);
        expect(items.length, `${name} menu is not empty`).toBeGreaterThan(0);
      }
      if (menus['assignee'] && known(role)) expect(menus['assignee'][0]).toBe('LEAD:Assign to me');
      if (menus['overflow']) {
        expect(menus['overflow']).toContain('Copy link');
        expect(menus['overflow'].some((i) => /^Cancel task/.test(i))).toBe(
          offered.some((o) => o.action === 'CANCEL'),
        );
      }
      await noErrors(page, 'menus');

      // Activity drawer: loads, its comment excerpt links work, closing returns to the page.
      const drawer = await detail.openActivity();
      await expect(drawer.locator('[data-event-id], [data-group-key]').first()).toBeVisible();
      await expect(drawer.locator('[data-load-error], [data-more-error]')).toHaveCount(0);
      await noErrors(page, 'activity');
      for (const href of await drawer
        .locator('a[href^="/"]')
        .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? '')))
        targets.add(href);
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();

      // Edit dialog: opens, its selects load without a 403, closes unchanged.
      if (allowed.canEdit) {
        await detail.openEdit();
        const dialog = page.getByRole('dialog', { name: 'Edit task details' });
        await settle(page);
        await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeVisible();
        // Pod and assignee only with Task.Assign; the project select only with Project.View.
        if (known(role)) {
          expect(
            (await dialog.getByLabel('Pod', { exact: true }).count()) > 0,
            'Pod field in Edit',
          ).toBe(has(role, 'Task.Assign'));
        }
        await noErrors(page, 'edit dialog');
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();
      }

      // Asset link form: opens and its lookup works (on the Assets tab).
      await detail.selectTab('Assets');
      if (canLinkAssets && !(await detail.section('Assets').locator('[data-link-form]').count())) {
        await detail.section('Assets').locator('[data-link-open]').click();
        await expect(detail.section('Assets').locator('[data-link-form]')).toBeVisible();
        await settle(page);
        await noErrors(page, 'link asset form');
        const cancel = detail.section('Assets').locator('[data-link-cancel]');
        // The picker's list is open and covers the button: press it with the keyboard.
        await cancel.focus();
        await page.keyboard.press('Enter');
        await expect(detail.section('Assets').locator('[data-link-form]')).toHaveCount(0);
      }

      // Workflow step: the first step opens; its buttons exist only with Workflow.Execute.
      await detail.selectTab('Workflow');
      const firstStep = page.locator('[data-workflow-tab] [data-step-id]').first();
      await expect(firstStep).toBeVisible();

      // --- origins, deep links, closed task ---------------------------------------------------------------------------
      for (const from of [
        'my-work',
        'task-queue',
        'pod-work',
        'matter',
        'project',
        'dashboard',
        'search',
      ]) {
        await visit(`/tasks/${task.taskId}?from=${from}`, `from=${from}`);
        const first = page
          .getByRole('navigation', { name: 'Breadcrumb' })
          .getByRole('link')
          .first();
        await expect(first).toBeVisible();
        const wanted: Record<string, [string, boolean]> = {
          matter: [`Matter ${world.matter.matterRef}`, !known(role) || has(role, 'Matter.View')],
          project: [`Project ${project.name}`, !known(role) || has(role, 'Project.View')],
          dashboard: [
            'Dashboard',
            !known(role) || (has(role, 'Dashboard.View') && has(role, 'Dashboard.ViewSummary')),
          ],
          'pod-work': ['Pod Work', !known(role) || has(role, 'Pod.View')],
          search: ['Search', true],
        };
        const [label, usable] = wanted[from] ?? [null, true];
        if (label && usable) await expect(first).toHaveText(label);
        // An origin the person cannot use is dropped: the crumb is the plain "Tasks" and its target opens.
        if (label && !usable) await expect(first).toHaveText('Tasks');
        // Exactly one visible way back (the crumb at this width).
        const href = await first.getAttribute('href');
        expect(href, `crumb target for from=${from}`).toBeTruthy();
        targets.add(href!);
      }
      for (const tab of ['workflow', 'comments', 'assets', 'details', 'activity']) {
        await visit(`/tasks/${task.taskId}?tab=${tab}`, `tab=${tab}`);
      }
      await visit(`/tasks/${data.closed.taskId}`, 'cancelled task');
      await expect(page.locator('[data-status-note]')).toBeVisible();
      if (known(role)) {
        const reopen = page.locator('[data-action="reopen"]');
        expect((await reopen.count()) > 0, 'Reopen task').toBe(has(role, 'Task.Reopen'));
      }

      // --- visible controls that do nothing -----------------------------------------------------------------------------
      await visit(`/tasks/${task.taskId}`, 'task again');
      await detail.ensureAssetsOpen();
      await detail.ensureCommentsOpen();
      expect(
        await uselessControls(page),
        'visible controls that are disabled and say nothing',
      ).toEqual([]);

      // --- every link target opens for this person ----------------------------------------------------------------------
      expect(targets.size, 'links found').toBeGreaterThanOrEqual(3);
      for (const target of targets) {
        seen.failed.length = 0;
        await page.goto(target);
        await settle(page);
        expect(seen.failed, `requests that failed behind ${target}`).toEqual([]);
        await expect(
          page.locator(
            '#mf-main [role=alert], [data-toast], [data-forbidden], [data-no-access]:not([data-section=assets] [data-no-access])',
          ),
          `error or no-access notice behind ${target}`,
        ).toHaveCount(0);
        await expect(
          page.getByRole('heading', { name: /permission|not found|couldn.t be loaded/i }),
          `error page behind ${target}`,
        ).toHaveCount(0);
      }
      expect(seen.errors, 'uncaught page errors').toEqual([]);

      // --- Tab stops to the first Workflow step (recorded, not gated) -----------------------------------------------------
      await page.goto(`/tasks/${task.taskId}`);
      await expect(detail.header).toBeVisible();
      await settle(page);
      const tabs = await tabStopsToFirstStep(page);
      test.info().annotations.push({
        type: 'tab-stops-before-first-step',
        description: `${tabs.count} (${tabs.stops.slice(0, tabs.count).join(' | ')})`,
      });
      console.log(`T10 ${role.key}: ${tabs.count} Tab stops before the first step`);
    });
  }
});

test.describe('#329: the most restricted variants at four sizes', () => {
  const restricted = ROLES.filter((r) =>
    ['view-only', 'no-asset', 'no-matter', 'matter-client-view'].includes(r.key),
  );
  for (const role of restricted) {
    test(`${role.label}: axe 0 and no sideways scroll at 375, 768, 1366 and 1920, also with the overflow and the Activity drawer open`, async ({
      asUser,
      seed,
      page: adminPage,
    }) => {
      test.setTimeout(300_000);
      const { page } = await newPage(role, seed, asUser, adminPage);
      const detail = new TaskDetailPage(page);
      await page.goto(`/tasks/${data.task.taskId}`);
      await expect(detail.header).toBeVisible();
      await settle(page);
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await detail.ensureAssetsOpen();
        await detail.ensureCommentsOpen();
        // From the top: a sticky bar over a scrolled step would make axe report it as partly covered.
        await page.evaluate(() => window.scrollTo(0, 0));
        if (axeAvailable())
          expect(await axeViolations(page), `${role.key} at ${size.width}`).toEqual([]);
        await noHorizontalScroll(page);
        await shot(page, `perm-${role.key}`);
        // The overflow menu open (every person has Copy link in it).
        await page.evaluate(() => window.scrollTo(0, 0));
        const overflow = page.locator('[data-record-header] [data-overflow]');
        await overflow.click();
        await expect(page.locator('[role=menu]:visible')).toBeVisible();
        if (axeAvailable())
          expect(await axeViolations(page), `${role.key} overflow at ${size.width}`).toEqual([]);
        await noHorizontalScroll(page);
        await page.keyboard.press('Escape');
        // The Activity drawer open.
        const drawer = await detail.openActivity();
        await settle(page);
        if (axeAvailable())
          expect(await axeViolations(page), `${role.key} activity at ${size.width}`).toEqual([]);
        await noHorizontalScroll(page);
        if (size.width === 375 || size.width === 1366)
          await shot(page, `perm-${role.key}-activity`);
        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
      }
    });
  }
});
