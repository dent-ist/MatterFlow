import fs from 'node:fs';
import path from 'node:path';
import { Page, Route } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Clients UX epic, WP2 (#251 list states, #252 matter reference never breaks). The three lists and the client's Matters tab show
 * loading (five skeleton rows, one polite "Loading ..."), a 500 (text, Retry, error reference; Retry puts focus on the rows), a 403
 * (no Retry), empty (first-run text and action) and filtered-empty (Clear filters) at 1366x768, 1920x1080, 768x1024 and 375x812: axe
 * finds nothing and the page never scrolls sideways. The reference `00107-00001` stays on one line at 768 and 375 in every table that
 * shows it. Route stubs only change what the list requests answer; the page, the router and the permissions are real.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/clients-review/fixes/wp2).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

type Mode = 'hung' | 'error' | 'forbidden' | 'empty';

interface ListSpec {
  name: string;
  /** The API path the list asks for. */
  api: string;
  /** The page, with the client id for the tab. */
  url: (clientId: number) => string;
  noun: string;
  none: RegExp;
  action?: string;
}

const LISTS: ListSpec[] = [
  {
    name: 'clients',
    api: '/api/v1/clients',
    url: () => '/clients',
    noun: 'clients',
    none: /No clients yet\./,
    action: 'New client',
  },
  {
    name: 'matters',
    api: '/api/v1/matters',
    url: () => '/matters',
    noun: 'matters',
    none: /No matters yet\./,
    action: 'New matter',
  },
  {
    name: 'projects',
    api: '/api/v1/projects',
    url: () => '/projects',
    noun: 'projects',
    none: /No projects yet\. Open a matter and choose New project\./,
  },
  {
    name: 'client-matters',
    api: '/api/v1/matters',
    url: (id) => `/clients/${id}?tab=matters`,
    noun: 'matters',
    none: /No matters yet for this client\./,
  },
];

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

/**
 * Answers the list's own request (the API path, not the page) per mode. `hung` never answers; `error` answers 500 with a reference once
 * and then passes through (so Retry works); `forbidden` is a 403; `empty` is a page with no rows.
 */
async function stub(page: Page, api: string, mode: Mode, counter?: { n: number }): Promise<void> {
  await page.route(
    (url) => url.pathname === api,
    async (route: Route) => {
      if (counter) counter.n++;
      if (mode === 'hung') return new Promise<void>(() => undefined);
      if (mode === 'error') {
        if (counter && counter.n > 1) return route.fallback();
        return route.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Server error',
            status: 500,
            code: 'SERVER_ERROR',
            traceId: 'wp2-trace-0001',
          }),
        });
      }
      if (mode === 'forbidden') {
        return route.fulfill({
          status: 403,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Forbidden',
            status: 403,
            code: 'FORBIDDEN',
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 25 }),
      });
    },
  );
}

/** Lines of text in an element: one client rect per line box of its text. */
async function lines(page: Page, selector: string): Promise<number[]> {
  return page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel)).map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
      return tops.size;
    });
  }, selector);
}

async function world(seed: Seeder) {
  const tag = uid();
  const client = await seed.client({ name: `WP2 client ${tag}` });
  const matter = await seed.matter({ client, name: `WP2 matter ${tag}`, number: '00001' });
  const project = await seed.project(matter, `WP2 project ${tag}`);
  const asset = await seed.asset(matter, `WP2 asset ${tag}`);
  return { tag, client, matter, project, asset };
}

test.describe('WP2 list states (#251)', () => {
  for (const list of LISTS) {
    test.describe(list.name, () => {
      let clientId = 0;
      test.beforeAll(async ({ seed }) => {
        clientId = (await world(seed)).client.clientId;
      });

      test('loading: five skeleton rows of 44 px, the header stays, one polite message', async ({
        page,
      }) => {
        test.setTimeout(120_000);
        await stub(page, list.api, 'hung');
        for (const [w, h] of SIZES) {
          await page.setViewportSize({ width: w, height: h });
          await page.goto(list.url(clientId));
          const body = page.locator('tbody[mfgridbody]');
          await expect(body.locator('tr[data-skeleton]')).toHaveCount(5);
          await expect(body).toHaveAttribute('aria-busy', 'true');
          await expect(body.locator('[data-loading]')).toHaveText(`Loading ${list.noun}`);
          await expect(body.locator('[data-loading]')).toHaveAttribute('role', 'status');
          await expect(page.locator('thead th').first()).toBeVisible();
          const heights = await body
            .locator('tr[data-skeleton]')
            .evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
          for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
          for (const height of heights) expect(height).toBeLessThanOrEqual(45);
          await axeClean(page, `${list.name} loading ${w}`);
          await noSideways(page, `${list.name} loading ${w}`);
          await shot(page, `${list.name}-loading`);
        }
      });

      test('500: text, error reference, Retry; a good Retry puts focus on the rows', async ({
        page,
      }) => {
        test.setTimeout(120_000);
        for (const [w, h] of SIZES) {
          await page.unrouteAll();
          const counter = { n: 0 };
          await stub(page, list.api, 'error', counter);
          await page.setViewportSize({ width: w, height: h });
          await page.goto(list.url(clientId));
          const error = page.locator('tbody [data-error]');
          await expect(error).toContainText(`Couldn't load ${list.noun}.`);
          await expect(error.locator('[data-error-reference]')).toContainText('wp2-trace-0001');
          await expect(error.getByRole('button', { name: 'Retry' })).toBeVisible();
          await axeClean(page, `${list.name} error ${w}`);
          await noSideways(page, `${list.name} error ${w}`);
          await shot(page, `${list.name}-error`);

          await error.getByRole('button', { name: 'Retry' }).click();
          await expect(page.locator('tbody [data-error]')).toHaveCount(0);
          // The row region (a row link, or the scrollable region when the list has no row) holds focus.
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  !!document.activeElement?.closest('tbody') ||
                  document.activeElement?.classList.contains('mf-scroll-area'),
              ),
            )
            .toBe(true);
        }
      });

      test('403: "You don\'t have access", no Retry', async ({ page }) => {
        test.setTimeout(120_000);
        await stub(page, list.api, 'forbidden');
        for (const [w, h] of SIZES) {
          await page.setViewportSize({ width: w, height: h });
          await page.goto(list.url(clientId));
          const cell = page.locator('tbody [data-forbidden]');
          await expect(cell).toHaveText(`You don't have access to ${list.noun}.`);
          await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
          await axeClean(page, `${list.name} forbidden ${w}`);
          await noSideways(page, `${list.name} forbidden ${w}`);
          await shot(page, `${list.name}-forbidden`);
        }
      });

      test('empty: first-run text and the right action; filtered-empty: Clear filters', async ({
        page,
      }) => {
        test.setTimeout(120_000);
        await stub(page, list.api, 'empty');
        for (const [w, h] of SIZES) {
          await page.setViewportSize({ width: w, height: h });
          await page.goto(list.url(clientId));
          const none = page.locator('tbody td[data-empty=none]');
          await expect(none).toContainText(list.none);
          if (list.action) {
            await expect(none.getByRole('button', { name: list.action })).toBeVisible();
          }
          if (list.name === 'projects') {
            await expect(none.getByRole('link', { name: 'Open a matter' })).toHaveAttribute(
              'href',
              '/matters',
            );
          }
          await axeClean(page, `${list.name} empty ${w}`);
          await noSideways(page, `${list.name} empty ${w}`);
          await shot(page, `${list.name}-empty`);

          const sep = list.url(clientId).includes('?') ? '&' : '?';
          await page.goto(`${list.url(clientId)}${sep}name=zzz-no-match`);
          const filtered = page.locator('tbody td[data-empty=filtered]');
          await expect(filtered).toContainText(`No ${list.noun} match these filters`);
          await expect(filtered.getByRole('button', { name: 'Clear filters' })).toBeVisible();
          await axeClean(page, `${list.name} filtered-empty ${w}`);
          await noSideways(page, `${list.name} filtered-empty ${w}`);
          await shot(page, `${list.name}-filtered-empty`);
        }
      });
    });
  }

  test('no layout shift when the rows arrive (CLS under 0.02)', async ({ page, seed }) => {
    test.setTimeout(120_000);
    const w = await world(seed);
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[]) {
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    // Hold the answer for a moment, so the skeleton is on screen before the real rows replace it.
    for (const [api, url] of [
      ['/api/v1/clients', '/clients'],
      ['/api/v1/matters', '/matters'],
      ['/api/v1/projects', '/projects'],
      ['/api/v1/matters', `/clients/${w.client.clientId}?tab=matters`],
    ] as const) {
      for (const [width, height] of [SIZES[0], SIZES[3]]) {
        await page.unrouteAll();
        await page.route(
          (u) => u.pathname === api,
          async (route) => {
            await new Promise((r) => setTimeout(r, 900));
            await route.fallback();
          },
        );
        await page.setViewportSize({ width, height });
        await page.goto(`${url}${url.includes('?') ? '&' : '?'}name=${w.tag}`);
        await expect(page.locator('tbody tr[data-skeleton]')).toHaveCount(5);
        await expect(page.locator('tbody tr[data-skeleton]')).toHaveCount(0);
        await page.waitForTimeout(300);
        const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
        expect(cls, `${url} at ${width}`).toBeLessThan(0.02);
      }
    }
  });
});

test.describe('WP2 matter reference on one line (#252)', () => {
  test('the reference never breaks at its hyphen at 768 and 375', async ({ page, seed }) => {
    test.setTimeout(120_000);
    const w = await world(seed);
    const ref = w.matter.matterRef as string;
    const tables = [
      {
        name: 'matters-list',
        url: `/matters?matterRef=${ref}`,
        cell: 'tbody mf-matter-ref .mf-ref',
      },
      {
        name: 'client-matters',
        url: `/clients/${w.client.clientId}?tab=matters`,
        cell: 'tbody mf-matter-ref .mf-ref',
      },
      {
        name: 'projects-list',
        url: `/projects?name=${w.tag}`,
        cell: 'tbody mf-matter-ref .mf-ref',
      },
      { name: 'assets-list', url: `/assets?name=${w.tag}`, cell: 'tbody mf-matter-ref .mf-ref' },
    ];
    for (const [width, height] of [SIZES[2], SIZES[3], SIZES[0], SIZES[1]]) {
      await page.setViewportSize({ width, height });
      for (const t of tables) {
        await page.goto(t.url);
        const cell = page.locator(t.cell).first();
        await expect(cell, `${t.name} at ${width}`).toBeVisible();
        await expect(cell).toHaveText(ref);
        expect(await lines(page, t.cell), `${t.name} at ${width}`).toEqual(
          expect.arrayContaining([1]),
        );
        expect(
          (await lines(page, t.cell)).every((n) => n === 1),
          `${t.name} at ${width}`,
        ).toBe(true);
        // The copy button stays beside the reference, on the same line.
        const copy = page.locator('tbody mf-matter-ref mf-copy-button').first();
        if (await copy.count()) {
          const a = (await cell.boundingBox())!;
          const b = (await copy.boundingBox())!;
          expect(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)), t.name).toBeLessThan(
            a.height,
          );
        }
        await axeClean(page, `${t.name} ${width}`);
        await noSideways(page, `${t.name} ${width}`);
        if (width === 768 || width === 375) await shot(page, `reference-${t.name}`);
      }
    }
  });
});
