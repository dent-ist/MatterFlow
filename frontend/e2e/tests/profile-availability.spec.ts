import { Locator, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { CreateTaskPage } from '../pages/create-task.page';
import { TaskDetailPage } from '../pages/task-detail.page';
import { Api } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { openEditAvailability } from '../support/users-grid';
import { dropdownById, filterDropdown } from '../support/dropdown';

/**
 * My profile (availability and work hours, epic #68 / issue #70): setting out of office from the profile and the header, the
 * availability chip and filter on the Users administration screen, "I'm Back", work-hours validation, the unsaved-changes guard,
 * an admin editing on behalf, the out-of-office flag on assignee pickers, and axe at 1366x768 and 375.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A day `plus` days from today in the firm zone (the suite runs in America/New_York) as `Oct 20, 2026` and `yyyy-MM-dd`. */
function inDays(plus: number): { text: string; iso: string; short: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const d = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + plus));
  const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
  return {
    text: `${MONTHS[m]} ${day}, ${y}`,
    iso: `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    short: `${MONTHS[m]} ${day}`,
  };
}

async function fillDate(input: Locator, text: string): Promise<void> {
  await input.fill(text);
  await input.blur();
}

async function userMenu(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /account menu/ }).click();
  return page.getByRole('menu', { name: 'Your account' });
}

async function displayNameOf(admin: Api, userId: number): Promise<string> {
  return (await admin.get(`/api/v1/users/${userId}`)).displayName;
}

test.describe('My profile: availability and work hours', () => {
  test('the header menu works with the keyboard', async ({ asUser, seed }) => {
    const { username } = await seed.user(['Data Technician'], 'keys');
    const me = await asUser(username);
    await me.goto('/my-work');
    const button = me.getByRole('button', { name: /account menu/ });
    await expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await button.focus();
    await me.keyboard.press('ArrowDown');
    await expect(me.getByRole('menuitem', { name: 'My Profile' })).toBeFocused();
    await me.keyboard.press('End');
    await expect(me.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeFocused();
    await me.keyboard.press('Escape');
    await expect(me.getByRole('menu')).toHaveCount(0);
    await expect(button).toBeFocused();

    await button.press('Enter');
    await me.getByRole('menuitem', { name: 'My Profile' }).press('Enter');
    await expect(me).toHaveURL(/\/profile$/);
  });

  test('work hours: live validation, copy to all weekdays, and the saved hours come back', async ({
    asUser,
    seed,
  }) => {
    const { username } = await seed.user(['Data Technician'], 'hours');
    const me = await asUser(username);
    await me.goto('/profile');

    await me.getByRole('button', { name: 'Different Hours on Some Days' }).click();
    // An end time before the start time is reported at once, in the summary on Save, and nothing is sent.
    await me.getByLabel('Tuesday end time').fill('08:00');
    await expect(me.locator('[data-day-error]')).toContainText(
      'Tuesday: the end time must be after the start time.',
    );
    await me.getByRole('button', { name: 'Save Changes' }).click();
    const summary = me.locator('[data-summary]');
    await expect(summary).toContainText('Fix the following to save');
    await expect(summary).toContainText('Tuesday: the end time must be after the start time.');
    await expect(summary).toBeFocused();
    await summary.getByRole('link', { name: /Tuesday/ }).click();
    await expect(me.getByLabel('Tuesday start time')).toBeFocused();

    // Fix it with Copy to all weekdays: Monday 08:00-16:00 everywhere Monday to Friday, Friday off is kept by switching Saturday on.
    await me.getByLabel('Monday start time').fill('08:00');
    await me.getByLabel('Monday end time').fill('16:00');
    await me.getByRole('button', { name: 'Copy Monday to All Weekdays' }).click();
    await expect(me.getByLabel('Thursday end time')).toHaveValue('16:00');
    await expect(me.locator('[data-day-error]')).toHaveCount(0);
    await me.getByLabel('Saturday', { exact: true }).check();
    await me.getByLabel('Saturday start time').fill('10:00');
    await me.getByLabel('Saturday end time').fill('12:00');
    await me.getByRole('button', { name: 'Save Changes' }).click();
    await expect(me.getByText('Availability saved').first()).toBeVisible();

    await me.reload();
    await expect(me.getByLabel('Wednesday start time')).toHaveValue('08:00');
    await expect(me.getByLabel('Wednesday end time')).toHaveValue('16:00');
    await expect(me.getByLabel('Saturday end time')).toHaveValue('12:00');
    await expect(me.getByLabel('Sunday', { exact: true })).not.toBeChecked();
  });

  test('a time zone that is not in the list is refused; the browser zone is preselected', async ({
    asUser,
    seed,
  }) => {
    const { username } = await seed.user(['Data Technician'], 'zone');
    const me = await asUser(username, { timezoneId: 'Europe/Berlin' });
    await me.goto('/profile');
    await expect(dropdownById(me, 'av-tz')).toHaveAttribute('data-value', 'Europe/Berlin');
    await dropdownById(me, 'av-tz').selectOption('__other__');
    await me.locator('#av-tz-other').fill('Mars/Olympus');
    await expect(me.locator('[data-tz-error]')).toContainText('is not a time zone we know');
    await me.locator('#av-tz-other').fill('Asia/Tokyo');
    await expect(me.locator('[data-tz-error]')).toHaveCount(0);
    await me.getByRole('button', { name: 'Save Changes' }).click();
    await expect(me.getByText('Availability saved').first()).toBeVisible();
    await me.reload();
    // A saved zone that is not a US zone stays selectable as an extra option (#540).
    await expect(dropdownById(me, 'av-tz')).toHaveAttribute('data-value', 'Asia/Tokyo');
  });

  test('leaving with unsaved edits asks first; the answer keeps or drops them', async ({
    asUser,
    seed,
  }) => {
    const { username } = await seed.user(['Data Technician'], 'guard');
    const me = await asUser(username);
    await me.goto('/profile');
    await me.getByLabel('Start time', { exact: true }).fill('07:00');
    await me.getByRole('link', { name: 'My Work' }).click();
    const ask = me.getByRole('dialog', { name: 'Unsaved Changes' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(me).toHaveURL(/\/profile$/);
    await expect(me.getByLabel('Start time', { exact: true })).toHaveValue('07:00');

    await me.getByRole('link', { name: 'My Work' }).click();
    await me
      .getByRole('dialog', { name: 'Unsaved Changes' })
      .getByRole('button', { name: 'Discard Changes' })
      .click();
    await expect(me).toHaveURL(/\/my-work$/);
  });

  test('assignee pickers and menus do not list a person who is out of office (DB-14)', async ({
    page,
    seed,
    admin,
  }) => {
    const { userId } = await seed.user(['Data Technician'], 'flag');
    const name = await displayNameOf(admin, userId);
    const until = inDays(4);
    await seed.outOfOffice(userId, { until: until.iso });
    const world = await seed.world();

    // Create task: the Assignee typeahead finds nobody by that name.
    const create = new CreateTaskPage(page);
    await create.open(`?taskType=${world.taskType.id}`);
    await create.openWhen();
    await create.assignee.fill(name);
    await expect(page.getByRole('option', { name })).toHaveCount(0);

    // The inline assignee menu on a task: not listed either.
    const task = await seed.task(world, { title: `Flag ${name}` });
    await new TaskDetailPage(page).open(task.taskId);
    await page.locator('[data-assignee] [data-inline-trigger]').click();
    await page.getByRole('textbox', { name: 'Search People' }).fill(name);
    await expect(page.getByRole('menuitemradio', { name })).toHaveCount(0);
  });
});

test.describe('My profile: accessibility (axe wcag2a, wcag2aa, wcag21aa)', () => {
  const SIZES = [
    { name: '1366x768', width: 1366, height: 768 },
    { name: '375', width: 375, height: 812 },
  ];

  test.skip(!axeAvailable(), 'axe-core is not installed (npm ci) and E2E_AXE_PATH is not set');

  for (const size of SIZES) {
    test(`profile, header menu, dialogs and the Users list are clean at ${size.name}`, async ({
      page,
      asUser,
      seed,
      admin,
    }) => {
      const { username, userId } = await seed.user(['Data Technician'], `axe${size.width}`);
      const name = await displayNameOf(admin, userId);
      const me = await asUser(username);
      await me.setViewportSize({ width: size.width, height: size.height });

      await me.goto('/profile');
      await expect(me.locator('h1 [data-availability-chip]')).toBeVisible();
      expect(await axeViolations(me)).toEqual([]);

      // The Add dialog is clean too (epic #1074, CAL-05), and nothing scrolls sideways.
      await me.getByRole('button', { name: 'Add Out of Office' }).first().click();
      await expect(me.getByRole('dialog', { name: 'Add Out of Office' })).toBeVisible();
      expect(await axeViolations(me)).toEqual([]);
      await me.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
      expect(
        await me.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
      await me.getByLabel('End time', { exact: true }).fill('07:00'); // an error summary on screen
      await me.getByRole('button', { name: 'Save Changes' }).click();
      await expect(me.locator('[data-summary]')).toBeVisible();
      expect(await axeViolations(me)).toEqual([]);

      await me.getByLabel('End time', { exact: true }).fill('16:00');
      await me.getByRole('button', { name: 'Save Changes' }).click();
      await expect(me.getByText('Availability saved').first()).toBeVisible();
      await me.getByRole('button', { name: /account menu/ }).click();
      await expect(me.getByRole('menu')).toBeVisible();
      expect(await axeViolations(me)).toEqual([]);
      await me.keyboard.press('Escape');

      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`/admin/users?status=active&name=${encodeURIComponent(name)}`);
      // A table row from 640 px (with the availability chip), a card below (its summary line says it, #445).
      const row = page.locator(size.width < 640 ? 'li.rc' : 'tbody tr', { hasText: name });
      if (size.width < 640) await expect(row.locator('[data-card-summary]')).toBeVisible();
      else await expect(row.locator('[data-availability-chip]')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);

      await openEditAvailability(row);
      const dialog = page.getByRole('dialog', { name: `Availability of ${name}` });
      await expect(dialog.locator('[data-preview-chip]')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});
