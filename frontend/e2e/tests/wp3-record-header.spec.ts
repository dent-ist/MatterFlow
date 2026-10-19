import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Clients UX epic, WP3 (#253 record header, #255 action rule, #254 phone header, #256 Sensitive note). Client, Matter and Project pages
 * share one header: crumb (the last step cut at 40 characters), a one-line title at 22 px with the name clamped to two lines, a context
 * line, Edit / Activity / the primary create action and an overflow "..." with the rest. The seeded long records are the review's:
 * a client name of 105 characters, a matter name of 150 and a project name of 130. Geometry is measured on the real page at 1366x768,
 * 1920x1080, 768x1024 and 375x812; axe finds nothing and the page never scrolls sideways.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/clients-review/fixes/wp3).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

const CLIENT_105 =
  'Meridian Pharmaceuticals International Holdings, Incorporated and its Subsidiaries and Affiliates (Americas Division)';
const MATTER_150 =
  'Regulatory Investigation and Related Civil Litigation Concerning Historic Manufacturing, Distribution and Labelling Practices of Legacy Products Across Multiple Jurisdictions';
const PROJECT_130 =
  'Custodian Interviews, Document Collection, Privilege Review and Production Workstream for the Second Wave of Regulatory Requests Phase';

let data: {
  client: Json;
  matter: Json;
  longClient: Json;
  longMatter: Json;
  project: Json;
  longProject: Json;
  sensitive: Json;
  inactiveClient: Json;
  busyMatter: Json;
};

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const e = document.scrollingElement!;
    return { sw: e.scrollWidth, cw: e.clientWidth };
  });
  expect(m.sw, 'page scrolls sideways').toBeLessThanOrEqual(m.cw);
}

/** Number of text lines in an element: its text's line boxes, grouped by vertical position (visually hidden text is left out). */
async function lines(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .first()
    .evaluate((e) => {
      const tops: number[] = [];
      const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim() || n.parentElement?.closest('.mf-sr-only')) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of Array.from(range.getClientRects())) {
          if (r.width > 0 && !tops.some((t) => Math.abs(t - r.top) < 6)) tops.push(r.top);
        }
      }
      return tops.length;
    });
}

const top = async (page: Page, selector: string): Promise<number> =>
  (await page.locator(selector).first().boundingBox())!.y;

test.beforeAll(async ({ seed }: { seed: Seeder }) => {
  const client = await seed.client({ name: `Hartwell & Bryce ${uid()}` });
  const matter = await seed.matter({ client, name: `Short matter ${uid()}` });
  const longClient = await seed.client({ name: CLIENT_105 });
  const longMatter = await seed.matter({ client: longClient, name: MATTER_150 });
  const project = await seed.project(matter, `Short project ${uid()}`);
  const longProject = await seed.project(longMatter, PROJECT_130);
  const sensitive = await seed.matter({
    client,
    number: '00002',
    name: `Sensitive matter ${uid()}`,
    sensitive: true,
  });
  const inactiveClient = await seed.client({ name: `Dormant ${uid()}` });
  await seed.admin.put(`/api/v1/clients/${inactiveClient.clientId}`, {
    name: inactiveClient.name,
    isActive: false,
    rowVersion: inactiveClient.rowVersion,
  });
  const busy = await seed.world();
  await seed.task(busy);
  data = {
    client,
    matter,
    longClient,
    longMatter,
    project,
    longProject,
    sensitive,
    inactiveClient: { ...inactiveClient, isActive: false },
    busyMatter: busy.matter,
  };
});

const urls = () => ({
  client: `/clients/${data.client.clientId}`,
  longClient: `/clients/${data.longClient.clientId}`,
  matter: `/matters/${data.matter.matterId}`,
  longMatter: `/matters/${data.longMatter.matterId}`,
  project: `/projects/${data.project.projectId}`,
  longProject: `/projects/${data.longProject.projectId}`,
});

test.describe('WP3: record header geometry (#253, #254)', () => {
  for (const [w, h] of SIZES) {
    test(`short and long records keep the header small at ${w}x${h}; axe clean; no sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      const u = urls();
      const phone = w < 640;
      const cases = [
        { key: 'client', url: u.client, tabs: true, long: false },
        { key: 'client-long', url: u.longClient, tabs: true, long: true },
        { key: 'matter', url: u.matter, tabs: true, long: false },
        { key: 'matter-long', url: u.longMatter, tabs: true, long: true },
        { key: 'project', url: u.project, tabs: true, long: false },
        { key: 'project-long', url: u.longProject, tabs: true, long: true },
      ];
      for (const c of cases) {
        await page.goto(c.url);
        await expect(page.locator('[data-record-header] h1 [data-name]')).toBeVisible();
        await expect(page.locator('[data-record-skeleton]')).toHaveCount(0);

        // The page title is the h1; the crumb never wraps and its last step is the current page.
        const current = page.locator('[data-crumb-current]');
        if (!phone) {
          await expect(current).toHaveAttribute('aria-current', 'page');
          const visible = await current.locator('[aria-hidden=true]').innerText();
          expect(visible.replace(/…$/, '').length, c.key).toBeLessThanOrEqual(40);
          expect(await lines(page, '[data-crumb-current]'), `${c.key} crumb lines`).toBe(1);
          if (c.long) await expect(current).toHaveAttribute('title', /.{41,}/);
        } else {
          await expect(page.locator('[data-back-link]')).toBeVisible();
          await expect(page.locator('.rh__trail')).toBeHidden();
        }

        // Name: at most two lines, the full name in the tooltip.
        const name = await page.locator('[data-record-header] h1 [data-name]').evaluate((e) => ({
          h: e.getBoundingClientRect().height,
          lh: parseFloat(getComputedStyle(e).lineHeight),
        }));
        expect(name.h / name.lh, `${c.key} name lines`).toBeLessThanOrEqual(2.05);
        if (c.long) {
          const titleAttr = await page.locator('h1 [data-name]').getAttribute('title');
          expect(titleAttr!.length).toBeGreaterThan(100);
        }

        // Where the tabs (or, on a Project, the body) start.
        const bodyTop = c.tabs
          ? await top(page, '[role=tablist]')
          : await top(page, 'mf-record-header + *');
        if (w >= 1024) {
          expect(bodyTop, `${c.key} tabs y at ${w}`).toBeLessThanOrEqual(200);
        } else if (phone) {
          expect(bodyTop, `${c.key} tabs y at ${w}`).toBeLessThanOrEqual(c.long ? 260 : 200);
        }
        if (w === 1366 || w === 375)
          console.log(`${c.key} ${w}x${h}: body at y ${Math.round(bodyTop)}`);

        await noSidewaysScroll(page);
        await axeClean(page, `${c.key} at ${w}x${h}`);
        await shot(page, `header-${c.key}`);
      }
    });
  }

  test('a tooltip carries the full name and the heading keeps all of it for assistive technology', async ({
    page,
  }) => {
    await page.goto(urls().longMatter);
    await expect(page.locator('h1')).toContainText(MATTER_150);
    await expect(page.locator('h1 [data-name]')).toHaveAttribute('title', MATTER_150);
    await expect(page.locator('[data-crumb-current] .mf-sr-only')).toContainText(MATTER_150);
  });

  test('the context line names the client (a link) and, on a project, the matter', async ({
    page,
  }) => {
    await page.goto(urls().matter);
    const ctx = page.locator('[data-record-context] [data-client]');
    await expect(ctx).toContainText('Client');
    await expect(ctx.locator('a')).toHaveAttribute('href', `/clients/${data.client.clientId}`);
    expect(await lines(page, '[data-record-context]')).toBe(1);

    await page.goto(urls().project);
    const pctx = page.locator('[data-record-context] [data-matter]');
    await expect(pctx).toContainText('Matter');
    await expect(pctx.locator('a.mf-ref')).toHaveAttribute(
      'href',
      `/matters/${data.matter.matterId}`,
    );

    await page.goto(urls().client);
    await expect(page.locator('[data-record-context]')).toBeHidden(); // a client has none
  });

  test('the matter reference keeps its copy button in the title; a client shows its number', async ({
    page,
  }) => {
    await page.goto(urls().matter);
    await expect(page.locator('h1 mf-copy-button button')).toBeVisible();
    await page.goto(urls().client);
    await expect(page.locator('h1 [data-ref]')).toHaveText(data.client.clientNumber);
  });

  test('the loading skeleton has the height of the loaded header (short names)', async ({
    page,
  }) => {
    for (const [w, h] of [
      [1366, 768],
      [375, 812],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      for (const [key, url, api] of [
        ['matter', urls().matter, `/api/v1/matters/${data.matter.matterId}`],
        ['client', urls().client, `/api/v1/clients/${data.client.clientId}`],
        ['project', urls().project, `/api/v1/projects/${data.project.projectId}`],
      ] as const) {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((r) => (release = r));
        const handler = async (route: import('@playwright/test').Route) => {
          await gate;
          await route.fallback();
        };
        await page.route(`**${api}`, handler);
        await page.goto(url);
        await expect(page.locator('[data-record-skeleton]')).toBeVisible();
        const skeleton = await page.locator('[data-record-header]').first().boundingBox();
        release();
        await expect(page.locator('[data-record-skeleton]')).toHaveCount(0);
        const loaded = await page.locator('[data-record-header]').first().boundingBox();
        await page.unroute(`**${api}`, handler);
        expect(Math.abs(skeleton!.height - loaded!.height), `${key} at ${w}`).toBeLessThanOrEqual(
          1,
        );
        if (key === 'matter') await shot(page, 'header-matter-after-skeleton');
      }
    }
  });
});

test.describe('WP3: one action rule (#255)', () => {
  const headerButtons = (page: Page) =>
    page
      .locator('[data-page-actions] > button')
      .evaluateAll((bs) => bs.map((b) => b.getAttribute('data-action')));

  async function menuItems(page: Page): Promise<(string | null)[]> {
    await page.locator('[data-overflow]').click();
    await expect(page.getByRole('menu')).toBeVisible();
    return page
      .getByRole('menuitem')
      .evaluateAll((bs) => bs.map((b) => b.getAttribute('data-action')));
  }

  test('with every permission: Edit, Activity, the primary action and an overflow on each page', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(urls().client);
    await expect(page.locator('[data-record-header] h1 [data-name]')).toBeVisible();
    expect(await headerButtons(page)).toEqual(['edit', 'activity', 'new-matter']);
    expect(await menuItems(page)).toEqual(['toggle-active']);
    await shot(page, 'overflow-client');
    await page.keyboard.press('Escape');

    await page.goto(urls().matter);
    await expect(page.locator('[data-record-header] h1 [data-name]')).toBeVisible();
    expect(await headerButtons(page)).toEqual(['edit', 'activity', 'create-task']);
    expect(await menuItems(page)).toEqual(['new-project', 'new-asset', 'toggle-active']);
    await shot(page, 'overflow-matter');
    await page.keyboard.press('Escape');

    await page.goto(urls().project);
    await expect(page.locator('[data-record-header] h1 [data-name]')).toBeVisible();
    expect(await headerButtons(page)).toEqual(['edit', 'activity', 'create-task']);
    expect(await menuItems(page)).toEqual(['toggle-active']);
    await expect(page.getByRole('menuitem')).toHaveText('Archive');
    await shot(page, 'overflow-project');
  });

  test('nothing that changes the record stays in a tab body or in the project side panel', async ({
    page,
  }) => {
    for (const url of [urls().client, urls().matter]) {
      await page.goto(url);
      const panel = page.getByRole('tabpanel');
      await expect(panel).toBeVisible();
      for (const name of ['Edit', 'Set inactive', 'Set active']) {
        await expect(panel.getByRole('button', { name, exact: true })).toHaveCount(0);
      }
    }
    await page.goto(urls().project);
    await expect(page.locator('[data-record-header] h1 [data-name]')).toBeVisible();
    await expect(
      page.locator('[mfaside], .dl-aside').getByRole('button', { name: 'Edit', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0);
  });

  test('the overflow is a menu: ArrowDown opens it, arrows move, Esc closes and returns focus to the button', async ({
    page,
  }) => {
    await page.goto(urls().matter);
    const button = page.locator('[data-overflow]');
    await expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await button.focus();
    await page.keyboard.press('ArrowDown');
    const items = page.getByRole('menuitem');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('Set inactive from the overflow confirms, and focus comes back to the overflow button', async ({
    page,
    seed,
  }) => {
    const matter = await seed.matter({
      client: data.client,
      number: String(30000 + Math.floor(Math.random() * 9999)).slice(0, 5),
    });
    await page.goto(`/matters/${matter.matterId}`);
    await page.locator('[data-overflow]').click();
    await page.getByRole('menuitem', { name: 'Set inactive' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Set inactive' }).click();
    await expect(page.locator('[data-inactive-banner]')).toBeVisible();
    await expect(page.locator('[data-overflow]')).toBeFocused();
    await page.locator('[data-overflow]').click();
    await expect(page.getByRole('menuitem', { name: 'Set active' })).toBeVisible();
    // Create task is disabled with its reason on an inactive matter.
    const create = page.locator('[data-action=create-task]');
    await expect(create).toHaveAttribute('aria-disabled', 'true');
  });

  test('disabled with a reason: Set inactive while tasks are open, New matter for an inactive client', async ({
    page,
  }) => {
    await page.goto(`/matters/${data.busyMatter.matterId}`);
    await page.locator('[data-overflow]').click();
    const toggle = page.getByRole('menuitem', { name: /Set inactive/ });
    await expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await expect(toggle).toContainText("aren't Completed or Cancelled");
    await toggle.focus();
    await expect(toggle).toBeFocused(); // still reachable by keyboard
    await page.keyboard.press('Escape');

    await page.goto(`/clients/${data.inactiveClient.clientId}`);
    const create = page.locator('[data-action=new-matter]');
    await expect(create).toHaveAttribute('aria-disabled', 'true');
    await create.focus();
    await expect(create).toBeFocused();
    await expect(create).toHaveAttribute('title', /inactive/);
    await create.click({ force: true });
    await expect(page).toHaveURL(new RegExp(`/clients/${data.inactiveClient.clientId}$`));
  });

  test('Archive from the project overflow asks first; the empty Projects tab keeps its New project action', async ({
    page,
    seed,
  }) => {
    const empty = await seed.matter({ client: data.client, number: '00077' });
    await page.goto(`/matters/${empty.matterId}?tab=projects`);
    await expect(page.locator('[data-empty-new-project]')).toBeVisible();
    await page.locator('[data-empty-new-project]').click();
    await expect(page).toHaveURL(new RegExp(`/projects/new\\?matterId=${empty.matterId}`));

    const project = await seed.project(data.matter);
    await page.goto(`/projects/${project.projectId}`);
    await page.locator('[data-overflow]').click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(page.locator('[data-archived-banner]')).toBeVisible();
    await expect(page.locator('[data-action=create-task]')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.locator('[data-overflow]').click();
    await expect(page.getByRole('menuitem', { name: 'Restore' })).toBeVisible();
  });

  for (const [w, h] of SIZES) {
    test(`axe finds nothing with the overflow open on each page at ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      for (const [key, url] of [
        ['client', urls().client],
        ['matter', urls().longMatter],
        ['project', urls().project],
      ] as const) {
        await page.goto(url);
        await expect(page.locator('[data-record-header] h1 [data-name]')).toBeVisible();
        await page.locator('[data-overflow]').click();
        await expect(page.getByRole('menu')).toBeVisible();
        const box = await page.getByRole('menu').boundingBox();
        expect(box!.x, `${key} menu left edge`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `${key} menu right edge`).toBeLessThanOrEqual(w);
        await axeClean(page, `${key} overflow open at ${w}x${h}`);
        await noSidewaysScroll(page);
        if (key === 'matter') await shot(page, 'overflow-open-matter-long');
      }
    });
  }

  test.describe('permission matrix', () => {
    test('a view-only user sees no Edit, no Activity, no create action and no empty overflow', async ({
      asUser,
      seed,
    }) => {
      const role = await seed.role(
        ['Client.View', 'Matter.View', 'Project.View', 'Task.View', 'Asset.View'],
        'E2E header viewer',
      );
      const viewer = await seed.user([role.name], 'hdr-viewer');
      const page = await asUser(viewer.username);
      for (const url of [urls().client, urls().matter, urls().project]) {
        await page.goto(url);
        await expect(page.locator('[data-record-header] h1 [data-name]')).toBeVisible();
        await expect(page.locator('[data-page-actions] button')).toHaveCount(0);
        await expect(page.locator('[data-overflow]')).toHaveCount(0);
      }
      // Context line: plain text without Client.View / Matter.View would be the other branch; this role holds both, so links stay.
      await page.goto(urls().matter);
      await expect(page.locator('[data-client] a')).toHaveCount(1);
    });

    test('without Task.Create there is no Create task, the rest of the rule stays', async ({
      asUser,
      seed,
    }) => {
      const role = await seed.role(
        [
          'Client.View',
          'Matter.View',
          'Matter.Edit',
          'Matter.SetActive',
          'Project.View',
          'Project.Create',
          'Task.View',
          'Asset.View',
          'Audit.View',
        ],
        'E2E no task create',
      );
      const user = await seed.user([role.name], 'hdr-notask');
      const page = await asUser(user.username);
      await page.goto(urls().matter);
      await expect(page.locator('[data-record-header] h1 [data-name]')).toBeVisible();
      expect(
        await page
          .locator('[data-page-actions] > button')
          .evaluateAll((bs) => bs.map((b) => b.getAttribute('data-action'))),
      ).toEqual(['edit', 'activity']);
      await page.locator('[data-overflow]').click();
      expect(
        await page
          .getByRole('menuitem')
          .evaluateAll((bs) => bs.map((b) => b.getAttribute('data-action'))),
      ).toEqual(['new-project', 'toggle-active']);
    });

    test('without Client.View the matter context line is plain text, not a link', async ({
      asUser,
      seed,
    }) => {
      const role = await seed.role(['Matter.View', 'Task.View'], 'E2E no client view');
      const user = await seed.user([role.name], 'hdr-nolink');
      const page = await asUser(user.username);
      await page.goto(urls().matter);
      await expect(page.locator('[data-client]')).toContainText('Client');
      await expect(page.locator('[data-client] a')).toHaveCount(0);
    });
  });
});

test.describe('WP3: phone header (#254)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('one row: the primary action and one overflow with 44 px targets; everything else is in the menu', async ({
    page,
  }) => {
    for (const [url, primary, items] of [
      [urls().client, 'new-matter', ['edit', 'activity', 'toggle-active']],
      [
        urls().matter,
        'create-task',
        ['edit', 'activity', 'new-project', 'new-asset', 'toggle-active'],
      ],
      [urls().project, 'create-task', ['edit', 'activity', 'toggle-active']],
    ] as const) {
      await page.goto(url);
      await expect(page.locator('[data-record-header] h1 [data-name]')).toBeVisible();
      const buttons = await page
        .locator('[data-page-actions] > button')
        .evaluateAll((bs) => bs.map((b) => b.getAttribute('data-action')));
      expect(buttons).toEqual([primary]);
      for (const sel of [`[data-action=${primary}]`, '[data-overflow]']) {
        const box = (await page.locator(sel).boundingBox())!;
        expect(box.height, sel).toBeGreaterThanOrEqual(44);
        expect(box.width, sel).toBeGreaterThanOrEqual(44);
      }
      await page.locator('[data-overflow]').click();
      await expect(page.getByRole('menuitem').first()).toBeVisible();
      const menu = await page
        .getByRole('menuitem')
        .evaluateAll((bs) =>
          bs.map((b) => [b.getAttribute('data-action'), b.getBoundingClientRect().height]),
        );
      expect(menu.map((m) => m[0])).toEqual(items);
      for (const [, height] of menu) expect(height as number).toBeGreaterThanOrEqual(44);
      await shot(page, `phone-overflow-${primary}`);
      await page.keyboard.press('Escape');
    }
  });

  test('the first grid row of the Matter Tasks tab is above the fold', async ({ page, seed }) => {
    const world = await seed.world();
    await seed.task(world);
    await page.goto(`/matters/${world.matter.matterId}?tab=tasks`);
    const row = page.locator('[data-task], .tc-card, tbody tr').first();
    await expect(row).toBeVisible();
    const box = (await row.boundingBox())!;
    expect(box.y + 20).toBeLessThan(812);
    await shot(page, 'phone-matter-tasks');
  });

  test('"Back to Matters" replaces the trail and goes to the list', async ({ page }) => {
    await page.goto(urls().matter);
    const back = page.locator('[data-back-link]');
    await expect(back).toHaveText(/Back to Matters/);
    await back.click();
    await expect(page).toHaveURL(/\/matters$/);
  });
});

test.describe('WP3: tablet header (#254)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('the primary action and Edit stay; Activity and the rest are in the overflow', async ({
    page,
  }) => {
    await page.goto(urls().matter);
    await expect(page.locator('[data-record-header] h1 [data-name]')).toBeVisible();
    expect(
      await page
        .locator('[data-page-actions] > button')
        .evaluateAll((bs) => bs.map((b) => b.getAttribute('data-action'))),
    ).toEqual(['edit', 'create-task']);
    await page.locator('[data-overflow]').click();
    expect(
      await page
        .getByRole('menuitem')
        .evaluateAll((bs) => bs.map((b) => b.getAttribute('data-action'))),
    ).toEqual(['activity', 'new-project', 'new-asset', 'toggle-active']);
    await shot(page, 'tablet-matter-overflow');
  });
});

test.describe('WP3: Sensitive note (#256)', () => {
  for (const [w, h] of [
    [1366, 768],
    [375, 812],
  ] as const) {
    test(`a Sensitive matter's tabs start at most 40 px lower than a plain one at ${w}x${h}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/matters/${data.matter.matterId}`);
      await expect(page.locator('[data-record-header] h1 [data-name]')).toBeVisible();
      const plain = await top(page, '[role=tablist]');
      await expect(page.locator('[data-sensitive-banner]')).toHaveCount(0);
      await page.goto(`/matters/${data.sensitive.matterId}`);
      const note = page.locator('[data-sensitive-banner]');
      await expect(note).toBeVisible();
      const sens = await top(page, '[role=tablist]');
      expect(sens - plain, `delta at ${w}`).toBeLessThanOrEqual(40);
      expect(sens - plain).toBeGreaterThan(0);
      await expect(note).toHaveAttribute('role', 'note');
      await expect(note).not.toHaveAttribute('aria-live', /.+/);
      await expect(note).toContainText('Sensitive matter.');
      await expect(note).toContainText(
        'This flag is a warning only and does not restrict who can see them.',
      );
      const noteBox = (await note.boundingBox())!;
      expect(noteBox.height).toBeLessThanOrEqual(w < 400 ? 48 : 32.5);
      // The badge beside the title is described by the note, which a screen reader hears once.
      const noteId = await note.getAttribute('id');
      await expect(page.locator('h1 mf-sensitive-badge span[aria-describedby]')).toHaveAttribute(
        'aria-describedby',
        noteId!,
      );
      // The Details tab keeps its own row.
      await expect(page.locator('[data-sensitive-value]')).toContainText('Warning only');
      await noSidewaysScroll(page);
      await axeClean(page, `sensitive matter at ${w}x${h}`);
      await shot(page, 'sensitive-matter');
    });
  }

  for (const [w, h] of SIZES) {
    test(`axe finds nothing on the Sensitive matter at ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/matters/${data.sensitive.matterId}`);
      await expect(page.locator('[data-sensitive-banner]')).toBeVisible();
      await axeClean(page, `sensitive at ${w}x${h}`);
      await noSidewaysScroll(page);
    });
  }
});
