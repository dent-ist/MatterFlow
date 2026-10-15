import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import {
  AssetsClient,
  AuditEventsClient,
  MattersClient,
  ProjectsClient,
  TaskQueueClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import {
  FakeMeApi,
  aMatter,
  aProject,
  apiError,
  buttonByLabel,
  fakeQuery,
  ok,
  pageOfProjects,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { anAssetListItem, pageOfAssets } from '../../../shared/testing/asset-testing';
import {
  aRow,
  pageOf,
  provideClock,
  provideLookups,
} from '../../../shared/work-queue/work-queue-testing';
import { MatterDetailPage } from './matter-detail-page';

describe('MatterDetailPage', () => {
  let matters: { getMatter: ReturnType<typeof vi.fn>; setMatterActive: ReturnType<typeof vi.fn> };
  let projects: { listProjects: ReturnType<typeof vi.fn> };
  let assets: { listAssets: ReturnType<typeof vi.fn> };
  let queue: { getTaskQueue: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<MatterDetailPage>;
  let query: ReturnType<typeof fakeQuery>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let writeText: ReturnType<typeof vi.fn>;
  const el = (): HTMLElement => fixture.nativeElement;

  async function create(permissions: Permission[], matter = aMatter()): Promise<void> {
    localStorage.clear();
    query = fakeQuery();
    matters = {
      getMatter: vi.fn().mockReturnValue(ok(matter)),
      setMatterActive: vi.fn().mockReturnValue(ok(aMatter({ isActive: false }))),
    };
    projects = { listProjects: vi.fn().mockReturnValue(ok(pageOfProjects(aProject()))) };
    assets = { listAssets: vi.fn().mockReturnValue(ok(pageOfAssets(anAssetListItem()))) };
    queue = { getTaskQueue: vi.fn().mockReturnValue(ok(pageOf([aRow()]))) };
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
        { provide: TaskQueueClient, useValue: queue },
        query.provider,
        ...provideLookups(),
        ...provideClock('2026-10-14T15:00:00Z'),
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

  /** The tab lives in the address (`?tab=`); the router binds it to the page input, so tests set the input. */
  async function openTab(key: string | undefined): Promise<void> {
    fixture.componentRef.setInput('tab', key);
    await settle(fixture);
  }

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
    expect(buttonByLabel(el(), 'Set active')).toBeDefined();
  });

  it('has Tasks, Projects and Assets tabs; Tasks needs Task.View, Projects lists the matter projects', async () => {
    await create(['Matter.View', 'Project.View']);

    expect(
      Array.from(el().querySelectorAll('[role=tab]')).map((t) => t.textContent!.trim()),
    ).toEqual(['Tasks (0)', 'Projects (1)', 'Assets']);
    // The first tab (Tasks) is selected on open; without Task.View it says so and loads nothing.
    expect(el().querySelector('[data-no-access=tasks]')).not.toBeNull();
    expect(queue.getTaskQueue).not.toHaveBeenCalled();
    expect(projects.listProjects).toHaveBeenCalledWith(
      undefined,
      7,
      undefined,
      undefined,
      undefined,
      1,
      100,
      'name',
    );
    await openTab('projects');
    expect(el().querySelector('tbody a')?.getAttribute('href')).toBe('/projects/3');

    await openTab(undefined);
    expect(el().querySelector('[data-no-access=tasks]')).not.toBeNull();
    await openTab('assets');
    expect(el().querySelector('[data-no-access=assets]')).not.toBeNull();
    expect(assets.listAssets).not.toHaveBeenCalled();
    // The old Details tab is gone: its link just shows the page (default tab) with the Details panel beside it.
    await openTab('details');
    expect(el().querySelector('[data-no-access=tasks]')).not.toBeNull();
    expect(el().querySelector('aside dl')?.textContent).toContain('Merger Review');
  });

  it('keeps the tab in the address', async () => {
    await create(['Matter.View', 'Project.View']);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    tab('Projects').click();
    expect(navigate).toHaveBeenCalledWith([], {
      // The Assets tab's filters, paging and sort belong to that tab only.
      queryParams: {
        tab: 'projects',
        name: null,
        typeId: null,
        extref: null,
        status: null,
        page: null,
        size: null,
        sort: null,
      },
      queryParamsHandling: 'merge',
    });
    expect(tab('Tasks').getAttribute('aria-selected')).toBe('true'); // the page input follows the address
  });

  it('puts the Details in a labelled panel beside the main area, with no Details or Activity tab', async () => {
    await create(['Matter.View', 'Audit.View'], aMatter({ isSensitive: true }));

    const aside = el().querySelector('aside')!;
    const heading = document.getElementById(aside.getAttribute('aria-labelledby')!)!;
    expect(heading.textContent?.trim()).toBe('Details');
    const text = aside.textContent!;
    for (const part of ['00343-00012', 'Merger Review', 'Active', 'Sensitive', 'Created']) {
      expect(text).toContain(part);
    }
    expect(aside.querySelector('mf-sensitive-badge')).not.toBeNull();
    expect(el().querySelector('mf-tabs')!.textContent).not.toMatch(/Details|Activity/);
    // Activity is a header button that opens the drawer.
    expect(el().querySelector('[data-page-actions]')!.textContent).toContain('Activity');
  });

  it('opens Activity in a drawer from the header button and for ?tab=activity; needs Audit.View', async () => {
    await create(['Matter.View', 'Audit.View']);
    expect(document.body.querySelector('.mf-drawer')).toBeNull();

    buttonByLabel(el(), 'Activity')!.click();
    await settle(fixture);
    const drawer = document.body.querySelector('.mf-drawer') as HTMLElement;
    expect(drawer.textContent).toContain('Activity: Merger Review');
    expect(drawer.querySelector('mf-entity-activity')).not.toBeNull();

    TestBed.resetTestingModule();
    await create(['Matter.View']);
    expect(buttonByLabel(el(), 'Activity')).toBeUndefined();
    fixture.componentRef.setInput('tab', 'activity');
    await settle(fixture);
    expect(document.body.querySelector('.mf-drawer')).toBeNull();
  });

  it('opens the Activity drawer for an old ?tab=activity link', async () => {
    TestBed.resetTestingModule();
    await create(['Matter.View', 'Audit.View']);
    fixture.componentRef.setInput('tab', 'activity');
    await settle(fixture);
    expect(document.body.querySelector('.mf-drawer')?.textContent).toContain('Activity: ');
    expect(tab('Tasks').getAttribute('aria-selected')).toBe('true');
  });

  it('lists the matter tasks in the Tasks tab (open by default, All on request); Create task is offered once, in the header', async () => {
    await create(['Matter.View', 'Task.View', 'Task.Create'], aMatter({ openTaskCount: 3 }));

    expect(tab('Tasks').textContent?.trim()).toBe('Tasks (3)');
    let args = queue.getTaskQueue.mock.calls[0];
    expect(args[9]).toBe(7);
    expect(args[10]).toBeUndefined();
    expect(args[1]).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']);
    expect(el().querySelector('tbody tr[data-task=TSK-1042] a')?.getAttribute('href')).toBe(
      '/tasks/1042',
    );

    const filter = el().querySelector<HTMLSelectElement>('[data-status-filter]')!;
    filter.value = 'all';
    filter.dispatchEvent(new Event('change'));
    await settle(fixture);
    args = queue.getTaskQueue.mock.calls.at(-1)!;
    expect(args[1]).toBeUndefined();

    expect(el().querySelector('mf-scoped-tasks [data-create-task]')).toBeNull();
    buttonByLabel(el(), 'Create task in this matter')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/tasks/new?matterId=7');
  });

  it('shows an empty state and a retry when the matter tasks cannot be loaded', async () => {
    await create(['Matter.View', 'Task.View']);
    queue.getTaskQueue.mockReturnValue(ok(pageOf([])));
    await openTab('projects');
    await openTab(undefined);
    expect(el().querySelector('[data-empty=tasks]')?.textContent).toContain('No open tasks.');

    queue.getTaskQueue.mockReturnValue(apiError(500, { title: 'x', status: 500 } as never));
    await openTab('projects');
    await openTab(undefined);
    expect(el().querySelector('[data-error]')).not.toBeNull();
  });

  it('lists the matter assets in the Assets tab with column filters, server-side, and links to the asset', async () => {
    await create(['Matter.View', 'Asset.View', 'Asset.Create']);

    await openTab('assets');

    expect(assets.listAssets).toHaveBeenCalledWith(
      7,
      undefined,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      25,
      undefined,
    );
    const grid = el().querySelector('mf-matter-assets')!;
    expect(grid.querySelector('tbody a')?.getAttribute('href')).toBe('/assets?selected=9');
    expect(buttonByLabel(el(), 'New asset')).toBeDefined();
    // The standalone search box and status select are gone: Name, Type, External reference and Status are column filters.
    expect(grid.querySelector('#matter-asset-search, #matter-asset-status')).toBeNull();
    expect(grid.querySelector('[data-filter-row]')).toBeNull(); // closed by default
    grid.querySelector<HTMLButtonElement>('[data-filters-toggle]')!.click();
    await settle(fixture);
    for (const name of ['Name', 'External reference'])
      expect(grid.querySelector(`input[aria-label="Filter by ${name}"]`), name).not.toBeNull();
    expect(
      grid.querySelector<HTMLSelectElement>('select[aria-label="Filter by Status"]')!.value,
    ).toBe('active');
    expect(grid.querySelector('[aria-label^="Filter by Type"]')).not.toBeNull();

    // The filters come from the address (same parameter names as the Assets screen).
    query.set({ name: 'contract', extref: 'WS', typeId: '4', status: 'all' });
    fixture.componentRef.setInput('status', 'all');
    await settle(fixture);
    expect(assets.listAssets).toHaveBeenLastCalledWith(
      7,
      [4],
      undefined,
      undefined,
      'contract',
      'WS',
      undefined,
      1,
      25,
      undefined,
    );

    buttonByLabel(el(), 'New asset')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/assets/new?matterId=7');
  });

  it('gates Edit, New project and the activation button by permission', async () => {
    await create(['Matter.View']);
    expect(buttonByLabel(el(), 'Edit')).toBeUndefined();
    expect(buttonByLabel(el(), 'New project')).toBeUndefined();
    expect(buttonByLabel(el(), 'Set inactive')).toBeUndefined();

    TestBed.resetTestingModule();
    await create(['Matter.View', 'Matter.Edit', 'Project.Create']);
    buttonByLabel(el(), 'New project')!.click();
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
