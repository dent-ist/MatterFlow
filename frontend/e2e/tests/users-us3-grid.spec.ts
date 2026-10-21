import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Persona } from '../support/personas';

/**
 * Users epic #422, WP-US3: the Users grid on the record-list contract (#432) and the one action column (#433).
 *  - six columns (Name over the Windows account, Roles, Pods, Availability, Status, one action column), rows exactly 44 px with a 130-character
 *    name, a 90-character role and two pods, no sideways scroll of the page or the table from 1366 px, the optional columns leave in the kit
 *    order (Pods below 1280 px, Roles below 1100 px), no "Scroll sideways" hint;
 *  - the name is the one control of the Name cell and opens the panel; focus returns to it; the accessible names carry the account;
 *  - Status is a badge only when the person is not simply Active; Email and First seen are filters in "Other filters" only;
 *  - one Tab stop for the name and one for the action (Grant access on a pending row, the row menu on every other); the menu offers Open,
 *    Edit availability and Activate / Deactivate with User.Manage and only Open without it; arrows, Esc and focus return.
 * Screenshots for docs/ux/users-review/fixes/us3-grid/ are written when E2E_SCREENSHOTS is set to the output folder.
 */
const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const OUT = process.env['E2E_SCREENSHOTS'];
const TAG = `us3g${Math.floor(Math.random() * 90000) + 10000}`;
const SAME = `Sam Same ${TAG}`;

let pendingLong: Persona;
let busy: Persona;
let away: Persona;
let gone: Persona;
let twinA: Persona;
let twinB: Persona;
let longRoleName: string;

test.beforeAll(async ({ personas, seed, admin }) => {
  pendingLong = await personas.create({ label: `${TAG}pend`, displayNameLength: 130 });
  longRoleName = `${TAG} ${'Senior Document Review Coordinator '.repeat(3)}`.trim().slice(0, 90);
  const role = await admin.post('/api/v1/roles', {
    name: longRoleName,
    description: null,
    permissionCodes: ['Task.View'],
  });
  busy = await personas.create({ label: `${TAG}busy`, roles: ['Data Technician'] });
  const detail = await admin.get(`/api/v1/users/${busy.userId}`);
  await admin.put(`/api/v1/users/${busy.userId}/roles`, {
    roleIds: [...detail.roleIds, role.roleId],
    rowVersion: detail.rowVersion,
  });
  const podA = await seed.pod(`Processing ${TAG}`, [busy.userId]);
  await seed.pod(`Quality review of long documents ${TAG}`, [busy.userId]);
  expect(podA.podId).toBeGreaterThan(0);
  away = await personas.create({ label: `${TAG}away`, roles: ['Data Technician'] });
  await seed.outOfOffice(away.userId, { note: 'Away', until: '2027-10-25' });
  gone = await personas.create({ label: `${TAG}gone`, roles: ['Data Technician'], disabled: true });
  twinA = await personas.create({
    label: `${TAG}twa`,
    roles: ['Data Technician'],
    displayName: SAME,
  });
  twinB = await personas.create({
    label: `${TAG}twb`,
    roles: ['Data Technician'],
    displayName: SAME,
  });
});

const listUrl = (extra = '') => `/admin/users?status=all&account=e2e-${TAG}${extra}`;
const rows = (page: Page) => page.locator('tr[data-user]');

async function shot(page: Page, name: string, width: number, height: number): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}-${width}x${height}.png`) });
}

async function openList(page: Page, width: number, height: number, extra = ''): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(listUrl(extra));
  // The six people of this file (a test may add a seventh: its own viewer).
  await expect(nameButton(page, twinB.userId)).toBeVisible();
  expect(await rows(page).count()).toBeGreaterThanOrEqual(6);
}

const noSideScroll = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

async function axeClean(page: Page) {
  const found = await axeViolations(page);
  return found
    .map((v) =>
      v.id === 'target-size'
        ? { ...v, nodes: v.nodes.filter((n) => !(n.why ?? '').includes('partially obscured')) }
        : v,
    )
    .filter((v) => v.nodes.length > 0);
}

const headers = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('table.mf-grid thead tr:first-child th'))
      .filter((th) => getComputedStyle(th).display !== 'none')
      .map((th) => th.textContent!.trim()),
  );

const nameButton = (page: Page, id: number) =>
  page.locator(`tr[data-user="${id}"] button[data-open]`);
const menuButton = (page: Page, id: number) =>
  page.locator(`tr[data-user="${id}"] button[data-overflow]`);

test.describe('#432 the grid', () => {
  for (const { width, height } of [SIZES[2], SIZES[3]]) {
    test(`rows are exactly 44 px and nothing scrolls sideways at ${width}`, async ({ page }) => {
      await openList(page, width, height);
      const heights = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('tr[data-user]')).map((r) => ({
          id: r.dataset['user'],
          h: Math.round(r.getBoundingClientRect().height * 10) / 10,
        })),
      );
      for (const r of heights) expect(r.h, `row ${r.id}`).toBeLessThanOrEqual(45); // 44 px; the collapsed border adds up to a pixel (as in ad2-kit-grid);
      for (const r of heights) expect(r.h, `row ${r.id}`).toBeGreaterThanOrEqual(43);
      const wrap = await page.evaluate(() => {
        const w = document.querySelector<HTMLElement>('.mf-table-wrap')!;
        return w.scrollWidth <= w.clientWidth + 1;
      });
      expect(wrap).toBe(true);
      expect(await noSideScroll(page)).toBe(true);
      // Last seen (#437) is the seventh column and has room from 1440 px only.
      expect(await headers(page)).toEqual(
        width >= 1440
          ? ['Name', 'Roles', 'Pods', 'Availability', 'Last seen', 'Status', 'Actions']
          : ['Name', 'Roles', 'Pods', 'Availability', 'Status', 'Actions'],
      );
      await expect(page.locator('[data-scroll-hint]')).toHaveCount(0);
    });
  }

  test('the 130-character name is clamped to two lines with the whole name as the tooltip; the 90-character role is one clipped line', async ({
    page,
  }) => {
    await openList(page, 1366, 768);
    const name = nameButton(page, pendingLong.userId);
    await expect(name).toHaveAttribute('title', pendingLong.displayName!);
    const cell = page.locator(`tr[data-user="${pendingLong.userId}"] button[data-open]`);
    const lines = await cell.evaluate((el) => {
      const style = getComputedStyle(el);
      const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
      return Math.round(el.getBoundingClientRect().height / line);
    });
    expect(lines).toBeLessThanOrEqual(2);
    const role = page.locator(`tr[data-user="${busy.userId}"] td.mf-cell-muted`);
    await expect(role).toHaveAttribute('title', new RegExp(longRoleName.slice(0, 40)));
  });

  // The table is for 640 px and wider; below that the list is cards (users-us5-phone).
  for (const { width, height } of SIZES.filter((size) => size.width >= 640)) {
    test(`axe 0, no sideways scroll of the page and the columns that fit, at ${width}`, async ({
      page,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      await openList(page, width, height);
      const shown = await headers(page);
      if (width >= 1440)
        expect(shown).toEqual([
          'Name',
          'Roles',
          'Pods',
          'Availability',
          'Last seen',
          'Status',
          'Actions',
        ]);
      else if (width >= 1280)
        expect(shown).toEqual(['Name', 'Roles', 'Pods', 'Availability', 'Status', 'Actions']);
      else if (width >= 1100)
        expect(shown).toEqual(['Name', 'Roles', 'Availability', 'Status', 'Actions']);
      else expect(shown).toEqual(['Name', 'Availability', 'Status', 'Actions']);
      expect(await noSideScroll(page)).toBe(true);
      expect(await axeClean(page)).toEqual([]);
      await shot(page, 'users-grid', width, height);

      // With a row menu open.
      await menuButton(page, busy.userId).click();
      await expect(page.getByRole('menu')).toBeVisible();
      expect(await axeClean(page)).toEqual([]);
      await shot(page, 'users-grid-menu', width, height);
    });
  }

  test('Status is a badge only when the person is not simply Active; Active is said to a screen reader', async ({
    page,
  }) => {
    await openList(page, 1366, 768);
    await expect(
      page.locator(`tr[data-user="${pendingLong.userId}"] [data-status] mf-badge`),
    ).toContainText('Pending access');
    await expect(
      page.locator(`tr[data-user="${gone.userId}"] [data-status] mf-badge`),
    ).toContainText('Inactive');
    await expect(page.locator(`tr[data-user="${busy.userId}"] [data-status] mf-badge`)).toHaveCount(
      0,
    );
    await expect(page.locator(`tr[data-user="${busy.userId}"] [data-status]`)).toContainText(
      'Active',
    );
  });

  test('Email and First seen are not columns; the filters stay in Other filters and in the address', async ({
    page,
  }) => {
    await openList(page, 1366, 768);
    await expect(page.getByRole('columnheader', { name: 'Email' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'First seen' })).toHaveCount(0);
    await page.locator('[data-more-filters]').click();
    for (const label of ['Windows account', 'First seen', 'Email']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await page.keyboard.press('Escape');

    // An Email filter in the address still filters (nobody has this e-mail) and shows as a chip.
    await page.goto(listUrl('&email=nobody-has-this'));
    await expect(page.locator('td[data-empty="filtered"]')).toContainText(
      'No users match these filters',
    );
    await expect(page.locator('[data-filter-chips]')).toContainText('Email');
  });

  test('the name opens the panel, Esc closes it and focus is back on the name', async ({
    page,
  }) => {
    await openList(page, 1366, 768);
    const name = nameButton(page, busy.userId);
    await name.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-panel-heading]')).toBeFocused();
    await expect(page.locator('[data-panel]')).toContainText('Email');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-panel]')).toHaveCount(0);
    await expect(name).toBeFocused();
  });

  test('two people with the same display name have different names for their controls', async ({
    page,
  }) => {
    await openList(page, 1366, 768);
    const a = nameButton(page, twinA.userId);
    const b = nameButton(page, twinB.userId);
    await expect(a).toHaveText(SAME);
    await expect(b).toHaveText(SAME);
    const nameA = await a.getAttribute('aria-label');
    const nameB = await b.getAttribute('aria-label');
    expect(nameA).toBe(`Open ${SAME} (${twinA.username})`);
    expect(nameB).toBe(`Open ${SAME} (${twinB.username})`);
    await expect(menuButton(page, twinA.userId)).toHaveAttribute(
      'aria-label',
      `Actions for ${SAME} (${twinA.username})`,
    );
    // A person you can find by their name.
    await expect(page.getByRole('button', { name: nameA! })).toHaveCount(1);
  });

  test('the Pods and Availability cells keep their meaning in one line', async ({ page }) => {
    await openList(page, 1920, 1080);
    const busyRow = page.locator(`tr[data-user="${busy.userId}"]`);
    await expect(busyRow.locator('[data-pods-cell]')).toContainText(`Processing ${TAG}`);
    await expect(
      page.locator(`tr[data-user="${away.userId}"] [data-availability-chip]`),
    ).toContainText('Out of office');
  });

  test('#434 availability informs only where it matters: chip for Out of office, nothing for Pending or Inactive', async ({
    page,
  }) => {
    await openList(page, 1366, 768);
    const cell = (id: number) => page.locator(`tr[data-user="${id}"] [data-availability-cell]`);
    // Out of office keeps its chip with the end date; an ordinary active person says a plain, muted "Available" (no badge).
    await expect(cell(away.userId).locator('[data-availability-chip]')).toContainText(
      /Out of office until/,
    );
    // An ordinary person says "Available" in plain muted text; outside their work hours the server reports Off hours, which is a chip.
    await expect(cell(busy.userId)).toHaveText(/^\s*(Available|Off hours)\s*$/);
    if ((await cell(busy.userId).textContent())?.includes('Available')) {
      await expect(cell(busy.userId).locator('[data-availability-chip]')).toHaveCount(0);
    }
    // Pending and Inactive people have no availability at all.
    await expect(cell(pendingLong.userId)).toHaveText('');
    await expect(cell(gone.userId)).toHaveText('');
    // One muted line: the rows stay at 44 px.
    for (const id of [away.userId, busy.userId, pendingLong.userId, gone.userId]) {
      const h = await page
        .locator(`tr[data-user="${id}"]`)
        .evaluate((r) => r.getBoundingClientRect().height);
      expect(h, `row ${id}`).toBeLessThanOrEqual(45);
    }
  });

  test('a Task.View-only person gets no list', async ({ personas, asUser }) => {
    const other = await personas.named('taskViewOnly');
    const page = await asUser(other.username);
    await page.goto(listUrl());
    await expect(rows(page)).toHaveCount(0);
  });
});

test.describe('#433 one action per row', () => {
  test('a pending row has the name and Grant access (two Tab stops); the other rows the name and the row menu', async ({
    page,
  }) => {
    await openList(page, 1366, 768);
    const stops = (id: number) =>
      page.evaluate(
        (userId) =>
          Array.from(
            document.querySelectorAll<HTMLElement>(
              `tr[data-user="${userId}"] a, tr[data-user="${userId}"] button`,
            ),
          ).filter((el) => el.tabIndex >= 0 && el.offsetParent !== null).length,
        id,
      );
    // The Pods cell is one more button for a person with Pod.ManageMembers (the System Admin has it): count the stops of the name and the action.
    const pendingRow = page.locator(`tr[data-user="${pendingLong.userId}"]`);
    await expect(pendingRow.getByRole('button', { name: /^Grant access to/ })).toBeVisible();
    await expect(pendingRow.locator('button[data-overflow]')).toHaveCount(0);
    expect(await stops(pendingLong.userId)).toBe(
      2 + (await pendingRow.locator('[data-pods-trigger]').count()),
    );
    const busyRow = page.locator(`tr[data-user="${busy.userId}"]`);
    await expect(busyRow.getByRole('button', { name: /^Grant access/ })).toHaveCount(0);
    expect(await stops(busy.userId)).toBe(
      2 + (await busyRow.locator('[data-pods-trigger]').count()),
    );
  });

  test('the row menu: Enter opens, arrows move, Esc closes and focus returns to its button', async ({
    page,
  }) => {
    await openList(page, 1366, 768);
    const trigger = menuButton(page, busy.userId);
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Open',
      'Edit availability',
      'Deactivate',
    ]);
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Edit availability' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('Edit availability opens the dialog; Deactivate opens the person with the question on screen; Activate needs no question', async ({
    page,
    personas,
  }) => {
    const revived = await personas.create({
      label: `${TAG}rev`,
      roles: ['Data Technician'],
      disabled: true,
    });
    await openList(page, 1366, 768);
    await menuButton(page, busy.userId).click();
    await page.getByRole('menuitem', { name: 'Edit availability' }).click();
    await expect(page.getByRole('dialog')).toContainText('Availability of');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await menuButton(page, busy.userId).click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    // The drawer opens with the question on screen (focus on Cancel); Cancel keeps the person active.
    const question = page.getByRole('dialog', { name: /^Deactivate / });
    await expect(question.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await question.getByRole('button', { name: 'Cancel' }).click();
    await expect(question).toBeHidden();
    await expect(page.locator('[data-panel-heading]')).toBeVisible();
    // Esc with a change asks first; Leave closes the drawer.
    await page.locator('[data-name]').fill('Changed Name');
    await page.keyboard.press('Escape');
    await page
      .getByRole('dialog', { name: 'Leave without saving?' })
      .getByRole('button', { name: 'Leave' })
      .click();
    await expect(page.locator('[data-panel]')).toHaveCount(0);
    // Focus goes back to the menu button that opened the drawer (after the question's dialog has left).
    await expect(menuButton(page, busy.userId)).toBeFocused();

    // Activate needs no question: the menu item activates the person at once (a person of its own: the others of this file stay as they are).
    await page.reload();
    await expect(nameButton(page, twinB.userId)).toBeVisible();
    await expect(async () => {
      await menuButton(page, revived.userId).click();
      await expect(page.getByRole('menuitem')).toHaveText(
        ['Open', 'Edit availability', 'Activate'],
        { timeout: 1500 },
      );
    }).toPass();
    await page.getByRole('menuitem', { name: 'Activate' }).click();
    await expect(page.getByRole('button', { name: /^Deactivate / })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-panel]')).toHaveCount(0);
  });

  test('#437 Name and Last seen sort from their headers: aria-sort, the address, focus, reload and Back', async ({
    page,
  }) => {
    await openList(page, 1920, 1080);
    const name = page.getByRole('columnheader', { name: 'Name' });
    const lastSeen = page.getByRole('columnheader', { name: 'Last seen' });
    await expect(name).toHaveAttribute('aria-sort', 'none');
    await name.getByRole('button').click();
    await expect(page).toHaveURL(/sort=name(&|$)/);
    await expect(name).toHaveAttribute('aria-sort', 'ascending');
    await expect(name.getByRole('button')).toBeFocused();
    const names = async () =>
      (await page.locator('tr[data-user] button[data-open]').allTextContents()).map((t) =>
        t.trim(),
      );
    // The server's collation orders the names; the twins with the same name keep their id order in both directions, so leave them out.
    const distinct = (list: string[]) => list.filter((n) => !n.startsWith('Sam Same'));
    // The list reloads after the press: wait until the first name is the one the server puts first.
    await expect.poll(async () => (await names())[0]).not.toMatch(/pend/);
    const asc = distinct(await names());
    await name.getByRole('button').click();
    await expect(page).toHaveURL(/sort=-name/);
    await expect(name).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(async () => distinct(await names())).toEqual([...asc].reverse());
    await lastSeen.getByRole('button').click();
    await expect(page).toHaveURL(/sort=lastSeen/);
    await expect(lastSeen).toHaveAttribute('aria-sort', 'ascending');
    await expect(name).toHaveAttribute('aria-sort', 'none');
    // Reload keeps the sort; Back returns to the previous one.
    await page.reload();
    await expect(page.getByRole('columnheader', { name: 'Last seen' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await page.goBack();
    await expect(page).toHaveURL(/sort=-name/);
    await expect(page.getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  test('#437 the rows per page are 25, 50 or 100 and live in the address', async ({ page }) => {
    await openList(page, 1366, 768);
    const size = page.getByLabel('Rows per page');
    await expect(size).toHaveValue('25');
    await size.selectOption('50');
    await expect(page).toHaveURL(/size=50/);
    await page.reload();
    await expect(page.getByLabel('Rows per page')).toHaveValue('50');
    await page.getByLabel('Rows per page').selectOption('25');
    await expect(page).not.toHaveURL(/size=/);
  });

  test('#437 on a phone the same sorts are a Sort by select in the Filters sheet, segments stay in the header', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(listUrl());
    await expect(page.locator('li.rc').first()).toBeVisible();
    await expect(page.locator('[data-strip-item="pending"]')).toBeVisible();
    await page.getByRole('button', { name: /^Filters/ }).click();
    const sheet = page.getByRole('dialog').last();
    const select = sheet.getByLabel('Sort by');
    await expect(select).toBeVisible();
    expect(await select.locator('option').allTextContents()).toEqual([
      'Default order (Waiting people first)',
      'Name',
      'Last seen',
      'First seen',
    ]);
    // The segments are not in the sheet.
    await expect(sheet.locator('[data-strip-item]')).toHaveCount(0);
    await select.selectOption('lastSeen');
    await expect(page).toHaveURL(/sort=lastSeen/);
  });

  test('a User.View-only administrator sees the name and a menu with Open only, and no Grant access', async ({
    personas,
    asUser,
  }) => {
    const viewer = await personas.create({ label: `${TAG}view`, permissions: ['User.View'] });
    const page = await asUser(viewer.username);
    await openList(page, 1366, 768);
    await expect(page.getByRole('button', { name: /^Grant access/ })).toHaveCount(0);
    await menuButton(page, busy.userId).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Open']);
    await page.getByRole('menuitem', { name: 'Open' }).click();
    await expect(page.locator('[data-panel-heading]')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menuButton(page, busy.userId)).toBeFocused();
  });

  test('Pod.ManageMembers without Pod.Manage still sees the pods as chips in the one-line cell and has the grid', async ({
    personas,
    asUser,
  }) => {
    const lead = await personas.create({
      label: `${TAG}pm`,
      permissions: ['User.View', 'Pod.ManageMembers', 'Pod.View'],
    });
    const page = await asUser(lead.username);
    await openList(page, 1366, 768);
    await expect(page.locator(`tr[data-user="${busy.userId}"] [data-pods-trigger]`)).toBeVisible();
  });
});
