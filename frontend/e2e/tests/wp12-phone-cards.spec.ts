import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page, Route } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { FIRM_ZONE, dateInZone } from '../support/time';

/**
 * Clients UX epic, WP12 phone cards (#275 the generic record card list, #276 Clients, #277 Matters and the client's Matters tab, #278
 * Projects). Below 640 px (639 is cards, 640 is the table) the three lists and the client's Matters tab are one `<ul>` of cards and no
 * table markup; from 640 px the table is back and no card exists. A card is: the name as the one link (two lines at most, tooltip), a mono
 * reference line, the status badges, "14 open" and "3 overdue" (Task Queue links, overdue only above 0). The cards equal the table at the same
 * address (names, order, counts, status), the Filters sheet carries Sort by and the filters, the states are the table's, and every size
 * passes axe without a sideways scroll. Cards at 320, 375, 414, 600 and 639; table at 640 and 768. Screenshots go to E2E_SCREENSHOTS when
 * it is set (docs/ux/clients-review/fixes/wp12).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const CARD_WIDTHS = [320, 375, 414, 600, 639] as const;
const TABLE_WIDTHS = [640, 768] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

async function noSideways(page: Page, what: string): Promise<void> {
  const widths = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(widths.doc, `${what}: page scrolls sideways`).toBeLessThanOrEqual(widths.inner);
}

const cards = (page: Page) => page.locator('li[data-record-card]');
const tableRows = (page: Page) =>
  page.locator('table.pg-table tbody tr:not([data-skeleton]):not(.gb-state)');

async function size(page: Page, width: number, height = 812): Promise<void> {
  await page.setViewportSize({ width, height });
}

interface Row {
  name: string;
  open: number;
  overdue: number;
  status: string;
}

/** The number of a count cell or link ("14 open" and "14" both read 14; nothing reads 0). */
async function countIn(scope: Locator, kind: 'open' | 'overdue'): Promise<number> {
  const link = scope.locator(`[data-count=${kind}] a`);
  if ((await link.count()) > 0) return Number((await link.innerText()).replace(/\D+/g, ''));
  return 0;
}

async function cardRows(page: Page): Promise<Row[]> {
  // One snapshot of the DOM: a list that reloads under the test cannot take a card away between two reads.
  return cards(page).evaluateAll((els) =>
    els.map((el) => {
      const count = (kind: string) =>
        Number((el.querySelector(`[data-count=${kind}] a`)?.textContent ?? '').replace(/\D+/g, ''));
      return {
        name: el.querySelector('[data-card-name]')?.getAttribute('title') ?? '',
        open: count('open'),
        overdue: count('overdue'),
        status: (el.querySelector('.rc-badges')?.textContent ?? '')
          .replace(/Sensitive/g, '')
          .replace(/\s+/g, ' ')
          .trim(),
      };
    }),
  );
}

/** Waits for the cards to be in this order (a sort reloads the list after the address changed), then returns them. */
async function expectCardsSorted(
  page: Page,
  pick: (r: Row) => number | string,
  dir: 'asc' | 'desc',
): Promise<(number | string)[]> {
  const sorted = (v: (number | string)[]) =>
    [...v].sort((a, b) =>
      typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)),
    );
  const want = (v: (number | string)[]) => (dir === 'asc' ? sorted(v) : sorted(v).reverse());
  await expect
    .poll(async () => {
      const v = (await cardRows(page)).map(pick);
      return v.length > 1 && JSON.stringify(v) === JSON.stringify(want(v));
    })
    .toBe(true);
  return (await cardRows(page)).map(pick);
}

async function tableRowsData(page: Page, nameCol: number, statusCol: number): Promise<Row[]> {
  const out: Row[] = [];
  for (const row of await tableRows(page).all()) {
    const status = (await row.locator(`td:nth-child(${statusCol})`).innerText()).trim();
    out.push({
      name: (await row.locator(`td:nth-child(${nameCol}) a.pg-name`).getAttribute('title')) ?? '',
      open: await countIn(row, 'open'),
      overdue: await countIn(row, 'overdue'),
      status,
    });
  }
  return out;
}

interface World {
  token: string;
  client: Json;
  m1: Json; // sensitive, 4 open (2 overdue)
  m2: Json; // 1 open
  mOff: Json; // inactive
  project: Json;
  archived: Json;
  offClient: Json;
  longClient: Json;
  longMatter: Json;
  longProject: Json;
  sort: Json[];
}

async function build(seed: Seeder, admin: Seeder['admin']): Promise<World> {
  const token = uid();
  const base = await seed.world();
  const client = await seed.client({ name: `Wp12 client ${token}` });
  const m1 = await seed.matter({
    client,
    number: '00001',
    name: `Wp12 matter ${token} one`,
    sensitive: true,
  });
  const m2 = await seed.matter({ client, number: '00002', name: `Wp12 matter ${token} two` });
  const mOff = await seed.matter({ client, number: '00003', name: `Wp12 matter ${token} off` });
  await admin.post(`/api/v1/matters/${mOff.matterId}/active`, {
    isActive: false,
    rowVersion: mOff.rowVersion,
  });
  const project = await seed.project(m1, `Wp12 project ${token}`);
  // The same project name on two matters: only the matter line tells them apart.
  await seed.project(m2, `Wp12 project ${token}`);
  const archived = await seed.project(m2, `Wp12 archived ${token}`);
  await admin.post(`/api/v1/projects/${archived.projectId}/active`, {
    isActive: false,
    rowVersion: archived.rowVersion,
  });
  const w1 = { matter: m1, taskType: base.taskType, workflow: base.workflow };
  const w2 = { matter: m2, taskType: base.taskType, workflow: base.workflow };
  await seed.task(w1, { title: `Wp12 over ${token}`, dueDate: dateInZone(FIRM_ZONE, -3) });
  await seed.task(w1, { title: `Wp12 asap ${token}` });
  await seed.task(w1, { title: `Wp12 later ${token}`, dueDate: dateInZone(FIRM_ZONE, 5) });
  await seed.task(w1, {
    title: `Wp12 project over ${token}`,
    dueDate: dateInZone(FIRM_ZONE, -2),
    projectId: project.projectId,
  });
  await seed.task(w2, { title: `Wp12 two ${token}`, dueDate: dateInZone(FIRM_ZONE, 7) });

  const offClient = await seed.client({ name: `Wp12 off ${token}` });
  await admin.put(`/api/v1/clients/${offClient.clientId}`, {
    name: offClient.name,
    isActive: false,
    rowVersion: offClient.rowVersion,
  });

  // Long names: the 105-character client, the 150-character matter and the 130-character project of the review.
  const longClient = await seed.client({
    name: `Wp12 ${token} Meridian Pharmaceuticals International Holdings, Incorporated and its Subsidiaries and Affiliates (Americas Division)`.slice(
      0,
      105,
    ),
  });
  const longMatter = await seed.matter({
    client,
    number: '00004',
    name: `Wp12 ${token} ${'Master services agreement renegotiation covering every jurisdiction and affiliate '.repeat(3)}`.slice(
      0,
      150,
    ),
  });
  const longProject = await seed.project(
    m2,
    `Wp12 ${token} ${'Clawback and redaction quality control for all custodians '.repeat(3)}`.slice(
      0,
      130,
    ),
  );

  // Three clients with 1, 3 and 2 open tasks for the sort.
  const sort: Json[] = [];
  for (const [i, open] of [1, 3, 2].entries()) {
    const c = await seed.client({ name: `Wp12 sort ${token} ${'ABC'[i]}` });
    const m = await seed.matter({
      client: c,
      number: '00001',
      name: `Wp12 sort matter ${token} ${'ABC'[i]}`,
    });
    for (let t = 0; t < open; t++) {
      await seed.task(
        { matter: m, taskType: base.taskType, workflow: base.workflow },
        { title: `Wp12 s ${token} ${i}${t}` },
      );
    }
    sort.push({ client: c, matter: m });
  }
  return {
    token,
    client,
    m1,
    m2,
    mOff,
    project,
    archived,
    offClient,
    longClient,
    longMatter,
    longProject,
    sort,
  };
}

interface Screen {
  key: string;
  noun: string;
  url: (w: World) => string;
  /** Column of the name and of the status in the table. */
  nameCol: number;
  statusCol: number;
}

const SCREENS: Screen[] = [
  {
    key: 'clients',
    noun: 'clients',
    url: (w) => `/clients?name=${w.token}&status=all`,
    nameCol: 2,
    statusCol: 6,
  },
  {
    key: 'matters',
    noun: 'matters',
    url: (w) => `/matters?name=${w.token}&status=all`,
    nameCol: 2,
    statusCol: 7, // Reference, Name, Client, Project manager, Open tasks, Overdue, Status
  },
  {
    key: 'projects',
    noun: 'projects',
    url: (w) => `/projects?name=${w.token}&status=all`,
    nameCol: 1,
    statusCol: 6,
  },
  {
    key: 'client-matters',
    noun: 'matters',
    url: (w) => `/clients/${w.client.clientId}?tab=matters&status=all`,
    nameCol: 2,
    statusCol: 5,
  },
];

test.describe('WP12 phone cards', () => {
  // Seven widths with axe and a screenshot each, and a database that fills up during a run: more than the default minute.
  test.describe.configure({ timeout: 180_000 });
  let w: World;
  test.beforeAll(async ({ seed, admin }) => {
    test.setTimeout(240_000);
    w = await build(seed, admin);
  });

  for (const screen of SCREENS) {
    test.describe(screen.key, () => {
      test('cards at 320, 375, 414, 600 and 639, the table at 640 and 768: one markup, axe 0, no sideways scroll', async ({
        page,
      }) => {
        await size(page, 375);
        await page.goto(screen.url(w));
        await expect(cards(page).first()).toBeVisible();
        for (const width of CARD_WIDTHS) {
          await size(page, width, width < 400 ? 640 : 812);
          await expect(cards(page).first()).toBeVisible();
          await expect(page.locator('table.pg-table'), `${width}: no table markup`).toHaveCount(0);
          await expect(page.locator('ul[data-record-cards]')).toHaveCount(1);
          await noSideways(page, `${screen.key} ${width}`);
          await axeClean(page, `${screen.key} cards ${width}`);
          if (width === 375 || width === 320) await shot(page, `${screen.key}-cards`);
        }
        for (const width of TABLE_WIDTHS) {
          await size(page, width, 1024);
          await expect(page.locator('table.pg-table'), `${width}: the table`).toHaveCount(1);
          await expect(cards(page), `${width}: no cards in the DOM`).toHaveCount(0);
          await expect(page.locator('ul[data-record-cards]')).toHaveCount(0);
          await noSideways(page, `${screen.key} ${width}`);
          await axeClean(page, `${screen.key} table ${width}`);
        }
        // And back: crossing 640 again brings the cards, with their rows.
        await size(page, 639);
        await expect(cards(page).first()).toBeVisible();
        await expect(page.locator('table.pg-table')).toHaveCount(0);
      });

      test('the cards equal the table at the same address (names, order, counts, status)', async ({
        page,
      }) => {
        await size(page, 1366, 768);
        await page.goto(screen.url(w));
        await expect(tableRows(page).first()).toBeVisible();
        const table = await tableRowsData(page, screen.nameCol, screen.statusCol);
        expect(table.length).toBeGreaterThanOrEqual(3);
        await size(page, 375);
        await expect(cards(page).first()).toBeVisible();
        const phone = await cardRows(page);
        // Projects show a badge for Archived only, the table says Active as well.
        const status = (s: string) => (screen.key === 'projects' && s === 'Active' ? '' : s);
        expect(phone.map((r) => ({ ...r, status: r.status.replace(/\s+/g, ' ') }))).toEqual(
          table.map((r) => ({ ...r, status: status(r.status) })),
        );
      });
    });
  }

  test.describe('Clients (#276)', () => {
    test('a card: name link, "00107 - 63 matters", 5 open and 2 overdue as Task Queue links, the status badge for Active and Inactive', async ({
      page,
      admin,
    }) => {
      await size(page, 375);
      await page.goto(`/clients?name=${w.token}&status=all`);
      const card = cards(page).filter({ hasText: `Wp12 client ${w.token}` });
      await expect(card).toHaveCount(1);
      const name = card.locator('[data-card-name]');
      await expect(name).toHaveAttribute('href', `/clients/${w.client.clientId}`);
      await expect(name).toHaveAttribute('title', `Wp12 client ${w.token}`);
      // Three matters were made active and one inactive; the count is the client's matter count.
      const matters = (await admin.get<Json>(`/api/v1/clients/${w.client.clientId}`)).matterCount;
      await expect(card.locator('[data-card-meta] .rc-ref')).toHaveText(w.client.clientNumber);
      await expect(card.locator('[data-card-meta] .rc-text')).toHaveText(`${matters} matters`);
      await expect(card.locator('.rc-badges')).toContainText('Active');
      const open = card.locator('[data-count=open] a');
      const over = card.locator('[data-count=overdue] a');
      await expect(open).toHaveText('5 open');
      await expect(over).toHaveText('2 overdue');
      await expect(over).toHaveAttribute('href', /overdue=true/);
      await expect(open).toHaveAttribute('href', new RegExp(`client=${w.client.clientId}&status=`));
      await expect(open).toHaveAttribute('aria-label', /^5 open tasks in /);
      // The overdue count is the shared overdue red, with its icon.
      const red = await over.evaluate((el) => getComputedStyle(el).color);
      expect(red).not.toBe(await open.evaluate((el) => getComputedStyle(el).color));
      await expect(over.locator('.pi')).toHaveCount(1);
      await shot(page, 'clients-card-counts');

      // A client with nothing overdue has no overdue count at all; an inactive client says Inactive.
      const quiet = cards(page).filter({ hasText: `Wp12 sort ${w.token} A` });
      await expect(quiet.locator('[data-count=overdue]')).toHaveCount(0);
      await expect(quiet.locator('[data-count=open] a')).toHaveText('1 open');
      await expect(
        cards(page)
          .filter({ hasText: `Wp12 off ${w.token}` })
          .locator('.rc-badges'),
      ).toContainText('Inactive');
      // The open count opens the Task Queue with exactly those tasks.
      await open.click();
      await expect(page).toHaveURL(new RegExp(`/tasks\\?client=${w.client.clientId}&`));
      await expect(page.locator('[data-range]')).toContainText('of 5');
    });

    test('the 105-character name clamps at two lines with the full text as tooltip; the card is at most 96 px', async ({
      page,
    }) => {
      for (const width of [320, 375]) {
        await size(page, width, 640);
        await page.goto(`/clients?name=${w.token}&status=all`);
        const card = cards(page).filter({ hasText: `Wp12 ${w.token} Meridian` });
        await expect(card).toHaveCount(1);
        const name = card.locator('[data-card-name]');
        expect(((await name.getAttribute('title')) ?? '').length).toBe(w.longClient.name.length);
        const box = (await card.boundingBox())!;
        expect(box.height, `${width}: card height`).toBeLessThanOrEqual(96);
        expect(box.height).toBeGreaterThanOrEqual(64);
        const nameBox = (await name.boundingBox())!;
        expect(nameBox.height, 'two lines of 20 px at most').toBeLessThanOrEqual(41);
        await expect(card.locator('.rc-badges')).toBeVisible();
        const clipped = await name.evaluate((el) => el.scrollHeight > el.clientHeight);
        expect(clipped, 'the long name is cut (ellipsis), not wrapped further').toBe(true);
        await shot(page, 'clients-long-name');
      }
    });

    test('Filters sheet: Sort by (Client number, Name, Open tasks, Overdue) reorders the cards like the headers, Esc returns focus', async ({
      page,
    }) => {
      await size(page, 375);
      await page.goto(`/clients?name=${w.token}&status=all`);
      await expect(cards(page).first()).toBeVisible();
      const filters = page.locator('[data-filters-toggle]');
      await filters.click();
      const sheet = page.locator('[data-filter-sheet]');
      await expect(sheet).toBeVisible();
      const select = sheet.locator('[data-sort-select]');
      expect((await select.locator('option').allInnerTexts()).map((t) => t.trim())).toEqual([
        'Client number',
        'Name',
        'Open tasks',
        'Overdue',
      ]);
      await expect(select).toHaveValue('clientNumber');
      await axeClean(page, 'clients sheet open');
      await shot(page, 'clients-sheet');
      await select.selectOption('openTasks');
      await expect(page).toHaveURL(/sort=-openTasks/);
      await expect(sheet.locator('[data-dir-select]')).toHaveValue('desc');
      await sheet.locator('[data-dir-select]').selectOption('asc');
      await expect(page).toHaveURL(/sort=openTasks(&|$)/);
      await sheet.locator('[data-sort-select]').selectOption('openTasks');
      await sheet.locator('[data-dir-select]').selectOption('desc');
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      await expect(filters).toBeFocused();
      await expect(page).toHaveURL(/sort=-openTasks/);
      const phone = await expectCardsSorted(page, (r) => r.open, 'desc');
      // The same address on the desktop gives the same order.
      const url = page.url();
      await size(page, 1366, 768);
      await page.goto(url);
      await expect(tableRows(page).first()).toBeVisible();
      const table = (await tableRowsData(page, 2, 6)).map((r) => r.open);
      expect(table).toEqual(phone);
      // Name, descending, through the sheet.
      await size(page, 375);
      await filters.click();
      await sheet.locator('[data-sort-select]').selectOption('name');
      await sheet.locator('[data-dir-select]').selectOption('desc');
      await expect(page).toHaveURL(/sort=-name/);
      await expectCardsSorted(page, (r) => r.name, 'desc');
      // Back to the default order: no sort in the address.
      await sheet.locator('[data-sort-select]').selectOption('clientNumber');
      await sheet.locator('[data-dir-select]').selectOption('asc');
      await expect(page).not.toHaveURL(/sort=/);
    });

    test('the sheet filters the cards; the sheet is a dialog with a focus trap; the pager is one row', async ({
      page,
    }) => {
      await size(page, 375);
      await page.goto(`/clients?status=all&name=${w.token}`);
      await expect(cards(page).first()).toBeVisible();
      const total = await cards(page).count();
      expect(total).toBeGreaterThan(3);
      const filters = page.locator('[data-filters-toggle]');
      await filters.click();
      const sheet = page.locator('[data-filter-sheet]');
      await expect(sheet).toHaveAttribute('role', 'dialog');
      // Focus stays inside: Tab through the whole sheet comes back to its first control.
      const first = sheet.locator('[data-sort-select]');
      await expect(first).toBeFocused();
      for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
      expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      await sheet.getByLabel('Filter by Name').fill(`sort ${w.token} B`);
      await expect(cards(page)).toHaveCount(1);
      await expect(page).toHaveURL(/name=/);
      await sheet.locator('[data-sheet-show]').click();
      await expect(sheet).toHaveCount(0);
      await expect(cards(page)).toHaveCount(1);
      // The pager: Previous, Page n of m, Next on one row, 44 px targets.
      await page.goto(`/clients?status=all&size=25`);
      await expect(cards(page).first()).toBeVisible();
      const pager = page.locator('nav[aria-label="Pagination"]');
      await expect(pager).toBeVisible();
      const prev = (await pager.getByRole('button', { name: 'Previous' }).boundingBox())!;
      const next = (await pager.getByRole('button', { name: 'Next' }).boundingBox())!;
      const label = (await pager.locator('[data-page]').boundingBox())!;
      expect(Math.abs(prev.y - next.y)).toBeLessThan(2);
      expect(Math.abs(prev.y - label.y)).toBeLessThan(30);
      expect(prev.height).toBeGreaterThanOrEqual(44);
      await shot(page, 'clients-pager');
    });
  });

  test.describe('Matters (#277)', () => {
    test('a card: name link, "00107-00001 - Client" on one line with the mono reference, counts, status and the Sensitive badge, the copy button last-but-name', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await size(page, 375);
      await page.goto(`/matters?name=${w.token}&status=all`);
      const card = cards(page).filter({ hasText: `Wp12 matter ${w.token} one` });
      await expect(card).toHaveCount(1);
      const ref = `${w.client.clientNumber}-00001`;
      await expect(card.locator('[data-card-name]')).toHaveAttribute(
        'href',
        `/matters/${w.m1.matterId}`,
      );
      const meta = card.locator('[data-card-meta]');
      await expect(meta.locator('.rc-ref')).toHaveText(ref);
      expect(
        await meta.locator('.rc-ref').evaluate((el) => getComputedStyle(el).fontFamily),
      ).toMatch(/mono|Consolas|Menlo|Courier/i);
      expect(await meta.locator('.rc-ref').evaluate((el) => getComputedStyle(el).whiteSpace)).toBe(
        'nowrap',
      );
      await expect(meta.locator('[data-card-client]')).toHaveText(`Wp12 client ${w.token}`);
      await expect(meta.locator('a[data-card-client]')).toHaveAttribute(
        'href',
        `/clients/${w.client.clientId}`,
      );
      await expect(card.locator('.rc-badges')).toContainText('Active');
      const sensitive = card.locator('.rc-badges mf-sensitive-badge');
      await expect(sensitive).toContainText('Sensitive');
      await expect(sensitive.locator('.pi-lock')).toHaveCount(1);
      await expect(card.locator('[data-count=open] a')).toHaveText('4 open');
      await expect(card.locator('[data-count=overdue] a')).toHaveText('2 overdue');
      // The meta line is one line.
      const lineBox = (await meta.boundingBox())!;
      expect(lineBox.height).toBeLessThanOrEqual(26);
      // Focus order: the name first, the copy button second.
      const order = await card.evaluate((el) =>
        Array.from(el.querySelectorAll<HTMLElement>('a[href], button')).map(
          (n) => n.getAttribute('aria-label') ?? n.getAttribute('data-card-name') ?? n.tagName,
        ),
      );
      expect(order[0]).toBe('');
      expect(order[1]).toBe('Copy matter number');
      // The copy button is a 44 px target and copies the reference.
      const copy = card.getByRole('button', { name: 'Copy matter number' });
      const box = (await copy.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await copy.click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ref);
      await shot(page, 'matters-card-sensitive');
      // An inactive matter says Inactive.
      await expect(
        cards(page)
          .filter({ hasText: `Wp12 matter ${w.token} off` })
          .locator('.rc-badges'),
      ).toContainText('Inactive');
    });

    test('the 150-character name clamps at two lines and keeps its badges; nothing overlaps at 320', async ({
      page,
    }) => {
      for (const width of [320, 375]) {
        await size(page, width, 640);
        await page.goto(`/matters?name=${w.token}&status=all`);
        const card = cards(page).filter({ hasText: `Wp12 ${w.token} Master` });
        await expect(card).toHaveCount(1);
        const name = card.locator('[data-card-name]');
        expect(((await name.getAttribute('title')) ?? '').length).toBe(w.longMatter.name.length);
        expect((await name.boundingBox())!.height).toBeLessThanOrEqual(41);
        const nameBox = (await name.boundingBox())!;
        const badges = (await card.locator('.rc-badges').boundingBox())!;
        expect(
          nameBox.x + nameBox.width,
          `${width}: the badges do not overlap the name`,
        ).toBeLessThanOrEqual(badges.x + 1);
        const cardBox = (await card.boundingBox())!;
        expect(badges.x + badges.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
        await shot(page, 'matters-long-name');
      }
    });

    test('the sheet sorts by Reference, Name, Client, Open tasks, Overdue and the cards follow', async ({
      page,
    }) => {
      await size(page, 375);
      await page.goto(`/matters?name=${w.token}&status=all`);
      await expect(cards(page).first()).toBeVisible();
      await page.locator('[data-filters-toggle]').click();
      const sheet = page.locator('[data-filter-sheet]');
      expect(
        (await sheet.locator('[data-sort-select] option').allInnerTexts()).map((t) => t.trim()),
      ).toEqual(['Reference', 'Name', 'Client', 'Project manager', 'Open tasks', 'Overdue']);
      // The sheet also carries Status and Sensitive (#272).
      await expect(sheet.getByLabel('Filter by Sensitive')).toBeVisible();
      await expect(sheet.getByLabel('Filter by Status')).toBeVisible();
      await axeClean(page, 'matters sheet open');
      await sheet.locator('[data-sort-select]').selectOption('overdue');
      await expect(page).toHaveURL(/sort=-overdue/);
      await expectCardsSorted(page, (r) => r.overdue, 'desc');
      await shot(page, 'matters-sheet');
    });

    test('the client Matters tab: no client text on the cards, the tab strip still works, the same sheet', async ({
      page,
    }) => {
      await size(page, 375);
      await page.goto(`/clients/${w.client.clientId}?tab=matters&status=all`);
      await expect(cards(page).first()).toBeVisible();
      await expect(page.locator('[data-card-client]')).toHaveCount(0);
      const first = cards(page).filter({ hasText: `Wp12 matter ${w.token} one` });
      await expect(first.locator('[data-card-meta] .rc-ref')).toHaveText(
        `${w.client.clientNumber}-00001`,
      );
      await expect(first.locator('.rc-badges')).toContainText('Sensitive');
      // The tab strip: Overview and back to Matters.
      await page.getByRole('tab', { name: /Overview|Details/ }).click();
      await expect(cards(page)).toHaveCount(0);
      await page.getByRole('tab', { name: /Matters/ }).click();
      await expect(cards(page).first()).toBeVisible();
      await page.locator('[data-filters-toggle]').click();
      const sheet = page.locator('[data-filter-sheet]');
      expect(
        (await sheet.locator('[data-sort-select] option').allInnerTexts()).map((t) => t.trim()),
      ).toEqual(['Reference', 'Name', 'Open tasks', 'Overdue']);
      await axeClean(page, 'client matters sheet open');
      await shot(page, 'client-matters-sheet');
      await page.keyboard.press('Escape');
      await shot(page, 'client-matters-tab');
    });
  });

  test.describe('Projects (#278)', () => {
    test('a card: name, "00121-00005 - Matter name" as a link, the client name muted, counts, Archived badge only for archived; same names are told apart', async ({
      page,
    }) => {
      await size(page, 375);
      await page.goto(`/projects?name=${w.token}&status=all`);
      const same = cards(page).filter({ hasText: `Wp12 project ${w.token}` });
      await expect(same).toHaveCount(2);
      const lines = await same.locator('[data-card-matter]').allInnerTexts();
      expect(
        new Set(lines.map((l) => l.replace(/\s+/g, ' '))).size,
        'the matter line differs',
      ).toBe(2);
      const one = same.filter({ hasText: `Wp12 matter ${w.token} one` });
      await expect(one.locator('[data-card-matter] .rc-ref')).toHaveText(
        `${w.client.clientNumber}-00001`,
      );
      await expect(one.locator('[data-card-matter] a')).toHaveAttribute(
        'href',
        `/matters/${w.m1.matterId}`,
      );
      await expect(one.locator('[data-card-client]')).toHaveText(`Wp12 client ${w.token}`);
      await expect(one.locator('.rc-badges')).toHaveCount(1);
      await expect(one.locator('.rc-badges')).toHaveText('');
      await expect(one.locator('[data-count=open] a')).toHaveText('1 open');
      await expect(one.locator('[data-count=overdue] a')).toHaveText('1 overdue');
      const gone = cards(page).filter({ hasText: `Wp12 archived ${w.token}` });
      await expect(gone.locator('.rc-badges')).toContainText('Archived');
      await expect(gone.locator('.rc-badges .pi')).toHaveCount(1);
      await shot(page, 'projects-cards');
    });

    test('the 130-character name clamps at two lines; the sheet sorts by Name, Matter, Open tasks, Overdue', async ({
      page,
    }) => {
      for (const width of [320, 375]) {
        await size(page, width, 640);
        await page.goto(`/projects?name=${w.token}&status=all`);
        const card = cards(page).filter({ hasText: `Wp12 ${w.token} Clawback` });
        await expect(card).toHaveCount(1);
        const name = card.locator('[data-card-name]');
        expect(((await name.getAttribute('title')) ?? '').length).toBe(w.longProject.name.length);
        expect((await name.boundingBox())!.height).toBeLessThanOrEqual(41);
      }
      await page.locator('[data-filters-toggle]').click();
      const sheet = page.locator('[data-filter-sheet]');
      expect(
        (await sheet.locator('[data-sort-select] option').allInnerTexts()).map((t) => t.trim()),
      ).toEqual(['Name', 'Matter', 'Open tasks', 'Overdue']);
      await axeClean(page, 'projects sheet open');
      await sheet.locator('[data-sort-select]').selectOption('matterRef');
      await expect(page).toHaveURL(/sort=matterRef/);
      await shot(page, 'projects-sheet');
    });
  });

  test.describe('states are the table states (#275)', () => {
    const LISTS = [
      { api: '/api/v1/clients', url: '/clients', noun: 'clients', none: /No clients yet\./ },
      { api: '/api/v1/matters', url: '/matters', noun: 'matters', none: /No matters yet\./ },
      {
        api: '/api/v1/projects',
        url: '/projects',
        noun: 'projects',
        none: /No projects yet\. Open a matter and choose New project\./,
      },
    ];

    async function stub(page: Page, api: string, mode: 'hung' | 'error' | 'forbidden' | 'empty') {
      const seen = { n: 0 };
      await page.route(
        (url) => url.pathname === api,
        async (route: Route) => {
          seen.n++;
          if (mode === 'hung') return new Promise<void>(() => undefined);
          if (mode === 'error' && seen.n > 1) return route.fallback();
          if (mode === 'error' || mode === 'forbidden') {
            return route.fulfill({
              status: mode === 'error' ? 500 : 403,
              contentType: 'application/problem+json',
              body: JSON.stringify({
                type: 'about:blank',
                title: mode,
                status: mode === 'error' ? 500 : 403,
                code: mode === 'error' ? 'SERVER_ERROR' : 'FORBIDDEN',
                traceId: 'wp12-trace-0001',
              }),
            });
          }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 25 }),
          });
        },
      );
    }

    for (const list of LISTS) {
      test(`${list.noun}: loading, 500 with Retry, 403, empty and filtered-empty as cards`, async ({
        page,
      }) => {
        await size(page, 375);
        // Loading: five skeleton cards, one polite sentence.
        await stub(page, list.api, 'hung');
        await page.goto(list.url);
        await expect(page.locator('li[data-skeleton]')).toHaveCount(5);
        await expect(page.locator('[data-loading]')).toHaveText(`Loading ${list.noun}`);
        await axeClean(page, `${list.noun} loading`);
        await shot(page, `${list.noun}-loading`);
        await page.unrouteAll({ behavior: 'ignoreErrors' });

        // 500: the text, the reference, Retry; a Retry that works shows the cards and focuses the first link.
        await stub(page, list.api, 'error');
        await page.goto(list.url);
        const error = page.locator('[data-error]');
        await expect(error).toContainText(`Couldn't load ${list.noun}.`);
        await expect(error).toContainText('wp12-trace-0001');
        await axeClean(page, `${list.noun} error`);
        await shot(page, `${list.noun}-error`);
        await error.getByRole('button', { name: 'Retry' }).click();
        await expect(cards(page).first()).toBeVisible();
        await expect(page.locator('li[data-record-card] a').first()).toBeFocused();
        await page.unrouteAll({ behavior: 'ignoreErrors' });

        // 403: the sentence, no Retry.
        await stub(page, list.api, 'forbidden');
        await page.goto(list.url);
        await expect(page.locator('[data-forbidden]')).toContainText(
          `You don't have access to ${list.noun}.`,
        );
        await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
        await page.unrouteAll({ behavior: 'ignoreErrors' });

        // Empty: the first-run text; filtered-empty: Clear filters.
        await stub(page, list.api, 'empty');
        await page.goto(list.url);
        await expect(page.locator('[data-empty=none]')).toContainText(list.none);
        await axeClean(page, `${list.noun} empty`);
        await shot(page, `${list.noun}-empty`);
        await page.goto(`${list.url}?name=zzz-none`);
        const filtered = page.locator('[data-empty=filtered]');
        await expect(filtered).toContainText(`No ${list.noun} match these filters`);
        await filtered.getByRole('button', { name: 'Clear filters' }).click();
        await expect(page).not.toHaveURL(/name=/);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
      });
    }

    test('the Projects empty copy links to Matters only with Matter.View', async ({
      page,
      asUser,
      seed,
    }) => {
      await size(page, 375);
      await stub(page, '/api/v1/projects', 'empty');
      await page.goto('/projects');
      await expect(
        page.locator('[data-empty=none] a', { hasText: 'Open a matter' }),
      ).toHaveAttribute('href', '/matters');
      const role = await seed.role(['Project.View', 'Task.View'], 'E2E projects only');
      const user = await seed.user([role.name], 'wp12-nomatter');
      const other = await asUser(user.username);
      await other.setViewportSize({ width: 375, height: 812 });
      await stub(other, '/api/v1/projects', 'empty');
      await other.goto('/projects');
      await expect(other.locator('[data-empty=none]')).toContainText(
        'No projects yet. Open a matter and choose New project.',
      );
      await expect(other.locator('[data-empty=none] a')).toHaveCount(0);
    });
  });

  test.describe('permissions', () => {
    test('without Task.View the cards have no counts; without Client.View and Matter.View the lines are text', async ({
      asUser,
      seed,
    }) => {
      const role = await seed.role(['Matter.View', 'Project.View'], 'E2E no task or client');
      const user = await seed.user([role.name], 'wp12-notask');
      const page = await asUser(user.username);
      await size(page, 375);
      await page.goto(`/matters?name=${w.token}&status=all`);
      await expect(cards(page).first()).toBeVisible();
      await expect(page.locator('[data-count]')).toHaveCount(0);
      // The client name is text, not a link.
      const matter = cards(page).filter({ hasText: `Wp12 matter ${w.token} one` });
      await expect(matter.locator('[data-card-client]')).toHaveText(`Wp12 client ${w.token}`);
      await expect(matter.locator('a[data-card-client]')).toHaveCount(0);
      // The matter name is still the one link of the card, plus the copy button.
      await expect(matter.locator('a')).toHaveCount(1);
      await page.goto(`/projects?name=${w.token}&status=all`);
      await expect(cards(page).first()).toBeVisible();
      await expect(page.locator('[data-count]')).toHaveCount(0);
      await expect(page.locator('[data-card-matter] a')).toHaveCount(await cards(page).count());
      // A phone sheet without Task.View has no count sorts.
      await page.locator('[data-filters-toggle]').click();
      expect(
        (await page.locator('[data-sort-select] option').allInnerTexts()).map((t) => t.trim()),
      ).toEqual(['Name', 'Matter']);
      await axeClean(page, 'no task view sheet');

      const projectsOnly = await seed.role(['Project.View', 'Task.View'], 'E2E projects only');
      const user2 = await seed.user([projectsOnly.name], 'wp12-nomatterview');
      const page2 = await asUser(user2.username);
      await size(page2, 375);
      await page2.goto(`/projects?name=${w.token}&status=all`);
      await expect(cards(page2).first()).toBeVisible();
      await expect(page2.locator('[data-card-matter] a')).toHaveCount(0);
      await expect(page2.locator('[data-card-matter] .rc-ref').first()).toBeVisible();
    });
  });
});
