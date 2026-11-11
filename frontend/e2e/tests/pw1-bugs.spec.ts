import { chooseWithKeyboard } from '../support/dropdown';
import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { MyWorkPage, PodWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeBestPractice, AxeViolation } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { podWorkFixtures } from '../support/pod-work-fixtures';
import { toasts } from '../support/toasts';

/**
 * Pod Work, first release (epic #546, package WP-PW1): BUG-1 and W4 (#548, the title and the capped Pod select), BUG-2 (#549, Pod.View
 * without Task.View), W9 and W14 (#550, "Assign to Me" with the keyboard) and
 * BUG-3 (#552, the strip follows assignments). Data: the fixtures of #547 (`support/pod-work-fixtures.ts`). Screenshots go to
 * `E2E_SCREENSHOTS_PW` when it is set (docs/ux/pod-work-review/fixes/pw1-bugs). axe runs at both desktop sizes and the suite fails, never skips,
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
          await expect(pw.podSelect).toContainText(pod.name.slice(0, 20));

          const h1 = await box(page.getByRole('heading', { name: 'Pod Work', level: 1 }));
          expect(h1.height, 'the title is one line').toBeLessThan(44);
          const sel = await box(pw.podSelect);
          expect(sel.x, 'select starts inside the window').toBeGreaterThanOrEqual(0);
          expect(sel.x + sel.width, 'select ends inside the window').toBeLessThanOrEqual(
            size.width,
          );
          expect(sel.width, 'the cap').toBeLessThanOrEqual(22 * 14 + 1);
          expect(sel.height, 'compact control (the shared dropdown: 36 px)').toBeLessThanOrEqual(
            36,
          );
          expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
          await expect(page.locator('mf-dropdown.pw-pod-select')).toHaveAttribute(
            'title',
            pod.name,
          );
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
      for (const size of [SIZES[0]]) {
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
      await page.setViewportSize({ width: 1366, height: 768 });
      const pw = new PodWorkPage(page);
      await page.goto(`/pods/work?podId=${fx.busy.podId}`);
      await expect(pw.podSelect).toBeVisible();
      // The shared dropdown, by keyboard: Down opens the list on the chosen pod, Down or Up walk to another pod, Enter chooses.
      const pods = await pw.podSelect.optionValues();
      expect(pods.length, 'the lead sees more than one pod').toBeGreaterThan(1);
      const other = pods.find((v) => v !== String(fx.busy.podId))!;
      await chooseWithKeyboard(pw.podSelect, other);
      await expect.poll(() => new URL(page.url()).searchParams.get('podId')).toBe(other);
      const now = new URL(page.url()).searchParams.get('podId');
      await page.reload();
      await expect(pw.podSelect).toHaveAttribute('data-value', now!);
      // A plain visit with no address comes back to the remembered Pod.
      await page.goto('/pods/work');
      await expect(pw.podSelect).toHaveAttribute('data-value', now!);
    });
  });

  test.describe('#549 BUG-2: Pod.View without Task.View', () => {
    test('no Pod Work item in the rail; the URL shows the 403 page with no request and no toast', async ({
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

      for (const size of [{ width: 1366, height: 768 }]) {
        await page.setViewportSize(size);
        await page.goto('/dashboard');
        await expect(page.getByRole('navigation', { name: 'Main' })).toBeAttached();
        await expect(
          page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pod Work' }),
        ).toHaveCount(0);
      }

      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto('/pods/work?podId=1');
      // The 403 page puts the address that was turned away back in the address bar, so the page is recognised by what it says.
      await expect(page.getByRole('heading', { name: "You don't have access." })).toBeVisible();
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
        await page.setViewportSize({ width: 1366, height: 768 });
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
      await expect(page.getByRole('heading', { name: "You don't have access." })).toBeVisible();
    });
  });

  test.describe('#550 W9 / W14: "Assign to Me" with the keyboard', () => {
    test('Assign to me works with the keyboard, and a read-only person has no link', async ({
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
      await page.setViewportSize({ width: 1366, height: 768 });
      const pw = new PodWorkPage(page);
      await page.goto(`/pods/work?podId=${pod.podId}`);
      const link = pw.assignToMe(task.taskNumber);
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(pw.row(task.taskNumber)).toContainText(
        (fx.lead.displayName ?? fx.lead.username).replace(/^.*\\/, ''),
      );

      const ro = await asUser(fx.readonly.username);
      await ro.setViewportSize({ width: 1366, height: 768 });
      await ro.goto(`/pods/work?podId=${fx.busy.podId}&view=queue`);
      await expect(ro.getByRole('row', { name: /TSK-/ }).first()).toContainText('Unassigned');
      await expect(ro.locator('[data-assign-link]')).toHaveCount(0);
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
    // The numbers are read once they have arrived: while they load the strip and the tab counts show "--".
    const numbers = async (page: Page) => {
      await expect.poll(async () => (await strip(page)).includes('--')).toBe(false);
      await expect
        .poll(async () => (await tabCounts(page)).some((t) => t.includes('--')))
        .toBe(false);
      return { strip: await strip(page), tabs: await tabCounts(page) };
    };

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
      expect(before.tabs.join('|')).toContain('Unassigned (2)');

      await pw.assignToMe(task.taskNumber).click();
      // The row leaves after its 4-second grace; the numbers follow at once and must equal a reload.
      await expect(pw.tab(/Unassigned/)).toContainText('(1)');
      await expect(pw.tab(/By Member/)).toContainText('(1)');
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
      await expect(pw.tab(/Unassigned/)).toContainText('(1)');
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(pw.tab(/Unassigned/)).toContainText('(2)');
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
      const pw = new PodWorkPage(page);
      await page.goto(`/pods/work?podId=${pod.podId}&view=members`);
      // The idle member is folded under "Show 1 member with no open work": open it to read both numbers.
      const open = (who: string) =>
        page.locator('[data-members] tbody tr').filter({ hasText: who }).locator('td').first();
      await expect(open(mine.username)).toHaveText('1');
      await page.getByRole('button', { name: /Show 1 member with no open work/ }).click();
      await expect(open(other.username)).toHaveText('0');
      await page.getByRole('button', { name: `View tasks of ${mine.username}` }).click();
      await page
        .getByRole('button', { name: new RegExp(`change assignee of ${task.taskNumber}`) })
        .click();
      await page
        .locator('.im-pop')
        .getByRole('menuitemradio', { name: other.username.replace(/^.*\\/, '') })
        .click();
      await expect(open(mine.username)).toHaveText('0');
      await expect(open(other.username)).toHaveText('1');
      const after = await numbers(page);
      await page.reload();
      await expect(pw.tab(/By Member/)).toContainText('(1)');
      expect(after.tabs).toEqual((await numbers(page)).tabs);
    });
  });
});
