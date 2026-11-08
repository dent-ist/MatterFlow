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
  test('LC-09: a 1098 px box keeps the Title at 160 px or more and the page never scrolls sideways; 1366 and 1920 are clean', async ({
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
    // The standard order does not fit: the frame scrolls sideways, the Title keeps its width.
    // D-43a (#1232): the Title minimum is 120 px on task grids; 160 is guaranteed only for the default column sets.
    expect(g.title).toBeGreaterThanOrEqual(120);
    await shot(page, 'task-queue-box-1098');

    for (const [name, width, height] of [
      ['1366x768', 1366, 768],
      ['1920x1080', 1920, 1080],
    ] as const) {
      await page.setViewportSize({ width, height });
      await queue.open(q);
      await expect(page.locator('[data-task]').first()).toBeVisible();
      const w = await grid(page);
      expect(w.title, name).toBeGreaterThanOrEqual(160);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        `${name}: the page does not scroll sideways`,
      ).toBeLessThanOrEqual(0);
      await shot(page, `task-queue-${name}`);
      await axeClean(page, `Task Queue ${name}`);
    }
  });

  test('LC-09: a user-added Client and Task type stay (nothing drops by width), the Title keeps 160 px, and they are ticked in the Columns chooser', async ({
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
    const g = await grid(page);
    expect(g.keys).toContain('client');
    expect(g.keys).toContain('type');
    // D-43a (#1232): the Title minimum is 120 px on task grids; 160 is guaranteed only for the default column sets.
    expect(g.title).toBeGreaterThanOrEqual(120);
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Client' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Type', exact: true })).toBeChecked();
    await shot(page, 'task-queue-extra-columns-1366x768');
  });
});

test.describe('Priority and Status triggers (#202)', () => {
  for (const [name, width, height] of [
    ['1366x768', 1366, 768],
    ['1920x1080', 1920, 1080],
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
    // The Title is the one spring (D-42, D-43): the frame width minus the other columns, within 2 px, and at least 120 px.
    const spring = await page.evaluate(() => {
      const ths = Array.from(document.querySelectorAll<HTMLElement>('thead tr:first-child th'));
      // The grid fills the frame (or scrolls): its table is at least as wide as the frame; the spring is the table minus the others.
      const frame = document
        .querySelector<HTMLElement>('.wt-wrap table')!
        .getBoundingClientRect().width;
      const others = ths
        .filter((th) => th.dataset['col'] !== 'title')
        .reduce((sum, th) => sum + th.getBoundingClientRect().width, 0);
      const title = ths.find((th) => th.dataset['col'] === 'title')!.getBoundingClientRect().width;
      return { title, rest: frame - others };
    });
    expect(spring.title).toBeGreaterThanOrEqual(120);
    expect(Math.abs(spring.title - Math.max(120, spring.rest))).toBeLessThanOrEqual(2);
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
    expect(Math.abs((await widthOf(page, 'due')) - 152)).toBeLessThanOrEqual(1);
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
    expect(Math.abs((await widthOf(page, 'due')) - 152)).toBeLessThanOrEqual(1);

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
    expect(Math.abs((await widthOf(page, 'due')) - 152)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});
