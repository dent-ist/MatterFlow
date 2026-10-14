import { TaskDetailPage } from '../pages/task-detail.page';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

test.describe('Linking assets to a task (SCN-016)', () => {
  test('SCN-016: assets of the same matter link with a relationship and can be changed and removed', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const source = await seed.asset(world.matter, `Source set ${uid()}`);
    const target = await seed.asset(world.matter, `Target workspace ${uid()}`);
    const task = await seed.task(world);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showTab('Assets');
    const panel = page.getByRole('region', { name: 'Linked assets' });

    const link = async (displayName: string, relationship: string) => {
      await panel.locator('[data-link-open]').click();
      await panel.getByRole('combobox', { name: 'Asset to link' }).fill(displayName);
      await page.getByRole('option', { name: new RegExp(displayName) }).click();
      await panel.locator('[data-link-role]').selectOption({ label: relationship });
      await panel.locator('[data-link-submit]').click();
      await expect(
        panel.locator(`tr[data-asset-id]`).filter({ hasText: displayName }),
      ).toBeVisible();
    };

    await link(source.displayName, 'Source');
    await link(target.displayName, 'Destination');
    await expect(panel.getByRole('heading', { name: 'Assets (2)' })).toBeVisible();
    await expect(
      panel.locator(`tr[data-asset-id="${source.assetId}"] [data-role-select]`),
    ).toHaveValue(/\d+/);

    await panel
      .locator(`tr[data-asset-id="${target.assetId}"] [data-role-select]`)
      .selectOption({ label: 'Result' });
    await expect
      .poll(async () => {
        const links = await admin.get(`/api/v1/tasks/${task.taskId}/assets`);
        return (links.items ?? links).find((l: { assetId: number }) => l.assetId === target.assetId)
          ?.assetLinkRoleName;
      })
      .toBe('Result');

    await panel.locator(`tr[data-asset-id="${source.assetId}"] [data-unlink]`).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove link' }).click();
    await expect(panel.locator(`tr[data-asset-id="${source.assetId}"]`)).toHaveCount(0);
    await expect(panel.getByRole('heading', { name: 'Assets (1)' })).toBeVisible();
  });

  test('SCN-016: the asset picker never offers assets of another matter', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const other = await seed.matter();
    const mine = await seed.asset(world.matter, `Mine ${uid()}`);
    const foreign = await seed.asset(other, `Foreign ${uid()}`);
    const task = await seed.task(world);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showTab('Assets');
    const panel = page.getByRole('region', { name: 'Linked assets' });
    await panel.locator('[data-link-open]').click();
    const picker = panel.getByRole('combobox', { name: 'Asset to link' });

    await picker.fill(foreign.displayName);
    await expect(
      page.getByRole('listbox').getByText('No assets in this matter match.'),
    ).toBeVisible();
    await expect(page.getByRole('option', { name: new RegExp(foreign.displayName) })).toHaveCount(
      0,
    );

    await picker.fill(mine.displayName);
    await expect(page.getByRole('option', { name: new RegExp(mine.displayName) })).toBeVisible();
  });

  test('SCN-016: the API refuses to link an asset of another matter and keeps the valid links', async ({
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const other = await seed.matter();
    const a1 = await seed.asset(world.matter);
    const a2 = await seed.asset(world.matter);
    const b1 = await seed.asset(other);
    const task = await seed.task(world);

    expect(
      (await admin.raw('POST', `/api/v1/tasks/${task.taskId}/assets`, { assetId: a1.assetId }))
        .status,
    ).toBe(201);
    expect(
      (await admin.raw('POST', `/api/v1/tasks/${task.taskId}/assets`, { assetId: a2.assetId }))
        .status,
    ).toBe(201);
    const rejected = await admin.raw('POST', `/api/v1/tasks/${task.taskId}/assets`, {
      assetId: b1.assetId,
    });
    expect([400, 409]).toContain(rejected.status);
    expect(rejected.body.code).toBe('CROSS_MATTER_REFERENCE');

    const links = await admin.get(`/api/v1/tasks/${task.taskId}/assets`);
    const ids = (links.items ?? links).map((l: { assetId: number }) => l.assetId).sort();
    expect(ids).toEqual([a1.assetId, a2.assetId].sort());
  });

  test('links cannot be changed while the task is closed', async ({ page, seed, admin }) => {
    const world = await seed.world();
    const asset = await seed.asset(world.matter);
    const task = await seed.task(world);
    await admin.post(`/api/v1/tasks/${task.taskId}/assets`, { assetId: asset.assetId });
    await admin.post(`/api/v1/tasks/${task.taskId}/cancel`, {
      rowVersion: task.rowVersion,
      comment: 'Closed for test',
    });

    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showTab('Assets');
    const panel = page.getByRole('region', { name: 'Linked assets' });
    await expect(panel.locator('[data-closed-note]')).toContainText("can't be changed");
    await expect(panel.locator('[data-link-open]')).toHaveCount(0);
    await expect(panel.locator('[data-unlink]')).toHaveCount(0);
  });
});
