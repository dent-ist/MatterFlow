import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { BoardSeed, seedBoard } from '../support/board';
import { expect, test } from '../support/fixtures';

/**
 * Dashboard > Swimlane, work package WP9a (#122 one-line compact card and one-line toolbar, #123 lane counts link to the Task Queue,
 * #124 no repeated client or matter on grouped cards). A board of about 120 tasks is seeded once per worker; the tests that must not see
 * other tests' tasks scope the board with `q=<tag>`; the count-link tests read the whole board and compare with the queue straight away.
 * Screenshots (not tests) are taken when E2E_SCREENSHOTS names a folder.
 */

let board: BoardSeed;
let base: string;

test.beforeAll(async ({ admin, seed }) => {
  test.setTimeout(300_000);
  board = await seedBoard(admin, seed, { tasks: 120, clients: 3, matters: 2, users: 4 });
  base = `/dashboard?tab=swimlane&q=${board.tag}`;
});

const lane = (page: Page, code: string): Locator => page.locator(`[data-lane="${code}"]`);
const cards = (page: Page, code: string): Locator => lane(page, code).locator('mf-swimlane-card');

async function openBoard(page: Page, query = '', url = base): Promise<void> {
  await page.goto(`${url}${query}`);
  await expect(cards(page, 'NEW').first()).toBeVisible();
  await expect(page.locator('[data-board][aria-busy="true"]')).toHaveCount(0);
}

/** Opens a board address and waits until the four lanes have been read (counts shown, no skeleton). */
async function openCounts(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('[data-board]')).toBeVisible();
  await expect(page.locator('[data-board][aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('a[data-lane-count]')).toHaveCount(4);
}

async function menuPick(page: Page, role: 'menuitemradio' | 'menuitemcheckbox', name: string) {
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole(role, { name }).click();
}

async function setCompact(page: Page): Promise<void> {
  await menuPick(page, 'menuitemradio', 'Compact');
  await expect(page.locator('[data-board]')).toHaveAttribute('data-density', 'compact');
}

/** Number of cards of a lane whose whole box is inside the lane's scrolling area (no scrolling needed to see them). */
async function visibleCards(page: Page, code: string): Promise<number> {
  return lane(page, code)
    .locator('[data-lane-body]')
    .evaluate((body) => {
      const area = body.getBoundingClientRect();
      return Array.from(body.querySelectorAll('mf-swimlane-card')).filter((c) => {
        const r = c.getBoundingClientRect();
        return r.top >= area.top - 1 && r.bottom <= area.bottom + 1;
      }).length;
    });
}

const OUT = process.env['E2E_SCREENSHOTS'];
const shot = async (page: Page, name: string) => {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
};

test.describe('Swimlane board (WP9a)', () => {
  test('Compact is a one-line card of 44 px: a lane shows at least 8 cards at 1366x768 and 10 at 1920x1080', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openBoard(page);
    await shot(page, '01-comfortable-1366');
    await setCompact(page);
    const first = cards(page, 'NEW').first();
    await expect(first.locator('.card--line')).toBeVisible();
    const box = (await first.locator('.card--line').boundingBox())!;
    expect(Math.abs(box.height - 44)).toBeLessThanOrEqual(2);
    // Everything of the one-line card is there; the rest is not.
    for (const part of [
      '[data-level-glyph]',
      'mf-task-type-icon',
      '[data-card-ref]',
      '[data-card-open]',
      '[data-avatar]',
      '[data-due]',
    ]) {
      await expect(first.locator(part)).toBeVisible();
    }
    for (const gone of ['[data-where]', '[data-progress]', '[data-field="status"]']) {
      await expect(first.locator(gone)).toHaveCount(0);
    }
    // Same y for every part: one line.
    const title = (await first.locator('[data-card-open]').boundingBox())!;
    const ref = (await first.locator('[data-card-ref]').boundingBox())!;
    expect(Math.abs(title.y + title.height / 2 - (ref.y + ref.height / 2))).toBeLessThan(4);
    expect(ref.height).toBeGreaterThanOrEqual(24);
    await shot(page, '02-compact-1366');

    for (const code of ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED']) {
      const have = await cards(page, code).count();
      const seen = await visibleCards(page, code);
      expect(seen, `${code} shows ${seen} of ${have} cards`).toBeGreaterThanOrEqual(
        Math.min(8, have),
      );
    }
    expect(await visibleCards(page, 'NEW')).toBeGreaterThanOrEqual(8);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect.poll(() => visibleCards(page, 'NEW')).toBeGreaterThanOrEqual(10);
    await shot(page, '03-compact-1920');
    await page.setViewportSize({ width: 1366, height: 768 });
    await menuPick(page, 'menuitemradio', 'Comfortable');
  });

  test('a remembered Compact setting is applied on load, and the one-line card still opens the drawer, with Enter too', async ({
    page,
  }) => {
    await openBoard(page);
    await setCompact(page);
    await page.goto(base);
    await expect(page.locator('[data-board]')).toHaveAttribute('data-density', 'compact');
    await expect(page.locator('[data-active-settings]')).toContainText('Compact');
    const open = cards(page, 'IN_PROGRESS').first().locator('[data-card-open]');
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('[data-peek-matter]')).toHaveAttribute('href', /\/matters\/\d+/);
    await page.keyboard.press('Escape');
    await expect(open).toBeFocused();
    // The keyboard model is unchanged: one tab stop per lane, arrows, Home and End.
    await page.keyboard.press('ArrowDown');
    await expect(cards(page, 'IN_PROGRESS').nth(1).locator('[data-card-open]')).toBeFocused();
    await page.keyboard.press('End');
    await expect(cards(page, 'IN_PROGRESS').last().locator('[data-card-open]')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(open).toBeFocused();
    // `m` has no menu on a one-line card: it opens the drawer, where the Status menu is.
    await page.keyboard.press('m');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await menuPick(page, 'menuitemradio', 'Comfortable');
  });

  test('the toolbar is one row of at most 56 px from 1100 px, wraps to two lines below, and "..." holds the rest', async ({
    page,
  }) => {
    for (const width of [1920, 1366, 1100]) {
      await page.setViewportSize({ width, height: 768 });
      await openBoard(page);
      const bar = (await page
        .locator('[role="toolbar"][aria-label="Swimlane controls"]')
        .boundingBox())!;
      expect(bar.height, `toolbar at ${width}`).toBeLessThanOrEqual(56);
      // Search, Group, Sort, Filters and "..." are all in it.
      for (const part of [
        page.getByRole('searchbox'),
        page.getByLabel('Group', { exact: true }),
        page.getByLabel('Sort', { exact: true }),
        page.getByRole('button', { name: /^Filters/ }),
        page.getByRole('button', { name: 'More options' }),
      ]) {
        const b = (await part.boundingBox())!;
        expect(b.y).toBeGreaterThanOrEqual(bar.y - 1);
        expect(b.y + b.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
      }
    }
    await page.setViewportSize({ width: 1024, height: 768 });
    await openBoard(page);
    const narrow = (await page
      .locator('[role="toolbar"][aria-label="Swimlane controls"]')
      .boundingBox())!;
    expect(narrow.height).toBeLessThanOrEqual(2 * 56);

    await page.setViewportSize({ width: 1366, height: 768 });
    await openBoard(page);
    await shot(page, '04-toolbar-1366');
    await page.getByRole('button', { name: 'More options' }).click();
    const menu = page.getByRole('menu', { name: 'Board options' });
    await expect(menu.getByRole('menuitemradio')).toHaveText([
      /Comfortable/,
      /Compact/,
      /7 days/,
      /14 days/,
      /30 days/,
    ]);
    await expect(menu.getByRole('menuitemcheckbox', { name: 'Only mine' })).toBeVisible();
    // Not grouped: no Expand all.
    await expect(menu.getByRole('menuitem', { name: 'Expand all' })).toHaveCount(0);
    await shot(page, '05-more-menu-1366');
    await page.keyboard.press('Escape');
    // The Filters sheet keeps Assignee, Task type, Priority and Overdue only; no Pod.
    await page.getByRole('button', { name: /^Filters/ }).click();
    const sheet = page.locator('[data-filter-panel]');
    await expect(sheet.locator('[data-filter]')).toHaveCount(4);
    await expect(sheet.getByLabel('Pod')).toHaveCount(0);
    await shot(page, '06-filters-1366');
  });

  test('the "..." menu is a menu button: Enter opens, arrows move, Esc closes and returns the focus; Tab reaches every control', async ({
    page,
  }) => {
    await openBoard(page, '&group=priority');
    const trigger = page.getByRole('button', { name: 'More options' });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu', { name: 'Board options' });
    const items = menu.locator('[role^="menuitem"]');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem', { name: 'Collapse all' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // Choosing closes the menu, returns the focus and shows the setting as text.
    await trigger.press('ArrowDown');
    await menu.getByRole('menuitemradio', { name: '14 days' }).click();
    await expect(trigger).toBeFocused();
    await expect(page.locator('[data-active-settings]')).toContainText('Done in 14 days');
    await page.goto(base);
    await menuPick(page, 'menuitemradio', '7 days');

    // Keyboard only: search, Group, Sort, Filters, "..." in that order, then the first lane.
    await page.getByLabel('Group', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Sort', { exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: /^Filters/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();
  });

  test('grouped by client / matter the cards leave out client and matter, and the group labels wrap instead of ending in an ellipsis', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openBoard(page, '&group=clientMatter&sort=clientMatter');
    const tree = lane(page, 'NEW').getByRole('tree');
    await expect(tree).toBeVisible();
    await expect(tree.locator('mf-swimlane-card').first()).toBeVisible();
    await expect(tree.locator('mf-swimlane-card [data-where]')).toHaveCount(0);
    // Tree structure unchanged.
    await expect(tree.locator('[role="treeitem"][aria-level="1"]').first()).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // No label is cut: the text fits its box (wrapped), nothing overflows horizontally.
    const cut = await tree
      .locator('.node-label')
      .evaluateAll(
        (els) =>
          els.filter(
            (e) => e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).whiteSpace === 'nowrap',
          ).length,
      );
    expect(cut).toBe(0);
    const heights = await tree
      .locator('.node--l2 .node-label')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    await shot(page, '07-group-client-matter-1366');

    // Compact: the same cards, one line, no client or matter either.
    await setCompact(page);
    await expect(tree.locator('mf-swimlane-card [data-where]')).toHaveCount(0);
    await shot(page, '08-group-client-matter-compact-1366');
    await menuPick(page, 'menuitemradio', 'Comfortable');
  });

  test('not grouped, a card shows client and matter name on one line; grouped by assignee it does not repeat the assignee', async ({
    page,
  }) => {
    await openBoard(page, '&group=none');
    const card = cards(page, 'IN_PROGRESS').first();
    const where = card.locator('[data-where]');
    await expect(where).toContainText('Board client');
    const box = (await where.boundingBox())!;
    expect(box.height).toBeLessThan(24); // one line
    await expect(where.locator('a')).toHaveCount(0);
    await expect(card.locator('[data-card-open]')).toHaveAttribute('title', /\d{5}-\d{5}/);
    await expect(card.locator('[data-field="assignee"]')).toHaveCount(1);

    await openBoard(page, '&group=assignee');
    await expect(cards(page, 'IN_PROGRESS').first().locator('[data-where]')).toBeVisible();
    await expect(page.locator('mf-swimlane-card [data-field="assignee"]')).toHaveCount(0);
    await expect(lane(page, 'IN_PROGRESS').locator('.grp-btn').first()).toBeVisible();
    await shot(page, '09-group-assignee-1366');
    await openBoard(page, '&group=priority');
    await expect(cards(page, 'NEW').first().locator('[data-where]')).toBeVisible();
    await shot(page, '10-group-priority-1366');
  });
});

test.describe('Swimlane lane counts (WP9a, #123)', () => {
  /** Lane count, the link target and the Task Queue's own total for it, read at the same moment. */
  async function counts(page: Page, code: string) {
    const link = lane(page, code).locator('a[data-lane-count]');
    const shown = Number(((await link.textContent()) ?? '').trim());
    const href = (await link.getAttribute('href'))!;
    const params = new URL(href, 'http://x').searchParams;
    const queue = await (await page.request.get(`/api/v1/task-queue?pageSize=1&${params}`)).json();
    return { shown, total: queue.total as number, params, link };
  }

  test('each lane count is a link to the Task Queue and equals its total (7-day Done window, no filters)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openCounts(page, '/dashboard?tab=swimlane');
    await shot(page, '11-lane-links-1366');
    for (const [code, name, status] of [
      ['NEW', 'New', ['NEW']],
      ['IN_PROGRESS', 'In Progress', ['IN_PROGRESS']],
      ['ON_HOLD', 'On Hold', ['ON_HOLD']],
      ['COMPLETED', 'Completed', ['COMPLETED', 'CANCELLED']],
    ] as const) {
      // Other tests create tasks at the same time: compare the pair read together, and read again when they moved in between.
      await expect(async () => {
        await openCounts(page, '/dashboard?tab=swimlane');
        const { shown, total, params, link } = await counts(page, code);
        expect(params.getAll('status')).toEqual(status);
        expect(params.has('q')).toBe(false);
        if (code === 'COMPLETED') expect(params.get('completedFrom')).toMatch(/^\d{4}-\d{2}-\d{2}/);
        else expect(params.has('completedFrom')).toBe(false);
        expect(total).toBe(shown);
        await expect(link).toHaveAttribute(
          'aria-label',
          `${shown} ${name} tasks in the Task Queue`,
        );
        await expect(lane(page, code).getByRole('heading', { level: 3 })).toHaveText(name);
        const box = (await link.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(24);
        expect(box.width).toBeGreaterThanOrEqual(24);
      }).toPass({ timeout: 40_000 });
    }

    // The link opens the Task Queue with the lane's status.
    await lane(page, 'ON_HOLD').locator('a[data-lane-count]').click();
    await expect(page).toHaveURL(/\/tasks\?/);
    expect(new URL(page.url()).searchParams.getAll('status')).toEqual(['ON_HOLD']);
  });

  test('the links carry the task type and the page scope, and the counts still equal the queue', async ({
    page,
  }) => {
    const typeId = board.world.taskType.id as number;
    await openCounts(page, `/dashboard?tab=swimlane&type=${typeId}`);
    for (const code of ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED']) {
      const { shown, total, params } = await counts(page, code);
      expect(params.get('type')).toBe(String(typeId));
      expect(total).toBe(shown);
    }
    // Scope: a pod of the seed (the page-wide control); the links carry it.
    await openCounts(page, `/dashboard?tab=swimlane&type=${typeId}&pod=${board.podId}`);
    for (const code of ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED']) {
      const { shown, total, params } = await counts(page, code);
      expect(params.getAll('pod')).toEqual([String(board.podId)]);
      expect(params.get('type')).toBe(String(typeId));
      expect(total).toBe(shown);
    }
    // And a 14-day window moves the start of the Completed link (the plain address is the 7-day default).
    await openCounts(page, `/dashboard?tab=swimlane&type=${typeId}`);
    const b = await counts(page, 'COMPLETED');
    expect(b.total).toBe(b.shown);
    await openCounts(page, `/dashboard?tab=swimlane&type=${typeId}&days=14`);
    const a = await counts(page, 'COMPLETED');
    expect(a.total).toBe(a.shown);
    expect(a.params.get('completedFrom')! < b.params.get('completedFrom')!).toBe(true);
  });

  test('with search text the link leaves it out and says so; the lane count stays the lane own number', async ({
    page,
  }) => {
    await openBoard(page);
    const link = lane(page, 'NEW').locator('a[data-lane-count]');
    await expect(link).toHaveAttribute('title', 'Search text is not included');
    await expect(link).toHaveAttribute('aria-label', /Search text is not included/);
    const href = (await link.getAttribute('href'))!;
    expect(new URL(href, 'http://x').searchParams.has('q')).toBe(false);
    await link.focus();
    await expect(link).toBeFocused();
    await link.click();
    await expect(page).toHaveURL(/\/tasks\?/);
    expect(page.url()).not.toContain('q=');
  });

  test('the count link is reachable with Tab before the lane and is not part of the lane roving tab stop', async ({
    page,
  }) => {
    await openBoard(page);
    const link = lane(page, 'NEW').locator('a[data-lane-count]');
    await link.focus();
    await page.keyboard.press('Tab');
    // The next tab stop is the lane's one stop (Skip lane, then the first card), not another control in the head.
    const next = await page.evaluate(
      () => document.activeElement?.getAttribute('data-skip-lane') !== null,
    );
    expect(next).toBe(true);
    await page.keyboard.press('Tab');
    await expect(cards(page, 'NEW').first().locator('[data-card-open]')).toBeFocused();
    await page.keyboard.press('Tab');
    // Not the second card: the lane has one tab stop.
    await expect(cards(page, 'NEW').nth(1).locator('[data-card-open]')).not.toBeFocused();
  });
});

test.describe('Swimlane accessibility (WP9a)', () => {
  test('axe is clean at 1366, 1920 and 375 (comfortable, compact, tree, open menu)', async ({
    page,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(480_000);
    for (const [w, h] of [
      [1366, 768],
      [1920, 1080],
      [375, 812],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await openBoard(page);
      expect(await axeViolations(page), `comfortable ${w}`).toEqual([]);
      await shot(page, `12-comfortable-${w}`);
      await page.goto(`${base}&group=clientMatter&sort=clientMatter`);
      await expect(lane(page, 'NEW').getByRole('tree')).toBeVisible();
      expect(await axeViolations(page), `tree ${w}`).toEqual([]);
      await shot(page, `13-tree-${w}`);
      await page.goto(`${base}&group=assignee`);
      await expect(cards(page, 'NEW').first()).toBeVisible();
      expect(await axeViolations(page), `assignee ${w}`).toEqual([]);
      await page.goto(`${base}&group=priority`);
      await expect(cards(page, 'NEW').first()).toBeVisible();
      expect(await axeViolations(page), `priority ${w}`).toEqual([]);
      await page.getByRole('button', { name: 'More options' }).click();
      await expect(page.getByRole('menu', { name: 'Board options' })).toBeVisible();
      expect(await axeViolations(page), `menu ${w}`).toEqual([]);
      await page.keyboard.press('Escape');
      await menuPick(page, 'menuitemradio', 'Compact');
      expect(await axeViolations(page), `compact ${w}`).toEqual([]);
      await shot(page, `14-compact-${w}`);
      await menuPick(page, 'menuitemradio', 'Comfortable');
    }
  });

  test('axe reports no aria-prohibited-attr, not even as "needs review"', async ({ page }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    const file = process.env['E2E_AXE_PATH']!;
    for (const query of [
      '&group=none',
      '&group=priority',
      '&group=assignee',
      '&group=clientMatter',
    ]) {
      await openBoard(page, query);
      await page.evaluate(fs.readFileSync(file, 'utf8'));
      const result = await page.evaluate(async () => {
        const axe = (
          window as unknown as {
            axe: {
              run: (
                c: unknown,
                o: unknown,
              ) => Promise<Record<string, { id: string; nodes: unknown[] }[]>>;
            };
          }
        ).axe;
        const r = await axe.run(document, { runOnly: ['aria-prohibited-attr'] });
        return {
          violations: r['violations'].map((v) => v.nodes.length),
          incomplete: r['incomplete'].map((v) => v.nodes.length),
        };
      });
      expect(result, query).toEqual({ violations: [], incomplete: [] });
    }
  });
});
