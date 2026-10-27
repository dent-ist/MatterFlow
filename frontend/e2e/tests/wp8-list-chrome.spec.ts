import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Clients UX epic, WP8 list chrome (#269 rows, #270 filter row, #271 Status and the hidden count, #272 Sensitive). On the three record
 * lists and the client's Matters tab: every body row is 44 px whatever the name length, names clamp at two lines with the full text as
 * tooltip, the filter row is open by default from 640 px and remembered, one chip rule with exactly one Clear filters, the default
 * Status is neither counted nor chipped, the pager says how many inactive records are hidden, and Sensitive is a select in the filter
 * row (no "Other filters"). axe finds nothing and the page never scrolls sideways at 1366x768, 1920x1080, 768x1024 and 375x812.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/clients-review/fixes/wp8).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

const grid = (page: Page, name: string) =>
  page.getByRole('region', { name: `${name}, scrollable` });
const toggle = (page: Page) => page.getByRole('button', { name: /^Filters/ });
const text = (page: Page, column: string) =>
  page.getByRole('textbox', { name: `Filter by ${column}` });
const select = (page: Page, column: string) =>
  page.getByRole('combobox', { name: `Filter by ${column}` });

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

async function noSideways(page: Page, what: string): Promise<void> {
  const widths = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(widths.doc, `${what}: page scrolls sideways`).toBeLessThanOrEqual(widths.inner);
}

/** Heights of the body rows that hold data (not skeleton or state rows). */
async function rowHeights(page: Page, region: string): Promise<number[]> {
  return grid(page, region)
    .locator('tbody tr:not([data-skeleton]):not(.gb-state)')
    .evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height));
}

/** Body rows that are fully inside the scroll area (what the person sees without scrolling). */
async function rowsInView(page: Page, region: string): Promise<number> {
  return grid(page, region).evaluate((area) => {
    const bottom = area.getBoundingClientRect().bottom;
    return Array.from(area.querySelectorAll('tbody tr')).filter(
      (r) => r.getBoundingClientRect().bottom <= bottom + 0.5,
    ).length;
  });
}

interface ListSpec {
  name: string;
  region: string;
  url: (w: World, query?: string) => string;
  /** The text filter that finds this test's records. */
  scope: (w: World) => string;
  long: (w: World) => string;
}

interface World {
  token: string;
  client: Json;
  longClient: Json;
  matters: Json[];
  longMatter: Json;
  sensitiveMatter: Json;
  longProject: Json;
}

const LONG_CLIENT = (t: string) =>
  `Wp8 long client ${t} ` + 'with a very long registered name that runs on and on '.repeat(2);
const LONG_MATTER = (t: string) =>
  `Wp8 long matter ${t} ` + 'about an extremely detailed and wide ranging dispute '.repeat(3);
const LONG_PROJECT = (t: string) =>
  `Wp8 long project ${t} ` + 'covering the document review for all custodians '.repeat(3);

async function world(seed: Seeder, admin: Api): Promise<World> {
  const token = uid();
  const client = await seed.client({ name: `Wp8 client ${token}` });
  const longClient = await seed.client({ name: LONG_CLIENT(token).slice(0, 105) });
  const matters: Json[] = [];
  for (let i = 1; i <= 3; i++) {
    matters.push(
      await seed.matter({
        client,
        number: String(i).padStart(5, '0'),
        name: `Wp8 matter ${token} ${i}`,
      }),
    );
  }
  const longMatter = await seed.matter({
    client,
    number: '00004',
    name: LONG_MATTER(token).slice(0, 150),
  });
  const sensitiveMatter = await seed.matter({
    client,
    number: '00005',
    name: `Wp8 sensitive ${token}`,
    sensitive: true,
  });
  await seed.project(matters[0], `Wp8 project ${token}`);
  const longProject = await seed.project(matters[0], LONG_PROJECT(token).slice(0, 130));
  void admin;
  return { token, client, longClient, matters, longMatter, sensitiveMatter, longProject };
}

const LISTS: ListSpec[] = [
  {
    name: 'clients',
    region: 'Clients list',
    url: (w, q = '') => `/clients?name=${w.token}${q}`,
    scope: (w) => w.token,
    long: (w) => w.longClient.name,
  },
  {
    name: 'matters',
    region: 'Matters list',
    url: (w, q = '') => `/matters?name=${w.token}${q}`,
    scope: (w) => w.token,
    long: (w) => w.longMatter.name,
  },
  {
    name: 'projects',
    region: 'Projects list',
    url: (w, q = '') => `/projects?name=${w.token}${q}`,
    scope: (w) => w.token,
    long: (w) => w.longProject.name,
  },
  {
    name: 'client-matters',
    region: 'Matters list',
    url: (w, q = '') => `/clients/${w.client.clientId}?tab=matters${q}`,
    scope: (w) => w.token,
    long: (w) => w.longMatter.name,
  },
];

test.describe('WP8 list chrome', () => {
  let w: World;
  test.beforeAll(async ({ seed, admin }) => {
    w = await world(seed, admin);
  });

  test.describe('44 px rows and the two-line clamp (#269)', () => {
    for (const list of LISTS) {
      test(`${list.name}: every row is 44 px, a long name clamps at two lines with a tooltip`, async ({
        page,
      }) => {
        test.setTimeout(120_000);
        for (const [width, height] of SIZES) {
          await page.setViewportSize({ width, height });
          await page.goto(list.url(w));
          // Below 640 px the lists are cards (WP12): at least 64 px high, the name in `data-card-name` clamps the same two lines.
          const phone = width < 640;
          const region = phone ? page.locator('ul[data-record-cards]') : grid(page, list.region);
          await expect(region.locator(phone ? 'li' : 'tbody tr').first()).toBeVisible();
          const heights = phone
            ? await region
                .locator('li')
                .evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height))
            : await rowHeights(page, list.region);
          expect(heights.length, `${list.name} ${width}`).toBeGreaterThan(0);
          for (const h of heights)
            expect(h, `${list.name} ${width}`).toBeGreaterThanOrEqual(phone ? 64 : 43);
          if (!phone)
            for (const h of heights) expect(h, `${list.name} ${width}`).toBeLessThanOrEqual(45);

          const longName = list.long(w);
          const cell = region
            .locator(
              phone ? `a[data-card-name][title="${longName}"]` : `.pg-name[title="${longName}"]`,
            )
            .first();
          await expect(cell, `${list.name} long name`).toBeVisible();
          const box = await cell.evaluate((el) => ({
            client: el.clientHeight,
            scroll: el.scrollHeight,
            line: parseFloat(getComputedStyle(el).lineHeight),
          }));
          expect(box.client).toBeLessThanOrEqual(box.line * 2 + 1); // two lines at most
          await expect(cell).toHaveAttribute('title', longName); // the full text
          await expect(cell).toHaveText(longName.trim()); // and in the DOM for assistive technology
          await noSideways(page, `${list.name} ${width}`);
        }
      });
    }

    test('the matter reference and the client number never wrap; the Name column is the spring at 1920', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(`/matters?name=${w.token}`);
      const region = grid(page, 'Matters list');
      await expect(region.locator('tbody tr').first()).toBeVisible();
      const refs = await region
        .locator('tbody .mf-ref')
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      for (const h of refs) expect(h).toBeLessThanOrEqual(22);
      const widths = await region
        .locator('thead th')
        .evaluateAll((ths) => ths.map((t) => t.getBoundingClientRect().width));
      // Reference, Name, Client, Projects, Status: the Name is the widest column and rows do not stretch.
      expect(widths[1]).toBe(Math.max(...widths));
      for (const h of await rowHeights(page, 'Matters list')) expect(h).toBeLessThanOrEqual(45);
    });

    test("the matter's Projects and Assets tabs use the same 44 px row", async ({ page, seed }) => {
      const asset = await seed.asset(w.matters[0], `Wp8 asset ${w.token}`);
      expect(asset).toBeTruthy();
      await page.setViewportSize({ width: 1366, height: 768 });
      for (const tab of ['projects', 'assets']) {
        await page.goto(`/matters/${w.matters[0].matterId}?tab=${tab}`);
        const rows = page.locator('[role="tabpanel"] tbody tr:not([data-skeleton])');
        await expect(rows.first()).toBeVisible();
        const heights = await rows.evaluateAll((trs) =>
          trs.map((r) => r.getBoundingClientRect().height),
        );
        for (const h of heights) {
          expect(h, tab).toBeGreaterThanOrEqual(43);
          expect(h, tab).toBeLessThanOrEqual(45);
        }
      }
    });
  });

  test.describe('filter row open by default and one chip rule (#270)', () => {
    for (const list of LISTS) {
      test(`${list.name}: open by default from 640 px with no toolbar-only row; Filters is in the page header`, async ({
        page,
      }) => {
        test.setTimeout(120_000);
        for (const [width, height] of SIZES) {
          await page.setViewportSize({ width, height });
          await page.goto(list.url(w));
          await expect(
            width >= 640
              ? grid(page, list.region).locator('tbody tr').first()
              : page.locator('li[data-record-card]').first(),
          ).toBeVisible();
          if (width >= 640) {
            await expect(page.locator('[data-filter-row]'), `${list.name} ${width}`).toBeVisible();
            await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
          } else {
            await expect(page.locator('[data-filter-row]')).toHaveCount(0);
            await expect(toggle(page)).toHaveAttribute('aria-haspopup', 'dialog');
          }
          if (list.name !== 'client-matters' && width >= 640) {
            // The lone button sits in the page header: no toolbar row above the grid (a phone shows the chips of the filter in the URL).
            await expect(page.locator('[data-grid-toolbar]')).toHaveCount(0);
            await expect(page.locator('[data-page-actions] [data-filters-toggle]')).toHaveCount(1);
          }
          await axeClean(page, `${list.name} open ${width}`);
          await noSideways(page, `${list.name} open ${width}`);
          await shot(page, `${list.name}-filters-open`);
        }
      });
    }

    test('the freed toolbar row gives the Clients grid more rows at 1366x768', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto('/clients');
      await expect(grid(page, 'Clients list').locator('tbody tr').first()).toBeVisible();
      const open = await rowsInView(page, 'Clients list');
      await toggle(page).click(); // closed
      await expect(page.locator('[data-filter-row]')).toHaveCount(0);
      const closed = await rowsInView(page, 'Clients list');
      test.info().annotations.push({
        type: 'rows-visible-1366x768',
        description: `open ${open}, closed ${closed}`,
      });
      expect(open).toBeGreaterThanOrEqual(10);
      expect(closed).toBeGreaterThanOrEqual(open);
      await shot(page, 'clients-filters-closed');
    });

    test('the open or closed choice is remembered per list (and per user), try/catch storage', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto('/clients');
      await expect(page.locator('[data-filter-row]')).toBeVisible();
      await toggle(page).click();
      await expect(page.locator('[data-filter-row]')).toHaveCount(0);
      await page.reload();
      await expect(grid(page, 'Clients list').locator('tbody tr').first()).toBeVisible();
      await expect(page.locator('[data-filter-row]')).toHaveCount(0);
      // Another list is not affected.
      await page.goto('/matters');
      await expect(page.locator('[data-filter-row]')).toBeVisible();
      // And back open again.
      await page.goto('/clients');
      await toggle(page).click();
      await expect(page.locator('[data-filter-row]')).toBeVisible();
      await page.reload();
      await expect(page.locator('[data-filter-row]')).toBeVisible();
    });

    test('the default Status is neither counted nor chipped; chips and one Clear filters only by the rule; Clear returns to Active', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto('/clients');
      await expect(page.locator('[data-filter-row]')).toBeVisible();
      await expect(toggle(page)).toHaveText(/^\s*Filters\s*$/);
      await expect(page.locator('[data-clear-filters]')).toHaveCount(0);

      await text(page, 'Name').fill(w.token);
      await select(page, 'Status').selectOption('all');
      await expect(page).toHaveURL(/status=all/);
      // Open: counter 2, no chips, exactly one Clear filters (in the header).
      await expect(toggle(page)).toContainText('(2)');
      await expect(page.locator('[data-chip]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(1);
      await expect(page.locator('[data-page-actions] [data-clear-filters]')).toHaveCount(1);

      // Closed: chips for the two filters changed, still exactly one Clear filters (with the chips).
      await toggle(page).click();
      await expect(page.locator('[data-chip]')).toHaveCount(2);
      await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(1);
      await expect(page.locator('[data-grid-toolbar] [data-clear-filters]')).toHaveCount(1);
      await shot(page, 'clients-filters-closed-chips');
      await page.getByRole('button', { name: 'Clear filters' }).click();
      // The default again (Active), not All: nothing in the address, nothing counted.
      await expect(page).not.toHaveURL(/status=|name=/);
      await expect(page.locator('[data-chip]')).toHaveCount(0);
      await toggle(page).click();
      await expect(select(page, 'Status')).toHaveValue('active');
    });

    test('no second Clear filters in the filtered-empty state; URL state survives a reload', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/clients?name=${uid()}-nothing&sort=-name`);
      const region = grid(page, 'Clients list');
      await expect(region.locator('td[data-empty="filtered"]')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(1);
      await toggle(page).click();
      await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(1);
      await page.reload();
      await expect(page).toHaveURL(/name=.*-nothing&sort=-name/);
    });
  });

  test.describe('Status and the hidden count (#271)', () => {
    let scoped: { token: string; client: Json };
    test.beforeAll(async ({ seed, admin }) => {
      // Three active and two inactive clients with the token; for matters and projects, two inactive/archived under a new client.
      const token = uid();
      const client = await seed.client({ name: `Wp8 hint ${token} one` });
      await seed.client({ name: `Wp8 hint ${token} two` });
      await seed.client({ name: `Wp8 hint ${token} three` });
      for (const n of ['four', 'five']) {
        const c = await seed.client({ name: `Wp8 hint ${token} ${n}` });
        await admin.put(`/api/v1/clients/${c.clientId}`, {
          name: c.name,
          isActive: false,
          rowVersion: c.rowVersion,
        });
      }
      for (let i = 1; i <= 3; i++) {
        const m = await seed.matter({
          client,
          number: String(i).padStart(5, '0'),
          name: `Wp8 hint ${token} m${i}`,
        });
        await seed.project(m, `Wp8 hint ${token} p${i}`);
      }
      for (let i = 4; i <= 5; i++) {
        const m = await seed.matter({
          client,
          number: String(i).padStart(5, '0'),
          name: `Wp8 hint ${token} m${i}`,
        });
        const p = await seed.project(m, `Wp8 hint ${token} p${i}`);
        await admin.post(`/api/v1/projects/${p.projectId}/active`, {
          isActive: false,
          rowVersion: p.rowVersion,
        });
        await admin.post(`/api/v1/matters/${m.matterId}/active`, {
          isActive: false,
          rowVersion: m.rowVersion,
        });
      }
      scoped = { token, client };
    });

    test('Clients: "of 3 active - 2 inactive hidden"; Show all lists all five; the address carries it and survives a reload', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/clients?name=${scoped.token}`);
      const rows = grid(page, 'Clients list').locator('tbody tr');
      await expect(rows).toHaveCount(3);
      const pager = page.locator('mf-pager');
      await expect(pager.locator('[data-range]')).toHaveText('Showing 1-3 of 3 active');
      await expect(pager.locator('[data-hidden-hint]')).toContainText('- 2 inactive hidden');
      await shot(page, 'clients-hidden-hint');
      await pager.getByRole('button', { name: 'Show all' }).click();
      await expect(page).toHaveURL(/status=all/);
      await expect(rows).toHaveCount(5);
      await expect(pager.locator('[data-hidden-hint]')).toHaveCount(0);
      await expect(pager.locator('[data-range]')).toHaveText('Showing 1-5 of 5');
      await page.reload();
      await expect(rows).toHaveCount(5);
      await expect(select(page, 'Status')).toHaveValue('all');
    });

    test('Status Inactive and All show no hint; the hint is not in the live region', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/clients?name=${scoped.token}&status=inactive`);
      await expect(grid(page, 'Clients list').locator('tbody tr')).toHaveCount(2);
      await expect(page.locator('[data-hidden-hint]')).toHaveCount(0);
      await select(page, 'Status').selectOption('active');
      await expect(grid(page, 'Clients list').locator('tbody tr')).toHaveCount(3);
      // Only the main result is announced.
      await expect(page.locator('[data-filter-live]')).not.toContainText('hidden');
    });

    test('Matters and the client Matters tab say "inactive", Projects says "archived"', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/matters?name=${scoped.token}`);
      await expect(page.locator('[data-range]')).toHaveText('Showing 1-3 of 3 active');
      await expect(page.locator('[data-hidden-hint]')).toContainText('- 2 inactive hidden');
      await page.goto(`/clients/${scoped.client.clientId}?tab=matters&name=${scoped.token}`);
      await expect(page.locator('[data-hidden-hint]')).toContainText('- 2 inactive hidden');
      await page.getByRole('button', { name: 'Show all' }).click();
      await expect(page).toHaveURL(/status=all/);
      await page.goto(`/projects?name=${scoped.token}`);
      await expect(page.locator('[data-range]')).toHaveText('Showing 1-3 of 3 active');
      await expect(page.locator('[data-hidden-hint]')).toContainText('- 2 archived hidden');
    });

    test('if the second count fails the hint is omitted silently and the list works', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.route(
        (url) => url.pathname === '/api/v1/clients' && url.searchParams.get('IsActive') === 'false',
        (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
      );
      await page.goto(`/clients?name=${scoped.token}`);
      await expect(grid(page, 'Clients list').locator('tbody tr')).toHaveCount(3);
      await expect(page.locator('[data-range]')).toHaveText('Showing 1-3 of 3');
      await expect(page.locator('[data-hidden-hint]')).toHaveCount(0);
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
    });

    test('the second count is one cheap request: isActive=false, pageSize=1, once per load', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const seen: string[] = [];
      page.on('request', (r) => {
        const u = new URL(r.url());
        if (u.pathname === '/api/v1/clients') seen.push(u.search);
      });
      await page.goto(`/clients?name=${scoped.token}`);
      await expect(page.locator('[data-hidden-hint]')).toBeVisible();
      expect(
        seen.filter((s) => s.includes('IsActive=false') && /PageSize=1(&|$)/.test(s)),
      ).toHaveLength(1);
      expect(seen.filter((s) => s.includes('IsActive=true'))).toHaveLength(1);
    });

    for (const [width, height] of SIZES) {
      test(`the hint fits at ${width} px: axe clean, no sideways scroll`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto(`/clients?name=${scoped.token}`);
        await expect(page.locator('[data-hidden-hint]')).toBeVisible();
        await axeClean(page, `hint ${width}`);
        await noSideways(page, `hint ${width}`);
        const box = await page.locator('mf-pager').boundingBox();
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
        await shot(page, 'clients-hidden-hint-pager');
      });
    }
  });

  test.describe('Sensitive in the filter row (#272)', () => {
    test('Matters: no "Other filters"; Sensitive Yes lists the sensitive matters and equals the API total', async ({
      page,
      admin,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/matters?name=${w.token}`);
      await expect(page.getByRole('button', { name: 'Other filters' })).toHaveCount(0);
      const sensitive = select(page, 'Sensitive');
      await expect(sensitive).toHaveValue('');
      // Up to 1499 px the two stack in the Status cell (PM v2, #881: side by side they took the room of Name and Client): under Status, same column.
      const [stackedStatus, stackedSensitive] = [
        await select(page, 'Status').boundingBox(),
        await sensitive.boundingBox(),
      ];
      expect(stackedSensitive!.y).toBeGreaterThan(stackedStatus!.y);
      expect(Math.abs(stackedSensitive!.x - stackedStatus!.x)).toBeLessThan(4);
      // From 1500 px: after Status, in the same row.
      await page.setViewportSize({ width: 1600, height: 900 });
      const [statusBox, sensitiveBox] = [
        await select(page, 'Status').boundingBox(),
        await sensitive.boundingBox(),
      ];
      expect(sensitiveBox!.x).toBeGreaterThan(statusBox!.x);
      expect(Math.abs(sensitiveBox!.y - statusBox!.y)).toBeLessThan(4);
      await shot(page, 'matters-sensitive-filter');

      await sensitive.selectOption('true');
      await expect(page).toHaveURL(/isSensitive=true/);
      const api = await admin.get<Json>(
        `/api/v1/matters?name=${w.token}&isActive=true&isSensitive=true&page=1&pageSize=25`,
      );
      expect(api.total).toBeGreaterThanOrEqual(1);
      const rows = grid(page, 'Matters list').locator('tbody tr');
      await expect(rows).toHaveCount(api.total);
      await expect(rows.first()).toContainText(`Wp8 sensitive ${w.token}`);
      await expect(page.locator('[data-range]')).toContainText(`of ${api.total}`);
      await sensitive.selectOption('false');
      await expect(rows.filter({ hasText: 'Wp8 sensitive' })).toHaveCount(0);
    });

    test('an old ?isSensitive=true link works; the chip "Sensitive: Yes" shows only with the row closed', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/matters?name=${w.token}&isSensitive=true`);
      await expect(select(page, 'Sensitive')).toHaveValue('true');
      await expect(grid(page, 'Matters list').locator('tbody tr')).toHaveCount(1);
      await expect(page.locator('[data-chip]')).toHaveCount(0);
      await toggle(page).click();
      await expect(page.getByRole('list', { name: 'Active filters' })).toContainText(
        'Sensitive: Yes',
      );
      await expect(page.getByRole('button', { name: 'Other filters' })).toHaveCount(0);
    });

    test('the client Matters tab has Sensitive too; Clients and Projects have no "Other filters"', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/clients/${w.client.clientId}?tab=matters&name=${w.token}`);
      await expect(select(page, 'Sensitive')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Other filters' })).toHaveCount(0);
      for (const url of ['/clients', '/projects']) {
        await page.goto(url);
        await expect(page.getByRole('button', { name: 'Other filters' })).toHaveCount(0);
        await expect(select(page, 'Sensitive')).toHaveCount(0);
      }
    });

    test('on a phone the Filters sheet carries Sensitive with its own label', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/matters?name=${w.token}`);
      await toggle(page).click();
      const sheet = page.getByRole('dialog', { name: 'Filters' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByLabel('Filter by Sensitive')).toBeVisible();
      await axeClean(page, 'matters sheet 375');
      await shot(page, 'matters-filters-sheet');
    });
  });

  test.describe('axe and sideways scroll at four sizes', () => {
    for (const list of LISTS) {
      test(`${list.name}: closed with chips, and filtered`, async ({ page }) => {
        test.setTimeout(180_000);
        for (const [width, height] of SIZES) {
          await page.setViewportSize({ width, height });
          await page.goto(list.url(w, '&status=all'));
          await expect(
            width >= 640
              ? grid(page, list.region).locator('tbody tr').first()
              : page.locator('li[data-record-card]').first(),
          ).toBeVisible();
          if (width >= 640)
            await toggle(page).click(); // closed: chips
          else await expect(page.locator('[data-chip]').first()).toBeVisible();
          await expect(page.locator('[data-chip]').first()).toBeVisible();
          await axeClean(page, `${list.name} chips ${width}`);
          await noSideways(page, `${list.name} chips ${width}`);
          await shot(page, `${list.name}-chips`);
        }
      });
    }
  });
});
