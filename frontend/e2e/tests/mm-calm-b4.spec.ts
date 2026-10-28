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
 *  - #899 the Client and Role filters share one label style and plain wording;
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
      ['trends', 'Weeks shown', ['8 weeks', '12 weeks', '26 weeks']],
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
    // Deadlines: List / Calendar sit behind Options and are the same component.
    await page.goto('/my-matters?tab=deadlines');
    await page.locator('[data-panel=deadlines-tab] [data-options-trigger]').click();
    const view = page.locator('[role=group][aria-label="Show deadlines as"]');
    await expect(view).toHaveClass(/mf-seg/);
    expect(await view.locator('button').allInnerTexts()).toEqual(['List', 'Calendar']);
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
    const options = page.locator('[data-panel=attention] [data-options-trigger]');
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
      for (const tab of ['', '?tab=breakdown', '?tab=trends']) {
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
    const row = a.closest('li') ?? a;
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
      const visibleRows = await page
        .locator('[data-attention-item]')
        .evaluateAll(
          (rows) => rows.filter((r) => r.getBoundingClientRect().bottom <= innerHeight).length,
        );
      expect(visibleRows, 'task rows fully on the first screen').toBeGreaterThanOrEqual(2);
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
      if (axeAvailable()) expect(await axeViolations(page), 'header menu open at 375').toEqual([]);
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
      // The strip is one row of at most four chips plus the muted count; it does not wrap.
      const strip = await page.locator('[data-mm-strip]').boundingBox();
      expect(strip!.height).toBeLessThanOrEqual(48);
      await expect(page.locator('[data-mm-strip] .ms__chip:visible')).toHaveCount(4);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      if (name === 'three matters') {
        expect(
          await page.evaluate(() => document.documentElement.scrollHeight),
        ).toBeLessThanOrEqual(2400);
      }
    });
  }

  test('375x812: a long matter name wraps and the client name under it never overlaps it', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4long');
    // A matter whose name wraps to two lines on a phone (the case batch 3 found overlapping the client's name).
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
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/my-matters');
    await settled(page);
    const rows = page.locator('[data-health-row]');
    await expect(rows.first()).toBeVisible();
    let wrapped = 0;
    for (const row of await rows.all()) {
      const link = await row.locator('[data-matter-link]').boundingBox();
      if (link!.height > 50) wrapped++;
      const client = row.locator('[data-client]');
      if ((await client.count()) === 0) continue;
      const c = await client.boundingBox();
      expect(c!.y, 'the client name starts below the matter name').toBeGreaterThanOrEqual(
        link!.y + link!.height - 1,
      );
    }
    expect(wrapped, 'the fixture has a matter name that wraps on a phone').toBeGreaterThan(0);
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
    await page.goto('/my-matters');
    await expect(page.locator('[data-page-error]')).toHaveCount(1);
    await expect(page.locator('[data-page-error]')).toContainText("Couldn't load My Matters.");
    await expect(retries(page)).toHaveCount(1);
    expect(await page.locator('[data-panel-notloaded]').count()).toBeGreaterThanOrEqual(3);
    await expect(page.locator('[data-panel-error], [data-strip-error]')).toHaveCount(0);
    if (axeAvailable()) expect(await axeViolations(page), 'with the banner').toEqual([]);
    await page.unroute('**/api/v1/my-matters/**');
    await retries(page).click();
    await expect(page.locator('[data-page-error]')).toHaveCount(0);
    await expect(page.locator('[data-attention-item]').first()).toBeVisible();
    await expect(page.locator('[data-mm-strip] .ms__chip').first()).toBeVisible();
  });

  test('one section failing keeps its own message and Retry, no banner; a strip failure does not move the tabs', async ({
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
    await expect(page.locator('[data-strip-error]')).toHaveCount(1);
    await expect(page.locator('[data-page-error]')).toHaveCount(0);
    await expect(retries(page)).toHaveCount(1);
    expect((await page.locator('#mm-tab-overview').boundingBox())!.y).toBe(tabsY);
    await page.unroute('**/api/v1/my-matters/summary*');
    await fail(page, '**/api/v1/my-matters/attention*');
    await page.reload();
    await expect(page.locator('[data-panel=attention] [data-panel-error]')).toHaveCount(1);
    await expect(page.locator('[data-panel=attention] [data-panel-retry]')).toBeVisible();
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
    // While a list is still loading it shows no toolbar (no Options, no View all).
    await page.route('**/api/v1/my-matters/attention*', async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await expect(page.locator('[data-panel=attention] [data-loading]')).toHaveCount(1);
    await expect(page.locator('[data-panel=attention] mf-options-menu')).toHaveCount(0);
    await expect(page.locator('[data-panel=attention] [data-view-all]')).toHaveCount(0);
    await expect(page.locator('[data-attention-item]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-panel=attention] mf-options-menu')).toHaveCount(1);
  });
});

test.describe('Client and Role filters (#899)', () => {
  test('one label style, equal heights, plain wording "I am: Primary or secondary / Primary / Secondary"', async ({
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
    const style = (sel: string) =>
      bar.locator(sel).evaluate((el) => {
        const s = getComputedStyle(el);
        return `${s.fontSize}/${s.fontWeight}/${s.color}`;
      });
    const client = await style('label[for=mm-client]');
    const role = await style('label[for=mm-role]');
    expect(role, 'Role has the label style of Client').toBe(client);
    await expect(bar.locator('label[for=mm-role]')).toHaveText('I am');
    expect(await bar.locator('#mm-role option').allInnerTexts()).toEqual([
      'Primary or secondary',
      'Primary',
      'Secondary',
    ]);
    const h = async (sel: string) => Math.round((await bar.locator(sel).boundingBox())!.height);
    expect(await h('#mm-client')).toBe(await h('#mm-role'));
    // The Dates control of the Deadlines tab uses the same label style.
    await page.goto('/my-matters?tab=deadlines');
    const dates = await page.locator('label[for=mm-range]').evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.fontSize}/${s.fontWeight}/${s.color}`;
    });
    expect(dates).toBe(client);
  });

  test('1920x1080: the filters and the strip share one line; 1366x768: they stack', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4f2');
    const page = await asUser(p.pm.username);
    const top = async () => {
      await page.goto('/my-matters');
      await settled(page);
      const b = (await page.locator('[data-mm-filters]').boundingBox())!;
      const s = (await page.locator('[data-mm-strip]').boundingBox())!;
      return { b, s };
    };
    await page.setViewportSize({ width: 1920, height: 1080 });
    const wide = await top();
    expect(Math.abs(wide.b.y + wide.b.height / 2 - (wide.s.y + wide.s.height / 2))).toBeLessThan(
      24,
    );
    await page.setViewportSize({ width: 1366, height: 768 });
    const narrow = await top();
    expect(narrow.s.y).toBeGreaterThanOrEqual(narrow.b.y + narrow.b.height - 1);
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

test.describe('The same right-hand pattern in every list (#901)', () => {
  const soonDay = (): string => new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

  test('Needs my attention and Next 7 days have the same two columns, who then when, aligned; the time text is the coloured one', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4r1');
    // A task that is assigned and due in 3 days: Next 7 days lists it (an unassigned one is listed under Needs my attention instead).
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
    // And one that nobody holds, due in 2 days: it is listed under Needs my attention with "No assignee" in the assignee column.
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
    const attention = page.locator('[data-attention-item]').first();
    await expect(attention).toBeVisible();
    const cols = async (row: typeof attention) => ({
      who: (await row.locator('[data-row-who]').boundingBox())!,
      when: (await row.locator('[data-fact]').boundingBox())!,
    });
    const color = (loc: ReturnType<typeof page.locator>) =>
      loc.evaluate((e) => getComputedStyle(e).color);
    const a = await cols(attention);
    const whoColour = await color(attention.locator('[data-row-who]'));
    expect(a.who.x + a.who.width).toBeLessThanOrEqual(a.when.x + 1);
    // Who is muted, never coloured; the time text is the one coloured element (red for overdue).
    expect(await color(attention.locator('[data-fact]'))).not.toBe(whoColour);
    await expect(attention.locator('[data-row-who]')).toHaveText('No assignee');
    // An unassigned task's reason is its assignee column; its time text is the day it is due ("due Sat Oct 31").
    const unassigned = page.locator('[data-reason=unassigned]').first();
    await expect(unassigned.locator('[data-row-who]')).toHaveText('No assignee');
    await expect(unassigned.locator('[data-fact]')).toHaveText(
      /^due [A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$|^ASAP$/,
    );
    // Next 7 days has the same two columns as Needs my attention, in the same places: who, then when (here the due day).
    const deadline = page.locator('[data-deadlines-list] li').first();
    await expect(deadline).toBeVisible();
    const d = await cols(deadline);
    expect(Math.abs(a.who.x - d.who.x), 'who is one column').toBeLessThan(1.5);
    expect(Math.abs(a.when.x - d.when.x), 'when is one column').toBeLessThan(1.5);
    expect(Math.abs(a.when.x + a.when.width - (d.when.x + d.when.width))).toBeLessThan(1.5);
    await expect(deadline.locator('[data-row-who]')).not.toHaveText('No assignee');
    expect(await color(deadline.locator('[data-row-who]'))).toBe(whoColour);
    await expect(deadline.locator('[data-fact]')).toHaveText(
      /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$/,
    );
    // The Deadlines tab uses the same row: the same two columns (the tab's list sits in its own box, so only the widths are compared).
    await page.goto('/my-matters?tab=deadlines');
    const tabRow = page.locator('[data-panel=deadlines-tab] [data-deadline-row]').first();
    await expect(tabRow).toBeVisible();
    const row = tabRow.locator('xpath=ancestor::li[1]');
    const t = await cols(row);
    expect(Math.abs(a.who.width - t.who.width)).toBeLessThan(1.5);
    expect(Math.abs(a.when.width - t.when.width)).toBeLessThan(1.5);
    expect(await color(row.locator('[data-row-who]'))).toBe(whoColour);
    await expect(row.locator('[data-fact]')).toHaveText(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$/);
  });

  test('375x812: the phone card keeps the order, who then when', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4r2');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/my-matters');
    await settled(page);
    const row = page.locator('[data-attention-item]').first();
    const who = (await row.locator('[data-row-who]').boundingBox())!;
    const when = (await row.locator('[data-fact]').boundingBox())!;
    expect(who.y).toBeLessThanOrEqual(when.y + 1);
    if (Math.abs(who.y - when.y) < 4) expect(who.x).toBeLessThan(when.x);
    expect(await firstTaskRowTop(page)).toBeLessThanOrEqual(420);
  });
});

test.describe('Clear sort (#898)', () => {
  test('Needs my attention names its order; the Task Queue says what comes first instead of an arrow, and Priority is Critical first', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b4s1');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    await expect(page.locator('[data-attention-list]')).toHaveAttribute(
      'aria-label',
      'Needs my attention, most urgent first',
    );
    await expect(page.locator('[data-panel=attention] h2')).toHaveAttribute(
      'title',
      /^Most urgent first/,
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
