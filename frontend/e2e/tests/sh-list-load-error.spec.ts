import { expect, test } from '../support/fixtures';
import { failApi } from '../support/personas';
import { atEverySize, shot } from '../support/screens';
import { toasts } from '../support/toasts';

/**
 * S15 (#613): a failed list load is shown once, inline, with the Reference, Copy and Retry on every list, and no toast for it: the toast stays
 * for actions. The same shared list state on Task Queue, My Work, Pod Work, Clients, Matters and Projects.
 */
const PAGES = [
  { name: 'Task Queue', path: '/tasks', api: /\/api\/v1\/task-queue\?/, noun: 'tasks' },
  { name: 'My Work', path: '/my-work', api: /\/api\/v1\/my-work\?/, noun: 'tasks' },
  { name: 'Pod Work', path: '/pods/work', api: /\/api\/v1\/pod-work\?/, noun: 'tasks' },
  { name: 'Clients', path: '/clients', api: /\/api\/v1\/clients\?/, noun: 'clients' },
  { name: 'Matters', path: '/matters', api: /\/api\/v1\/matters\?/, noun: 'matters' },
  { name: 'Projects', path: '/projects', api: /\/api\/v1\/projects\?/, noun: 'projects' },
] as const;

test.describe('A failed list load is shown once, inline (#613)', () => {
  test.setTimeout(480_000);

  for (const p of PAGES) {
    test(`${p.name}: "Couldn't load ${p.noun}." with the Reference, Copy and Retry, no toast, and Retry reads the list again`, async ({
      page,
    }) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.setViewportSize({ width: 1366, height: 768 });
      const unfail = await failApi(page, p.api, 500);
      await page.goto(p.path);
      const alert = page.getByRole('alert').filter({ hasText: `Couldn't load ${p.noun}.` });
      await expect(alert).toHaveCount(1);
      await expect(alert).toContainText('Reference:');
      await expect(alert).toContainText('e2e-500-trace');
      await expect(alert.getByRole('button', { name: /Copy/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
      // The toast would have come after the held 400 ms and shows for 8 seconds: neither the first nor the later one exists.
      await page.waitForTimeout(1500);
      await expect(toasts(page)).toHaveCount(0);
      await shot(page, `list-error-${p.name.replace(/ /g, '-').toLowerCase()}`);

      await alert.getByRole('button', { name: /Copy/ }).focus();
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('e2e-500-trace');

      await unfail();
      await page.getByRole('button', { name: 'Retry' }).click();
      await expect(page.getByText(`Couldn't load ${p.noun}.`)).toHaveCount(0);
      await expect(toasts(page)).toHaveCount(0);
    });
  }

  test('a forbidden list is one inline message and no toast either', async ({ page }) => {
    await failApi(page, /\/api\/v1\/clients\?/, 403);
    await page.goto('/clients');
    await expect(page.getByText("You don't have access to clients.")).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(toasts(page)).toHaveCount(0);
  });

  test('an action that fails still toasts (saving a change is not a page load)', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Toast stays ${Date.now()}` });
    await failApi(page, /\/api\/v1\/clients\/\d+$/, 500, { method: 'PUT' });
    await page.goto(`/clients/${client.clientId}/edit`);
    const name = page.getByRole('textbox', { name: /Client name/ });
    await name.fill(`Renamed ${Date.now()}`);
    await page.getByRole('button', { name: /^Save/ }).first().click();
    await expect(toasts(page).first()).toBeVisible();
  });

  test('axe is clean with the inline error on the lists at four sizes', async ({ page }) => {
    for (const p of [PAGES[0], PAGES[3]]) {
      const unfail = await failApi(page, p.api, 500);
      await page.goto(p.path);
      await expect(
        page.getByRole('alert').filter({ hasText: `Couldn't load ${p.noun}.` }),
      ).toHaveCount(1);
      await atEverySize(page, `list-error-axe-${p.name.replace(/ /g, '-').toLowerCase()}`);
      await unfail();
    }
  });
});
