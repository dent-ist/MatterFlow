import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { TaskQueuePage } from '../pages/queues.pages';
import { Persona } from '../support/personas';
import { userName, userRow } from '../support/users-grid';
import { TaskApi } from '../support/tasks';

/**
 * Users epic #422, WP-US1 first release (#423 BUG-1/BUG-5, #424 BUG-2, #425 BUG-3): the fixes started as interim code on the inline panel; the
 * user drawer (#438, #441) replaced that code and these tests stayed, now against the drawer.
 *  - no status badge is cut at 375, 768, 1366 and 1920 (the "Scroll sideways" hint is gone with the nine-column grid, #432);
 *  - opening a user moves focus to the drawer heading, Esc and Cancel close it and focus returns to the row button, Esc with unsaved edits asks;
 *  - Deactivate asks in a dialog that is on screen with focus on Cancel (BUG-3), and the dialog states the open tasks (BUG-4).
 * Screenshots for docs/ux/users-review/fixes/us1-bugs/ are written when E2E_SCREENSHOTS is set to the output folder.
 */
const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const OUT = process.env['E2E_SCREENSHOTS'];

let active: Persona;
let pending: Persona;
const TAG = `us1b${Math.floor(Math.random() * 90000) + 10000}`;

/** The Windows account of each person of this file, to find their card below 640 px (#445). */
const ACCOUNT = new Map<number, string>();

test.beforeAll(async ({ personas }) => {
  active = await personas.create({ label: `${TAG}act`, roles: ['Data Technician'] });
  pending = await personas.create({ label: `${TAG}pend`, displayNameLength: 130 });
  const off = await personas.create({
    label: `${TAG}off`,
    roles: ['Data Technician'],
    disabled: true,
  });
  for (const p of [active, pending, off]) ACCOUNT.set(p.userId, p.username);
});

const listUrl = (extra = '') => `/admin/users?status=all&account=e2e-${TAG}${extra}`;

async function openList(page: Page, width = 1366, height = 768, extra = ''): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(listUrl(extra));
  // The table from 640 px, cards below (#445).
  await expect(page.locator(width < 640 ? 'li.rc' : 'tr[data-user]')).toHaveCount(3);
}

/** The name of the person: the one control of the Name cell (#432); it opens the panel. */
const rowOf = (page: Page, userId: number) => userRow(page, userId, ACCOUNT.get(userId)!);
const rowButton = (page: Page, userId: number) => userName(rowOf(page, userId));
const grantButton = (page: Page, userId: number) =>
  rowOf(page, userId).locator('[data-grant] button, [data-card-primary] button');

/**
 * axe violations, without the one artifact of a scrolled page: a 24 px check box that sits half under the fixed header or the sticky Save bar
 * is reported by `target-size` as "partially obscured" while the page is where it happens to be scrolled. Everything else counts.
 */
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

const noSideScroll = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

test.describe('BUG-1 / BUG-5: status badges and the scroll hint', () => {
  for (const { width, height } of SIZES) {
    test(`no badge is cut and there is no scroll hint at ${width}`, async ({ page }) => {
      await openList(page, width, height);
      const badges = page.locator('tr[data-user] [data-status] mf-badge, li.rc mf-badge');
      // A badge only when the person is not simply Active (#432): Pending access and Inactive here, none for the active person.
      expect(await badges.allTextContents()).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Pending access'),
          expect.stringContaining('Inactive'),
        ]),
      );
      await expect(
        rowOf(page, active.userId).locator('[data-status] mf-badge, .rc-badges mf-badge'),
      ).toHaveCount(0);
      const cut = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('tr[data-user] [data-status], li.rc'))
          .filter((cell) => !!cell.querySelector('mf-badge'))
          .map((cell) => {
            const badge = cell.querySelector<HTMLElement>('mf-badge')!;
            const inner = badge.firstElementChild as HTMLElement | null;
            return {
              text: badge.textContent!.trim(),
              badge: badge.scrollWidth - badge.clientWidth,
              inner: inner ? inner.scrollWidth - inner.clientWidth : 0,
              cell: cell.scrollWidth - cell.clientWidth,
              // the badge must lie inside its cell
              out: badge.getBoundingClientRect().right - cell.getBoundingClientRect().right,
            };
          })
          .filter((m) => m.badge > 0 || m.inner > 0 || m.cell > 0 || m.out > 0.5),
      );
      expect(cut).toEqual([]);

      // The grid fits: there is no "Scroll sideways" hint any more.
      await expect(page.locator('[data-scroll-hint]')).toHaveCount(0);
      expect(await noSideScroll(page)).toBe(true);
    });
  }
});

test.describe('BUG-2: focus and Esc', () => {
  test('keyboard only: open moves focus to the heading, Esc closes and focus is back on the row button', async ({
    page,
  }) => {
    await openList(page);
    const button = rowButton(page, active.userId);
    await button.focus();
    await page.keyboard.press('Enter');
    const heading = page.locator('[data-panel-heading]');
    await expect(heading).toBeFocused();
    await expect(page.locator('.mf-user-drawer')).toHaveAttribute('aria-labelledby', /.+/);

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-panel]')).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('Close does the same, and Grant access for a pending person too', async ({ page }) => {
    await openList(page);
    const grant = grantButton(page, pending.userId);
    await expect(grant).toHaveText('Grant access');
    await grant.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-panel-heading]')).toBeFocused();
    await page.getByRole('button', { name: 'Close user details' }).click();
    await expect(page.locator('[data-panel]')).toHaveCount(0);
    await expect(grant).toBeFocused();
  });

  test('Esc with unsaved edits asks first; Stay keeps the panel, Leave closes it', async ({
    page,
  }) => {
    await openList(page);
    await rowButton(page, active.userId).click();
    const name = page.locator('[data-name]');
    await name.fill('Someone Else Entirely');
    await page.keyboard.press('Escape');
    const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Stay' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-panel]')).toBeVisible();
    await expect(name).toHaveValue('Someone Else Entirely');

    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Leave' }).click();
    await expect(page.locator('[data-panel]')).toHaveCount(0);
    await expect(rowButton(page, active.userId)).toBeFocused();
  });

  test('Esc inside the availability dialog closes only the dialog', async ({ page }) => {
    await openList(page);
    await rowButton(page, active.userId).click();
    await expect(page.locator('[data-panel]')).toBeVisible();
    const edit = page.locator('[data-edit-availability]');
    await edit.click();
    const dialog = page.getByRole('dialog', { name: /^Availability of / });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-panel]')).toBeVisible();
    await expect(edit).toBeFocused();
  });

  test('a person with User.View only can open, close with Esc and has no edit controls', async ({
    personas,
    asUser,
  }) => {
    const viewer = await personas.create({ label: `us1x-view`, permissions: ['User.View'] });
    const page = await asUser(viewer.username);
    await page.goto(listUrl());
    await expect(page.locator('tr[data-user]')).toHaveCount(3);
    const button = rowButton(page, active.userId);
    await expect(button).toHaveAttribute('aria-label', /^Open /);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-panel-heading]')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-panel]')).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('a Task.View-only person gets the 403 page, not the panel', async ({ personas, asUser }) => {
    const p = await personas.named('taskViewOnly');
    const page = await asUser(p.username);
    await page.goto(listUrl());
    await expect(page.locator('[data-panel]')).toHaveCount(0);
    await expect(page.locator('tr[data-user]')).toHaveCount(0);
  });
});

test.describe('BUG-3: the deactivation question', () => {
  test('Deactivate puts the question on screen in a dialog with focus on Cancel; Cancel changes nothing', async ({
    page,
  }) => {
    await openList(page, 1366, 768);
    await rowButton(page, active.userId).click();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();

    const deactivate = page.getByRole('button', { name: /^Deactivate / });
    await deactivate.click();
    const dialog = page.getByRole('dialog', { name: /^Deactivate / });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Deactivate', exact: true })).toBeVisible();
    // Fully inside the window.
    const inside = await dialog.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth
      );
    });
    expect(inside).toBe(true);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(deactivate).toBeFocused();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  });

  test('Deactivate saves; the person is Inactive in the list', async ({ page, personas }) => {
    const victim = await personas.create({ label: `us1x-victim`, roles: ['Data Technician'] });
    await page.goto(`/admin/users?status=all&account=e2e-us1x-victim`);
    await rowButton(page, victim.userId).click();
    await page.getByRole('button', { name: /^Deactivate / }).click();
    await page
      .getByRole('dialog', { name: /^Deactivate / })
      .getByRole('button', { name: 'Deactivate', exact: true })
      .click();
    await expect(page.locator(`tr[data-user="${victim.userId}"] [data-status]`)).toContainText(
      'Inactive',
    );
    await expect(page.locator('[data-activate]')).toBeVisible();
  });

  test('keyboard: Tab reaches Deactivate, Enter asks, Tab moves to Deactivate in the dialog, Enter does it', async ({
    page,
    personas,
  }) => {
    const victim = await personas.create({ label: `us1x-kbd`, roles: ['Data Technician'] });
    await page.goto(`/admin/users?status=all&account=e2e-us1x-kbd`);
    await rowButton(page, victim.userId).click();
    await page.getByRole('button', { name: /^Deactivate / }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /^Deactivate / });
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Deactivate', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-activate]')).toBeVisible();
  });
});

test.describe('BUG-4: open tasks and "View their tasks" (#427)', () => {
  test('a person with open tasks: count in the panel, the sentence, and the link opens their open tasks in the Task Queue', async ({
    page,
    admin,
    seed,
    personas,
  }) => {
    const worker = await personas.create({ label: `us1x-tasks`, roles: ['Data Technician'] });
    const pod = await seed.pod(undefined, [worker.userId]);
    const world = await seed.world();
    const mine: string[] = [];
    for (let i = 0; i < 2; i++) {
      const t = await seed.task(world, { assignedUserId: worker.userId, assignedPodId: pod.podId });
      mine.push(t.title);
    }
    // A cancelled task does not count.
    const closed = await seed.task(world, {
      assignedUserId: worker.userId,
      assignedPodId: pod.podId,
    });
    expect((await new TaskApi(admin, closed.taskId).cancel('not needed')).status).toBeLessThan(300);

    await page.goto(`/admin/users?status=all&account=e2e-us1x-tasks`);
    await rowButton(page, worker.userId).click();
    await expect(page.locator('[data-open-tasks]')).toHaveText('Open tasks: 2');
    await page.getByRole('button', { name: /^Deactivate / }).click();
    const dialog = page.getByRole('dialog', { name: /^Deactivate / });
    await expect(dialog).toContainText(
      'This user has 2 open tasks. They stay assigned until you reassign them one by one.',
    );
    // The question offers the trip as its main button, reachable by keyboard.
    const trip = dialog.getByRole('button', { name: 'View their tasks' });
    await expect(trip).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(trip).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/tasks\?.*assignee=/);
    const queue = new TaskQueuePage(page);
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
    await queue.expectListed(...mine);
    await expect(page.locator('[data-task]')).toHaveCount(2);
  });

  test('zero open tasks: "No open tasks" and no link', async ({ page }) => {
    await openList(page);
    await rowButton(page, active.userId).click();
    await expect(page.locator('[data-open-tasks]')).toHaveText('No open tasks');
    await page.getByRole('button', { name: /^Deactivate / }).click();
    await expect(page.getByRole('dialog', { name: /^Deactivate / })).toContainText(
      'No open tasks are assigned to them.',
    );
    await expect(page.getByRole('link', { name: 'View their tasks' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'View their tasks' })).toHaveCount(0);
  });

  test('User.Manage without Task.View: no number, no link, the plain sentence stays', async ({
    personas,
    asUser,
  }) => {
    const manager = await personas.create({
      label: `us1x-mgr`,
      permissions: ['User.View', 'User.Manage'],
    });
    const page = await asUser(manager.username);
    await page.goto(listUrl());
    await rowButton(page, active.userId).click();
    await expect(page.locator('[data-panel-heading]')).toBeFocused();
    await expect(page.locator('[data-open-tasks]')).toHaveCount(0);
    await page.getByRole('button', { name: /^Deactivate / }).click();
    await expect(page.getByRole('dialog', { name: /^Deactivate / })).toContainText(
      'Their assigned tasks stay assigned until you reassign them one by one.',
    );
    await expect(page.getByRole('link', { name: 'View their tasks' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'View their tasks' })).toHaveCount(0);
  });
});

test.describe('axe and layout at four sizes', () => {
  for (const { width, height } of SIZES) {
    test(`list, drawer and the deactivation question at ${width}x${height}`, async ({ page }) => {
      expect(axeAvailable(), 'axe-core is required (set E2E_AXE_PATH)').toBe(true);
      await openList(page, width, height);
      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);

      await rowButton(page, active.userId).click();
      await expect(page.locator('[data-panel-heading]')).toBeFocused();
      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);

      await page.getByRole('button', { name: /^Deactivate / }).click();
      await expect(
        page.getByRole('dialog', { name: /^Deactivate / }).getByRole('button', { name: 'Cancel' }),
      ).toBeFocused();
      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);
    });
  }
});

test.describe('us1-bugs screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');
  for (const { width, height } of SIZES) {
    test(`capture ${width}x${height}`, async ({ page }) => {
      fs.mkdirSync(OUT!, { recursive: true });
      const shot = async (name: string) => {
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT!, `${name}-${width}x${height}.png`) });
      };
      await openList(page, width, height);
      await shot('users-status-all');
      await rowButton(page, active.userId).click();
      await expect(page.locator('[data-panel-heading]')).toBeFocused();
      await shot('user-panel-focus');
      await page.getByRole('button', { name: /^Deactivate / }).click();
      await expect(
        page.getByRole('dialog', { name: /^Deactivate / }).getByRole('button', { name: 'Cancel' }),
      ).toBeFocused();
      await shot('user-deactivate-confirm');
    });
  }
});
