import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage, PodWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * WP13c (#238, inside #192): the Task Queue and Pod Work as cards below 640 px, and the phone chrome around them. Card content: the
 * assignee line (name, or "Unassigned" with "Assign to me"), the toolbar of at most two rows (quick views with counts, one Filters button; no
 * Columns, no Other filters), the Sort by select in the Filters sheet with the same URL parameters as the headers, Group by in the sheet
 * of My Work, "Open in Task Queue" in its footer. Counts and order are compared with the table of the same address at 1366 px. Every test has
 * its own user and tagged tasks (the lists are filtered with `q=<tag>`). Screenshots: E2E_SCREENSHOTS_TQ (docs/ux/task-queue-review/fixes/wp-cards)
 * and E2E_SCREENSHOTS (docs/ux/my-work-review/fixes/wp-cards).
 */
const OUT_TQ = process.env['E2E_SCREENSHOTS_TQ'];
const OUT_MW = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string, out = OUT_TQ): Promise<void> {
  if (!out) return;
  fs.mkdirSync(out, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

const pageSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

const cards = (page: Page) => page.locator('li[data-task]');
const cardTitles = (page: Page) => page.locator('li[data-task] a.wt-title').allTextContents();

interface Persona {
  username: string;
  userId: number;
  tag: string;
  podName: string;
  podId: number;
  titles: string[];
}

/** A user in a Pod with five tagged tasks: two theirs (one overdue), one unassigned in the Pod, one held (theirs), one ASAP unassigned. */
async function persona(seed: Seeder, role = 'Pod Lead'): Promise<Persona> {
  const me = await seed.user([role], 'qc');
  const pod = await seed.pod(undefined, [me.userId]);
  const world = await seed.world();
  const tag = uid();
  const titles = [`Alpha ${tag}`, `Bravo ${tag}`, `Charlie ${tag}`, `Delta ${tag}`, `Echo ${tag}`];
  const inPod = { assignedPodId: pod.podId };
  await seed.task(world, {
    title: titles[0],
    ...inPod,
    assignedUserId: me.userId,
    dueDate: dateInZone(FIRM_ZONE, -3),
  });
  await seed.task(world, {
    title: titles[1],
    ...inPod,
    assignedUserId: me.userId,
    dueDate: dateInZone(FIRM_ZONE, 4),
  });
  await seed.task(world, { title: titles[2], ...inPod, dueDate: dateInZone(FIRM_ZONE, 1) });
  await seed.task(world, {
    title: titles[3],
    ...inPod,
    assignedUserId: me.userId,
    dueDate: dateInZone(FIRM_ZONE, 9),
  });
  await seed.task(world, { title: titles[4], ...inPod, isAsap: true });
  return {
    username: me.username,
    userId: me.userId,
    tag,
    podName: pod.name,
    podId: pod.podId,
    titles,
  };
}

test.describe('WP13c: Task Queue and Pod Work cards', () => {
  let px: Persona;
  test.beforeAll(async ({ seed }) => {
    px = await persona(seed);
  });

  for (const width of [320, 375, 414, 600]) {
    test(`${width} px: the Task Queue is cards with the assignee line, two toolbar rows at most, no sideways scroll, axe clean`, async ({
      asUser,
    }) => {
      const page = await asUser(px.username);
      await page.setViewportSize({ width, height: 812 });
      const queue = new TaskQueuePage(page);
      await queue.open(`?q=${px.tag}`);
      await expect(cards(page)).toHaveCount(5);
      await expect(page.locator('table.wt')).toHaveCount(0);
      // Line 4 on every card: the assignee (button for a person who may assign) and the task number.
      for (const c of await cards(page).all()) {
        await expect(c.locator('[data-card-meta] [data-col="assignee"]')).toBeVisible();
        await expect(c.locator('[data-card-meta] .tc-num')).toBeVisible();
        await expect(c.locator('[data-col="priority"]')).toBeVisible();
        await expect(c.locator('[data-col="status"]')).toBeVisible();
      }
      expect(await pageSideScroll(page)).toBe(false);
      // The toolbar: the quick views and one Filters button, in two rows at most; no Columns, no Other filters, no sideways hint.
      await expect(page.getByRole('button', { name: 'Columns', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Other filters' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Filters/ })).toBeVisible();
      const rows = await page.evaluate(() => {
        const bar = document.querySelector('[data-grid-toolbar]')!;
        const ys = new Set<number>();
        bar.querySelectorAll<HTMLElement>('button, a').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) ys.add(Math.round(r.top / 8));
        });
        return ys.size;
      });
      expect(rows, 'toolbar rows').toBeLessThanOrEqual(2);
      await expect(page.locator('[data-scroll-hint]')).toBeHidden();
      await axeClean(page, `task queue at ${width}`);
      await shot(page, `tq-cards-${width}x812`);
    });
  }

  test('640 px is the table with its sticky Ref, 639 px is cards (the breakpoint is below 640)', async ({
    asUser,
  }) => {
    const page = await asUser(px.username);
    const queue = new TaskQueuePage(page);
    await page.setViewportSize({ width: 639, height: 900 });
    await queue.open(`?q=${px.tag}`);
    await expect(cards(page)).toHaveCount(5);
    await page.setViewportSize({ width: 640, height: 900 });
    await expect(page.getByRole('table', { name: /Task Queue/ })).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    await expect(page.locator('tr[data-task]')).toHaveCount(5);
    await page.setViewportSize({ width: 768, height: 900 });
    await axeClean(page, 'task queue table at 768');
    await shot(page, 'tq-table-768x900');
    expect(await pageSideScroll(page)).toBe(false);
  });

  test('counts, titles and order are the same as the table of the same address', async ({
    asUser,
  }) => {
    const page = await asUser(px.username);
    const queue = new TaskQueuePage(page);
    await page.setViewportSize({ width: 1366, height: 800 });
    await queue.open(`?q=${px.tag}&sort=title&dir=asc`);
    await expect(page.locator('tr[data-task]')).toHaveCount(5);
    const table = await page.locator('tr[data-task] a.wt-title').allTextContents();
    const tableCount = await queue.quickView(/^All open/).textContent();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(cards(page)).toHaveCount(5);
    expect(await cardTitles(page)).toEqual(table);
    expect(await queue.quickView(/^All open/).textContent()).toEqual(tableCount);
    // The quick views with their counts are there, and Unassigned narrows the cards like it narrows the table (a view replaces the filters).
    await expect(queue.quickView(/^Unassigned/)).toContainText(/\d/);
    await queue.quickView(/^Unassigned/).click();
    await expect(queue.quickView(/^Unassigned/)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-task]').first()).toBeVisible();
    await expect
      .poll(async () => {
        const lines = await page.locator('li[data-task] [data-card-meta]').allTextContents();
        return lines.length > 0 && lines.every((l) => l.includes('Unassigned'));
      })
      .toBe(true);
    await shot(page, 'tq-quick-view-375x812');
  });

  test('Sort by in the Filters sheet: a select with the URL parameters of the headers; Direction; back to the default order', async ({
    asUser,
  }) => {
    const page = await asUser(px.username);
    await page.setViewportSize({ width: 375, height: 812 });
    const queue = new TaskQueuePage(page);
    await queue.open(`?q=${px.tag}`);
    await expect(cards(page)).toHaveCount(5);
    await page.getByRole('button', { name: /^Filters/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await expect(sheet).toBeVisible();
    // The sort control is the first thing in the sheet, 44 px, naming the default order.
    const select = sheet.getByLabel('Sort by');
    await expect(select).toHaveValue('');
    await expect(select.locator('option').first()).toContainText('Default order');
    expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await shot(page, 'tq-filters-sheet-375x812');
    await axeClean(page, 'filters sheet with the sort select at 375');

    await select.selectOption('title');
    await expect(page).toHaveURL(/sort=title/);
    await expect(page).toHaveURL(/dir=asc/);
    await expect.poll(() => cardTitles(page)).toEqual([...px.titles].sort());
    await expect(sheet.getByLabel('Direction')).toHaveValue('asc');
    await sheet.getByLabel('Direction').selectOption('desc');
    await expect(page).toHaveURL(/dir=desc/);
    await expect.poll(() => cardTitles(page)).toEqual([...px.titles].sort().reverse());
    await select.selectOption('due');
    await expect(page).toHaveURL(/sort=due/);
    await select.selectOption('');
    await expect(page).not.toHaveURL(/sort=/);
    await expect(sheet.getByLabel('Direction')).toHaveCount(0);
    await sheet.getByRole('button', { name: /^Show \d+ results?$/ }).click();
    await expect(sheet).toHaveCount(0);
  });

  test('the Title or Ref filter in the sheet narrows the cards and the URL like the filter row', async ({
    asUser,
  }) => {
    const page = await asUser(px.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await new TaskQueuePage(page).open(`?q=${px.tag}`);
    await page.getByRole('button', { name: /^Filters/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    const box = sheet.getByRole('textbox', { name: /Title or Ref/ });
    await box.fill(px.titles[3]);
    await box.press('Enter');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText(px.titles[3]);
    await sheet.getByRole('button', { name: 'Clear filters' }).click();
    await sheet.getByRole('button', { name: /^Show/ }).click();
    await expect(page).not.toHaveURL(/q=/);
  });

  test('Task Queue: Unassigned has "Assign to me" in the Assignee menu of the card; it assigns and Undo puts the card back', async ({
    asUser,
    admin,
    seed,
  }) => {
    const tech = await seed.user(['Data Technician'], 'qc-tech');
    const world = await seed.world();
    const title = `Take ${uid()}`;
    const task = await seed.task(world, { title });
    const page = await asUser(tech.username);
    await page.setViewportSize({ width: 375, height: 812 });
    const queue = new TaskQueuePage(page);
    await queue.open(`?q=${title}`);
    const card = queue.row(task.taskNumber);
    await expect(card).toBeVisible();
    await expect(card.locator('[data-card-meta]')).toContainText('Unassigned');
    const trigger = card.getByRole('button', { name: /^Unassigned, change assignee of/ });
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await trigger.click();
    await page
      .getByRole('button', { name: `Assign ${task.taskNumber} to me`, exact: true })
      .click();
    await expect(card.locator('[data-card-meta]')).toContainText(tech.username);
    await expect(card.locator('[data-avatar]')).toBeVisible();
    await expect(page.locator('mf-undo-toast')).toContainText('Assigned to you.');
    expect((await admin.get(`/api/v1/tasks/${task.taskId}`)).assignedUser.userId).toBe(tech.userId);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(card.locator('[data-card-meta]')).toContainText('Unassigned');
  });

  test('Pod Work: cards with "Assign to me" next to Unassigned and the Assignee menu ("Assign to"), counts as on the table', async ({
    asUser,
  }) => {
    const page = await asUser(px.username);
    await page.setViewportSize({ width: 375, height: 812 });
    const podWork = new PodWorkPage(page);
    await page.goto(`/pods/work?podId=${px.podId}&q=${px.tag}`);
    await expect(page.getByRole('heading', { name: 'Pod Work', level: 1 })).toBeVisible();
    await podWork.tab(/^Unassigned/).click();
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator('table.wt')).toHaveCount(0);
    const card = cards(page).filter({ hasText: px.titles[2] });
    const link = card.locator('[data-assign-link]');
    await expect(link).toHaveText('Assign to me');
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await pageSideScroll(page)).toBe(false);
    await axeClean(page, 'pod work cards at 375');
    await shot(page, 'pod-work-375x812');
    // The menu is "Assign to ..." with the Pod's members.
    await card.getByRole('button', { name: /^Unassigned, change assignee of/ }).click();
    await expect(page.locator('.im-pop').getByRole('menu', { name: 'Assign to' })).toBeVisible();
    await page.keyboard.press('Escape');
    // Assign to me from the link: the Undo toast, the same call as on the table.
    await link.click();
    await expect(page.locator('mf-undo-toast')).toContainText('Assigned to you.');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(link).toBeVisible();
    // Totals against the table of the same address.
    await page.setViewportSize({ width: 1366, height: 800 });
    await expect(page.locator('tr[data-task]')).toHaveCount(2);
  });

  test('My Work: the sheet has Sort by, Group by and "Open in Task Queue"; grouping and sorting exclude each other', async ({
    asUser,
  }) => {
    const page = await asUser(px.username);
    await page.setViewportSize({ width: 375, height: 812 });
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await expect(cards(page).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Columns', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-sort-note]')).toBeHidden();
    // One toolbar row: the Filters button.
    await page.getByRole('button', { name: /^Filters/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await expect(sheet.getByRole('link', { name: 'Open in Task Queue' })).toBeVisible();
    await shot(page, 'my-work-filters-sheet-375x812', OUT_MW);
    await sheet.getByLabel('Group by').selectOption('due');
    await expect(page).toHaveURL(/group=due/);
    await expect(page.locator('li.tc-group').first()).toBeVisible();
    await sheet.getByLabel('Sort by').selectOption('title');
    await expect(page).toHaveURL(/sort=title/);
    await expect(page).not.toHaveURL(/group=due/);
    await expect(page.locator('li.tc-group')).toHaveCount(0);
    await expect(sheet.getByLabel('Group by')).toHaveValue('');
    await axeClean(page, 'my work sheet at 375');
  });

  for (const width of [320, 375, 414, 600, 768]) {
    test(`${width} px: Pod Work and the Filters sheet are axe clean without sideways scroll`, async ({
      asUser,
    }) => {
      const page = await asUser(px.username);
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`/pods/work?podId=${px.podId}&q=${px.tag}`);
      await expect(page.locator('[data-task]').first()).toBeVisible();
      expect(await pageSideScroll(page)).toBe(false);
      await axeClean(page, `pod work at ${width}`);
      await page.getByRole('button', { name: /^Filters/ }).click();
      await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
      await axeClean(page, `pod work sheet at ${width}`);
    });
  }
});
