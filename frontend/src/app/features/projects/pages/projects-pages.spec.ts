import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
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
  openOverflow,
  fakeQuery,
  ok,
  pageOfMatters,
  pageOfProjects,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import {
  aRow,
  pageOf,
  provideClock,
  provideLookups,
  provideQueueChoices,
} from '../../../shared/work-queue/work-queue-testing';
import { ProjectDetailPage } from './project-detail-page';
import { ProjectFormPage } from './project-form-page';
import { ProjectsListPage } from './projects-list-page';

type Mock = ReturnType<typeof vi.fn>;

describe('Projects pages', () => {
  let projects: Record<
    | 'listProjects'
    | 'getProject'
    | 'createProject'
    | 'updateProject'
    | 'setProjectActive'
    | 'getProjectSummary',
    Mock
  >;
  let matters: Record<'getMatter' | 'listMatters', Mock>;
  let queue: Record<'getTaskQueue', Mock>;
  let navigate: Mock;
  let navigateByUrl: Mock;
  let query: ReturnType<typeof fakeQuery>;

  async function configure(permissions: Permission[]): Promise<void> {
    projects = {
      listProjects: vi
        .fn()
        .mockReturnValue(
          ok(
            pageOfProjects(aProject(), aProject({ projectId: 4, name: 'Review', isActive: false })),
          ),
        ),
      getProject: vi.fn().mockReturnValue(ok(aProject())),
      getProjectSummary: vi
        .fn()
        .mockReturnValue(
          ok({ projectId: 3, openTasks: 1, overdue: 2, dueSoon: 1, asap: 0, onHold: 1 }),
        ),
      createProject: vi.fn().mockReturnValue(ok(aProject({ projectId: 11 }))),
      updateProject: vi.fn().mockReturnValue(ok(aProject({ name: 'Renamed' }))),
      setProjectActive: vi.fn().mockReturnValue(ok(aProject({ isActive: false }))),
    };
    matters = {
      getMatter: vi.fn().mockReturnValue(ok(aMatter())),
      listMatters: vi
        .fn()
        .mockReturnValue(
          ok(
            pageOfMatters(
              aMatter(),
              aMatter({ matterId: 8, matterRef: '00001-00003', name: 'Old', isActive: false }),
            ),
          ),
        ),
    };
    queue = { getTaskQueue: vi.fn().mockReturnValue(ok(pageOf([aRow({ projectId: 3 })]))) };
    query = fakeQuery();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: ProjectsClient, useValue: projects },
        { provide: MattersClient, useValue: matters },
        { provide: TaskQueueClient, useValue: queue },
        {
          provide: AuditEventsClient,
          useValue: { listAuditEvents: vi.fn().mockReturnValue(ok({ items: [] })) },
        },
        ...provideLookups(),
        ...provideQueueChoices(),
        ...provideClock('2026-10-14T15:00:00Z'),
      ],
    });
    const router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true) as never;
    navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
  }

  describe('list', () => {
    const FILTER_PARAMS = ['name', 'matter', 'matterId', 'status'];

    async function create(permissions: Permission[], inputs: Record<string, string> = {}) {
      localStorage.clear();
      await configure(permissions);
      query.set(
        Object.fromEntries(Object.entries(inputs).filter(([k]) => FILTER_PARAMS.includes(k))),
      );
      const fixture = TestBed.createComponent(ProjectsListPage);
      for (const [k, v] of Object.entries(inputs)) {
        if (!FILTER_PARAMS.includes(k) || k === 'status') fixture.componentRef.setInput(k, v);
      }
      await settle(fixture);
      return fixture;
    }

    const control = <T extends HTMLElement>(el: HTMLElement, name: string): T =>
      el.querySelector<T>(`[aria-label="Filter by ${name}"]`)!;

    it('lists projects with their matter reference and archived state', async () => {
      const fixture = await create(['Project.View', 'Project.Create']);
      const rows = fixture.nativeElement.querySelectorAll('tbody tr');

      expect(rows).toHaveLength(2);
      expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/projects/3');
      expect(rows[0].querySelector('.mf-ref')?.textContent).toBe('00343-00012');
      expect(rows[1].textContent).toContain('Archived');
      expect(projects.listProjects).toHaveBeenCalledWith(
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        1,
        25,
        undefined,
      );
    });

    it('shows the matter cell, the client, Open tasks and Overdue (WP9, #267)', async () => {
      const fixture = await create(['Project.View', 'Task.View', 'Matter.View']);
      projects.listProjects.mockReturnValue(
        ok(pageOfProjects(aProject({ projectId: 3, openTaskCount: 4, overdueTaskCount: 1 }))),
      );
      fixture.componentRef.setInput('sort', 'name');
      await settle(fixture);
      const el: HTMLElement = fixture.nativeElement;

      const heads = Array.from(el.querySelectorAll('thead tr:first-child th')).map((h) =>
        h.textContent!.trim(),
      );
      expect(heads.slice(0, 2)).toEqual(['Name', 'Matter']);
      expect(heads.slice(-3)).toEqual(['Open tasks', 'Overdue', 'Status']);
      const row = el.querySelector('tbody tr')!;
      // The shared two-line Matter cell: reference over name, tooltip Client . Matter, a link with Matter.View.
      const cell = row.querySelector('mf-matter-cell')!;
      expect(cell.querySelector('a.mf-ref')?.getAttribute('href')).toBe('/matters/7');
      expect(cell.querySelector('[data-matter-name]')?.textContent).toContain('Merger Review');
      expect(cell.querySelector('.mc')?.getAttribute('title')).toBe('Acme Corp · Merger Review');
      expect(row.querySelector('[data-count=open] a')?.getAttribute('href')).toBe(
        '/tasks?project=3&status=NEW&status=IN_PROGRESS&status=ON_HOLD',
      );
      expect(row.querySelector('[data-count=overdue] a')?.getAttribute('aria-label')).toBe(
        '1 overdue task in Custodian Processing',
      );
    });

    it('shows the matter as text without Matter.View and leaves the counts out without Task.View', async () => {
      const fixture = await create(['Project.View']);
      const el: HTMLElement = fixture.nativeElement;
      const row = el.querySelector('tbody tr')!;
      expect(row.querySelector('mf-matter-cell a')).toBeNull();
      expect(row.querySelector('mf-matter-cell .mf-ref')?.textContent).toBe('00343-00012');
      expect(el.querySelector('[data-count]')).toBeNull();
      expect(el.querySelectorAll('thead tr:first-child th')).not.toHaveLength(0);
    });

    async function createEmpty(permissions: Permission[]) {
      localStorage.clear();
      await configure(permissions);
      projects.listProjects.mockReturnValue(ok(pageOf([])));
      query.set({});
      const fixture = TestBed.createComponent(ProjectsListPage);
      await settle(fixture);
      return fixture.nativeElement.querySelector('td[data-empty=none]') as HTMLElement;
    }
    const FIRST_RUN = 'No projects yet. Open a matter and choose New project.';

    it('points an empty list at Matters with a link when the viewer can see matters (L11)', async () => {
      const cell = await createEmpty(['Project.View', 'Matter.View']);
      expect(cell.textContent).toContain(FIRST_RUN);
      expect(cell.querySelector('a')?.getAttribute('href')).toBe('/matters');
    });

    it('says the same without the link when the viewer cannot see matters (L11)', async () => {
      const cell = await createEmpty(['Project.View']);
      expect(cell.textContent).toContain(FIRST_RUN);
      expect(cell.querySelector('a')).toBeNull();
    });

    it('has column filters instead of a search box: Name, Matter and Status (Active shown, Archived by name)', async () => {
      const fixture = await create(['Project.View']);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('#project-search, #project-status, mf-search-box')).toBeNull();
      expect(el.querySelector('[data-filter-row]')).not.toBeNull(); // open by default (WP8 #270)

      expect(control<HTMLInputElement>(el, 'Name')).not.toBeNull();
      expect(control<HTMLInputElement>(el, 'Matter')).not.toBeNull();
      const status = control<HTMLSelectElement>(el, 'Status');
      expect(status.value).toBe('active');
      expect(Array.from(status.options).map((o) => o.textContent?.trim())).toEqual([
        'Active',
        'Archived',
        'All',
      ]);
      expect(el.querySelector('[data-filter-count]')).toBeNull();

      const name = control<HTMLInputElement>(el, 'Name');
      name.value = ' phase ';
      name.dispatchEvent(new Event('input'));
      name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { name: 'phase', page: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });

    it('sends the filters of the URL to the API, shows a removable matter chip and keeps the matter when creating', async () => {
      const fixture = await create(['Project.View', 'Project.Create'], {
        matterId: '7',
        name: 'cust',
        matter: '343-12',
        status: 'inactive',
        page: '2',
      });
      fixture.componentRef.setInput('page', '2');
      await settle(fixture);

      expect(projects.listProjects).toHaveBeenLastCalledWith(
        undefined,
        7,
        false,
        'cust',
        '343-12',
        2,
        25,
        undefined,
      );
      expect(fixture.nativeElement.querySelector('[data-chip="matterId"]')?.textContent).toContain(
        'Matter: 00343-00012 Merger Review',
      );
      buttonByLabel(fixture.nativeElement, 'New project')!.click();
      expect(navigateByUrl).toHaveBeenCalledWith('/projects/new?matterId=7');
      fixture.nativeElement.querySelector('[data-chip="matterId"] button').click();
      expect(navigate).toHaveBeenCalledWith([], {
        queryParams: { matterId: null, page: null },
        queryParamsHandling: 'merge',
      });
    });

    it('hides New project without Project.Create and keeps the headers and filter row when nothing matches', async () => {
      const fixture = await create(['Project.View']);
      expect(buttonByLabel(fixture.nativeElement, 'New project')).toBeUndefined();

      projects.listProjects.mockReturnValue(ok(pageOfProjects()));
      query.set({ name: 'zzz' });
      await settle(fixture);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-empty=filtered]')).not.toBeNull();
      expect(el.querySelector('thead th')).not.toBeNull();
      expect(el.querySelector('[data-filter-row]')).not.toBeNull();
    });
  });

  describe('form', () => {
    let fixture: ComponentFixture<ProjectFormPage>;
    const el = (): HTMLElement => fixture.nativeElement;

    async function create(inputs: Record<string, string>, permissions: Permission[]) {
      await configure(permissions);
      fixture = TestBed.createComponent(ProjectFormPage);
      for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
      await settle(fixture);
    }

    function type(selector: string, value: string): void {
      const input = el().querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }

    async function submit(): Promise<void> {
      el().querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle(fixture);
    }

    it("Cancel from a matter goes back to that matter's Projects tab", async () => {
      await create({ matterId: '7' }, ['Project.View', 'Project.Create']);
      el()
        .querySelectorAll<HTMLButtonElement>('button')
        .forEach((b) => b.textContent?.trim() === 'Cancel' && b.click());
      expect(navigateByUrl).toHaveBeenCalledWith('/matters/7?tab=projects');
    });

    it('creates in the launching matter, with the matter prefilled and locked', async () => {
      await create({ matterId: '7' }, ['Project.View', 'Project.Create']);

      expect(matters.getMatter).toHaveBeenCalledWith(7);
      expect(el().querySelector('[data-chosen]')?.textContent).toContain(
        '00343-00012 Merger Review',
      );
      expect(el().querySelector('.mf-picker__change')).toBeNull();

      type('#project-name', ' Custodian Processing ');
      type('#project-description', 'Intake');
      await submit();

      expect(projects.createProject).toHaveBeenCalledWith({
        matterId: 7,
        name: 'Custodian Processing',
        description: 'Intake',
      });
      expect(navigate).toHaveBeenCalledWith(['/projects', 11]);
    });

    it('lets the user pick a matter when not launched from one, and requires it', async () => {
      await create({}, ['Project.View', 'Project.Create']);
      await submit();
      expect(el().querySelector('[data-summary]')?.textContent).toContain('Select a matter.');
      expect(el().querySelector('[data-summary]')?.textContent).toContain('Enter a project name.');

      type('#project-matter', '343-12');
      await new Promise((r) => setTimeout(r, 300));
      await settle(fixture);
      expect(matters.listMatters).toHaveBeenCalledWith(
        '343-12',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        8,
        undefined,
      );
      expect(el().textContent).toContain('00001-00003 Old');
      expect(el().querySelectorAll('mf-badge')).toHaveLength(1); // the inactive matter is marked
    });

    it('maps a duplicate name to the field', async () => {
      await create({ matterId: '7' }, ['Project.View', 'Project.Create']);
      projects.createProject.mockReturnValue(
        apiError(409, {
          status: 409,
          code: 'DUPLICATE_NAME',
          errors: {
            name: [
              {
                code: 'DUPLICATE_NAME',
                message: "A project named 'X' already exists in this matter.",
              },
            ],
          },
          meta: { existingId: 3 },
        }),
      );
      type('#project-name', 'X');
      await submit();

      expect(el().querySelector('#project-name-error')?.textContent).toContain(
        "A project named 'X' already exists in this matter.",
      );
      expect(el().querySelector('[data-summary] a')?.getAttribute('href')).toBe('/projects/3');
    });

    it('edits name and description with the row version; the matter stays locked', async () => {
      await create({ projectId: '3' }, ['Project.View', 'Project.Edit']);

      expect(el().querySelector('.mf-picker__change')).toBeNull();
      expect(el().querySelector<HTMLInputElement>('#project-name')!.value).toBe(
        'Custodian Processing',
      );
      type('#project-name', 'Renamed');
      type('#project-description', '');
      await submit();

      expect(projects.updateProject).toHaveBeenCalledWith(3, {
        name: 'Renamed',
        description: undefined,
        rowVersion: 'CCCC',
      });
    });
  });

  describe('detail', () => {
    let fixture: ComponentFixture<ProjectDetailPage>;
    const el = (): HTMLElement => fixture.nativeElement;

    async function create(permissions: Permission[], project = aProject()) {
      await configure(permissions);
      projects.getProject.mockReturnValue(ok(project));
      fixture = TestBed.createComponent(ProjectDetailPage);
      fixture.componentRef.setInput('projectId', '3');
      await settle(fixture);
    }

    it('shows the project in its matter', async () => {
      await create(['Project.View']);

      expect(el().querySelector('h1')?.textContent).toContain('Custodian Processing');
      expect(el().querySelector('[data-matter] .mf-ref')?.textContent).toBe('00343-00012');
      expect(buttonByLabel(el(), 'Archive')).toBeUndefined();
      expect(buttonByLabel(el(), 'Edit')).toBeUndefined();
    });

    it('has Tasks (n) and Details tabs, Tasks first and selected, and no side panel; Edit is in the header and Archive in the overflow', async () => {
      await create(['Project.View', 'Project.Edit', 'Project.Archive', 'Task.View']);

      const tabs = Array.from(el().querySelectorAll('[role=tab]'));
      expect(tabs.map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
        'Tasks (1)',
        'Details',
      ]);
      expect(tabs[0].getAttribute('aria-selected')).toBe('true');
      expect(el().querySelector('aside, mf-detail-layout')).toBeNull();
      expect(el().querySelector('[data-details-tab]')).toBeNull();
      const edit = buttonByLabel(el(), 'Edit')!;
      expect(el().querySelector('[data-page-actions]')!.contains(edit)).toBe(true);
      const menu = await openOverflow(fixture);
      expect(menu!.querySelector('[data-action=toggle-active]')?.textContent?.trim()).toBe(
        'Archive',
      );
      edit.click();
      expect(navigateByUrl).toHaveBeenCalledWith('/projects/3/edit');
    });

    it('shows no count without Task.View', async () => {
      await create(['Project.View']);
      expect(el().querySelector('[role=tab]')?.textContent?.trim()).toBe('Tasks');
    });

    it('keeps the count of the whole list when the person narrows the grid', async () => {
      await create(['Project.View', 'Task.View']);
      fixture.componentInstance['onTasksLoaded']({ total: 7, filtered: false });
      await settle(fixture);
      expect(el().querySelector('[role=tab]')?.textContent).toContain('(7)');
      fixture.componentInstance['onTasksLoaded']({ total: 2, filtered: true });
      await settle(fixture);
      expect(el().querySelector('[role=tab]')?.textContent).toContain('(7)');
    });

    it('?tab=details shows Matter, the Description when set, Status and dates, without repeating the name', async () => {
      await create(['Project.View', 'Task.View']);
      fixture.componentRef.setInput('tab', 'details');
      await settle(fixture);

      expect(el().querySelector('[role=tab][aria-selected=true]')?.textContent).toContain(
        'Details',
      );
      const body = el().querySelector<HTMLElement>('[data-details-tab]')!;
      const labels = Array.from(body.querySelectorAll('dt')).map((d) => d.textContent!.trim());
      expect(labels).toEqual(['Matter', 'Description', 'Status', 'Created']);
      expect(body.textContent).toContain('00343-00012');
      expect(body.textContent).not.toContain('Custodian Processing');
      expect(body.textContent).toContain('Active');
      // The grid stays mounted (hidden) so its count and filters survive a visit.
      expect(queue.getTaskQueue).toHaveBeenCalledTimes(1);
      expect(el().querySelector('mf-scoped-tasks')).not.toBeNull();
    });

    it('omits the Description when there is none, and shows Archived for an archived project', async () => {
      await create(['Project.View'], aProject({ description: undefined, isActive: false }));
      fixture.componentRef.setInput('tab', 'details');
      await settle(fixture);

      const body = el().querySelector<HTMLElement>('[data-details-tab]')!;
      expect(body.textContent).not.toContain('Description');
      expect(body.textContent).not.toContain('No description');
      expect(body.textContent).toContain('Archived');
    });

    it('links the matter only with Matter.View', async () => {
      await create(['Project.View', 'Matter.View']);
      fixture.componentRef.setInput('tab', 'details');
      await settle(fixture);
      expect(el().querySelector('[data-matter-value] a')?.getAttribute('href')).toBe('/matters/7');

      TestBed.resetTestingModule();
      await create(['Project.View']);
      fixture.componentRef.setInput('tab', 'details');
      await settle(fixture);
      expect(el().querySelector('[data-matter-value] a')).toBeNull();
      expect(el().querySelector('[data-matter-value]')?.textContent).toContain('00343-00012');
    });

    it('choosing a tab only changes ?tab= (absent for Tasks)', async () => {
      await create(['Project.View']);
      el().querySelector<HTMLElement>('[data-tab=details]')!.click();
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { tab: 'details' },
        queryParamsHandling: 'merge',
      });
      fixture.componentRef.setInput('tab', 'details');
      await settle(fixture);
      el().querySelector<HTMLElement>('[data-tab=tasks]')!.click();
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { tab: null },
        queryParamsHandling: 'merge',
      });
    });

    it('opens Activity in a drawer from the header (Audit.View), also for an old ?tab=activity link', async () => {
      await create(['Project.View']);
      expect(buttonByLabel(el(), 'Activity')).toBeUndefined();

      TestBed.resetTestingModule();
      await create(['Project.View', 'Audit.View']);
      buttonByLabel(el(), 'Activity')!.click();
      await settle(fixture);
      const drawer = document.body.querySelector('.mf-drawer') as HTMLElement;
      expect(drawer.textContent).toContain('Activity: Custodian Processing');
      expect(drawer.querySelector('mf-entity-activity')).not.toBeNull();

      TestBed.resetTestingModule();
      await create(['Project.View', 'Audit.View']);
      fixture.componentRef.setInput('tab', 'activity');
      await settle(fixture);
      expect(document.body.querySelector('.mf-drawer')).not.toBeNull();
    });

    it('lists the project tasks through the work-queue table, filtered by matter and project', async () => {
      await create(['Project.View', 'Task.View']);

      const args = queue.getTaskQueue.mock.calls[0];
      expect(args[10]).toBe(7); // matter
      expect(args[11]).toBe(3); // project
      expect(args[2]).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']); // open by default
      expect(el().querySelector('tbody tr[data-task=TSK-1042] a')?.getAttribute('href')).toBe(
        '/tasks/1042?from=project',
      );
      expect(el().querySelector('mf-scoped-tasks [data-create-task]')).toBeNull(); // needs Task.Create
      // A project's tasks have no Project filter (the project is the page).
      expect(el().querySelector('mf-scoped-tasks [aria-label="Filter by Project"]')).toBeNull();
    });

    it('offers Create task in the header (once), prefilled with the matter and the project', async () => {
      await create(['Project.View', 'Task.View', 'Task.Create']);

      expect(el().querySelector('mf-scoped-tasks [data-create-task]')).toBeNull();
      buttonByLabel(el(), 'Create task')!.click();

      expect(navigateByUrl).toHaveBeenCalledWith('/tasks/new?matterId=7&projectId=3');
    });

    it('keeps Create task focusable with its reason for an archived project', async () => {
      await create(['Project.View', 'Task.View', 'Task.Create'], aProject({ isActive: false }));

      const button = el().querySelector<HTMLButtonElement>('[data-action=create-task]')!;
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.disabled).toBe(false);
      button.click();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('says so, and loads nothing, without Task.View', async () => {
      await create(['Project.View']);

      expect(el().querySelector('[data-no-access=tasks]')).not.toBeNull();
      expect(queue.getTaskQueue).not.toHaveBeenCalled();
    });

    it('archives after confirmation, explaining that existing tasks keep the project', async () => {
      await create(['Project.View', 'Project.Archive']);

      await openOverflow(fixture);
      buttonByLabel(el(), 'Archive')!.click();
      await settle(fixture);
      const dialog = document.body.querySelector('p-dialog') as HTMLElement;
      expect(dialog.querySelector('[data-toggle-body]')?.textContent).toContain(
        "Existing tasks keep this project, but new tasks can't select it.",
      );
      buttonByLabel(dialog, 'Archive')!.click();
      await settle(fixture);

      expect(projects.setProjectActive).toHaveBeenCalledWith(3, {
        isActive: false,
        rowVersion: 'CCCC',
      });
      expect(el().querySelector('[data-archived-banner]')).not.toBeNull();
    });

    it('offers Restore for an archived project', async () => {
      await create(['Project.View', 'Project.Archive'], aProject({ isActive: false }));

      expect(el().querySelector('[data-archived-banner]')?.textContent).toContain(
        "new tasks can't select it",
      );
      await openOverflow(fixture);
      expect(buttonByLabel(el(), 'Restore')).toBeDefined();
    });

    it('shows the not-found text with a link back and no Retry for a 404', async () => {
      await create(['Project.View']);
      projects.getProject.mockReturnValue(apiError(404, { status: 404, code: 'NOT_FOUND' }));
      await fixture.componentInstance.load();
      await settle(fixture);

      expect(el().querySelector('h1')?.textContent).toContain("We couldn't find that project.");
      expect(el().querySelector('[data-back-link]')?.textContent).toContain('Go to projects');
      expect(buttonByLabel(el(), 'Retry')).toBeUndefined();
    });

    it('shows the access text for a 403 and Retry for a server fault', async () => {
      await create(['Project.View']);
      projects.getProject.mockReturnValue(apiError(403, { status: 403 }));
      await fixture.componentInstance.load();
      await settle(fixture);
      expect(el().querySelector('h1')?.textContent).toContain(
        "You don't have access to this project.",
      );
      expect(buttonByLabel(el(), 'Retry')).toBeUndefined();

      projects.getProject.mockReturnValue(apiError(503, { status: 503 }));
      await fixture.componentInstance.load();
      await settle(fixture);
      expect(el().querySelector('h1')?.textContent).toContain("Couldn't load this project.");
      expect(buttonByLabel(el(), 'Retry')).toBeDefined();
    });

    it('names the project and its view in the document title', async () => {
      await create(['Project.View']);
      expect(document.title).toBe('Custodian Processing: Tasks - MatterFlow');
      fixture.componentRef.setInput('tab', 'details');
      await settle(fixture);
      expect(document.title).toBe('Custodian Processing: Details - MatterFlow');
    });
  });
});
