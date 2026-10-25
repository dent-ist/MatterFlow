import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { PERMISSION_VARIANTS } from '../support/personas';

/**
 * S21 (#606): one document-title rule, `<Page or record>: <Tab or view> - MatterFlow`. A hyphen only stands before the app name; a tab,
 * view or create page follows its page after a colon (`Users: Roles`, `Task Types: New workflow`); not-found titles say so. The table of
 * every route is the unit test `core/title/route-titles.spec.ts`; this spec samples routes in a real browser, with the tab buttons.
 */
const titleOf = (page: Page) => page.evaluate(() => document.title);

/** At most one " - ", the one before the app name. */
const RULE = /^(?!.* - .* - MatterFlow$).+ - MatterFlow$|^MatterFlow$/;

const SAMPLE: [string, string][] = [
  ['/dashboard', 'Dashboard - MatterFlow'],
  ['/clients', 'Clients - MatterFlow'],
  ['/matters', 'Matters - MatterFlow'],
  ['/projects', 'Projects - MatterFlow'],
  ['/admin/users', 'Users - MatterFlow'],
  ['/admin/roles', 'Users: Roles - MatterFlow'],
  ['/admin/pods', 'Users: Pods - MatterFlow'],
  ['/admin/workflows', 'Task Types: Workflows - MatterFlow'],
  ['/admin/steps', 'Task Types: Workflow Steps - MatterFlow'],
  ['/admin/priorities', 'Labels: Priorities - MatterFlow'],
  ['/admin/status-labels', 'Labels: Status labels - MatterFlow'],
  ['/admin/asset-types?tab=link-roles', 'Asset Types: Link Roles - MatterFlow'],
  ['/admin/workflows/new', 'Task Types: New workflow - MatterFlow'],
  ['/no-such-page', 'Page not found - MatterFlow'],
];

test.describe('Document titles: the colon rule (#606)', () => {
  test.setTimeout(300_000);

  test('14 sampled routes show the rule title in the browser tab', async ({ page }) => {
    for (const [url, title] of SAMPLE) {
      await page.goto(url);
      await expect(page).toHaveTitle(title);
      expect(await titleOf(page), url).toMatch(RULE);
    }
  });

  test('switching a tab changes the title with a colon, without a reload', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveTitle('Users - MatterFlow');
    await page.getByRole('tab', { name: /^Roles/ }).click();
    await expect(page).toHaveTitle('Users: Roles - MatterFlow');
    await page.getByRole('tab', { name: /^Pods/ }).click();
    await expect(page).toHaveTitle('Users: Pods - MatterFlow');
    await page.goto('/admin/priorities');
    await page.getByRole('tab', { name: /Status labels/ }).click();
    await expect(page).toHaveTitle('Labels: Status labels - MatterFlow');
  });

  test('a record and its tab, and the task Activity drawer, follow the same rule', async ({
    page,
    seed,
  }) => {
    const client = await seed.client();
    await page.goto(`/clients/${client.clientId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const title = await titleOf(page);
    expect(title).toMatch(/: .+ - MatterFlow$/);
    expect(title).toMatch(RULE);
    const task = await seed.task(await seed.world());
    await page.goto(`/tasks/${task.taskId}?tab=activity`);
    await expect(page).toHaveTitle(/: Activity - MatterFlow$/);
    expect(await titleOf(page)).toMatch(RULE);
  });

  test('permission variants: every landing page and denial has a rule title', async ({
    personas,
    asUser,
  }) => {
    for (const spec of PERMISSION_VARIANTS) {
      const person = await personas.create({ ...spec, label: `title-${spec.key}` });
      const page = await asUser(person.username);
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await titleOf(page), spec.key).toMatch(RULE);
      await page.goto('/admin/roles');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await titleOf(page), `${spec.key} on /admin/roles`).toMatch(RULE);
    }
    const oneView = await personas.create({ permissions: ['Client.View'], label: 'title-one' });
    const page = await asUser(oneView.username);
    await page.goto('/clients');
    await expect(page).toHaveTitle('Clients - MatterFlow');
  });
});
