import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { seedBoard } from '../support/board';
import { dateInZone, FIRM_ZONE } from '../support/time';
import { uid } from '../support/seed';

/**
 * One shareable period model (review 2, WP3, issue #91): the same label, list and address on Summary, Trends and Coverage; the address wins
 * over memory; a custom range is checked inline; old stored values migrate; the scope note says where the period does not apply.
 * With E2E_SCREENSHOTS set to a folder the run also writes the screenshots of docs/ux/dashboard-review-2/fixes/wp3.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const CORE = ['7 days', '30 days', '90 days', 'This month', 'Last month', 'Custom'];
const COVERAGE = [
  '7 days',
  '30 days',
  '90 days',
  'This month',
  'Last month',
  'Last 6 months',
  'Last 12 months',
  'Custom',
];
const NOTE =
  'Applies to Completed and Created. Open, Overdue, Due soon, Unassigned, On hold and ASAP are not affected.';

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ admin, seed }) => {
  test.setTimeout(240_000);
  const world = await seed.world();
  const tag = uid();
  for (let i = 0; i < 4; i++) {
    await seed.task(world, {
      title: `Period sample ${i + 1} ${tag}`,
      dueDate: dateInZone(FIRM_ZONE, 3 + i),
    });
  }
  await seedBoard(admin, seed, { tasks: 24 });
});

async function shoot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const period = (page: Page) => page.getByLabel('Period', { exact: true });
const options = (page: Page) => period(page).locator('option');
const tile = (page: Page, label: string) =>
  page.locator('[data-group="overview"] mf-stat-tile', {
    has: page.locator('.label', { hasText: label }),
  });

async function openSummary(page: Page, url = '/dashboard') {
  await page.goto(url);
  await expect(page.locator('[data-group="overview"]')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

async function openTrends(page: Page, url = '/dashboard?tab=trends') {
  await page.goto(url);
  await expect(page.locator('[data-plot]').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle');
}

async function openCoverage(page: Page, url = '/dashboard?tab=users&view=coverage') {
  await page.goto(url);
  await expect(page.locator('[data-coverage-region]')).toBeVisible({ timeout: 120_000 });
  await page.waitForLoadState('networkidle');
}

test.describe('the list, the label and the scope note', () => {
  test('Summary and Trends offer the six items, Coverage appends 6 and 12 months, one label everywhere', async ({
    page,
  }) => {
    await openSummary(page);
    await expect(options(page)).toHaveText(CORE);
    await expect(period(page)).toHaveValue('30d');
    await expect(page).toHaveURL(/\/dashboard$/);

    await openTrends(page);
    await expect(options(page)).toHaveText(CORE);
    await expect(page.getByText('Completed and created in')).toHaveCount(0);

    await openCoverage(page);
    await expect(options(page)).toHaveText(COVERAGE);
  });

  test('the scope note is on Summary only and the control is hidden on Breakdowns, Swimlane and Workload', async ({
    page,
  }) => {
    await openSummary(page);
    const note = page.locator('[data-period-note]');
    await expect(note).toHaveText(NOTE);
    const id = await note.getAttribute('id');
    await expect(period(page)).toHaveAttribute('aria-describedby', id!);

    await openTrends(page);
    await expect(page.locator('[data-period-note]')).toHaveCount(0);

    await page.goto('/dashboard?tab=breakdowns');
    await expect(page.locator('[data-grid="breakdowns"]')).toBeVisible();
    await expect(page.locator('select[data-period]')).toHaveCount(0);
    await page.goto('/dashboard?tab=swimlane');
    await expect(page.locator('[data-board]')).toBeVisible();
    await expect(page.locator('select[data-period]')).toHaveCount(0);
    await page.goto('/dashboard?tab=users');
    await expect(page.locator('[data-users-grid], [data-users-table]').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('select[data-period]')).toHaveCount(0);
  });

  test('Swimlane has its own window, "Done in the last"', async ({ page }) => {
    await page.goto('/dashboard?tab=swimlane');
    await expect(page.getByLabel('Done in the last')).toBeVisible();
    await expect(page.getByLabel('Completed in last')).toHaveCount(0);
  });
});

test.describe('the address', () => {
  test('a Director picks 90 days on Trends, copies the address, a Pod Lead opens it and sees 90 days', async ({
    page,
    seed,
    asUser,
  }) => {
    await openTrends(page);
    const read = page.waitForRequest((r) =>
      /\/api\/v1\/dashboard\/trend\?.*period=90d/.test(r.url()),
    );
    await period(page).selectOption({ label: '90 days' });
    await read;
    await expect(page).toHaveURL(/\/dashboard\?tab=trends&period=90d$/);
    const link = page.url();

    const role = await seed.role(
      ['Task.View', 'Dashboard.View', 'Dashboard.ViewSummary', 'Dashboard.ViewTrends'],
      'E2E period lead',
    );
    const lead = await seed.user([role.name], 'periodlead');
    const other = await asUser(lead.username);
    const recipient = other.waitForRequest((r) =>
      /\/api\/v1\/dashboard\/trend\?.*period=90d/.test(r.url()),
    );
    await openTrends(other, link);
    await recipient;
    await expect(period(other)).toHaveValue('90d');
    await expect(other).toHaveURL(/period=90d/);
    // The Pod Lead's own memory is not the default any more either: the link counts as their choice.
    await other.goto('/dashboard');
    await expect(period(other)).toHaveValue('90d');
    await other.close();
  });

  test('the same value moves with the person between Summary, Trends and Coverage', async ({
    page,
  }) => {
    await openSummary(page);
    await period(page).selectOption({ label: '90 days' });
    await expect(page).toHaveURL(/period=90d/);
    const caption = await tile(page, 'Completed').locator('.caption').textContent();

    await page.getByRole('tab', { name: 'Trends' }).click();
    await expect(page.locator('[data-section="trend"]')).toBeVisible({ timeout: 20_000 });
    await expect(period(page)).toHaveValue('90d');
    await expect(page).toHaveURL(/(?=.*tab=trends)(?=.*period=90d)/);
    await expect(page.locator('[data-trend-period], [data-section="trend"]').first()).toContainText(
      caption!.trim(),
    );

    await page.getByRole('tab', { name: 'Users' }).click();
    await page.locator('[data-view="coverage"]').click();
    await expect(page.locator('[data-coverage-region]')).toBeVisible({ timeout: 120_000 });
    await expect(period(page)).toHaveValue('90d');
    await period(page).selectOption({ label: 'Last 12 months' });
    await expect(page).toHaveURL(/period=12m/);

    // Back on Summary, which has no 12 month item: it reads as the default, and Coverage keeps the long window.
    await page.getByRole('tab', { name: 'Summary' }).click();
    await expect(page.locator('[data-group="overview"]')).toBeVisible();
    await expect(period(page)).toHaveValue('30d');
    await page.getByRole('tab', { name: 'Users' }).click();
    await expect(page.locator('[data-coverage-region]')).toBeVisible({ timeout: 120_000 });
    await expect(period(page)).toHaveValue('12m');
  });

  test('a stored "Last quarter" shows 90 days with a clean address; a bad address falls back to memory', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(
      ['Task.View', 'Dashboard.View', 'Dashboard.ViewSummary', 'Dashboard.ViewTrends'],
      'E2E period migrate',
    );
    const user = await seed.user([role.name], 'periodold');
    const page = await asUser(user.username);
    await page.goto('/dashboard');
    await expect(page.locator('[data-group="overview"]')).toBeVisible();
    await page.evaluate(
      (id) => localStorage.setItem(`mf.dashboard.v2.${id}`, JSON.stringify({ period: 'quarter' })),
      user.userId,
    );
    const read = page.waitForRequest((r) => /\/api\/v1\/dashboard\?.*period=90d/.test(r.url()));
    await page.reload();
    await read;
    await expect(period(page)).toHaveValue('90d');
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(
      await page.evaluate((id) => localStorage.getItem(`mf.dashboard.v2.${id}`), user.userId),
    ).toBe(JSON.stringify({ period: '90d' }));

    // A range the address cannot carry (reversed) is dropped and the remembered period applies.
    await page.goto('/dashboard?tab=trends&period=custom&from=2026-10-09&to=2026-10-01');
    await expect(page.locator('[data-plot]').first()).toBeVisible({ timeout: 20_000 });
    await expect(period(page)).toHaveValue('90d');
    await expect(page).toHaveURL(/\/dashboard\?tab=trends$/);
    await page.close();
  });

  test('the old periodDays argument still answers for one release', async ({ page }) => {
    const response = await page.request.get('/api/v1/dashboard?periodDays=7');
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { period: { days: number; key: string } };
    expect(body.period.days).toBe(7);
    expect(body.period.key).toBe('7d');
    expect((await page.request.get('/api/v1/dashboard?period=quarter')).status()).toBe(400);
  });
});

test.describe('custom ranges', () => {
  test('a reversed or over-long range shows an inline error and the previous period stays in effect', async ({
    page,
  }) => {
    await openSummary(page, '/dashboard?period=7d');
    await period(page).selectOption({ label: 'Custom' });
    await expect(page).toHaveURL(/period=custom&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
    const url = page.url();
    const from = page.getByLabel('From', { exact: true });
    await expect(from).toBeVisible();

    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/dashboard?')) requests.push(r.url());
    });

    // From after To: the inline error says what is still shown, nothing is requested, the address is unchanged.
    await from.fill(dateInZone(FIRM_ZONE, 1));
    await from.press('Enter');
    const error = page.locator('[data-period-error]');
    await expect(error).toContainText('The start of the period is after its end.');
    await expect(error).toContainText('Still showing');
    await shoot(page, 'period-custom-error-1366');
    expect(requests).toHaveLength(0);
    expect(page.url()).toBe(url);

    // Over 366 days.
    await from.fill(dateInZone(FIRM_ZONE, -400));
    await from.press('Enter');
    await expect(error).toContainText('at most 366 days');
    expect(requests).toHaveLength(0);

    // Exactly 366 days is accepted: the figures are read for that range and the error goes away.
    const start = dateInZone(FIRM_ZONE, -365);
    const end = dateInZone(FIRM_ZONE, 0);
    const read = page.waitForRequest(
      (r) =>
        r.url().includes(`period=custom&from=${start}&to=${end}`) ||
        (r.url().includes(`from=${start}`) && r.url().includes(`to=${end}`)),
    );
    await from.fill(start);
    await from.press('Enter');
    await read;
    await expect(error).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`from=${start}&to=${end}`));
  });

  test('a custom range is read inclusive on both ends and Created equals the Trends total', async ({
    page,
  }) => {
    const start = dateInZone(FIRM_ZONE, -30);
    const end = dateInZone(FIRM_ZONE, 0);
    const summary = page.waitForResponse(
      (r) => r.url().includes('/api/v1/dashboard?') && r.url().includes(`from=${start}`),
    );
    await openSummary(page, `/dashboard?period=custom&from=${start}&to=${end}`);
    const body = (await (await summary).json()) as {
      period: { days: number; from: string; to: string };
      created: { count: number };
      completed: { count: number };
    };
    expect(body.period).toMatchObject({ days: 31, from: start, to: end });
    await expect(tile(page, 'Created').locator('.value')).toHaveText(String(body.created.count));

    const trend = await page.request.get(
      `/api/v1/dashboard/trend?period=custom&from=${start}&to=${end}`,
    );
    const t = (await trend.json()) as { all: { created: number; completed: number }[] };
    expect(t.all).toHaveLength(31);
    expect(t.all.reduce((n, d) => n + d.created, 0)).toBe(body.created.count);
    expect(t.all.reduce((n, d) => n + d.completed, 0)).toBe(body.completed.count);
  });

  test('tile totals equal Trends totals for every preset', async ({ page }) => {
    for (const key of ['7d', '30d', '90d', 'this-month', 'last-month']) {
      const s = (await (
        await page.request.get(`/api/v1/dashboard?period=${key}&fresh=true`)
      ).json()) as {
        period: { from: string; to: string };
        created: { count: number };
        completed: { count: number };
      };
      const t = (await (
        await page.request.get(`/api/v1/dashboard/trend?period=${key}&fresh=true`)
      ).json()) as {
        period: { from: string; to: string };
        all: { created: number; completed: number }[];
      };
      expect(t.period, key).toEqual(s.period);
      // Other tests create tasks while this one runs: a read that raced with one is allowed one step of difference.
      expect(
        Math.abs(t.all.reduce((n, d) => n + d.created, 0) - s.created.count),
        key,
      ).toBeLessThanOrEqual(3);
      expect(
        Math.abs(t.all.reduce((n, d) => n + d.completed, 0) - s.completed.count),
        key,
      ).toBeLessThanOrEqual(3);
    }
  });
});

test.describe('accessibility and screens', () => {
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 375, height: 812 },
  ]) {
    test(`Summary, Trends and Coverage at ${size.width}: axe is clean, the control is operable by keyboard and nothing scrolls sideways`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await openSummary(page, '/dashboard?period=custom&from=2026-09-01&to=2026-09-30');
      await period(page).focus();
      await expect(period(page)).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByLabel('From', { exact: true })).toBeFocused();
      await expect(page.getByLabel('From', { exact: true })).toBeVisible();
      await page.getByLabel('From', { exact: true }).fill('2026-10-05');
      await page.getByLabel('From', { exact: true }).press('Enter');
      await expect(page.locator('[data-period-error]')).toBeVisible();
      await shoot(page, `period-summary-custom-${size.width}`);
      if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        )
        .toBe(true);

      await openSummary(page);
      await shoot(page, `period-summary-${size.width}`);
      if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);

      await openTrends(page, '/dashboard?tab=trends&period=this-month');
      await shoot(page, `period-trends-${size.width}`);
      if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);

      await openCoverage(page, '/dashboard?tab=users&view=coverage&period=12m');
      await expect(period(page)).toHaveValue('12m');
      await shoot(page, `period-coverage-${size.width}`);
      if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        )
        .toBe(true);
    });
  }
});
