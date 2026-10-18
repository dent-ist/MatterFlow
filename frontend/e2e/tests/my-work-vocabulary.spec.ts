import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * One vocabulary and the tab rules of My Work (WP5a): the tab names, tooltips and URL values (M5, #171), the Due soon and overdue order
 * (D1, #154), the Closed window and "Show older" as an all-time state (C4, #187), the info button and the empty copy (D4/D6, #188), and the
 * title, caption and live region naming the tab (M8, #161). Every test uses its own user and tagged tasks, so nothing depends on global
 * counts. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/my-work-review/fixes/wp5a).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

test.describe('My Work vocabulary and tab rules', () => {
  test('M5, D1, M8: the tab names, the Due soon and overdue order, the title, caption and live region', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'vocab');
    const world = await seed.world();
    const tag = uid();
    const make = (name: string, offset: number | null, extra: Record<string, unknown> = {}) =>
      seed.task(world, {
        title: `${name} ${tag}`,
        assignedUserId: me.userId,
        ...(offset === null ? {} : { dueDate: dateInZone(FIRM_ZONE, offset) }),
        ...extra,
      });
    // Created in a shuffled order on purpose.
    await make('Tomorrow', 1);
    await make('Over1', -1);
    await make('Asap', null);
    await make('Over13', -13);
    await make('Today', 0);
    await make('Over5', -5);
    await make('Far', 40);

    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open();

    // Tab names, counts and tooltips.
    await expect(myWork.tab(/^Active/)).toContainText('(7)');
    const tabs = (await page.getByRole('tab').allTextContents()).map((t) =>
      t.replace(/\s+/g, ' ').trim(),
    );
    expect(tabs).toEqual([
      'Active (7)',
      'Due soon and overdue (5)',
      'Closed (0)',
      'Created by me (0)',
    ]);
    await expect(myWork.tab(/^Active/)).toHaveAttribute('title', 'Open tasks assigned to you');
    await expect(myWork.tab(/^Due soon and overdue/)).toHaveAttribute(
      'title',
      'Overdue plus due in the next 2 days. ASAP tasks have no due date and are listed under Active',
    );
    await expect(myWork.tab(/^Closed/)).toHaveAttribute(
      'title',
      'Completed or cancelled in the last 90 days (use Show older for more)',
    );
    await expect(myWork.tab(/^Created by me/)).toHaveAttribute(
      'title',
      'Tasks you created, any status or assignee',
    );

    // Title, caption and live region on Active, then after a tab change without a reload.
    await expect(page).toHaveTitle('My Work: Active - MatterFlow');
    await expect(page.locator('table caption')).toHaveText('My Work: Active');
    await expect(page.locator('.wl-sr')).toHaveText(/^Active: 7 tasks, showing 1 to 7$/);

    await myWork.tab(/^Due soon and overdue/).click();
    await expect(page).toHaveURL(/view=dueSoon/);
    await expect(page).toHaveTitle('My Work: Due soon and overdue - MatterFlow');
    await expect(page.locator('table caption')).toHaveText('My Work: Due soon and overdue');
    await expect(page.locator('.wl-sr')).toHaveText(
      /^Due soon and overdue: 5 tasks, showing 1 to 5$/,
    );

    // D1: overdue first (oldest due first), then the due date; ASAP and the far one are not here.
    const titles = async () =>
      (await page.locator('tbody tr[data-task]').allTextContents()).map(
        (t) => /(Over13|Over5|Over1|Today|Tomorrow|Asap|Far)/.exec(t)?.[1],
      );
    expect(await titles()).toEqual(['Over13', 'Over5', 'Over1', 'Today', 'Tomorrow']);
    await expect(page.locator('[data-sort-note]')).toContainText('Overdue first, then due date');
    await page.getByRole('button', { name: 'How the default order works' }).click();
    await expect(page.locator('[data-sort-rule]')).toContainText(
      'Default order: Overdue first, then due date, then priority',
    );
    await page.keyboard.press('Escape');

    // A header sort replaces it (and the URL says so); Reset sort returns, with `sort` absent from the URL.
    await page
      .getByRole('button', { name: /^Priority/ })
      .first()
      .click();
    await expect(page).toHaveURL(/sort=priority/);
    await expect(page.locator('[data-sort-note]')).toContainText('Sorted by Priority');
    await page.getByRole('button', { name: 'Reset sort' }).click();
    await expect(page).not.toHaveURL(/sort=/);
    expect(await titles()).toEqual(['Over13', 'Over5', 'Over1', 'Today', 'Tomorrow']);

    // Active keeps its own rule: ASAP above the dated ones of the same priority.
    await myWork.tab(/^Active/).click();
    await expect(page).toHaveTitle('My Work: Active - MatterFlow');
    await expect.poll(async () => (await titles())[0]).toBe('Asap');

    // The old link opens Closed.
    await myWork.open('?view=completed');
    await expect(myWork.tab(/^Closed/)).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveTitle('My Work: Closed - MatterFlow');
    await expect(page.locator('table caption')).toHaveText('My Work: Closed');
  });

  test('D4, D6: the help is an info button, not a paragraph; the empty states say what is true', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'empty');
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);

    await myWork.open('?view=dueSoon');
    await expect(page.locator('[data-help]')).toHaveCount(0);
    await expect(page.locator('tbody')).toContainText(
      'Nothing is overdue and nothing is due in the next 2 days.',
    );
    const about = page.getByRole('button', { name: 'About this tab' });
    await expect(about).toHaveAttribute('aria-expanded', 'false');
    await about.click();
    await expect(about).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-tab-help-text]')).toHaveText(
      'Overdue tasks plus tasks due in the next 2 days. ASAP tasks have no due date, so they are not here; find them under Active.',
    );
    await shot(page, 'info-button-due-soon-1366x768');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-tab-help-text]')).toHaveCount(0);

    await myWork.open('?view=completed');
    await expect(page.locator('tbody')).toContainText('No tasks were closed in the last 90 days.');
    await page.getByRole('button', { name: 'About this tab' }).click();
    await expect(page.locator('[data-tab-help-text]')).toHaveText(
      'Completed or cancelled tasks from the last 90 days. Use Show older for earlier ones.',
    );
    await shot(page, 'info-button-closed-1366x768');
  });

  test('C4: Show older is an all-time state (closed=all), removable, and an old date link keeps its date', async ({
    seed,
    asUser,
  }) => {
    test.skip(!Seeder.canWriteLegacyText(), 'needs the SQL container of run-local.sh to age tasks');
    const me = await seed.user(['Data Technician'], 'older');
    const world = await seed.world();
    const tag = uid();
    const recent = await seed.task(world, { title: `Recent ${tag}`, assignedUserId: me.userId });
    const old = await seed.task(world, { title: `Old ${tag}`, assignedUserId: me.userId });
    seed.ageTask(Number(recent['taskId']), { createdDaysAgo: 10, completedDaysAgo: 2 });
    seed.ageTask(Number(old['taskId']), { createdDaysAgo: 150, completedDaysAgo: 120 });

    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open('?view=completed');
    await expect(myWork.tab(/^Closed/)).toContainText('(1)');
    await myWork.expectListed(`Recent ${tag}`);
    await myWork.expectNotListed(`Old ${tag}`);
    await expect(page.locator('[data-filter-chips] [data-chip]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Show older' }).first().click();
    await expect(page).toHaveURL(/closed=all/);
    await expect(page).not.toHaveURL(/completedFrom/);
    await expect(myWork.tab(/^Closed/)).toContainText('(2)');
    await myWork.expectListed(`Recent ${tag}`, `Old ${tag}`);
    const chip = page.locator('[data-filter-chips] [data-chip]');
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText('Closed: all time');
    await expect(page.getByRole('button', { name: 'Show older' })).toHaveCount(0);
    await page.getByRole('button', { name: 'About this tab' }).click();
    await expect(page.locator('[data-tab-help-text]')).toContainText('all time');
    await shot(page, 'show-older-all-time-1366x768');
    await page.keyboard.press('Escape');

    // Another tab leaves the flag behind; coming back is the 90-day window again.
    await myWork.tab(/^Active/).click();
    await expect(page).not.toHaveURL(/closed=/);
    await myWork.open('?view=completed&closed=all');
    await chip.getByRole('button').click();
    await expect(page).not.toHaveURL(/closed=/);
    await expect(myWork.tab(/^Closed/)).toContainText('(1)');
    await myWork.expectNotListed(`Old ${tag}`);

    // An old link keeps working and shows the real date.
    await myWork.open('?view=completed&completedFrom=2000-01-01');
    await expect(myWork.tab(/^Closed/)).toContainText('(2)');
    await expect(page.locator('[data-filter-chips] [data-chip]')).toContainText(
      'Closed: from Jan 1, 2000',
    );
  });

  test('axe, no overflow and screenshots of the tab strip at 1366, 1920, 768 and 375', async ({
    seed,
    asUser,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    const me = await seed.user(['Data Technician'], 'sizes');
    const world = await seed.world();
    await seed.task(world, {
      title: `Size ${uid()}`,
      assignedUserId: me.userId,
      dueDate: dateInZone(FIRM_ZONE, -2),
    });
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      for (const view of ['dueSoon', 'completed'] as const) {
        await myWork.open(`?view=${view}`);
        await expect(page.locator('tbody')).not.toContainText('Loading');
        expect(await axeViolations(page), `${view} at ${w}`).toEqual([]);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        expect(overflow, `no horizontal page scroll at ${w}`).toBe(false);
        if (w >= 768) {
          // The four tabs fit on one line at 768 and above.
          const strip = await page
            .getByRole('tablist', { name: 'My Work views' })
            .evaluate((n) => ({
              scroll: n.scrollWidth,
              client: n.clientWidth,
            }));
          expect(strip.scroll, `tabs fit at ${w}`).toBeLessThanOrEqual(strip.client + 1);
        }
        await shot(page, `${view === 'dueSoon' ? 'due-soon-and-overdue' : 'closed'}-${w}x${h}`);
      }
    }

    // At 375 the strip scrolls inside itself and the selected tab is in view.
    await page.setViewportSize({ width: 375, height: 812 });
    await myWork.open('?view=createdByMe');
    const selected = myWork.tab(/^Created by me/);
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    const visible = await selected.evaluate((n) => {
      const strip = n.parentElement!.getBoundingClientRect();
      const box = n.getBoundingClientRect();
      return box.left >= strip.left - 1 && box.right <= strip.right + 1;
    });
    expect(visible, 'the selected tab is scrolled into view').toBe(true);
  });
});
