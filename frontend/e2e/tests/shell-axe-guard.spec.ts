import { Page } from '@playwright/test';
import { axeAvailable, axeBestPractice, AxeViolation } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * Axe guard for the whole app shell (epic #585, #597): WCAG 2.2 AA plus the best-practice rule set on every shell route and on the open
 * states, at 1366x768 and 375x812. One table: later epics add their routes here. A violation fails the test and the message prints the
 * rule and the node. Needs axe-core (E2E_AXE_PATH or the installed package); without it every test skips itself.
 */
const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '375x812', width: 375, height: 812 },
] as const;

let ids: {
  clientId: number;
  matterId: number;
  projectId: number;
  taskId: number;
  assetId?: number;
};
let technician: string;
let searchText: string;
let pending: string;

test.beforeAll(async ({ seed }) => {
  const world = await seed.world();
  const task = await seed.task(world);
  searchText = world.client.name;
  const project = await seed.project(world.matter);
  ids = {
    clientId: world.client.clientId,
    matterId: world.matter.matterId,
    projectId: project.projectId,
    taskId: task.taskId,
  };
  technician = (await seed.user(['Data Technician'], 'guardtech')).username;
  pending = (await seed.user([], 'guardpend')).username;
});

function describe(violations: AxeViolation[]): string {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes.map((n) => `   ${JSON.stringify(n.target)} ${n.html}`).join('\n'),
    )
    .join('\n');
}

async function guard(page: Page, what: string): Promise<void> {
  const violations = await axeBestPractice(page);
  expect(violations, `${what}\n${describe(violations)}`).toEqual([]);
}

const ROUTES: { name: string; url: () => string }[] = [
  { name: 'Dashboard', url: () => '/dashboard' },
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
  { name: 'My profile', url: () => '/profile' },
  { name: 'Search', url: () => '/search?q=e2e' },
  { name: 'Search filters', url: () => '/search?type=task&q=e2e&filters=open' },
  { name: 'Admin Users', url: () => '/admin/users' },
  { name: 'Admin Task Types', url: () => '/admin/task-types' },
  { name: 'Admin Asset Types', url: () => '/admin/asset-types' },
  { name: 'Admin Custom Fields', url: () => '/admin/custom-fields' },
  { name: 'Admin Labels', url: () => '/admin/priorities' },
  { name: 'Admin Status labels', url: () => '/admin/status-labels' },
  { name: 'Admin Audit', url: () => '/admin/audit' },
  { name: '404 page', url: () => '/no-such-page' },
  { name: 'Client 404', url: () => '/clients/999999999' },
  { name: 'Matter 404', url: () => '/matters/999999999' },
  { name: 'Project 404', url: () => '/projects/999999999' },
  { name: 'Task 404', url: () => '/tasks/999999999' },
];

for (const size of SIZES) {
  test.describe(`Shell axe guard at ${size.name}`, () => {
    test.skip(() => !axeAvailable(), 'axe-core is not available');
    test.use({ viewport: { width: size.width, height: size.height } });

    test('every shell route is clean (best-practice included)', async ({ page }) => {
      test.setTimeout(240_000);
      for (const route of ROUTES) {
        await page.goto(route.url());
        await expect(page.getByRole('heading').first()).toBeVisible();
        await guard(page, `${route.name} at ${size.name}`);
      }
    });

    test('open states: user menu, shortcut help, a dialog, the Activity drawer', async ({
      page,
    }) => {
      await page.goto('/my-work');
      await page.getByTestId('user-menu').click();
      await expect(page.getByRole('menu', { name: 'Your account' })).toBeVisible();
      await guard(page, `user menu at ${size.name}`);
      await page.getByRole('menuitem', { name: /Set out of office/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await guard(page, `out of office dialog at ${size.name}`);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await page.getByTestId('user-menu').click();
      await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
      await expect(page.locator('[data-shortcut-help]')).toBeVisible();
      await guard(page, `shortcut help at ${size.name}`);
      await page.keyboard.press('Escape');

      await page.goto(`/tasks/${ids.taskId}`);
      await expect(page.getByRole('heading').first()).toBeVisible();
      const activity = page.getByRole('button', { name: /Activity/ }).first();
      if (await activity.isVisible()) {
        await activity.click();
        await expect(page.getByRole('dialog').or(page.locator('.p-drawer'))).toBeVisible();
        await guard(page, `Activity drawer at ${size.name}`);
      }
    });

    test('403, the error page and Access Pending', async ({ asUser, page }) => {
      const tech = await asUser(technician);
      await tech.setViewportSize({ width: size.width, height: size.height });
      await tech.goto('/admin/users');
      await expect(tech.getByRole('heading').first()).toBeVisible();
      await guard(tech, `403 at ${size.name}`);

      await page.route('**/api/v1/me', (route) => route.fulfill({ status: 500, body: '{}' }));
      await page.goto('/my-work');
      await expect(page.getByRole('heading').first()).toBeVisible();
      await guard(page, `error page at ${size.name}`);

      const pend = await asUser(pending);
      await pend.setViewportSize({ width: size.width, height: size.height });
      await pend.goto('/');
      await expect(pend.getByRole('heading', { name: /access is pending/i })).toBeVisible();
      await guard(pend, `Access Pending at ${size.name}`);
    });
  });
}

test.describe('Shell axe guard: phone states', () => {
  test.skip(() => !axeAvailable(), 'axe-core is not available');
  test.use({ viewport: { width: 375, height: 812 } });

  test('phone menu and the search row with suggestions', async ({ page }) => {
    await page.goto('/my-work');
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await guard(page, 'phone menu open');
    await page.keyboard.press('Escape');
    await page.getByTestId('search-button').click();
    await guard(page, 'phone search row');
    await page.locator('#mf-search-row input').fill(searchText);
    await expect(page.locator('[data-search-panel]')).toBeVisible();
    await guard(page, 'phone search suggestions');
  });
});
