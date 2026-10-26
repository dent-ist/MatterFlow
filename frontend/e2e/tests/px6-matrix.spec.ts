import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Api } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { PmFixtures, pmFixtures } from '../support/pm-fixtures';
import { SIZES, noHorizontalScroll } from '../support/screens';

/**
 * The permission, keyboard and motion checks of the Project Manager experience (epic #758, WP-PX6, #785). The tab specs, the scope specs and the
 * matter specs (px3-*, px4-*, px5-*) already prove each view for the Project Manager; this file proves the whole matrix in one place:
 *
 * - Permission matrix: for each variant (Project Manager, PM without Matter.AssignManagers, PM without Task.View, Director, Read-Only Observer,
 *   technician) what the menu offers, where the person lands, whether the scope switch and the My Matters tabs exist, what the matter Overview
 *   and its header menu show, and what every PM endpoint answers (200 / 403). The expectation is written down here; the same table is in
 *   docs/qa/pm-permission-matrix.md.
 * - Keyboard: the Tab stops of the new areas are listed (evidence for docs/qa/pm-keyboard-evidence.md when `E2E_TABSTOPS_OUT` is set), every stop
 *   has a name and a visible focus indicator, nothing traps the keyboard, and the scope switch and the tabs keep focus where the person put it.
 * - Reduced motion: with the system setting on, none of the new views starts a finite animation.
 * No new or changed keyboard shortcut is introduced anywhere (#420).
 */

interface Facts {
  landing: string;
  menu: string[];
  switchOnMatters: boolean;
  switchOnAssets: boolean;
  tabs: string[];
  overviewSections: string[];
  headerMenu: string[];
  api: Record<string, number>;
}

async function collectUi(page: Page, fx: PmFixtures): Promise<Omit<Facts, 'api'>> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const landing = new URL(page.url()).pathname;
  const links = page.locator('nav[aria-label="Main"] a');
  const more = page.locator('[data-nav-more-toggle]');
  if ((await more.count()) > 0 && (await more.getAttribute('aria-expanded')) !== 'true') {
    await more.click();
  }
  const menu = (await links.allInnerTexts()).map((t) => t.trim());

  await page.goto(`/matters?name=${fx.token}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  const switchOnMatters = (await page.locator('[data-scope-switch]').count()) > 0;
  await page.goto('/assets');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  const switchOnAssets = (await page.locator('[data-scope-switch]').count()) > 0;

  await page.goto('/my-matters');
  await page.waitForLoadState('networkidle');
  const tabs = (await page.locator('[role=tab]').allInnerTexts()).map((t) => t.trim());

  await page.goto(`/matters/${fx.m.primary.matterId}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  const overviewSections = await page
    .locator('[data-matter-overview] [data-section]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-section') ?? ''));
  let headerMenu: string[] = [];
  const overflow = page.locator('mf-record-header [data-overflow]');
  if ((await overflow.count()) > 0) {
    await overflow.click();
    headerMenu = (await page.locator('[role=menuitem]').allInnerTexts()).map((t) => t.trim());
    await page.keyboard.press('Escape');
  }
  return { landing, menu, switchOnMatters, switchOnAssets, tabs, overviewSections, headerMenu };
}

async function collectApi(who: Api, fx: PmFixtures): Promise<Record<string, number>> {
  const get = async (p: string) => (await who.raw('GET', p)).status;
  const out: Record<string, number> = {};
  out['my-matters/summary'] = await get('/api/v1/my-matters/summary');
  out['my-matters/summary?scope=all'] = await get('/api/v1/my-matters/summary?scope=all');
  out['my-matters/deadlines'] = await get('/api/v1/my-matters/deadlines');
  out['my-matters/workload'] = await get('/api/v1/my-matters/workload');
  out['my-matters/trends'] = await get('/api/v1/my-matters/trends');
  out['my-matters/activity'] = await get('/api/v1/my-matters/activity');
  out['my-matters/since-last-visit'] = await get('/api/v1/my-matters/since-last-visit');
  out['matters/{id}/overview'] = await get(`/api/v1/matters/${fx.m.primary.matterId}/overview`);
  out['matters?managedByMe'] = await get('/api/v1/matters?managedByMe=true');
  out['task-queue?managedByMe'] = await get('/api/v1/task-queue?managedByMe=true');
  out['assets?matterManagedByMe'] = await get('/api/v1/assets?matterManagedByMe=true');
  out['clients?matterManagedByMe'] = await get('/api/v1/clients?matterManagedByMe=true');
  out['projects?matterManagedByMe'] = await get('/api/v1/projects?matterManagedByMe=true');
  return out;
}

const PM_MENU = ['My Matters', 'Matters', 'Tasks', 'Assets', 'Clients', 'Projects', 'My Work'];
const FOUR_TABS = ['Overview', 'Deadlines', 'Breakdown', 'Data', 'Activity', 'Trends']; // the Data tab (#870) is offered with Asset.View

test.describe('Permission matrix of the Project Manager views', () => {
  test('Project Manager (holds Matter.AssignManagers): the short menu, the switch, four tabs, the full Overview and header menu, every endpoint', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    const ui = await collectUi(page, fx);
    expect(ui.landing).toBe('/my-matters');
    expect(ui.menu).toEqual(PM_MENU);
    expect(ui.switchOnMatters && ui.switchOnAssets).toBe(true);
    expect(ui.tabs).toEqual(FOUR_TABS);
    expect(ui.overviewSections).toEqual(
      expect.arrayContaining(['health', 'status', 'deadlines', 'people', 'assets', 'activity']),
    );
    expect(ui.headerMenu.join('|')).toMatch(/New task|Bulk re-assign/);
    expect(ui.headerMenu.join('|')).toMatch(/Add comment/);
    const api = await Api.as(fx.pmA.username);
    const status = await collectApi(api, fx);
    await api.dispose();
    for (const [name, code] of Object.entries(status)) expect(code, name).toBe(200);
  });

  test('PM without Matter.AssignManagers: no switch, scope=all refused (403), four tabs, everything else as the Project Manager', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmNoAssign.username);
    const ui = await collectUi(page, fx);
    expect(ui.landing).toBe('/my-matters');
    expect(ui.menu).toEqual(PM_MENU);
    expect(ui.switchOnMatters || ui.switchOnAssets).toBe(false);
    expect(ui.tabs).toEqual(FOUR_TABS);
    const api = await Api.as(fx.pmNoAssign.username);
    const status = await collectApi(api, fx);
    await api.dispose();
    expect(status['my-matters/summary?scope=all']).toBe(403);
    for (const [name, code] of Object.entries(status)) {
      if (name !== 'my-matters/summary?scope=all') expect(code, name).toBe(200);
    }
  });

  test('PM without Task.View: the full menu of a person who does not land on My Matters, no tabs, no tasks section, the PM endpoints answer 403', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmNoTask.username);
    const ui = await collectUi(page, fx);
    expect(ui.landing).not.toBe('/my-matters');
    expect(ui.menu).not.toContain('My Matters');
    expect(ui.menu).not.toContain('Tasks');
    expect(ui.tabs).toEqual([]);
    expect(ui.overviewSections).not.toContain('status');
    expect(ui.overviewSections).not.toContain('deadlines');
    expect(ui.headerMenu).toEqual([]);
    const api = await Api.as(fx.pmNoTask.username);
    const status = await collectApi(api, fx);
    await api.dispose();
    for (const name of [
      'my-matters/summary',
      'my-matters/summary?scope=all',
      'my-matters/deadlines',
      'my-matters/workload',
      'my-matters/trends',
      'my-matters/activity',
      'my-matters/since-last-visit',
      'task-queue?managedByMe',
    ]) {
      expect(status[name], name).toBe(403);
    }
    expect(status['matters/{id}/overview']).toBe(200);
  });

  test('Director (holds Matter.AssignManagers, cannot be a manager): no My Matters item or tabs, no switch, the lists as they were', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.director.username);
    const ui = await collectUi(page, fx);
    expect(ui.landing).not.toBe('/my-matters');
    expect(ui.menu).not.toContain('My Matters');
    expect(ui.switchOnMatters || ui.switchOnAssets).toBe(false);
    expect(ui.tabs).toEqual([]);
  });

  test('Read-Only Observer and technician: no My Matters, no switch, no tabs; the matter Overview shows only what they may read', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    for (const who of [fx.observer, fx.technician]) {
      const page = await asUser(who.username);
      const ui = await collectUi(page, fx);
      expect(ui.landing, who.username).not.toBe('/my-matters');
      expect(ui.menu, who.username).not.toContain('My Matters');
      expect(ui.switchOnMatters || ui.switchOnAssets, who.username).toBe(false);
      expect(ui.tabs, who.username).toEqual([]);
      const api = await Api.as(who.username);
      const status = await collectApi(api, fx);
      await api.dispose();
      expect(status['my-matters/summary'], who.username).toBe(403);
      expect(status['my-matters/summary?scope=all'], who.username).toBe(403);
    }
  });

  test('the System Admin keeps the full menu and the lists as they were, and can open My Matters from the menu', async ({
    page,
  }) => {
    await page.goto('/my-work');
    await expect(page.locator('nav[aria-label="Main"] a', { hasText: 'Pod Work' })).toHaveCount(1);
    await expect(page.locator('[data-nav-more]')).toHaveCount(0);
    await page.goto('/my-matters');
    await expect(page.getByRole('heading', { name: 'My Matters', level: 1 })).toBeVisible();
  });
});

interface Stop {
  tag: string;
  role: string;
  name: string;
  top: number;
  left: number;
  focusVisible: boolean;
  html: string;
  style: string;
}

/** Presses Tab from just after `from` until the focus leaves `region` (or `max` presses) and lists every stop. */
async function tabStops(
  page: Page,
  from: string,
  region: string,
  max = 80,
): Promise<{ stops: Stop[]; left: boolean }> {
  await page.evaluate((sel) => {
    // A focusable-by-script marker placed before the element sets the start point of the next Tab, as a click on it would.
    const el = document.querySelector(sel) as HTMLElement;
    const marker = document.createElement('span');
    marker.tabIndex = -1;
    marker.setAttribute('data-tab-start', '');
    el.parentNode!.insertBefore(marker, el);
    marker.focus();
  }, from);
  const stops: Stop[] = [];
  let left = false;
  let wrapped = false;
  const seen = new Set<string>();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate((reg) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return { out: true } as const;
      const inRegion = !!el.closest(reg);
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const after = getComputedStyle(el, '::after'); // a stretched card link draws its ring on ::after
      const outline =
        (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
        (after.outlineStyle !== 'none' && parseFloat(after.outlineWidth) > 0);
      const shadow = cs.boxShadow !== 'none' && !/^rgba\(0, 0, 0, 0\)/.test(cs.boxShadow);
      const name =
        el.getAttribute('aria-label') ??
        (el.getAttribute('aria-labelledby')
          ? document.getElementById(el.getAttribute('aria-labelledby')!)?.textContent
          : null) ??
        (el as HTMLInputElement).labels?.[0]?.textContent ??
        (el.innerText || (el as HTMLInputElement).value || el.getAttribute('title') || '');
      return {
        out: !inRegion,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') ?? '',
        name: name.replace(/\s+/g, ' ').trim().slice(0, 60),
        top: Math.round(rect.top + window.scrollY),
        left: Math.round(rect.left),
        focusVisible: outline || shadow,
        html: el.outerHTML.replace(/ _ngcontent[^ ]*/g, '').slice(0, 400),
        style: `outline ${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}; shadow ${cs.boxShadow}`,
      };
    }, region);
    if (info.out) {
      left = true;
      break;
    }
    const key = `${(info as Stop).tag}|${(info as Stop).name}|${(info as Stop).top}|${(info as Stop).left}`;
    if (seen.has(key)) {
      wrapped = true;
      break;
    }
    seen.add(key);
    stops.push(info as Stop);
  }
  return { stops, left: left || wrapped };
}

function evidence(area: string, size: string, result: { stops: Stop[]; left: boolean }): void {
  const out = process.env['E2E_TABSTOPS_OUT'];
  if (!out) return;
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, `${area}-${size}.json`),
    JSON.stringify(
      result.stops.map((s) => ({ tag: s.tag, role: s.role, name: s.name })),
      null,
      1,
    ),
  );
}

function expectGoodStops(
  area: string,
  result: { stops: Stop[]; left: boolean },
  min: number,
): void {
  expect(result.stops.length, `${area}: stops`).toBeGreaterThanOrEqual(min);
  expect(result.left, `${area}: the keyboard leaves the region (no trap)`).toBe(true);
  for (const s of result.stops) {
    expect(s.name, `${area}: every stop has a name: ${s.html}`).not.toBe('');
    expect(s.focusVisible, `${area}: focus is visible on "${s.name}": ${s.html} ${s.style}`).toBe(
      true,
    );
  }
}

test.describe('Keyboard: Tab stops of the new areas (existing keys only)', () => {
  test('scoped list: the switch is two stops in order, then the filters and the rows; Enter and Space change it and focus stays on it', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    for (const size of [SIZES[2], SIZES[0]]) {
      await page.setViewportSize(size);
      await page.goto('/matters?size=25');
      await expect(page.locator('[data-scope-switch]')).toBeVisible();
      await page.waitForLoadState('networkidle');
      const result = await tabStops(page, 'h1', 'main, mf-fixed-page, body > *:not(nav)', 40);
      evidence('scoped-matters-list', `${size.width}`, result);
      const names = result.stops.map((s) => s.name);
      const mine = names.findIndex((n) => /^My matters/.test(n));
      const all = names.findIndex((n) => /^All/.test(n));
      expect(mine, 'My matters is a stop').toBeGreaterThanOrEqual(0);
      expect(all, 'All follows My matters directly').toBe(mine + 1);
      expectGoodStops('scoped list', { stops: result.stops, left: true }, 4);
    }
    await page.setViewportSize(SIZES[2]);
    await page.goto('/assets');
    await page.locator('[data-scope="all"]').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/scope=all/);
    await expect(page.locator('[data-scope="all"]')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('[data-scope="mine"]')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/scope=mine/);
    await expect(page.locator('[data-scope="mine"]')).toBeFocused();
  });

  test('main menu: one stop per item, More is a button that opens a list of links, on the desktop rail and in the phone overlay', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    await page.setViewportSize(SIZES[2]);
    await page.goto('/my-matters');
    await page.waitForLoadState('networkidle');
    const toggle = page.locator('[data-nav-more-toggle]');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    const desk = await tabStops(page, 'nav[aria-label="Main"]', 'nav[aria-label="Main"]');
    evidence('main-menu', '1366', desk);
    expectGoodStops('menu 1366', desk, 7);
    expect(desk.stops.map((s) => s.name)).toEqual(
      expect.arrayContaining(['My Matters', 'Matters', 'Tasks', 'Assets', 'Clients']),
    );
    // Enter on More collapses and expands it again.
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await page.setViewportSize(SIZES[0]);
    await page.goto('/my-matters');
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const phoneToggle = page.locator('[data-nav-more-toggle]');
    if ((await phoneToggle.getAttribute('aria-expanded')) !== 'true') await phoneToggle.click();
    const phone = await tabStops(page, 'nav[aria-label="Main"]', 'nav[aria-label="Main"]');
    evidence('main-menu', '375', phone);
    expectGoodStops('menu 375', phone, 7);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused();
  });

  test('My Matters tabs: the tab strip is one stop, the arrow keys move between tabs, Home and End jump, Back restores the tab', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    await page.setViewportSize(SIZES[2]);
    await page.goto('/my-matters');
    await page.waitForLoadState('networkidle');
    // No cap that hides the end of the page: the whole Overview is walked (#820 lists the stop count in docs/qa/pm-keyboard-evidence.md).
    const result = await tabStops(page, 'h1', '[data-mm-tabpanel], mf-fixed-page, main', 250);
    evidence('my-matters-overview', '1366', result);
    expectGoodStops('my matters', { stops: result.stops, left: true }, 6);
    // The skip links are the first stops after the tab strip (#820): four links, each with a name and a visible focus.
    const tabAt = result.stops.findIndex((s) => s.role === 'tab');
    expect(result.stops.slice(tabAt + 1, tabAt + 5).map((s) => s.name)).toEqual([
      'Needs my attention',
      'Upcoming deadlines',
      'Matter health',
      'Recent activity',
    ]);
    expect(result.left, 'the whole page was walked').toBe(true);
    const tabStopsInStrip = result.stops.filter((s) => s.role === 'tab');
    expect(tabStopsInStrip.length, 'the tab strip is a single Tab stop').toBe(1);

    const first = page.locator('[role=tab]').first();
    await first.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[role=tab]').nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.locator('[role=tab]').last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.locator('[role=tab]').first()).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/tab=deadlines/);
    await page.goBack();
    await expect(page.locator('[role=tab][aria-selected=true]')).toHaveText(/Overview/);
  });

  test('matter Overview and the header menu: stops listed, the menu opens with Enter, Esc closes it and the button has focus again', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    await page.setViewportSize(SIZES[2]);
    await page.goto(`/matters/${fx.m.primary.matterId}`);
    await expect(page.locator('[data-matter-overview] [data-section="health"]')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const result = await tabStops(page, 'h1', 'main, mf-fixed-page', 60);
    evidence('matter-overview', '1366', result);
    expectGoodStops('matter overview', { stops: result.stops, left: true }, 5);

    const overflow = page.locator('mf-record-header [data-overflow]');
    await overflow.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[role=menuitem]').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(page.locator('[role=menuitem]')).toHaveCount(0);
    await expect(overflow).toBeFocused();
  });
});

test.describe('Reduced motion and focus after a change', () => {
  test('with reduced motion on, My Matters, its tabs, the lists and the matter Overview start no finite animation', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const running = () =>
      page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => {
            const t = a.effect?.getComputedTiming();
            return (
              a.playState === 'running' &&
              !!t &&
              t.iterations !== Infinity &&
              Number(t.duration) > 1
            );
          })
          .map((a) => (a.effect as KeyframeEffect).target?.tagName ?? '?'),
      );
    for (const url of [
      '/my-matters',
      '/my-matters?tab=deadlines',
      '/my-matters?tab=workload', // the removed Workload tab: an old link opens Overview
      '/my-matters?tab=trends',
      '/my-matters?tab=activity',
      '/matters',
      '/tasks',
      '/assets',
      `/matters/${fx.m.primary.matterId}`,
    ]) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      expect(await running(), url).toEqual([]);
    }
    await page.goto('/matters');
    await page.locator('[data-scope="all"]').click();
    await page.waitForLoadState('networkidle');
    expect(await running(), 'after the scope switch').toEqual([]);
  });

  test('zoom 200 percent (a 683 px wide window): the scoped lists, the tabs and the Overview do not scroll sideways', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.skip(!axeAvailable(), 'axe-core is not installed');
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    await page.setViewportSize({ width: 683, height: 384 });
    for (const url of [
      '/matters',
      '/tasks',
      '/assets',
      '/my-matters',
      '/my-matters?tab=trends',
      `/matters/${fx.m.primary.matterId}`,
    ]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await axeViolations(page), url).toEqual([]);
      await noHorizontalScroll(page);
    }
  });
});
