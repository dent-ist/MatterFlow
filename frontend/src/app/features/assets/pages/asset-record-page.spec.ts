import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AssetsClient, AuditEventsClient, FormsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { aFormVersion, anAsset } from '../../../shared/testing/asset-testing';
import {
  FakeMeApi,
  apiError,
  buttonByLabel,
  ok,
  openOverflow,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { AssetRecordPage } from './asset-record-page';

const LINK = {
  taskId: 1042,
  taskNumber: 'TSK-1042',
  title: 'Process Smith custodians',
  statusCode: 'IN_PROGRESS',
  assetLinkRoleId: 2,
  assetLinkRoleName: 'Source',
  linkedAtUtc: '2026-10-01T12:00:00Z',
};

describe('AssetRecordPage', () => {
  let assets: Record<
    'getAsset' | 'setAssetActive' | 'listAssetLinkedTasks',
    ReturnType<typeof vi.fn>
  >;
  let fixture: ComponentFixture<AssetRecordPage>;
  let navigate: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  const el = (): HTMLElement => fixture.nativeElement;
  const tabs = (): string[] =>
    Array.from(el().querySelectorAll('[role=tab]')).map((t) =>
      t.textContent!.replace(/\s+/g, ' ').trim(),
    );
  const tab = (label: string): HTMLElement =>
    Array.from(el().querySelectorAll<HTMLElement>('[role=tab]')).find((t) =>
      t.textContent!.trim().startsWith(label),
    )!;

  async function create(permissions: Permission[], startTab?: string): Promise<void> {
    localStorage.clear();
    assets = {
      getAsset: vi
        .fn()
        .mockReturnValue(ok(anAsset({ linkedTaskCount: 2, openLinkedTaskCount: 1 }))),
      setAssetActive: vi.fn().mockReturnValue(ok(anAsset({ isActive: false, rowVersion: 'BBBB' }))),
      listAssetLinkedTasks: vi.fn().mockReturnValue(ok({ items: [LINK, { ...LINK, taskId: 7 }] })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: AssetsClient, useValue: assets },
        {
          provide: FormsClient,
          useValue: { getFormVersionSchema: vi.fn().mockReturnValue(ok(aFormVersion())) },
        },
        {
          provide: AuditEventsClient,
          useValue: { listAuditEvents: vi.fn().mockReturnValue(ok({ items: [] })) },
        },
      ],
    });
    const router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true) as never;
    navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(AssetRecordPage);
    fixture.componentRef.setInput('assetId', '9');
    if (startTab) fixture.componentRef.setInput('tab', startTab);
    await settle(fixture);
  }

  async function openTab(key: string | undefined): Promise<void> {
    fixture.componentRef.setInput('tab', key);
    await settle(fixture);
  }

  it('shows the record header: crumb, name, type badge, status, the matter on the context line', async () => {
    await create(['Asset.View', 'Matter.View']);

    expect(el().querySelector('h1')?.textContent).toContain('Contract bundle');
    expect(el().querySelector('[data-record-header] [data-back-link]')?.textContent).toContain(
      'Assets',
    );
    expect(el().querySelector('[data-type-badge]')?.textContent).toContain('Document Set');
    expect(el().querySelector('[data-record-header] mf-active-badge')?.textContent).toContain(
      'Active',
    );
    const matter = el().querySelector('[data-matter]')!;
    expect(matter.textContent).toContain('Merger Review');
    expect(matter.querySelector('a.mf-ref')?.getAttribute('href')).toBe('/matters/7');
    expect(assets.getAsset).toHaveBeenCalledWith(9);
    expect(document.title).toBe('Contract bundle: Details - MatterFlow');
  });

  it('shows the matter as plain text without Matter.View', async () => {
    await create(['Asset.View']);
    expect(el().querySelector('[data-matter] .mf-ref')?.textContent).toBe('00343-00012');
    expect(el().querySelectorAll('a[href^="/matters"]')).toHaveLength(0);
  });

  it('offers no Edit, Activity or overflow to a person who can only view assets', async () => {
    await create(['Asset.View']);
    expect(el().querySelector('[data-action="edit"]')).toBeNull();
    expect(el().querySelector('[data-action="activity"]')).toBeNull();
    expect(el().querySelector('[data-overflow]')?.getAttribute('aria-label') ?? '').not.toBe('x');
    const menu = await openOverflow(fixture);
    expect(menu?.textContent ?? '').not.toContain('Set inactive');
  });

  it('puts Edit and Activity in the header and Set inactive in the overflow, in that order', async () => {
    await create(['Asset.View', 'Asset.Edit', 'Audit.View']);
    const buttons = Array.from(
      el().querySelectorAll('[data-page-actions] button[data-action]'),
    ).map((b) => b.getAttribute('data-action'));
    expect(buttons).toEqual(['edit', 'activity']);
    const menu = await openOverflow(fixture);
    expect(menu?.textContent).toContain('Set inactive');

    buttonByLabel(el(), 'Edit')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/assets/9/edit');
  });

  it('hides Edit for an inactive asset and offers Set active', async () => {
    await create(['Asset.View', 'Asset.Edit']);
    assets.getAsset.mockReturnValue(ok(anAsset({ isActive: false })));
    await fixture.componentInstance.load();
    await settle(fixture);

    expect(el().querySelector('[data-action="edit"]')).toBeNull();
    expect(el().querySelector('[data-inactive-banner]')).not.toBeNull();
    const menu = await openOverflow(fixture);
    expect(menu?.textContent).toContain('Set active');
  });

  it('shows the inactive-type banner', async () => {
    await create(['Asset.View']);
    assets.getAsset.mockReturnValue(ok(anAsset({ assetTypeIsActive: false })));
    await fixture.componentInstance.load();
    await settle(fixture);
    expect(el().querySelector('[data-type-inactive-banner]')?.textContent).toContain(
      'Document Set is inactive',
    );
  });

  it('sets the asset inactive after confirmation and updates in place', async () => {
    await create(['Asset.View', 'Asset.Edit']);
    const menu = await openOverflow(fixture);
    Array.from(menu!.querySelectorAll<HTMLElement>('[role=menuitem]'))
      .find((i) => i.textContent!.includes('Set inactive'))!
      .click();
    await settle(fixture);
    const dialog = document.body.querySelector('p-dialog') as HTMLElement;
    expect(dialog.textContent).toContain('Set Contract bundle inactive?');
    expect(assets.setAssetActive).not.toHaveBeenCalled();

    buttonByLabel(dialog, 'Set inactive')!.click();
    await settle(fixture);
    expect(assets.setAssetActive).toHaveBeenCalledWith(9, { isActive: false, rowVersion: 'AAAA' });
    expect(el().querySelector('[data-record-header] mf-active-badge')?.textContent).toContain(
      'Inactive',
    );
  });

  it('has Details, Linked tasks (n) and History tabs; the count is the number of linked tasks', async () => {
    await create(['Asset.View', 'Task.View', 'Audit.View']);
    expect(tabs()).toEqual(['Details', 'Linked tasks (2)', 'History']);
    expect(tab('Details').getAttribute('aria-selected')).toBe('true');
    expect(el().querySelector('[role=tabpanel]')!.getAttribute('aria-labelledby')).toBe(
      'asset-tab-details',
    );
    expect(el().querySelector('[data-details-tab] mf-asset-details-tab')).not.toBeNull();
  });

  it('has no count without Task.View and no History tab without Audit.View', async () => {
    await create(['Asset.View']);
    assets.getAsset.mockReturnValue(ok(anAsset({ linkedTaskCount: undefined })));
    await fixture.componentInstance.load();
    await settle(fixture);
    expect(tabs()).toEqual(['Details', 'Linked tasks']);
    expect(assets.listAssetLinkedTasks).not.toHaveBeenCalled();
    await openTab('history');
    expect(tab('Details').getAttribute('aria-selected')).toBe('true'); // falls back to Details
    await openTab('tasks');
    expect(el().querySelector('[data-no-access="linked-tasks"]')?.textContent).toContain(
      "You don't have permission to view tasks.",
    );
  });

  it('selects the tab from ?tab= and keeps it in the address, replacing the entry', async () => {
    await create(['Asset.View', 'Task.View', 'Audit.View']);
    await openTab('tasks');
    expect(tab('Linked tasks').getAttribute('aria-selected')).toBe('true');
    expect(el().querySelector('mf-asset-linked-tasks')).not.toBeNull();
    expect(document.title).toBe('Contract bundle: Linked tasks - MatterFlow');

    await openTab('history');
    expect(el().querySelector('mf-entity-activity')).not.toBeNull();

    tab('Details').click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { tab: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    await openTab(undefined);
    tab('History').click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { tab: 'history' },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });

  it('Activity in the header opens the History tab', async () => {
    await create(['Asset.View', 'Audit.View']);
    buttonByLabel(el(), 'Activity')!.click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { tab: 'history' },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });

  it('moves focus to the heading when the page opens', async () => {
    await create(['Asset.View']);
    await settle(fixture);
    expect(document.activeElement).toBe(el().querySelector('[data-page-title]'));
  });

  it('shows the not-found text with a link back and no Retry for a 404', async () => {
    await create(['Asset.View']);
    assets.getAsset.mockReturnValue(apiError(404, { status: 404, code: 'NOT_FOUND' }));
    await fixture.componentInstance.load();
    await settle(fixture);

    expect(el().querySelector('h1')?.textContent).toContain("We couldn't find that asset.");
    expect(el().querySelector('[data-back-link]')?.textContent).toContain('Go to assets');
    expect(buttonByLabel(el(), 'Retry')).toBeUndefined();
    expect(el().querySelector('[role=tablist]')).toBeNull();
    expect(document.title).toBe('Asset not found - MatterFlow');
  });

  it('shows the access text and no Retry for a 403', async () => {
    await create(['Asset.View']);
    assets.getAsset.mockReturnValue(apiError(403, { status: 403, code: 'PERMISSION_DENIED' }));
    await fixture.componentInstance.load();
    await settle(fixture);
    expect(el().querySelector('h1')?.textContent).toContain("You don't have access to this asset.");
    expect(buttonByLabel(el(), 'Retry')).toBeUndefined();
  });

  it('says "Couldn\'t load this asset" with the reference and Retry for a server fault, and recovers', async () => {
    await create(['Asset.View']);
    assets.getAsset.mockReturnValue(apiError(500, { status: 500, traceId: 'abc' }));
    await fixture.componentInstance.load();
    await settle(fixture);

    expect(el().querySelector('h1')?.textContent).toContain("Couldn't load this asset.");
    expect(el().querySelector('[data-record-error]')).not.toBeNull();
    const retry = buttonByLabel(el(), 'Retry')!;
    assets.getAsset.mockReturnValue(ok(anAsset()));
    retry.click();
    await settle(fixture);
    expect(el().querySelector('[data-page-title]')?.textContent).toContain('Contract bundle');
    expect(buttonByLabel(el(), 'Retry')).toBeUndefined();
    expect(el().querySelector('[data-record-live]')?.textContent).toBe('Loaded');
  });
});
