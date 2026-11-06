import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Clients UX epic, WP3 (#253 record header, #255 action rule, #256 Sensitive note). Client, Matter and Project pages
 * share one header: crumb (the last step cut at 40 characters), a one-line title at 22 px with the name clamped to two lines, a context
 * line, Edit / Activity / the primary create action and an overflow "..." with the rest. The seeded long records are the review's:
 * a client name of 105 characters, a matter name of 150 and a project name of 130. Geometry is measured on the real page at 1366x768,
 * 1920x1080; axe finds nothing and the page never scrolls sideways.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/clients-review/fixes/wp3).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  [1366, 768],
  [1920, 1080],
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
  // Short means one line at 375 px beside the status badge (about 16 characters at 18 px): the skeleton is one line, a name that wraps
  // makes the loaded header one line taller (a random 25-character name did that 1 time in 100).
  const client = await seed.client({ name: `Hartwell & Bryce ${uid()}` });
  const matter = await seed.matter({ client, name: `Short M ${uid()}` });
  const longClient = await seed.client({ name: CLIENT_105 });
  const longMatter = await seed.matter({ client: longClient, name: MATTER_150 });
  const project = await seed.project(matter, `Short P ${uid()}`);
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

// The Matter page has its own header since the Matter detail redesign (MD-01, #1002): its e2e cases are in md-matter-header.spec.ts.
// This file keeps the Client and Project pages (the shared record header).
test.describe('WP3: record header geometry (#253, #254)', () => {
  for (const [w, h] of SIZES) {
    test(`short and long records keep the header small at ${w}x${h}; axe clean; no sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      const u = urls();
      const cases = [
        { key: 'client', url: u.client, tabs: true, long: false },
        { key: 'client-long', url: u.longClient, tabs: true, long: true },
        { key: 'project', url: u.project, tabs: true, long: false },
        { key: 'project-long', url: u.longProject, tabs: true, long: true },
      ];
      for (const c of cases) {
        await page.goto(c.url);
        await expect(page.locator('[data-record-header] h1 [data-name]')).toBeVisible();
        await expect(page.locator('[data-record-skeleton]')).toHaveCount(0);

        // The page title is the h1; the crumb never wraps and its last step is the current page.
        const current = page.locator('[data-crumb-current]');
        await expect(current).toHaveAttribute('aria-current', 'page');
        const visible = await current.locator('[aria-hidden=true]').innerText();
        expect(visible.replace(/…$/, '').length, c.key).toBeLessThanOrEqual(40);
        expect(await lines(page, '[data-crumb-current]'), `${c.key} crumb lines`).toBe(1);
        if (c.long) await expect(current).toHaveAttribute('title', /.{41,}/);

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
        // A matter also carries the project manager line and the small health strip (epic #667): up to 50 px more.
        const extra = c.key.startsWith('matter') ? 50 : 0;
        expect(bodyTop, `${c.key} tabs y at ${w}`).toBeLessThanOrEqual(200 + extra);
        if (w === 1366) console.log(`${c.key} ${w}x${h}: body at y ${Math.round(bodyTop)}`);

        await noSidewaysScroll(page);
        await axeClean(page, `${c.key} at ${w}x${h}`);
        await shot(page, `header-${c.key}`);
      }
    });
  }
});

test.describe('WP3: Sensitive note (#256)', () => {
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
