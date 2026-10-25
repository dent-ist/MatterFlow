import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { expect, test } from '../support/fixtures';
import { SIZES, shot } from '../support/screens';

/**
 * Phone and tablet layout of My Matters (epic #667, #700; #818): at 375 px the filters are one "Filters (n)" button with a sheet, the strip is a
 * two-column grid with every count (Overdue included) in the first screen, the panels follow the reading order of the plan, the health table is cards with a 44 px "+ New task", Workload and
 * Recent activity show five lines with "Show all", and the first screen shows the strip and the first panel. From 640 to 1099 px the lower
 * panels are two columns and the health table folds Due this week and % complete into the row.
 */
/** No page-level sideways scroll once the layout has settled after a resize (polled: the table measures itself on the next frame). */
const noHorizontalScroll = async (page: Page): Promise<void> => {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      { message: 'page-level horizontal scroll' },
    )
    .toBeLessThanOrEqual(0);
};

const y = async (page: Page, selector: string): Promise<number> => {
  const box = await page.locator(selector).first().boundingBox();
  return box ? box.y : -1;
};

test.describe('My Matters on a phone and a tablet', () => {
  test('phone: the first screen shows the strip and the first panel; panels in reading order; cards; no sideways scroll', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'lay1');
    const a = await w.matter('Layout alpha');
    await w.matter('Layout bravo', w.pm, w.other);
    await w.task(a, { dueDate: '2000-01-01' });
    await w.task(a, { dueDate: inDays(2) });
    await w.task(a);
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/my-matters');
    await expect(page.locator('[data-panel=health] [data-record-card]').first()).toBeVisible();
    await shot(page, 'my-matters-phone');
    // Filters: one button; its sheet holds every filter.
    const filtersButton = page.locator('[data-filters-open]');
    await expect(filtersButton).toHaveText(/Filters/);
    await expect(page.locator('[data-filter=role]')).toHaveCount(0);
    expect((await filtersButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // The strip is a two-column grid: every cell, Overdue included, is inside the page width and on the first screen (#818).
    const strip = page.locator('[data-strip]');
    const box = (await strip.boundingBox())!;
    expect(box.height).toBeLessThan(260);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    for (const key of ['matters', 'open', 'overdue', 'due3', 'due7', 'unassigned', 'onHold']) {
      const cell = (await page.locator(`[data-strip-item=${key}]`).boundingBox())!;
      expect(cell.x, `${key} starts inside the page`).toBeGreaterThanOrEqual(0);
      expect(cell.x + cell.width, `${key} ends inside the page`).toBeLessThanOrEqual(375);
      expect(cell.y + cell.height, `${key} is on the first screen`).toBeLessThanOrEqual(812);
      expect(cell.height, `${key} is a 44 px target`).toBeGreaterThanOrEqual(44);
    }
    // The first screen (375x812) shows the whole strip and the heading of the first panel; Needs my attention starts in it.
    const attention = (await page.locator('[data-panel=attention] h2').boundingBox())!;
    expect(attention.y + attention.height).toBeLessThanOrEqual(812);
    expect(box.y + box.height).toBeLessThanOrEqual(812);
    // The one-line description would only be cut off: it is kept for screen readers and takes no room.
    const description = (await page.locator('[data-page-description]').boundingBox())!;
    expect(description.height).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-page-description]')).toContainText('The matters you manage');
    // Reading order: attention, health, deadlines, workload, activity.
    const order = await Promise.all(
      ['attention', 'health', 'deadlines', 'workload', 'activity'].map((p) =>
        y(page, `[data-panel=${p}]`),
      ),
    );
    expect(order).toEqual([...order].sort((p, q) => p - q));
    // Cards, each with a full-width 44 px "+ New task".
    const card = page.locator('[data-panel=health] [data-record-card]').first();
    const rowNewTask = card.getByRole('button', { name: /^New task for/ });
    const nb = (await rowNewTask.boundingBox())!;
    expect(nb.height).toBeGreaterThanOrEqual(44);
    await expect(card).toContainText('overdue');
    await expect(page.locator('[data-health-table]')).toHaveCount(0);
    await noHorizontalScroll(page);
    // The sheet.
    await filtersButton.click();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await expect(sheet.locator('[data-filter=role]')).toBeVisible();
    await sheet.locator('[data-filter=role]').selectOption('primary');
    await expect(page).toHaveURL(/role=primary/);
    expect(await axeViolations(page), 'filter sheet open at 375').toEqual([]);
    await sheet.getByRole('button', { name: 'Show results' }).click();
    await expect(filtersButton).toHaveText(/Filters \(1\)/);
  });

  test('phone: Workload and Recent activity show five lines and "Show all"', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const w = await mmWorld(seed, personas, 'lay2');
    const a = await w.matter('Layout many');
    const pod = await seed.pod(undefined, []);
    for (let i = 0; i < 7; i++) {
      const who = await personas.create({
        label: `lay2-t${i}`,
        roles: ['Data Technician'],
        displayName: `Layout Person ${i}`,
      });
      await seed.admin.post(`/api/v1/pods/${pod.podId}/members`, { userIds: [who.userId] });
      await w.task(a, {
        assignedUserId: who.userId,
        assignedPodId: pod.podId,
        dueDate: inDays(30),
        title: `Layout task ${i}`,
      });
    }
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/my-matters');
    const load = page.locator('[data-panel=workload]');
    await expect(load.locator('[data-workload-line]')).toHaveCount(5);
    await load.locator('[data-show-all]').click();
    await expect(load.locator('[data-workload-line]')).toHaveCount(8); // the pod and seven people
    const act = page.locator('[data-panel=activity]');
    await expect(act.locator('[data-activity-row]')).toHaveCount(5);
    await act.locator('[data-show-all]').click();
    await expect.poll(() => act.locator('[data-activity-row]').count()).toBeGreaterThan(5);
    await noHorizontalScroll(page);
  });

  test('tablet: two columns for the lower panels, and the table folds two columns into the row', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'lay3');
    const a = await w.matter('Layout tablet');
    await w.task(a, { dueDate: inDays(2) });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/my-matters');
    await expect(page.locator('[data-health-row]').first()).toBeVisible();
    const [workload, activity] = await Promise.all([
      page.locator('[data-panel=workload]').boundingBox(),
      page.locator('[data-panel=activity]').boundingBox(),
    ]);
    expect(Math.abs(workload!.y - activity!.y)).toBeLessThan(4);
    expect(activity!.x).toBeGreaterThan(workload!.x + workload!.width - 2);
    await expect(page.locator('th', { hasText: 'Due this week' })).toBeHidden();
    await expect(page.locator('th', { hasText: '% complete' })).toBeHidden();
    await expect(page.locator('[data-fold]').first()).toBeVisible();
    await expect(page.locator('[data-fold]').first()).toContainText('due this week');
    // The table fits its panel at 768 px: no scroll box of its own.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const box = document.querySelector('.hp__scroll');
          return box ? box.scrollWidth - box.clientWidth : -1;
        }),
      )
      .toBeLessThanOrEqual(0);
    await shot(page, 'my-matters-tablet');
    await noHorizontalScroll(page);
    // From 1100 px the two columns are columns again.
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(page.locator('th', { hasText: 'Due this week' })).toBeVisible();
    await expect(page.locator('[data-fold]').first()).toBeHidden();
  });

  test('no sideways scroll, 44 px targets on a phone and axe 0 at the four sizes', async ({
    seed,
    personas,
    asUser,
  }) => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    const w = await mmWorld(seed, personas, 'lay4');
    const a = await w.matter('Layout sizes');
    await w.matter('Layout sizes two', w.pm, w.other);
    await w.task(a, { dueDate: '2000-01-01' });
    await w.task(a, { dueDate: inDays(3) });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await expect(
        page
          .locator('[data-panel=health] [data-health-row], [data-panel=health] [data-record-card]')
          .first(),
      ).toBeVisible();
      await expect(page.locator('[data-panel=activity] [data-activity-row]').first()).toBeVisible();
      expect(await axeViolations(page), `page at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'my-matters');
      if (size.width < 640) {
        const small = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>('main a[href], main button'))
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return (
                r.width > 0 &&
                r.height > 0 &&
                r.height < 44 &&
                !el.closest('[data-strip]') &&
                !el.classList.contains('rc-name')
              );
            })
            .map(
              (el) =>
                `${el.tagName.toLowerCase()} ${el.textContent?.trim().slice(0, 30)} ${Math.round(el.getBoundingClientRect().height)}`,
            ),
        );
        expect(small, 'targets under 44 px on a phone').toEqual([]);
      }
    }
  });
});
