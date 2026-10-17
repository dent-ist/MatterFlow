import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { PLAN, WorkloadSeed, crowdPlan, seedWorkload } from '../support/workload';

/**
 * Dashboard > Users tab, Workload view (WP10a, UX review 2): the "can take work" population (U4, #130), the text Workload | Coverage switch and the
 * labelled toolbar (U2, #128), the capacity strip and the Assign work menu (U1, #127) and the quiet Idle tile (U7, #133).
 *
 * The twelve people of the standard plan are all in a pod. Two more people are added without a pod: one idle (hidden by the rule) and one who holds
 * an open task (always shown). Every test scopes the tab to them with `uq=<tag>`; the hidden count is about the whole department, so it is compared with
 * the API, not with a constant. Screenshots: set WP10A_SHOTS to the output folder (they use a department of 120 people).
 */
const SHOTS = process.env['WP10A_SHOTS'];

let wl: WorkloadSeed;
let podless: {
  idle: { userId: number; displayName: string };
  busy: { userId: number; displayName: string };
};

test.beforeAll(async ({ admin, seed }) => {
  test.setTimeout(300_000);
  wl = await seedWorkload(admin, seed);
  const make = async (label: string) => {
    const u = await seed.user(['Data Technician'], `wl${wl.tag}${label}`);
    const profile = await admin.get<Json>(
      `/api/v1/users?status=all&search=${encodeURIComponent(u.username)}`,
    );
    const found = profile.items.find((x: Json) => x.userId === u.userId);
    return { userId: u.userId, displayName: found.displayName as string };
  };
  podless = { idle: await make('nopodidle'), busy: await make('nopodbusy') };
  await seed.task(
    { ...wl.world, matter: wl.world.matter },
    {
      title: `No pod holds ${wl.tag}`,
      priorityId: wl.priorities[2].id,
      assignedUserId: podless.busy.userId,
    },
  );
});

const css = (value: string) => value.replace(/\\/g, '\\\\');
const cardOf = (page: Page, name: string) =>
  page.locator(`[data-user-card][data-user="${css(name)}"]`);

async function openUsers(page: Page, extra = ''): Promise<void> {
  await page.goto(`/dashboard?tab=users&uq=${wl.tag}${extra}`);
  await expect(page.locator('[data-user-card]').first()).toBeVisible();
  await expect(page.locator('[data-users-loading]')).toHaveCount(0);
}

async function workload(page: Page, params = ''): Promise<Json> {
  const response = await page.request.get(`/api/v1/dashboard/workload?q=${wl.tag}${params}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

const levels = (board: Json) => {
  const count = (l: string) => board.users.filter((u: Json) => u.loadLevel === l).length;
  return {
    idle: count('IDLE'),
    light: count('LIGHT'),
    normal: count('NORMAL'),
    heavy: count('HEAVY'),
  };
};
const out = (board: Json) =>
  board.users.filter((u: Json) => u.availability.state === 'OUT_OF_OFFICE').length;

test.describe('Users tab: capacity, population and toolbar', () => {
  test('the default view lists the people who can take work; the quiet line counts the others and Show them adds them (unopod=1)', async ({
    page,
  }) => {
    // "Others hidden" counts every idle person without a pod in the shared database, and other workers keep creating, assigning and
    // deactivating users, so the number is never the same twice: it is compared with what the page's own request answered.
    const answers: { hidden: number; total: number }[] = [];
    page.on('response', async (r) => {
      if (
        r.url().includes('/api/v1/dashboard/workload') &&
        r.url().includes('includeNoPod=false')
      ) {
        const body = await r.json();
        answers.push({ hidden: body.hiddenCount, total: body.summary.total });
      }
    });
    await openUsers(page);
    const shown = await workload(page, '&includeNoPod=false');
    const everyone = await workload(page, '&includeNoPod=true');
    expect(shown.hiddenCount).toBeGreaterThanOrEqual(1);
    expect(everyone.hiddenCount).toBe(0);
    // Of the people matching the tag only the idle one without a pod is hidden.
    expect(everyone.users.length - shown.users.length).toBe(1);

    // A pod-less person who holds an open task is in the default view; the idle one without a pod is not.
    await expect(page.locator('[data-user-card]')).toHaveCount(PLAN.length + 1);
    await expect(cardOf(page, podless.busy.displayName)).toBeVisible();
    await expect(cardOf(page, podless.idle.displayName)).toHaveCount(0);
    const line = page.locator('[data-users-population-text]');
    await expect(line).toContainText(/Showing \d+ people who can take work\./);
    const text = (await line.textContent()) ?? '';
    const hidden = Number(/(\d+) others? (?:is|are) hidden\./.exec(text)?.[1]);
    const total = Number(/Showing (\d+) people/.exec(text)?.[1]);
    await expect
      .poll(() => answers.some((a) => a.hidden === hidden && a.total === total))
      .toBe(true);

    await page.getByRole('button', { name: 'Show them' }).click();
    await expect(page).toHaveURL(/unopod=1/);
    await expect(cardOf(page, podless.idle.displayName)).toBeVisible();
    await expect(page.locator('[data-user-card]')).toHaveCount(PLAN.length + 2);
    await expect(line).toHaveText('Including people without a pod.');
    // The old population: the idle chip counts one more, and Clear filters leaves the switch on.
    const idleOn = Number(await page.locator('[data-chip="idle"] [data-n]').textContent());
    expect(idleOn).toBe(levels(everyone).idle);
    await page.locator('[data-chip="heavy"]').click();
    await page.getByRole('button', { name: /^Clear filters/ }).click();
    await expect(page).toHaveURL(/unopod=1/);
    await page.locator('[data-chip="heavy"]').click();
    await page.locator('[data-chip="heavy"]').click();

    // The address is the state: reload keeps it, and Hide them goes back to the rule.
    await openUsers(page, '&unopod=1');
    await expect(cardOf(page, podless.idle.displayName)).toBeVisible();
    await page.getByRole('button', { name: 'Hide them' }).click();
    await expect(page).not.toHaveURL(/unopod/);
    await expect(cardOf(page, podless.idle.displayName)).toHaveCount(0);
  });

  test('counts are equal in the chips, the capacity strip, the tile totals and the API; a Pod scope hides nobody', async ({
    page,
  }) => {
    await openUsers(page);
    const board = await workload(page, '&includeNoPod=false');
    const lv = levels(board);
    for (const key of ['idle', 'light', 'normal', 'heavy'] as const) {
      expect(Number(await page.locator(`[data-chip="${key}"] [data-n]`).textContent())).toBe(
        lv[key],
      );
      const segment = page.locator(`[data-capacity-bar] [data-segment="${key}"]`);
      if (lv[key] > 0) {
        await expect(segment).toHaveAttribute('aria-label', `Filter: ${lv[key]} ${key}`);
        await expect(segment).toHaveCSS('flex-grow', String(lv[key]));
      } else {
        await expect(segment).toHaveCount(0);
      }
    }
    expect(Number(await page.locator('[data-chip="out"] [data-n]').textContent())).toBe(out(board));
    await expect(page.locator('[data-capacity]')).toHaveAttribute(
      'aria-label',
      `Capacity: ${lv.idle} idle, ${lv.light} light, ${lv.normal} normal, ${lv.heavy} heavy, ${out(board)} out of office`,
    );
    // The tiles on screen add up to the strip.
    expect(lv.idle + lv.light + lv.normal + lv.heavy).toBe(
      await page.locator('[data-user-card]').count(),
    );
    await expect(page.locator('[data-summary-unassigned]')).toContainText(
      `${board.summary.unassignedTasks} unassigned task`,
    );

    // Clicking a segment filters like the chip, and a second click clears.
    const heavy = page.locator('[data-capacity-bar] [data-segment="heavy"]');
    await heavy.click();
    await expect(page).toHaveURL(/uload=heavy/);
    await expect(heavy).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-chip="heavy"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-user-card]')).toHaveCount(lv.heavy);
    await heavy.click();
    await expect(page).not.toHaveURL(/uload/);
    await expect(page.locator('[data-user-card]')).toHaveCount(
      lv.idle + lv.light + lv.normal + lv.heavy,
    );

    // Scope = Pod B: strip, chips and unassigned link follow it; nobody is hidden, so there is no population line.
    await page.getByLabel('Scope', { exact: true }).selectOption(String(wl.podB.podId));
    await expect(page.locator('[data-users-population]')).toHaveCount(0);
    const scoped = await workload(page, `&podScope=${wl.podB.podId}`);
    expect(scoped.hiddenCount).toBe(0);
    const slv = levels(scoped);
    await expect(page.locator('[data-chip="idle"] [data-n]')).toHaveText(String(slv.idle));
    await expect(page.locator('[data-chip="heavy"] [data-n]')).toHaveText(String(slv.heavy));
    await expect(page.locator('[data-capacity]')).toHaveAttribute(
      'aria-label',
      new RegExp(`^Capacity: ${slv.idle} idle, ${slv.light} light`),
    );
    await expect(page.locator('[data-summary-unassigned]')).toContainText(
      `${scoped.summary.unassignedTasks} unassigned task`,
    );
    await expect(page.locator('[data-summary-unassigned]')).toHaveAttribute(
      'href',
      new RegExp(`pod=${wl.podB.podId}`),
    );
  });

  test('Assign work offers the people who can take work now (fewest open tasks first) and the unassigned queue; Escape closes it', async ({
    page,
  }) => {
    await openUsers(page);
    const trigger = page.getByRole('button', { name: 'Assign work', exact: true });
    await trigger.click();
    await expect(page.getByRole('menuitem')).toHaveText([
      'Show people who can take work now',
      'Open the unassigned queue',
    ]);
    await expect(page.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.getByRole('menuitem', { name: 'Show people who can take work now' }).click();
    await expect(page).toHaveURL(/uavail=available/);
    await expect(page).toHaveURL(/uload=idle(,|%2C)light/);
    await expect(page.locator('[data-sort]')).toHaveValue('fewest');
    const board = await workload(page, '&availability=available&includeNoPod=false');
    const wanted = board.users
      .filter((u: Json) => u.loadLevel === 'IDLE' || u.loadLevel === 'LIGHT')
      .sort((a: Json, b: Json) => a.openTotal - b.openTotal);
    await expect(page.locator('[data-user-card]')).toHaveCount(wanted.length);
    const opens = await page
      .locator('[data-user-card] [data-open-total]')
      .allTextContents()
      .then((t) => t.map(Number));
    expect(opens).toEqual([...opens].sort((a, b) => a - b));
    // No one out of office is offered.
    await expect(page.locator('[data-user-card][data-availability="OUT_OF_OFFICE"]')).toHaveCount(
      0,
    );

    await page.getByRole('button', { name: 'Assign work', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open the unassigned queue' }).click();
    await expect(page).toHaveURL(/\/tasks\?.*unassigned=true/);
  });

  test('Workload | Coverage is a text switch of toggle buttons, first in the toolbar and on Coverage; a role without Coverage has none', async ({
    page,
    seed,
    asUser,
  }) => {
    await page.goto('/dashboard?tab=users');
    await expect(page.locator('[data-user-card]').first()).toBeVisible();
    const views = page.locator('[data-users-views]');
    await expect(views.getByRole('button')).toHaveText(['Workload', 'Coverage']);
    await expect(views.getByRole('button', { name: 'Workload' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(views.locator('[role="tablist"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Team workload', exact: true })).toHaveCount(1);

    // Keyboard order: switch, search, filters, sort, then density, layout and legend.
    await views.getByRole('button', { name: 'Workload' }).focus();
    const order: string[] = [];
    for (let i = 0; i < 11; i++) {
      order.push(
        await page.evaluate(() => {
          const a = document.activeElement as HTMLElement;
          return (
            a.getAttribute('aria-label') ||
            a.getAttribute('id') ||
            a.textContent?.trim() ||
            a.tagName
          );
        }),
      );
      await page.keyboard.press('Tab');
    }
    expect(order).toEqual([
      'Workload',
      'Coverage',
      'wl-q',
      'wl-prio',
      'wl-avail',
      'wl-sort',
      'Tile size: standard',
      'Tile size: dense',
      'Layout: cards',
      'Layout: table',
      'Legend and help',
    ]);

    await views.getByRole('button', { name: 'Coverage' }).click();
    await expect(page).toHaveURL(/view=coverage/);
    await expect(
      page.locator('[data-coverage-table], [data-coverage-heading]').first(),
    ).toBeVisible();
    // The first control on Coverage is the switch, never unlabeled buttons.
    const first = await page.evaluate(() => {
      const main = document.querySelector('mf-dash-users-tab')!;
      const control = Array.from(
        main.querySelectorAll<HTMLElement>('button, a, input, select'),
      ).find((e) => e.offsetParent !== null)!;
      return control.textContent?.trim() ?? '';
    });
    expect(first).toBe('Workload');

    const role = await seed.role(
      ['Task.View', 'Dashboard.View', 'Dashboard.ViewUsers'],
      'No coverage',
    );
    const { username } = await seed.user([role.name], 'nocovswitch');
    const lead = await asUser(username);
    await lead.goto(`/dashboard?tab=users&uq=${wl.tag}`);
    await expect(lead.locator('[data-user-card]').first()).toBeVisible();
    await expect(lead.locator('[data-users-views]')).toHaveCount(0);
    await expect(lead.getByRole('heading', { name: 'Workload', exact: true })).toHaveCount(1);
  });

  test('icon buttons say their purpose and state, show a text tip on hover and focus, are 32 px, and the Legend word appears from 1100 px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openUsers(page);
    const dense = page.getByRole('button', { name: 'Tile size: dense' });
    const standard = page.getByRole('button', { name: 'Tile size: standard' });
    await expect(standard).toHaveAttribute('aria-pressed', 'true');
    await dense.click();
    await expect(dense).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-users-grid]')).toHaveAttribute('data-density', 'compact');
    await standard.click();
    for (const b of [dense, standard, page.getByRole('button', { name: 'Layout: table' })]) {
      const box = (await b.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(32);
      expect(box.height).toBeGreaterThanOrEqual(32);
    }
    // Distinct icons.
    const icon = (loc: ReturnType<Page['locator']>) => loc.locator('.pi').getAttribute('class');
    expect(await icon(dense)).not.toBe(await icon(standard));
    expect(await icon(page.locator('[data-layout="cards"]'))).not.toBe(
      await icon(page.locator('[data-layout="table"]')),
    );
    // A text tip on hover and on keyboard focus.
    await dense.hover();
    expect(await dense.evaluate((el) => getComputedStyle(el, '::after').content)).toContain(
      'Dense tiles',
    );
    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: 'Layout: table' }).focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    expect(
      await page
        .getByRole('button', { name: 'Layout: table' })
        .evaluate((el) => getComputedStyle(el, '::after').content),
    ).toContain('Table');
    await expect(page.locator('.legend-word')).toBeVisible();
    await expect(page.locator('.legend-word')).toHaveText('Legend');
    await page.setViewportSize({ width: 1000, height: 768 });
    await expect(page.locator('.legend-word')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Legend and help' })).toBeVisible();
  });

  test('the toolbar is one line at 1366, wraps without sideways scroll at 375, and the strip keeps its place while loading', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openUsers(page);
    const bar = (await page.locator('[role="toolbar"]').boundingBox())!;
    expect(bar.height).toBeLessThanOrEqual(56);
    const tops = await page
      .locator('[role="toolbar"] button, [role="toolbar"] select, [role="toolbar"] input')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(24);
    await page.setViewportSize({ width: 375, height: 812 });
    await openUsers(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await expect(page.locator('[data-capacity-bar]')).toBeVisible();
    const strip = (await page.locator('[data-capacity-bar]').boundingBox())!;
    // The app shell's 56 px rail leaves 271 px at 375: the bar fills it.
    expect(strip.width).toBeGreaterThan(250);
  });

  test('an Idle tile is a light tint with a thin outline; Heavy keeps its outline and icon; no tile is darker than the tint except Heavy and Out of office', async ({
    page,
  }) => {
    await openUsers(page);
    // Computed colours of color-mix() come back as color(srgb ...): draw them on a canvas to get plain RGB.
    const luminanceOf = (css: string, selector: string | null) =>
      page.evaluate(
        ({ css, selector }) => {
          const node = selector
            ? (document.querySelector(selector) as HTMLElement)
            : document.body.appendChild(document.createElement('i'));
          if (!selector) node.style.background = css;
          const color = getComputedStyle(node).backgroundColor;
          if (!selector) node.remove();
          const ctx = document.createElement('canvas').getContext('2d')!;
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
          return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        },
        { css, selector },
      );
    const luminance = async (el: ReturnType<Page['locator']>) => {
      await el.evaluate((node) => node.setAttribute('data-probe', ''));
      const value = await luminanceOf('', '[data-probe]');
      await el.evaluate((node) => node.removeAttribute('data-probe'));
      return value;
    };
    const token = await luminanceOf('var(--mf-success-bg)', null);
    const idle = page.locator('[data-user-card][data-state="free"]').first();
    expect(await luminance(idle)).toBeGreaterThan(token);
    await expect(idle.locator('[data-state-icon]')).toHaveClass(/pi-check-circle/);
    expect(await idle.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe('1px');
    for (const c of await page.locator('[data-user-card]:not([data-state="ooo"])').all()) {
      const heavy = (await c.getAttribute('data-load')) === 'HEAVY';
      if (!heavy) expect(await luminance(c)).toBeGreaterThanOrEqual(token);
    }
    const heavy = page.locator('[data-user-card][data-load="HEAVY"]').first();
    await expect(heavy.locator('[data-heavy]')).toHaveCount(1);
    expect(await heavy.evaluate((e) => getComputedStyle(e).boxShadow)).not.toBe('none');
  });

  test('chip tooltips and accessible names carry the thresholds, and the legend explains who is counted', async ({
    page,
  }) => {
    await openUsers(page);
    for (const [key, words] of [
      ['idle', 'no open tasks'],
      ['light', '1 to 3 open tasks'],
      ['normal', '4 to 8 open tasks'],
      ['heavy', 'more than 8 open tasks'],
    ] as const) {
      const chip = page.locator(`[data-chip="${key}"]`);
      await expect(chip).toHaveAttribute('aria-label', new RegExp(words));
      await expect(chip).toHaveAttribute('title', new RegExp(words));
      await expect(
        page.locator(`[data-capacity-bar] [data-segment="${key}"]`).first(),
      ).toHaveAttribute('title', new RegExp(words));
    }
    await page.getByRole('button', { name: 'Legend and help' }).click();
    await expect(page.locator('[data-load-help]')).toContainText('Light: 1 to 3 open tasks.');
    await expect(page.locator('[data-legend-population]')).toContainText(
      'in a pod or hold an open task',
    );
  });

  test('has no axe violations in the strip, the open menu, the population line and the toolbar at 1366, 1920 and 375', async ({
    page,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(300_000);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      await openUsers(page);
      await expect(page.locator('[data-users-population]')).toBeVisible();
      expect(await axeViolations(page), `workload ${width}`).toEqual([]);
      await page.getByRole('button', { name: 'Assign work', exact: true }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      expect(await axeViolations(page), `menu ${width}`).toEqual([]);
      await page.keyboard.press('Escape');
      await page.locator('[data-capacity-bar] [data-segment="heavy"]').click();
      expect(await axeViolations(page), `filtered ${width}`).toEqual([]);
      await page.goto(`/dashboard?tab=users&view=coverage&uq=${wl.tag}`);
      await expect(page.locator('[data-users-views]')).toBeVisible();
      expect(await axeViolations(page), `coverage ${width}`).toEqual([]);
      // The choice is remembered: go back to Workload for the next size.
      await page.locator('[data-view="workload"]').click();
      await expect(page.locator('[data-user-card]').first()).toBeVisible();
    }
  });
});

test.describe('capacity strip on a big board', () => {
  test('every segment is a 24 px target at 375 and 1366 px, with one Idle person among hundreds, and axe finds nothing', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // A data-heavy department made from the seeded board: one Idle person, hundreds of Light, Normal and Heavy ones. The Idle share is far under a
    // pixel of the strip, which used to squeeze its segment below the minimum target size (axe target-size at 375 px).
    await page.route('**/api/v1/dashboard/workload**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const real = body.users as Json[];
      const users: Json[] = [];
      let id = 900_000;
      for (const level of ['IDLE', 'LIGHT', 'NORMAL', 'HEAVY']) {
        const count = level === 'IDLE' ? 1 : 150;
        for (let i = 0; i < count; i++) {
          const base = real[i % real.length];
          users.push({
            ...base,
            userId: id++,
            displayName: `${level} ${i + 1} ${base.displayName}`,
            loadLevel: level,
          });
        }
      }
      body.users = users;
      await route.fulfill({ response, json: body });
    });
    for (const [width, height] of [
      [375, 812],
      [1366, 768],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto(`/dashboard?tab=users&uq=${wl.tag}`);
      const segments = page.locator('[data-capacity-bar] [data-segment]');
      await expect(segments).toHaveCount(4);
      for (const level of ['idle', 'light', 'normal', 'heavy']) {
        const box = await page
          .locator(`[data-capacity-bar] [data-segment="${level}"]`)
          .boundingBox();
        expect(box!.width, `${level} width at ${width}`).toBeGreaterThanOrEqual(24);
        expect(box!.height, `${level} height at ${width}`).toBeGreaterThanOrEqual(24);
      }
      // The strip stays inside its row: no horizontal page scroll.
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      if (axeAvailable()) {
        expect(await axeViolations(page), `strip ${width}`).toEqual([]);
      }
    }
  });
});

const FIRST =
  'Ana Ben Cai Dev Eli Fay Gus Hal Ida Jon Kay Leo Mia Ned Ola Pat Quin Rae Sam Tia Uma Vic Wes Xia Yan Zoe Amir Bea Carl Dina Evan Faye Gil Hana Ivo Jade Kofi Lena Milo Nia'.split(
    ' ',
  );
const LAST =
  'Adams Baker Chen Diaz Evans Farah Gupta Hayes Ito Jones Khan Lopez Moore Nguyen Okafor Patel Quinn Rossi Singh Tanaka Usman Vega Walsh Xu Young Zhang Abbott Brandt Cole Dunn Ellis Frost Grant Holt Iyer Joshi Kerr Lowe Mills Nash'.split(
    ' ',
  );

test.describe('users capacity screenshots', () => {
  test.skip(!SHOTS, 'set WP10A_SHOTS to the output folder');

  test('capture', async ({ page, admin, seed }) => {
    test.setTimeout(900_000);
    fs.mkdirSync(SHOTS!, { recursive: true });
    const crowd = await seedWorkload(admin, seed, { plan: crowdPlan(120), width: 6 });
    // Sample names instead of the machine names of the throwaway accounts (screenshots only).
    await page.route('**/api/v1/dashboard/workload**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const ids = body.users
        .map((u: { userId: number }) => u.userId)
        .sort((a: number, b: number) => a - b);
      for (const u of body.users) {
        const i = ids.indexOf(u.userId);
        const first = FIRST[i % FIRST.length];
        const last = LAST[(i * 7 + 3 + Math.floor(i / FIRST.length) * 11) % LAST.length];
        u.displayName = `${first} ${last}`;
        u.initials = `${first[0]}${last[0]}`;
      }
      await route.fulfill({ response, json: body });
    });
    const shot = async (name: string) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS!, `${name}.png`) });
    };
    const base = `/dashboard?tab=users&uq=${crowd.tag}`;
    const ready = async () => {
      await expect(page.locator('[data-user-card]').first()).toBeVisible();
      await expect(page.locator('[data-users-loading]')).toHaveCount(0);
    };
    for (const [w, h] of [
      [1366, 768],
      [1920, 1080],
      [375, 812],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(base);
      await ready();
      await shot(`01-workload-${w}`);
      await page.locator('[data-capacity-bar] [data-segment="heavy"]').click();
      await expect(page.locator('[data-capacity-bar] [data-segment="heavy"]')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await shot(`02-strip-heavy-${w}`);
      await page.locator('[data-capacity-bar] [data-segment="heavy"]').click();
      await page.getByRole('button', { name: 'Assign work', exact: true }).click();
      await shot(`03-assign-menu-${w}`);
      await page.keyboard.press('Escape');
      await page.goto(`/dashboard?tab=users&view=coverage&uq=${crowd.tag}`);
      await expect(page.locator('[data-users-views]')).toBeVisible();
      await shot(`04-coverage-${w}`);
      // The choice is remembered: back to Workload for the next size.
      await page.locator('[data-view="workload"]').click();
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${base}&unopod=1`);
    await ready();
    await shot('05-include-no-pod-1366');
    await page.goto(base);
    await ready();
    await page.getByRole('button', { name: 'Legend and help' }).click();
    await shot('06-legend-1366');
    await page.getByRole('button', { name: 'Legend and help' }).click();
    await page.locator('[data-density="compact"]').click();
    await shot('07-dense-1366');
    await page.locator('[data-density="comfortable"]').click();
    // The tile anatomy at 200%: sorted by name (a mix of idle, light, normal and heavy people), the grid scaled up.
    await page.getByLabel('Sort', { exact: true }).selectOption('name');
    await page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>('[data-users-grid]')!;
      grid.style.transformOrigin = '0 0';
      grid.style.transform = 'scale(2)';
    });
    await page.waitForTimeout(300);
    const gridBox = (await page.locator('[data-users-grid]').boundingBox())!;
    await page.screenshot({
      path: path.join(SHOTS!, '00-tile-anatomy-2x.png'),
      clip: { x: gridBox.x, y: gridBox.y, width: Math.min(gridBox.width, 1000), height: 340 },
    });
  });
});
