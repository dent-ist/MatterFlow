import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { MyWorkPage, PodWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * WP10: the hold reason in the row (#165, #182) and one colour language (#162): the stripe means overdue, On Hold is grey with a pause icon,
 * New is a neutral outlined pill so blue means ASAP only. Every test uses its own user and tagged tasks, so nothing depends on global counts.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/my-work-review/fixes/wp10).
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

const REASON = 'Waiting for the custodian';

const row = (page: Page, title: string): Locator =>
  page.locator('tbody tr', { has: page.getByRole('link', { name: title, exact: true }) });

const css = (loc: Locator, prop: string) =>
  loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test.describe('WP10 hold reason and colours', () => {
  test('#165 #182: an On Hold row says why, with a pause marker and a grey pill; resumed it all goes', async ({
    seed,
    admin,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'hold');
    const world = await seed.world();
    const tag = uid();
    const title = (n: string) => `${n} ${tag}`;
    const make = (name: string, extra: Record<string, unknown> = {}) =>
      seed.task(world, {
        title: title(name),
        assignedUserId: me.userId,
        dueDate: dateInZone(FIRM_ZONE, 20),
        ...extra,
      });
    const held = await make('Held');
    await new TaskApi(admin, held.taskId).changeStatus('ON_HOLD', REASON);
    const longOne = await make('Long');
    await new TaskApi(admin, longOne.taskId).changeStatus('ON_HOLD', 'y'.repeat(500));
    const resumed = await make('Resumed');
    const resumedApi = new TaskApi(admin, resumed.taskId);
    await resumedApi.changeStatus('ON_HOLD', 'Will resume');
    await resumedApi.changeStatus('IN_PROGRESS');
    await make('Fresh', { dueDate: undefined });

    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await myWork.open();
      await expect(row(page, title('Held'))).toBeVisible();

      const heldRow = row(page, title('Held'));
      const mark = heldRow.locator('[data-hold-mark]');
      await expect(mark).toHaveAttribute('aria-label', 'On hold');
      await expect(heldRow.locator('[data-hold-reason]')).toHaveText(REASON);
      await expect(heldRow.locator('[data-col="status"] > div')).toHaveAttribute('title', REASON);
      // The pill is the grey one and the title is not dimmed.
      const pill = heldRow.locator('[data-status="ON_HOLD"]');
      expect(await css(pill, 'background-color')).toBe('rgb(169, 176, 187)');
      expect(await css(heldRow.locator('.wt-title'), 'opacity')).toBe('1');
      await expect(pill.locator('.pi-pause-circle')).toHaveCount(1);

      const longRow = row(page, title('Long'));
      await expect(longRow.locator('[data-col="status"] > div')).toHaveAttribute(
        'title',
        'y'.repeat(200) + '...',
      );

      // Resumed and never held: no line, no marker.
      for (const n of ['Resumed', 'Fresh']) {
        await expect(
          row(page, title(n)).locator('[data-hold-reason], [data-hold-mark]'),
        ).toHaveCount(0);
      }
      // Phones: the reason moves under the title ("Waiting: ...").
      const hint = heldRow.locator('[data-hold-hint]');
      if (w <= 480) {
        await expect(hint).toBeVisible();
        await expect(hint).toContainText(`Waiting: ${REASON}`);
      } else {
        await expect(hint).toBeHidden();
        await expect(heldRow.locator('[data-hold-reason]')).toBeVisible();
      }
      await shot(page, `hold-my-work-${w}x${h}`);
      if (axeAvailable()) {
        expect(await axeViolations(page), `axe at ${w}`).toEqual([]);
      }
    }

    // Resuming a held task removes everything on the next load.
    await new TaskApi(admin, held.taskId).changeStatus('IN_PROGRESS');
    await page.setViewportSize({ width: 1366, height: 768 });
    await myWork.open();
    await expect(row(page, title('Held'))).toBeVisible();
    await expect(
      row(page, title('Held')).locator('[data-hold-reason], [data-hold-mark]'),
    ).toHaveCount(0);
  });

  test('#165: the Task Queue and Pod Work rows show the reason too', async ({
    seed,
    admin,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'holdlists');
    const world = await seed.world();
    const pod = await seed.pod(`Hold pod ${uid()}`, [me.userId]);
    const tag = uid();
    const task = await seed.task(world, {
      title: `Pod held ${tag}`,
      assignedPodId: pod.podId,
      dueDate: dateInZone(FIRM_ZONE, 20),
    });
    await new TaskApi(admin, task.taskId).changeStatus('ON_HOLD', REASON);

    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open(`?q=${tag}&status=ON_HOLD`);
    const queueRow = row(page, `Pod held ${tag}`);
    await expect(queueRow.locator('[data-hold-reason]')).toHaveText(REASON);
    await shot(page, 'hold-task-queue-1366x768');

    // A task nobody has started is New: a neutral outlined pill with a dot (blue means ASAP only).
    await seed.task(world, { title: `Brand new ${tag}`, assignedPodId: pod.podId });
    await queue.open(`?q=${tag}`);
    const fresh = row(page, `Brand new ${tag}`).locator('[data-status="NEW"]');
    await expect(fresh.locator('.pi-circle-fill')).toHaveCount(1);
    expect(await css(fresh, 'background-color')).toBe('rgb(255, 255, 255)');
    expect(await css(fresh, 'color')).toBe('rgb(55, 65, 81)');
    await shot(page, 'new-pill-task-queue-1366x768');

    const podWork = new PodWorkPage(page);
    await podWork.open();
    await podWork.choosePod(pod.name);
    await expect(row(page, `Pod held ${tag}`).locator('[data-hold-reason]')).toHaveText(REASON);
    await shot(page, 'hold-pod-work-1366x768');
  });

  test('#162: the stripe means overdue on My Work and on the Swimlane card, whatever the priority', async ({
    seed,
    asUser,
    admin,
    page: boardPage,
  }) => {
    const me = await seed.user(['Data Technician'], 'stripe');
    const world = await seed.world();
    const tag = uid();
    const priorities = await admin.get<{ id: number; label: string }[]>('/api/v1/priorities');
    const high = priorities.find((p) => p.label === 'High')!.id;
    await seed.task(world, {
      title: `HighOver ${tag}`,
      assignedUserId: me.userId,
      priorityId: high,
      dueDate: dateInZone(FIRM_ZONE, -3),
    });
    await seed.task(world, {
      title: `HighCalm ${tag}`,
      assignedUserId: me.userId,
      priorityId: high,
      dueDate: dateInZone(FIRM_ZONE, 30),
    });

    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open();
    const over = row(page, `HighOver ${tag}`);
    await expect(over).toBeVisible();
    await expect(over).toHaveClass(/wt-row--overdue/);
    await expect(row(page, `HighCalm ${tag}`)).not.toHaveClass(/wt-row--overdue/);
    // The priority is still said by its badge (text and glyph).
    await expect(over.locator('[data-priority]')).toContainText('High');
    await shot(page, 'stripe-my-work-1366x768');

    const board = boardPage;
    await board.setViewportSize({ width: 1366, height: 768 });
    for (const density of ['comfortable', 'compact']) {
      await board.goto(`/dashboard?tab=swimlane&q=${tag}&group=none`);
      await expect(board.locator('mf-swimlane-card').first()).toBeVisible();
      if (density === 'compact') {
        await board.getByRole('button', { name: 'More options' }).click();
        await board.getByRole('menuitemradio', { name: 'Compact' }).click();
      }
      const card = board.locator('mf-swimlane-card', { hasText: `HighOver ${tag}` });
      const calm = board.locator('mf-swimlane-card', { hasText: `HighCalm ${tag}` });
      await expect(card.locator('article > .bar')).toHaveClass(/bar--overdue/);
      expect(await css(card.locator('article > .bar'), 'background-color')).toBe(
        'rgb(180, 35, 24)',
      );
      await expect(calm.locator('article > .bar')).not.toHaveClass(/bar--overdue/);
      await expect(card).toContainText('Overdue');
      if (density === 'compact') {
        await expect(card.locator('[data-level-glyph] .lvl-bar')).not.toHaveCount(0);
      } else {
        await expect(card.locator('[data-priority]')).toContainText('High');
      }
      await shot(board, `stripe-swimlane-${density}-1366x768`);
      if (axeAvailable()) expect(await axeViolations(board), `swimlane ${density}`).toEqual([]);
    }
  });

  test('#162: the Dashboard tabs that show statuses and the Swimlane keep their colours readable (screenshots, axe)', async ({
    seed,
    admin,
    page,
  }) => {
    const world = await seed.world();
    const tag = uid();
    const held = await seed.task(world, {
      title: `DashHold ${tag}`,
      dueDate: dateInZone(FIRM_ZONE, 5),
    });
    await new TaskApi(admin, held.taskId).changeStatus('ON_HOLD', REASON);
    await seed.task(world, { title: `DashNew ${tag}`, dueDate: dateInZone(FIRM_ZONE, 5) });

    await page.setViewportSize({ width: 1366, height: 768 });
    for (const tab of ['summary', 'breakdowns', 'swimlane', 'users']) {
      await page.goto(`/dashboard?tab=${tab}${tab === 'swimlane' ? `&q=${tag}&group=none` : ''}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await shot(page, `dashboard-${tab}-1366x768`);
      if (axeAvailable()) expect(await axeViolations(page), `dashboard ${tab}`).toEqual([]);
    }
  });
});
