import { Locator, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { CreateTaskPage } from '../pages/create-task.page';
import { TaskDetailPage } from '../pages/task-detail.page';
import { Api } from '../support/api';
import { axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * My profile (availability and work hours, epic #68 / issue #70): setting out of office from the profile and the header, the
 * availability chip and filter on the Users administration screen, "I'm back", work-hours validation, the unsaved-changes guard,
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
  test('a person sets out of office on the profile, an admin sees the chip, and "I\'m back" in the header ends it', async ({
    page,
    asUser,
    seed,
    admin,
  }) => {
    const { username, userId } = await seed.user(['Data Technician'], 'ooo');
    const name = await displayNameOf(admin, userId);
    const me = await asUser(username);
    const until = inDays(5);

    await me.goto('/profile');
    await expect(me).toHaveTitle('My profile - MatterFlow');
    await expect(me.getByRole('heading', { name: 'My profile', level: 1 })).toBeVisible();
    await expect(me.locator('[data-preview-chip]')).toHaveText(/Available|Off hours/);

    await me.getByRole('radio', { name: /Out of office/ }).check();
    await fillDate(me.locator('#av-until'), until.text);
    await me.getByLabel('Note (optional)').fill('Covering: Dana Director');
    await expect(me.locator('[data-note-count]')).toContainText('23 / 200');
    await expect(me.locator('[data-ooo-summary]')).toContainText(
      `You will show as out of office from now until ${until.short}`,
    );
    await me.getByRole('button', { name: 'Save changes' }).click();

    await expect(me.getByText('Availability saved').first()).toBeVisible();
    await expect(me.locator('[data-preview-chip]')).toContainText(
      `Out of office until ${until.short}`,
    );
    // The header says so too.
    await expect(me.locator('[data-ooo-label]')).toContainText(
      `Out of office until ${until.short}`,
    );

    // The administrator sees the chip in the Users list.
    await page.goto('/admin/users?status=active');
    await page.getByRole('searchbox', { name: 'Search users' }).fill(name);
    const row = page.locator('tbody tr', { hasText: name });
    await expect(row.locator('[data-availability-chip]')).toContainText(
      `Out of office until ${until.short}`,
    );

    // "I'm back" from the header menu.
    const menu = await userMenu(me);
    await expect(menu.getByRole('menuitem')).toHaveText([
      /My profile/,
      /I'm back/,
      /Keyboard shortcuts/,
    ]);
    await menu.getByRole('menuitem', { name: "I'm back" }).click();
    await expect(me.getByText('Welcome back')).toBeVisible();
    await expect(me.locator('[data-ooo-label]')).toHaveCount(0);

    await page.reload();
    await page.getByRole('searchbox', { name: 'Search users' }).fill(name);
    await expect(
      page.locator('tbody tr', { hasText: name }).locator('[data-availability-chip]'),
    ).toHaveText(/Available|Off hours/);
  });

  test('"Set out of office..." in the header menu asks for an until date and a note', async ({
    asUser,
    seed,
  }) => {
    const { username } = await seed.user(['Data Technician'], 'quick');
    const me = await asUser(username);
    const until = inDays(3);
    await me.goto('/my-work');

    const menu = await userMenu(me);
    await menu.getByRole('menuitem', { name: 'Set out of office...' }).click();
    const dialog = me.getByRole('dialog', { name: 'Set out of office' });
    await fillDate(dialog.locator('#ooo-until'), until.text);
    await dialog.getByLabel('Note (optional)').fill('Back soon');
    await expect(dialog.locator('[data-ooo-summary]')).toContainText(`until ${until.short}`);
    await dialog.getByRole('button', { name: 'Set out of office' }).click();

    await expect(me.locator('[data-ooo-label]')).toContainText(
      `Out of office until ${until.short}`,
    );
    // Focus returns to the menu button that opened the dialog.
    await expect(me.getByRole('button', { name: /account menu/ })).toBeFocused();
  });

  test('the header menu works with the keyboard', async ({ asUser, seed }) => {
    const { username } = await seed.user(['Data Technician'], 'keys');
    const me = await asUser(username);
    await me.goto('/my-work');
    const button = me.getByRole('button', { name: /account menu/ });
    await expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await button.focus();
    await me.keyboard.press('ArrowDown');
    await expect(me.getByRole('menuitem', { name: 'My profile' })).toBeFocused();
    await me.keyboard.press('End');
    await expect(me.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeFocused();
    await me.keyboard.press('Escape');
    await expect(me.getByRole('menu')).toHaveCount(0);
    await expect(button).toBeFocused();

    await button.press('Enter');
    await me.getByRole('menuitem', { name: 'My profile' }).press('Enter');
    await expect(me).toHaveURL(/\/profile$/);
  });

  test('work hours: live validation, copy to all weekdays, and the saved hours come back', async ({
    asUser,
    seed,
  }) => {
    const { username } = await seed.user(['Data Technician'], 'hours');
    const me = await asUser(username);
    await me.goto('/profile');

    // An end time before the start time is reported at once, in the summary on Save, and nothing is sent.
    await me.getByLabel('Tuesday end time').fill('08:00');
    await expect(me.locator('[data-day-error]')).toContainText(
      'Tuesday: the end time must be after the start time.',
    );
    await me.getByRole('button', { name: 'Save changes' }).click();
    const summary = me.locator('[data-summary]');
    await expect(summary).toContainText('Fix the following to save');
    await expect(summary).toContainText('Tuesday: the end time must be after the start time.');
    await expect(summary).toBeFocused();
    await summary.getByRole('link', { name: /Tuesday/ }).click();
    await expect(me.getByLabel('Tuesday start time')).toBeFocused();

    // Fix it with Copy to all weekdays: Monday 08:00-16:00 everywhere Monday to Friday, Friday off is kept by switching Saturday on.
    await me.getByLabel('Monday start time').fill('08:00');
    await me.getByLabel('Monday end time').fill('16:00');
    await me.getByRole('button', { name: 'Copy Monday to all weekdays' }).click();
    await expect(me.getByLabel('Thursday end time')).toHaveValue('16:00');
    await expect(me.locator('[data-day-error]')).toHaveCount(0);
    await me.getByLabel('Saturday', { exact: true }).check();
    await me.getByLabel('Saturday start time').fill('10:00');
    await me.getByLabel('Saturday end time').fill('12:00');
    await me.getByRole('button', { name: 'Save changes' }).click();
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
    await expect(me.getByLabel('Time zone')).toHaveValue('Europe/Berlin');
    await me.getByLabel('Time zone').fill('Mars/Olympus');
    await expect(me.locator('[data-tz-error]')).toContainText('is not a time zone we know');
    await me.getByLabel('Time zone').fill('Asia/Tokyo');
    await expect(me.locator('[data-tz-error]')).toHaveCount(0);
    await me.getByRole('button', { name: 'Save changes' }).click();
    await expect(me.getByText('Availability saved').first()).toBeVisible();
    await me.reload();
    await expect(me.getByLabel('Time zone')).toHaveValue('Asia/Tokyo');
  });

  test('leaving with unsaved edits asks first; the answer keeps or drops them', async ({
    asUser,
    seed,
  }) => {
    const { username } = await seed.user(['Data Technician'], 'guard');
    const me = await asUser(username);
    await me.goto('/profile');
    await me.getByLabel('Monday start time').fill('07:00');
    await me.getByRole('link', { name: 'My Work' }).click();
    const ask = me.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Stay' }).click();
    await expect(me).toHaveURL(/\/profile$/);
    await expect(me.getByLabel('Monday start time')).toHaveValue('07:00');

    await me.getByRole('link', { name: 'My Work' }).click();
    await me
      .getByRole('dialog', { name: 'Leave without saving?' })
      .getByRole('button', { name: 'Leave' })
      .click();
    await expect(me).toHaveURL(/\/my-work$/);
  });

  test("an admin edits availability on behalf of a user; the chip, the filter and the user's own profile follow", async ({
    page,
    asUser,
    seed,
    admin,
  }) => {
    const { username, userId } = await seed.user(['Data Technician'], 'behalf');
    const name = await displayNameOf(admin, userId);
    const until = inDays(7);

    await page.goto('/admin/users?status=active');
    await page.getByRole('searchbox', { name: 'Search users' }).fill(name);
    const row = page.locator('tbody tr', { hasText: name });
    await row.getByRole('button', { name: `Edit availability of ${name}` }).click();
    const dialog = page.getByRole('dialog', { name: `Availability of ${name}` });
    await expect(dialog.locator('[data-preview]')).toContainText(`${name}'s current status`);
    await dialog.getByRole('radio', { name: /Out of office/ }).check();
    await expect(dialog.locator('[data-ooo-summary]')).toContainText(
      `${name} will show as out of office`,
    );
    await fillDate(dialog.locator('#av-until'), until.text);
    await dialog.getByLabel('Note (optional)').fill('Sick leave cover');
    await dialog.getByRole('button', { name: 'Save changes' }).click();

    await expect(dialog).toBeHidden();
    await expect(row.locator('[data-availability-chip]')).toContainText(
      `Out of office until ${until.short}`,
    );

    // The availability filter next to the status filter.
    await page.getByRole('searchbox', { name: 'Search users' }).fill('');
    await page.getByLabel('Availability', { exact: true }).selectOption('OUT_OF_OFFICE');
    await expect(page).toHaveURL(/availability=OUT_OF_OFFICE/);
    await expect(page.locator('tbody tr', { hasText: name })).toBeVisible();
    await expect(
      page.locator('tbody tr [data-availability-chip]:not([data-state=OUT_OF_OFFICE])'),
    ).toHaveCount(0);
    await page.getByLabel('Availability', { exact: true }).selectOption('AVAILABLE');
    await expect(page.locator('tbody tr', { hasText: name })).toHaveCount(0);

    // The person sees it on their own profile and in the header, with the note.
    const me = await asUser(username);
    await me.goto('/profile');
    await expect(me.getByRole('radio', { name: /Out of office/ })).toBeChecked();
    await expect(me.getByLabel('Note (optional)')).toHaveValue('Sick leave cover');
    await expect(me.locator('[data-ooo-label]')).toBeVisible();
  });

  test('a second editor gets a conflict message and the latest values, not a silent overwrite', async ({
    asUser,
    seed,
    admin,
  }) => {
    const { username, userId } = await seed.user(['Data Technician'], 'conflict');
    const me = await asUser(username);
    await me.goto('/profile');
    await expect(me.getByRole('radio', { name: 'Available' })).toBeChecked();

    await seed.outOfOffice(userId, { note: 'Changed elsewhere' }); // another editor saves first
    await me.getByLabel('Monday start time').fill('07:00');
    await me.getByRole('button', { name: 'Save changes' }).click();
    await expect(me.locator('[data-conflict]')).toContainText('your edits were not saved');
    await expect(me.getByRole('radio', { name: /Out of office/ })).toBeChecked();
    await expect(me.getByLabel('Note (optional)')).toHaveValue('Changed elsewhere');
    expect(admin).toBeTruthy();
  });

  test('assignee pickers and menus flag a person who is out of office but still let you choose them', async ({
    page,
    seed,
    admin,
  }) => {
    const { userId } = await seed.user(['Data Technician'], 'flag');
    const name = await displayNameOf(admin, userId);
    const until = inDays(4);
    await seed.outOfOffice(userId, { until: until.iso });
    const world = await seed.world();

    // Create task: the Assignee typeahead.
    const create = new CreateTaskPage(page);
    await create.open(`?taskType=${world.taskType.id}`);
    await create.assignee.fill(name);
    const option = page.getByRole('option', { name });
    await expect(option.locator('[data-option-flag]')).toContainText(
      `Out of office until ${until.short}`,
    );
    await option.click();
    await expect(page.locator('[data-chosen]').filter({ hasText: name })).toBeVisible();
    await expect(page.locator('[data-chosen-flag]')).toContainText('Out of office until');

    // The inline assignee menu on a task: flagged, and the pick still assigns.
    const task = await seed.task(world, { title: `Flag ${name}` });
    await new TaskDetailPage(page).open(task.taskId);
    await page.locator('[data-assignee] [data-inline-trigger]').click();
    await page.getByRole('searchbox', { name: /Search/ }).fill(name);
    const item = page.getByRole('menuitemradio', { name });
    await expect(item.locator('[data-option-flag]')).toContainText(
      `Out of office until ${until.short}`,
    );
    await item.click();
    await expect(page.locator('[data-assignee]')).toContainText(name);
  });
});

test.describe('My profile: accessibility (axe wcag2a, wcag2aa, wcag21aa)', () => {
  const SIZES = [
    { name: '1366x768', width: 1366, height: 768 },
    { name: '375', width: 375, height: 812 },
  ];

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
      await expect(me.locator('[data-preview-chip]')).toBeVisible();
      expect(await axeViolations(me)).toEqual([]);

      await me.getByRole('radio', { name: /Out of office/ }).check();
      await fillDate(me.locator('#av-until'), inDays(5).text);
      // No sideways scrolling, even with the out-of-office fields open.
      expect(
        await me.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
      await me.getByLabel('Monday end time').fill('07:00'); // an error summary on screen
      await me.getByRole('button', { name: 'Save changes' }).click();
      await expect(me.locator('[data-summary]')).toBeVisible();
      expect(await axeViolations(me)).toEqual([]);

      await me.getByLabel('Monday end time').fill('16:00');
      await me.getByRole('button', { name: 'Save changes' }).click();
      await expect(me.locator('[data-ooo-label]')).toBeVisible();
      await me.getByRole('button', { name: /account menu/ }).click();
      await expect(me.getByRole('menu')).toBeVisible();
      expect(await axeViolations(me)).toEqual([]);
      await me.keyboard.press('Escape');

      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/admin/users?status=active');
      await page.getByRole('searchbox', { name: 'Search users' }).fill(name);
      await expect(
        page.locator('tbody tr', { hasText: name }).locator('[data-availability-chip]'),
      ).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);

      await page.getByRole('button', { name: `Edit availability of ${name}` }).click();
      const dialog = page.getByRole('dialog', { name: `Availability of ${name}` });
      await expect(dialog.locator('[data-preview-chip]')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});

/**
 * Screenshots for docs/ux/profile-availability (not a test: skipped unless E2E_SCREENSHOTS names the output folder):
 *   E2E_SCREENSHOTS=docs/ux/profile-availability frontend/e2e/run-local.sh -g "profile screenshots"
 */
const OUT = process.env['E2E_SCREENSHOTS'];

test.describe('profile screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, asUser, seed, admin }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(OUT!, { recursive: true });
    const world = await seed.world();
    const shot = async (p: Page, size: string, file: string, fullPage = true) => {
      // A sticky action bar would float in the middle of a full-page capture.
      if (fullPage) {
        await p.evaluate(() =>
          document
            .querySelectorAll<HTMLElement>('.mf-form-actions--sticky')
            .forEach((e) => (e.style.position = 'static')),
        );
      }
      await p.screenshot({ path: path.join(OUT!, `${size}-${file}.png`), fullPage });
    };
    const people = await Promise.all(
      [
        ['Priya Out', 'out'],
        ['Marcus Hours', 'hours'],
        ['Elena Back', 'back'],
      ].map(async ([, label]) => seed.user(['Data Technician'], `shot-${label}`)),
    );
    const names = await Promise.all(people.map((p) => displayNameOf(admin, p.userId)));
    await seed.outOfOffice(people[0].userId, {
      until: inDays(6).iso,
      note: 'Covering: Dana Director',
    });
    await seed.availability(people[1].userId, {
      workHours: [1, 2, 3, 4].map((d) => ({ dayOfWeek: d, start: '07:00', end: '15:00' })),
    });

    for (const size of [
      { n: '1366x768', w: 1366, h: 768 },
      { n: '375', w: 375, h: 812 },
    ]) {
      await seed.availability(people[2].userId, {});
      const me = await asUser(people[2].username);
      await me.setViewportSize({ width: size.w, height: size.h });
      await me.goto('/profile');
      await expect(me.locator('[data-preview-chip]')).toBeVisible();
      await shot(me, size.n, '01-profile-available');

      await me.getByRole('radio', { name: /Out of office/ }).check();
      await fillDate(me.locator('#av-from'), inDays(1).text);
      await fillDate(me.locator('#av-until'), inDays(5).text);
      await me.getByLabel('Note (optional)').fill('Annual leave. Dana Director covers my queue.');
      await shot(me, size.n, '02-profile-out-of-office');

      await me.getByLabel('Tuesday end time').fill('08:00');
      await me.getByRole('button', { name: 'Save changes' }).click();
      await expect(me.locator('[data-summary]')).toBeVisible();
      await shot(me, size.n, '03-profile-validation');
      await me.getByLabel('Tuesday end time').fill('17:00');
      await fillDate(me.locator('#av-from'), ''); // out of office from now, so the header shows it

      await me.getByRole('button', { name: 'Save changes' }).click();
      await expect(me.locator('[data-ooo-label]')).toBeVisible();
      await me.evaluate(() => window.scrollTo(0, 0));
      await me.getByRole('button', { name: /account menu/ }).click();
      await shot(me, size.n, '04-header-menu-out-of-office', false);
      await me.keyboard.press('Escape');
      await me.getByRole('button', { name: /account menu/ }).click();
      await me.getByRole('menuitem', { name: "I'm back" }).click();
      await expect(me.locator('[data-ooo-label]')).toHaveCount(0);

      const quick = await asUser(people[2].username);
      await quick.setViewportSize({ width: size.w, height: size.h });
      await quick.goto('/my-work');
      await quick.getByRole('button', { name: /account menu/ }).click();
      await quick.getByRole('menuitem', { name: 'Set out of office...' }).click();
      const dialog = quick.getByRole('dialog', { name: 'Set out of office' });
      await fillDate(dialog.locator('#ooo-until'), inDays(3).text);
      await dialog.getByLabel('Note (optional)').fill('Back Thursday');
      await shot(quick, size.n, '05-set-out-of-office-dialog', false);

      const view = await asUser('ke\\kekim');
      await view.setViewportSize({ width: size.w, height: size.h });
      await view.goto('/admin/users?status=active');
      await view.getByRole('searchbox', { name: 'Search users' }).fill('e2e-shot');
      await expect(view.locator('tbody tr').first()).toBeVisible();
      await shot(view, size.n, '06-users-chips', false);
      await view.getByLabel('Availability', { exact: true }).selectOption('OUT_OF_OFFICE');
      await shot(view, size.n, '07-users-filter-out-of-office', false);

      await view.getByLabel('Availability', { exact: true }).selectOption('all');
      await view.getByRole('button', { name: `Edit availability of ${names[1]}` }).click();
      await expect(view.getByRole('dialog').locator('[data-preview-chip]')).toBeVisible();
      await shot(view, size.n, '08-admin-edit-availability-dialog', false);
      await view.keyboard.press('Escape');

      const create = await asUser('ke\\kekim');
      await create.setViewportSize({ width: size.w, height: size.h });
      const createTask = new CreateTaskPage(create);
      await createTask.open(`?taskType=${world.taskType.id}`);
      await createTask.assignee.fill(names[0]);
      await expect(create.locator('[data-option-flag]').first()).toBeVisible();
      await shot(create, size.n, '09-assignee-picker-flag', false);
    }
  });
});
