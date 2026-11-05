import { ddSelect } from '../../../testing/dropdown-testing.spec-util';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  AssetsClient,
  AuditEventsClient,
  AuditSearchClient,
  MatterManagersClient,
  MatterEventsClient,
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
    changeMatterNumber: ReturnType<typeof vi.fn>;
    updateMatter: ReturnType<typeof vi.fn>;
  };
  let projects: { listProjects: ReturnType<typeof vi.fn> };
  let assets: {
    listAssets: ReturnType<typeof vi.fn>;
    getAssetCountsByType: ReturnType<typeof vi.fn>;
  };
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
      changeMatterNumber: vi
        .fn()
        .mockReturnValue(
          ok(aMatter({ matterRef: '00343-00099', matterNumber: '00099', rowVersion: 'CCCC' })),
        ),
      updateMatter: vi
        .fn()
        .mockReturnValue(ok(aMatter({ matterRef: '00343-00099', matterNumber: '00099' }))),
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
    assets = {
      listAssets: vi.fn().mockReturnValue(ok(pageOfAssets(anAssetListItem()))),
      getAssetCountsByType: vi.fn().mockReturnValue(
        ok([
          {
            assetTypeId: 4,
            assetTypeName: 'Custodian',
            iconKey: null,
            colourKey: null,
            count: 3,
            retiredCount: 0,
          },
        ]),
      ),
    };
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
        {
          provide: MatterEventsClient,
          useValue: {
            listMatterEvents: vi.fn().mockReturnValue(
              ok({
                from: '2026-10-14',
                to: '2027-01-12',
                total: 1,
                items: [
                  {
                    eventId: 5,
                    matterId: 7,
                    typeCode: 'COURT_HEARING',
                    title: 'Status hearing',
                    date: '2026-11-03',
                    time: '14:30:00',
                  },
                ],
              }),
            ),
            createMatterEvent: vi.fn(),
          },
        },
        { provide: TaskQueueClient, useValue: queue },
        query.provider,
        ...provideLookups(),
        ...provideQueueChoices(),
        ...provideClock('2026-10-14T15:00:00Z'),
        {
          provide: AuditSearchClient,
          useValue: {
            searchAuditEvents: vi
              .fn()
              .mockReturnValue(ok({ items: [], nextCursor: null, pageSize: 50, timeZone: 'UTC' })),
          },
        },
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

  /** Opens the header menu whose button name starts with `name` ("Create", "More actions") and picks an entry. */
  async function pick(name: string, action: string): Promise<void> {
    const trigger = el().querySelector<HTMLButtonElement>(
      `[data-overflow][aria-label^="${name}"]`,
    )!;
    trigger.click();
    await settle(fixture);
    el().querySelector<HTMLElement>(`[role=menuitem][data-action=${action}]`)!.click();
    await settle(fixture);
  }

  const tab = (label: string): HTMLElement =>
    Array.from(el().querySelectorAll<HTMLElement>('[role=tab]')).find((t) =>
      t.textContent!.trim().startsWith(label),
    )!;

  /** The Summary shows its details list at once (no disclosure any more, MD-03). */
  async function openDetails(): Promise<void> {
    await settle(fixture);
  }

  /** The tab lives in the address (`?tab=`); the router binds it to the page input, so tests set the input. */
  async function openTab(key: string | undefined): Promise<void> {
    fixture.componentRef.setInput('tab', key);
    await settle(fixture);
  }

  it('has a simple header: breadcrumb with the matter name, the title, New and More; the CM number, status and AI chips live in the Summary (MD-42, #1060)', async () => {
    await create(['Matter.View', 'Project.View', 'Client.View']);
    const header = el().querySelector('[data-matter-header]')!;
    expect(header.querySelector('[data-crumb-current]')?.textContent?.trim()).toBe('Merger Review');
    expect(header.querySelector('h1')?.textContent).toContain('Acme Corp');
    expect(header.querySelector('h1')?.textContent).toContain('Merger Review');
    // No chips and no CM number in the header.
    expect(header.querySelector('[data-matter-subtitle]')).toBeNull();
    expect(header.querySelector('[data-ai-chip]')).toBeNull();
    expect(header.textContent).not.toContain('00343-00012');
    expect(header.textContent).not.toContain('Active');
    // The CM number with its copy button, the client and the status are in the Summary's Details.
    const details = el().querySelector('[data-summary-details]')!;
    expect(details.querySelector('.mf-ref')?.textContent).toBe('00343-00012');
    expect(details.textContent).toContain('Active');
    expect(details.querySelector('[data-client-value] a')?.getAttribute('href')).toBe('/clients/1');
    details.querySelector<HTMLButtonElement>('mf-copy-button button')!.click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith('00343-00012');
  });

  it('keeps the sensitivity information bar in the header for a sensitive matter; the Sensitive chip is in the Details and points to the bar', async () => {
    await create(['Matter.View'], aMatter({ isSensitive: true }));
    const banner = el().querySelector('[data-matter-header] [data-sensitive-banner]');
    expect(banner?.textContent).toContain('Sensitive matter');
    expect(banner?.textContent).toContain('Only its project managers');
    expect(banner?.getAttribute('role')).toBe('note');
    const chip = el().querySelector('[data-summary-details] [data-sensitive-value]')!;
    expect(chip.querySelector('mf-sensitive-badge span')?.getAttribute('aria-describedby')).toBe(
      banner?.id,
    );
    expect(chip.querySelector('[data-sensitive-chip]')?.getAttribute('title')).toContain(
      'Restricted access',
    );

    TestBed.resetTestingModule();
    await create(['Matter.View'], aMatter({ isSensitive: false }));
    expect(el().querySelector('[data-sensitive-banner]')).toBeNull();
    // A matter that is not sensitive has no Sensitive field at all.
    expect(el().querySelector('[data-sensitive-value]')).toBeNull();
  });

  it('shows a persistent banner for an inactive matter and offers Reactivate', async () => {
    await create(['Matter.View', 'Matter.SetActive'], aMatter({ isActive: false }));

    expect(el().querySelector('[data-inactive-banner]')?.textContent).toContain(
      "New tasks can't be created and completed or cancelled tasks can't be reopened.",
    );
    await openOverflow(fixture);
    expect(buttonByLabel(el(), 'Set Active')).toBeDefined();
  });

  it('keeps Create task focusable with its reason while the matter is inactive', async () => {
    await create(['Matter.View', 'Task.Create'], aMatter({ isActive: false }));
    el().querySelector<HTMLButtonElement>('[data-overflow][aria-label^="Create"]')!.click();
    await settle(fixture);
    const button = el().querySelector<HTMLButtonElement>('[data-action=create-task]')!;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
      "This matter is inactive. New tasks can't be created.",
    );
    button.click();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('has seven tabs in order when everything is permitted, Summary first; the Calendar tab is gone', async () => {
    await create([
      'Matter.View',
      'Task.View',
      'Project.View',
      'Asset.View',
      'Production.View' as Permission, // added to the catalog by the Productions and Notes issues
      'MatterNote.View' as Permission,
      'Audit.View',
    ]);
    expect(
      Array.from(el().querySelectorAll('[role=tab]')).map((t) =>
        t.textContent!.trim().replace(/\s*\(.*\)$/, ''),
      ),
    ).toEqual(['Summary', 'Tasks', 'Projects', 'Assets', 'Productions', 'Notes', 'Activities']);
    expect(el().querySelectorAll('[role=tab] .pi').length).toBe(7);
    // Productions and Notes open their own tabs (MD-11, MD-13).
    await openTab('productions');
    expect(el().querySelector('[data-productions-tab]')).not.toBeNull();
    await openTab('notes');
    expect(el().querySelector('[data-notes-tab]')).not.toBeNull();
  });

  it('has Summary, Tasks, Projects and Assets tabs, Summary first and the default; Tasks needs Task.View, Projects lists the matter projects', async () => {
    await create(['Matter.View', 'Project.View']);

    expect(
      Array.from(el().querySelectorAll('[role=tab]')).map((t) => t.textContent!.trim()),
    ).toEqual(['Summary', 'Tasks', 'Projects (1)']); // Assets needs Asset.View
    // The first tab (Overview) is selected on open and loads no task list.
    expect(tab('Summary').getAttribute('aria-selected')).toBe('true');
    // Without Task.View and Asset.View the Overview has no sections, so the details are open at once.
    await openDetails();
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
    expect(tab('Summary').getAttribute('aria-selected')).toBe('true');
    expect(assets.listAssets).not.toHaveBeenCalled();
    expect(matters.getMatterSummary).not.toHaveBeenCalled();
    // No parameter, ?tab=details and an unknown value all show the Overview.
    for (const key of [undefined, 'details', 'summary', 'nonsense']) {
      await openTab(key);
      expect(tab('Summary').getAttribute('aria-selected')).toBe('true');
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
    expect(tab('Summary').getAttribute('aria-selected')).toBe('true'); // the page input follows the address

    // Overview is the default tab, so it leaves no `tab` in the address; Tasks does.
    const lastTab = (): unknown =>
      (navigate.mock.lastCall![1] as { queryParams: { tab: unknown } }).queryParams.tab;
    await openTab('projects');
    tab('Summary').click();
    expect(lastTab()).toBeNull();
    tab('Tasks').click();
    expect(lastTab()).toBe('tasks');
  });

  it('shows the Summary as the first tab with the matter details as a plain list: CM number first, only existing fields, custom fields as rows, AI allowed', async () => {
    await create(
      ['Matter.View', 'Audit.View', 'Client.View', 'Task.View'],
      aMatter({ isSensitive: true, modifiedAtUtc: '2026-10-05T12:00:00Z' }),
    );

    expect(el().querySelector('aside')).toBeNull();
    const panel = el().querySelector('[role=tabpanel]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe('matter-tab-summary');
    const summary = panel.querySelector('[data-details-tab]')!;
    const rows = Array.from(summary.querySelectorAll('dt')).map((t) => t.textContent!.trim());
    expect(rows).toEqual([
      'CM number',
      'Client',
      'Matter number',
      'Matter name',
      'Status',
      'Sensitive',
      'Primary PM',
      'Secondary PM',
      'AI allowed',
      'Created',
      'Last changed',
    ]);
    expect(summary.querySelector('dl')!.textContent).toContain('00343-00012');
    expect(summary.querySelector('[data-ai-value]')!.textContent!.trim()).toBe('No');
    expect(summary.querySelector('mf-sensitive-badge')).not.toBeNull();
    // Dates are numeric with the year; the long form is the tooltip.
    expect(summary.querySelector('[data-created]')!.textContent!.trim()).toMatch(
      /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} (AM|PM)$/,
    );
    expect(summary.querySelector('[data-client-value] a')?.getAttribute('href')).toBe('/clients/1');
    expect(summary.textContent).not.toMatch(/Custom fields/i);
    // Activities is a tab now, no longer a drawer button.
    expect(el().querySelector('mf-tabs')!.textContent).toMatch(/Activities/);
    expect(el().querySelector('[data-page-actions]')!.textContent).not.toContain('Activity');
  });

  it('shows the assets by type as tiles that open the Assets tab for the type (needs Asset.View); the Summary has no recent activity (MD-42)', async () => {
    await create(['Matter.View', 'Asset.View', 'Task.View']);
    const tile = el().querySelector<HTMLAnchorElement>('[data-asset-tile]')!;
    expect(tile.textContent).toContain('Custodian');
    expect(tile.textContent).toContain('3');
    expect(el().querySelector('[data-summary-activity]')).toBeNull();
    expect(el().querySelector('[data-asset-tile=total]')).toBeNull();

    TestBed.resetTestingModule();
    await create(['Matter.View']);
    expect(el().querySelector('[data-summary-assets]')).toBeNull();
    expect(assets.getAssetCountsByType).not.toHaveBeenCalled();
  });

  it('has no Next events panel any more; the New menu keeps Calendar event for Matter.BeManager only and opens the pop-up (MD-23, #1027)', async () => {
    await create(['Matter.View', 'Matter.BeManager' as Permission, 'Matter.Edit']);
    expect(el().querySelector('[data-next-events]')).toBeNull();
    expect(el().querySelector('[data-add-event]')).toBeNull();
    expect(el().querySelector('[data-open-calendar]')).toBeNull();
    expect(el().textContent).not.toContain('Next events');
  });

  it('shows one Edit button on the Summary only with Matter.Edit; it opens the pop-up dialog without leaving the page', async () => {
    await create(['Matter.View']);
    expect(el().querySelector('[data-edit-matter]')).toBeNull();

    TestBed.resetTestingModule();
    await create(['Matter.View', 'Matter.Edit']);
    el().querySelector<HTMLButtonElement>('[data-edit-matter]')!.click();
    await settle(fixture);
    const panel = document.body.querySelector('.mf-formdlg')!;
    expect(panel.textContent).toContain('Edit matter');
    expect(panel.querySelector('#matter-name')).not.toBeNull();
    expect(panel.querySelector('[data-ai-allowed]')).not.toBeNull();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('Edit shows Client and Matter number locked in the same places as New; the number unlocks after a confirmation and a change is confirmed again with its result (MD-43, #1061)', async () => {
    await create(['Matter.View', 'Matter.Edit', 'Matter.EditNumber']);
    el().querySelector<HTMLButtonElement>('[data-edit-matter]')!.click();
    await settle(fixture);
    const dlg = document.body.querySelector('.mf-formdlg')!;
    const number = () => dlg.querySelector<HTMLInputElement>('#matter-number')!;
    // Same fields as New; Client and Matter number are locked; the CM Number is a read-only preview.
    expect(number().disabled).toBe(true);
    expect(dlg.querySelector('#matter-client')).toBeNull(); // a locked picker shows text, not an input
    expect(dlg.querySelector('[data-cm-value]')!.textContent).toBe('00343-00012');
    expect(dlg.querySelector('[data-client-lock]')).not.toBeNull();

    // Unlocking needs a confirmation.
    dlg.querySelector<HTMLButtonElement>('[data-change-number]')!.click();
    await settle(fixture);
    expect(document.body.querySelector('[data-unlock-body]')).not.toBeNull();
    expect(number().disabled).toBe(true);
    document.body
      .querySelector<HTMLButtonElement>(
        '[data-confirm-primary] button, button[data-confirm-primary]',
      )!
      .click();
    await settle(fixture);
    expect(number().disabled).toBe(false);

    // The CM Number preview follows the number; Save asks again with the exact result.
    number().value = '99';
    number().dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(dlg.querySelector('[data-cm-value]')!.textContent).toBe('00343-00099');
    dlg.querySelector<HTMLButtonElement>('[data-panel-primary] button')!.click();
    await settle(fixture);
    const body = document.body.querySelector('[data-number-change-body]')!;
    expect(body.textContent!.replace(/\s+/g, ' ')).toContain(
      'The CM Number changes from 00343-00012 to 00343-00099,',
    );
    expect(matters.changeMatterNumber).not.toHaveBeenCalled();
    const confirms = document.body.querySelectorAll<HTMLButtonElement>(
      '[data-confirm-primary] button, button[data-confirm-primary]',
    );
    confirms[confirms.length - 1].click();
    await settle(fixture);
    expect(matters.changeMatterNumber).toHaveBeenCalledWith(7, {
      number: '99',
      rowVersion: 'BBBB',
    });
    expect(matters.updateMatter).toHaveBeenCalled();
    expect(el().querySelector('[data-summary-details] .mf-ref')!.textContent).toBe('00343-00099');
  });

  it('Edit offers no way to change the matter number without Matter.EditNumber', async () => {
    await create(['Matter.View', 'Matter.Edit']);
    el().querySelector<HTMLButtonElement>('[data-edit-matter]')!.click();
    await settle(fixture);
    const dlg = document.body.querySelector('.mf-formdlg')!;
    expect(dlg.querySelector('[data-change-number]')).toBeNull();
    expect(dlg.querySelector<HTMLInputElement>('#matter-number')!.disabled).toBe(true);
  });

  it('shows Primary PM and Secondary PM as two rows of the details (MD-23, #1027)', async () => {
    await create(
      ['Matter.View', 'Matter.AssignManagers', 'Task.View'],
      aMatter({ primaryManager: { userId: 3, displayName: 'Test User 03', isActive: true } }),
    );
    expect(el().querySelector('[data-primary-manager]')!.textContent).toBe('Test User 03');
    expect(el().querySelector('[data-secondary-manager]')!.textContent).toBe('None');
  });

  it('shows PMs with initials, no domain on an account name, and Change / Add buttons for people who may assign (MD-42)', async () => {
    await create(
      ['Matter.View', 'Matter.AssignManagers'],
      aMatter({ primaryManager: { userId: 3, displayName: 'KE\\kekim', isActive: true } }),
    );
    expect(el().querySelector('[data-primary-manager]')!.textContent).toBe('kekim');
    expect(el().querySelector('[data-managers] .ms__avatar')!.textContent!.trim()).toBe('KE');
    expect(el().querySelector('[data-change-managers]')!.textContent!.trim()).toBe('Change');
    // A missing Secondary PM has its own Add.
    expect(el().querySelector('[data-add-secondary-manager]')!.textContent!.trim()).toBe('Add');

    TestBed.resetTestingModule();
    await create(['Matter.View'], aMatter());
    expect(el().querySelector('[data-change-managers], [data-add-managers]')).toBeNull();
    expect(el().querySelector('[data-add-secondary-manager]')).toBeNull();
  });

  it('shows one tile per asset type (no Total tile), and an empty bar with New Asset when there are none', async () => {
    await create(['Matter.View', 'Asset.View', 'Asset.Create']);
    assets.getAssetCountsByType.mockReturnValue(
      ok([
        { assetTypeId: 4, assetTypeName: 'Custodian', count: 3, retiredCount: 0 },
        { assetTypeId: 5, assetTypeName: 'Laptop', count: 2, retiredCount: 0 },
      ]),
    );
    (fixture.componentInstance as unknown as { projectSaved(): void }).projectSaved(); // asks the tiles again
    await settle(fixture);
    const tiles = Array.from(el().querySelectorAll('[data-summary-assets] .ms__tile')).map((t) =>
      t.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(tiles).toEqual(['Custodian3', 'Laptop2']);

    TestBed.resetTestingModule();
    await create(['Matter.View', 'Asset.View', 'Asset.Create']);
    assets.getAssetCountsByType.mockReturnValue(ok([]));
    (fixture.componentInstance as unknown as { projectSaved(): void }).projectSaved();
    await settle(fixture);
    expect(el().querySelector('[data-no-assets]')!.textContent).toContain('no assets yet');
    el().querySelector<HTMLButtonElement>('[data-new-asset]')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/assets/new?matterId=7');
  });

  it('shows no task counts in the header and asks for the summary once (MD-01)', async () => {
    await create(['Matter.View', 'Task.View', 'Asset.View']);
    expect(el().querySelector('mf-matter-health-strip')).toBeNull();
    expect(el().querySelector('[data-matter-header]')!.textContent).not.toMatch(
      /Overdue|Due soon|ASAP/,
    );
    expect(matters.getMatterSummary).toHaveBeenCalledWith(7);
  });

  it('has no strip and asks for no numbers without Task.View, and the tab is still complete', async () => {
    await create(['Matter.View']);
    expect(matters.getMatterSummary).not.toHaveBeenCalled();
    expect(el().querySelector('[data-strip]')).toBeNull();
    expect(el().querySelector('[role=alert]')).toBeNull();
    await openDetails();
    expect(el().querySelector('[data-details-tab] dl')).not.toBeNull();
  });

  it('shows the client as plain text without Client.View', async () => {
    await create(['Matter.View']);
    await openDetails();
    expect(el().querySelector('[data-client-value] a')).toBeNull();
    expect(el().querySelector('[data-client-value]')!.textContent).toContain('Acme Corp');
  });

  it('shows Activities as a tab for Audit.View and maps the old ?tab=activity link to it', async () => {
    await create(['Matter.View', 'Audit.View']);
    expect(document.body.querySelector('.mf-drawer')).toBeNull();
    expect(tab('Activities')).toBeDefined();
    await openTab('activity');
    expect(tab('Activities').getAttribute('aria-selected')).toBe('true');
    expect(el().querySelector('mf-matter-activities')).not.toBeNull();

    TestBed.resetTestingModule();
    await create(['Matter.View']);
    expect(el().querySelector('[data-tab=activities]')).toBeNull();
    await openTab('activities');
    expect(tab('Summary').getAttribute('aria-selected')).toBe('true');
  });

  it('lists the matter tasks in the Tasks tab (open by default, All on request); Create task is in the header and "New Task" in the tab toolbar (LC-02)', async () => {
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

    // The tab's title row has "+ New Task" (decision AR 8); it opens Create Task with the matter, like the header's New menu.
    const newTask = el().querySelector<HTMLButtonElement>(
      'mf-scoped-tasks [data-create-task] button',
    )!;
    expect(newTask.textContent).toContain('New Task');
    newTask.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/tasks/new?matterId=7');
    navigateByUrl.mockClear();
    await pick('Create', 'create-task');
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
    // Title or Ref is the toolbar's Search box (LC-01): Search first, Filters right after it, no cell for it in the row.
    expect(grid.querySelector('mf-list-toolbar [data-list-search] input')).not.toBeNull();
    expect(grid.querySelector('[aria-label^="Filter by Title or Ref"]')).toBeNull();
    for (const name of ['Priority', 'Assignee', 'Due', 'Status'])
      expect(grid.querySelector(`[aria-label^="Filter by ${name}"]`), name).not.toBeNull();
    expect(
      grid.querySelector('mf-dropdown button[aria-label^="Filter by Project"]'),
    ).not.toBeNull();

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
      undefined,
      undefined,
      1,
      50,
      undefined,
    );
    const grid = el().querySelector('mf-matter-assets')!;
    expect(grid.querySelector('tbody a')?.getAttribute('href')).toBe('/assets/9');
    // New asset lives in the header overflow now (#274); the tab has no button of its own while it lists assets.
    expect(buttonByLabel(el(), 'New asset')).toBeUndefined();
    expect(grid.querySelector('[data-empty-new-asset]')).toBeNull();
    // The standalone search box and status select are gone: Name, Type, External reference and Disposition are column filters.
    expect(grid.querySelector('#matter-asset-search, #matter-asset-status')).toBeNull();
    expect(grid.querySelector('[data-filter-row]')).toBeNull(); // closed by default
    grid.querySelector<HTMLButtonElement>('[data-filters-toggle]')!.click();
    await settle(fixture);
    // Name is the toolbar's Search box (LC-08); the other text filter stays in the row.
    expect(grid.querySelector('[data-list-search] input')).not.toBeNull();
    expect(grid.querySelector('input[aria-label^="Filter by External Reference"]')).not.toBeNull();
    expect(ddSelect(grid, 'Filter by Disposition').value).toBe('active');
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
      undefined,
      undefined,
      1,
      50,
      undefined,
    );
  });

  it('gates the New menu and the activation entry by permission; New > Project opens the side panel', async () => {
    await create(['Matter.View']);
    expect(el().querySelector('[data-overflow]')).toBeNull(); // nothing to put in either menu: no empty button

    TestBed.resetTestingModule();
    await create(['Matter.View', 'Matter.Edit', 'Project.Create']);
    // New > Project opens the side panel and leaves the page where it is.
    await pick('Create', 'new-project');
    expect(document.body.querySelector('.mf-formdlg')?.textContent).toContain('New project');
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('puts Edit, New (Task, Project, Asset) and More actions (Set inactive) in the header and nothing else', async () => {
    await create([
      'Matter.View',
      'Matter.Edit',
      'Matter.SetActive',
      'Project.Create',
      'Asset.Create',
      'Task.Create',
      'Audit.View',
    ]);
    // Edit is the one button of the header (#1136); New and More actions are menus.
    expect(
      Array.from(el().querySelectorAll('[data-page-actions] > button')).map((b) =>
        b.getAttribute('data-action'),
      ),
    ).toEqual(['edit']);
    const menus = el().querySelectorAll<HTMLButtonElement>('[data-overflow]');
    expect(menus.length).toBe(2);
    menus[0].click();
    await settle(fixture);
    expect(
      Array.from(el().querySelectorAll('[role=menuitem]')).map((b) =>
        b.getAttribute('data-action'),
      ),
    ).toEqual(['create-task', 'new-project', 'new-asset']);
    el().querySelector<HTMLElement>('[data-action=new-asset]')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/assets/new?matterId=7');
    menus[1].click();
    await settle(fixture);
    expect(
      Array.from(el().querySelectorAll('[role=menuitem]')).map((b) =>
        b.getAttribute('data-action'),
      ),
    ).toEqual(['toggle-active']);
  });

  it('shows the Projects tab action in its empty state', async () => {
    await create(['Matter.View', 'Project.View', 'Project.Create'], aMatter({ projectCount: 0 }));
    projects.listProjects.mockReturnValue(ok(pageOfProjects()));
    await fixture.componentInstance.load();
    await openTab('projects');
    el().querySelector<HTMLButtonElement>('[data-empty-new-project] button')!.click();
    await settle(fixture);
    expect(document.body.querySelector('.mf-formdlg')?.textContent).toContain('New project');
  });

  it('confirms before deactivating and saves with the row version', async () => {
    await create(['Matter.View', 'Matter.SetActive']);

    await openOverflow(fixture);
    buttonByLabel(el(), 'Set Inactive')!.click();
    await settle(fixture);
    const dialog = document.body.querySelector('p-dialog') as HTMLElement;
    expect(dialog.querySelector('[data-toggle-body]')?.textContent).toContain(
      "00343-00012 becomes inactive: new tasks can't be created and completed or cancelled tasks can't be reopened until you reactivate it.",
    );
    expect(matters.setMatterActive).not.toHaveBeenCalled();

    buttonByLabel(dialog, 'Set Matter Inactive')!.click();
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
    buttonByLabel(el(), 'Set Inactive')!.click();
    await settle(fixture);
    buttonByLabel(
      document.body.querySelector('p-dialog') as HTMLElement,
      'Set Matter Inactive',
    )!.click();
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
    expect(document.title).toBe('00343-00012 Merger Review: Summary - MatterFlow');
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
      const cells = el().querySelectorAll('mf-matter-assets tbody tr td:nth-child(4)');
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
      expect(line.querySelector('[data-primary-manager]')?.textContent).toBe('Ann Lee');
      expect(el().querySelector('[data-secondary-manager]')?.textContent).toBe('Bob Roe');
      expect(el().querySelector('[data-change-managers]')).toBeNull(); // no Matter.AssignManagers

      TestBed.resetTestingModule();
      await create(['Matter.View'], aMatter());
      expect(el().querySelector('[data-managers]')!.textContent).toContain('None');
      expect(el().textContent).not.toMatch(/unassigned manager/i);
    });

    it('offers a quiet Add project manager link only with Matter.AssignManagers', async () => {
      await create(['Matter.View', 'Matter.AssignManagers'], aMatter());
      expect(el().querySelector('[data-add-managers]')?.textContent?.trim()).toBe('Add');
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
      document.body.querySelector<HTMLButtonElement>('[data-panel-primary] button')!.click();
      await settle(fixture);

      expect(matters.setMatterManagers).toHaveBeenCalledWith(7, {
        primaryManagerId: 12,
        secondaryManagerId: undefined,
        rowVersion: 'RV1',
      });
      expect(el().querySelector('[data-primary-manager]')?.textContent).toBe('Bob Roe');
    });
  });
});
