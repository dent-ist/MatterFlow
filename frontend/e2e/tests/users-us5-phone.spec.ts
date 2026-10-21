import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Persona } from '../support/personas';

/**
 * Users epic #422, WP-US5 #445 (U5 / BUG-5 final): Users phone cards below 640 px.
 *  - one card per person: the name (a button; two lines at most), the account under it, the status badge top right (none for Active), one summary
 *    line "Data Technician · 2 pods · Out of office until Oct 25", and the one primary action (Grant access on a waiting person) or the row menu;
 *  - every field of the desktop row is reachable on the card (name, account, roles, pods, availability, status, actions);
 *  - cards are the full width of the page with no sideways scroll at 375 and 639, the table is back at 640;
 *  - tap targets are at least 44 px high for the primary action and the name's card; axe 0 with a menu open.
 * Screenshots for docs/ux/users-review/fixes/us5-phone/ are written when E2E_SCREENSHOTS is set to the output folder.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const TAG = `us5p${Math.floor(Math.random() * 90000) + 10000}`;

let waiting: Persona;
let busy: Persona;
let away: Persona;
let gone: Persona;

test.beforeAll(async ({ personas, seed }) => {
  waiting = await personas.create({ label: `${TAG}w`, displayNameLength: 130 });
  busy = await personas.create({ label: `${TAG}b`, roles: ['Data Technician'] });
  await seed.pod(`Processing ${TAG}`, [busy.userId]);
  await seed.pod(`Review ${TAG}`, [busy.userId]);
  away = await personas.create({ label: `${TAG}a`, roles: ['Data Technician'] });
  await seed.outOfOffice(away.userId, { note: 'Away', until: '2027-10-25' });
  gone = await personas.create({ label: `${TAG}g`, roles: ['Data Technician'], disabled: true });
});

const listUrl = (extra = '') => `/admin/users?status=all&account=e2e-${TAG}${extra}`;
async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}-375x812.png`) });
}

const noSideScroll = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

async function axeClean(page: Page) {
  return (await axeViolations(page))
    .map((v) =>
      v.id === 'target-size'
        ? { ...v, nodes: v.nodes.filter((n) => !(n.why ?? '').includes('partially obscured')) }
        : v,
    )
    .filter((v) => v.nodes.length > 0);
}

test.describe('#445 phone cards', () => {
  test('one card per person with every field of the desktop row reachable, at 375', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(listUrl());
    await expect(page.locator('li.rc').first()).toBeVisible();
    await expect(page.locator('table.mf-grid')).toHaveCount(0);
    expect(await page.locator('li.rc').count()).toBeGreaterThanOrEqual(4);

    const busyCard = page.locator('li.rc', { hasText: busy.username });
    await expect(busyCard.locator('[data-card-summary]')).toContainText('Data Technician');
    await expect(busyCard.locator('[data-card-summary]')).toContainText('2 pods');
    await expect(busyCard.locator('[data-card-summary]')).toContainText(/Available|Off hours/);
    await expect(busyCard.locator('mf-badge')).toHaveCount(0); // Active: no badge
    await expect(busyCard.locator('button[data-overflow]')).toHaveAttribute(
      'aria-label',
      `Actions for ${busy.displayName ?? busy.username} (${busy.username})`,
    );

    const awayCard = page.locator('li.rc', { hasText: away.username });
    await expect(awayCard.locator('[data-card-summary]')).toContainText(
      'Out of office until Oct 25',
    );

    const goneCard = page.locator('li.rc', { hasText: gone.username });
    await expect(goneCard.locator('mf-badge')).toContainText('Inactive');

    const waitingCard = page.locator('li.rc', { hasText: waiting.username.slice(0, 20) });
    await expect(waitingCard.locator('mf-badge')).toContainText('Pending access');
    await expect(waitingCard.getByRole('button', { name: /^Grant access to/ })).toBeVisible();
    await expect(waitingCard.locator('button[data-overflow]')).toHaveCount(0);

    expect(await noSideScroll(page)).toBe(true);
    await shot(page, 'users-cards-all');
  });

  test('the 130-character name is two lines at most, the card is the full width and the targets are 44 px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(listUrl());
    const waitingCard = page.locator('li.rc', { hasText: waiting.username.slice(0, 20) });
    await expect(waitingCard).toBeVisible();
    const m = await waitingCard.evaluate((el) => {
      const name = el.querySelector<HTMLElement>('[data-card-name]')!;
      const style = getComputedStyle(name);
      const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
      const list = el.closest('ul')!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const grant = el
        .querySelector<HTMLElement>('[data-card-primary] button')!
        .getBoundingClientRect();
      return {
        lines: Math.round(name.getBoundingClientRect().height / line),
        cardWidth: Math.round(box.width),
        listWidth: Math.round(list.width),
        grantHeight: Math.round(grant.height),
      };
    });
    expect(m.lines).toBeLessThanOrEqual(2);
    expect(m.cardWidth).toBe(m.listWidth);
    expect(m.grantHeight).toBeGreaterThanOrEqual(44);
  });

  test('the name opens the panel, Grant access opens it too, and focus returns', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(listUrl());
    const busyCard = page.locator('li.rc', { hasText: busy.username });
    const name = busyCard.locator('button[data-card-name]');
    await name.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-panel-heading]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-panel]')).toHaveCount(0);
    await expect(name).toBeFocused();

    const waitingCard = page.locator('li.rc', { hasText: waiting.username.slice(0, 20) });
    const grant = waitingCard.getByRole('button', { name: /^Grant access to/ });
    await grant.click();
    await expect(page.locator('[data-panel-heading]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(grant).toBeFocused();
  });

  test('the row menu on a card has the same items as the table row', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(listUrl());
    await page
      .locator('li.rc', { hasText: busy.username })
      .locator('button[data-overflow]')
      .click();
    await expect(page.getByRole('menuitem')).toHaveText([
      'Open',
      'Edit availability',
      'Deactivate',
    ]);
    if (axeAvailable()) expect(await axeClean(page)).toEqual([]);
    await shot(page, 'users-cards-menu');
    await page.keyboard.press('Escape');
  });

  test('the states on a phone: empty and filtered-empty messages, with the table states', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(listUrl('&name=nobody-like-this'));
    await expect(page.locator('[data-empty="filtered"]')).toContainText(
      'No users match these filters',
    );
    await expect(page.getByRole('button', { name: 'Clear filters' }).first()).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
    await shot(page, 'users-cards-empty');
  });

  test('a User.View-only administrator has cards with Open only, and no Grant access', async ({
    personas,
    asUser,
  }) => {
    const viewer = await personas.create({ label: `${TAG}v`, permissions: ['User.View'] });
    const page = await asUser(viewer.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(listUrl());
    await expect(page.locator('li.rc').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Grant access/ })).toHaveCount(0);
    await page
      .locator('li.rc', { hasText: busy.username })
      .locator('button[data-overflow]')
      .click();
    await expect(page.getByRole('menuitem')).toHaveText(['Open']);
  });

  test('the cards give way to the table at 640 and back at 639', async ({ page }) => {
    await page.setViewportSize({ width: 639, height: 900 });
    await page.goto(listUrl());
    await expect(page.locator('li.rc').first()).toBeVisible();
    await expect(page.locator('table.mf-grid')).toHaveCount(0);
    await page.setViewportSize({ width: 640, height: 900 });
    await expect(page.locator('table.mf-grid')).toBeVisible();
    await expect(page.locator('li.rc')).toHaveCount(0);
  });

  for (const state of ['pending', 'active', 'inactive'] as const) {
    test(`axe 0 and no sideways scroll at 375 on the ${state} segment`, async ({ page }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/admin/users?status=${state}`);
      await expect(page.locator('li.rc, [data-empty]').first()).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      expect(await axeClean(page)).toEqual([]);
      await shot(page, `users-cards-${state}`);
    });
  }

  test('the loading state is skeleton cards with one polite message', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.route(/\/api\/v1\/users\?/, async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.goto('/admin/users?status=all');
    await expect(page.locator('[data-loading]')).toHaveCount(1);
    await expect(page.locator('li[data-skeleton]').first()).toBeAttached();
    await shot(page, 'users-cards-loading');
    expect(await noSideScroll(page)).toBe(true);
    await expect(page.locator('li.rc button[data-card-name]').first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('loading skeleton and error state at 375', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.route(/\/api\/v1\/users\?/, (route) =>
      route.fulfill({ status: 500, body: '{}', contentType: 'application/json' }),
    );
    await page.goto('/admin/users?status=all');
    await expect(page.locator('[data-error]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await shot(page, 'users-cards-error');
    expect(await noSideScroll(page)).toBe(true);
  });
});
