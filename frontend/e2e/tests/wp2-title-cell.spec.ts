import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Title cell (TQ-WP2, #196, TQ14, TQ48): the Title cell holds the type icon and the title link, nothing else, on every grid. A 170-character
 * title and a 90-character unbroken token keep the column width and the row height of an ordinary title (two lines at most, Comfortable).
 * Every test uses its own user and tagged tasks. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/task-queue-review/fixes/wp-title).
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

const SUB =
  '.wt-subline, .wt-sub, [data-title-context], [data-title-progress], [data-sub-task], .wt-new';

async function worker(seed: Seeder, label: string) {
  const me = await seed.user(['Data Technician'], label);
  const world = await seed.world();
  const tag = uid();
  const make = (title: string) => seed.task(world, { title, assignedUserId: me.userId });
  const short = await make(`Short ${tag}`);
  const long = await make(`${'Long title words '.repeat(10).slice(0, 170)} ${tag}`.slice(0, 170));
  const token = await make(`T${'x'.repeat(89)}`);
  return { me, tag, short, long, token, world };
}

test.describe('Title cell (#196)', () => {
  test('no subline anywhere; the long title and the unbroken token keep the row height and the column width', async ({
    seed,
    asUser,
  }) => {
    const { me, short, long, token } = await worker(seed, 'wp2-clamp');
    const page = await asUser(me.username);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      await new MyWorkPage(page).open();
      const rowOf = (t: { taskNumber: string }) => page.locator(`tr[data-task="${t.taskNumber}"]`);
      await expect(rowOf(short)).toBeVisible();
      await expect(rowOf(long)).toBeVisible();
      await expect(rowOf(token)).toBeVisible();
      await expect(page.locator(SUB)).toHaveCount(0);
      const h = async (t: { taskNumber: string }) => (await rowOf(t).boundingBox())!.height;
      // #210: the clamped title never grows a row: every row is 44 px.
      expect(Math.abs((await h(long)) - 44), `long row at ${width}`).toBeLessThanOrEqual(1);
      expect(Math.abs((await h(token)) - 44), `token row at ${width}`).toBeLessThanOrEqual(1);
      expect(Math.abs((await h(short)) - 44), `short row at ${width}`).toBeLessThanOrEqual(1);
      for (const t of [long, token]) {
        const link = rowOf(t).locator('a.wt-title');
        const box = (await link.boundingBox())!;
        expect(box.height, 'at most two 18 px lines').toBeLessThanOrEqual(36);
        expect(await link.getAttribute('title')).toBeTruthy();
      }
      const widths = await page.evaluate(() =>
        Array.from(document.querySelectorAll('tbody tr[data-task] td[data-col="title"]')).map(
          (c) => c.getBoundingClientRect().width,
        ),
      );
      expect(new Set(widths.map(Math.round)).size, 'one title column width').toBe(1);
      const o = await page.evaluate(() => {
        const w = document.querySelector('.wt-wrap') as HTMLElement;
        return w.scrollWidth <= w.clientWidth;
      });
      expect(o, `no sideways scroll at ${width}`).toBe(true);
      await shot(page, `my-work-title-only-${width}x${height}`);
      await axeClean(page, `My Work ${width}`);
    }
  });

  test('Task Queue and a read-only viewer show the same Title cell; nothing in it links to a Matter', async ({
    seed,
    asUser,
  }) => {
    const { tag } = await worker(seed, 'wp2-queue');
    const role = await seed.role(['Task.View'], `E2E title ${uid()}`);
    const viewer = await seed.user([role.name], 'wp2-viewer');
    const page = await asUser(viewer.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    await queue.search(tag);
    await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
    await expect(page.locator(SUB)).toHaveCount(0);
    await expect(page.locator('td[data-col="title"] a[href^="/matters"]')).toHaveCount(0);
    // The key model hooks stay.
    await expect(page.locator('tr[data-task] a.wt-title').first()).toBeVisible();
    await shot(page, 'task-queue-title-only-1366x768');
    await axeClean(page, 'Task Queue 1366');
  });

  test('tablet and phone widths: no subline, a 24 px link target, axe clean', async ({
    seed,
    asUser,
  }) => {
    const { me, long } = await worker(seed, 'wp2-narrow');
    const page = await asUser(me.username);
    for (const [width, height] of [
      [768, 1024],
      [375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      await new MyWorkPage(page).open();
      const row = page.locator(`tr[data-task="${long.taskNumber}"]`);
      await expect(row).toBeVisible();
      await expect(page.locator(SUB)).toHaveCount(0);
      const box = (await row.locator('a.wt-title').boundingBox())!;
      expect(box.height, `a 24 px target at ${width}`).toBeGreaterThanOrEqual(24);
      await shot(page, `my-work-title-only-${width}x${height}`);
      await axeClean(page, `My Work ${width}`);
    }
  });
});
