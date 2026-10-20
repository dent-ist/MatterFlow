import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { toasts } from '../support/toasts';

/**
 * SH-B #616 (S16): one toast host, bottom right, tinted; success announced politely and errors assertively; Undo inside the toast; the
 * pager and the scroll bar stay usable. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/shell-review/fixes/sh5-toast).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

const AVAILABILITY = /\/api\/v1\/me\/availability/;

async function openOutOfOfficeDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /account menu/ }).click();
  await page
    .getByRole('menu', { name: 'Your account' })
    .getByRole('menuitem', { name: 'Set out of office...' })
    .click();
  return page.getByRole('dialog', { name: 'Set out of office' });
}

async function noSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe('SH-B: the one toast host', () => {
  test('only one toast host is in the page, and no PrimeNG toast or second Undo host', async ({
    page,
  }) => {
    await page.goto('/my-work');
    await expect(page.locator('mf-toast-host')).toHaveCount(1);
    await expect(page.locator('p-toast, mf-undo-toast, .p-toast')).toHaveCount(0);
  });

  test('success is announced politely, an error assertively; both sit bottom right, tinted, with a close button', async ({
    asUser,
    seed,
  }) => {
    const { username } = await seed.user(['Data Technician'], 'shb-live');
    const me = await asUser(username);
    await me.setViewportSize({ width: 1366, height: 768 });
    await me.goto('/my-work');

    // An error first: the save fails.
    let fail = true;
    await me.route(AVAILABILITY, (route) =>
      fail && route.request().method() !== 'GET'
        ? route.fulfill({
            status: 500,
            contentType: 'application/problem+json',
            body: JSON.stringify({ title: 'Boom', status: 500 }),
          })
        : route.continue(),
    );
    const dialog = await openOutOfOfficeDialog(me);
    await dialog.getByRole('button', { name: 'Set out of office' }).click();
    const error = me.locator('[data-toast][data-severity="error"]');
    await expect(error).toHaveCount(1);
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(me.locator('[role="status"] [data-toast][data-severity="error"]')).toHaveCount(0);
    const box = (await error.boundingBox())!;
    const view = me.viewportSize()!;
    expect(box.x + box.width).toBeLessThanOrEqual(view.width - 16 + 0.5);
    expect(box.x + box.width).toBeGreaterThan(view.width - 24);
    expect(box.y + box.height).toBeLessThanOrEqual(view.height - 16 + 0.5);
    await expect(error.locator('[data-toast-close]')).toBeVisible();

    // Then it works: success, in the polite status region.
    fail = false;
    await dialog.getByRole('button', { name: 'Set out of office' }).click();
    const ok = me.locator('[role="status"] [data-toast][data-severity="success"]');
    await expect(ok).toHaveCount(1);
    await expect(ok).toContainText('You are out of office');
    await expect(ok).not.toHaveAttribute('role', 'alert');
    await shot(me, 'toast-error-and-success-1366x768');
  });

  test('the same error many times is one toast with a count; many different errors show three at most', async ({
    asUser,
    seed,
  }) => {
    const { username } = await seed.user(['Data Technician'], 'shb-many');
    const me = await asUser(username);
    await me.goto('/my-work');
    let n = 0;
    let distinct = false;
    await me.route(AVAILABILITY, (route) =>
      route.request().method() === 'GET'
        ? route.continue()
        : route.fulfill({
            status: 400,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              title: 'Bad',
              status: 400,
              detail: distinct ? `Failure number ${++n}` : 'The same failure',
            }),
          }),
    );
    const dialog = await openOutOfOfficeDialog(me);
    const save = dialog.getByRole('button', { name: 'Set out of office' });
    for (let i = 0; i < 5; i++) await save.click();
    const same = me.locator('[data-toast][data-severity="error"]');
    await expect(same).toHaveCount(1);
    await expect(same.locator('[data-toast-count]')).toHaveText('x5');

    distinct = true;
    await me.waitForTimeout(5100);
    for (let i = 0; i < 5; i++) await save.click();
    await expect(toasts(me)).toHaveCount(3);
    await expect(toasts(me).last()).toContainText('Failure number 5');
  });

  test('a toast is closed with the keyboard, and focus stays where it was', async ({
    asUser,
    seed,
  }) => {
    const { username } = await seed.user(['Data Technician'], 'shb-key');
    const me = await asUser(username);
    await me.goto('/my-work');
    const dialog = await openOutOfOfficeDialog(me);
    await dialog.getByRole('button', { name: 'Set out of office' }).click();
    const toast = toasts(me).first();
    await expect(toast).toBeVisible();
    // The account menu button got focus back from the dialog; the toast did not take it.
    await expect(me.getByRole('button', { name: /account menu/ })).toBeFocused();
    const close = toast.getByRole('button', { name: 'Dismiss' });
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await me.keyboard.press('Tab');
      reached = await close.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    await expect(close).toBeFocused();
    await me.keyboard.press('Enter');
    await expect(toasts(me)).toHaveCount(0);
  });

  test('reduced motion: the toast does not animate', async ({ asUser, seed }) => {
    const { username } = await seed.user(['Data Technician'], 'shb-motion');
    const me = await asUser(username);
    await me.emulateMedia({ reducedMotion: 'reduce' });
    await me.goto('/my-work');
    const dialog = await openOutOfOfficeDialog(me);
    await dialog.getByRole('button', { name: 'Set out of office' }).click();
    const toast = toasts(me).first();
    await expect(toast).toBeVisible();
    expect(await toast.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });

  for (const size of SIZES) {
    test(`axe clean and no sideways scroll with toasts open at ${size.name}`, async ({
      asUser,
      seed,
    }) => {
      const { username } = await seed.user(['Data Technician'], `shb-axe-${size.width}`);
      const me = await asUser(username);
      await me.setViewportSize({ width: size.width, height: size.height });
      await me.goto('/my-work');
      await me.route(AVAILABILITY, (route) =>
        route.request().method() === 'GET'
          ? route.continue()
          : route.fulfill({
              status: 400,
              contentType: 'application/problem+json',
              body: JSON.stringify({ title: 'Bad', status: 400, detail: 'That did not save.' }),
            }),
      );
      const dialog = await openOutOfOfficeDialog(me);
      await dialog.getByRole('button', { name: 'Set out of office' }).click();
      await expect(me.locator('[data-toast][data-severity="error"]')).toHaveCount(1);
      await me.unroute(AVAILABILITY);
      await dialog.getByRole('button', { name: 'Set out of office' }).click();
      await expect(me.locator('[data-toast][data-severity="success"]')).toHaveCount(1);
      await noSideScroll(me);
      if (axeAvailable()) expect(await axeViolations(me), 'axe with toasts open').toEqual([]);
      await shot(me, `toasts-open-${size.name}`);
      // A phone: the toast spans the width.
      if (size.width < 640) {
        const box = (await toasts(me).first().boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(15);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width - 15);
        expect(box.width).toBeGreaterThan(size.width - 40);
      }
    });
  }

  for (const size of [SIZES[0], SIZES[1], SIZES[3]]) {
    test(`Undo is inside the host, reachable by keyboard, and does not cover the pager at ${size.name}`, async ({
      seed,
      admin,
      asUser,
    }) => {
      const token = uid();
      const tech = await seed.user(['Data Technician'], `shb-u-${token}`);
      const other = await seed.user(['Data Technician'], `shb-o-${token}`);
      const pod = await seed.pod(undefined, [other.userId]);
      const world = await seed.world();
      const title = `Take ${token}`;
      const task = await seed.task(world, { title, assignedPodId: pod.podId });

      const page = await asUser(tech.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      const queue = new TaskQueuePage(page);
      await queue.open(`?q=${title}`);
      const row = queue.row(task.taskNumber);
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: /change assignee of/ }).click();
      await page
        .getByRole('button', { name: `Assign ${task.taskNumber} to me`, exact: true })
        .click();

      const toast = page.locator('mf-toast-host [data-undo-toast]');
      await expect(toast).toContainText('Assigned to you.');
      await expect(page.locator('[data-undo-toast]')).toHaveCount(1);
      const view = page.viewportSize()!;
      const box = (await toast.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(view.width - 16 + 0.5);
      for (const name of ['Previous', 'Next', 'First', 'Last']) {
        const button = page.getByRole('button', { name, exact: true });
        if ((await button.count()) === 0 || !(await button.first().isVisible())) continue;
        expect(overlap(box, (await button.first().boundingBox())!), `${name} is covered`).toBe(
          false,
        );
      }
      await noSideScroll(page);
      await shot(page, `undo-toast-task-queue-${size.name}`);

      // Undo by keyboard: Tab to the button, Enter.
      const undo = toast.getByRole('button', { name: 'Undo' });
      let reached = false;
      for (let i = 0; i < 120 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await undo.evaluate((el) => el === document.activeElement);
      }
      expect(reached).toBe(true);
      await page.keyboard.press('Enter');
      await expect(row).toContainText('Unassigned');
      const stored = await admin.get(`/api/v1/tasks/${task.taskId}`);
      expect(stored.assignedUser ?? null).toBeNull();
    });
  }
});
