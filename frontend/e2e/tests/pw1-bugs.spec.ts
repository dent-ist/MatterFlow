import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { MyWorkPage, PodWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeBestPractice, AxeViolation } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { failApi } from '../support/personas';
import { podWorkFixtures } from '../support/pod-work-fixtures';
import { toasts } from '../support/toasts';

/**
 * Pod Work, first release (epic #546, package WP-PW1): BUG-1 and W4 (#548, the title and the capped Pod select), BUG-2 (#549, Pod.View
 * without Task.View), W9 and W14 (#550, "Assign to me" in view from 640 to 899 px), BUG-4 (#551, no page-level sideways scroll at 375 px) and
 * BUG-3 (#552, the strip follows assignments). Data: the fixtures of #547 (`support/pod-work-fixtures.ts`). Screenshots go to
 * `E2E_SCREENSHOTS_PW` when it is set (docs/ux/pod-work-review/fixes/pw1-bugs). axe runs at the four sizes and the suite fails, never skips,
 * when axe is not available (set E2E_AXE_PATH to a copy of axe.min.js).
 */
const OUT = process.env['E2E_SCREENSHOTS_PW'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

async function axeClean(page: Page, what: string): Promise<void> {
  const found: AxeViolation[] = await axeBestPractice(page);
  // Skip link and landmark findings belong to the App shell epic (#585), not to this page.
  const own = found.filter((v) => !['skip-link', 'region'].includes(v.id));
  expect(own, what).toEqual([]);
}

const pageSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const box = async (locator: Locator) => {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not visible');
  return b;
};

test.describe('Pod Work first release', () => {
  test('axe is available (the audits below really run)', () => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
  });

  test.describe('#548 BUG-1 / W4: the title never wraps and the Pod select is capped', () => {
    for (const size of SIZES) {
      test(`${size.name}: one-line title, select fully in view, axe 0, no sideways scroll`, async ({
        seed,
        personas,
        asUser,
      }) => {
        const fx = await podWorkFixtures(seed, personas);
        const page = await asUser(fx.lead.username);
        await page.setViewportSize({ width: size.width, height: size.height });
        const pw = new PodWorkPage(page);
        for (const pod of [fx.busy, fx.longName]) {
          await page.goto(`/pods/work?podId=${pod.podId}`);
          await expect(page.getByRole('heading', { name: 'Pod Work', level: 1 })).toBeVisible();
          await expect(pw.podSelect.locator('option:checked')).toContainText(pod.name.slice(0, 20));

          const h1 = await box(page.getByRole('heading', { name: 'Pod Work', level: 1 }));
          expect(h1.height, 'the title is one line').toBeLessThan(44);
          const sel = await box(pw.podSelect);
          expect(sel.x, 'select starts inside the window').toBeGreaterThanOrEqual(0);
          expect(sel.x + sel.width, 'select ends inside the window').toBeLessThanOrEqual(
            size.width,
          );
          expect(sel.width, 'the cap').toBeLessThanOrEqual(22 * 14 + 1);
          expect(sel.height, 'compact control').toBeLessThanOrEqual(33);
          expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
          await expect(pw.podSelect).toHaveAttribute('title', pod.name);
        }
        await shot(page, `bug1-long-pod-name-${size.name}`);
        await axeClean(page, `axe at ${size.name}`);
      });
    }

    test('the title row starts at the same height as My Work and Task Queue (12 px under the top of the main area)', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      for (const size of [SIZES[0], SIZES[2]]) {
        await page.setViewportSize({ width: size.width, height: size.height });
        const tops: number[] = [];
        await new MyWorkPage(page).open();
        tops.push((await box(page.getByRole('heading', { level: 1 }))).y);
        await new TaskQueuePage(page).open();
        tops.push((await box(page.getByRole('heading', { level: 1 }))).y);
        await page.goto(`/pods/work?podId=${fx.longName.podId}`);
        await expect(page.getByRole('heading', { name: 'Pod Work', level: 1 })).toBeVisible();
        tops.push((await box(page.getByRole('heading', { level: 1 }))).y);
        expect(tops[2], `Pod Work against My Work and Task Queue at ${size.name}`).toBe(tops[0]);
        expect(tops[1]).toBe(tops[0]);
      }
    });

    test('the capped select works with the keyboard: Arrow keys change the Pod, the address and the remembered Pod follow', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 768, height: 1024 });
      const pw = new PodWorkPage(page);
      await page.goto(`/pods/work?podId=${fx.busy.podId}`);
      await expect(pw.podSelect).toBeVisible();
      await pw.podSelect.focus();
      await page.keyboard.press('ArrowDown');
      await expect
        .poll(() => new URL(page.url()).searchParams.get('podId'))
        .not.toBe(String(fx.busy.podId));
      const now = new URL(page.url()).searchParams.get('podId');
      await page.reload();
      await expect(pw.podSelect).toHaveValue(now!);
      // A plain visit with no address comes back to the remembered Pod.
      await page.goto('/pods/work');
      await expect(pw.podSelect).toHaveValue(now!);
    });
  });

  test.describe('#549 BUG-2: Pod.View without Task.View', () => {
    test('no Pod Work item in the rail (desktop, tablet) or the phone menu; the URL shows the 403 page with no request and no toast', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.podNoTask.username);
      const requests: string[] = [];
      page.on('request', (r) => {
        if (r.url().includes('/api/v1/pod-work')) requests.push(r.url());
      });

      for (const size of [
        { width: 1440, height: 900 },
        { width: 768, height: 1024 },
      ]) {
        await page.setViewportSize(size);
        await page.goto('/dashboard');
        await expect(page.getByRole('navigation', { name: 'Main' })).toBeAttached();
        await expect(
          page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pod Work' }),
        ).toHaveCount(0);
      }
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/dashboard');
      await page.getByTestId('nav-menu-button').click();
      await expect(
        page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard' }),
      ).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pod Work' }),
      ).toHaveCount(0);

      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto('/pods/work?podId=1');
      // The 403 page puts the address that was turned away back in the address bar, so the page is recognised by what it says.
      await expect(
        page.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();
      await expect(page.locator('[data-asked-path]')).toHaveText('/pods/work?podId=1');
      await page.waitForTimeout(500);
      expect(requests, 'Pod Work asks the server for nothing').toEqual([]);
      await expect(toasts(page)).toHaveCount(0);
      await shot(page, 'bug2-403-1366x768');
    });

    test('Pod Lead, read-only and Director (Task.View) see the item and the page', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      for (const person of [fx.lead, fx.readonly, fx.director]) {
        const page = await asUser(person.username);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/my-work');
        await page
          .getByRole('navigation', { name: 'Main' })
          .getByRole('link', { name: 'Pod Work' })
          .click();
        await expect(page).toHaveURL(/\/pods\/work/);
        await expect(page.getByRole('heading', { name: 'Pod Work', level: 1 })).toBeVisible();
        await expect(toasts(page)).toHaveCount(0);
      }
    });

    test('a person with no Pod.View gets the 403 page too', async ({ personas, asUser }) => {
      const person = await personas.create({ label: 'pw-notview', permissions: ['Task.View'] });
      const page = await asUser(person.username);
      await page.goto('/pods/work');
      await expect(
        page.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();
    });
  });

  test.describe('#550 W9 / W14: "Assign to me" in view from 640 to 899 px', () => {
    for (const width of [640, 768, 899]) {
      test(`${width}x1024: the link of the first row is inside the grid without scrolling; Matter Number is a column of the chooser`, async ({
        seed,
        personas,
        asUser,
      }) => {
        const fx = await podWorkFixtures(seed, personas);
        const page = await asUser(fx.lead.username);
        await page.setViewportSize({ width, height: 1024 });
        const pw = new PodWorkPage(page);
        await page.goto(`/pods/work?podId=${fx.busy.podId}`);
        const link = pw.assignToMe(fx.busy.unassignedNumbers[0]);
        await expect(link).toBeVisible();
        const grid = await box(page.getByRole('region', { name: /Pod Work/ }).first());
        const l = await box(link);
        expect(l.x, 'link starts inside the grid').toBeGreaterThanOrEqual(grid.x);
        expect(l.x + l.width, 'link ends inside the grid').toBeLessThanOrEqual(grid.x + grid.width);
        await expect(page.getByRole('columnheader', { name: /Matter Number/ })).toHaveCount(0);
        await expect(page.getByRole('columnheader', { name: /Assignee/ })).toBeVisible();
        expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
        if (width === 768) {
          await shot(page, 'w9-assign-link-768x1024');
          await axeClean(page, 'axe at 768 with the link only');
        }
      });
    }

    test("from 900 px the columns are today's; below 640 px the cards are unchanged", async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      const pw = new PodWorkPage(page);
      await page.setViewportSize({ width: 900, height: 1024 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}`);
      await expect(page.getByRole('columnheader', { name: /Matter Number/ })).toBeVisible();
      await expect(pw.assignToMe(fx.busy.unassignedNumbers[0])).toBeVisible();
      await expect(page.getByRole('row', { name: /TSK-/ }).first()).toContainText('Unassigned');

      await page.setViewportSize({ width: 639, height: 900 });
      await expect(page.locator('li[data-task]').first()).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(pw.assignToMe(fx.busy.unassignedNumbers[0])).toBeVisible();
    });

    test('a column choice made by the person wins over the narrow default', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}`);
      await expect(page.getByRole('columnheader', { name: /Assignee/ })).toBeVisible();
      await page.getByRole('button', { name: 'Columns', exact: true }).click();
      await page.getByRole('checkbox', { name: /Matter Number/ }).check();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('columnheader', { name: /Matter Number/ })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('columnheader', { name: /Matter Number/ })).toBeVisible();
    });

    test('Assign to me works with the keyboard from 768 px, and a read-only person has no link', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const pod = await seed.pod(undefined, [fx.lead.userId, fx.readonly.userId]);
      const task = await seed.task(fx.busy.world, {
        title: `PW keyboard ${fx.token}`,
        assignedPodId: pod.podId,
      });
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 768, height: 1024 });
      const pw = new PodWorkPage(page);
      await page.goto(`/pods/work?podId=${pod.podId}`);
      const link = pw.assignToMe(task.taskNumber);
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(pw.row(task.taskNumber)).toContainText(fx.lead.displayName ?? fx.lead.username);

      const ro = await asUser(fx.readonly.username);
      await ro.setViewportSize({ width: 768, height: 1024 });
      await ro.goto(`/pods/work?podId=${fx.busy.podId}&view=queue`);
      await expect(ro.getByRole('row', { name: /TSK-/ }).first()).toContainText('Unassigned');
      await expect(ro.locator('[data-assign-link]')).toHaveCount(0);
    });
  });

  test.describe('#551 BUG-4: no page-level sideways scroll on any tab or state', () => {
    for (const size of [SIZES[3], SIZES[2]]) {
      test(`${size.name}: the four tabs, the empty pod, the no-pod state and the error state`, async ({
        seed,
        personas,
        asUser,
      }) => {
        const fx = await podWorkFixtures(seed, personas);
        const page = await asUser(fx.lead.username);
        await page.setViewportSize({ width: size.width, height: size.height });
        const pw = new PodWorkPage(page);
        const seen: [string, number][] = [];
        const check = async (what: string) => {
          await page.waitForTimeout(300);
          seen.push([what, await pageSideScroll(page)]);
        };

        for (const view of ['queue', 'members', 'attention', 'all']) {
          await page.goto(`/pods/work?podId=${fx.busy.podId}&view=${view}`);
          await expect(pw.tab(/./).first()).toBeVisible();
          await expect(
            page.getByRole('row').nth(1).or(page.locator('li[data-task]').first()).first(),
          ).toBeVisible();
          await check(`busy pod, ${view}`);
          if (view === 'members') await shot(page, `bug4-members-${size.name}`);
        }
        await page.goto(`/pods/work?podId=${fx.longName.podId}`);
        await expect(pw.tab(/./).first()).toBeVisible();
        await check('long pod name');

        await page.goto(`/pods/work?podId=${fx.empty.podId}&view=members`);
        await expect(page.getByText('No members yet.')).toBeVisible();
        await check('empty pod, By member');

        const none = await asUser(fx.noPod.username);
        await none.setViewportSize({ width: size.width, height: size.height });
        await none.goto('/pods/work');
        await expect(none.locator('[data-empty], [data-pod-list]').first()).toBeVisible();
        seen.push(['person in no pod', await pageSideScroll(none)]);

        const unfail = await failApi(page, '**/api/v1/pod-work*', 500);
        await page.goto(`/pods/work?podId=${fx.busy.podId}`);
        await expect(page.getByText(/Couldn.t load/).first()).toBeVisible();
        await check('error state');
        await unfail();

        for (const [what, over] of seen) {
          expect(over, `${what} at ${size.name}`).toBeLessThanOrEqual(0);
        }
      });
    }

    test('the By member table scrolls inside its own named, keyboard-reachable region at 375 px; the page does not', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
      const region = page.getByRole('region', { name: /Pod members/ });
      await expect(region).toBeVisible();
      await expect(region).toHaveAttribute('tabindex', '0');
      await expect(page.getByRole('button', { name: /Show tasks of/ }).first()).toBeVisible();
      expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
      await axeClean(page, 'axe at 375, By member');
    });
  });

  test.describe('#552 BUG-3: the strip follows assignments', () => {
    const strip = (page: Page) =>
      page
        .locator('[data-strip]')
        .first()
        .evaluate((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim());
    const tabCounts = (page: Page) =>
      page
        .getByRole('tablist', { name: 'Pod Work views' })
        .getByRole('tab')
        .evaluateAll((tabs) => tabs.map((t) => (t.textContent ?? '').replace(/\s+/g, ' ').trim()));
    const numbers = async (page: Page) => ({
      strip: await strip(page),
      tabs: await tabCounts(page),
    });

    test('after Assign to me and after Undo the strip and the tabs equal a fresh reload', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const mine = await personas.create({ label: 'pw-strip', roles: ['Pod Lead'] });
      const pod = await seed.pod(undefined, [mine.userId]);
      const world = await seed.world();
      const tag = fx.token;
      const task = await seed.task(world, { title: `Strip ${tag}`, assignedPodId: pod.podId });
      await seed.task(world, { title: `Strip other ${tag}`, assignedPodId: pod.podId });

      const page = await asUser(mine.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      const pw = new PodWorkPage(page);
      await page.goto(`/pods/work?podId=${pod.podId}`);
      await expect(pw.assignToMe(task.taskNumber)).toBeVisible();
      const before = await numbers(page);
      expect(before.strip).toContain('Unassigned 2');

      await pw.assignToMe(task.taskNumber).click();
      // The row leaves after its 4-second grace; the numbers follow at once and must equal a reload.
      await expect(page.locator('[data-strip]').first()).toContainText('Unassigned 1');
      await expect(page.locator('[data-strip]').first()).toContainText('Assigned 1');
      const after = await numbers(page);
      await page.reload();
      await expect(pw.tab(/Unassigned/)).toBeVisible();
      expect(after).toEqual(await numbers(page));

      // Undo: the numbers come back, again equal to a reload.
      await page.goto(`/pods/work?podId=${pod.podId}`);
      await page.goto(`/pods/work?podId=${pod.podId}&view=all`);
      await expect(page.getByRole('row', { name: new RegExp(task.taskNumber) })).toBeVisible();
      await page.goto(`/pods/work?podId=${pod.podId}`);
      const second = await seed.task(world, {
        title: `Strip undo ${tag}`,
        assignedPodId: pod.podId,
      });
      await page.reload();
      await pw.assignToMe(second.taskNumber).click();
      await expect(page.locator('[data-strip]').first()).toContainText('Unassigned 1');
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.locator('[data-strip]').first()).toContainText('Unassigned 2');
      const undone = await numbers(page);
      await page.reload();
      await expect(pw.tab(/Unassigned/)).toBeVisible();
      expect(undone).toEqual(await numbers(page));
    });

    test('a reassignment from the By member tab updates the member table, the strip and the tabs too', async ({
      seed,
      personas,
      asUser,
    }) => {
      const mine = await personas.create({ label: 'pw-strip2', roles: ['Pod Lead'] });
      const other = await personas.create({ label: 'pw-strip3', roles: ['Data Technician'] });
      const pod = await seed.pod(undefined, [mine.userId, other.userId]);
      const world = await seed.world();
      const task = await seed.task(world, {
        title: `Strip move ${pod.podId}`,
        assignedPodId: pod.podId,
        assignedUserId: mine.userId,
      });

      const page = await asUser(mine.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/pods/work?podId=${pod.podId}&view=members`);
      const open = (who: string) =>
        page.locator('[data-members] tbody tr').filter({ hasText: who }).locator('td').first();
      await expect(open(mine.username)).toHaveText('1');
      await expect(open(other.username)).toHaveText('0');
      await page
        .getByRole('button', { name: /Show tasks of/ })
        .first()
        .click();
      await page
        .getByRole('button', { name: new RegExp(`change assignee of ${task.taskNumber}`) })
        .click();
      await page.locator('.im-pop').getByRole('menuitemradio', { name: other.username }).click();
      await expect(open(mine.username)).toHaveText('0');
      await expect(open(other.username)).toHaveText('1');
      const after = await numbers(page);
      await page.reload();
      await expect(open(other.username)).toHaveText('1');
      expect(after).toEqual(await numbers(page));
    });
  });
});
