import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * Dashboard shell foundations (UX review 2, WP1): P2 tabs independent, P7 shared state component, P6 staleness text, P9 address defaults,
 * R1 note for a forbidden tab link, R2 menu item. Screenshots go to the folder in E2E_SCREENSHOTS when it is set
 * (docs/ux/dashboard-review-2/fixes/wp1); the tests run without it.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 1366, height: 768, name: '1366' },
  { width: 375, height: 812, name: '375' },
];
const SUMMARY_API = /\/api\/v1\/dashboard(\?|$)/;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function expectAxeClean(page: Page): Promise<void> {
  if (!axeAvailable()) return;
  expect(await axeViolations(page)).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

const failSummary = (page: Page) =>
  page.route(SUMMARY_API, (route) =>
    route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR', traceId: 'trace-wp1-0001' } }),
  );

test.describe('Dashboard shell: tabs are independent (P2) and errors stay in the tab (P7)', () => {
  test('a failing /api/v1/dashboard does not blank Users or Swimlane, which never call it', async ({
    page,
  }) => {
    const calls: string[] = [];
    page.on('request', (r) => {
      if (SUMMARY_API.test(r.url())) calls.push(r.url());
    });
    await failSummary(page);
    for (const tab of ['users', 'swimlane']) {
      await page.goto(`/dashboard?tab=${tab}`);
      await expect(page.getByRole('tab', { name: 'Summary' })).toBeVisible();
      await expect(page.locator(`[data-tabpanel="${tab}"]`)).toBeVisible();
      if (tab === 'users') {
        await expect(page.getByRole('heading', { name: 'Team workload' })).toBeAttached();
      } else {
        await expect(page.getByRole('region', { name: 'Swimlane board' })).toBeVisible();
      }
      await expect(page.locator('[data-dash-state="error"]')).toHaveCount(0);
      await expect(page.locator('[data-refresh]')).toBeVisible();
    }
    expect(calls).toEqual([]);
  });

  test('the Users tab keeps working through the five-minute timer without asking for the summary', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-10-14T15:00:00Z') });
    const calls: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/v1\/dashboard\/workload/.test(r.url())) calls.push('workload');
      else if (SUMMARY_API.test(r.url())) calls.push('summary');
    });
    await page.goto('/dashboard?tab=users');
    await expect(page.getByRole('heading', { name: 'Team workload' })).toBeAttached();
    await page.clock.fastForward('05:05');
    await expect.poll(() => calls.filter((c) => c === 'workload').length).toBeGreaterThan(1);
    expect(calls.filter((c) => c === 'summary')).toEqual([]);
  });

  test('a failing summary shows one inline error in the panel: tab row and Refresh stay, no toast, Retry works', async ({
    page,
  }) => {
    await failSummary(page);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/dashboard?tab=breakdowns');
      const error = page.locator('[data-tabpanel="breakdowns"] [data-dash-state="error"]');
      await expect(error).toBeVisible();
      await expect(error).toContainText('The dashboard could not be loaded.');
      await expect(error).toContainText('trace-wp1-0001');
      await expect(error.getByRole('button', { name: 'Retry' })).toBeVisible();
      await expect(page.getByRole('tablist', { name: 'Dashboard views' })).toBeVisible();
      await expect(page.locator('[data-refresh]')).toBeVisible();
      await expect(page.locator('[role="alert"]:visible')).toHaveCount(1);
      // The inline error replaces the toast: wait past the 400 ms hold-back and look again.
      await page.waitForTimeout(800);
      await expect(page.locator('.p-toast-message')).toHaveCount(0);
      await shot(page, `01-error-breakdowns-${size.name}`);
      await expectAxeClean(page);
    }
    await page.unroute(SUMMARY_API);
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('[data-dash-state="error"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Open by priority' })).toBeVisible();
    // Focus lands on the first control of the refreshed content, not on a vanished button.
    await expect(page.locator('body')).not.toBeFocused();
  });

  test('a deep link to Trends keeps its context when the summary fails', async ({ page }) => {
    await failSummary(page);
    await page.goto('/dashboard?tab=trends&metric=completed');
    await expect(page.locator('[data-tabpanel="trends"] [data-dash-state="error"]')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Trends' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page).toHaveURL(/tab=trends&metric=completed/);
  });

  test('the swimlane and users errors use the same state block, with a text Retry', async ({
    page,
  }) => {
    await page.route('**/api/v1/dashboard/swimlane**', (route) =>
      route.fulfill({ status: 500, json: { code: 'INTERNAL_ERROR', traceId: 'trace-wp1-0002' } }),
    );
    await page.route('**/api/v1/dashboard/workload**', (route) => route.abort());
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/dashboard?tab=swimlane');
      await expect(page.locator('[data-dash-state="error"]')).toContainText(
        'The swimlane board could not be loaded.',
      );
      await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
      await shot(page, `02-error-swimlane-${size.name}`);
      await expectAxeClean(page);
      await page.goto('/dashboard?tab=users');
      await expect(page.locator('[data-dash-state="error"]')).toContainText(
        'The team workload could not be loaded.',
      );
      await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
      await shot(page, `03-error-users-${size.name}`);
      await expectAxeClean(page);
    }
  });

  test('a failed background refresh keeps the figures and shows the stale banner with Retry', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-10-14T15:00:00Z') });
    await page.goto('/dashboard?tab=summary');
    await expect(page.locator('[data-group="attention"]')).toBeVisible();
    await failSummary(page);
    await page.clock.fastForward('05:05');
    const banner = page.locator('[data-dash-state="stale"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Could not refresh. Showing data from');
    await expect(page.locator('[data-group="attention"]')).toBeVisible();
    await expect(page.locator('.p-toast-message')).toHaveCount(0);
    // The banner takes precedence: the age text does not repeat it.
    await page.clock.fastForward('06:00');
    await expect(page.locator('[data-stale-age]')).toHaveCount(0);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await shot(page, `04-stale-banner-${size.name}`);
      await expectAxeClean(page);
    }
    await page.unroute(SUMMARY_API);
    await banner.getByRole('button', { name: 'Retry' }).click();
    await expect(banner).toHaveCount(0);
  });
});

test.describe('Dashboard shell: staleness text (P6)', () => {
  test('nothing is shown in a fresh session or at 9 minutes; "Updated N min ago" from 10 minutes, gone after a refresh', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-10-14T15:00:00Z') });
    await page.goto('/dashboard?tab=summary');
    await expect(page.locator('[data-group="attention"]')).toBeVisible();
    await expect(page.locator('[data-stale-age]')).toHaveCount(0);
    // Refreshes started by the timer never finish (a throttled or sleeping laptop): the figures just get old.
    await page.route(SUMMARY_API, () => new Promise(() => undefined));
    await page.clock.fastForward('09:00');
    await expect(page.locator('[data-stale-age]')).toHaveCount(0);
    await expect(page.locator('[data-refresh]')).toHaveAttribute('aria-label', 'Refresh');
    await page.clock.fastForward('01:30');
    const age = page.locator('[data-stale-age]');
    await expect(age).toBeVisible();
    await expect(age).toHaveText(/Updated 10 min ago/);
    await expect(page.locator('[data-refresh]')).toHaveAttribute(
      'aria-label',
      /Refresh\. Updated 10 min ago\./,
    );
    await expect(page.locator('[data-stale-age-live]')).toHaveAttribute('aria-live', 'polite');
    await page.setViewportSize({ width: 1366, height: 768 });
    await shot(page, '05-stale-age-1366');
    await expectAxeClean(page);
    // At 375 px the text is read, not shown; no horizontal scroll.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(age).not.toBeInViewport();
    await shot(page, '05-stale-age-375');
    await expectAxeClean(page);
    // A read that works makes it disappear.
    await page.unroute(SUMMARY_API);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.locator('[data-refresh]').click();
    await expect(page.locator('[data-stale-age]')).toHaveCount(0);
  });
});

test.describe('Dashboard shell: the address keeps only what differs from the default (P9)', () => {
  test('a Swimlane-only user opening ?tab=swimlane keeps the address exactly', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(['Dashboard.View', 'Dashboard.ViewSwimlane'], 'E2E swimlane only');
    const user = await seed.user([role.name], 'swimonly');
    const page = await asUser(user.username);
    await page.goto('/dashboard?tab=swimlane');
    await expect(page.getByRole('region', { name: 'Swimlane board' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(new URL(page.url()).search).toBe('?tab=swimlane');
  });

  test('defaults written in a link are removed without a new history entry; real choices stay', async ({
    page,
  }) => {
    await page.goto('/dashboard?tab=summary');
    await expect(page.locator('[data-group="attention"]')).toBeVisible();
    await page.goto('/dashboard?tab=swimlane&group=none&sort=priority&days=7&utm=mail');
    await expect(page.getByRole('region', { name: 'Swimlane board' })).toBeVisible();
    await expect.poll(() => new URL(page.url()).search).toBe('?tab=swimlane');
    // Back goes to the previous page (Summary), not through a defaults address: the rewrite replaced the entry.
    await page.goBack();
    await expect(page).toHaveURL(/tab=summary/);
    await page.goForward();
    await expect(page).toHaveURL(/\?tab=swimlane$/);

    await page.getByLabel('Group by').selectOption({ label: 'Assignee' });
    await expect(page).toHaveURL(/\?tab=swimlane&group=assignee$/);
    // Back leaves the Swimlane tab altogether instead of stepping through filter states.
    await page.goBack();
    await expect(page).toHaveURL(/tab=summary/);
  });

  test('the Users and Coverage addresses leave their defaults out too', async ({ page }) => {
    await page.goto('/dashboard?tab=users&view=workload&uavail=all');
    await expect(page.getByRole('heading', { name: 'Team workload' })).toBeAttached();
    await expect.poll(() => new URL(page.url()).search).toBe('?tab=users');
    await page.goto('/dashboard?tab=users&view=coverage&cp=30');
    await expect(page.locator('[data-coverage-period]')).toBeVisible();
    await expect.poll(() => new URL(page.url()).search).toBe('?tab=users&view=coverage');
    await page.locator('[data-coverage-period]').selectOption('90');
    await expect(page).toHaveURL(/\?tab=users&view=coverage&cp=90$/);
  });
});

test.describe('Dashboard shell: roles (R1, R2)', () => {
  const MENU = (page: Page) =>
    page.getByRole('navigation').getByRole('link', { name: 'Dashboard' });

  test('the menu item needs Dashboard.View and a tab permission; the route still explains itself', async ({
    seed,
    asUser,
  }) => {
    const viewOnly = await seed.role(['Task.View', 'Dashboard.View'], 'E2E dash view only');
    const coverage = await seed.role(
      ['Task.View', 'Dashboard.View', 'Dashboard.ViewCoverage'],
      'E2E dash coverage only',
    );
    const trends = await seed.role(
      ['Task.View', 'Dashboard.View', 'Dashboard.ViewTrends'],
      'E2E dash trends one',
    );

    let page = await asUser((await seed.user([viewOnly.name], 'dvonly')).username);
    await page.goto('/my-work');
    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(MENU(page)).toHaveCount(0);
    await page.goto('/dashboard');
    await expect(page.locator('[data-no-tabs-note]')).toContainText(
      'No Dashboard tab is turned on for your role.',
    );
    await expect(page.locator('[data-my-work-link]')).toBeVisible();
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await shot(page, `06-view-only-note-${size.name}`);
      await expectAxeClean(page);
    }

    page = await asUser((await seed.user([coverage.name], 'dvcov')).username);
    await page.goto('/my-work');
    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(MENU(page)).toHaveCount(0);

    page = await asUser((await seed.user([trends.name], 'dvtrends')).username);
    await page.goto('/my-work');
    await expect(MENU(page)).toBeVisible();
    await MENU(page).click();
    await expect(page.getByRole('tab', { name: 'Trends' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('every seeded role that has Dashboard.View keeps the menu item', async ({
    seed,
    asUser,
  }) => {
    for (const roleName of ['Director', 'Project Manager', 'Pod Lead', 'Data Technician']) {
      const page = await asUser((await seed.user([roleName], 'seeded')).username);
      await page.goto('/my-work');
      await expect(MENU(page), roleName).toBeVisible();
    }
  });

  test('a link to a tab the role cannot see says why, once, and the address is rewritten', async ({
    seed,
    asUser,
  }) => {
    const user = await seed.user(['Pod Lead'], 'podlead');
    const page = await asUser(user.username);

    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/dashboard?tab=breakdowns');
      const note = page.locator('[data-dash-note]');
      await expect(note).toHaveText(
        /Breakdowns is not available for your role\. Showing Summary\./,
      );
      await expect(note).toHaveAttribute('role', 'status');
      await expect(page).toHaveURL(/\/dashboard\?tab=summary$/);
      await expect(page.getByRole('tab', { name: 'Summary' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await shot(page, `07-forbidden-tab-note-${size.name}`);
      await expectAxeClean(page);
    }

    await page.goto('/dashboard?tab=xyz');
    await expect(page.locator('[data-dash-note]')).toContainText(
      'That tab does not exist. Showing Summary.',
    );

    await page.getByRole('button', { name: 'Dismiss this note' }).click();
    await expect(page.locator('[data-dash-note]')).toHaveCount(0);
  });

  test('a Director opening a tab gets no note', async ({ page }) => {
    await page.goto('/dashboard?tab=breakdowns');
    await expect(page.getByRole('tab', { name: 'Breakdowns' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-dash-note]')).toHaveCount(0);
  });
});
