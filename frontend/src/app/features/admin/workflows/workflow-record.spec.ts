import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import {
  WorkflowDetail,
  WorkflowSummary,
  WorkflowVersionStatus,
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
import {
  activeTaskTypes,
  openTasksOnPublished,
  openTasksOnWorkflow,
  workflowStateBadges,
  workflowStripItems,
  workflowTabOf,
  workflowTabs,
} from './workflow-record';

const ref = (id: number, name: string, isActive = true, isDefault = false) => ({
  taskTypeId: id,
  name,
  isActive,
  isDefault,
});

const summary = (o: Partial<WorkflowSummary> = {}): WorkflowSummary => ({
  workflowDefinitionId: 1,
  name: 'Billing request',
  description: 'Bills',
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
  ...o,
});

const version = (o: Partial<WorkflowVersionSummary> = {}): WorkflowVersionSummary => ({
  workflowVersionId: 11,
  versionNo: 2,
  status: WorkflowVersionStatus.Published,
  isOrdered: true,
  stepCount: 3,
  createdAtUtc: '2026-10-01T10:00:00Z',
  publishedAtUtc: '2026-10-02T10:00:00Z',
  publishedByUserId: 1,
  rowVersion: 'V2',
  openTaskCount: 14,
  createdByUserId: 1,
  createdByName: 'Kim Reyes',
  ...o,
});

const detail = (
  w: Partial<WorkflowSummary> = {},
  versions: WorkflowVersionSummary[] = [
    version(),
    version({
      workflowVersionId: 10,
      versionNo: 1,
      status: WorkflowVersionStatus.Retired,
      openTaskCount: 2,
      createdByName: undefined,
    }),
  ],
): WorkflowDetail => ({ workflow: summary(w), versions });

describe('workflow record helpers', () => {
  it('reads the tab from the address; anything else is Overview', () => {
    expect(workflowTabOf('versions')).toBe('versions');
    expect(workflowTabOf('task-types')).toBe('task-types');
    expect(workflowTabOf('activity')).toBe('overview');
    expect(workflowTabOf(undefined)).toBe('overview');
  });

  it('counts versions and the active task types only', () => {
    const d = detail({
      taskTypes: [ref(1, 'A'), ref(2, 'B', false), ref(3, 'C', true, true)],
    });
    expect(activeTaskTypes(d).map((t) => t.name)).toEqual(['A', 'C']);
    expect(workflowTabs(d).map((t) => [t.label, t.count])).toEqual([
      ['Overview', undefined],
      ['Versions', 2],
      ['Task types', 2],
    ]);
    expect(workflowTabs(null).map((t) => t.count)).toEqual([undefined, '--', '--']);
  });

  it('names the state badges: Published vN or Not published, and the draft', () => {
    expect(workflowStateBadges(summary()).map((b) => b.label)).toEqual(['Published v2']);
    expect(
      workflowStateBadges(summary({ draftVersionId: 12, draftVersionNo: 3 })).map((b) => b.label),
    ).toEqual(['Published v2', 'Draft v3 in progress']);
    expect(
      workflowStateBadges(
        summary({ publishedVersionId: undefined, publishedVersionNo: undefined }),
      ).map((b) => [b.label, b.tone]),
    ).toEqual([['Not published', 'neutral']]);
  });

  it('shows only the open-task numbers the API returned', () => {
    const d = detail();
    expect(openTasksOnPublished(d)).toBe(14);
    expect(openTasksOnWorkflow(d)).toBe(16);
    const none = detail({}, [version({ openTaskCount: undefined })]);
    expect(openTasksOnPublished(none)).toBeNull();
    expect(openTasksOnWorkflow(none)).toBeNull();
  });

  it('builds the strip from the response; Open tasks is absent without the number and linked only when all open tasks run on the published version', () => {
    const items = workflowStripItems(
      detail({ draftVersionId: 12, draftVersionNo: 3, taskTypes: [ref(1, 'A')] }),
      true,
    );
    expect(items.map((i) => [i.key, i.value ?? i.count])).toEqual([
      ['published', 'v2'],
      ['draft', 'v3'],
      ['steps', 3],
      ['task-types', 1],
      ['open-tasks', 14],
    ]);
    // 16 open tasks in all, 14 on the published version: the Queue cannot filter by version, so no link.
    expect(items.find((i) => i.key === 'open-tasks')?.link).toBeUndefined();
    const single = workflowStripItems(
      detail({}, [
        version({ openTaskCount: 5 }),
        version({
          workflowVersionId: 10,
          versionNo: 1,
          status: WorkflowVersionStatus.Retired,
          openTaskCount: 0,
        }),
      ]),
      true,
    );
    expect(single.find((i) => i.key === 'open-tasks')?.link?.queryParams).toEqual({
      workflow: 1,
      status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'],
    });
    const noTasks = workflowStripItems(detail({}, [version({ openTaskCount: undefined })]), true);
    expect(noTasks.some((i) => i.key === 'open-tasks')).toBe(false);
    expect(workflowStripItems(detail(), false).some((i) => i.key === 'open-tasks')).toBe(false);
  });
});

type Permission = Parameters<typeof withPermissions>[number];

async function setup(api: Record<string, unknown>, ...permissions: Permission[]) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      MessageService,
      provideFakeMe(
        new FakeMeApi(
          withPermissions(
            ...(permissions.length ? permissions : (['Workflow.Manage'] as Permission[])),
          ),
        ),
      ),
      { provide: WorkflowsClient, useValue: api },
    ],
  });
  await TestBed.inject(AuthStore).ensureLoaded();
}

async function open(tab?: string) {
  const fixture = TestBed.createComponent(WorkflowEditPage);
  fixture.componentRef.setInput('workflowId', '1');
  if (tab) fixture.componentRef.setInput('tab', tab);
  await settle(fixture);
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('WorkflowEditPage record page (WP-TY5)', () => {
  it('shows the header, the strip and the three tabs with live counts', async () => {
    await setup({
      getWorkflow: vi.fn().mockReturnValue(
        ok(
          detail({
            taskTypes: [ref(1, 'Billing request 02', true, true), ref(2, 'Old', false)],
          }),
        ),
      ),
    });
    const { el } = await open();
    expect(el.querySelector('[data-page-title]')?.textContent).toContain('Billing request');
    expect(el.querySelector('[data-strip]')?.textContent).toContain('Published');
    const tabs = Array.from(el.querySelectorAll('[role="tab"]')).map((t) =>
      t.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(tabs).toEqual(['Overview', 'Versions (2)', 'Task types (1)']);
    // The overview keeps the editable fields; the status checkbox is gone on an existing workflow.
    expect(el.querySelector('#wf-name')).not.toBeNull();
    expect(el.querySelector('#wf-active')).toBeNull();
  });

  it('lists the task types with the default marker and links only with TaskType.Manage', async () => {
    const d = detail({
      taskTypes: [ref(2, 'Old type', false), ref(1, 'Billing request 02', true, true)],
    });
    await setup({ getWorkflow: vi.fn().mockReturnValue(ok(d)) }, 'Workflow.Manage');
    let { el } = await open('task-types');
    let rows = Array.from(el.querySelectorAll('[data-task-type]'));
    expect(rows.map((r) => r.getAttribute('data-task-type'))).toEqual(['1', '2']);
    expect(rows[0].textContent).toContain('Default workflow');
    expect(rows[1].textContent).toContain('Inactive');
    expect(el.querySelector('[data-task-types-tab] a')).toBeNull();
    expect(el.querySelector('[data-summary-line]')?.textContent).toContain(
      '1 task type active use this workflow. 1 inactive is listed and not counted.',
    );
    TestBed.resetTestingModule();

    await setup(
      { getWorkflow: vi.fn().mockReturnValue(ok(d)) },
      'Workflow.Manage',
      'TaskType.Manage',
    );
    ({ el } = await open('task-types'));
    rows = Array.from(el.querySelectorAll('[data-task-type]'));
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/admin/task-types/1');
  });

  it('says so when no task type uses the workflow', async () => {
    await setup({ getWorkflow: vi.fn().mockReturnValue(ok(detail())) });
    const { el } = await open('task-types');
    expect(el.querySelector('[data-no-task-types]')?.textContent).toContain(
      'No task type uses this workflow.',
    );
  });

  it('has Created, By and Tasks in the version table, and no Tasks column when the API sent no counts', async () => {
    await setup({ getWorkflow: vi.fn().mockReturnValue(ok(detail())) });
    let { el } = await open('versions');
    const heads = Array.from(el.querySelectorAll('[data-version-table] th')).map((h) =>
      h.textContent!.trim(),
    );
    expect(heads).toEqual([
      'Version',
      'Status',
      'Mode',
      'Steps',
      'Created',
      'By',
      'Tasks',
      'Actions',
    ]);
    expect(el.querySelector('[data-version="2"] [data-version-tasks]')?.textContent).toBe('14');
    expect(el.querySelector('[data-version="2"]')?.textContent).toContain('Kim Reyes');
    TestBed.resetTestingModule();

    const bare = detail({}, [version({ openTaskCount: undefined })]);
    await setup({ getWorkflow: vi.fn().mockReturnValue(ok(bare)) });
    ({ el } = await open('versions'));
    expect(el.querySelector('[data-version-tasks]')).toBeNull();
  });

  it('puts the draft behind Open draft while one exists: Create draft is disabled with its reason', async () => {
    await setup({
      getWorkflow: vi.fn().mockReturnValue(
        ok(
          detail({ draftVersionId: 12, draftVersionNo: 3 }, [
            version({
              workflowVersionId: 12,
              versionNo: 3,
              status: WorkflowVersionStatus.Draft,
              openTaskCount: 0,
            }),
            version(),
          ]),
        ),
      ),
    });
    const { fixture, el } = await open('versions');
    el.querySelector<HTMLElement>('[data-version="2"] [data-overflow]')!.click();
    await settle(fixture);
    const create = el.querySelector('[data-action="create-draft"]')!;
    expect(create.getAttribute('aria-disabled')).toBe('true');
    expect(el.querySelector('[data-action="open-draft"]')?.textContent).toContain('Open draft v3');
    expect(el.querySelector('[data-action="retire"]')).not.toBeNull();
  });

  it('retires a published version after the dialog names the open tasks', async () => {
    const api = {
      getWorkflow: vi.fn().mockReturnValue(ok(detail())),
      retireWorkflowVersion: vi.fn().mockReturnValue(
        ok({
          workflowDefinitionId: 1,
          workflowName: 'x',
          version: version({ status: WorkflowVersionStatus.Retired }),
          steps: [],
        }),
      ),
    };
    await setup(api);
    const { fixture, el } = await open('versions');
    el.querySelector<HTMLElement>('[data-version="2"] [data-overflow]')!.click();
    await settle(fixture);
    el.querySelector<HTMLElement>('[data-action="retire"]')!.click();
    await settle(fixture);
    expect(document.body.querySelector('[data-retire-impact]')?.textContent).toContain(
      '14 open tasks keep running on v2.',
    );
    buttonByLabel(document.body, 'Retire v2')!.click();
    await settle(fixture);
    expect(api.retireWorkflowVersion).toHaveBeenCalledWith(1, 11, { rowVersion: 'V2' });
  });

  it('deactivates from the header after a dialog that names the task types that lose the workflow', async () => {
    const d = detail({
      taskTypes: [
        ref(1, 'Billing request 02', true, true),
        ref(2, 'Refunds'),
        ref(3, 'Old', false),
      ],
    });
    const api = {
      getWorkflow: vi.fn().mockReturnValue(ok(d)),
      updateWorkflow: vi.fn().mockReturnValue(ok(detail({ isActive: false, rowVersion: 'N' }))),
    };
    await setup(api);
    const { fixture, el } = await open();
    el.querySelector<HTMLElement>('[data-record-header] [data-overflow]')!.click();
    await settle(fixture);
    el.querySelector<HTMLElement>('[data-action="deactivate"]')!.click();
    await settle(fixture);
    const body = document.body;
    expect(body.querySelector('[data-impact]')?.textContent).toContain(
      '2 task types lose this workflow.',
    );
    expect(body.querySelector('[data-impact]')?.textContent).toContain(
      '16 open tasks keep running on it.',
    );
    expect(
      Array.from(body.querySelectorAll('[data-impact-names] li')).map((l) => l.textContent),
    ).toEqual(['Billing request 02', 'Refunds']);
    buttonByLabel(body, 'Deactivate workflow')!.click();
    await settle(fixture);
    expect(api.updateWorkflow).toHaveBeenCalledWith(1, {
      name: 'Billing request',
      description: 'Bills',
      isActive: false,
      rowVersion: 'WWWW',
    });
  });

  it('asks before leaving the Overview with edits and reverts them on Leave', async () => {
    await setup({ getWorkflow: vi.fn().mockReturnValue(ok(detail())) });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const { fixture, el } = await open();
    const input = el.querySelector<HTMLInputElement>('#wf-name')!;
    input.value = 'Changed';
    input.dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    el.querySelector<HTMLElement>('[data-tab="versions"]')!.click();
    await settle(fixture);
    const { LeaveConfirmService } = await import('../../../shared/guards/unsaved-changes.guard');
    const leave = TestBed.inject(LeaveConfirmService);
    expect(leave.open()).toBe(true);
    expect(leave.saveOffer()?.label).toBe('Save and leave');
    leave.answer(true);
    await settle(fixture);
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { tab: 'versions' }, replaceUrl: true }),
    );
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('shows a conflict and keeps the person on the page', async () => {
    const api = {
      getWorkflow: vi.fn().mockReturnValue(ok(detail())),
      updateWorkflow: vi
        .fn()
        .mockReturnValue(
          apiError(409, { status: 409, title: 'Conflict', code: 'CONCURRENCY_CONFLICT' }),
        ),
    };
    await setup(api);
    const { fixture, el } = await open();
    const input = el.querySelector<HTMLInputElement>('#wf-name')!;
    input.value = 'X';
    input.dispatchEvent(new Event('input'));
    buttonByLabel(el, 'Save changes')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-conflict]')).not.toBeNull();
  });
});
