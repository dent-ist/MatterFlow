import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  AssetsClient,
  AuditEventsClient,
  MatterManagersClient,
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
  openOverflow,
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
  provideQueueChoices,
} from '../../../shared/work-queue/work-queue-testing';
import { ProjectResponse } from '../../../api/generated/api-client';
import { MatterDetailPage } from './matter-detail-page';

describe('MatterDetailPage', () => {
  let matters: {
    getMatter: ReturnType<typeof vi.fn>;
    setMatterActive: ReturnType<typeof vi.fn>;
    getMatterSummary: ReturnType<typeof vi.fn>;
    setMatterManagers: ReturnType<typeof vi.fn>;
  };
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
      setMatterManagers: vi
        .fn()
        .mockReturnValue(
          ok(aMatter({ primaryManager: { userId: 12, displayName: 'Bob Roe', isActive: true } })),
        ),
      getMatterSummary: vi.fn().mockReturnValue(
        ok({
          matterId: 7,
          openTasks: 9,
          overdue: 3,
          dueSoon: 1,
          asap: 1,
          onHold: 1,
          unassigned: 2,
          projectCount: 1,
          assetCount: 0,
        }),
      ),
    };
    projects = { listProjects: vi.fn().mockReturnValue(ok(pageOfProjects(aProject()))) };
    assets = { listAssets: vi.fn().mockReturnValue(ok(pageOfAssets(anAssetListItem()))) };
    queue = { getTaskQueue: vi.fn().mockReturnValue(ok(pageOf([aRow()]))) };
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: MattersClient, useValue: matters },
        {
          provide: MatterManagersClient,
          useValue: {
            lookupMatterManagers: vi.fn().mockReturnValue(
              ok([
                { userId: 11, displayName: 'Ann Lee', availability: { state: 'AVAILABLE' } },
                {
                  userId: 12,
                  displayName: 'Bob Roe',
                  availability: { state: 'OUT_OF_OFFICE', outUntil: '2026-10-30T00:00:00Z' },
                },
              ]),
            ),
          },
        },
        { provide: ProjectsClient, useValue: projects },
        { provide: AssetsClient, useValue: assets },
        { provide: TaskQueueClient, useValue: queue },
        query.provider,
        ...provideLookups(),
        ...provideQueueChoices(),
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
    await create(['Matter.View', 'Project.View', 'Client.View']);

    expect(el().querySelector('h1 .mf-ref')?.textContent).toBe('00343-00012');
    expect(el().querySelector('[data-client]')?.textContent).toContain('00343');
    expect(el().querySelector('[data-client] a')?.getAttribute('href')).toBe('/clients/1');
    el().querySelector<HTMLButtonElement>('h1 mf-copy-button button')!.click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith('00343-00012');
  });

  it('shows the sensitivity note in the header only for sensitive matters (access rule in the note), with a badge that points to it', async () => {
    await create(['Matter.View'], aMatter({ isSensitive: true }));
    const banner = el().querySelector('[data-record-header] [data-sensitive-banner]');
    expect(banner?.textContent).toContain('Sensitive matter');
    expect(banner?.textContent).toContain('Only its project managers');
    expect(banner?.textContent).not.toContain('does not restrict');
    expect(banner?.getAttribute('role')).toBe('note');
    expect(el().querySelector('h1 mf-sensitive-badge span')?.getAttribute('aria-describedby')).toBe(
      banner?.id,
    );

    TestBed.resetTestingModule();
    await create(['Matter.View'], aMatter({ isSensitive: false }));
    expect(el().querySelector('[data-sensitive-banner]')).toBeNull();
  });

  it('shows a persistent banner for an inactive matter and offers Reactivate', async () => {
    await create(['Matter.View', 'Matter.SetActive'], aMatter({ isActive: false }));

    expect(el().querySelector('[data-inactive-banner]')?.textContent).toContain(
      "New tasks can't be created and completed or cancelled tasks can't be reopened.",
    );
    await openOverflow(fixture);
    expect(buttonByLabel(el(), 'Set active')).toBeDefined();
  });

  it('keeps Create task focusable with its reason while the matter is inactive', async () => {
    await create(['Matter.View', 'Task.Create'], aMatter({ isActive: false }));
    const button = el().querySelector<HTMLButtonElement>('[data-action=create-task]')!;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
      "This matter is inactive. New tasks can't be created.",
    );
    button.click();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('has Overview, Tasks, Projects and Assets tabs, Overview first and the default; Tasks needs Task.View, Projects lists the matter projects', async () => {
    await create(['Matter.View', 'Project.View']);

    expect(
      Array.from(el().querySelectorAll('[role=tab]')).map((t) => t.textContent!.trim()),
    ).toEqual(['Overview', 'Tasks', 'Projects (1)']); // Assets needs Asset.View
    // The first tab (Overview) is selected on open and loads no task list.
    expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
    expect(el().querySelector('[data-details-tab] dl')?.textContent).toContain('Acme Corp');
    expect(queue.getTaskQueue).not.toHaveBeenCalled();
    // Without Task.View the Tasks tab says so and loads nothing.
    await openTab('tasks');
    expect(el().querySelector('[data-no-access=tasks]')).not.toBeNull();
    expect(queue.getTaskQueue).not.toHaveBeenCalled();
    expect(projects.listProjects).toHaveBeenCalledWith(
      undefined,
      7,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      100,
      'name',
    );
    await openTab('projects');
    expect(el().querySelector('tbody a')?.getAttribute('href')).toBe('/projects/3');

    // A link to the Assets tab without Asset.View shows the Overview and asks for no assets.
    await openTab('assets');
    expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
    expect(assets.listAssets).not.toHaveBeenCalled();
    expect(matters.getMatterSummary).not.toHaveBeenCalled();
    // No parameter, ?tab=details and an unknown value all show the Overview.
    for (const key of [undefined, 'details', 'nonsense']) {
      await openTab(key);
      expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
    }
    expect(el().querySelector('aside')).toBeNull();
  });

  it('keeps the tab in the address', async () => {
    await create(['Matter.View', 'Project.View']);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    tab('Projects').click();
    expect(navigate).toHaveBeenCalledWith([], {
      // The filters of the Tasks and Assets tabs, and the Assets paging and sort, belong to their tab only.
      queryParams: {
        tab: 'projects',
        name: null,
        typeId: null,
        extref: null,
        q: null,
        status: null,
        project: null,
        priority: null,
        assignee: null,
        unassigned: null,
        dueFrom: null,
        dueTo: null,
        view: null,
        page: null,
        size: null,
        sort: null,
      },
      queryParamsHandling: 'merge',
    });
    expect(tab('Overview').getAttribute('aria-selected')).toBe('true'); // the page input follows the address

    // Overview is the default tab, so it leaves no `tab` in the address; Tasks does.
    const lastTab = (): unknown =>
      (navigate.mock.lastCall![1] as { queryParams: { tab: unknown } }).queryParams.tab;
    await openTab('projects');
    tab('Overview').click();
    expect(lastTab()).toBeNull();
    tab('Tasks').click();
    expect(lastTab()).toBe('tasks');
  });

  it('shows the Overview as the first tab, in the full-width tab panel, with no side panel and no Activity tab; the title facts are not repeated', async () => {
    await create(
      ['Matter.View', 'Audit.View', 'Client.View', 'Task.View'],
      aMatter({ isSensitive: true, modifiedAtUtc: '2026-10-05T12:00:00Z' }),
    );

    expect(el().querySelector('aside')).toBeNull();
    const panel = el().querySelector('[role=tabpanel]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe('matter-tab-details');
    const overview = panel.querySelector('[data-details-tab]')!;
    const rows = Array.from(overview.querySelectorAll('dt')).map((t) => t.textContent!.trim());
    // The reference, the matter number and the name are in the header: not a row again.
    expect(rows).toEqual(['Client', 'Status', 'Sensitive', 'Created', 'Last changed']);
    expect(overview.querySelector('dl')!.textContent).not.toContain('00343-00012');
    expect(overview.querySelector('dl')!.textContent).not.toContain('Merger Review');
    expect(overview.querySelector('mf-sensitive-badge')).not.toBeNull();
    expect(overview.querySelector('[data-client-value] a')?.getAttribute('href')).toBe(
      '/clients/1',
    );
    expect(el().querySelector('mf-tabs')!.textContent).not.toMatch(/Activity/);
    // Activity is a header button that opens the drawer.
    expect(el().querySelector('[data-page-actions]')!.textContent).toContain('Activity');
  });

  it('shows each count once: the Overview has no strip of its own, the header strip carries all six counts (#816)', async () => {
    await create(['Matter.View', 'Task.View']);
    expect(matters.getMatterSummary).toHaveBeenCalledWith(7);
    expect(el().querySelector('[data-matter-overview] [data-strip]')).toBeNull();
    expect(el().querySelector('[data-matter-overview] mf-summary-strip')).toBeNull();
    const links = Array.from(
      el().querySelectorAll<HTMLAnchorElement>('mf-matter-health-strip [data-strip-item]'),
    );
    expect(links.map((a) => a.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Open 9',
      'Overdue 3',
      'Due soon 1',
      'ASAP 1',
      'Unassigned 2',
      'On hold 1',
    ]);
    const hrefs = links.map((a) => a.getAttribute('href')!);
    expect(hrefs.every((h) => h.startsWith('/tasks?matter=7'))).toBe(true);
    expect(hrefs[1]).toContain('overdue=true');
    expect(hrefs[2]).toContain('asap=false&overdue=false&dueTo=');
    expect(hrefs[3]).toContain('asap=true');
    expect(hrefs[4]).toContain('unassigned=true');
    expect(hrefs[5]).toContain('status=ON_HOLD');
  });

  it('has no strip and asks for no numbers without Task.View, and the tab is still complete', async () => {
    await create(['Matter.View']);
    expect(matters.getMatterSummary).not.toHaveBeenCalled();
    expect(el().querySelector('[data-strip]')).toBeNull();
    expect(el().querySelector('[role=alert]')).toBeNull();
    expect(el().querySelector('[data-details-tab] dl')).not.toBeNull();
  });

  it('shows the client as plain text without Client.View', async () => {
    await create(['Matter.View']);
    expect(el().querySelector('[data-client-value] a')).toBeNull();
    expect(el().querySelector('[data-client-value]')!.textContent).toContain('Acme Corp');
    expect(el().querySelector('[data-client] a')).toBeNull();
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
    expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
  });

  it('lists the matter tasks in the Tasks tab (open by default, All on request); Create task is offered once, in the header', async () => {
    await create(['Matter.View', 'Task.View', 'Task.Create'], aMatter({ openTaskCount: 3 }));
    await openTab('tasks');

    expect(tab('Tasks').textContent?.trim()).toBe('Tasks (3)');
    // `group` is argument 0 (#232), then the shared filters.
    let args = queue.getTaskQueue.mock.calls[0];
    expect(args[10]).toBe(7);
    expect(args[11]).toBeUndefined();
    expect(args[2]).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']);
    expect(el().querySelector('tbody tr[data-task=TSK-1042] a')?.getAttribute('href')).toBe(
      '/tasks/1042?from=matter',
    );

    // The "Show" select is the Status column filter now: open by default, every status on request, from the address.
    const grid = el().querySelector('mf-scoped-tasks')!;
    expect(grid.querySelector('[data-filter-row]')).toBeNull(); // closed by default
    expect(grid.querySelector('[data-status-filter]')).toBeNull();
    query.set({ status: '' });
    await settle(fixture);
    args = queue.getTaskQueue.mock.calls.at(-1)!;
    expect(args[2]).toBeUndefined();
    expect(grid.querySelector('[data-filters-toggle]')!.textContent).toContain('(1)');

    expect(el().querySelector('mf-scoped-tasks [data-create-task]')).toBeNull();
    buttonByLabel(el(), 'Create task')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/tasks/new?matterId=7');
  });

  it('shows an empty state and a retry when the matter tasks cannot be loaded', async () => {
    await create(['Matter.View', 'Task.View']);
    queue.getTaskQueue.mockReturnValue(ok(pageOf([])));
    await openTab('projects');
    await openTab('tasks');
    expect(el().querySelector('mf-scoped-tasks tbody [data-empty]')?.textContent).toContain(
      'No open tasks.',
    );

    queue.getTaskQueue.mockReturnValue(apiError(500, { title: 'x', status: 500 } as never));
    await openTab('projects');
    await openTab('tasks');
    expect(el().querySelector('mf-scoped-tasks tbody [data-error]')).not.toBeNull();
    expect(el().querySelector('mf-scoped-tasks thead th')).not.toBeNull(); // the headers stay
  });

  it('filters the matter tasks by the shared column filters from the address, with a Project choice', async () => {
    await create(['Matter.View', 'Task.View', 'Project.View']);
    await openTab('tasks');
    const grid = el().querySelector('mf-scoped-tasks')!;
    grid.querySelector<HTMLButtonElement>('[data-filters-toggle]')!.click();
    await settle(fixture);
    for (const name of ['Title or Ref', 'Priority', 'Assignee', 'Due', 'Status'])
      expect(grid.querySelector(`[aria-label^="Filter by ${name}"]`), name).not.toBeNull();
    expect(grid.querySelector('select[aria-label="Filter by Project"]')).not.toBeNull();

    query.set({ q: 'dedup', priority: '2', project: '3', dueTo: '2026-10-31' });
    await settle(fixture);
    const args = queue.getTaskQueue.mock.calls.at(-1)!;
    expect(args[1]).toBe('dedup');
    expect(args[3]).toEqual([2]);
    expect(args[10]).toBe(7); // the matter
    expect(args[11]).toBe(3); // the project filter
    expect(args[17]).toBe('2026-10-31');
    expect(args[2]).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']); // Open by default
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
      undefined,
      undefined,
      1,
      25,
      undefined,
    );
    const grid = el().querySelector('mf-matter-assets')!;
    expect(grid.querySelector('tbody a')?.getAttribute('href')).toBe('/assets/9');
    // New asset lives in the header overflow now (#274); the tab has no button of its own while it lists assets.
    expect(buttonByLabel(el(), 'New asset')).toBeUndefined();
    expect(grid.querySelector('[data-new-asset], [data-empty-new-asset]')).toBeNull();
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
      undefined,
      undefined,
      1,
      25,
      undefined,
    );
  });

  it('gates Edit, New project and the activation button by permission', async () => {
    await create(['Matter.View']);
    expect(buttonByLabel(el(), 'Edit')).toBeUndefined();
    expect(buttonByLabel(el(), 'New project')).toBeUndefined();
    expect(buttonByLabel(el(), 'Set inactive')).toBeUndefined();
    expect(el().querySelector('[data-overflow]')).toBeNull(); // nothing to put in it: no empty "..."

    TestBed.resetTestingModule();
    await create(['Matter.View', 'Matter.Edit', 'Project.Create']);
    // Edit is in the header; New project is a secondary create, so it is in the overflow.
    expect(buttonByLabel(el(), 'New project')).toBeUndefined();
    await openOverflow(fixture);
    buttonByLabel(el(), 'New project')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/projects/new?matterId=7');
    buttonByLabel(el(), 'Edit')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/matters/7/edit');
  });

  it('puts exactly Edit, Activity, Create task and the overflow (New project, New asset, Set inactive) in the header; no action is left in the Overview tab', async () => {
    await create([
      'Matter.View',
      'Matter.Edit',
      'Matter.SetActive',
      'Project.Create',
      'Asset.Create',
      'Task.Create',
      'Audit.View',
    ]);
    expect(
      Array.from(el().querySelectorAll('[data-page-actions] > button')).map((b) =>
        b.getAttribute('data-action'),
      ),
    ).toEqual(['edit', 'activity', 'create-task']);
    expect(el().querySelector('[data-details-tab] button:not(mf-copy-button button)')).toBeNull();
    const menu = await openOverflow(fixture);
    expect(
      Array.from(menu!.querySelectorAll('[role=menuitem]')).map((b) =>
        b.getAttribute('data-action'),
      ),
    ).toEqual(['new-project', 'new-asset', 'toggle-active']);
    menu!.querySelector<HTMLElement>('[data-action=new-asset]')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/assets/new?matterId=7');
  });

  it('shows the Projects tab action in its empty state', async () => {
    await create(['Matter.View', 'Project.View', 'Project.Create'], aMatter({ projectCount: 0 }));
    projects.listProjects.mockReturnValue(ok(pageOfProjects()));
    await fixture.componentInstance.load();
    await openTab('projects');
    el().querySelector<HTMLButtonElement>('[data-empty-new-project] button')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/projects/new?matterId=7');
  });

  it('confirms before deactivating and saves with the row version', async () => {
    await create(['Matter.View', 'Matter.SetActive']);

    await openOverflow(fixture);
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

    await openOverflow(fixture);
    const item = el().querySelector<HTMLButtonElement>('[data-action=toggle-active]')!;
    expect(item.getAttribute('aria-disabled')).toBe('true'); // focusable, says why
    expect(document.getElementById(item.getAttribute('aria-describedby')!)?.textContent).toContain(
      "This matter has 3 tasks that aren't Completed or Cancelled. Finish or cancel them first.",
    );
    item.click();
    await settle(fixture);
    expect(document.body.querySelector('p-dialog [data-toggle-body]')).toBeNull();
  });

  it('explains a server refusal (open tasks) in a dialog with a way to the open tasks', async () => {
    await create(['Matter.View', 'Matter.SetActive', 'Task.View']);
    matters.setMatterActive.mockReturnValue(
      apiError(409, { status: 409, code: 'MATTER_HAS_OPEN_TASKS', meta: { openTaskCount: 2 } }),
    );

    await openOverflow(fixture);
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

  it('shows the not-found text with a link back and no Retry for a 404', async () => {
    await create(['Matter.View']);
    matters.getMatter.mockReturnValue(apiError(404, { status: 404, code: 'NOT_FOUND' }));
    await fixture.componentInstance.load();
    await settle(fixture);

    expect(el().querySelector('h1')?.textContent).toContain("We couldn't find that matter.");
    expect(el().querySelector('[data-back-link]')?.textContent).toContain('Go to matters');
    expect(buttonByLabel(el(), 'Retry')).toBeUndefined();
    expect(el().querySelector('[role=tablist]')).toBeNull();
  });

  it('shows the access text for a 403 and "Couldn\'t load" with Retry for a server fault', async () => {
    await create(['Matter.View']);
    matters.getMatter.mockReturnValue(apiError(403, { status: 403, code: 'PERMISSION_DENIED' }));
    await fixture.componentInstance.load();
    await settle(fixture);
    expect(el().querySelector('h1')?.textContent).toContain(
      "You don't have access to this matter.",
    );
    expect(buttonByLabel(el(), 'Retry')).toBeUndefined();

    matters.getMatter.mockReturnValue(apiError(500, { status: 500 }));
    await fixture.componentInstance.load();
    await settle(fixture);
    expect(el().querySelector('h1')?.textContent).toContain("Couldn't load this matter.");
    matters.getMatter.mockReturnValue(ok(aMatter()));
    buttonByLabel(el(), 'Retry')!.click();
    await settle(fixture);
    expect(el().querySelector('[data-record-live]')?.textContent).toBe('Loaded');
    expect(buttonByLabel(el(), 'Retry')).toBeUndefined();
  });

  it('names the record and the tab in the document title', async () => {
    await create(['Matter.View', 'Project.View', 'Asset.View']);
    expect(document.title).toBe('00343-00012 Merger Review: Overview - MatterFlow');
    await openTab('projects');
    expect(document.title).toBe('00343-00012 Merger Review: Projects - MatterFlow');
    await openTab('assets');
    expect(document.title).toBe('00343-00012 Merger Review: Assets - MatterFlow');
  });

  it('sorts the Projects tab in natural order (Wave 7 before Wave 15, accents and case ignored)', async () => {
    await create(['Matter.View', 'Project.View']);
    const names = ['Wave 15', 'Wave 7', 'Wave 23', 'Étude 10', 'etude 2'];
    projects.listProjects.mockReturnValue(
      ok(pageOfProjects(...names.map((name, i) => aProject({ projectId: i + 1, name })))),
    );
    await fixture.componentInstance.load();
    await openTab('projects');

    const rows = Array.from(el().querySelectorAll('[data-project-name]')).map((c) =>
      c.textContent!.trim(),
    );
    expect(rows).toEqual(['etude 2', 'Étude 10', 'Wave 7', 'Wave 15', 'Wave 23']);
    expect(el().querySelector('[data-projects-truncated]')).toBeNull();
  });

  it('keeps the server order and says so when the matter has more projects than one page returns', async () => {
    await create(['Matter.View', 'Project.View']);
    projects.listProjects.mockReturnValue(
      ok({
        ...pageOfProjects(
          aProject({ projectId: 1, name: 'Wave 15' }),
          aProject({ projectId: 2, name: 'Wave 7' }),
        ),
        total: 250,
      }),
    );
    await fixture.componentInstance.load();
    await openTab('projects');

    expect(
      Array.from(el().querySelectorAll('[data-project-name]')).map((c) => c.textContent!.trim()),
    ).toEqual(['Wave 15', 'Wave 7']);
    expect(el().querySelector('[data-projects-truncated]')?.textContent).toContain(
      'Showing the first 2 projects.',
    );
  });

  describe('Projects tab (#273)', () => {
    const many = (...rows: Partial<ProjectResponse>[]) =>
      projects.listProjects.mockReturnValue(
        ok(pageOfProjects(...rows.map((r, i) => aProject({ projectId: i + 1, ...r })))),
      );
    const names = (): string[] =>
      Array.from(el().querySelectorAll('[data-project-name]')).map((c) => c.textContent!.trim());
    const toggle = (): HTMLButtonElement =>
      el().querySelector<HTMLButtonElement>('[data-archived-toggle]')!;

    it('has Name, Open tasks, Overdue and Status columns and no Description column', async () => {
      await create(['Matter.View', 'Project.View', 'Task.View']);
      many({ name: 'Alpha', openTaskCount: 4, overdueTaskCount: 2 });
      await fixture.componentInstance.load();
      await openTab('projects');
      expect(
        Array.from(el().querySelectorAll('thead th')).map((h) => h.textContent!.trim()),
      ).toEqual(['Name', 'Open tasks', 'Overdue', 'Status']);
      const cells = el().querySelectorAll('tbody tr')[0].querySelectorAll('td');
      expect(cells[1].querySelector('a')?.getAttribute('aria-label')).toBe('4 open tasks in Alpha');
      expect(cells[2].querySelector('a')?.getAttribute('aria-label')).toBe(
        '2 overdue tasks in Alpha',
      );
    });

    it('leaves the count columns out without Task.View', async () => {
      await create(['Matter.View', 'Project.View']);
      many({ name: 'Alpha', openTaskCount: undefined });
      await fixture.componentInstance.load();
      await openTab('projects');
      expect(
        Array.from(el().querySelectorAll('thead th')).map((h) => h.textContent!.trim()),
      ).toEqual(['Name', 'Status']);
      expect(el().querySelector('mf-task-count')).toBeNull();
    });

    it('shows the description as a muted second line only when there is one', async () => {
      await create(['Matter.View', 'Project.View']);
      many(
        { name: 'With', description: 'Intake of custodian data' },
        { name: 'Without', description: undefined },
      );
      await fixture.componentInstance.load();
      await openTab('projects');
      const rows = el().querySelectorAll('tbody tr');
      const d = rows[0].querySelector('[data-project-description]')!;
      expect(d.textContent!.trim()).toBe('Intake of custodian data');
      expect(d.getAttribute('title')).toBe('Intake of custodian data');
      expect(rows[1].querySelector('[data-project-description]')).toBeNull();
    });

    it('lists Active projects first and keeps Archived in a collapsed group that opens with Enter or Space', async () => {
      await create(['Matter.View', 'Project.View']);
      many(
        { name: 'Zed archived', isActive: false },
        { name: 'Wave 15' },
        { name: 'Wave 7' },
        { name: 'Alpha archived', isActive: false },
      );
      await fixture.componentInstance.load();
      await openTab('projects');
      expect(names()).toEqual(['Wave 7', 'Wave 15']);
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(toggle().textContent!.replace(/\s+/g, ' ').trim()).toBe('Archived (2 projects)');
      toggle().click();
      await settle(fixture);
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(names()).toEqual(['Wave 7', 'Wave 15', 'Alpha archived', 'Zed archived']);
      toggle().click();
      await settle(fixture);
      expect(names()).toEqual(['Wave 7', 'Wave 15']);
    });

    it('starts with the Archived group open when every project is archived, and has no group without archived ones', async () => {
      await create(['Matter.View', 'Project.View']);
      many({ name: 'Old one', isActive: false }, { name: 'Old two', isActive: false });
      await fixture.componentInstance.load();
      await openTab('projects');
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(names()).toEqual(['Old one', 'Old two']);

      many({ name: 'Live' });
      await fixture.componentInstance.load();
      await settle(fixture);
      expect(el().querySelector('[data-archived-toggle]')).toBeNull();
    });
  });

  describe('Assets tab (#274)', () => {
    it('shows a muted dash with the hidden word None for an empty External reference', async () => {
      await create(['Matter.View', 'Asset.View']);
      assets.listAssets.mockReturnValue(
        ok(
          pageOfAssets(
            anAssetListItem({ assetId: 1, externalReference: undefined }),
            anAssetListItem({ assetId: 2, externalReference: 'WS-1' }),
          ),
        ),
      );
      await openTab('assets');
      const cells = el().querySelectorAll('mf-matter-assets tbody tr td:nth-child(3)');
      expect(cells[0].textContent!.replace(/\s+/g, ' ').trim()).toBe('–None');
      expect(cells[0].querySelector('[data-none]')?.getAttribute('aria-hidden')).toBe('true');
      expect(cells[1].textContent!.trim()).toBe('WS-1');
    });

    it('offers New asset in the empty state for a person who may create assets, and nothing otherwise', async () => {
      await create(['Matter.View', 'Asset.View', 'Asset.Create']);
      assets.listAssets.mockReturnValue(ok(pageOfAssets()));
      await openTab('assets');
      el()
        .querySelector<HTMLButtonElement>(
          '[data-empty-new-asset] button, button[data-empty-new-asset]',
        )!
        .click();
      expect(navigateByUrl).toHaveBeenCalledWith('/assets/new?matterId=7');
    });

    it('offers no New asset in the empty state without Asset.Create', async () => {
      await create(['Matter.View', 'Asset.View']);
      assets.listAssets.mockReturnValue(ok(pageOfAssets()));
      await openTab('assets');
      expect(el().querySelector('[data-empty="none"]')).not.toBeNull();
      expect(el().querySelector('[data-empty-new-asset]')).toBeNull();
    });

    it('shows Assets (n) from the summary and hides the tab and the request without Asset.View', async () => {
      await create(['Matter.View', 'Asset.View']);
      expect(tab('Assets').textContent!.replace(/\s+/g, ' ').trim()).toBe('Assets (0)');
    });

    it('has no Assets tab and asks for no summary without Asset.View', async () => {
      await create(['Matter.View']);
      expect(tab('Assets')).toBeUndefined();
      expect(matters.getMatterSummary).not.toHaveBeenCalled();
    });
  });
  describe('project managers and the health strip (epic #667)', () => {
    const ann = { userId: 11, displayName: 'Ann Lee', isActive: true };
    const bob = { userId: 12, displayName: 'Bob Roe', isActive: true };

    it('shows Primary and Secondary in the header line; nothing at all when none is set and the viewer cannot assign', async () => {
      await create(['Matter.View'], aMatter({ primaryManager: ann, secondaryManager: bob }));
      const line = el().querySelector('[data-managers]')!;
      expect(line.textContent).toContain('Project manager:');
      expect(line.querySelector('[data-primary-manager]')?.textContent).toBe('Ann Lee');
      expect(line.textContent).toContain('(primary)');
      expect(line.textContent).toContain('Bob Roe');
      expect(line.textContent).toContain('(secondary)');
      expect(el().querySelector('[data-change-managers]')).toBeNull(); // no Matter.AssignManagers

      TestBed.resetTestingModule();
      await create(['Matter.View'], aMatter());
      expect(el().querySelector('[data-managers]')).toBeNull();
      expect(el().textContent).not.toMatch(/no project manager|unassigned manager/i);
    });

    it('offers a quiet Add project manager link only with Matter.AssignManagers', async () => {
      await create(['Matter.View', 'Matter.AssignManagers'], aMatter());
      expect(el().querySelector('[data-add-managers]')?.textContent?.trim()).toBe(
        'Add project manager',
      );
      expect(el().querySelector('[data-change-managers]')).toBeNull();
    });

    it('Change opens the two-picker dialog, marks out-of-office people, saves with the row version and shows the result', async () => {
      await create(
        ['Matter.View', 'Matter.AssignManagers'],
        aMatter({ rowVersion: 'RV1', primaryManager: ann }),
      );
      const change = el().querySelector<HTMLButtonElement>('[data-change-managers]')!;
      change.focus();
      change.click();
      await settle(fixture);

      const dialog = document.body.querySelector('[data-managers-dialog]')!;
      const primary = dialog.querySelector<HTMLSelectElement>('[data-manager-select=primary]')!;
      const secondary = dialog.querySelector<HTMLSelectElement>('[data-manager-select=secondary]')!;
      expect(primary.value).toBe('11');
      expect(secondary.value).toBe('');
      expect(Array.from(secondary.options).map((o) => o.textContent?.trim())).toEqual([
        'None',
        'Ann Lee',
        expect.stringContaining('Bob Roe (out of office until'),
      ]);
      // The same person twice is refused in the dialog.
      secondary.value = '11';
      secondary.dispatchEvent(new Event('change'));
      await settle(fixture);
      expect(dialog.querySelector('[data-managers-same]')).not.toBeNull();

      primary.value = '12';
      primary.dispatchEvent(new Event('change'));
      secondary.value = '';
      secondary.dispatchEvent(new Event('change'));
      await settle(fixture);
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-confirm-primary] button, button[data-confirm-primary]',
        )!
        .click();
      await settle(fixture);

      expect(matters.setMatterManagers).toHaveBeenCalledWith(7, {
        primaryManagerId: 12,
        secondaryManagerId: undefined,
        rowVersion: 'RV1',
      });
      expect(el().querySelector('[data-primary-manager]')?.textContent).toBe('Bob Roe');
    });

    it("draws the one strip with Open, Overdue, Due soon, ASAP, Unassigned and On hold as links to the matter's tasks, and nothing without Task.View", async () => {
      await create(['Matter.View', 'Task.View']);
      const items = Array.from(
        el().querySelectorAll(
          '[data-matter-health] [data-strip-item], mf-matter-health-strip [data-strip-item]',
        ),
      );
      expect(items.map((i) => i.getAttribute('data-strip-item'))).toEqual([
        'open',
        'overdue',
        'dueSoon',
        'asap',
        'unassigned',
        'onHold',
      ]);
      const unassigned = items[4];
      expect(unassigned.textContent).toContain('2');
      expect(unassigned.getAttribute('href')).toBe(
        '/tasks?matter=7&status=NEW&status=IN_PROGRESS&status=ON_HOLD&unassigned=true',
      );

      TestBed.resetTestingModule();
      await create(['Matter.View']);
      expect(el().querySelector('mf-matter-health-strip [data-strip-item]')).toBeNull();
    });
  });
});
