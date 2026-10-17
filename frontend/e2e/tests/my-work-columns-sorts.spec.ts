import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Sorts, the Closed column and the column framework of My Work (WP6a): sortable Title, Matter, Updated and Age headers (G3, #156), the
 * Closed column sorted newest first on the Closed tab (C1, #172) and one remembered column choice per tab with "Reset columns" (X1, #152).
 * Every test uses its own user and tagged tasks, so nothing depends on global counts. Screenshots go to E2E_SCREENSHOTS when it is set
 * (docs/ux/my-work-review/fixes/wp6a). The Closed dates are set with SQL (the container of run-local.sh), so those tests skip without it.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

/** The tagged titles of the rows on screen, in order. */
async function order(page: Page, tag: string): Promise<string[]> {
  const rows = await page.locator('tbody tr[data-task]').allTextContents();
  return rows
    .map((t) => new RegExp(`(\\p{L}+) ${tag}`, 'u').exec(t)?.[1])
    .filter((t): t is string => !!t);
}

test.describe('My Work sorts, Closed column and column sets', () => {
  test('G3: Title, Matter, Updated and Age sort from their headers and the URL says so', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'sorts');
    const world = await seed.world();
    const tag = uid();
    // Created in a shuffled order; the accented title sorts with the E's whatever the case.
    for (const name of ['Banana', 'apple', 'Étude', 'Echo', 'Cherry']) {
      await seed.task(world, { title: `${name} ${tag}`, assignedUserId: me.userId });
    }

    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await myWork.search(tag);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(5);

    const sortButton = (name: string) => page.locator(`th[data-col="${name}"] button`);
    const header = (name: string) => page.locator(`th[data-col="${name}"]`);

    // Title: A to Z, a second click reverses.
    await sortButton('title').click();
    await expect(page).toHaveURL(/sort=title/);
    await expect(header('title')).toHaveAttribute('aria-sort', 'ascending');
    await expect
      .poll(() => order(page, tag))
      .toEqual(['apple', 'Banana', 'Cherry', 'Echo', 'Étude']);
    await sortButton('title').click();
    await expect(header('title')).toHaveAttribute('aria-sort', 'descending');
    await expect
      .poll(() => order(page, tag))
      .toEqual(['Étude', 'Echo', 'Cherry', 'Banana', 'apple']);
    await expect(page.locator('[data-sort-note]')).toContainText('Sorted by Title');

    // Age is not a default column: add it from the chooser, then sort. Ascending age is the most recently created task first.
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await page.getByLabel('Age', { exact: true }).check();
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await expect(sortButton('age')).toBeVisible();
    await sortButton('age').click();
    await expect(header('age')).toHaveAttribute('aria-sort', 'ascending');
    await expect
      .poll(() => order(page, tag))
      .toEqual(['Cherry', 'Echo', 'Étude', 'apple', 'Banana']);
    await sortButton('age').click();
    await expect(header('age')).toHaveAttribute('aria-sort', 'descending');
    await expect
      .poll(() => order(page, tag))
      .toEqual(['Banana', 'apple', 'Étude', 'Echo', 'Cherry']);

    // Reset sort returns to the default.
    await page.getByRole('button', { name: 'Reset sort' }).click();
    await expect(page).not.toHaveURL(/sort=/);
  });

  test('C1: the Closed tab shows the closing date, newest first, and the header flips it', async ({
    seed,
    asUser,
  }) => {
    test.skip(!Seeder.canWriteLegacyText(), 'needs the SQL container of run-local.sh');
    const me = await seed.user(['Data Technician'], 'closed');
    const world = await seed.world();
    const tag = uid();
    for (const [name, days] of [
      ['Mid', 5],
      ['Newest', 1],
      ['Oldest', 20],
    ] as const) {
      const t = await seed.task(world, { title: `${name} ${tag}`, assignedUserId: me.userId });
      seed.ageTask(Number(t['taskId']), { createdDaysAgo: days + 3, completedDaysAgo: days });
    }
    await seed.task(world, { title: `Open ${tag}`, assignedUserId: me.userId });

    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open('?view=completed');
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(3);

    const closed = page.locator('th[data-col="closed"]');
    await expect(closed).toBeVisible();
    await expect(closed).toHaveAttribute('aria-sort', 'descending');
    await expect(page.locator('[data-sort-note]')).toContainText('Sorted by Closed date');
    await expect.poll(() => order(page, tag)).toEqual(['Newest', 'Mid', 'Oldest']);
    const dates = await page.locator('tbody td[data-col="closed"]').allTextContents();
    for (const d of dates) expect(d.trim()).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    // The tooltip carries the time and the zone.
    await expect(page.locator('tbody td[data-col="closed"] [title]').first()).toHaveAttribute(
      'title',
      /\d{1,2}:\d{2} [AP]M \S+$/,
    );

    await closed.getByRole('button').click();
    await expect(page).toHaveURL(/sort=closed/);
    await expect(page).toHaveURL(/dir=asc/);
    await expect(closed).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(() => order(page, tag)).toEqual(['Oldest', 'Mid', 'Newest']);
    await expect(page.locator('[data-sort-note]')).toContainText('Sorted by Closed');
    await page.getByRole('button', { name: 'Reset sort' }).click();
    await expect(closed).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => order(page, tag)).toEqual(['Newest', 'Mid', 'Oldest']);

    // Open tasks show a dash on lists that list them (Active has no Closed column by default).
    await myWork.open();
    await expect(page.locator('th[data-col="closed"]')).toHaveCount(0);
  });

  test('X1: each tab remembers its own columns, Reset columns restores only the current tab', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'cols');
    const world = await seed.world();
    const tag = uid();
    await seed.task(world, { title: `Alpha ${tag}`, assignedUserId: me.userId });

    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open();
    const col = (key: string) => page.locator(`th[data-col="${key}"]`);
    const columns = page.getByRole('button', { name: 'Columns', exact: true });

    await expect(col('progress')).toBeVisible();
    await columns.click();
    await page.getByLabel('Workflow progress', { exact: true }).uncheck();
    await expect(col('progress')).toHaveCount(0);
    if (axeAvailable()) expect(await axeViolations(page), 'chooser open at 1366').toEqual([]);
    await columns.click();

    // Closed has its own default; the hidden Workflow progress is still shown there.
    await myWork.tab(/^Closed/).click();
    await expect(col('progress')).toBeVisible();
    await expect(col('closed')).toBeVisible();

    // The choice survives a reload, per tab.
    await myWork.open();
    await expect(col('progress')).toHaveCount(0);
    await myWork.open('?view=completed');
    await expect(col('progress')).toBeVisible();

    // Reset columns on Active restores Active only.
    await myWork.tab(/^Active/).click();
    await expect(col('progress')).toHaveCount(0);
    await columns.click();
    await page.getByRole('button', { name: 'Reset columns' }).click();
    await expect(col('progress')).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Columns reset to the default set.' }),
    ).toHaveCount(1);
  });

  test('axe, no overflow and screenshots of the Closed tab at 1366, 1920, 768 and 375', async ({
    seed,
    asUser,
  }) => {
    test.skip(!Seeder.canWriteLegacyText(), 'needs the SQL container of run-local.sh');
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    const me = await seed.user(['Data Technician'], 'sizes');
    const world = await seed.world();
    for (const days of [1, 4]) {
      const t = await seed.task(world, { assignedUserId: me.userId });
      seed.ageTask(Number(t['taskId']), { createdDaysAgo: days + 2, completedDaysAgo: days });
    }
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await myWork.open('?view=completed');
      await expect(page.locator('tbody tr[data-task]')).toHaveCount(2);
      expect(await axeViolations(page), `closed at ${w}`).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, `no horizontal page scroll at ${w}`).toBe(false);
      await shot(page, `closed-column-${w}x${h}`);
    }
  });
});
