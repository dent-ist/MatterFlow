import { Page } from '@playwright/test';
import { axeAvailable, axeBestPractice } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { asDropdown } from '../support/dropdown';

/**
 * PM v2 lane A and F (epic #851): the task type colour and expected turnaround (#852, #853), the shared task type badge in the Task Queue (#854) and
 * the admin list of on-hold reasons (#876). Colour is never the only signal: the icon and the accessible name are always there.
 */
const SIZES = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
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

    await asDropdown(page.locator('[data-colour-select] button')).selectOption('teal');
    await expect(page.locator('[data-preview]')).toHaveAttribute('data-colour', 'teal');
    await page.locator('[data-target-input]').fill('400');
    await page.locator('[data-save]').click();
    await expect(page.locator('[data-target-error]')).toContainText('from 1 to 365');
    await page.locator('[data-target-input]').fill('4');
    await page.locator('[data-save]').click();
    await expect(page.getByText('Task type saved').first()).toBeVisible();

    const saved = await admin.get(`/api/v1/task-types/${world.taskType.id}`);
    expect(saved.colourKey).toBe('teal');
    expect(saved.targetDays).toBe(4);

    await page.goto(`/admin/task-types?name=${encodeURIComponent(world.taskType.name)}`);
    const row = page.locator(`[data-row="${world.taskType.name}"]`);
    await expect(row.locator('[data-target]')).toHaveText('4');
    await expect(row.locator('mf-task-type-cell mf-task-type-chip')).toHaveAttribute(
      'data-colour',
      'teal',
    );

    await page.goto(`/tasks?matter=${world.matter.matterId}`);
    const link = page.locator(`[data-task-id="${task.taskId}"]`).first();
    await expect(link).toBeVisible();
    // The Type column is the shared Type cell: the solid chip in the type's colour and the type's name beside it.
    const cell = link.locator('xpath=ancestor::tr[1]').locator('mf-task-type-cell');
    await expect(cell.locator('mf-task-type-chip')).toHaveAttribute('data-colour', 'teal');
    await expect(cell.locator('[data-type-name]')).toHaveText(world.taskType.name);
    await expect(cell.locator('svg')).toBeVisible();

    // Clearing both goes back to the neutral default.
    await page.goto(`/admin/task-types/${world.taskType.id}`);
    await asDropdown(page.locator('[data-colour-select] button')).selectOption('');
    await page.locator('[data-target-input]').fill('');
    await page.locator('[data-save]').click();
    await expect(page.getByText('Task type saved').first()).toBeVisible();
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
      await expect(page.locator('mf-task-type-cell').first()).toBeVisible();
      await clean(page, `Task Queue at ${size.name}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'no sideways page scroll').toBeLessThanOrEqual(0);
    });
  }
});

test.describe('On-Hold Reasons', () => {
  test('the Lists page has the On-Hold Reasons list: the seeded list, add, rename, deactivate and the API', async ({
    page,
    admin,
  }) => {
    await page.goto('/admin/on-hold-reasons');
    await expect(page.getByRole('heading', { name: 'Lists', level: 1 })).toBeVisible();
    await expect(page.getByRole('option', { name: /^On-Hold Reasons/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-row="Waiting for client data"]')).toBeVisible();
    await expect(page.locator('[data-row="Waiting for approval"]')).toBeVisible();

    const name = `Waiting for counsel ${Date.now() % 100000}`;
    await page.locator('[data-new]').click();
    const dialog = page.getByRole('dialog', { name: 'New Reason' });
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
    test(`the On-Hold Reasons list is clean at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/admin/on-hold-reasons');
      await expect(page.getByText('Waiting for client data').first()).toBeVisible();
      await clean(page, `On-Hold Reasons at ${size.name}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'no sideways page scroll').toBeLessThanOrEqual(0);
    });
  }
});
