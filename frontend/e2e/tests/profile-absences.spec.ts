import { Locator, Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * My profile > Out of office (epic #1074, CAL-05, issue #1079): a person keeps SEVERAL entries (Now, Upcoming, Past), adds and edits them in a pop-up dialog
 * (Cancel left, primary right), deletes with a confirmation, presses "I'm back" on a running entry, and gets the server's messages for an overlap (naming the other
 * entry) and for a first day in the past. A Pod Lead (User.ManageAvailability) adds an entry for a member of their pod. axe at 1366x768 and 375x812.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A day `plus` days from today in the firm zone (the suite runs in America/New_York) as `Oct 20, 2026` and `yyyy-MM-dd`. */
function inDays(plus: number): { text: string; iso: string } {
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
  };
}

async function fillDate(input: Locator, text: string): Promise<void> {
  await input.fill(text);
  await input.blur();
}

/** Opens the Add dialog and fills it (the first day, the last day, an optional note and type). */
async function addEntry(
  page: Page,
  opts: { start: string; end?: string; note?: string; type?: string },
): Promise<Locator> {
  await page.getByRole('button', { name: 'Add out of office' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add out of office' });
  await expect(dialog).toBeVisible();
  if (opts.type) await dialog.getByLabel('Type').selectOption({ label: opts.type });
  await fillDate(dialog.locator('#ad-start'), opts.start);
  if (opts.end) await fillDate(dialog.locator('#ad-end'), opts.end);
  if (opts.note) await dialog.getByLabel('Note (optional)').fill(opts.note);
  return dialog;
}

test.describe('My profile: several Out of office entries', () => {
  test('add two entries, edit one, delete one; the list is grouped and the dates are numeric', async ({
    asUser,
    seed,
  }) => {
    const { username } = await seed.user(['Data Technician'], 'abs');
    const me = await asUser(username);
    await me.goto('/profile');
    await expect(me.locator('[data-absence-empty]')).toBeVisible();

    const first = inDays(10);
    const dialog = await addEntry(me, {
      start: first.text,
      end: inDays(12).text,
      type: 'Vacation',
      note: 'Covering: Dana',
    });
    // Cancel on the left, the primary action on the right.
    const buttons = await dialog.locator('button').allTextContents();
    expect(
      buttons
        .map((b) => b.trim())
        .filter(Boolean)
        .slice(-2),
    ).toEqual(['Cancel', 'Add out of office']);
    await dialog.getByRole('button', { name: 'Add out of office' }).click();
    await expect(dialog).toBeHidden();

    const second = await addEntry(me, {
      start: inDays(20).text,
      end: inDays(20).text,
      type: 'Training',
    });
    await second.getByRole('button', { name: 'Add out of office' }).click();
    await expect(second).toBeHidden();

    const upcoming = me.locator('[data-group="upcoming"] [data-absence]');
    await expect(upcoming).toHaveCount(2);
    await expect(upcoming.first()).toContainText('Vacation');
    await expect(upcoming.first()).toContainText('Covering: Dana');
    await expect(upcoming.first()).toContainText(/\d\d\/\d\d to \d\d\/\d\d/);

    // Edit the second entry: the note.
    await upcoming.nth(1).locator('[data-absence-edit]').click();
    const edit = me.getByRole('dialog', { name: 'Edit out of office' });
    await edit.getByLabel('Note (optional)').fill('Certification course');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit).toBeHidden();
    await expect(upcoming.nth(1)).toContainText('Certification course');

    // Delete the first one after the confirmation.
    await upcoming.first().locator('[data-absence-delete]').click();
    const confirm = me.getByRole('dialog', { name: 'Delete this entry?' });
    await expect(confirm).toContainText('Vacation');
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(upcoming).toHaveCount(1);
  });

  test('an overlapping entry names the other one; a first day in the past is refused', async ({
    asUser,
    seed,
  }) => {
    const { username } = await seed.user(['Data Technician'], 'abs-rules');
    const me = await asUser(username);
    await me.goto('/profile');
    const base = await addEntry(me, {
      start: inDays(30).text,
      end: inDays(34).text,
      type: 'Vacation',
    });
    await base.getByRole('button', { name: 'Add out of office' }).click();
    await expect(base).toBeHidden();

    const overlap = await addEntry(me, {
      start: inDays(32).text,
      end: inDays(33).text,
      type: 'Sick',
    });
    await overlap.getByRole('button', { name: 'Add out of office' }).click();
    await expect(overlap.locator('[data-ad-overlap]')).toContainText(
      'overlap another entry: Vacation',
    );
    await expect(overlap).toBeVisible();
    await overlap.getByRole('button', { name: 'Cancel' }).click();

    const past = await addEntry(me, { start: inDays(-40).text, type: 'Vacation' });
    await past.getByRole('button', { name: 'Add out of office' }).click();
    await expect(past.locator('[data-ad-start-error]')).toBeVisible();
    await past.getByRole('button', { name: 'Cancel' }).click();
  });

  test('"I\'m back" ends a running entry and the header label goes away', async ({
    asUser,
    seed,
  }) => {
    const { username, userId } = await seed.user(['Data Technician'], 'abs-back');
    await seed.outOfOffice(userId, { note: 'Away' });
    const me = await asUser(username);
    await me.goto('/profile');
    await expect(me.locator('[data-ooo-label]')).toBeVisible();
    const now = me.locator('[data-group="now"] [data-absence]');
    await expect(now).toHaveCount(1);
    await now.locator('[data-absence-back]').click();
    await expect(me.getByText('Welcome back').first()).toBeVisible();
    await expect(me.locator('[data-ooo-label]')).toHaveCount(0);
  });

  test('a Pod Lead adds an entry for a member of their pod from the Calendar day panel', async ({
    asUser,
    seed,
    personas,
  }) => {
    const lead = await personas.named('podLead');
    const member = await seed.user(['Data Technician'], 'abs-member');
    await seed.pod(undefined, [lead.userId, member.userId]);
    const page = await asUser(lead.username);
    await page.goto(`/dashboard?tab=calendar&day=${inDays(1).iso}`);
    await expect(page.locator('[data-cal-panel]')).toBeVisible();
    await page.getByRole('button', { name: 'Add out of office' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add out of office' });
    await expect(dialog.locator('[data-ad-person]')).toBeVisible();
  });
});

test.describe('My profile: Out of office, accessibility (axe wcag2a, wcag2aa, wcag21aa)', () => {
  test.skip(!axeAvailable(), 'axe-core is not installed (npm ci) and E2E_AXE_PATH is not set');
  for (const size of [
    { name: '1366x768', width: 1366, height: 768 },
    { name: '1920x1080', width: 1920, height: 1080 },
    { name: '768x1024', width: 768, height: 1024 },
    { name: '375x812', width: 375, height: 812 },
  ]) {
    test(`the list and the dialogs are clean at ${size.name} with no sideways scroll`, async ({
      asUser,
      seed,
    }) => {
      const { username, userId } = await seed.user(['Data Technician'], `abs-axe-${size.width}`);
      await seed.outOfOffice(userId, { note: 'Away' });
      const me = await asUser(username);
      await me.setViewportSize({ width: size.width, height: size.height });
      await me.goto('/profile');
      await expect(me.locator('[data-absence-list]')).toBeVisible();
      expect(await axeViolations(me)).toEqual([]);
      expect(
        await me.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
      await me.getByRole('button', { name: 'Add out of office' }).first().click();
      await expect(me.getByRole('dialog', { name: 'Add out of office' })).toBeVisible();
      expect(await axeViolations(me)).toEqual([]);
    });
  }
});
