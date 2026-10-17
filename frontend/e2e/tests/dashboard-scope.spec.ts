import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { Json } from '../support/api';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Dashboard page-wide Scope (UX review 2, P1, #89): one Scope select at the right end of the tab row ("All pods", "My pods", one pod) for every
 * tab, `?pod=` in the address, remembered per user, "My pods" by default for a member of at least one pod and "All pods" for everyone else
 * (membership, not role names). The scope is the task's Pod field, so every scoped number equals the Task Queue count behind its link.
 *
 * The database is shared, so the scenario owns three pods (A, B, C) and the people in them: the lead is in A and B, the peer in A, the
 * technician of B in B, the technician of C in C; the director is in no pod and may see every pod. Screenshots: set E2E_SCREENSHOTS.
 */
const SHOTS = process.env['E2E_SCREENSHOTS'];

const DASH = [
  'Task.View',
  'Task.Assign',
  'Matter.View',
  'Dashboard.View',
  'Dashboard.ViewSummary',
  'Dashboard.ViewBreakdowns',
  'Dashboard.ViewTrends',
  'Dashboard.ViewSwimlane',
  'Dashboard.ViewUsers',
  'Dashboard.ViewCoverage',
];

interface Scenario {
  tag: string;
  podA: Json;
  podB: Json;
  podC: Json;
  lead: { username: string; userId: number };
  director: { username: string; userId: number };
  loner: { username: string; userId: number };
  titles: Record<string, string>;
}

let s: Scenario;

async function build(seed: Seeder): Promise<Scenario> {
  const tag = uid();
  const world = await seed.world();
  const people = await seed.role(['Task.View'], 'E2E scope member');
  const peer = await seed.user([people.name], 'scopepeer');
  const techB = await seed.user([people.name], 'scopetechb');
  const techC = await seed.user([people.name], 'scopetechc');
  // The lead holds the Dashboard without Pod.View: A and B are the only pods they may pick; the director may see every pod.
  const leadRole = await seed.role(DASH, 'E2E scope lead');
  const directorRole = await seed.role([...DASH, 'Pod.View'], 'E2E scope director');
  const lead = await seed.user([leadRole.name], 'scopelead');
  const director = await seed.user([directorRole.name], 'scopedirector');
  const loner = await seed.user([leadRole.name], 'scopeloner');
  const podA = await seed.pod(`Scope A ${tag}`, [lead.userId, peer.userId]);
  const podB = await seed.pod(`Scope B ${tag}`, [lead.userId, techB.userId]);
  const podC = await seed.pod(`Scope C ${tag}`, [techC.userId]);

  const titles = {
    a1: `A unassigned late ${tag}`,
    a2: `A assigned soon ${tag}`,
    b1: `B unassigned ${tag}`,
    b2: `B assigned late ${tag}`,
    c1: `C unassigned late ${tag}`,
    c2: `C assigned ${tag}`,
    n1: `No pod late ${tag}`,
    n2: `No pod asap ${tag}`,
  };
  const late = (n: number) => dateInZone(FIRM_ZONE, -n);
  await seed.task(world, { title: titles.a1, assignedPodId: podA.podId, dueDate: late(5) });
  await seed.task(world, {
    title: titles.a2,
    assignedPodId: podA.podId,
    assignedUserId: peer.userId,
    dueDate: dateInZone(FIRM_ZONE, 1),
  });
  await seed.task(world, {
    title: titles.b1,
    assignedPodId: podB.podId,
    dueDate: dateInZone(FIRM_ZONE, 20),
  });
  await seed.task(world, {
    title: titles.b2,
    assignedPodId: podB.podId,
    assignedUserId: techB.userId,
    dueDate: late(3),
  });
  await seed.task(world, { title: titles.c1, assignedPodId: podC.podId, dueDate: late(4) });
  await seed.task(world, {
    title: titles.c2,
    assignedPodId: podC.podId,
    assignedUserId: techC.userId,
  });
  await seed.task(world, { title: titles.n1, dueDate: late(6) });
  await seed.task(world, { title: titles.n2 });
  return { tag, podA, podB, podC, lead, director, loner, titles };
}

const scopeSelect = (page: Page) => page.getByLabel('Scope', { exact: true });
const tile = (page: Page, label: string) =>
  page.locator('mf-stat-tile', {
    has: page.locator('.label', { hasText: new RegExp(`^${label}$`) }),
  });
const tileValue = async (page: Page, label: string) =>
  Number((await tile(page, label).locator('.value').innerText()).trim());
const shown = async (page: Page) => {
  await expect(page.locator('[data-tabpanel="summary"] mf-stat-tile').first()).toBeVisible();
};

/** The summary of the scope for the signed-in browser user (the page's own request, read through the browser). */
async function summaryOf(page: Page, scope: string): Promise<Json> {
  const r = await page.request.get(`/api/v1/dashboard?fresh=true&podScope=${scope}`);
  expect(r.ok()).toBe(true);
  return r.json();
}

test.describe.configure({ mode: 'serial' });

test.describe('Dashboard Scope', () => {
  test.beforeAll(async ({ seed }) => {
    test.setTimeout(240_000);
    s = await build(seed);
  });

  test('a pod member opens on My pods and a person in no pod on All pods; the tiles equal the Task Queue for the same pods', async ({
    asUser,
  }) => {
    const page = await asUser(s.lead.username);
    await page.goto('/dashboard');
    await shown(page);
    await expect(scopeSelect(page)).toHaveValue('mine');
    await expect(scopeSelect(page).locator('option:checked')).toHaveText('My pods');
    // The default is not written to the address.
    expect(new URL(page.url()).searchParams.has('pod')).toBe(false);
    await expect(
      page.getByRole('tablist').locator('xpath=ancestor::*[@data-dash-head]').getByLabel('Scope'),
    ).toBeVisible();

    // Four open tasks in A and B, two of them unassigned and two overdue: the same numbers as the queue for pod in (A, B).
    expect(await tileValue(page, 'Open')).toBe(4);
    expect(await tileValue(page, 'Unassigned')).toBe(2);
    expect(await tileValue(page, 'Overdue')).toBe(2);
    await tile(page, 'Overdue').getByRole('link').click();
    await expect(page).toHaveURL(/\/tasks\?/);
    const q = new URL(page.url()).searchParams;
    expect(q.getAll('pod').sort()).toEqual([String(s.podA.podId), String(s.podB.podId)].sort());
    expect(q.get('overdue')).toBe('true');
    const queue = await (await page.request.get(`/api/v1/task-queue?pageSize=1&${q}`)).json();
    expect(queue.total).toBe(2);
    await expect(page.getByText(s.titles.a1)).toBeVisible();
    await expect(page.getByText(s.titles.b2)).toBeVisible();
    await expect(page.getByText(s.titles.c1)).toHaveCount(0);

    // Someone in no pod, with every right, starts on All pods and sees at least everything in the three pods.
    const dir = await asUser(s.director.username);
    await dir.goto('/dashboard');
    await shown(dir);
    await expect(scopeSelect(dir)).toHaveValue('all');
    await expect(scopeSelect(dir).locator('option:checked')).toHaveText('All pods');
    expect(await tileValue(dir, 'Open')).toBeGreaterThanOrEqual(8);
  });

  test('the list of the select: All pods, My pods, the own pods first; the other pods only with Pod.View', async ({
    asUser,
  }) => {
    const lead = await asUser(s.lead.username);
    await lead.goto('/dashboard');
    await shown(lead);
    await expect(scopeSelect(lead).locator('option')).toHaveText([
      'All pods',
      'My pods',
      `Scope A ${s.tag}`,
      `Scope B ${s.tag}`,
    ]);
    const dir = await asUser(s.director.username);
    await dir.goto('/dashboard');
    await shown(dir);
    const labels = (await scopeSelect(dir).locator('option').allTextContents()).map((l) =>
      l.trim(),
    );
    expect(labels[0]).toBe('All pods');
    expect(labels).toEqual(
      expect.arrayContaining([`Scope A ${s.tag}`, `Scope B ${s.tag}`, `Scope C ${s.tag}`]),
    );
    expect(labels).not.toContain('My pods');
    // A person in no pod has no "My pods"; the loner has the lead's rights but no pod.
    const alone = await asUser(s.loner.username);
    await alone.goto('/dashboard');
    await shown(alone);
    await expect(scopeSelect(alone)).toHaveValue('all');
    await expect(scopeSelect(alone).locator('option')).toHaveText(['All pods']);
  });

  test('a shared link carries the scope to every tab and survives a reload; a tab change keeps it', async ({
    asUser,
  }) => {
    const page = await asUser(s.director.username);
    const trend = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/dashboard/trend') && r.url().includes(`podScope=${s.podC.podId}`),
    );
    await page.goto(`/dashboard?tab=trends&pod=${s.podC.podId}`);
    expect((await trend).ok()).toBe(true);
    await expect(scopeSelect(page).locator('option:checked')).toHaveText(`Scope C ${s.tag}`);
    await expect(page).toHaveURL(new RegExp(`pod=${s.podC.podId}`));
    await page.reload();
    await expect(scopeSelect(page)).toHaveValue(String(s.podC.podId));

    await page.getByRole('tab', { name: 'Users' }).click();
    await expect(page).toHaveURL(new RegExp(`pod=${s.podC.podId}`));
    await expect(page).toHaveURL(/tab=users/);
    await expect(page.locator('[data-user-card]')).toHaveCount(1);
  });

  test('a pod the person may not see shows the default scope and a note, not an error page', async ({
    asUser,
  }) => {
    const page = await asUser(s.lead.username);
    await page.goto(`/dashboard?tab=trends&pod=${s.podC.podId}`);
    await expect(page.locator('mf-dash-note')).toContainText(
      'That pod is not available to you. Showing My pods.',
    );
    await expect(scopeSelect(page)).toHaveValue('mine');
    await expect(page).not.toHaveURL(/pod=/);
    await expect(page.getByRole('tab', { name: 'Trends', selected: true })).toBeVisible();
    await expect(page.locator('[data-dash-state="error"]')).toHaveCount(0);
    // The server says the same: 403 with the standard problem body.
    const r = await page.request.get(`/api/v1/dashboard?podScope=${s.podC.podId}`);
    expect(r.status()).toBe(403);
    expect((await r.json()).code).toBe('PERMISSION_DENIED');
  });

  test('every tab reads the scope: Summary, Breakdowns, Trends, Swimlane, Users and Coverage show only the pods A and B, and no tab has a Pod control any more', async ({
    asUser,
  }) => {
    const page = await asUser(s.lead.username);
    const podScopeSent = (needle: string) =>
      page.waitForRequest(
        (r) => r.url().includes(needle) && new URL(r.url()).searchParams.get('podScope') === 'mine',
      );

    let sent = podScopeSent('/api/v1/dashboard?');
    await page.goto('/dashboard');
    await sent;
    await shown(page);
    expect(await tileValue(page, 'Open')).toBe(4);

    await page.getByRole('tab', { name: 'Breakdowns' }).click();
    const bars = page.locator('[data-section="breakdowns"]');
    await expect(bars.locator('mf-bar-list').first()).toBeVisible();
    // The age bar adds up to the four open tasks of the two pods.
    const ages = await bars
      .locator('a[aria-label*=" days:"], a[aria-label*="More than"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    expect(ages.length).toBeGreaterThan(0);
    expect(ages.reduce((n, label) => n + Number(/: (\d+) tasks?/.exec(label)?.[1] ?? 0), 0)).toBe(
      4,
    );

    sent = podScopeSent('/api/v1/dashboard/trend');
    await page.getByRole('tab', { name: 'Trends' }).click();
    await sent;
    await expect(page.locator('[data-section="trend"]')).toBeVisible();

    sent = podScopeSent('/api/v1/dashboard/swimlane');
    await page.getByRole('tab', { name: 'Swimlane' }).click();
    await sent;
    // The two unassigned tasks are New, the two assigned ones are In progress.
    await expect(page.locator('[data-lane="NEW"] [data-lane-count]')).toHaveText('2');
    await expect(page.locator('[data-lane="IN_PROGRESS"] [data-lane-count]')).toHaveText('2');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.getByLabel('Pod', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-filter="pod"]')).toHaveCount(0);

    sent = podScopeSent('/api/v1/dashboard/workload');
    await page.getByRole('tab', { name: 'Users' }).click();
    await sent;
    // The lead, the peer and the technician of B: the members of the two pods.
    await expect(page.locator('[data-user-card]')).toHaveCount(3);
    await expect(page.getByLabel('Pod', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-filter="pod"]')).toHaveCount(0);

    sent = podScopeSent('/api/v1/dashboard/coverage');
    await page.getByRole('button', { name: 'Coverage' }).click();
    await sent;
    // By task type is the default orientation; the matrix lists the people of the two pods.
    await expect(page.locator('[data-coverage-types-table]')).toBeVisible();
    await expect(page.locator('[data-coverage-pod]')).toHaveCount(0);
    sent = podScopeSent('/api/v1/dashboard/coverage');
    await page.locator('[data-orientation="matrix"]').click();
    await sent;
    await expect(page.locator('[data-coverage-table]')).toBeVisible();
    await expect(page.locator('thead th[data-person]')).toHaveCount(3);
    await expect(page).toHaveURL(/view=coverage/);
    await expect(page).not.toHaveURL(/pod=/);
  });

  test('choosing a pod narrows every number, announces it, is written to the address and remembered; the default is not written', async ({
    asUser,
  }) => {
    const page = await asUser(s.lead.username);
    await page.goto('/dashboard');
    await shown(page);
    await scopeSelect(page).selectOption({ label: `Scope B ${s.tag}` });
    await expect(page).toHaveURL(new RegExp(`pod=${s.podB.podId}`));
    await expect(page.locator('[data-dash-live]')).toHaveText(`Scope: Scope B ${s.tag}`);
    await expect.poll(() => tileValue(page, 'Open')).toBe(2);
    expect(await tileValue(page, 'Unassigned')).toBe(1);
    expect(await tileValue(page, 'Overdue')).toBe(1);

    // The drill-through of a scoped number: the same pod, the same count.
    await tile(page, 'Unassigned').getByRole('link').click();
    await expect(page).toHaveURL(/\/tasks\?/);
    const q = new URL(page.url()).searchParams;
    expect(q.getAll('pod')).toEqual([String(s.podB.podId)]);
    const queue = await (await page.request.get(`/api/v1/task-queue?pageSize=1&${q}`)).json();
    expect(queue.total).toBe(1);

    // Remembered per user: a plain link opens on the last explicit choice.
    await page.goto('/dashboard');
    await shown(page);
    await expect(scopeSelect(page)).toHaveValue(String(s.podB.podId));
    // The address wins over the memory.
    await page.goto('/dashboard?pod=all');
    await expect(scopeSelect(page)).toHaveValue('all');
    await scopeSelect(page).selectOption('mine');
    await expect(page).not.toHaveURL(/pod=/);
    await page.goto('/dashboard');
    await expect(scopeSelect(page)).toHaveValue('mine');
  });

  test('tasks with no pod only appear under All pods; the Summary says how many unassigned ones there are and links to All pods', async ({
    asUser,
  }) => {
    const page = await asUser(s.lead.username);
    await page.goto('/dashboard');
    await shown(page);
    const hint = page.locator('[data-no-pod-hint]');
    await expect(hint).toBeVisible();
    const sum = await summaryOf(page, 'mine');
    const n = sum.scope.unassignedNoPod as number;
    expect(n).toBeGreaterThanOrEqual(2);
    await expect(hint).toContainText(`${n} unassigned tasks have no pod.`);
    // None of them is in the lists under a pod scope.
    await expect(page.getByText(s.titles.n1)).toHaveCount(0);
    await hint.getByRole('link', { name: 'Show all pods' }).click();
    await expect(page).toHaveURL(/pod=all/);
    await expect(scopeSelect(page)).toHaveValue('all');
    await expect(page.locator('[data-no-pod-hint]')).toHaveCount(0);
    expect(await tileValue(page, 'Open')).toBeGreaterThanOrEqual(6);
  });

  test('the old Users pod link is read once into pod and rewritten', async ({ asUser }) => {
    const page = await asUser(s.director.username);
    await page.goto(`/dashboard?tab=users&upod=${s.podB.podId}`);
    await expect(page.locator('[data-user-card]').first()).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`pod=${s.podB.podId}`));
    await expect(page).not.toHaveURL(/upod=/);
    await expect(scopeSelect(page)).toHaveValue(String(s.podB.podId));
    await expect(page.locator('[data-user-card]')).toHaveCount(2);
  });

  test('the Technician view (Unassigned only) has the control next to the heading and Refresh', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(
      ['Task.View', 'Task.Assign', 'Dashboard.View', 'Dashboard.ViewUnassigned'],
      'E2E scope tech',
    );
    const user = await seed.user([role.name], 'scopetech');
    await seed.pod(`Scope T ${s.tag}`, [user.userId]);
    const page = await asUser(user.username);
    await page.goto('/dashboard');
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(scopeSelect(page)).toHaveValue('mine');
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('axe is clean at 1366, 1920 and 375 with the control in the tab row (open and closed), and no horizontal page scroll', async ({
    asUser,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(240_000);
    const page = await asUser(s.lead.username);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      for (const tab of ['summary', 'breakdowns', 'trends', 'swimlane', 'users']) {
        await page.goto(tab === 'summary' ? '/dashboard' : `/dashboard?tab=${tab}`);
        await expect(scopeSelect(page)).toBeVisible();
        await expect(page.locator('[data-tabpanel]')).toBeVisible();
        await page.waitForTimeout(400);
        expect(await axeViolations(page), `${width} ${tab}`).toEqual([]);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${width} ${tab} horizontal scroll`).toBeLessThanOrEqual(0);
        // The select is at least 24 px high and its label is text.
        const box = (await scopeSelect(page).boundingBox())!;
        expect(box.height, `${width} ${tab} target`).toBeGreaterThanOrEqual(24);
        if (width >= 1366) {
          // In the tab row, left of Refresh.
          const row = (await page.locator('[data-dash-head]').boundingBox())!;
          const refresh = (await page.getByRole('button', { name: 'Refresh' }).boundingBox())!;
          expect(box.y).toBeGreaterThanOrEqual(row.y - 1);
          expect(box.y + box.height).toBeLessThanOrEqual(row.y + row.height + 1);
          expect(box.x + box.width).toBeLessThanOrEqual(refresh.x);
        }
      }
    }
  });

  test('screenshots', async ({ asUser }) => {
    test.skip(!SHOTS, 'set E2E_SCREENSHOTS to the output folder');
    test.setTimeout(300_000);
    fs.mkdirSync(SHOTS!, { recursive: true });
    const lead = await asUser(s.lead.username);
    const dir = await asUser(s.director.username);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [375, 812],
    ]) {
      for (const [who, page] of [
        ['lead', lead],
        ['director', dir],
      ] as const) {
        await page.setViewportSize({ width, height });
        await page.goto('/dashboard');
        await shown(page);
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SHOTS!, `summary-${who}-${width}.png`) });
      }
      await lead.goto(`/dashboard?tab=users&pod=${s.podB.podId}`);
      await expect(lead.locator('[data-user-card]').first()).toBeVisible();
      await lead.waitForTimeout(500);
      await lead.screenshot({ path: path.join(SHOTS!, `users-pod-b-${width}.png`) });
      await lead.goto('/dashboard?tab=swimlane');
      await expect(lead.locator('[data-lane="NEW"]')).toBeVisible();
      await lead.waitForTimeout(500);
      await lead.screenshot({ path: path.join(SHOTS!, `swimlane-${width}.png`) });
      await lead.goto('/dashboard?tab=trends');
      await expect(lead.locator('[data-section="trend"]')).toBeVisible();
      await lead.waitForTimeout(700);
      await lead.screenshot({ path: path.join(SHOTS!, `trends-${width}.png`) });
      // The open select (a native list does not show in a screenshot: focus ring on the closed control instead).
      await lead.goto('/dashboard');
      await shown(lead);
      await scopeSelect(lead).focus();
      await lead.screenshot({ path: path.join(SHOTS!, `scope-focus-${width}.png`) });
    }
    await lead.setViewportSize({ width: 1366, height: 768 });
    await lead.goto(`/dashboard?tab=trends&pod=${s.podC.podId}`);
    await expect(lead.locator('mf-dash-note')).toBeVisible();
    await lead.waitForTimeout(500);
    await lead.screenshot({ path: path.join(SHOTS!, 'forbidden-pod-note-1366.png') });
  });
});
