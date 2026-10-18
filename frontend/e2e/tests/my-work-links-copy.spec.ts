import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Links, filters and copy of the work lists (WP4): Matter links only with Matter.View (BUG-7, #146), empty and near-empty copy by permission
 * (BUG-8 #147, A9 #157, B4 #159), the fixed value of tab-owned filters (BUG-10 #149), the Status choices per tab (BUG-11 #150), the Due
 * presets (G2 #155) and one error message (G6 #177). Every test has its own users and tagged tasks and asserts nothing about global counts.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/my-work-review/fixes/wp4).
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

async function viewer(seed: Seeder, codes: string[], label: string) {
  const role = await seed.role(codes, `E2E ${label}`);
  const user = await seed.user([role.name], label);
  return user;
}

test.describe('My Work links, filters and copy', () => {
  test('BUG-7: Matter references are text without Matter.View, links with it', async ({
    seed,
    asUser,
  }) => {
    const mina = await viewer(seed, ['Task.View'], 'mina');
    const tech = await viewer(seed, ['Task.View', 'Matter.View'], 'tech');
    const world = await seed.world();
    const tag = uid();
    const minaTask = await seed.task(world, { title: `Mina ${tag}`, assignedUserId: mina.userId });
    const techTask = await seed.task(world, { title: `Tech ${tag}`, assignedUserId: tech.userId });

    const columns = JSON.stringify({
      columns: ['ref', 'title', 'matter', 'client', 'priority', 'due', 'status'],
      density: 'comfortable',
    });
    for (const [who, task, allowed] of [
      [mina, minaTask, false],
      [tech, techTask, true],
    ] as const) {
      const page = await asUser(who.username);
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.addInitScript(
        ([k, v]) => localStorage.setItem(k, v),
        [`mf.work-table.v3.my-work.${who.userId}`, columns],
      );
      const myWork = new MyWorkPage(page);
      await myWork.open('?view=active');
      await myWork.expectListed(task.title);
      const row = page.locator('[data-task]').filter({ hasText: task.title });
      await expect(row.locator('td[data-col="matter"] .mf-ref')).toBeVisible();
      await expect(row.locator('a[href*="/matters/"]')).toHaveCount(allowed ? 1 : 0);
      if (!allowed) {
        // Nothing to Tab to in the Matter cell, and no way to reach the 403 page by clicking.
        await expect(
          row.locator('td[data-col="matter"] a, td[data-col="matter"] button'),
        ).toHaveCount(0);
        await shot(page, 'bug7-matter-text-1920x1080');
      }

      await new TaskQueuePage(page).open(`?q=${encodeURIComponent(task.title)}`);
      await expect(page.locator(`[data-task]`).filter({ hasText: task.title })).toHaveCount(1);
      await expect(page.locator('tbody a[href*="/matters/"]')).toHaveCount(allowed ? 1 : 0);

      await page.goto(`/tasks/${task.taskId}`);
      await expect(page.locator('[data-matter]')).toBeVisible();
      await expect(page.locator('[data-matter] .mf-ref')).toBeVisible();
      await expect(page.locator('a[href*="/matters/"]')).not.toHaveCount(allowed ? 0 : 1);
      if (allowed)
        await expect(page.locator('nav[aria-label="Breadcrumb"] a[href*="/matters/"]')).toHaveCount(
          1,
        );
      else {
        await expect(page.locator('a[href*="/matters/"]')).toHaveCount(0);
        await expect(page.locator('nav[aria-label="Breadcrumb"]')).toContainText(
          world.matter.matterRef,
        );
        await shot(page, 'bug7-task-breadcrumb-text-1920x1080');
      }
      await page.close();
    }
  });

  test('BUG-8, B4: empty copy names only screens the user can open', async ({ seed, asUser }) => {
    const plain = await viewer(seed, ['Task.View'], 'plain');
    const podUser = await viewer(seed, ['Task.View', 'Pod.View'], 'pod');
    const noPod = await viewer(seed, ['Task.View', 'Pod.View'], 'nopod');
    const creator = await viewer(seed, ['Task.View', 'Task.Create'], 'maker');
    await seed.pod(undefined, [podUser.userId]);

    // Task.View only: no mention of Pod Work.
    let page = await asUser(plain.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    let myWork = new MyWorkPage(page);
    await myWork.open('?view=active');
    const empty = page.locator('tbody [data-empty="none"]');
    await expect(empty).toHaveText(/^\s*Nothing is assigned to you right now\.\s*$/);
    await expect(empty.locator('a')).toHaveCount(0);
    await shot(page, 'bug8-empty-task-view-only-1366x768');
    await page.close();

    // Pod.View and a Pod: "Pod Work" is a link in the sentence.
    page = await asUser(podUser.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    myWork = new MyWorkPage(page);
    await myWork.open('?view=active');
    const withPod = page.locator('tbody [data-empty="none"]');
    await expect(withPod).toContainText(
      'Nothing is assigned to you right now. Check Pod Work for unassigned tasks.',
    );
    const link = withPod.getByRole('link', { name: 'Pod Work' });
    await expect(link).toHaveAttribute('href', '/pods/work');
    await shot(page, 'bug8-empty-with-pod-1366x768');
    await link.click();
    await expect(page).toHaveURL(/\/pods\/work/);
    await page.close();

    // Pod.View but no Pod: say so.
    page = await asUser(noPod.username);
    myWork = new MyWorkPage(page);
    await myWork.open('?view=active');
    await expect(page.locator('tbody [data-empty="none"]')).toContainText(
      'Nothing is assigned to you right now. You are not in a Pod yet; ask an administrator.',
    );
    await myWork.tab(/^Due soon and overdue/).click();
    await expect(page.locator('tbody [data-empty="none"]')).not.toContainText(
      /Pod Work|Task Queue/,
    );
    await page.close();

    // Created by me: Create task only with Task.Create.
    page = await asUser(creator.username);
    myWork = new MyWorkPage(page);
    await myWork.open('?view=createdByMe');
    const none = page.locator('tbody [data-empty="none"]');
    await expect(none).toContainText('You have no open tasks you created.');
    await shot(page, 'b4-created-by-me-create-task-1366x768');
    await none.getByRole('link', { name: 'Create task' }).click();
    await expect(page).toHaveURL(/\/tasks\/new/);
    await page.close();

    page = await asUser(plain.username);
    myWork = new MyWorkPage(page);
    await myWork.open('?view=createdByMe');
    await expect(page.locator('tbody [data-empty="none"]')).toContainText(
      'You have no open tasks you created.',
    );
    await expect(page.locator('tbody [data-empty="none"] a')).toHaveCount(0);
    await page.close();
  });

  test('A9: the near-empty line sits right under the last row, up to 10 tasks and unfiltered', async ({
    seed,
    asUser,
  }) => {
    const few = await viewer(seed, ['Task.View', 'Pod.View'], 'few');
    const many = await viewer(seed, ['Task.View'], 'many');
    const world = await seed.world();
    const tag = uid();
    for (let i = 0; i < 3; i++) {
      await seed.task(world, { title: `Few ${i} ${tag}`, assignedUserId: few.userId });
    }
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        seed.task(world, { title: `Many ${i} ${tag}`, assignedUserId: many.userId }),
      ),
    );

    for (const [w, h] of SIZES) {
      const page = await asUser(few.username);
      await page.setViewportSize({ width: w, height: h });
      const myWork = new MyWorkPage(page);
      await myWork.open('?view=active');
      await expect(page.locator('[data-task]')).toHaveCount(3);
      const note = page.locator('[data-near-empty]');
      await expect(note).toBeVisible();
      await expect(note).toHaveAttribute('role', 'note');
      await expect(note).toContainText("That's everything on your plate.");
      const lastRow = (await page.locator('[data-task]').last().boundingBox())!;
      const box = (await note.boundingBox())!;
      expect(box.y - (lastRow.y + lastRow.height), `${w}: gap under the last row`).toBeLessThan(16);
      expect(box.y).toBeGreaterThanOrEqual(lastRow.y + lastRow.height - 1);
      if (axeAvailable()) expect(await axeViolations(page), `near-empty at ${w}`).toEqual([]);
      await shot(page, `a9-near-empty-${w}x${h}`);

      // A filter hides the line (the filtered state applies).
      await myWork.open(`?view=active&q=${encodeURIComponent(`Few 0 ${tag}`)}`);
      await expect(page.locator('[data-task]')).toHaveCount(1);
      await expect(note).toHaveCount(0);
      await page.close();
    }

    const page = await asUser(many.username);
    await new MyWorkPage(page).open('?view=active');
    await expect(page.locator('[data-task]').first()).toBeVisible();
    await expect(page.locator('[data-near-empty]')).toHaveCount(0);
    await page.close();
  });

  test('BUG-10, BUG-11, G2: tab-owned cells say what they are, Status offers what can match, Due looks ahead', async ({
    seed,
    asUser,
  }) => {
    const me = await viewer(seed, ['Task.View'], 'filters');
    const world = await seed.world();
    const tag = uid();
    await seed.task(world, {
      title: `Soon ${tag}`,
      assignedUserId: me.userId,
      dueDate: dateInZone(FIRM_ZONE, 1),
    });
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1920, height: 1080 });
    // The column choice is per tab (X1): the same customised set on every tab.
    await page.addInitScript(
      ([keys, v]) => {
        for (const k of keys) localStorage.setItem(k, v);
      },
      [
        ['active', 'dueSoon', 'closed', 'createdByMe'].map(
          (tab) => `mf.work-columns.v2.myWork.${tab}.${me.userId}`,
        ),
        JSON.stringify(['ref', 'title', 'assignee', 'creator', 'priority', 'due', 'status']),
      ] as const,
    );
    const myWork = new MyWorkPage(page);
    const fixed = (key: string) =>
      page.locator(`tr[data-filter-row] [data-filter-fixed][data-filter="${key}"]`);
    const statusChoices = async () => {
      await page.getByRole('button', { name: /^Filter by Status/ }).click();
      const labels = await page.locator('mf-filter-popover .ms-label').allTextContents();
      await page.keyboard.press('Escape');
      return labels.map((t) => t.replace(/\s+/g, ' ').trim());
    };

    // Due soon and overdue: the Due cell reads its meaning, never "until".
    await myWork.open('?view=dueSoon');
    await expect(fixed('due')).toContainText('Next 2 days and overdue');
    await expect(fixed('assignee')).toHaveText(/Me/);
    await expect(page.locator('tr[data-filter-row]')).not.toContainText('until');
    await expect(fixed('due').locator('.fc-sr')).toHaveText(
      'Due: Next 2 days and overdue, set by this tab',
    );
    await expect(page.locator('tr[data-filter-row] input[disabled]')).toHaveCount(0);
    expect(await statusChoices()).toEqual(['In Progress', 'On Hold']);
    await shot(page, 'bug10-due-soon-fixed-cells-1920x1080');
    // Not counted, no chip.
    await expect(page.locator('[data-filter-chips] [data-chip]')).toHaveCount(0);

    await myWork.tab(/^Active/).click();
    await expect(fixed('assignee')).toHaveText(/Me/);
    expect(await statusChoices()).toEqual(['In Progress', 'On Hold']);
    await myWork.tab(/^Closed/).click();
    expect(await statusChoices()).toEqual(['Completed', 'Cancelled']);
    await myWork.tab(/^Created by me/).click();
    await expect(fixed('creator')).toHaveText(/Me/);
    expect(await statusChoices()).toEqual([
      'New',
      'In Progress',
      'On Hold',
      'Completed',
      'Cancelled',
    ]);

    // A link with a status the tab cannot show still works: a removable chip, no rows.
    await myWork.open('?view=active&status=NEW');
    await expect(page.locator('tr[data-filter-row] [data-filter="status"]')).toContainText('New');
    await expect(page.locator('tbody td[data-empty="filtered"]')).toBeVisible();
    await page.locator('[data-clear-filters]').click();
    await expect(page).not.toHaveURL(/status=/);

    // Due presets, in order, without Overdue; "Next 7 days" equals the range typed by hand.
    await myWork.open('?view=active');
    await page.getByRole('button', { name: /^Filter by Due/ }).click();
    const presets = page.getByRole('group', { name: 'Presets' }).getByRole('button');
    await expect(presets).toHaveText([
      'Today',
      'Tomorrow',
      'Next 7 days',
      'This week',
      'Next week',
      'This month',
    ]);
    await presets.filter({ hasText: 'Next 7 days' }).click();
    await expect(page).toHaveURL(new RegExp(`dueFrom=${dateInZone(FIRM_ZONE, 0)}`));
    await expect(page).toHaveURL(new RegExp(`dueTo=${dateInZone(FIRM_ZONE, 6)}`));
    await expect(page.locator(`[data-task]`).filter({ hasText: `Soon ${tag}` })).toHaveCount(1);
    await shot(page, 'g2-due-presets-1920x1080');
    await page.keyboard.press('Escape');
    const typed = page.url();
    await myWork.open(
      `?view=active&dueFrom=${dateInZone(FIRM_ZONE, 0)}&dueTo=${dateInZone(FIRM_ZONE, 6)}`,
    );
    await expect(page.locator(`[data-task]`).filter({ hasText: `Soon ${tag}` })).toHaveCount(1);
    expect(typed).toContain('dueFrom=');

    // The tab-owned cells and the Status choices at every width (at 375 the filters are in the sheet).
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await myWork.open('?view=dueSoon');
      if (w < 640) {
        await page.getByRole('button', { name: /^Filters/ }).click();
        await expect(
          page.getByRole('dialog').locator('[data-filter-fixed][data-filter="due"]'),
        ).toContainText('Next 2 days and overdue');
        if (axeAvailable()) expect(await axeViolations(page), `sheet at ${w}`).toEqual([]);
        await shot(page, `bug10-filters-sheet-${w}x${h}`);
        await page.keyboard.press('Escape');
      } else {
        if (axeAvailable()) expect(await axeViolations(page), `filters at ${w}`).toEqual([]);
        await shot(page, `bug10-due-soon-${w}x${h}`);
      }
    }
    await page.close();
  });

  test('G6: a failed first load and a failed reload show the same message, Retry restores the rows and focus', async ({
    seed,
    asUser,
  }) => {
    const me = await viewer(seed, ['Task.View'], 'errors');
    const world = await seed.world();
    const title = `Err ${uid()}`;
    await seed.task(world, { title, assignedUserId: me.userId });
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    let fail = true;
    await page.route('**/api/v1/my-work?**', (route) =>
      fail
        ? route.fulfill({
            status: 500,
            contentType: 'application/problem+json',
            body: JSON.stringify({ title: 'Boom', status: 500 }),
          })
        : route.continue(),
    );
    const myWork = new MyWorkPage(page);
    const error = page.locator('tbody [data-error]');
    const normalized = async () =>
      (await error.innerText())
        .replace(/Reference:.*$/s, '')
        .replace(/\s+/g, ' ')
        .trim();

    await myWork.open('?view=active');
    await expect(error).toBeVisible();
    const first = await normalized();
    expect(first).toContain("Couldn't load tasks.");
    await expect(page.locator('tr[data-filter-row]')).toBeVisible();
    await shot(page, 'g6-first-load-error-1366x768');

    fail = false;
    await page.locator('tbody').getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('[data-task]').filter({ hasText: title })).toHaveCount(1);
    await expect(page.locator('[data-task] a.wt-title').first()).toBeFocused();

    // A reload that fails: the rows go, the same message and controls come.
    fail = true;
    await page
      .locator('tr[data-filter-row]')
      .getByRole('textbox', { name: 'Filter by Title or Ref' })
      .fill('x');
    await page.keyboard.press('Enter');
    await expect(error).toBeVisible();
    expect(await normalized()).toBe(first);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await expect(page.locator('[data-task]')).toHaveCount(0);
    await expect(error.getByRole('button', { name: 'Retry' })).toBeVisible();
    await shot(page, 'g6-reload-error-1366x768');

    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      // Below 640 px the list is cards (#192): the same message sits in the card list's error block, not in a table body.
      await expect(w < 640 ? page.locator('[data-error]') : error).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow, `no sideways scroll at ${w}`).toBe(false);
      if (axeAvailable()) expect(await axeViolations(page), `error at ${w}`).toEqual([]);
    }
    await shot(page, 'g6-error-375x812');
    await page.close();
  });
});
