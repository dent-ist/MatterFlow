import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { stepWorld, typeWorld } from '../support/designer';
import { expect, test } from '../support/fixtures';
import { build, versionIds } from '../support/ty-workflow';

/**
 * WP-TY9 #415: the keyboard and axe audit of the Task Types administration pages. Two parts:
 *  1. Tab stops per page and tab (recorded in `tab-stops.json` when E2E_SCREENSHOTS names the output folder; not gated), and the rule
 *     that no page keeps a hidden Tab stop (a stop that is not visible) and that Tab never leaves the document into nothing.
 *  2. The route x width x open overlay matrix: every menu, popover, dialog, drawer and sheet is opened at 1366, 1920, 768 and 375,
 *     axe has 0 violations, the page does not scroll sideways, Escape closes it and focus is back on the control that opened it.
 * No keyboard shortcut is added or changed by this package.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
  { w: 768, h: 1024 },
  { w: 375, h: 812 },
] as const;

interface World {
  wfId: number;
  v: { v1: number; v2: number; v3: number };
  type: { id: number; name: string; url: string };
  published: { url: string };
  step: { id: number; name: string; url: string };
  wfName: string;
  typeName: string;
}
let world: World;
const stops: Record<string, number | string> = {};

test.beforeAll(async ({ seed, admin }) => {
  test.setTimeout(300_000);
  const s = await build(seed, admin, { types: 1 });
  const v = await versionIds(admin, s);
  const type = await typeWorld(seed, admin, { published: true, draft: true });
  const published = await typeWorld(seed, admin, { published: true });
  const step = await stepWorld(seed, admin, { published: true });
  world = {
    wfId: s.workflow.workflowDefinitionId,
    v,
    type: { id: type.id, name: type.name, url: type.url },
    published: { url: published.url },
    step: { id: step.id, name: step.name, url: step.url },
    wfName: s.workflow.name,
    typeName: s.world.taskType.name,
  };
});

test.afterAll(() => {
  if (!OUT || Object.keys(stops).length === 0) return;
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'tab-stops.json');
  const before: Record<string, number | string> = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : {};
  fs.writeFileSync(file, JSON.stringify({ ...before, ...stops }, null, 2));
});

async function shoot(page: Page, name: string, w: number): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  await page.screenshot({ path: path.join(OUT, `${slug}-${w}.png`) });
}

async function noSideScroll(page: Page, label: string): Promise<void> {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over, `${label}: page scrolls sideways`).toBeLessThanOrEqual(0);
}

/** Stops from the first Tab to the one before focus comes round to "Skip to main content" or "Skip to table" again. */
async function walkPage(page: Page): Promise<{ total: number; shell: number; hidden: string[] }> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen: string[] = [];
  const hidden: string[] = [];
  let shell = 0;
  for (let i = 0; i < 400; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      if (!e || e === document.body) return null;
      const r = e.getBoundingClientRect();
      const name = (e.getAttribute('aria-label') ?? e.textContent ?? '')
        .trim()
        .replace(/\s+/g, ' ');
      return {
        text: `${e.tagName.toLowerCase()}:${name.slice(0, 40)}`,
        visible: r.width > 0 && r.height > 0,
        inShell: !!e.closest('header, nav[aria-label="Main"]') && !e.closest('main'),
      };
    });
    if (!info) break;
    if (i > 0 && (info.text === seen[0] || /^a:Skip to main content/.test(info.text))) break;
    seen.push(info.text);
    if (info.inShell) shell++;
    if (!info.visible) hidden.push(info.text);
  }
  return { total: seen.length, shell, hidden };
}

test.describe('#415: Tab stops per page (recorded)', () => {
  const pages: [string, () => string][] = [
    ['task types list', () => '/admin/task-types'],
    ['workflows list', () => '/admin/workflows'],
    ['steps list', () => '/admin/steps'],
    ['task type: overview', () => `/admin/task-types/${world.type.id}`],
    ['task type: workflows tab', () => `/admin/task-types/${world.type.id}?tab=workflows`],
    ['task type: request form tab', () => `/admin/task-types/${world.type.id}?tab=request-form`],
    ['task type: new', () => '/admin/task-types/new'],
    ['workflow: overview', () => `/admin/workflows/${world.wfId}`],
    ['workflow: versions tab', () => `/admin/workflows/${world.wfId}?tab=versions`],
    ['workflow: task types tab', () => `/admin/workflows/${world.wfId}?tab=task-types`],
    ['workflow: new', () => '/admin/workflows/new'],
    ['version page: draft', () => `/admin/workflows/${world.wfId}/versions/${world.v.v3}`],
    ['version page: published', () => `/admin/workflows/${world.wfId}/versions/${world.v.v2}`],
    [
      'version page: used by',
      () => `/admin/workflows/${world.wfId}/versions/${world.v.v3}?tab=used-by`,
    ],
    ['step: details', () => `/admin/steps/${world.step.id}`],
    ['step: inputs tab', () => `/admin/steps/${world.step.id}?tab=inputs`],
    ['step: used by tab', () => `/admin/steps/${world.step.id}?tab=used-by`],
    ['step: new', () => '/admin/steps/new'],
    ['form designer: draft', () => world.type.url],
    ['form designer: published', () => world.published.url],
    ['form designer: step', () => world.step.url],
  ];
  for (const [name, url] of pages) {
    test(`${name}`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(url());
      await expect(page.locator('[data-page-title]').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      // The page is on screen when its skeleton and busy markers are gone and nothing has moved for a moment.
      await expect(page.locator('[data-skeleton], [aria-busy="true"]')).toHaveCount(0);
      await page.waitForTimeout(800);
      const walk = await walkPage(page);
      expect(walk.hidden, `${name}: Tab stops that cannot be seen`).toEqual([]);
      expect(walk.total, `${name}: reached something`).toBeGreaterThan(walk.shell);
      stops[
        `${name}: Tab stops in the page (the application header and menu are ${walk.shell} of the ${walk.total})`
      ] = walk.total - walk.shell;
    });
  }
});

type Opener = (page: Page, size: { w: number; h: number }) => Promise<Locator>;
interface Scenario {
  name: string;
  url: () => string;
  /** Opens the overlay and returns the control that must have focus again after Escape (null: not applicable at this width). */
  open: Opener | ((page: Page, size: { w: number; h: number }) => Promise<Locator | null>);
  /** Only at widths where this is true. */
  when?: (w: number) => boolean;
}

/** Opens a menu button, picks an entry with the mouse and returns the menu button. */
const viaMenu =
  (opener: string | RegExp, item: string | RegExp) =>
  async (page: Page): Promise<Locator> => {
    const button = page.getByRole('button', { name: opener }).first();
    await button.click();
    await page.getByRole('menuitem', { name: item }).first().click();
    return button;
  };
const justMenu = (opener: string | RegExp) => async (page: Page) => {
  const button = page.getByRole('button', { name: opener }).first();
  await button.click();
  await expect(page.getByRole('menu')).toBeVisible();
  return button;
};
const button =
  (name: string | RegExp, exact = false) =>
  async (page: Page) => {
    const b = page.getByRole('button', { name, exact }).first();
    await b.click();
    return b;
  };

/** Activity is a header button when it fits and an entry of the overflow menu when it does not (the header decides by width). */
const activity = async (p: Page): Promise<Locator> => {
  const inline = p.getByRole('button', { name: 'Activity', exact: true });
  if (await inline.first().isVisible()) {
    await inline.first().click();
    return inline.first();
  }
  return viaMenu('More actions', 'Activity')(p);
};

const rowName = () => world.typeName;

const SCENARIOS: Scenario[] = [
  {
    name: 'types list: row menu',
    url: () => `/admin/task-types?name=${encodeURIComponent(rowName())}`,
    open: (p) => justMenu(`Actions for ${rowName()}`)(p),
  },
  {
    name: 'types list: deactivate dialog',
    url: () => `/admin/task-types?name=${encodeURIComponent(rowName())}`,
    open: (p) => viaMenu(`Actions for ${rowName()}`, 'Deactivate')(p),
  },
  {
    name: 'workflows list: row menu',
    url: () => `/admin/workflows?name=${encodeURIComponent(world.wfName)}`,
    open: (p) => justMenu(`Actions for ${world.wfName}`)(p),
  },
  {
    name: 'workflows list: deactivate dialog',
    url: () => `/admin/workflows?name=${encodeURIComponent(world.wfName)}`,
    open: (p) => viaMenu(`Actions for ${world.wfName}`, 'Deactivate')(p),
  },
  {
    name: 'steps list: row menu',
    url: () => `/admin/steps?title=${encodeURIComponent(world.step.name)}`,
    open: (p) => justMenu(`Actions for ${world.step.name}`)(p),
  },
  {
    name: 'steps list: deactivate dialog',
    url: () => `/admin/steps?title=${encodeURIComponent(world.step.name)}`,
    open: (p) => viaMenu(`Actions for ${world.step.name}`, 'Deactivate')(p),
  },
  {
    name: 'steps list: tags filter popover',
    url: () => '/admin/steps',
    open: async (p) => {
      // The Tags filter is a column filter; narrower than its column it moves under "Other filters" or into the Filters sheet.
      const tags = p.getByRole('button', { name: /^Filter by Tags,/ });
      const other = p.getByRole('button', { name: /^(Other filters|Filters)/ }).first();
      const b = (await tags.isVisible()) ? tags : other;
      await b.click();
      return b;
    },
  },
  {
    name: 'task type: More actions menu',
    url: () => `/admin/task-types/${world.type.id}`,
    open: (p) => justMenu('More actions')(p),
  },
  {
    name: 'task type: deactivate dialog',
    url: () => `/admin/task-types/${world.type.id}`,
    open: (p) => viaMenu('More actions', 'Deactivate')(p),
  },
  {
    name: 'task type: Activity drawer',
    url: () => `/admin/task-types/${world.type.id}`,
    open: activity,
  },
  {
    name: 'workflow: deactivate dialog',
    url: () => `/admin/workflows/${world.wfId}`,
    open: (p) => viaMenu('More actions', 'Deactivate')(p),
  },
  {
    name: 'workflow: Activity drawer',
    url: () => `/admin/workflows/${world.wfId}`,
    open: activity,
  },
  {
    name: 'workflow versions: row menu',
    url: () => `/admin/workflows/${world.wfId}?tab=versions`,
    open: (p) => justMenu('Actions for v2')(p),
  },
  {
    name: 'workflow versions: retire dialog',
    url: () => `/admin/workflows/${world.wfId}?tab=versions`,
    open: (p) => viaMenu('Actions for v2', /^Retire/)(p),
  },
  {
    name: 'step: deactivate dialog',
    url: () => `/admin/steps/${world.step.id}`,
    open: (p) => viaMenu('More actions', 'Deactivate')(p),
  },
  {
    name: 'step: Activity drawer',
    url: () => `/admin/steps/${world.step.id}`,
    open: activity,
  },
  {
    name: 'version page: overflow menu',
    url: () => `/admin/workflows/${world.wfId}/versions/${world.v.v3}`,
    open: (p) => justMenu('More version actions')(p),
  },
  {
    name: 'version page: version switcher',
    url: () => `/admin/workflows/${world.wfId}/versions/${world.v.v3}`,
    open: (p) => justMenu(/^Switch version/)(p),
  },
  {
    name: 'version page: execution mode popover',
    url: () => `/admin/workflows/${world.wfId}/versions/${world.v.v3}`,
    open: button(/^Execution mode/),
  },
  {
    name: 'version page: publish dialog',
    url: () => `/admin/workflows/${world.wfId}/versions/${world.v.v3}`,
    open: button('Publish...', true),
  },
  {
    name: 'version page: discard dialog',
    url: () => `/admin/workflows/${world.wfId}/versions/${world.v.v3}`,
    open: (p) => viaMenu('More version actions', 'Discard draft')(p),
  },
  {
    name: 'version page: skip rules popover',
    url: () => `/admin/workflows/${world.wfId}/versions/${world.v.v3}`,
    open: async (p) => {
      const b = p
        .locator('[data-step-row]')
        .first()
        .getByRole('button', { name: /^Actions for/ });
      await b.click();
      await p.getByRole('menuitem', { name: 'Skip rules...' }).click();
      // Escape returns to the rule badge of the row, which is what the menu entry stands for (ty6-version-editor).
      return p
        .locator('[data-step-row]')
        .first()
        .getByRole('button', { name: /^Skip rules of/ });
    },
  },
  {
    name: 'version page: library drawer',
    url: () => `/admin/workflows/${world.wfId}/versions/${world.v.v3}`,
    when: (w) => w < 1280,
    open: button(/Add step$/),
  },
  {
    name: 'version page: retire dialog',
    url: () => `/admin/workflows/${world.wfId}/versions/${world.v.v2}`,
    open: (p) => viaMenu('More version actions', /^Retire/)(p),
  },
  { name: 'designer: publish dialog', url: () => world.type.url, open: button('Publish...', true) },
  { name: 'designer: versions dialog', url: () => world.type.url, open: button(/^Versions/) },
  {
    name: 'designer: palette sheet',
    url: () => world.type.url,
    when: (w) => w < 1100,
    open: button('Add field', true),
  },
  {
    name: 'designer: retire dialog',
    url: () => world.published.url,
    open: button('Retire version', true),
  },
];

test.describe('#415: axe, no sideways scroll and focus return with every overlay open', () => {
  for (const sc of SCENARIOS) {
    test(sc.name, async ({ page }) => {
      test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
      test.setTimeout(180_000);
      for (const size of SIZES) {
        if (sc.when && !sc.when(size.w)) continue;
        const label = `${sc.name} at ${size.w}`;
        await page.setViewportSize({ width: size.w, height: size.h });
        await page.goto(sc.url());
        await expect(page.locator('[data-page-title]').first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        const opener = await sc.open(page, size);
        await page.waitForTimeout(400);
        expect(await axeViolations(page), `${label}: axe`).toEqual([]);
        await noSideScroll(page, label);
        if (/Activity drawer|publish dialog/.test(sc.name)) await shoot(page, sc.name, size.w);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        if (opener) await expect(opener, `${label}: focus returns to the opener`).toBeFocused();
      }
    });
  }
});
