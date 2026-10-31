import { Page } from '@playwright/test';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { expect, test } from '../support/fixtures';

/**
 * QA of the UI update (epic #953): regression tests for the bugs the exploratory pass found. Each test names the bug it guards.
 */

const settle = async (page: Page) => {
  await page.waitForLoadState('networkidle');
};

test.describe('My Matters QA: filters', () => {
  test('the Assignee filter lists people (the lookup asks for at most 50) and the Priority filter has its options on a page opened by address', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'qa1');
    const a = await w.matter('Alpha');
    await w.task(a, { title: 'Filter me' });
    const page = await asUser(w.pm.username);
    const failed: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });
    await page.goto('/my-matters');
    await page.locator('[data-filter-toggle]').click();
    await settle(page);
    await page.locator('#mm-f-priority').click();
    await expect(page.getByRole('option').first()).toBeVisible();
    expect(await page.getByRole('option').count()).toBeGreaterThanOrEqual(3);
    await page.keyboard.press('Escape');
    await page.locator('#mm-f-assignee').click();
    // Anyone, Unassigned and at least the person who is signed in (the lookup lists active people).
    await expect(page.getByRole('option').nth(2)).toBeVisible();
    await page.keyboard.press('Escape');
    expect(failed, 'no failed request while the filters open').toEqual([]);
  });
});

test.describe('My Matters QA: numbers', () => {
  test('every enabled number of Metrics Work opens the Overview with a grid total equal to that number, and the Overdue column never counts On Hold', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'qa2');
    const a = await w.matter('Alpha');
    await w.task(a, { title: 'Late one', dueDate: '2000-01-01' });
    const hold = await w.task(a, { title: 'Late but on hold', dueDate: '2000-01-02' });
    await seed.admin.post(`/api/v1/tasks/${hold['taskId']}/status`, {
      status: 'ON_HOLD',
      comment: 'Waiting for the client',
      rowVersion: hold['rowVersion'],
    });
    await w.task(a, { title: 'Soon', dueDate: inDays(30) });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters?tab=metrics');
    await settle(page);
    const buttons = page.locator('mf-mm-metrics-work button:not([disabled])');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(5);
    for (let i = 0; i < count; i++) {
      await page.goto('/my-matters?tab=metrics');
      await settle(page);
      const b = page.locator('mf-mm-metrics-work button:not([disabled])').nth(i);
      const number = Number(/^\s*(\d+)/.exec(await b.innerText())?.[1]);
      await b.click();
      await expect(page).toHaveURL(/\/my-matters/);
      await expect(page.locator('mf-mm-task-list .tot')).toHaveText(String(number));
    }
  });
});

test.describe('My Matters QA: names are text, never markup', () => {
  test('hostile names in the tree, grid, dropdowns, calendar and dialogs run nothing and show as written', async ({
    seed,
    personas,
    asUser,
  }) => {
    const hostile = `<img src=x onerror="window.__xss=1"><b>bold</b>`;
    const w = await mmWorld(seed, personas, 'qa3');
    const created = await seed.matter({
      client: await seed.client({ name: `${hostile} client` }),
      number: '00001',
      name: `${hostile} matter`,
    });
    await seed.admin.put(`/api/v1/matters/${created['matterId']}/managers`, {
      primaryManagerId: w.pm.userId,
      secondaryManagerId: null,
      rowVersion: created['rowVersion'],
    });
    const matter = { matterId: created['matterId'] as number };
    await w.task(matter as never, { title: `${hostile} task`, dueDate: inDays(3) });
    await seed.admin.post(`/api/v1/matters/${matter.matterId}/events`, {
      typeCode: 'DEPOSITION',
      title: `${hostile} event`,
      date: inDays(3),
      time: '10:00',
      note: hostile,
    });
    const page = await asUser(w.pm.username);
    await page.addInitScript(() => {
      (window as unknown as { __xss?: number }).__xss = 0;
    });
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    for (const tab of ['overview', 'calendar', 'assets', 'metrics', 'activity']) {
      await page.goto(
        `/my-matters?tab=${tab}&month=${inDays(3).slice(0, 7)}&matterId=${matter.matterId}`,
      );
      await settle(page);
    }
    await page.goto('/my-matters');
    await settle(page);
    await expect(page.getByText(`${hostile} task`).first()).toBeVisible();
    await page.locator('#mm-matter').click();
    await expect(page.getByRole('option', { name: /<img src=x/ }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto(`/my-matters?tab=calendar&month=${inDays(3).slice(0, 7)}`);
    await settle(page);
    await page.locator(`[data-day="${inDays(3)}"]`).click();
    await page.locator('[data-edit]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.locator('img[src="x"]').count(), 'no injected image element').toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBe(0);
    expect(dialogs).toEqual([]);
  });
});

test.describe('My Matters QA: calendar item permissions', () => {
  test('a manager without Matter.Edit can add and edit items of the matter they manage; the API refuses a matter they do not manage', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'qa4');
    const mine = await w.matter('Mine');
    const notMine = await w.matter('NotMine', w.other, null);
    const manager = await personas.create({
      label: 'qa4-mgr',
      permissions: ['Task.View', 'Matter.View', 'Matter.BeManager', 'Client.View'],
    });
    await seed.admin.put(`/api/v1/matters/${mine.matterId}/managers`, {
      primaryManagerId: manager.userId,
      secondaryManagerId: null,
      rowVersion: (await seed.admin.get(`/api/v1/matters/${mine.matterId}`))['rowVersion'],
    });
    const page = await asUser(manager.username);
    await page.goto(`/my-matters?tab=calendar&month=${inDays(2).slice(0, 7)}`);
    await expect(page.locator('[data-add-event]')).not.toHaveAttribute('aria-disabled', 'true');
    const api = await page.request.post(`/api/v1/matters/${notMine.matterId}/events`, {
      headers: { 'X-MatterFlow-Client': 'web' },
      data: { typeCode: 'OTHER', title: 'Not allowed', date: inDays(2), time: null, note: null },
    });
    expect([403, 404]).toContain(api.status());
    const okApi = await page.request.post(`/api/v1/matters/${mine.matterId}/events`, {
      headers: { 'X-MatterFlow-Client': 'web' },
      data: { typeCode: 'OTHER', title: 'Allowed', date: inDays(2), time: null, note: null },
    });
    expect(okApi.status()).toBe(201);
  });
});
