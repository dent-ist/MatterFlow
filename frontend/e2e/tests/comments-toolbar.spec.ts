import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * Comments tab toolbar (#665): the "Search comments" box (with a leading search icon) and the sort select share one 36 px row from 480 px
 * and wrap below it. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/task-detail-review/fixes/comments-toolbar).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

async function toolbar(page: Page) {
  const search = page.getByRole('searchbox', { name: 'Search comments' });
  const select = page.locator('[data-order-select]');
  await expect(search).toBeVisible();
  const s = (await search.boundingBox())!;
  const o = (await select.boundingBox())!;
  return { s, o };
}

test.describe('Comments toolbar (#665)', () => {
  test('one row from 480 px with the icon, wrapping below it; axe 0, no sideways scroll; also with the Show all line', async ({
    seed,
    admin,
    page,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    for (let i = 1; i <= 5; i++) {
      await admin.post(`/api/v1/tasks/${task.taskId}/comments`, { bodyHtml: `Comment ${i}` });
    }
    const detail = new TaskDetailPage(page);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await detail.open(task.taskId);
      await detail.showSection('Comments');
      await expect(detail.showAllComments).toBeVisible();
      const { s, o } = await toolbar(page);
      expect(s.height, `search height at ${size.width}`).toBeCloseTo(36, 0);
      expect(o.height, `select height at ${size.width}`).toBeCloseTo(36, 0);
      if (size.width >= 480) {
        expect(Math.abs(s.y - o.y), `one row at ${size.width}`).toBeLessThanOrEqual(2);
        expect(o.x).toBeGreaterThan(s.x + s.width - 1);
        expect(s.width).toBeGreaterThanOrEqual(192);
      } else {
        expect(o.y, `wrapped at ${size.width}`).toBeGreaterThan(s.y + s.height - 1);
        expect(s.width).toBeGreaterThan(size.width - 80);
      }
      await expect(page.locator('.tc__tools .sb__icon')).toBeVisible();
      await expect(page.locator('.tc__tools .sb__icon')).toHaveAttribute('aria-hidden', 'true');
      if (axeAvailable()) expect(await axeViolations(page), `axe at ${size.width}`).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      if (OUT) {
        fs.mkdirSync(OUT, { recursive: true });
        await page.screenshot({ path: path.join(OUT, `toolbar-${size.width}x${size.height}.png`) });
      }
    }
  });

  test('a person without Task.Comment sees the same one-row toolbar', async ({
    seed,
    admin,
    asUser,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    await admin.post(`/api/v1/tasks/${task.taskId}/comments`, { bodyHtml: 'Only one' });
    const role = await seed.role(['Task.View', 'Matter.View', 'Client.View'], 'E2E reader');
    const reader = await seed.user([role.name], 'reader');
    const page = await asUser(reader.username);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showSection('Comments');
    const { s, o } = await toolbar(page);
    expect(Math.abs(s.y - o.y)).toBeLessThanOrEqual(2);
    await page.getByRole('searchbox', { name: 'Search comments' }).fill('zzz');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('searchbox', { name: 'Search comments' })).toHaveValue('');
  });
});
