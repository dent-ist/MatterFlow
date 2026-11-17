import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * The jump strip of the one-page Matter (#1396, D-03b): the highlighted link follows the scroll, gives every section its turn (an empty Productions included), a click makes
 * exactly that link current and keeps it so, and the last section is current at the bottom. Matter "short" has tasks, projects, assets and ONE note but no production, so the
 * page ends soon after Productions; matter "one" has a single task and nothing else.
 */
const SIZES = [
  [1366, 768],
  [1920, 1080],
] as const;
const ORDER = ['summary', 'tasks', 'projects', 'assets', 'productions', 'notes'];

interface World {
  short: Json;
  one: Json;
}

async function build(seed: Seeder): Promise<World> {
  const token = uid();
  const base = await seed.world();
  const client = await seed.client({ name: `Jump spy client ${token}` });
  const short = await seed.matter({ client, number: '00001', name: `Jump spy short ${token}` });
  const one = await seed.matter({ client, number: '00002', name: `Jump spy one ${token}` });
  for (const [m, count] of [
    [short, 14],
    [one, 1],
  ] as const) {
    const world = { matter: m, taskType: base.taskType, workflow: base.workflow };
    for (let i = 1; i <= count; i++)
      await seed.task(world, { title: `Jump spy task ${i} ${token}` });
  }
  for (let i = 1; i <= 3; i++) await seed.project(short, `Jump spy project ${i} ${token}`);
  for (let i = 1; i <= 12; i++) await seed.asset(short, `Jump spy asset ${i} ${token}`);
  await seed.admin.post('/api/v1/notes', {
    matterId: short.matterId,
    bodyHtml: '<h1>Jump spy note</h1><p>Body</p>',
    tagIds: [],
  });
  return { short, one };
}

const ready = (page: Page) => expect(page.locator('[data-matter-one-page]')).toBeVisible();
const links = (page: Page) => page.locator('[data-jump-strip] [data-jump]');
const link = (page: Page, key: string) => page.locator(`[data-jump-strip] [data-jump="${key}"]`);

/** The keys of the links that are current (there is always exactly one). */
const currents = (page: Page): Promise<string[]> =>
  page
    .locator('[data-jump-strip] [data-jump][aria-current]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-jump') ?? ''));

const keysOf = (page: Page): Promise<string[]> =>
  links(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-jump') ?? ''));

/** Scrolls from the top to the bottom in small steps and returns the current link after each one, without repeats. */
async function scrollThrough(page: Page): Promise<string[]> {
  const seen: string[] = [];
  const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  for (let y = 0; y <= max + 40; y += 40) {
    await page.evaluate((to) => window.scrollTo(0, to), Math.min(y, max));
    await page.waitForTimeout(40);
    const now = await currents(page);
    expect(now).toHaveLength(1);
    if (seen[seen.length - 1] !== now[0]) seen.push(now[0]);
  }
  return seen;
}

/** The sections in the list appear in the page order, each at most once. */
function inOrder(seen: string[], keys: string[]): void {
  const idx = seen.map((k) => keys.indexOf(k));
  expect(idx.every((i) => i >= 0)).toBe(true);
  expect(idx).toEqual([...idx].sort((a, b) => a - b));
  expect(new Set(seen).size).toBe(seen.length);
}

/** Clicks every link; exactly that link is current right away and after 1.5 s, the section heading is right under the strip when the page can scroll that far. */
async function clickEach(page: Page, keys: string[]): Promise<void> {
  for (const key of [...keys, ...[...keys].reverse(), keys[0]]) {
    await link(page, key).click();
    await expect
      .poll(() => currents(page), { message: `right after the click on ${key}`, timeout: 1000 })
      .toEqual([key]);
    await page.waitForTimeout(1500);
    expect(await currents(page), `1.5 s after the click on ${key}`).toEqual([key]);
    if (key !== 'summary') await expect(page.locator(`#section-${key}-h`)).toBeFocused();
  }
}

test.describe('Matter jump strip highlight (#1396)', () => {
  let w: World;
  test.setTimeout(120_000);
  test.beforeAll(async ({ seed }) => {
    test.setTimeout(300_000);
    w = await build(seed);
  });

  for (const [width, height] of SIZES) {
    test.describe(`${width}x${height}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height });
      });

      test('scrolling through the page highlights every section in order, an empty Productions included, and Notes at the bottom', async ({
        page,
      }) => {
        await page.goto(`/matters/${w.short.matterId}`);
        await ready(page);
        const seen = await scrollThrough(page);
        expect(seen).toEqual(ORDER);
        // And back up.
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect.poll(() => currents(page)).toEqual(['summary']);
      });

      test('the last section is current at the bottom of the page', async ({ page }) => {
        await page.goto(`/matters/${w.short.matterId}`);
        await ready(page);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect.poll(() => currents(page)).toEqual(['notes']);
      });

      test('a click on each link makes exactly that link current and it stays, an empty Productions included', async ({
        page,
      }) => {
        await page.goto(`/matters/${w.short.matterId}`);
        await ready(page);
        await clickEach(page, ORDER);
      });

      test('a click on Productions stays on Productions with reduced motion too, until the person scrolls', async ({
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(`/matters/${w.short.matterId}`);
        await ready(page);
        await link(page, 'productions').click();
        await page.waitForTimeout(1200);
        expect(await currents(page)).toEqual(['productions']);
        // The heading is under the strip, not hidden behind it.
        const [stripBottom, headingTop] = await page.evaluate(() => [
          document.querySelector('[data-jump-strip]')!.getBoundingClientRect().bottom,
          document.getElementById('section-productions-h')!.getBoundingClientRect().top,
        ]);
        expect(headingTop).toBeGreaterThanOrEqual(stripBottom - 1);
        // A wheel step releases the held link; the highlight then follows the scroll again.
        await page.mouse.move(width / 2, height / 2);
        await page.mouse.wheel(0, -700);
        await expect.poll(() => currents(page)).not.toEqual(['productions']);
        expect(await currents(page)).toHaveLength(1);
      });

      test('a matter with one task and nothing else: every section has its turn and every click sticks', async ({
        page,
      }) => {
        await page.goto(`/matters/${w.one.matterId}`);
        await ready(page);
        const keys = await keysOf(page);
        expect(keys).toEqual(ORDER);
        inOrder(await scrollThrough(page), keys);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect.poll(() => currents(page)).toEqual(['notes']);
        await clickEach(page, keys);
      });

      test('a limited viewer (no Assets) gets the same: each section current in turn, every click sticks', async ({
        personas,
        asUser,
      }) => {
        const viewer = await personas.create({
          label: 'jumpspy',
          permissions: [
            'Matter.View',
            'Client.View',
            'Task.View',
            'Project.View',
            'Production.View',
            'MatterNote.View',
          ],
        });
        const limited = await asUser(viewer.username);
        await limited.setViewportSize({ width, height });
        await limited.goto(`/matters/${w.short.matterId}`);
        await ready(limited);
        const keys = await keysOf(limited);
        expect(keys).toEqual(['summary', 'tasks', 'projects', 'productions', 'notes']);
        const seen = await scrollThrough(limited);
        expect(seen).toEqual(keys);
        await clickEach(limited, keys);
      });
    });
  }
});
