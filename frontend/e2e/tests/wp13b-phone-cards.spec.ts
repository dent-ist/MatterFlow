import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { MyWorkPage } from '../pages/queues.pages';
import { Api } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * WP13b (#192, with #173 and #184): below 640 px the work lists are task cards, not a table. This file covers My Work, on all four tabs:
 * the cards and their three chips (Priority, Due, Status), the hold reason as its own line, the assignee line of Created by me, the Closed
 * layout (title, client and matter, "Closed Oct 16", Status), the chips as the inline editors (44 px, the same dialog and Undo toast),
 * the keyboard model (J, K, S), group headers, the pager and the states. Widths 320, 375, 414 and 600 are cards, 640 and 768 stay the table.
 * Every test has its own user and tagged tasks. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/my-work-review/fixes/wp-cards).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

/** The page does not scroll sideways, and (cards) nothing inside the list does either. */
const noSideScroll = (page: Page, inner = true) =>
  page.evaluate(
    (checkInner) =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth &&
      (!checkInner ||
        Array.from(document.querySelectorAll<HTMLElement>('.wt-wrap')).every(
          (w) => w.scrollWidth <= w.clientWidth + 1,
        )),
    inner,
  );

const PHONES = [320, 375, 414, 600] as const;
const PERMS = [
  'Task.View',
  'Task.Create',
  'Task.ChangeStatus',
  'Task.SetPriority',
  'Task.Assign',
  'Matter.View',
];

const cards = (page: Page) => page.locator('li[data-task]');
const card = (page: Page, title: string) => cards(page).filter({ hasText: title });

interface Fixture {
  username: string;
  userId: number;
  tag: string;
  titles: Record<string, string>;
}

/** A user with an overdue, a due-today, an ASAP, an on-hold, a tomorrow, a cancelled and two created-by-me tasks (one handed on, one unassigned). */
async function setup(
  seed: Seeder,
  admin: Api,
  perms = PERMS,
  otherLabel = 'cards-other',
): Promise<Fixture> {
  const role = await seed.role(perms, 'E2E cards');
  const me = await seed.user([role.name], 'cards');
  const other = await seed.user(['Data Technician'], otherLabel);
  const world = await seed.world();
  const tag = uid();
  const titles = {
    overdue: `Overdue ${tag}`,
    today: `Today ${tag}`,
    asap: `Asap ${tag}`,
    hold: `Hold ${tag}`,
    tomorrow: `Tomorrow ${tag}`,
    cancelled: `Cancelled ${tag}`,
    created: `Created ${tag}`,
    unassigned: `Unassigned ${tag}`,
  };
  const mine = { assignedUserId: me.userId };
  await seed.task(world, { title: titles.overdue, ...mine, dueDate: dateInZone(FIRM_ZONE, -2) });
  await seed.task(world, { title: titles.today, ...mine, dueDate: dateInZone(FIRM_ZONE, 0) });
  await seed.task(world, { title: titles.asap, ...mine, isAsap: true });
  const held = await seed.task(world, {
    title: titles.hold,
    ...mine,
    dueDate: dateInZone(FIRM_ZONE, 5),
  });
  await seed.task(world, { title: titles.tomorrow, ...mine, dueDate: dateInZone(FIRM_ZONE, 1) });
  const cancelled = await seed.task(world, { title: titles.cancelled, ...mine });
  // Held and cancelled through the API, so the cards show a hold line and the Closed tab has a row.
  await new TaskApi(admin, held.taskId).changeStatus('ON_HOLD', 'Waiting for the custodian');
  await new TaskApi(admin, cancelled.taskId).changeStatus('CANCELLED', 'Not needed');
  // Created by the signed-in user (through their own session) and handed to someone else; the second one nobody has.
  const asMe = await Api.as(me.username);
  await seed.task(world, { title: titles.created, assignedUserId: other.userId }, asMe);
  await seed.task(world, { title: titles.unassigned }, asMe);
  await asMe.dispose();
  return { username: me.username, userId: me.userId, tag, titles };
}

test.describe('WP13b: phone cards on My Work', () => {
  let fx: Fixture;

  test('a long assignee account name is cut with an ellipsis: it never covers the task number or widens the card at 320 and 375 px (final verification, 1 run in 30 failed with a long random name)', async ({
    seed,
    admin,
    asUser,
  }) => {
    const long = await setup(
      seed,
      admin,
      PERMS,
      'cards-other-with-a-very-long-account-name-for-the-card',
    );
    const page = await asUser(long.username);
    const myWork = new MyWorkPage(page);
    for (const width of [320, 375]) {
      await page.setViewportSize({ width, height: 812 });
      await myWork.open('?view=createdByMe');
      const card = page.locator('li[data-task]').filter({ hasText: long.titles.created });
      await expect(card).toBeVisible();
      const who = await card.locator('[data-col="assignee"]').boundingBox();
      const num = await card.locator('.tc-num').boundingBox();
      expect(who!.x + who!.width, `assignee right edge at ${width}`).toBeLessThanOrEqual(
        num!.x + 0.5,
      );
      expect(await noSideScroll(page), `createdByMe at ${width}`).toBe(true);
    }
  });

  test.beforeAll(async ({ seed, admin }) => {
    fx = await setup(seed, admin);
  });

  for (const width of PHONES) {
    test(`${width} px: every tab is a list of cards with its chips, no table and no sideways scroll`, async ({
      asUser,
    }) => {
      const page = await asUser(fx.username);
      await page.setViewportSize({ width, height: 812 });
      const myWork = new MyWorkPage(page);
      for (const view of ['active', 'dueSoon', 'completed', 'createdByMe']) {
        await myWork.open(`?view=${view}`);
        // (The placeholder cards are a list too: wait for a real card.)
        await expect(cards(page).first(), view).toBeVisible();
        await expect(page.locator('table.wt')).toHaveCount(0);
        // Every card says its Status; the open tabs say Priority and Due too.
        for (const c of await cards(page).all()) {
          await expect(c.locator('[data-col="status"]')).toBeVisible();
          if (view === 'active' || view === 'dueSoon') {
            await expect(c.locator('[data-col="priority"]')).toBeVisible();
            await expect(c.locator('[data-col="due"]')).toBeVisible();
          }
        }
        expect(await noSideScroll(page), `${view} at ${width}`).toBe(true);
        await axeClean(page, `${view} at ${width}`);
      }
    });
  }

  for (const width of [640, 641, 768]) {
    test(`${width} px: the table, not cards`, async ({ asUser }) => {
      const page = await asUser(fx.username);
      await page.setViewportSize({ width, height: 900 });
      await new MyWorkPage(page).open();
      await expect(page.getByRole('table', { name: /My Work/ })).toBeVisible();
      await expect(page.locator('ul.tc-list')).toHaveCount(0);
      // The table scrolls inside its own box; the page does not.
      expect(await noSideScroll(page, false)).toBe(true);
      await axeClean(page, `table at ${width}`);
    });
  }

  test('a card: title link, client and matter, the three chips, the hold line (no "Waiting:"), the task number', async ({
    asUser,
  }) => {
    const page = await asUser(fx.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await new MyWorkPage(page).open();
    const overdue = card(page, fx.titles.overdue);
    const link = overdue.getByRole('link', { name: fx.titles.overdue, exact: true });
    await expect(link).toHaveAttribute('href', /\/tasks\/\d+\?from=my-work/);
    await expect(overdue.getByRole('heading', { level: 2 })).toContainText(fx.titles.overdue);
    // Line 2: client . matter reference (a link, the person has Matter.View).
    await expect(overdue.locator('[data-card-matter]')).toContainText('E2E Client');
    await expect(overdue.locator('[data-card-matter] a')).toHaveAttribute('href', /\/matters\/\d+/);
    // Line 3: Priority, two-line Due (date over "Overdue 2d"), Status.
    const chips = overdue.locator('[data-card-chips]');
    await expect(chips.locator('[data-col="priority"]')).toContainText('Normal');
    await expect(chips.locator('[data-col="due"]')).toContainText('Overdue 2d');
    await expect(chips.locator('[data-col="status"]')).toContainText('In Progress');
    await expect(overdue.locator('.tc-num')).toHaveText(/^\s*TSK-\d+\s*$/);
    await expect(card(page, fx.titles.today).locator('[data-col="due"]')).toContainText(
      'Due today',
    );
    await expect(card(page, fx.titles.asap).locator('[data-col="due"]')).toContainText('ASAP');
    await expect(card(page, fx.titles.tomorrow).locator('[data-col="due"]')).toContainText(
      'Tomorrow',
    );
    // The hold reason is its own line; the old "Waiting:" line under the title is gone.
    const held = card(page, fx.titles.hold);
    await expect(held.locator('[data-hold-chip]')).toContainText('Waiting for the custodian');
    await expect(page.locator('[data-hold-hint]')).toHaveCount(0);
    await expect(page.getByText('Waiting: ')).toHaveCount(0);
    await expect(held.locator('[data-col="status"]')).toContainText('On Hold');
    // The row's accessible name is one item: number and title.
    await expect(overdue.getByRole('article')).toHaveAttribute('aria-label', /^TSK-\d+, Overdue /);
    await shot(page, 'my-work-active-375x812');
  });

  test('Closed: title, client and matter, "Closed <date>" and the Status, no Due or Priority', async ({
    asUser,
  }) => {
    const page = await asUser(fx.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await new MyWorkPage(page).open('?view=completed');
    const c = card(page, fx.titles.cancelled);
    await expect(c).toHaveCount(1);
    await expect(c.locator('[data-card-matter]')).toContainText('E2E Client');
    await expect(c.locator('[data-col="closed"]')).toHaveText(
      /^Closed [A-Z][a-z]{2} \d{1,2}(, \d{4})?$/,
    );
    await expect(c.locator('[data-col="status"]')).toContainText('Cancelled');
    await expect(c.locator('[data-col="due"]')).toHaveCount(0);
    await expect(c.locator('[data-col="priority"]')).toHaveCount(0);
    await shot(page, 'my-work-closed-375x812');
  });

  test('Created by me: the assignee line with initials, Unassigned in italics, and the number', async ({
    asUser,
  }) => {
    const page = await asUser(fx.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await new MyWorkPage(page).open('?view=createdByMe');
    const handed = card(page, fx.titles.created);
    await expect(handed.locator('[data-card-meta] [data-avatar]')).toHaveText(/^[A-Z]{1,2}$/);
    // The person may assign, so the name is the Assignee button.
    await expect(handed.getByRole('button', { name: /change assignee of TSK-/ })).toBeVisible();
    const nobody = card(page, fx.titles.unassigned);
    await expect(
      nobody.getByRole('button', { name: /^Unassigned, change assignee/ }),
    ).toBeVisible();
    await expect(nobody.locator('[data-card-meta] .tc-num')).toHaveText(/^\s*TSK-\d+\s*$/);
    await shot(page, 'my-work-created-by-me-375x812');
  });

  test('read-only: without edit permissions the chips and the assignee are plain text', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(['Task.View'], 'E2E cards read-only');
    const me = await seed.user([role.name], 'cards-ro');
    const world = await seed.world();
    const title = `Plain ${uid()}`;
    await seed.task(world, { title, assignedUserId: me.userId });
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await new MyWorkPage(page).open();
    const c = card(page, title);
    await expect(c).toHaveCount(1);
    await expect(c.locator('[data-inline-trigger]')).toHaveCount(0);
    await expect(c.locator('[data-col="status"]')).toContainText('In Progress');
    await expect(c.locator('[data-card-matter] a')).toHaveCount(0);
  });

  test('chips are the inline editors: 44 px targets, the Hold dialog and the Undo toast work as on the table', async ({
    asUser,
  }) => {
    const page = await asUser(fx.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await new MyWorkPage(page).open();
    const c = card(page, fx.titles.tomorrow);
    const status = c.getByRole('button', { name: /change status of/ });
    const priority = c.getByRole('button', { name: /change priority of/ });
    for (const trigger of [status, priority]) {
      const box = (await trigger.boundingBox())!;
      expect(box.height, 'target height').toBeGreaterThanOrEqual(44);
      expect(box.width, 'target width').toBeGreaterThanOrEqual(44);
    }
    // Hold: the same reason dialog, then the chip and the hold line.
    await status.click();
    await page.locator('[data-option="HOLD"]').click();
    const dialog = page.getByRole('dialog').filter({ has: page.locator('[data-reason-body]') });
    await dialog.getByLabel(/Comment|Reason/).fill('Parked by the partner');
    await dialog.getByRole('button', { name: /Put on hold|Hold/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(c.locator('[data-col="status"]')).toContainText('On Hold');
    // (The reason itself arrives with the next load of the list.)
    await page.reload();
    await expect(c.locator('[data-hold-chip]')).toContainText('Parked by the partner');
    // Priority: a new value, the Undo toast, and Undo puts it back.
    await priority.click();
    await page.getByRole('menuitemradio', { name: 'High' }).click();
    await expect(c.locator('[data-col="priority"]')).toContainText('High');
    await page.locator('[data-undo-toast]').getByRole('button', { name: 'Undo' }).click();
    await expect(c.locator('[data-col="priority"]')).toContainText('Normal');
    await shot(page, 'my-work-chip-menu-375x812');
  });

  test('keyboard: J and K move between the cards, S opens the Status menu of the card, Escape brings focus back to its title', async ({
    asUser,
  }) => {
    const page = await asUser(fx.username);
    await page.setViewportSize({ width: 414, height: 800 });
    await new MyWorkPage(page).open();
    const titles = page.locator('li[data-task] a.wt-title');
    await titles.first().focus();
    const first = (await titles.first().textContent())!.trim();
    await page.keyboard.press('j');
    const second = (await titles.nth(1).textContent())!.trim();
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe(second);
    await page.keyboard.press('k');
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe(first);
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe(second);
    await page.keyboard.press('s');
    await expect(page.locator('.im-pop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.im-pop')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim()))
      .toBe(second);
  });

  test('Back from a task gives focus to the title of the card that was opened', async ({
    asUser,
  }) => {
    const page = await asUser(fx.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await new MyWorkPage(page).open();
    const link = card(page, fx.titles.today).getByRole('link', {
      name: fx.titles.today,
      exact: true,
    });
    await link.click();
    await expect(page).toHaveURL(/\/tasks\/\d+/);
    await page.goBack();
    await expect(card(page, fx.titles.today)).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim()))
      .toBe(fx.titles.today);
  });

  test('group headers from the Due sort: one 44 px button per group, collapsing hides its cards', async ({
    asUser,
  }) => {
    const page = await asUser(fx.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await new MyWorkPage(page).open('?group=due');
    const headers = page.locator('li.tc-group');
    await expect(headers.first()).toBeVisible();
    const names = await headers.locator('.tc-group__name').allTextContents();
    expect(names).toContain('Overdue');
    const overdue = headers.filter({ hasText: 'Overdue' }).getByRole('button');
    expect((await overdue.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(overdue).toHaveAttribute('aria-expanded', 'true');
    await expect(card(page, fx.titles.overdue)).toBeVisible();
    await overdue.click();
    await expect(overdue).toHaveAttribute('aria-expanded', 'false');
    await expect(card(page, fx.titles.overdue)).toBeHidden();
    await expect(card(page, fx.titles.today)).toBeVisible();
    await overdue.click();
    await expect(card(page, fx.titles.overdue)).toBeVisible();
    await axeClean(page, 'grouped cards');
    await shot(page, 'my-work-grouped-375x812');
  });

  test('loading shows placeholder cards, an error shows Retry, an empty tab says so, all in card mode', async ({
    asUser,
  }) => {
    const page = await asUser(fx.username);
    await page.setViewportSize({ width: 375, height: 812 });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/v1/my-work?*', async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto('/my-work');
    await expect(page.locator('li[data-skeleton]')).toHaveCount(6);
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading tasks' }).first(),
    ).toBeAttached();
    await shot(page, 'my-work-loading-375x812');
    release();
    await expect(cards(page).first()).toBeVisible();
    await page.unroute('**/api/v1/my-work?*');

    await page.route('**/api/v1/my-work?*', (route) => route.fulfill({ status: 500, body: '{}' }));
    await page.reload();
    await expect(page.locator('[data-error]')).toContainText("Couldn't load tasks.");
    await shot(page, 'my-work-error-375x812');
    await page.unroute('**/api/v1/my-work?*');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(cards(page).first()).toBeVisible();

    await new MyWorkPage(page).open('?view=active&q=zzz-no-such-task');
    await expect(page.locator('[data-empty="filtered"]')).toContainText(
      'No tasks match these filters',
    );
    await page.getByRole('button', { name: 'Clear filters' }).last().click();
    await expect(cards(page).first()).toBeVisible();
  });

  test('text at 200 percent does not clip or scroll the page sideways', async ({ asUser }) => {
    const page = await asUser(fx.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await new MyWorkPage(page).open();
    await page.addStyleTag({
      content: 'html { font-size: 200% !important; } .tc, .tc * { font-size: revert-layer; }',
    });
    await expect(cards(page).first()).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
    const overflow = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll<HTMLElement>('.tc article')).filter(
          (a) => a.scrollWidth > a.clientWidth + 1,
        ).length,
    );
    expect(overflow).toBe(0);
  });
});

test.describe('WP13b: the pager of the cards', () => {
  test('a second page: one row "Page 1 of 2" with Previous and Next (44 px), no size select', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(PERMS, 'E2E cards pager');
    const me = await seed.user([role.name], 'cards-pg');
    const world = await seed.world();
    const tag = uid();
    for (let i = 1; i <= 26; i++) {
      await seed.task(world, {
        title: `${tag} ${String(i).padStart(2, '0')}`,
        assignedUserId: me.userId,
      });
    }
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await new MyWorkPage(page).open('?pageSize=25');
    await expect(cards(page)).toHaveCount(25);
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    await expect(pager.locator('[data-page]')).toHaveText('Page 1 of 2');
    await expect(pager.getByText('Rows per page')).toBeHidden();
    const next = pager.getByRole('button', { name: 'Next' });
    const previous = pager.getByRole('button', { name: 'Previous' });
    for (const b of [next, previous])
      expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const [a, b] = [await previous.boundingBox(), await next.boundingBox()];
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(4);
    await next.click();
    await expect(pager.locator('[data-page]')).toHaveText('Page 2 of 2');
    await expect(cards(page)).toHaveCount(1);
    await shot(page, 'my-work-pager-375x812');
  });

  test('five whole cards fit under the chrome of My Work at 375x812', async ({ seed, asUser }) => {
    const role = await seed.role(PERMS, 'E2E cards five');
    const me = await seed.user([role.name], 'cards-five');
    const world = await seed.world();
    const tag = uid();
    for (let i = 1; i <= 8; i++) {
      await seed.task(world, {
        title: `${tag} ${i}`,
        assignedUserId: me.userId,
        dueDate: dateInZone(FIRM_ZONE, i + 3),
      });
    }
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await new MyWorkPage(page).open();
    await expect(cards(page)).toHaveCount(8);
    // The page scrolls (the chrome goes up); with the list at the top of the screen, at least five cards are whole above the pager.
    await page.evaluate(() =>
      document.querySelector('ul.tc-list')?.scrollIntoView({ block: 'start' }),
    );
    const whole = await visibleWholeCards(page);
    expect(whole).toBeGreaterThanOrEqual(5);
  });
});

/** Cards that are completely inside the window above the sticky pager. */
export async function visibleWholeCards(page: Page): Promise<number> {
  return page.evaluate(() => {
    const pager = document.querySelector('.wl-footrow')?.getBoundingClientRect().top ?? innerHeight;
    return Array.from(document.querySelectorAll('li[data-task]')).filter((li) => {
      const r = li.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= Math.min(pager, innerHeight) + 1;
    }).length;
  });
}

export type { Locator };
