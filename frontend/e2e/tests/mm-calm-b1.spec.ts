import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { openHeaderOptions } from '../support/mm-header';
import { mmWorld } from '../support/my-matters-fixtures';
import { pmSolo, pmThree } from '../support/pm-fixtures';
import { SIZES } from '../support/screens';

/**
 * My Matters, a calmer page: batch 1 of epic #893.
 *
 *  - #904 the title block: no description line, exactly one create-task button for a person with one matter;
 *  - #906 a filter is drawn only when it can change the result; the filter bar is the same on every tab; the Calendar is a month with Previous / Next / Today and no Dates choice (#929, #944);
 *  - #941 Client and Matter dropdowns have no visible label; a one-matter person sees neither;
 *  - #920 an empty list is one line with no toolbar; a page with nothing to show is a few lines;
 *  - #923 a long reason on a held task never squeezes the title.
 */
const TABS = ['overview', 'breakdown', 'data', 'activity'] as const;
type Tab = (typeof TABS)[number];
const url = (tab: Tab, extra = ''): string =>
  `/my-matters?${tab === 'overview' ? '' : `tab=${tab}`}${extra}`;

/** Waits until nothing on the page is loading. */
const settled = async (page: Page, tab: Tab = 'overview'): Promise<void> => {
  await expect(page.locator(`#mm-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-mm-tabpanel] >> text=/^Loading /')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
};

const noSideways = async (page: Page): Promise<void> => {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
};

/** Visible means drawn with a size (a visually hidden sentence for screen readers is 1 px). */
const drawn = (page: Page, selector: string): Promise<number> =>
  page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden';
    }).length;
  }, selector);

/** Answers "no events" to the activity calls and "nothing changed" to the since-last-visit call (setting a matter up leaves events behind). */
const nothingRecent = async (page: Page, activity = true, since = true): Promise<void> => {
  const now = new Date().toISOString();
  if (activity)
    await page.route('**/api/v1/my-matters/activity**', (route) =>
      route.fulfill({
        json: {
          timeZone: 'America/New_York',
          asOfUtc: now,
          sinceUtc: now,
          seenEventId: 0,
          latestEventId: 0,
          unreadCount: 0,
          hasMore: false,
          items: [],
        },
      }),
    );
  if (since)
    await page.route('**/api/v1/my-matters/since-last-visit**', (route) => {
      const none = { count: 0, query: '', target: 'activity' };
      return route.fulfill({
        json: {
          timeZone: 'America/New_York',
          asOfUtc: now,
          sinceUtc: now,
          hasMarker: true,
          seenEventId: 0,
          counts: {
            newTasks: none,
            completed: none,
            becameOverdue: none,
            reassigned: none,
            putOnHold: none,
            comments: none,
            newUnassigned: none,
          },
          items: [],
        },
      });
    });
};

test.describe('Title block (#904)', () => {
  for (const size of SIZES) {
    test(`one matter: no description line and exactly one create-task button at ${size.width} px`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const p = await pmSolo(seed, personas, `tb1${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      await settled(page);

      // The sentence is still there for screen readers, but nothing of it is drawn.
      await expect(page.locator('[data-page-description]')).toHaveCount(1);
      expect(await drawn(page, '[data-page-description]'), 'no description line').toBe(0);
      // One create button: the shell's. The page has none of its own.
      await expect(page.locator('[data-header-new-task]')).toHaveCount(0);
      const create = page.getByRole('button', { name: 'Create task' });
      await expect(create).toHaveCount(1);
      await expect(create).toBeVisible();
      await expect(
        page
          .locator('mf-page-header')
          .getByRole('button', { name: /New task|Matter for New task/ }),
      ).toHaveCount(0);

      await noSideways(page);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${size.width}`).toEqual([]);

      // The shell button opens Create task with the only matter filled in.
      await create.click();
      await expect(page).toHaveURL(new RegExp(`/tasks/new\\?.*matterId=${p.matters[0].matterId}`));
    });
  }

  test('several matters: the shell button plus New task and no matter chooser; no description line on any tab', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'tb3');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    for (const tab of TABS) {
      await page.goto(url(tab));
      await settled(page, tab);
      expect(await drawn(page, '[data-page-description]'), `${tab}: no description line`).toBe(0);
    }
    await page.goto('/my-matters');
    await settled(page);
    await expect(page.getByRole('button', { name: 'Create task' })).toHaveCount(1);
    const menu = page.locator('[data-header-new-task]');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: /^New task/ })).toBeVisible();
    // The chooser "Matter: ..." is gone (#941): the Matter dropdown of the filter bar is the one place a matter is chosen.
    await expect(menu).not.toContainText('Matter:');
    await expect(page.locator('#mm-matter')).toBeVisible();
    // The scope switch carries what the sentence used to say.
    await expect(page.locator('[data-scope-switch]')).toHaveAttribute(
      'title',
      /manage as primary or secondary project manager/,
    );
  });

  test('the All matters switch says in its tooltip which matters are shown', async ({
    page,
    seed,
  }) => {
    const w = await seed.world();
    await seed.task(w);
    await page.goto('/my-matters');
    const group = page.locator('[data-scope-switch]');
    await expect(group).toHaveAttribute('title', /manage as primary or secondary project manager/);
    await openHeaderOptions(page);
    await page.getByRole('button', { name: 'All matters', exact: true }).click();
    await expect(group).toHaveAttribute('title', /All active matters, whoever manages them/);
    expect(await drawn(page, '[data-page-description]')).toBe(0);
  });
});

test.describe('Filters only when they can change the result (#906)', () => {
  test('one matter: no filter bar on any of the four tabs, at any width', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.slow();
    const p = await pmSolo(seed, personas, 'fb1');
    const page = await asUser(p.pm.username);
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      for (const tab of TABS) {
        await page.goto(url(tab));
        await settled(page, tab);
        await expect(page.locator('[data-mm-filters]'), `${tab} at ${size.width}`).toHaveCount(0);
        await expect(page.locator('[data-filters-open]')).toHaveCount(0);
      }
    }
  });

  test('several clients and both roles: the bar is the same on all four tabs; there is no Dates choice anywhere', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.slow();
    const p = await pmThree(seed, personas, 'fb3');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const boxes = new Map<Tab, { x: number; y: number; width: number; height: number }>();
    for (const tab of TABS) {
      await page.goto(url(tab));
      await settled(page, tab);
      await expect(page.locator('#mm-client')).toBeVisible();
      await expect(page.locator('#mm-matter')).toBeVisible();
      await expect(page.locator('#mm-role')).toBeVisible();
      // Client and Matter have no visible label; an aria-label names them (#941).
      await expect(page.locator('label[for=mm-client], label[for=mm-matter]')).toHaveCount(0);
      await expect(page.locator('#mm-client')).toHaveAttribute('aria-label', 'Client');
      await expect(page.locator('#mm-matter')).toHaveAttribute('aria-label', 'Matter');
      const box = await page.locator('[data-mm-filters]').boundingBox();
      expect(box, `${tab}: the bar is drawn`).not.toBeNull();
      boxes.set(tab, box!);
      await expect(page.locator('#mm-range'), `${tab}: Dates`).toHaveCount(0);
    }
    const first = boxes.get('overview')!;
    for (const [tab, b] of boxes) {
      expect(b.y, `${tab}: top of the bar`).toBeCloseTo(first.y, 1);
      expect(b.height, `${tab}: height of the bar`).toBeCloseTo(first.height, 1);
      expect(b.width, `${tab}: width of the bar`).toBeCloseTo(first.width, 1);
    }
    // One Clear filters, only while a filter is in force.
    await expect(page.locator('[data-clear-filters]')).toHaveCount(0);
    await page.goto('/my-matters?role=primary');
    await settled(page);
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/role=/);
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
  });

  test('one client with only Primary matters: no Client and no Role, but the Matter dropdown (two matters); a filter in force is never hidden', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'fbo');
    const a = await w.matter('Only alpha');
    const b = await w.matter('Only beta');
    await w.task(a);
    await w.task(b);
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    await expect(page.locator('#mm-client')).toHaveCount(0);
    await expect(page.locator('#mm-role')).toHaveCount(0);
    await expect(page.locator('#mm-matter')).toBeVisible();
    // An address (or a remembered filter) that sets a role: the control comes back, so the person can see and clear it.
    await page.goto('/my-matters?role=secondary');
    await settled(page);
    await expect(page.locator('#mm-role')).toHaveValue('secondary');
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.locator('#mm-role')).toHaveCount(0);
    await expect(page.locator('#mm-matter')).toBeVisible();
  });

  test('the Calendar is a month: Previous, Next and Today change it, and there is no Dates choice (#944)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmSolo(seed, personas, 'dts');
    const page = await asUser(p.pm.username);
    await page.goto('/my-matters?view=calendar');
    await settled(page);
    await expect(page.locator('[data-panel=calendar]')).toBeVisible();
    await expect(
      page.locator('#mm-range, [data-mm-dates], [data-mm-tabpanel] [data-range]'),
    ).toHaveCount(0);
    const title = page.locator('[data-cal-month]');
    const before = (await title.textContent())!.trim();
    await expect(page.locator('[data-cal-today]')).toBeDisabled();
    await page.locator('[data-cal-next]').click();
    await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
    await expect(title).not.toHaveText(before);
    await expect(page.locator('[data-cal-today]')).toBeEnabled();
    await page.locator('[data-cal-today]').click();
    await expect(title).toHaveText(before);
    await expect(page).not.toHaveURL(/month=/);
    // The old range addresses are no filters any more.
    await page.goto('/my-matters?range=2w');
    await settled(page);
    await expect(page.locator('#mm-range')).toHaveCount(0);
    await expect(page.locator('[data-mm-filters]')).toHaveCount(0);
  });

  for (const size of SIZES) {
    test(`the bar is clean (axe, no sideways scroll) with several clients at ${size.width} px`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const p = await pmThree(seed, personas, `fba${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      await settled(page);
      if (size.width < 640) {
        await page.locator('[data-filters-open]').click();
        await expect(
          page.getByRole('dialog', { name: 'Filters' }).locator('#mm-client'),
        ).toBeVisible();
        await expect(
          page.getByRole('dialog', { name: 'Filters' }).locator('#mm-matter'),
        ).toBeVisible();
        await expect(
          page.getByRole('dialog', { name: 'Filters' }).locator('#mm-role'),
        ).toBeVisible();
      } else {
        await expect(page.locator('#mm-client')).toBeVisible();
        await expect(page.locator('#mm-matter')).toBeVisible();
      }
      await noSideways(page);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${size.width}`).toEqual([]);
    });
  }
});

test.describe('Empty states are one line (#920)', () => {
  for (const size of SIZES) {
    test(`a manager with no matter: the Overview is a few lines, no toolbars, no card at ${size.width} px`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const w = await mmWorld(seed, personas, `em${size.width}`);
      const page = await asUser(w.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      await settled(page);
      await expect(page.locator('[data-no-matters]')).toBeVisible();
      // Nothing but the message: no Views / Export / Sort / Task types controls, no dropdown of counts.
      await expect(page.locator('[data-prefilter]')).toHaveCount(0);
      for (const hidden of ['tasks', 'activity', 'since']) {
        await expect(page.locator(`[data-panel=${hidden}]`)).toBeHidden();
      }
      const panel = await page.locator('[data-mm-tabpanel]').boundingBox();
      expect(panel!.height, 'the Overview content is shorter than 300 px').toBeLessThan(300);
      expect(await drawn(page, '[data-mm-tabpanel] select'), 'no select').toBe(0);
      expect(
        await page.getByRole('button', { name: 'Clear filters' }).count(),
        'at most one Clear filters',
      ).toBeLessThanOrEqual(1);
      await noSideways(page);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${size.width}`).toEqual([]);
    });
  }

  test('filters that match nothing: one line, one Clear filters (in the bar), and the page is short', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'emf');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    // The three-matter person is Primary of two and Secondary of one; a client with none of their matters matches nothing.
    const other = await seed.client({ name: `Nobody client ${p.token}` });
    await page.goto(`/my-matters?clientId=${other.clientId}`);
    await settled(page);
    await expect(page.locator('[data-panel=tasks] [data-empty]')).toContainText('No open tasks.');
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(1);
    await expect(page.locator('[data-prefilter]')).toHaveCount(0);
    expect(await drawn(page, '[data-mm-tabpanel] [data-views], [data-mm-tabpanel] select')).toBe(0);
    const panel = await page.locator('[data-mm-tabpanel]').boundingBox();
    expect(panel!.height).toBeLessThan(300);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.locator('[data-panel=tasks] a.wt-title').first()).toBeVisible();
  });

  test('a manager with matters but no work and nothing recent: the grid is one line, with the Calendar button and no toolbar', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'emq');
    await w.matter('Quiet matter');
    await w.matter('Quiet matter two');
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    // Setting up the matter left events behind (a manager was named): the page is quiet when there are none.
    await nothingRecent(page);
    await page.goto('/my-matters');
    await settled(page);
    const panel = page.locator('[data-panel=tasks]');
    await expect(panel.locator('[data-empty]')).toHaveText('No open tasks.');
    expect(await panel.locator('table, select, mf-options-menu, [data-sort-urgency]').count()).toBe(
      0,
    );
    await expect(panel.locator('[data-calendar-toggle]')).toBeVisible();
    // No Matters section (#945) and no Recent activity on the Overview (#909).
    await expect(page.locator('[data-panel=health], [data-panel=activity]')).toHaveCount(0);
  });

  test('a person with work: ONE grid, one heading, and a dropdown of counts above it, with no section that has nothing in it (#943)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ems');
    const a = await w.matter('Some work');
    await w.task(a, { dueDate: '2000-01-01' }); // overdue
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    await expect(page.locator('[data-panel]')).toHaveCount(1);
    await expect(page.locator('[data-panel=tasks] a.wt-title')).toHaveCount(1);
    await expect(page.locator('[data-prefilter]')).toBeVisible();
    await expect(page.locator('[data-all-quiet]')).toHaveCount(0);
  });

  test('every tab says it in one line when there is nothing, and draws no controls of its own', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.slow();
    const w = await mmWorld(seed, personas, 'emt');
    await w.matter('No work at all');
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await nothingRecent(page, true, false);
    for (const tab of ['breakdown', 'data', 'activity'] as const) {
      await page.goto(url(tab));
      await settled(page, tab);
      await expect(page.locator('[data-mm-tabpanel] [data-empty]'), tab).toBeVisible();
      expect(
        await drawn(page, '[data-mm-tabpanel] select, [data-mm-tabpanel] input'),
        `${tab}: no controls`,
      ).toBe(0);
      const panel = await page.locator('[data-mm-tabpanel]').boundingBox();
      expect(panel!.height, `${tab}: short`).toBeLessThan(200);
    }
    // The Calendar keeps its month buttons (another month can show something) and says so in one line.
    await page.goto('/my-matters?view=calendar');
    await settled(page);
    await expect(page.locator('[data-panel=calendar] [data-empty]')).toBeVisible();
    await expect(page.locator('[data-cal-prev], [data-cal-next], [data-cal-today]')).toHaveCount(3);
    expect(await drawn(page, '[data-mm-tabpanel] select, [data-mm-tabpanel] input')).toBe(0);
  });
});

test.describe('The held row keeps its title (#923)', () => {
  for (const size of [
    { width: 320, height: 640 },
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
  ]) {
    test(`a 60-character hold reason does not squeeze the title at ${size.width} px`, async ({
      seed,
      personas,
      asUser,
      admin,
    }) => {
      test.skip(!process.env['E2E_SQL_CONTAINER'], 'needs the SQL container to age the hold');
      const w = await mmWorld(seed, personas, `sq${size.width}`);
      const a = await w.matter('Squeeze alpha');
      const reasonName =
        `Waiting for the other side ${Date.now().toString(36)} ${size.width}`.padEnd(60, 'x');
      const created = await admin.post('/api/v1/on-hold-reasons', { name: reasonName });
      const task = await w.task(a, { title: 'Relativity Workspace Setup' });
      await admin.post(`/api/v1/tasks/${task.taskId}/status`, {
        status: 'ON_HOLD',
        comment: 'Waiting',
        onHoldReasonId: created.id ?? created.onHoldReasonId,
        rowVersion: task.rowVersion,
      });
      seed.sql(
        `UPDATE dbo.Task SET StatusChangedAt = DATEADD(DAY, -9, SYSUTCDATETIME()) WHERE TaskId = ${Number(task.taskId)}`,
      );
      const page = await asUser(w.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      await settled(page);
      const group = page.locator('[data-panel=tasks] [data-task]').first();
      await expect(group).toBeVisible();
      const link = group.locator('a.wt-title').first();
      // The grid shows the reference in its own column; the title link is the title.
      await expect(link).toContainText('Relativity Workspace Setup');
      await expect(group).toContainText(task.taskNumber);
      const wide = await link.evaluate((el) => {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        return {
          width: el.getBoundingClientRect().width,
          chars: el.getBoundingClientRect().width / (fs * 0.55),
        };
      });
      expect(
        wide.chars,
        `the title is at least 12 characters wide (${wide.width}px)`,
      ).toBeGreaterThanOrEqual(12);
      // The shared Status cell says the task is on hold (the reason is its hold note), and the title keeps its room.
      await expect(group).toContainText(/On Hold/i);
      // One matter: its name is not repeated on the row.
      await expect(group.locator('td[data-col=matterName]')).toHaveCount(0);
      await noSideways(page);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${size.width}`).toEqual([]);
    });
  }
});
