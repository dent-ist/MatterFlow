import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import {
  AuditSearchClient,
  EntraConnectionClient,
  EntraConnectionResponse,
  IntegrationResponse,
  IntegrationsClient,
  TestResultResponse,
} from '../../../../api/generated/api-client';
import { AuthStore } from '../../../../core/auth/auth.store';
import { Permission } from '../../../../core/auth/permissions';
import { Clock } from '../../../../core/time/clock';
import { NotificationService } from '../../../../core/notify/notification.service';
import {
  FakeMeApi,
  apiError,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../../shared/testing/org-testing';
import { IntegrationsTab } from './integrations-tab';

const NOW = new Date('2026-11-16T15:30:00Z');

const connection = (patch: Partial<EntraConnectionResponse> = {}): EntraConnectionResponse => ({
  tenantId: 'aaaaaaaa-0000-4000-8000-000000000001',
  clientId: 'bbbbbbbb-0000-4000-8000-000000000002',
  secretIsSet: true,
  secretExpiresOn: '2027-03-18',
  secretUpdatedAt: '2026-11-04T16:05:00Z',
  secretUpdatedBy: 'Priya Raman',
  lastTest: undefined,
  updatedAt: '2026-11-04T16:05:00Z',
  updatedBy: 'Priya Raman',
  rowVersion: 'AAAA',
  ...patch,
});

const result = (outcome: string, patch: Partial<TestResultResponse> = {}): TestResultResponse => {
  const failed = ['OK'].includes(outcome) ? -1 : outcome === 'SCOPE_REFUSED' ? 2 : 0;
  const keys = ['ENTRA_REACHED', 'CREDENTIALS_ACCEPTED', 'TOKEN_ISSUED', 'API_ANSWERED'];
  return {
    outcome,
    steps: keys.map((key, i) => ({
      key,
      state: failed < 0 || i < failed ? 'PASSED' : i === failed ? 'FAILED' : 'NOT_REACHED',
    })),
    tokenSeconds: outcome === 'OK' ? 3599 : undefined,
    testedAt: '2026-11-15T21:42:00Z',
    testedBy: 'Priya Raman',
    ...patch,
  };
};

const integration = (patch: Partial<IntegrationResponse> = {}): IntegrationResponse => ({
  integrationId: 1,
  name: 'Matter Lookup',
  typeCode: 'MATTER_LOOKUP',
  baseUrl: 'https://matters.example-firm.test/api/v1',
  scope: 'api://cccccccc-0000-4000-8000-000000000003/.default',
  isEnabled: true,
  status: 'NOT_TESTED',
  lastTest: undefined,
  rowVersion: 'BBBB',
  ...patch,
});

describe('IntegrationsTab (#1395)', () => {
  let entra: Record<string, ReturnType<typeof vi.fn>>;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let toasts: { kind: string; summary: string; detail?: string }[];
  let fixture: ComponentFixture<IntegrationsTab>;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T | null =>
    el().querySelector<T>(sel);
  const text = (sel: string): string => q(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const flush = () => settle(fixture);

  async function open(
    opts: {
      conn?: EntraConnectionResponse;
      list?: IntegrationResponse[];
      permissions?: Permission[];
    } = {},
  ) {
    localStorage.clear();
    entra = {
      getEntraConnection: vi.fn().mockReturnValue(of(opts.conn ?? connection())),
      updateEntraConnection: vi.fn(),
      setEntraClientSecret: vi.fn(),
      testEntraConnection: vi.fn(),
    };
    api = {
      listIntegrations: vi.fn().mockReturnValue(
        of(
          opts.list ?? [
            integration(),
            integration({
              integrationId: 2,
              name: 'Ethical Wall',
              typeCode: 'ETHICAL_WALL',
              baseUrl: undefined,
              scope: undefined,
              status: 'NOT_SET_UP',
              rowVersion: 'CCCC',
            }),
          ],
        ),
      ),
      createIntegration: vi.fn(),
      updateIntegration: vi.fn(),
      deleteIntegration: vi.fn(),
      enableIntegration: vi.fn(),
      disableIntegration: vi.fn(),
      testIntegration: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(
          new FakeMeApi(
            withPermissions(...(opts.permissions ?? ['Integrations.Manage', 'Audit.View'])),
          ),
        ),
        { provide: EntraConnectionClient, useValue: entra },
        { provide: IntegrationsClient, useValue: api },
        {
          provide: AuditSearchClient,
          useValue: {
            searchAuditEvents: vi.fn().mockReturnValue(
              of({
                items: [
                  {
                    auditEventId: 1,
                    occurredAtUtc: '2026-11-12T19:15:00Z',
                    actor: { displayName: 'Priya Raman' },
                    summary: 'Replaced the client secret; new expiry 03/18/2027',
                  },
                ],
                pageSize: 4,
                timeZone: 'UTC',
              }),
            ),
          },
        },
        { provide: Clock, useValue: { now: () => NOW } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    toasts = [];
    const notify = TestBed.inject(NotificationService);
    vi.spyOn(notify, 'success').mockImplementation(
      (summary, detail) => void toasts.push({ kind: 'success', summary, detail }),
    );
    vi.spyOn(notify, 'error').mockImplementation(
      (summary, detail) => void toasts.push({ kind: 'error', summary, detail }),
    );
    fixture = TestBed.createComponent(IntegrationsTab);
    await flush();
  }

  const names = () =>
    Array.from(el().querySelectorAll('[data-integration-name]')).map((b) => b.textContent!.trim());

  it('shows the connection, the secret state without any value, and the grid with its status chips', async () => {
    await open();

    expect(q('#ig-tenant')!.getAttribute('value') ?? q<HTMLInputElement>('#ig-tenant')!.value).toBe(
      'aaaaaaaa-0000-4000-8000-000000000001',
    );
    expect(text('[data-secret-state]')).toBe('Secret set');
    expect(text('[data-secret-expiry]')).toContain('03/18/2027');
    expect(text('[data-secret-chip]')).toBe('Expires in 122 days');
    expect(text('[data-secret-open]')).toBe('Replace Secret');
    expect(names()).toEqual(['Matter Lookup', 'Ethical Wall']);
    expect(
      Array.from(el().querySelectorAll('[data-integration-status]')).map((c) =>
        c.textContent!.trim(),
      ),
    ).toEqual(['Not Tested', 'Not Set Up']);
    expect(el().querySelector('input[type="password"]')).toBeNull(); // the secret is never in the page
    expect(el().querySelector('[data-secret-banner]')).toBeNull();
    expect(text('[data-recent-changes]')).toContain('Replaced the client secret');
    expect(q('[data-open-audit]')!.getAttribute('href')).toContain('/admin/audit');
  });

  it('says "Not set" and offers Set Secret when there is no secret', async () => {
    await open({
      conn: connection({
        secretIsSet: false,
        secretExpiresOn: undefined,
        tenantId: undefined,
        clientId: undefined,
      }),
    });

    expect(text('[data-secret-state]')).toBe('Not set');
    expect(text('[data-secret-open]')).toBe('Set Secret');
    expect(text('[data-secret-chip]')).toBe('Not Set');
  });

  it('warns with an amber banner and chip at 21 days, and with a red one when expired', async () => {
    await open({ conn: connection({ secretExpiresOn: '2026-12-07' }) });
    expect(q('[data-secret-banner]')!.getAttribute('data-state')).toBe('soon');
    expect(q('[data-secret-banner]')!.classList.contains('pg-banner--danger')).toBe(false);
    expect(text('[data-secret-chip]')).toBe('Expires in 21 days');
    expect(q('[data-secret-banner]')!.getAttribute('role')).toBe('status');
    fixture.destroy();
    TestBed.resetTestingModule();

    await open({ conn: connection({ secretExpiresOn: '2026-11-10' }) });
    expect(q('[data-secret-banner]')!.getAttribute('data-state')).toBe('expired');
    expect(q('[data-secret-banner]')!.classList.contains('pg-banner--danger')).toBe(true);
    expect(q('[data-secret-banner]')!.getAttribute('role')).toBe('alert');
    expect(text('[data-secret-chip]')).toBe('Expired 6 days ago');
  });

  it('Save Changes covers only the two IDs and is off until one changes', async () => {
    await open();
    expect(q<HTMLButtonElement>('[data-save-ids] button, button[data-save-ids]')!.disabled).toBe(
      true,
    );
    expect(text('[data-no-changes]')).toBe('No unsaved changes');

    entra['updateEntraConnection'].mockReturnValue(
      of(connection({ tenantId: 'cccccccc-0000-4000-8000-000000000009', rowVersion: 'DDDD' })),
    );
    const tenant = q<HTMLInputElement>('#ig-tenant')!;
    tenant.value = '  cccccccc-0000-4000-8000-000000000009 ';
    tenant.dispatchEvent(new Event('input'));
    await flush();
    q<HTMLFormElement>('[data-entra-form]')!.dispatchEvent(new Event('submit'));
    await flush();

    expect(entra['updateEntraConnection']).toHaveBeenCalledWith({
      tenantId: 'cccccccc-0000-4000-8000-000000000009',
      clientId: 'bbbbbbbb-0000-4000-8000-000000000002',
      rowVersion: 'AAAA',
    });
    expect(Object.keys(entra['updateEntraConnection'].mock.calls[0][0]).sort()).toEqual([
      'clientId',
      'rowVersion',
      'tenantId',
    ]);
    expect(toasts[0]).toMatchObject({ kind: 'success', summary: 'Connection saved' });
  });

  it("shows the server's message under the ID field and a conflict banner for a stale record", async () => {
    await open();
    entra['updateEntraConnection'].mockReturnValue(
      apiError(400, {
        code: 'VALIDATION_FAILED',
        errors: {
          clientId: [{ code: 'INVALID', message: 'Enter the Application (client) ID: a GUID.' }],
        },
      }),
    );
    const client = q<HTMLInputElement>('#ig-client')!;
    client.value = 'nope';
    client.dispatchEvent(new Event('input'));
    await flush();
    q<HTMLFormElement>('[data-entra-form]')!.dispatchEvent(new Event('submit'));
    await flush();
    expect(text('[data-summary]')).toContain('Enter the Application (client) ID');

    entra['updateEntraConnection'].mockReturnValue(apiError(409, { code: 'CONCURRENCY_CONFLICT' }));
    q<HTMLFormElement>('[data-entra-form]')!.dispatchEvent(new Event('submit'));
    await flush();
    expect(q('[data-conflict]')).not.toBeNull();
  });

  it('Test Connection shows a toast and keeps the result on the page; a failure names its plain reason', async () => {
    await open();
    entra['testEntraConnection'].mockReturnValue(
      of({ ...result('OK'), steps: result('OK').steps.slice(0, 2), rowVersion: 'EEEE' }),
    );
    q<HTMLButtonElement>('[data-test-entra]')!.click();
    await flush();

    expect(toasts[0]).toMatchObject({
      kind: 'success',
      summary: 'Microsoft Entra ID is connected.',
    });
    expect(text('[data-entra-last-test]')).toContain('Last Tested');
    expect(text('[data-entra-last-reason]')).toBe('Entra ID accepted the credentials.');

    entra['testEntraConnection'].mockReturnValue(
      of({ ...result('CREDENTIALS_REFUSED'), rowVersion: 'FFFF' }),
    );
    q<HTMLButtonElement>('[data-test-entra]')!.click();
    await flush();
    expect(toasts[1]).toMatchObject({
      kind: 'error',
      summary: "Couldn't connect Microsoft Entra ID.",
    });
    expect(text('[data-entra-last-reason]')).toContain('Check the Tenant ID');
  });

  it('a test of one integration fills the result panel with the steps and marks the failing one', async () => {
    await open();
    api['testIntegration'].mockReturnValue(of(result('SCOPE_REFUSED')));
    api['listIntegrations'].mockReturnValue(
      of([integration({ status: 'FAILED', lastTest: result('SCOPE_REFUSED') })]),
    );

    q<HTMLButtonElement>('[data-integration-name]')!
      .closest('tr')!
      .querySelector<HTMLButtonElement>('[data-row-actions] button')!
      .click();
    await flush();
    Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]'))
      .find((i) => i.textContent!.includes('Test Connection'))!
      .click();
    await flush();

    expect(api['testIntegration']).toHaveBeenCalledWith(1);
    expect(text('[data-result-heading]')).toBe('Test Result: Matter Lookup');
    expect(text('[data-result-title]')).toBe('Entra ID refused the scope.');
    expect(text('[data-result-detail]')).toContain(
      'api://cccccccc-0000-4000-8000-000000000003/.default',
    );
    const steps = Array.from(el().querySelectorAll('[data-result-steps] li')).map((li) => [
      li.getAttribute('data-step'),
      li.getAttribute('data-state'),
    ]);
    expect(steps).toEqual([
      ['ENTRA_REACHED', 'PASSED'],
      ['CREDENTIALS_ACCEPTED', 'PASSED'],
      ['TOKEN_ISSUED', 'FAILED'],
      ['API_ANSWERED', 'NOT_REACHED'],
    ]);
    expect(text('[data-result-steps]')).toContain('Stopped here');
    expect(toasts[0]).toMatchObject({ kind: 'error', summary: "Couldn't connect Matter Lookup." });
  });

  it('after a reload the panel shows the most recent stored result', async () => {
    await open({
      list: [
        integration({ status: 'CONNECTED', lastTest: result('OK') }),
        integration({
          integrationId: 2,
          name: 'Ethical Wall',
          lastTest: result('SCOPE_REFUSED', { testedAt: '2026-11-10T10:00:00Z' }),
        }),
      ],
    });

    expect(text('[data-result-heading]')).toBe('Test Result: Matter Lookup');
    expect(text('[data-result-title]')).toBe('Connected.');
  });

  it('turning an integration off or on does not ask and toasts', async () => {
    await open();
    api['disableIntegration'].mockReturnValue(
      of(integration({ isEnabled: false, status: 'DISABLED' })),
    );
    api['listIntegrations'].mockReturnValue(
      of([integration({ isEnabled: false, status: 'DISABLED' })]),
    );
    q<HTMLElement>('[data-row-actions] button')!.click();
    await flush();
    Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]'))
      .find((i) => i.textContent!.trim() === 'Disable')!
      .click();
    await flush();

    expect(api['disableIntegration']).toHaveBeenCalledWith(1);
    expect(toasts[0]).toMatchObject({ summary: 'Matter Lookup disabled' });
    expect(q('mf-confirm-dialog [role=dialog]')).toBeNull();
    expect(text('[data-integration-status]')).toBe('Disabled');
  });

  it('Delete asks first and names the integration', async () => {
    await open();
    api['deleteIntegration'].mockReturnValue(of(undefined));
    q<HTMLElement>('[data-row-actions] button')!.click();
    await flush();
    Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]'))
      .find((i) => i.textContent!.trim() === 'Delete')!
      .click();
    await flush();

    expect(document.body.textContent).toContain('Delete Integration');
    expect(document.querySelector('[data-delete-text]')!.textContent).toContain('Matter Lookup');
    expect(api['deleteIntegration']).not.toHaveBeenCalled();
  });

  it('an empty list offers Add Integration; a load failure offers Retry', async () => {
    await open({ list: [] });
    expect(q('[data-empty-add]')).not.toBeNull();
    fixture.destroy();
    TestBed.resetTestingModule();

    await open();
    entra['getEntraConnection'].mockReturnValue(throwError(() => new Error('x')));
    q<HTMLElement>('[data-integrations-error]');
    await fixture.componentInstance.load();
    await flush();
    expect(q('[data-integrations-error]')).not.toBeNull();
  });

  it('hides Recent Changes from someone who cannot read the audit', async () => {
    await open({ permissions: ['Integrations.Manage'] });

    expect(q('[data-recent-changes]')).toBeNull();
  });
});
