import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * The one continuous Matter page (#1396, epic #1389; D-03a to D-03e): sections one under the other, the sticky jump strip, lazy sections,
 * the compact cards (empty, error, no access), `?tab=` full views and "Open Full View". Screenshots go to E2E_SCREENSHOTS when it is set.
 *
 * Matter "full" has 14 open tasks, 3 projects, 12 assets, 12 notes and no production. Matter "prod" has one production.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  [1366, 768],
  [1920, 1080],
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}.png`) });
}

const html = (title: string) => `<h1>${title}</h1><p>Body of ${title}</p>`;

interface World {
  token: string;
  full: Json;
  prod: Json;
  empty: Json;
}

async function build(seed: Seeder): Promise<World> {
  const token = uid();
  const base = await seed.world();
  const client = await seed.client({ name: `One page client ${token}` });
  const full = await seed.matter({ client, number: '00001', name: `One page full ${token}` });
  const prod = await seed.matter({ client, number: '00002', name: `One page prod ${token}` });
  const empty = await seed.matter({ client, number: '00003', name: `One page empty ${token}` });
  const world = { matter: full, taskType: base.taskType, workflow: base.workflow };
  for (let i = 1; i <= 14; i++) await seed.task(world, { title: `One page task ${i} ${token}` });
  for (let i = 1; i <= 3; i++) await seed.project(full, `One page project ${i} ${token}`);
  for (let i = 1; i <= 12; i++) await seed.asset(full, `One page asset ${i} ${token}`);
  for (let i = 1; i <= 12; i++) {
    await seed.admin.post('/api/v1/notes', {
      matterId: full.matterId,
      bodyHtml: html(`One page note ${i} ${token}`),
      tagIds: [],
    });
  }
  await seed.admin.post('/api/v1/productions', {
    matterId: prod.matterId,
    name: `One page production ${token}`,
    direction: 'OUT',
  });
  return { token, full, prod, empty };
}

const ready = (page: Page) => expect(page.locator('[data-matter-one-page]')).toBeVisible();
const link = (page: Page, key: string) => page.locator(`[data-jump-strip] [data-jump="${key}"]`);
const card = (page: Page, key: string) => page.locator(`[data-section="${key}"]`);
const rows = (page: Page, key: string) =>
  card(page, key).locator(
    'tbody tr:not([data-skeleton]):not(.gb-state):not(.gb-still):has(td:not(.mf-sr-only))',
  );
const skeletonRows = (page: Page, key: string) =>
  card(page, key).locator('tr[data-skeleton], tr.gb-sk');

/** Counts the requests of the lists the sections ask for (the Summary and the header ask for others). */
function watchRequests(page: Page): Record<string, number> {
  const seen = { tasks: 0, assets: 0, productions: 0, notes: 0, activities: 0 };
  page.on('request', (r) => {
    const url = r.url();
    if (/\/api\/v1\/task-queue\?/.test(url)) seen.tasks++;
    else if (/\/api\/v1\/assets\?/.test(url)) seen.assets++;
    else if (/\/api\/v1\/productions\?/.test(url)) seen.productions++;
    else if (/\/api\/v1\/notes\?/.test(url)) seen.notes++;
    else if (/\/api\/v1\/audit\/search\?|\/audit[^?]*\?.*matterId/.test(url)) seen.activities++;
  });
  return seen;
}

test.describe('One-page Matter (#1396)', () => {
  let w: World;
  test.beforeAll(async ({ seed }) => {
    test.setTimeout(300_000);
    w = await build(seed);
  });

  for (const [width, height] of SIZES) {
    test(`shows Summary and one card per section in the tab order, with the jump strip, at ${width}x${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/matters/${w.full.matterId}`);
      await ready(page);
      await expect(page.getByRole('navigation', { name: 'Matter sections' })).toBeVisible();
      const names = (await page.locator('[data-jump-strip] a').allTextContents()).map((t) =>
        t.replace(/\s*\(.*\)\s*$/, '').trim(),
      );
      expect(names).toEqual([
        'Summary',
        'Tasks',
        'Projects',
        'Assets',
        'Productions',
        'Notes',
        'Activities',
      ]);
      await expect(page.locator('[data-jump-strip] [role=tab]')).toHaveCount(0);
      await expect(link(page, 'summary')).toHaveAttribute('aria-current', 'location');
      await expect(page.locator('[data-summary-details]')).toBeVisible();
      for (const key of ['tasks', 'projects', 'assets', 'productions', 'notes', 'activities']) {
        await expect(card(page, key).locator('h2')).toBeAttached();
        await expect(page.locator(`#section-${key}`)).toHaveAttribute(
          'aria-labelledby',
          `section-${key}-h`,
        );
      }
      await expect(card(page, 'tasks').locator('[data-section-count]')).toHaveText('14');
      await shot(page, `top`);
    });
  }

  test('?tab=summary shows the same one page', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${w.full.matterId}?tab=summary`);
    await ready(page);
    await expect(page.locator('[role=tablist]')).toHaveCount(0);
  });

  test('loads a section when it is near the window, not before; a jump loads only the target', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const seen = watchRequests(page);
    await page.goto(`/matters/${w.full.matterId}`);
    await ready(page);
    await expect(card(page, 'tasks')).toBeAttached();
    // Far sections have asked for nothing and show their placeholder (10 skeleton rows, real headings, "load when you scroll here").
    expect(seen['assets']).toBe(0);
    expect(seen['productions']).toBe(0);
    expect(seen['notes']).toBe(0);
    expect(seen['activities']).toBe(0);
    await expect(card(page, 'notes').locator('[data-section-note]')).toHaveText(
      'Notes load when you scroll here',
    );
    await expect(skeletonRows(page, 'notes')).toHaveCount(10);
    await expect(card(page, 'notes').locator('thead th')).toHaveText([
      'Title',
      'Tags',
      'Author',
      'Last Updated',
    ]);

    // A jump to the last section loads that section only.
    await link(page, 'activities').click();
    await expect(page.locator('#section-activities-h')).toBeFocused();
    await expect(rows(page, 'activities').first()).toBeVisible();
    expect(seen['activities']).toBeGreaterThan(0);
    // The sections the scroll passed (Assets, Productions) were not loaded. Notes sits directly above Activities and is in the window when the page ends, so it may load.
    expect(seen['assets']).toBe(0);
    expect(seen['productions']).toBe(0);
    await expect(link(page, 'activities')).toHaveAttribute('aria-current', 'location');
    // The address is untouched (no hash, no tab).
    expect(new URL(page.url()).search).toBe('');
    expect(new URL(page.url()).hash).toBe('');

    // Scrolling up through the page loads the sections that come into view.
    await link(page, 'assets').click();
    await expect(rows(page, 'assets').first()).toBeVisible();
    expect(seen['assets']).toBeGreaterThan(0);
  });

  test('the strip sticks under the top bar, follows the scroll and jumps with reduced motion instantly', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/matters/${w.full.matterId}`);
    await ready(page);
    const headerH = await page.evaluate(
      () => document.querySelector('header.mf-header')!.getBoundingClientRect().bottom,
    );
    await link(page, 'notes').click();
    await expect(page.locator('#section-notes-h')).toBeFocused();
    const top = await page
      .locator('[data-jump-strip]')
      .evaluate((e) => Math.round(e.getBoundingClientRect().top));
    expect(Math.abs(top - Math.round(headerH))).toBeLessThanOrEqual(2);
    await expect(page.locator('[data-jump-strip] [data-jump-meta]')).toBeVisible();
    // The heading of the section is right under the strip, not hidden behind it.
    const stripBottom = await page
      .locator('[data-jump-strip]')
      .evaluate((e) => e.getBoundingClientRect().bottom);
    const headingTop = await page
      .locator('#section-notes-h')
      .evaluate((e) => e.getBoundingClientRect().top);
    expect(headingTop).toBeGreaterThanOrEqual(stripBottom - 1);
    await shot(page, 'sticky-strip');
    // Scrolling to the top highlights Summary again.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(link(page, 'summary')).toHaveAttribute('aria-current', 'location');
    await expect(page.locator('[data-jump-strip] [data-jump-meta]')).toHaveCount(0);
  });

  test('a section shows up to 10 rows in 36 px rows, the footer and Open Full View', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${w.full.matterId}`);
    await ready(page);
    await link(page, 'tasks').click();
    await expect(rows(page, 'tasks')).toHaveCount(10);
    await expect(card(page, 'tasks').locator('[data-section-note]')).toHaveText(
      'Showing 10 of 14 tasks',
    );
    const heights = await rows(page, 'tasks').evaluateAll((rs) =>
      rs.map((r) => Math.round(r.getBoundingClientRect().height)),
    );
    expect(new Set(heights)).toEqual(new Set([36]));
    await link(page, 'projects').click();
    await expect(card(page, 'projects').locator('[data-section-note]')).toHaveText(
      'Showing all 3 projects',
    );
    await link(page, 'assets').click();
    await expect(rows(page, 'assets')).toHaveCount(10);
    await expect(card(page, 'assets').locator('[data-section-note]')).toHaveText(
      'Showing 10 of 12 assets',
    );
    await link(page, 'notes').click();
    await expect(rows(page, 'notes')).toHaveCount(10);
    await expect(card(page, 'notes').locator('[data-section-note]')).toHaveText(
      'Showing 10 of 12 notes',
    );
    // The compact grids have no toolbar, filters or pager.
    await expect(card(page, 'assets').locator('mf-list-toolbar, mf-pager')).toHaveCount(0);
    await expect(card(page, 'tasks').locator('mf-list-toolbar, mf-pager')).toHaveCount(0);
  });

  test('Open Full View opens the tab page, whose Summary tab leads back to the one page', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${w.full.matterId}`);
    await ready(page);
    await link(page, 'tasks').click();
    await card(page, 'tasks').getByRole('link', { name: 'Open Full View' }).click();
    await expect(page).toHaveURL(new RegExp(`/matters/${w.full.matterId}\\?tab=tasks$`));
    await expect(page.getByRole('tab', { name: /^Tasks/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('mf-scoped-tasks')).toBeVisible();
    await shot(page, 'full-view-tasks');
    await page.getByRole('tab', { name: /^Summary/ }).click();
    await ready(page);
    await expect(page).toHaveURL(new RegExp(`/matters/${w.full.matterId}$`));
  });

  test('every ?tab= value still opens its full view', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    for (const [tab, host] of [
      ['tasks', 'mf-scoped-tasks'],
      ['projects', 'mf-matter-projects'],
      ['assets', 'mf-matter-assets'],
      ['productions', '[data-productions-tab]'],
      ['notes', '[data-notes-tab]'],
      ['activities', '[data-activities-tab]'],
    ] as const) {
      await page.goto(`/matters/${w.full.matterId}?tab=${tab}`);
      await expect(page.getByRole('tab', { name: new RegExp(`^${tab}`, 'i') })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.locator(host).first()).toBeVisible();
      await expect(page.locator('[data-matter-one-page]')).toHaveCount(0);
    }
    // The old values map as before.
    await page.goto(`/matters/${w.full.matterId}?tab=details`);
    await ready(page);
    await page.goto(`/matters/${w.full.matterId}?tab=activity`);
    await expect(page.getByRole('tab', { name: /^Activities/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('an empty section says so and keeps its action; an error stays in its section and Retry reloads it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${w.empty.matterId}`);
    await ready(page);
    await link(page, 'productions').click();
    const prod = card(page, 'productions');
    await expect(prod.getByText('No productions yet.')).toBeVisible();
    await expect(prod.getByRole('button', { name: 'New Production' })).toHaveCount(2); // header action and empty state
    await expect(prod.locator('[data-section-note]')).toHaveText('0 productions');
    await shot(page, 'empty-section');

    // A failing notes list shows the error state in Notes only.
    let failing = true;
    await page.route(/\/api\/v1\/notes\?/, (route) =>
      failing ? route.fulfill({ status: 500, body: '{}' }) : route.continue(),
    );
    await page.goto(`/matters/${w.full.matterId}`);
    await ready(page);
    await link(page, 'notes').click();
    await expect(card(page, 'notes').locator('[data-error]')).toBeVisible();
    await expect(card(page, 'notes').getByText("Couldn't load notes.")).toBeVisible();
    await expect(card(page, 'notes').locator('thead th').first()).toHaveText('Title');
    await expect(card(page, 'notes').getByRole('link', { name: 'Open Full View' })).toBeVisible();
    await expect(card(page, 'projects').locator('[data-error]')).toHaveCount(0);
    await shot(page, 'error-section');
    failing = false;
    await card(page, 'notes').getByRole('button', { name: 'Retry' }).click();
    await expect(rows(page, 'notes').first()).toBeVisible();
  });

  test('a section with a production lists it and Add Note opens the Notes full view with a new note', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${w.prod.matterId}`);
    await ready(page);
    await link(page, 'productions').click();
    await expect(rows(page, 'productions')).toHaveCount(1);
    await expect(card(page, 'productions').locator('[data-section-note]')).toHaveText(
      'Showing all 1 productions',
    );

    await page.goto(`/matters/${w.full.matterId}`);
    await ready(page);
    await card(page, 'notes').locator('[data-section-action="add-note"]').scrollIntoViewIfNeeded();
    await card(page, 'notes').locator('[data-section-action="add-note"]').click();
    await expect(page).toHaveURL(new RegExp(`/matters/${w.full.matterId}\\?tab=notes$`));
    await expect(page.locator('[data-notes-tab]')).toBeVisible();
    await expect(page.getByText('New note', { exact: true })).toBeVisible();
    expect(page.url()).not.toContain('compose');
  });

  test('a viewer without Asset and Audit rights has no Assets or Activities section and no link to them', async ({
    personas,
    asUser,
  }) => {
    const viewer = await personas.create({
      label: 'onepage',
      permissions: [
        'Matter.View',
        'Client.View',
        'Task.View',
        'Project.View',
        'Production.View',
        'MatterNote.View',
      ],
    });
    const page = await asUser(viewer.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${w.full.matterId}`);
    await ready(page);
    const names = (await page.locator('[data-jump-strip] a').allTextContents()).map((t) =>
      t.replace(/\s*\(.*\)\s*$/, '').trim(),
    );
    expect(names).toEqual(['Summary', 'Tasks', 'Projects', 'Productions', 'Notes']);
    await expect(page.locator('#section-assets, #section-activities')).toHaveCount(0);
    await expect(page.getByText(/don't have access/i)).toHaveCount(0);
    // A link to a section it may not see shows the one page.
    await page.goto(`/matters/${w.full.matterId}?tab=assets`);
    await ready(page);
  });

  for (const [width, height] of SIZES) {
    test(`has no accessibility violations (axe) with every section loaded, at ${width}x${height}`, async ({
      page,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not installed');
      await page.setViewportSize({ width, height });
      await page.goto(`/matters/${w.full.matterId}`);
      await ready(page);
      for (const key of ['tasks', 'projects', 'assets', 'productions', 'notes', 'activities']) {
        await link(page, key).click();
        await expect(card(page, key).locator('[data-section-note]')).not.toHaveText(
          /load when you scroll|Loading/,
        );
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await axeViolations(page), 'one page').toEqual([]);
      await shot(page, 'loaded');
      await page.goto(`/matters/${w.full.matterId}?tab=tasks`);
      await expect(page.locator('mf-scoped-tasks')).toBeVisible();
      expect(await axeViolations(page), 'full view').toEqual([]);
    });
  }
});
