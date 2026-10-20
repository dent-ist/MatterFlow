import { expect, test } from '../support/fixtures';
import { Persona } from '../support/personas';
import { atEverySize } from '../support/screens';

/**
 * S9 (#598): a guard denial renders the 403 page at the address that was asked for. "You asked for /path." in monospace, Copy link beside
 * "Go to <a page you can open>"; Reload retries the address (after a role grant it opens), Back goes where the person came from; `/403`
 * still works as a direct address; the document title stays "No access - MatterFlow".
 */
const FORBIDDEN = "You don't have permission to view this.";

test.describe('The 403 page keeps the address (#598)', () => {
  test('a technician typing /admin/users sees the 403 at that address; Back returns; Reload after a role grant opens the page', async ({
    page: adminPage,
    personas,
    seed,
    asUser,
  }) => {
    void adminPage;
    const tech = await personas.named('technician');
    const page = await asUser(tech.username);
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();

    await page.goto('/admin/users?status=all');
    await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/users\?status=all$/);
    await expect(page.locator('[data-asked-path]')).toHaveText('/admin/users?status=all');
    await expect(page.locator('[data-asked]')).toContainText(
      'You asked for /admin/users?status=all.',
    );
    await expect(page).toHaveTitle('No access - MatterFlow');
    await expect(page.locator('[data-back-link]')).toHaveAttribute('href', '/tasks');

    // Back goes to the page the person came from (the 403 did not add an entry of its own).
    await page.goBack();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/admin\/users\?status=all$/);
    await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeVisible();

    // An administrator grants a role; Reload retries the same address and opens it.
    await seed.grantRoles(tech.userId, ['Director']);
    await page.reload();
    await expect(page).toHaveURL(/\/admin\/users\?status=all$/);
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
    await expect(page.locator('[data-asked]')).toHaveCount(0);
  });

  test('a denial after an in-app navigation also keeps the address, and Back returns', async ({
    personas,
    asUser,
  }) => {
    const viewer = await personas.named('clientViewOnly');
    const page = await asUser(viewer.username);
    await page.goto('/clients');
    await expect(page.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
    // Navigate inside the running app (no page load): the router sees a popstate to an address the person may not open.
    await page.evaluate(() => {
      history.pushState(null, '', '/tasks?view=mine');
      dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/tasks\?view=mine$/);
    await expect(page.locator('[data-asked-path]')).toHaveText('/tasks?view=mine');
    await expect(page.locator('[data-back-link]')).toHaveAttribute('href', '/clients');
    await page.goBack();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
  });

  test('Copy link puts the full address on the clipboard, says so, and works from the keyboard', async ({
    personas,
    asUser,
    baseURL,
  }) => {
    const tech = await personas.named('technician');
    const page = await asUser(tech.username);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/admin/audit?from=2026-01-01');
    await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeVisible();

    const copy = page.getByRole('button', { name: 'Copy link' });
    await expect(copy).toBeVisible();
    await expect(copy).toContainText('Copy link');
    // Keyboard only: Tab from the page heading reaches the primary "Go to ..." link, then Copy link (#607: primary first, secondary second).
    await page.locator('h1').evaluate((h) => {
      h.setAttribute('tabindex', '-1');
      (h as HTMLElement).focus();
    });
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-back-link]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(copy).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Link copied' })).toBeAttached();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${baseURL}/admin/audit?from=2026-01-01`,
    );
  });

  test('/403 as a direct address still works and offers no address to copy', async ({
    personas,
    asUser,
  }) => {
    const tech = await personas.named('technician');
    const page = await asUser(tech.username);
    await page.goto('/403');
    await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/403$/);
    await expect(page.locator('[data-asked]')).toHaveCount(0);
    await expect(page).toHaveTitle('No access - MatterFlow');
  });

  test('permission variants: the address is kept for every kind of person, and the link follows the landing rule', async ({
    personas,
    asUser,
  }) => {
    const cases: { who: Persona; path: string; link: string | null }[] = [
      { who: await personas.named('clientViewOnly'), path: '/matters', link: '/clients' },
      { who: await personas.named('taskViewOnly'), path: '/admin/task-types', link: '/tasks' },
      { who: await personas.named('podViewWithoutTaskView'), path: '/tasks', link: '/pods/work' },
      { who: await personas.named('userManageOnly'), path: '/clients/new', link: '/admin' },
      { who: await personas.named('readOnlyObserver'), path: '/admin/workflows', link: null },
      { who: await personas.named('complianceAuditor'), path: '/clients/new', link: null },
      { who: await personas.named('intakeCoordinator'), path: '/admin/workflows', link: null },
      { who: await personas.named('configurationAdmin'), path: '/tasks', link: null },
    ];
    for (const c of cases) {
      const page = await asUser(c.who.username);
      await page.goto(c.path);
      const label = `${c.who.username} ${c.path}`;
      await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 }), label).toBeVisible();
      await expect(page, label).toHaveURL(new RegExp(`${c.path.replace(/\//g, '\\/')}$`));
      await expect(page.locator('[data-asked-path]'), label).toHaveText(c.path);
      if (c.link) {
        await expect(page.locator('[data-back-link]'), label).toHaveAttribute('href', c.link);
      }
    }
  });

  test('a pending user still goes to Access Pending, not the 403', async ({ personas, asUser }) => {
    const pending = await personas.named('pending');
    const page = await asUser(pending.username);
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/access-pending$/);
  });

  test('axe is clean and nothing scrolls sideways at four sizes (long path included)', async ({
    personas,
    asUser,
  }) => {
    const tech = await personas.named('technician');
    const page = await asUser(tech.username);
    const long = `/admin/users?account=${'x'.repeat(120)}`;
    await page.goto(long);
    await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeVisible();
    await expect(page.locator('[data-asked-path]')).toHaveText(long);
    await atEverySize(page, 'forbidden-in-place');
  });
});
