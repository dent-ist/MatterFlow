import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage, PodWorkPage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * The needs-attention strip of My Work (WP8a, #153) and Pod Work's move to the shared strip (#178). Every test uses its own user and
 * tagged tasks, so nothing depends on global counts. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/my-work-review/fixes/wp8a).
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

test.describe('My Work needs-attention strip', () => {
  test('M1: counts over the whole open set, click applies the filter on Active, toggles, ignores grid filters', async ({
    seed,
    admin,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'strip');
    const world = await seed.world();
    const tag = uid();
    const priorities = await admin.get<{ id: number; label: string }[]>('/api/v1/priorities');
    const high = priorities.find((p) => p.label === 'High')!.id;
    const make = (name: string, offset: number | null, extra: Record<string, unknown> = {}) =>
      seed.task(world, {
        title: `${name} ${tag}`,
        assignedUserId: me.userId,
        ...(offset === null ? {} : { dueDate: dateInZone(FIRM_ZONE, offset) }),
        ...extra,
      });
    await make('Over3', -3, { priorityId: high });
    await make('Over1', -1);
    await make('Today', 0);
    await make('Asap', null);
    const held = await make('Held', 10);
    await new TaskApi(admin, held.taskId).changeStatus('ON_HOLD', 'Waiting for the client');
    await make('Far', 40);

    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open();

    const strip = page.locator('[data-strip]');
    const item = (key: string) => page.locator(`[data-strip-item="${key}"]`);
    const rows = page.locator('[data-task]');
    await expect(strip).toContainText('Overdue 2');
    await expect(strip).toContainText('Due today 1');
    await expect(strip).toContainText('ASAP 1');
    await expect(strip).toContainText('On hold 1');
    await expect(strip).toHaveAttribute(
      'title',
      'All your open tasks, not affected by the filters below',
    );
    // The strip sits between the title and the tabs.
    const boxes = await Promise.all([
      page.getByRole('heading', { name: 'My Work', level: 1 }).boundingBox(),
      strip.boundingBox(),
      page.getByRole('tablist', { name: 'My Work views' }).boundingBox(),
    ]);
    expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y);
    expect(boxes[1]!.y).toBeLessThan(boxes[2]!.y);
    await shot(page, 'strip-1366x768');

    // A click applies the filter on Active; the grid total equals the number on the item.
    await myWork.tab(/^Closed/).click();
    await item('overdue').click();
    await expect(myWork.tab(/^Active/)).toHaveAttribute('aria-selected', 'true');
    await expect(rows).toHaveCount(2);
    await expect(item('overdue')).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/overdue=true/);

    // Another item replaces it.
    await item('dueToday').click();
    await expect(rows).toHaveCount(1);
    await expect(page).not.toHaveURL(/overdue=true/);
    await item('asap').click();
    await expect(rows).toHaveCount(1);
    await item('onHold').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Held');
    await expect(page).not.toHaveURL(/asap=true/);

    // The second click switches it off.
    await item('onHold').click();
    await expect(item('onHold')).toHaveAttribute('aria-pressed', 'false');
    await expect(rows).toHaveCount(6);

    // A grid filter narrows the grid but not the strip.
    await myWork.open(`?priority=${high}`);
    await expect(rows).toHaveCount(1);
    await expect(strip).toContainText('Overdue 2');
    await item('overdue').click();
    await expect(rows).toHaveCount(1);
    await expect(strip).toContainText('Overdue 2');
    await expect(strip).toContainText('On hold 1');
  });

  test('M1: zero items stay muted but present; sizes, axe, no horizontal scroll, 44 px targets on a phone', async ({
    seed,
    asUser,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    const me = await seed.user(['Data Technician'], 'strip-sizes');
    const world = await seed.world();
    await seed.task(world, {
      title: `Size ${uid()}`,
      assignedUserId: me.userId,
      dueDate: dateInZone(FIRM_ZONE, -2),
    });
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await myWork.open();
      const strip = page.locator('[data-strip]');
      await expect(strip).toContainText('Overdue 1');
      await expect(page.locator('[data-strip-item="onHold"]')).toContainText('On hold 0');
      await expect(page.locator('[data-loading]')).toHaveCount(0);
      expect(await axeViolations(page), `axe at ${w}`).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
        `no horizontal page scroll at ${w}`,
      ).toBe(false);
      const items = await page.locator('[data-strip-item]').evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { top: Math.round(r.top), w: r.width, h: r.height };
        }),
      );
      if (w >= 640) expect(new Set(items.map((i) => i.top)).size, `one line at ${w}`).toBe(1);
      if (w === 375) {
        expect(new Set(items.map((i) => i.top)).size, '2x2 at 375').toBe(2);
        for (const i of items) expect(i.h).toBeGreaterThanOrEqual(44);
      }
      await shot(page, `strip-${w}x${h}`);
    }
  });

  test('X2: Pod Work renders its summary with the same strip', async ({ seed, asUser }) => {
    const me = await seed.user(['Data Technician'], 'strip-pod');
    const pod = await seed.pod(`Strip ${uid()}`, [me.userId]);
    const world = await seed.world();
    await seed.task(world, { title: `Queue ${uid()}`, assignedPodId: pod.podId });
    await seed.task(world, {
      title: `Late ${uid()}`,
      assignedPodId: pod.podId,
      assignedUserId: me.userId,
      dueDate: dateInZone(FIRM_ZONE, -2),
    });
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const podWork = new PodWorkPage(page);
    await podWork.open();
    await podWork.choosePod(pod.name);
    const strip = page.locator('[data-strip]');
    await expect(strip).toContainText('Unassigned 1');
    await expect(strip).toContainText('Assigned 1');
    await expect(strip).toContainText('Overdue 1');
    await expect(strip).toContainText('On Hold 0');
    await expect(strip.locator('button')).toHaveCount(0);
    await shot(page, 'pod-work-strip-1366x768');
    await page.setViewportSize({ width: 375, height: 812 });
    await shot(page, 'pod-work-strip-375x812');
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
  });
});
