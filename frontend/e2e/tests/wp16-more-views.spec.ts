import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Api, Json } from '../support/api';
import { TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';
import {
  VIEW_FIELD,
  VIEW_LABEL,
  ViewKey,
  chooseView,
  inStrip,
  isPressed,
  moreButton,
  openMore,
  stripView,
  viewAvailable,
} from '../support/views';

/**
 * More views, vocabulary and the window (WP12 and WP16: #222, #224, #220, #221, #223). Nothing here depends on global counts or order:
 * counts are compared with the same response's `views` block and `total`, data is tagged, the Dashboard links are read for a Pod of the
 * test's own, and the people are users of the test. Screenshots go to E2E_SCREENSHOTS when it is set
 * (docs/ux/task-queue-review/fixes/wp-views2).
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

const isQueue = (url: string) => /\/api\/v1\/task-queue\?/.test(url);

interface QueueBody {
  total: number;
  views: Record<string, number | null>;
  items: { taskNumber: string; title: string }[];
}

/** Runs `action` and returns the Task Queue response it causes. */
async function queueResponse(page: Page, action: () => Promise<unknown>): Promise<QueueBody> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => isQueue(r.url()) && r.status() === 200),
    action(),
  ]);
  return (await response.json()) as QueueBody;
}

const filterInput = (page: Page, key: string) =>
  page.locator(`tr[data-filter-row] input[data-filter="${key}"]`);

/** Narrows the open view to the test's own tasks with the Title filter, and returns the titles on screen. */
async function titlesWith(page: Page, token: string): Promise<string[]> {
  await filterInput(page, 'q').fill(token);
  await filterInput(page, 'q').press('Enter');
  await expect(page).toHaveURL(new RegExp(`q=${token}`));
  await expect(page.locator('[data-task]').first()).toBeVisible();
  // Settled: one response later the rows are the filtered ones.
  await page.waitForLoadState('networkidle');
  return page
    .locator('[data-task] .wt-title')
    .evaluateAll((links) => links.map((l) => (l.textContent ?? '').trim()));
}

const paramsOf = (url: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const [k, v] of new URL(url).searchParams) (out[k] ??= []).push(v);
  for (const k of Object.keys(out)) out[k].sort();
  return out;
};

const withoutOrder = (p: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'sort' && k !== 'dir'));

test.describe('More views (WP16)', () => {
  test('#220: Due soon, ASAP and On hold list their own tasks, with the Dashboard totals, tooltips and order', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const token = uid();
    const make = (title: string, extra: Json = {}) =>
      seed.task(world, { title: `${title} ${token}`, ...extra });
    await make('VV soon', { dueDate: dateInZone(FIRM_ZONE, 1) });
    await make('VV soon2', { dueDate: dateInZone(FIRM_ZONE, 2) });
    await make('VV later', { dueDate: dateInZone(FIRM_ZONE, 5) });
    await make('VV over', { dueDate: dateInZone(FIRM_ZONE, -3) });
    await make('VV asap');
    const hold = await make('VV hold', { dueDate: dateInZone(FIRM_ZONE, 10) });
    const held = await new TaskApi(admin, hold.taskId).changeStatus('ON_HOLD', 'Waiting');
    expect(held.status, JSON.stringify(held.body)).toBeLessThan(300);

    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    const expected: [ViewKey, string[]][] = [
      ['dueSoon', [`VV soon ${token}`, `VV soon2 ${token}`]],
      ['asap', [`VV asap ${token}`]],
      ['onHold', [`VV hold ${token}`]],
      ['overdue', [`VV over ${token}`]],
    ];
    for (const [key, titles] of expected) {
      await queue.open();
      await expect(page.locator('.qv .qv-n:not([data-count-pending])').first()).toBeVisible();
      const body = await queueResponse(page, () => chooseView(page, key));
      // The count of the view, the grid total and (below) the Dashboard's drill-through are one number.
      expect(body.views[VIEW_FIELD[key]], `${key} count = total`).toBe(body.total);
      expect(await isPressed(page, key)).toBe(true);
      expect(await titlesWith(page, token), key).toEqual(expect.arrayContaining(titles));
      expect((await titlesWith(page, token)).length, `${key} holds only its own tasks`).toBe(
        titles.length,
      );
    }

    // Due soon starts soonest first, like the Dashboard list, and says what it is in its tooltip.
    await queue.open();
    await chooseView(page, 'dueSoon');
    await expect(page).toHaveURL(/sort=due&dir=asc/);
    const dueSoonButton = (await inStrip(page, 'dueSoon'))
      ? stripView(page, 'dueSoon')
      : await openMore(page, 'dueSoon');
    const tip = await dueSoonButton.getAttribute('title');
    expect(tip).toBe('Open tasks due today, tomorrow or in 2 days; not overdue, not ASAP');

    // Same shape as the Dashboard tile's link (the order the view adds apart).
    const viewParams = withoutOrder(paramsOf(page.url()));
    const summary = await admin.get<Json>('/api/v1/dashboard?fresh=true');
    const tileParams = paramsOf(`http://x/tasks?${summary.dueSoon.query}`);
    expect(viewParams).toEqual(tileParams);
    await shot(page, 'due-soon-1366x768');
  });

  test('#220: the row is the Dashboard order, Recently completed is in More, and More follows the popover rule', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    await expect(page.locator('.qv .qv-n:not([data-count-pending])').first()).toBeVisible();
    const keys = await page
      .locator('.qv > button[data-view]')
      .evaluateAll((b) => b.map((x) => x.getAttribute('data-view')));
    const order = [
      'allOpen',
      'unassigned',
      'overdue',
      'dueSoon',
      'asap',
      'onHold',
      'myPod',
      'createdByMe',
    ];
    // Whatever fits is in the Dashboard's order (the first six are the tiles), and the rest sits in More.
    expect(keys).toEqual(order.filter((k) => keys.includes(k)));
    expect(keys.slice(0, 6)).toEqual(order.slice(0, Math.min(6, keys.length)));
    expect(await inStrip(page, 'recentlyCompleted')).toBe(false);
    await shot(page, 'row-1920x1080');

    // Opens, names itself, closes on Esc with focus back, and on a press outside.
    await moreButton(page).click();
    await expect(moreButton(page)).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByRole('dialog', { name: 'More views' });
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-view="recentlyCompleted"]')).toBeVisible();
    await expect(panel.locator('[data-view="recentlyCompleted"]')).toHaveAttribute(
      'title',
      'Completed in the last 30 days (cancelled tasks are not included)',
    );
    await shot(page, 'more-open-1920x1080');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(moreButton(page)).toBeFocused();
    await moreButton(page).click();
    await expect(panel).toBeVisible();
    await page.locator('h1').click();
    await expect(panel).toHaveCount(0);
    await expect(moreButton(page)).toHaveAttribute('aria-expanded', 'false');

    // From the keyboard alone: every view is reachable, More opens with Enter and a view is chosen with Enter.
    await stripView(page, 'allOpen').focus();
    for (const tab of keys.map(() => 'Tab')) await page.keyboard.press(tab);
    await expect(moreButton(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-view]').first()).toBeFocused();
    const body = await queueResponse(page, () =>
      panel
        .locator('[data-view="recentlyCompleted"]')
        .focus()
        .then(() => page.keyboard.press('Enter')),
    );
    expect(body.views['recentlyCompleted']).toBe(body.total);
    await expect(panel).toHaveCount(0);
    // The pressed view is in More: the button shows its name and count and counts as pressed.
    await expect(moreButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(moreButton(page)).toContainText('Recently completed');
    await expect(moreButton(page).locator('.qv-n')).toHaveText(body.total.toLocaleString('en-US'));
    await shot(page, 'more-pressed-1920x1080');
  });

  test('#220: row 1 stays one line with every view at 1366 and 1920, and overflows into More instead of wrapping', async ({
    seed,
    asUser,
  }) => {
    // The most views a person gets: Task.Create and a primary Pod.
    const lead = await seed.user(['Pod Lead'], 'v2lead');
    const pod = await seed.pod(`V2 pod ${uid()}`, [lead.userId]);
    seed.sql(
      `UPDATE dbo.PodMember SET IsPrimary = 1 WHERE UserId = ${lead.userId} AND PodId = ${pod.podId}`,
    );
    const page = await asUser(lead.username);
    const widths: Record<number, number> = {};
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      const queue = new TaskQueuePage(page);
      await queue.open();
      await expect(page.locator('.qv .qv-n:not([data-count-pending])').first()).toBeVisible();
      // My pod comes with the Pods (a request of its own); at 1366 it is one of the views that overflow into More.
      await expect.poll(() => viewAvailable(page, 'myPod')).toBe(true);
      const strip = page.locator('.qv > button');
      const boxes = await strip.evaluateAll((bs) =>
        bs.map((b) => {
          const r = b.getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), right: r.right };
        }),
      );
      widths[w] = boxes.length - 1;
      if (w >= 1100) {
        // One line: every button of the strip and the buttons at the right share the line.
        expect(new Set(boxes.map((b) => b.top)).size, `strip on one line at ${w}`).toBe(1);
        const bar = (await page.locator('[data-grid-toolbar]').boundingBox())!;
        expect(bar.height, `row 1 at ${w}`).toBeLessThanOrEqual(40);
        const filters = (await page.locator('[data-filters-toggle]').boundingBox())!;
        expect(boxes[boxes.length - 1].right).toBeLessThan(filters.x);
      }
      // Every view is reachable: in the strip or in More, none is lost.
      const inMore: string[] = [];
      await moreButton(page).click();
      const items = await page
        .locator('mf-filter-popover [data-view]')
        .evaluateAll((b) => b.map((x) => x.getAttribute('data-view') ?? ''));
      inMore.push(...items);
      const inRow = await strip.evaluateAll((bs) =>
        bs.map((b) => b.getAttribute('data-view')).filter((k): k is string => !!k),
      );
      expect([...inRow, ...inMore].sort(), `all views at ${w}`).toEqual(
        [
          'allOpen',
          'unassigned',
          'overdue',
          'dueSoon',
          'asap',
          'onHold',
          'myPod',
          'createdByMe',
          'recentlyCompleted',
        ].sort(),
      );
      await shot(page, `lead-more-open-${w}x${h}`);
      if (axeAvailable()) {
        expect(await axeViolations(page), `More open at ${w}`).toEqual([]);
      }
      await page.keyboard.press('Escape');
      expect(await axeViolations(page).catch(() => []), `closed at ${w}`).toEqual([]);
      await shot(page, `lead-row-${w}x${h}`);
    }
    // Wider windows hold at least as many views in the strip as narrower ones.
    expect(widths[1920]).toBeGreaterThanOrEqual(widths[1366]);
    expect(widths[1366]).toBeGreaterThanOrEqual(widths[768]);
  });

  test('#220: a view that was chosen from More is named in the restored notice and again on a plain link', async ({
    page,
  }) => {
    const queue = new TaskQueuePage(page);
    await queue.open();
    await expect(page.locator('.qv .qv-n:not([data-count-pending])').first()).toBeVisible();
    await chooseView(page, 'dueSoon');
    await expect(page).toHaveURL(/dueTo=/);
    await expect(
      page.locator('[data-view="dueSoon"], [data-view-in-more="dueSoon"]').first(),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.goto('/tasks');
    await expect(page.locator('[data-restored-text]')).toHaveText(
      'Restored your last view: Due soon.',
    );
    expect(await isPressed(page, 'dueSoon')).toBe(true);
    await expect(page.locator('[data-filters-toggle]')).not.toContainText('(');
    await shot(page, 'restored-due-soon-1366x768');
  });
});

test.describe('Dashboard links are views (WP16, #221)', () => {
  test('every Dashboard link of a Pod keeps its total and Due soon, ASAP, On hold, Overdue, Unassigned and Recently completed are pressed', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 1 });
    const tech = await seed.user(['Data Technician'], 'v2dash');
    const pod = await seed.pod(`V2 dash ${uid()}`, [tech.userId]);
    const day = (n: number) => dateInZone(FIRM_ZONE, n);
    const inPod = { assignedPodId: pod.podId };
    const tag = uid();
    await seed.task(world, { ...inPod, title: `D over ${tag}`, dueDate: day(-3) });
    await seed.task(world, { ...inPod, title: `D asap ${tag}` });
    await seed.task(world, {
      ...inPod,
      title: `D soon ${tag}`,
      assignedUserId: tech.userId,
      dueDate: day(1),
    });
    await seed.task(world, {
      ...inPod,
      title: `D far ${tag}`,
      assignedUserId: tech.userId,
      dueDate: day(8),
    });
    const hold = await seed.task(world, {
      ...inPod,
      title: `D hold ${tag}`,
      assignedUserId: tech.userId,
      dueDate: day(10),
    });
    expect(
      (await new TaskApi(admin, hold.taskId).changeStatus('ON_HOLD', 'Waiting')).status,
    ).toBeLessThan(300);
    const done = await seed.task(world, {
      ...inPod,
      title: `D done ${tag}`,
      assignedUserId: tech.userId,
    });
    const doneApi = new TaskApi(admin, done.taskId);
    await doneApi.completeSteps(1);
    expect((await doneApi.complete()).status).toBeLessThan(300);

    const summary = await admin.get<Json>(`/api/v1/dashboard?fresh=true&podScope=${pod.podId}`);
    const links: { path: string; count: number; query: string }[] = [];
    const walk = (node: Json, trail: string) => {
      if (Array.isArray(node)) node.forEach((n, i) => walk(n, `${trail}[${i}]`));
      else if (node && typeof node === 'object') {
        if (typeof node.query === 'string' && typeof node.count === 'number')
          links.push({ path: trail, count: node.count, query: node.query });
        for (const [k, v] of Object.entries(node)) walk(v, `${trail}.${k}`);
      }
    };
    walk(summary, 'summary');
    expect(links.length, 'the summary has its drill-through links').toBeGreaterThanOrEqual(10);

    await page.setViewportSize({ width: 1366, height: 768 });
    const pressed: Record<string, ViewKey> = {
      'summary.unassigned': 'unassigned',
      'summary.overdue': 'overdue',
      'summary.onHold': 'onHold',
      'summary.dueSoon': 'dueSoon',
      'summary.asapOpen': 'asap',
      'summary.completed': 'recentlyCompleted',
      'summary.overdueCritical': 'overdue',
      'summary.overdueHigh': 'overdue',
    };
    // Filters on top of the view: the scope's Pod, and the priority of the two overdue breakdown links.
    const extras = (path: string) => (/overdue(Critical|High)$/.test(path) ? 2 : 1);
    for (const link of links) {
      const body = await queueResponse(page, () => page.goto(`/tasks?${link.query}`));
      expect(body.total, `${link.path} (${link.query})`).toBe(link.count);
      await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
      await expect(page.locator('.qv .qv-n:not([data-count-pending])').first()).toBeVisible();
      const onlyHold =
        /(^|&)status=ON_HOLD(&|$)/.test(link.query) &&
        !/status=(NEW|IN_PROGRESS|COMPLETED|CANCELLED)/.test(link.query);
      const key = pressed[link.path] ?? (onlyHold ? 'onHold' : undefined);
      if (key) {
        expect(await isPressed(page, key), `${link.path} presses ${key}`).toBe(true);
        // The pod filter of the scope is the one filter on top of the view.
        await expect(page.locator('[data-filters-toggle]'), link.path).toContainText(
          `(${extras(link.path)})`,
        );
        if (link.path === 'summary.dueSoon') await shot(page, 'dashboard-due-soon-pod-1366x768');
      } else {
        // Open, Created and the breakdowns: a plain filter, never a wrong view.
        expect(
          await page.locator('.qv [aria-pressed="true"]').count(),
          `${link.path} presses no view`,
        ).toBe(0);
      }
    }
  });

  test('the Due soon link of the Dashboard is pressed with no filter count; one more filter shows one, and three days out is no view', async ({
    page,
  }) => {
    const soon = `status=NEW&status=IN_PROGRESS&status=ON_HOLD&asap=false&overdue=false&dueTo=${dateInZone(FIRM_ZONE, 2)}`;
    const queue = new TaskQueuePage(page);
    await queue.open(`?${soon}`);
    await expect(page.locator('.qv .qv-n:not([data-count-pending])').first()).toBeVisible();
    expect(await isPressed(page, 'dueSoon')).toBe(true);
    await expect(page.locator('[data-filters-toggle]')).not.toContainText('(');
    await expect(page.locator('[data-filter-chips] [data-chip]')).toHaveCount(0);
    await shot(page, 'dashboard-due-soon-1366x768');

    await queue.open(`?${soon}&priority=1`);
    await expect(page.locator('.qv .qv-n:not([data-count-pending])').first()).toBeVisible();
    expect(await isPressed(page, 'dueSoon')).toBe(true);
    await expect(page.locator('[data-filters-toggle]')).toContainText('(1)');
    await shot(page, 'dashboard-due-soon-priority-1366x768');

    await queue.open(`?${soon.replace(/dueTo=.*/, `dueTo=${dateInZone(FIRM_ZONE, 3)}`)}`);
    await expect(page.locator('.qv .qv-n:not([data-count-pending])').first()).toBeVisible();
    expect(await page.locator('.qv [aria-pressed="true"]').count()).toBe(0);
    await expect(page.locator('[data-filters-toggle]')).toContainText('(');
  });
});

test.describe('Recently completed window (WP12, #224)', () => {
  test('a task completed 29 days ago is in, one completed 30 days ago is out, and the total is the Dashboard Completed tile', async ({
    page,
    seed,
    admin,
  }) => {
    test.skip(!seedCanWrite(), 'needs the SQL container of run-local.sh');
    const world = await seed.world({ stepCount: 1 });
    const token = uid();
    const ids: Record<string, number> = {};
    for (const [name, days] of [
      ['d29', 29],
      ['d30', 30],
      ['d1', 1],
    ] as const) {
      const task = await seed.task(world, { title: `RC ${name} ${token}` });
      const api = new TaskApi(admin, task.taskId);
      await api.completeSteps(1);
      expect((await api.complete()).status).toBeLessThan(300);
      seed.ageTask(task.taskId, { createdDaysAgo: days + 2, completedDaysAgo: days });
      ids[name] = task.taskId;
    }
    const from = dateInZone(FIRM_ZONE, -29);

    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    await expect(page.locator('.qv .qv-n:not([data-count-pending])').first()).toBeVisible();
    const request = page.waitForRequest(
      (r) => isQueue(r.url()) && r.url().includes('completedFrom='),
    );
    const body = await queueResponse(page, () => chooseView(page, 'recentlyCompleted'));
    // The window starts 29 days back (30 days with today): the Dashboard tile's first day.
    expect(new URL((await request).url()).searchParams.get('completedFrom')).toBe(from);
    await expect(page).toHaveURL(new RegExp(`completedFrom=${from}`));
    expect(body.views['recentlyCompleted']).toBe(body.total);
    const dashboard = await admin.get<Json>('/api/v1/dashboard?fresh=true');
    expect(dashboard.completed.query).toContain(`completedFrom=${from}`);
    expect(await isPressed(page, 'recentlyCompleted')).toBe(true);

    // The boundary tasks, newest closed first, with the Closed column in place of Due.
    const titles = await titlesWith(page, token);
    expect(titles).toEqual([`RC d1 ${token}`, `RC d29 ${token}`]);
    await expect(page.locator('thead th[data-col="closed"]')).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await expect(page.locator('thead th[data-col="due"]')).toHaveCount(0);
    await shot(page, 'recently-completed-window-1366x768');

    // The same list through the API for the other zones: the window follows the viewer's zone.
    for (const zone of ['America/New_York', 'Pacific/Auckland', 'America/Los_Angeles']) {
      const api = await Api.as(undefined, { timeZone: zone });
      try {
        const zoneFrom = dateInZone(zone, -29);
        const res = await api.get<Json>(
          `/api/v1/task-queue?status=COMPLETED&completedFrom=${zoneFrom}&q=${token}&pageSize=50`,
        );
        const names = res.items.map((i: Json) => i.title);
        expect(names, zone).toContain(`RC d29 ${token}`);
        expect(names, zone).not.toContain(`RC d30 ${token}`);
        expect(res.views.recentlyCompleted).toBeGreaterThanOrEqual(res.total);
      } finally {
        await api.dispose();
      }
    }
  });
});

function seedCanWrite(): boolean {
  return !!process.env['E2E_SQL_CONTAINER'] && !!process.env['E2E_SQL_PASSWORD'];
}

test.describe('One vocabulary with My Work (WP12, #222)', () => {
  test("Created by me starts on Open with no status= in the address, the Status chip widens it, and the total is My Work's", async ({
    seed,
    asUser,
    admin,
  }) => {
    const tech = await seed.user(['Data Technician'], 'v2me');
    const mine = await Api.as(tech.username);
    const world = await seed.world({ stepCount: 1 });
    const token = uid();
    try {
      await seed.task(world, { title: `CM one ${token}` }, mine);
      await seed.task(world, { title: `CM two ${token}` }, mine);
      const hold = await seed.task(world, { title: `CM hold ${token}` }, mine);
      expect(
        (await new TaskApi(admin, hold.taskId).changeStatus('ON_HOLD', 'Waiting')).status,
      ).toBeLessThan(300);
      const done = await seed.task(world, { title: `CM done ${token}` }, mine);
      const doneApi = new TaskApi(admin, done.taskId);
      await doneApi.completeSteps(1);
      expect((await doneApi.complete()).status).toBeLessThan(300);
      const cancelled = await seed.task(world, { title: `CM cancelled ${token}` }, mine);
      expect((await new TaskApi(admin, cancelled.taskId).cancel('Not needed')).status).toBeLessThan(
        300,
      );

      const myWork = await mine.get<Json>('/api/v1/my-work?view=createdByMe&pageSize=1');
      expect(myWork.total, 'My Work, Created by me, Open by default').toBe(3);

      const page = await asUser(tech.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      const queue = new TaskQueuePage(page);
      await queue.open();
      await expect(page.locator('.qv .qv-n:not([data-count-pending])').first()).toBeVisible();
      const body = await queueResponse(page, () => chooseView(page, 'createdByMe'));
      expect(body.total).toBe(3);
      expect(body.views['createdByMe']).toBe(3);
      expect(body.total).toBe(myWork.total);
      await expect(page).toHaveURL(new RegExp(`/tasks\\?creator=${tech.userId}$`));
      expect(page.url()).not.toContain('status=');
      expect(await isPressed(page, 'createdByMe')).toBe(true);
      // The Status cell reads Open and nothing counts as an extra filter.
      await expect(page.locator('tr[data-filter-row] [data-filter="status"]')).toContainText(
        'Open',
      );
      await expect(page.locator('[data-filters-toggle]')).not.toContainText('(');
      await shot(page, 'created-by-me-open-1366x768');
      // A reload of the same address is the same view.
      await page.reload();
      await expect(page.locator('tr[data-filter-row] [data-filter="status"]')).toContainText(
        'Open',
      );
      expect(await isPressed(page, 'createdByMe')).toBe(true);

      // Widened to every status: the Status cell says "All", the address gets the one explicit empty status=, and the list is every task
      // this person created.
      await page.locator('tr[data-filter-row] [data-filter="status"]').click();
      const all = await queueResponse(page, () =>
        page
          .getByRole('dialog', { name: 'Filter by Status' })
          .getByRole('button', { name: 'Clear' })
          .click(),
      );
      await page.keyboard.press('Escape');
      expect(all.total).toBe(5);
      expect(page.url()).toMatch(/[?&]status=(&|$)/);
      await expect(page.locator('tr[data-filter-row] [data-filter="status"]')).toContainText('All');
      expect(await isPressed(page, 'createdByMe')).toBe(false);
      await shot(page, 'created-by-me-all-statuses-1366x768');
    } finally {
      await mine.dispose();
    }
  });

  test('the Recently completed tooltip says 30 days and the others name their tasks', async ({
    page,
  }) => {
    const queue = new TaskQueuePage(page);
    await queue.open();
    await expect(page.locator('.qv .qv-n:not([data-count-pending])').first()).toBeVisible();
    const item = await openMore(page, 'recentlyCompleted');
    expect(await item.getAttribute('title')).toContain('30 days');
    expect(await item.getAttribute('title')).toBe(
      'Completed in the last 30 days (cancelled tasks are not included)',
    );
    await page.keyboard.press('Escape');
    for (const key of ['createdByMe', 'allOpen', 'unassigned', 'overdue'] as ViewKey[]) {
      if (await inStrip(page, key)) {
        expect(await stripView(page, key).getAttribute('title'), key).toBeTruthy();
      }
    }
    if (await inStrip(page, 'createdByMe')) {
      await expect(stripView(page, 'createdByMe')).toHaveAttribute(
        'title',
        'Open tasks you created',
      );
    }
  });
});

test.describe('Views by person (WP16, #223)', () => {
  const persona = async (
    seed: import('../support/seed').Seeder,
    kind: 'technician' | 'lead' | 'director' | 'viewonly' | 'observer',
  ) => {
    switch (kind) {
      case 'technician':
      case 'lead': {
        const user = await seed.user(
          [kind === 'lead' ? 'Pod Lead' : 'Data Technician'],
          `v2${kind}`,
        );
        const pod = await seed.pod(`V2 ${kind} ${uid()}`, [user.userId]);
        seed.sql(
          `UPDATE dbo.PodMember SET IsPrimary = 1 WHERE UserId = ${user.userId} AND PodId = ${pod.podId}`,
        );
        return { ...user, myPod: true, created: true };
      }
      case 'director': {
        const user = await seed.user(['Director'], 'v2director');
        return { ...user, myPod: false, created: null as boolean | null };
      }
      case 'observer': {
        const user = await seed.user(['Read-Only Observer'], 'v2observer');
        return { ...user, myPod: false, created: false };
      }
      case 'viewonly': {
        const role = await seed.role(['Task.View'], 'E2E v2 view-only');
        const user = await seed.user([role.name], 'v2viewonly');
        return { ...user, myPod: false, created: false };
      }
    }
  };

  for (const kind of ['technician', 'lead', 'director', 'viewonly', 'observer'] as const) {
    test(`${kind}: no view is disabled, My pod and Created by me show only for those who can use them`, async ({
      seed,
      asUser,
    }) => {
      const person = await persona(seed, kind);
      const api = await Api.as(person.username);
      let canCreate: boolean;
      try {
        const me = await api.get<Json>('/api/v1/me');
        canCreate = (me.permissions as string[]).includes('Task.Create');
      } finally {
        await api.dispose();
      }
      if (person.created !== null) expect(canCreate, `${kind} Task.Create`).toBe(person.created);
      const page = await asUser(person.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      const queue = new TaskQueuePage(page);
      await queue.open();
      await expect(page.locator('.qv .qv-n:not([data-count-pending])').first()).toBeVisible();
      // Nothing on the strip is disabled, and every view of the person is a focusable button.
      expect(await page.locator('.qv button:disabled').count()).toBe(0);
      const shown = async (key: ViewKey) =>
        (await inStrip(page, key)) ||
        (await (async () => {
          await moreButton(page).click();
          const there = (await page.locator(`mf-filter-popover [data-view="${key}"]`).count()) > 0;
          await page.keyboard.press('Escape');
          return there;
        })());
      expect(await shown('myPod'), `${kind} My pod`).toBe(person.myPod);
      expect(await shown('createdByMe'), `${kind} Created by me`).toBe(canCreate);
      await shot(page, `persona-${kind}-1366x768`);
      if (kind === 'viewonly') {
        // A bookmarked creator link still works as a filter.
        await queue.open(`?creator=${person.userId}&status=NEW`);
        await expect(page.locator('[data-filter-chips] [data-chip]')).not.toHaveCount(0);
        expect(await page.locator('.qv [aria-pressed="true"]').count()).toBe(0);
      }
    });
  }

  for (const [w, h] of SIZES) {
    test(`axe: the views with More open have no violations at ${w}x${h}`, async ({
      seed,
      asUser,
    }) => {
      test.skip(!axeAvailable(), 'axe-core not available');
      const person = await persona(seed, 'viewonly');
      const page = await asUser(person.username);
      await page.setViewportSize({ width: w, height: h });
      const queue = new TaskQueuePage(page);
      await queue.open();
      await expect(page.locator('.qv .qv-n:not([data-count-pending])').first()).toBeVisible();
      expect(await axeViolations(page), `default at ${w}`).toEqual([]);
      await moreButton(page).click();
      await expect(page.getByRole('dialog', { name: 'More views' })).toBeVisible();
      expect(await axeViolations(page), `More open at ${w}`).toEqual([]);
      await page.keyboard.press('Escape');
      await chooseView(page, 'dueSoon');
      await expect(page).toHaveURL(/dueTo=/);
      expect(await axeViolations(page), `Due soon at ${w}`).toEqual([]);
      expect(await isPressed(page, 'dueSoon')).toBe(true);
      void VIEW_LABEL;
    });
  }
});
