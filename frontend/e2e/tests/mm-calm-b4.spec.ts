import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { openHeaderOptions } from '../support/mm-header';
import { pmSolo, pmThree } from '../support/pm-fixtures';
import { SIZES } from '../support/screens';

/**
 * My Matters, a calmer page: batch 4 of epic #893 (Release 2, "Calm details").
 *
 *  - #919 one toggle pattern (the scope switch and the tab toggles share one component, one look, one keyboard behaviour);
 *  - #922 the phone's first screen shows tasks (the first task row within 420 px at 375x812);
 *  - #921 one error banner and one Retry per page; a skeleton without toolbars;
 *  - #899 the Role filter has plain wording; Client and Matter have no visible label (#941) and the same height;
 *  - #898 plain sort labels and the server's Priority order;
 *  - #901 the same right-hand detail pattern in every list.
 */
const settled = async (page: Page): Promise<void> => {
  await expect(page.locator('#mm-tab-overview')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-mm-tabpanel] >> text=/^Loading /')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
};

test.describe('One toggle pattern (#919)', () => {
  test('the scope switch is a segmented toggle: same height as the controls, a check mark on the pressed button, one Tab stop, arrow keys', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4a');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    // The scope switch is inside the title row's one Options menu (issue #900).
    await openHeaderOptions(page);
    const group = page.locator('[data-scope-switch]');
    await expect(group).toHaveAttribute('aria-label', 'Scope');
    const mine = group.locator('[data-scope=mine]');
    const all = group.locator('[data-scope=all]');
    await expect(mine).toHaveAttribute('aria-pressed', 'true');
    // The pressed state is not colour alone: a check mark before its words.
    const tick = (b: typeof mine) =>
      b.evaluate((el) => getComputedStyle(el, '::before').content.replace(/"/g, ''));
    expect(await tick(mine)).toBe('✓');
    expect(await tick(all)).toBe('none');
    // Same height as the other controls of the page header (32 px at this width).
    const heights = await group
      .locator('button')
      .evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)));
    expect(heights).toEqual([32, 32]);
    // One Tab stop: only the pressed button is in the Tab order; arrows move the focus, Enter presses.
    await expect(mine).toHaveAttribute('tabindex', '0');
    await expect(all).toHaveAttribute('tabindex', '-1');
    await mine.focus();
    await page.keyboard.press('ArrowRight');
    await expect(all).toBeFocused();
    await expect(mine).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/scope=all/);
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(all).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('Tab');
    expect(await group.evaluate((g) => g.contains(document.activeElement))).toBe(false);
  });

  test('the tab toggles use the same pattern and plain words, and no two controls of a tab share a label', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4b');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    for (const [tab, group, words] of [
      ['breakdown', 'Matters shown', ['By matter', 'All together']],
    ] as const) {
      await page.goto(`/my-matters?tab=${tab}`);
      const g = page.locator(`[role=group][aria-label="${group}"]`);
      await expect(g).toBeVisible();
      await expect(g).toHaveClass(/mf-seg/);
      expect(await g.locator('button').allInnerTexts()).toEqual(words.map((w) => w));
      await expect(g.locator('button[aria-pressed=true]')).toHaveCount(1);
    }
    // "All matters" belongs to the scope switch only.
    await page.goto('/my-matters?tab=breakdown');
    await openHeaderOptions(page);
    await expect(page.getByRole('button', { name: 'All matters', exact: true })).toHaveCount(1);
    // The Calendar is one icon button on the Overview (not a toggle group): "Show calendar" there, "Show list" on the Calendar view.
    await page.goto('/my-matters');
    await expect(page.getByRole('button', { name: 'Show calendar', exact: true })).toHaveCount(1);
    await page.goto('/my-matters?view=calendar');
    await expect(page.getByRole('button', { name: 'Show list', exact: true })).toHaveCount(1);
  });

  test('the title row has one Options menu, built like every other Options button, and the Focus is inside it', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmSolo(seed, personas, 'b4c');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    // No Focus button of its own: one Options button in the title row (issue #900).
    await expect(page.locator('[data-header-options] [data-options-trigger]')).toHaveCount(1);
    await expect(
      page.locator('mf-page-header').getByRole('button', { name: /^Focus/ }),
    ).toHaveCount(0);
    const header = page.locator('[data-header-options] [data-options-trigger]');
    await expect(header).toContainText('Options');
    expect(await header.evaluate((e) => Math.round(e.getBoundingClientRect().height))).toBe(32);
    const options = page.locator('[data-panel=tasks] [data-options-trigger]');
    expect(
      await options.evaluate((e) => Math.round(e.getBoundingClientRect().height)),
    ).toBeLessThanOrEqual(32);
    expect(await header.evaluate((e) => getComputedStyle(e).borderRadius)).toBe(
      await options.evaluate((e) => getComputedStyle(e).borderRadius),
    );
    await header.click();
    await expect(page.locator('[data-header-options] [data-focus-inline]')).toBeVisible();
  });

  for (const size of SIZES) {
    test(`axe is clean at ${size.width}x${size.height} with the toggles on screen`, async ({
      seed,
      personas,
      asUser,
    }) => {
      expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
      const p = await pmThree(seed, personas, `b4x${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize(size);
      for (const tab of ['', '?tab=breakdown']) {
        await page.goto(`/my-matters${tab}`);
        await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
        expect(await axeViolations(page), `${tab || 'overview'} at ${size.width}`).toEqual([]);
      }
    });
  }
});

const firstTaskRowTop = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const a = document.querySelector('[data-mm-tabpanel] a[href^="/tasks/"]')!;
    const row = a.closest('tr, li') ?? a;
    return Math.round(row.getBoundingClientRect().top + window.scrollY);
  });

test.describe('Phone first screen (#922)', () => {
  for (const [name, make] of [
    ['one matter', pmSolo],
    ['three matters', pmThree],
  ] as const) {
    test(`375x812, ${name}: the first task row is within 420 px, two rows are on the first screen, every target is 44 px, nothing scrolls sideways`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const p = await make(seed, personas, name === 'one matter' ? 'b4p1' : 'b4p3');
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/my-matters');
      await settled(page);
      expect(await firstTaskRowTop(page)).toBeLessThanOrEqual(420);
      // The shared table is cards on a phone (issue #929), taller than the old one-line rows: the first card is whole on the first screen.
      const visibleRows = await page
        .locator('[data-panel=tasks] li[data-task]')
        .evaluateAll(
          (rows) => rows.filter((r) => r.getBoundingClientRect().bottom <= innerHeight).length,
        );
      expect(visibleRows, 'task cards fully on the first screen').toBeGreaterThanOrEqual(1);
      // One title row: the title and one Options menu (Filters beside it only when there is something to filter).
      const header = await page.locator('[data-page-actions]').boundingBox();
      const title = await page.locator('[data-page-title]').boundingBox();
      expect(Math.abs(header!.y - title!.y)).toBeLessThan(4);
      await expect(page.locator('[data-header-options] [data-options-trigger]')).toBeVisible();
      // The scope, the Focus and New task are inside that menu, not rows of their own.
      await expect(page.locator('main [data-scope-switch]')).toBeHidden();
      await page.locator('[data-header-options] [data-options-trigger]').click();
      await expect(page.locator('[data-header-options] [data-scope-switch]')).toBeVisible();
      await expect(page.locator('[data-header-options] [data-focus-inline]')).toBeVisible();
      // The open menu lies over the first cards: axe reads their links as partly covered, so the menu itself is what is checked here.
      if (axeAvailable())
        expect(
          await axeViolations(page, '[data-header-options]'),
          'header menu open at 375',
        ).toEqual([]);
      await page.keyboard.press('Escape');
      // Every control of the first screen is a 44 px target.
      const small = await page.evaluate(() => {
        const out: string[] = [];
        for (const e of document.querySelectorAll<HTMLElement>(
          'main a[href], main button, main summary, main select, main input',
        )) {
          const r = e.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || getComputedStyle(e).visibility === 'hidden')
            continue;
          if (e.closest('details:not([open])') && e.tagName !== 'SUMMARY') continue;
          if (e.closest('[data-skip-links]')) continue;
          if (r.top < innerHeight && r.height < 43.5)
            out.push(`${e.tagName} ${e.textContent?.trim().slice(0, 20)} ${Math.round(r.height)}`);
        }
        return out;
      });
      expect(small).toEqual([]);
      // The pre-filter dropdown is on the first screen and is a 44 px target (the tiles are gone, #942).
      await expect(page.locator('[data-mm-strip], .tile')).toHaveCount(0);
      const prefilter = (await page.locator('select[data-prefilter]').boundingBox())!;
      expect(prefilter.height).toBeGreaterThanOrEqual(43.5);
      expect(prefilter.y + prefilter.height).toBeLessThanOrEqual(812);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      if (name === 'three matters') {
        // One grid and nothing under it: the page is far shorter than the two grids and the matters list were.
        expect(
          await page.evaluate(() => document.documentElement.scrollHeight),
        ).toBeLessThanOrEqual(2400);
      }
    });
  }

  test('375x812: a long matter name wraps inside its card and never widens the page', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4long');
    // A matter whose name wraps to two lines on a phone.
    const long = await seed.matter({
      client: { clientId: p.clients[0].clientId },
      number: '09999',
      name: `A matter with a very long name that cannot fit on one line of a phone ${p.token}`,
    });
    await seed.admin.put(`/api/v1/matters/${long.matterId}/managers`, {
      primaryManagerId: p.pm.userId,
      secondaryManagerId: null,
      rowVersion: long.rowVersion,
    });
    await seed.task(
      {
        matter: { matterId: long.matterId },
        taskType: p.world.taskType,
        workflow: p.world.workflow,
      },
      { title: `On the long matter ${p.token}`, dueDate: '2000-01-01' },
    );
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/my-matters');
    await settled(page);
    const card = page.locator('[data-panel=tasks] li[data-task]', {
      hasText: `On the long matter ${p.token}`,
    });
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    expect(box.x + box.width, 'the card is inside the screen').toBeLessThanOrEqual(376);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});

test.describe('Loading and error (#921)', () => {
  const fail = (page: Page, glob: string): Promise<void> =>
    page.route(glob, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Server error', status: 500, traceId: 'trace-b4' }),
      }),
    );
  const retries = (page: Page) =>
    page.locator('main button:visible').filter({ hasText: /^\s*Retry\s*$/ });

  test('every call failing: one banner, one Retry, a muted "not loaded" line in each section; Retry reloads them all', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4e1');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await fail(page, '**/api/v1/my-matters/**');
    await fail(page, '**/api/v1/task-queue*'); // the grid asks the Task Queue (#929, #943)
    await page.goto('/my-matters');
    await expect(page.locator('[data-page-error]')).toHaveCount(1);
    await expect(page.locator('[data-page-error]')).toContainText("Couldn't load My Matters.");
    await expect(retries(page)).toHaveCount(1);
    expect(await page.locator('[data-panel-notloaded]').count()).toBeGreaterThanOrEqual(1);
    await expect(
      page.locator('[data-panel-error], [data-prefilter-error], [data-prefilter-retry]'),
    ).toHaveCount(0);
    if (axeAvailable()) expect(await axeViolations(page), 'with the banner').toEqual([]);
    await page.unroute('**/api/v1/my-matters/**');
    await page.unroute('**/api/v1/task-queue*');
    await retries(page).click();
    await expect(page.locator('[data-page-error]')).toHaveCount(0);
    await expect(page.locator('[data-panel=tasks] tr[data-task]').first()).toBeVisible();
    await expect(page.locator('select[data-prefilter]')).toBeVisible();
    await expect(page.locator('option[data-prefilter-option=open]')).toHaveText(/\(\d+\)\s*$/);
  });

  test('one request failing keeps its own message and Retry, no banner; a failure of the counts does not move the tabs', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4e2');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    const tabsY = (await page.locator('#mm-tab-overview').boundingBox())!.y;
    await fail(page, '**/api/v1/my-matters/summary*');
    await page.reload();
    await expect(page.locator('[data-prefilter-error]')).toHaveCount(1);
    // The dropdown still works without numbers.
    await expect(page.locator('select[data-prefilter]')).toBeVisible();
    await expect(page.locator('[data-page-error]')).toHaveCount(0);
    await expect(retries(page)).toHaveCount(1);
    expect((await page.locator('#mm-tab-overview').boundingBox())!.y).toBe(tabsY);
    await page.unroute('**/api/v1/my-matters/summary*');
    // Only the grid's request fails: that section alone says so, and the counts above it are left alone.
    await page.route(
      (url) => url.pathname.endsWith('/api/v1/task-queue'),
      (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: JSON.stringify({ title: 'Server error', status: 500, traceId: 'trace-b4' }),
        }),
    );
    await page.reload();
    await expect(page.locator('[data-panel=tasks] [data-panel-error]')).toHaveCount(1);
    await expect(page.locator('[data-panel=tasks] [data-panel-retry]')).toBeVisible();
    await expect(page.locator('[data-page-error]')).toHaveCount(0);
  });

  test('loading: a skeleton without toolbars, and the page does not jump when the data arrive (layout shift under 0.05)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4e3');
    const page = await asUser(p.pm.username);
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number; __shifts: string[] };
      w.__cls = 0;
      w.__shifts = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
          startTime: number;
          sources: { node?: Element; previousRect: DOMRect; currentRect: DOMRect }[];
        }[])
          if (!e.hadRecentInput) {
            w.__cls += e.value;
            w.__shifts.push(
              `${e.value.toFixed(3)}@${Math.round(e.startTime)}ms ` +
                e.sources
                  .map(
                    (s) =>
                      `${s.node?.nodeName}.${String((s.node as HTMLElement | undefined)?.className ?? '').slice(0, 24)} y ${Math.round(s.previousRect.y)}->${Math.round(s.currentRect.y)}`,
                  )
                  .join('; '),
            );
          }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    for (const size of [
      { width: 1366, height: 768 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(size);
      await page.goto('/my-matters');
      await settled(page);
      await page.waitForTimeout(1000);
      const { cls, shifts } = await page.evaluate(() => {
        const w = window as unknown as { __cls: number; __shifts: string[] };
        return { cls: w.__cls, shifts: w.__shifts };
      });
      expect(cls, `layout shift at ${size.width}: ${shifts.join(' | ')}`).toBeLessThan(0.05);
    }
    // While the grid is still loading it shows no toolbar (no Options, no Urgency).
    await page.route('**/api/v1/task-queue*', async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await expect(page.locator('[data-panel=tasks] [data-loading]')).toHaveCount(1);
    await expect(page.locator('[data-panel=tasks] mf-options-menu')).toHaveCount(0);
    await expect(page.locator('[data-panel=tasks] [data-sort-urgency]')).toHaveCount(0);
    await expect(page.locator('[data-panel=tasks] tr[data-task]').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-panel=tasks] mf-options-menu')).toHaveCount(1);
  });
});

test.describe('Client and Role filters (#899)', () => {
  test('Client and Matter have no visible label and one height; Role keeps its label and plain wording "I am: Primary or secondary / Primary / Secondary"', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4f1');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    const bar = page.locator('[data-mm-filters]');
    await expect(bar).toBeVisible();
    await expect(bar.locator('label[for=mm-client], label[for=mm-matter]')).toHaveCount(0);
    await expect(bar.locator('#mm-client')).toHaveAccessibleName('Client');
    await expect(bar.locator('#mm-matter')).toHaveAccessibleName('Matter');
    await expect(bar.locator('#mm-client')).toHaveValue('All clients');
    await expect(bar.locator('#mm-matter')).toHaveValue('All matters');
    await expect(bar.locator('label[for=mm-role]')).toHaveText('I am');
    expect(await bar.locator('#mm-role option').allInnerTexts()).toEqual([
      'Primary or secondary',
      'Primary',
      'Secondary',
    ]);
    const h = async (sel: string) => Math.round((await bar.locator(sel).boundingBox())!.height);
    expect(await h('#mm-client')).toBe(await h('#mm-role'));
    expect(await h('#mm-matter')).toBe(await h('#mm-role'));
    // The Client and Matter dropdowns are side by side (same line).
    const client = (await bar.locator('#mm-client').boundingBox())!;
    const matter = (await bar.locator('#mm-matter').boundingBox())!;
    expect(Math.abs(client.y - matter.y)).toBeLessThan(2);
    expect(matter.x).toBeGreaterThan(client.x + client.width - 1);
  });

  test('the Matter dropdown narrows to the chosen client, and choosing a client clears a matter of another client', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4f2');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/my-matters?clientId=${p.clients[0].clientId}`);
    await settled(page);
    await page.locator('#mm-matter').click();
    const names = await page.locator('#mm-matter-list [role=option]').allInnerTexts();
    expect(names[0]).toBe('All matters');
    expect(names.length, 'one matter of that client (and the way back to all)').toBe(2);
    await page.locator('#mm-matter-list [role=option]').nth(1).click();
    await expect(page).toHaveURL(/matterId=/);
    // A client choice of another client clears the matter.
    await page.locator('#mm-client').click();
    await page
      .locator('#mm-client-list [role=option]')
      .filter({ hasText: p.clients[1].name })
      .click();
    await expect(page).toHaveURL(new RegExp(`clientId=${p.clients[1].clientId}`));
    await expect(page).not.toHaveURL(/matterId=/);
    await expect(page.locator('#mm-matter')).toHaveValue('All matters');
  });

  test('375x812: a filter in force is a removable chip, so the closed Filters sheet still says what the page is filtered by', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4f3');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/my-matters?role=primary&clientId=${p.clients[0].clientId}`);
    await settled(page);
    const chips = page.locator('[data-active-filters] li');
    await expect(chips).toHaveCount(2);
    await expect(page.locator('[data-active-filter=role]')).toContainText('I am: Primary');
    await expect(page.locator('[data-active-filter=client]')).toContainText(
      `Client: ${p.clients[0].clientNumber} ${p.clients[0].name}`,
    );
    for (const x of await page.locator('[data-active-filters] button').all()) {
      expect((await x.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator('[data-filters-open]')).toContainText('Filters (2)');
    // The Matter filter is a chip too.
    await page.goto(`/my-matters?matterId=${p.matters[0].matterId}`);
    await settled(page);
    await expect(page.locator('[data-active-filter=matter]')).toContainText(
      `Matter: ${p.matters[0].matterRef} ${p.matters[0].name}`,
    );
    await page.goto(`/my-matters?role=primary&clientId=${p.clients[0].clientId}`);
    await settled(page);
    await page.locator('[data-active-filter=role] button').click();
    await expect(page).not.toHaveURL(/role=/);
    await expect(page.locator('[data-active-filters] li')).toHaveCount(1);
    await page.locator('[data-active-filter=client] button').click();
    await expect(page.locator('[data-active-filters]')).toHaveCount(0);
    expect(await firstTaskRowTop(page)).toBeLessThanOrEqual(420);
  });

  for (const size of SIZES) {
    test(`axe is clean at ${size.width}x${size.height} with the filters in force`, async ({
      seed,
      personas,
      asUser,
    }) => {
      expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
      const p = await pmThree(seed, personas, `b4fx${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize(size);
      await page.goto(`/my-matters?role=secondary`);
      await settled(page);
      expect(await axeViolations(page), `at ${size.width}`).toEqual([]);
    });
  }
});

test.describe('The columns of the grid (#901, #929, #943)', () => {
  const soonDay = (): string => new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

  test('the grid has the Tasks columns; Unassigned is said in the Assignee column; the holder is named; the Due cell says overdue', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4r1');
    // A task that is assigned and due in 3 days.
    const tech = await seed.user(['Data Technician'], 'b4r1tech');
    const pod = await seed.pod(`B4 pod ${p.token}`, [tech.userId]);
    await seed.task(
      {
        matter: { matterId: p.matters[0].matterId },
        taskType: p.world.taskType,
        workflow: p.world.workflow,
      },
      {
        title: `Soon ${p.token}`,
        dueDate: soonDay(),
        assignedUserId: tech.userId,
        assignedPodId: pod['podId'],
      },
    );
    // And one that nobody holds, due in 2 days: "Unassigned" in the assignee column.
    await seed.task(
      {
        matter: { matterId: p.matters[1].matterId },
        taskType: p.world.taskType,
        workflow: p.world.workflow,
      },
      {
        title: `Nobody ${p.token}`,
        dueDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      },
    );
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    const grid = page.locator('[data-panel=tasks]');
    await expect(grid.locator('tr[data-task]').first()).toBeVisible();
    expect(
      await grid
        .locator('thead th')
        .evaluateAll((ths) => ths.map((t) => t.getAttribute('data-col'))),
    ).toEqual(['ref', 'title', 'matterName', 'priority', 'assignee', 'due', 'status']);
    // The first row is overdue (urgency order); its Due cell says so.
    await expect(grid.locator('tr[data-task]').first().locator('td[data-col=due]')).toContainText(
      /overdue/i,
    );
    await expect(
      grid
        .locator('tr[data-task]', { hasText: `Nobody ${p.token}` })
        .locator('td[data-col=assignee]'),
    ).toContainText('Unassigned');
    await expect(
      grid
        .locator('tr[data-task]', { hasText: `Soon ${p.token}` })
        .locator('td[data-col=assignee]'),
    ).not.toContainText('Unassigned');
  });

  test('375x812: the phone shows cards, the first task is within 420 px', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4r2');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/my-matters');
    await settled(page);
    await expect(page.locator('[data-panel=tasks] table')).toHaveCount(0);
    await expect(page.locator('[data-panel=tasks] li[data-task]').first()).toBeVisible();
    expect(await firstTaskRowTop(page)).toBeLessThanOrEqual(420);
  });
});

test.describe('Clear sort (#898)', () => {
  test('The grid names its order in its heading; the Task Queue says what comes first instead of an arrow, and Priority is Critical first', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4s1');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    // The default order is Urgency (issue #935): the Urgency control is pressed, no column heading is marked, and the heading's tooltip names the order.
    await expect(page.locator('[data-panel=tasks] [data-sort-urgency]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-panel=tasks] th[data-col=due]')).toHaveAttribute(
      'aria-sort',
      'none',
    );
    await expect(page.locator('[data-panel=tasks] h2')).toHaveAttribute(
      'title',
      /Most urgent first/,
    );
    // No Sort control and no arrow button remain on the page.
    await expect(page.locator('[data-sort], [data-sort-dir], [data-dir-select]')).toHaveCount(0);

    await page.goto('/tasks');
    await expect(page.locator('.mf-pager [data-sort-note]')).toContainText(
      'Sorted by Priority, most urgent first (default order)',
    );
    await page.goto('/tasks?sort=priority&dir=desc');
    await expect(page.locator('.mf-pager [data-sort-note]')).toContainText(
      'Sorted by Priority, least urgent first',
    );
    await page.goto('/tasks?sort=due&dir=asc');
    await expect(page.locator('.mf-pager [data-sort-note]')).toContainText(
      'Sorted by Due date, soonest first',
    );
    await expect(
      page.locator(
        '.mf-pager [data-sort-note] .pi-sort-amount-down, .mf-pager [data-sort-note] .pi-sort-amount-up-alt',
      ),
    ).toHaveCount(0);
  });
});
