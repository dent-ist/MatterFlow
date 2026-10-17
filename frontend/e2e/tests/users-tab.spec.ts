import { Locator, Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import {
  CoverageSeed,
  PLAN,
  Person,
  WorkloadSeed,
  seedCoverage,
  seedWorkload,
} from '../support/workload';

/**
 * Dashboard > Users tab (issue #73): the team workload cards, the table view, the drawer with the person's open tasks, the assign picker and the
 * Coverage view. Twelve people with different loads are seeded once per worker (an idle one, light, normal and heavy ones, one out of office
 * with tasks, one out of office and idle, one off hours); every test scopes the tab to them with `uq=<tag>` (the database is shared).
 */

let wl: WorkloadSeed;
let cov: CoverageSeed;

test.beforeAll(async ({ admin, seed }) => {
  test.setTimeout(300_000);
  wl = await seedWorkload(admin, seed);
  cov = await seedCoverage(admin, seed);
});

const person = (key: string): Person => wl.people[key];
/** A CSS attribute value: the account-style display names contain a backslash. */
const css = (value: string) => value.replace(/\\/g, '\\\\');
const card = (page: Page, key: string): Locator =>
  page.locator(`[data-user-card][data-user="${css(person(key).displayName)}"]`);

async function openUsers(page: Page, extra = ''): Promise<void> {
  await page.goto(`/dashboard?tab=users&uq=${wl.tag}${extra}`);
  await expect(page.locator('[data-user-card]').first()).toBeVisible();
  await expect(page.locator('[data-users-loading]')).toHaveCount(0);
}

async function api(page: Page, params = ''): Promise<Json> {
  const response = await page.request.get(`/api/v1/dashboard/workload?q=${wl.tag}${params}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

/** The background colour a token resolves to, as the browser reports it. */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((t) => {
    const el = document.createElement('i');
    el.style.background = `var(${t})`;
    document.body.appendChild(el);
    const value = getComputedStyle(el).backgroundColor;
    el.remove();
    return value;
  }, token);
}

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.describe('Users tab: workload', () => {
  test('is the fifth tab, shows a card per person and keeps its own address', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('tab')).toHaveText([
      'Summary',
      'Breakdowns',
      'Trends',
      'Swimlane',
      'Users',
    ]);
    await page.getByRole('tab', { name: 'Users' }).click();
    await expect(page).toHaveURL(/tab=users/);
    await expect(page.locator('[data-user-card]').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Summary' }).click();
    await expect(page).not.toHaveURL(/uq=|view=/);
    await openUsers(page);
    await expect(page.locator('[data-user-card]')).toHaveCount(PLAN.length);
  });

  test('each card shows its state, colour and counts as the API reports them', async ({ page }) => {
    await openUsers(page);
    const data = await api(page);
    expect(data.users).toHaveLength(PLAN.length);
    for (const u of data.users) {
      const c = page.locator(`[data-user-card="${u.userId}"]`);
      const ooo = u.availability.state === 'OUT_OF_OFFICE';
      const state = ooo ? 'ooo' : u.openTotal === 0 ? 'free' : 'busy';
      await expect(c).toHaveAttribute('data-state', state);
      await expect(c).toHaveAttribute(
        'data-tone',
        ooo ? 'ooo' : u.openTotal === 0 ? 'free' : u.topPriority.color,
      );
      await expect(c).toHaveAttribute('data-load', u.loadLevel);
      if (u.openTotal > 0) {
        await expect(c.locator('[data-open-total]')).toHaveText(String(u.openTotal));
      } else {
        await expect(c.locator('[data-open-total]')).toHaveCount(0);
      }
      await expect(c.locator('[data-overdue]')).toHaveCount(u.overdue > 0 ? 1 : 0);
      if (u.overdue > 0) {
        await expect(c.locator('[data-overdue]')).toHaveAttribute('data-count', String(u.overdue));
      }
      // The bar has a segment for every priority that has open tasks, and only for those.
      for (const p of data.priorities) {
        const n = u.byPriority.find((b: Json) => b.priorityId === p.priorityId).count;
        await expect(c.locator(`[data-load-bar] [data-segment="${p.label}"]`)).toHaveCount(
          n > 0 ? 1 : 0,
        );
      }
      // The whole status is in the accessible name and the tooltip, not on the tile.
      const open = c.locator('[data-user-open]');
      const name = await open.getAttribute('aria-label');
      expect(name).toBe(await open.getAttribute('title'));
      expect(name).toContain(u.displayName);
      if (u.openTotal === 0) expect(name).toContain('No open tasks');
      else expect(name).toContain(`${u.openTotal} open task`);
      if (ooo) expect(name).toContain('Out of office');
    }
  });

  test('colours the tile by the highest priority with the same colours as the priority badge, and a level glyph', async ({
    page,
  }) => {
    await openUsers(page);
    const critical = card(page, 'critical');
    await expect(critical).toHaveAttribute('data-tone', 'critical');
    const pill = critical.locator('[data-pill]');
    expect(await pill.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      await tokenColor(page, '--mf-pr-critical-bg'),
    );
    expect(await pill.evaluate((el) => getComputedStyle(el).color)).toBe(
      await tokenColor(page, '--mf-pr-critical-fg'),
    );
    expect(await critical.evaluate((el) => getComputedStyle(el).borderLeftColor)).toBe(
      await tokenColor(page, '--mf-pr-critical-fg'),
    );
    // The glyph repeats the rank (colour is never the only cue): 4 bars for the most urgent, 1 for the least.
    await expect(critical.locator('[data-glyph]')).toHaveAttribute('data-bars', '4');
    await expect(card(page, 'high')).toHaveAttribute('data-tone', 'high');
    await expect(card(page, 'high').locator('[data-glyph]')).toHaveAttribute('data-bars', '3');
    await expect(card(page, 'lightNormal')).toHaveAttribute('data-tone', 'normal');
    await expect(card(page, 'low')).toHaveAttribute('data-tone', 'low');
    await expect(card(page, 'low').locator('[data-glyph]')).toHaveAttribute('data-bars', '1');
    // Load bar segments follow the priority order.
    expect(
      await critical
        .locator('[data-load-bar] [data-segment]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-segment'))),
    ).toEqual(['Critical', 'High', 'Normal']);
  });

  test('idle is green and out of office is hatched grey, with icons and no sentences; the words are in the name and tooltip', async ({
    page,
  }) => {
    await openUsers(page);
    const idle = card(page, 'idle');
    await expect(idle.locator('[data-state-icon]')).toHaveClass(/pi-check-circle/);
    await expect(idle.locator('[data-open-total]')).toHaveCount(0);
    expect(await idle.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      await tokenColor(page, '--mf-success-bg'),
    );
    await expect(idle.locator('[data-user-open]')).toHaveAttribute(
      'aria-label',
      `${person('idle').displayName}. No open tasks`,
    );

    const away = card(page, 'ooo');
    await expect(away).toHaveAttribute('data-availability', 'OUT_OF_OFFICE');
    await expect(away.locator('[data-state-icon]')).toHaveClass(/pi-calendar-minus/);
    await expect(away.locator('[data-user-open]')).toHaveAttribute(
      'aria-label',
      /Out of office until [A-Z][a-z]{2} \d{1,2}\. Annual leave\. 2 open tasks/,
    );
    expect(await away.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
      'repeating-linear-gradient',
    );
    // Their open tasks are still counted.
    await expect(away.locator('[data-open-total]')).toHaveText('2');
    await expect(card(page, 'oooIdle').locator('[data-user-open]')).toHaveAttribute(
      'aria-label',
      /Parental leave\. No open tasks/,
    );

    const off = card(page, 'offHours');
    await expect(off.locator('[data-off-hours]')).toHaveCount(1);
    await expect(off).toHaveAttribute('data-state', 'busy');
    await expect(off.locator('[data-user-open]')).toHaveAttribute('aria-label', /Off hours/);

    // No filler sentences anywhere on a tile.
    for (const c of await page.locator('[data-user-card]').all()) {
      const visible = (await c.innerText()).replace(/\s+/g, ' ');
      expect(visible).not.toMatch(/No open tasks|Not available|Available|Highest priority|Free/);
    }
  });

  test('a tile is a fraction of the old card: small, and many to a line', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openUsers(page);
    const box = (await card(page, 'critical').boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(64);
    expect(box.width).toBeLessThanOrEqual(200);
    expect(box.width * box.height).toBeLessThanOrEqual(89_000 / 4);
    const perLine = await page.locator('[data-users-grid] li').evaluateAll((els) => {
      const top = els[0].getBoundingClientRect().top;
      return els.filter((e) => Math.abs(e.getBoundingClientRect().top - top) < 2).length;
    });
    expect(perLine).toBeGreaterThanOrEqual(6);
  });

  test('shows the default order: available first, out of office last, lighter load first', async ({
    page,
  }) => {
    await openUsers(page);
    const names = await page
      .locator('[data-user-card]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-user')));
    const apiNames = (await api(page)).users.map((u: Json) => u.displayName);
    expect(names).toEqual(apiNames);
    expect(names.slice(-2).sort()).toEqual(
      [person('ooo').displayName, person('oooIdle').displayName].sort(),
    );
  });

  test('sorts, filters by pod and availability, searches by name, and keeps the filters in the address', async ({
    page,
  }) => {
    await openUsers(page);
    await page.getByLabel('Sort', { exact: true }).selectOption({ label: 'Name' });
    const names = await page
      .locator('[data-user-card]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-user')!));
    expect(names).toEqual(
      [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    );
    await page.getByLabel('Sort', { exact: true }).selectOption({ label: 'Open tasks' });
    await expect(page.locator('[data-user-card]').first()).toHaveAttribute('data-load', 'HEAVY');
    // The choice is remembered across a reload.
    await page.reload();
    await expect(page.getByLabel('Sort', { exact: true })).toHaveValue('open');

    await page.getByLabel('Availability', { exact: true }).selectOption({ label: 'Out of office' });
    await expect(page.locator('[data-user-card]')).toHaveCount(2);
    await expect(page).toHaveURL(/uavail=out/);
    // The summary does not change with the filter.
    await expect(page.locator('[data-chip="out"] [data-n]')).not.toHaveText('-');
    await page.getByLabel('Availability', { exact: true }).selectOption({ label: 'Available' });
    await expect(page.locator('[data-user-card]')).toHaveCount(PLAN.length - 2);
    await page.getByLabel('Availability', { exact: true }).selectOption({ label: 'All' });
    await expect(page.locator('[data-user-card]')).toHaveCount(PLAN.length);

    // The Pod is the page-wide Scope now (P1), not a filter of the tab.
    await expect(page.getByLabel('Pod', { exact: true })).toHaveCount(0);
    await page.getByLabel('Scope', { exact: true }).selectOption({ label: `Workload B ${wl.tag}` });
    await expect(page.locator('[data-user-card]')).toHaveCount(
      PLAN.filter((p) => p.pod === 'B').length,
    );
    await expect(page).toHaveURL(new RegExp(`pod=${wl.podB.podId}`));
    await page.reload();
    await expect(page.locator('[data-user-card]')).toHaveCount(
      PLAN.filter((p) => p.pod === 'B').length,
    );
    await page
      .getByRole('searchbox', { name: 'Search by name' })
      .fill(person('heavyCritical').displayName);
    await expect(page.locator('[data-user-card]')).toHaveCount(1);
    await expect(page).toHaveURL(/uq=/);
    await page.getByRole('searchbox', { name: 'Search by name' }).fill('zzzz-nobody');
    await expect(page.locator('[data-users-empty]')).toContainText(
      'No people match these filters.',
    );
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page.locator('[data-user-card]').first()).toBeVisible();
  });

  test('switches to the compact table and keeps it and the density across a reload', async ({
    page,
  }) => {
    await openUsers(page);
    await page.getByRole('button', { name: 'Table' }).click();
    const table = page.locator('[data-users-table]');
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(PLAN.length);
    await expect(
      table.locator(`[data-user-row][data-user="${css(person('ooo').displayName)}"]`),
    ).toContainText('Out of office until');
    await page.locator('[data-density="compact"]').click();
    await page.reload();
    await expect(page.locator('[data-users-table]')).toHaveAttribute('data-density', 'compact');
    await page.getByRole('button', { name: 'Cards' }).click();
    await expect(page.locator('[data-users-grid]')).toHaveAttribute('data-density', 'compact');
  });

  test('the chips count the team, filter by load, idle, out of office and off hours, and link the unassigned tasks to the Task Queue', async ({
    page,
  }) => {
    await openUsers(page);
    const n = async (k: string) =>
      Number(await page.locator(`[data-chip="${k}"] [data-n]`).textContent());
    const data = await api(page);
    const byLevel = (l: string) => data.users.filter((u: Json) => u.loadLevel === l).length;
    expect(await n('idle')).toBe(byLevel('IDLE'));
    expect(await n('light')).toBe(byLevel('LIGHT'));
    expect(await n('normal')).toBe(byLevel('NORMAL'));
    expect(await n('heavy')).toBe(byLevel('HEAVY'));
    expect(await n('out')).toBe(
      data.users.filter((u: Json) => u.availability.state === 'OUT_OF_OFFICE').length,
    );
    expect(await n('off')).toBe(
      data.users.filter((u: Json) => u.availability.state === 'OFF_HOURS').length,
    );
    expect(Number(await page.locator('[data-summary-unassigned] [data-n]').textContent())).toBe(
      data.summary.unassignedTasks,
    );
    expect(await n('out')).toBeGreaterThanOrEqual(2);

    await page.locator('[data-chip="out"]').click();
    await expect(page.locator('[data-user-card]')).toHaveCount(2);
    await expect(page.locator('[data-chip="out"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-chip="out"]').click();
    await expect(page.locator('[data-user-card]')).toHaveCount(PLAN.length);

    // Idle is everyone with nothing open (including the one out of office); heavy joins it (any of the chosen levels).
    await page.locator('[data-chip="idle"]').click();
    await expect(page.locator('[data-user-card]')).toHaveCount(byLevel('IDLE'));
    await expect(page).toHaveURL(/uload=idle/);
    await page.locator('[data-chip="heavy"]').click();
    await expect(page.locator('[data-user-card]')).toHaveCount(byLevel('IDLE') + byLevel('HEAVY'));
    await expect(page).toHaveURL(/uload=idle(,|%2C)heavy/);
    await page.reload();
    await expect(page.locator('[data-chip="heavy"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-chip="idle"]').click();
    await page.locator('[data-chip="heavy"]').click();
    await expect(page.locator('[data-user-card]')).toHaveCount(PLAN.length);

    await page.locator('[data-chip="off"]').click();
    await expect(page.locator('[data-user-card]')).toHaveCount(1);
    await expect(card(page, 'offHours')).toBeVisible();
    await page.locator('[data-chip="off"]').click();

    await page.getByLabel('Highest priority', { exact: true }).selectOption({ label: 'Critical' });
    await expect(page.locator('[data-user-card]')).toHaveCount(
      data.users.filter((u: Json) => u.topPriority?.label === 'Critical').length,
    );
    await expect(page).toHaveURL(/uprio=/);
    await page
      .getByLabel('Highest priority', { exact: true })
      .selectOption({ label: 'Any priority' });
    await expect(page.locator('[data-user-card]')).toHaveCount(PLAN.length);

    await page.locator('[data-summary-unassigned]').click();
    await expect(page).toHaveURL(/\/tasks\?.*unassigned=true/);
    await expect(page.getByRole('link', { name: `Unassigned ${wl.tag} 1` })).toBeVisible();
  });

  test('the assign icon appears on hover and focus and is reachable from the keyboard', async ({
    page,
  }) => {
    await openUsers(page);
    const tile = card(page, 'idle');
    const assign = tile.locator('[data-assign-work]');
    await expect(assign).toHaveAttribute(
      'aria-label',
      `Assign work to ${person('idle').displayName}`,
    );
    await expect(assign).toHaveAttribute('title', /Assign work to/);
    expect(await assign.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
    await tile.hover();
    await expect(assign).toHaveCSS('opacity', '1');
    const size = (await assign.boundingBox())!;
    expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(24);
    await page.mouse.move(0, 0);
    await tile.locator('[data-user-open]').focus();
    await page.keyboard.press('Tab');
    await expect(assign).toBeFocused();
    await expect(assign).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-assign-dialog]')).toBeVisible();
  });

  test('a card opens a drawer with the open tasks, keeps focus and returns it on Escape', async ({
    page,
  }) => {
    await openUsers(page);
    const heavy = card(page, 'heavy');
    const opener = heavy.locator('[data-user-open]');
    await opener.focus();
    await page.keyboard.press('Enter');
    const drawer = page.locator('[data-users-drawer]');
    await expect(drawer).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close person details' })).toBeFocused();
    await expect(drawer.locator('[data-drawer-tasks] li')).toHaveCount(12);
    await expect(drawer.locator('[data-drawer-tasks] li').first()).toContainText(
      `Workload ${wl.tag} heavy`,
    );
    await expect(
      drawer.locator('[data-drawer-tasks] [data-field="priority"]').first(),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();

    // The link opens the Task Queue filtered by this person.
    await opener.click();
    await page.locator('[data-open-queue]').click();
    await expect(page).toHaveURL(new RegExp(`assignee=${person('heavy').userId}`));
    await expect(page).toHaveURL(/status=IN_PROGRESS/);
    await expect(
      page.getByRole('link', { name: new RegExp(`Workload ${wl.tag} heavy`) }).first(),
    ).toBeVisible();
  });

  test('changing a task in the drawer updates the card, and Undo puts it back', async ({
    page,
  }) => {
    await openUsers(page);
    const low = card(page, 'low');
    await expect(low).toHaveAttribute('data-tone', 'low');
    await low.locator('[data-user-open]').click();
    const row = page.locator('[data-drawer-tasks] li').first();
    await row.locator('[data-field="priority"] [data-inline-trigger]').click();
    await page.getByRole('menuitemradio', { name: 'Critical', exact: true }).click();
    await expect(page.getByText(/priority set to Critical/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(low).toHaveAttribute('data-tone', 'critical', { timeout: 15_000 });
    await expect(low.locator('[data-glyph]')).toHaveAttribute('data-bars', '4');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(low).toHaveAttribute('data-tone', 'low', { timeout: 15_000 });
  });

  test('assigns an unassigned task from the picker with a hint for people who are away or heavily loaded, and Undo', async ({
    page,
  }) => {
    await openUsers(page);
    const idle = card(page, 'idle');
    await idle.locator('[data-assign-work]').click();
    const dialog = page.locator('[data-assign-dialog]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-assign-hint]')).toHaveCount(0);
    await expect(dialog.locator('[data-assign-order]')).toContainText('highest priority first');
    // Default: the unassigned tasks of the person's pods only (#132); the switch shows everything.
    await expect(dialog.locator('[data-assign-row]')).toHaveCount(1);
    await expect(dialog.locator('[data-assign-row]').first()).toContainText(`PodA backlog`);
    await expect(dialog.locator('[data-assign-row] [data-type]').first()).toBeVisible();
    await dialog.locator('[data-assign-allpods]').check();
    await dialog
      .getByRole('searchbox', { name: 'Search unassigned tasks' })
      .fill(`Unassigned ${wl.tag}`);
    await expect(dialog.locator('[data-assign-row]')).toHaveCount(4);
    // Most urgent first: the Critical one, then High, Normal, Low (the order of the seeded priorities).
    await expect(dialog.locator('[data-assign-row]').first()).toContainText(
      `Unassigned ${wl.tag} 1`,
    );
    await dialog
      .getByRole('searchbox', { name: 'Search unassigned tasks' })
      .fill(`Unassigned ${wl.tag} 4`);
    await expect(dialog.locator('[data-assign-row]')).toHaveCount(1);
    await dialog.locator('[data-assign-pick]').click();
    await expect(page.getByText(/assigned to .*\./).first()).toBeVisible();
    await expect(dialog.locator('[data-assign-empty]')).toBeVisible();
    const found = await (
      await page.request.get(`/api/v1/task-queue?q=${encodeURIComponent(`Unassigned ${wl.tag} 4`)}`)
    ).json();
    expect(found.items[0].assignedUser.userId).toBe(person('idle').userId);
    expect(found.items[0].status).toBe('IN_PROGRESS'); // assigning starts a New task
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(idle.locator('[data-open-total]')).toHaveText('1', { timeout: 15_000 });
    await expect(idle).toHaveAttribute('data-state', 'busy');

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(idle).toHaveAttribute('data-state', 'free', { timeout: 15_000 });
    const back = await (
      await page.request.get(`/api/v1/task-queue?q=${encodeURIComponent(`Unassigned ${wl.tag} 4`)}`)
    ).json();
    expect(back.items[0].assignedUser ?? null).toBeNull();

    await card(page, 'ooo').locator('[data-assign-work]').click();
    await expect(page.locator('[data-assign-hint]')).toContainText(
      'is not available (out of office until',
    );
    await expect(page.locator('[data-assign-hint]')).toContainText('You can still assign work.');
    await page.keyboard.press('Escape');
    await card(page, 'heavyCritical').locator('[data-assign-work]').click();
    await expect(page.locator('[data-assign-hint]')).toContainText(
      'already has a heavy load (12 open tasks, more than 8)',
    );
  });

  test('the table fits 1366 and 1920 without sideways scroll, sorts by its headers and follows the toolbar', async ({
    page,
  }) => {
    for (const width of [1366, 1920]) {
      await page.setViewportSize({ width, height: 768 });
      await openUsers(page);
      await page.getByRole('button', { name: 'Table' }).click();
      const table = page.locator('[data-users-table]');
      await expect(table).toBeVisible();
      const fits = await table.evaluate((t) => t.scrollWidth <= t.parentElement!.clientWidth);
      expect(fits, `${width}px`).toBe(true);
      await expect(page.locator('[data-sort-key="load"]')).toBeInViewport();
      await expect(page.locator('[data-assign-work]').first()).toBeInViewport();
      await page.getByRole('button', { name: 'Cards' }).click();
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByRole('button', { name: 'Table' }).click();
    const openers = (t: Locator) => t.locator('tbody td.num.strong');
    const table = page.locator('[data-users-table]');
    // One stacked cell per person, with the words in its accessible text.
    await expect(table.locator('[data-priority-counts] .sr-only').first()).toHaveText(
      /^\d+ \w+(, \d+ \w+){3}$/,
    );
    await expect(table.locator('thead th', { hasText: /^Critical$/ })).toHaveCount(0);
    const sortSelect = page.getByLabel('Sort', { exact: true });
    const header = table.locator('thead th', { has: page.locator('[data-sort-key="open"]') });
    await page.locator('[data-sort-key="open"]').click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await expect(sortSelect).toHaveValue('open');
    const desc = (await openers(table).allTextContents()).map(Number);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
    await page.locator('[data-sort-key="open"]').click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    const asc = (await openers(table).allTextContents()).map(Number);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    // Keyboard: a header is a button.
    await page.locator('[data-sort-key="name"]').focus();
    await page.keyboard.press('Enter');
    await expect(sortSelect).toHaveValue('name');
    await expect(
      table.locator('thead th', { has: page.locator('[data-sort-key="name"]') }),
    ).toHaveAttribute('aria-sort', 'ascending');
    await expect(header).toHaveAttribute('aria-sort', 'none');
  });

  test('below 900 px the table scrolls sideways and keeps the person column in view', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openUsers(page);
    await page.getByRole('button', { name: 'Table' }).click();
    const wrap = page.locator('[data-users-scroll]');
    await expect(wrap).toBeVisible();
    await wrap.evaluate((el) => (el.scrollLeft = 300));
    const person = page.locator('[data-users-table] tbody th.person').first();
    const w = (await wrap.boundingBox())!;
    const p = (await person.boundingBox())!;
    expect(p.x).toBeGreaterThanOrEqual(w.x - 1);
    expect(p.x + p.width).toBeLessThanOrEqual(w.x + w.width);
  });

  test('the drawer rows have a Reassign icon instead of an assignee menu, list overdue first and reassign with focus, announcement and Undo', async ({
    page,
  }) => {
    await openUsers(page);
    const heavy = card(page, 'heavy');
    await heavy.locator('[data-user-open]').click();
    const drawer = page.locator('[data-users-drawer]');
    const rows = drawer.locator('[data-drawer-tasks] li');
    await expect(rows).toHaveCount(12);
    await expect(drawer.locator('[data-drawer-order]')).toHaveText('Overdue first, then priority.');
    await expect(drawer.getByRole('button', { name: /^Reassign / })).toHaveCount(12);
    await expect(
      drawer.locator('[data-field="assignee"] [data-inline-trigger]').first(),
    ).not.toContainText(person('heavy').displayName);
    // Overdue tasks come first and say so in text.
    await expect(rows.first()).toContainText('Overdue');
    const firstOverdueFlags = await rows.evaluateAll((els) =>
      els.map((e) => /Overdue/.test(e.textContent ?? '')),
    );
    const firstNonOverdue = firstOverdueFlags.indexOf(false);
    expect(firstOverdueFlags.slice(firstNonOverdue).some(Boolean)).toBe(false);
    // Target size.
    const size = (await drawer
      .getByRole('button', { name: /^Reassign / })
      .first()
      .boundingBox())!;
    expect(size.width).toBeGreaterThanOrEqual(24);
    expect(size.height).toBeGreaterThanOrEqual(24);

    const ref = (await rows.first().locator('.mf-ref').first().textContent())!.trim();
    await drawer.getByRole('button', { name: `Reassign ${ref}` }).click();
    await page.getByRole('textbox', { name: 'Search people' }).fill(person('idle').displayName);
    await page.getByRole('menuitemradio', { name: person('idle').displayName }).click();
    await expect(drawer.locator('[data-drawer-live]')).toContainText(
      `${ref} reassigned to ${person('idle').displayName}`,
    );
    await expect(rows).toHaveCount(11);
    await expect(heavy.locator('[data-open-total]')).toHaveText('11', { timeout: 15_000 });
    await expect(rows.first().getByRole('button', { name: /^Reassign / })).toBeFocused();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(heavy.locator('[data-open-total]')).toHaveText('12', { timeout: 15_000 });
  });

  test('"Assign the next 3" asks first, repeats the warning, assigns three in one request and Undo restores them', async ({
    page,
  }) => {
    await openUsers(page);
    await card(page, 'heavyCritical').locator('[data-assign-work]').click();
    const dialog = page.locator('[data-assign-dialog]');
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-assign-allpods]').check();
    await dialog.locator('[data-assign-next]').click();
    const confirm = dialog.locator('[data-assign-confirm]');
    await expect(confirm).toContainText('Assign these 3 tasks to');
    await expect(confirm.locator('[data-confirm-row]')).toHaveCount(3);
    await expect(confirm.locator('[data-assign-confirm-hint]')).toContainText('heavy load');
    await dialog.locator('[data-assign-confirm-back]').click();
    await expect(confirm).toHaveCount(0);
    await page.keyboard.press('Escape');

    await card(page, 'idle').locator('[data-assign-work]').click();
    await dialog.locator('[data-assign-allpods]').check();
    await dialog
      .getByRole('searchbox', { name: 'Search unassigned tasks' })
      .fill(`Unassigned ${wl.tag}`);
    await expect(dialog.locator('[data-assign-row]')).toHaveCount(4);
    // Other picks: the selection button counts the checked rows.
    await dialog.locator('[data-assign-check]').nth(3).check();
    await expect(dialog.locator('[data-assign-selected]')).toHaveText('Assign 1 selected');
    await dialog.locator('[data-assign-check]').nth(3).uncheck();
    await dialog.locator('[data-assign-next]').click();
    await expect(dialog.locator('[data-assign-confirm-hint]')).toHaveCount(0);
    const refs = await dialog
      .locator('[data-confirm-row]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-confirm-row')!));
    expect(refs).toHaveLength(3);
    await dialog.locator('[data-assign-confirm-ok]').click();
    await expect(page.getByText(/3 tasks assigned to/).first()).toBeVisible();
    for (const n of [1, 2, 3]) {
      const found = await (
        await page.request.get(
          `/api/v1/task-queue?q=${encodeURIComponent(`Unassigned ${wl.tag} ${n}`)}`,
        )
      ).json();
      expect(found.items[0].assignedUser.userId).toBe(person('idle').userId);
      expect(found.items[0].status).toBe('IN_PROGRESS');
    }
    await page.keyboard.press('Escape');
    await expect(card(page, 'idle').locator('[data-open-total]')).toHaveText('3', {
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(card(page, 'idle')).toHaveAttribute('data-state', 'free', { timeout: 15_000 });
  });

  test('screenshots of the table, drawer and picker (only with WP10B_SHOTS=<directory>)', async ({
    page,
  }) => {
    const dir = process.env['WP10B_SHOTS'];
    test.skip(!dir, 'set WP10B_SHOTS to a directory to write the screenshots');
    test.setTimeout(300_000);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      await openUsers(page);
      await page.getByRole('button', { name: 'Table' }).click();
      await expect(page.locator('[data-users-table]')).toBeVisible();
      await page.screenshot({ path: `${dir}/users-table-${width}.png` });
      await page.getByRole('button', { name: 'Cards' }).click();
      await card(page, 'heavy').locator('[data-user-open]').click();
      await expect(page.locator('[data-drawer-tasks] li').first()).toBeVisible();
      await page.screenshot({ path: `${dir}/users-drawer-${width}.png` });
      await page.locator('[data-drawer-assign]').click();
      await page.locator('[data-assign-dialog] [data-assign-allpods]').check();
      await expect(page.locator('[data-assign-row]').first()).toBeVisible();
      await page.screenshot({ path: `${dir}/users-assign-${width}.png` });
      await page.locator('[data-assign-next]').click();
      await expect(page.locator('[data-assign-confirm]')).toBeVisible();
      await page.screenshot({ path: `${dir}/users-assign-confirm-${width}.png` });
    }
  });

  test('the legend explains the colours, the marks, the load levels and what the view is not', async ({
    page,
  }) => {
    await openUsers(page);
    await page.getByRole('button', { name: 'Legend and help' }).click();
    const legend = page.locator('[data-legend]');
    await expect(legend.locator('[data-legend-priorities]')).toContainText('Critical');
    await expect(legend.locator('[data-legend-priorities]')).toContainText('Idle: no open tasks');
    await expect(legend.locator('[data-legend-priorities]')).toContainText('Out of office');
    await expect(legend.locator('[data-legend-marks]')).toContainText('overdue');
    await expect(legend).toContainText('Light: 1 to 3 open tasks.');
    await expect(legend).toContainText('Heavy: more than 8 open tasks.');
    await expect(legend.locator('[data-frame]')).toContainText('Operational capacity only');
    await expect(legend).toContainText('No completion');
  });

  test('is usable at 1024 and 375 px without sideways scrolling', async ({ page }) => {
    for (const [w, h] of [
      [1024, 768],
      [375, 812],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await openUsers(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${w}px`).toBeLessThanOrEqual(0);
    }
    // Two columns at 375 px: tiles reflow side by side and none is cut off.
    const a = (await card(page, 'idle').boundingBox())!;
    const b = (await card(page, 'light').boundingBox())!;
    const tiles = await page
      .locator('[data-user-card]')
      .evaluateAll(
        (els) =>
          els
            .map((e) => e.getBoundingClientRect())
            .filter((r) => r.top === els[0].getBoundingClientRect().top).length,
      );
    expect(tiles).toBeGreaterThanOrEqual(2);
    expect(tiles).toBeLessThanOrEqual(3);
    expect(a.x + a.width).toBeLessThanOrEqual(375);
    expect(b.x + b.width).toBeLessThanOrEqual(375);
  });

  test('has no axe violations on the cards, the table, the drawer and the picker at 1366, 1920 and 375', async ({
    page,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(400_000);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      await openUsers(page);
      await page.getByRole('button', { name: 'Cards' }).click();
      expect(await axeViolations(page), `cards ${width}`).toEqual([]);
      if (width === 1366) {
        await page.getByRole('button', { name: 'Legend and help' }).click();
        expect(await axeViolations(page), 'legend').toEqual([]);
        await page.keyboard.press('Escape');
      }
      await page.getByRole('button', { name: 'Table' }).click();
      await expect(page.locator('[data-users-table]')).toBeVisible();
      expect(await axeViolations(page), `table ${width}`).toEqual([]);
      await page.getByRole('button', { name: 'Cards' }).click();
      await card(page, 'heavy').locator('[data-user-open]').click();
      await expect(page.locator('[data-drawer-tasks] li').first()).toBeVisible();
      // A modal drawer makes the page behind it inert, so the dialogs are checked on their own.
      expect(await axeViolations(page, '.mf-users-drawer'), `drawer ${width}`).toEqual([]);
      await page.locator('[data-drawer-assign]').click();
      await expect(page.locator('[data-assign-dialog]')).toBeVisible();
      await page.locator('[data-assign-dialog] [data-assign-allpods]').check();
      await expect(page.locator('[data-assign-row]').first()).toBeVisible();
      expect(await axeViolations(page, '.mf-users-assign'), `picker ${width}`).toEqual([]);
      await page.locator('[data-assign-next]').click();
      await expect(page.locator('[data-assign-confirm]')).toBeVisible();
      expect(await axeViolations(page, '.mf-users-assign'), `confirm ${width}`).toEqual([]);
    }
  });
});

test.describe('Users tab: coverage', () => {
  const scoped = (extra = '') => `/dashboard?tab=users&view=coverage&uq=zcov${cov.tag}${extra}`;
  const cell = (page: Page, p: Person, typeId: number) =>
    page.locator(`[data-cell="${p.userId}:${typeId}"]`);

  test('is offered with its own permission and not to a role that only has the Users tab', async ({
    page,
    seed,
    asUser,
  }) => {
    await page.goto(`/dashboard?tab=users&uq=${wl.tag}`);
    await expect(page.locator('[data-users-views]')).toBeVisible();
    const role = await seed.role(
      ['Task.View', 'Dashboard.View', 'Dashboard.ViewUsers'],
      'No coverage',
    );
    const { username } = await seed.user([role.name], 'nocov');
    const pm = await asUser(username);
    await pm.goto(`/dashboard?tab=users&view=coverage&uq=${wl.tag}`);
    await expect(pm.locator('[data-user-card]').first()).toBeVisible();
    await expect(pm.locator('[data-users-views]')).toHaveCount(0);
    expect((await pm.request.get('/api/v1/dashboard/coverage')).status()).toBe(403);
  });

  test('draws the matrix with the numbers, totals and who handled each type, and states what it is for', async ({
    page,
  }) => {
    await page.goto(scoped());
    await expect(page.locator('[data-coverage-heading]')).toHaveText(
      'Task type coverage - use this to plan training and cross-coverage, not to rank people',
    );
    const { a, b, c } = cov.people;
    await expect(page.locator('[data-coverage-table]')).toBeVisible();
    await expect(cell(page, a, cov.typeIds.production)).toHaveText('3');
    await expect(cell(page, a, cov.typeIds.review)).toHaveText('1');
    await expect(cell(page, b, cov.typeIds.production)).toHaveText('1');
    await expect(cell(page, c, cov.typeIds.production)).toHaveText('2');
    await expect(cell(page, b, cov.typeIds.review)).toHaveText('0');
    const production = page.locator(`[data-type-name="${cov.typeNames.production}"]`);
    const review = page.locator(`[data-type-name="${cov.typeNames.review}"]`);
    await expect(production.locator('[data-row-total]')).toHaveText('6');
    await expect(production.locator('[data-people]')).toContainText('3 people');
    await expect(review.locator('[data-people]')).toContainText('1 person');
    await expect(review.locator('[data-people]')).toHaveClass(/thin/);
    await expect(page.locator('[data-col-total]')).toHaveText(['4', '1', '2']);
    await expect(page.locator('[data-grand-total]')).toHaveText('7');
    await expect(page.locator('[data-summary="thin"]')).toContainText(
      'fewer than 2 people who handled them',
    );
    // The cancelled task is not counted (A completed 3 Production, not 4).
    await expect(cell(page, a, cov.typeIds.production)).not.toHaveText('4');
  });

  test('a zero is hatched with a visible 0 and a gap is marked; every cell has a sentence for a name', async ({
    page,
  }) => {
    await page.goto(scoped());
    const { a, b } = cov.people;
    const zero = cell(page, b, cov.typeIds.review).locator('xpath=ancestor::td');
    await expect(zero).toHaveAttribute('data-step', '0');
    await expect(zero).toHaveAttribute('data-gap', 'true');
    expect(await zero.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
      'repeating-linear-gradient',
    );
    await expect(cell(page, b, cov.typeIds.review)).toHaveAttribute(
      'aria-label',
      new RegExp(
        `^${esc(b.displayName)}: 0 ${esc(cov.typeNames.review)} tasks completed from \\w{3} \\d+ to \\w{3} \\d+`,
      ),
    );
    await expect(cell(page, a, cov.typeIds.production)).toHaveAttribute(
      'aria-label',
      new RegExp(
        `^${esc(a.displayName)}: 3 ${esc(cov.typeNames.production)} tasks completed from \\w{3} \\d+ to \\w{3} \\d+`,
      ),
    );
    // Relative to the row by default: A has the most Production, so the darkest step; absolute: 3 is step 2.
    await expect(
      cell(page, a, cov.typeIds.production).locator('xpath=ancestor::td'),
    ).toHaveAttribute('data-step', '4');
    await page.getByLabel('Colour scale').selectOption('absolute');
    await expect(
      cell(page, a, cov.typeIds.production).locator('xpath=ancestor::td'),
    ).toHaveAttribute('data-step', '2');
  });

  test('the Training gaps filter, the period and the orders work and are kept in the address', async ({
    page,
  }) => {
    await page.goto(scoped());
    await page.getByRole('button', { name: 'Training gaps' }).click();
    await expect(page.locator(`[data-type-name="${cov.typeNames.review}"]`)).toBeVisible();
    await expect(page.locator(`[data-type-name="${cov.typeNames.production}"]`)).toHaveCount(0);
    await page.getByRole('button', { name: 'Training gaps' }).click();
    await page.getByLabel('Period', { exact: true }).selectOption('90d');
    await expect(page).toHaveURL(/period=90d/);
    await expect(cell(page, cov.people.a, cov.typeIds.production)).toHaveAttribute(
      'aria-label',
      /completed from /,
    );
    await page.getByLabel('People', { exact: true }).selectOption('total');
    await expect(page.locator('thead th[data-person]').first()).toContainText(
      cov.people.a.displayName,
    );
    await page.getByLabel('Period', { exact: true }).selectOption('custom');
    await expect(page).toHaveURL(/period=custom&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
    await page.reload();
    await expect(page.locator('[data-coverage-table]')).toBeVisible();
    await expect(page.getByLabel('Period', { exact: true })).toHaveValue('custom');
  });

  test('a cell opens the completed tasks, with a link to the Task Queue', async ({ page }) => {
    await page.goto(scoped());
    const opener = cell(page, cov.people.a, cov.typeIds.production);
    await opener.focus();
    await page.keyboard.press('Enter');
    const drawer = page.locator('[data-coverage-drawer]');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('[data-coverage-tasks] li')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Close completed tasks' })).toBeFocused();
    await page.locator('[data-open-queue]').click();
    await expect(page).toHaveURL(/status=COMPLETED/);
    await expect(page).toHaveURL(new RegExp(`type=${cov.typeIds.production}`));
    await expect(page).toHaveURL(new RegExp(`assignee=${cov.people.a.userId}`));
    await page.goBack();
    await expect(page.locator('[data-coverage-table]')).toBeVisible();
  });

  test('the matrix is one tab stop with arrow keys between the cells', async ({ page }) => {
    await page.goto(scoped());
    await expect(page.locator('[data-coverage-table]')).toBeVisible();
    await expect(page.locator('[data-cell][tabindex="0"]')).toHaveCount(1);
    const first = page.locator('[data-cell][tabindex="0"]');
    await first.focus();
    const start = await first.getAttribute('data-cell');
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-cell'))).not.toBe(
      start,
    );
    await page.keyboard.press('ArrowLeft');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-cell'))).toBe(
      start,
    );
  });

  test('has no axe violations in the matrix and in the cell drawer, and fits 375 px', async ({
    page,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(300_000);
    await page.goto(scoped());
    await expect(page.locator('[data-coverage-table]')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await cell(page, cov.people.a, cov.typeIds.production).click();
    await expect(page.locator('[data-coverage-tasks] li').first()).toBeVisible();
    expect(await axeViolations(page, '.mf-coverage-drawer')).toEqual([]);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(scoped());
    await expect(page.locator('[data-coverage-table]')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
