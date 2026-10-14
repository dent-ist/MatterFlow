import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import {
  AssetsClient,
  AuditEventsClient,
  MattersClient,
  ProjectsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import {
  FakeMeApi,
  aMatter,
  aProject,
  apiError,
  buttonByLabel,
  ok,
  pageOfProjects,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { anAssetListItem, pageOfAssets } from '../../../shared/testing/asset-testing';
import { MatterDetailPage } from './matter-detail-page';

describe('MatterDetailPage', () => {
  let matters: { getMatter: ReturnType<typeof vi.fn>; setMatterActive: ReturnType<typeof vi.fn> };
  let projects: { listProjects: ReturnType<typeof vi.fn> };
  let assets: { listAssets: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<MatterDetailPage>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let writeText: ReturnType<typeof vi.fn>;
  const el = (): HTMLElement => fixture.nativeElement;

  async function create(permissions: Permission[], matter = aMatter()): Promise<void> {
    matters = {
      getMatter: vi.fn().mockReturnValue(ok(matter)),
      setMatterActive: vi.fn().mockReturnValue(ok(aMatter({ isActive: false }))),
    };
    projects = { listProjects: vi.fn().mockReturnValue(ok(pageOfProjects(aProject()))) };
    assets = { listAssets: vi.fn().mockReturnValue(ok(pageOfAssets(anAssetListItem()))) };
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: MattersClient, useValue: matters },
        { provide: ProjectsClient, useValue: projects },
        { provide: AssetsClient, useValue: assets },
        {
          provide: AuditEventsClient,
          useValue: { listAuditEvents: vi.fn().mockReturnValue(ok({ items: [] })) },
        },
      ],
    });
    navigateByUrl = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(MatterDetailPage);
    fixture.componentRef.setInput('matterId', '7');
    await settle(fixture);
  }

  const tab = (label: string): HTMLElement =>
    Array.from(el().querySelectorAll<HTMLElement>('[role=tab]')).find((t) =>
      t.textContent!.trim().startsWith(label),
    )!;

  it('shows the reference with a copy button, the client and the status', async () => {
    await create(['Matter.View', 'Project.View']);

    expect(el().querySelector('h1 .mf-ref')?.textContent).toBe('00343-00012');
    expect(el().querySelector('[data-client]')?.textContent).toContain('00343');
    expect(el().querySelector('[data-client] a')?.getAttribute('href')).toBe('/clients/1');
    el().querySelector<HTMLButtonElement>('h1 mf-copy-button button')!.click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith('00343-00012');
  });

  it('shows the sensitivity warning banner only for sensitive matters (display only)', async () => {
    await create(['Matter.View'], aMatter({ isSensitive: true }));
    const banner = el().querySelector('[data-sensitive-banner]');
    expect(banner?.textContent).toContain('Sensitive matter');
    expect(banner?.textContent).toContain('does not restrict');
    expect(banner?.getAttribute('role')).toBe('note');

    TestBed.resetTestingModule();
    await create(['Matter.View'], aMatter({ isSensitive: false }));
    expect(el().querySelector('[data-sensitive-banner]')).toBeNull();
  });

  it('shows a persistent banner for an inactive matter and offers Reactivate', async () => {
    await create(['Matter.View', 'Matter.SetActive'], aMatter({ isActive: false }));

    expect(el().querySelector('[data-inactive-banner]')?.textContent).toContain(
      "New tasks can't be created and completed or cancelled tasks can't be reopened.",
    );
    expect(buttonByLabel(el(), 'Reactivate')).toBeDefined();
  });

  it('has Tasks, Projects and Assets tabs; Tasks is a placeholder, Projects lists the matter projects', async () => {
    await create(['Matter.View', 'Project.View']);

    expect(
      Array.from(el().querySelectorAll('[role=tab]')).map((t) => t.textContent!.trim()),
    ).toEqual(['Tasks (0 open)', 'Projects (1)', 'Assets', 'Details']);
    expect(projects.listProjects).toHaveBeenCalledWith(undefined, 7, undefined, 1, 100, 'name');
    expect(el().querySelector('tbody a')?.getAttribute('href')).toBe('/projects/3');

    tab('Tasks').click();
    await settle(fixture);
    expect(el().querySelector('[data-placeholder=tasks]')).not.toBeNull();
    tab('Assets').click();
    await settle(fixture);
    expect(el().querySelector('[data-no-access=assets]')).not.toBeNull();
    expect(assets.listAssets).not.toHaveBeenCalled();
    tab('Details').click();
    await settle(fixture);
    expect(el().querySelector('dl')?.textContent).toContain('Merger Review');
  });

  it('lists the matter assets in the Assets tab with server-side search and links to the asset', async () => {
    await create(['Matter.View', 'Asset.View', 'Asset.Create']);

    tab('Assets').click();
    await settle(fixture);

    expect(assets.listAssets).toHaveBeenCalledWith(
      7,
      undefined,
      true,
      undefined,
      1,
      25,
      'displayName',
    );
    expect(el().querySelector('mf-matter-assets tbody a')?.getAttribute('href')).toBe('/assets/9');
    expect(buttonByLabel(el(), 'New Asset')).toBeDefined();

    const box = el().querySelector<HTMLInputElement>('#matter-asset-search')!;
    box.value = 'contract';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle(fixture);
    expect(assets.listAssets).toHaveBeenLastCalledWith(
      7,
      undefined,
      true,
      'contract',
      1,
      25,
      'displayName',
    );

    buttonByLabel(el(), 'New Asset')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/assets/new?matterId=7');
  });

  it('gates Edit, New Project and the activation button by permission', async () => {
    await create(['Matter.View']);
    expect(buttonByLabel(el(), 'Edit')).toBeUndefined();
    expect(buttonByLabel(el(), 'New Project')).toBeUndefined();
    expect(buttonByLabel(el(), 'Set inactive')).toBeUndefined();

    TestBed.resetTestingModule();
    await create(['Matter.View', 'Matter.Edit', 'Project.Create']);
    buttonByLabel(el(), 'New Project')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/projects/new?matterId=7');
    buttonByLabel(el(), 'Edit')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/matters/7/edit');
  });

  it('confirms before deactivating and saves with the row version', async () => {
    await create(['Matter.View', 'Matter.SetActive']);

    buttonByLabel(el(), 'Set inactive')!.click();
    await settle(fixture);
    const dialog = document.body.querySelector('p-dialog') as HTMLElement;
    expect(dialog.querySelector('[data-toggle-body]')?.textContent).toContain(
      "Set 00343-00012 inactive? New tasks can't be created and completed or cancelled tasks can't be reopened until it's active again.",
    );
    expect(matters.setMatterActive).not.toHaveBeenCalled();

    buttonByLabel(dialog, 'Set inactive')!.click();
    await settle(fixture);
    expect(matters.setMatterActive).toHaveBeenCalledWith(7, {
      isActive: false,
      rowVersion: 'BBBB',
    });
    expect(el().querySelector('[data-inactive-banner]')).not.toBeNull();
  });

  it('disables deactivation with a visible reason while tasks are open', async () => {
    await create(['Matter.View', 'Matter.SetActive'], aMatter({ openTaskCount: 3 }));

    expect(buttonByLabel(el(), 'Set inactive')!.disabled).toBe(true);
    expect(el().querySelector('[data-toggle-reason]')?.textContent).toContain(
      "This matter has 3 tasks that aren't Completed or Cancelled. Finish or cancel them first.",
    );
  });

  it('explains a server refusal (open tasks) in a dialog with a way to the open tasks', async () => {
    await create(['Matter.View', 'Matter.SetActive', 'Task.View']);
    matters.setMatterActive.mockReturnValue(
      apiError(409, { status: 409, code: 'MATTER_HAS_OPEN_TASKS', meta: { openTaskCount: 2 } }),
    );

    buttonByLabel(el(), 'Set inactive')!.click();
    await settle(fixture);
    buttonByLabel(document.body.querySelector('p-dialog') as HTMLElement, 'Set inactive')!.click();
    await settle(fixture);

    const blocked = document.body.querySelector('[data-blocked-body]')!;
    expect(blocked.textContent).toContain(
      "This matter has 2 tasks that aren't Completed or Cancelled. Finish or cancel them first.",
    );
    buttonByLabel(blocked.closest('p-dialog') as HTMLElement, 'View open tasks')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/tasks?matterId=7');
    expect(el().querySelector('[data-inactive-banner]')).toBeNull(); // still active
  });

  it('shows a not-found state', async () => {
    await create(['Matter.View']);
    matters.getMatter.mockReturnValue(apiError(404, { status: 404, code: 'NOT_FOUND' }));
    await fixture.componentInstance.load();
    await settle(fixture);

    expect(el().querySelector('[role=alert]')?.textContent).toContain("couldn't find that matter");
  });
});
