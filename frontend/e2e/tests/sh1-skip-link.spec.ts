import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeBestPractice } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * App shell SH1 (epic #585): #586 the "Skip to ..." link names an element that exists, #587 the phone search button's aria-controls.
 * Axe runs with the best-practice tag at 1366x768, 1920x1080, 768x1024 and 375x812; no page-level horizontal scroll. With E2E_SCREENSHOTS set
 * the run writes the screenshots of docs/ux/shell-review/fixes/sh1-critical.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeBestPractice(page), what).toEqual([]);
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const e = document.scrollingElement!;
    return { sw: e.scrollWidth, cw: e.clientWidth };
  });
  expect(m.sw, 'page scrolls sideways').toBeLessThanOrEqual(m.cw);
}

let projectId: number;
/** A search text that finds one record only (a long suggestion list scrolls, which is the Search epic's to make keyboard reachable). */
let searchText: string;
let technician: string;
let observer: string;
let viewOnly: string;
let pending: string;
let podId: number;

test.beforeAll(async ({ seed }) => {
  const world = await seed.world();
  await seed.task(world);
  searchText = world.client.name;
  projectId = (await seed.project(world.matter)).projectId;
  const tech = await seed.user(['Data Technician'], 'tech');
  technician = tech.username;
  const pod = await seed.pod(undefined, [tech.userId]);
  podId = pod.podId;
  const role = await seed.role(
    ['Task.View', 'Client.View', 'Matter.View', 'Project.View', 'Pod.View', 'Asset.View'],
    'E2E read only',
  );
  observer = (await seed.user([role.name], 'obs')).username;
  const taskOnly = await seed.role(['Task.View'], 'E2E task view');
  viewOnly = (await seed.user([taskOnly.name], 'tv')).username;
  pending = (await seed.user([], 'pend')).username;
});

const LIST_PAGES: { name: string; url: () => string; skip: RegExp }[] = [
  { name: 'My Work', url: () => '/my-work', skip: /Skip to task list/ },
  { name: 'Task Queue', url: () => '/tasks', skip: /Skip to task list/ },
  { name: 'Clients', url: () => '/clients', skip: /Skip to table/ },
  { name: 'Matters', url: () => '/matters', skip: /Skip to table/ },
  { name: 'Projects', url: () => '/projects', skip: /Skip to table/ },
  {
    name: 'Project record',
    url: () => `/projects/${projectId}`,
    skip: /Skip to (task list|table)/,
  },
];

test.describe('Skip link target (#586)', () => {
  test('on every list page the link names an element that exists; Enter focuses a row; the next Tab leaves it', async ({
    page,
  }) => {
    for (const p of LIST_PAGES) {
      await page.goto(p.url());
      await expect(page.getByRole('heading').first(), p.name).toBeVisible({
        timeout: 30_000,
      });
      const skip = page.locator('a.mf-skip[data-skip-list]');
      await expect(skip, p.name).toHaveText(p.skip);
      const href = (await skip.getAttribute('href'))!;
      expect(href.startsWith('#'), p.name).toBe(true);
      await expect(page.locator(`[id="${href.slice(1)}"]`), `${p.name} target`).toHaveCount(1);
      await page.keyboard.press('Tab');
      await expect(skip, p.name).toBeFocused();
      await page.keyboard.press('Enter');
      const inside = await page.evaluate(
        (id) => !!document.getElementById(id)?.contains(document.activeElement),
        href.slice(1),
      );
      expect(inside, `${p.name}: focus is inside the list region`).toBe(true);
      await page.evaluate(() => {
        (window as unknown as { __row: Element | null }).__row = document.activeElement;
      });
      await page.keyboard.press('Tab');
      const moved = await page.evaluate(
        () =>
          document.activeElement !== (window as unknown as { __row: Element | null }).__row &&
          document.activeElement !== document.body,
      );
      expect(moved, `${p.name}: Tab moves on`).toBe(true);
      expect(await skip.evaluate((el) => el === document.activeElement)).toBe(false);
    }
  });

  test('axe best-practice is clean on the list pages and no page scrolls sideways, at four sizes', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      for (const p of LIST_PAGES) {
        await page.goto(p.url());
        await expect(page.getByRole('heading').first(), p.name).toBeVisible({
          timeout: 30_000,
        });
        await expect(page.locator('a.mf-skip[data-skip-list]')).toHaveText(p.skip);
        await axeClean(page, `${p.name} at ${w}x${h}`);
        await noSidewaysScroll(page);
        if (p.name === 'My Work' || p.name === 'Clients')
          await shot(page, p.name.replace(' ', '-').toLowerCase());
      }
    }
  });

  test('Pod Work for a technician with a pod: link, target, Enter and axe', async ({ asUser }) => {
    const page = await asUser(technician);
    await page.goto('/pods/work');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const skip = page.locator('a.mf-skip[data-skip-list]');
    await expect(skip).toHaveText(/Skip to task list/);
    const href = (await skip.getAttribute('href'))!;
    await expect(page.locator(`[id="${href.slice(1)}"]`)).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    expect(
      await page.evaluate(
        (id) => !!document.getElementById(id)?.contains(document.activeElement),
        href.slice(1),
      ),
    ).toBe(true);
    await axeClean(page, 'Pod Work technician');
    expect(podId).toBeGreaterThan(0);
  });

  test('permission variants: the link, when drawn, always names an element that exists', async ({
    asUser,
  }) => {
    for (const who of [technician, observer, viewOnly]) {
      const page = await asUser(who);
      for (const url of ['/my-work', '/tasks', '/clients', '/matters', '/projects']) {
        await page.goto(url);
        await expect(page.locator('main, h1').first()).toBeVisible();
        await page.waitForTimeout(300);
        const hrefs = await page
          .locator('a.mf-skip[data-skip-list]')
          .evaluateAll((a) => a.map((x) => x.getAttribute('href')));
        for (const href of hrefs) {
          await expect(page.locator(`[id="${href!.slice(1)}"]`), `${who} ${url}`).toHaveCount(1);
        }
      }
      await axeClean(page, `${who} /tasks`);
    }
  });

  test('a pending user sees no skip link to a list', async ({ asUser }) => {
    const page = await asUser(pending);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /access is pending/i })).toBeVisible();
    await expect(page.locator('a.mf-skip[data-skip-list]')).toHaveCount(0);
    await axeClean(page, 'access pending');
  });
});

test.describe('Phone search (#587)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('aria-controls names the search row; axe is clean closed, open and with suggestions; Esc returns focus', async ({
    page,
  }) => {
    await page.goto('/my-work');
    const button = page.getByTestId('search-button');
    await expect(button).toHaveAttribute('aria-controls', 'mf-search-row');
    await expect(page.locator('#mf-search-row')).toHaveCount(1);
    await axeClean(page, 'search closed');
    await button.click();
    await expect(page.locator('header.mf-header--search-open')).toBeVisible();
    await expect(page.locator('#mf-search-row input')).toBeFocused();
    await axeClean(page, 'search open');
    await page.locator('#mf-search-row input').fill(searchText);
    await expect(page.locator('[data-search-panel]')).toBeVisible();
    await axeClean(page, 'search suggestions');
    await shot(page, 'phone-search-suggestions');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
    await noSidewaysScroll(page);
  });
});
