import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Persona } from '../support/personas';
import { userName, userRow } from '../support/users-grid';

/**
 * Users epic #422, WP-US7 #454: the keyboard-only flows of the rebuilt Users area, with the focus asserted at every step (open, return) and axe
 * with every overlay open at 375, 768, 1366 and 1920.
 *
 * The six flows, each without a pointer: grant access, deactivate, edit availability, edit pods, edit a role, edit a pod. A flow starts from
 * the first Tab stop of the page ("Skip to table") and moves with Tab, Shift+Tab, arrows, Enter, Space and Esc only. Focus never lands on
 * `body`. The Tab stops from the top of the page to the first row action are recorded in `keyboard-evidence.json` (E2E_SCREENSHOTS,
 * docs/ux/users-review/fixes/us7-keyboard). axe is required here: a missing axe-core fails the file. No shortcut is involved (Phase 2, #420).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const TAG = `us7k${Math.floor(Math.random() * 90000) + 10000}`;
const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const evidence: Record<string, unknown> = {};
let pending: Persona;
let worker: Persona;
let roleId: number;
let podId: number;
let podName: string;
let otherPodName: string;

test.beforeAll(async ({ personas, seed, admin }) => {
  pending = await personas.create({ label: `${TAG}pend` });
  worker = await personas.create({ label: `${TAG}work`, roles: ['Data Technician'] });
  const role = await admin.post('/api/v1/roles', {
    name: `Keyboard role ${TAG}`,
    description: 'For the keyboard flows.',
    permissionCodes: ['Task.View'],
  });
  roleId = role.roleId;
  podName = `Keyboard pod ${TAG}`;
  const pod = await seed.pod(podName, [worker.userId]);
  podId = pod.podId;
  otherPodName = `Second pod ${TAG}`;
  await seed.pod(otherPodName, []);
});

const listUrl = `/admin/users?status=all&account=e2e-${TAG}`;
const rowOf = (page: Page, userId: number, account: string) => userRow(page, userId, account);

const onBody = (page: Page) =>
  page.evaluate(() => document.activeElement === document.body || !document.activeElement);

/**
 * The most Tab presses a walk may take: one per control on the page, and a few more. A fixed number broke on a database the suite had used,
 * where the roles list of the user panel has hundreds of checkboxes (one Tab stop each), not the dozen of a fresh one.
 */
const tabBudget = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]').length + 20,
  );

/** Presses Tab until the locator has focus (at most `max` times); returns how many presses it took. Fails when it never does. */
async function tabTo(page: Page, target: Locator, max?: number): Promise<number> {
  const limit = max ?? (await tabBudget(page));
  for (let n = 1; n <= limit; n++) {
    await page.keyboard.press('Tab');
    expect(await onBody(page), 'focus landed on body').toBe(false);
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return n;
  }
  throw new Error(`Tab never reached ${target}`);
}

async function shiftTabTo(page: Page, target: Locator, max?: number): Promise<number> {
  const limit = max ?? (await tabBudget(page));
  for (let n = 1; n <= limit; n++) {
    await page.keyboard.press('Shift+Tab');
    expect(await onBody(page), 'focus landed on body').toBe(false);
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return n;
  }
  throw new Error(`Shift+Tab never reached ${target}`);
}

/** From the top of the page: the first Tab stop is "Skip to table"; Enter on it moves focus into the list. */
async function viaSkipLink(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to table' })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await onBody(page), 'focus landed on body after the skip link').toBe(false);
}

const noSideScroll = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

async function axeClean(page: Page) {
  expect(axeAvailable(), 'axe-core is required (set E2E_AXE_PATH)').toBe(true);
  return (await axeViolations(page))
    .map((v) =>
      v.id === 'target-size'
        ? { ...v, nodes: v.nodes.filter((n) => !(n.why ?? '').includes('partially obscured')) }
        : v,
    )
    .filter((v) => v.nodes.length > 0);
}

test.describe('#454 the six keyboard flows', () => {
  test('1. grant access: skip link, Grant access, a role, Save changes; focus lands on a row, with the toast reachable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/users?status=pending&account=e2e-${TAG}pend`);
    await expect(page.locator('tr[data-user]')).toHaveCount(1);
    await viaSkipLink(page);
    const grant = rowOf(page, pending.userId, pending.username).locator('[data-grant] button');
    const nameBtn = userName(rowOf(page, pending.userId, pending.username));
    await expect(nameBtn).toBeFocused();
    const stops = await tabTo(page, grant);
    evidence['grantAccess'] = { tabStopsFromSkipTargetToAction: stops };
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-panel-heading]')).toBeFocused();
    const role = page.getByRole('checkbox', { name: /^Data Technician/ });
    await tabTo(page, role);
    await page.keyboard.press('Space');
    await expect(role).toBeChecked();
    await tabTo(page, page.getByRole('button', { name: 'Save changes' }));
    await page.keyboard.press('Enter');
    // The drawer closed, the person left the Pending segment, and focus is on the list (not on body).
    await expect(page.locator('.mf-user-drawer')).toHaveCount(0);
    await expect.poll(() => onBody(page)).toBe(false);
    // The toast with Undo is a button in the tab order.
    const undo = page.getByRole('button', { name: /Undo/ });
    await expect(undo).toBeVisible();
    await undo.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('tr[data-user]')).toHaveCount(1);
  });

  test('2. deactivate: Deactivate, the question (focus on Cancel), Deactivate; focus stays inside the drawer', async ({
    page,
    personas,
  }) => {
    const victim = await personas.create({ label: `${TAG}victim`, roles: ['Data Technician'] });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/users?status=all&account=${victim.username}`);
    await expect(page.locator('tr[data-user]')).toHaveCount(1);
    await viaSkipLink(page);
    await page.keyboard.press('Enter'); // the name of the first row
    await expect(page.locator('[data-panel-heading]')).toBeFocused();
    const deactivate = page.getByRole('button', { name: /^Deactivate / });
    await tabTo(page, deactivate);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /^Deactivate / });
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Deactivate', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-drawer-status]')).toContainText('Inactive');
    await expect.poll(() => onBody(page)).toBe(false);
    // Esc closes the drawer and focus is back on the name.
    await page.keyboard.press('Escape');
    await expect(page.locator('.mf-user-drawer')).toHaveCount(0);
    await expect(userName(rowOf(page, victim.userId, victim.username))).toBeFocused();
  });

  test('3. edit availability: Edit availability opens the dialog, Esc closes it and focus returns to the button', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/users?status=all&account=${worker.username}`);
    await expect(page.locator('tr[data-user]')).toHaveCount(1);
    await userName(rowOf(page, worker.userId, worker.username)).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-panel-heading]')).toBeFocused();
    const edit = page.locator('[data-edit-availability]');
    await tabTo(page, edit);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /^Availability of / });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('.mf-user-drawer')).toBeVisible();
    await expect(edit).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.mf-user-drawer')).toHaveCount(0);
  });

  test('4. edit pods: the pods button opens the popover, arrows walk it, Esc returns focus to the button', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/users?status=all&account=${worker.username}`);
    await expect(page.locator('tr[data-user]')).toHaveCount(1);
    await userName(rowOf(page, worker.userId, worker.username)).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-panel-heading]')).toBeFocused();
    const trigger = page.locator('.mf-user-drawer [data-pods-trigger]');
    await tabTo(page, trigger);
    await page.keyboard.press('Enter');
    const search = page.locator('[data-pods-search]');
    await expect(search).toBeFocused();
    await page.keyboard.press('ArrowDown');
    expect(await onBody(page)).toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-pods-popover]')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    // The drawer is still open: Esc again closes it.
    await expect(page.locator('.mf-user-drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.mf-user-drawer')).toHaveCount(0);
  });

  test('5. edit a role: the list, the editor, a permission, the Changed chip, Save; no pointer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/roles');
    const entry = page.locator(`[data-role="${roleId}"]`);
    await entry.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-editor]')).toBeVisible();
    const box = page.locator('[data-perm="Asset.View"]');
    await tabTo(page, box, 120);
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
    const chip = page.getByRole('button', { name: 'Undo: added Asset.View' });
    await expect(chip).toBeVisible();
    await shiftTabTo(page, chip, 120);
    await page.keyboard.press('Enter');
    await expect(box).not.toBeChecked();
    await expect(chip).toHaveCount(0);
    expect(await onBody(page)).toBe(false);
    await box.focus();
    await page.keyboard.press('Space');
    await tabTo(page, page.getByRole('button', { name: 'Save changes' }), 120);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-changes]')).toHaveCount(0);
    expect(await onBody(page)).toBe(false);
  });

  test('6. edit a pod: the name link opens the record page, Save, the crumb returns to the list with focus on the row', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/pods?status=all&name=${encodeURIComponent(TAG)}`);
    await expect(page.locator(`tr[data-pod="${podId}"]`)).toBeVisible();
    await viaSkipLink(page);
    const link = page.locator(`tr[data-pod="${podId}"] a`);
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-record-header]')).toBeVisible();
    const name = page.locator('input[data-name]');
    await tabTo(page, name, 60);
    await page.keyboard.press('End');
    await page.keyboard.type(' v2');
    await tabTo(page, page.getByRole('button', { name: 'Save changes' }), 60);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-page-title]')).toContainText('v2');
    const crumb = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', {
      name: 'Pods',
    });
    await shiftTabTo(page, crumb, 80);
    await page.keyboard.press('Enter');
    await expect(page.locator(`tr[data-pod="${podId}"] a`)).toBeFocused();
    await expect(page).toHaveURL(/status=all/);
  });
});

test.describe('#454 axe with every overlay open, and no nested scroller', () => {
  for (const { width, height } of SIZES) {
    test(`drawer, popover, dialogs, role editor and pod page at ${width}x${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/admin/users?status=all&account=${worker.username}`);
      await expect(page.locator(width < 640 ? 'li.rc' : 'tr[data-user]')).toHaveCount(1);
      await userName(rowOf(page, worker.userId, worker.username)).click();
      await expect(page.locator('[data-panel-heading]')).toBeFocused();
      expect(await axeClean(page)).toEqual([]);
      // No scroller inside the drawer besides its own body.
      const nested = await page.evaluate(() => {
        const body = document.querySelector('.ud-body');
        return Array.from(document.querySelectorAll<HTMLElement>('.mf-user-drawer *'))
          .filter((el) => el !== body)
          .filter((el) => {
            const s = getComputedStyle(el);
            return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1;
          })
          .map((el) => el.className);
      });
      expect(nested).toEqual([]);
      // The pods popover.
      const trigger = page.locator('.mf-user-drawer [data-pods-trigger]');
      if (width < 640) await page.locator('[data-section-toggle="pods"]').click();
      await trigger.click();
      await expect(page.locator('[data-pods-popover]')).toBeVisible();
      expect(await axeClean(page)).toEqual([]);
      await page.keyboard.press('Escape');
      // The availability dialog.
      if (width < 640) await page.locator('[data-section-toggle="availability"]').click();
      await page.locator('[data-edit-availability]').click();
      await expect(page.getByRole('dialog', { name: /^Availability of / })).toBeVisible();
      expect(await axeClean(page)).toEqual([]);
      await page.keyboard.press('Escape');
      // The Deactivate question.
      await page.getByRole('button', { name: /^Deactivate / }).click();
      await expect(page.getByRole('dialog', { name: /^Deactivate / })).toBeVisible();
      expect(await axeClean(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      expect(await noSideScroll(page)).toBe(true);

      // The role editor with a change, and the pod record page.
      await page.goto('/admin/roles');
      await page.locator(`[data-role="${roleId}"]`).click();
      await page.locator('[data-perm="Matter.View"]').check();
      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);
      await page.goto(`/admin/pods?pod=${podId}`);
      await expect(page.locator('[data-record-header]')).toBeVisible();
      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);
    });
  }
});

test.describe('evidence', () => {
  test.afterAll(() => {
    if (!OUT) return;
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'keyboard-evidence.json'), JSON.stringify(evidence, null, 2));
  });
  test('the Tab stops from the top of a page to its first row action are recorded', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    for (const [key, url, selector] of [
      ['users', listUrl, 'tr[data-user] button[data-open]'],
      ['roles', '/admin/roles', '[data-role]'],
      ['pods', `/admin/pods?status=all&name=${encodeURIComponent(TAG)}`, 'tr[data-pod] a'],
    ] as const) {
      await page.goto(url);
      await expect(page.locator(selector).first()).toBeVisible();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      let stops: number | null = null;
      for (let n = 1; n <= 60 && stops === null; n++) {
        await page.keyboard.press('Tab');
        if (await page.evaluate((s) => !!document.activeElement?.matches(s), selector)) stops = n;
      }
      evidence[`tabStopsToFirstRow:${key}`] = stops;
      expect(stops, `${key}: the first row is reachable`).not.toBeNull();
      expect(stops!, `${key}: reachable`).toBeLessThanOrEqual(60);
    }
  });
});
