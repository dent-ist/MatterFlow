import fs from 'node:fs';
import path from 'node:path';
import { Page, Route } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Json } from '../support/api';
import { uid } from '../support/seed';

/**
 * Detail-page bugs and states (WP1, #246 to #250): the load failures and the skeleton of the Client, Matter and Project pages, the
 * document title, "New matter" and the inactive-client rule, and the natural order of a matter's Projects tab. Every test seeds its own
 * records. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/clients-review/fixes/wp1).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page-level horizontal scroll').toBeLessThanOrEqual(0);
}

/** The page at every size: axe finds nothing and the page does not scroll sideways. */
async function atEverySize(page: Page, name: string, settle?: () => Promise<void>): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    if (settle) await settle();
    if (axeAvailable()) expect(await axeViolations(page), `${name} at ${size.width}`).toEqual([]);
    await noHorizontalScroll(page);
    if (size.width === 1366 || size.width === 375) await shot(page, name);
  }
}

type Kind = 'client' | 'matter' | 'project';

interface Records {
  client: Json;
  matter: Json;
  project: Json;
}

const API = { client: 'clients', matter: 'matters', project: 'projects' } as const;
const NOUN = { client: 'client', matter: 'matter', project: 'project' } as const;

function url(kind: Kind, records: Records): string {
  const id = records[kind][`${kind}Id`];
  return `/${API[kind]}/${id}`;
}
function apiPattern(kind: Kind, records: Records): string {
  return `**/api/v1/${API[kind]}/${records[kind][`${kind}Id`]}`;
}

const KINDS: Kind[] = ['client', 'matter', 'project'];

test.describe('Detail pages: load failures (#246)', () => {
  async function records(seed: {
    client: () => Promise<Json>;
    matter: (o: { client: Json }) => Promise<Json>;
    project: (m: Json) => Promise<Json>;
  }): Promise<Records> {
    const client = await seed.client();
    const matter = await seed.matter({ client });
    const project = await seed.project(matter);
    return { client, matter, project };
  }

  for (const kind of KINDS) {
    test(`${kind}: an unknown id says it was not found, with a way back and no Retry`, async ({
      page,
    }) => {
      await page.goto(`/${API[kind]}/99999999`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        `We couldn't find that ${NOUN[kind]}.`,
      );
      await expect(page.getByRole('link', { name: `Go to ${API[kind]}` })).toHaveAttribute(
        'href',
        `/${API[kind]}`,
      );
      await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
      await expect(page.getByRole('tab')).toHaveCount(0); // no header and tabs in an error state
      await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0); // no toast on top of the page state
      await atEverySize(page, `${kind}-not-found`);
      await page.getByRole('link', { name: `Go to ${API[kind]}` }).click();
      await expect(page).toHaveURL(new RegExp(`/${API[kind]}$`));
    });

    test(`${kind}: a 404 answer (stub) shows the same, and a 403 says access, both without Retry`, async ({
      page,
      seed,
    }) => {
      const r = await records(seed);
      let status = 404;
      await page.route(apiPattern(kind, r), (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status,
              contentType: 'application/problem+json',
              body: JSON.stringify({
                status,
                code: status === 404 ? 'NOT_FOUND' : 'PERMISSION_DENIED',
              }),
            })
          : route.continue(),
      );
      await page.goto(url(kind, r));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        `We couldn't find that ${NOUN[kind]}.`,
      );
      await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);

      status = 403;
      await page.goto(url(kind, r));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        `You don't have access to this ${NOUN[kind]}.`,
      );
      await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: `Go to ${API[kind]}` })).toBeVisible();
      await atEverySize(page, `${kind}-forbidden`);
    });

    test(`${kind}: a server fault shows Couldn't load with the reference and Retry; Retry recovers and focuses the heading`, async ({
      page,
      seed,
    }) => {
      const r = await records(seed);
      let failing = true;
      const reference = `ref-${uid()}`;
      await page.route(apiPattern(kind, r), (route) =>
        failing && route.request().method() === 'GET'
          ? route.fulfill({
              status: 500,
              contentType: 'application/problem+json',
              body: JSON.stringify({ status: 500, code: 'INTERNAL_ERROR', traceId: reference }),
            })
          : route.continue(),
      );
      await page.goto(url(kind, r));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        `Couldn't load this ${NOUN[kind]}.`,
      );
      await expect(page.locator('[data-error-reference]')).toContainText(reference);
      await expect(page.getByRole('tab')).toHaveCount(0);
      await atEverySize(page, `${kind}-load-failed`);

      // Retry while the stub still fails: the button stays and keeps focus.
      await page.setViewportSize({ width: 1366, height: 768 });
      const retry = page.getByRole('button', { name: 'Retry' });
      await retry.focus();
      await retry.click();
      await expect(retry).toBeFocused();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        `Couldn't load this ${NOUN[kind]}.`,
      );

      // The stub recovers: Retry loads the record, focus moves to the heading, the live region says Loaded.
      failing = false;
      await retry.click();
      await expect(page.getByRole('heading', { level: 1 })).toContainText(
        kind === 'client' ? r.client.name : kind === 'matter' ? r.matter.name : r.project.name,
      );
      await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
      await expect(page.locator('[data-page-title]')).toBeFocused();
      await expect(page.locator('[data-record-live]')).toHaveText('Loaded');
    });

    test(`${kind}: a lost connection shows Couldn't load with Retry`, async ({ page, seed }) => {
      const r = await records(seed);
      let offline = true;
      await page.route(apiPattern(kind, r), (route: Route) =>
        offline && route.request().method() === 'GET'
          ? route.abort('connectionreset')
          : route.continue(),
      );
      await page.goto(url(kind, r));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        `Couldn't load this ${NOUN[kind]}.`,
      );
      offline = false;
      await page.getByRole('button', { name: 'Retry' }).click();
      await expect(page.getByRole('heading', { level: 1 })).not.toContainText("Couldn't load");
      await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    });
  }
});

test.describe('Detail pages: loading skeleton (#247)', () => {
  /** Holds the record's request until `release()` is called. */
  async function hold(page: Page, kind: Kind, r: Records): Promise<() => void> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(apiPattern(kind, r), async (route) => {
      if (route.request().method() === 'GET') await gate;
      await route.continue();
    });
    return release;
  }

  async function seedAll(seed: {
    client: () => Promise<Json>;
    matter: (o: { client: Json }) => Promise<Json>;
    project: (m: Json) => Promise<Json>;
  }): Promise<Records> {
    const client = await seed.client();
    const matter = await seed.matter({ client });
    const project = await seed.project(matter);
    return { client, matter, project };
  }

  for (const kind of KINDS) {
    test(`${kind}: the crumb, tab strip and rows show at once, the loaded page does not move (CLS under 0.02), axe is clean`, async ({
      page,
      seed,
    }) => {
      const r = await seedAll(seed);
      await page.setViewportSize({ width: 1366, height: 768 });
      const release = await hold(page, kind, r);
      await page.addInitScript(() => {
        const w = window as unknown as { __cls: number; __clsOn: boolean };
        w.__cls = 0;
        w.__clsOn = false;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as {
            value: number;
            hadRecentInput: boolean;
          }[]) {
            if (w.__clsOn && !e.hadRecentInput) w.__cls += e.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto(url(kind, r), { waitUntil: 'commit' });

      const skeleton = page.locator('[data-record-skeleton]');
      await expect(skeleton).toBeVisible();
      await expect(skeleton).toHaveAttribute('aria-busy', 'true');
      await expect(skeleton.locator('[role=status]')).toHaveText(`Loading ${kind}`);
      await expect(page.locator('nav[aria-label=Breadcrumb] a:visible').first()).toBeVisible();
      await expect(skeleton.locator('[role=tab]')).toHaveCount(kind === 'matter' ? 4 : 2);
      await expect(skeleton.locator('.rk__row')).toHaveCount(5);
      const rowHeight = await skeleton
        .locator('.rk__row')
        .first()
        .evaluate((e) => e.getBoundingClientRect().height);
      expect(rowHeight).toBe(44);
      await expect(page.getByText(/^Loading the /)).toHaveCount(0); // one indicator, not a spinner and a skeleton
      if (kind === 'project') {
        await expect(skeleton.locator('[role=tab]')).toHaveText(['Tasks (--)', 'Details']);
      }
      if (kind === 'matter') {
        await expect(skeleton.locator('[role=tab]')).toHaveText([
          'Details',
          'Tasks (--)',
          'Projects (--)',
          'Assets',
        ]);
      }
      await shot(page, `${kind}-loading`);
      await page.waitForTimeout(300);
      await page.evaluate(() => ((window as unknown as { __clsOn: boolean }).__clsOn = true));

      release();
      await expect(skeleton).toHaveCount(0);
      await expect(page.locator('[data-page-title]')).toBeVisible();
      await page.waitForTimeout(700);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      expect(cls, 'cumulative layout shift when the record arrives').toBeLessThan(0.02);
    });

    test(`${kind}: the loading state is clean at every size and animation-free with reduced motion`, async ({
      page,
      seed,
    }) => {
      const r = await seedAll(seed);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const release = await hold(page, kind, r);
      await page.goto(url(kind, r), { waitUntil: 'commit' });
      await expect(page.locator('[data-record-skeleton]')).toBeVisible();
      const animation = await page
        .locator('.rk__bar')
        .first()
        .evaluate((e) => getComputedStyle(e).animationName);
      expect(animation).toBe('none');
      await atEverySize(page, `${kind}-loading`);
      release();
      await expect(page.locator('[data-record-skeleton]')).toHaveCount(0);
    });
  }
});

test.describe('Detail pages: document title (#248)', () => {
  const title = (page: Page) => page.evaluate(() => document.title);

  test('Client: names the record and the tab, on a deep link, a click and the arrow keys', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Hartwell & Bryce ${uid()}` });
    const record = `${client.clientNumber} ${client.name}`;
    await page.goto(`/clients/${client.clientId}?tab=matters`);
    await expect.poll(() => title(page)).toBe(`${record}: Matters - MatterFlow`);
    await page.getByRole('tab', { name: 'Details' }).click();
    await expect.poll(() => title(page)).toBe(`${record}: Details - MatterFlow`);
    await page.getByRole('tab', { name: 'Details' }).press('ArrowRight');
    await expect.poll(() => title(page)).toBe(`${record}: Matters - MatterFlow`);
    await page.goto(`/clients/${client.clientId}`);
    await expect.poll(() => title(page)).toBe(`${record}: Details - MatterFlow`);
  });

  test('Matter: every tab is named; a 150 character name is cut at 60 characters in the title only', async ({
    page,
    seed,
  }) => {
    const client = await seed.client();
    const longName = `Long ${'x'.repeat(145)}`;
    const matter = await seed.matter({ client, name: longName });
    const record = `${matter.matterRef} ${matter.name}`;
    const short = record.slice(0, 60).trimEnd() + '…';
    for (const [tab, label] of [
      [undefined, 'Details'],
      ['tasks', 'Tasks'],
      ['projects', 'Projects'],
      ['assets', 'Assets'],
    ] as const) {
      await page.goto(`/matters/${matter.matterId}${tab ? `?tab=${tab}` : ''}`);
      await expect.poll(() => title(page)).toBe(`${short}: ${label} - MatterFlow`);
    }
    await expect(page.locator('[data-page-title]')).toContainText(longName); // the page shows the whole name
    await page.getByRole('tab', { name: /^Tasks/ }).click();
    await expect.poll(() => title(page)).toBe(`${short}: Tasks - MatterFlow`);
    await page.getByRole('tab', { name: /^Tasks/ }).press('ArrowRight');
    await expect.poll(() => title(page)).toBe(`${short}: Projects - MatterFlow`);
  });

  test('Project: Name: Tasks, then Name: Details; the lists keep their plain names; the id gives the plain name while loading', async ({
    page,
    seed,
  }) => {
    const client = await seed.client();
    const matter = await seed.matter({ client });
    const project = await seed.project(matter, `Wave ${uid()}`);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/api/v1/projects/${project.projectId}`, async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(`/projects/${project.projectId}`, { waitUntil: 'commit' });
    await expect.poll(() => title(page)).toBe('Project - MatterFlow');
    release();
    await expect.poll(() => title(page)).toBe(`${project.name}: Tasks - MatterFlow`);
    await page.getByRole('tab', { name: 'Details' }).click();
    await expect.poll(() => title(page)).toBe(`${project.name}: Details - MatterFlow`);

    await page.goto('/clients');
    await expect.poll(() => title(page)).toBe('Clients - MatterFlow');
    await page.goto('/matters');
    await expect.poll(() => title(page)).toBe('Matters - MatterFlow');
    await page.goto('/projects');
    await expect.poll(() => title(page)).toBe('Projects - MatterFlow');
  });
});

test.describe('Client Matters tab: New matter and the inactive-client rule (#250)', () => {
  const REASON = 'This client is inactive. Set it active to add matters.';

  async function inactiveClient(
    seed: { client: () => Promise<Json> },
    admin: { put: (p: string, b: unknown) => Promise<Json> },
  ) {
    const client = await seed.client();
    await admin.put(`/api/v1/clients/${client.clientId}`, {
      name: client.name,
      isActive: false,
      rowVersion: client.rowVersion,
    });
    return client;
  }

  test('an active client: the button reads New matter in the tab and in the empty state', async ({
    page,
    seed,
  }) => {
    const empty = await seed.client();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/clients/${empty.clientId}?tab=matters`);
    await expect(page.getByRole('button', { name: 'New matter' })).toHaveCount(3); // the header (WP3), the toolbar and the empty state
    await expect(page.getByRole('button', { name: 'Create matter' })).toHaveCount(0);
    await expect(page.locator('[data-create-matter]')).not.toHaveAttribute('aria-disabled', 'true');
    await shot(page, 'client-matters-empty-active');
    await atEverySize(page, 'client-matters-empty-active');

    const withMatter = await seed.client();
    await seed.matter({ client: withMatter });
    await page.goto(`/clients/${withMatter.clientId}?tab=matters`);
    await expect(page.getByRole('button', { name: 'New matter' })).toHaveCount(2); // the header and the toolbar
    await page.locator('[data-create-matter]').click();
    await expect(page).toHaveURL(new RegExp(`/matters/new\\?clientId=${withMatter.clientId}$`));
  });

  test('an inactive client: New matter is aria-disabled and focusable with the reason beside it; activating it does nothing', async ({
    page,
    seed,
    admin,
  }) => {
    const client = await inactiveClient(seed, admin);
    await seed.matter({ client: await seed.client() }); // unrelated
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/clients/${client.clientId}?tab=matters`);

    const button = page.locator('[data-create-matter]');
    await expect(button).toHaveText('New matter');
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveJSProperty('disabled', false); // not natively disabled: reachable by keyboard
    await expect(button).toHaveAttribute('title', REASON);
    await expect(page.locator('[data-inactive-reason]')).toHaveText(REASON);
    await expect(button).toHaveAccessibleDescription(REASON);
    await button.focus();
    await expect(button).toBeFocused();
    await button.click({ force: true }); // Playwright treats aria-disabled as not actionable
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/clients/${client.clientId}\\?tab=matters`));
    // The empty state gives the same sentence instead of a second button.
    await expect(page.locator('[data-empty-new-matter]')).toHaveCount(0);
    await expect(page.locator('[data-empty=none]')).toContainText(REASON);
    await shot(page, 'client-matters-inactive');

    await atEverySize(page, 'client-matters-inactive');
    // At 375 the reason wraps inside the screen.
    await page.setViewportSize({ width: 375, height: 812 });
    const box = (await page.locator('[data-inactive-reason]').boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  });
});

test.describe('Matter Projects tab: natural order (#249)', () => {
  test('lists Wave 7, 15, 23 in number order, and Étude 2 before etude 10', async ({
    page,
    seed,
  }) => {
    const client = await seed.client();
    const matter = await seed.matter({ client });
    for (const name of ['Wave 15', 'Wave 23', 'Wave 7', 'etude 10', 'Étude 2']) {
      await seed.project(matter, name);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${matter.matterId}?tab=projects`);
    const names = page.locator('tbody tr td:first-child');
    await expect(names).toHaveText(['Étude 2', 'etude 10', 'Wave 7', 'Wave 15', 'Wave 23']);
    await expect(page.locator('[data-projects-truncated]')).toHaveCount(0);
    await shot(page, 'matter-projects-natural-order');
    await atEverySize(page, 'matter-projects-natural-order');
  });

  test('a matter with more projects than one page returns keeps the server order and says so', async ({
    page,
    seed,
  }) => {
    const client = await seed.client();
    const matter = await seed.matter({ client });
    for (const name of ['Wave 15', 'Wave 7']) await seed.project(matter, name);
    await page.route('**/api/v1/projects?**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, total: 250 } });
    });
    await page.goto(`/matters/${matter.matterId}?tab=projects`);
    // The server orders by name as text: Wave 15 before Wave 7, untouched by the page.
    await expect(page.locator('tbody tr td:first-child')).toHaveText(['Wave 15', 'Wave 7']);
    await expect(page.locator('[data-projects-truncated]')).toHaveText(
      'Showing the first 2 projects.',
    );
    await shot(page, 'matter-projects-truncated');
    await atEverySize(page, 'matter-projects-truncated');
  });
});
