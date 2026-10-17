import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage } from '../pages/queues.pages';
import { Api } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Per-tab columns of My Work (WP6b): Active and Due soon and overdue lose the Matter column and carry the reference in the line under the
 * title (A2, #174), workflow progress is one text line (A3, #175), Created by me gets Assignee, Priority, Due, Status and Age (B1/B3, #173,
 * #185) and starts on Open (B2, #186, with "Show closed tasks"), Closed shows Ref, Title, Matter, Closed and Status with a muted priority
 * (C2, #184). Every test uses its own users and tagged tasks, so nothing depends on global counts. Screenshots go to E2E_SCREENSHOTS when it
 * is set (docs/ux/my-work-review/fixes/wp6b).
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

const MAKER_RIGHTS = ['Task.View', 'Task.Create', 'Task.Assign', 'Matter.View'];

async function maker(seed: Seeder, label: string, codes: string[] = MAKER_RIGHTS) {
  const role = await seed.role(codes, `E2E ${label} ${uid()}`);
  return seed.user([role.name], label);
}

const headers = (page: Page) =>
  page
    .locator('thead tr')
    .first()
    .locator('th')
    .allTextContents()
    .then((t) => t.map((x) => x.trim()));

/** Rows whose bottom edge is inside the scrolling grid box: what is on screen without scrolling. */
async function rowsInView(page: Page): Promise<number> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tbody tr[data-task]'));
    const wrap = document.querySelector('.wt-wrap') as HTMLElement;
    const box = wrap.getBoundingClientRect();
    return rows.filter((r) => r.getBoundingClientRect().bottom <= box.bottom + 1).length;
  });
}

test.describe('My Work per-tab columns', () => {
  test('A2, A3: Active has no Matter column, the reference leads the subline and progress is one text line', async ({
    seed,
    asUser,
  }) => {
    const tech = await maker(seed, 'tab-active');
    const world = await seed.world();
    const tag = uid();
    for (let i = 1; i <= 14; i++) {
      await seed.task(world, {
        title: `Review privileged documents ${i} ${tag}`,
        assignedUserId: tech.userId,
      });
    }

    const page = await asUser(tech.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(14);
    expect(await headers(page)).toEqual([
      'Ref',
      'Title',
      'Workflow progress',
      'Priority',
      'Due',
      'Status',
    ]);
    // Same set on Due soon and overdue.
    await myWork.tab(/^Due soon and overdue/).click();
    expect(await headers(page)).toEqual([
      'Ref',
      'Title',
      'Workflow progress',
      'Priority',
      'Due',
      'Status',
    ]);
    await myWork.open('?view=active');

    const row = page.locator('tbody tr[data-task]').first();
    const sub = row.locator('[data-title-context]');
    // Reference (monospace, a link with Matter.View), client, matter; one line; the full text in the tooltip.
    const subRef = sub.locator('[data-sub-ref]');
    await expect(subRef).toHaveClass(/wt-mono/);
    await expect(subRef).toHaveAttribute('href', /\/matters\/\d+/);
    const full = (await sub.getAttribute('title')) ?? '';
    expect(full).toMatch(/^\S+ · .+ · .+/);
    expect(full.startsWith((await subRef.textContent())!.trim())).toBe(true);
    const lineHeight = await sub.evaluate((n) => n.getBoundingClientRect().height);
    expect(lineHeight, 'the subline is one line').toBeLessThan(24);

    // A3: "0 of 3 done · Step", no bar.
    const progress = row.locator('td[data-col="progress"]');
    await expect(progress).toHaveText(/^\s*0 of 3 done · \S+/);
    await expect(row.locator('progress')).toHaveCount(0);
    const progressHeight = await progress
      .locator('.wt-progress')
      .evaluate((n) => n.getBoundingClientRect().height);
    expect(progressHeight, 'progress is one line').toBeLessThan(24);

    // Titles of average length stay on one line, and 9 rows fit at 1366x768.
    const titleHeight = await row
      .locator('a.wt-title')
      .evaluate((n) => n.getBoundingClientRect().height);
    expect(titleHeight, 'the title is one line').toBeLessThan(24);
    expect(await rowsInView(page)).toBeGreaterThanOrEqual(9);
    await shot(page, 'a2-active-1366x768');

    // The Matter filter is still reachable: a matter text in the address filters the rows.
    const ref = (await subRef.textContent())!.trim();
    await myWork.open(`?matterText=${encodeURIComponent(ref)}`);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(14);
    await myWork.open('?matterText=no-such-matter-9999');
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(0);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await myWork.open('?view=active');
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(14);
    expect(await rowsInView(page)).toBeGreaterThanOrEqual(14);
    await shot(page, 'a2-active-1920x1080');
  });

  test('A2: a customised column set is kept; the Matter column can be added back', async ({
    seed,
    asUser,
  }) => {
    const tech = await maker(seed, 'tab-custom');
    const world = await seed.world();
    await seed.task(world, { assignedUserId: tech.userId });
    const page = await asUser(tech.username);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript(
      ([k, v]) => {
        if (!localStorage.getItem(k)) localStorage.setItem(k, v);
      },
      [
        `mf.work-columns.v2.myWork.active.${tech.userId}`,
        JSON.stringify(['ref', 'title', 'client', 'status']),
      ],
    );
    const myWork = new MyWorkPage(page);
    await myWork.open();
    expect(await headers(page)).toEqual(['Ref', 'Title', 'Client', 'Status']);
    await myWork.tab(/^Created by me/).click();
    expect(await headers(page)).toEqual([
      'Ref',
      'Title',
      'Priority',
      'Assignee',
      'Due',
      'Status',
      'Age',
    ]);
    await myWork.tab(/^Active/).click();
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await page.getByLabel('Matter', { exact: true }).check();
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await expect(page.locator('th[data-col="matter"]')).toBeVisible();
    // The Matter column shows the reference, so the subline leaves it out.
    await expect(page.locator('tbody tr[data-task]').first().locator('[data-sub-ref]')).toHaveCount(
      0,
    );
  });

  test('B1, B3, B2: Created by me columns, Age, Open by default, All with a chip, and the counts', async ({
    seed,
    asUser,
  }) => {
    test.skip(!Seeder.canWriteLegacyText(), 'needs the SQL container of run-local.sh');
    const boss = await maker(seed, 'tab-created');
    const worker = await maker(seed, 'tab-worker', ['Task.View']);
    const idle = await seed.user(['Data Technician'], 'tab-idle');
    const world = await seed.world();
    const tag = uid();
    const api = await Api.as(boss.username);
    try {
      const assigned = await seed.task(
        world,
        { title: `Assigned ${tag}`, assignedUserId: worker.userId },
        api,
      );
      seed.ageTask(Number(assigned['taskId']), { createdDaysAgo: 12 });
      await seed.task(world, { title: `Nobody ${tag}` }, api);
      const done = await seed.task(
        world,
        { title: `Finished ${tag}`, assignedUserId: idle.userId },
        api,
      );
      seed.ageTask(Number(done['taskId']), { createdDaysAgo: 30, completedDaysAgo: 18 });
    } finally {
      await api.dispose();
    }

    const page = await asUser(boss.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open('?view=createdByMe');
    await myWork.search(tag);
    expect(await headers(page)).toEqual([
      'Ref',
      'Title',
      'Priority',
      'Assignee',
      'Due',
      'Status',
      'Age',
    ]);
    // Open by default: the closed task is not here, the Status filter says Open without a chip, and the tab count follows the grid.
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(2);
    await myWork.expectNotListed(`Finished ${tag}`);
    await expect(page.locator('tr[data-filter-row] [data-filter="status"]')).toContainText('Open');
    await expect(page.getByRole('button', { name: /^Filters \(1\)/ })).toBeVisible();
    await expect(myWork.tab(/^Created by me/)).toContainText('(');
    const assignedRow = myWork.row(`Assigned ${tag}`);
    await expect(assignedRow.locator('td[data-col="assignee"]')).toContainText(/\w/);
    await expect(assignedRow.locator('td[data-col="age"]')).toHaveText('12 d');
    await expect(assignedRow.locator('td[data-col="age"] [title]')).toHaveAttribute(
      'title',
      /^Created [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M \S+$/,
    );
    await expect(myWork.row(`Nobody ${tag}`).locator('td[data-col="assignee"]')).toContainText(
      'Unassigned',
    );
    await shot(page, 'b1-created-by-me-1366x768');

    // The Assignee filter is available on this tab (Creator is the tab-owned one).
    await expect(page.locator('tr[data-filter-row] [data-filter="assignee"]')).toBeVisible();
    await expect(page.locator('tr[data-filter-row] [data-filter="creator"]')).toHaveCount(0);

    // All statuses: written to the address, with a chip, and the closed task joins (with how long it took).
    const countOpen = await tabCountOf(page);
    await myWork.open(`?view=createdByMe&status=&q=${tag}`);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(3);
    await expect(page.locator('tr[data-filter-row] [data-filter="status"]')).toContainText('All');
    // "All" is a chosen filter: the Filters button counts it (the q search and the status).
    await expect(page.getByRole('button', { name: /^Filters \(2\)/ })).toBeVisible();
    const finished = myWork.row(`Finished ${tag}`);
    await expect(finished.locator('td[data-col="age"]')).toHaveText('12 d');
    await expect(finished.locator('td[data-col="age"] [title]')).toHaveAttribute(
      'title',
      /^Took 12 d\./,
    );
    await shot(page, 'b2-created-by-me-all-1366x768');
    expect(await tabCountOf(page)).toBeGreaterThanOrEqual(countOpen);

    // A bare link means Open; a link with another filter and no status means every status (the Task Queue rule).
    await myWork.open(`?view=createdByMe&q=${tag}`);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(3);
    await myWork.open('?view=createdByMe');
    await myWork.search(tag);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(2);
    // Typing a search keeps the Open statuses in the address, so the list does not widen by itself.
    await expect(page).toHaveURL(/status=NEW/);

    // The Task Queue agrees with the tab on the Open default.
    await page.getByRole('link', { name: 'Open in Task Queue' }).click();
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(2);
  });

  test('B1: without Task.Assign the Assignee cell is plain text, "Unassigned" muted italic', async ({
    seed,
    asUser,
  }) => {
    const boss = await maker(seed, 'tab-plain', ['Task.View', 'Task.Create']);
    const world = await seed.world();
    const tag = uid();
    const api = await Api.as(boss.username);
    try {
      await seed.task(world, { title: `Plain ${tag}` }, api);
    } finally {
      await api.dispose();
    }
    const page = await asUser(boss.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open('?view=createdByMe');
    await myWork.search(tag);
    const cell = myWork.row(`Plain ${tag}`).locator('td[data-col="assignee"]');
    await expect(cell.locator('.wt-unassigned')).toHaveText('Unassigned');
    await expect(cell.locator('button, select, [role="combobox"]')).toHaveCount(0);
  });

  test('B2, B4: with nothing open, Created by me offers "Show closed tasks"', async ({
    seed,
    asUser,
  }) => {
    test.skip(!Seeder.canWriteLegacyText(), 'needs the SQL container of run-local.sh');
    const boss = await maker(seed, 'tab-closedonly');
    const world = await seed.world();
    const tag = uid();
    const api = await Api.as(boss.username);
    try {
      const t = await seed.task(world, { title: `Old ${tag}` }, api);
      seed.ageTask(Number(t['taskId']), { createdDaysAgo: 9, completedDaysAgo: 2 });
    } finally {
      await api.dispose();
    }
    const page = await asUser(boss.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open('?view=createdByMe');
    const none = page.locator('tbody [data-empty="none"]');
    await expect(none).toContainText('You have no open tasks you created.');
    await expect(myWork.tab(/^Created by me/)).toContainText('(0)');
    await shot(page, 'b2-created-by-me-no-open-1366x768');
    await none.getByRole('button', { name: 'Show closed tasks' }).click();
    await expect(page).toHaveURL(/status=(&|$)/);
    await expect(myWork.row(`Old ${tag}`)).toHaveCount(1);
    await expect(myWork.tab(/^Created by me/)).toContainText('(1)');
  });

  test('C2: Closed shows Ref, Title, Matter, Closed and Status; priority is muted and Due plain when added', async ({
    seed,
    asUser,
  }) => {
    test.skip(!Seeder.canWriteLegacyText(), 'needs the SQL container of run-local.sh');
    const tech = await maker(seed, 'tab-closed');
    const world = await seed.world();
    const tag = uid();
    const t = await seed.task(world, {
      title: `Closed critical ${tag}`,
      assignedUserId: tech.userId,
    });
    seed.ageTask(Number(t['taskId']), { createdDaysAgo: 7, completedDaysAgo: 3 });

    const page = await asUser(tech.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open('?view=completed');
    await myWork.search(tag);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(1);
    expect(await headers(page)).toEqual(['Ref', 'Title', 'Matter', 'Status', 'Closed']);
    await expect(page.locator('.pi-bolt')).toHaveCount(0);
    await shot(page, 'c2-closed-1366x768');

    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await page.getByLabel('Priority', { exact: true }).check();
    await page.getByLabel('Due', { exact: true }).check();
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    const row = page.locator('tbody tr[data-task]').first();
    await expect(row.locator('td[data-col="priority"] .badge')).toHaveClass(/muted/);
    const bg = await row
      .locator('td[data-col="priority"] .badge')
      .evaluate((n) => getComputedStyle(n).backgroundColor);
    expect(bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent').toBe(true);
    await expect(row.locator('td[data-col="due"] .pi-bolt')).toHaveCount(0);
    await expect(row.locator('td[data-col="due"]')).toHaveText('-');
    await shot(page, 'c2-closed-with-priority-1366x768');
  });

  test('axe, no horizontal page scroll and screenshots of the three default sets at four widths', async ({
    seed,
    asUser,
  }) => {
    test.skip(!Seeder.canWriteLegacyText(), 'needs the SQL container of run-local.sh');
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    const boss = await maker(seed, 'tab-axe');
    const world = await seed.world();
    const api = await Api.as(boss.username);
    try {
      for (let i = 0; i < 3; i++) {
        await seed.task(world, { assignedUserId: boss.userId }, api);
      }
      const t = await seed.task(world, { assignedUserId: boss.userId }, api);
      seed.ageTask(Number(t['taskId']), { createdDaysAgo: 8, completedDaysAgo: 2 });
    } finally {
      await api.dispose();
    }
    const page = await asUser(boss.username);
    const myWork = new MyWorkPage(page);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      for (const [view, name] of [
        ['active', 'active'],
        ['createdByMe', 'created-by-me'],
        ['completed', 'closed'],
      ] as const) {
        await myWork.open(`?view=${view}`);
        await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
        expect(await axeViolations(page), `${name} at ${w}`).toEqual([]);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        expect(overflow, `no horizontal page scroll, ${name} at ${w}`).toBe(false);
        await shot(page, `${name}-${w}x${h}`);
      }
    }
  });
});

async function tabCountOf(page: Page): Promise<number> {
  const text = (await new MyWorkPage(page).tab(/^Created by me/).textContent()) ?? '';
  return Number(/\((\d+)\)/.exec(text)?.[1]);
}
