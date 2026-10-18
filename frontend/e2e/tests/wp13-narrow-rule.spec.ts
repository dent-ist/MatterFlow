import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage, PodWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Narrow rule, chevrons and stored widths (TQ-WP13 and WP17, #201, #202, #203). One rule drops columns by priority while the Title would be
 * narrower than 200 px; Ref is sticky while the grid scrolls; the Priority and Status triggers sit inside their cells; widths come from
 * `mf.work-widths.v1.<scope>.<userId>`. Every test seeds its own user and tagged tasks and reads only its own rows. Screenshots go to
 * E2E_SCREENSHOTS when set (docs/ux/task-queue-review/fixes/wp-narrow).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const NEVER_DROPPED = ['ref', 'title', 'matter', 'priority', 'assignee', 'due', 'status', 'closed'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

interface Grid {
  scroll: number;
  client: number;
  keys: string[];
  title: number;
  hint: boolean;
  refPosition: string;
}

function grid(page: Page): Promise<Grid> {
  return page.evaluate(() => {
    const wrap = document.querySelector('.wt-wrap') as HTMLElement;
    const ths = Array.from(document.querySelectorAll<HTMLElement>('thead tr:first-child th'));
    const hint = document.querySelector('[data-scroll-hint]') as HTMLElement;
    return {
      scroll: wrap.scrollWidth,
      client: wrap.clientWidth,
      keys: ths.map((t) => t.dataset['col'] ?? ''),
      title: ths.find((t) => t.dataset['col'] === 'title')!.getBoundingClientRect().width,
      hint: getComputedStyle(hint).display !== 'none',
      refPosition: getComputedStyle(ths[0]).position,
    };
  });
}

async function worker(seed: Seeder, label: string) {
  const me = await seed.user(['Data Technician'], label);
  const world = await seed.world();
  const tag = uid();
  const titles: string[] = [];
  for (let i = 0; i < 4; i++) {
    const title = `Narrow ${i} ${tag}`;
    titles.push(title);
    await seed.task(world, {
      title,
      assignedUserId: me.userId,
      ...(i % 2 === 0 ? { dueDate: dateInZone(FIRM_ZONE, -3 + i) } : {}),
    });
  }
  return { me, tag, titles, world };
}

test.describe('Narrow rule (#201)', () => {
  test('640 to 1023 px: the default sets of My Work, Task Queue and Pod Work fit, or only the never-dropped columns are left, the hint shows and Ref is sticky', async ({
    seed,
    asUser,
  }) => {
    test.setTimeout(240_000);
    const { me, tag, titles } = await worker(seed, 'narrow');
    const lead = await seed.user(['Pod Lead'], `narrow-lead-${tag}`);
    const pod = await seed.pod(undefined, [lead.userId]);
    const world = await seed.world();
    await seed.task(world, { title: `Pod narrow ${tag}`, assignedPodId: pod.podId });

    const mine = await asUser(me.username);
    const podPage = await asUser(lead.username);
    const cases: { name: string; page: Page; open: (p: Page) => Promise<void> }[] = [
      { name: 'My Work', page: mine, open: (p) => new MyWorkPage(p).open() },
      {
        name: 'Task Queue',
        page: mine,
        open: (p) => new TaskQueuePage(p).open(`?q=${encodeURIComponent(tag)}`),
      },
      {
        name: 'Pod Work',
        page: podPage,
        open: async (p) => {
          const pw = new PodWorkPage(p);
          await pw.open();
          await pw.choosePod(pod.name);
        },
      },
    ];
    for (const c of cases) {
      for (const [width, height] of [
        [640, 900],
        [700, 900],
        [768, 1024],
        [900, 800],
        [1023, 768],
      ]) {
        await c.page.setViewportSize({ width, height });
        await c.open(c.page);
        await expect(c.page.locator('[data-task]').first()).toBeVisible();
        const g = await grid(c.page);
        const what = `${c.name} at ${width}`;
        // Ref is the first column and Title is never folded under anything.
        expect(g.keys[0], what).toBe('ref');
        await expect(c.page.locator('[data-sub-task], .wt-subline')).toHaveCount(0);
        if (g.scroll > g.client + 1) {
          // The rule dropped everything it may: only the never-dropped columns are left. The hint says so and Ref stays in view.
          for (const k of g.keys)
            expect(NEVER_DROPPED, `${what}: ${k} should have dropped`).toContain(k);
          expect(g.hint, `${what}: hint`).toBe(true);
          expect(g.refPosition, what).toBe('sticky');
          await c.page.evaluate(() => {
            const w = document.querySelector('.wt-wrap') as HTMLElement;
            w.scrollLeft = w.scrollWidth;
          });
          const ref = (await c.page
            .locator('thead tr:first-child th[data-col="ref"]')
            .boundingBox())!;
          const box = (await c.page.locator('.wt-wrap').boundingBox())!;
          expect(
            Math.abs(ref.x - box.x),
            `${what}: Ref stays at the left edge`,
          ).toBeLessThanOrEqual(1);
        } else {
          expect(g.hint, `${what}: no hint`).toBe(false);
          expect(g.title, `${what}: Title`).toBeGreaterThanOrEqual(160);
          const status = (await c.page
            .locator('[data-task]')
            .first()
            .locator('td[data-col="status"]')
            .boundingBox())!;
          const box = (await c.page.locator('.wt-wrap').boundingBox())!;
          expect(status.x + status.width, `${what}: Status in view`).toBeLessThanOrEqual(
            box.x + box.width + 1,
          );
        }
        if (width === 768) {
          await shot(c.page, `${c.name.toLowerCase().replace(' ', '-')}-768x1024`);
          if (c.name === 'Task Queue') await axeClean(c.page, 'Task Queue 768');
        }
      }
    }
    expect(titles.length).toBe(4);
  });

  test('a 1098 px box fits the default Task Queue set without sideways scroll and the Title has at least 300 px; 1366, 1920 and 375 are clean', async ({
    seed,
    asUser,
  }) => {
    const { me, tag } = await worker(seed, 'box1098');
    const page = await asUser(me.username);
    const queue = new TaskQueuePage(page);
    const q = `?q=${encodeURIComponent(tag)}`;
    await page.setViewportSize({ width: 1366, height: 768 });
    await queue.open(q);
    await expect(page.locator('[data-task]').first()).toBeVisible();
    const g1366 = await grid(page);
    const gutter = 1366 - g1366.client;
    await page.setViewportSize({ width: 1098 + gutter, height: 768 });
    await queue.open(q);
    await expect(page.locator('[data-task]').first()).toBeVisible();
    const g = await grid(page);
    expect(g.client).toBe(1098);
    expect(g.scroll).toBeLessThanOrEqual(g.client);
    expect(g.title).toBeGreaterThanOrEqual(300);
    expect(g.hint).toBe(false);
    await shot(page, 'task-queue-box-1098');

    for (const [name, width, height] of [
      ['1366x768', 1366, 768],
      ['1920x1080', 1920, 1080],
    ] as const) {
      await page.setViewportSize({ width, height });
      await queue.open(q);
      await expect(page.locator('[data-task]').first()).toBeVisible();
      const w = await grid(page);
      expect(w.scroll, name).toBeLessThanOrEqual(w.client);
      await shot(page, `task-queue-${name}`);
      await axeClean(page, `Task Queue ${name}`);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await queue.open(q);
    await expect(page.locator('[data-task]').first()).toBeVisible();
    await shot(page, 'task-queue-375x812');
  });

  test('a user-added Client and Task type drop first when the Title would go below 200 px, and stay ticked in the Columns chooser', async ({
    seed,
    asUser,
  }) => {
    const { me, tag } = await worker(seed, 'extra');
    const page = await asUser(me.username);
    await page.addInitScript(
      ([k, v]) => localStorage.setItem(k, v),
      [
        `mf.work-columns.v2.taskQueue.${me.userId}`,
        JSON.stringify([
          'ref',
          'title',
          'matter',
          'client',
          'type',
          'priority',
          'assignee',
          'due',
          'status',
        ]),
      ],
    );
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open(`?q=${encodeURIComponent(tag)}`);
    await expect(page.locator('[data-task]').first()).toBeVisible();
    // Ref 112 + Matter 160 + Client 140 + Type 140 + Priority 112 + Assignee 136 + Due 136 + Status 140 = 1076 px of columns.
    const g = await grid(page);
    const full = 1076 + 200;
    if (g.client < full) {
      expect(g.keys).not.toContain('type');
      expect(g.title).toBeGreaterThanOrEqual(200);
      if (g.keys.includes('client')) expect(g.client).toBeGreaterThanOrEqual(full - 140);
    }
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Client' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Task type' })).toBeChecked();
    await shot(page, 'task-queue-extra-columns-1366x768');
  });
});

test.describe('Priority and Status triggers (#202)', () => {
  for (const [name, width, height] of [
    ['1366x768', 1366, 768],
    ['1920x1080', 1920, 1080],
    ['768x1024', 768, 1024],
    // The narrowest table: below 640 px the list is cards (#192).
    ['640x900', 640, 900],
  ] as const) {
    test(`the chevron is inside the cell at ${name}: one control, at least 24 px, inside the cell padding, axe clean`, async ({
      seed,
      admin,
      asUser,
    }) => {
      const { me, tag, world } = await worker(seed, `chev${width}`);
      const held = await seed.task(world, {
        title: `Held chevron ${tag}`,
        assignedUserId: me.userId,
        dueDate: dateInZone(FIRM_ZONE, 30),
      });
      await new TaskApi(admin, held.taskId).changeStatus('ON_HOLD', 'Waiting for the custodian');
      const page = await asUser(me.username);
      await page.setViewportSize({ width, height });
      const queue = new TaskQueuePage(page);
      await queue.open(`?q=${encodeURIComponent(tag)}`);
      await expect(page.locator('[data-task]').first()).toBeVisible();
      for (const density of ['comfortable', 'compact'] as const) {
        if (density === 'compact') {
          await page.getByRole('button', { name: 'Columns', exact: true }).click();
          await page.getByRole('radio', { name: 'Compact' }).check();
          await page.keyboard.press('Escape');
        }
        const spill = await page.evaluate(() => {
          const out: string[] = [];
          for (const col of ['priority', 'status']) {
            document
              .querySelectorAll<HTMLElement>(`[data-task] td[data-col="${col}"]`)
              .forEach((td) => {
                const cs = getComputedStyle(td);
                const left = td.getBoundingClientRect().left + parseFloat(cs.paddingLeft);
                const right = td.getBoundingClientRect().right - parseFloat(cs.paddingRight);
                const trigger = td.querySelector<HTMLElement>('[data-inline-trigger]');
                if (!trigger) return;
                const r = trigger.getBoundingClientRect();
                const chevron = trigger.querySelector('.pi-chevron-down')?.getBoundingClientRect();
                if (r.left < left - 0.5 || r.right > right + 0.5)
                  out.push(`${col} trigger ${r.left}-${r.right} outside ${left}-${right}`);
                if (r.width < 24 || r.height < 24)
                  out.push(`${col} trigger ${r.width}x${r.height}`);
                const value = trigger.querySelector<HTMLElement>('.im-value');
                if (value && value.scrollWidth > value.clientWidth + 0.5)
                  out.push(`${col} badge is cut (${value.scrollWidth} > ${value.clientWidth})`);
                if (!chevron || chevron.right > r.right + 0.5 || chevron.left < r.left)
                  out.push(`${col} chevron outside its trigger`);
                const note = td.querySelector<HTMLElement>('[data-hold-reason]');
                if (note && note.getBoundingClientRect().right > right + 0.5)
                  out.push('hold note spills');
              });
          }
          return out;
        });
        expect(spill, `${density} at ${name}`).toEqual([]);
      }
      if (width >= 768) {
        const widths = await page.evaluate(() => {
          const w: Record<string, number> = {};
          document
            .querySelectorAll<HTMLElement>('thead tr:first-child th')
            .forEach((t) => (w[t.dataset['col']!] = t.getBoundingClientRect().width));
          return w;
        });
        expect(widths['priority']).toBeLessThanOrEqual(112.5);
        expect(widths['status']).toBeLessThanOrEqual(140.5);
      }
      // Keyboard: the P and S keys still open the menus (WP12b selectors).
      await page.locator('[data-task] a.wt-title').first().focus();
      await page.keyboard.press('p');
      await expect(page.locator('.im-pop')).toBeVisible();
      await page.keyboard.press('Escape');
      await shot(page, `chevron-inside-${name}`);
      await axeClean(page, `Task Queue chevrons ${name}`);
    });
  }
});

test.describe('Stored widths (#203)', () => {
  const widthOf = (page: Page, col: string) =>
    page.evaluate(
      (c) =>
        document
          .querySelector<HTMLElement>(`thead tr:first-child th[data-col="${c}"]`)!
          .getBoundingClientRect().width,
      col,
    );

  test('a seeded width is applied on load, per page and tab, clamped, ignored when corrupt, and gone after a reset', async ({
    seed,
    asUser,
  }) => {
    const { me, tag } = await worker(seed, 'widths');
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const key = (scope: string) => `mf.work-widths.v1.${scope}.${me.userId}`;
    await page.addInitScript(
      ([a, b]) => {
        if (!sessionStorage.getItem('seeded')) {
          sessionStorage.setItem('seeded', '1');
          localStorage.setItem(
            a,
            '{"v":1,"w":{"due":182,"matter":9999,"foo":5,"status":"x","title":900}}',
          );
          localStorage.setItem(b, '{"v":1,"w":{"due":126}}');
        }
      },
      [key('taskQueue'), key('myWork.active')],
    );
    const queue = new TaskQueuePage(page);
    await queue.open(`?q=${encodeURIComponent(tag)}`);
    await expect(page.locator('[data-task]').first()).toBeVisible();
    expect(Math.abs((await widthOf(page, 'due')) - 182)).toBeLessThanOrEqual(1);
    // Over the maximum: clamped to 320 px; a string and the Title are ignored.
    expect(Math.abs((await widthOf(page, 'matter')) - 320)).toBeLessThanOrEqual(1);
    expect(Math.abs((await widthOf(page, 'status')) - 140)).toBeLessThanOrEqual(1);
    expect(await widthOf(page, 'title')).toBeLessThan(700);
    await shot(page, 'task-queue-stored-widths-1920x1080');

    // My Work keeps its own width, and Task Queue still has its own after coming back.
    await new MyWorkPage(page).open();
    await expect(page.locator('[data-task]').first()).toBeVisible();
    expect(Math.abs((await widthOf(page, 'due')) - 126)).toBeLessThanOrEqual(1);
    await page.getByRole('link', { name: 'Task Queue' }).first().click();
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
    await expect(page.locator('[data-task]').first()).toBeVisible();
    expect(Math.abs((await widthOf(page, 'due')) - 182)).toBeLessThanOrEqual(1);

    // The storage is independent of the column set and of the density: the Compact density keeps the widths.
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await page.getByRole('radio', { name: 'Compact' }).check();
    await page.keyboard.press('Escape');
    expect(Math.abs((await widthOf(page, 'due')) - 182)).toBeLessThanOrEqual(1);

    // Reset (the store's resetWidths removes the key of the scope): defaults return, other scopes keep theirs.
    await page.evaluate((k) => localStorage.removeItem(k), key('taskQueue'));
    await page.reload();
    await expect(page.locator('[data-task]').first()).toBeVisible();
    expect(Math.abs((await widthOf(page, 'due')) - 136)).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate((k) => localStorage.getItem(k), key('myWork.active')),
    ).not.toBeNull();
  });

  test('corrupt JSON and blocked storage render the default widths without an error', async ({
    seed,
    asUser,
  }) => {
    const { me, tag } = await worker(seed, 'blocked');
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(
      (k) => localStorage.setItem(k, '{not json'),
      `mf.work-widths.v1.taskQueue.${me.userId}`,
    );
    const queue = new TaskQueuePage(page);
    await queue.open(`?q=${encodeURIComponent(tag)}`);
    await expect(page.locator('[data-task]').first()).toBeVisible();
    expect(Math.abs((await widthOf(page, 'due')) - 136)).toBeLessThanOrEqual(1);

    // Storage that throws for the width keys only.
    await page.addInitScript(() => {
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k: string) {
        if (k.startsWith('mf.work-widths')) throw new Error('blocked');
        return get.call(this, k);
      };
    });
    await queue.open(`?q=${encodeURIComponent(tag)}`);
    await expect(page.locator('[data-task]').first()).toBeVisible();
    expect(Math.abs((await widthOf(page, 'due')) - 136)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});
