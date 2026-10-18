import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { MyWorkPage, PodWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Drag resize of a column (TQ-WP20, #204). A handle sits on the border of each resizable header cell (the right edge of the columns before
 * the Title, the left edge of the columns after it, so the border follows the pointer); `dragGrow` drags it so the column gets wider by
 * the given amount. Every test seeds its own tagged tasks and filters on the tag; widths are read from the header and body cells, never
 * from global counts. Screenshots go to E2E_SCREENSHOTS when set (docs/ux/task-queue-review/fixes/wp-resize).
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

const handle = (page: Page, key: string): Locator =>
  page.locator(`thead .wt-resize[data-resize="${key}"]`);
const th = (page: Page, key: string): Locator =>
  page.locator(`thead tr:first-child th[data-col="${key}"]`);
const width = async (page: Page, key: string): Promise<number> =>
  (await th(page, key).boundingBox())!.width;
const WIDTHS_KEY = /^mf\.work-widths\.v1\./;

/** Reads every stored width entry of the page (scope -> map). */
const stored = (page: Page): Promise<Record<string, Record<string, number>>> =>
  page.evaluate(() => {
    const out: Record<string, Record<string, number>> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith('mf.work-widths.v1.')) out[k] = JSON.parse(localStorage.getItem(k)!).w;
    }
    return out;
  });

/** Presses on a handle, moves the pointer so the column grows by `amount` px (negative: shrinks), optionally keeps the button down. */
async function dragGrow(page: Page, key: string, amount: number, release = true): Promise<void> {
  const h = handle(page, key);
  const side = await h.getAttribute('data-side');
  const box = (await h.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (side === 'end' ? amount : -amount), y, { steps: 8 });
  if (release) await page.mouse.up();
}

/** Every body cell and the filter cell of a column have the header cell's left edge and width (the colgroup is shared). */
async function expectColumnAligned(page: Page, key: string): Promise<void> {
  const head = (await th(page, key).boundingBox())!;
  const cells = await page
    .locator(`tbody td[data-col="${key}"], tr[data-filter-row] td[data-col="${key}"]`)
    .evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, w: r.width };
      }),
    );
  expect(cells.length).toBeGreaterThan(0);
  for (const c of cells) {
    expect(Math.abs(c.x - head.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(c.w - head.width)).toBeLessThanOrEqual(1);
  }
}

async function overflowOfFilterControls(page: Page): Promise<number> {
  return page.evaluate(() => {
    let over = 0;
    document.querySelectorAll<HTMLElement>('tr[data-filter-row] td').forEach((td) => {
      const box = td.getBoundingClientRect();
      td.querySelectorAll<HTMLElement>('input, button, select').forEach((c) => {
        const r = c.getBoundingClientRect();
        if (r.width > 0 && (r.left < box.left - 1 || r.right > box.right + 1)) over++;
      });
    });
    return over;
  });
}

test.describe('Drag resize (#204)', () => {
  test('Task Queue: dragging the Due border changes its width by the distance, every row follows, the Title gives way, it persists and Reset restores', async ({
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const me = await seed.user(['Data Technician'], 'wp20-tq');
    const tag = uid();
    for (let i = 0; i < 4; i++)
      await seed.task(world, { title: `Resize ${i} ${tag}`, assignedUserId: me.userId });
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open(`?q=${encodeURIComponent(tag)}`);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(4);

    const due0 = await width(page, 'due');
    const title0 = await width(page, 'title');
    const scroll0 = await page.locator('.wt-wrap').evaluate((e) => e.scrollTop);
    expect(Math.round(due0)).toBe(136);
    await shot(page, 'task-queue-handles-1366x768');

    // Live: the width follows while the button is still down.
    await dragGrow(page, 'due', 44, false);
    await expect
      .poll(async () => Math.abs((await width(page, 'due')) - (due0 + 44)))
      .toBeLessThanOrEqual(1);
    expect(await stored(page)).toEqual({}); // nothing is stored per frame
    await shot(page, 'task-queue-dragging-1366x768');
    await page.mouse.up();

    expect(Math.abs((await width(page, 'due')) - (due0 + 44))).toBeLessThanOrEqual(1);
    expect(Math.abs((await width(page, 'title')) - (title0 - 44))).toBeLessThanOrEqual(1);
    await expectColumnAligned(page, 'due');
    await expectColumnAligned(page, 'title');
    await expectColumnAligned(page, 'status');
    expect(await overflowOfFilterControls(page), 'filter controls stay in their cells').toBe(0);
    expect(await page.locator('.wt-wrap').evaluate((e) => e.scrollTop)).toBe(scroll0);
    const entries = Object.values(await stored(page));
    expect(entries).toHaveLength(1);
    expect(entries[0]['due']).toBe(180);
    await shot(page, 'task-queue-due-180-1366x768');

    // Reload: still 180. The sort in the URL was never touched.
    await page.reload();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(4);
    expect(Math.abs((await width(page, 'due')) - 180)).toBeLessThanOrEqual(1);
    expect(page.url()).not.toContain('sort=');

    // Reset (the store's resetWidths removes the scope's key): the default returns.
    await page.evaluate((re) => {
      for (const k of Object.keys(localStorage))
        if (new RegExp(re).test(k)) localStorage.removeItem(k);
    }, WIDTHS_KEY.source);
    await page.reload();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(4);
    expect(Math.round(await width(page, 'due'))).toBe(136);
  });

  test('clamps at the column minimum and maximum; the Title is never stored; Ref grows from its right edge', async ({
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const tag = uid();
    await seed.task(world, { title: `Clamp ${tag}` });
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await new TaskQueuePage(page).open(`?q=${encodeURIComponent(tag)}`);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(1);
    expect(await handle(page, 'title').count()).toBe(0);

    await dragGrow(page, 'due', 400);
    expect(Math.round(await width(page, 'due'))).toBe(200); // maximum
    await dragGrow(page, 'due', -400);
    expect(Math.round(await width(page, 'due'))).toBe(120); // minimum (Due 120 px)
    await dragGrow(page, 'ref', -300);
    expect(Math.round(await width(page, 'ref'))).toBe(80);
    const all = Object.values(await stored(page))[0];
    expect(all['due']).toBe(120);
    expect(all['ref']).toBe(80);
    expect(Object.keys(all)).not.toContain('title');
    await expectColumnAligned(page, 'ref');
  });

  test('Escape during a drag restores the width and stores nothing; a click on a header still sorts; a drag does not', async ({
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const tag = uid();
    await seed.task(world, { title: `Esc ${tag}` });
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskQueuePage(page).open(`?q=${encodeURIComponent(tag)}`);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(1);
    const before = await width(page, 'status');

    await dragGrow(page, 'status', 40, false);
    await expect
      .poll(async () => Math.abs((await width(page, 'status')) - (before + 40)))
      .toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    expect(Math.abs((await width(page, 'status')) - before)).toBeLessThanOrEqual(1);
    await page.mouse.up();
    expect(Math.abs((await width(page, 'status')) - before)).toBeLessThanOrEqual(1);
    expect(await stored(page)).toEqual({});
    expect(await page.evaluate(() => document.body.classList.contains('wt-resizing'))).toBe(false);

    // A drag that starts on a border and ends on a sort button does not sort.
    await dragGrow(page, 'priority', 20);
    await expect(th(page, 'due')).toHaveAttribute('aria-sort', 'none');
    expect(page.url()).not.toContain('sort=');
    // A click on the header button sorts, as before.
    await th(page, 'due').getByRole('button').click();
    await expect(th(page, 'due')).toHaveAttribute('aria-sort', /ascending|descending/);
    // The handle is out of the tab order and out of the accessibility tree.
    await page.locator('thead').getByRole('button').first().focus();
    const focusedHandles: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      focusedHandles.push(
        await page.evaluate(() =>
          document.activeElement?.classList.contains('wt-resize') ? 'handle' : '',
        ),
      );
    }
    expect(focusedHandles.filter(Boolean)).toEqual([]);
    for (const h of await page.locator('thead .wt-resize').all()) {
      await expect(h).toHaveAttribute('aria-hidden', 'true');
      await expect(h).not.toHaveAttribute('tabindex', /.*/);
    }
    expect(await page.locator('tbody .wt-resize').count()).toBe(0);
  });

  test('My Work and Pod Work: the drag works, persists per tab and does not change another screen', async ({
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const tag = uid();
    const lead = await seed.user(['Pod Lead', 'Data Technician'], `wp20-${tag}`);
    const pod = await seed.pod(undefined, [lead.userId]);
    await seed.task(world, { title: `Mine ${tag}`, assignedUserId: lead.userId });
    await seed.task(world, { title: `Pod ${tag}`, assignedPodId: pod.podId });
    const page = await asUser(lead.username);
    await page.setViewportSize({ width: 1366, height: 768 });

    const myWork = new MyWorkPage(page);
    await myWork.open(`?q=${encodeURIComponent(`Mine ${tag}`)}`);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(1);
    const due0 = await width(page, 'due');
    await dragGrow(page, 'due', 30);
    expect(Math.abs((await width(page, 'due')) - (due0 + 30))).toBeLessThanOrEqual(1);
    await expectColumnAligned(page, 'due');
    await shot(page, 'my-work-resized-1366x768');
    await page.reload();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(1);
    expect(Math.abs((await width(page, 'due')) - (due0 + 30))).toBeLessThanOrEqual(1);

    const podWork = new PodWorkPage(page);
    await podWork.open();
    await podWork.choosePod(pod.name);
    await podWork.search(`Pod ${tag}`);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(1);
    expect(Math.round(await width(page, 'due'))).toBe(136); // Pod Work has its own scope
    const assignee0 = await width(page, 'assignee');
    await dragGrow(page, 'assignee', -24);
    expect(Math.abs((await width(page, 'assignee')) - (assignee0 - 24))).toBeLessThanOrEqual(1);
    await expectColumnAligned(page, 'assignee');
    await shot(page, 'pod-work-resized-1366x768');
    await page.reload();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(1);
    expect(Math.abs((await width(page, 'assignee')) - (assignee0 - 24))).toBeLessThanOrEqual(1);
    const scopes = Object.keys(await stored(page));
    expect(scopes.some((k) => k.includes('myWork.active'))).toBe(true);
    expect(scopes.some((k) => k.includes('podWork'))).toBe(true);

    // The Task Queue is a third scope: untouched.
    await new TaskQueuePage(page).open(`?q=${encodeURIComponent(tag)}`);
    await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
    expect(Math.round(await width(page, 'due'))).toBe(136);
  });

  test('a long page (cloned to 200 rows) uses the guide line and applies the width on release; frame times are recorded', async ({
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const tag = uid();
    await seed.task(world, { title: `Perf ${tag}` });
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskQueuePage(page).open(`?q=${encodeURIComponent(tag)}`);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(1);
    const rows = async (n: number) =>
      page.evaluate((count) => {
        const body = document.querySelector('tbody')!;
        const first = body.querySelector('tr[data-task]')!;
        while (body.querySelectorAll('tr[data-task]').length < count)
          body.append(first.cloneNode(true));
        // Settle the layout of the clones, so the drag measures its own relayout and not theirs.
        return new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        );
      }, n);

    // 60 rows: live relayout while dragging.
    await rows(60);
    const due0 = await width(page, 'due');
    await dragGrow(page, 'due', 20, false);
    // Live (the usual case) or, when this machine's first frame took over 24 ms, the guide line: both are the PM rule.
    await expect
      .poll(async () => {
        const w = await width(page, 'due');
        const guide = await page.locator('.wt-resize-guide').count();
        return Math.abs(w - (due0 + 20)) <= 1
          ? 'live'
          : guide > 0 && Math.abs(w - due0) <= 1
            ? 'guide'
            : 'neither';
      })
      .not.toBe('neither');
    await page.mouse.up();
    expect(Math.abs((await width(page, 'due')) - (due0 + 20))).toBeLessThanOrEqual(1);
    const live = await page.locator('table.wt').evaluate((t) => ({
      mode: (t as HTMLElement).dataset['resizeMode'],
      ms: (t as HTMLElement).dataset['resizeFrameMs'],
    }));
    console.log(`WP20 60 rows: ${live.mode}, slowest relayout ${live.ms} ms`);

    // 200 rows: a guide line and a tip follow the pointer; the table changes on release.
    await rows(200);
    const due1 = await width(page, 'due');
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[] };
      w.__frames = [];
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        w.__frames.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.waitForTimeout(600);
    const idle = await page.evaluate(() =>
      (window as unknown as { __frames: number[] }).__frames.slice(2),
    );
    console.log(
      `WP20 idle 200 rows: ${idle.length} frames, worst ${Math.max(...idle).toFixed(1)} ms`,
    );
    await page.evaluate(() => ((window as unknown as { __frames: number[] }).__frames.length = 0));
    await dragGrow(page, 'due', 30, false);
    expect(Math.abs((await width(page, 'due')) - due1)).toBeLessThanOrEqual(1);
    await expect(page.locator('.wt-resize-guide')).toBeVisible();
    await expect(page.locator('.wt-resize-tip')).toContainText('Due');
    const duringDrag = await page.evaluate(() =>
      (window as unknown as { __frames: number[] }).__frames.slice(2),
    );
    await shot(page, 'guide-line-200-rows-1366x768');
    await page.mouse.up();
    expect(Math.abs((await width(page, 'due')) - (due1 + 30))).toBeLessThanOrEqual(1);
    await expect(page.locator('.wt-resize-guide')).toHaveCount(0);
    const frames = await page.evaluate(
      () => (window as unknown as { __frames: number[] }).__frames,
    );
    const drag = Math.max(...duringDrag);
    const all = Math.max(...frames);
    test.info().annotations.push({
      type: 'frame-times',
      description: `200 rows, guide line: worst frame while dragging ${drag.toFixed(1)} ms, worst including the release ${all.toFixed(1)} ms`,
    });
    console.log(
      `WP20 200-row drag: ${duringDrag.length} frames while dragging, worst ${drag.toFixed(1)} ms; worst including the release ${all.toFixed(1)} ms`,
    );
  });

  test('touch: a finger on the handle resizes at 768; below 640 px there are no handles; axe at four sizes', async ({
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const tag = uid();
    await seed.task(world, { title: `Four sizes ${tag}` });
    const page = await asUser('ke\\kekim');
    const queue = new TaskQueuePage(page);
    for (const [w, h] of [
      [1366, 768],
      [1920, 1080],
      [768, 1024],
      [375, 812],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await queue.open(`?q=${encodeURIComponent(tag)}`);
      await expect(page.locator('tbody tr[data-task]')).toHaveCount(1);
      const visible = await page
        .locator('thead .wt-resize')
        .evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).length);
      if (w < 640) expect(visible, `no handles at ${w}`).toBe(0);
      else expect(visible, `handles at ${w}`).toBeGreaterThan(0);
      await axeClean(page, `Task Queue with handles at ${w}`);
      await shot(page, `resize-handles-${w}x${h}`);
    }

    await page.setViewportSize({ width: 768, height: 1024 });
    await queue.open(`?q=${encodeURIComponent(tag)}`);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(1);
    expect(await handle(page, 'matter').evaluate((e) => getComputedStyle(e).touchAction)).toBe(
      'none',
    );
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await page.reload();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(1);
    const before = await width(page, 'matter');
    const box = (await handle(page, 'matter').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 6; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x - 5 * i, y }],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => Math.round((await width(page, 'matter')) - before)).toBe(30);
  });
});
