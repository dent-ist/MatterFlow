import { ApiError } from '../support/api';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { ClientFormPage, MatterFormPage } from '../pages/organization.pages';

test.describe('Client and matter numbering (SCN-001, SCN-002, SCN-003)', () => {
  test('SCN-001: a client number typed without padding is saved zero padded', async ({
    page,
    seed,
  }) => {
    const padded = await seed.freeClientNumber(true);
    const typed = String(Number(padded));
    const form = new ClientFormPage(page);
    await form.open();
    await form.number.fill(typed);
    await expect(page.locator('[data-preview]')).toContainText(`Will be saved as ${padded}`);
    await form.name.fill(`E2E Client ${uid()}`);
    await form.save.click();

    await expect(page).toHaveURL(/\/clients\/\d+$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(padded);
  });

  test('SCN-001: a second client with the same number is rejected and only one row exists', async ({
    page,
    seed,
    admin,
  }) => {
    const existing = await seed.client();
    const form = new ClientFormPage(page);
    await form.open();
    await form.create(existing.clientNumber, 'Duplicate Holder');

    await expect(form.summary).toContainText(/already|exists|in use/i);
    await expect(
      form.summary.getByRole('link', { name: 'View the existing client' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/clients\/new$/);

    const found = await admin.get(`/api/v1/clients?q=${existing.clientNumber}`);
    expect(
      found.items.filter((c: { clientNumber: string }) => c.clientNumber === existing.clientNumber),
    ).toHaveLength(1);
  });

  test('SCN-001: the API refuses a duplicate number, also in its unpadded form, with DUPLICATE_NUMBER', async ({
    seed,
    admin,
  }) => {
    const padded = await seed.freeClientNumber(true);
    await seed.client({ number: padded });
    for (const attempt of [padded, String(Number(padded))]) {
      const result = await admin.raw('POST', '/api/v1/clients', {
        clientNumber: attempt,
        name: 'Other',
      });
      expect(result.status).toBe(409);
      expect(result.body.code).toBe('DUPLICATE_NUMBER');
    }
  });

  test('client numbers must be one to five digits', async ({ page }) => {
    const form = new ClientFormPage(page);
    await form.open();
    await form.fill('123456', 'Too long');
    await form.save.click();
    await expect(form.numberError).toHaveText(/Use at most 5 digits\./);

    await form.number.fill('12ab');
    await form.save.click();
    await expect(form.numberError).toHaveText(/Use digits only\./);
    await expect(page).toHaveURL(/\/clients\/new$/);
  });

  test('SCN-002: the same matter number under two clients gives two different references', async ({
    page,
    seed,
  }) => {
    const first = await seed.client();
    const second = await seed.client();
    const form = new MatterFormPage(page);

    await form.open();
    await form.create(first.clientNumber, '1', `Matter ${uid()}`);
    await expect(form.heading()).toContainText(`${first.clientNumber}-00001`);

    await form.open();
    await form.create(second.clientNumber, '1', `Matter ${uid()}`);
    await expect(form.heading()).toContainText(`${second.clientNumber}-00001`);
  });

  test('SCN-003: a duplicate matter number inside one client is rejected', async ({
    page,
    seed,
    admin,
  }) => {
    const client = await seed.client();
    const matter = await seed.matter({ client, number: '00001' });
    const form = new MatterFormPage(page);

    await form.open();
    await form.create(client.clientNumber, '1', `Another ${uid()}`);

    await expect(form.summary).toContainText(/already|exists|in use/i);
    await expect(page).toHaveURL(/\/matters\/new$/);

    const result = await admin.raw('POST', '/api/v1/matters', {
      clientId: client.clientId,
      matterNumber: '1',
      name: 'Dup',
      isSensitive: false,
    });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('DUPLICATE_NUMBER');
    const list = await admin.get(`/api/v1/matters?q=${matter.matterRef}`);
    expect(list.items).toHaveLength(1);
  });

  test('a matter can be found by its combined number written without padding', async ({
    seed,
    admin,
  }) => {
    const client = await seed.client({ number: await seed.freeClientNumber(true) });
    const matter = await seed.matter({ client, number: '00012' });
    const typed = `${Number(client.clientNumber)}-12`;
    const found = await admin.get(`/api/v1/matters/lookup?ref=${typed}`);
    expect(found.matterId).toBe(matter.matterId);
    await expect(admin.get('/api/v1/matters/lookup?ref=99999-99999')).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
