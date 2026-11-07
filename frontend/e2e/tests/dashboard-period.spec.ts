import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { seedBoard } from '../support/board';
import { dateInZone, FIRM_ZONE } from '../support/time';
import { uid } from '../support/seed';
import { dropdownByAttr } from '../support/dropdown';

/**
 * One shareable period model (review 2, WP3, issue #91): the same label, list and address on Summary, Trends and Coverage; the address wins
 * over memory; a custom range is checked inline; old stored values migrate; the scope note says where the period does not apply.
 * With E2E_SCREENSHOTS set to a folder the run also writes the screenshots of docs/ux/dashboard-review-2/fixes/wp3.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const CORE = ['7 Days', '30 Days', '90 Days', 'This Month', 'Last Month', 'Custom'];
const COVERAGE = [
  '7 Days',
  '30 Days',
  '90 Days',
  'This Month',
  'Last Month',
  'Last 6 Months',
  'Last 12 Months',
  'Custom',
];
const NOTE =
  'Applies to Completed and Created. Open, Overdue, Due soon, Unassigned, On hold and ASAP are not affected.';

test.describe.configure({ timeout: 180_000 });

/** A Pod the run owns: the figures of its scope change only through this file, while the rest of the database keeps growing under other workers. */
let ownPod = 0;

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
  ownPod = (await seedBoard(admin, seed, { tasks: 24 })).podId;
});

async function shoot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const period = (page: Page) => dropdownByAttr(page, 'data-period');
const options = (page: Page) => ({ texts: () => period(page).optionTexts() });
/**
 * Dashboard v4 (epic #1063): the Overview and its Period control left Summary, so the period is opened where it lives, on Trends (the address keeps `period`, `from` and
 * `to` for every tab). The name is kept so the tests below read as before.
 */
async function openSummary(page: Page, url = '/dashboard') {
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'tab=trends');
  await expect(page.locator('[data-plot]').first()).toBeVisible({ timeout: 20_000 });
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
    expect(await options(page).texts()).toEqual(CORE);
    await expect(period(page)).toHaveAttribute('data-value', '30d');
    await expect(page).toHaveURL(/\/dashboard\?tab=trends$/);

    await openTrends(page);
    expect(await options(page).texts()).toEqual(CORE);
    await expect(page.getByText('Completed and created in')).toHaveCount(0);

    await openCoverage(page);
    expect(await options(page).texts()).toEqual(COVERAGE);
  });

  test('Swimlane has its own window, "Done in the last"', async ({ page }) => {
    await page.goto('/dashboard?tab=swimlane');
    // The window lives in the "..." menu of the Swimlane toolbar.
    await page.getByRole('button', { name: 'More options' }).click();
    await expect(page.getByRole('group', { name: 'Done in the last' })).toBeVisible();
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
    await period(page).selectOption({ label: '90 Days' });
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
    await expect(period(other)).toHaveAttribute('data-value', '90d');
    await expect(other).toHaveURL(/period=90d/);
    // The Pod Lead's own memory is not the default any more either: the link counts as their choice.
    await other.goto('/dashboard');
    await expect(period(other)).toHaveAttribute('data-value', '90d');
    await other.close();
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
    await expect(page).toHaveURL(
      /period=custom&(?:tab=trends&)?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/,
    );
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
    // Scoped to the Pod this file owns: a count over the whole database would move between the two reads whenever another worker creates a task.
    await openSummary(page, `/dashboard?period=custom&from=${start}&to=${end}&pod=${ownPod}`);
    const body = (await (await summary).json()) as {
      period: { days: number; from: string; to: string };
      created: { count: number };
      completed: { count: number };
    };
    expect(body.period).toMatchObject({ days: 31, from: start, to: end });
    expect(body.created.count).toBeGreaterThan(0);

    const trend = await page.request.get(
      `/api/v1/dashboard/trend?period=custom&from=${start}&to=${end}&podScope=${ownPod}`,
    );
    const t = (await trend.json()) as { all: { created: number; completed: number }[] };
    expect(t.all).toHaveLength(31);
    expect(t.all.reduce((n, d) => n + d.created, 0)).toBe(body.created.count);
    expect(t.all.reduce((n, d) => n + d.completed, 0)).toBe(body.completed.count);
  });
});

test.describe('accessibility and screens', () => {
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
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
      await expect(period(page)).toHaveAttribute('data-value', '12m');
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
