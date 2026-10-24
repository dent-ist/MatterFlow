import { Page } from '@playwright/test';
import { Api } from '../support/api';
import { axeAvailable, axeBestPractice } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Notifications, frontend (NT-D1 to NT-D5, #745 to #749): the lazy bell with its count and polite live region, the panel (popover and
 * phone sheet), the /notifications page and the My profile switches, against the real API. The admin is the actor; the technician is the
 * recipient (the person who makes a change is never notified).
 */
const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

const SHOTS = process.env['E2E_SHOT_DIR'];

const bell = (page: Page) => page.getByTestId('notification-bell');
const badge = (page: Page) => page.locator('[data-notification-badge]');
const panel = (page: Page) => page.locator('[data-notification-panel]');
const live = (page: Page) => page.locator('[data-notification-live]');
const sideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function setup(seed: Seeder, admin: Api) {
  const tech = await seed.user(['Data Technician'], 'ntf');
  const world = await seed.world();
  const assign = (title: string) =>
    seed.task(world, { title, assignedUserId: tech.userId }) as Promise<{
      taskId: number;
      taskNumber: string;
    }>;
  return { tech, world, assign, admin };
}

test.describe('Notification bell and panel', () => {
  test('a task assigned to the technician shows in the badge, the panel and the live region; reading it clears the badge', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(150_000);
    const { tech, assign } = await setup(seed, admin);
    const first = `Review privilege log ${uid()}`;
    const task = await assign(first);

    const page = await asUser(tech.username);
    await page.goto('/tasks');
    // The first poll never announces what is already there.
    await expect(badge(page)).toHaveText('1');
    await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications, 1 unread');
    await expect(badge(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(live(page)).toHaveText('');
    await expect(live(page)).toHaveAttribute('aria-live', 'polite');
    await expect(live(page)).toHaveAttribute('role', 'status');

    await bell(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(page.locator('#np-title')).toBeFocused();
    const row = panel(page).locator('[data-notification-item]').first();
    await expect(row).toContainText('Assigned to you');
    await expect(row).toContainText(first);
    await expect(row).toContainText('Unread:');
    await expect(row.locator('time')).toHaveAttribute('datetime', /\d{4}-\d\d-\d\d/);
    await expect(panel(page).locator('[data-view-all]')).toBeVisible();

    // Esc closes and gives focus back to the bell.
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(bell(page)).toBeFocused();

    // A second assignment arrives with a poll (30 s plus up to 5 s) and is announced politely, once.
    const second = `Load production volume ${uid()}`;
    await assign(second);
    await expect(live(page)).toHaveText(
      `New notification: ${await messageOf(tech.username, second)}`,
      {
        timeout: 50_000,
      },
    );
    await expect(badge(page)).toHaveText('2');

    // Choosing an item reads it, opens the task and lowers the count at once.
    await bell(page).click();
    await panel(page).locator('[data-notification-item]', { hasText: first }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.taskId}`));
    await expect(panel(page)).toHaveCount(0);
    await expect(badge(page)).toHaveText('1');
    await expect(live(page)).toHaveText(/^New notification:/); // own mark-read is not announced

    await bell(page).click();
    await panel(page).locator('[data-mark-all-read]').click();
    await expect(badge(page)).toHaveCount(0);
    await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications, 0 unread');
    await expect(panel(page).locator('[data-mark-all-read]')).toHaveCount(0);
    await expect(panel(page).locator('.np__item--unread')).toHaveCount(0);
  });

  test('a comment by somebody else is a notification, opened and read with the keyboard alone; no key opens the panel but the bell', async ({
    admin,
    seed,
    asUser,
  }) => {
    test.setTimeout(150_000);
    const { tech, assign } = await setup(seed, admin);
    const title = `Comment target ${uid()}`;
    const task = await assign(title);
    const page = await asUser(tech.username);
    await page.goto('/tasks');
    await expect(badge(page)).toHaveText('1'); // the assignment

    await admin.post(`/api/v1/tasks/${task.taskId}/comments`, {
      bodyHtml: '<p>Please re-run the search with the new terms</p>',
    });
    await expect(badge(page)).toHaveText('2', { timeout: 50_000 });

    // The keys of the app (existing ones and letters that are not shortcuts) do not open the panel; only the bell does.
    await page
      .locator('main h1')
      .first()
      .evaluate((h) => {
        h.setAttribute('tabindex', '-1');
        (h as HTMLElement).focus();
      });
    for (const key of ['n', 'b', '.', 'x']) await page.keyboard.press(key);
    await expect(panel(page)).toHaveCount(0);

    await bell(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#np-title')).toBeFocused();
    const comment = panel(page).locator('[data-notification-item]', { hasText: 'New comment from' });
    await expect(comment).toContainText(task.taskNumber);
    // The wording is reason first and names the commenter; the comment text is not repeated in the notification.
    await expect(comment).not.toContainText('Please re-run the search');
    // Tab walks the panel: Mark all as read, the items, View all; Enter on the comment item opens the task and reads it.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      if (
        await comment.evaluate(
          (el) => el === document.activeElement || el.contains(document.activeElement),
        )
      )
        break;
    }
    await expect(comment).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.taskId}`));
    await expect(panel(page)).toHaveCount(0);
    await expect(badge(page)).toHaveText('1');
  });

  test('the actor is never notified', async ({ admin, seed, asUser }) => {
    const { tech, assign } = await setup(seed, admin);
    await assign(`Actor ${uid()}`);
    const page = await asUser(tech.username);
    await page.goto('/tasks');
    await expect(badge(page)).toHaveText('1');
    const adminApi = await Api.as('ke\\kekim');
    const poll = await adminApi.get('/api/v1/me/notifications/poll?initial=true');
    expect(poll.items).toEqual([]);
    await adminApi.dispose();
  });

  test('panel states: empty and the phone sheet', async ({ admin, seed, asUser }) => {
    const { tech, assign } = await setup(seed, admin);
    const page = await asUser(tech.username);
    await page.goto('/tasks');
    await bell(page).click();
    await expect(panel(page).locator('[data-panel-empty]')).toContainText("You're all caught up.");
    await page.keyboard.press('Escape');

    await assign(`Sheet ${uid()}`);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/tasks');
    await expect(badge(page)).toHaveText('1');
    await bell(page).click();
    const box = (await panel(page).boundingBox())!;
    expect(box.x).toBe(0);
    expect(Math.round(box.width)).toBe(375);
    expect(await sideScroll(page)).toBe(0);
    await expect(panel(page).locator('[data-panel-close]')).toBeVisible();
    await panel(page).locator('[data-panel-close]').click();
    await expect(panel(page)).toHaveCount(0);
    await expect(bell(page)).toBeFocused();
  });

  test('axe is clean with the panel open at four sizes, and the header does not scroll sideways', async ({
    admin,
    seed,
    asUser,
  }, info) => {
    test.skip(!axeAvailable(), 'axe-core is not available');
    test.setTimeout(120_000);
    const { tech, assign } = await setup(seed, admin);
    await assign(`Axe one ${uid()}`);
    await assign(`Axe two ${uid()}`);
    const page = await asUser(tech.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/tasks');
      await expect(badge(page)).toHaveText('2');
      await bell(page).click();
      await expect(panel(page).locator('[data-notification-item]')).toHaveCount(2);
      expect(await sideScroll(page), size.name).toBe(0);
      const found = await axeBestPractice(page);
      expect(
        found.filter((v) => !['skip-link', 'region'].includes(v.id)),
        size.name,
      ).toEqual([]);
      await shot(page, `panel-${size.name}`);
      await page.keyboard.press('Escape');
    }
    info.annotations.push({ type: 'axe', description: 'run at 4 sizes with the panel open' });
  });

  test('a person without Task.View has no bell and no notification request, and /notifications is the 403 page', async ({
    personas,
    asUser,
  }) => {
    const viewer = await personas.create({ permissions: ['Client.View'] });
    const page = await asUser(viewer.username);
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/me/notification')) calls.push(r.url());
    });
    await page.goto('/clients');
    await expect(page.getByTestId('user-menu')).toBeVisible();
    await expect(bell(page)).toHaveCount(0);
    await page.goto('/notifications');
    await expect(
      page.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    expect(calls).toEqual([]);
  });
});

test.describe('Scheduled notifications reach the bell', () => {
  test('an overdue task shows up for its assignee within a scheduler tick, once', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const { tech, world } = await setup(seed, admin);
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const title = `Overdue ${uid()}`;
    await seed.task(world, { title, assignedUserId: tech.userId, dueDate: yesterday });

    const page = await asUser(tech.username);
    await page.goto('/tasks');
    // Assigned (create path) at once; overdue when the scheduler runs (every minute on the e2e stack).
    await expect(badge(page)).toHaveText('2', { timeout: 120_000 });
    await bell(page).click();
    const rows = panel(page).locator('[data-notification-item]');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Overdue');
    await expect(rows.first()).toContainText(title);
    await page.waitForTimeout(65_000); // another tick: nothing new for the same due date
    await page.reload();
    await expect(badge(page)).toHaveText('2');
  });
});

test.describe('Notifications page', () => {
  test('filter, paging and mark all as read, restored from the address', async ({
    admin,
    seed,
    asUser,
  }) => {
    test.setTimeout(150_000);
    const { tech, assign } = await setup(seed, admin);
    const made: { taskId: number }[] = [];
    for (let i = 0; i < 27; i += 3) {
      made.push(...(await Promise.all([1, 2, 3].map((n) => assign(`Paged ${i + n} ${uid()}`)))));
    }
    const page = await asUser(tech.username);
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
    await expect(page.locator('[data-notification-item]')).toHaveCount(25);
    await expect(page.locator('[data-filter=unread]')).toHaveText('Unread (27)');
    await expect(page.locator('[data-filter=all]')).toHaveAttribute('aria-pressed', 'true');
    await shot(page, 'page-desktop');

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('[data-notification-item]')).toHaveCount(2);
    await expect(page.locator('[data-result-count]')).toContainText('27 notifications, page 2');

    await page.goto('/notifications?filter=unread&page=1');
    await expect(page.locator('[data-filter=unread]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-mark-all-read]').first().click();
    await expect(page.locator('[data-page-empty]')).toContainText('No unread notifications.');
    await page.locator('[data-show-all]').click();
    await expect(page).toHaveURL(/\/notifications(\?pageSize=25)?$/);
    await expect(page.locator('[data-notification-item]')).toHaveCount(25);
    await expect(page.locator('.npg__row--unread')).toHaveCount(0);
    await expect(badge(page)).toHaveCount(0);

    // Opening a row opens the task.
    await page.locator('[data-notification-item]').first().click();
    await expect(page).toHaveURL(/\/tasks\/\d+/);
  });

  test('axe is clean at four sizes and the empty page says so', async ({ admin, seed, asUser }) => {
    test.skip(!axeAvailable(), 'axe-core is not available');
    test.setTimeout(120_000);
    const { tech, assign } = await setup(seed, admin);
    const empty = await asUser(tech.username);
    await empty.goto('/notifications');
    await expect(empty.locator('[data-page-empty]')).toContainText('No notifications yet.');
    await assign(`Page axe ${uid()}`);
    const page = await asUser(tech.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/notifications');
      await expect(page.locator('[data-notification-item]')).toHaveCount(1);
      expect(await sideScroll(page), size.name).toBe(0);
      const found = await axeBestPractice(page);
      expect(
        found.filter((v) => !['skip-link', 'region'].includes(v.id)),
        size.name,
      ).toEqual([]);
      await shot(page, `page-${size.name}`);
    }
  });
});

test.describe('My profile: Notifications section', () => {
  test('eight switches, saved at once, honoured for the next notification', async ({
    admin,
    seed,
    asUser,
  }) => {
    test.setTimeout(120_000);
    const { tech, assign } = await setup(seed, admin);
    const page = await asUser(tech.username);
    await page.goto('/profile');
    const section = page.locator('[data-notification-preferences]');
    await expect(section.locator('input[role=switch]')).toHaveCount(8);
    await expect(section.locator('input[role=switch]:checked')).toHaveCount(8);
    await expect(section).toContainText('nothing is sent by email');
    // A technician holds the Technician group; the others sit under "Other events".
    await expect(section.locator('[data-prefs-other] [data-prefs-group=Technician]')).toHaveCount(
      0,
    );
    await expect(
      section.locator('[data-prefs-other] [data-prefs-group=ProjectManager]'),
    ).toHaveCount(1);

    await section.getByLabel('A task is assigned to me').uncheck();
    await expect(section.locator('[data-prefs-status]')).toHaveText('Saved.');
    const mine = await Api.as(tech.username);
    const prefs = await mine.get('/api/v1/me/notification-preferences');
    expect(
      prefs.items.find((i: { eventType: string }) => i.eventType === 'TaskAssigned').enabled,
    ).toBe(false);

    await assign(`Switched off ${uid()}`);
    const poll = await mine.get('/api/v1/me/notifications/poll?initial=true');
    expect(poll.unreadCount).toBe(0);
    await mine.dispose();

    await page.reload();
    await expect(section.getByLabel('A task is assigned to me')).not.toBeChecked();
    await expect(section.locator('input[role=switch]:checked')).toHaveCount(7);
    await shot(page, 'profile-desktop');

    // A failed save puts the switch back with an inline message and no toast.
    await page.route('**/me/notification-preferences', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 500, body: '{}' })
        : route.continue(),
    );
    await section.getByLabel('A task is assigned to me').check();
    await expect(section.locator('[data-prefs-error]')).toContainText('A task is assigned to me');
    await expect(section.getByLabel('A task is assigned to me')).not.toBeChecked();
    await expect(page.locator('.p-toast-message')).toHaveCount(0);
  });

  test('axe is clean at four sizes', async ({ admin, seed, asUser }) => {
    test.skip(!axeAvailable(), 'axe-core is not available');
    test.setTimeout(120_000);
    const { tech } = await setup(seed, admin);
    const page = await asUser(tech.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/profile');
      await expect(page.locator('[data-notification-preferences] input[role=switch]')).toHaveCount(
        8,
      );
      await page.locator('[data-prefs-other] summary').click();
      expect(await sideScroll(page), size.name).toBe(0);
      // Only this section: the availability form above it has its own finding (a 16 px day checkbox at 1920 px).
      expect(await axeBestPractice(page, '[data-notification-preferences]'), size.name).toEqual([]);
      await shot(page, `profile-${size.name}`);
    }
  });
});

/** The message the server wrote for the task with this title (what the live region repeats). */
async function messageOf(username: string, title: string): Promise<string> {
  const api = await Api.as(username);
  try {
    for (let i = 0; i < 20; i++) {
      const list = await api.get('/api/v1/me/notifications?pageSize=50');
      const hit = list.items.find((n: { message: string }) => n.message.includes(title));
      if (hit) return hit.message;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`no notification for ${title}`);
  } finally {
    await api.dispose();
  }
}
