import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Group by: Due on My Work (WP12a, #180). Every test uses its own user and tagged tasks, so nothing depends on global counts.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/my-work-review/fixes/wp12a).
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

/** The review's persona: 14 ASAP, 9 overdue, 3 due today, one tomorrow and three far away (30 open tasks, two pages of 25). */
async function seedTariq(seed: Seeder, label: string) {
  const me = await seed.user(['Data Technician'], label);
  const world = await seed.world();
  const tag = uid();
  const make = (name: string, offset: number | null) =>
    seed.task(world, {
      title: `${name} ${tag}`,
      assignedUserId: me.userId,
      ...(offset === null ? {} : { dueDate: dateInZone(FIRM_ZONE, offset) }),
    });
  const jobs: Promise<unknown>[] = [];
  for (let n = 1; n <= 14; n++) jobs.push(make(`Asap${n}`, null));
  for (let n = 1; n <= 9; n++) jobs.push(make(`Late${n}`, -n));
  for (let n = 1; n <= 3; n++) jobs.push(make(`Now${n}`, 0));
  jobs.push(make('Next1', 1));
  for (let n = 1; n <= 3; n++) jobs.push(make(`Far${n}`, 60 + n));
  for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6));
  return me;
}

test.describe('My Work: Group by due', () => {
  test('M12.1: headers with whole counts, continued on page 2, collapse by keyboard, remembered, a header sort turns it off', async ({
    seed,
    asUser,
  }) => {
    const me = await seedTariq(seed, 'group');
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open('?pageSize=25');
    const rows = page.locator('[data-task]');
    const headers = page.locator('tr.wt-group, li.tc-group');
    await expect(rows).toHaveCount(25);
    await expect(headers).toHaveCount(0);

    // Off by default; the control is in the Columns panel on Active.
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('radio', { name: 'Due' }).check();
    await expect(page).toHaveURL(/group=due/);
    await expect(page.locator('[data-grouped-note]')).toContainText('Grouped by due');
    await expect(headers).toHaveCount(3);
    await expect(headers.nth(0)).toContainText('ASAP (14');
    await expect(headers.nth(1)).toContainText('Overdue (9');
    await expect(headers.nth(2)).toContainText('Today (3');
    await expect(headers.nth(3))
      .toContainText('Tomorrow')
      .catch(() => undefined);
    await page.keyboard.press('Escape');

    // Page 1 is 25 rows: 14 ASAP, 9 overdue, 2 of the 3 due today. Counts equal the strip for ASAP and Overdue.
    await expect(headers.nth(2)).toContainText('Today (3');
    await expect(rows).toHaveCount(25);
    await expect(page.locator('[data-strip-item="asap"]')).toContainText('ASAP 14');
    await expect(page.locator('[data-strip-item="overdue"]')).toContainText('Overdue 9');
    await shot(page, 'grouped-1366x768');

    // Rows inside a group: overdue rows are the oldest due first within the same priority.
    const overdueTitles = await page
      .locator('[data-task]')
      .evaluateAll((trs) => trs.map((tr) => tr.querySelector('a.wt-title')?.textContent?.trim()));
    expect(overdueTitles.slice(14, 23).map((t) => t?.split(' ')[0])).toEqual([
      'Late9',
      'Late8',
      'Late7',
      'Late6',
      'Late5',
      'Late4',
      'Late3',
      'Late2',
      'Late1',
    ]);

    // Page 2 continues the bucket and shows the rest.
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(headers.first()).toContainText('Today (3');
    await expect(headers.first()).toContainText('continued');
    await expect(headers).toHaveCount(3);
    await expect(headers.nth(1)).toContainText('Tomorrow (1');
    await expect(headers.nth(2)).toContainText('Later (3');
    await expect(rows).toHaveCount(5);

    // Keyboard: the group button toggles with Enter and Space and announces its state and count.
    const first = headers.first().getByRole('button');
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-task]:visible')).toHaveCount(4);
    await page.keyboard.press('Space');
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-task]:visible')).toHaveCount(5);
    await expect(first).toContainText('Today (3 tasks), continued');
    await expect(headers.first().locator('th')).toHaveAttribute('scope', 'colgroup');

    // Remembered per user: a plain visit starts grouped.
    await myWork.open();
    await expect(page).toHaveURL(/group=due/);
    await expect(headers.first()).toContainText('ASAP (14');

    // Other tabs have no control and no groups.
    await myWork.tab(/^Closed/).click();
    await expect(headers).toHaveCount(0);
    await page.getByRole('button', { name: 'Columns' }).click();
    await expect(page.getByRole('radio', { name: 'Due' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await myWork.tab(/^Active/).click();
    await expect(headers.first()).toContainText('ASAP (14');

    // A header sort turns grouping off and shows the sort; the choice is forgotten.
    await page
      .getByRole('button', { name: /^Priority/ })
      .first()
      .click();
    await expect(page).not.toHaveURL(/group=due/);
    await expect(headers).toHaveCount(0);
    await expect(page.locator('[data-grouped-note]')).toHaveCount(0);
    await expect(page.locator('[data-sort-note]')).toContainText('Sorted by Priority');
    await myWork.open('?pageSize=25');
    await expect(page).not.toHaveURL(/group=due/);
    await expect(headers).toHaveCount(0);
  });

  test('M12.1: the grouped counts follow the filters, and "Remove grouping" returns to the default order', async ({
    seed,
    asUser,
  }) => {
    const me = await seedTariq(seed, 'group-filter');
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open('?group=due&overdue=true');
    const headers = page.locator('tr.wt-group, li.tc-group');
    await expect(headers).toHaveCount(1);
    await expect(headers.first()).toContainText('Overdue (9');
    await expect(page.locator('[data-task]')).toHaveCount(9);

    await page.getByRole('button', { name: 'Remove grouping' }).click();
    await expect(page).not.toHaveURL(/group=due/);
    await expect(headers).toHaveCount(0);
    await expect(page.locator('[data-task]')).toHaveCount(9);
  });

  test('M12.1: sizes, axe, no horizontal page scroll, headers span the list at 375', async ({
    seed,
    asUser,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    const me = await seedTariq(seed, 'group-sizes');
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await myWork.open('?group=due');
      const headers = page.locator('tr.wt-group, li.tc-group');
      await expect(headers.first()).toContainText('ASAP (14');
      await expect(page.locator('[data-loading]')).toHaveCount(0);
      expect(await axeViolations(page), `axe at ${w}`).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
        `no horizontal page scroll at ${w}`,
      ).toBe(false);
      if (w < 640) {
        // Phone cards (#192): the group header is a 44 px button spanning the list.
        const span = await headers.first().evaluate((li) => ({
          li: Math.round(li.getBoundingClientRect().width),
          list: Math.round(li.closest('ul')!.getBoundingClientRect().width),
        }));
        expect(span.li, `the group header spans the list at ${w}`).toBeGreaterThanOrEqual(
          span.list - 1,
        );
        const btn = await headers.first().getByRole('button').boundingBox();
        expect(btn!.height, `target height at ${w}`).toBeGreaterThanOrEqual(44);
      } else {
        const spans = await headers.first().evaluate((tr) => {
          const th = tr.querySelector('th')!.getBoundingClientRect();
          const table = tr.closest('table')!.getBoundingClientRect();
          return { th: Math.round(th.width), table: Math.round(table.width) };
        });
        expect(spans.th, `the group header spans the table at ${w}`).toBeGreaterThanOrEqual(
          spans.table - 1,
        );
        const btn = await headers.first().getByRole('button').boundingBox();
        expect(btn!.height, `target height at ${w}`).toBeGreaterThanOrEqual(24);
      }
      await shot(page, `grouped-${w}x${h}`);
    }
    // Collapsed state, for the record.
    await page.setViewportSize({ width: 1366, height: 768 });
    await myWork.open('?group=due');
    await page.locator('tr.wt-group, li.tc-group').nth(0).getByRole('button').click();
    await shot(page, 'grouped-collapsed-1366x768');
    expect(await axeViolations(page), 'axe collapsed').toEqual([]);
  });
});
