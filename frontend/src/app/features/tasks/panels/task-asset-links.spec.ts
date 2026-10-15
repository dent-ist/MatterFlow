import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import {
  AssetLinkRolesClient,
  AssetsClient,
  TaskAssetsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { aLookupItem } from '../../../shared/testing/asset-testing';
import { apiError, buttonByLabel, ok, settle } from '../../../shared/testing/org-testing';
import { aLink } from './task-panels-testing';
import { TaskAssetLinks } from './task-asset-links';

const ROLES = [
  { id: 1, name: 'Source', sortOrder: 1, isActive: true, rowVersion: 'r1' },
  { id: 2, name: 'Destination', sortOrder: 2, isActive: true, rowVersion: 'r2' },
  { id: 3, name: 'Retired', sortOrder: 3, isActive: false, rowVersion: 'r3' },
];

describe('TaskAssetLinks', () => {
  let api: {
    listTaskAssets: ReturnType<typeof vi.fn>;
    linkTaskAsset: ReturnType<typeof vi.fn>;
    changeTaskAssetRole: ReturnType<typeof vi.fn>;
    unlinkTaskAsset: ReturnType<typeof vi.fn>;
  };
  let assets: { lookupAssets: ReturnType<typeof vi.fn>; getAsset: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<TaskAssetLinks>;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement>(selector: string): T => el().querySelector<T>(selector)!;

  async function create(
    list = { items: [aLink()], canEdit: true },
    inputs: Record<string, unknown> = {},
    permissions: Parameters<typeof withPermissions> = ['Asset.View', 'Asset.Link', 'Task.Edit'],
  ): Promise<void> {
    api = {
      listTaskAssets: vi.fn().mockReturnValue(ok(list)),
      linkTaskAsset: vi.fn().mockReturnValue(ok(aLink({ assetId: 11 }))),
      changeTaskAssetRole: vi.fn().mockReturnValue(ok(aLink({ assetLinkRoleId: 2 }))),
      unlinkTaskAsset: vi.fn().mockReturnValue(ok(undefined)),
    };
    assets = {
      lookupAssets: vi
        .fn()
        .mockReturnValue(ok([aLookupItem({ assetId: 11, displayName: 'Laptop' })])),
      getAsset: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: TaskAssetsClient, useValue: api },
        { provide: AssetsClient, useValue: assets },
        { provide: AssetLinkRolesClient, useValue: { listAssetLinkRoles: () => ok(ROLES) } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(TaskAssetLinks);
    fixture.componentRef.setInput('taskId', 42);
    fixture.componentRef.setInput('matterId', 7);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await settle(fixture);
  }

  it('lists the linked assets with type, external reference and relationship', async () => {
    await create();

    expect(q('h2').textContent).toContain('Assets (1)');
    const row = q('[data-asset-id="9"]');
    expect(row.textContent).toContain('Contract bundle');
    expect(row.textContent).toContain('Document Set');
    const link = row.querySelector<HTMLAnchorElement>('a')!;
    expect(link.getAttribute('href')).toBe('https://dms.example/folders/42');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    const select = row.querySelector<HTMLSelectElement>('[data-role-select]')!;
    expect(select.value).toBe('1');
    expect(Array.from(select.options).map((o) => o.textContent!.trim())).toEqual([
      'None',
      'Source',
      'Destination',
    ]);
  });

  it('puts the list in its own labelled, focusable scroll region and keeps the actions outside it', async () => {
    await create();
    const region = q('[data-assets-scroll]');
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('aria-label')).toBe('Linked assets, scrollable');
    expect(region.querySelector('[data-asset-id="9"] [data-unlink]')).not.toBeNull();
    expect(region.querySelector('[data-link-open]')).toBeNull(); // the Link asset button stays in the heading row
    expect(q('section').getAttribute('aria-label')).toBe('Assets');
  });

  it('shows the empty state', async () => {
    await create({ items: [], canEdit: true });
    expect(q('[data-empty]').textContent).toBe('No assets linked.');
  });

  it('is read-only when the host says so: no link button, no role select, no remove', async () => {
    await create({ items: [aLink()], canEdit: true }, { readOnly: true });

    expect(el().querySelector('[data-link-open]')).toBeNull();
    expect(el().querySelector('[data-role-select]')).toBeNull();
    expect(el().querySelector('[data-unlink]')).toBeNull();
    expect(q('[data-role]').textContent).toBe('Source');
  });

  it('explains a closed task', async () => {
    await create({ items: [aLink()], canEdit: false }, { readOnly: true, taskStatus: 'COMPLETED' });
    expect(q('[data-closed-note]').textContent).toContain('Completed or Cancelled');
  });

  it('is read-only when the server says the caller cannot change links', async () => {
    await create({ items: [aLink()], canEdit: false });
    expect(el().querySelector('[data-link-open]')).toBeNull();
    expect(el().querySelector('[data-unlink]')).toBeNull();
    expect(el().querySelector('[data-closed-note]')).toBeNull();
  });

  it('links an asset picked from the task matter, with a relationship', async () => {
    await create();
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);

    q<HTMLButtonElement>('[data-link-open]').click();
    await settle(fixture);
    const box = q<HTMLInputElement>('input[role=combobox]');
    box.dispatchEvent(new Event('focus'));
    await settle(fixture);
    expect(assets.lookupAssets).toHaveBeenCalledWith(7, undefined, undefined, 20);

    el()
      .querySelector('[role=option]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await settle(fixture);
    const role = q<HTMLSelectElement>('[data-link-role]');
    role.value = '2';
    role.dispatchEvent(new Event('change'));
    await settle(fixture);
    q<HTMLButtonElement>('[data-link-submit]').click();
    await settle(fixture);

    expect(api.linkTaskAsset).toHaveBeenCalledWith(42, { assetId: 11, assetLinkRoleId: 2 });
    expect(el().querySelector('[data-link-form]')).toBeNull();
    expect(api.listTaskAssets).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('needs an asset before linking', async () => {
    await create();
    q<HTMLButtonElement>('[data-link-open]').click();
    await settle(fixture);
    expect(q<HTMLButtonElement>('[data-link-submit]').disabled).toBe(true);
  });

  it('shows the server message when linking is rejected (duplicate, other matter, inactive)', async () => {
    await create();
    api.linkTaskAsset.mockReturnValue(
      apiError(409, {
        status: 409,
        code: 'CROSS_MATTER_REFERENCE',
        detail:
          "That asset belongs to a different matter than the task. Link an asset of the task's matter.",
      }),
    );
    q<HTMLButtonElement>('[data-link-open]').click();
    await settle(fixture);
    q<HTMLInputElement>('input[role=combobox]').dispatchEvent(new Event('focus'));
    await settle(fixture);
    el()
      .querySelector('[role=option]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await settle(fixture);
    q<HTMLButtonElement>('[data-link-submit]').click();
    await settle(fixture);

    expect(q('[data-link-error]').textContent).toContain('different matter');
    expect(el().querySelector('[data-link-form]')).not.toBeNull();
  });

  it('changes the relationship of a link', async () => {
    await create();
    const select = q<HTMLSelectElement>('[data-role-select]');
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(api.changeTaskAssetRole).toHaveBeenCalledWith(42, 9, {
      assetLinkRoleId: 2,
      rowVersion: 'LLLL',
    });
  });

  it('clears the relationship', async () => {
    await create();
    const select = q<HTMLSelectElement>('[data-role-select]');
    select.value = '';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(api.changeTaskAssetRole).toHaveBeenCalledWith(42, 9, {
      assetLinkRoleId: undefined,
      rowVersion: 'LLLL',
    });
  });

  it('keeps a deactivated relationship selectable on the link that has it', async () => {
    await create({
      items: [aLink({ assetLinkRoleId: 3, assetLinkRoleName: 'Retired' })],
      canEdit: true,
    });
    const select = q<HTMLSelectElement>('[data-role-select]');
    expect(Array.from(select.options).map((o) => o.textContent!.trim())).toContain('Retired');
    expect(select.value).toBe('3');
  });

  it('confirms before removing a link', async () => {
    await create();
    q<HTMLButtonElement>('[data-unlink]').click();
    await settle(fixture);
    const dialog = document.body.querySelector('p-dialog') as HTMLElement;
    expect(dialog.textContent).toContain('Remove the link to Contract bundle?');
    expect(api.unlinkTaskAsset).not.toHaveBeenCalled();

    api.listTaskAssets.mockReturnValue(ok({ items: [], canEdit: true }));
    buttonByLabel(dialog, 'Remove link')!.click();
    await settle(fixture);

    expect(api.unlinkTaskAsset).toHaveBeenCalledWith(42, 9);
    expect(q('[data-empty]')).not.toBeNull();
  });

  it('shows the error when the task closed in the meantime', async () => {
    await create();
    api.unlinkTaskAsset.mockReturnValue(
      apiError(409, {
        status: 409,
        code: 'TASK_NOT_EDITABLE',
        detail: "A completed task can't be changed; reopen it first.",
      }),
    );
    q<HTMLButtonElement>('[data-unlink]').click();
    await settle(fixture);
    buttonByLabel(document.body.querySelector('p-dialog') as HTMLElement, 'Remove link')!.click();
    await settle(fixture);

    expect(q('[data-row-error]').textContent).toContain("can't be changed");
  });

  it('shows a note instead of the list, and loads nothing, without the Asset.View permission', async () => {
    await create({ items: [aLink()], canEdit: false }, {}, ['Task.View']);

    expect(q('[data-no-access]').textContent).toContain("don't have permission to view assets");
    expect(api.listTaskAssets).not.toHaveBeenCalled();
    expect(el().querySelector('[data-asset-id]')).toBeNull();
    expect(el().querySelector('[data-link-open]')).toBeNull();
  });

  it('offers a retry when loading fails', async () => {
    await create();
    api.listTaskAssets.mockReturnValue(apiError(500, { status: 500, title: 'x' }));
    fixture.componentRef.setInput('taskId', 43);
    await settle(fixture);
    expect(q('[data-load-error]')).not.toBeNull();

    api.listTaskAssets.mockReturnValue(ok({ items: [aLink()], canEdit: true }));
    q<HTMLButtonElement>('[data-load-error] button').click();
    await settle(fixture);
    expect(el().querySelector('[data-asset-id]')).not.toBeNull();
  });
});
