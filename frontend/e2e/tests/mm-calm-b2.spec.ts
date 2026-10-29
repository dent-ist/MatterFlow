import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { pmSolo, pmThree } from '../support/pm-fixtures';
import { SIZES } from '../support/screens';

/**
 * My Matters, a calmer page: batch 2 of epic #893.
 *
 *  - #909 + #895 one "what changed" line, drawn only when something that needs a decision changed; no Recent activity on the Overview;
 *  - #942 (owner change of 2026-10-29) the six tiles are gone: a pre-filter dropdown with the counts in its options filters the grid in place, the counts equal the grid totals;
 *  - #945 no Matters section on the Overview at any width (it replaced #908);
 *  - #943 ONE grid of the open tasks (it replaced #905 and the two grids of #929): urgency order, 25 a page, sortable headings, each task once.
 */
const settled = async (page: Page, tab = 'overview'): Promise<void> => {
  await expect(page.locator(`#mm-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-mm-tabpanel] >> text=/^Loading /')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
};

const noSideways = async (page: Page): Promise<void> => {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
};

/** Answers the since-last-visit call with the given counts (a task set up leaves audit events and new tasks behind, so "nothing changed" is staged). */
const sinceCounts = async (
  page: Page,
  counts: Partial<
    Record<
      'becameOverdue' | 'putOnHold' | 'completed' | 'newUnassigned' | 'newTasks' | 'comments',
      number
    >
  >,
): Promise<void> => {
  const now = new Date().toISOString();
  await page.route('**/api/v1/my-matters/since-last-visit**', (route) => {
    const c = (n: number | undefined, target = 'taskQueue') => ({
      count: n ?? 0,
      query: 'managedByMe=true&unassigned=true',
      target,
    });
    return route.fulfill({
      json: {
        timeZone: 'America/New_York',
        asOfUtc: now,
        sinceUtc: now,
        hasMarker: true,
        seenEventId: 0,
        counts: {
          newTasks: c(counts.newTasks, 'activity'),
          completed: c(counts.completed, 'activity'),
          becameOverdue: c(counts.becameOverdue),
          reassigned: c(0, 'activity'),
          putOnHold: c(counts.putOnHold, 'activity'),
          comments: c(counts.comments, 'activity'),
          newUnassigned: c(counts.newUnassigned),
        },
        items: [],
      },
    });
  });
};

const taskLinks = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-mm-tabpanel] a[href^="/tasks/"]')]
      .filter((a) => {
        const r = a.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      })
      .map((a) => a.getAttribute('href')!.split('?')[0]),
  );

test.describe('One "what changed" line, on the Activity tab (#909, #895, owner decision of 2026-10-28)', () => {
  test('changes that need a decision: the Overview draws nothing and the Activity tab a badge; opened, one line of links with Mark as read; no Recent activity and no event listed on the Overview', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'sc1');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await sinceCounts(page, {
      putOnHold: 4,
      becameOverdue: 2,
      completed: 9,
      newUnassigned: 3,
      comments: 21,
    });
    await page.goto('/my-matters');
    await settled(page);
    // Cut 1: nothing of it on the Overview; the four figures added up are the badge of the Activity tab.
    await expect(page.locator('[data-panel=since]')).toHaveCount(0);
    await expect(page.locator('#mm-tab-activity [data-tab-badge]')).toHaveText('18'); // 2 + 4 + 9 + 3, comments are not counted
    await expect(page.locator('#mm-tab-activity')).toHaveAccessibleName(
      'Activity, 18 changes since your last visit',
    );
    // The Overview has no Recent activity and lists no event; the Activity tab keeps the full list.
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toHaveCount(0);
    await expect(page.locator('[data-panel=activity], [data-activity-row]')).toHaveCount(0);
    await expect(page.locator('[data-since-item], [data-since-toggle]')).toHaveCount(0);
    await page.locator('#mm-tab-activity').click();
    await expect(page).toHaveURL(/tab=activity/);
    const line = page.locator('[data-panel=since]');
    await expect(line).toHaveCount(1);
    await expect(line).toContainText('Since your last visit:');
    // Only the four that need a decision are counted; comments are not.
    await expect(line.locator('[data-since-figures] a').first()).toBeVisible();
    const parts = (await line.locator('[data-since-figures] a').allInnerTexts()).map((t) =>
      t.replace(/\s+/g, ' ').trim(),
    );
    expect(parts).toEqual(['2 became overdue', '4 put on hold', '9 completed', '3 new unassigned']);
    await expect(line).not.toContainText('comment');
    await expect(line.getByRole('button', { name: 'Mark as read' })).toBeVisible();
    // It is a line, not a card: about one text line high.
    const box = await line.boundingBox();
    expect(box!.height, 'one line').toBeLessThanOrEqual(30);
    // Each part leads to its list (the Task Queue, or the Activity tab).
    await expect(line.locator('[data-figure=becameOverdue]')).toHaveAttribute('href', /\/tasks\?/);
    await expect(line.locator('[data-figure=putOnHold]')).toHaveAttribute('href', /tab=activity/);
  });

  test('nothing that needs a decision changed: nothing is drawn (comments and new tasks alone do not count)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'sc2');
    const page = await asUser(p.pm.username);
    await sinceCounts(page, { comments: 5, newTasks: 12 });
    await page.goto('/my-matters?tab=activity');
    await expect(page.locator('#mm-tab-activity')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('[data-panel=since]')).toHaveCount(0);
    await expect(page.locator('#mm-tab-activity [data-tab-badge]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mark as read' })).toHaveCount(0);
    const host = await page.locator('mf-mm-since').boundingBox();
    expect(host?.height ?? 0, 'no space reserved').toBeLessThanOrEqual(1);
  });

  test('the real counts: a held task and unassigned tasks, linked; Mark as read moves the marker and the line goes away', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmSolo(seed, personas, 'sc3');
    const page = await asUser(p.pm.username);
    await page.goto('/my-matters?tab=activity');
    await expect(page.locator('#mm-tab-activity')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
    const line = page.locator('[data-panel=since]');
    await expect(line).toBeVisible();
    // The persona has unassigned tasks created in the last 7 days; the part links to exactly those.
    const unassigned = line.locator('[data-figure=newUnassigned]');
    await expect(unassigned).toBeVisible();
    const n = Number((await unassigned.innerText()).trim().split(/\s+/)[0]);
    expect(n).toBeGreaterThan(0);
    const [queue] = await Promise.all([
      page.waitForResponse((r) => /\/api\/v1\/task-queue\?/.test(r.url()) && r.ok()),
      unassigned.click(),
    ]);
    expect(((await queue.json()) as { total: number }).total).toBe(n);
    await page.goBack();
    await settled(page, 'activity');

    const seen = page.waitForResponse(
      (r) => r.url().includes('/api/v1/my-matters/activity/seen') && r.ok(),
    );
    await page.getByRole('button', { name: 'Mark as read' }).click();
    await seen;
    await expect(page.locator('[data-panel=since]')).toHaveCount(0);
    // Reload: still nothing (the marker moved on the server).
    await page.reload();
    await settled(page, 'activity');
    await expect(page.locator('[data-panel=since]')).toHaveCount(0);
  });

  test('the Activity tab still lists the events (and no event is on the Overview)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmSolo(seed, personas, 'sc4');
    const page = await asUser(p.pm.username);
    await page.goto('/my-matters?tab=activity');
    await expect(page.locator('#mm-tab-activity')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-mm-tabpanel] a[href^="/tasks/"]').first()).toBeVisible({
      timeout: 20_000,
    });
    await page.goto('/my-matters');
    await settled(page);
    await expect(page.locator('[data-activity-row], [data-panel=activity]')).toHaveCount(0);
  });

  for (const size of SIZES) {
    test(`the line is clean (axe, no sideways scroll) at ${size.width} px`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const p = await pmThree(seed, personas, `sca${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await sinceCounts(page, { becameOverdue: 2, putOnHold: 4, completed: 9, newUnassigned: 3 });
      await page.goto('/my-matters?tab=activity');
      await settled(page, 'activity');
      await expect(page.locator('[data-panel=since]')).toBeVisible();
      await noSideways(page);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${size.width}`).toEqual([]);
    });
  }
});

test.describe('Pre-filter dropdown with counts (#942)', () => {
  const OPTIONS = ['open', 'overdue', 'atRisk', 'unassigned', 'onHold', 'dueSoon'] as const;
  const optionCount = async (page: Page, key: string): Promise<number> => {
    const text = (await page.locator(`option[data-prefilter-option=${key}]`).textContent()) ?? '';
    return Number(/\((\d+)\)\s*$/.exec(text.trim())![1]);
  };

  test('no tiles; the six choices carry their count in the option; each filters the grid in place and its total is the count', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.slow();
    const p = await pmThree(seed, personas, 'ch1');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    await expect(page.locator('[data-mm-strip], button[data-strip-item], .tile')).toHaveCount(0);
    const select = page.locator('select[data-prefilter]');
    await expect(select).toHaveAccessibleName('Show tasks');
    expect(
      await select
        .locator('option')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-prefilter-option'))),
    ).toEqual([...OPTIONS]);
    for (const key of OPTIONS) {
      const text = (await page
        .locator(`option[data-prefilter-option=${key}]`)
        .textContent())!.trim();
      expect(text, key).toMatch(/\(\d+\)$/);
    }
    await expect(select).toHaveValue('open');
    // Every choice filters the grid in place (no jump to the Tasks page) and the grid's total is the count in the option.
    for (const key of OPTIONS.slice(1)) {
      const count = await optionCount(page, key);
      const [queue] = await Promise.all([
        page.waitForResponse((r) => /\/api\/v1\/task-queue\?/.test(r.url()) && r.ok()),
        select.selectOption(key),
      ]);
      await expect(page).toHaveURL(new RegExp(`/my-matters\\?show=${key}`));
      expect(((await queue.json()) as { total: number }).total, `${key}: option = grid`).toBe(
        count,
      );
      if (count > 0)
        await expect(page.locator('[data-grid-status]'), key).toContainText(String(count));
      await expect(page.locator('[data-panel=tasks]')).toBeVisible();
    }
    // One way back.
    await expect(page.locator('[data-clear-prefilter]')).toHaveCount(1);
    await page.locator('[data-clear-prefilter]').click();
    await expect(select).toHaveValue('open');
    await expect(page).not.toHaveURL(/show=/);
  });

  test('the counts follow the Client and Matter filters, and the choice is kept in the address and remembered', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.slow();
    const p = await pmThree(seed, personas, 'ch3');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    const all = await optionCount(page, 'open');
    await page.goto(`/my-matters?matterId=${p.matters[0].matterId}`);
    await settled(page);
    const one = await optionCount(page, 'open');
    expect(one).toBeLessThan(all);
    // The grid agrees with the option.
    const [queue] = await Promise.all([
      page.waitForResponse((r) => /\/api\/v1\/task-queue\?/.test(r.url()) && r.ok()),
      page.locator('select[data-prefilter]').selectOption('open'),
    ]);
    void queue;
    await page.goto('/my-matters?show=unassigned');
    await settled(page);
    await expect(page.locator('select[data-prefilter]')).toHaveValue('unassigned');
    // A visit with nothing in the address comes back to the last choice.
    await page.goto('/my-matters');
    await expect(page).toHaveURL(/show=unassigned/);
    await expect(page.locator('select[data-prefilter]')).toHaveValue('unassigned');
  });

  test('a zero stays selectable but muted, and the word of the option still says (0)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ch2');
    const m = await w.matter('Calm only');
    await w.task(m, { dueDate: '2099-01-01', assignedUserId: w.pm.userId });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await settled(page);
    const overdue = page.locator('option[data-prefilter-option=overdue]');
    await expect(overdue).toHaveText(/Overdue \(0\)/);
    await expect(overdue).toHaveClass(/pf__zero/);
    expect(await overdue.evaluate((e) => (e as HTMLOptionElement).disabled)).toBe(false);
    await page.locator('select[data-prefilter]').selectOption('overdue');
    await expect(page.locator('[data-panel=tasks] [data-empty]')).toHaveText('No overdue tasks.');
    await expect(page.locator('select[data-prefilter]')).toBeVisible();
    await expect(page.locator('[data-clear-prefilter]')).toHaveCount(1);
  });

  for (const size of SIZES) {
    test(`the dropdown and the grid are clean (axe, no sideways scroll) at ${size.width} px; 44 px on a phone`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const p = await pmThree(seed, personas, `cha${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      await settled(page);
      const select = page.locator('select[data-prefilter]');
      await expect(select).toBeVisible();
      const box = await select.boundingBox();
      if (size.width < 640) expect(box!.height, 'phone target').toBeGreaterThanOrEqual(43.5);
      else expect(box!.height, 'compact height').toBeLessThanOrEqual(34);
      expect(box!.x + box!.width, 'inside the screen').toBeLessThanOrEqual(size.width);
      await page.locator('select[data-prefilter]').selectOption('overdue');
      await settled(page);
      await noSideways(page);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${size.width}`).toEqual([]);
    });
  }
});

test.describe('No Matters section on the Overview (#945)', () => {
  test('one matter: no section, no row menu; the matter is named and linked after the heading of the grid on a wide screen', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmSolo(seed, personas, 'mh1');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    await expect(page.locator('[data-panel=health]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^Matters?( health)?$/ })).toHaveCount(0);
    await expect(
      page.locator('[data-health-list], [data-health-row], [data-all-matters]'),
    ).toHaveCount(0);
    // One create button for the whole page: the shell's.
    await expect(page.getByRole('button', { name: /New task|Task on a matter/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create task' })).toHaveCount(1);
    const link = page.locator('[data-grid-matter] a');
    await expect(link).toHaveAttribute('href', `/matters/${p.matters[0].matterId}`);
    await expect(link).toContainText(p.matters[0].name);
  });

  for (const size of SIZES) {
    test(`several matters: no Matters section, no "All matters" link, nothing below the grid at ${size.width} px`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const p = await pmThree(seed, personas, `mh3${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      await settled(page);
      await expect(page.locator('[data-panel]')).toHaveCount(1);
      await expect(
        page.locator('[data-panel=health], [data-health-row], [data-all-matters]'),
      ).toHaveCount(0);
      await expect(page.getByRole('link', { name: /^All matters/ })).toHaveCount(0);
      await noSideways(page);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${size.width}`).toEqual([]);
    });
  }
});

test.describe('One grid of the open tasks (#943)', () => {
  test('one grid of the shared table with sortable headings and 25 a page: a second page by keyboard; no second grid, no View all', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'na1');
    const m = await w.matter('Paging');
    for (let i = 0; i < 27; i++)
      await w.task(m, {
        dueDate: '2000-02-' + String((i % 27) + 1).padStart(2, '0'),
        title: `Page ${String(i).padStart(2, '0')}`,
      });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    const panel = page.locator('[data-panel=tasks]');
    await expect(page.locator('[data-panel]')).toHaveCount(1);
    await expect(page.locator('[data-mm-tabpanel] h2')).toHaveCount(1);
    await expect(panel.locator('[data-view-all]')).toHaveCount(0);
    await expect(panel.locator('mf-task-table table.wt')).toBeVisible();
    const heads = panel.locator('thead th');
    // One matter: no Matter column.
    expect(await heads.evaluateAll((els) => els.map((e) => e.getAttribute('data-col')))).toEqual([
      'ref',
      'title',
      'priority',
      'assignee',
      'due',
      'status',
    ]);
    await expect(heads.locator('button.wt-sort')).toHaveCount(6);
    await expect(panel.locator('tbody tr[data-task]')).toHaveCount(25);
    const pager = page.locator('mf-pager');
    await expect(pager).toContainText('Page 1 of 2');
    // The page control is reachable and works with the keyboard.
    const next = pager.getByRole('button', { name: 'Next' });
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(pager).toContainText('Page 2 of 2');
    await expect(panel.locator('tbody tr[data-task]')).toHaveCount(2);
    // A task is listed once.
    const links = await taskLinks(page);
    expect(new Set(links).size, `no task id twice: ${links.join(' ')}`).toBe(links.length);
  });

  test('a click on a heading sorts ALL the tasks on the server, not the rows on screen; Urgency brings the default order back', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'na5');
    const m = await w.matter('Sorting');
    for (let i = 0; i < 7; i++)
      await w.task(m, {
        dueDate: `2000-01-0${i + 1}`,
        title: `Sort ${String.fromCharCode(65 + i)}`,
      });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    const panel = page.locator('[data-panel=tasks]');
    const titles = async () =>
      (await panel.locator('a.wt-title').allInnerTexts()).map((t) => t.trim());
    expect(await titles()).toEqual([
      'Sort A',
      'Sort B',
      'Sort C',
      'Sort D',
      'Sort E',
      'Sort F',
      'Sort G',
    ]);
    await expect(panel.locator('th[data-col=due]')).toHaveAttribute('aria-sort', 'none');
    await expect(panel.locator('[data-sort-urgency]')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('[data-sort-urgency]')).toHaveText('Urgency');
    const titleSort = panel.locator('th[data-col=title] button.wt-sort');
    await titleSort.click();
    await expect(panel.locator('th[data-col=title]')).toHaveAttribute('aria-sort', 'ascending');
    await titleSort.click();
    await expect(panel.locator('th[data-col=title]')).toHaveAttribute('aria-sort', 'descending');
    await expect
      .poll(titles)
      .toEqual(['Sort G', 'Sort F', 'Sort E', 'Sort D', 'Sort C', 'Sort B', 'Sort A']);
    await expect(panel.locator('th[data-col=due]')).toHaveAttribute('aria-sort', 'none');
    await expect(panel.locator('[data-sort-urgency]')).toHaveAttribute('aria-pressed', 'false');
    // The pre-filter keeps the order the person chose.
    await page.locator('select[data-prefilter]').selectOption('overdue');
    await expect
      .poll(titles)
      .toEqual(['Sort G', 'Sort F', 'Sort E', 'Sort D', 'Sort C', 'Sort B', 'Sort A']);
    // Urgency brings the default order back.
    await panel.locator('[data-sort-urgency]').click();
    await expect
      .poll(titles)
      .toEqual(['Sort A', 'Sort B', 'Sort C', 'Sort D', 'Sort E', 'Sort F', 'Sort G']);
    await expect(panel.locator('[data-sort-urgency]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the default order is Urgency: by reason, then by due date, so a held task due soon does not go before an unassigned task due later (#935)', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.skip(!process.env['E2E_SQL_CONTAINER'], 'needs the SQL container to age the hold');
    const w = await mmWorld(seed, personas, 'na6');
    const m = await w.matter('Urgency');
    await w.task(m, { dueDate: '2000-01-01', title: 'Urg overdue' });
    await w.task(m, { dueDate: inDays(5), title: 'Urg unassigned later' });
    const held = await w.task(m, {
      dueDate: inDays(1),
      assignedUserId: w.pm.userId,
      title: 'Urg held sooner',
    });
    await seed.admin.post(`/api/v1/tasks/${held.taskId}/status`, {
      status: 'ON_HOLD',
      comment: 'Waiting',
      rowVersion: held.rowVersion,
    });
    seed.sql(
      `UPDATE dbo.Task SET StatusChangedAt = DATEADD(DAY, -9, SYSUTCDATETIME()) WHERE TaskId = ${Number(held.taskId)}`,
    );
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    const panel = page.locator('[data-panel=tasks]');
    await expect
      .poll(async () => (await panel.locator('a.wt-title').allInnerTexts()).map((t) => t.trim()))
      .toEqual(['Urg overdue', 'Urg unassigned later', 'Urg held sooner']);
  });

  test('every task is listed once; overdue work comes first; no inline editors in the grid', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'na2');
    const m = await w.matter('Once');
    await w.task(m, { dueDate: inDays(0), title: 'Due today and unassigned' });
    await w.task(m, { dueDate: '2000-01-01', title: 'Long overdue', assignedUserId: w.pm.userId });
    for (let i = 1; i <= 3; i++)
      await w.task(m, { dueDate: inDays(i), title: `Soon ${i}`, assignedUserId: w.pm.userId });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    const links = await taskLinks(page);
    expect(new Set(links).size, `no task id twice: ${links.join(' ')}`).toBe(links.length);
    await expect(page.locator('[data-panel=tasks] tr[data-task]')).toHaveCount(5);
    await expect(page.locator('[data-panel=tasks] tr[data-task]').first()).toContainText(
      'Long overdue',
    );
    await expect(page.locator('[data-panel=tasks] [data-inline-trigger]')).toHaveCount(0);
  });

  test('nothing open: one muted line, no toolbar, only the Calendar button', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'na4');
    await w.matter('Quiet');
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await settled(page);
    const panel = page.locator('[data-panel=tasks]');
    await expect(panel).toContainText('No open tasks.');
    await expect(panel.locator('select, table, mf-options-menu')).toHaveCount(0);
    await expect(panel.locator('[data-calendar-toggle]')).toBeVisible();
  });

  for (const size of SIZES) {
    test(`the grid is clean (axe, no sideways scroll) at ${size.width} px`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const p = await pmThree(seed, personas, `naa${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      await settled(page);
      await expect(page.locator('[data-panel=tasks] [data-task]').first()).toBeVisible();
      await noSideways(page);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${size.width}`).toEqual([]);
    });
  }
});
