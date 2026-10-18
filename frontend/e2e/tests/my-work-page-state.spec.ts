import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { Api } from '../support/api';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * My Work page state (WP3): no stale rows under a new tab (BUG-2), Reset to default (BUG-4), New markers across a visit (BUG-3),
 * the restored view rule (M6) and the first non-empty tab (M4). Every test uses its own users and tagged tasks, so nothing depends on
 * global counts. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/my-work-review/fixes/wp3).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const visitKey = (userId: number) => `mf.my-work.visit.v2.${userId}`;
const viewKey = (userId: number) => `mf.work-view.v1.my-work.${userId}`;

test.describe('My Work page state', () => {
  test('BUG-2: a failed tab change shows the error row and never the previous tab rows', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'stale');
    const world = await seed.world();
    const title = `Soon ${uid()}`;
    await seed.task(world, {
      title,
      assignedUserId: me.userId,
      dueDate: dateInZone(FIRM_ZONE, 1),
    });
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    await myWork.open('?view=dueSoon');
    await myWork.expectListed(title);

    let fail = true;
    await page.route('**/api/v1/my-work?**', (route) =>
      fail && route.request().url().includes('view=completed') ? route.abort() : route.continue(),
    );
    await myWork.tab(/^Closed/).click();
    await expect(page.locator('tbody').getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByText(title)).toHaveCount(0);
    await expect(page.locator('[data-sort-note]')).toContainText('Closed date');
    await expect(myWork.tab(/^Due soon/)).toContainText('(1)'); // the counts stay
    await shot(page, 'bug2-error-no-stale-rows-1366x768');
    if (axeAvailable()) expect(await axeViolations(page), 'error state').toEqual([]);

    // Retry asks for the current tab.
    fail = false;
    await page.locator('tbody').getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('tbody').getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await expect(page.getByText(title)).toHaveCount(0);
  });

  test('BUG-2: a slow answer for a tab left behind never shows its rows', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'late');
    const world = await seed.world();
    const title = `Late ${uid()}`;
    await seed.task(world, {
      title,
      assignedUserId: me.userId,
      dueDate: dateInZone(FIRM_ZONE, 1),
    });
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await myWork.expectListed(title);
    // Due soon answers late; Completed answers at once, and wins.
    await page.route('**/api/v1/my-work?**', async (route) => {
      if (route.request().url().includes('view=dueSoon'))
        await new Promise((r) => setTimeout(r, 1500));
      await route.continue().catch(() => undefined);
    });
    await myWork.tab(/^Due soon/).click();
    await expect(page.getByText(title)).toHaveCount(0);
    await myWork.tab(/^Closed/).click();
    await page.waitForTimeout(2200);
    await expect(page.getByText(title)).toHaveCount(0);
    await expect(myWork.tab(/^Closed/)).toHaveAttribute('aria-selected', 'true');
  });

  test('BUG-3: the New markers survive opening a task and pressing Back', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'newback');
    const world = await seed.world();
    const old = await seed.task(world, { title: `Old ${uid()}`, assignedUserId: me.userId });
    await new Promise((r) => setTimeout(r, 1100));
    const since = Date.now();
    await new Promise((r) => setTimeout(r, 1100));
    const fresh = [1, 2, 3].map((i) => `Fresh${i} ${uid()}`);
    for (const title of fresh) await seed.task(world, { title, assignedUserId: me.userId });

    const page = await asUser(me.username);
    await page.addInitScript(
      ([key, value]) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, value);
      },
      [visitKey(me.userId), JSON.stringify({ lastActiveAt: Date.now(), visitSince: since })],
    );
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await expect(page.locator('[data-new-dot]')).toHaveCount(3);
    await expect(myWork.row(old.title).locator('[data-new-dot]')).toHaveCount(0);
    await shot(page, 'bug3-new-markers-1366x768');

    await myWork.row(fresh[0]).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/tasks\/\d+/);
    await page.goBack();
    await expect(page.locator('[data-new-dot]')).toHaveCount(3);
    await page.reload();
    await expect(page.locator('[data-new-dot]')).toHaveCount(3);
    await page.goto('/tasks');
    await page.goto('/my-work');
    await expect(page.locator('[data-new-dot]')).toHaveCount(3);
    await shot(page, 'bug3-after-back-1366x768');
  });

  test('BUG-4 and M6: Reset to default forgets the view, Dismiss does not, and the notice names the view', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'reset');
    const world = await seed.world();
    await seed.task(world, {
      title: `Reset ${uid()}`,
      assignedUserId: me.userId,
      dueDate: dateInZone(FIRM_ZONE, 1),
    });
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    await myWork.open('?view=dueSoon&priority=1&priority=2');
    // A view is remembered once its list has loaded (the heading shows earlier): wait for that before leaving, as a person would.
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), viewKey(me.userId)))
      .toContain('dueSoon');
    await page.goto('/pods/work'); // away, then back through the nav with no query string
    await page.getByRole('link', { name: 'My Work', exact: true }).first().click();
    const notice = page.locator('[data-restored-notice]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Restored your last view: Due soon and overdue, Priority');
    await expect(page).toHaveURL(/view=dueSoon/);
    await shot(page, 'm6-restored-notice-1366x768');
    if (axeAvailable()) expect(await axeViolations(page), 'notice').toEqual([]);

    // Dismiss only hides the notice; the next plain visit restores again.
    await notice.getByRole('button', { name: 'Dismiss notice' }).click();
    await expect(notice).toHaveCount(0);
    await expect(page).toHaveURL(/view=dueSoon/);
    await myWork.open();
    await expect(page).toHaveURL(/view=dueSoon/);
    await expect(notice).toBeVisible();

    // Reset to default: plain URL, Active, no filters, notice gone, heading focused; the next plain visit is quiet.
    await notice.getByRole('button', { name: 'Reset to default' }).click();
    await expect(notice).toHaveCount(0);
    await expect(page).toHaveURL(/\/my-work$/);
    await expect(myWork.tab(/^Active/)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'My Work', level: 1 })).toBeFocused();
    await expect(page.locator('[data-filter-chips]')).toHaveCount(0);
    await myWork.open();
    await expect(page).toHaveURL(/\/my-work$/);
    await expect(notice).toHaveCount(0);
  });

  test('BUG-4: Reset to default on the Task Queue returns to the plain /tasks and forgets the view', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'qreset');
    const page = await asUser(me.username);
    await page.addInitScript(
      ([key, value]) => {
        if (sessionStorage.getItem('seeded')) return; // seed once, so a reset stays reset
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(key, value);
      },
      [`mf.work-view.v1.queue.${me.userId}`, JSON.stringify({ status: ['NEW'], overdue: 'true' })],
    );
    const queue = new TaskQueuePage(page);
    await page.goto('/tasks');
    const notice = page.locator('[data-restored-notice]');
    await expect(notice).toContainText('Restored your last view');
    await notice.getByRole('button', { name: 'Reset to default' }).click();
    await expect(notice).toHaveCount(0);
    await expect(page).toHaveURL(/\/tasks$/);
    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(notice).toHaveCount(0);
    expect(queue).toBeTruthy();
  });

  for (const view of ['completed', 'createdByMe']) {
    test(`M6: a last view on ${view} is not restored, the plain visit opens Active`, async ({
      seed,
      asUser,
    }) => {
      const me = await seed.user(['Data Technician'], 'norestore');
      const world = await seed.world();
      await seed.task(world, { title: `Mine ${uid()}`, assignedUserId: me.userId });
      const page = await asUser(me.username);
      await page.addInitScript(
        ([key, value]) => localStorage.setItem(key, value),
        [viewKey(me.userId), JSON.stringify({ view, sort: 'due' })],
      );
      const myWork = new MyWorkPage(page);
      await myWork.open();
      await expect(page).toHaveURL(/\/my-work$/);
      await expect(myWork.tab(/^Active/)).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('[data-restored-notice]')).toHaveCount(0);
    });
  }

  test('M4: with nothing assigned the plain visit opens Created by me once, with a notice; Back does not bounce', async ({
    seed,
    asUser,
  }) => {
    const lead = await seed.user(['Project Manager'], 'landing');
    const worker = await seed.user(['Data Technician'], 'landing-w');
    const world = await seed.world();
    const title = `Made ${uid()}`;
    await seed.task(world, { title, assignedUserId: worker.userId }, await Api.as(lead.username));

    const page = await asUser(lead.username);
    const myWork = new MyWorkPage(page);
    await page.goto('/pods/work');
    await myWork.open();
    await expect(page).toHaveURL(/view=createdByMe/);
    await expect(myWork.tab(/^Created by me/)).toHaveAttribute('aria-selected', 'true');
    const notice = page.locator('[data-restored-notice]');
    await expect(notice).toContainText('Nothing is assigned to you, so this opens Created by me.');
    await expect(notice.getByRole('button', { name: 'Reset to default' })).toHaveCount(0);
    await myWork.expectListed(title);
    await shot(page, 'm4-opens-created-by-me-1366x768');
    if (axeAvailable()) expect(await axeViolations(page), 'landing notice').toEqual([]);

    // The fallback is not remembered, and Back leaves My Work instead of bouncing.
    await page.goBack();
    await expect(page).not.toHaveURL(/my-work/);

    // An explicit tab click and a deep link are never redirected.
    await myWork.open('?view=dueSoon');
    await expect(page).toHaveURL(/view=dueSoon/);
    await expect(myWork.tab(/^Due soon/)).toHaveAttribute('aria-selected', 'true');
    await myWork.open();
    await myWork.tab(/^Active/).click();
    await expect(myWork.tab(/^Active/)).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/\/my-work$/);
  });

  test('M4: a person with work lands on Active with no notice', async ({ seed, asUser }) => {
    const me = await seed.user(['Data Technician'], 'busy');
    const world = await seed.world();
    await seed.task(world, { title: `Busy ${uid()}`, assignedUserId: me.userId });
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await expect(page).toHaveURL(/\/my-work$/);
    await expect(page.locator('[data-restored-notice]')).toHaveCount(0);
  });

  test('axe and no overflow: the notices at 1920, 768 and 375', async ({ seed, asUser }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    const me = await seed.user(['Data Technician'], 'sizes');
    const world = await seed.world();
    await seed.task(world, {
      title: `Size ${uid()}`,
      assignedUserId: me.userId,
      dueDate: dateInZone(FIRM_ZONE, 1),
    });
    const page = await asUser(me.username);
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [viewKey(me.userId), JSON.stringify({ view: 'dueSoon', priority: ['1', '2', '3'] })],
    );
    for (const [w, h] of [
      [1920, 1080],
      [768, 1024],
      [375, 812],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/my-work');
      await expect(page.locator('[data-restored-notice]')).toBeVisible();
      expect(await axeViolations(page), `${w}`).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, `no horizontal scroll at ${w}`).toBe(false);
      await shot(page, `m6-restored-notice-${w}x${h}`);
    }
  });
});
