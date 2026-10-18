import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * The Task Queue sorted by Due shows a divider per due bucket (WP23, #232), reusing My Work's group headers. Every test seeds its own Matter, and
 * the address names it (`matter=`), so nothing depends on global counts. Screenshots go to E2E_SCREENSHOTS when it is set
 * (docs/ux/task-queue-review/fixes/wp-due-groups).
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

/** 30 ASAP, 4 overdue, 2 due today, 1 tomorrow and 3 far away: 40 open tasks of one Matter, two pages of 25. */
async function seedMatter(seed: Seeder): Promise<number> {
  const world = await seed.world();
  const tag = uid();
  const make = (name: string, offset: number | null) =>
    seed.task(world, {
      title: `${name} ${tag}`,
      ...(offset === null ? {} : { dueDate: dateInZone(FIRM_ZONE, offset) }),
    });
  const jobs: (() => Promise<unknown>)[] = [];
  for (let n = 1; n <= 30; n++) jobs.push(() => make(`Asap${n}`, null));
  for (let n = 1; n <= 4; n++) jobs.push(() => make(`Late${n}`, -n));
  for (let n = 1; n <= 2; n++) jobs.push(() => make(`Now${n}`, 0));
  jobs.push(() => make('Next1', 1));
  for (let n = 1; n <= 3; n++) jobs.push(() => make(`Far${n}`, 60 + n));
  for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map((j) => j()));
  return world.matter.matterId as number;
}

test.describe('Task Queue: dividers when sorted by Due', () => {
  test('#232: ascending shows ASAP first with the whole count, continued on page 2, in bucket order', async ({
    page,
    seed,
  }) => {
    const matter = await seedMatter(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open(`?matter=${matter}&sort=due&dir=asc&pageSize=25`);
    const rows = page.locator('tr[data-task]');
    const headers = page.locator('tr.wt-group');
    await expect(rows).toHaveCount(25);
    await expect(headers).toHaveCount(1);
    await expect(headers.first()).toContainText('ASAP (30 tasks)');
    await expect(headers.first()).not.toContainText('continued');
    // The Due header names where ASAP goes.
    await expect(page.locator('th[data-col="due"] button')).toHaveAttribute(
      'title',
      'Due (ASAP first)',
    );
    await shot(page, 'due-asc-1366x768');

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(headers).toHaveCount(5);
    await expect(headers.nth(0)).toContainText('ASAP (30 tasks), continued');
    await expect(headers.nth(1)).toContainText('Overdue (4 tasks)');
    await expect(headers.nth(2)).toContainText('Today (2 tasks)');
    await expect(headers.nth(3)).toContainText('Tomorrow (1 task)');
    await expect(headers.nth(4)).toContainText('Later (3 tasks)');
    await expect(rows).toHaveCount(15);
    // Inside Overdue the oldest due date is first.
    const titles = await rows.evaluateAll((trs) =>
      trs.map((tr) => tr.querySelector('a.wt-title')?.textContent?.trim().split(' ')[0]),
    );
    expect(titles.slice(5, 9)).toEqual(['Late4', 'Late3', 'Late2', 'Late1']);
    await shot(page, 'due-asc-page2-1366x768');

    // The counts are the grid's: the same filter with asap=true lists the ASAP bucket.
    await queue.open(`?matter=${matter}&asap=true&status=NEW&status=IN_PROGRESS&status=ON_HOLD`);
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText('of 30');
  });

  test('#232: descending mirrors the dividers, nothing is stored, other sorts have none', async ({
    page,
    seed,
  }) => {
    const matter = await seedMatter(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open(`?matter=${matter}&sort=due&dir=desc`);
    const headers = page.locator('tr.wt-group');
    await expect(headers).toHaveCount(5);
    await expect(headers.nth(0)).toContainText('Later (3 tasks)');
    await expect(headers.nth(1)).toContainText('Tomorrow (1 task)');
    await expect(headers.nth(2)).toContainText('Today (2 tasks)');
    await expect(headers.nth(3)).toContainText('Overdue (4 tasks)');
    await expect(headers.nth(4)).toContainText('ASAP (30 tasks)');
    await expect(page.locator('th[data-col="due"] button')).toHaveAttribute(
      'title',
      'Due (ASAP last)',
    );
    await shot(page, 'due-desc-1366x768');

    // Not a setting: no group parameter in the address, nothing remembered, and another sort has no dividers.
    expect(page.url()).not.toContain('group=');
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.toLowerCase().includes('group')),
      ),
    ).toEqual([]);
    await page.locator('th[data-col="priority"] button').click();
    await expect(page).toHaveURL(/sort=priority/);
    await expect(headers).toHaveCount(0);
    await page.locator('th[data-col="due"] button').click();
    await expect(page).toHaveURL(/sort=due/);
    await expect(headers.first()).toBeVisible();
  });

  test('#232: a divider collapses by keyboard and J/K skip the hidden rows', async ({
    page,
    seed,
  }) => {
    const matter = await seedMatter(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open(`?matter=${matter}&sort=due&dir=asc&pageSize=25&page=2`);
    const headers = page.locator('tr.wt-group');
    await expect(headers).toHaveCount(5);
    const asap = headers.first().getByRole('button');
    await asap.focus();
    await expect(asap).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Enter');
    await expect(asap).toHaveAttribute('aria-expanded', 'false');
    // 15 rows, 5 of them in the collapsed ASAP bucket.
    await expect(page.locator('tr[data-task]:visible')).toHaveCount(10);
    // J from the first visible title goes to the second, never into the hidden rows.
    const first = page.locator('tr[data-task]:visible a.wt-title').first();
    await first.focus();
    await page.keyboard.press('j');
    await expect(page.locator('tr[data-task]:visible a.wt-title').nth(1)).toBeFocused();
    await page.keyboard.press('k');
    await expect(first).toBeFocused();
    await page.keyboard.press('Space');
    // Space on a title opens nothing; collapse state is not stored, a reload shows every group open.
    await page.reload();
    await expect(page.locator('tr[data-task]:visible')).toHaveCount(15);
  });

  test('#232: axe is clean at four sizes, no page scroll, dividers span the table', async ({
    page,
    seed,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    const matter = await seedMatter(seed);
    const queue = new TaskQueuePage(page);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await queue.open(`?matter=${matter}&sort=due&dir=asc&pageSize=25`);
      const headers = page.locator('tr.wt-group');
      await expect(headers.first()).toContainText('ASAP (30');
      await expect(page.locator('tbody')).not.toContainText('Loading');
      expect(await axeViolations(page), `axe at ${w}`).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
        `no horizontal page scroll at ${w}`,
      ).toBe(false);
      const spans = await headers.first().evaluate((tr) => {
        const th = tr.querySelector('th')!;
        const head = tr.closest('table')!.querySelectorAll('thead tr:first-child th').length;
        return { colspan: Number(th.getAttribute('colspan')), head };
      });
      expect(spans.colspan, `the divider spans every shown column at ${w}`).toBe(spans.head);
      await shot(page, `due-groups-${w}x${h}`);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await queue.open(`?matter=${matter}&sort=due&dir=asc&pageSize=25`);
    await page.locator('tr.wt-group').first().getByRole('button').click();
    await shot(page, 'due-collapsed-1366x768');
    expect(await axeViolations(page), 'axe collapsed').toEqual([]);
  });
});
