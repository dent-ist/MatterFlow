import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Matter cell and default columns (TQ-WP8, #197, #198): the Matter cell is reference over name (name muted, one line, ellipsis, the name
 * is shown without Matter.View), the Client column is one line, and a Task Queue user who removed Matter keeps that choice with a one-time
 * notice that offers "Add Matter column". Own users and tagged data only. Screenshots go to E2E_SCREENSHOTS when it is set
 * (docs/ux/task-queue-review/fixes/wp-matter).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

async function world(seed: Seeder, label: string) {
  const tag = uid();
  const client = await seed.client({
    name: `Client ${'Verylongclientname '.repeat(3)}${tag}`.slice(0, 47),
  });
  const longName = `Matter name ${'very long '.repeat(14)}${tag}`;
  const matterLong = await seed.matter({ client, name: longName });
  const matterShort = await seed.matter({ client, name: `Short ${tag}`, number: '00002' });
  const workflow = await seed.workflow({});
  const taskType = await seed.taskType({ workflows: [workflow] });
  const me = await seed.user(['Data Technician'], label);
  const make = (matter: unknown, title: string) =>
    seed.task({ matter, taskType, workflow } as never, { title, assignedUserId: me.userId });
  const long = await make(matterLong, `Long ${tag}`);
  const short = await make(matterShort, `Short ${tag}`);
  return { tag, client, matterLong, matterShort, longName, me, long, short };
}

test.describe('Matter cell (#197)', () => {
  test('reference over name, tooltip, ellipsis without a taller row, axe at four sizes', async ({
    seed,
    asUser,
  }) => {
    const w = await world(seed, 'wp8-cell');
    const viewer = await seed.user(
      [(await seed.role(['Task.View'], `E2E v ${uid()}`)).name],
      'wp8-v',
    );
    const page = await asUser(viewer.username);
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      const queue = new TaskQueuePage(page);
      await queue.open(`?q=${w.tag}`);
      const longRow = page.locator(`[data-task="${w.long.taskNumber}"]`);
      const shortRow = page.locator(`[data-task="${w.short.taskNumber}"]`);
      await expect(longRow).toBeVisible();
      if (width >= 960) {
        const cell = longRow.locator('td[data-col="matter"]');
        // No Matter.View: the reference is plain text, the name is shown.
        await expect(cell.locator('a')).toHaveCount(0);
        await expect(cell.locator('.mf-ref')).toHaveText(String(w.matterLong.matterRef));
        await expect(cell.locator('[data-matter-name]')).toContainText('Matter name');
        await expect(cell.locator('[title]').first()).toHaveAttribute(
          'title',
          `${w.client.name} · ${w.longName}`,
        );
        const name = cell.locator('[data-matter-name]');
        expect(await name.evaluate((n) => n.scrollWidth > n.clientWidth), 'ellipsis').toBe(true);
        const hl = (await longRow.boundingBox())!.height;
        const hs = (await shortRow.boundingBox())!.height;
        expect(Math.abs(hl - hs), `row height at ${width}`).toBeLessThanOrEqual(1);
        expect(await cell.evaluate((n) => n.getBoundingClientRect().width)).toBeLessThan(260);
      }
      await shot(page, `task-queue-matter-cell-${width}x${height}`);
      await axeClean(page, `Task Queue ${width}`);
    }
  });

  test('a user with Matter.View gets a link; Client is a one-line column; Compact shows the reference only', async ({
    seed,
    asUser,
  }) => {
    const w = await world(seed, 'wp8-link');
    const role = await seed.role(['Task.View', 'Matter.View'], `E2E mv ${uid()}`);
    const viewer = await seed.user([role.name], 'wp8-mv');
    const page = await asUser(viewer.username);
    await page.addInitScript(
      ([k, v]) => {
        if (!localStorage.getItem(k)) localStorage.setItem(k, v);
      },
      [
        `mf.work-columns.v2.taskQueue.${viewer.userId}`,
        JSON.stringify(['ref', 'title', 'matter', 'client', 'status']),
      ],
    );
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open(`?q=${w.tag}`);
    const longRow = page.locator(`[data-task="${w.long.taskNumber}"]`);
    const shortRow = page.locator(`[data-task="${w.short.taskNumber}"]`);
    await expect(longRow.locator('td[data-col="matter"] a')).toHaveAttribute(
      'href',
      `/matters/${w.matterLong.matterId}`,
    );
    const clientCell = longRow.locator('td[data-col="client"]');
    await expect(clientCell).toContainText(String(w.client.name).slice(0, 20));
    expect(
      Math.abs((await longRow.boundingBox())!.height - (await shortRow.boundingBox())!.height),
    ).toBeLessThanOrEqual(1);
    await shot(page, 'task-queue-matter-client-1366x768');
    await axeClean(page, 'Task Queue with Matter link and Client');
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await page.getByRole('radio', { name: 'Compact' }).check();
    await page.keyboard.press('Escape');
    await expect(longRow.locator('[data-matter-name]')).toHaveCount(0);
    await expect(longRow.locator('td[data-col="matter"] .mf-ref')).toBeVisible();
    await shot(page, 'task-queue-matter-compact-1366x768');
  });
});

test.describe('Matter column default and notice (#198)', () => {
  test('a Task Queue user who removed Matter keeps the choice; the notice offers Add Matter column once', async ({
    seed,
    asUser,
  }) => {
    const w = await world(seed, 'wp8-notice');
    const role = await seed.role(['Task.View'], `E2E n ${uid()}`);
    const viewer = await seed.user([role.name], 'wp8-n');
    const page = await asUser(viewer.username);
    await page.addInitScript(
      ([k, v]) => {
        if (!localStorage.getItem(k)) localStorage.setItem(k, v);
      },
      [`mf.work-columns.v2.taskQueue.${viewer.userId}`, JSON.stringify(['ref', 'title', 'status'])],
    );
    for (const [width, height] of [
      [375, 812],
      [1366, 768],
    ] as const) {
      await page.setViewportSize({ width, height });
      const queue = new TaskQueuePage(page);
      await queue.open(`?q=${w.tag}`);
      await expect(page.locator('th[data-col="matter"]')).toHaveCount(0);
      const notice = page.locator('[data-columns-notice]');
      await expect(notice).toBeVisible();
      await shot(page, `task-queue-notice-${width}x${height}`);
      await axeClean(page, `notice ${width}`);
      if (width === 375) continue;
      await notice.locator('[data-add-matter]').click();
      await expect(notice).toHaveCount(0);
      await expect(page.locator('th[data-col="matter"]')).toBeVisible();
      await page.reload();
      await expect(page.locator('[data-columns-notice]')).toHaveCount(0);
      await expect(page.locator('th[data-col="matter"]')).toBeVisible();
    }
  });

  test('a user without a stored set sees Matter in the default and no notice; Reset columns restores it', async ({
    seed,
    asUser,
  }) => {
    const w = await world(seed, 'wp8-default');
    const page = await asUser(w.me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    await expect(page.locator('th[data-col="matter"]')).toBeVisible();
    await expect(page.locator('th[data-col="client"]')).toHaveCount(0);
    await expect(page.locator('[data-columns-notice]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await page.getByLabel('Matter', { exact: true }).uncheck();
    await expect(page.locator('th[data-col="matter"]')).toHaveCount(0);
    await page.getByRole('button', { name: /Reset columns/ }).click();
    await expect(page.locator('th[data-col="matter"]')).toBeVisible();
  });
});
