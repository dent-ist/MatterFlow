import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { Json } from '../support/api';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Dashboard Summary: change since before on four tiles (UX review 2, S3, #102) and the Technician's Summary (S9, #108).
 *
 * The database is shared by every spec, so each scenario owns a pod and reads its numbers through `?pod=`: a tile is then worked out from the
 * tasks seeded here (backdated with one UPDATE in the SQL container of run-local.sh, so the deltas need it) and from nothing else.
 * With E2E_SCREENSHOTS set to a folder the run also writes the screenshots of docs/ux/dashboard-review-2/fixes/wp6.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shoot(page: Page, name: string, fullPage = false) {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
}

const tile = (page: Page, label: string) =>
  page
    .locator('.summary-tiles mf-stat-tile')
    .filter({ has: page.locator('.label-text', { hasText: new RegExp(`^${label}$`) }) });

const deltaWords = (page: Page, label: string) => tile(page, label).locator('.delta-text');

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function axeAt(
  page: Page,
  sizes: [number, number][],
  url: string,
  ready: string,
  shot: string,
) {
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.goto(url);
    await expect(page.locator(ready).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await axeViolations(page), `axe at ${width}`).toEqual([]);
    await noHorizontalScroll(page);
    await shoot(page, `${shot}-${width}`, width < 600);
  }
}

test.describe('Summary deltas (S3)', () => {
  test.skip(
    !Seeder.canWriteLegacyText(),
    'needs the SQL container of run-local.sh to backdate tasks',
  );
  test.describe.configure({ timeout: 180_000 });

  let pod: Json;
  let busyPod: Json;

  test.beforeAll(async ({ seed }) => {
    const tag = uid();
    const world = await seed.world();
    pod = await seed.pod(`Delta pod ${tag}`, []);
    busyPod = await seed.pod(`Delta busy ${tag}`, []);
    const inPod = (title: string, overrides: Json = {}, podId = pod.podId) =>
      seed.task(world, { title: `${title} ${tag}`, assignedPodId: podId, ...overrides });

    // Pod 1. Created in the last 30 days: C, D, E (3); in the 30 days before: A, B (2); F is older than both periods, so the comparison is real.
    // Completed in the last 30 days: C (1); in the 30 days before: A and B (2). Open now: D, E, F (3); at the end of yesterday: D, F (2). Overdue: D now and yesterday.
    seed.ageTask((await inPod('A')).taskId, { createdDaysAgo: 45, completedDaysAgo: 40 });
    seed.ageTask((await inPod('B')).taskId, { createdDaysAgo: 45, completedDaysAgo: 35 });
    seed.ageTask((await inPod('C')).taskId, { createdDaysAgo: 20, completedDaysAgo: 10 });
    seed.ageTask((await inPod('D', { dueDate: dateInZone(FIRM_ZONE, -5) })).taskId, {
      createdDaysAgo: 20,
    });
    await inPod('E');
    seed.ageTask((await inPod('F')).taskId, { createdDaysAgo: 100 });

    // Pod 2: two tasks that became overdue after yesterday ended (created now, due days ago): Overdue and Open went up by two.
    seed.ageTask((await inPod('H', {}, busyPod.podId)).taskId, { createdDaysAgo: 30 });
    await inPod('G1', { dueDate: dateInZone(FIRM_ZONE, -3) }, busyPod.podId);
    await inPod('G2', { dueDate: dateInZone(FIRM_ZONE, -3) }, busyPod.podId);
  });

  test('the four tiles read their change with a glyph, a signed number and words; Unassigned, On hold, Due soon and ASAP have none', async ({
    page,
  }) => {
    await page.goto(`/dashboard?pod=${pod.podId}`);
    await expect(tile(page, 'Overdue')).toBeVisible();
    await expect(tile(page, 'Overdue').locator('.value')).toHaveText('1');
    await expect(deltaWords(page, 'Overdue')).toHaveText('no change vs yesterday');
    await expect(tile(page, 'Open').locator('.value')).toHaveText('3');
    await expect(deltaWords(page, 'Open')).toHaveText('+1 vs yesterday');
    await expect(tile(page, 'Created').locator('.value')).toHaveText('3');
    await expect(deltaWords(page, 'Created')).toHaveText('+1 vs previous 30 days');
    await expect(tile(page, 'Completed').locator('.value')).toHaveText('1');
    await expect(deltaWords(page, 'Completed')).toHaveText('-1 vs previous 30 days');
    for (const label of ['Unassigned', 'On hold', 'Due soon', 'ASAP open']) {
      await expect(tile(page, label), label).toBeVisible();
      await expect(tile(page, label).locator('[data-delta]'), label).toHaveCount(0);
    }
    // The glyph repeats the direction; the screen-reader sentence is part of the tile's link name.
    await expect(tile(page, 'Open').locator('.delta-glyph')).toHaveText('▲');
    await expect(tile(page, 'Completed').locator('.delta-glyph')).toHaveText('▼');
    await expect(tile(page, 'Overdue').locator('.delta-glyph')).toHaveText('=');
    await expect(tile(page, 'Completed').getByRole('link')).toHaveAccessibleName(
      /1 fewer than in the previous 30 days/,
    );
    await expect(tile(page, 'Open').getByRole('link')).toHaveAccessibleName(
      /1 more than yesterday/,
    );
    // The tooltip says what yesterday was and repeats the Trends caveat.
    await expect(tile(page, 'Open').getByRole('link')).toHaveAttribute(
      'title',
      /At the end of yesterday: 2\..*Trends tab/,
    );
    await expect(tile(page, 'Completed').getByRole('link')).toHaveAttribute(
      'title',
      /^Completed \(cancelled not counted\)\. Compared with .+: 2 completed\.$/,
    );
    await shoot(page, 'deltas-neutral-1366');
  });

  test('only Overdue going up is coloured; everything else is neutral', async ({ page }) => {
    await page.goto(`/dashboard?pod=${busyPod.podId}`);
    await expect(deltaWords(page, 'Overdue')).toHaveText('+2 vs yesterday');
    await expect(deltaWords(page, 'Open')).toHaveText('+2 vs yesterday');
    const colour = (label: string) =>
      tile(page, label)
        .locator('[data-delta]')
        .evaluate((el) => getComputedStyle(el).color);
    const attention = await colour('Overdue');
    const neutral = await colour('Open');
    expect(attention).not.toBe(neutral);
    await expect(tile(page, 'Overdue').locator('[data-delta]')).toHaveAttribute(
      'data-attention',
      '',
    );
    await expect(tile(page, 'Open').locator('[data-delta]')).not.toHaveAttribute(
      'data-attention',
      '',
    );
    await shoot(page, 'deltas-attention-1366');
  });

  test('the numbers are the API numbers: tile minus delta is the Trends point of yesterday, for the same pod', async ({
    page,
  }) => {
    for (const p of [pod, busyPod]) {
      const summary = await (
        await page.request.get(`/api/v1/dashboard?podScope=${p.podId}&fresh=true`, {
          headers: { 'X-Time-Zone': FIRM_ZONE },
        })
      ).json();
      const trend = await (
        await page.request.get(`/api/v1/dashboard/trend?period=7d&podScope=${p.podId}&fresh=true`, {
          headers: { 'X-Time-Zone': FIRM_ZONE },
        })
      ).json();
      const yesterday = trend.all[trend.all.length - 2];
      expect(yesterday.date).toBe(dateInZone(FIRM_ZONE, -1));
      expect(summary.overdueYesterday).toBe(yesterday.overdue);
      expect(summary.openYesterday).toBe(yesterday.open);
      expect(summary.overdue.count).toBe(trend.all[trend.all.length - 1].overdue);
      expect(summary.open.count).toBe(trend.all[trend.all.length - 1].open);
    }
  });

  test('a pod that is younger than the comparison shows no line, never NaN or +0', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const fresh = await seed.pod(`Delta fresh ${uid()}`, []);
    await seed.task(world, { title: `New ${uid()}`, assignedPodId: fresh.podId });
    await page.goto(`/dashboard?pod=${fresh.podId}`);
    await expect(tile(page, 'Open').locator('.value')).toHaveText('1');
    await expect(page.locator('[data-delta]')).toHaveCount(0);
    await expect(page.locator('.summary-tiles')).not.toContainText(/NaN|\+0/);
  });

  test('This month compares with the same days of last month', async ({ page }) => {
    await page.goto(`/dashboard?pod=${pod.podId}&period=this-month`);
    // F is older than last month, so both lines are shown; the numbers depend on the day of the month, the words do not.
    await expect(deltaWords(page, 'Created')).toContainText('vs same days last month');
    await expect(deltaWords(page, 'Completed')).toContainText('vs same days last month');
    await expect(tile(page, 'Created').locator('[data-delta] .sr-only')).toContainText(
      'in the same days last month',
    );
    // Open and Overdue are still compared with yesterday.
    await expect(deltaWords(page, 'Open')).toContainText('vs yesterday');
  });

  test('axe is clean at 1366, 1920 and 375, the line fits the tile at 375 and 320, and the page does not scroll sideways', async ({
    page,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    await axeAt(
      page,
      [
        [1366, 768],
        [1920, 1080],
        [375, 812],
      ],
      `/dashboard?pod=${busyPod.podId}`,
      '.summary-tiles [data-delta]',
      'deltas-axe',
    );
    // 375 and 320: the line wraps inside its tile, nothing is cut.
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`/dashboard?pod=${pod.podId}`);
      await expect(page.locator('.summary-tiles [data-delta]').first()).toBeVisible();
      const cut = await page.evaluate(() =>
        Array.from(document.querySelectorAll('mf-stat-tile [data-delta]'))
          .filter((n) => {
            const tileBox = n.closest('mf-stat-tile')!.getBoundingClientRect();
            const r = n.getBoundingClientRect();
            return r.right > tileBox.right + 0.5 || n.scrollWidth > n.clientWidth + 1;
          })
          .map((n) => n.textContent?.trim()),
      );
      expect(cut, `cut at ${width}`).toEqual([]);
      await noHorizontalScroll(page);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/dashboard?pod=${pod.podId}`);
    await expect(page.locator('.summary-tiles [data-delta]').first()).toBeVisible();
    await shoot(page, 'deltas-375', true);
  });
});

const TECH_RIGHTS = ['Task.View', 'Task.Assign', 'Dashboard.View', 'Dashboard.ViewUnassigned'];

test.describe('Technician Summary (S9)', () => {
  test.describe.configure({ timeout: 240_000 });

  interface Scenario {
    tag: string;
    tech: { username: string; userId: number };
    mine: Json;
    other: Json;
    empty: Json;
    critical: number;
    normal: number;
    typeX: Json;
    typeY: Json;
    titles: Record<string, string>;
  }
  let s: Scenario;

  test.beforeAll(async ({ seed, admin }) => {
    const tag = uid();
    const world = await seed.world();
    const typeY = await seed.taskType({ name: `Redaction ${tag}`, workflows: [world.workflow] });
    const role = await seed.role(TECH_RIGHTS, 'E2E technician');
    const tech = await seed.user([role.name], 'dashtechy');
    const mine = await seed.pod(`Tech pod ${tag}`, [tech.userId]);
    const other = await seed.pod(`Other pod ${tag}`, []);
    const empty = await seed.pod(`Quiet pod ${tag}`, [tech.userId]);
    const priorities = await admin.get<Json>('/api/v1/priorities');
    const list = (Array.isArray(priorities) ? priorities : priorities['items']) as {
      id: number;
      label: string;
    }[];
    const id = (label: string) => list.find((p) => p.label === label)!.id;
    const titles = {
      critX: `Critical Collection ${tag}`,
      critY: `Critical Redaction ${tag}`,
      normX: `Normal Collection ${tag}`,
      normY: `Normal Redaction ${tag}`,
      elsewhere: `Elsewhere ${tag}`,
      mine1: `Mine one ${tag}`,
      mine2: `Mine overdue ${tag}`,
    };
    const inMine = { assignedPodId: mine.podId };
    await seed.task(world, { title: titles.critX, priorityId: id('Critical'), ...inMine });
    await seed.task(world, {
      title: titles.critY,
      priorityId: id('Critical'),
      taskTypeId: typeY.id,
      ...inMine,
    });
    await seed.task(world, { title: titles.normX, priorityId: id('Normal'), ...inMine });
    await seed.task(world, {
      title: titles.normY,
      priorityId: id('Normal'),
      taskTypeId: typeY.id,
      ...inMine,
    });
    await seed.task(world, { title: titles.elsewhere, assignedPodId: other.podId });
    // Their own work: two open, one of them overdue.
    await seed.task(world, { title: titles.mine1, assignedUserId: tech.userId });
    await seed.task(world, {
      title: titles.mine2,
      assignedUserId: tech.userId,
      dueDate: dateInZone(FIRM_ZONE, -4),
    });
    s = {
      tag,
      tech,
      mine,
      other,
      empty,
      critical: id('Critical'),
      normal: id('Normal'),
      typeX: world.taskType,
      typeY,
      titles,
    };
  });

  const queue = (page: Page) => page.locator('[data-panel="unassigned"]');
  const rowsOf = async (page: Page) =>
    (await queue(page).locator('li .title').allTextContents()).map((t) => t.trim());

  /** Task Queue total for a filter, the way the Task Queue counts it. */
  async function queueTotal(page: Page, extra: string) {
    const r = await page.request.get(
      `/api/v1/task-queue?status=NEW&status=IN_PROGRESS&status=ON_HOLD&unassigned=true&pod=${s.mine.podId}${extra}&pageSize=1`,
    );
    return (await r.json()).total as number;
  }

  async function pick(page: Page, label: string, option: string) {
    await page.getByRole('button', { name: new RegExp(`^Filter by ${label}`) }).click();
    await page.getByRole('checkbox', { name: option }).check();
    await page.getByRole('button', { name: 'Done' }).click();
  }

  test('the page is titled Unassigned work, has no tab row, a pod member opens on My pods, and the own-work line links to My Work', async ({
    asUser,
  }) => {
    const page = await asUser(s.tech.username);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: 'Unassigned work' })).toBeVisible();
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.locator('select[data-scope]')).toHaveValue('mine');
    await expect(page.locator('[data-own-work]')).toContainText('You have 2 open, 1 overdue.');
    await expect(page.getByRole('link', { name: 'Open My Work' })).toHaveAttribute(
      'href',
      '/my-work',
    );
    // Limited to the pod: the other pod's task is not in the queue.
    await expect(queue(page).locator('li').first()).toBeVisible();
    const titles = await rowsOf(page);
    expect(titles).toEqual(
      expect.arrayContaining([s.titles.critX, s.titles.critY, s.titles.normX, s.titles.normY]),
    );
    expect(titles).not.toContain(s.titles.elsewhere);
    // No department counts: no tiles, no period control.
    await expect(page.locator('mf-stat-tile, select[data-period], [data-group]')).toHaveCount(0);
    await shoot(page, 'technician-1366');
  });

  test('Priority and Task type filter the queue on the server: the count and the list equal the Task Queue, and the address keeps them', async ({
    asUser,
  }) => {
    const page = await asUser(s.tech.username);
    await page.goto('/dashboard');
    await expect(queue(page).locator('li').first()).toBeVisible();
    await pick(page, 'Priority', 'Critical');
    await expect(page).toHaveURL(new RegExp(`sprio=${s.critical}`));
    await expect
      .poll(async () => (await rowsOf(page)).sort())
      .toEqual([s.titles.critX, s.titles.critY].sort());
    await expect(queue(page).locator('[data-total]')).toHaveText(
      String(await queueTotal(page, `&priority=${s.critical}`)),
    );
    await pick(page, 'Task type', s.typeY.name);
    await expect(page).toHaveURL(new RegExp(`stype=${s.typeY.id}`));
    await expect.poll(() => rowsOf(page)).toEqual([s.titles.critY]);
    await expect(queue(page).locator('[data-total]')).toHaveText(
      String(await queueTotal(page, `&priority=${s.critical}&type=${s.typeY.id}`)),
    );
    // "View all" opens the Task Queue with the same filters.
    await expect(queue(page).locator('[data-view-all]')).toHaveAttribute(
      'href',
      new RegExp(`priority=${s.critical}.*type=${s.typeY.id}`),
    );
    await shoot(page, 'technician-filtered-1366');
    // A reload (a pasted link) shows the same.
    await page.reload();
    await expect.poll(() => rowsOf(page)).toEqual([s.titles.critY]);
    await expect(page.getByRole('button', { name: /^Filter by Priority, Critical/ })).toBeVisible();
  });

  test('a filter that hides everything says so and clears; a scope that has nothing says so and widens', async ({
    asUser,
  }) => {
    const page = await asUser(s.tech.username);
    await page.goto(`/dashboard?sprio=${s.critical}&stype=${s.typeX.id}&pod=${s.mine.podId}`);
    // Critical and Collection: one task. Make it empty with a priority nobody has.
    await expect(queue(page).locator('li')).toHaveCount(1);
    await page.goto(`/dashboard?sprio=999999&pod=${s.mine.podId}`);
    await expect(queue(page).locator('[data-dash-state]')).toContainText(
      'No unassigned tasks match these filters.',
    );
    await queue(page).getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/sprio/);
    await expect(queue(page).locator('li').first()).toBeVisible();

    await page.goto(`/dashboard?pod=${s.empty.podId}`);
    await expect(queue(page).locator('[data-dash-state]')).toContainText(
      /Nothing is unassigned in Quiet pod/,
    );
    await queue(page).getByRole('button', { name: 'Show all pods' }).click();
    await expect(page.locator('select[data-scope]')).toHaveValue('all');
    await expect(queue(page).locator('li').first()).toBeVisible();
  });

  test('Assign to me still removes the row, drops the count and announces it', async ({
    asUser,
  }) => {
    const page = await asUser(s.tech.username);
    await page.goto('/dashboard');
    await expect(queue(page).locator('li').first()).toBeVisible();
    const total = Number(await queue(page).locator('[data-total]').textContent());
    const first = queue(page).locator('li').first();
    const number = (await first.getAttribute('data-task'))!;
    await first.getByRole('button', { name: `Assign to me, ${number}` }).click();
    await expect(queue(page).locator(`li[data-task="${number}"]`)).toHaveCount(0);
    await expect(queue(page).locator('[data-total]')).toHaveText(String(total - 1));
    await expect(page.locator('[data-dash-live]')).toContainText(`${number} assigned to`);
    // Their own count follows once the page reads again.
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.locator('[data-own-work]')).toContainText('You have 3 open');
  });

  test('a person in no pod gets All pods and a quiet note; the Director keeps the whole Summary without the strip', async ({
    seed,
    asUser,
    page: director,
  }) => {
    const loner = await seed.user([(await seed.role(TECH_RIGHTS, 'E2E loner')).name], 'dashloner');
    const page = await asUser(loner.username);
    await page.goto('/dashboard');
    await expect(page.locator('select[data-scope]')).toHaveValue('all');
    await expect(page.locator('[data-no-pod-note]')).toHaveText(
      'You are not in a pod yet. Showing all pods.',
    );
    await director.goto('/dashboard');
    await expect(director.locator('[data-group="attention"]')).toBeVisible();
    await expect(director.locator('[data-tech-bar], [data-own-work]')).toHaveCount(0);
    await expect(director.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });

  test('axe is clean at 1366, 1920 and 375; the filters wrap at 375 and 320 with no sideways scroll', async ({
    asUser,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    const page = await asUser(s.tech.username);
    await axeAt(
      page,
      [
        [1366, 768],
        [1920, 1080],
        [375, 812],
      ],
      `/dashboard?sprio=${s.critical}`,
      '[data-tech-bar] [data-field]',
      'technician-axe',
    );
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto('/dashboard');
      await expect(page.locator('[data-tech-bar] [data-field]').first()).toBeVisible();
      await expect(queue(page).locator('li').first()).toBeVisible();
      await noHorizontalScroll(page);
      const small = await page.evaluate(
        () =>
          Array.from(document.querySelectorAll('[data-tech-bar] button, [data-tech-bar] a'))
            .map((n) => n.getBoundingClientRect())
            .filter((r) => r.width > 0 && (r.height < 23.5 || r.right > window.innerWidth + 0.5))
            .length,
      );
      expect(small, `targets at ${width}`).toBe(0);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/dashboard');
    await expect(queue(page).locator('li').first()).toBeVisible();
    await shoot(page, 'technician-375', true);
  });
});
