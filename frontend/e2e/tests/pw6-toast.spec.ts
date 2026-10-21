import { Page } from '@playwright/test';
import { PodWorkPage } from '../pages/queues.pages';
import { axeAvailable } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { podWorkFixtures } from '../support/pod-work-fixtures';
import { SIZES, axeClean, box, pageSideScroll, shot } from '../support/pod-work-checks';

/**
 * Pod Work, the Undo toast after "Assign to me" (epic #546, #571, W8). The App shell epic's toast system already replaced the white box:
 * "Assigned to you." and one short line, the long explanation as the Undo button's tooltip, in the one toast host bottom right. This spec
 * is the verification the issue asks for, at four sizes on Pod Work: text, style and position, not covering the pager, axe 0 with the
 * toast visible, Undo from the keyboard restores the assignee and not the status, the polite live region and the 4-second grace of the row.
 * Screenshots go to `E2E_SCREENSHOTS_PW` (docs/ux/pod-work-review/fixes/pw6-assign).
 */
test.describe('Pod Work Undo toast (#571)', () => {
  test('axe is available (the audits below really run)', () => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
  });

  /** A pod of its own with one New task and the signed-in person as its only member. */
  async function setup(
    seed: Parameters<Parameters<typeof test>[2]>[0]['seed'],
    personas: Parameters<Parameters<typeof test>[2]>[0]['personas'],
    token: string,
  ) {
    const mine = await personas.create({ label: `pw-toast-${token}`, roles: ['Pod Lead'] });
    const pod = await seed.pod(undefined, [mine.userId]);
    const world = await seed.world();
    const task = await seed.task(world, { title: `Toast ${token}`, assignedPodId: pod.podId });
    return { mine, pod, task };
  }

  const assign = async (page: Page, taskNumber: string) => {
    const pw = new PodWorkPage(page);
    const direct = pw.assignToMe(taskNumber);
    if (await direct.isVisible().catch(() => false)) {
      await direct.click();
      return;
    }
    await page
      .getByRole('button', { name: new RegExp(`change assignee of ${taskNumber}`) })
      .click();
    await page
      .locator('.im-pop')
      .getByRole('button', { name: `Assign ${taskNumber} to me`, exact: true })
      .click();
  };

  for (const size of SIZES) {
    test(`${size.name}: short two-line toast in the shared style bottom right, clear of the pager, axe 0, Undo by keyboard restores the assignee and not the status`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const { mine, pod, task } = await setup(seed, personas, `${fx.token}${size.width}`);
      const page = await asUser(mine.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`/pods/work?podId=${pod.podId}`);
      await expect(page.locator(`[data-task]`).first()).toBeVisible();
      await assign(page, task.taskNumber);

      const toast = page.locator('[data-undo-toast]');
      await expect(toast).toBeVisible();
      await expect(toast.locator('[data-undo-message]')).toHaveText('Assigned to you.');
      await expect(toast.locator('[data-toast-detail]')).toHaveText('Task moved to In Progress.');
      await expect(toast).not.toContainText('Undo puts the assignee back');
      await expect(toast.getByRole('button', { name: 'Undo' })).toHaveAttribute(
        'title',
        /Undo \(Alt\+Z\): Undo puts the assignee back; the status stays\./,
      );
      // The shared toast: inside the polite live region, tinted, bottom right, two lines at most.
      await expect(page.locator('[data-toast-polite] [data-undo-toast]')).toHaveCount(1);
      const t = await box(toast);
      expect(t.height, 'two lines at most').toBeLessThanOrEqual(84);
      expect(t.x + t.width, 'inside the window, near the right edge').toBeLessThanOrEqual(
        size.width,
      );
      expect(t.x + t.width).toBeGreaterThan(size.width - 40);
      expect(t.y + t.height, 'above the bottom edge').toBeLessThanOrEqual(size.height);
      expect(t.y).toBeGreaterThan(size.height / 2);
      await shot(page, `toast-${size.name}`);
      // It never covers the pager (or the cards' last row) of the page.
      const pager = page.locator('mf-pager').first();
      if (await pager.isVisible().catch(() => false)) {
        const p = await box(pager);
        const apart = t.y >= p.y + p.height - 1 || t.y + t.height <= p.y + 1;
        expect(apart, 'the toast and the pager do not overlap').toBe(true);
      }
      expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
      await axeClean(page, `axe with the toast visible at ${size.name}`);

      // Undo by keyboard: the assignee goes back to Unassigned; the status stays In Progress.
      await toast.getByRole('button', { name: 'Undo' }).focus();
      await page.keyboard.press('Enter');
      await expect(toast).toHaveCount(0);
      const after = await seed.admin.get(`/api/v1/tasks/${task.taskId}`);
      expect(after.assignedUser ?? null).toBeNull();
      expect(after.status).toBe('IN_PROGRESS');
    });
  }

  test('the row stays for its 4-second grace and then leaves the Unassigned tab; the toast outlives it', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await podWorkFixtures(seed, personas);
    const { mine, pod, task } = await setup(seed, personas, `${fx.token}g`);
    const page = await asUser(mine.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/pods/work?podId=${pod.podId}`);
    await assign(page, task.taskNumber);
    const row = page.getByRole('row', { name: new RegExp(task.taskNumber) });
    await expect(row).toBeVisible();
    await expect(page.locator('[data-undo-toast]')).toBeVisible();
    await expect(row).toHaveCount(0, { timeout: 9000 });
    await expect(page.locator('[data-undo-toast]')).toBeVisible();
  });
});
