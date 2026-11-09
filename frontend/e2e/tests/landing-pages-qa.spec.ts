import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { labelledDropdown } from '../support/dropdown';
import { expect, test } from '../support/fixtures';
import { delayApi, failApi } from '../support/personas';
import { atEverySize, shot } from '../support/screens';
import { toasts } from '../support/toasts';
import { userName, userRow } from '../support/users-grid';

/**
 * Landing pages QA on a real stack (epic #1330, #1335): the starter roles land where the owner decided, several roles use the first role by name,
 * the Pod Work entry follows the resolved landing page, the My Landing Page card shows its loading and load-error states, and a failed
 * `GET /me/landing-page` falls back to the old rule. Screens at both desktop sizes (D-82), axe on every new state.
 */
async function review(page: Page, name: string, focus?: string): Promise<void> {
  await atEverySize(page, name, async () => {
    if (focus)
      await page
        .locator(focus)
        .first()
        .evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    await shot(page, name);
  });
}

/** The main menu (the Dashboard and the lists have a pager, which is a navigation landmark too). */
const navLinks = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('link');

test.describe('Landing pages QA (#1335)', () => {
  test.setTimeout(300_000);

  const CASES = [
    // [starter role, lands on without work, lands on with a pod]
    { role: 'Project Manager', free: /\/my-matters$/, work: /\/my-matters$/ },
    { role: 'Director', free: /\/dashboard$/, work: /\/dashboard$/ },
    { role: 'Pod Lead', free: /\/dashboard$/, work: /\/my-work$/ },
    { role: 'Data Technician', free: /\/dashboard$/, work: /\/my-work$/ },
    { role: 'Data Scientist', free: /\/dashboard$/, work: /\/my-work$/ },
    { role: 'System Admin', free: /\/dashboard$/, work: /\/my-work$/ },
  ];

  test('each starter role lands where the owner decided, with and without work', async ({
    personas,
    seed,
    asUser,
  }) => {
    for (const c of CASES) {
      const free = await personas.create({ label: 'lq-free', roles: [c.role] });
      const freePage = await asUser(free.username);
      await freePage.goto('/');
      await expect(freePage, `${c.role} without work`).toHaveURL(c.free);
      const busy = await personas.create({ label: 'lq-busy', roles: [c.role] });
      await seed.pod(undefined, [busy.userId]);
      const busyPage = await asUser(busy.username);
      await busyPage.goto('/');
      await expect(busyPage, `${c.role} with work`).toHaveURL(c.work);
      // The logo follows the same rule.
      await busyPage.goto('/profile');
      await busyPage.getByRole('link', { name: 'MatterFlow home' }).click();
      await expect(busyPage, `${c.role} logo`).toHaveURL(c.work);
    }
  });

  test('Roles list, role API: starter defaults, and a page the role cannot open is refused with PAGE_NOT_OPENABLE', async ({
    admin,
    page,
  }) => {
    const roles = await admin.get<Json[]>('/api/v1/roles');
    const expected: Record<string, string | null> = {
      'Project Manager': 'my-matters',
      Director: 'dashboard',
      'Pod Lead': null,
      'Data Technician': null,
      'Data Scientist': null,
      'System Admin': null,
    };
    for (const [name, key] of Object.entries(expected)) {
      const role = roles.find((r) => r.name === name)!;
      const dto = await admin.get<Json>(`/api/v1/roles/${role.roleId}/landing-page`);
      expect(dto.landingPage ?? null, name).toBe(key);
    }
    // Data Technician holds no Matter.BeManager: My Matters is not openable for the role.
    const tech = roles.find((r) => r.name === 'Data Technician')!;
    const detail = await admin.get<Json>(`/api/v1/roles/${tech.roleId}`);
    const refused = await admin.raw('PUT', `/api/v1/roles/${tech.roleId}/landing-page`, {
      landingPage: 'my-matters',
      rowVersion: detail.rowVersion,
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain('PAGE_NOT_OPENABLE');
    // The Roles list says it for every starter role.
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/roles');
    for (const [name, key] of Object.entries(expected)) {
      const label =
        key === 'my-matters' ? 'My Matters' : key === 'dashboard' ? 'Dashboard' : 'Automatic';
      await expect(
        page
          .locator('button.mf-role')
          .filter({ has: page.locator('.mf-name', { hasText: new RegExp(`^${name}$`) }) })
          .locator('[data-landing-col]'),
        name,
      ).toHaveText(label);
    }
    await review(page, 'roles-list-starter-defaults');
  });

  test('several roles: the first role by name decides, in the Users drawer, the card and where "/" leads', async ({
    personas,
    seed,
    asUser,
    page,
  }) => {
    // Director sorts before Project Manager: Dashboard, although Project Manager would say My Matters.
    const tag = Date.now().toString(36);
    const dm = await personas.create({
      label: 'lq-dm',
      roles: ['Project Manager', 'Director'],
      displayName: `LQ Dm ${tag}`,
    });
    const dmPage = await asUser(dm.username);
    await dmPage.goto('/');
    await expect(dmPage).toHaveURL(/\/dashboard$/);
    await dmPage.goto('/profile');
    await expect(dmPage.locator('[data-landing-result]')).toHaveText(
      'You start on Dashboard. This is the default of your role, Director.',
    );
    // Data Technician sorts first and is Automatic: it does NOT fall through to the Project Manager default. Automatic is today's rule, which
    // puts a manager on My Matters.
    const tm = await personas.create({
      label: 'lq-tm',
      roles: ['Project Manager', 'Data Technician'],
      displayName: `LQ Tm ${tag}`,
    });
    await seed.pod(undefined, [tm.userId]);
    const tmPage = await asUser(tm.username);
    await tmPage.goto('/');
    await expect(tmPage).toHaveURL(/\/my-matters$/);
    await tmPage.goto('/profile');
    await expect(tmPage.locator('[data-landing-result]')).toHaveText(
      'Your role has no fixed landing page. You start on My Matters, chosen automatically.',
    );
    await page.goto(`/admin/users?status=all&name=${encodeURIComponent(`LQ Dm ${tag}`)}`);
    await userName(userRow(page, dm.userId, dm.username)).click();
    await expect(page.locator('[data-landing-source]')).toHaveText(
      'Landing page comes from Director.',
    );
    await page.keyboard.press('Escape');
    await page.goto(`/admin/users?status=all&name=${encodeURIComponent(`LQ Tm ${tag}`)}`);
    await userName(userRow(page, tm.userId, tm.username)).click();
    await expect(page.locator('[data-landing-source]')).toHaveText(
      'Landing page comes from Data Technician.',
    );
  });

  test('the menu leaves out Pod Work only for a person whose resolved landing page is My Matters', async ({
    personas,
    admin,
    asUser,
  }) => {
    const PERMS = [
      'Matter.BeManager',
      'Matter.View',
      'Task.View',
      'Pod.View',
      'Dashboard.View',
      'Dashboard.ViewSummary',
    ];
    const p = await personas.create({ label: 'lq-menu', permissions: PERMS });
    const role = (await admin.get<Json[]>('/api/v1/roles')).find((r) => r.name === p.roleNames[0])!;
    const setDefault = async (landingPage: string | null) => {
      const d = await admin.get<Json>(`/api/v1/roles/${role.roleId}`);
      await admin.put(`/api/v1/roles/${role.roleId}/landing-page`, {
        landingPage,
        rowVersion: d.rowVersion,
      });
    };
    // Automatic: today's rule says My Matters (BeManager), so the compact menu.
    const page = await asUser(p.username);
    await page.goto('/');
    await expect(page).toHaveURL(/\/my-matters$/);
    await expect(navLinks(page).filter({ hasText: 'Pod Work' })).toHaveCount(0);
    // Role default Dashboard (the Director case): Pod Work is back.
    await setDefault('dashboard');
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(navLinks(page).filter({ hasText: 'Pod Work' })).toHaveCount(1);
    await review(page, 'menu-pod-work-dashboard-lander');
    // The person chooses My Matters on the card: the entry goes away at once, no reload.
    await page.goto('/profile');
    await labelledDropdown(page.locator('[data-landing-card]'), 'Landing Page').selectOption(
      'My Matters',
    );
    await expect(toasts(page)).toContainText('Landing page saved');
    await expect(navLinks(page).filter({ hasText: 'Pod Work' })).toHaveCount(0);
    // Back to the role's default: it returns.
    await labelledDropdown(page.locator('[data-landing-card]'), 'Landing Page').selectOption(
      "Use My Role's Default",
    );
    await expect(navLinks(page).filter({ hasText: 'Pod Work' })).toHaveCount(1);
  });

  test('a failed GET /me/landing-page falls back to the old rule: landing and menu', async ({
    personas,
    seed,
    asUser,
  }) => {
    // A Director: the server would say Dashboard; without the answer, the old rule (Matter.BeManager) says My Matters, and the menu agrees.
    const d = await personas.create({ label: 'lq-fail-dir', roles: ['Director'] });
    const dp = await asUser(d.username);
    await failApi(dp, '**/api/v1/me/landing-page', 500, { method: 'GET' });
    await dp.goto('/');
    await expect(dp).toHaveURL(/\/my-matters$/);
    await expect(toasts(dp)).toHaveCount(0);
    await expect(navLinks(dp).filter({ hasText: 'Pod Work' })).toHaveCount(0);
    // A technician with work keeps My Work, one without lands on the Dashboard.
    const t = await personas.create({ label: 'lq-fail-tech', roles: ['Data Technician'] });
    await seed.pod(undefined, [t.userId]);
    const tp = await asUser(t.username);
    await failApi(tp, '**/api/v1/me/landing-page', 503, { method: 'GET' });
    await tp.goto('/');
    await expect(tp).toHaveURL(/\/my-work$/);
    const f = await personas.create({ label: 'lq-fail-free', roles: ['Data Technician'] });
    const fp = await asUser(f.username);
    await failApi(fp, '**/api/v1/me/landing-page', 500, { method: 'GET' });
    await fp.goto('/');
    await expect(fp).toHaveURL(/\/dashboard$/);
  });

  test('My Landing Page card: loading skeleton, then a load error with Retry', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ label: 'lq-card', roles: ['Director'] });
    const page = await asUser(p.username);
    const stopDelay = await delayApi(page, '**/api/v1/me/landing-pages', 12_000);
    await page.goto('/profile', { waitUntil: 'commit' });
    const card = page.locator('[data-landing-card]');
    await expect(card.locator('[data-landing-loading]')).toBeVisible();
    await expect(card.locator('[data-landing-loading]')).toHaveAttribute('aria-busy', 'true');
    // The rest of the page does not wait for it.
    await expect(page.locator('[data-account-card]')).toBeVisible();
    await review(page, 'landing-card-loading', '[data-landing-card]');
    await stopDelay();

    const stopFail = await failApi(page, '**/api/v1/me/landing-pages', 500, { times: 1 });
    await page.goto('/profile');
    await expect(card.locator('[data-landing-load-error]')).toContainText(
      "Couldn't load your landing page.",
    );
    await expect(toasts(page)).toHaveCount(0);
    await review(page, 'landing-card-load-error', '[data-landing-card]');
    await card.locator('[data-landing-retry]').click();
    await expect(labelledDropdown(card, 'Landing Page')).toBeVisible();
    await expect(card.locator('[data-landing-load-error]')).toHaveCount(0);
    await stopFail();
  });
});
