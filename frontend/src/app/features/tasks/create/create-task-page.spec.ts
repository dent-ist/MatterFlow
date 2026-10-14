import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import {
  EmailSource,
  FormsClient,
  IntakeClient,
  MattersClient,
  PodsClient,
  PrioritiesClient,
  ProjectsClient,
  PublishedWorkflowSummary,
  StatusLabelsClient,
  TaskTypeView,
  TaskTypesClient,
  TasksClient,
  UsersLookupClient,
  WorkflowsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import {
  FakePrioritiesClient,
  FakeStatusLabelsClient,
} from '../../../core/lookups/lookups-testing';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { DOCUMENT_FIELDS, aFormVersion } from '../../../shared/testing/asset-testing';
import {
  FakeMeApi,
  aMatter,
  aProject,
  apiError,
  buttonByLabel,
  ok,
  pageOfMatters,
  pageOfProjects,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { CreateTaskPage } from './create-task-page';

type Mock = ReturnType<typeof vi.fn>;

const ALL: Permission[] = [
  'Task.View',
  'Task.Create',
  'Task.Assign',
  'Task.SetPriority',
  'Pod.View',
  'Matter.View',
];

const aType = (overrides: Partial<TaskTypeView> = {}): TaskTypeView => ({
  id: 1,
  name: 'Data Processing',
  description: undefined,
  isActive: true,
  defaultWorkflowDefinitionId: 10,
  eligibleWorkflowIds: [10, 11],
  formDefinitionId: 5,
  formStatus: undefined,
  publishedFormVersionId: 21,
  publishedFormVersionNo: 2,
  draftFormVersionNo: undefined,
  hasFormFields: true,
  isUsable: true,
  usabilityIssues: [],
  rowVersion: 'T1',
  ...overrides,
});

const aWorkflow = (id: number, name: string, steps: number): PublishedWorkflowSummary => ({
  workflowDefinitionId: id,
  name,
  description: undefined,
  workflowVersionId: id * 10,
  versionNo: 2,
  isOrdered: true,
  stepCount: steps,
  publishedAtUtc: '2026-10-01T12:00:00Z',
});

const createdTask = { taskId: 55, taskNumber: 'TSK-55' };

interface Harness {
  fixture: ReturnType<typeof TestBed.createComponent<CreateTaskPage>>;
  el: HTMLElement;
  tasks: { createTask: Mock };
  intake: { parseEmailText: Mock };
  users: { lookupUsers: Mock };
  pods: { listPods: Mock; getPod: Mock };
  router: Router;
}

async function create(
  options: {
    permissions?: Permission[];
    inputs?: Record<string, string>;
    types?: TaskTypeView[];
    matter?: ReturnType<typeof aMatter>;
    createResult?: unknown;
  } = {},
): Promise<Harness> {
  const matter = options.matter ?? aMatter();
  const tasks = {
    createTask: vi.fn().mockReturnValue(options.createResult ?? ok(createdTask)),
  };
  const intake = {
    parseEmailText: vi.fn().mockReturnValue(
      ok({
        subject: 'Production volume 7',
        body: 'Please prepare the load file.',
        fromName: 'Jane Doe',
        fromEmail: 'jane.doe@example-firm.test',
        sentAt: '2026-10-12T13:15:00+00:00',
        source: EmailSource.Text,
        warnings: [],
      }),
    ),
  };
  const users = {
    lookupUsers: vi.fn().mockReturnValue(ok([{ userId: 9, displayName: 'Tariq M.' }])),
  };
  const pods = {
    listPods: vi.fn().mockReturnValue(
      ok({
        items: [{ podId: 4, name: 'Pod A', isActive: true, memberCount: 1, rowVersion: 'p' }],
        total: 1,
        page: 1,
        pageSize: 100,
      }),
    ),
    getPod: vi
      .fn()
      .mockReturnValue(ok({ pod: {}, members: [{ userId: 2, displayName: 'Other' }] })),
  };
  const matters = {
    getMatter: vi.fn().mockReturnValue(ok(matter)),
    listMatters: vi.fn().mockReturnValue(ok(pageOfMatters(matter))),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      MessageService,
      provideFakeMe(new FakeMeApi(withPermissions(...(options.permissions ?? ALL)))),
      { provide: USER_TIME_ZONE, useValue: 'UTC' },
      { provide: Clock, useValue: { now: () => new Date('2026-10-14T12:00:00Z') } },
      { provide: PrioritiesClient, useValue: new FakePrioritiesClient() },
      { provide: StatusLabelsClient, useValue: new FakeStatusLabelsClient() },
      {
        provide: TaskTypesClient,
        useValue: { listTaskTypes: vi.fn().mockReturnValue(ok(options.types ?? [aType()])) },
      },
      {
        provide: WorkflowsClient,
        useValue: {
          listPublishedWorkflows: vi
            .fn()
            .mockReturnValue(
              ok([aWorkflow(10, 'Standard Processing', 6), aWorkflow(11, 'Rush', 3)]),
            ),
        },
      },
      {
        provide: FormsClient,
        useValue: {
          getFormVersionSchema: vi.fn().mockReturnValue(ok(aFormVersion(DOCUMENT_FIELDS))),
        },
      },
      { provide: MattersClient, useValue: matters },
      {
        provide: ProjectsClient,
        useValue: {
          listProjects: vi.fn().mockReturnValue(ok(pageOfProjects(aProject()))),
          getProject: vi.fn().mockReturnValue(ok(aProject())),
        },
      },
      { provide: PodsClient, useValue: pods },
      { provide: UsersLookupClient, useValue: users },
      { provide: TasksClient, useValue: tasks },
      { provide: IntakeClient, useValue: intake },
    ],
  });
  const router = TestBed.inject(Router);
  vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  await TestBed.inject(AuthStore).ensureLoaded();
  const fixture = TestBed.createComponent(CreateTaskPage);
  for (const [key, value] of Object.entries(options.inputs ?? {})) {
    fixture.componentRef.setInput(key, value);
  }
  await settle(fixture);
  return { fixture, el: fixture.nativeElement, tasks, intake, users, pods, router };
}

const field = <T extends HTMLElement>(h: Harness, selector: string): T =>
  h.el.querySelector<T>(selector)!;

async function type(h: Harness, selector: string, value: string): Promise<void> {
  const input = field<HTMLInputElement | HTMLTextAreaElement>(h, selector);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await settle(h.fixture);
}

async function choose(h: Harness, selector: string, value: string): Promise<void> {
  const select = field<HTMLSelectElement>(h, selector);
  select.value = value;
  select.dispatchEvent(new Event('change'));
  await settle(h.fixture);
}

async function submit(h: Harness): Promise<void> {
  field<HTMLFormElement>(h, 'form').dispatchEvent(new Event('submit'));
  await settle(h.fixture);
}

async function fillRequired(h: Harness): Promise<void> {
  await type(h, '#ct-title', 'Process Smith custodians');
  await type(h, '#ct-requestor-name', 'Jane Doe');
  await choose(h, '#ct-type', '1');
}

describe('CreateTaskPage', () => {
  it('shows only active types, disabling those without an eligible published workflow', async () => {
    const h = await create({
      types: [
        aType(),
        aType({ id: 2, name: 'Broken', isUsable: false, eligibleWorkflowIds: [] }),
        aType({ id: 3, name: 'Retired', isActive: false }),
      ],
    });
    const options = Array.from(h.el.querySelectorAll<HTMLOptionElement>('#ct-type option'));
    expect(options.map((o) => o.textContent!.trim())).toEqual([
      'Select...',
      'Broken (no workflow available)',
      'Data Processing',
    ]);
    expect(options[1].disabled).toBe(true);
    expect(options[2].disabled).toBe(false);
  });

  it('preselects the default workflow and renders the type form with its conditional rules', async () => {
    const h = await create({ inputs: { matterId: '7' } });
    expect(field(h, '[data-request-details]')).toBeNull();

    await choose(h, '#ct-type', '1');

    const radios = Array.from(h.el.querySelectorAll<HTMLInputElement>('[data-workflows] input'));
    expect(radios.map((r) => r.checked)).toEqual([true, false]);
    expect(field(h, '[data-workflows]').textContent).toContain('Standard Processing v2');
    expect(field(h, '[data-request-details]').textContent).toContain('Workspace ID');
    expect(field(h, '[data-request-details]').textContent).not.toContain('OCR language');

    const scanned = field<HTMLInputElement>(h, '[data-request-details] input[type=checkbox]');
    scanned.click();
    await settle(h.fixture);
    expect(field(h, '[data-request-details]').textContent).toContain('OCR language');
    expect(field(h, '[data-summary-card]').textContent).toContain(
      'Standard Processing v2 (6 steps',
    );
  });

  it('blocks submit with a summary while the visible required request field is empty', async () => {
    const h = await create({ inputs: { matterId: '7' } });
    await fillRequired(h);

    await submit(h);

    expect(h.tasks.createTask).not.toHaveBeenCalled();
    expect(field(h, '[data-summary]').textContent).toContain('Workspace ID: Enter workspace ID.');
  });

  it('creates the task in one call with the form values, due date and assignment, then opens it', async () => {
    const h = await create({ inputs: { matterId: '7', projectId: '3' } });
    await fillRequired(h);
    await type(h, '#ct-requestor-email', 'jane@example-firm.test');
    await type(h, '#ct-description', 'Load file by Friday');
    await choose(h, '#ct-priority', '2');
    await type(h, '#ct-due-date', '2026-10-30');
    await type(h, '#ct-due-time', '15:00');
    await choose(h, '#ct-pod', '4');
    await type(h, '[data-request-details] input[type=text]', 'WS-9');

    await type(h, '#ct-user', 'tar');
    await new Promise((r) => setTimeout(r, 300));
    await settle(h.fixture);
    h.el.querySelector<HTMLElement>('#ct-user-opt-0')!.dispatchEvent(new MouseEvent('mousedown'));
    await settle(h.fixture);

    expect(field(h, '[data-due-help]').textContent).toContain('local time zone (UTC)');
    expect(field(h, '[data-not-in-pod]').textContent).toContain("Tariq M. isn't a member of Pod A");

    await submit(h);

    expect(h.tasks.createTask).toHaveBeenCalledTimes(1);
    expect(h.tasks.createTask.mock.calls[0][0]).toEqual({
      matterId: 7,
      projectId: 3,
      taskTypeId: 1,
      workflowDefinitionId: 10,
      title: 'Process Smith custodians',
      description: 'Load file by Friday',
      requestorName: 'Jane Doe',
      requestorEmail: 'jane@example-firm.test',
      requestedAtUtc: undefined,
      priorityId: 2,
      dueDate: '2026-10-30',
      dueTime: '15:00',
      assignedPodId: 4,
      assignedUserId: 9,
      formValues: { workspace_id: 'WS-9' },
    });
    expect(h.router.navigateByUrl).toHaveBeenCalledWith('/tasks/55');
  });

  it('shows ASAP help without a due date and warns about a past date', async () => {
    const h = await create();
    expect(field(h, '[data-due-help]').textContent).toContain('ASAP');
    await type(h, '#ct-due-date', '2026-10-01');
    expect(field(h, '[data-past-due]').textContent).toContain('already passed');
    await type(h, '#ct-due-date', '2026-10-20');
    expect(field(h, '[data-past-due]')).toBeNull();
  });

  it('requires a date before a time', async () => {
    const h = await create({ inputs: { matterId: '7' } });
    await fillRequired(h);
    await type(h, '[data-request-details] input[type=text]', 'WS-9');
    await type(h, '#ct-due-time', '09:00');

    await submit(h);

    expect(h.tasks.createTask).not.toHaveBeenCalled();
    expect(field(h, '#ct-due-date').closest('.mf-field')!.textContent).toContain(
      'Enter a date before adding a time.',
    );
  });

  it('shows the sensitive-matter warning', async () => {
    const h = await create({ inputs: { matterId: '7' }, matter: aMatter({ isSensitive: true }) });
    expect(field(h, '[data-sensitive-banner]').textContent).toContain('Sensitive matter');
  });

  it('does not preselect an inactive matter', async () => {
    const h = await create({ inputs: { matterId: '7' }, matter: aMatter({ isActive: false }) });
    expect(field(h, '#ct-matter')).not.toBeNull();
    expect(h.el.textContent).toContain('This matter is inactive. Choose an active matter.');
  });

  describe('request form on type change', { timeout: 20000 }, () => {
    it('asks before clearing entered request details and keeps them on Keep', async () => {
      const h = await create({
        inputs: { matterId: '7' },
        types: [
          aType(),
          aType({ id: 2, name: 'Other', hasFormFields: false, publishedFormVersionId: undefined }),
        ],
      });
      await choose(h, '#ct-type', '1');
      await type(h, '[data-request-details] input[type=text]', 'WS-9');

      const select = field<HTMLSelectElement>(h, '#ct-type');
      select.value = '2';
      select.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 50)); // an open dialog never lets the fixture settle in tests
      h.fixture.detectChanges();
      expect(document.body.textContent).toContain(
        'Changing the task type clears the request details you entered.',
      );
      expect(field<HTMLSelectElement>(h, '#ct-type').value).toBe('1');

      buttonByLabel(document.querySelector('[role=dialog]')!, 'Change')!.click();
      await new Promise((r) => setTimeout(r, 50)); // the closing dialog animation never settles in tests
      h.fixture.detectChanges();
      expect(field<HTMLSelectElement>(h, '#ct-type').value).toBe('2');
      expect(field(h, '[data-request-details] mf-dynamic-form')).toBeNull();
    });
  });

  describe('server errors', () => {
    it('maps field and form:<key> errors to inputs and preserves the input', async () => {
      const h = await create({
        inputs: { matterId: '7' },
        createResult: apiError(400, {
          code: 'VALIDATION_FAILED',
          detail: 'Validation failed.',
          errors: {
            title: [{ code: 'INVALID', message: 'That title is not allowed.' }],
            'form:workspace_id': [{ code: 'REQUIRED', message: 'Enter Workspace ID.' }],
            requestorEmail: [{ code: 'INVALID', message: 'Enter a valid email address.' }],
          },
        }),
      });
      await fillRequired(h);
      await type(h, '[data-request-details] input[type=text]', 'WS-9');

      await submit(h);

      expect(h.tasks.createTask).toHaveBeenCalled();
      expect(field(h, '#ct-title').closest('.mf-field')!.textContent).toContain(
        'That title is not allowed.',
      );
      expect(field(h, '#ct-requestor-email').closest('.mf-field')!.textContent).toContain(
        'Enter a valid email address.',
      );
      expect(field(h, '[data-request-details]').textContent).toContain('Enter Workspace ID.');
      expect(field(h, '[data-summary]').textContent).toContain('That title is not allowed.');
      expect(field<HTMLInputElement>(h, '#ct-title').value).toBe('Process Smith custodians');
      expect(field<HTMLInputElement>(h, '[data-request-details] input[type=text]').value).toBe(
        'WS-9',
      );
      expect(h.router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('shows the message of an inactive-matter conflict and keeps the form', async () => {
      const h = await create({
        inputs: { matterId: '7' },
        createResult: apiError(409, {
          code: 'MATTER_INACTIVE',
          detail: "Matter 00343-00012 is inactive; tasks can't be created on it.",
        }),
      });
      await fillRequired(h);
      await type(h, '[data-request-details] input[type=text]', 'WS-9');

      await submit(h);

      expect(field(h, '[data-summary]').textContent).toContain('is inactive');
      expect(field<HTMLInputElement>(h, '#ct-title').value).toBe('Process Smith custodians');
    });
  });

  describe('permissions', () => {
    it('hides priority choice and assignment without Task.SetPriority and Task.Assign', async () => {
      const h = await create({
        permissions: ['Task.View', 'Task.Create', 'Matter.View'],
        inputs: { matterId: '7' },
      });
      expect(field(h, '#ct-priority')).toBeNull();
      expect(field(h, '[data-priority-fixed]').textContent).toContain('Normal');
      expect(field(h, '#ct-user')).toBeNull();
      expect(field(h, '#ct-pod')).toBeNull();
      expect(field(h, '[data-no-assign]')).not.toBeNull();

      await fillRequired(h);
      await type(h, '[data-request-details] input[type=text]', 'WS-9');
      await submit(h);

      const body = h.tasks.createTask.mock.calls[0][0];
      expect(body.priorityId).toBeUndefined();
      expect(body.assignedPodId).toBeUndefined();
      expect(body.assignedUserId).toBeUndefined();
    });

    it('refuses the page without Task.Create', async () => {
      const h = await create({ permissions: ['Task.View'] });
      expect(field(h, '[data-denied]')).not.toBeNull();
      expect(field(h, 'form')).toBeNull();
    });
  });

  describe('Quick fill from email', () => {
    it('prefills title, description and requestor, all still editable', async () => {
      const h = await create({ inputs: { matterId: '7' } });

      const paste = field<HTMLTextAreaElement>(h, '#ei-paste');
      paste.value =
        'From: Jane Doe <jane.doe@example-firm.test>\nSubject: Production volume 7\n\nPlease prepare the load file.';
      paste.dispatchEvent(new Event('input'));
      await settle(h.fixture);
      buttonByLabel(h.el, 'Fill from pasted text')!.click();
      await settle(h.fixture);
      buttonByLabel(h.el, 'Fill the task')!.click();
      await settle(h.fixture);

      expect(h.intake.parseEmailText).toHaveBeenCalled();
      expect(field<HTMLInputElement>(h, '#ct-title').value).toBe('Production volume 7');
      expect(field<HTMLTextAreaElement>(h, '#ct-description').value).toBe(
        'Please prepare the load file.',
      );
      expect(field<HTMLInputElement>(h, '#ct-requestor-name').value).toBe('Jane Doe');
      expect(field<HTMLInputElement>(h, '#ct-requestor-email').value).toBe(
        'jane.doe@example-firm.test',
      );
      expect(field(h, '[data-source-sent]')).not.toBeNull();
      expect(field(h, '#ct-type')).not.toBeNull();

      await type(h, '#ct-title', 'Edited by hand');
      await choose(h, '#ct-type', '1');
      await type(h, '[data-request-details] input[type=text]', 'WS-9');
      await submit(h);
      const body = h.tasks.createTask.mock.calls[0][0];
      expect(body.title).toBe('Edited by hand');
      expect(body.requestedAtUtc).toBe('2026-10-12T13:15:00+00:00');
    });
  });

  it('keeps matter, project, priority and pod on Create and add another', async () => {
    const h = await create({ inputs: { matterId: '7', projectId: '3' } });
    await fillRequired(h);
    await choose(h, '#ct-pod', '4');
    await type(h, '[data-request-details] input[type=text]', 'WS-9');

    buttonByLabel(h.el, 'Create and add another')!.click();
    await settle(h.fixture);

    expect(h.tasks.createTask).toHaveBeenCalledTimes(1);
    expect(h.router.navigateByUrl).not.toHaveBeenCalled();
    expect(field<HTMLInputElement>(h, '#ct-title').value).toBe('');
    expect(field<HTMLSelectElement>(h, '#ct-type').value).toBe('');
    expect(field<HTMLSelectElement>(h, '#ct-pod').value).toBe('4');
    expect(field<HTMLSelectElement>(h, '#ct-project').value).toBe('3');
    expect(field(h, '[data-chosen]').textContent).toContain('00343-00012');
  });

  it('reports unsaved changes until the task is created', async () => {
    const h = await create({ inputs: { matterId: '7' } });
    expect(h.fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    await type(h, '#ct-title', 'Draft');
    expect(h.fixture.componentInstance.hasUnsavedChanges()).toBe(true);
  });
});
