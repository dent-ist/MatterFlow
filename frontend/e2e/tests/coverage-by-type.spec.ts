import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { CoverageSeed, seedCoverage } from '../support/workload';

/**
 * Dashboard > Users > Coverage, WP11 (UX review 2): the "By task type" orientation as the default (C1, #134), the two statements about types nobody
 * handled and types handled by one person (C3, #136) and the quiet matrix (C2, #135, covered in users-tab.spec.ts). The seeded people (A: 3
 * Production and 1 Review, B: 1 Production, C: 2 Production) make Production a three-person type and Review a one-person type; every test scopes the
 * search to them with `uq=<tag>` because the database is shared. Screenshots go to E2E_SCREENSHOTS when it is set.
 */

const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 375, height: 812 },
];

let cov: CoverageSeed;
let podId: number;

test.beforeAll(async ({ admin, seed }) => {
  test.setTimeout(300_000);
  cov = await seedCoverage(admin, seed);
  const { a, b, c } = cov.people;
  const pod = await seed.pod(`Cov pod ${cov.tag}`, [a.userId, b.userId, c.userId]);
  podId = pod['podId'] as number;
});

async function shoot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const typeUrl = (extra = '') => `/dashboard?tab=users&view=coverage&uq=zcov${cov.tag}${extra}`;
const row = (page: Page, name: string) => page.locator(`[data-type-row][data-type-name="${name}"]`);
const card = (page: Page, name: string) =>
  page.locator(`[data-type-card]:has(strong:text-is("${name}"))`);

async function openTypes(page: Page, extra = ''): Promise<void> {
  await page.goto(typeUrl(extra));
  await expect(page.locator('[data-coverage-region]')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('[data-coverage-loading]')).toHaveCount(0);
}

test.describe('By task type (C1, #134)', () => {
  test('is the default: names per type, people, completed and status; the matrix is the second option and only it writes cov', async ({
    page,
  }) => {
    await openTypes(page);
    await expect(page.locator('[data-orientation="type"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-coverage-heading]')).toHaveText(
      'Task type coverage - use this to plan training and cross-coverage, not to rank people',
    );
    await expect(page.locator('[data-coverage-table]')).toHaveCount(0);
    const { a, b, c } = cov.people;
    const production = row(page, cov.typeNames.production);
    const names = [a, b, c].map((p) => p.displayName).sort((x, y) => x.localeCompare(y));
    await expect(production.locator('[data-names]')).toHaveText(names.join(', '));
    await expect(production.locator('[data-people]')).toHaveText('3');
    await expect(production.locator('[data-completed]')).toHaveText('6');
    await expect(production.locator('[data-status]')).toHaveCount(0);
    const review = row(page, cov.typeNames.review);
    await expect(review.locator('[data-names]')).toHaveText(a.displayName);
    await expect(review.locator('[data-status="one"]')).toHaveText('One person');
    await expect(page.locator('[data-summary="completed"]')).toContainText('7');
    // Neutral orders, no scores.
    await expect(page.locator('[data-coverage-row-order] option')).toHaveText([
      'Fewest people first',
      'Type name',
      'Most completed',
    ]);
    await expect(page).not.toHaveURL(/cov=/);

    await page.locator('[data-orientation="matrix"]').click();
    await expect(page).toHaveURL(/cov=matrix/);
    await expect(page.locator('[data-coverage-table]')).toBeVisible();
    // The matrix and the type view agree on the totals of the same people.
    await expect(page.locator('[data-grand-total]')).toHaveText('7');
    await page.reload();
    await expect(page.locator('[data-coverage-table]')).toBeVisible({ timeout: 120_000 });
    await page.locator('[data-orientation="type"]').click();
    await expect(page).not.toHaveURL(/cov=/);
    await expect(row(page, cov.typeNames.production)).toBeVisible();
  });

  test('a row expands with everyone and their counts; a count opens the tasks behind it with a link to the Task Queue; focus returns to the count', async ({
    page,
  }) => {
    await openTypes(page);
    const production = row(page, cov.typeNames.production);
    const toggle = production.locator('[data-toggle]');
    await toggle.focus();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const detail = page.locator('[data-type-detail]');
    await expect(detail.locator('[data-person]')).toHaveCount(3);
    const { a } = cov.people;
    const count = detail.locator(`[data-count-for="${a.userId}:${cov.typeIds.production}"]`);
    await expect(count).toHaveText('3');
    await count.click();
    const drawer = page.locator('[data-coverage-drawer]');
    await expect(drawer.locator('[data-coverage-tasks] li')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Close completed tasks' })).toBeFocused();
    await expect(drawer.locator('[data-open-queue]')).toHaveAttribute(
      'href',
      new RegExp(`type=${cov.typeIds.production}`),
    );
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(count).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    // Focus is never trapped inside the details.
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  });

  test('"not handled" asks to pick a pod with all pods and lists the pod members with a neutral 0 when a pod is the scope', async ({
    page,
  }) => {
    await openTypes(page, '&pod=all');
    await row(page, cov.typeNames.review).locator('[data-toggle]').click();
    await expect(page.locator('[data-pick-pod]')).toBeVisible();
    await expect(page.locator('[data-not-handled]')).toHaveCount(0);

    await openTypes(page, `&pod=${podId}`);
    await row(page, cov.typeNames.review).locator('[data-toggle]').click();
    const control = page.locator('[data-not-handled]');
    await expect(control).toContainText(`Show people in Cov pod ${cov.tag} who have not handled`);
    await expect(control).toHaveAttribute('aria-expanded', 'false');
    await control.click();
    const { b, c } = cov.people;
    const missing = [b, c].map((p) => p.displayName).sort((x, y) => x.localeCompare(y));
    await expect(page.locator('[data-not-list] li')).toHaveCount(2);
    for (const [i, name] of missing.entries()) {
      await expect(page.locator('[data-not-list] li').nth(i)).toContainText(name);
      await expect(page.locator('[data-not-list] li').nth(i)).toContainText('0');
    }
    // The names of the type are limited to the pod too, and the totals follow the scope.
    await expect(row(page, cov.typeNames.production).locator('[data-people]')).toHaveText('3');
  });

  test('orders by type name or most completed and remembers the choice; the search finds a type or a person', async ({
    page,
  }) => {
    await openTypes(page);
    const order = page.locator('[data-coverage-row-order]');
    await expect(order).toHaveValue('fewest');
    const names = () =>
      page
        .locator('[data-type-row]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-type-name')));
    expect(await names()).toEqual([cov.typeNames.review, cov.typeNames.production]);
    await order.selectOption('completed');
    expect(await names()).toEqual([cov.typeNames.production, cov.typeNames.review]);
    await order.selectOption('name');
    expect(await names()).toEqual([cov.typeNames.production, cov.typeNames.review]);
    await page.reload();
    await expect(page.locator('[data-coverage-row-order]')).toHaveValue('name');
    await page.locator('#cv-q').fill(`Cov ${cov.tag} Review`);
    await expect(page.locator('[data-type-row]')).toHaveCount(1);
  });
});

test.describe('Two statements (C3, #136)', () => {
  test('types nobody handled are neutral and collapsed; types handled by one person are an amber status naming the types, with no gap or bus factor wording', async ({
    page,
  }) => {
    await openTypes(page);
    const none = page.locator('[data-note="none"]');
    await expect(none).toBeVisible();
    await expect(none.locator('summary')).toContainText(
      /^\d+ task types? had no completed tasks in this period\.$/,
    );
    expect(await none.evaluate((el: HTMLDetailsElement) => el.open)).toBe(false);
    await expect(none.locator('.hint')).toBeHidden();
    const warn = page.locator('[data-note="one"]');
    await expect(warn).toContainText('handled by only one person in this period:');
    await expect(warn).toContainText(cov.typeNames.review);
    await expect(warn).toContainText('Consider cross-training.');
    await expect(page.locator('[role="status"] [data-note="one"]')).toHaveCount(1);
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    await none.locator('summary').click();
    await expect(none.locator('.hint')).toBeVisible();
    await expect(none).toContainText(
      'Rarely used types can be empty in a short period. Try a longer period.',
    );
    const ui = await page.locator('mf-coverage-view').innerText();
    expect(ui).not.toMatch(/\bgaps?\b|bus factor|\b(best|worst|leaderboard|score)\b/i);
  });

  test('a pod scope changes both counts; the statements show on the matrix too', async ({
    page,
  }) => {
    await openTypes(page, `&pod=${podId}`);
    await expect(page.locator('[data-note="one"]')).toContainText(cov.typeNames.review);
    await page.locator('[data-orientation="matrix"]').click();
    await expect(page.locator('[data-coverage-table]')).toBeVisible();
    await expect(page.locator('[data-note="one"]')).toContainText(cov.typeNames.review);
    await expect(page.locator('thead th[data-person]')).toHaveCount(3);
  });
});

test.describe('Bounded rendering', () => {
  // 500 people x 30 task types answered by the API stub: the matrix draws the first 30 people and 30 types, "Show more" adds the rest in steps.
  function bigBoard(): Json {
    const types = Array.from({ length: 30 }, (_, i) => ({
      taskTypeId: 1000 + i,
      name: `Type ${String(i).padStart(2, '0')}`,
      iconKey: 'file-text',
      isActive: true,
      total: 500,
      peopleWhoHandledIt: 500,
    }));
    const users = Array.from({ length: 500 }, (_, i) => ({
      userId: 5000 + i,
      displayName: `Person ${String(i).padStart(3, '0')}`,
      initials: 'PP',
      pods: [],
      isActive: true,
      availability: { state: 'AVAILABLE' },
      total: 30,
    }));
    return {
      timeZone: 'UTC',
      generatedAtUtc: '2026-10-15T15:00:00Z',
      from: '2026-09-16',
      to: '2026-10-15',
      days: 30,
      taskTypes: types,
      users,
      cells: users.flatMap((u) =>
        types.map((t) => ({ userId: u.userId, taskTypeId: t.taskTypeId, completed: 1 })),
      ),
      summary: { taskTypes: 30, users: 500, typesWithFewerThanTwoPeople: 0, totalCompleted: 15000 },
    };
  }

  test('500 people x 30 types: the matrix renders a bounded page quickly and is axe clean', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const body = JSON.stringify(bigBoard());
    await page.route('**/api/v1/dashboard/coverage**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body }),
    );
    const started = Date.now();
    await page.goto('/dashboard?tab=users&view=coverage&cov=matrix');
    await expect(page.locator('[data-coverage-table]')).toBeVisible({ timeout: 60_000 });
    const drawn = Date.now() - started;
    console.log(`500 x 30 matrix drawn in ${drawn} ms`);
    expect(drawn).toBeLessThan(15_000);
    await expect(page.locator('thead th[data-person]')).toHaveCount(30);
    await expect(page.locator('[data-cell]')).toHaveCount(30 * 30);
    await expect(page.locator('[data-matrix-more]')).toContainText('30 of 500 people');
    // Totals are over everyone, not only the people drawn.
    await expect(page.locator('[data-row-total]').first()).toHaveText('500');
    await page.locator('[data-cols-more]').click();
    await expect(page.locator('thead th[data-person]')).toHaveCount(60);
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe('Screens and accessibility', () => {
  for (const size of SIZES) {
    test(`By task type and the matrix at ${size.width}: axe is clean, nothing scrolls sideways, screenshots`, async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await page.setViewportSize(size);
      await openTypes(page);
      const narrow = size.width < 561;
      if (narrow) {
        await expect(page.locator('[data-type-card]').first()).toBeVisible();
        await expect(page.locator('[data-coverage-types-table]')).toHaveCount(0);
      } else {
        await expect(page.locator('[data-coverage-types-table]')).toBeVisible();
        await expect(page.locator('[data-type-card]')).toHaveCount(0);
      }
      const overflow = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
      expect(await overflow()).toBeLessThanOrEqual(0);
      if (axeAvailable()) expect(await axeViolations(page), `types ${size.width}`).toEqual([]);
      await shoot(page, `by-type-${size.width}`);

      // The reviewed type, expanded.
      const open = narrow
        ? card(page, cov.typeNames.production).locator('[data-card-toggle]')
        : row(page, cov.typeNames.production).locator('[data-toggle]');
      await open.click();
      await expect(page.locator('[data-type-detail]').first()).toBeVisible();
      if (axeAvailable()) expect(await axeViolations(page), `expanded ${size.width}`).toEqual([]);
      await shoot(page, `by-type-expanded-${size.width}`);
      expect(await overflow()).toBeLessThanOrEqual(0);

      await page.goto(`${typeUrl('&cov=matrix')}`);
      await expect(page.locator('[data-coverage-table]')).toBeVisible({ timeout: 120_000 });
      if (axeAvailable()) expect(await axeViolations(page), `matrix ${size.width}`).toEqual([]);
      await shoot(page, `matrix-${size.width}`);
      await page.getByRole('button', { name: 'Training gaps' }).click();
      await expect(page.locator('[data-gap="true"]').first()).toBeVisible();
      if (axeAvailable()) expect(await axeViolations(page), `gaps ${size.width}`).toEqual([]);
      await shoot(page, `matrix-gaps-${size.width}`);
      expect(await overflow()).toBeLessThanOrEqual(0);
    });
  }
});
