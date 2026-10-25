import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeBestPractice, AxeViolation } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { goOffline } from '../support/personas';
import { noHorizontalScroll, shot, SIZES } from '../support/screens';

/**
 * Final verification of the app shell and system pages (epic #585, #632): the contract over the shell routes at the four sizes (axe with
 * the best-practice rules including target-size, no page-level sideways scroll, the page-header numbers, the bell, the mark), the banners
 * open, the landing of the personas (the Project Manager's short menu and landing included) and the keyboard and focus rules of the shell.
 * Measurements are written to `$E2E_SCREENSHOTS/measurements.json` when that folder is set (docs/ux/shell-review/fixes/final).
 */
let ids: { clientId: number; matterId: number; projectId: number; taskId: number };

test.beforeAll(async ({ seed }) => {
  const world = await seed.world();
  const task = await seed.task(world);
  const project = await seed.project(world.matter);
  ids = {
    clientId: world.client.clientId,
    matterId: world.matter.matterId,
    projectId: project.projectId,
    taskId: task.taskId,
  };
});

const ROUTES: { name: string; url: () => string }[] = [
  { name: 'Dashboard', url: () => '/dashboard' },
  { name: 'My Matters', url: () => '/my-matters' },
  { name: 'My Work', url: () => '/my-work' },
  { name: 'Task Queue', url: () => '/tasks' },
  { name: 'Pod Work', url: () => '/pods/work' },
  { name: 'Clients', url: () => '/clients' },
  { name: 'Client record', url: () => `/clients/${ids.clientId}` },
  { name: 'Matters', url: () => '/matters' },
  { name: 'Matter record', url: () => `/matters/${ids.matterId}` },
  { name: 'Projects', url: () => '/projects' },
  { name: 'Project record', url: () => `/projects/${ids.projectId}` },
  { name: 'Assets', url: () => '/assets' },
  { name: 'Create task', url: () => '/tasks/new' },
  { name: 'Task page', url: () => `/tasks/${ids.taskId}` },
  { name: 'Notifications', url: () => '/notifications' },
  { name: 'My profile', url: () => '/profile' },
  { name: 'Search', url: () => '/search?q=e2e' },
  { name: 'Search filters', url: () => '/search?type=task&q=e2e&filters=open' },
  { name: 'Admin Users', url: () => '/admin/users' },
  { name: 'Admin Roles', url: () => '/admin/roles' },
  { name: 'Admin Pods', url: () => '/admin/pods' },
  { name: 'Admin Task Types', url: () => '/admin/task-types' },
  { name: 'Admin Workflows', url: () => '/admin/workflows' },
  { name: 'Admin Steps', url: () => '/admin/steps' },
  { name: 'Admin Asset Types', url: () => '/admin/asset-types' },
  { name: 'Admin Custom Fields', url: () => '/admin/custom-fields' },
  { name: 'Admin Labels', url: () => '/admin/priorities' },
  { name: 'Admin Status labels', url: () => '/admin/status-labels' },
  { name: 'Admin Reports', url: () => '/admin/reports' },
  { name: 'Admin Audit', url: () => '/admin/audit' },
  { name: '404 page', url: () => '/no-such-page' },
  { name: 'Client 404', url: () => '/clients/999999999' },
];

interface Row {
  route: string;
  width: number;
  fontSize: number;
  weight: number;
  offset: number;
  overflow: number;
  bell: boolean;
  axe: string[];
}

const describeAxe = (v: AxeViolation[]): string[] =>
  v.map((x) => `${x.id}: ${x.nodes.map((n) => JSON.stringify(n.target)).join(' ')}`);

async function measure(page: Page, route: string, width: number): Promise<Row> {
  const h1 = page.locator('main h1').first();
  await expect(h1).toBeVisible();
  await page.waitForTimeout(250);
  const g = await h1.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      fontSize: parseFloat(cs.fontSize),
      weight: Number(cs.fontWeight),
      offset:
        el.getBoundingClientRect().top -
        document.querySelector('main')!.getBoundingClientRect().top,
    };
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  return {
    route,
    width,
    ...g,
    overflow,
    bell: (await page.locator('mf-notification-bell').count()) > 0,
    axe: describeAxe(await axeBestPractice(page)),
  };
}

test.describe('Final contract over the shell routes (#632)', () => {
  test.skip(() => !axeAvailable(), 'axe-core is not available');
  test.setTimeout(900_000);

  test('every shell route at four sizes: axe 0 (best-practice), no sideways scroll, header numbers, bell, mark', async ({
    page,
  }) => {
    const rows: Row[] = [];
    for (const size of SIZES) {
      await page.setViewportSize(size);
      for (const r of ROUTES) {
        await page.goto(r.url());
        rows.push(await measure(page, r.name, size.width));
        if (size.width === 1366 || size.width === 375)
          await shot(page, `final-${r.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}`);
      }
      await expect(page.locator('.mf-logo__mark')).toBeVisible();
    }
    const out = process.env['E2E_SCREENSHOTS'];
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(rows, null, 1));
    }
    const problems: string[] = [];
    for (const r of rows) {
      const want = r.width < 640 ? 18 : 22;
      if (r.fontSize !== want)
        problems.push(`${r.route} @${r.width}: H1 ${r.fontSize}px, want ${want}`);
      if (r.weight < 700) problems.push(`${r.route} @${r.width}: H1 weight ${r.weight}`);
      if (r.overflow > 0) problems.push(`${r.route} @${r.width}: sideways scroll ${r.overflow}px`);
      if (!r.bell) problems.push(`${r.route} @${r.width}: no notification bell`);
      for (const a of r.axe) problems.push(`${r.route} @${r.width}: axe ${a}`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('banners open: sign-in problem and offline are clean at four sizes and the page does not scroll sideways', async ({
    page,
    context,
  }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/clients');
      await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
      await goOffline(context, true);
      await expect(page.locator('[data-offline-banner]')).toBeVisible({ timeout: 15_000 });
      expect(describeAxe(await axeBestPractice(page)), `offline @${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'final-offline-banner');
      await goOffline(context, false);
      await expect(page.locator('[data-offline-banner]')).toHaveCount(0, { timeout: 30_000 });
    }
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.route('**/api/v1/clients**', (route) =>
        route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
      );
      await page.goto('/clients');
      await expect(page.locator('[data-signin-banner]')).toBeVisible();
      expect(describeAxe(await axeBestPractice(page)), `sign-in @${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'final-signin-banner');
      await page.unroute('**/api/v1/clients**');
    }
  });
});

test.describe('Landing and menus of the personas (#632)', () => {
  test.setTimeout(300_000);

  test('where "/" leads for twelve kinds of person, the Project Manager menu, the bell and the mark', async ({
    personas,
    asUser,
    seed,
  }) => {
    const withPod = await personas.create({ roles: ['Data Technician'], label: 'final-pod' });
    await seed.pod(undefined, [withPod.userId]);
    const noPod = await personas.create({ roles: ['Data Technician'], label: 'final-nopod' });
    const pm = await personas.create({ roles: ['Project Manager'], label: 'final-pm' });
    const cases: { who: string; username: string; lands: RegExp }[] = [
      {
        who: 'director',
        username: (await personas.named('director')).username,
        lands: /\/dashboard$/,
      },
      {
        who: 'observer',
        username: (await personas.named('readOnlyObserver')).username,
        lands: /\/dashboard$/,
      },
      {
        who: 'auditor',
        username: (await personas.named('complianceAuditor')).username,
        lands: /\/dashboard$/,
      },
      {
        who: 'intake',
        username: (await personas.named('intakeCoordinator')).username,
        lands: /\/dashboard$/,
      },
      { who: 'project manager', username: pm.username, lands: /\/my-matters$/ },
      {
        who: 'task view only',
        username: (await personas.named('taskViewOnly')).username,
        lands: /\/(tasks|my-work)$/,
      },
      {
        who: 'client view only',
        username: (await personas.named('clientViewOnly')).username,
        lands: /\/clients$/,
      },
      {
        who: 'config admin',
        username: (await personas.named('configurationAdmin')).username,
        lands: /\/admin\//,
      },
      {
        who: 'pending',
        username: (await personas.named('pending')).username,
        lands: /\/access-pending$/,
      },
      { who: 'technician with a pod', username: withPod.username, lands: /\/my-work$/ },
      { who: 'technician without a pod', username: noPod.username, lands: /\/dashboard$/ },
      { who: 'system admin', username: 'ke\\kekim', lands: /\/(dashboard|my-work)$/ },
    ];
    for (const c of cases) {
      const page = await asUser(c.username);
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(page.url(), c.who).toMatch(c.lands);
      if (!/access-pending|error/.test(page.url())) {
        const hasView = await page.locator('mf-notification-bell').count();
        if (c.who !== 'config admin' && c.who !== 'client view only')
          expect(hasView, `${c.who}: notification bell`).toBe(1);
        await expect(page.locator('.mf-logo__mark')).toBeVisible();
      }
    }

    // The Project Manager's short menu: My Matters, Matters, Tasks, Assets; Clients, Projects and My Work under More.
    const pmPage = await asUser(pm.username);
    await pmPage.setViewportSize({ width: 1366, height: 768 });
    await pmPage.goto('/');
    const nav = pmPage.getByRole('navigation', { name: 'Main' });
    await expect(nav.locator('[data-nav-group] a')).toHaveText([
      /My Matters/,
      /Matters/,
      /Tasks/,
      /Assets/,
    ]);
    await expect(nav.locator('[data-nav-more-toggle]')).toHaveAttribute(
      'aria-expanded',
      /true|false/,
    );
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
    await shot(pmPage, 'final-pm-menu');
  });
});

test.describe('Keyboard and focus (#632)', () => {
  test.setTimeout(300_000);

  test('skip links come first, the user menu and a dialog give focus back, the phone menu returns to its button', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/clients');
    await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /^Skip to/ }).first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /^Skip to/ }).nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();

    const user = page.getByTestId('user-menu');
    await user.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'Your account' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(user).toBeFocused();

    await page.goto('/my-work');
    await user.click();
    await page.getByRole('menuitem', { name: /Set out of office/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(user).toBeFocused();

    await page.setViewportSize({ width: 375, height: 812 });
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
  });
});
