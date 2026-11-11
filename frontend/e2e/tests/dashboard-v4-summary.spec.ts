import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Dashboard Summary v4 (epic #1063, decision AS; DB-03 to DB-07): three cards that filter the grid, the grid in the list standard with the Type icon, the Due `+9d` suffix
 * and the inline Assign control, the capacity battery with its People popover, the unassigned gauge, the Scope, the Technician's queue and the phone layout.
 * Each test seeds its own tasks with a unique tag, so the counts it checks are about its own rows (the cards are scope-wide, the grid is searched by the tag).
 */
test.describe.configure({ timeout: 180_000 });

const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

const card = (page: import('@playwright/test').Page, key: string) =>
  page.locator(`[data-card="${key}"]`);
const total = (page: import('@playwright/test').Page) =>
  page.locator('mf-dash-grid [data-list-count]');

test.describe('Summary v4', () => {
  test('the cards filter the grid, a second click clears it, and the Overview is gone', async ({
    seed,
    page,
  }) => {
    const world = await seed.world();
    const tag = uid();
    // One pod of this test's own: the cards and the grid then count only its two tasks, whatever other workers create in the firm meanwhile.
    const tech = await seed.user(['Data Technician'], 'v4cards');
    const pod = await seed.pod(undefined, [tech.userId]);
    await seed.task(world, {
      title: `Overdue ${tag}`,
      dueDate: dateInZone(FIRM_ZONE, -4),
      assignedPodId: pod.podId,
    });
    await seed.task(world, { title: `Open unassigned ${tag}`, assignedPodId: pod.podId });

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/dashboard?pod=${pod.podId}`);
    await expect(page.locator('[data-dash-cards]')).toBeVisible();
    await expect(page.locator('[data-card]')).toHaveCount(3);
    await expect(page.locator('mf-stat-tile, [data-group="overview"]')).toHaveCount(0);
    await expect(page.locator('mf-dropdown[data-period]')).toHaveCount(0);
    await expect(total(page)).toBeVisible();

    await expect(card(page, 'overdue').locator('[data-card-count]')).toHaveText('1');
    const overdue = 1;
    await card(page, 'overdue').click();
    await expect(page).toHaveURL(/card=overdue/);
    await expect(card(page, 'overdue')).toHaveAttribute('aria-pressed', 'true');
    // Pressing a card and the title count agree (no other filter is on).
    await expect(total(page)).toHaveText(String(overdue));
    await expect(page.locator('[data-chip="card"]')).toContainText('Overdue');
    await page.getByRole('searchbox', { name: 'Search tasks' }).fill(tag);
    await expect(page.getByText(`Overdue ${tag}`)).toBeVisible();
    await expect(page.getByText(`Open unassigned ${tag}`)).toHaveCount(0);
    // The card keeps its scope-wide number while Search narrows the grid.
    await expect(card(page, 'overdue').locator('[data-card-count]')).toHaveText(String(overdue));

    await card(page, 'overdue').click();
    await expect(card(page, 'overdue')).toHaveAttribute('aria-pressed', 'false');
    await expect(page).not.toHaveURL(/card=/);

    // Arrow keys move between the cards.
    await card(page, 'overdue').focus();
    await page.keyboard.press('ArrowRight');
    await expect(card(page, 'unassigned')).toBeFocused();
  });

  test('the Unassigned card adds the Unassigned for column and sorts longest waiting first', async ({
    seed,
    page,
  }) => {
    const world = await seed.world();
    await seed.task(world, { title: `Waiting ${uid()}` });
    await page.goto('/dashboard');
    await card(page, 'unassigned').click();
    await expect(page.locator('mf-dash-grid th[data-col="unassignedFor"]')).toBeVisible();
    await expect(page.locator('[data-sorted-text]')).toContainText('Sorted by Unassigned for');
    await expect(page.locator('mf-dash-grid td[data-col="unassignedFor"]').first()).toBeVisible();
    await card(page, 'unassigned').click();
    await expect(page.locator('mf-dash-grid th[data-col="unassignedFor"]')).toHaveCount(0);
  });

  test('Type shows the chip and the type name, and an overdue Due is the date and +Nd on one line', async ({
    seed,
    page,
  }) => {
    const world = await seed.world();
    const tag = uid();
    await seed.task(world, { title: `Late ${tag}`, dueDate: dateInZone(FIRM_ZONE, -9) });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/dashboard?card=overdue&q=${tag}`);
    const row = page.locator('mf-dash-grid [data-task]').first();
    await expect(row).toBeVisible();
    const type = row.locator('td[data-col="type"]');
    await expect(type.locator('[data-type-chip]')).toBeVisible();
    await expect(type.locator('[data-type-name]')).not.toHaveText('');
    const due = row.locator('td[data-col="due"]');
    await expect(due.locator('[data-due-suffix]')).toHaveText('+9d');
    await expect(due.locator('[data-due-suffix-cell]')).toHaveAttribute('title', /9 days overdue/);
    const date = await due.locator('[data-due-date]').boundingBox();
    const suffix = await due.locator('[data-due-suffix]').boundingBox();
    // One line: the suffix sits beside the date, not under it.
    expect(Math.abs(date!.y - suffix!.y)).toBeLessThan(8);
    expect(suffix!.x).toBeGreaterThan(date!.x);
  });

  test('a Director assigns an unassigned task from the grid: the row leaves, the Unassigned card drops by one, Technician sees no Assign', async ({
    seed,
    page,
    asUser,
    personas,
  }) => {
    const world = await seed.world();
    const tag = uid();
    // A pod of this test's own, so the Unassigned card counts only this task whatever other workers create in the firm meanwhile.
    const member = await seed.user(['Data Technician'], 'v4assign');
    const pod = await seed.pod(undefined, [member.userId]);
    await seed.task(world, { title: `Assign me ${tag}`, assignedPodId: pod.podId });
    await page.goto(`/dashboard?pod=${pod.podId}&card=unassigned&q=${tag}`);
    const row = page.locator('mf-dash-grid [data-task]').first();
    await expect(row).toBeVisible();
    // The summary is served from a 15 second server cache: a read made just after an earlier test may not hold the task seeded above. Refresh reads it again.
    await page.locator('[data-refresh]').click();
    await expect(page.locator('[data-refresh]')).toBeEnabled();
    await expect
      .poll(async () =>
        Number(await card(page, 'unassigned').locator('[data-card-count]').innerText()),
      )
      .toBe(1);

    const assign = row.getByRole('button', { name: 'Unassigned: assign this task' });
    await assign.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Search People' })).toBeFocused();
    // Each person shows the state and the load.
    await expect(page.locator('.im-pop [data-option-hint]').first()).toContainText(/open/);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('mf-dash-grid [data-task]')).toHaveCount(0);
    await expect
      .poll(async () =>
        Number(await card(page, 'unassigned').locator('[data-card-count]').innerText()),
      )
      .toBe(0);

    const tech = await personas.named('technician');
    const techPage = await asUser(tech.username);
    await techPage.goto('/dashboard');
    await expect(techPage.locator('mf-dash-grid, [data-dash-cards]')).toHaveCount(0);
  });

  test('a conflict (someone else assigned the task first) shows the clear message and reloads the row', async ({
    seed,
    page,
    personas,
  }) => {
    const world = await seed.world();
    const tag = uid();
    const task = await seed.task(world, { title: `Conflict ${tag}` });
    const other = await personas.named('technician');
    await page.goto(`/dashboard?card=unassigned&q=${tag}`);
    const row = page.locator('mf-dash-grid [data-task]').first();
    await expect(row).toBeVisible();
    // Someone else assigns it behind the page's back: the page's row version is now old.
    await seed.admin.post(`/api/v1/tasks/${task.taskId}/assignment`, {
      rowVersion: task.rowVersion,
      userId: other.userId,
    });
    await row.getByRole('button', { name: 'Unassigned: assign this task' }).click();
    await page.locator('.im-pop [data-option]').first().click();
    await expect(
      page.getByText('This task was changed by someone else. The row was reloaded.'),
    ).toBeVisible();
  });

  test('the battery shows the remaining capacity inside it, People opens a searchable dialog and Escape returns focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/dashboard');
    const battery = page.locator('[data-battery]');
    await expect(battery).toBeVisible();
    // On an empty database nobody takes work yet: the card says so (`[data-battery-empty]`) instead of drawing the percentage.
    await expect(battery.locator('[data-battery-big], [data-battery-empty]')).toHaveText(
      /\d+%|After hours|Everyone out|No one in this scope takes work yet/,
    );
    const people = battery.getByRole('button', { name: 'People' });
    if (await people.count()) {
      await people.click();
      const dialog = page.getByRole('dialog', { name: /People/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('searchbox', { name: 'Search People' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(people).toBeFocused();
    }
    // The page does not scroll.
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
    ).toBe(true);
  });

  test('the gauge button selects the Unassigned card sorted by the longest wait', async ({
    seed,
    page,
  }) => {
    const world = await seed.world();
    await seed.task(world, { title: `Gauge ${uid()}` });
    await page.goto('/dashboard');
    const gauge = page.locator('[data-gauge]');
    await expect(gauge).toBeVisible();
    await expect(gauge.locator('[data-gauge-badge]')).toContainText(/Level \d|Normal|All clear/);
    await gauge.getByRole('button', { name: /Show them, longest waiting first/ }).click();
    await expect(card(page, 'unassigned')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-sorted-text]')).toContainText('Sorted by Unassigned for');
  });

  test('Hide Panel gives the grid the full width and puts a compact battery and gauge on the cards row; the choice is remembered (#1233)', async ({
    seed,
    page,
  }) => {
    const world = await seed.world();
    await seed.task(world, { title: `Panel ${uid()}` });
    for (const size of [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      await page.goto('/dashboard');
      const hide = page.getByRole('button', { name: 'Hide Panel', exact: true });
      await expect(hide).toHaveAttribute('aria-expanded', 'true');
      const where = (await hide.boundingBox())!;
      await expect(page.locator('[data-dash-compact]')).toHaveCount(0);
      const shown = (await page.locator('mf-dash-grid').boundingBox())!.width;
      await hide.click();
      const expand = page.getByRole('button', { name: 'Show Panel', exact: true });
      await expect(expand).toHaveAttribute('aria-expanded', 'false');
      await expect(expand).toBeFocused();
      // One button, one place: the same x and y in both states, at the far right of the cards row.
      const moved = (await expand.boundingBox())!;
      expect(Math.abs(moved.x - where.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(moved.y - where.y)).toBeLessThanOrEqual(1);
      await expect(page.locator('[data-dash-rcol]')).toBeHidden();
      await expect(page.locator('[data-compact-battery]')).toBeVisible();
      await expect(page.locator('[data-compact-gauge]')).toBeVisible();
      expect((await page.locator('mf-dash-grid').boundingBox())!.width).toBeGreaterThan(
        shown + 300,
      );
      // Same row as the cards, never wrapped, nothing sideways.
      const cards = (await page.locator('[data-dash-cards]').boundingBox())!;
      const gauge = (await page.locator('[data-compact-gauge]').boundingBox())!;
      expect(Math.abs(cards.y + cards.height / 2 - (gauge.y + gauge.height / 2))).toBeLessThan(12);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
      // Remembered for this user: a reload keeps it hidden; the gauge selects the Unassigned card.
      await page.reload();
      await expect(page.locator('[data-compact-gauge]')).toBeVisible();
      await page.locator('[data-compact-gauge]').click();
      await expect(card(page, 'unassigned')).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Show Panel', exact: true }).click();
      await expect(page.locator('[data-dash-rcol]')).toBeVisible();
      await expect(page.locator('[data-compact-battery]')).toHaveCount(0);
    }
  });

  test('a Pod Lead opens on My pods', async ({ seed, asUser, personas }) => {
    const lead = await personas.named('podLead');
    await seed.pod(`Lead pod ${uid()}`, [lead.userId]);
    const page = await asUser(lead.username);
    await page.goto('/dashboard');
    await expect(page.locator('[data-dash-cards]')).toBeVisible();
    await expect(page.locator('mf-dropdown[data-scope] button')).toHaveAttribute(
      'data-value',
      'mine',
    );
  });
});

test.describe('Summary v4 at both desktop sizes', () => {
  for (const size of SIZES) {
    test(`${size.width}x${size.height}: axe is clean, the page never scrolls sideways${size.width >= 768 ? ' or down' : ''}`, async ({
      seed,
      page,
    }) => {
      const world = await seed.world();
      await seed.task(world, { title: `Sized ${uid()}` });
      await page.setViewportSize(size);
      await page.goto('/dashboard');
      await expect(page.locator('[data-dash-cards]')).toBeVisible();
      await expect(page.locator('mf-dash-grid [data-task]').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      if (size.width >= 768 && size.height >= 561) {
        expect(
          await page.evaluate(
            () => document.documentElement.scrollHeight <= window.innerHeight + 1,
          ),
        ).toBe(true);
      }
      if (size.width < 768) {
        // The three cards stay in one row (the phone layout of the mockup) and the right column sits above the tasks.
        const boxes = await page
          .locator('[data-card]')
          .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
        expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(4);
        const rcol = await page.locator('[data-dash-rcol]').boundingBox();
        const grid = await page.locator('mf-dash-grid').boundingBox();
        expect(rcol!.y).toBeLessThan(grid!.y);
      }
      if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
    });
  }
});
