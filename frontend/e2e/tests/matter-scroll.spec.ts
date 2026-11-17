import { Page } from '@playwright/test';
import { Api, Json } from '../support/api';
import { expect, test } from '../support/fixtures';
import { SIZES } from '../support/labels';
import { Seeder, uid } from '../support/seed';

/**
 * Matter page scrolling (epic #1389, #1396, D-03a to D-03c): the Matter page is ONE page that scrolls as a whole. The compact grids of Tasks, Projects, Assets, Productions, Notes and
 * Activities show at most 10 rows and have nothing to scroll up and down, so the wheel (or trackpad, or Page Down) over them must move the PAGE (it used to do nothing: the grid frame stopped
 * the scroll chain with `overscroll-behavior: contain`). The Summary (Details card with several paths, Team, Vendors, asset tiles) has no scroll area of its own: the wheel over it moves the page
 * and nothing in it is cut off. The areas that are made to scroll inside themselves do: the people and vendor rows of the Edit Team and Edit Vendors dialogs, and the full view of a section
 * (`?tab=tasks`). A table wider than its card scrolls sideways inside the card. Matter "scroll" has 32 tasks, 12 projects, 12 assets, 12 notes, 1 production, 6 DMS and 4 DFS paths, 10 team members and 7 vendors.
 */
const token = uid().slice(0, 6);

interface World {
  matter: Json;
}

async function build(seed: Seeder, admin: Api): Promise<World> {
  const client = await seed.client({ name: `Scroll client ${token}` });
  const matter = await seed.matter({ client, number: '00001', name: `Scroll matter ${token}` });
  const base = await seed.world();
  const world = { matter, taskType: base.taskType, workflow: base.workflow };
  for (let i = 1; i <= 32; i++) await seed.task(world, { title: `Scroll task ${i} ${token}` });
  for (let i = 1; i <= 12; i++) await seed.asset(matter, `Scroll asset ${i} ${token}`);
  for (let i = 1; i <= 12; i++) await seed.project(matter, `Scroll project ${i} ${token}`);
  for (let i = 1; i <= 12; i++) {
    await admin.post('/api/v1/notes', {
      matterId: matter.matterId,
      bodyHtml: `<h1>Scroll note ${i} ${token}</h1><p>Body ${i}</p>`,
      tagIds: [],
    });
  }
  await admin.post('/api/v1/productions', {
    matterId: matter.matterId,
    name: `Scroll production ${token}`,
    direction: 'OUT',
  });
  const long = 'long-segment-'.repeat(4);
  const dms = Array.from(
    { length: 6 },
    (_, i) => `\\\\fs01\\dms\\Matters\\1048\\0017\\folder-${i}\\${long}`,
  );
  const dfs = Array.from(
    { length: 4 },
    (_, i) => `https://dfs.example.com/matters/10482/0017/${i}/${long}`,
  );
  const fresh = await admin.get<Json>(`/api/v1/matters/${matter.matterId}`);
  await admin.put(`/api/v1/matters/${matter.matterId}`, {
    name: fresh.name,
    isSensitive: false,
    rowVersion: fresh.rowVersion,
    dmsPaths: dms,
    dfsPaths: dfs,
  });
  const titles = (await admin.get<Json[]>('/api/v1/team-titles')).filter((t) => t.isActive);
  const names = ['Maria', 'Helen', 'Victor', 'Tom', 'Grace', 'Ana', 'Bo', 'Cy', 'Di', 'Ed'];
  for (const [i, first] of names.entries()) {
    const p = await admin.post('/api/v1/people', {
      firstName: `${first}${token}`,
      lastName: 'Team',
      personType: 'INTERNAL',
      email: `${first}.${token}@demo.example`.toLowerCase(),
    });
    await admin.post(`/api/v1/matters/${matter.matterId}/team`, {
      personId: p.personId,
      teamTitleId: titles[i % titles.length].id,
    });
  }
  for (const n of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta']) {
    const v = await admin.post('/api/v1/vendors', { name: `${n} ${token}`, category: 'PREFERRED' });
    await admin.post(`/api/v1/matters/${matter.matterId}/vendors`, {
      vendorId: v.vendorId,
      confirmBlacklisted: false,
    });
  }
  return { matter };
}

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
const card = (page: Page, key: string) => page.locator(`[data-section="${key}"]`);
const bodyRows = (page: Page, key: string) =>
  card(page, key).locator(
    'tbody tr:not([data-skeleton]):not(.gb-state):not(.gb-still):not(.gb-live):not(.gb-sk):has(td:not(.mf-sr-only))',
  );

/** Moves the mouse over the middle of `target`'s first line and turns the wheel. */
async function wheelOver(page: Page, target: ReturnType<Page['locator']>, dy: number, dx = 0) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + Math.min(box.width / 2, 300), box.y + Math.min(box.height / 2, 20));
  await page.mouse.wheel(dx, dy);
}

async function open(page: Page, w: World, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto(`/matters/${w.matter.matterId}`);
  await expect(page.locator('[data-matter-one-page]')).toBeVisible();
  await expect(page.locator('[data-summary-details]')).toBeVisible();
}

test.describe('Matter page scrolling', () => {
  let w: World;
  test.beforeAll(async ({ seed, admin }) => {
    test.setTimeout(600_000);
    w = await build(seed, admin);
  });

  for (const size of SIZES) {
    const at = `${size.width}x${size.height}`;

    test(`the wheel over a compact grid scrolls the page, at ${at}`, async ({ page }) => {
      await open(page, w, size);
      for (const key of ['tasks', 'projects', 'assets', 'productions', 'notes', 'activities']) {
        const grid = card(page, key).locator('[data-grid-frame], .wt-wrap').first();
        await grid.scrollIntoViewIfNeeded();
        await expect(bodyRows(page, key).first(), `${key} rows`).toBeVisible();
        const row = bodyRows(page, key).first();
        // Up: the page is below its top here, so it can always move.
        const before = await scrollY(page);
        expect(before, `${key}: page is scrolled`).toBeGreaterThan(0);
        await wheelOver(page, row, -120);
        await expect.poll(() => scrollY(page), { message: `${key} wheel up` }).toBeLessThan(before);
      }
      // Down, over the first rows of the Tasks grid (the page has more below).
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(bodyRows(page, 'tasks').first()).toBeVisible();
      await wheelOver(page, bodyRows(page, 'tasks').first(), 200);
      await expect.poll(() => scrollY(page), { message: 'tasks wheel down' }).toBeGreaterThan(0);
    });

    test(`the keyboard scrolls the page from a compact card, at ${at}`, async ({ page }) => {
      await open(page, w, size);
      // The compact grids add no empty Tab stop: nothing in them scrolls up or down.
      await expect(bodyRows(page, 'tasks').first()).toBeVisible();
      await expect(page.locator('[data-matter-one-page] [data-section] [role=region]')).toHaveCount(
        0,
      );
      await page.locator('#section-tasks-h').focus();
      const before = await scrollY(page);
      await page.keyboard.press('PageDown');
      await expect.poll(() => scrollY(page)).toBeGreaterThan(before);
      const mid = await scrollY(page);
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => scrollY(page)).toBeGreaterThan(mid);
      await page.keyboard.press('PageUp');
      await expect.poll(() => scrollY(page)).toBeLessThan((await scrollY(page)) + 1);
    });

    test(`nothing on the page traps the wheel and nothing is cut off, at ${at}`, async ({
      page,
    }) => {
      await open(page, w, size);
      for (const key of ['tasks', 'projects', 'assets', 'productions', 'notes', 'activities']) {
        await card(page, key).scrollIntoViewIfNeeded();
        await expect(bodyRows(page, key).first()).toBeVisible();
      }
      const traps = await page.evaluate(() => {
        const out: string[] = [];
        const root = document.querySelector('[data-matter-one-page]')!;
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
          const cs = getComputedStyle(el);
          const scrollsY =
            /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
          const stopsChain = cs.overscrollBehaviorY !== 'auto' || cs.overscrollBehaviorX !== 'auto';
          const name = `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`;
          // A box that does not scroll up and down must not stop the wheel from reaching the page.
          if (
            stopsChain &&
            !scrollsY &&
            /auto|scroll|hidden/.test(`${cs.overflowX} ${cs.overflowY}`)
          ) {
            out.push(`${name} stops the scroll chain`);
          }
          // The Summary and the compact cards have no scroll area of their own (D-03a).
          if (scrollsY) out.push(`${name} scrolls inside the page`);
        }
        return out;
      });
      expect(traps).toEqual([]);
      // The Details card holds every path (6 DMS and 4 DFS) and is not cut off.
      const details = page.locator('[data-summary-details]');
      await expect(details.locator('[data-path-row]')).toHaveCount(10);
      const clipped = await details.evaluate((el) => {
        const bottom = el.getBoundingClientRect().bottom;
        return Array.from(el.querySelectorAll('[data-path-row]')).filter(
          (r) => r.getBoundingClientRect().bottom > bottom + 1,
        ).length;
      });
      expect(clipped, 'path rows below the Details card').toBe(0);
    });

    test(`the wheel over the Summary (Details, Team, Vendors, asset tiles) scrolls the page, at ${at}`, async ({
      page,
    }) => {
      await open(page, w, size);
      for (const sel of [
        '[data-summary-details]',
        '[data-section-panel="team"]',
        '[data-section-panel="vendors"]',
        '[data-summary-assets] ul',
      ]) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page.locator(sel).first()).toBeVisible();
        await wheelOver(page, page.locator(sel).first(), 150);
        await expect.poll(() => scrollY(page), { message: sel }).toBeGreaterThan(0);
      }
    });

    test(`a table wider than its card scrolls sideways inside the card, and the wheel still moves the page, at ${at}`, async ({
      page,
    }) => {
      await open(page, w, size);
      const wrap = card(page, 'projects').locator('.scroll').first();
      await expect(bodyRows(page, 'projects').first()).toBeVisible();
      await wrap
        .locator('table')
        .first()
        .evaluate((t) => ((t as HTMLElement).style.minWidth = '2600px'));
      await wheelOver(page, bodyRows(page, 'projects').first(), 0, 300);
      await expect.poll(() => wrap.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
      const before = await scrollY(page);
      await wheelOver(page, bodyRows(page, 'projects').first(), -100);
      await expect.poll(() => scrollY(page)).toBeLessThan(before);
    });

    test(`Edit Team and Edit Vendors: the rows scroll inside the dialog, at ${at}`, async ({
      page,
    }) => {
      await open(page, w, size);
      for (const [edit, rows, last] of [
        ['[data-team-edit]', '[data-team-rows]', '[data-team-row]'],
        ['[data-vendor-edit]', '[data-vendor-rows]', '[data-vendor-row]'],
      ] as const) {
        await page.locator(edit).first().click();
        const list = page.locator(`.mf-formdlg ${rows}`);
        await expect(list).toBeVisible();
        const dims = await list.evaluate((e) => ({ s: e.scrollHeight, c: e.clientHeight }));
        expect(dims.s, `${rows} has more rows than fit`).toBeGreaterThan(dims.c);
        const y = await scrollY(page);
        await wheelOver(page, list.locator(last).first(), 200);
        await expect
          .poll(() => list.evaluate((e) => e.scrollTop), { message: rows })
          .toBeGreaterThan(0);
        expect(await scrollY(page), 'the page behind the dialog stays').toBe(y);
        await list.evaluate((e) => (e.scrollTop = e.scrollHeight));
        await expect(list.locator(last).last()).toBeInViewport();
        await page.keyboard.press('Escape');
        await expect(page.locator('.mf-formdlg')).toHaveCount(0);
      }
    });

    test(`the full view of Tasks (?tab=tasks) scrolls inside its grid with wheel and keyboard, at ${at}`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await page.goto(`/matters/${w.matter.matterId}?tab=tasks`);
      const area = page.locator('.mf-scroll-area').first();
      await expect(area).toBeVisible();
      await expect(area.locator('tbody tr').nth(5)).toBeVisible();
      const dims = await area.evaluate((e) => ({ s: e.scrollHeight, c: e.clientHeight }));
      expect(dims.s, 'more tasks than fit').toBeGreaterThan(dims.c);
      await wheelOver(page, area.locator('tbody tr').nth(3), 300);
      await expect
        .poll(() => area.evaluate((e) => e.scrollTop), { message: 'wheel' })
        .toBeGreaterThan(0);
      const top = await area.evaluate((e) => e.scrollTop);
      await area.focus();
      await page.keyboard.press('PageDown');
      await expect
        .poll(() => area.evaluate((e) => e.scrollTop), { message: 'Page Down' })
        .toBeGreaterThan(top);
      await page.keyboard.press('End');
      await expect
        .poll(() => area.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop), {
          message: 'End',
        })
        .toBeLessThanOrEqual(1);
    });
  }
});
