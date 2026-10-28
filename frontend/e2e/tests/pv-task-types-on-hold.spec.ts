import { Page } from '@playwright/test';
import { mmWorld } from '../support/my-matters-fixtures';
import { axeAvailable, axeBestPractice } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * PM v2 lane A and F (epic #851): the task type colour and expected turnaround (#852, #853), the shared task type badge in the Task Queue (#854) and
 * the admin list of on-hold reasons (#876). Colour is never the only signal: the icon and the accessible name are always there.
 */
const SIZES = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

async function clean(page: Page, what: string): Promise<void> {
  if (!axeAvailable()) return;
  const violations = await axeBestPractice(page);
  expect(
    violations.map((v) => `${v.id}: ${v.help} ${JSON.stringify(v.nodes.map((n) => n.target))}`),
    what,
  ).toEqual([]);
}

test.describe('Task type colour, target and the badge', () => {
  test('an admin sets colour and turnaround; the list, the Task Queue and the API show them', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    await page.goto(`/admin/task-types/${world.taskType.id}`);
    await expect(page.getByRole('heading', { name: world.taskType.name, level: 1 })).toBeVisible();

    await page.locator('[data-colour-select]').selectOption('teal');
    await expect(page.locator('[data-preview]')).toHaveAttribute('data-colour', 'teal');
    await page.locator('[data-target-input]').fill('400');
    await page.locator('[data-save]').click();
    await expect(page.locator('[data-target-error]')).toContainText('from 1 to 365');
    await page.locator('[data-target-input]').fill('4');
    await page.locator('[data-save]').click();
    await expect(page.getByText('Saved.').first()).toBeVisible();

    const saved = await admin.get(`/api/v1/task-types/${world.taskType.id}`);
    expect(saved.colourKey).toBe('teal');
    expect(saved.targetDays).toBe(4);

    await page.goto(`/admin/task-types?name=${encodeURIComponent(world.taskType.name)}`);
    const row = page.locator(`[data-row="${world.taskType.name}"]`);
    await expect(row.locator('[data-target]')).toHaveText('4');
    await expect(row.locator('mf-task-type-badge')).toHaveAttribute('data-colour', 'teal');

    await page.goto(`/tasks?matter=${world.matter.matterId}`);
    const link = page.locator(`[data-task-id="${task.taskId}"]`).first();
    await expect(link).toBeVisible();
    const badge = link.locator('xpath=ancestor::tr[1]').locator('mf-task-type-badge');
    await expect(badge).toHaveAttribute('data-colour', 'teal');
    await expect(badge.locator('[role="img"]')).toHaveAttribute(
      'aria-label',
      `Task type: ${world.taskType.name}`,
    );
    await expect(badge.locator('svg')).toBeVisible();
    // The link is described by the badge, so a keyboard or screen reader user hears the type.
    const describedBy = await link.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toHaveText(`Task type: ${world.taskType.name}`);

    // Clearing both goes back to the neutral default.
    await page.goto(`/admin/task-types/${world.taskType.id}`);
    await page.locator('[data-colour-select]').selectOption('');
    await page.locator('[data-target-input]').fill('');
    await page.locator('[data-save]').click();
    await expect(page.getByText('Saved.').first()).toBeVisible();
    const cleared = await admin.get(`/api/v1/task-types/${world.taskType.id}`);
    expect(cleared.colourKey ?? null).toBeNull();
    expect(cleared.targetDays ?? null).toBeNull();
  });

  for (const size of SIZES) {
    test(`the Task Type page and the Task Queue are clean at ${size.name}`, async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      const world = await seed.world();
      await seed.task(world);
      await page.goto(`/admin/task-types/${world.taskType.id}`);
      await expect(page.locator('[data-colour-select]')).toBeVisible();
      await clean(page, `Task Type page at ${size.name}`);
      await page.goto(`/tasks?matter=${world.matter.matterId}`);
      await expect(page.locator('mf-task-type-badge').first()).toBeVisible();
      await clean(page, `Task Queue at ${size.name}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'no sideways page scroll').toBeLessThanOrEqual(0);
    });
  }
});

test.describe('On-hold reasons', () => {
  test('the Labels page has the On-hold reasons tab: the seeded list, add, rename, deactivate and the API', async ({
    page,
    admin,
  }) => {
    await page.goto('/admin/on-hold-reasons');
    await expect(page.getByRole('heading', { name: 'Labels', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: /On-hold reasons/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-row="Waiting for client data"]')).toBeVisible();
    await expect(page.locator('[data-row="Waiting for approval"]')).toBeVisible();

    const name = `Waiting for counsel ${Date.now() % 100000}`;
    await page.locator('[data-new]').click();
    const dialog = page.getByRole('dialog', { name: 'New reason' });
    await dialog.locator('#on-hold-reason-name').fill(name);
    await dialog.getByRole('button', { name: 'Add reason' }).click();
    await expect(page.locator(`[data-row="${name}"]`)).toBeVisible();

    // A used reason is deactivated, never deleted: there is no Delete in the menu.
    const row = page.locator(`[data-row="${name}"]`);
    await row.locator('button[data-overflow]').click();
    await expect(row.locator('[data-action="delete"]')).toHaveCount(0);
    await row.locator('[data-action="deactivate"]').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Deactivate reason' }).click();
    await expect(row).toContainText('Inactive');

    const list = await admin.get('/api/v1/on-hold-reasons');
    const mine = list.find((r: { name: string }) => r.name === name);
    expect(mine?.isActive).toBe(false);
  });

  for (const size of SIZES) {
    test(`the On-hold reasons tab is clean at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/admin/on-hold-reasons');
      await expect(page.getByText('Waiting for client data').first()).toBeVisible();
      await clean(page, `On-hold reasons at ${size.name}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'no sideways page scroll').toBeLessThanOrEqual(0);
    });
  }
});

test.describe('My Matters section toolbar (#857)', () => {
  test('filter by task type, the choice is remembered, and the page stays clean at four sizes', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'tb');
    const second = await seed.taskType({ workflows: [w.world.workflow] });
    const a = await w.matter('Alpha');
    await w.task(a, { dueDate: '2000-01-01' });
    await w.task(a, { dueDate: '2000-01-02' });
    await w.task(a, { dueDate: '2000-01-03', taskTypeId: second.id });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    const rows = page.locator('[data-panel="attention"] [data-attention-row]');
    await expect(rows).toHaveCount(3);
    await page.locator('[data-types-trigger]').first().click();
    await page.locator(`[data-type-option="${second.id}"]`).first().check();
    await expect(rows).toHaveCount(1);
    await expect(page.locator('[data-chip]').first()).toContainText(second.name);
    await page.reload();
    await expect(rows).toHaveCount(1);
    await page.locator('[data-clear-all]').first().click();
    await expect(rows).toHaveCount(3);
    // The ranked list has no sort of its own: the ranking is the order (#905).
    await expect(page.locator('[data-panel="attention"] [data-sort]')).toHaveCount(0);
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      await expect(rows.first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, `no sideways scroll at ${size.name}`).toBe(false);
      await clean(page, `My Matters toolbar at ${size.name}`);
    }
  });
});
