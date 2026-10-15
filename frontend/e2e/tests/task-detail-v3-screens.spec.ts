import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { Api } from '../support/api';
import { seedBusyTask } from '../support/busy-task';
import { expect, test } from '../support/fixtures';

/**
 * Screenshots for docs/ux/task-detail-v3 (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/task-detail-v3 frontend/e2e/run-local.sh -g "task detail v3 screenshots"
 * One busy task photographed at 1366x768 and 375x812: collapsed bars, both expanded, the "new" cue after another user comments, and the
 * composer as one line and as the editor. Each shot is the page scrolled so that the Comments / Assets area is in view.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

test.describe('task detail v3 screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, seed, admin }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(OUT!, { recursive: true });
    const task = await seedBusyTask(seed, admin);
    const tech = await seed.user(['Data Technician'], 'tech');
    const asTech = await Api.as(tech.username);
    const detail = new TaskDetailPage(page);

    const shoot = async (p: Page, name: string, fold = false) => {
      await p.waitForLoadState('networkidle');
      if (!fold) {
        await p
          .locator('[data-section="comments"]')
          .evaluate((el) => el.scrollIntoView({ block: 'center' }));
      }
      await p.waitForTimeout(300);
      await p.screenshot({ path: path.join(OUT!, `${name}.png`), fullPage: false });
    };
    const reset = async (): Promise<void> => {
      await page.evaluate(() => localStorage.clear());
    };

    try {
      for (const size of [
        { w: 1366, h: 768 },
        { w: 375, h: 812 },
      ]) {
        const at = `${size.w}`;
        await page.setViewportSize({ width: size.w, height: size.h });
        await page.goto(`/tasks/${task.taskId}`);
        await reset();
        await page.reload();
        await expect(detail.header).toBeVisible();
        await expect(detail.toggle('Comments')).toHaveAttribute('aria-expanded', 'false');
        await shoot(page, `${at}-1-collapsed`);

        await detail.ensureCommentsOpen();
        await shoot(page, `${at}-2-comments-open`);
        await detail.ensureAssetsOpen();
        await shoot(page, `${at}-3-both-open`);
        await detail.composer();
        await shoot(page, `${at}-5-composer-editor`);
        await page.keyboard.type('Thanks, loading the second batch now.');
        await shoot(page, `${at}-6-composer-with-text`);

        // Collapse, then another user comments: the next visit shows the cue and opens Comments.
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await expect(detail.header).toBeVisible();
        await detail.ensureCommentsOpen();
        await detail.ensureAssetsOpen();
        await detail.toggle('Comments').click();
        await detail.toggle('Assets').click();
        await page.waitForTimeout(1100);
        await asTech.post(`/api/v1/tasks/${task.taskId}/comments`, {
          bodyHtml: `<p>Batch B-00${size.w === 1366 ? 2 : 3} is loaded, QC can start.</p>`,
        });
        await page.reload();
        await expect(detail.section('Comments').locator('[data-new-badge]')).toBeVisible();
        await shoot(page, `${at}-4-new-cue`);

        // The bar with only Comments open (one open section takes the whole row), then the one-line composer.
        await detail.toggle('Comments').click();
        await page.reload();
        await expect(detail.header).toBeVisible();
        await detail.ensureCommentsOpen();
        await shoot(page, `${at}-7-composer-one-line`);
      }
    } finally {
      await asTech.dispose();
    }
  });
});
