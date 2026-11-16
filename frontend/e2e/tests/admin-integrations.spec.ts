import { Api } from '../support/api';
import { expect, test } from '../support/fixtures';
import { SIZES, atEverySize, shot } from '../support/screens';
import { toasts } from '../support/toasts';
import { Locator, Page } from '@playwright/test';

/**
 * Administration > Settings > Integrations and the Lookup button of New Client and New Matter (epic #1389, issue #1395). The stack runs with the built-in
 * Entra ID simulator (`Integrations__Simulator__Enabled`, Development only; docs/qa/e2e.md): a secret that contains "refused" or "expired", a tenant that
 * contains "unreachable", a scope that contains "refused" and a Base URL host that contains "unreachable" or "refusing" give the failure states;
 * client 99999 is not found and 55555 fails. No real network is used. The file is serial because the Entra ID connection is one global record, and it
 * leaves the integrations as it found them (Not Set Up). axe and the two desktop sizes (1366x768, 1920x1080) are checked on the tab and its dialogs.
 */
test.describe.configure({ mode: 'serial' });

const TENANT = '11111111-1111-1111-1111-111111111111';
const CLIENT = '22222222-2222-2222-2222-222222222222';
const SECRET = 'Abc8Q~TopSecretValue-9f3';
const SECRET_ID = '3f2a9c1e-8b7d-4e5f-9a6b-1c2d3e4f5a6b';
const LOOKUP_BASE = 'https://matters.example-firm.test/api/v1';
const LOOKUP_SCOPE = 'api://cccccccc-0000-4000-8000-000000000003/.default';

const isoDate = (daysFromToday: number): string => {
  const d = new Date(Date.now() + daysFromToday * 86_400_000);
  return d.toISOString().slice(0, 10);
};

const dialog = (page: Page, name: string): Locator => page.getByRole('dialog', { name });
const row = (page: Page, name: string): Locator =>
  page.locator('tbody tr', {
    has: page.locator('[data-integration-name]', { hasText: new RegExp(`^\\s*${name}\\s*$`) }),
  });

async function openTab(page: Page): Promise<void> {
  await page.goto('/admin/settings');
  await page.getByRole('tab', { name: 'Integrations' }).click();
  await expect(page.getByRole('heading', { name: 'Microsoft Entra ID Connection' })).toBeVisible();
  await expect(page.locator('[data-integrations-card] tbody tr').first()).toBeVisible();
}

async function menu(page: Page, name: string, item: string): Promise<void> {
  await row(page, name).locator('[data-row-actions] button').click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

async function saveIds(page: Page, tenant: string, client: string): Promise<void> {
  await page.locator('#ig-tenant').fill(tenant);
  await page.locator('#ig-client').fill(client);
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(toasts(page).filter({ hasText: 'Connection saved' })).toBeVisible();
}

/** Puts the integrations back as the script made them (Not Set Up, enabled), removes the Other ones and leaves a working connection. */
async function reset(api: Api): Promise<void> {
  const list = await api.call<
    { integrationId: number; name: string; typeCode: string; rowVersion: string }[]
  >('GET', '/api/v1/admin/integrations');
  for (const i of list) {
    if (i.typeCode === 'OTHER')
      await api.call('DELETE', `/api/v1/admin/integrations/${i.integrationId}`);
    else
      await api.call('PUT', `/api/v1/admin/integrations/${i.integrationId}`, {
        name: i.typeCode === 'MATTER_LOOKUP' ? 'Matter Lookup' : 'Ethical Wall',
        typeCode: i.typeCode,
        isEnabled: true,
        rowVersion: i.rowVersion,
      });
  }
}

async function configureLookup(
  api: Api,
  patch: { baseUrl?: string; scope?: string; enabled?: boolean } = {},
): Promise<void> {
  const list = await api.call<{ integrationId: number; typeCode: string; rowVersion: string }[]>(
    'GET',
    '/api/v1/admin/integrations',
  );
  const lookup = list.find((i) => i.typeCode === 'MATTER_LOOKUP')!;
  await api.call('PUT', `/api/v1/admin/integrations/${lookup.integrationId}`, {
    name: 'Matter Lookup',
    typeCode: 'MATTER_LOOKUP',
    baseUrl: patch.baseUrl ?? LOOKUP_BASE,
    scope: patch.scope ?? LOOKUP_SCOPE,
    isEnabled: patch.enabled ?? true,
    rowVersion: lookup.rowVersion,
  });
}

async function connection(api: Api, tenant = TENANT, secret = SECRET): Promise<void> {
  const current = await api.call<{ rowVersion: string }>('GET', '/api/v1/admin/entra-connection');
  await api.call('PUT', '/api/v1/admin/entra-connection', {
    tenantId: tenant,
    clientId: CLIENT,
    rowVersion: current.rowVersion,
  });
  await api.call('PUT', '/api/v1/admin/entra-connection/secret', {
    secret,
    expiresOn: isoDate(200),
  });
}

test.afterAll(async ({ admin }) => reset(admin));

test('the tab is the fourth one and the first look is the empty connection with both integrations Not Set Up', async ({
  page,
}) => {
  await page.goto('/admin/settings');
  await expect(page.getByRole('tab')).toHaveText([
    'Branding',
    'Dashboard',
    'Holidays',
    'Integrations',
  ]);
  await page.getByRole('tab', { name: 'Integrations' }).click();

  await expect(page.locator('[data-secret-state]')).toHaveText('Not set');
  await expect(page.locator('[data-secret-open]')).toHaveText('Set Secret');
  await expect(page.locator('[data-integration-name]')).toHaveText([
    'Matter Lookup',
    'Ethical Wall',
  ]);
  await expect(page.locator('[data-integration-status]')).toHaveText(['Not Set Up', 'Not Set Up']);
  await expect(page.locator('[data-no-changes]')).toHaveText('No unsaved changes');
  await atEverySize(page, 'integrations-first-use');
});

test('Tenant ID and Client ID save on their own; the secret has its own masked dialog and is never shown again', async ({
  page,
  admin,
}) => {
  await openTab(page);
  await page.locator('#ig-tenant').fill('not a tenant');
  await page.locator('#ig-client').fill('nope');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.locator('[data-summary]')).toContainText('Application (client) ID');

  await saveIds(page, TENANT, CLIENT);
  await expect(page.locator('[data-last-updated]')).toContainText('Last Updated');

  await page.locator('[data-secret-open]').click();
  const dlg = dialog(page, 'Set Client Secret');
  await expect(dlg.getByLabel('Client Secret')).toHaveAttribute('type', 'password');
  await expect(dlg).toContainText('never shows it again');
  await atEverySize(page, 'integrations-secret-dialog');

  await dlg.getByLabel('Client Secret').fill(SECRET_ID);
  await dlg.locator('#sd-expires').fill(isoDate(122));
  await dlg.getByRole('button', { name: 'Set Secret' }).click();
  await expect(dlg).toContainText('That looks like the Secret ID');
  await dlg.getByLabel('Client Secret').fill(SECRET);
  await dlg.getByRole('button', { name: 'Set Secret' }).click();
  await expect(dlg).toBeHidden();

  await expect(toasts(page).filter({ hasText: 'Client secret set' })).toBeVisible();
  await expect(page.locator('[data-secret-state]')).toHaveText('Secret set');
  await expect(page.locator('[data-secret-open]')).toHaveText('Replace Secret');
  await expect(page.locator('[data-secret-chip]')).toContainText(/Expires in 12[12] days/);
  expect(await page.content()).not.toContain(SECRET);
  expect(await page.locator('body').innerText()).not.toContain('TopSecret');

  // No API answer carries it either.
  const bodies = [
    JSON.stringify(await admin.call('GET', '/api/v1/admin/entra-connection')),
    JSON.stringify(await admin.call('GET', '/api/v1/admin/integrations')),
  ];
  for (const b of bodies) expect(b).not.toContain('TopSecret');
  await page.reload();
  await page.getByRole('tab', { name: 'Integrations' }).click();
  await expect(page.locator('[data-secret-state]')).toHaveText('Secret set');
  expect(await page.content()).not.toContain('TopSecret');
});

test('Test Connection on the Entra ID card: a toast and a result that stays; the plain reasons for refused, expired and not reachable', async ({
  page,
  admin,
}) => {
  await openTab(page);

  await page.locator('[data-test-entra]').click();
  await expect(toasts(page).filter({ hasText: 'Microsoft Entra ID is connected.' })).toBeVisible();
  await expect(page.locator('[data-entra-last-reason]')).toHaveText(
    'Entra ID accepted the credentials.',
  );
  await expect(page.locator('[data-entra-last-test]')).toContainText('Last Tested');
  await page.reload();
  await page.getByRole('tab', { name: 'Integrations' }).click();
  await expect(page.locator('[data-entra-last-reason]')).toHaveText(
    'Entra ID accepted the credentials.',
  ); // kept after a reload

  const cases: [string, string, string, string][] = [
    ['this-secret-is-refused', TENANT, 'Check the Tenant ID', 'Entra ID refused the credentials'],
    [
      'this-secret-is-expired',
      TENANT,
      'Create a new secret in the app registration',
      'client secret has expired',
    ],
    [
      SECRET,
      'unreachable.example-firm.test',
      'could not connect to Microsoft',
      "Couldn't connect Microsoft Entra ID.",
    ],
  ];
  for (const [secret, tenant, reason, toast] of cases) {
    await connection(admin, tenant, secret);
    await page.reload();
    await page.getByRole('tab', { name: 'Integrations' }).click();
    await expect(page.locator('[data-entra-last-test]')).toContainText('Not tested yet'); // a changed credential cleared the result
    await page.locator('[data-test-entra]').click();
    await expect(page.locator('[data-entra-last-reason]')).toContainText(reason);
    await expect(toasts(page).filter({ hasText: toast }).first()).toBeVisible();
  }
  await connection(admin);
});

test('the expiry banner: amber at 21 days, red once expired, with Replace Secret in the banner', async ({
  page,
  admin,
}) => {
  const current = await admin.call<{ rowVersion: string }>('GET', '/api/v1/admin/entra-connection');
  expect(current.rowVersion).toBeTruthy();
  await admin.call('PUT', '/api/v1/admin/entra-connection/secret', {
    secret: SECRET,
    expiresOn: isoDate(21),
  });
  await openTab(page);
  const banner = page.locator('[data-secret-banner]');
  await expect(banner).toHaveAttribute('data-state', 'soon');
  await expect(banner).toContainText('expires');
  await expect(page.locator('[data-secret-chip]')).toContainText(/Expires in 2[01] days/);
  await atEverySize(page, 'integrations-secret-expiring');

  await admin.call('PUT', '/api/v1/admin/entra-connection/secret', {
    secret: SECRET,
    expiresOn: isoDate(-6),
  });
  await page.reload();
  await page.getByRole('tab', { name: 'Integrations' }).click();
  await expect(banner).toHaveAttribute('data-state', 'expired');
  await expect(page.locator('[data-secret-chip]')).toContainText('Expired 6 days ago');
  await atEverySize(page, 'integrations-secret-expired');

  await banner.getByRole('button', { name: 'Replace Secret' }).click();
  const dlg = dialog(page, 'Replace Client Secret');
  await dlg.getByLabel('Client Secret').fill(SECRET);
  await dlg.locator('#sd-expires').fill(isoDate(200));
  await dlg.getByRole('button', { name: 'Replace Secret' }).click();
  await expect(banner).toBeHidden();
});

test('add, edit, turn off and on, and delete an integration; a second Matter Lookup and a plain http address are refused', async ({
  page,
}) => {
  await openTab(page);

  await page.getByRole('button', { name: 'Add Integration' }).first().click();
  const add = dialog(page, 'Add Integration');
  await expect(add.locator('#ig-scope-help')).toContainText('api://<app-id>/.default');
  await add.getByLabel('Name').fill('Billing Export');
  await add.locator('#ig-base').fill('http://billing.example-firm.test/export');
  await add.getByRole('button', { name: 'Add Integration' }).click();
  await expect(add.locator('#ig-base-error')).toContainText('starts with https://');
  await atEverySize(page, 'integrations-add-dialog');

  await add.locator('#ig-base').fill('https://billing.example-firm.test/export');
  await add.locator('#ig-scope').fill('api://ffffffff-0000-4000-8000-000000000006/.default');
  await add.getByRole('button', { name: 'Add Integration' }).click();
  await expect(add).toBeHidden();
  await expect(row(page, 'Billing Export')).toContainText('Other');
  await expect(row(page, 'Billing Export').locator('[data-integration-status]')).toHaveText(
    'Not Tested',
  );

  // A second Matter Lookup is refused with a clear message and the dialog stays.
  await page.getByRole('button', { name: 'Add Integration' }).first().click();
  const second = dialog(page, 'Add Integration');
  await second.getByLabel('Name').fill('Another Lookup');
  await second.locator('[data-integration-type]').click();
  await page.getByRole('option', { name: 'Matter Lookup' }).click();
  await second.getByRole('button', { name: 'Add Integration' }).click();
  await expect(second.locator('[data-type-error]')).toContainText(
    'There is already a Matter Lookup integration',
  );
  await second.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Discard Changes' }).click();
  await expect(second).toBeHidden();

  // Edit through the name button.
  await row(page, 'Billing Export').locator('[data-integration-name]').click();
  const edit = dialog(page, 'Edit Integration');
  await edit.getByLabel('Name').fill('Billing Export v2');
  await edit.getByRole('button', { name: 'Save Changes' }).click();
  await expect(edit).toBeHidden();
  await expect(row(page, 'Billing Export v2')).toBeVisible();

  // Disable and enable: no question, a toast.
  await menu(page, 'Billing Export v2', 'Disable');
  await expect(toasts(page).filter({ hasText: 'Billing Export v2 disabled' })).toBeVisible();
  await expect(row(page, 'Billing Export v2').locator('[data-integration-status]')).toHaveText(
    'Disabled',
  );
  await expect(row(page, 'Billing Export v2').locator('[data-integration-enabled]')).toHaveText(
    'No',
  );
  await menu(page, 'Billing Export v2', 'Enable');
  await expect(row(page, 'Billing Export v2').locator('[data-integration-status]')).toHaveText(
    'Not Tested',
  );

  // Delete asks first.
  await menu(page, 'Billing Export v2', 'Delete');
  const confirm = page.getByRole('dialog', { name: 'Delete Integration' });
  await expect(confirm).toContainText('Billing Export v2');
  await atEverySize(page, 'integrations-delete-confirm');
  await confirm.getByRole('button', { name: 'Delete Integration' }).click();
  await expect(row(page, 'Billing Export v2')).toHaveCount(0);

  // The audit lines of this page.
  await expect(page.locator('[data-recent-changes]')).toContainText('Billing Export');
  await expect(page.locator('[data-open-audit]')).toHaveText('Open Audit Logs');
});

test('Test Connection per integration: not set up, connected, scope refused and API not reachable, each with its steps', async ({
  page,
  admin,
}) => {
  await reset(admin);
  await connection(admin);
  await openTab(page);

  await menu(page, 'Ethical Wall', 'Test Connection');
  await expect(page.locator('[data-result-title]')).toHaveText('Not set up yet.');
  await expect(page.locator('[data-result-heading]')).toHaveText('Test Result: Ethical Wall');

  await configureLookup(admin);
  await page.reload();
  await page.getByRole('tab', { name: 'Integrations' }).click();
  await expect(row(page, 'Matter Lookup').locator('[data-integration-status]')).toHaveText(
    'Not Tested',
  );
  await menu(page, 'Matter Lookup', 'Test Connection');
  await expect(toasts(page).filter({ hasText: 'Matter Lookup is connected.' })).toBeVisible();
  await expect(page.locator('[data-result-title]')).toHaveText('Connected.');
  await expect(page.locator('[data-result-steps] li')).toHaveCount(4);
  await expect(page.locator('[data-result-steps] [data-state="PASSED"]')).toHaveCount(4);
  await expect(row(page, 'Matter Lookup').locator('[data-integration-status]')).toHaveText(
    'Connected',
  );
  await atEverySize(page, 'integrations-test-connected');

  await configureLookup(admin, { scope: 'api://refused-scope/.default' });
  await page.reload();
  await page.getByRole('tab', { name: 'Integrations' }).click();
  await menu(page, 'Matter Lookup', 'Test Connection');
  await expect(page.locator('[data-result-title]')).toHaveText('Entra ID refused the scope.');
  await expect(page.locator('[data-result-detail]')).toContainText('api://refused-scope/.default');
  await expect(page.locator('[data-result-steps] [data-step="TOKEN_ISSUED"]')).toHaveAttribute(
    'data-state',
    'FAILED',
  );
  await expect(page.locator('[data-result-steps] [data-step="API_ANSWERED"]')).toHaveAttribute(
    'data-state',
    'NOT_REACHED',
  );
  await expect(page.locator('[data-result-steps]')).toContainText('Stopped here');
  await expect(toasts(page).filter({ hasText: "Couldn't connect Matter Lookup." })).toBeVisible();
  await expect(row(page, 'Matter Lookup').locator('[data-integration-status]')).toHaveText(
    'Failed',
  );
  await atEverySize(page, 'integrations-test-scope-refused');

  await configureLookup(admin, { baseUrl: 'https://unreachable.example-firm.test/api' });
  await page.reload();
  await page.getByRole('tab', { name: 'Integrations' }).click();
  await menu(page, 'Matter Lookup', 'Test Connection');
  await expect(page.locator('[data-result-title]')).toHaveText('The API is not reachable.');
  await expect(page.locator('[data-result-detail]')).toContainText(
    'https://unreachable.example-firm.test/api',
  );
  await atEverySize(page, 'integrations-test-api-unreachable');
});

test('the Lookup button on New Client: Not set up, Ready, Nothing found, Fails when used, Disabled', async ({
  page,
  admin,
}) => {
  await reset(admin);
  await connection(admin);

  // Not set up: the button stays, off, with the sentence; an administrator also gets the link.
  await page.goto('/clients/new');
  const lookup = page.locator('[data-lookup]');
  await expect(lookup).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-lookup-unavailable]')).toContainText(
    "Lookup isn't available yet. Enter the details yourself.",
  );
  await expect(page.locator('[data-open-integrations]')).toHaveText('Open Integrations');
  await page.locator('#client-number').fill('4711');
  await page.locator('#client-name').fill('Typed By Hand');
  await atEverySize(page, 'lookup-new-client-not-set-up');

  // Ready.
  await configureLookup(admin);
  await page.goto('/clients/new');
  await expect(lookup).not.toHaveAttribute('aria-disabled', 'true');
  await expect(lookup).toHaveAttribute('aria-disabled', 'true'); // no number yet
  await page.locator('#client-number').fill('343');
  await expect(lookup).not.toHaveAttribute('aria-disabled', 'true');
  await lookup.click();
  await expect(page.locator('#client-name')).toHaveValue('Simulated Client 00343');
  await expect(page.locator('[data-lookup-message]')).toContainText(
    'Client Name filled in from Matter Lookup. Check it before you save.',
  );
  await atEverySize(page, 'lookup-new-client-ready');

  // Nothing found keeps what was typed.
  await page.locator('#client-number').fill('99999');
  await page.locator('#client-name').fill('Typed By Hand');
  await lookup.click();
  await expect(page.locator('[data-lookup-message]')).toContainText(
    'Nothing found for 99999. Enter the client name yourself.',
  );
  await expect(page.locator('#client-name')).toHaveValue('Typed By Hand');

  // Fails when used: a plain message with Retry, nothing lost.
  await page.locator('#client-number').fill('55555');
  await lookup.click();
  await expect(page.locator('[data-lookup-message]')).toContainText(
    "Lookup didn't work. What you entered is kept.",
  );
  await expect(page.locator('[data-lookup-retry]')).toBeVisible();
  await expect(page.locator('#client-name')).toHaveValue('Typed By Hand');
  await atEverySize(page, 'lookup-new-client-fails');

  // Disabled by an administrator.
  await configureLookup(admin, { enabled: false });
  await page.goto('/clients/new');
  await expect(lookup).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-lookup-unavailable]')).toContainText(
    'Lookup is turned off. Enter the details yourself.',
  );
  await lookup.hover();
  await expect(page.getByRole('tooltip').or(page.locator('[role="tooltip"]'))).toContainText(
    'turned off',
  );
});

test('the Lookup button on New Matter fills the Matter Name, needs a client first, and is not on Edit Matter; everyone else sees no link', async ({
  page,
  admin,
  personas,
  asUser,
}) => {
  await reset(admin);
  await connection(admin);
  await configureLookup(admin);
  const clientNumber = String(70000 + (Date.now() % 20000));
  const client = await admin.call<{ clientId: number }>('POST', '/api/v1/clients', {
    clientNumber,
    name: `Lookup Client ${clientNumber}`,
  });

  await page.goto(`/matters/new?clientId=${client.clientId}`);
  const lookup = page.locator('[data-lookup]');
  await expect(lookup).toHaveAttribute('aria-disabled', 'true'); // no matter number yet
  await page.locator('#matter-number').fill('12');
  await expect(lookup).not.toHaveAttribute('aria-disabled', 'true');
  await lookup.click();
  await expect(page.locator('#matter-name')).toHaveValue('Simulated Matter 00012');
  await expect(page.locator('[data-lookup-message]')).toContainText(
    'Matter Name filled in from Matter Lookup.',
  );
  await atEverySize(page, 'lookup-new-matter-ready');

  const matter = await admin.call<{ matterId: number }>('POST', '/api/v1/matters', {
    clientId: client.clientId,
    matterNumber: '1',
    name: 'Existing',
  });
  await page.goto(`/matters/${matter.matterId}/edit`);
  await expect(page.locator('[data-lookup]')).toHaveCount(0);

  // A person who may create matters but is not an administrator: same button, no Open Integrations link when it is not set up.
  await configureLookup(admin, { enabled: false });
  const creator = await personas.create({
    label: 'lookup',
    permissions: ['Client.View', 'Matter.View', 'Matter.Create'],
  });
  const theirPage = await asUser(creator.username);
  await theirPage.goto(`/matters/new?clientId=${client.clientId}`);
  await expect(theirPage.locator('[data-lookup]')).toHaveAttribute('aria-disabled', 'true');
  await expect(theirPage.locator('[data-lookup-unavailable]')).toContainText(
    'Lookup is turned off.',
  );
  await expect(theirPage.locator('[data-open-integrations]')).toHaveCount(0);
});

test('without Integrations.Manage: no tab, a deep link says so, and the API answers 403', async ({
  personas,
  asUser,
}) => {
  const settingsOnly = await personas.create({
    label: 'settings',
    permissions: ['Settings.Manage'],
  });
  const theirPage = await asUser(settingsOnly.username);
  await theirPage.goto('/admin/settings');
  await expect(theirPage.getByRole('tab')).toHaveText(['Branding', 'Dashboard', 'Holidays']);

  await theirPage.goto('/admin/settings?tab=integrations');
  await expect(theirPage.locator('[data-integrations-forbidden]')).toContainText(
    "You don't have access to Integrations.",
  );
  await expect(theirPage.locator('[data-entra-card]')).toHaveCount(0);
  await atEverySize(theirPage, 'integrations-no-access');

  const api = await Api.as(settingsOnly.username);
  expect((await api.raw('GET', '/api/v1/admin/entra-connection')).status).toBe(403);
  expect((await api.raw('GET', '/api/v1/admin/integrations')).status).toBe(403);
  expect(
    (
      await api.raw('PUT', '/api/v1/admin/entra-connection/secret', {
        secret: 'x',
        expiresOn: '2027-01-01',
      })
    ).status,
  ).toBe(403);
  await api.dispose();
});

test('both desktop sizes: the loaded tab and the load error state have no page scroll and no axe violation', async ({
  page,
  admin,
}) => {
  await reset(admin);
  await connection(admin);
  await configureLookup(admin);
  await openTab(page);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await shot(page, 'integrations-tab');
  }
  await atEverySize(page, 'integrations-tab');

  await page.route('**/api/v1/admin/integrations', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: '{"code":"INTERNAL_ERROR"}',
    }),
  );
  await page.reload();
  await page.getByRole('tab', { name: 'Integrations' }).click();
  await expect(page.locator('[data-integrations-error]')).toContainText(
    "Couldn't load integrations.",
  );
  await expect(
    page.locator('[data-integrations-error]').getByRole('button', { name: 'Retry' }),
  ).toBeVisible();
  await atEverySize(page, 'integrations-load-error');
});
