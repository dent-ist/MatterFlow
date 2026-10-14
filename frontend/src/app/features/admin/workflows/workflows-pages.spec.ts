import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import {
  StepDefinitionSummary,
  StepDefinitionsClient,
  FormsClient,
  WorkflowDetail,
  WorkflowSummary,
  WorkflowVersionDetail,
  WorkflowVersionStatus,
  WorkflowVersionStepModel,
  WorkflowVersionSummary,
  WorkflowsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
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
  rowVersion: 'WWWW',
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
  rowVersion: 'S',
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
  Array.from(el.querySelectorAll('[data-steps] ol > li')).map((li) =>
    li.getAttribute('data-step-row'),
  );

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
    expect(api.listWorkflows).toHaveBeenCalledWith(undefined, undefined, true, 1, 25);
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
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    const rows = Array.from(el.querySelectorAll('[data-history] tbody tr'));
    expect(rows.map((r) => r.getAttribute('data-version'))).toEqual(['2', '1']);
    expect(rows[0].textContent).toContain('Published');
    expect(rows[1].textContent).toContain('Retired');

    buttonByLabel(el, 'Create new draft from v2')!.click();
    await settle(fixture);
    expect(api.createWorkflowDraft).toHaveBeenCalledWith(1, { fromVersionId: 11 });
    expect(navigate).toHaveBeenCalledWith(['/admin/workflows', 1, 'versions', 12]);
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

  it('adds, reorders with buttons and keyboard, and removes steps; the guard tracks edits', async () => {
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

    click(el, '[data-move="up"][data-step="5"]');
    await settle(fixture);
    expect(titles(el)).toEqual(['Intake QC', 'OCR', 'Load']);
    expect(el.querySelector<HTMLButtonElement>('[data-move="up"][data-step="1"]')!.disabled).toBe(
      true,
    );
    expect(el.querySelector<HTMLButtonElement>('[aria-label="Move OCR up"]')).not.toBeNull();

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

    click(el, '[data-remove="1"]');
    await settle(fixture);
    expect(titles(el)).toEqual(['Load', 'OCR']);
  });

  it('keeps comment-required disabled unless the step is skippable', async () => {
    const { a, fixture, el } = await open();
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

  it('explains the mode and confirms a change when steps exist', async () => {
    const { fixture, el } = await open();
    expect(el.querySelector('[data-mode-help]')?.textContent).toContain('Ordered:');
    expect(el.querySelector('[data-step-row="Load"]')?.textContent).toContain('2.');

    click(el, '[data-mode="unordered"]');
    await settle(fixture);
    expect(document.body.textContent).toContain(
      'Ordered numbering will be hidden; steps can be done in any order.',
    );
    // Not applied until confirmed.
    expect(el.querySelector('[data-mode-help]')?.textContent).toContain('Ordered:');
    const confirm = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Change mode',
    )!;
    confirm.click();
    await settle(fixture);
    expect(el.querySelector('[data-mode-help]')?.textContent).toContain('Unordered:');
    expect(el.querySelector('[data-step-row="Load"]')?.textContent).not.toContain('2.');
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

    const toggle = el.querySelector<HTMLButtonElement>('[data-preview="1"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await settle(fixture);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
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
    expect(diff).toContain('Added "Step 5"');
    expect(diff).toContain('Removed "Old step"');
    expect(diff).toContain('existing tasks stay on their current version');

    expect(a.workflows['publishWorkflowVersion']).not.toHaveBeenCalled();
    Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Publish v3')!
      .click();
    await settle(fixture);
    expect(a.workflows['publishWorkflowVersion']).toHaveBeenCalledWith(1, 12, {
      rowVersion: 'NEW',
    });
    expect(navigate).toHaveBeenCalledWith(['/admin/workflows', 1]);
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
    click(el, '[data-remove="2"]');
    await settle(fixture);
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
    expect(el.querySelector('[data-readonly-banner]')).not.toBeNull();
    expect(el.querySelector('[data-add]')).toBeNull();
    expect(el.querySelector('[data-move]')).toBeNull();
    expect(el.querySelector('[data-skippable]')).toBeNull();
    expect(buttonByLabel(el, 'Publish...')).toBeUndefined();
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    buttonByLabel(el, 'Create new draft from v2')!.click();
    await settle(fixture);
    expect(workflows.createWorkflowDraft).toHaveBeenCalledWith(1, { fromVersionId: 11 });
    expect(navigate).toHaveBeenCalledWith(['/admin/workflows', 1, 'versions', 12]);
  });

  it('retires after confirmation', async () => {
    const { workflows, fixture, el } = await openPublished();
    buttonByLabel(el, 'Retire version')!.click();
    await settle(fixture);
    Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Retire')!
      .click();
    await settle(fixture);
    expect(workflows.retireWorkflowVersion).toHaveBeenCalledWith(1, 11, { rowVersion: 'VVVV' });
  });

  it('disables creating a draft while one exists', async () => {
    const { el } = await openPublished({
      getWorkflow: vi.fn().mockReturnValue(ok(wfDetail({ draftVersionId: 12, draftVersionNo: 3 }))),
    });
    expect(buttonByLabel(el, 'Create new draft from v2')!.disabled).toBe(true);
    expect(el.querySelector('[data-readonly-banner] a')?.getAttribute('href')).toBe(
      '/admin/workflows/1/versions/12',
    );
  });
});
