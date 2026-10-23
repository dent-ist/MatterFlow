import { Api } from '../support/api';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { expect, test } from '../support/fixtures';

/**
 * Scope "All matters" and manager assignment (epic #667, #701): the switch exists only for holders of Matter.AssignManagers, re-runs every panel
 * with scope=all, adds a Project manager filter, pages the health table, keeps the strip equal to the lists it opens, and links to the Matters
 * list in selection mode ("Set project managers"). A matter nobody manages is listed like any other: no warning.
 */
const strip = (page: import('@playwright/test').Page, key: string) =>
  page.locator(`[data-strip-item="${key}"] strong`);
const total = async (page: import('@playwright/test').Page): Promise<number> => {
  const text = await page.locator('[data-range]').first().innerText();
  return Number(/of (\d+)/.exec(text)?.[1] ?? -1);
};

test.describe('My Matters: All matters', () => {
  test('the switch re-runs every panel, the manager filter narrows it, and the numbers equal the lists', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'all1');
    const mine = await w.matter('Scope mine');
    const theirs = await w.matter('Scope theirs', w.other, null);
    const orphan = await w.matter('Scope orphan', null, null);
    await w.task(mine, { dueDate: '2000-01-01' });
    await w.task(theirs, { dueDate: '2000-01-01' });
    await w.task(theirs, { dueDate: inDays(2) });
    await w.task(orphan, { dueDate: '2000-01-01' });
    const clientId = w.world.client.clientId;
    const page = await asUser(w.pm.username);
    await page.goto(`/my-matters?clientId=${clientId}`);
    await expect(strip(page, 'matters')).toHaveText('1');
    await expect(strip(page, 'overdue')).toHaveText('1');
    await expect(page.locator('[data-scope=mine]')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('[data-scope=all]').click();
    await expect(page).toHaveURL(/scope=all/);
    await expect(page.locator('[data-scope=all]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'My Matters', level: 1 })).toBeVisible();
    // The world's own matter (00001), mine, theirs and the orphan: four active matters of this client.
    await expect(strip(page, 'matters')).toHaveText('4');
    await expect(page.locator('[data-strip-item="matters"]')).toContainText('Matters');
    await expect(strip(page, 'overdue')).toHaveText('3');
    await expect(strip(page, 'open')).toHaveText('4');
    await expect(page.locator('[data-panel=health] [data-health-row]')).toHaveCount(4);
    await expect(
      page.locator('[data-panel=health] [data-health-row]', { hasText: 'Scope orphan' }),
    ).toBeVisible();
    await expect(page.locator('main')).not.toContainText(
      /no (project )?manager|unmanaged|not managed/i,
    );
    await expect(page.locator('[data-strip]')).toHaveAttribute('aria-label', /all matters/);
    await expect(page.locator('main')).toContainText('All active matters, whoever manages them');
    // Role does not apply until a manager is named.
    await expect(page.locator('[data-filter=role]')).toHaveCount(0);

    // The strip equals the lists it opens in the All scope.
    for (const key of ['open', 'overdue', 'unassigned', 'matters']) {
      await page.goto(`/my-matters?scope=all&clientId=${clientId}`);
      await expect(strip(page, key)).not.toHaveText('--');
      const n = Number(await strip(page, key).innerText());
      await page.locator(`[data-strip-item="${key}"]`).click();
      await expect.poll(() => total(page), { message: key }).toBe(n);
    }

    // The Project manager filter narrows every panel to that person's matters; the role then applies.
    await page.goto(`/my-matters?scope=all&clientId=${clientId}`);
    await page.getByRole('combobox', { name: 'Project manager' }).fill(w.other.displayName!);
    await page.getByRole('option', { name: w.other.displayName! }).click();
    await expect(page).toHaveURL(new RegExp(`managerId=${w.other.userId}`));
    await expect(strip(page, 'matters')).toHaveText('1');
    await expect(strip(page, 'overdue')).toHaveText('1');
    await expect(page.locator('[data-panel=health] [data-health-row]')).toHaveCount(1);
    await expect(page.locator('[data-strip]')).toHaveAttribute('aria-label', /project manager/);
    await expect(page.locator('[data-filter=role]')).toBeVisible();
    await page.locator('[data-strip-item="matters"]').click();
    await expect(page).toHaveURL(/\/matters\?/);
    await expect.poll(() => total(page)).toBe(1);
    // Back to My matters clears the manager and the scope.
    await page.goBack();
    await page.locator('[data-scope=mine]').click();
    await expect(page).not.toHaveURL(/scope=all|managerId/);
    await expect(strip(page, 'matters')).toHaveText('1');
  });

  test('the health table pages in the All scope', async ({ seed, personas, asUser }) => {
    test.setTimeout(240_000);
    const w = await mmWorld(seed, personas, 'all2');
    for (let i = 0; i < 52; i++) await w.matter(`Paged ${String(i).padStart(2, '0')}`, null, null);
    const page = await asUser(w.pm.username);
    await page.goto(`/my-matters?scope=all&clientId=${w.world.client.clientId}&sort=matter`);
    await expect(page.locator('[data-panel=health] [data-health-row]')).toHaveCount(50);
    await expect(page.locator('[data-panel=health] [data-page]')).toContainText('Page 1 of 2');
    await page
      .locator('[data-panel=health]')
      .getByRole('button', { name: 'Next', exact: true })
      .click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('[data-panel=health] [data-health-row]')).toHaveCount(3); // 52 + the world's own matter
    await page.goBack();
    await expect(page.locator('[data-panel=health] [data-health-row]')).toHaveCount(50);
  });

  test('Set project managers opens the Matters list in selection mode', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'all3');
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters?scope=all');
    await page.locator('[data-set-managers]').click();
    await expect(page).toHaveURL(/\/matters/);
    await expect(page.locator('[data-selection-bar]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set project managers' })).toBeVisible();
  });

  test('a manager without Matter.AssignManagers has no switch, the address cannot force it, and the API answers 403', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'all4');
    const m = await w.matter('Plain mine');
    await w.task(m, { dueDate: '2000-01-01' });
    const plain = await personas.create({
      label: 'all4-plain',
      permissions: ['Client.View', 'Matter.View', 'Matter.BeManager', 'Task.View', 'Task.Create'],
    });
    const page = await asUser(plain.username);
    const forbidden: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/v1/my-matters') && r.status() >= 400)
        forbidden.push(`${r.status()} ${r.url()}`);
    });
    await page.goto('/my-matters?scope=all&managerId=1');
    await expect(page.getByRole('heading', { name: 'My Matters', level: 1 })).toBeVisible();
    await expect(page.locator('[data-scope]')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Project manager' })).toHaveCount(0);
    await expect(page.locator('[data-set-managers]')).toHaveCount(0);
    await expect(strip(page, 'matters')).toHaveText('0');
    expect(forbidden).toEqual([]);
    const api = await Api.as(plain.username);
    for (const path of ['scope=all', 'scope=mine&managerId=1']) {
      const r = await api.raw('GET', `/api/v1/my-matters/summary?${path}`);
      expect(r.status, path).toBeGreaterThanOrEqual(400);
    }
    const denied = await api.raw('GET', '/api/v1/my-matters/summary?scope=all');
    expect(denied.status).toBe(403);
    await api.dispose();
  });
});
