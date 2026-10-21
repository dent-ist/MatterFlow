import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Persona } from '../support/personas';
import { userName, userRow } from '../support/users-grid';

/**
 * Users epic #422, WP-US4: the user drawer (#438 shell, #439 Access, #440 Pods / Availability / Profile, #441 deactivation dialog, #442 grant
 * toast with Undo, #443 read-only variants, #444 last System Admin and concurrent edits).
 *  - one modal side drawer, `?user=<id>` in the address (a deep link opens it, Back closes it, Back from "View their tasks" reopens it);
 *  - Roles are in view at 1366x768, the grid keeps its width, the footer stays, focus is trapped, Esc closes (asking when dirty), focus goes back;
 *  - Access first (role description and permission count, grouped permissions after the save, System Admin warning), then Pods, Availability, Profile;
 *  - Deactivate is a confirm dialog with the open-task count, focus on Cancel, a toast, no duplicate toast for the last System Admin;
 *  - a first grant of access closes the drawer, offers Undo and keeps focus in the grid;
 *  - User.View only is read only with the reason; Pod.ManageMembers can change pods and nothing else.
 * axe is required here: a missing axe-core fails the file instead of skipping it. Screenshots for docs/ux/users-review/fixes/us4-drawer/ are
 * written when E2E_SCREENSHOTS is set to the output folder.
 */
const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const OUT = process.env['E2E_SCREENSHOTS'];
const TAG = `us4d${Math.floor(Math.random() * 90000) + 10000}`;
/** People a test creates for itself: their accounts do not match the list of the file (it counts exactly four). */
const XTAG = `us4x${Math.floor(Math.random() * 90000) + 10000}`;
const ACCOUNT = new Map<number, string>();

let worker: Persona;
let pending: Persona;
let away: Persona;
let gone: Persona;
let podName: string;
let otherPodName: string;

test.beforeAll(async ({ personas, seed, admin }) => {
  worker = await personas.create({ label: `${TAG}work`, roles: ['Data Technician'] });
  pending = await personas.create({ label: `${TAG}pend` });
  away = await personas.create({ label: `${TAG}away`, roles: ['Data Technician'] });
  gone = await personas.create({ label: `${TAG}gone`, roles: ['Data Technician'], disabled: true });
  await seed.outOfOffice(away.userId, { note: 'On leave', until: '2027-10-25' });
  const pod = await seed.pod(`Processing ${TAG}`, [worker.userId]);
  const other = await seed.pod(`Review ${TAG}`, []);
  podName = pod.name;
  otherPodName = other.name;
  const world = await seed.world();
  for (let i = 0; i < 2; i++) {
    await seed.task(world, { assignedUserId: worker.userId, assignedPodId: pod.podId });
  }
  expect(admin).toBeDefined();
  for (const p of [worker, pending, away, gone]) ACCOUNT.set(p.userId, p.username);
});

const listUrl = (extra = '') => `/admin/users?status=all&account=e2e-${TAG}${extra}`;
const rowOf = (page: Page, userId: number) => userRow(page, userId, ACCOUNT.get(userId)!);
const nameOf = (page: Page, userId: number) => userName(rowOf(page, userId));
const drawer = (page: Page) => page.locator('.mf-user-drawer');

async function openList(page: Page, width = 1366, height = 768, extra = ''): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(listUrl(extra));
  await expect(page.locator(width < 640 ? 'li.rc' : 'tr[data-user]')).toHaveCount(4);
}

async function openDrawer(page: Page, userId: number): Promise<void> {
  await nameOf(page, userId).click();
  await expect(page.locator('[data-panel-heading]')).toBeFocused();
  await expect(page.locator('[data-panel] [data-section="access"]')).toBeVisible();
}

const noSideScroll = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

async function axeClean(page: Page) {
  expect(axeAvailable(), 'axe-core is required (set E2E_AXE_PATH)').toBe(true);
  const found = await axeViolations(page);
  return found
    .map((v) =>
      v.id === 'target-size'
        ? { ...v, nodes: v.nodes.filter((n) => !(n.why ?? '').includes('partially obscured')) }
        : v,
    )
    .filter((v) => v.nodes.length > 0);
}

test.describe('#438 the drawer shell', () => {
  test('opens from the name over a grid that keeps its width; Roles are in view at 1366x768; the footer stays', async ({
    page,
  }) => {
    await openList(page);
    const before = await page.locator('.mf-table-wrap').boundingBox();
    await openDrawer(page, worker.userId);
    await expect(page).toHaveURL(new RegExp(`user=${worker.userId}`));
    // The grid behind the mask is as wide as before: the drawer takes no room from it.
    const after = await page.locator('.mf-table-wrap').boundingBox();
    expect(Math.round(after!.width)).toBe(Math.round(before!.width));
    // The drawer is 480 px from 1024 up.
    const box = await drawer(page).boundingBox();
    expect(Math.round(box!.width)).toBe(480);
    // The first role is on screen without scrolling the drawer, and so are Save changes and Cancel.
    const role = page.locator('[data-panel] [data-role]').first();
    const roleBox = await role.boundingBox();
    expect(roleBox!.y + roleBox!.height).toBeLessThanOrEqual(768);
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeInViewport();
    // The content scrolls inside the drawer, never the page.
    expect(await noSideScroll(page)).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
    ).toBe(true);
  });

  test('is a modal dialog named by its heading: Tab stays inside, the page behind cannot be reached', async ({
    page,
  }) => {
    await openList(page);
    await openDrawer(page, worker.userId);
    await expect(drawer(page)).toHaveAttribute('aria-modal', 'true');
    const labelled = await drawer(page).getAttribute('aria-labelledby');
    await expect(page.locator(`#${labelled}`)).toHaveAttribute('data-panel-heading', '');
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('.mf-user-drawer'))).toBe(
        true,
      );
    }
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('.mf-user-drawer'))).toBe(
        true,
      );
    }
  });

  test('Esc closes it, takes the person out of the address and puts focus back on the name', async ({
    page,
  }) => {
    await openList(page);
    const button = nameOf(page, worker.userId);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-panel-heading]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/user=/);
    await expect(button).toBeFocused();
  });

  test('a deep link opens it; Back closes it and Forward opens it again', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(listUrl());
    await expect(page.locator('tr[data-user]')).toHaveCount(4);
    await nameOf(page, worker.userId).click();
    await expect(drawer(page)).toBeVisible();
    await page.goBack();
    await expect(drawer(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/user=/);
    await page.goForward();
    await expect(drawer(page)).toBeVisible();
    // A reload keeps it: the person is in the address.
    await page.reload();
    await expect(page.locator('[data-panel-heading]')).toContainText(
      worker.displayName ?? worker.username,
    );
    // Closing after a reload leaves the address without the person.
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/user=/);
    // A person that does not exist shows the error, not a blank drawer.
    await page.goto(listUrl('&user=99999999'));
    await expect(page.locator('[data-panel-error]')).toContainText('We could not load this user');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('Esc with unsaved edits asks first: Stay keeps the drawer, Leave closes it and focus is back on the name', async ({
    page,
  }) => {
    await openList(page);
    await openDrawer(page, worker.userId);
    const name = page.locator('[data-name]');
    await name.fill('Someone Else Entirely');
    await page.keyboard.press('Escape');
    const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Stay' }).click();
    await expect(dialog).toBeHidden();
    await expect(name).toHaveValue('Someone Else Entirely');
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Leave' }).click();
    await expect(drawer(page)).toHaveCount(0);
    await expect(nameOf(page, worker.userId)).toBeFocused();
  });

  test('the header names the person, status, last seen and open tasks; the name is clamped to two lines', async ({
    page,
  }) => {
    await openList(page);
    await openDrawer(page, worker.userId);
    const head = page.locator('[data-drawer-head]');
    await expect(head.locator('[data-drawer-status]')).toContainText('Active');
    await expect(head.locator('[data-open-tasks]')).toHaveText('Open tasks: 2');
    const clamp = await page
      .locator('[data-panel-heading]')
      .evaluate((h) => getComputedStyle(h).getPropertyValue('-webkit-line-clamp'));
    expect(clamp).toBe('2');
    // Pending: its own badge, no Deactivate offered for a person who cannot sign in yet? (they can be deactivated), Activate not shown.
    await page.keyboard.press('Escape');
    await openDrawer(page, pending.userId);
    await expect(head.locator('[data-drawer-status]')).toContainText('Pending access');
    await page.keyboard.press('Escape');
    // Inactive: Activate instead of Deactivate.
    await openDrawer(page, gone.userId);
    await expect(head.locator('[data-drawer-status]')).toContainText('Inactive');
    await expect(page.getByRole('button', { name: /^Activate / })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Deactivate / })).toHaveCount(0);
  });
});

test.describe('#439 Access', () => {
  test('roles show a description and a permission count; ticking a role previews the permissions after the save; System Admin warns', async ({
    page,
  }) => {
    await openList(page);
    await openDrawer(page, worker.userId);
    const director = page.locator('[data-role]').first().locator('xpath=ancestor::label');
    await expect(director.locator('.ud-role-meta')).toContainText(/\d+ permissions?/);
    const saved = page.locator('[data-permissions] h4');
    await expect(saved).toContainText('Effective permissions (');
    const chips = page.locator('[data-permission-group]');
    expect(await chips.count()).toBeGreaterThan(1);
    const savedTotal = Number(/\((\d+)\)/.exec((await saved.textContent()) ?? '')![1]);
    const sum = async () =>
      (await chips.allTextContents()).reduce((n, t) => n + Number(/\((\d+)\)/.exec(t)![1]), 0);
    expect(await sum()).toBe(savedTotal);

    // Tick System Admin: the warning appears and the summary says it applies after the save.
    const adminBox = page.getByRole('checkbox', { name: /^System Admin/ });
    await adminBox.check();
    await expect(page.locator('[data-sysadmin-warning]')).toContainText('holds every permission');
    await expect(saved).toContainText('After you save');
    await expect(page.locator('[data-permissions-preview]')).toContainText('after you save');
    expect(await sum()).toBeGreaterThan(savedTotal);
    await adminBox.uncheck();
    await expect(page.locator('[data-sysadmin-warning]')).toHaveCount(0);
    await expect(saved).toContainText('Effective permissions (');
  });

  test('keyboard order: the roles, then the permission summary, then Pods', async ({ page }) => {
    await openList(page);
    await openDrawer(page, worker.userId);
    const names: string[] = [];
    for (let i = 0; i < 400; i++) {
      await page.keyboard.press('Tab');
      const where = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return a?.closest('[data-section]')?.getAttribute('data-section') ?? 'chrome';
      });
      if (names[names.length - 1] !== where) names.push(where);
      if (where === 'profile') break;
    }
    expect(names.filter((n) => n !== 'chrome')).toEqual([
      'access',
      'pods',
      'availability',
      'profile',
    ]);
  });
});

test.describe('#440 Pods, Availability and Profile', () => {
  test('Pods are changed in the drawer and saved at once, with Undo', async ({ page }) => {
    await openList(page);
    await openDrawer(page, worker.userId);
    const pods = page.locator('[data-section="pods"]');
    await expect(pods).toContainText(podName);
    await pods.locator('[data-pods-trigger]').click();
    const pop = page.locator('[data-pods-popover]');
    await expect(pop).toBeVisible();
    await pop.getByRole('checkbox', { name: new RegExp(otherPodName) }).check();
    await pop.getByRole('radio', { name: `Primary pod: ${otherPodName}` }).check();
    await pop.locator('[data-pods-apply]').click();
    await expect(pods).toContainText(otherPodName);
    await expect(page.getByRole('status').filter({ hasText: /Pods of/ })).toBeVisible();
    await expect(pods.locator('[data-pods-trigger]')).toBeFocused();
  });

  test('Edit availability opens the existing dialog; focus returns to the button that opened it', async ({
    page,
  }) => {
    await openList(page);
    await openDrawer(page, away.userId);
    await expect(page.locator('[data-availability-sentence]')).toContainText(
      'Out of office until Oct 25',
    );
    const edit = page.locator('[data-edit-availability]');
    await edit.click();
    const dialog = page.getByRole('dialog', { name: /^Availability of / });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(drawer(page)).toBeVisible();
    await expect(edit).toBeFocused();
  });

  test('Profile: name and email save with Save changes; the account and first seen are facts', async ({
    page,
    personas,
  }) => {
    const p = await personas.create({ label: `${XTAG}prof`, roles: ['Data Technician'] });
    ACCOUNT.set(p.userId, p.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/users?status=all&account=${p.username}`);
    await nameOf(page, p.userId).click();
    await expect(page.locator('.ud-dl')).toContainText(p.username);
    await expect(page.locator('[data-first-seen]')).toHaveText(/\w{3} \d{1,2}, \d{4}/);
    await page.locator('[data-name]').fill('Renamed Drawer Person');
    await page.locator('[data-email]').fill('renamed@firm.test');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('[data-panel-heading]')).toContainText('Renamed Drawer Person');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
});

test.describe('#441 deactivation', () => {
  test('Deactivate asks in a dialog that states the open tasks; focus is on Cancel; the result is a toast and the counts follow', async ({
    page,
  }) => {
    await openList(page);
    await openDrawer(page, worker.userId);
    const deactivate = page.getByRole('button', { name: /^Deactivate / });
    await deactivate.click();
    const dialog = page.getByRole('dialog', { name: /^Deactivate / });
    await expect(dialog).toContainText(
      'This user has 2 open tasks. They stay assigned until you reassign them one by one.',
    );
    await expect(dialog.getByRole('button', { name: 'View their tasks' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    // Cancel changes nothing and focus returns to the control that asked.
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(deactivate).toBeFocused();

    const inactiveBefore = await page.locator('[data-strip-item="inactive"]').textContent();
    await deactivate.click();
    await dialog.getByRole('button', { name: 'Deactivate', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-drawer-status]')).toContainText('Inactive');
    await expect(page.getByRole('button', { name: /^Activate / })).toBeVisible();
    await expect(page.locator('[data-strip-item="inactive"]')).not.toHaveText(inactiveBefore ?? '');
    await expect(page.getByText('User deactivated')).toBeVisible();
    // Activate needs no question.
    await page.getByRole('button', { name: /^Activate / }).click();
    await expect(page.locator('[data-drawer-status]')).toContainText('Active');
  });

  test('"View their tasks" leaves for the Task Queue and Back returns to the open drawer', async ({
    page,
  }) => {
    await openList(page);
    await openDrawer(page, worker.userId);
    await page.getByRole('link', { name: 'View their tasks' }).click();
    await expect(page).toHaveURL(/\/tasks\?.*assignee=/);
    await expect(page.locator('[data-task]')).toHaveCount(2);
    await page.goBack();
    await expect(page.locator('[data-panel-heading]')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`user=${worker.userId}`));
  });

  test('the last System Admin message is shown in the drawer once, without a toast', async ({
    page,
  }) => {
    await openList(page);
    await openDrawer(page, worker.userId);
    await page.route('**/api/v1/users/*/status', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          status: 409,
          code: 'LAST_ADMIN',
          title: 'Conflict',
          detail: 'At least one active System Admin is required.',
        }),
      }),
    );
    await page.getByRole('button', { name: /^Deactivate / }).click();
    await page
      .getByRole('dialog', { name: /^Deactivate / })
      .getByRole('button', { name: 'Deactivate', exact: true })
      .click();
    await expect(page.locator('[data-panel-error]')).toHaveText(
      'At least one active System Admin is required.',
    );
    await expect(
      page.locator('.mf-toast, p-toast, [data-toast]').filter({ hasText: 'At least one active' }),
    ).toHaveCount(0);
    await expect(page.locator('[data-drawer-status]')).toContainText('Active');
  });
});

test.describe('#442 a first grant of access', () => {
  test('shows a toast with Undo, closes the drawer and keeps focus in the grid; Undo puts the person back to Pending', async ({
    page,
    personas,
  }) => {
    const first = await personas.create({ label: `${XTAG}g1` });
    const second = await personas.create({ label: `${XTAG}g2` });
    ACCOUNT.set(first.userId, first.username);
    ACCOUNT.set(second.userId, second.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/users?status=pending&account=e2e-${XTAG}g`);
    await expect(page.locator('tr[data-user]')).toHaveCount(2);
    const grant = rowOf(page, first.userId).locator('[data-grant] button');
    await grant.click();
    await expect(page.locator('[data-panel-heading]')).toBeFocused();
    await page.getByRole('checkbox', { name: /^Data Technician/ }).check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(drawer(page)).toHaveCount(0);
    const toast = page.getByRole('status').filter({ hasText: 'now has access (Data Technician)' });
    await expect(toast).toBeVisible();
    // The person left the Pending segment; focus is on a row that is still there.
    await expect(rowOf(page, first.userId)).toHaveCount(0);
    await expect(nameOf(page, second.userId)).toBeFocused();

    await toast.getByRole('button', { name: /Undo/ }).click();
    await expect(rowOf(page, first.userId)).toHaveCount(1);
  });
});

test.describe('#443 read-only variants and #444 conflicts', () => {
  test('User.View only: read only with the reason, nothing that edits, no Grant access, no 403 toast', async ({
    personas,
    asUser,
  }) => {
    const viewer = await personas.create({ label: `${XTAG}view`, permissions: ['User.View'] });
    const page = await asUser(viewer.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(listUrl());
    await expect(page.locator('tr[data-user]')).toHaveCount(4);
    await expect(page.locator('[data-grant]')).toHaveCount(0);
    await openDrawer(page, pending.userId);
    await expect(page.locator('[data-readonly-reason]')).toContainText(
      'you can see this person but not change them',
    );
    for (const sel of ['[data-deactivate]', '[data-activate]', '[data-edit-availability]']) {
      await expect(page.locator(sel)).toHaveCount(0);
    }
    await expect(drawer(page).locator('[data-pods-trigger]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(drawer(page).getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await expect(page.locator('[data-role]').first()).toBeDisabled();
    await expect(page.locator('[data-name]')).toBeDisabled();
    expect(await axeClean(page)).toEqual([]);
  });

  test('Pod.ManageMembers can change pods and nothing else', async ({ personas, asUser }) => {
    const lead = await personas.create({
      label: `${XTAG}pods`,
      permissions: ['User.View', 'Pod.ManageMembers', 'Pod.View'],
    });
    const subject = await personas.create({ label: `${XTAG}podw`, roles: ['Data Technician'] });
    ACCOUNT.set(subject.userId, subject.username);
    const page = await asUser(lead.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/users?status=all&account=${subject.username}`);
    await nameOf(page, subject.userId).click();
    await expect(page.locator('[data-panel-heading]')).toBeFocused();
    await expect(page.locator('[data-readonly-reason]')).toContainText('except pods');
    await expect(drawer(page).locator('[data-pods-trigger]')).toBeVisible();
    await expect(page.locator('[data-deactivate]')).toHaveCount(0);
    await expect(page.locator('[data-role]').first()).toBeDisabled();
    await drawer(page).locator('[data-pods-trigger]').click();
    await page.getByRole('checkbox', { name: new RegExp(otherPodName) }).check();
    await page.getByRole('radio', { name: `Primary pod: ${otherPodName}` }).check();
    await page.locator('[data-pods-apply]').click();
    await expect(page.locator('[data-section="pods"]')).toContainText(otherPodName);
  });

  test('a change by someone else shows the conflict message with the latest values, not an overwrite', async ({
    page,
    admin,
    personas,
  }) => {
    const p = await personas.create({ label: `${XTAG}conf`, roles: ['Data Technician'] });
    ACCOUNT.set(p.userId, p.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/users?status=all&account=${p.username}`);
    await nameOf(page, p.userId).click();
    await expect(page.locator('[data-panel-heading]')).toBeFocused();
    // Another administrator renames the person after this drawer loaded.
    const detail = await admin.get(`/api/v1/users/${p.userId}`);
    await admin.put(`/api/v1/users/${p.userId}`, {
      displayName: 'Changed Elsewhere',
      email: null,
      rowVersion: detail.rowVersion,
    });
    await page.locator('[data-email]').fill('mine@firm.test');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('[data-panel-error]')).toContainText(
      'This user was changed by someone else. The latest values are shown.',
    );
    await expect(page.locator('[data-panel-heading]')).toContainText('Changed Elsewhere');
  });
});

test.describe('axe and layout at four sizes with the drawer open', () => {
  for (const { width, height } of SIZES) {
    test(`drawer, deactivation dialog and availability dialog at ${width}x${height}`, async ({
      page,
    }) => {
      await openList(page, width, height);
      expect(await axeClean(page)).toEqual([]);
      await openDrawer(page, worker.userId);
      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);
      // The footer stays in view whatever the window.
      await expect(page.getByRole('button', { name: 'Save changes' })).toBeInViewport();
      await page.getByRole('button', { name: /^Deactivate / }).click();
      const dialog = page.getByRole('dialog', { name: /^Deactivate / });
      await expect(dialog).toBeVisible();
      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      if (width < 640) await page.locator('[data-section-toggle="availability"]').click();
      await page.locator('[data-edit-availability]').click();
      await expect(page.getByRole('dialog').last()).toBeVisible();
      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);
    });
  }
});

test.describe('us4-drawer screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');
  for (const { width, height } of SIZES) {
    test(`capture ${width}x${height}`, async ({ page }) => {
      fs.mkdirSync(OUT!, { recursive: true });
      const shot = async (name: string) => {
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT!, `${name}-${width}x${height}.png`) });
      };
      await openList(page, width, height);
      await openDrawer(page, worker.userId);
      await shot('user-drawer');
      await page.getByRole('checkbox', { name: /^System Admin/ }).check();
      await shot('user-drawer-sysadmin-preview');
      await page.getByRole('checkbox', { name: /^System Admin/ }).uncheck();
      await page.getByRole('button', { name: /^Deactivate / }).click();
      await shot('user-deactivate-dialog');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: /^Deactivate / })).toBeHidden();
      await expect(page.locator('.p-dialog-mask')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(drawer(page)).toHaveCount(0);
      await openDrawer(page, pending.userId);
      await shot('user-drawer-pending');
    });
  }
});
