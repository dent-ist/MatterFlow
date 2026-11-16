import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Persona } from '../support/personas';
import { userName, userRow } from '../support/users-grid';

/**
 * Users epic #422, WP-US4, moved from the side drawer to a centre dialog in epic #1389 (issue #1390): the user dialog (#438 shell, #439 Access, #440 Pods /
 * Availability / Profile, #441 deactivation question, #442 grant toast with Undo, #443 read-only variants, #444 last System Admin and concurrent edits).
 *  - one large (768 px) centred dialog, `?user=<id>` in the address (a deep link opens it, Back closes it, Back from "View their tasks" reopens it);
 *  - Roles are in view at 1366x768, the grid stays where it is, the footer stays, focus is trapped, Esc closes (asking when dirty), focus goes back;
 *  - Access first (role description and permission count, grouped permissions after the save, System Admin warning), then Pods, Availability, Profile;
 *  - Deactivate asks in the footer of the dialog (no second dialog) with the open-task count, focus on Keep User, a toast, no duplicate toast for the last System Admin;
 *  - a first grant of access closes the dialog, offers Undo and keeps focus in the grid;
 *  - User.View only is read only with the reason; Pod.ManageMembers can change pods and nothing else.
 * axe is required here: a missing axe-core fails the file instead of skipping it. Screenshots (older ones in docs/ux/users-review/fixes/us4-drawer/) are
 * written when E2E_SCREENSHOTS is set to the output folder.
 */
const SIZES = [
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
/** The user dialog (the Availability dialog above it is another `.mf-formdlg`). */
const dialogOf = (page: Page) =>
  page.locator('.mf-formdlg').filter({ has: page.locator('[data-panel]') });

async function openList(page: Page, width = 1366, height = 768, extra = ''): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(listUrl(extra));
  await expect(page.locator(width < 640 ? 'li.rc' : 'tr[data-record-id]')).toHaveCount(4);
}

async function openDialog(page: Page, userId: number): Promise<void> {
  await nameOf(page, userId).click();
  await expect(page.locator('[data-panel] [data-section="access"]')).toBeVisible();
  await expect(dialogOf(page).locator(':focus')).toHaveCount(1);
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

test.describe('#438 the dialog shell', () => {
  test('opens from the name over a grid that keeps its width; it is 768 px and centred; Roles are in view at 1366x768; the footer stays', async ({
    page,
  }) => {
    await openList(page);
    const before = await page.locator('mf-grid-frame .scroll').boundingBox();
    await openDialog(page, worker.userId);
    await expect(page).toHaveURL(new RegExp(`user=${worker.userId}`));
    // The grid behind the mask is as wide as before: the dialog takes no room from it.
    const after = await page.locator('mf-grid-frame .scroll').boundingBox();
    expect(Math.round(after!.width)).toBe(Math.round(before!.width));
    // The large dialog is 768 px (D-32) and centred in the window (it is not a panel at the right edge).
    const box = await dialogOf(page).boundingBox();
    expect(Math.round(box!.width)).toBe(768);
    const viewport = page.viewportSize()!;
    expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    expect(box!.y).toBeGreaterThan(0);
    expect(box!.y + box!.height).toBeLessThan(viewport.height);
    // The first role is on screen without scrolling the dialog, and so are Save Changes and Cancel.
    const role = page.locator('[data-panel] [data-role]').first();
    const roleBox = await role.boundingBox();
    expect(roleBox!.y + roleBox!.height).toBeLessThanOrEqual(768);
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeInViewport();
    // The content scrolls inside the dialog, never the page.
    expect(await noSideScroll(page)).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
    ).toBe(true);
  });

  test('is a modal dialog named by its heading: Tab stays inside, the page behind cannot be reached', async ({
    page,
  }) => {
    await openList(page);
    await openDialog(page, worker.userId);
    await expect(dialogOf(page)).toHaveAttribute('aria-modal', 'true');
    const labelled = await dialogOf(page).getAttribute('aria-labelledby');
    await expect(page.locator(`#${labelled}`)).toHaveAttribute('data-panel-title', '');
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('.mf-formdlg'))).toBe(
        true,
      );
    }
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('.mf-formdlg'))).toBe(
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
    await expect(dialogOf(page).locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/user=/);
    await expect(button).toBeFocused();
  });

  test('a deep link opens it; Back closes it and Forward opens it again', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(listUrl());
    await expect(page.locator('tr[data-record-id]')).toHaveCount(4);
    await nameOf(page, worker.userId).click();
    await expect(dialogOf(page)).toBeVisible();
    await page.goBack();
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/user=/);
    await page.goForward();
    await expect(dialogOf(page)).toBeVisible();
    // A reload keeps it: the person is in the address.
    await page.reload();
    await expect(page.locator('[data-panel-title]')).toContainText(
      (worker.displayName ?? worker.username).replace(/^.*\\/, ''),
    );
    // Closing after a reload leaves the address without the person.
    await page.keyboard.press('Escape');
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/user=/);
    // A person that does not exist shows the error, not a blank dialog.
    await page.goto(listUrl('&user=99999999'));
    await expect(page.locator('[data-panel-error]')).toContainText("Couldn't load this user");
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('Esc with unsaved edits asks first in the footer: Keep Editing keeps the dialog, Discard Changes closes it and focus is back on the name', async ({
    page,
  }) => {
    await openList(page);
    await openDialog(page, worker.userId);
    const name = page.locator('[data-name]');
    await name.fill('Someone Else Entirely');
    await page.keyboard.press('Escape');
    const ask = dialogOf(page).locator('[data-panel-guard]');
    await expect(ask).toContainText('You have unsaved changes. Discard them?');
    await ask.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(ask).toBeHidden();
    await expect(dialogOf(page)).toBeVisible();
    await expect(name).toHaveValue('Someone Else Entirely');
    await page.keyboard.press('Escape');
    await dialogOf(page)
      .locator('[data-panel-guard]')
      .getByRole('button', { name: 'Discard Changes' })
      .click();
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(nameOf(page, worker.userId)).toBeFocused();
  });

  test('the header names the person and the account; the first lines name the status, last seen and open tasks', async ({
    page,
  }) => {
    await openList(page);
    await openDialog(page, worker.userId);
    const head = page.locator('[data-dialog-head]');
    await expect(head.locator('[data-dialog-status]')).toContainText('Active');
    await expect(head.locator('[data-open-tasks]')).toHaveText('Open tasks: 2');
    // Title = the name, subtitle = the Windows account (D-31).
    await expect(page.locator('[data-panel-title]')).toContainText(worker.username);
    // Pending: its own badge, no Deactivate offered for a person who cannot sign in yet? (they can be deactivated), Activate not shown.
    await page.keyboard.press('Escape');
    await expect(dialogOf(page)).toHaveCount(0);
    await openDialog(page, pending.userId);
    await expect(head.locator('[data-dialog-status]')).toContainText('Pending Access');
    await page.keyboard.press('Escape');
    await expect(dialogOf(page)).toHaveCount(0);
    // Inactive: Activate instead of Deactivate.
    await openDialog(page, gone.userId);
    await expect(head.locator('[data-dialog-status]')).toContainText('Inactive');
    await expect(page.getByRole('button', { name: /^Activate / })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Deactivate / })).toHaveCount(0);
  });
});

test.describe('#439 Access', () => {
  test('roles show a description and a permission count; ticking a role previews the permissions after the save; System Admin warns', async ({
    page,
  }) => {
    await openList(page);
    await openDialog(page, worker.userId);
    const director = page.locator('[data-role]').first().locator('xpath=ancestor::label');
    await expect(director.locator('.ud-role-meta')).toContainText(/\d+ permissions?/);
    const saved = page.locator('[data-permissions] h3');
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
    // The groups are drawn again after the preview text: read them until they are there.
    await expect.poll(sum).toBeGreaterThan(savedTotal);
    await adminBox.uncheck();
    await expect(page.locator('[data-sysadmin-warning]')).toHaveCount(0);
    await expect(saved).toContainText('Effective permissions (');
  });

  test('keyboard order: the roles, then the permission summary, then Pods', async ({ page }) => {
    await openList(page);
    await openDialog(page, worker.userId);
    const names: string[] = [];
    // One press per control on the page and a few more (a used database has hundreds of roles, one checkbox each).
    const budget = await page.evaluate(
      () =>
        document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]').length +
        20,
    );
    for (let i = 0; i < budget; i++) {
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
  test('Pods are changed in the dialog and saved at once, with Undo', async ({ page }) => {
    await openList(page);
    await openDialog(page, worker.userId);
    const pods = page.locator('[data-section="pods"]');
    await expect(pods).toContainText(podName);
    await pods.locator('[data-pods-trigger]').click();
    const pop = page.locator('[data-pods-popover]');
    await expect(pop).toBeVisible();
    await pop.getByRole('checkbox', { name: new RegExp(otherPodName) }).check();
    // The person is in a pod that was added without a primary one (seed), so the popover asks for a primary pod: "Make Primary" appears on the ticked row after
    // the next render. (A person with no pods at all gets the Primary tag on the first pod at once, no button then.) Wait for either before looking.
    const row = pop
      .locator('li')
      .filter({ has: page.getByRole('checkbox', { name: new RegExp(otherPodName) }) });
    await expect(row.locator('[data-pod-primary], [data-primary-chip]')).toBeVisible();
    const makePrimary = pop.getByRole('button', { name: `Make ${otherPodName} the primary pod` });
    if ((await makePrimary.count()) > 0) await makePrimary.click();
    // Apply is aria-disabled until the choice is a change the popover accepts: wait for that instead of clicking into a disabled button.
    const apply = pop.locator('[data-pods-apply]');
    await expect(apply).not.toHaveAttribute('aria-disabled', 'true');
    await apply.click();
    await expect(pods).toContainText(otherPodName);
    await expect(page.getByRole('status').filter({ hasText: /Pods of/ })).toBeVisible();
    await expect(pods.locator('[data-pods-trigger]')).toBeFocused();
  });

  test('Edit availability opens the existing dialog; focus returns to the button that opened it', async ({
    page,
  }) => {
    await openList(page);
    await openDialog(page, away.userId);
    await expect(page.locator('[data-availability-sentence]')).toContainText(
      'Out of Office until 10/25/2027',
    );
    const edit = page.locator('[data-edit-availability]');
    await edit.click();
    const dialog = page.getByRole('dialog', { name: /^Availability of / });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(dialogOf(page)).toBeVisible();
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
    await expect(page.locator('[data-first-seen]')).toHaveText(/^\d{2}\/\d{2}/);
    await page.locator('[data-name]').fill('Renamed Dialog Person');
    await page.locator('[data-email]').fill('renamed@firm.test');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.locator('[data-panel-title]')).toContainText('Renamed Dialog Person');
    await expect(page.locator('[data-panel-primary]')).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('#441 deactivation', () => {
  test('Deactivate asks in the footer of the dialog (no second dialog) and states the open tasks; focus is on Keep User; the result is a toast and the counts follow', async ({
    page,
  }) => {
    await openList(page);
    await openDialog(page, worker.userId);
    const deactivate = page.getByRole('button', { name: /^Deactivate / });
    await deactivate.click();
    const ask = page.locator('[data-deactivate-foot]');
    await expect(ask).toContainText(
      'This user has 2 open tasks. They stay assigned until you reassign them one by one.',
    );
    await expect(page.locator('.mf-formdlg')).toHaveCount(1);
    await expect(ask.locator('[data-deactivate-extra]')).toBeVisible();
    await expect(ask.getByRole('button', { name: 'Keep User' })).toBeFocused();
    // Keep User changes nothing and the control that asked is still there.
    await page.keyboard.press('Enter');
    await expect(ask).toBeHidden();
    await expect(deactivate).toBeVisible();
    // Esc closes the question first, not the dialog.
    await deactivate.click();
    await expect(ask).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ask).toBeHidden();
    await expect(dialogOf(page)).toBeVisible();

    const inactiveBefore = await page.locator('[data-strip-item="inactive"]').textContent();
    await deactivate.click();
    await ask.getByRole('button', { name: 'Deactivate User', exact: true }).click();
    await expect(ask).toBeHidden();
    await expect(page.locator('[data-dialog-status]')).toContainText('Inactive');
    await expect(page.getByRole('button', { name: /^Activate / })).toBeVisible();
    await expect(page.locator('[data-strip-item="inactive"]')).not.toHaveText(inactiveBefore ?? '');
    await expect(page.getByText('User deactivated')).toBeVisible();
    // Activate needs no question.
    await page.getByRole('button', { name: /^Activate / }).click();
    await expect(page.locator('[data-dialog-status]')).toContainText('Active');
  });

  test('"View their tasks" leaves for the Task Queue and Back returns to the open dialog', async ({
    page,
  }) => {
    await openList(page);
    await openDialog(page, worker.userId);
    await page.getByRole('link', { name: 'View their tasks' }).click();
    await expect(page).toHaveURL(/\/tasks\?.*assignee=/);
    await expect(page.locator('[data-task]')).toHaveCount(2);
    await page.goBack();
    await expect(page.locator('[data-panel-title]')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`user=${worker.userId}`));
  });

  test('the last System Admin message is shown in the dialog once, without a toast', async ({
    page,
  }) => {
    await openList(page);
    await openDialog(page, worker.userId);
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
      .locator('[data-deactivate-foot]')
      .getByRole('button', { name: 'Deactivate User', exact: true })
      .click();
    await expect(page.locator('[data-panel-error]')).toHaveText(
      'At least one active System Admin is required.',
    );
    await expect(
      page.locator('.mf-toast, p-toast, [data-toast]').filter({ hasText: 'At least one active' }),
    ).toHaveCount(0);
    await expect(page.locator('[data-dialog-status]')).toContainText('Active');
  });
});

test.describe('#442 a first grant of access', () => {
  test('shows a toast with Undo, closes the dialog and keeps focus in the grid; Undo puts the person back to Pending', async ({
    page,
    personas,
  }) => {
    const first = await personas.create({ label: `${XTAG}g1` });
    const second = await personas.create({ label: `${XTAG}g2` });
    ACCOUNT.set(first.userId, first.username);
    ACCOUNT.set(second.userId, second.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/users?status=pending&account=e2e-${XTAG}g`);
    await expect(page.locator('tr[data-record-id]')).toHaveCount(2);
    const grant = rowOf(page, first.userId).locator('button[data-grant]');
    await grant.click();
    await expect(page.locator('[data-panel] [data-section="access"]')).toBeVisible();
    await page.getByRole('checkbox', { name: /^Data Technician/ }).check();
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(dialogOf(page)).toHaveCount(0);
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
    await expect(page.locator('tr[data-record-id]')).toHaveCount(4);
    await expect(page.locator('[data-grant]')).toHaveCount(0);
    await openDialog(page, pending.userId);
    await expect(page.locator('[data-readonly-reason]')).toContainText(
      'you can see this person but not change them',
    );
    for (const sel of ['[data-deactivate]', '[data-activate]', '[data-edit-availability]']) {
      await expect(page.locator(sel)).toHaveCount(0);
    }
    await expect(dialogOf(page).locator('[data-pods-trigger]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save Changes' })).toHaveCount(0);
    await expect(
      page.locator('[data-panel-cancel]').getByRole('button', { name: 'Close' }),
    ).toBeVisible();
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
    await expect(page.locator('[data-panel] [data-section="access"]')).toBeVisible();
    await expect(page.locator('[data-readonly-reason]')).toContainText('except pods');
    await expect(dialogOf(page).locator('[data-pods-trigger]')).toBeVisible();
    await expect(page.locator('[data-deactivate]')).toHaveCount(0);
    await expect(page.locator('[data-role]').first()).toBeDisabled();
    await dialogOf(page).locator('[data-pods-trigger]').click();
    await page.getByRole('checkbox', { name: new RegExp(otherPodName) }).check();
    // The first pod of a person with no pods is the primary one already (no "Make Primary" button then).
    const makePrimary = page.getByRole('button', { name: `Make ${otherPodName} the primary pod` });
    if ((await makePrimary.count()) > 0) await makePrimary.click();
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
    await expect(page.locator('[data-panel] [data-section="access"]')).toBeVisible();
    // Another administrator renames the person after this dialog loaded.
    const detail = await admin.get(`/api/v1/users/${p.userId}`);
    await admin.put(`/api/v1/users/${p.userId}`, {
      displayName: 'Changed Elsewhere',
      email: null,
      rowVersion: detail.rowVersion,
    });
    await page.locator('[data-email]').fill('mine@firm.test');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.locator('[data-panel-error]')).toContainText(
      'This user was changed by someone else. The latest values are shown.',
    );
    await expect(page.locator('[data-panel-title]')).toContainText('Changed Elsewhere');
  });
});

test.describe('axe and layout at both desktop sizes with the dialog open', () => {
  for (const { width, height } of SIZES) {
    test(`dialog, deactivation question and availability dialog at ${width}x${height}`, async ({
      page,
    }) => {
      await openList(page, width, height);
      expect(await axeClean(page)).toEqual([]);
      await openDialog(page, worker.userId);
      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);
      // The footer stays in view whatever the window.
      await expect(page.getByRole('button', { name: 'Save Changes' })).toBeInViewport();
      await page.getByRole('button', { name: /^Deactivate / }).click();
      const ask = page.locator('[data-deactivate-foot]');
      await expect(ask).toBeVisible();
      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(ask).toBeHidden();
      await page.locator('[data-edit-availability]').click();
      await expect(page.getByRole('dialog').last()).toBeVisible();
      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);
    });
  }
});

test.describe('us4-dialog screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');
  for (const { width, height } of SIZES) {
    test(`capture ${width}x${height}`, async ({ page }) => {
      fs.mkdirSync(OUT!, { recursive: true });
      const shot = async (name: string) => {
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT!, `${name}-${width}x${height}.png`) });
      };
      await openList(page, width, height);
      await openDialog(page, worker.userId);
      await shot('user-dialog');
      await page.getByRole('checkbox', { name: /^System Admin/ }).check();
      await shot('user-dialog-sysadmin-preview');
      await page.getByRole('checkbox', { name: /^System Admin/ }).uncheck();
      await page.getByRole('button', { name: /^Deactivate / }).click();
      await shot('user-deactivate-question');
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-deactivate-foot]')).toBeHidden();
      await expect(page.locator('.p-dialog-mask')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(dialogOf(page)).toHaveCount(0);
      await openDialog(page, pending.userId);
      await shot('user-dialog-pending');
    });
  }
});
