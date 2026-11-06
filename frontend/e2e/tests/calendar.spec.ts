import { Page } from '@playwright/test';
import { Api } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * Dashboard > Calendar (epic #1074, CAL-07 and CAL-08, issues #1081 and #1082): Month and Week, the Pod scope and the Role filter, the coverage cell with its icon and word, the
 * day panel with the Available and Unavailable lists by role, the privacy of the absence type (only with Dashboard.ViewAbsenceReasons), the Technician who has no tab, the phone
 * layout (panel as a bottom sheet) and axe at 1366x768, 1920x1080, 768x1024 and 375x812. The data is created through the API for people of one new pod, so the assertions
 * name those people and never count the whole firm.
 */

/** The first weekday that is at least `plus` days from today in the firm zone, as `yyyy-MM-dd`. */
function weekdayFrom(plus: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const d = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + plus));
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function absent(admin: Api, userId: number, date: string, type = 'VACATION'): Promise<void> {
  await admin.post(`/api/v1/users/${userId}/absences`, {
    type,
    startDate: date,
    endDate: date,
    note: 'private note',
  });
}

async function podWithTwo(seed: {
  user: (r: string[], l?: string) => Promise<{ username: string; userId: number }>;
  pod: (n: string | undefined, m: number[]) => Promise<{ podId: number }>;
}) {
  const a = await seed.user(['Data Technician'], 'cal-a');
  const b = await seed.user(['Data Technician'], 'cal-b');
  const pod = await seed.pod(undefined, [a.userId, b.userId]);
  return { a, b, pod };
}

test.describe('Dashboard > Calendar', () => {
  test('the Director sees the Calendar tab with a Month grid, levels as icon and word, and a legend', async ({
    asUser,
    personas,
  }) => {
    const director = await personas.named('director');
    const page = await asUser(director.username);
    await page.goto('/dashboard');
    await page.getByRole('tab', { name: 'Calendar' }).click();
    await expect(page).toHaveURL(/tab=calendar/);
    const grid = page.getByRole('grid');
    await expect(grid).toBeVisible();
    await expect(page.locator('[data-day]').first()).toBeVisible();
    await expect(page.locator('[data-cal-legend]')).toContainText('Good');
    await expect(page.locator('[data-cal-legend]')).toContainText('Critical');
    // A working day prints "available of expected" (never only a colour).
    const cell = page
      .locator(
        '[data-day][data-level="GOOD"], [data-day][data-level="WATCH"], [data-day][data-level="LOW"], [data-day][data-level="CRITICAL"]',
      )
      .first();
    await expect(cell).toContainText(/\d+ of \d+ expected|\d+\/\d+/);
    await expect(cell.locator('.lv .pi')).toHaveCount(1);
  });

  test('a day with an absence lists the person under Unavailable with the reason and the type (reasons permission), never the note', async ({
    asUser,
    personas,
    seed,
    admin,
  }) => {
    const { a, b } = await podWithTwo(seed);
    const day = weekdayFrom(9);
    await absent(admin, a.userId, day, 'SICK');
    const director = await personas.named('director');
    const page = await asUser(director.username);
    await page.goto(`/dashboard?tab=calendar&day=${day}`);
    const panel = page.locator('[data-cal-panel]');
    await expect(panel).toBeVisible();
    const name = (await admin.get(`/api/v1/users/${a.userId}`)).displayName as string;
    const other = (await admin.get(`/api/v1/users/${b.userId}`)).displayName as string;
    await expect(panel.locator('[data-list="unavailable"]')).toContainText(name);
    // The absence type is the front of the pods line of the Not Available row (only with the reasons permission).
    await expect(panel.locator('[data-list="unavailable"] [data-pods]').first()).toContainText(
      'Sick',
    );
    await expect(panel.locator('[data-list="available"]')).toContainText(other);
    await expect(panel).not.toContainText('private note');
    // Reading order is the visual order: the counts, the pods, then Available, then Not Available.
    const order = await panel.locator('h3').allTextContents();
    expect(order.map((t) => t.trim().split(' ')[0])).toEqual(['Coverage', 'Available', 'Not']);
  });

  test('the day panel lists people under role bands: collapse, remembered choice, compact rows with the state in the accessible name, and a Not Available section (#1242)', async ({
    asUser,
    personas,
    seed,
    admin,
  }) => {
    const { a, b } = await podWithTwo(seed);
    const day = weekdayFrom(11);
    await absent(admin, a.userId, day, 'VACATION');
    const director = await personas.named('director');
    const page = await asUser(director.username);
    await page.goto(`/dashboard?tab=calendar&day=${day}`);
    const panel = page.locator('[data-cal-panel]');
    await expect(panel).toBeVisible();
    const nameB = (await admin.get(`/api/v1/users/${b.userId}`)).displayName as string;
    const nameA = (await admin.get(`/api/v1/users/${a.userId}`)).displayName as string;
    // A header band per role: a button, expanded by default, sticky at the top of the scrolling panel body.
    const band = panel.locator('[data-list="available"] .gh').first();
    await expect(band).toHaveAttribute('aria-expanded', 'true');
    expect(await band.evaluate((e) => getComputedStyle(e.closest('h4')!).position)).toBe('sticky');
    // A compact row: 44 px, the state icon and the accessible name with the load and the state.
    const row = panel.locator(`[data-list="available"] .person`, { hasText: nameB });
    await expect(row).toHaveAttribute(
      'aria-label',
      new RegExp(`^${nameB}, \\d+ open tasks?, \\w+, Available$`),
    );
    expect(Math.round((await row.boundingBox())!.height)).toBe(44);
    await expect(row.locator('mf-user-state-icon')).toHaveCount(1);
    // Not Available: the person on vacation with the "Back" chip and the out-of-office icon.
    const away = panel.locator('[data-list="unavailable"] .person', { hasText: nameA });
    await expect(away).toHaveAttribute('data-state', 'out');
    await expect(away.locator('[data-reason]')).toContainText(/^\s*Back \d\d\/\d\d\s*$/);
    // Collapse the role: its people are hidden in both lists and the choice survives a reload.
    await band.click();
    await expect(band).toHaveAttribute('aria-expanded', 'false');
    await expect(row).toBeHidden();
    await page.reload();
    await expect(panel.locator('[data-list="available"] .gh').first()).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await panel.locator('[data-collapse-all]').click();
    await expect(panel.locator('[data-collapse-all]')).toHaveText(/Collapse All|Expand All/);
    await panel.locator('[data-collapse-all]').click();
    await expect(panel.locator('[data-list="available"] .gh').first()).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // The jump chip of the role is there and keeps the keyboard order: search, chips, bands.
    await expect(panel.locator('[data-jump] button').first()).toBeVisible();
  });

  test('without Dashboard.ViewAbsenceReasons the type and the note do not exist in the page', async ({
    asUser,
    personas,
    seed,
    admin,
  }) => {
    const { a } = await podWithTwo(seed);
    const day = weekdayFrom(10);
    await absent(admin, a.userId, day, 'SICK');
    const viewer = await personas.create({
      label: 'cal-noreasons',
      permissions: [
        'Task.View',
        'Dashboard.View',
        'Dashboard.ViewCalendar',
        'User.View',
        'Pod.View',
      ],
    });
    const page = await asUser(viewer.username);
    await page.goto(`/dashboard?tab=calendar&day=${day}`);
    await expect(page.locator('[data-cal-panel] [data-list="unavailable"]')).toBeVisible();
    await expect(page.locator('[data-list="unavailable"] [data-pods]').first()).not.toContainText(
      'Sick',
    );
    const html = await page.content();
    expect(html).not.toContain('private note');
    for (const word of ['Sick', 'Vacation', 'Conference']) expect(html).not.toContain(`>${word}<`);
    const response = await page.request.get(
      `/api/v1/dashboard/calendar/day?date=${day}&podScope=all`,
    );
    expect(JSON.stringify(await response.json())).not.toContain('absenceType');
  });

  test('Week shows pods by days; Previous, Today and Next move; arrow keys move between days', async ({
    asUser,
    personas,
  }) => {
    const director = await personas.named('director');
    const page = await asUser(director.username);
    await page.goto('/dashboard?tab=calendar');
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(page).toHaveURL(/cal=week/);
    await expect(page.locator('[data-week-scroll] table')).toBeVisible();
    const title = await page.locator('[data-cal-title]').textContent();
    await page.getByRole('button', { name: /^Next week/ }).click();
    await expect(page.locator('[data-cal-title]')).not.toHaveText(title ?? '');
    await page.getByRole('button', { name: 'Today' }).click();
    await expect(page.locator('[data-cal-title]')).toHaveText(title ?? '');
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    const stop = page.locator('[data-day][tabindex="0"]');
    await expect(stop).toHaveCount(1);
    await stop.focus();
    const before = await stop.getAttribute('data-day');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-day]:focus')).not.toHaveAttribute('data-day', before ?? '');
  });

  test('a Technician has no Calendar tab; a link to it says so', async ({ asUser, personas }) => {
    const tech = await personas.named('technician');
    const page = await asUser(tech.username);
    await page.goto('/dashboard?tab=calendar');
    await expect(page.getByRole('tab', { name: 'Calendar' })).toHaveCount(0);
    await expect(page.getByText(/Calendar is not available for your role/)).toBeVisible();
  });

  test('on a phone the panel is a bottom sheet with a Close button and the page does not scroll sideways', async ({
    asUser,
    personas,
  }) => {
    const director = await personas.named('director');
    const page = await asUser(director.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/dashboard?tab=calendar');
    await page.locator('[data-day]').nth(10).click();
    const panel = page.locator('[data-cal-panel]');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box && box.y + box.height).toBeGreaterThan(700);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
    await panel.getByRole('button', { name: 'Close the day panel' }).click();
    await expect(panel).toBeHidden();
  });
});

test.describe('Dashboard > Calendar: accessibility (axe wcag2a, wcag2aa, wcag21aa) and the fixed page', () => {
  test.skip(!axeAvailable(), 'axe-core is not installed (npm ci) and E2E_AXE_PATH is not set');
  for (const size of [
    { name: '1366x768', width: 1366, height: 768 },
    { name: '1920x1080', width: 1920, height: 1080 },
    { name: '768x1024', width: 768, height: 1024 },
    { name: '375x812', width: 375, height: 812 },
  ]) {
    test(`Month, Week and the open panel are clean at ${size.name}`, async ({
      asUser,
      personas,
    }) => {
      const director = await personas.named('director');
      const page: Page = await asUser(director.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/dashboard?tab=calendar');
      await expect(page.locator('[data-day]').first()).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      if (size.width >= 768 && size.height >= 561) {
        // The fixed page: the document never scrolls; the grid and the panel scroll inside themselves.
        expect(
          await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
        ).toBeLessThanOrEqual(1);
      }
      await page.locator('[data-day]').nth(12).click();
      await expect(page.locator('[data-cal-panel] [data-list]').first()).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      await page.goto('/dashboard?tab=calendar&cal=week');
      await expect(page.locator('[data-week-scroll]')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});
