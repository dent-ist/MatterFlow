import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { atEverySize, noHorizontalScroll, shot, SIZES } from '../support/screens';
import { longName } from '../support/personas';
import { uid } from '../support/seed';

/**
 * The page-header contract (S20, #600): the same H1 size, weight and top offset on every list and workspace page, 18 px below 640 px on every
 * page (record pages included), the context line under the title, actions on the right, a long title or selector that does not wrap or
 * push the header past the viewport, and a title that does not move when you click through the rail.
 */
const LIST_PAGES = [
  { path: '/my-work', name: 'My Work' },
  { path: '/tasks', name: 'Task Queue' },
  { path: '/clients', name: 'Clients' },
  { path: '/matters', name: 'Matters' },
  { path: '/projects', name: 'Projects' },
] as const;

interface Geometry {
  top: number;
  left: number;
  height: number;
  fontSize: number;
  fontWeight: string;
  /** The H1's top edge below the top of the main area. */
  offset: number;
}

async function geometry(page: Page, name: string | RegExp): Promise<Geometry> {
  // My profile's H1 is the person's name (#528), so that page is found by its place, not by its text.
  const h1 =
    name === 'My profile'
      ? page.locator('main h1').first()
      : page.getByRole('heading', { name, level: 1 });
  await expect(h1).toBeVisible();
  await page.waitForTimeout(300); // the header does not depend on data; let the first layout settle
  return h1.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const main = document.querySelector('main')!.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      top: r.top,
      left: r.left,
      height: r.height,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: cs.fontWeight,
      offset: r.top - main.top,
    };
  });
}

test.describe('Page-header contract (#600)', () => {
  test.setTimeout(300_000);

  test('My Work, Task Queue, Clients, Matters and Projects: H1 22 px / 700 (18 px below 640), 12 px from the top, and the title does not move between them', async ({
    page,
  }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      const boxes: Record<string, Geometry> = {};
      for (const p of LIST_PAGES) {
        await page.goto(p.path);
        boxes[p.name] = await geometry(page, p.name);
        const g = boxes[p.name];
        const label = `${p.name} at ${size.width}`;
        expect(g.fontSize, `${label}: font size`).toBe(size.width < 640 ? 18 : 22);
        expect(Number(g.fontWeight), `${label}: weight`).toBeGreaterThanOrEqual(700);
        expect(g.offset, `${label}: top offset`).toBeCloseTo(12, 0);
        if (size.width === 1366 || size.width === 375)
          await shot(page, `header-${p.name.replace(/ /g, '-').toLowerCase()}`);
      }
      const reference = boxes['Clients'];
      for (const [name, g] of Object.entries(boxes)) {
        expect(
          Math.abs(g.top - reference.top),
          `${name} title moved at ${size.width}`,
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(g.left - reference.left),
          `${name} title shifted sideways at ${size.width}`,
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(g.height - reference.height),
          `${name} title box height`,
        ).toBeLessThanOrEqual(0.5);
      }
    }
  });

  test('clicking through the rail does not move the title (1366)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/clients');
    const tops: number[] = [];
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const label of ['Clients', 'Matters', 'Projects', 'Task Queue', 'My Work', 'Clients']) {
      await nav.getByRole('link', { name: label, exact: true }).click();
      tops.push((await geometry(page, label)).top);
    }
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(0.5);
  });

  test('record pages use the same sizes: 22 px, and 18 px below 640', async ({ page, seed }) => {
    const client = await seed.client({ name: `Header ${longName(20, 'Co')}` });
    const matter = await seed.matter({ client });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/matters/${matter.matterId}`);
      const g = await geometry(page, /./);
      expect(g.fontSize, `matter record at ${size.width}`).toBe(size.width < 640 ? 18 : 22);
      expect(Number(g.fontWeight)).toBeGreaterThanOrEqual(700);
    }
  });

  test('a long title and a long selector do not wrap the title, widen the page or push the header off screen', async ({
    page,
    seed,
    admin,
  }) => {
    const name = longName(76, `Pod ${uid()}`);
    const pod = await seed.pod(name, []);
    await admin.get('/api/v1/me');
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/pods/work?pod=${pod.podId}`);
      const h1 = page.getByRole('heading', { name: 'Pod Work', level: 1 });
      await expect(h1).toBeVisible();
      await noHorizontalScroll(page);
      const header = await page.evaluate(() => {
        const root = document
          .querySelector('[data-page-title]')!
          .closest('header, .ph') as HTMLElement;
        const actions = root.querySelector('[data-page-actions]') as HTMLElement;
        const h = document.querySelector('[data-page-title]') as HTMLElement;
        const sel = actions.querySelector(
          'select, .p-select, [data-ph-selector]',
        ) as HTMLElement | null;
        return {
          rootRight: root.getBoundingClientRect().right,
          selectWidth: sel?.getBoundingClientRect().width ?? 0,
          titleHeight: h.getBoundingClientRect().height,
          viewport: window.innerWidth,
        };
      });
      expect(header.rootRight, `header right edge at ${size.width}`).toBeLessThanOrEqual(
        header.viewport,
      );
      expect(header.selectWidth, `selector width at ${size.width}`).toBeLessThanOrEqual(
        22 * 16 + 1,
      );
      expect(header.titleHeight, `title height at ${size.width}: one line`).toBeLessThanOrEqual(37);
    }
  });

  test('axe is clean on the five list pages at four sizes', async ({ page }) => {
    for (const p of LIST_PAGES) {
      await page.goto(p.path);
      await expect(page.getByRole('heading', { name: p.name, level: 1 })).toBeVisible();
      await atEverySize(page, `header-axe-${p.name.replace(/ /g, '-').toLowerCase()}`);
    }
  });

  test('Dashboard, Search, My profile and Create task use the same title numbers and top edge as the list pages (#602, #603, #604)', async ({
    page,
  }) => {
    const MORE = [
      { path: '/dashboard', name: 'Dashboard' },
      { path: '/search?q=acme', name: 'Search results' },
      { path: '/profile', name: 'My profile' },
    ] as const;
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/clients');
      const reference = await geometry(page, 'Clients');
      for (const p of MORE) {
        await page.goto(p.path);
        const g = await geometry(page, p.name);
        const label = `${p.name} at ${size.width}`;
        expect(g.fontSize, `${label}: font size`).toBe(size.width < 640 ? 18 : 22);
        expect(Number(g.fontWeight), `${label}: weight`).toBeGreaterThanOrEqual(700);
        expect(g.offset, `${label}: top offset`).toBeCloseTo(12, 0);
        expect(Math.abs(g.left - reference.left), `${label}: left edge`).toBeLessThanOrEqual(0.5);
        await noHorizontalScroll(page);
        if (size.width === 1366 || size.width === 375)
          await shot(page, `header-${p.name.replace(/ /g, '-').toLowerCase()}`);
      }
    }
  });

  test('Create task: the title sits where a record page title sits (breadcrumb row above it), at four sizes (#602)', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Header ${uid()}` });
    const matter = await seed.matter({ client });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      const top = () =>
        page.evaluate(() => {
          const main = document.querySelector('main')!.getBoundingClientRect();
          const header = document.querySelector('mf-record-header')!.getBoundingClientRect();
          return { top: header.top - main.top, left: header.left };
        });
      await page.goto(`/matters/${matter.matterId}`);
      const record = { ...(await geometry(page, /./)), ...(await top()) };
      await page.goto('/tasks/new');
      const create = { ...(await geometry(page, 'Create task')), ...(await top()) };
      expect(create.fontSize).toBe(record.fontSize);
      // The header (breadcrumb row, then the title) starts at the same height as a record page's: 12 px below the top of the main area.
      expect(create.top, `header top at ${size.width}`).toBeCloseTo(record.top, 0);
      expect(Math.abs(create.left - record.left)).toBeLessThanOrEqual(0.5);
    }
  });

  test('Dashboard: the tab strip is under the title, Scope and Refresh are at the right of the title row, a long scope name does not widen the page (#603)', async ({
    page,
    seed,
  }) => {
    const pod = await seed.pod(longName(76, `Pod ${uid()}`), []);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/dashboard?pod=${pod.podId}`);
      const h1 = page.getByRole('heading', { name: 'Dashboard', level: 1 });
      await expect(h1).toBeVisible();
      const scope = page.getByLabel('Scope');
      await expect(scope).toBeVisible();
      const refresh = page.locator('[data-refresh]');
      await expect(refresh).toBeVisible();
      const [h, tab, sc, rf] = await Promise.all([
        h1.boundingBox(),
        page.getByRole('tab').first().boundingBox(),
        scope.boundingBox(),
        refresh.boundingBox(),
      ]);
      expect(tab!.y, `tabs under the title at ${size.width}`).toBeGreaterThanOrEqual(
        h!.y + h!.height - 1,
      );
      // Scope and Refresh share the title row: they start above the tab strip.
      expect(sc!.y + sc!.height, `scope in the title row at ${size.width}`).toBeLessThanOrEqual(
        tab!.y + 1,
      );
      expect(rf!.y + rf!.height).toBeLessThanOrEqual(tab!.y + 1);
      expect(sc!.width, `scope width at ${size.width}`).toBeLessThanOrEqual(22 * 16);
      await noHorizontalScroll(page);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    // Arrow keys still move between the tabs, as built.
    const first = page.getByRole('tab').first();
    await first.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab').nth(1)).toBeFocused();
    await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  });

  test('Dashboard header axe at four sizes', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await atEverySize(page, 'header-axe-dashboard');
  });

  test('permission variants: the header numbers hold for every kind of person (#602)', async ({
    personas,
    asUser,
  }) => {
    const cases = [
      { who: 'director' as const, path: '/dashboard', name: 'Dashboard' },
      { who: 'technician' as const, path: '/tasks', name: 'Task Queue' },
      { who: 'readOnlyObserver' as const, path: '/clients', name: 'Clients' },
      { who: 'complianceAuditor' as const, path: '/matters', name: 'Matters' },
      { who: 'intakeCoordinator' as const, path: '/projects', name: 'Projects' },
      { who: 'taskViewOnly' as const, path: '/search?q=acme', name: 'Search results' },
      { who: 'technician' as const, path: '/profile', name: 'My profile' },
    ];
    for (const c of cases) {
      const person = await personas.named(c.who);
      const page = await asUser(person.username);
      for (const size of [SIZES[0], SIZES[2]]) {
        await page.setViewportSize(size);
        await page.goto(c.path);
        const g = await geometry(page, c.name);
        expect(g.fontSize, `${c.who} ${c.name} at ${size.width}`).toBe(size.width < 640 ? 18 : 22);
        expect(g.offset, `${c.who} ${c.name} top`).toBeCloseTo(12, 0);
      }
    }
  });
});
