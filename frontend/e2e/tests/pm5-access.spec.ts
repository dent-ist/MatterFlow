import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { expect, test } from '../support/fixtures';
import { pmFixtures } from '../support/pm-fixtures';
import { SIZES, shot } from '../support/screens';
import { toasts } from '../support/toasts';

/**
 * Keyboard, axe and permission matrix for My Matters and the manager fields (epic #667, #703): Tab-stop evidence with the keys the app already
 * has (no new or changed shortcut, #420), axe at four widths with the menus and the sheet open, six kinds of people (Project Manager, a manager
 * without Task.View, a manager without Matter.AssignManagers, Director, Read-Only Observer, technician) with no dead link, no toast and no
 * refused request, and the explicit check that a matter without a manager is never a warning on any of the pages that show managers.
 */

/** What the keyboard focus is on, as a short label: tag, role and the accessible text. */
async function focusLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return 'body';
    const text =
      el.getAttribute('aria-label') ||
      (el as HTMLInputElement).labels?.[0]?.textContent ||
      el.textContent ||
      el.getAttribute('title') ||
      '';
    return `${el.tagName.toLowerCase()}: ${text.replace(/\s+/g, ' ').trim().slice(0, 60)}`;
  });
}

/** The Tab stops of the page's `main` area, from its heading on. */
async function tabStops(page: Page, max = 120): Promise<string[]> {
  await page
    .locator('main h1')
    .first()
    .evaluate((h) => {
      h.setAttribute('tabindex', '-1');
      (h as HTMLElement).focus();
    });
  const stops: string[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const inMain = await page.evaluate(() => !!document.activeElement?.closest('main'));
    if (!inMain) break;
    stops.push(await focusLabel(page));
  }
  return stops;
}

/** `expected` appear in `actual` in this order (other stops may lie between them). */
function inOrder(actual: string[], expected: RegExp[]): void {
  let at = -1;
  for (const re of expected) {
    const next = actual.findIndex((s, i) => i > at && re.test(s));
    expect(next, `Tab stop ${re} after position ${at} in\n${actual.join('\n')}`).toBeGreaterThan(
      at,
    );
    at = next;
  }
}

const FORBIDDEN_WORDS =
  /no project manager|without a (project )?manager|not managed|unmanaged|needs? a (project )?manager|missing (project )?manager|assign a (project )?manager|warning/i;

test.describe('My Matters: keyboard', () => {
  test('Tab visits the filters, the chips, the panels in reading order, the matters list and the row menu, with the keys the app already has', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'kb1');
    const a = await w.matter('Keyboard alpha');
    await w.matter('Keyboard beta', w.other, w.pm); // Secondary here: the Role filter is offered
    await w.matterInOtherClient('Keyboard gamma'); // a second client: the Client filter is offered
    await w.task(a, { dueDate: '2000-01-01', title: 'Keyboard overdue' });
    await w.task(a, { dueDate: inDays(3), title: 'Keyboard soon' });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await expect(page.locator('[data-health-row]').first()).toBeVisible();
    const stops = await tabStops(page);
    inOrder(stops, [
      /My matters/, // one Tab stop for the scope switch: the pressed button (the arrow keys reach All matters, issue #919)
      /Client/,
      /I am/,
      /^button: \d+ overdue$/,
      /^button: \d+ at risk$/,
      /^button: \d+ unassigned$/,
      /^button: \d+ on hold/,
      /^button: \d+ due in 7 days$/,
      /^button: \d+ open tasks$/,
      /View all/,
      /Options for Needs my attention/,
      /Keyboard overdue/,
      /All deadlines/,
      /How the matters are ordered/,
      /Keyboard alpha/,
      /More actions for/,
    ]);
    // Evidence for the review: the stops in order (written once per run to the test output).
    test.info().annotations.push({ type: 'tab-stops', description: stops.join(' > ') });

    // Enter on the row menu opens it, Enter on New task opens Create task with the matter; Back returns.
    await page.locator('[data-health-row] [data-row-actions] button').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: '+ New task' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks\/new\?matterId=/);
    await page.goBack();
    await expect(page.locator('[data-health-row]').first()).toBeVisible();

    // A task link from the keyboard, then Back: focus returns to the row that was left.
    const link = page.locator('[data-attention-row]').first();
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks\/\d+/);
    await page.goBack();
    await expect(page.locator('[data-attention-row]').first()).toBeFocused();

    // The info button opens and closes the rule from the keyboard and keeps focus.
    const how = page.locator('[data-how]');
    await how.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-rule]')).toBeVisible();
    await expect(how).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-rule]')).toBeHidden();
  });

  test('no new or changed shortcut: the keys the app has still do their one job and My Matters adds none', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'kb2');
    await w.matter('Shortcut alpha');
    await w.matterInOtherClient('Shortcut beta'); // a second client: the Client filter is offered
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await expect(page.locator('[data-health-row]').first()).toBeVisible();
    // Typing in a filter is typing, not a shortcut.
    await page.locator('#mm-client').fill('mg');
    await expect(page).toHaveURL(/\/my-matters$/);
    await page.locator('#mm-client').fill('');
    await page.locator('main h1').evaluate((h) => {
      h.setAttribute('tabindex', '-1');
      (h as HTMLElement).focus();
    });
    // Letters that are not in the app's list do nothing here; the existing "g" then "m" goes to My Work, as before.
    for (const key of ['x', 'q', 'p', 'a', 'r']) {
      await page.keyboard.press(key);
      await expect(page, key).toHaveURL(/\/my-matters$/);
    }
    await page.keyboard.press('g');
    await page.keyboard.press('m');
    await expect(page).toHaveURL(/\/my-work/);
  });
});

test.describe('My Matters: axe with the menus and the sheet open', () => {
  test('client and manager suggestions, the Role menu, the explanation and the filter sheet at four sizes', async ({
    seed,
    personas,
    asUser,
  }) => {
    // Twelve axe runs over the page of every matter (scope=all): 43 s on a fresh database, over a minute after three full runs left
    // their matters behind. The time limit follows the data; no assertion changes.
    test.slow();
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    const w = await mmWorld(seed, personas, 'ax1');
    const a = await w.matter('Axe alpha');
    await w.matter('Axe bravo', w.pm, w.other);
    await w.task(a, { dueDate: '2000-01-01' });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters?scope=all');
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await expect(
        page
          .locator('[data-panel=health] [data-health-row], [data-panel=health] [data-record-card]')
          .first(),
      ).toBeVisible();
      const phone = size.width < 640;
      if (phone) {
        await page.locator('[data-filters-open]').click();
        await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
      }
      // The suggestion lists of the two typeaheads.
      // Axe judges what the fixed header covers: the filters are looked at from the top of the page (a 32 px input that Playwright scrolls
      // under the header would be half covered whatever the page does).
      await page.locator('main h1').scrollIntoViewIfNeeded();
      const client = page.locator('#mm-client');
      await client.fill('E2E');
      await expect(page.getByRole('listbox').first()).toBeVisible();
      expect(await axeViolations(page), `client suggestions at ${size.width}`).toEqual([]);
      await client.fill('');
      await client.blur();
      await page.locator('main h1').scrollIntoViewIfNeeded();
      const manager = page.locator('#mm-manager');
      await manager.fill('PM');
      await expect(page.getByRole('listbox').first()).toBeVisible();
      expect(await axeViolations(page), `manager suggestions at ${size.width}`).toEqual([]);
      await manager.fill('');
      await manager.blur();
      if (phone) {
        expect(await axeViolations(page), 'filter sheet').toEqual([]);
        await shot(page, 'pm5-filter-sheet');
        await page.getByRole('button', { name: 'Show results' }).click();
        await expect(page.getByRole('dialog', { name: 'Filters' })).toBeHidden();
      }
      await page.locator('[data-how]').click();
      await expect(page.locator('[data-rule]')).toBeVisible();
      // Axe judges what a fixed header covers: look at the page from its top.
      await page.locator('main h1').scrollIntoViewIfNeeded();
      expect(await axeViolations(page), `explanation at ${size.width}`).toEqual([]);
      await page.locator('[data-how]').click();
    }
  });
});

test.describe('My Matters and the manager fields: who sees what', () => {
  /** Opens `path` as the person and returns what went wrong on the way: refused requests and toasts. */
  async function visit(
    page: Page,
    path: string,
  ): Promise<{ refused: string[]; toastCount: number }> {
    const refused: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/') && (r.status() === 401 || r.status() === 403))
        refused.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    return { refused, toastCount: await toasts(page).count() };
  }

  test('Project Manager: My Matters, My Work, and every link on the page leads somewhere the person may open', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    const { refused, toastCount } = await visit(page, '/my-matters');
    await expect(page.getByRole('heading', { name: 'My Matters', level: 1 })).toBeVisible();
    await expect(page.locator('[data-health-row]').first()).toBeVisible();
    expect(refused).toEqual([]);
    expect(toastCount).toBe(0);
    const links = await page.$$eval('main a[href^="/"]', (as) =>
      [...new Set(as.map((a) => a.getAttribute('href')!))].filter(
        (h) => !h.startsWith('/tasks/new'),
      ),
    );
    expect(links.length).toBeGreaterThan(8);
    for (const href of links.slice(0, 24)) {
      await page.goto(href);
      await expect(
        page.getByRole('heading', { name: "You don't have permission to view this.", level: 1 }),
        href,
      ).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 }).first(), href).toBeVisible();
    }
    expect(refused, 'refused requests while following the links').toEqual([]);
    expect(await toasts(page).count()).toBe(0);
    await shot(page, 'pm5-project-manager');
  });

  test('a manager without Task.View, the Director, the Observer and a technician: no My Matters item, the 403 page at the address, no request and no toast', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const tech = await personas.named('technician');
    await seed.pod(undefined, [tech.userId]);
    const people = [
      { who: fx.pmNoTask, landing: /\/matters|\/clients/ },
      { who: fx.director, landing: /\/dashboard/ },
      { who: fx.observer, landing: /\/dashboard/ },
      { who: tech, landing: /\/my-work/ },
    ];
    for (const p of people) {
      const page = await asUser(p.who.username);
      const calls: string[] = [];
      page.on('request', (r) => {
        if (r.url().includes('/api/v1/my-matters')) calls.push(r.url());
      });
      await page.goto('/');
      await expect(page, p.who.username).toHaveURL(p.landing);
      await expect(page.getByRole('link', { name: 'My Matters' })).toHaveCount(0);
      await page.goto('/my-matters');
      await expect(
        page.getByRole('heading', { name: "You don't have permission to view this.", level: 1 }),
      ).toBeVisible();
      expect(calls, p.who.username).toEqual([]);
      expect(await toasts(page).count()).toBe(0);
    }
  });

  test('a manager without Matter.AssignManagers sees My Matters but no switch, no manager filter, no Set project managers and no Select on the Matters list', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'perm3');
    const m = await w.matter('Plain manager matter');
    await w.task(m, { dueDate: '2000-01-01' });
    const plain = await personas.create({
      label: 'perm3-plain',
      permissions: [
        'Client.View',
        'Matter.View',
        'Matter.BeManager',
        'Task.View',
        'Task.Create',
        'Project.View',
      ],
    });
    await seed.admin.put(`/api/v1/matters/${m.matterId}/managers`, {
      primaryManagerId: plain.userId,
      secondaryManagerId: null,
      rowVersion: (await seed.admin.get<{ rowVersion: string }>(`/api/v1/matters/${m.matterId}`))
        .rowVersion,
    });
    const page = await asUser(plain.username);
    const { refused, toastCount } = await visit(page, '/my-matters');
    await expect(page.locator('[data-panel=health]')).toHaveCount(0); // one matter: no matters list (#908)
    await expect(page.locator('[data-scope]')).toHaveCount(0);
    expect(refused).toEqual([]);
    expect(toastCount).toBe(0);
    await page.goto('/matters');
    await expect(page.locator('[data-select-mode]')).toHaveCount(0);
    await page.goto(`/matters/${m.matterId}`);
    await expect(page.getByRole('button', { name: /Change|Add project manager/ })).toHaveCount(0);
  });

  test('a matter without a manager is never a warning: Matters list, matter header, My Matters (All scope), the strip and the panels', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const w = await mmWorld(seed, personas, 'nowarn');
    const orphan = await w.matter('Orphan matter', null, null);
    await w.task(orphan, { dueDate: '2000-01-01', title: 'Orphan overdue' });
    const checks: [string, string, string][] = [
      ['/matters?name=' + fx.token, 'Matters list', 'main'],
      [`/matters/${fx.m.none1.matterId}`, 'matter header', 'main'],
      [
        `/my-matters?scope=all&clientId=${w.world.client.clientId}`,
        'My Matters, All scope',
        'main',
      ],
      [`/tasks?matter=${orphan.matterId}`, 'Task Queue of the orphan matter', 'main'],
    ];
    for (const who of [fx.director, w.pm]) {
      const page = await asUser(who.username);
      for (const [path, label] of checks) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        const text = await page.locator('main').innerText();
        expect(text, `${label} as ${who.username}`).not.toMatch(FORBIDDEN_WORDS);
        expect(await page.locator('main [role=alert]').count(), `${label}: alerts`).toBe(0);
        expect(await toasts(page).count()).toBe(0);
      }
    }
    // Where the orphan matter shows on My Matters it counts its own overdue task and nothing else: never a warning for lacking a manager.
    const page = await asUser(w.pm.username);
    await page.goto(`/my-matters?scope=all&clientId=${w.world.client.clientId}`);
    const row = page.locator('[data-health-row]', { hasText: 'Orphan matter' });
    await expect(row).toBeVisible();
    await expect(row.locator('[data-overdue]')).toHaveText('1 overdue'); // because of its overdue task, and for no other reason
    await expect(row.locator('[data-at-risk], [data-unassigned]')).toHaveCount(1); // the task has no assignee: counted as such
    await expect(row).not.toContainText(/manager/i);
    await shot(page, 'pm5-no-manager');
  });
});
