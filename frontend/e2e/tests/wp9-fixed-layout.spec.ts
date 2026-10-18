import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage, PodWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Fixed layout (TQ-WP9, #200, BUG-TQ1 and TQ13): the grid is a fixed-layout table with a <colgroup>, so the width of a column never depends
 * on the rows on the page. Twelve URLs of the Task Queue (different sort, filters, pages, a 170-character title, a 90-character token, an
 * On Hold row) give identical column widths at 1366 and 1920. Every test seeds its own tagged tasks and filters on the tag, so nothing
 * depends on global counts or order. Screenshots go to E2E_SCREENSHOTS when set (docs/ux/task-queue-review/fixes/wp-layout).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

interface Measure {
  /** Header cell widths by column key. */
  widths: Record<string, number>;
  /** Body row heights with the height of their title link. */
  rows: { height: number; link: number; held: boolean }[];
  /** Body cells whose content is wider than the cell (cut off by the fixed column): must be none. */
  clipped: string[];
  scroll: number;
  client: number;
}

function measure(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    const widths: Record<string, number> = {};
    document
      .querySelectorAll<HTMLElement>('thead tr:first-child th')
      .forEach((th) => (widths[th.dataset['col'] ?? 'actions'] = th.getBoundingClientRect().width));
    const rows = Array.from(document.querySelectorAll<HTMLElement>('tbody tr[data-task]'))
      .filter((r) => !r.hidden)
      .map((r) => ({
        height: r.getBoundingClientRect().height,
        link: r.querySelector('a.wt-title')?.getBoundingClientRect().height ?? 0,
        held: !!r.querySelector('[data-hold-reason]'),
      }));
    const clipped = Array.from(document.querySelectorAll<HTMLElement>('tbody tr[data-task] td'))
      .filter(
        (td) =>
          !['priority', 'status', 'assignee'].includes(td.dataset['col'] ?? '') &&
          td.scrollWidth > td.clientWidth + 1,
      )
      .map((td) => `${td.dataset['col']} ${td.scrollWidth}>${td.clientWidth}`)
      // The value of an inline menu (badge and label) is cut off inside its own trigger.
      .concat(
        Array.from(
          document.querySelectorAll<HTMLElement>(
            'tbody td[data-col="priority"] .im-value, tbody td[data-col="status"] .im-value',
          ),
        )
          .filter((v) => v.scrollWidth > v.clientWidth + 1)
          .map((v) => `menu value ${v.textContent?.trim()} ${v.scrollWidth}>${v.clientWidth}`),
      );
    const w = document.querySelector('.wt-wrap') as HTMLElement;
    return { widths, rows, clipped, scroll: w.scrollWidth, client: w.clientWidth };
  });
}

test.describe('Fixed layout (#200)', () => {
  test('BUG-TQ1: Title, Due and every other column keep their width across twelve views; rows are 44 px', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(240_000);
    const world = await seed.world();
    const tag = uid();
    const me = await seed.user(['Data Technician'], 'wp9-layout');
    const make = (title: string, extra: Record<string, unknown> = {}) =>
      seed.task(world, { title, assignedUserId: me.userId, ...extra });
    for (let i = 0; i < 27; i++) {
      await make(
        `Short ${i} ${tag}`,
        i % 3 === 0 ? { dueDate: dateInZone(FIRM_ZONE, -9 + i) } : {},
      );
    }
    const priorities = await admin.get<{ id: number; label: string }[]>('/api/v1/priorities');
    for (const p of priorities) await make(`Prio ${p.label} ${tag}`, { priorityId: p.id });
    const long = await make(`${'Long title words '.repeat(10).slice(0, 170)} ${tag}`.slice(0, 170));
    const token = await make(`T${tag}${'x'.repeat(80)}`);
    const held = await make(`Held ${tag}`, { dueDate: dateInZone(FIRM_ZONE, 30) });
    await new TaskApi(admin, held.taskId).changeStatus('ON_HOLD', 'Waiting for the custodian');

    const page = await asUser('ke\\kekim');
    const base = `q=${encodeURIComponent(tag)}`;
    const urls = [
      `/tasks?${base}`,
      `/tasks?${base}&sort=due&dir=asc`,
      `/tasks?${base}&sort=due&dir=desc`,
      `/tasks?${base}&sort=title&dir=asc`,
      `/tasks?${base}&pageSize=25&page=2`,
      `/tasks?${base}&sort=due&dir=asc&pageSize=25&page=2`,
      `/tasks?${base}&overdue=true`,
      `/tasks?${base}&asap=true`,
      `/tasks?q=${long.taskNumber}`,
      `/tasks?q=${token.taskNumber}`,
      `/tasks?${base}&status=ON_HOLD`,
      '/tasks',
    ];
    const queue = new TaskQueuePage(page);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      let reference: Measure | null = null;
      for (const url of urls) {
        await page.goto(url);
        await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
        await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
        const m = await measure(page);
        reference ??= m;
        // An On Hold row carries its reason under the Status pill (WP10) and is 47 px until #210 fixes the row height for every cell.
        const tall = m.rows.filter((r) => !r.held && r.link <= 24 && Math.round(r.height) !== 44);
        expect(tall, `one-line rows are 44 px at ${width} for ${url}`).toEqual([]);
        for (const [key, w] of Object.entries(m.widths)) {
          expect(
            Math.abs(w - reference.widths[key]),
            `${key} at ${width} for ${url}: ${w} vs ${reference.widths[key]}`,
          ).toBeLessThanOrEqual(1);
        }
        // A one-line title is a 44 px row; a two-line title may be taller (PM ruling, #196); nothing is shorter.
        for (const r of m.rows) {
          if (r.link <= 24 && !r.held)
            expect(Math.round(r.height), `one-line row at ${width} for ${url}`).toBe(44);
          else expect(r.height).toBeLessThanOrEqual(64);
        }
        expect(m.clipped, `nothing is cut off at ${width} for ${url}`).toEqual([]);
        expect(m.scroll, `no sideways scroll at ${width} for ${url}`).toBeLessThanOrEqual(m.client);
      }
      // The two most-quoted numbers of the review: Due is 136 px (not 403 at 1920) and the Title takes the rest.
      await page.goto(urls[0]);
      await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
      const m = await measure(page);
      expect(Math.round(m.widths['due'])).toBe(136);
      expect(Math.round(m.widths['ref'])).toBe(112);
      expect(Math.round(m.widths['matter'])).toBe(160);
      expect(Math.round(m.widths['priority'])).toBe(112);
      expect(m.widths['title']).toBeGreaterThan(160);
      await shot(page, `task-queue-default-${width}x${height}`);
      await axeClean(page, `Task Queue ${width}`);
      await queue.open('?q=' + long.taskNumber);
      await shot(page, `task-queue-long-title-${width}x${height}`);
    }

    // The pause marker and a four-digit number fit in the 112 px Ref column.
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/tasks?${base}&status=ON_HOLD`);
    const cell = page.locator('tbody tr[data-task] td[data-col="ref"]').first();
    await expect(cell.locator('[data-hold-mark]')).toBeVisible();
    expect(await cell.evaluate((n) => n.scrollWidth <= n.clientWidth + 1), 'Ref fits').toBe(true);
    await shot(page, 'task-queue-hold-row-ref-1366x768');
  });

  test('a 170-character title and a 90-character token change no width; tablets and phones keep working', async ({
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const me = await seed.user(['Data Technician'], 'wp9-long');
    const tag = uid();
    const short = await seed.task(world, { title: `Short ${tag}`, assignedUserId: me.userId });
    await seed.task(world, {
      title: `${'Long title words '.repeat(10).slice(0, 170)} ${tag}`.slice(0, 170),
      assignedUserId: me.userId,
    });
    await seed.task(world, { title: `T${tag}${'x'.repeat(89)}`, assignedUserId: me.userId });
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [768, 1024],
      [375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      await myWork.open();
      await expect(page.locator('tr[data-task]')).toHaveCount(3);
      const all = await measure(page);
      await myWork.open(`?q=${encodeURIComponent(`Short ${tag}`)}`);
      await expect(page.locator('tr[data-task]')).toHaveCount(1);
      await expect(page.locator(`tr[data-task="${short.taskNumber}"]`)).toBeVisible();
      const one = await measure(page);
      for (const [key, w] of Object.entries(all.widths))
        expect(Math.abs(w - one.widths[key]), `${key} at ${width}`).toBeLessThanOrEqual(1);
      if (width >= 768) {
        expect(all.scroll, `no sideways scroll at ${width}`).toBeLessThanOrEqual(all.client);
      }
      await shot(page, `layout-my-work-${width}x${height}`);
      await axeClean(page, `My Work ${width}`);
    }
  });

  test('the skeleton rows use the table columns: nothing moves when the rows arrive', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'wp9-skel');
    const world = await seed.world();
    await seed.task(world, { title: `Skeleton ${uid()}`, assignedUserId: me.userId });
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/v1/my-work?**', async (route) => {
      await gate;
      await route.continue().catch(() => undefined);
    });
    await page.goto('/my-work');
    await expect(page.locator('tbody tr[data-skeleton]').first()).toBeVisible();
    const during = await page.evaluate(() => {
      const out: Record<string, number> = {};
      document
        .querySelectorAll<HTMLElement>('tbody tr[data-skeleton] td')
        .forEach(
          (td) => (out[td.dataset['col'] ?? 'actions'] ??= td.getBoundingClientRect().width),
        );
      return out;
    });
    const head = await measure(page);
    for (const [key, w] of Object.entries(during))
      expect(
        Math.abs(w - head.widths[key]),
        `skeleton ${key} equals the header`,
      ).toBeLessThanOrEqual(1);
    release();
    await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
    const after = await measure(page);
    for (const [key, w] of Object.entries(head.widths))
      expect(
        Math.abs(w - after.widths[key]),
        `${key} before and after the rows`,
      ).toBeLessThanOrEqual(1);
  });
  test('Pod Work: "Unassigned" and "Assign to me" fit the Assignee column and no width depends on the rows', async ({
    seed,
    asUser,
  }) => {
    const token = uid();
    const lead = await seed.user(['Pod Lead'], `wp9-pod-${token}`);
    const pod = await seed.pod(undefined, [lead.userId]);
    const world = await seed.world();
    const open = await seed.task(world, { title: `Open ${token}`, assignedPodId: pod.podId });
    await seed.task(world, {
      title: `Taken ${token}`,
      assignedPodId: pod.podId,
      assignedUserId: lead.userId,
    });
    const page = await asUser(lead.username);
    const podWork = new PodWorkPage(page);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      await podWork.open();
      await podWork.choosePod(pod.name);
      await podWork.search(`Open ${token}`);
      const row = podWork.row(open.taskNumber);
      await expect(row).toBeVisible();
      const link = podWork.assignToMe(open.taskNumber);
      await expect(link).toBeVisible();
      const cell = (await row.locator('td[data-col="assignee"]').boundingBox())!;
      const box = (await link.boundingBox())!;
      expect(
        box.x + box.width,
        `the link ends inside the Assignee cell at ${width}`,
      ).toBeLessThanOrEqual(cell.x + cell.width);
      const m = await measure(page);
      expect(m.scroll).toBeLessThanOrEqual(m.client);
      expect(m.rows.map((r) => Math.round(r.height))).toEqual([44]);
      await shot(page, `pod-work-assign-link-${width}x${height}`);
      await axeClean(page, `Pod Work ${width}`);
    }
  });
});
