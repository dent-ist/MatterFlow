import { Api } from '../support/api';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { expect, test } from '../support/fixtures';
import { openHeaderOptions } from '../support/mm-header';

/**
 * Scope "All matters" and manager assignment (epic #667, #701): the switch exists only for holders of Matter.AssignManagers, re-runs the grid and the
 * counts with scope=all, adds a Project manager filter, searches every matter of the firm in the Matter dropdown (#941), keeps the counts equal to the grid, and
 * links to the Matters list in selection mode ("Set project managers"). A matter nobody manages is listed like any other: no warning.
 */
type Page = import('@playwright/test').Page;
const optionCount = async (page: Page, key: string): Promise<number> => {
  const text = (await page.locator(`option[data-prefilter-option="${key}"]`).textContent()) ?? '';
  const m = /\((\d+)\)\s*$/.exec(text.trim());
  return m ? Number(m[1]) : Number.NaN;
};

test.describe('My Matters: All matters', () => {
  test('the switch re-runs the grid and the counts, the manager filter narrows them, and the numbers equal the grid', async ({
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
    await expect.poll(() => optionCount(page, 'overdue')).toBe(1);
    await expect.poll(() => optionCount(page, 'open')).toBe(1);
    await expect(page.locator('[data-panel=tasks] tr[data-task]')).toHaveCount(1);

    await openHeaderOptions(page);
    await expect(page.locator('[data-scope=mine]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-scope=all]').click();
    await expect(page).toHaveURL(/scope=all/);
    await expect(page.locator('[data-scope=all]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'My Matters', level: 1 })).toBeVisible();
    // The world's own matter (00001, no task), mine, theirs and the orphan: four active matters of this client, four open tasks, three overdue.
    await expect.poll(() => optionCount(page, 'open')).toBe(4);
    expect(await optionCount(page, 'overdue')).toBe(3);
    await expect(page.locator('[data-panel=tasks] tr[data-task]')).toHaveCount(4);
    await expect(
      page.locator('[data-panel=tasks] tr[data-task]', { hasText: 'Scope orphan' }),
    ).toBeVisible();
    await expect(page.locator('main')).not.toContainText(
      /no (project )?manager|unmanaged|not managed/i,
    );
    await expect(page.locator('main')).toContainText('All active matters, whoever manages them');
    // There is no Matters section any more (#945).
    await expect(page.locator('[data-panel=health], [data-all-matters]')).toHaveCount(0);
    // Role does not apply until a manager is named.
    await expect(page.locator('[data-filter=role]')).toHaveCount(0);

    // The counts equal the grid in the All scope.
    for (const key of ['open', 'overdue', 'unassigned']) {
      const [queue] = await Promise.all([
        page.waitForResponse((r) => /\/api\/v1\/task-queue\?/.test(r.url()) && r.ok()),
        page.goto(
          `/my-matters?scope=all&clientId=${clientId}${key === 'open' ? '' : `&show=${key}`}`,
        ),
      ]);
      await expect.poll(() => optionCount(page, key)).not.toBeNaN();
      const n = await optionCount(page, key);
      expect(((await queue.json()) as { total: number }).total, key).toBe(n);
    }

    // The Project manager filter narrows the grid and the counts to that person's matters; the role then applies.
    await page.goto(`/my-matters?scope=all&clientId=${clientId}`);
    await page.getByRole('combobox', { name: 'Project manager' }).fill(w.other.displayName!);
    await page.getByRole('option', { name: w.other.displayName! }).click();
    await expect(page).toHaveURL(new RegExp(`managerId=${w.other.userId}`));
    await expect.poll(() => optionCount(page, 'overdue')).toBe(1);
    await expect.poll(() => optionCount(page, 'open')).toBe(2);
    await expect(page.locator('[data-panel=tasks] tr[data-task]')).toHaveCount(2);
    await expect(page.locator('[data-filter=role]')).toBeVisible();
    // Back to My matters clears the manager and the scope.
    await openHeaderOptions(page);
    await page.locator('[data-scope=mine]').click();
    await expect(page).not.toHaveURL(/scope=all|managerId/);
    await expect.poll(() => optionCount(page, 'overdue')).toBe(1);
  });

  test('in the All scope the Matter dropdown searches every matter on the server and limits the page to the one chosen', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'all2');
    for (let i = 0; i < 3; i++) await w.matter(`Paged ${String(i).padStart(2, '0')}`, null, null);
    const wanted = await w.matter('Needle in the haystack', null, null);
    await w.task(wanted, { dueDate: '2000-01-01', title: 'Needle task' });
    const page = await asUser(w.pm.username);
    await page.goto(`/my-matters?scope=all&clientId=${w.world.client.clientId}`);
    await expect.poll(() => optionCount(page, 'open')).toBe(1);
    await page.locator('#mm-matter').fill('Needle');
    await expect(page.locator('#mm-matter-list [role=option]')).toHaveCount(1);
    await page.locator('#mm-matter-list [role=option]').click();
    await expect(page).toHaveURL(new RegExp(`matterId=${wanted.matterId}`));
    await expect(page.locator('[data-panel=tasks] tr[data-task]')).toHaveCount(1);
    await expect(page.locator('[data-panel=tasks]')).toContainText('Needle task');
    await expect(page.locator('#mm-matter')).toHaveValue(new RegExp('Needle in the haystack'));
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
    await expect(page.locator('[data-no-matters]')).toBeVisible(); // nothing to count: one positive line (#920)
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
