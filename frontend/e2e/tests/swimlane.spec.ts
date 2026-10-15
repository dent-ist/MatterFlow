import { Locator, Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { BoardSeed, seedBoard } from '../support/board';
import { expect, test } from '../support/fixtures';

/**
 * Dashboard > Swimlane (issue #72). A board of about 60 tasks across clients, matters, priorities, statuses and assignees is seeded once per
 * worker; every test scopes the board to it with `q=<tag>` (the database is shared with the other tests).
 */

let board: BoardSeed;
let base: string;

test.beforeAll(async ({ admin, seed }) => {
  test.setTimeout(240_000);
  board = await seedBoard(admin, seed, { tasks: 60, clients: 3, matters: 2, users: 4 });
  base = `/dashboard?tab=swimlane&q=${board.tag}`;
});

const lane = (page: Page, code: string): Locator => page.locator(`[data-lane="${code}"]`);
const cards = (page: Page, code: string): Locator => lane(page, code).locator('mf-swimlane-card');

async function openBoard(page: Page, query = ''): Promise<void> {
  await page.goto(`${base}${query}`);
  await expect(cards(page, 'NEW').first()).toBeVisible();
}

async function api(page: Page, params: string): Promise<Json> {
  const response = await page.request.get(`/api/v1/dashboard/swimlane?q=${board.tag}${params}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.describe('Swimlane tab', () => {
  test('is the fourth tab with a Users tab after it, and each tab keeps its own address', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveText(['Summary', 'Breakdowns', 'Trends', 'Swimlane', 'Users']);
    await page.getByRole('tab', { name: 'Swimlane' }).click();
    await expect(page).toHaveURL(/tab=swimlane/);
    await expect(page.getByRole('region', { name: 'Swimlane board' })).toBeVisible();
    // The board's own parameters do not follow the person to another tab.
    await expect(page).toHaveURL(/group=none/);
    await page.getByRole('tab', { name: 'Users' }).click();
    await expect(page).toHaveURL(/tab=users/);
    await expect(page).not.toHaveURL(/group=/);
    await expect(page.getByText('Team workload is coming soon')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('region', { name: 'Swimlane board' })).toBeVisible();
  });

  test('shows four lanes with sticky headers, exact counts and its own scrolling per lane', async ({
    page,
  }) => {
    await openBoard(page);
    const data = await api(page, '');
    for (const l of data.lanes) {
      const heading = lane(page, l.status).getByRole('heading', { level: 3 });
      await expect(heading).toContainText(String(l.count));
    }
    await expect(lane(page, 'IN_PROGRESS').getByRole('heading', { level: 3 })).toContainText(
      'In Progress',
    );
    await expect(lane(page, 'COMPLETED').getByRole('heading', { level: 3 })).toContainText(
      'Completed',
    );

    // The New lane holds more cards than fit: it scrolls by itself while its header stays where it is.
    const body = lane(page, 'NEW').locator('[data-lane-body]');
    const head = lane(page, 'NEW').getByRole('heading', { level: 3 });
    const overflow = await body.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(overflow).toBe(true);
    const before = await head.boundingBox();
    await body.evaluate((el) => (el.scrollTop = 400));
    const after = await head.boundingBox();
    expect(after!.y).toBe(before!.y);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('a card shows priority (bar, icon and text), type, ref link, clamped title, client and matter, assignee, due chip and progress', async ({
    page,
  }) => {
    await openBoard(page);
    const card = cards(page, 'IN_PROGRESS').first();
    await expect(card.locator('.card > .bar')).toBeVisible();
    await expect(card.locator('[data-field="priority"]')).toContainText(/Critical|High|Normal|Low/);
    await expect(card.locator('mf-task-type-icon svg')).toHaveCount(1);
    await expect(card.locator('[data-card-ref]')).toHaveAttribute('href', /\/tasks\/\d+/);
    await expect(card.locator('[data-client]')).toContainText('Board client');
    await expect(card.locator('mf-matter-ref a')).toHaveAttribute('href', /\/matters\/\d+/);
    await expect(card.locator('[data-due]')).not.toBeEmpty();
    await expect(card.locator('[data-progress]')).toContainText('/4');
    const clamp = await card
      .locator('[data-card-open]')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-line-clamp'));
    expect(clamp).toBe('2');
  });

  test('flags an assignee who is out of office on the card and in the assignee group', async ({
    page,
  }) => {
    await openBoard(page, '&group=assignee');
    const oooLane = page.locator('[data-ooo]').first();
    await expect(oooLane).toContainText('Out of office');
    const group = page
      .locator('[data-lane="IN_PROGRESS"] .grp-btn')
      .filter({ hasText: board.outOfOfficeUser.displayName });
    await expect(group).toContainText('Out of office');
  });

  test('sorts by priority, due date, client / matter and created like the server does', async ({
    page,
  }) => {
    await openBoard(page);
    for (const [key, label] of [
      ['due', 'Due date'],
      ['created', 'Created'],
      ['clientMatter', 'Client / matter'],
      ['priority', 'Priority'],
    ] as const) {
      const response = page.waitForResponse(
        (r) => r.url().includes('/dashboard/swimlane') && r.url().includes(`sort=${key}`),
      );
      await page.getByLabel('Sort', { exact: true }).selectOption({ label });
      const data = await (await response).json();
      await expect(page).toHaveURL(new RegExp(`sort=${key}`));
      const refs = data.lanes
        .find((l: Json) => l.status === 'IN_PROGRESS')
        .cards.map((c: Json) => c.ref);
      await expect(cards(page, 'IN_PROGRESS').first().locator('[data-card-ref]')).toHaveText(
        refs[0],
      );
      await expect(cards(page, 'IN_PROGRESS').nth(1).locator('[data-card-ref]')).toHaveText(
        refs[1],
      );
    }
  });

  test('groups by priority with colour headers in rank order, and by assignee with an Unassigned group', async ({
    page,
  }) => {
    await openBoard(page, '&group=priority');
    const headers = lane(page, 'NEW').locator('.grp-btn');
    const data = await api(page, '&groupBy=priority');
    const expected = data.groups.filter((g: Json) => g.counts.new > 0).map((g: Json) => g.label);
    const shown = await headers.locator('.grp-title').allTextContents();
    expect(shown.map((t) => t.trim())).toEqual(expected);
    await expect(headers.first()).toContainText(String(data.groups[0].counts.new));

    await page.getByLabel('Group by').selectOption({ label: 'Assignee' });
    await expect(lane(page, 'NEW').locator('.grp-btn').first()).toContainText('Unassigned');
  });

  test('groups by client and matter as a tree with indentation, tree roles and counts on every node', async ({
    page,
  }) => {
    await openBoard(page, '&group=clientMatter&sort=clientMatter');
    const tree = lane(page, 'NEW').getByRole('tree');
    await expect(tree).toBeVisible();
    const clients = tree.locator('[role="treeitem"][aria-level="1"]');
    const matters = tree.locator('[role="treeitem"][aria-level="2"]');
    const leaves = tree.locator('[role="treeitem"][aria-level="3"]');
    await expect(clients).toHaveCount(3);
    expect(await matters.count()).toBeGreaterThanOrEqual(3);
    expect(await leaves.count()).toBeGreaterThan(5);
    await expect(clients.first()).toHaveAttribute('aria-expanded', 'true');
    // Indentation grows with the level.
    const x = async (l: Locator) => (await l.first().boundingBox())!.x;
    expect(await x(matters)).toBeGreaterThan(await x(clients));
    expect(await x(leaves)).toBeGreaterThan(await x(matters));

    // Counts agree with the API's exact group counts.
    const data = await api(page, '&groupBy=clientMatter');
    const first = data.groups.find((g: Json) => g.counts.new > 0);
    await expect(clients.first()).toContainText(first.label);
    await expect(clients.first().locator('.count')).toHaveText(String(first.counts.new));

    // Collapse a client with a click: its matters and cards leave the tree.
    const matterCount = await matters.count();
    await clients.first().click();
    await expect(clients.first()).toHaveAttribute('aria-expanded', 'false');
    expect(await matters.count()).toBeLessThan(matterCount);

    await page.getByRole('button', { name: 'Expand all' }).click();
    await expect(matters).toHaveCount(matterCount);
    await page.getByRole('button', { name: 'Collapse all' }).click();
    await expect(matters).toHaveCount(0);
    await expect(clients.first()).toHaveAttribute('aria-expanded', 'false');
  });

  test('moves through the tree and between cards with the arrow keys, and opens a card with Enter', async ({
    page,
  }) => {
    await openBoard(page, '&group=clientMatter&sort=clientMatter');
    const tree = lane(page, 'NEW').getByRole('tree');
    const items = tree.getByRole('treeitem');
    await items.first().focus();
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowDown'); // first matter
    await expect(items.nth(1)).toBeFocused();
    await expect(items.nth(1)).toHaveAttribute('aria-level', '2');
    await page.keyboard.press('ArrowDown'); // first card
    await expect(items.nth(2)).toHaveAttribute('aria-level', '3');
    await expect(items.nth(2)).toBeFocused();
    await page.keyboard.press('ArrowLeft'); // back to the matter
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowLeft'); // collapses the matter
    await expect(items.nth(1)).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowRight'); // opens it again
    await expect(items.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-peek]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-peek]')).toHaveCount(0);
    await expect(items.nth(2)).toBeFocused();
  });

  test('moves between cards with arrows and between lanes with Left and Right, and m opens the status menu', async ({
    page,
  }) => {
    await openBoard(page);
    const first = cards(page, 'NEW').first().locator('[data-card-open]');
    await first.focus();
    await page.keyboard.press('ArrowDown');
    await expect(cards(page, 'NEW').nth(1).locator('[data-card-open]')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(cards(page, 'IN_PROGRESS').first().locator('[data-card-open]')).toBeFocused();
    await page.keyboard.press('m');
    await expect(page.getByRole('menu', { name: 'Change status' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('searches title or ref, filters with a count, and keeps the data filters in the address', async ({
    page,
  }) => {
    await openBoard(page);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByLabel('Priority', { exact: true }).selectOption({ index: 1 });
    await expect(page.locator('[data-filter-count]')).toHaveText('(1)');
    await expect(page).toHaveURL(/priority=\d+/);
    const priority = new URL(page.url()).searchParams.get('priority');
    const data = await api(page, `&priorityId=${priority}`);
    await expect(lane(page, 'NEW').getByRole('heading', { level: 3 })).toContainText(
      String(data.lanes[0].count),
    );
    await page.getByRole('checkbox', { name: 'Overdue only' }).check();
    await expect(page.locator('[data-filter-count]')).toHaveText('(2)');
    await expect(page).toHaveURL(/overdue=true/);
    // A reload lands on the same filtered board.
    await page.reload();
    await expect(page.locator('[data-filter-count]')).toHaveText('(2)');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.locator('[data-filter-count]')).toHaveCount(0);
    await expect(page).not.toHaveURL(/priority=|overdue=/);

    // Search by the number of one task.
    const one = (await api(page, '')).lanes[1].cards[0];
    await page.getByRole('searchbox', { name: 'Search title or ref' }).fill(one.ref);
    await expect(page).toHaveURL(new RegExp(`q=${one.ref}`));
    await expect(page.locator('mf-swimlane-card')).toHaveCount(1);
    await expect(page.locator('mf-swimlane-card [data-card-ref]')).toHaveText(one.ref);
  });

  test('"Only mine" narrows the board to the signed-in user and says so in the empty lanes', async ({
    page,
  }) => {
    await openBoard(page);
    await page.getByRole('button', { name: 'Only mine' }).click();
    await expect(page).toHaveURL(/mine=true/);
    await expect(page.getByRole('button', { name: 'Only mine' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The seeded tasks belong to other people.
    await expect(lane(page, 'NEW').locator('[data-lane-empty]')).toContainText('match the filters');
    await expect(page.locator('mf-swimlane-card')).toHaveCount(0);
  });

  test('changes the completed window to 14 and 30 days and remembers it, with grouping, sort and density', async ({
    page,
  }) => {
    await openBoard(page);
    const response = page.waitForResponse(
      (r) => r.url().includes('/dashboard/swimlane') && r.url().includes('completedDays=30'),
    );
    await page.getByLabel('Completed in last').selectOption('30');
    expect((await response).ok()).toBe(true);
    await expect(page).toHaveURL(/days=30/);
    await page.getByLabel('Group by').selectOption({ label: 'Priority' });
    await page.getByLabel('Density').selectOption('compact');
    await expect(page.locator('[data-board]')).toHaveAttribute('data-density', 'compact');

    // A plain Swimlane link (no board parameters) opens with the remembered choices, and writes them into the address.
    await page.goto(`/dashboard?tab=swimlane&q=${board.tag}`);
    await expect(page.getByLabel('Completed in last')).toHaveValue('30');
    await expect(page.getByLabel('Group by')).toHaveValue('priority');
    await expect(page.getByLabel('Density')).toHaveValue('compact');
    await expect(page).toHaveURL(/group=priority/);
    await expect(page).toHaveURL(/days=30/);
    // Put the defaults back for the tests that follow.
    await page.getByLabel('Completed in last').selectOption('7');
    await page.getByLabel('Group by').selectOption({ label: 'None' });
    await page.getByLabel('Density').selectOption('comfortable');
  });

  test('opens a drawer peek with summary, steps and quick actions; Esc closes it and focus returns to the card', async ({
    page,
  }) => {
    await openBoard(page);
    const open = cards(page, 'IN_PROGRESS').nth(1).locator('[data-card-open]');
    const ref = await cards(page, 'IN_PROGRESS').nth(1).locator('[data-card-ref]').textContent();
    await open.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(`Task ${ref}`);
    await expect(drawer.locator('[data-peek-steps] li')).toHaveCount(4);
    await expect(drawer.getByText('Latest comments')).toBeVisible();
    await expect(drawer.getByRole('link', { name: /Open full task/ })).toHaveAttribute(
      'href',
      /\/tasks\/\d+/,
    );
    // Focus is trapped in the drawer: Tab never leaves it.
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.p-dialog'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(open).toBeFocused();

    await open.click();
    await page
      .getByRole('dialog')
      .getByRole('link', { name: /Open full task/ })
      .click();
    await expect(page).toHaveURL(/\/tasks\/\d+/);
  });

  test('changes the status inline: the card moves to the new lane, counts follow and the task changed on the server', async ({
    page,
  }) => {
    await openBoard(page);
    const card = cards(page, 'ON_HOLD').first();
    const ref = (await card.locator('[data-card-ref]').textContent())!.trim();
    const before = {
      hold: Number(
        (await lane(page, 'ON_HOLD').locator('[data-lane-count]').textContent())!.trim(),
      ),
      progress: Number(
        (await lane(page, 'IN_PROGRESS').locator('[data-lane-count]').textContent())!.trim(),
      ),
    };
    await card.locator('[data-field="status"] [data-inline-trigger]').click();
    await page.getByRole('menuitemradio', { name: /^Resume/ }).click();
    const moved = cards(page, 'IN_PROGRESS').filter({ hasText: ref });
    await expect(moved).toHaveCount(1);
    await expect(
      lane(page, 'ON_HOLD').locator('mf-swimlane-card').filter({ hasText: ref }),
    ).toHaveCount(0);
    await expect(lane(page, 'ON_HOLD').locator('[data-lane-count]')).toHaveText(
      String(before.hold - 1),
    );
    await expect(lane(page, 'IN_PROGRESS').locator('[data-lane-count]')).toHaveText(
      String(before.progress + 1),
    );
    const id = await moved.locator('[data-card]').getAttribute('data-card');
    await expect
      .poll(async () => (await (await page.request.get(`/api/v1/tasks/${id}`)).json()).status)
      .toBe('IN_PROGRESS');
  });

  test('changes the priority inline with an Undo that puts it back', async ({ page }) => {
    await openBoard(page);
    const card = cards(page, 'IN_PROGRESS').first();
    const ref = (await card.locator('[data-card-ref]').textContent())!.trim();
    const id = await card.locator('[data-card]').getAttribute('data-card');
    const was = (await (await page.request.get(`/api/v1/tasks/${id}`)).json()).priority.label;
    await card.locator('[data-field="priority"] [data-inline-trigger]').click();
    const target = board.priorities.find((p) => p.label !== was)!;
    await page.getByRole('menuitemradio', { name: target.label, exact: true }).click();
    await expect(page.getByText(`${ref} priority set to ${target.label}.`)).toBeVisible();
    await expect
      .poll(
        async () => (await (await page.request.get(`/api/v1/tasks/${id}`)).json()).priority.label,
      )
      .toBe(target.label);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect
      .poll(
        async () => (await (await page.request.get(`/api/v1/tasks/${id}`)).json()).priority.label,
      )
      .toBe(was);
  });

  test('assigns inline from the card menu', async ({ page }) => {
    await openBoard(page);
    const card = cards(page, 'NEW').first();
    const ref = (await card.locator('[data-card-ref]').textContent())!.trim();
    await card.locator('[data-field="assignee"] [data-inline-trigger]').click();
    const user = board.users[1];
    await page.getByRole('textbox', { name: 'Search people' }).fill(user.displayName.slice(0, 12));
    await page
      .getByRole('menuitemradio', { name: user.displayName.slice(0, 12) })
      .first()
      .click();
    await expect(page.getByText(new RegExp(`${ref} assigned to`))).toBeVisible();
    // Assigning starts a New task: the card is in the In Progress lane now.
    await expect(cards(page, 'IN_PROGRESS').filter({ hasText: ref })).toHaveCount(1);
  });

  test('shows an error with Retry, then the board when the read works again', async ({ page }) => {
    let fail = true;
    await page.route('**/api/v1/dashboard/swimlane**', (route) =>
      fail
        ? route.fulfill({ status: 500, json: { code: 'INTERNAL', traceId: 'trace-xyz' } })
        : route.continue(),
    );
    await page.goto(base);
    await expect(page.locator('[data-swimlane-error]')).toContainText('could not be loaded');
    await expect(page.locator('[data-swimlane-error]')).toContainText('Reference');
    fail = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(cards(page, 'NEW').first()).toBeVisible();
    await expect(page.locator('[data-swimlane-error]')).toHaveCount(0);
  });

  test('stacks the lanes below 900 px and scrolls the board sideways in between', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await openBoard(page);
    const a = (await lane(page, 'NEW').boundingBox())!;
    const b = (await lane(page, 'IN_PROGRESS').boundingBox())!;
    expect(b.y).toBeGreaterThan(a.y + a.height - 2);
    expect(Math.abs(b.x - a.x)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(async () => {
      const x = (await lane(page, 'IN_PROGRESS').boundingBox())!;
      expect(x.y).toBeLessThan(a.y + 60);
    }).toPass();
    // No horizontal scroll of the page: the board scrolls inside itself.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test('stays quick with 800 cards: a lane draws 40 at a time and "Show all" draws the rest', async ({
    page,
  }) => {
    const priority = { priorityId: 2, label: 'High', color: 'high', rank: 2 };
    const lanes = ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED'].map((status, l) => ({
      status,
      label: status,
      count: 260,
      total: 260,
      truncated: true,
      cards: Array.from({ length: 200 }, (_, i) => ({
        taskId: l * 1000 + i + 1,
        ref: `TSK-${l * 1000 + i + 1}`,
        title: `Synthetic card ${i}`,
        status,
        statusLabel: status,
        priority,
        assignee: undefined,
        pod: undefined,
        clientId: 1 + (i % 12),
        clientNumber: '00001',
        clientName: `Client ${i % 12}`,
        matterId: 1 + (i % 30),
        matterRef: `00001-${String(1 + (i % 30)).padStart(5, '0')}`,
        matterName: `Matter ${i % 30}`,
        matterIsSensitive: false,
        taskTypeId: 1,
        taskTypeName: 'Type',
        taskTypeIconKey: 'file-text',
        dueDate: undefined,
        dueAtUtc: undefined,
        isOverdue: false,
        isAsap: true,
        stepsResolved: 0,
        stepsTotal: 3,
        createdAtUtc: '2026-10-01T00:00:00Z',
        completedAtUtc: undefined,
        rowVersion: 'AAAA',
      })),
    }));
    await page.route('**/api/v1/dashboard/swimlane**', (route) =>
      route.fulfill({
        json: {
          timeZone: 'America/New_York',
          generatedAtUtc: new Date().toISOString(),
          completedDays: 7,
          completedFrom: '2026-10-09',
          groupBy: 'none',
          sort: 'priority',
          laneCap: 200,
          lanes,
          groups: [],
        },
      }),
    );
    await page.goto('/dashboard?tab=swimlane');
    await expect(cards(page, 'NEW').first()).toBeVisible();
    await expect(page.locator('mf-swimlane-card')).toHaveCount(160);
    await expect(lane(page, 'NEW').locator('[data-show-more]')).toHaveText(
      /Show 40 more of 160 hidden/,
    );
    await lane(page, 'NEW').locator('[data-show-all]').click();
    await expect(cards(page, 'NEW')).toHaveCount(200);
    await expect(lane(page, 'NEW').locator('[data-truncated]')).toContainText('Showing 200 of 260');
  });

  test('has no axe violations on the board, the tree, a compact board and the drawer', async ({
    page,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(300_000); // axe on a board of dozens of cards takes a while
    await openBoard(page);
    expect(await axeViolations(page)).toEqual([]);
    await page.goto(`${base}&group=clientMatter&sort=clientMatter`);
    await expect(lane(page, 'NEW').getByRole('tree')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.goto(`${base}&group=assignee`);
    await expect(cards(page, 'NEW').first()).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await cards(page, 'IN_PROGRESS').first().locator('[data-card-open]').click();
    await expect(page.locator('[data-peek-steps]')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
