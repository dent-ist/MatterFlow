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
      expect(await headers(page)).toEqual([
        'Name',
        'Roles',
        'Pods',
        'Availability',
        'Status',
        'Actions',
      ]);
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
      if (width >= 1280)
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

  test('Edit availability opens the dialog; Deactivate opens the person with the question on screen; Activate is one Save away', async ({
    page,
  }) => {
    await openList(page, 1366, 768);
    await menuButton(page, busy.userId).click();
    await page.getByRole('menuitem', { name: 'Edit availability' }).click();
    await expect(page.getByRole('dialog')).toContainText('Availability of');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await menuButton(page, busy.userId).click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await expect(page.locator('[data-confirm]')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Deactivate user' })).toBeVisible();
    // Esc with a change asks first; Leave closes the panel.
    await page.keyboard.press('Escape');
    await page
      .getByRole('dialog', { name: 'Leave without saving?' })
      .getByRole('button', { name: 'Leave' })
      .click();
    await expect(page.locator('[data-panel]')).toHaveCount(0);
    // Focus goes back to the menu button that opened the panel (after the question's dialog has left).
    await expect(menuButton(page, busy.userId)).toBeFocused();

    // A floating menu closes when the page or a box scrolls; the panel that has just left can move the grid, so open it until it stays.
    await expect(async () => {
      await menuButton(page, gone.userId).click();
      await expect(page.getByRole('menuitem')).toHaveText(
        ['Open', 'Edit availability', 'Activate'],
        { timeout: 1500 },
      );
    }).toPass();
    await page.getByRole('menuitem', { name: 'Activate' }).click();
    await expect(page.locator('[data-status-active]')).toBeChecked();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
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
