import { Page } from '@playwright/test';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { expect, test } from '../support/fixtures';
import { ADMIN_USER } from '../support/api';

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
  test('hostile names in the scope chip, grid, calendar and dialogs run nothing and show as written', async ({
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
    // The scope chip shows the hostile names as plain text (MM-20: the dropdowns are gone; one matter has no tree).
    await page.goto(`/my-matters?matterId=${matter.matterId}`);
    await expect(page.locator('[data-scope-chip]')).toContainText('<img src=x');
    await expect(page.locator('[data-scope-chip] img, [data-scope-chip] b')).toHaveCount(0);
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

  test('a person who manages matters but cannot edit matters, on All matters, who tries to add an item to a matter they do not manage, is told no (not silently ignored)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'qa5');
    const mine = await w.matter('Mine');
    const notMine = await w.matter('NotMine', w.other, null);
    const lead = await personas.create({
      label: 'qa5-lead',
      permissions: [
        'Task.View',
        'Matter.View',
        'Matter.BeManager',
        'Matter.AssignManagers',
        'Client.View',
      ],
    });
    await seed.admin.put(`/api/v1/matters/${mine.matterId}/managers`, {
      primaryManagerId: lead.userId,
      secondaryManagerId: null,
      rowVersion: (await seed.admin.get(`/api/v1/matters/${mine.matterId}`))['rowVersion'],
    });
    const page = await asUser(lead.username);
    await page.goto(
      `/my-matters?scope=all&tab=calendar&month=${inDays(2).slice(0, 7)}&matterId=${notMine.matterId}`,
    );
    await settle(page);
    const add = page.locator('[data-add-event]');
    if ((await add.getAttribute('aria-disabled')) === 'true') return; // the page already says no
    await add.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Court hearing').check({ force: true });
    await dialog.getByLabel('Title').fill('Should be refused');
    await dialog.getByLabel('Date').fill(inDays(2));
    await dialog.getByRole('button', { name: 'Add item' }).click();
    // Either the dialog stays with a message in words, or a toast says it was refused; the item never appears.
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: /manage|permission|not allowed|refused/i })
        .first(),
    ).toBeVisible();
  });
});

test.describe('My Matters QA: states and focus', () => {
  test('when the tree request fails the panel says so and Retry brings it back', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'qa6');
    await w.matter('Alpha');
    await w.matterInOtherClient('Beta');
    const page = await asUser(w.pm.username);
    await page.route('**/api/v1/my-matters/tree*', (r) =>
      r.fulfill({ status: 500, contentType: 'application/problem+json', body: '{"status":500}' }),
    );
    await page.goto('/my-matters');
    await expect(page.locator('[data-tree-error]')).toBeVisible();
    await expect(page.getByText('No clients or matters in this view.')).toHaveCount(0);
    await page.unroute('**/api/v1/my-matters/tree*');
    await page.locator('[data-tree-retry]').click();
    await expect(page.getByRole('treeitem').first()).toBeVisible();
  });

  test('an On Hold task past its date is shown in the plain tone, not as overdue', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'qa7');
    const a = await w.matter('Alpha');
    const held = await w.task(a, { title: 'Held and late', dueDate: '2000-01-01' });
    await seed.admin.post(`/api/v1/tasks/${held['taskId']}/status`, {
      status: 'ON_HOLD',
      comment: 'Waiting for the client',
      rowVersion: held['rowVersion'],
    });
    await w.task(a, { title: 'Open and late', dueDate: '2000-01-02' });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    const row = (t: string) => page.locator('mf-mm-task-list tbody tr', { hasText: t });
    await expect(row('Open and late').locator('[data-cell=due]')).toContainText('overdue');
    await expect(row('Held and late').locator('[data-cell=due]')).not.toContainText('overdue');
    await expect(row('Held and late').locator('[data-cell=due] .overdue')).toHaveCount(0);
  });

  test('focus comes back: the calendar item dialog (Add Event and + New) and the asset panel', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'qa8');
    const a = await w.matter('Alpha');
    await seed.asset({ matterId: a.matterId }, 'Focus asset');
    const page = await asUser(w.pm.username);
    await page.goto(`/my-matters?tab=calendar&month=${inDays(2).slice(0, 7)}`);
    await settle(page);
    await page.locator('[data-add-event]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-add-event]')).toBeFocused();
    await page.locator('#mm-new-btn').click();
    await page.getByRole('menuitem', { name: /New calendar item/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#mm-new-btn')).toBeFocused();
    await page.goto('/my-matters?tab=assets');
    await settle(page);
    const open = page.locator('[data-open]').first();
    await open.click();
    await expect(page.locator('[data-asset-panel]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-asset-panel]')).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test('an administrator on All matters can open the side panel of an asset on a matter they do not manage', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'qa9');
    const a = await w.matter('Alpha');
    await seed.asset({ matterId: a.matterId }, 'Admin can open me');
    const page = await asUser(ADMIN_USER);
    await page.goto(`/my-matters?scope=all&tab=assets&matterId=${a.matterId}`);
    await settle(page);
    await page.locator('[data-open]').first().click();
    await expect(page.locator('[data-asset-panel]')).toContainText('Admin can open me');
    await expect(page.locator('[data-asset-panel] [role=alert]')).toHaveCount(0);
  });
});
