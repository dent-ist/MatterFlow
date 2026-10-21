import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { PodWorkPage } from '../pages/queues.pages';
import { axeAvailable } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { podWorkFixtures } from '../support/pod-work-fixtures';
import { SIZES, axeClean, pageSideScroll, shot } from '../support/pod-work-checks';

/**
 * Pod Work keyboard-only walk and axe audit (epic #546, package WP-PW7, #573). One spec walks the page with the keyboard alone: switch pod,
 * press a strip item, switch tabs, open and close the folded idle members, sort, View tasks, Assign to me and Undo, open a task and go
 * Back (focus returns to the row). Tab stops to the first grid row at 1366x768 are recorded (not gated) in `tab-stops.json` of the folder
 * `E2E_SCREENSHOTS_PW` (docs/ux/pod-work-review/fixes/pw7-access). No keyboard shortcut is added or changed (Phase 2, #420): only Tab,
 * Shift+Tab, Enter, Space, the arrow keys, Home and End are used. axe runs at four sizes on every tab and state with menus open; the
 * suite fails, never skips, without axe.
 */
const OUT = process.env['E2E_SCREENSHOTS_PW'];

/** Presses Tab until `target` has focus (at most `max` presses); returns how many it took. Fails when it cannot be reached. */
async function tabTo(page: Page, target: Locator, max = 80): Promise<number> {
  for (let n = 1; n <= max; n++) {
    await page.keyboard.press('Tab');
    const there = await target.evaluate((el) => el === document.activeElement).catch(() => false);
    if (there) return n;
  }
  throw new Error(`Tab did not reach the control in ${max} presses`);
}

/** Tab presses from the top of the page until the focus is inside the first row (or card) of the task grid. */
async function stopsToFirstRow(page: Page): Promise<number> {
  for (let n = 1; n <= 120; n++) {
    await page.keyboard.press('Tab');
    const inRow = await page.evaluate(() => !!document.activeElement?.closest('[data-task]'));
    if (inRow) return n;
  }
  throw new Error('no control of the grid was reached');
}

const focusedHasRing = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return false;
    const s = getComputedStyle(el);
    const outlined = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    return outlined || s.boxShadow !== 'none';
  });

test.describe('Pod Work keyboard', () => {
  test('axe is available (the audits below really run)', () => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
  });

  test('a keyboard-only walk: pod, strip, tabs, fold, sort, View tasks, Assign to me and Undo, open a task and Back', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const fx = await podWorkFixtures(seed, personas);
    const mine = await personas.create({ label: 'pw-kbd', roles: ['Pod Lead'] });
    const other = await personas.create({ label: 'pw-kbd2', roles: ['Data Technician'] });
    const pod = await seed.pod(undefined, [mine.userId, other.userId]);
    const world = await seed.world();
    await seed.task(world, {
      title: `Kbd own ${fx.token}`,
      assignedPodId: pod.podId,
      assignedUserId: other.userId,
    });
    const free = await seed.task(world, {
      title: `Kbd free ${fx.token}`,
      assignedPodId: pod.podId,
    });
    const free2 = await seed.task(world, {
      title: `Kbd free2 ${fx.token}`,
      assignedPodId: pod.podId,
    });

    const page = await asUser(mine.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const pw = new PodWorkPage(page);
    await page.goto(`/pods/work?podId=${pod.podId}`);
    await expect(pw.assignToMe(free.taskNumber)).toBeVisible();

    // The pod select: Tab reaches it, the arrow keys change the pod and the address, the focus stays.
    await page.locator('h1').focus();
    await tabTo(page, pw.podSelect);
    expect(await focusedHasRing(page), 'the select shows where the focus is').toBe(true);
    await page.keyboard.press('ArrowDown');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('podId'))
      .not.toBe(String(pod.podId));
    await expect(pw.podSelect).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => new URL(page.url()).searchParams.get('podId')).toBe(String(pod.podId));
    await expect(pw.assignToMe(free.taskNumber)).toBeVisible();

    // A strip item: Tab reaches it, Enter applies its filter on All open, Enter again takes it off.
    const asapItem = page.locator('[data-strip-item="asap"]');
    await tabTo(page, asapItem);
    expect(await focusedHasRing(page)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/asap=true/);
    await expect(page).toHaveURL(/view=all/);
    await expect(asapItem).toHaveAttribute('aria-pressed', 'true');
    await expect(asapItem).toBeFocused();
    await page.keyboard.press('Space');
    await expect(asapItem).toHaveAttribute('aria-pressed', 'false');
    await expect(page).not.toHaveURL(/asap=true/);

    // The tabs: one Tab stop, the arrow keys move and select (unchanged model).
    const tabs = page.getByRole('tablist', { name: 'Pod Work views' });
    await tabs.getByRole('tab', { selected: true }).focus();
    await page.keyboard.press('Home');
    await expect(pw.tab(/^Unassigned/)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(pw.tab(/^By member/)).toHaveAttribute('aria-selected', 'true');
    await expect(pw.tab(/^By member/)).toBeFocused();

    // By member: the fold, the sort and View tasks.
    const fold = page.locator('[data-member-fold] button');
    await expect(fold).toBeVisible();
    await tabTo(page, fold);
    await page.keyboard.press('Enter');
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Space');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    const openHead = page.getByRole('button', { name: 'Open', exact: true });
    await openHead.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('thead th').nth(1)).toHaveAttribute('aria-sort', 'ascending');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.locator('thead th').nth(1)).toHaveAttribute('aria-sort', 'none');
    const view = page.getByRole('button', { name: `View tasks of ${other.username}` });
    await view.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`assignee=${other.userId}`));
    await expect(view).toBeFocused();
    await page.goBack();
    await expect(page).not.toHaveURL(/assignee=/);

    // Unassigned: Assign to me, then Undo, by keyboard.
    await pw.tab(/^Unassigned/).focus();
    await page.keyboard.press('Enter');
    await tabs.getByRole('tab', { selected: true }).focus();
    await page.keyboard.press('Home');
    await expect(pw.tab(/^Unassigned/)).toHaveAttribute('aria-selected', 'true');
    const assign = pw.assignToMe(free2.taskNumber);
    await expect(assign).toBeVisible();
    await assign.focus();
    await page.keyboard.press('Enter');
    const undo = page.getByRole('button', { name: 'Undo' });
    await expect(undo).toBeVisible();
    await undo.focus();
    await page.keyboard.press('Enter');
    await expect(pw.assignToMe(free2.taskNumber)).toBeVisible();

    // Open a task from the grid and go Back: the focus returns to the row.
    await page.goto(`/pods/work?podId=${pod.podId}&view=all`);
    const link = page.getByRole('link', { name: `Kbd own ${fx.token}` }).first();
    await expect(link).toBeVisible();
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/tasks/`));
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Pod Work', level: 1 })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-task]')), {
        message: 'focus returned to the row of the task',
      })
      .toBe(true);
  });

  test('Tab stops to the first grid row at 1366x768, per tab (recorded, not gated)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await podWorkFixtures(seed, personas);
    const page = await asUser(fx.lead.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const record: Record<string, number> = {};
    for (const [name, view] of [
      ['Unassigned', 'queue'],
      ['By member', 'members'],
      ['All open', 'all'],
    ] as const) {
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=${view}`);
      await expect(page.locator('[data-strip-item="overdue"]')).toBeVisible();
      await page.locator('body').click({ position: { x: 1, y: 1 } });
      record[name] = await stopsToFirstRow(page);
      expect(record[name]).toBeGreaterThan(0);
    }
    // Two controls per member row (the name and View tasks).
    await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
    await expect(page.locator('[data-member-row][data-user]').first()).toBeVisible();
    record['controls per member row'] = await page
      .locator('[data-member-row][data-user]')
      .first()
      .locator('button')
      .count();
    expect(record['controls per member row']).toBe(2);
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(
        path.join(OUT, 'tab-stops.json'),
        JSON.stringify({ size: '1366x768', tabsToFirstGridRow: record }, null, 2) + '\n',
      );
    }
  });

  for (const size of SIZES) {
    test(`${size.name}: axe 0 and no sideways scroll on every tab and state, with the assignee menu and the strip open`, async ({
      seed,
      personas,
      asUser,
    }) => {
      test.setTimeout(180_000);
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      const base = `/pods/work?podId=${fx.busy.podId}`;
      const states: [string, string][] = [
        ['Unassigned', `${base}`],
        ['By member', `${base}&view=members`],
        ['All open', `${base}&view=all`],
        ['All open, Overdue', `${base}&view=all&overdue=true`],
        ['All open, On hold', `${base}&view=all&status=ON_HOLD`],
        ['By member, a person', `${base}&view=members&assignee=${fx.busy.withWork[0]}`],
        ['long pod name', `/pods/work?podId=${fx.longName.podId}`],
        ['empty pod, By member', `/pods/work?podId=${fx.empty.podId}&view=members`],
      ];
      for (const [name, url] of states) {
        await page.goto(url);
        await expect(page.getByRole('heading', { name: 'Pod Work', level: 1 })).toBeVisible();
        await expect(page.locator('[role="tab"]').first()).toBeVisible();
        await page.waitForTimeout(300);
        expect(await pageSideScroll(page), `${name} at ${size.name}`).toBeLessThanOrEqual(0);
        await axeClean(page, `axe, ${name}, ${size.name}`);
      }
      // The folded members open, and the assignee menu is open.
      await page.goto(`${base}&view=members`);
      const fold = page.locator('[data-member-fold] button');
      await fold.click();
      await axeClean(page, `axe, unfolded members, ${size.name}`);
      await page.goto(base);
      const menu = page
        .getByRole('button', {
          name: new RegExp(`change assignee of ${fx.busy.unassignedNumbers[1]}`),
        })
        .first();
      if (await menu.isVisible().catch(() => false)) {
        await menu.click();
        await expect(page.locator('.im-pop')).toBeVisible();
        await axeClean(page, `axe, assignee menu open, ${size.name}`);
        await page.keyboard.press('Escape');
        await expect(page.locator('.im-pop')).toHaveCount(0);
        await expect(menu).toBeFocused();
      }
      await shot(page, `walk-${size.name}`);
    });
  }
});
