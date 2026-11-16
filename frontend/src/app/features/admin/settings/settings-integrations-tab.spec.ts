import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import {
  AuditSearchClient,
  EntraConnectionClient,
  IntegrationsClient,
  SettingsBrandingClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { provideCalendarFixtures } from '../../../shared/testing/calendar-testing';
import {
  FakeMeApi,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { SettingsPage } from './settings-page';

describe('SettingsPage: the Integrations tab (#1395)', () => {
  let fixture: ComponentFixture<SettingsPage>;
  const el = (): HTMLElement => fixture.nativeElement;
  const tabs = (): string[] =>
    Array.from(el().querySelectorAll('[role="tab"]')).map((t) => t.textContent!.trim());

  async function open(permissions: Permission[], tab?: string): Promise<void> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        {
          provide: SettingsBrandingClient,
          useValue: {
            getBrandingSettings: () =>
              of({
                appName: 'LPT Hub',
                defaultAppName: 'LPT Hub',
                appNameIsCustom: false,
                appNameRowVersion: '',
                iconRowVersion: '',
                version: 'a',
                limits: {
                  appNameMaxLength: 40,
                  iconMaxBytes: 262144,
                  iconMinPixels: 64,
                  iconMaxPngPixels: 1024,
                  iconTypes: ['png'],
                },
              }),
          },
        },
        {
          provide: EntraConnectionClient,
          useValue: { getEntraConnection: () => of({ secretIsSet: false, rowVersion: 'AA' }) },
        },
        { provide: IntegrationsClient, useValue: { listIntegrations: () => of([]) } },
        {
          provide: AuditSearchClient,
          useValue: { searchAuditEvents: () => of({ items: [], pageSize: 4, timeZone: 'UTC' }) },
        },
        ...provideCalendarFixtures(),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(SettingsPage);
    if (tab) fixture.componentRef.setInput('tab', tab);
    await settle(fixture);
  }

  it('is the fourth tab, after Branding, Dashboard and Holidays, with the Integrations permission', async () => {
    await open(['Settings.Manage', 'Integrations.Manage']);

    expect(tabs()).toEqual(['Branding', 'Dashboard', 'Holidays', 'Integrations']);
    (el().querySelectorAll('[role="tab"]')[3] as HTMLElement).click();
    await settle(fixture);
    expect(el().querySelector('#settings-panel mf-integrations-tab')).not.toBeNull();
    expect(el().querySelector('[role="tab"][aria-selected="true"]')!.textContent!.trim()).toBe(
      'Integrations',
    );
  });

  it('is not drawn for someone with Settings.Manage but without Integrations.Manage', async () => {
    await open(['Settings.Manage']);

    expect(tabs()).toEqual(['Branding', 'Dashboard', 'Holidays']);
  });

  it('opens from the address (?tab=integrations) for an administrator', async () => {
    await open(['Settings.Manage', 'Integrations.Manage'], 'integrations');

    expect(el().querySelector('mf-integrations-tab')).not.toBeNull();
  });

  it('a deep link without the permission says so and loads nothing from the Integrations API', async () => {
    await open(['Settings.Manage'], 'integrations');

    expect(el().querySelector('[data-integrations-forbidden]')!.textContent).toContain(
      "You don't have access to Integrations.",
    );
    expect(el().querySelector('mf-integrations-tab')).toBeNull();
  });

  it('an unknown tab name keeps Branding', async () => {
    await open(['Settings.Manage', 'Integrations.Manage'], 'nonsense');

    expect(el().querySelector('[role="tab"][aria-selected="true"]')!.textContent!.trim()).toBe(
      'Branding',
    );
  });
});
