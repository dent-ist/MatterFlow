import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Clients UX epic, WP6 (#260 mf-work-strip link mode and Task Queue scope links, #261 Client Overview, #262 tab counts).
 *
 * One client with two busy matters and one empty matter, seeded so the numbers are known without asking the API:
 *   matter A: 2 open with a far due date, 2 overdue, 1 ASAP (no due date), 1 due tomorrow, 1 on hold (due in 20 days), 1 completed
 *   matter B: 1 open with a far due date, 1 overdue
 *   matter C: nothing
 * so the client has Open 9, Overdue 3, Due soon 1, ASAP 1, On hold 1 and two matters with open tasks (A: 7 open / 2 overdue, B: 2 / 1).
 *
 * The consistency check follows each strip link into the Task Queue and compares the number in the strip with the grid total there, for
 * three people with different permissions. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/clients-review/fixes/wp6).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

const KEYS = ['open', 'overdue', 'dueSoon', 'asap', 'onHold'] as const;
const VIEW_OF: Record<string, string | null> = {
  open: null, // All open is matched exactly only (#221); a scoped link shows its filters as chips
  overdue: 'overdue',
  dueSoon: 'dueSoon',
  asap: 'asap',
  onHold: 'onHold',
};

interface Data {
  client: Json;
  matters: Json[];
  empty: Json;
  inactive: Json;
  many: Json;
}
let data: Data;

const day = (offset: number) => dateInZone(FIRM_ZONE, offset);

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const e = document.scrollingElement!;
    return { sw: e.scrollWidth, cw: e.clientWidth };
  });
  expect(m.sw, 'page scrolls sideways').toBeLessThanOrEqual(m.cw);
}

/** The five numbers of the strip, in the order shown; null when the strip is absent. */
async function stripNumbers(page: Page): Promise<Record<string, number> | null> {
  const strip = page.locator('[data-client-overview] [data-strip]');
  if ((await strip.count()) === 0) return null;
  const out: Record<string, number> = {};
  for (const key of KEYS) {
    const text = await strip.locator(`[data-strip-item="${key}"] .n`).textContent();
    out[key] = Number(text);
  }
  return out;
}

/** The total the Task Queue's pager reports ("Showing 1-25 of 9", "Showing 0 of 0"). */
async function queueTotal(page: Page): Promise<number> {
  const pager = page.getByRole('navigation', { name: 'Pagination' });
  await expect(pager).toContainText(/of [\d,]+/);
  const text = (await pager.textContent()) ?? '';
  return Number(text.match(/of ([\d,]+)/)![1].replace(/,/g, ''));
}

/** Seeds a task in a matter of the client's world with a due date (days from today, null = ASAP). */
async function task(
  seed: Seeder,
  world: { taskType: Json; workflow: Json },
  matter: Json,
  due: number | null,
  title: string,
): Promise<Json> {
  return seed.task({ matter, taskType: world.taskType, workflow: world.workflow } as never, {
    title: `${title} ${uid()}`,
    ...(due === null ? {} : { dueDate: day(due) }),
  });
}

test.beforeAll(async ({ seed }: { seed: Seeder }) => {
  const world = await seed.world({ stepCount: 1 });
  const client = world.client;
  const a = world.matter;
  const b = await seed.matter({ client, number: '00002', name: `Second Request ${uid()}` });
  const c = await seed.matter({ client, number: '00003', name: `No work yet ${uid()}` });
  await task(seed, world, a, 10, 'A far 1');
  await task(seed, world, a, 10, 'A far 2');
  await task(seed, world, a, -3, 'A late 1');
  await task(seed, world, a, -5, 'A late 2');
  await task(seed, world, a, null, 'A asap');
  await task(seed, world, a, 1, 'A soon');
  const held = await task(seed, world, a, 20, 'A held');
  expect(
    (await new TaskApi(seed.admin, held.taskId).changeStatus('ON_HOLD', 'Waiting')).status,
  ).toBe(200);
  const done = await task(seed, world, a, 5, 'A done');
  const doneApi = new TaskApi(seed.admin, done.taskId);
  await doneApi.completeSteps(1);
  expect((await doneApi.complete()).status).toBe(200);
  await task(seed, world, b, 10, 'B far');
  await task(seed, world, b, -2, 'B late');

  const empty = await seed.client({ name: `Fresh client ${uid()}` });
  const inactive = await seed.client({ name: `Dormant ${uid()}` });
  await seed.admin.put(`/api/v1/clients/${inactive.clientId}`, {
    name: inactive.name,
    isActive: false,
    rowVersion: inactive.rowVersion,
  });
  const many = await seed.client({ name: `Many matters ${uid()}` });
  for (let start = 1; start <= 63; start += 9) {
    await Promise.all(
      Array.from({ length: Math.min(9, 64 - start) }, (_, i) =>
        seed.matter({
          client: many,
          number: String(start + i).padStart(5, '0'),
          name: `Bulk matter ${start + i}`,
        }),
      ),
    );
  }
  data = { client, matters: [a, b, c], empty, inactive: { ...inactive, isActive: false }, many };
});

const url = (client: Json, tab?: string) =>
  `/clients/${client.clientId}${tab ? `?tab=${tab}` : ''}`;

test.describe('WP6: Client Overview (#261) and tab counts (#262)', () => {
  test('shows the strip, the matters with the most open tasks and no duplicated rows', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(url(data.client));
    const overview = page.locator('[data-client-overview]');
    await expect(overview.locator('[data-strip]')).toBeVisible();

    expect(await stripNumbers(page)).toEqual({
      open: 9,
      overdue: 3,
      dueSoon: 1,
      asap: 1,
      onHold: 1,
    });
    // The order of the strip is the Dashboard's.
    expect(
      await overview
        .locator('[data-strip-item]')
        .evaluateAll((e) => e.map((x) => x.textContent!.replace(/\s+/g, ' ').trim())),
    ).toEqual(['Open 9', 'Overdue 3', 'Due soon 1', 'ASAP 1', 'On hold 1']);
    // Overdue keeps the word and the icon, not only the colour.
    await expect(overview.locator('[data-strip-item="overdue"] .pi')).toBeVisible();

    // The two matters with open tasks, most first; the empty matter is not listed.
    const rows = overview.locator('[data-top-matters] tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(
      `${data.client.clientNumber}-${data.matters[0].matterNumber}`,
    );
    await expect(rows.nth(0).locator('td').nth(2)).toHaveText('7');
    await expect(rows.nth(0).locator('td').nth(3)).toContainText('2 overdue');
    await expect(rows.nth(1).locator('td').nth(2)).toHaveText('2');
    await expect(rows.nth(1).locator('td').nth(3)).toContainText('1 overdue');
    await expect(overview.locator('[data-view-all]')).toHaveText('View all 3 matters');

    // Number, name and status are in the header only; the old rows are gone.
    await expect(overview.locator('dl')).toHaveCount(0);
    await expect(overview.getByText('Client number')).toHaveCount(0);
    await expect(overview.locator('[data-created-line]')).toContainText(
      /^\s*Created [A-Z][a-z]{2} \d{1,2}, \d{4}/,
    );

    await expect(page.getByRole('tab')).toHaveText(['Overview', 'Matters (3)']);
    await expect(page).toHaveTitle(/Overview - MatterFlow$/);
    await shot(page, 'client-overview');
  });

  test('a reference opens the matter and View all opens the Matters tab; ?tab=details still works', async ({
    page,
  }) => {
    await page.goto(url(data.client, 'details'));
    await expect(page.getByRole('tab', { name: /Overview/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.locator('[data-view-all]').click();
    await expect(page).toHaveURL(/tab=matters/);
    await expect(page.getByRole('tab', { name: /Matters/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('tab', { name: 'Overview' }).click();
    expect(new URL(page.url()).searchParams.has('tab')).toBe(false);
    await page.locator('[data-top-matters] tbody tr').first().getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/matters/${data.matters[0].matterId}$`));
  });

  test('the Matters tab label equals the grid total, and refreshes when a matter is added', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Label client ${uid()}` });
    await page.goto(url(client));
    await expect(page.getByRole('tab', { name: /Matters/ })).toHaveText('Matters (0)');
    await expect(page.locator('[data-no-matters]')).toContainText('No matters yet.');
    await expect(page.locator('[data-no-matters] [data-new-matter]')).toBeVisible();
    await seed.matter({ client, number: '00001', name: 'First' });
    await seed.matter({ client, number: '00002', name: 'Second' });
    await page.reload();
    await expect(page.getByRole('tab', { name: /Matters/ })).toHaveText('Matters (2)');
    await expect(page.getByRole('tab', { name: /Matters/ })).toHaveAccessibleName('Matters, 2');
    await page.getByRole('tab', { name: /Matters/ }).click();
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText('of 2');
  });

  test('client with 63 matters: Matters (63), five rows, View all 63 matters', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(url(data.many));
    await expect(page.getByRole('tab', { name: /Matters/ })).toHaveText('Matters (63)');
    await expect(page.locator('[data-client-overview] [data-strip]')).toBeVisible();
    // No task anywhere: real zeros in the strip, no table, and a plain sentence instead.
    expect(await stripNumbers(page)).toEqual({
      open: 0,
      overdue: 0,
      dueSoon: 0,
      asap: 0,
      onHold: 0,
    });
    await expect(page.locator('[data-no-open]')).toHaveText('No matter has open tasks.');
    await expect(page.locator('[data-view-all]')).toHaveText('View all 63 matters');
    await page.locator('[data-view-all]').click();
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText('of 63');
  });

  test('a client without matters, and an inactive client', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(url(data.empty));
    await expect(page.locator('[data-no-matters]')).toContainText('No matters yet.');
    await expect(page.locator('[data-new-matter]')).toBeVisible();
    await expect(page.getByRole('tab', { name: /Matters/ })).toHaveText('Matters (0)');
    await expect(page.locator('[data-strip-item="open"]')).toHaveClass(/zero/);
    await shot(page, 'client-overview-empty');

    await page.goto(url(data.inactive));
    await expect(page.locator('[data-record-header]')).toContainText('Inactive');
    await expect(page.locator('[data-no-matters]')).toContainText('No matters yet.');
    await expect(page.locator('[data-new-matter]')).toHaveCount(0);
    await expect(page.locator('[data-inactive-reason]')).toContainText('This client is inactive');
    await expect(page.getByText('Inactive: no new matters')).toHaveCount(0);
    await shot(page, 'client-overview-inactive');
  });

  for (const [w, h] of SIZES) {
    test(`axe clean and no sideways scroll at ${w}x${h}; the table is a list on a phone`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(url(data.client));
      await expect(page.locator('[data-top-matters] tbody tr')).toHaveCount(2);
      await expect(page.locator('[data-strip-item="open"] .n')).toHaveText('9');
      await axeClean(page, `overview ${w}x${h}`);
      await noSidewaysScroll(page);
      // The overview never scrolls sideways inside its own scroll area either.
      const area = await page.locator('[data-details-tab]').evaluate((e) => ({
        sw: e.scrollWidth,
        cw: e.clientWidth,
      }));
      expect(area.sw).toBeLessThanOrEqual(area.cw);
      if (w < 640) {
        // Two-line list: the header row is hidden and a row holds the reference and name above the numbers.
        const row = page.locator('[data-top-matters] tbody tr').first();
        const ref = (await row.locator('.ov-ref').boundingBox())!;
        const open = (await row.locator('td.ov-num').first().boundingBox())!;
        expect(open.y).toBeGreaterThan(ref.y + ref.height - 1);
        // 44 px targets for the strip on a phone.
        const link = (await page.locator('[data-strip-item="open"]').boundingBox())!;
        expect(link.height).toBeGreaterThanOrEqual(44);
      }
      await shot(page, 'client-overview');
      if (axeAvailable()) {
        await page.getByRole('tab', { name: /Matters/ }).click();
        await expect(page.getByRole('tab', { name: /Matters/ })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await axeClean(page, `matters tab ${w}x${h}`);
        await noSidewaysScroll(page);
      }
    });
  }

  test('Enter on a strip link follows it', async ({ page }) => {
    await page.goto(url(data.client));
    const overdue = page.locator('[data-strip-item="overdue"]');
    await overdue.focus();
    await expect(overdue).not.toHaveAttribute('aria-pressed', /.*/);
    expect(await overdue.evaluate((e) => e.tagName)).toBe('A');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks\?/);
    await expect(page).toHaveURL(new RegExp(`client=${data.client.clientId}`));
    await expect(page).toHaveURL(/overdue=true/);
  });
});

test.describe('WP6: strip numbers equal the Task Queue totals behind each link, for three people', () => {
  const FULL = ['Client.View', 'Matter.View', 'Matter.Create', 'Client.Edit', 'Task.View'];
  const NO_MATTERS = ['Client.View', 'Task.View'];
  const NO_TASKS = ['Client.View', 'Matter.View'];

  for (const who of [
    { label: 'full access', permissions: FULL },
    { label: 'no Matter.View', permissions: NO_MATTERS },
  ]) {
    test(`${who.label}: every link lands on a queue whose total is the strip number`, async ({
      asUser,
      seed,
    }) => {
      const role = await seed.role(who.permissions, 'E2E overview');
      const user = await seed.user([role.name], 'ov');
      const page = await asUser(user.username);
      await page.goto(url(data.client));
      await expect(page.locator('[data-client-overview] [data-strip]')).toBeVisible();
      const numbers = (await stripNumbers(page))!;
      expect(numbers).toEqual({ open: 9, overdue: 3, dueSoon: 1, asap: 1, onHold: 1 });

      for (const key of KEYS) {
        await page.goto(url(data.client));
        const link = page.locator(`[data-client-overview] [data-strip-item="${key}"]`);
        await link.click();
        await expect(page).toHaveURL(/\/tasks\?/);
        await expect(page).toHaveURL(new RegExp(`client=${data.client.clientId}`));
        expect(await queueTotal(page), `${key} total in the Task Queue`).toBe(numbers[key]);
        const view = VIEW_OF[key];
        if (view) {
          const pressed = page
            .locator(
              `.qv [data-view="${view}"][aria-pressed="true"], .qv [data-view-in-more="${view}"][aria-pressed="true"]`,
            )
            .first();
          await expect(pressed, `${key} presses its quick view`).toBeVisible();
        }
      }
      // The Matters tab exists only with Matter.View.
      await page.goto(url(data.client));
      await expect(page.getByRole('tab').first()).toBeVisible();
      const tabs = await page.getByRole('tab').allTextContents();
      expect(tabs.map((t) => t.replace(/\s+/g, ' ').trim())).toEqual(
        who.permissions.includes('Matter.View') ? ['Overview', 'Matters (3)'] : ['Overview'],
      );
      if (!who.permissions.includes('Matter.View')) {
        await expect(page.locator('[data-top-matters]')).toHaveCount(0);
      }
    });
  }

  test('full access: the matter rows link to the matters and the numbers match the matter pages', async ({
    asUser,
    seed,
  }) => {
    const role = await seed.role(FULL, 'E2E overview rows');
    const user = await seed.user([role.name], 'ovr');
    const page = await asUser(user.username);
    await page.goto(url(data.client));
    const rows = page.locator('[data-top-matters] tbody tr');
    await expect(rows).toHaveCount(2);
    const first = rows.first();
    const open = Number(await first.locator('td').nth(2).textContent());
    await first.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/matters/${data.matters[0].matterId}`));
    await page.getByRole('tab', { name: /Tasks/ }).click();
    await expect(page.getByRole('tab', { name: /Tasks/ })).toContainText(`(${open})`);
  });

  test('no Task.View: no strip, no numbers, matters listed with reference, name and status; never an error', async ({
    asUser,
    seed,
  }) => {
    const role = await seed.role(NO_TASKS, 'E2E overview no tasks');
    const user = await seed.user([role.name], 'ovn');
    const page = await asUser(user.username);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(url(data.client));
      await expect(page.locator('[data-top-matters]')).toBeVisible();
      await expect(page.locator('[data-strip]')).toHaveCount(0);
      await expect(page.locator('[data-overview-error]')).toHaveCount(0);
      await expect(page.locator('[role=alert]')).toHaveCount(0);
      await expect(page.locator('[data-top-matters] tbody tr')).toHaveCount(3);
      expect(
        (await page.locator('[data-top-matters] th').allTextContents()).map((t) => t.trim()),
      ).toEqual(['Matter', 'Name', 'Status']);
      await expect(page.locator('.ov-h')).toHaveText('Matters');
      await expect(page.getByRole('tab')).toHaveText(['Overview', 'Matters (3)']);
      await axeClean(page, `no Task.View ${w}x${h}`);
      await noSidewaysScroll(page);
      await shot(page, 'client-overview-no-task-view');
    }
  });
});
