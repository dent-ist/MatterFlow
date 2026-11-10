import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { expect, test } from '../support/fixtures';

/**
 * Issue #979: coverage that was lost when the old My Matters specs were retired, for what the current page still has. Three small specs:
 * the Metrics Data view drill-down (a number opens the Assets list for that matter, asset type and state), the calendar day cap ("+2 more" after three
 * items, the day panel lists all), and the unread count with Mark All as Read of the Activity tab. The other two listed gaps do not exist on the page any
 * more: the Overview rows have no "Add comment" or bulk re-assign (a row only opens its task), and a sensitive matter's events are covered by the API leak
 * scan (`sensitive-leak-scan.spec.ts`), which also walks the Data view.
 */
test.describe('My Matters coverage (#979)', () => {
  test('Metrics > Data: the view is in the address, and the number of an asset type opens the Assets list of that matter', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'cv1');
    const a = await w.matter('Alpha');
    await seed.asset({ matterId: a.matterId }, 'Drill asset one');
    await seed.asset({ matterId: a.matterId }, 'Drill asset two');
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters?tab=metrics');
    await page.locator('[data-view="data"]').click();
    await expect(page).toHaveURL(/mview=data/);
    await expect(page.locator('[data-view="data"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-tiles]')).toBeVisible();
    const row = page.locator('[data-type-row]').first();
    await expect(row).toBeVisible();
    const total = row.locator('td.num a').first();
    const count = Number((await total.innerText()).replace(/\D/g, ''));
    expect(count).toBeGreaterThanOrEqual(2);
    await total.click();
    await expect(page).toHaveURL(/\/assets\?/);
    await expect(page.getByRole('heading', { name: 'Assets', level: 1 })).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: 'Drill asset one' })).toHaveCount(1);
  });

  test('Calendar: a day with more than three items shows three and "+2 more", its label counts all five, and the day panel lists every one', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'cv2');
    const a = await w.matter('Alpha');
    // The calendar shows events and Critical tasks by default; `shows=all` is "All task due dates" of the Shows menu.
    const day = inDays(9);
    for (let i = 1; i <= 5; i++) await w.task(a, { title: `Capped ${i}`, dueDate: day });
    const page = await asUser(w.pm.username);
    await page.goto(
      `/my-matters?tab=calendar&shows=all&month=${day.slice(0, 7)}&matterId=${a.matterId}`,
    );
    const cell = page.locator(`[data-day="${day}"]`);
    await expect(cell).toHaveAttribute('aria-label', /5 tasks due/);
    await expect(cell.locator('.evline')).toHaveCount(3);
    await expect(cell.locator('.more')).toHaveText('+2 more');
    await cell.click();
    const panel = page.getByRole('dialog').filter({ hasText: 'Tasks Due' });
    await expect(panel.locator('li')).toHaveCount(5);
    await expect(panel).toContainText('Capped 5');
  });

  test('Activity: somebody else’s comment is unread until Mark All as Read, which empties the count and survives a reload', async ({
    seed,
    personas,
    asUser,
    admin,
  }) => {
    const w = await mmWorld(seed, personas, 'cv3');
    const a = await w.matter('Alpha');
    const task = await w.task(a, { title: 'Commented on', dueDate: '2000-01-01' });
    const page = await asUser(w.pm.username);
    // The first visit sets the marker: nothing is unread yet.
    await page.goto('/my-matters?tab=activity');
    await expect(page.locator('mf-mm-activity-tab a[data-feed]').first()).toBeVisible();
    await expect(page.locator('[data-unread]')).toHaveCount(0);
    await admin.post(`/api/v1/tasks/${task['taskId']}/comments`, {
      bodyHtml: '<p>A comment by somebody else</p>',
    });
    await page.reload();
    await expect(page.locator('[data-unread]')).toHaveText(/1 unread/);
    await expect(page.locator('tr.unread')).toHaveCount(1);
    await page.locator('[data-unread-only]').check();
    await expect(page.locator('mf-mm-activity-tab tbody tr')).toHaveCount(1);
    await page.locator('[data-unread-only]').uncheck();
    await page.locator('[data-mark-read]').click();
    await expect(page.locator('[data-unread]')).toHaveCount(0);
    await expect(page.locator('tr.unread')).toHaveCount(0);
    await expect(page.locator('[data-mark-read]')).toHaveAttribute('aria-disabled', 'true');
    await page.reload();
    await expect(page.locator('mf-mm-activity-tab a[data-feed]').first()).toBeVisible();
    await expect(page.locator('[data-unread]')).toHaveCount(0);
  });
});
