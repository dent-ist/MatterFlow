import { Page } from '@playwright/test';
import { PodWorkPage } from '../pages/queues.pages';
import { axeAvailable } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { podWorkFixtures } from '../support/pod-work-fixtures';
import { SIZES, axeClean, box, pageSideScroll, shot } from '../support/pod-work-checks';
import { TaskApi } from '../support/tasks';
import { FIRM_ZONE, dateInZone } from '../support/time';

/**
 * Pod Work, strip and tabs (epic #546, package WP-PW3): the strip is Overdue, Due today, ASAP and On hold, each a filter on All open (W5,
 * #561); the tabs are Unassigned, By member (people with open work) and All open (W6 / BUG-7, #562); on a phone the strip is one scrolling
 * chip row (W11, #563). Data: the fixtures of #547 and a small pod of its own with a task of each kind. Screenshots go to
 * `E2E_SCREENSHOTS_PW` (docs/ux/pod-work-review/fixes/pw3-strip). axe runs at the four sizes and the suite fails, never skips, without axe.
 */
test.describe('Pod Work strip and tabs', () => {
  const strip = (page: Page) => page.locator('[data-strip]').first();
  const item = (page: Page, key: string) => page.locator(`[data-strip-item="${key}"]`);
  const stripNumbers = async (page: Page) =>
    Object.fromEntries(
      await page
        .locator('[data-strip-item]')
        .evaluateAll((els) =>
          els.map((e) => [
            e.getAttribute('data-strip-item'),
            Number(e.querySelector('.n')?.textContent),
          ]),
        ),
    );

  test('axe is available (the audits below really run)', () => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
  });

  test.describe('#561 W5: the strip', () => {
    for (const size of SIZES) {
      test(`${size.name}: four items with the pod's counts, no number twice, axe 0, no sideways scroll`, async ({
        seed,
        personas,
        admin,
        asUser,
      }) => {
        const fx = await podWorkFixtures(seed, personas);
        const page = await asUser(fx.lead.username);
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto(`/pods/work?podId=${fx.busy.podId}`);
        await expect(item(page, 'overdue')).toBeVisible();

        const api = await admin.get(`/api/v1/pod-work?podId=${fx.busy.podId}`);
        expect(await stripNumbers(page)).toEqual({
          overdue: api.summary.overdue,
          dueToday: api.summary.dueToday,
          asap: api.summary.asap,
          onHold: api.summary.onHold,
        });
        const text = (await strip(page).innerText()).replace(/\s+/g, ' ');
        expect(text).not.toMatch(/Unassigned|Assigned/);
        expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
        if (size.width >= 1366) {
          // One row at 1366 and 1920 (it wraps cleanly at 768, never overlapping).
          const tops = await page
            .locator('[data-strip-item]')
            .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
          expect(new Set(tops).size, 'one row').toBe(1);
        }
        await shot(page, `strip-${size.name}`);
        await axeClean(page, `axe at ${size.name}`);
        await item(page, 'overdue').click();
        await expect(item(page, 'overdue')).toHaveAttribute('aria-pressed', 'true');
        await axeClean(page, `axe with a strip item pressed at ${size.name}`);
        await shot(page, `strip-overdue-${size.name}`);
      });
    }

    test('each item opens All open with its filter, keeps the pod and toggles off; the address carries the filter and Back works', async ({
      seed,
      personas,
      admin,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const mine = await personas.create({ label: 'pw-strip4', roles: ['Pod Lead'] });
      const pod = await seed.pod(undefined, [mine.userId]);
      const world = await seed.world();
      const tag = fx.token;
      const today = dateInZone(FIRM_ZONE, 0);
      await seed.task(world, {
        title: `S due today A ${tag}`,
        assignedPodId: pod.podId,
        dueDate: today,
      });
      await seed.task(world, {
        title: `S due today B ${tag}`,
        assignedPodId: pod.podId,
        dueDate: today,
        assignedUserId: mine.userId,
      });
      await seed.task(world, {
        title: `S overdue ${tag}`,
        assignedPodId: pod.podId,
        dueDate: dateInZone(FIRM_ZONE, -4),
      });
      await seed.task(world, { title: `S asap ${tag}`, assignedPodId: pod.podId, isAsap: true });
      // A task with no due date counts as ASAP, so the held task has a due date of its own.
      const held = await seed.task(world, {
        title: `S hold ${tag}`,
        assignedPodId: pod.podId,
        assignedUserId: mine.userId,
        dueDate: dateInZone(FIRM_ZONE, 10),
      });
      await new TaskApi(admin, held.taskId).changeStatus('ON_HOLD', 'Waiting');

      const page = await asUser(mine.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      const pw = new PodWorkPage(page);
      await page.goto(`/pods/work?podId=${pod.podId}`);
      await expect(item(page, 'dueToday')).toBeVisible();
      expect(await stripNumbers(page)).toEqual({ overdue: 1, dueToday: 2, asap: 1, onHold: 1 });
      const rowsOf = (title: string) =>
        page.getByRole('row', { name: new RegExp(`${title} ${tag}`) });

      await item(page, 'dueToday').click();
      await expect(page).toHaveURL(new RegExp(`view=all`));
      await expect(page).toHaveURL(new RegExp(`podId=${pod.podId}`));
      await expect(page).toHaveURL(new RegExp(`dueFrom=${today}`));
      await expect(item(page, 'dueToday')).toHaveAttribute('aria-pressed', 'true');
      await expect(pw.tab(/^All open/)).toHaveAttribute('aria-selected', 'true');
      await expect(rowsOf('S due today A')).toBeVisible();
      await expect(rowsOf('S due today B')).toBeVisible();
      await expect(rowsOf('S overdue')).toHaveCount(0);
      // The number on the item equals the number of rows the filter shows, and the tab says the same.
      await expect(pw.tab(/^All open/)).toContainText('(2)');

      // One item at a time: the next replaces the first.
      await item(page, 'asap').click();
      await expect(item(page, 'asap')).toHaveAttribute('aria-pressed', 'true');
      await expect(item(page, 'dueToday')).toHaveAttribute('aria-pressed', 'false');
      await expect(rowsOf('S asap')).toBeVisible();
      await expect(pw.tab(/^All open/)).toContainText('(1)');

      await item(page, 'onHold').click();
      await expect(rowsOf('S hold')).toBeVisible();
      await expect(pw.tab(/^All open/)).toContainText('(1)');

      await item(page, 'overdue').click();
      await expect(rowsOf('S overdue')).toBeVisible();
      await expect(pw.tab(/^All open/)).toContainText('(1)');

      // A second click switches it off: All open without a filter; the strip counts did not move meanwhile.
      await item(page, 'overdue').click();
      await expect(item(page, 'overdue')).toHaveAttribute('aria-pressed', 'false');
      await expect(page).not.toHaveURL(/overdue=true/);
      await expect(pw.tab(/^All open/)).toContainText('(5)');
      expect(await stripNumbers(page)).toEqual({ overdue: 1, dueToday: 2, asap: 1, onHold: 1 });

      // Back returns to the pressed state.
      await page.goBack();
      await expect(item(page, 'overdue')).toHaveAttribute('aria-pressed', 'true');
      await page.reload();
      await expect(item(page, 'overdue')).toHaveAttribute('aria-pressed', 'true');
    });

    test('the counts never follow the grid filters; a read-only person can use the strip', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.readonly.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=all`);
      await expect(item(page, 'overdue')).toBeVisible();
      const before = await stripNumbers(page);
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=all&q=zzz-nothing-matches`);
      await expect(
        page.getByText(/No tasks match these filters|No open tasks/).first(),
      ).toBeVisible();
      expect(await stripNumbers(page)).toEqual(before);
      await item(page, 'asap').click();
      await expect(item(page, 'asap')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: /Assign .* to me/ })).toHaveCount(0);
    });
  });

  test.describe('#562 W6 / BUG-7: the tabs', () => {
    for (const size of SIZES) {
      test(`${size.name}: Unassigned, By member (people) and All open; counts equal the API; axe 0`, async ({
        seed,
        personas,
        admin,
        asUser,
      }) => {
        const fx = await podWorkFixtures(seed, personas);
        const page = await asUser(fx.lead.username);
        await page.setViewportSize({ width: size.width, height: size.height });
        const pw = new PodWorkPage(page);
        await page.goto(`/pods/work?podId=${fx.busy.podId}`);
        const tabs = page.getByRole('tablist', { name: 'Pod Work views' }).getByRole('tab');
        await expect(tabs).toHaveCount(3);
        const api = await admin.get(`/api/v1/pod-work?podId=${fx.busy.podId}`);
        await expect(tabs.nth(0)).toHaveText(`Unassigned (${api.counts.queue})`);
        await expect(tabs.nth(1)).toHaveText(`By member (${api.counts.membersWithWork})`);
        await expect(tabs.nth(2)).toHaveText(`All open (${api.counts.all})`);
        // The By member number is the people with open work, not their tasks.
        expect(api.counts.membersWithWork).toBeLessThan(api.counts.members);
        await expect(pw.tab(/Overdue and on hold/)).toHaveCount(0);
        expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
        await shot(page, `tabs-${size.name}`);
        await axeClean(page, `axe at ${size.name}`);
      });
    }

    test('the old Overdue and on hold address opens All open with the Overdue filter; All open and the document title use the new names', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      const pw = new PodWorkPage(page);
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=attention`);
      await expect(page).toHaveURL(/view=all/);
      await expect(page).toHaveURL(/overdue=true/);
      await expect(pw.tab(/^All open/)).toHaveAttribute('aria-selected', 'true');
      await expect(item(page, 'overdue')).toHaveAttribute('aria-pressed', 'true');
      await expect(page).toHaveTitle(
        new RegExp(`^Pod Work: ${fx.busy.name}: All open - MatterFlow$`),
      );
      await expect(page.getByRole('table').first().locator('caption')).toContainText('All open');
      // The bookmark of the old tab with no filters at all: All open.
      await page.goto(`/pods/work?view=all&podId=${fx.busy.podId}`);
      await expect(pw.tab(/^All open/)).toHaveAttribute('aria-selected', 'true');
    });

    test('BUG-7: the strip and the tabs never contradict each other (Overdue on the strip equals the rows its filter shows)', async ({
      seed,
      personas,
      admin,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.goto(`/pods/work?podId=${fx.busy.podId}`);
      await expect(item(page, 'overdue').locator('.n')).toHaveText(/^\d+$/);
      const numbers = await stripNumbers(page);
      for (const [key, params] of [
        ['overdue', 'overdue=true'],
        ['asap', 'asap=true'],
        ['onHold', 'status=ON_HOLD'],
      ] as const) {
        const api = await admin.get(`/api/v1/pod-work?podId=${fx.busy.podId}&view=all&${params}`);
        expect(api.total, key).toBe(numbers[key]);
      }
    });

    test('keyboard: the tab list is one Tab stop, arrow keys move and select, Home and End jump (unchanged model)', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      const pw = new PodWorkPage(page);
      await page.goto(`/pods/work?podId=${fx.busy.podId}`);
      await pw.tab(/^Unassigned/).focus();
      await page.keyboard.press('ArrowRight');
      await expect(pw.tab(/^By member/)).toHaveAttribute('aria-selected', 'true');
      await expect(pw.tab(/^By member/)).toBeFocused();
      await page.keyboard.press('End');
      await expect(pw.tab(/^All open/)).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Home');
      await expect(pw.tab(/^Unassigned/)).toHaveAttribute('aria-selected', 'true');
      // Only the selected tab is in the Tab order.
      const stops = await page
        .getByRole('tablist', { name: 'Pod Work views' })
        .getByRole('tab')
        .evaluateAll((tabs) => tabs.map((t) => t.getAttribute('tabindex')));
      expect(stops).toEqual(['0', '-1', '-1']);
    });
  });

  test.describe('#563 W11: on a phone the strip is one scrolling chip row', () => {
    test('375 px: one row of 44 px chips, the scroll is inside the strip, never the page; reachable by keyboard', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}`);
      await expect(item(page, 'overdue')).toBeVisible();
      const tops = await page
        .locator('[data-strip-item]')
        .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      expect(new Set(tops).size, 'one row').toBe(1);
      for (const key of ['overdue', 'dueToday', 'asap', 'onHold']) {
        const b = await page
          .locator(`[data-strip-item="${key}"]`)
          .evaluate((e) => e.getBoundingClientRect().height);
        expect(b, `${key} target`).toBeGreaterThanOrEqual(44);
      }
      const stripBox = await box(strip(page));
      expect(stripBox.height, 'about one chip tall, not two rows of boxes').toBeLessThan(64);
      expect(stripBox.x + stripBox.width).toBeLessThanOrEqual(375);
      expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
      // The last chip is reachable by keyboard: focusing it scrolls the strip, not the page.
      await item(page, 'onHold').focus();
      await expect(item(page, 'onHold')).toBeFocused();
      await expect(item(page, 'onHold')).toBeInViewport();
      expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
      await shot(page, 'strip-chip-row-375x812');
      await axeClean(page, 'axe at 375, chip row');
      // 768 px: the strip is the My Work look, not boxes.
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(item(page, 'overdue')).toBeVisible();
      await shot(page, 'strip-768x1024');
    });
  });
});
