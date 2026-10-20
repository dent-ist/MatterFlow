import { lastMain } from '../list-testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import {
  StepDefinitionsClient,
  TaskTypesClient,
  WorkflowsClient,
} from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { ADMIN_NAV_ITEMS } from '../../../shared/layout/nav-items';
import { iconForPath } from '../../../shared/layout/section-icons';
import { ADMIN_ROUTES } from '../admin.routes';

const empty = { items: [], total: 0, page: 1, pageSize: 25 };

/** These tests drive the real router and lazy routes; give them room on a busy machine. */
const SLOW = 20_000;

describe('Task Types page tabs (Task Types, Workflows, Workflow Steps)', () => {
  let harness: RouterTestingHarness;
  let steps: {
    listStepDefinitions: ReturnType<typeof vi.fn>;
    listStepTags: ReturnType<typeof vi.fn>;
    getStepDefinition: ReturnType<typeof vi.fn>;
  };
  let workflows: { listWorkflows: ReturnType<typeof vi.fn> };
  const el = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const tabs = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('[role="tab"]'));
  /** The visible text of a tab without its count: `Task Types (61)` is `Task Types` (#364 adds the counts). */
  const label = (t: HTMLElement): string => t.textContent!.replace(/\s*\(.*\)\s*$/, '').trim();
  const tabNames = (): string[] => tabs().map(label);
  const selected = (): string[] =>
    tabs()
      .filter((t) => t.getAttribute('aria-selected') === 'true')
      .map(label);
  const crumbs = (): string[] =>
    Array.from(el().querySelectorAll('nav[aria-label="Breadcrumb"] li')).map((li) =>
      li.textContent!.trim(),
    );

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r));
      harness.detectChanges();
    }
  }

  async function open(url: string, ...permissions: Permission[]): Promise<Router> {
    steps = {
      listStepDefinitions: vi.fn().mockReturnValue(of({ ...empty, summary: { active: 66 } })),
      listStepTags: vi.fn().mockReturnValue(of([{ name: 'Relativity', stepCount: 2 }])),
      getStepDefinition: vi.fn().mockReturnValue(of({ stepDefinitionId: 5, title: 'Load' })),
    };
    workflows = {
      listWorkflows: vi.fn().mockReturnValue(of({ ...empty, summary: { active: 30 } })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'admin', children: ADMIN_ROUTES },
            { path: '403', children: [] },
          ],
          withComponentInputBinding(),
        ),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: WorkflowsClient, useValue: workflows },
        { provide: StepDefinitionsClient, useValue: steps },
        {
          provide: TaskTypesClient,
          useValue: {
            getTaskType: vi.fn().mockReturnValue(of({ id: 1, name: 'Data Processing' })),
          },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle();
    return TestBed.inject(Router);
  }

  it(
    'is one navigation item, Task Types, that stays highlighted on the workflow and step URLs',
    () => {
      const labels = ADMIN_NAV_ITEMS.map((i) => i.label);
      expect(labels).toEqual([
        'Users',
        'Task Types',
        'Labels',
        'Assets',
        'Custom Fields',
        'Audit Logs',
      ]);
      expect(labels).not.toContain('Workflows');
      expect(labels).not.toContain('Task Types & Forms');
      const item = ADMIN_NAV_ITEMS.find((i) => i.label === 'Task Types')!;
      expect(item.path).toBe('/admin/task-types');
      expect(item.alsoActive).toEqual(['/admin/workflows', '/admin/steps']);
      // Shown to a person who holds either permission.
      expect(item.permissions).toEqual(['TaskType.Manage', 'Workflow.Manage']);
      // One icon rule: every page of the section, on every tab, shows the icon of the menu item.
      for (const path of [
        '/admin/task-types',
        '/admin/workflows',
        '/admin/workflows/3',
        '/admin/steps',
        '/admin/steps/new',
        '/admin/steps/4/form',
      ]) {
        expect(iconForPath(path)).toBe(item.icon);
      }
    },
    SLOW,
  );

  it(
    'opens the Task Types tab on /admin/task-types with the section icon, three tabs and the breadcrumb',
    async () => {
      await open('/admin/task-types', 'TaskType.Manage', 'Workflow.Manage');
      expect(el().querySelector('h1')!.textContent).toContain('Task Types');
      expect(el().querySelector('[data-page-icon]')?.className).toContain('pi-file-edit');
      expect(tabNames()).toEqual(['Task Types', 'Workflows', 'Workflow Steps']);
      expect(selected()).toEqual(['Task Types']);
      expect(crumbs()).toEqual(['Administration', 'Task Types']);
      // Every tab has its own filters bar (inline column filters, open by default from 640 px, #365) and no search box; the Filters
      // button is one of the page header's actions.
      expect(el().querySelector('mf-filters-bar')).not.toBeNull();
      expect(el().querySelector('#task-type-search, #wf-search, mf-search-box')).toBeNull();
      expect(el().querySelector('[data-filter-row]')).not.toBeNull();
      expect(el().querySelector('mf-page-header [data-filters-toggle]')).not.toBeNull();
      expect(el().querySelector('[data-new]')!.textContent).toContain('New task type');
      expect(el().querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(
        'task-types-admin-tab-task-types',
      );
    },
    SLOW,
  );

  it(
    'opens the Workflows tab on /admin/workflows with the same icon and its own breadcrumb',
    async () => {
      await open('/admin/workflows', 'TaskType.Manage', 'Workflow.Manage');
      expect(el().querySelector('h1')!.textContent).toContain('Task Types');
      expect(el().querySelector('[data-page-icon]')?.className).toContain('pi-file-edit');
      expect(selected()).toEqual(['Workflows']);
      expect(crumbs()).toEqual(['Administration', 'Task Types', 'Workflows']);
      expect(el().querySelector('mf-filters-bar')).not.toBeNull();
      expect(el().querySelector('#wf-search, mf-search-box')).toBeNull();
      expect(
        Array.from(el().querySelectorAll('button')).some(
          (b) => b.textContent?.trim() === 'New workflow',
        ),
      ).toBe(true);
    },
    SLOW,
  );

  it(
    'shows the active count of each tab, spoken as "Workflows, 30 active", `--` while unknown (#364)',
    async () => {
      await open('/admin/workflows', 'TaskType.Manage', 'Workflow.Manage');
      // The in-memory Task Types API answers with its seed, the library-wide summaries of the other two are mocked.
      expect(tabs().map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
        expect.stringMatching(/^Task Types \(\d+\)$/),
        'Workflows (30)',
        'Workflow Steps (66)',
      ]);
      expect(tabs().map((t) => t.getAttribute('aria-label'))).toEqual([
        expect.stringMatching(/^Task Types, \d+ active$/),
        'Workflows, 30 active',
        'Workflow Steps, 66 active',
      ]);
    },
    SLOW,
  );

  it(
    'opens the Workflow Steps tab on /admin/steps and keeps the address in step with the tab',
    async () => {
      const router = await open('/admin/steps', 'TaskType.Manage', 'Workflow.Manage');
      expect(selected()).toEqual(['Workflow Steps']);
      expect(el().querySelector('[data-page-icon]')?.className).toContain('pi-file-edit');
      expect(crumbs()).toEqual(['Administration', 'Task Types', 'Workflow Steps']);
      expect(el().querySelector('mf-filters-bar')).not.toBeNull();
      expect(el().querySelector('#step-search, mf-search-box')).toBeNull();
      expect(
        Array.from(el().querySelectorAll('button')).some(
          (b) => b.textContent?.trim() === 'New step',
        ),
      ).toBe(true);

      tabs()[1].click();
      await settle();
      expect(router.url).toBe('/admin/workflows');
      expect(selected()).toEqual(['Workflows']);

      tabs()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await settle();
      expect(router.url).toBe('/admin/steps');
      expect(tabs().map((t) => t.tabIndex)).toEqual([-1, -1, 0]);

      tabs()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      await settle();
      expect(router.url).toBe('/admin/task-types');
      expect(selected()).toEqual(['Task Types']);
    },
    SLOW,
  );

  it(
    'hands the tag filter in the address to the step list',
    async () => {
      await open(
        '/admin/steps?tags=Relativity&tags=QC&tagMatch=any&title=load',
        'TaskType.Manage',
        'Workflow.Manage',
      );
      expect(lastMain(steps.listStepDefinitions)).toEqual([
        undefined,
        undefined,
        'load',
        undefined,
        undefined,
        ['Relativity', 'QC'],
        'any',
        true,
        1,
        25,
      ]);
      // The address opens the filter row with the tags chosen and Match any selected.
      expect(
        el().querySelector<HTMLSelectElement>('[aria-label="Filter by Tag match"]')?.value,
      ).toBe('any');
    },
    SLOW,
  );

  it(
    'opens the Workflows tab filtered by a task type or a step, each with a removable chip',
    async () => {
      const router = await open(
        '/admin/workflows?taskType=1',
        'TaskType.Manage',
        'Workflow.Manage',
      );
      expect(lastMain(workflows.listWorkflows)).toEqual([
        undefined,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        1,
        undefined,
        1,
        25,
      ]);
      expect(el().querySelector('[data-filtered-by]')!.textContent).toContain(
        'Filtered by task type Data Processing',
      );
      el()
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Remove filter Task type: Data Processing"]',
        )!
        .click();
      await settle();
      expect(router.url).toBe('/admin/workflows');
      expect(el().querySelector('[data-assoc-filter]')).toBeNull();

      await harness.navigateByUrl('/admin/workflows?step=5');
      await settle();
      expect(lastMain(workflows.listWorkflows)).toEqual([
        undefined,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        undefined,
        5,
        1,
        25,
      ]);
      expect(el().querySelector('[data-filtered-by]')!.textContent).toContain(
        'Filtered by step Load',
      );
    },
    SLOW,
  );

  it(
    'offers only the tabs the person may use and lands a Workflow.Manage-only person on Workflows',
    async () => {
      const router = await open('/admin/task-types', 'Workflow.Manage');
      expect(tabNames()).toEqual(['Workflows', 'Workflow Steps']);
      expect(router.url).toBe('/admin/workflows');
      expect(selected()).toEqual(['Workflows']);
      expect(crumbs()).toEqual(['Administration', 'Task Types', 'Workflows']);
      expect(el().querySelector('[data-new]')).toBeNull();
      // The menu item reaches this person's tabs: either permission shows it.
      const item = ADMIN_NAV_ITEMS.find((i) => i.label === 'Task Types')!;
      expect(TestBed.inject(AuthStore).hasAny(item.permissions)).toBe(true);
    },
    SLOW,
  );

  it(
    'offers only Task Types to a TaskType.Manage-only person and sends the other URLs there',
    async () => {
      const router = await open('/admin/steps', 'TaskType.Manage');
      // One allowed tab is a page, not a tab strip (the admin list kit, #545): the H1 and the list are all there is.
      expect(tabNames()).toEqual([]);
      expect(el().querySelector('[role="tablist"]')).toBeNull();
      expect(el().querySelector('h1')?.textContent).toContain('Task Types');
      expect(router.url).toBe('/admin/task-types');
    },
    SLOW,
  );

  it(
    'is forbidden without either permission',
    async () => {
      const router = await open('/admin/workflows', 'Pod.Manage');
      expect(router.url).toBe('/403');
      await harness.navigateByUrl('/admin/task-types');
      await settle();
      expect(router.url).toBe('/403');
      await harness.navigateByUrl('/admin/steps');
      await settle();
      expect(router.url).toBe('/403');
    },
    SLOW,
  );

  it(
    'uses the page name plus the open tab as the document title',
    async () => {
      const titleOf = async (url: string) => {
        const router = TestBed.inject(Router);
        await harness.navigateByUrl(url);
        await settle();
        let route = router.routerState.snapshot.root;
        while (route.firstChild) route = route.firstChild;
        return route.title;
      };
      await open('/admin/task-types', 'TaskType.Manage', 'Workflow.Manage');
      expect(await titleOf('/admin/task-types')).toBe('Task Types');
      expect(await titleOf('/admin/workflows')).toBe('Task Types - Workflows');
      expect(await titleOf('/admin/steps')).toBe('Task Types - Workflow Steps');
      expect(await titleOf('/admin/steps/new')).toBe('New step');
      expect(await titleOf('/admin/task-types/new')).toBe('New task type');
    },
    SLOW,
  );
});
