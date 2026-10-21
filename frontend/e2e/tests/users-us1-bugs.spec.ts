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
 * Users epic #422, WP-US1 first release (#423 BUG-1/BUG-5, #424 BUG-2, #425 BUG-3): the interim fixes on the current grid and panel.
 *  - no status badge is cut at 375, 768, 1366 and 1920 (the "Scroll sideways" hint is gone with the nine-column grid, #432);
 *  - opening a user moves focus to the panel heading, Esc and Close close it and focus returns to the row button, Esc with unsaved edits asks;
 *  - choosing Inactive shows the question in view with focus on it, the button reads "Deactivate user" and goes back with Active.
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
const menuButton = (page: Page, userId: number) =>
  rowOf(page, userId).locator('button[data-overflow]');

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
    await expect(page.locator('[data-panel]')).toHaveAttribute('aria-label', 'User details');

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
    await page.getByRole('button', { name: 'Close' }).click();
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
    await menuButton(page, active.userId).click();
    await page.getByRole('menuitem', { name: 'Edit availability' }).click();
    const dialog = page.locator('.p-dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-panel]')).toBeVisible();
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
  test('choosing Inactive shows the question in view with focus on it; Active takes it back', async ({
    page,
  }) => {
    await openList(page, 1366, 768);
    await rowButton(page, active.userId).click();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();

    await page.locator('[data-status-inactive]').check();
    const box = page.locator('[data-confirm]');
    await expect(box).toBeFocused();
    await expect(page.getByRole('button', { name: 'Deactivate user' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(page.locator('[data-confirm-live]')).toContainText('Confirm deactivation');

    // Fully inside the panel's scrolling box and inside the window.
    const inside = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-confirm]')!;
      const panel = document.querySelector<HTMLElement>('[data-panel]')!;
      const e = el.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const bar = document
        .querySelector<HTMLElement>('[data-panel] .mf-actions')!
        .getBoundingClientRect();
      return {
        inPanel: e.top >= p.top - 1 && e.bottom <= p.bottom + 1,
        inWindow: e.top >= 0 && e.bottom <= window.innerHeight,
        clearOfButtons: e.bottom <= bar.top + 1,
      };
    });
    expect(inside).toEqual({ inPanel: true, inWindow: true, clearOfButtons: true });

    await page.locator('[data-status-active]').check();
    await expect(page.locator('[data-confirm]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deactivate user' })).toHaveCount(0);
  });

  test('Deactivate user saves; the person is Inactive in the list', async ({ page, personas }) => {
    const victim = await personas.create({ label: `us1x-victim`, roles: ['Data Technician'] });
    await page.goto(`/admin/users?status=all&account=e2e-us1x-victim`);
    await rowButton(page, victim.userId).click();
    await page.locator('[data-status-inactive]').check();
    await page.getByRole('button', { name: 'Deactivate user' }).click();
    await expect(page.locator(`tr[data-user="${victim.userId}"] [data-status]`)).toContainText(
      'Inactive',
    );
    await expect(page.locator('[data-confirm]')).toHaveCount(0);
  });

  test('keyboard: the radio, then Tab reaches Cancel / Deactivate user, Cancel brings Active back', async ({
    page,
  }) => {
    await openList(page, 1366, 768);
    await rowButton(page, active.userId).click();
    await page.locator('[data-status-inactive]').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('[data-confirm]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Deactivate user' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-confirm]')).toHaveCount(0);
    await expect(page.locator('[data-status-active]')).toBeChecked();
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
    await page.locator('[data-status-inactive]').check();
    await expect(page.locator('[data-confirm]')).toContainText(
      'This user has 2 open tasks. They stay assigned until you reassign them one by one.',
    );
    const link = page.getByRole('link', { name: 'View their tasks' });
    await expect(link).toBeVisible();
    // Reachable by keyboard from the question.
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
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
    await page.locator('[data-status-inactive]').check();
    await expect(page.locator('[data-confirm]')).toContainText(
      'No open tasks are assigned to them.',
    );
    await expect(page.getByRole('link', { name: 'View their tasks' })).toHaveCount(0);
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
    await page.locator('[data-status-inactive]').check();
    await expect(page.locator('[data-confirm]')).toContainText(
      'Their assigned tasks stay assigned until you reassign them one by one.',
    );
    await expect(page.getByRole('link', { name: 'View their tasks' })).toHaveCount(0);
  });
});

test.describe('axe and layout at four sizes', () => {
  test.skip(!axeAvailable(), 'axe-core is not available');
  for (const { width, height } of SIZES) {
    test(`list, panel and the deactivation question at ${width}x${height}`, async ({ page }) => {
      await openList(page, width, height);
      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);

      await rowButton(page, active.userId).click();
      await expect(page.locator('[data-panel-heading]')).toBeFocused();
      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);

      await page.locator('[data-status-inactive]').check();
      await expect(page.locator('[data-confirm]')).toBeFocused();
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
      await page.locator('[data-status-inactive]').check();
      await expect(page.locator('[data-confirm]')).toBeFocused();
      await shot('user-deactivate-confirm');
    });
  }
});
