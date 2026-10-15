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
      await expect(c.locator('[data-open-total] dd')).toHaveText(String(u.openTotal));
      await expect(c.locator('[data-overdue] dd')).toHaveText(String(u.overdue));
      await expect(c.locator('[data-due-soon] dd')).toHaveText(String(u.dueSoon));
      await expect(c.locator('[data-hold] dd')).toHaveText(String(u.onHold));
      if (u.openTotal > 0) {
        for (const p of data.priorities) {
          const n = u.byPriority.find((b: Json) => b.priorityId === p.priorityId).count;
          await expect(c.locator(`[data-priority-count="${p.label}"]`)).toHaveAttribute(
            'data-count',
            String(n),
          );
        }
      }
    }
  });

  test('colours the card by the highest priority with the same colours as the priority badge, and says it in words', async ({
    page,
  }) => {
    await openUsers(page);
    const critical = card(page, 'critical');
    await expect(critical).toHaveAttribute('data-tone', 'critical');
    await expect(critical.locator('[data-band-text]')).toHaveText('Highest priority: Critical');
    const band = critical.locator('[data-band]');
    expect(await band.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      await tokenColor(page, '--mf-pr-critical-bg'),
    );
    expect(await band.evaluate((el) => getComputedStyle(el).color)).toBe(
      await tokenColor(page, '--mf-pr-critical-fg'),
    );
    await expect(card(page, 'high')).toHaveAttribute('data-tone', 'high');
    await expect(card(page, 'high').locator('[data-band-text]')).toHaveText(
      'Highest priority: High',
    );
    await expect(card(page, 'lightNormal')).toHaveAttribute('data-tone', 'normal');
    await expect(card(page, 'low')).toHaveAttribute('data-tone', 'low');
    // Priority counts in rank order, zeros muted.
    const critBadges = critical.locator('[data-priority-count]');
    await expect(critBadges).toHaveText(['Critical 1', 'High 2', 'Normal 2', 'Low 0']);
    await expect(critBadges.nth(3)).toHaveClass(/pc--zero/);
    await expect(critBadges.nth(0)).not.toHaveClass(/pc--zero/);
    // Load bar segments follow the same order.
    await expect(critical.locator('[data-load-bar] [data-segment]')).toHaveText(['', '', '']);
    expect(
      await critical
        .locator('[data-load-bar] [data-segment]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-segment'))),
    ).toEqual(['Critical', 'High', 'Normal']);
  });

  test('free capacity is green with text, an out of office person has a hatched grey card with the return date and note', async ({
    page,
  }) => {
    await openUsers(page);
    const idle = card(page, 'idle');
    await expect(idle.locator('[data-band-text]')).toHaveText('Available - no open tasks');
    await expect(idle.locator('[data-free]')).toContainText('No open tasks');
    await expect(idle.locator('[data-load-label]')).toHaveText('Free');
    await expect(idle.locator('[data-avail-chip]')).toHaveText('Available');
    expect(await idle.locator('[data-band]').evaluate((el) => getComputedStyle(el).color)).toBe(
      await tokenColor(page, '--mf-success'),
    );

    const away = card(page, 'ooo');
    await expect(away.locator('[data-band-text]')).toHaveText('Not available');
    await expect(away.locator('[data-avail-chip]')).toContainText('Out of office until');
    await expect(away.locator('[data-back]')).toContainText(/^\s*Back on [A-Z][a-z]{2} \d{1,2}/);
    await expect(away.locator('[data-note]')).toHaveText('Annual leave');
    await expect(away).toHaveAttribute('data-availability', 'OUT_OF_OFFICE');
    expect(await away.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
      'repeating-linear-gradient',
    );
    // Their open tasks are still counted.
    await expect(away.locator('[data-open-total] dd')).toHaveText('2');

    const awayIdle = card(page, 'oooIdle');
    await expect(awayIdle.locator('[data-band-text]')).toHaveText('Not available');
    await expect(awayIdle.locator('[data-back]')).toContainText('No return date set');

    const off = card(page, 'offHours');
    await expect(off.locator('[data-avail-chip]')).toHaveText('Off hours');
    await expect(off).toHaveAttribute('data-state', 'busy');
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
    await expect(page.locator('[data-summary-tile="out"] [data-n]')).not.toHaveText('-');
    await page.getByLabel('Availability', { exact: true }).selectOption({ label: 'Available' });
    await expect(page.locator('[data-user-card]')).toHaveCount(PLAN.length - 2);
    await page.getByLabel('Availability', { exact: true }).selectOption({ label: 'All' });
    await expect(page.locator('[data-user-card]')).toHaveCount(PLAN.length);

    await page.getByLabel('Pod', { exact: true }).selectOption({ label: `Workload B ${wl.tag}` });
    await expect(page.locator('[data-user-card]')).toHaveCount(
      PLAN.filter((p) => p.pod === 'B').length,
    );
    await expect(page).toHaveURL(new RegExp(`upod=${wl.podB.podId}`));
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
    await page.getByLabel('Density', { exact: true }).selectOption({ label: 'Compact' });
    await page.reload();
    await expect(page.locator('[data-users-table]')).toHaveAttribute('data-density', 'compact');
    await page.getByRole('button', { name: 'Cards' }).click();
    await expect(page.locator('[data-users-grid]')).toHaveAttribute('data-density', 'compact');
  });

  test('the summary strip counts the team and links the unassigned tasks to the Task Queue', async ({
    page,
  }) => {
    await openUsers(page);
    const n = async (k: string) =>
      Number(await page.locator(`[data-summary-tile="${k}"] [data-n]`).textContent());
    const summary = (await api(page)).summary;
    expect(await n('available')).toBe(summary.available);
    expect(await n('busy')).toBe(summary.busy);
    expect(await n('out')).toBe(summary.outOfOffice);
    expect(await n('unassigned')).toBe(summary.unassignedTasks);
    expect(summary.available).toBeGreaterThanOrEqual(2);
    expect(summary.outOfOffice).toBeGreaterThanOrEqual(2);

    await page
      .getByRole('button', { name: /Out of office/ })
      .first()
      .click();
    await expect(page.locator('[data-user-card]')).toHaveCount(2);
    await page
      .getByRole('button', { name: /Out of office/ })
      .first()
      .click();
    await expect(page.locator('[data-user-card]')).toHaveCount(PLAN.length);

    await page.locator('[data-summary-unassigned]').click();
    await expect(page).toHaveURL(/\/tasks\?.*unassigned=true/);
    await expect(page.getByRole('link', { name: `Unassigned ${wl.tag} 1` })).toBeVisible();
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
    await expect(low.locator('[data-band-text]')).toHaveText('Highest priority: Critical');
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
    await expect(idle.locator('[data-open-total] dd')).toHaveText('1', { timeout: 15_000 });
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

  test('the legend explains the colours, the load levels and what the view is not', async ({
    page,
  }) => {
    await openUsers(page);
    await expect(page.locator('[data-frame]')).toContainText('does not measure completed work');
    await page.getByRole('button', { name: 'Legend and help' }).click();
    const legend = page.locator('[data-legend]');
    await expect(legend).toContainText('Highest priority: Critical');
    await expect(legend).toContainText('Available - no open tasks');
    await expect(legend).toContainText('Light: 1 to 3 open tasks.');
    await expect(legend).toContainText('Heavy: more than 8 open tasks.');
    await expect(legend).toContainText('no completion');
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
    const a = await card(page, 'idle').boundingBox();
    const b = await card(page, 'light').boundingBox();
    expect(Math.abs(a!.x - b!.x)).toBeLessThan(2); // one column at 375 px
  });

  test('has no axe violations on the cards, the table, the drawer and the picker', async ({
    page,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(300_000);
    await openUsers(page);
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole('button', { name: 'Legend and help' }).click();
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole('button', { name: 'Table' }).click();
    await expect(page.locator('[data-users-table]')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole('button', { name: 'Cards' }).click();
    await card(page, 'heavy').locator('[data-user-open]').click();
    await expect(page.locator('[data-drawer-tasks] li').first()).toBeVisible();
    // A modal drawer makes the page behind it inert, so the dialogs are checked on their own.
    expect(await axeViolations(page, '.mf-users-drawer')).toEqual([]);
    await page.locator('[data-drawer-assign]').click();
    await expect(page.locator('[data-assign-dialog]')).toBeVisible();
    expect(await axeViolations(page, '.mf-users-assign')).toEqual([]);
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
      `${b.displayName}: 0 ${cov.typeNames.review} tasks completed in the last 30 days`,
    );
    await expect(cell(page, a, cov.typeIds.production)).toHaveAttribute(
      'aria-label',
      `${a.displayName}: 3 ${cov.typeNames.production} tasks completed in the last 30 days`,
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
    await page.getByLabel('Period').selectOption('90');
    await expect(page).toHaveURL(/cp=90/);
    await expect(cell(page, cov.people.a, cov.typeIds.production)).toHaveAttribute(
      'aria-label',
      /in the last 90 days/,
    );
    await page.getByLabel('People', { exact: true }).selectOption('total');
    await expect(page.locator('thead th[data-person]').first()).toContainText(
      cov.people.a.displayName,
    );
    await page.getByLabel('Period').selectOption('custom');
    await expect(page).toHaveURL(/cp=custom/);
    await page.reload();
    await expect(page.locator('[data-coverage-table]')).toBeVisible();
    await expect(page.getByLabel('Period')).toHaveValue('custom');
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
