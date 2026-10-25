import { Page } from '@playwright/test';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, requireRule, test } from '../support/sensitive-fixtures';
import { SensitiveUniverse } from '../support/sensitive-universe';
import { toasts } from '../support/toasts';

/**
 * Sensitive matters, the screens (epic #788, SM-14 and SM-17, #802 and #805): what a person sees when the rule applies to them.
 *   - marking a matter sensitive asks "You will no longer see this matter" first (409), and a sensitive matter needs a manager (400);
 *   - the Roles screen warns that Matter.ViewSensitive shows ALL sensitive matters;
 *   - an assignee's task page shows the matter header as plain text (no link) and calls nothing that fails;
 *   - access that ends (a manager removed, a task reassigned) ends on the person's next request;
 *   - axe finds nothing on the changed screens at 1366x768, 1920x1080, 768x1024 and 375x812.
 *
 * Needs `Features__SensitiveMatterAccess=true`; the tests skip themselves when it is off (see sensitive-leak-scan.spec.ts).
 */
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;

async function axeAtEverySize(
  page: Page,
  what: string,
  ready?: () => Promise<void>,
): Promise<void> {
  expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    if (ready) await ready();
    const violations = await axeViolations(page);
    expect(violations, `${what} at ${size.width}x${size.height}`).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${what}: no sideways scroll at ${size.width}`).toBeLessThanOrEqual(0);
  }
}

/** A fresh normal matter with a task, in the universe's client, that a test may change without touching the shared S1 to S3. */
async function ownMatter(
  u: SensitiveUniverse,
  admin: Api,
  seedTask: (matterId: number, title: string, assignee?: number) => Promise<Json>,
  number: string,
  options: { sensitive?: boolean; secondary?: number; primary?: number } = {},
): Promise<{ matter: Json; task: Json }> {
  let matter: Json = await admin.post('/api/v1/matters', {
    clientId: u.client.clientId,
    matterNumber: number,
    name: `Own-${u.tag}-${number} matter`,
    isSensitive: options.sensitive ?? false,
  });
  if (options.primary || options.secondary) {
    matter = await admin.put(`/api/v1/matters/${matter.matterId}/managers`, {
      primaryManagerId: options.primary ?? null,
      secondaryManagerId: options.secondary ?? null,
      rowVersion: matter.rowVersion,
    });
  }
  const task = await seedTask(matter.matterId, `Own-${u.tag}-${number} task`);
  return { matter, task };
}

test.describe('Sensitive matters: the screens', () => {
  test.describe.configure({ timeout: 240_000 });
  test.beforeEach(({ universe }) => requireRule(universe, test.skip));

  test('marking asks "You will no longer see this matter" first; keeping it changes nothing; confirming sends the person to the list', async ({
    universe: u,
    admin,
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const matter: Json = await admin.post('/api/v1/matters', {
      clientId: u.client.clientId,
      matterNumber: '00031',
      name: `Mark-${u.tag} matter`,
    });
    const page = await asUser(u.people.p5.username);
    await page.goto(`/matters/${matter.matterId}/edit`);
    await page.getByRole('checkbox', { name: /Sensitive matter/ }).check();
    // The wording says what the flag does now.
    await expect(page.locator('form')).toContainText('Everyone else does not see it at all');
    await page.getByRole('button', { name: 'Save changes' }).click();

    const dialog = page.getByRole('dialog', { name: 'You will no longer see this matter' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('You are none of these');
    await expect(toasts(page)).toHaveCount(0); // asked in the dialog, not announced as an error
    await axeAtEverySize(page, 'confirm dialog', async () => {
      await expect(dialog).toBeVisible();
    });
    await page.setViewportSize({ width: 1440, height: 900 });

    // Keep it as it is: nothing was saved.
    await dialog.getByRole('button', { name: 'Keep it as it is' }).click();
    await expect(dialog).toBeHidden();
    expect((await admin.get<Json>(`/api/v1/matters/${matter.matterId}`)).isSensitive).toBe(false);

    // Confirm: saved, the list opens (the matter page would be "not found" now), and the editor no longer sees the matter.
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page
      .getByRole('dialog', { name: 'You will no longer see this matter' })
      .getByRole('button', { name: 'Mark sensitive' })
      .click();
    await expect(page).toHaveURL(/\/matters(\?scope=mine)?$/); // the list opens on the person's own matters (epic #758)
    await expect(toasts(page).first()).toContainText('you no longer see it');
    expect((await admin.get<Json>(`/api/v1/matters/${matter.matterId}`)).isSensitive).toBe(true);
    const p5 = await Api.as(u.people.p5.username);
    expect((await p5.raw('GET', `/api/v1/matters/${matter.matterId}`)).status).toBe(404);
    await p5.dispose();
    await expect(page.getByText(`Mark-${u.tag} matter`)).toHaveCount(0);
    // The holder of Matter.ViewSensitive still sees it, marked.
    const p4 = await asUser(u.people.p4.username);
    await p4.goto(`/matters/${matter.matterId}`);
    await expect(p4.locator('[data-sensitive-banner]')).toContainText('Only its project managers');
    void world;
  });

  test('a sensitive matter needs a project manager unless its creator sees all sensitive matters (400 SENSITIVE_NEEDS_MANAGER)', async ({
    universe: u,
    asUser,
  }) => {
    const page = await asUser(u.people.p5.username);
    await page.goto('/matters/new');
    await page.locator('#matter-client').fill(u.client.clientNumber);
    await page.getByRole('option').first().click();
    await page.locator('#matter-number').fill('00032');
    await page.locator('#matter-name').fill(`Needs-${u.tag} manager`);
    await page.getByRole('checkbox', { name: /Sensitive matter/ }).check();
    await page.getByRole('button', { name: 'Create matter' }).click();
    const error = page.locator('#matter-sensitive-error');
    await expect(error).toContainText('needs a project manager');
    await expect(page.getByRole('checkbox', { name: /Sensitive matter/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(page).toHaveURL(/\/matters\/new/);
    await axeAtEverySize(page, 'new matter with the sensitive refusal');

    // The holder of Matter.ViewSensitive may create it without a manager, and opens it straight away.
    const p4 = await asUser(u.people.p4.username);
    await p4.goto('/matters/new');
    await p4.locator('#matter-client').fill(u.client.clientNumber);
    await p4.getByRole('option').first().click();
    await p4.locator('#matter-number').fill('00033');
    await p4.locator('#matter-name').fill(`Holder-${u.tag} matter`);
    await p4.getByRole('checkbox', { name: /Sensitive matter/ }).check();
    await p4.getByRole('button', { name: 'Create matter' }).click();
    await expect(p4).toHaveURL(/\/matters\/\d+$/);
    await expect(p4.locator('[data-sensitive-banner]')).toBeVisible();
  });

  test('the Roles screen warns that Matter.ViewSensitive shows ALL sensitive matters', async ({
    admin,
    asUser,
    universe: u,
  }) => {
    void admin;
    const page = await asUser('ke\\kekim');
    await page.goto('/admin/roles');
    await page.getByRole('button', { name: 'New role' }).click();
    const warning = page.locator('[data-perm-warning][data-for="Matter.ViewSensitive"]');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('see ALL sensitive matters');
    await expect(page.locator('[data-perm-warning]')).toHaveCount(1);
    await axeAtEverySize(page, 'roles editor with the warning', async () => {
      await warning.scrollIntoViewIfNeeded();
    });
    void u;
  });

  test('the assignee task page, the matter overview note and the Matters list are clean for axe at four widths', async ({
    universe: u,
    asUser,
  }) => {
    const p3 = await asUser(u.people.p3.username);
    await p3.goto(`/tasks/${u.s3.taskId}`);
    await expect(p3.locator('[data-task-header]')).toContainText(u.s3.matterRef);
    await axeAtEverySize(p3, 'assignee task page');
    await p3.goto('/my-work');
    await axeAtEverySize(p3, 'assignee My Work');

    const p4 = await asUser(u.people.p4.username);
    await p4.goto(`/matters/${u.s1.matterId}`);
    await expect(p4.locator('[data-sensitive-banner]')).toBeVisible();
    await axeAtEverySize(p4, 'sensitive matter overview');
    await p4.goto('/matters?scope=all');
    await expect(p4.getByText(u.s1.name).first()).toBeVisible();
    await axeAtEverySize(p4, 'matters list with the sensitive marker');
  });

  test('access ends on the next request: a manager removed and a task reassigned', async ({
    universe: u,
    admin,
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const task = (matterId: number, title: string, assignee?: number) =>
      seed.task(
        { matter: { matterId }, taskType: world.taskType, workflow: world.workflow },
        { title, assignedUserId: assignee },
      );

    // A manager is removed.
    const a = await ownMatter(u, admin, task, '00034', {
      sensitive: true,
      secondary: u.people.p2.userId,
      primary: u.people.p1.userId,
    });
    const p2 = await asUser(u.people.p2.username);
    await p2.goto(`/tasks/${a.task.taskId}`);
    await expect(p2.locator('[data-task-header]')).toContainText(`Own-${u.tag}-00034 task`);
    await p2.getByTestId('notification-bell').click();
    await expect(p2.locator('[data-notification-panel]')).toContainText(
      `Own-${u.tag}-00034 matter`,
    );
    await p2.keyboard.press('Escape');
    const current: Json = await admin.get(`/api/v1/matters/${a.matter.matterId}`);
    await admin.put(`/api/v1/matters/${a.matter.matterId}/managers`, {
      primaryManagerId: u.people.p1.userId,
      secondaryManagerId: null,
      rowVersion: current.rowVersion,
    });
    await p2.reload();
    await expect(p2.locator('[data-record-state="notFound"]')).toBeVisible();
    await expect(p2.getByText(`Own-${u.tag}-00034`)).toHaveCount(0);
    await p2.goto('/tasks');
    await p2.getByTestId('notification-bell').click();
    await expect(p2.locator('[data-notification-panel]')).not.toContainText(`Own-${u.tag}-00034`);
    await p2.keyboard.press('Escape');
    await expect(p2.getByText(`Own-${u.tag}-00034`)).toHaveCount(0);

    // A task is reassigned: the assignee loses the task page the moment it moves to somebody else.
    const b = await ownMatter(u, admin, task, '00035', {
      sensitive: true,
      primary: u.people.p1.userId,
    });
    const first: Json = await admin.post(`/api/v1/tasks/${b.task.taskId}/assignment`, {
      userId: u.people.p3.userId,
      rowVersion: b.task.rowVersion,
    });
    const p3 = await asUser(u.people.p3.username);
    await p3.goto(`/tasks/${b.task.taskId}`);
    await expect(p3.locator('[data-task-header]')).toContainText(`Own-${u.tag}-00035 task`);
    await expect(p3.locator('a[href^="/matters/"]')).toHaveCount(0);
    await admin.post(`/api/v1/tasks/${b.task.taskId}/assignment`, {
      userId: u.people.p5.userId,
      rowVersion: first.rowVersion,
    });
    await p3.reload();
    await expect(p3.locator('[data-record-state="notFound"]')).toBeVisible();
    await expect(p3.getByText(`Own-${u.tag}-00035`)).toHaveCount(0);
  });
});
