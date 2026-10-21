import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Persona } from '../support/personas';

/**
 * Users epic #422, WP-US7 #452 (U14): "Skip to table" is the first Tab stop and lands on the first row, one Tab stop for the name and one for the
 * action of a row, accessible names with the Windows account. The Tab-stop counts of the page are measured with real Tab presses and written to
 * `tab-stops.json` (recorded, never gated) in the folder E2E_SCREENSHOTS names (docs/ux/users-review/fixes/us7-keyboard/).
 * No keyboard shortcut is added or changed: the skip link, focus order and the row menu's own arrows are the standard ones.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const TAG = `us7k${Math.floor(Math.random() * 90000) + 10000}`;

/** What the review measured on the nine-column grid (docs/ux/users-review/README.md, section 5), for the before / after table. */
const BEFORE = { stopsBeforeFirstRow: 33, stopsPerRow: 3, stopsPerPageOf25: 75 };

let waiting: Persona;
let member: Persona;

test.beforeAll(async ({ personas }) => {
  waiting = await personas.create({ label: `${TAG}w`, displayName: `Wanda ${TAG}` });
  member = await personas.create({ label: `${TAG}m`, roles: ['Data Technician'] });
});

const listUrl = (extra = '') => `/admin/users?status=all${extra}`;
const skipLink = (page: Page) => page.getByRole('link', { name: 'Skip to table' });
/** The name of each person: the table's name button, below 640 px the card's. */
const names = (page: Page) =>
  page.locator('tbody tr[data-user] button[data-open], li.rc button[data-card-name]');

/** Presses Tab until `target` has focus; the number of presses, or -1 after `max`. */
async function tabsUntil(page: Page, target: Locator, max = 400): Promise<number> {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return i;
  }
  return -1;
}

async function atTop(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(
    page.locator('tbody tr[data-user] button[data-open], li.rc button[data-card-name]').first(),
  ).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test.describe('#452 Skip to table', () => {
  test("is the first Tab stop, visible on focus, and Enter lands on the name of the first row; the next Tab is that row's action", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await atTop(page, listUrl(`&account=e2e-${TAG}`));
    await page.keyboard.press('Tab');
    await expect(skipLink(page)).toBeFocused();
    const box = await skipLink(page).boundingBox();
    expect(box && box.width > 0 && box.height > 0, 'visible when focused').toBe(true);
    await page.keyboard.press('Enter');
    await expect(names(page).first()).toBeFocused();
    // The next stop is the pods button (a person who may assign pods) and then the row's one action: Grant access or the row menu.
    const row = page.locator('tbody tr[data-user]').first();
    const action = row.locator('[data-grant] button, button[data-overflow]').first();
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('Tab');
      if (await action.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(action).toBeFocused();
  });

  test('lands on the empty message when nobody is listed', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(listUrl('&name=nobody-like-this-at-all'));
    await expect(page.locator('td[data-empty="filtered"]')).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Tab');
    await skipLink(page).press('Enter');
    // On the message, or on the Clear filters button inside it.
    await expect(page.locator('td[data-empty] :focus, td[data-empty]:focus')).toHaveCount(1);
  });

  test('is not offered to a person who cannot see the list', async ({ personas, asUser }) => {
    const other = await personas.named('taskViewOnly');
    const page = await asUser(other.username);
    await page.goto(listUrl());
    await expect(skipLink(page)).toHaveCount(0);
  });
});

test.describe('#452 one Tab stop per control', () => {
  test('a row has one stop for the name and one for the action; the names carry the account', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(listUrl(`&account=e2e-${TAG}`));
    const waitingRow = page.locator(`tr[data-user="${waiting.userId}"]`);
    const memberRow = page.locator(`tr[data-user="${member.userId}"]`);
    await expect(
      waitingRow.getByRole('button', { name: `Open Wanda ${TAG} (${waiting.username})` }),
    ).toBeVisible();
    await expect(
      waitingRow.getByRole('button', {
        name: `Grant access to Wanda ${TAG} (${waiting.username})`,
      }),
    ).toBeVisible();
    await expect(
      memberRow.getByRole('button', {
        name: `Open ${member.displayName ?? member.username} (${member.username})`,
      }),
    ).toBeVisible();
    await expect(
      memberRow.getByRole('button', {
        name: `Actions for ${member.displayName ?? member.username} (${member.username})`,
      }),
    ).toBeVisible();
  });

  test('the Tab-stop counts, recorded', async ({ page, personas, asUser }) => {
    await page.setViewportSize({ width: 1366, height: 768 });

    // Stops before the first row, without the skip link (header, search, menu, tabs, segments, filters).
    await atTop(page, listUrl());
    const beforeFirstRow = await tabsUntil(page, names(page).first());
    expect(beforeFirstRow).toBeGreaterThan(0);

    // Stops per row: from the first name to the second.
    const stopsPerRow = await tabsUntil(page, names(page).nth(1));
    expect(stopsPerRow).toBeGreaterThan(0);

    // Stops over a whole page: from the first name until focus leaves the table.
    await atTop(page, listUrl());
    await skipLink(page).focus();
    await page.keyboard.press('Enter');
    let rowsOnPage = await names(page).count();
    let stopsInTable = 0;
    for (let i = 0; i < 400; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => !!document.activeElement?.closest('#users-table tbody'),
      );
      if (!inside) break;
      stopsInTable++;
    }
    rowsOnPage = Math.min(rowsOnPage, 25);

    // The same measurement for a person who may manage users but not assign pods: the Pods cell is then text, not a button.
    const manager = await personas.named('userManageOnly');
    const managerPage = await asUser(manager.username);
    await managerPage.setViewportSize({ width: 1366, height: 768 });
    await atTop(managerPage, listUrl());
    await tabsUntil(managerPage, names(managerPage).first());
    const stopsPerRowWithoutPods = await tabsUntil(managerPage, names(managerPage).nth(1));

    const evidence = {
      page: '/admin/users (Users tab), 1366x768, status All, first page',
      measured: 'real Tab presses in Chromium (recorded, never gated)',
      before: BEFORE,
      after: {
        stopsBeforeFirstRowWithoutSkipLink: beforeFirstRow,
        stopsBeforeFirstRowWithSkipLink: 1,
        stopsPerRow,
        stopsPerRowWithoutPodAssignment: stopsPerRowWithoutPods,
        rowsOnPage,
        stopsInTableForThePage: stopsInTable + 1,
      },
    };
    test
      .info()
      .annotations.push({ type: 'tab-stops', description: JSON.stringify(evidence.after) });
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, 'tab-stops.json'), JSON.stringify(evidence, null, 2) + '\n');
    }
    // The one fact the rows must keep: no more than the name, the action and (with Pod.ManageMembers) the pods button.
    expect(stopsPerRow).toBeLessThanOrEqual(3);
    expect(stopsPerRowWithoutPods).toBe(2); // the name and the action
  });
});

test.describe('#452 axe at four widths with the skip link focused', () => {
  test.skip(!axeAvailable(), 'axe-core is not available');
  for (const [width, height] of [
    [375, 812],
    [768, 1024],
    [1366, 768],
    [1920, 1080],
  ] as const) {
    test(`axe 0 at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await atTop(page, listUrl(`&account=e2e-${TAG}`));
      await page.keyboard.press('Tab');
      await expect(skipLink(page)).toBeFocused();
      const found = (await axeViolations(page))
        .map((v) =>
          v.id === 'target-size'
            ? { ...v, nodes: v.nodes.filter((n) => !(n.why ?? '').includes('partially obscured')) }
            : v,
        )
        .filter((v) => v.nodes.length > 0);
      expect(found).toEqual([]);
      const side = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      );
      expect(side).toBe(true);
      if (OUT) {
        fs.mkdirSync(OUT, { recursive: true });
        await page.screenshot({ path: path.join(OUT, `users-skip-link-${width}x${height}.png`) });
      }
    });
  }
});
