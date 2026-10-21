import { Page } from '@playwright/test';
import { axeAvailable } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { atEverySize } from '../support/screens';

/**
 * S12 / S12a (#610): on arrival the 403 and the 404 put focus on their one H1 (a link, a guard denial and a reload all end there), and the
 * disabled-account page says "Your account is disabled" once, as the heading, then what to do.
 */
const FORBIDDEN = "You don't have permission to view this.";
const NOT_FOUND = "We couldn't find that.";

const focusedHeading = (page: Page) => page.locator('h1:focus');

test.describe('Focus lands on the heading of the 403 and the 404 (#610)', () => {
  test.setTimeout(300_000);

  test('a guard denial, a reload and an in-app link put focus on the 403 heading; Back leaves the page alone', async ({
    personas,
    asUser,
  }) => {
    const tech = await personas.named('technician');
    const page = await asUser(tech.username);
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();

    // An address typed or followed in the app: the router goes to the guard, the guard denies.
    await page.evaluate(() => {
      history.pushState({}, '', '/admin/users');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeFocused();

    await page.reload();
    await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeFocused();

    // Back to the list: the 403 heading no longer holds focus (the list's own rules apply), and nothing throws.
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
    await expect(focusedHeading(page).filter({ hasText: FORBIDDEN })).toHaveCount(0);
  });

  test('the 404 takes focus on arrival by address and by link, and a screen reader reads the heading', async ({
    page,
  }) => {
    await page.goto('/no-such-page');
    const h1 = page.getByRole('heading', { name: NOT_FOUND, level: 1 });
    await expect(h1).toBeFocused();
    // The heading is the first thing the next Tab leaves: "Go to ..." comes after it.
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-back-link]')).toBeFocused();

    await page.goto('/tasks');
    await page.evaluate(() => {
      history.pushState({}, '', '/also-missing');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: NOT_FOUND, level: 1 })).toBeFocused();
  });

  test('permission variants: every kind of person who reaches a 403 or a 404 lands with focus on the heading', async ({
    personas,
    asUser,
  }) => {
    const who = [
      'technician',
      'director',
      'readOnlyObserver',
      'complianceAuditor',
      'intakeCoordinator',
      'clientViewOnly',
      'taskViewOnly',
    ] as const;
    for (const key of who) {
      const person = await personas.named(key);
      const page = await asUser(person.username);
      await page.goto('/no-such-page');
      await expect(
        page.getByRole('heading', { name: NOT_FOUND, level: 1 }),
        `${key} 404`,
      ).toBeFocused();
      await page.goto('/admin/task-types');
      await expect(
        page.getByRole('heading', { name: FORBIDDEN, level: 1 }),
        `${key} 403`,
      ).toBeFocused();
    }
    // A custom role with one View permission.
    const one = await personas.create({ label: 'oneview', permissions: ['Matter.View'] });
    const page = await asUser(one.username);
    await page.goto('/admin/task-types');
    await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeFocused();
    // A pending person has no 403: Access Pending focuses its own heading, as before.
    const pending = await personas.named('pending');
    const pendingPage = await asUser(pending.username);
    await pendingPage.goto('/');
    await expect(
      pendingPage.getByRole('heading', { name: 'Your access is pending', level: 1 }),
    ).toBeFocused();
  });

  test('axe is clean on the focused 403 and 404 at four sizes', async ({
    personas,
    asUser,
    page,
  }) => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    await page.goto('/no-such-page');
    await expect(focusedHeading(page)).toHaveCount(1);
    await atEverySize(page, 'focus-404', async () => {
      await page.goto('/no-such-page');
      await expect(focusedHeading(page)).toHaveCount(1);
    });
    const tech = await personas.named('technician');
    const techPage = await asUser(tech.username);
    await atEverySize(techPage, 'focus-403', async () => {
      await techPage.goto('/admin/users');
      await expect(techPage.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeFocused();
    });
  });
});

test.describe('The disabled-account page says things once (#610)', () => {
  test.setTimeout(300_000);

  test('the heading says it, the sentence says what to do', async ({ personas, asUser }) => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    const disabled = await personas.named('disabled');
    const page = await asUser(disabled.username);
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Your account is disabled', level: 1 }),
    ).toBeFocused();
    const text = ((await page.locator('main.mf-pending').textContent()) ?? '').replace(/\s+/g, ' ');
    expect(text.match(/account is disabled/gi)).toHaveLength(1);
    expect(text).toContain('Contact the administrator to have it enabled again.');
    await atEverySize(page, 'disabled-page');
  });
});
