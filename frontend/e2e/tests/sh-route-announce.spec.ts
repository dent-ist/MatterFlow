import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { noHorizontalScroll, shot, SIZES } from '../support/screens';

/**
 * S9a (#624): a polite live region says the document title after a navigation to another page, and nothing after Back; focus is not moved.
 */
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const region = (page: Page) => page.locator('[data-route-announcer]');

test.describe('Route announcement (#624)', () => {
  test('the live region says the document title after a click on the rail, and nothing after Back', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/clients');
    await expect(region(page)).toHaveAttribute('aria-live', 'polite');
    await expect(region(page)).toHaveText('');
    await nav(page).getByRole('link', { name: 'Matters', exact: true }).click();
    await expect(region(page)).toHaveText('Matters - MatterFlow');
    expect(await page.evaluate(() => document.title)).toBe('Matters - MatterFlow');
    await nav(page).getByRole('link', { name: 'Projects' }).click();
    await expect(region(page)).toHaveText('Projects - MatterFlow');
    // Focus is left to the router: the region never takes it.
    expect(
      await page.evaluate(() => document.activeElement?.closest('[data-route-announcer]')),
    ).toBeNull();

    await page.goBack();
    await expect(page).toHaveURL(/\/matters$/);
    await page.waitForTimeout(1200);
    await expect(region(page)).toHaveText('Projects - MatterFlow');
    expect(await page.evaluate(() => document.title)).toBe('Matters - MatterFlow');
  });

  test('a record announces its own name once it has loaded; a tab change (query) says nothing', async ({
    page,
    seed,
  }) => {
    const client = await seed.client();
    await page.goto('/clients');
    await page.goto(`/clients/${client.clientId}`);
    const link = page.locator('a', { hasText: 'Dashboard' }).first();
    await expect(link).toBeVisible();
    await nav(page).getByRole('link', { name: 'Matters', exact: true }).click();
    await expect(region(page)).toHaveText('Matters - MatterFlow');
    // The list is filtered to this client's own unique name: on a database with many clients it is not on the first page of /clients.
    await page.goto(`/clients?name=${encodeURIComponent(client.name as string)}&status=all`);
    await page
      .getByRole('link', { name: client.name as string })
      .first()
      .click();
    await expect(region(page)).toContainText(new RegExp(`${client.clientNumber}.*- MatterFlow`));
  });

  test('permission variants: the region is present for every person who gets the shell', async ({
    personas,
    asUser,
  }) => {
    for (const who of ['technician', 'director', 'taskViewOnly', 'clientViewOnly'] as const) {
      const person = await personas.named(who);
      const page = await asUser(person.username);
      await page.goto('/');
      await expect(region(page)).toHaveCount(1);
      // A link to the page already open does not navigate, so pick one that is not the current page.
      const others = nav(page).locator('a:not([aria-current])');
      if ((await others.count()) === 0) continue; // a person with one page has nowhere else to go
      await others.last().click();
      await expect(region(page)).toHaveText(/ - MatterFlow$/);
    }
  });

  test('axe 0 and no sideways scroll at four widths with the region filled; the region takes no space', async ({
    page,
  }) => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/clients');
      await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
      if (size.width < 640) await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await nav(page).getByRole('link', { name: 'Matters', exact: true }).click();
      await expect(region(page)).toHaveText('Matters - MatterFlow');
      const box = (await region(page).boundingBox())!;
      expect(box.width * box.height, `region size at ${size.width}`).toBeLessThanOrEqual(1);
      expect(await axeViolations(page), `announcement at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'route-announcement');
    }
  });
});
