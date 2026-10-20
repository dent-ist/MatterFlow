import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import {
  StepDefinitionSummary,
  StepDefinitionsClient,
  FormsClient,
  TaskTypesClient,
  WorkflowDetail,
  WorkflowSummary,
  WorkflowVersionDetail,
  WorkflowVersionStatus,
  WorkflowVersionStepModel,
  WorkflowVersionSummary,
  WorkflowsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { WorkflowLookup } from '../../../core/lookups/workflow-lookup';
import { UndoService } from '../../../core/notify/undo.service';
import {
  FakeMeApi,
  apiError,
  buttonByLabel,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { WorkflowEditPage } from './workflow-edit-page';
import { WorkflowVersionPage } from './workflow-version-page';
import { WorkflowsListPage } from './workflows-list-page';

const summary = (overrides: Partial<WorkflowSummary> = {}): WorkflowSummary => ({
  workflowDefinitionId: 1,
  name: 'Standard Processing',
  description: 'Default flow',
  isActive: true,
  publishedVersionId: 11,
  publishedVersionNo: 2,
  publishedStepCount: 3,
  draftVersionId: undefined,
  draftVersionNo: undefined,
  taskTypes: [],
  rowVersion: 'WWWW',
  hasDraft: false,
  versionCount: 2,
  publishedAtUtc: '2026-10-01T10:00:00Z',
  stepCount: 3,
  taskTypeCount: 0,
  ...overrides,
});

const versionSummary = (
  overrides: Partial<WorkflowVersionSummary> = {},
): WorkflowVersionSummary => ({
  workflowVersionId: 12,
  versionNo: 3,
  status: WorkflowVersionStatus.Draft,
  isOrdered: true,
  stepCount: 2,
  createdAtUtc: '2026-10-01T10:00:00Z',
  publishedAtUtc: undefined,
  publishedByUserId: undefined,
  rowVersion: 'VVVV',
  ...overrides,
});

const stepModel = (id: number, title: string, skippable = false): WorkflowVersionStepModel => ({
  workflowVersionStepId: id * 10,
  sequenceNo: id,
  sourceStepDefinitionId: id,
  title,
  description: undefined,
  instructions: undefined,
  documentationUrl: undefined,
  stepFormVersionId: undefined,
  isSkippable: skippable,
  skipCommentRequired: false,
  sourceStepActive: true,
});

const versionDetail = (
  version: Partial<WorkflowVersionSummary> = {},
  steps: WorkflowVersionStepModel[] = [stepModel(1, 'Intake QC'), stepModel(2, 'Load')],
): WorkflowVersionDetail => ({
  workflowDefinitionId: 1,
  workflowName: 'Standard Processing',
  version: versionSummary(version),
  steps,
});

const libStep = (id: number, title: string): StepDefinitionSummary => ({
  stepDefinitionId: id,
  title,
  description: undefined,
  documentationUrl: undefined,
  isActive: true,
  usedInVersions: 0,
  usedInWorkflows: 0,
  tags: [],
  rowVersion: 'S',
  publishedFormVersionId: undefined,
  draftFormFieldCount: 0,
});

const wfDetail = (w: Partial<WorkflowSummary> = {}): WorkflowDetail => ({
  workflow: summary(w),
  versions: [
    versionSummary({
      workflowVersionId: 11,
      versionNo: 2,
      status: WorkflowVersionStatus.Published,
    }),
    versionSummary({ workflowVersionId: 10, versionNo: 1, status: WorkflowVersionStatus.Retired }),
  ],
});

async function setup(
  workflows: Record<string, unknown>,
  steps: Record<string, unknown> = {},
  forms: Record<string, unknown> = {},
) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      MessageService,
      provideFakeMe(new FakeMeApi(withPermissions('Workflow.Manage'))),
      { provide: WorkflowsClient, useValue: workflows },
      { provide: StepDefinitionsClient, useValue: steps },
      { provide: FormsClient, useValue: forms },
    ],
  });
  await TestBed.inject(AuthStore).ensureLoaded();
}

const type = (el: HTMLElement, selector: string, value: string) => {
  const input = el.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

const titles = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('[data-steps] ol [data-step-row]')).map((row) =>
    row.getAttribute('data-step-row'),
  );

/** Opens the overflow menu of a step row and picks an entry (Move up, Move down, Skip rules, Preview inputs, Remove). */
async function pickRowAction(
  fixture: { whenStable(): Promise<unknown> },
  el: HTMLElement,
  title: string,
  action: 'up' | 'down' | 'rules' | 'preview' | 'remove',
): Promise<void> {
  el.querySelector<HTMLElement>(`[data-step-row="${title}"] [data-overflow]`)!.click();
  await settle(fixture as never);
  el.querySelector<HTMLElement>(`[data-step-row="${title}"] [data-action="${action}"]`)!.click();
  await settle(fixture as never);
}

describe('WorkflowsListPage', () => {
  it('lists workflows with latest published version, draft and status', async () => {
    const api = {
      listWorkflows: vi.fn().mockReturnValue(
        ok({
          items: [
            summary(),
            summary({
              workflowDefinitionId: 2,
              name: 'Production',
              publishedVersionId: undefined,
              publishedVersionNo: undefined,
              draftVersionNo: 1,
              draftVersionId: 20,
              isActive: false,
            }),
          ],
          total: 2,
          page: 1,
          pageSize: 25,
        }),
      ),
    };
    await setup(api);
    const fixture = TestBed.createComponent(WorkflowsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    const rows = Array.from(el.querySelectorAll('tbody tr'));
    expect(rows.map((r) => r.getAttribute('data-row'))).toEqual([
      'Standard Processing',
      'Production',
    ]);
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/admin/workflows/1');
    expect(rows[0].textContent).toContain('v2 (3 steps)');
    expect(rows[1].textContent).toContain('Not published');
    expect(rows[1].textContent).toContain('Draft');
    expect(rows[1].textContent).toContain('Inactive');
    expect(api.listWorkflows).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      25,
    );
  });

  it('shows the task types of each workflow as chips (default starred, three then +n more) and links', async () => {
    const ref = (id: number, name: string, isDefault = false, isActive = true) => ({
      taskTypeId: id,
      name,
      isDefault,
      isActive,
    });
    const api = {
      listWorkflows: vi.fn().mockReturnValue(
        ok({
          items: [
            summary({
              taskTypes: [
                ref(1, 'Data Processing', true),
                ref(2, 'Collection'),
                ref(3, 'Review'),
                ref(4, 'Production'),
                ref(5, 'Legacy', false, false),
              ],
            }),
            summary({ workflowDefinitionId: 2, name: 'Production', taskTypes: [] }),
          ],
          total: 2,
          page: 1,
          pageSize: 25,
        }),
      ),
    };
    await setup(api);
    const fixture = TestBed.createComponent(WorkflowsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const first = el.querySelector('[data-row="Standard Processing"]')!;
    expect(
      Array.from(first.querySelectorAll('[data-assoc-chip]')).map((c) =>
        c.getAttribute('data-assoc-chip'),
      ),
    ).toEqual(['Data Processing', 'Collection', 'Production']);
    expect(first.querySelector('[data-assoc-default]')!.textContent).toBe('default');
    expect(first.querySelector('[data-assoc-more]')!.textContent!.trim()).toBe('+2 more');
    expect(el.querySelector('[data-row="Production"] [data-assoc-empty]')!.textContent).toContain(
      'No task type',
    );
    expect(first.textContent).toContain('v2 (3 steps)');
  });

  it('links the task type chips to the task type pages and +n more to the filtered Task Types tab', async () => {
    const ref = (id: number, name: string) => ({
      taskTypeId: id,
      name,
      isDefault: false,
      isActive: true,
    });
    const api = {
      listWorkflows: vi.fn().mockReturnValue(
        ok({
          items: [summary({ taskTypes: [1, 2, 3, 4].map((i) => ref(i, 'T' + i)) })],
          total: 1,
          page: 1,
          pageSize: 25,
        }),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions('Workflow.Manage', 'TaskType.Manage'))),
        { provide: WorkflowsClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(WorkflowsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-assoc-chip="T2"] a')!.getAttribute('href')).toBe(
      '/admin/task-types/2',
    );
    expect(el.querySelector('[data-assoc-more]')!.getAttribute('href')).toBe(
      '/admin/task-types?workflow=1',
    );
  });

  it('filters by task type and by step from the address, with a removable chip', async () => {
    const api = {
      listWorkflows: vi
        .fn()
        .mockReturnValue(ok({ items: [summary()], total: 1, page: 1, pageSize: 25 })),
    };
    const taskTypes = {
      getTaskType: vi.fn().mockReturnValue(ok({ id: 7, name: 'Data Processing' })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions('Workflow.Manage'))),
        { provide: WorkflowsClient, useValue: api },
        { provide: TaskTypesClient, useValue: taskTypes },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/admin/workflows?taskType=7');
    const fixture = TestBed.createComponent(WorkflowsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(api.listWorkflows).toHaveBeenLastCalledWith(
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      undefined,
      7,
      undefined,
      1,
      25,
    );
    expect(el.querySelector('[data-filtered-by]')!.textContent).toContain(
      'Filtered by task type Data Processing: 1 workflow',
    );
    const remove = el.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove filter Task type: Data Processing"]',
    )!;
    expect(remove).not.toBeNull();
    remove.click();
    await settle(fixture);
    expect(router.url).toBe('/admin/workflows');
    expect(el.querySelector('[data-assoc-filter]')).toBeNull();
    expect(api.listWorkflows).toHaveBeenLastCalledWith(
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      25,
    );
  });

  it('ignores a task type or step that is not a number', async () => {
    const api = {
      listWorkflows: vi
        .fn()
        .mockReturnValue(ok({ items: [summary()], total: 1, page: 1, pageSize: 25 })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions('Workflow.Manage'))),
        { provide: WorkflowsClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    await TestBed.inject(Router).navigateByUrl('/x?taskType=abc&step=-3');
    const fixture = TestBed.createComponent(WorkflowsListPage);
    await settle(fixture);
    expect(api.listWorkflows).toHaveBeenLastCalledWith(
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      25,
    );
  });

  it('sends the column filters of the address: name, published, draft and status', async () => {
    const api = {
      listWorkflows: vi
        .fn()
        .mockReturnValue(ok({ items: [summary()], total: 1, page: 1, pageSize: 25 })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions('Workflow.Manage'))),
        { provide: WorkflowsClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    await TestBed.inject(Router).navigateByUrl(
      '/x?name=%20std%20&hasPublished=true&hasDraft=false&status=all',
    );
    const fixture = TestBed.createComponent(WorkflowsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(api.listWorkflows).toHaveBeenLastCalledWith(
      undefined,
      undefined,
      'std',
      undefined,
      true,
      false,
      undefined,
      undefined,
      1,
      25,
    );
    // A link with filters opens the row with the values in it.
    const control = (name: string) =>
      el.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="Filter by ${name}"]`);
    expect(control('Name')?.value).toBe('std');
    expect(el.querySelector('[data-filter-count]')?.textContent).toBe('(4)');
  });

  it('has column filters instead of a search box and a status select, closed by default', async () => {
    const api = {
      listWorkflows: vi
        .fn()
        .mockReturnValue(ok({ items: [summary()], total: 1, page: 1, pageSize: 25 })),
    };
    await setup(api);
    const fixture = TestBed.createComponent(WorkflowsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('#wf-search, #wf-status, mf-search-box')).toBeNull();
    expect(el.querySelector('[data-filter-row]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-filters-toggle]')!.click();
    await settle(fixture);
    for (const column of ['Name', 'Latest published', 'Draft', 'Status']) {
      expect(el.querySelector(`[aria-label="Filter by ${column}"]`)).not.toBeNull();
    }
    expect(el.querySelector<HTMLSelectElement>('[aria-label="Filter by Status"]')!.value).toBe(
      'active',
    );
    expect(el.querySelector('[data-filter-count]')).toBeNull();
  });

  it('shows empty and error states', async () => {
    const api = {
      listWorkflows: vi.fn().mockReturnValue(ok({ items: [], total: 0, page: 1, pageSize: 25 })),
    };
    await setup(api);
    const fixture = TestBed.createComponent(WorkflowsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-empty="none"]')).not.toBeNull();

    api.listWorkflows.mockReturnValue(apiError(500, { status: 500, title: 'Error' }));
    fixture.componentRef.setInput('q', 'x');
    await settle(fixture);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load workflows.");
  });
});

describe('WorkflowsListPage name cell (#356)', () => {
  it('clamps the name to two lines, or to one line above a one-line description, with the full texts as tooltips', async () => {
    const long = 'N'.repeat(150);
    const api = {
      listWorkflows: vi.fn().mockReturnValue(
        ok({
          items: [
            summary({ workflowDefinitionId: 1, name: long, description: 'D'.repeat(240) }),
            summary({ workflowDefinitionId: 2, name: 'Plain', description: undefined }),
          ],
          total: 2,
          page: 1,
          pageSize: 25,
        }),
      ),
    };
    await setup(api);
    const fixture = TestBed.createComponent(WorkflowsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const withText = el.querySelector(`tr[data-row="${long}"] td.ad-name`)!;
    const link = withText.querySelector('a.pg-name')!;
    expect(link.getAttribute('title')).toBe(long);
    expect(link.classList.contains('pg-name--one')).toBe(true);
    const description = withText.querySelector('.pg-clip')!;
    expect(description.getAttribute('title')).toBe('D'.repeat(240));
    const plain = el.querySelector('tr[data-row="Plain"] td.ad-name')!;
    expect(plain.querySelector('a.pg-name')!.classList.contains('pg-name--one')).toBe(false);
    expect(plain.querySelector('.pg-clip')).toBeNull();
  });
});

describe('WorkflowsListPage row menu', () => {
  const page = (items: WorkflowSummary[]) => ({
    items,
    total: items.length,
    page: 1,
    pageSize: 25,
  });
  const openMenu = async (fixture: { nativeElement: HTMLElement }, name: string) => {
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>(`tr[data-row="${name}"] button[data-overflow]`)!.click();
    await new Promise((r) => setTimeout(r));
    return () =>
      Array.from(el.querySelectorAll('[role=menuitem]')).map((i) => i.getAttribute('data-action'));
  };

  it('has one overflow button per row, offers Open draft only when there is a draft and confirms Deactivate', async () => {
    const withDraft = summary({
      workflowDefinitionId: 2,
      name: 'Production',
      draftVersionId: 20,
      draftVersionNo: 3,
    });
    const api = {
      listWorkflows: vi.fn().mockReturnValue(ok(page([summary(), withDraft]))),
      updateWorkflow: vi.fn().mockReturnValue(ok(wfDetail())),
    };
    await setup(api);
    const fixture = TestBed.createComponent(WorkflowsListPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelectorAll('tbody button[data-overflow]')).toHaveLength(2);
    expect(
      el
        .querySelector('tr[data-row="Production"] button[data-overflow]')!
        .getAttribute('aria-label'),
    ).toBe('Actions for Production');
    let entries = await openMenu(fixture, 'Standard Processing');
    await settle(fixture);
    expect(entries()).toEqual(['deactivate']);
    el.querySelector<HTMLButtonElement>(
      'tr[data-row="Standard Processing"] button[data-overflow]',
    )!.click();
    await settle(fixture);

    entries = await openMenu(fixture, 'Production');
    await settle(fixture);
    expect(entries()).toEqual(['open-draft', 'deactivate']);
    const go = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    el.querySelector<HTMLButtonElement>('[data-action=open-draft]')!.click();
    expect(go).toHaveBeenCalledWith(['/admin/workflows', 2, 'versions', 20], {
      state: { returnTo: expect.any(String) },
    });

    // Deactivate asks first, then saves with the row version.
    await openMenu(fixture, 'Standard Processing');
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-action=deactivate]')!.click();
    await settle(fixture);
    const confirm = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Deactivate workflow' && b.closest('p-dialog, .p-dialog'),
    );
    expect(confirm).toBeDefined();
    expect(api.updateWorkflow).not.toHaveBeenCalled();
    confirm!.click();
    await settle(fixture);
    expect(api.updateWorkflow).toHaveBeenCalledWith(1, {
      name: 'Standard Processing',
      description: 'Default flow',
      isActive: false,
      rowVersion: 'WWWW',
    });
    expect(el.querySelector('[data-announce]')!.textContent).toContain('deactivated');
  });

  it('offers Activate on an inactive workflow', async () => {
    const api = {
      listWorkflows: vi.fn().mockReturnValue(ok(page([summary({ isActive: false })]))),
      updateWorkflow: vi.fn().mockReturnValue(ok(wfDetail())),
    };
    await setup(api);
    const fixture = TestBed.createComponent(WorkflowsListPage);
    await settle(fixture);
    const entries = await openMenu(fixture, 'Standard Processing');
    await settle(fixture);
    expect(entries()).toEqual(['activate']);
    fixture.nativeElement.querySelector('[data-action=activate]').click();
    await settle(fixture);
    expect(api.updateWorkflow).toHaveBeenCalledWith(1, expect.objectContaining({ isActive: true }));
  });
});

describe('WorkflowEditPage', () => {
  it('creates a workflow and opens its first draft', async () => {
    const api = {
      createWorkflow: vi.fn().mockReturnValue(
        ok({
          workflow: summary({ workflowDefinitionId: 7, draftVersionId: 70, draftVersionNo: 1 }),
          versions: [],
        }),
      ),
    };
    await setup(api);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(WorkflowEditPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    buttonByLabel(el, 'Create workflow')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-summary]')?.textContent).toContain('Enter a name.');
    expect(api.createWorkflow).not.toHaveBeenCalled();

    type(el, '#wf-name', ' Review ');
    el.querySelector<HTMLInputElement>('[data-mode="unordered"]')!.click();
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    buttonByLabel(el, 'Create workflow')!.click();
    await settle(fixture);
    expect(api.createWorkflow).toHaveBeenCalledWith({
      name: 'Review',
      description: undefined,
      isOrdered: false,
    });
    expect(navigate).toHaveBeenCalledWith(['/admin/workflows', 7, 'versions', 70]);
  });

  it('shows the version history and creates a new draft from a published version', async () => {
    const api = {
      getWorkflow: vi.fn().mockReturnValue(ok(wfDetail())),
      createWorkflowDraft: vi.fn().mockReturnValue(ok(versionDetail({ workflowVersionId: 12 }))),
    };
    await setup(api);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(WorkflowEditPage);
    fixture.componentRef.setInput('workflowId', '1');
    fixture.componentRef.setInput('tab', 'versions');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    const rows = Array.from(el.querySelectorAll('[data-versions-tab] tbody tr'));
    expect(rows.map((r) => r.getAttribute('data-version'))).toEqual(['2', '1']);
    expect(rows[0].textContent).toContain('Published');
    expect(rows[1].textContent).toContain('Retired');

    // The primary action of a workflow without a draft creates one from the published version.
    el.querySelector<HTMLElement>('[data-action="new-draft"]')!.click();
    await settle(fixture);
    expect(api.createWorkflowDraft).toHaveBeenCalledWith(1, { fromVersionId: 11 });
    expect(navigate).toHaveBeenCalledWith(['/admin/workflows', 1, 'versions', 12], {});
  });

  it('shows the workflow status in the header and links to the draft in progress', async () => {
    await setup({
      getWorkflow: vi.fn().mockReturnValue(ok(wfDetail({ draftVersionId: 12, draftVersionNo: 3 }))),
    });
    const fixture = TestBed.createComponent(WorkflowEditPage);
    fixture.componentRef.setInput('workflowId', '1');
    fixture.componentRef.setInput('tab', 'versions');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const header = el.querySelector('[data-record-header]')!.textContent!;
    expect(header).toContain('Published v2');
    expect(header).toContain('Draft v3 in progress');
    // One primary action: Open draft v3, never also Create new draft.
    expect(el.querySelector('[data-action="open-draft"]')?.textContent).toContain('Open draft v3');
    expect(el.querySelector('[data-action="new-draft"]')).toBeNull();
    expect(el.querySelector('[data-versions-tab] [data-version="2"]')?.textContent).toContain(
      'Current',
    );
  });

  it('saves details with the row version and reports a conflict', async () => {
    const api = {
      getWorkflow: vi.fn().mockReturnValue(ok(wfDetail())),
      updateWorkflow: vi.fn().mockReturnValue(ok(wfDetail({ name: 'Std', rowVersion: 'XXXX' }))),
    };
    await setup(api);
    const fixture = TestBed.createComponent(WorkflowEditPage);
    fixture.componentRef.setInput('workflowId', '1');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    type(el, '#wf-name', 'Std');
    buttonByLabel(el, 'Save changes')!.click();
    await settle(fixture);
    expect(api.updateWorkflow).toHaveBeenCalledWith(1, {
      name: 'Std',
      description: 'Default flow',
      isActive: true,
      rowVersion: 'WWWW',
    });
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);

    api.updateWorkflow.mockReturnValue(
      apiError(409, { status: 409, title: 'Conflict', code: 'CONCURRENCY_CONFLICT' }),
    );
    type(el, '#wf-name', 'Std 2');
    buttonByLabel(el, 'Save changes')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-conflict]')).not.toBeNull();
  });
});

describe('WorkflowVersionPage draft editor', () => {
  function apis(overrides: Record<string, unknown> = {}) {
    return {
      workflows: {
        getWorkflow: vi
          .fn()
          .mockReturnValue(ok(wfDetail({ draftVersionId: 12, draftVersionNo: 3 }))),
        getWorkflowVersion: vi.fn().mockImplementation((_id: number, vid: number) =>
          ok(
            vid === 11
              ? versionDetail(
                  {
                    workflowVersionId: 11,
                    versionNo: 2,
                    status: WorkflowVersionStatus.Published,
                  },
                  [stepModel(1, 'Intake QC'), stepModel(3, 'Old step')],
                )
              : versionDetail(),
          ),
        ),
        saveWorkflowDraft: vi.fn().mockImplementation((_id: number, _vid: number, body) =>
          ok(
            versionDetail(
              { rowVersion: 'NEW', isOrdered: body.isOrdered },
              body.steps.map((s: { sourceStepDefinitionId: number; isSkippable: boolean }) =>
                stepModel(
                  s.sourceStepDefinitionId,
                  `Step ${s.sourceStepDefinitionId}`,
                  s.isSkippable,
                ),
              ),
            ),
          ),
        ),
        publishWorkflowVersion: vi
          .fn()
          .mockReturnValue(ok(versionDetail({ status: WorkflowVersionStatus.Published }))),
        ...overrides,
      },
      steps: {
        listStepDefinitions: vi.fn().mockReturnValue(
          ok({
            items: [libStep(1, 'Intake QC'), libStep(2, 'Load'), libStep(5, 'OCR')],
            total: 3,
            page: 1,
            pageSize: 50,
          }),
        ),
      },
    };
  }

  async function open(overrides: Record<string, unknown> = {}) {
    const a = apis(overrides);
    await setup(a.workflows, a.steps);
    const fixture = TestBed.createComponent(WorkflowVersionPage);
    fixture.componentRef.setInput('workflowId', '1');
    fixture.componentRef.setInput('versionId', '12');
    await settle(fixture);
    return { a, fixture, el: fixture.nativeElement as HTMLElement };
  }

  const click = (el: HTMLElement, selector: string) =>
    el.querySelector<HTMLElement>(selector)!.click();

  it('adds, reorders from the row menu and with the keyboard, and removes steps; the guard tracks edits', async () => {
    const { fixture, el } = await open();
    expect(titles(el)).toEqual(['Intake QC', 'Load']);
    expect(el.querySelector('[data-status]')?.textContent).toContain('Draft');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    expect(el.querySelector<HTMLButtonElement>('[data-add="1"]')!.disabled).toBe(true);

    click(el, '[data-add="5"]');
    await settle(fixture);
    expect(titles(el)).toEqual(['Intake QC', 'Load', 'OCR']);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    expect(el.querySelector('[data-live]')?.textContent).toContain('Added OCR at position 3');

    await pickRowAction(fixture, el, 'OCR', 'up');
    expect(titles(el)).toEqual(['Intake QC', 'OCR', 'Load']);
    expect(el.querySelector('[data-live]')?.textContent).toContain('Moved OCR to position 2 of 3');
    // The first row has no Move up, the last has no Move down.
    el.querySelector<HTMLElement>('[data-step-row="Intake QC"] [data-overflow]')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-step-row="Intake QC"] [data-action="up"]')).toBeNull();
    expect(el.querySelector('[data-step-row="Intake QC"] [data-action="down"]')).not.toBeNull();
    el.querySelector<HTMLElement>('[data-step-row="Intake QC"] [data-overflow]')!.click();
    await settle(fixture);

    // Keyboard: Alt+ArrowDown on the OCR row moves it down.
    el.querySelector('[data-step-row="OCR"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }),
    );
    await settle(fixture);
    expect(titles(el)).toEqual(['Intake QC', 'Load', 'OCR']);
    // Without Alt nothing moves.
    el.querySelector('[data-step-row="OCR"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
    );
    await settle(fixture);
    expect(titles(el)).toEqual(['Intake QC', 'Load', 'OCR']);

    await pickRowAction(fixture, el, 'Intake QC', 'remove');
    expect(titles(el)).toEqual(['Load', 'OCR']);
  });

  it('removes a step with an Undo that puts it back at its place with its skip rules', async () => {
    const { fixture, el } = await open();
    const undo = TestBed.inject(UndoService);
    click(el, '[data-add="5"]');
    await settle(fixture);
    await pickRowAction(fixture, el, 'Load', 'rules');
    click(el, '[data-skippable="2"]');
    await settle(fixture);
    click(el, '[data-comment="2"]');
    await settle(fixture);
    await pickRowAction(fixture, el, 'Load', 'remove');
    expect(titles(el)).toEqual(['Intake QC', 'OCR']);
    expect(undo.current()?.message).toBe('Removed Load from the workflow.');
    expect(el.querySelector('[data-live]')?.textContent).toContain('Removed Load. 2 steps remain.');

    await undo.run();
    await settle(fixture);
    expect(titles(el)).toEqual(['Intake QC', 'Load', 'OCR']);
    expect(el.querySelector('[data-step-row="Load"] [data-skip-summary]')?.textContent).toContain(
      'Skippable - comment',
    );
    expect(el.querySelector('[data-live]')?.textContent).toContain(
      'Restored Load at position 2 of 3',
    );
  });

  it('a step row has two Tab stops in a draft: the Skip rules badge and the overflow', async () => {
    const { el } = await open();
    const stops = Array.from(
      el.querySelectorAll('[data-step-row="Intake QC"] button, [data-step-row="Intake QC"] input'),
    );
    expect(
      stops.map((b) => b.hasAttribute('data-rule') || b.hasAttribute('data-overflow')),
    ).toEqual([true, true]);
  });

  it('searches the library after a pause, with a labelled field, hint, count and no-results state', async () => {
    const { a, fixture, el } = await open();
    const label = el.querySelector<HTMLLabelElement>('[data-library] label[for="wf-lib-search"]');
    expect(label?.textContent).toContain('Search steps');
    expect(el.querySelector('[data-library] [data-search-hint]')).not.toBeNull();
    expect(el.querySelector('[data-lib-count]')?.textContent).toContain('3 steps');

    a.steps.listStepDefinitions.mockReturnValue(ok({ items: [], total: 0, page: 1, pageSize: 50 }));
    type(el, '#wf-lib-search', 'zzz');
    await new Promise((r) => setTimeout(r, 400));
    await settle(fixture);
    expect(a.steps.listStepDefinitions).toHaveBeenLastCalledWith(
      undefined,
      'zzz',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      1,
      50,
    );
    expect(el.querySelector('[data-lib-empty]')?.textContent).toContain('No steps match');
  });

  it('moves focus to the next addable library step after adding one', async () => {
    const { fixture, el } = await open();
    click(el, '[data-add="5"]');
    await settle(fixture);
    // 1 and 2 are already in the workflow, 5 was just added: nothing left, so focus goes to the search box.
    expect(document.activeElement?.id).toBe('wf-lib-search');
  });

  it('shows required and skippable indicators for each step', async () => {
    const { el } = await open();
    expect(
      el.querySelector('[data-step-row="Intake QC"] [data-skip-summary]')?.textContent,
    ).toContain('Required');
    expect(el.querySelector('#wf-lib-heading')?.textContent).toContain('Workflow Steps');
    expect(el.querySelector('#wf-steps-heading')?.textContent).toContain('(2)');
  });

  it('keeps comment-required disabled unless the step is skippable', async () => {
    const { a, fixture, el } = await open();
    // The rules are in the Skip rules popover of the row (opened from the badge).
    expect(el.querySelector('[data-comment="1"]')).toBeNull();
    click(el, '[data-step-row="Intake QC"] [data-rule]');
    await settle(fixture);
    const comment = () => el.querySelector<HTMLInputElement>('[data-comment="1"]')!;
    expect(comment().disabled).toBe(true);

    click(el, '[data-skippable="1"]');
    await settle(fixture);
    expect(comment().disabled).toBe(false);
    click(el, '[data-comment="1"]');
    await settle(fixture);
    expect(comment().checked).toBe(true);

    // Clearing skippable resets the comment requirement.
    click(el, '[data-skippable="1"]');
    await settle(fixture);
    expect(comment().disabled).toBe(true);
    expect(comment().checked).toBe(false);

    click(el, '[data-skippable="1"]');
    await settle(fixture);
    click(el, '[data-comment="1"]');
    await settle(fixture);
    buttonByLabel(el, 'Save draft')!.click();
    await settle(fixture);
    expect(a.workflows['saveWorkflowDraft']).toHaveBeenCalledWith(1, 12, {
      isOrdered: true,
      steps: [
        { sourceStepDefinitionId: 1, isSkippable: true, skipCommentRequired: true },
        { sourceStepDefinitionId: 2, isSkippable: false, skipCommentRequired: false },
      ],
      rowVersion: 'VVVV',
    });
  });

  it('explains the mode in the bar control and confirms a change when steps exist', async () => {
    const { fixture, el } = await open();
    const button = () => el.querySelector<HTMLElement>('[data-action-bar] [data-mode-button]')!;
    expect(button().textContent).toContain('Ordered');
    expect(el.querySelector('[data-step-row="Load"] .wsr__no')?.textContent).toContain('2');
    button().click();
    await settle(fixture);
    expect(el.querySelector('[data-mode-help]')?.textContent).toContain('Ordered:');

    click(el, '[data-mode="unordered"]');
    await settle(fixture);
    expect(document.body.textContent).toContain(
      'Ordered numbering will be hidden; steps can be done in any order.',
    );
    // Not applied until confirmed.
    expect(button().textContent).toContain('Ordered');
    expect(button().textContent).not.toContain('Unordered');
    const confirm = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Change mode',
    )!;
    confirm.click();
    await settle(fixture);
    expect(button().textContent).toContain('Unordered');
    expect(el.querySelector('[data-step-row="Load"] .wsr__no')).toBeNull();
  });

  it('previews a step input form read-only', async () => {
    const steps = {
      getStepDefinition: vi.fn().mockReturnValue(ok({ publishedFormVersionId: 40 })),
    };
    const a = apis();
    const forms = {
      getFormVersionSchema: vi.fn().mockReturnValue(
        ok({
          fields: [
            {
              key: 'itemsIn',
              label: 'Items in',
              control: 'NUMBER',
              displayOrder: 1,
              isRequired: false,
              isVisible: true,
              options: [],
              rules: [],
            },
          ],
        }),
      ),
    };
    await setup(a.workflows, { ...a.steps, ...steps }, forms);
    const fixture = TestBed.createComponent(WorkflowVersionPage);
    fixture.componentRef.setInput('workflowId', '1');
    fixture.componentRef.setInput('versionId', '12');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    await pickRowAction(fixture, el, 'Intake QC', 'preview');
    expect(steps.getStepDefinition).toHaveBeenCalledWith(1);
    expect(el.querySelector('[data-preview-box="1"] mf-dynamic-form')).not.toBeNull();
  });

  it('saves, then publishes after a confirmation that shows the diff against the published version', async () => {
    const { a, fixture, el } = await open();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    click(el, '[data-add="5"]');
    await settle(fixture);
    buttonByLabel(el, 'Publish...')!.click();
    await settle(fixture);

    // The unsaved edit is saved first, then the dialog compares with v2.
    expect(a.workflows['saveWorkflowDraft']).toHaveBeenCalled();
    expect(a.workflows['getWorkflowVersion']).toHaveBeenCalledWith(1, 11);
    const diff = document.querySelector('[data-diff]')!.textContent!;
    expect(diff).toContain('Changes since v2');
    const items = Array.from(document.querySelectorAll('[data-diff] .wf-diff li')).map((li) =>
      li.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(items).toContain('Added"Step 5"');
    expect(items).toContain('Removed"Old step"');
    expect(document.querySelector('[data-publish-impact]')?.textContent).toBe(
      'Tasks already running keep v2. New tasks use v3.',
    );

    expect(a.workflows['publishWorkflowVersion']).not.toHaveBeenCalled();
    Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Publish v3')!
      .click();
    await settle(fixture);
    expect(a.workflows['publishWorkflowVersion']).toHaveBeenCalledWith(1, 12, {
      rowVersion: 'NEW',
    });
    expect(navigate).toHaveBeenCalledWith(['/admin/workflows', 1], {});
  });

  it('shows server validation errors inline when publishing fails', async () => {
    const { fixture, el } = await open({
      publishWorkflowVersion: vi.fn().mockReturnValue(
        apiError(400, {
          status: 400,
          title: 'Validation failed',
          code: 'VALIDATION_FAILED',
          errors: { steps: [{ code: 'REQUIRED', message: 'A workflow needs at least one step.' }] },
        }),
      ),
    });
    buttonByLabel(el, 'Publish...')!.click();
    await settle(fixture);
    Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Publish v3')!
      .click();
    await settle(fixture);

    const summaryEl = el.querySelector('[data-summary]');
    expect(summaryEl?.getAttribute('role')).toBe('alert');
    expect(summaryEl?.textContent).toContain('A workflow needs at least one step.');
  });

  it('offers a reload when the draft changed elsewhere', async () => {
    const { fixture, el } = await open({
      saveWorkflowDraft: vi
        .fn()
        .mockReturnValue(
          apiError(409, { status: 409, title: 'Conflict', code: 'CONCURRENCY_CONFLICT' }),
        ),
    });
    await pickRowAction(fixture, el, 'Load', 'remove');
    buttonByLabel(el, 'Save draft')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-conflict]')).not.toBeNull();
    expect(buttonByLabel(el, 'Reload latest')).toBeDefined();
  });

  it('shows an empty message when the draft has no steps', async () => {
    const { fixture, el } = await open({
      getWorkflowVersion: vi.fn().mockReturnValue(ok(versionDetail({}, []))),
    });
    expect(el.querySelector('[data-steps-empty]')?.textContent).toContain('No steps yet');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });
});

describe('WorkflowVersionPage published version', () => {
  async function openPublished(overrides: Record<string, unknown> = {}) {
    const workflows = {
      getWorkflow: vi.fn().mockReturnValue(ok(wfDetail())),
      getWorkflowVersion: vi.fn().mockReturnValue(
        ok(
          versionDetail({
            workflowVersionId: 11,
            versionNo: 2,
            status: WorkflowVersionStatus.Published,
          }),
        ),
      ),
      createWorkflowDraft: vi.fn().mockReturnValue(ok(versionDetail({ workflowVersionId: 12 }))),
      retireWorkflowVersion: vi
        .fn()
        .mockReturnValue(
          ok(versionDetail({ workflowVersionId: 11, status: WorkflowVersionStatus.Retired })),
        ),
      ...overrides,
    };
    await setup(workflows, { listStepDefinitions: vi.fn() });
    const fixture = TestBed.createComponent(WorkflowVersionPage);
    fixture.componentRef.setInput('workflowId', '1');
    fixture.componentRef.setInput('versionId', '11');
    await settle(fixture);
    return { workflows, fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('is read-only and offers a new draft and retire', async () => {
    const { workflows, fixture, el } = await openPublished();
    expect(el.querySelector('[data-status]')?.textContent).toContain('Published');
    // A neutral note, never a warning (decision W): the neutral class, an info icon, no alert role.
    const note = el.querySelector('[data-readonly-banner]')!;
    expect(note.classList.contains('wf-note')).toBe(true);
    expect(note.querySelector('.pi-info-circle')).not.toBeNull();
    expect(note.getAttribute('role')).toBeNull();
    expect(el.querySelector('[data-add]')).toBeNull();
    expect(el.querySelector('[data-steps] [data-overflow]')).toBeNull();
    expect(el.querySelector('[data-skippable]')).toBeNull();
    expect(el.querySelector('[data-skip-summary]')?.textContent).toContain('Required');
    expect(el.querySelector('[data-mode-badge]')?.textContent).toContain('Ordered');
    expect(el.querySelector('[data-mode-button]')).toBeNull();
    expect(buttonByLabel(el, 'Publish...')).toBeUndefined();
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    buttonByLabel(el, 'Create new draft from v2')!.click();
    await settle(fixture);
    expect(workflows.createWorkflowDraft).toHaveBeenCalledWith(1, { fromVersionId: 11 });
    expect(navigate).toHaveBeenCalledWith(['/admin/workflows', 1, 'versions', 12], {});
  });

  it('retires after confirmation', async () => {
    const { workflows, fixture, el } = await openPublished();
    el.querySelector<HTMLButtonElement>('[data-action-bar] [data-overflow]')!.click();
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-action="retire"]')!.click();
    await settle(fixture);
    Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Retire v2')!
      .click();
    await settle(fixture);
    expect(workflows.retireWorkflowVersion).toHaveBeenCalledWith(1, 11, { rowVersion: 'VVVV' });
  });

  it('offers Open draft in place of a second draft while one exists', async () => {
    const { el } = await openPublished({
      getWorkflow: vi.fn().mockReturnValue(ok(wfDetail({ draftVersionId: 12, draftVersionNo: 3 }))),
    });
    expect(buttonByLabel(el, 'Create new draft from v2')).toBeUndefined();
    const open = el.querySelector('[data-action-bar] [data-open-draft]')!;
    expect(open.textContent).toContain('Open draft v3');
    expect(open.getAttribute('href')).toBe('/admin/workflows/1/versions/12');
    expect(el.querySelector('[data-readonly-banner] a')?.getAttribute('href')).toBe(
      '/admin/workflows/1/versions/12',
    );
  });
});

describe('WorkflowVersionPage tabs, switcher and impact lines (WP-TY6)', () => {
  const ref = (id: number, name: string, isActive = true) => ({
    taskTypeId: id,
    name,
    isActive,
    isDefault: false,
  });
  const detail = (): WorkflowDetail => {
    const d = wfDetail({
      draftVersionId: 12,
      draftVersionNo: 3,
      taskTypes: [ref(1, 'Billing request 02'), ref(2, 'Refunds'), ref(3, 'Old', false)],
    });
    d.versions.unshift(
      versionSummary({ workflowVersionId: 12, versionNo: 3, status: WorkflowVersionStatus.Draft }),
    );
    return d;
  };

  async function open(
    versionId: number,
    opts: { permissions?: string[]; tab?: string; extra?: Record<string, unknown> } = {},
    taskTypes: Record<string, unknown> = {},
    lookup: unknown[] = [],
  ) {
    const versions = {
      11: versionDetail({
        workflowVersionId: 11,
        versionNo: 2,
        status: WorkflowVersionStatus.Published,
        openTaskCount: 14,
      }),
      12: versionDetail({
        workflowVersionId: 12,
        versionNo: 3,
        status: WorkflowVersionStatus.Draft,
      }),
    } as Record<number, WorkflowVersionDetail>;
    const workflows = {
      getWorkflow: vi.fn().mockReturnValue(ok(detail())),
      getWorkflowVersion: vi.fn().mockImplementation((_w: number, v: number) => ok(versions[v])),
      retireWorkflowVersion: vi.fn().mockReturnValue(ok(versions[11])),
      ...opts.extra,
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        provideFakeMe(
          new FakeMeApi(withPermissions(...((opts.permissions ?? ['Workflow.Manage']) as never[]))),
        ),
        { provide: WorkflowsClient, useValue: workflows },
        { provide: StepDefinitionsClient, useValue: { listStepDefinitions: vi.fn() } },
        { provide: FormsClient, useValue: {} },
        { provide: TaskTypesClient, useValue: taskTypes },
      ],
    });
    TestBed.overrideComponent(WorkflowVersionPage, {
      set: { providers: [{ provide: WorkflowLookup, useValue: { list: () => ok(lookup) } }] },
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(WorkflowVersionPage);
    fixture.componentRef.setInput('workflowId', '1');
    fixture.componentRef.setInput('versionId', String(versionId));
    if (opts.tab) fixture.componentRef.setInput('tab', opts.tab);
    await settle(fixture);
    return { workflows, fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('has the tabs Steps (n) and Used by (n) with the active task types, and no Versions tab', async () => {
    const { el } = await open(12);
    const tabs = Array.from(el.querySelectorAll('[role="tab"]')).map((t) =>
      t.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(tabs).toEqual(['Steps (2)', 'Used by (2)']);
    expect(el.querySelector('[data-steps]')).not.toBeNull();
    expect(el.querySelector('[data-used-by-panel]')).toBeNull();
  });

  it('shows the task types of the workflow on the Used by tab, names plain without TaskType.Manage', async () => {
    const { el } = await open(12, { tab: 'used-by' });
    expect(el.querySelector('[data-steps]')).toBeNull();
    expect(
      Array.from(el.querySelectorAll('[data-task-type]')).map((r) =>
        r.getAttribute('data-task-type'),
      ),
    ).toEqual(['1', '2', '3']);
    expect(el.querySelector('[data-task-types-tab] a')).toBeNull();
  });

  it('switches version from the header, keeping the tab; the current version is marked', async () => {
    const { fixture, el } = await open(12);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const trigger = el.querySelector<HTMLElement>('[data-version-switcher] [data-overflow]')!;
    expect(trigger.textContent).toContain('v3 Draft');
    trigger.click();
    await settle(fixture);
    const items = Array.from(
      el.querySelectorAll<HTMLElement>('[data-version-switcher] [role="menuitem"]'),
    );
    expect(items.map((i) => i.textContent!.trim())).toEqual([
      'v3 Draft',
      'v2 Published (current)',
      'v1 Retired',
    ]);
    expect(items[0].getAttribute('aria-current')).toBe('true');
    items[1].click();
    await settle(fixture);
    expect(navigate).toHaveBeenCalledWith(
      ['/admin/workflows', '1', 'versions', 11],
      expect.objectContaining({ queryParams: { tab: null } }),
    );
  });

  it('retire dialog says which task types have no other published workflow and keeps the open tasks (Task.View)', async () => {
    const taskTypes = {
      listTaskTypes: vi.fn().mockReturnValue(
        ok([
          { id: 1, name: 'Billing request 02', isActive: true, eligibleWorkflowIds: [1] },
          { id: 2, name: 'Refunds', isActive: true, eligibleWorkflowIds: [1, 2] },
        ]),
      ),
    };
    const { workflows, fixture, el } = await open(
      11,
      { permissions: ['Workflow.Manage', 'Task.View'] },
      taskTypes,
      [
        { id: 1, name: 'This', publishedVersionNo: 2, isActive: true },
        { id: 2, name: 'Other', publishedVersionNo: 1, isActive: true },
      ],
    );
    el.querySelector<HTMLButtonElement>('[data-action-bar] [data-overflow]')!.click();
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-action="retire"]')!.click();
    await settle(fixture);
    expect(taskTypes.listTaskTypes).toHaveBeenCalledWith(1);
    expect(document.body.querySelector('[data-retire-impact]')?.textContent).toBe(
      'Billing request 02 has no other published workflow. 14 open tasks keep running on v2. New tasks cannot use it.',
    );
    expect(buttonByLabel(document.body, 'Keep published')).toBeDefined();
    buttonByLabel(document.body, 'Retire v2')!.click();
    await settle(fixture);
    expect(workflows.retireWorkflowVersion).toHaveBeenCalled();
  });

  it('retire dialog without Task.View leaves the unknown parts out (no made-up numbers)', async () => {
    const { workflows, fixture, el } = await open(11, {
      extra: {
        getWorkflowVersion: vi.fn().mockReturnValue(
          ok(
            versionDetail({
              workflowVersionId: 11,
              versionNo: 2,
              status: WorkflowVersionStatus.Published,
              openTaskCount: undefined,
            }),
          ),
        ),
      },
    });
    el.querySelector<HTMLButtonElement>('[data-action-bar] [data-overflow]')!.click();
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-action="retire"]')!.click();
    await settle(fixture);
    expect(document.body.querySelector('[data-retire-impact]')?.textContent).toBe(
      'New tasks cannot use it.',
    );
    expect(workflows.retireWorkflowVersion).not.toHaveBeenCalled();
  });
});
