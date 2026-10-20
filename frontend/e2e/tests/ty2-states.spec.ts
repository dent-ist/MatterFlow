import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { LISTS, ListKind } from '../support/admin-lists';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * WP-TY2 list states of the Task Types administration (#370): the skeleton has the table's columns and the list loads without a layout
 * shift, a failure is one message with the reference and Retry, the first-run text has no second "New" button, and a list without a
 * match offers Clear filters. Screenshots go to E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty2-shell).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;
const KINDS: ListKind[] = ['types', 'workflows', 'steps'];
const dataRows = (page: Page) => page.locator('tbody tr[data-row]');

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function noSideScroll(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${what}: page-level horizontal scroll`).toBeLessThanOrEqual(0);
}

/** The list's GET endpoint of each kind (not the single record, not the tags). */
const LIST_API: Record<ListKind, (url: URL) => boolean> = {
  types: (url) => url.pathname === '/api/v1/task-types',
  workflows: (url) => url.pathname === '/api/v1/workflows',
  steps: (url) => url.pathname === '/api/v1/step-definitions',
};
const EMPTY_BODY: Record<ListKind, unknown> = {
  types: [],
  workflows: { items: [], total: 0, page: 1, pageSize: 25 },
  steps: { items: [], total: 0, page: 1, pageSize: 25 },
};

/** Starts counting layout shifts before the app starts (the sum of the shifts that did not follow an input). */
async function watchShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
      }[]) {
        if (!e.hadRecentInput) w.__cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

const shifts = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls);

test.describe('list loading, error and empty states follow the grid-body pattern (#370)', () => {
  for (const kind of KINDS) {
    const info = LISTS[kind];

    test(`${kind}: the skeleton has the table's columns and the list loads without a layout shift`, async ({
      page,
    }) => {
      await watchShifts(page);
      for (const size of SIZES) {
        await page.setViewportSize(size);
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        await page.route(LIST_API[kind], async (route) => {
          await held;
          await route.continue();
        });
        await page.goto(info.list);
        const skeleton = page.locator('tbody [data-skeleton]');
        if (size.width >= 640) {
          await expect(skeleton).toHaveCount(5);
          const columns = await page.locator('thead tr').first().locator('th').count();
          const cells = await skeleton.first().locator('td').count();
          expect(cells, `${kind} at ${size.width}: skeleton cells`).toBe(columns);
          // Where each column starts while loading, and once loaded: the grid does not jump.
          const left = () =>
            page
              .locator('thead tr')
              .first()
              .locator('th')
              .evaluateAll((ths) => ths.map((th) => Math.round(th.getBoundingClientRect().left)));
          const before = await left();
          release();
          await expect(dataRows(page).first()).toBeVisible();
          await page.waitForTimeout(500);
          const after = await left();
          const drift = Math.max(...before.map((x, i) => Math.abs(x - after[i])));
          test.info().annotations.push({
            type: 'drift',
            description: `${kind} at ${size.width}: ${drift}px (${before} -> ${after})`,
          });
        } else {
          release();
          await expect(
            page.locator('mf-record-card-list, tbody[mfGridBody]').first(),
          ).toBeVisible();
          await page.waitForTimeout(500);
        }
        const cls = await shifts(page);
        test
          .info()
          .annotations.push({ type: 'cls', description: `${kind} at ${size.width}: ${cls}` });
        expect(cls, `${kind} at ${size.width}: layout shift`).toBeLessThan(0.02);
        await page.unroute(LIST_API[kind]);
      }
    });

    test(`${kind}: a failed load is one message with the reference and Retry; Retry brings the rows`, async ({
      page,
    }) => {
      const reference = `ref-${uid()}`;
      let fail = true;
      await page.route(LIST_API[kind], (route) =>
        fail
          ? route.fulfill({
              status: 500,
              contentType: 'application/problem+json',
              body: JSON.stringify({ status: 500, code: 'INTERNAL_ERROR', traceId: reference }),
            })
          : route.continue(),
      );
      for (const size of SIZES) {
        await page.setViewportSize(size);
        fail = true;
        await page.goto(info.list);
        const error = page.locator('[data-error]');
        await expect(error).toContainText(`Couldn't load ${info.noun}.`);
        await expect(error.locator('[data-error-reference]')).toContainText(reference);
        await expect(error.getByRole('button', { name: 'Retry' })).toBeVisible();
        // The header and the tabs stay; one message, no toast.
        await expect(page.getByRole('heading', { name: 'Task Types', level: 1 })).toBeVisible();
        await expect(page.locator('[data-toast]')).toHaveCount(0);
        if (axeAvailable()) expect(await axeViolations(page), `error at ${size.width}`).toEqual([]);
        await noSideScroll(page, `${kind} error at ${size.width}`);
        await shot(page, `p370-${kind}-error`);
        fail = false;
        await error.getByRole('button', { name: 'Retry' }).click();
        await expect(
          dataRows(page).first().or(page.locator('li[data-record-card]').first()),
        ).toBeVisible();
        await expect(page.locator('[data-error]')).toHaveCount(0);
      }
    });

    test(`${kind}: the first-run text has no second "New" button under the header's one, and no-match offers Clear filters`, async ({
      page,
    }) => {
      await page.route(LIST_API[kind], (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(EMPTY_BODY[kind]),
        }),
      );
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await page.goto(info.list);
        const empty = page.locator('[data-empty="none"]');
        await expect(empty).toBeVisible();
        await expect(empty.locator('a, button')).toHaveCount(0);
        // The one way to create is the header's button.
        await expect(
          page
            .locator('mf-page-header')
            .getByRole('button', { name: /New (task type|workflow|step)/ }),
        ).toBeVisible();
        if (axeAvailable()) expect(await axeViolations(page), `empty at ${size.width}`).toEqual([]);
        await noSideScroll(page, `${kind} empty at ${size.width}`);
        await shot(page, `p370-${kind}-empty`);
      }
      await page.unroute(LIST_API[kind]);
      await page.setViewportSize(SIZES[0]);
      await page.goto(`${info.list}?${info.filter}=zz-no-such-${uid()}`);
      const none = page.locator('[data-empty="filtered"]');
      await expect(none).toContainText(`No ${info.noun} match these filters`);
      await expect(none.getByRole('button', { name: 'Clear filters' })).toBeVisible();
      await shot(page, `p370-${kind}-no-match`);
      await none.getByRole('button', { name: 'Clear filters' }).click();
      await expect(dataRows(page).first()).toBeVisible();
    });
  }

  test('permissions: Task.View only gets the 403 page, not an empty list', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([role.name], 'ty2-viewer2')).username);
    for (const kind of KINDS) {
      await viewer.goto(LISTS[kind].list);
      await expect(
        viewer.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();
    }
  });
});
