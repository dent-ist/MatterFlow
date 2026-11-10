import { Json } from '../support/api';
import { expect, test } from '../support/fixtures';
import { labelledDropdown } from '../support/dropdown';
import { PERSONAS } from '../support/personas';
import { atEverySize, shot } from '../support/screens';
import { Page } from '@playwright/test';
import { userName, userRow } from '../support/users-grid';
import { toasts } from '../support/toasts';

/**
 * Landing pages (epic #1330, #1333, #1334): the landing page comes from the server (the person's choice, else the default of the first role,
 * else the old rule); Role Setup has a Landing Page field and column; My Profile has the My Landing Page card and opens for everybody; the five
 * lists default to All for a person who manages no matter. Screens at both desktop sizes (D-82), axe, no new shortcut.
 */
/** Axe, no sideways scroll and (with E2E_SCREENSHOTS) a picture at both desktop sizes. */
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

test.describe('Landing pages (#1333)', () => {
  test.setTimeout(300_000);

  /** A role with exactly these permissions and a person who holds it (plus a pod, so the old rule would say My Work). */
  async function personOf(
    personas: import('../support/personas').Personas,
    seed: import('../support/seed').Seeder,
    label: string,
    permissions: string[],
  ) {
    const p = await personas.create({ label, permissions });
    await seed.pod(undefined, [p.userId]);
    return p;
  }

  async function roleOf(
    admin: import('../support/api').Api,
    name: string,
  ): Promise<{ roleId: number; rowVersion: string }> {
    const roles = await admin.get<Json[]>('/api/v1/roles');
    const role = roles.find((r) => r.name === name)!;
    const detail = await admin.get<Json>(`/api/v1/roles/${role.roleId}`);
    return { roleId: detail.roleId, rowVersion: detail.rowVersion };
  }

  const PERMS = [
    'Task.View',
    'Client.View',
    'Matter.View',
    'Dashboard.View',
    'Dashboard.ViewSummary',
  ];

  test('role default, personal choice and the fallback decide where "/" and the logo lead', async ({
    personas,
    seed,
    admin,
    asUser,
  }) => {
    const p = await personOf(personas, seed, 'lpchain', PERMS);
    const page = await asUser(p.username);
    // Nothing set: today's rule (the person has work, so My Work).
    await page.goto('/');
    await expect(page).toHaveURL(/\/my-work$/);

    // The role default wins over the old rule.
    const role = await roleOf(admin, p.roleNames[0]);
    await admin.put(`/api/v1/roles/${role.roleId}/landing-page`, {
      landingPage: 'dashboard',
      rowVersion: role.rowVersion,
    });
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);

    // The person's own choice (My Profile) wins over the role default, saves at once and the logo follows.
    await page.goto('/profile');
    const card = page.locator('[data-landing-card]');
    await expect(card.locator('h2')).toHaveText('My Landing Page');
    await expect(card.locator('[data-landing-result]')).toContainText(
      `You start on Dashboard. This is the default of your role, ${p.roleNames[0]}.`,
    );
    await labelledDropdown(card, 'Landing Page').selectOption('Clients');
    await expect(toasts(page)).toContainText('Landing page saved');
    await expect(toasts(page)).toContainText('You start on Clients after you sign in.');
    await expect(card.locator('[data-landing-result]')).toHaveText('You start on Clients.');
    await page.getByRole('link', { name: 'LPT Hub home' }).click();
    await expect(page).toHaveURL(/\/clients$/);

    // The choice survives a reload (stored on the server).
    await page.goto('/profile');
    await expect(
      labelledDropdown(page.locator('[data-landing-card]'), 'Landing Page'),
    ).toHaveAttribute('data-value', 'clients');

    // Access to the chosen page is taken away: sign-in falls back silently, the card says so and keeps the choice.
    const detail = await admin.get<Json>(`/api/v1/roles/${role.roleId}`);
    await admin.put(`/api/v1/roles/${role.roleId}`, {
      name: detail.name,
      description: detail.description,
      permissionCodes: PERMS.filter((c) => c !== 'Client.View'),
      rowVersion: detail.rowVersion,
    });
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(toasts(page)).toHaveCount(0);
    await page.goto('/profile');
    const banner = page.locator('[data-landing-banner]');
    await expect(banner).toContainText(
      'Clients is no longer available to you, so you start on Dashboard. Your choice is kept in case access comes back.',
    );
    await expect(
      labelledDropdown(page.locator('[data-landing-card]'), 'Landing Page'),
    ).toContainText('Clients (not available)');
    await review(page, 'landing-card-banner', '[data-landing-card]');

    // Picking "Use My Role's Default" replaces it.
    await labelledDropdown(page.locator('[data-landing-card]'), 'Landing Page').selectOption(
      "Use My Role's Default",
    );
    await expect(page.locator('[data-landing-banner]')).toHaveCount(0);
    await expect(toasts(page)).toContainText('You start on Dashboard, the default of your role.');
  });

  test('My Landing Page card: normal state at both sizes; a failed save puts the value back with the reason', async ({
    personas,
    seed,
    asUser,
  }) => {
    const p = await personOf(personas, seed, 'lpcard', PERMS);
    const page = await asUser(p.username);
    await page.goto('/profile');
    const card = page.locator('[data-landing-card]');
    await expect(card).toBeVisible();
    // Between Account and Notifications.
    const order = await page
      .locator('.pp__col--side > *')
      .evaluateAll((els) => els.map((e) => e.tagName.toLowerCase()));
    const i = order.indexOf('mf-landing-card');
    expect(order[i - 1]).toBe('mf-account-card');
    expect(order[i + 1]).toBe('mf-notification-preferences');
    await review(page, 'landing-card-normal', '[data-landing-card]');

    await page.route('**/api/v1/me/landing-page', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({
            status: 400,
            contentType: 'application/problem+json',
            body: JSON.stringify({ status: 400, title: 'Bad Request', detail: 'Unknown page.' }),
          })
        : route.continue(),
    );
    await labelledDropdown(card, 'Landing Page').selectOption('Clients');
    await expect(card.locator('[data-landing-save-error]')).toContainText(
      "Couldn't save your landing page.",
    );
    await expect(labelledDropdown(card, 'Landing Page')).toHaveAttribute('data-value', '');
    await expect(toasts(page)).toHaveCount(0);
    await review(page, 'landing-card-error', '[data-landing-card]');
  });

  test('My Profile opens for a person without Task.View: Account and My Landing Page only', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.clientViewOnly, label: 'lpnotv' });
    const page = await asUser(p.username);
    await page.goto('/profile');
    await expect(page.locator('[data-profile-header] h1')).toHaveText('My Profile');
    await expect(page.locator('[data-landing-card]')).toBeVisible();
    await expect(page.locator('[data-account-card]')).toBeVisible();
    await expect(
      page.locator('mf-availability-form, mf-absence-list, mf-notification-preferences'),
    ).toHaveCount(0);
    await review(page, 'profile-no-task-view');
    // The account menu offers My Profile (and not Set Out of Office).
    await page.getByRole('button', { name: /account menu/ }).click();
    await expect(page.getByRole('menu', { name: 'Your account' }).getByRole('menuitem')).toHaveText(
      [/My Profile/, /Keyboard Shortcuts/],
    );
  });
});

test.describe('Role Setup: Landing Page (#1333)', () => {
  test.setTimeout(300_000);

  test('the field follows the ticked permissions, saves with the role, blocks a page the role cannot open, and the list shows the column', async ({
    page,
    seed,
  }) => {
    const role = await seed.role(['Task.View', 'Client.View', 'Matter.View'], 'E2E landing');
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/roles');
    // The wide list: a Landing Page column, "Automatic" muted.
    await expect(page.locator('.mf-role-head')).toContainText('Landing Page');
    const row = page.locator('button.mf-role', { hasText: role.name });
    await expect(row.locator('[data-landing-col]')).toHaveText('Automatic');
    await review(page, 'roles-list-landing-column');

    await row.click();
    const field = labelledDropdown(page, 'Landing Page');
    await expect(field).toBeVisible();
    await expect(page.locator('[data-landing-help]')).toHaveText(
      'Where people with this role start after signing in. People can choose their own page under My Profile.',
    );
    expect(await field.optionTexts()).toEqual([
      'Automatic',
      'My Work',
      'Clients',
      'Matters',
      'Task Queue',
    ]);
    // Ticking a permission adds its page at once.
    await page.locator('[data-perm="Asset.View"]').check();
    expect(await field.optionTexts()).toContain('Assets');
    await field.selectOption('Assets');
    await review(page, 'role-setup-landing-field', '[data-landing-field]');

    // Clearing the permission under the chosen page: the trigger says so, the error appears, Save is blocked.
    await page.locator('[data-perm="Asset.View"]').uncheck();
    await expect(field).toContainText('Assets (not available)');
    await expect(page.locator('[data-landing-error]')).toHaveText(
      "This role can't open Assets. Choose another landing page.",
    );
    await review(page, 'role-setup-landing-error', '[data-landing-field]');
    await page.locator('[data-save] button').click();
    await expect(page.locator('[data-landing-error]')).toBeVisible();
    await expect(toasts(page)).toHaveCount(0);

    // Another page: Save works, the list shows it and a reload keeps it.
    await field.selectOption('Clients');
    await expect(page.locator('[data-landing-error]')).toHaveCount(0);
    await page.locator('[data-save] button').click();
    await expect(toasts(page)).toContainText('Role saved');
    await page.getByRole('button', { name: 'Cancel' }).first().dispatchEvent('click');
    await expect(row.locator('[data-landing-col]')).toHaveText('Clients');
    await page.reload();
    await expect(
      page.locator('button.mf-role', { hasText: role.name }).locator('[data-landing-col]'),
    ).toHaveText('Clients');
  });

  test('System Admin is locked: the field is disabled and says why', async ({ page }) => {
    await page.goto('/admin/roles');
    await page.locator('button.mf-role', { hasText: 'System Admin' }).click();
    await expect(labelledDropdown(page, 'Landing Page')).toBeDisabled();
    await expect(page.locator('[data-landing-help]')).toHaveText(
      'System Admin always uses the automatic rule. People with this role can still choose their own page.',
    );
  });

  test('the Users drawer says which role decides the landing page', async ({ personas, page }) => {
    const p = await personas.create({ ...PERSONAS.director, label: 'lpdrawer' });
    await page.goto('/admin/users?status=all');
    await userName(userRow(page, p.userId, p.username)).click();
    await expect(page.locator('[data-landing-source]')).toHaveText(
      'Landing page comes from Director.',
    );
    await review(page, 'users-drawer-landing-line', '[data-landing-source]');
  });
});
