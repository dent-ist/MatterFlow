import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { StepDefinitionsClient, WorkflowsClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { AdminCounts } from './admin-counts';
import { TaskTypesApi } from './task-types-api';

@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class Tab {
  readonly report = AdminCounts.report('workflows');
}

async function setup(permissions: Permission[], overrides: Record<string, unknown> = {}) {
  const taskTypes = {
    list: vi
      .fn()
      .mockReturnValue(of([{ isActive: true }, { isActive: true }, { isActive: false }])),
  };
  const workflows = (overrides['workflows'] as { listWorkflows: ReturnType<typeof vi.fn> }) ?? {
    listWorkflows: vi.fn().mockReturnValue(of({ summary: { active: 30 } })),
  };
  const steps = { listStepDefinitions: vi.fn().mockReturnValue(of({ summary: { active: 66 } })) };
  TestBed.configureTestingModule({
    providers: [
      provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
      AdminCounts,
      { provide: TaskTypesApi, useValue: taskTypes },
      { provide: WorkflowsClient, useValue: workflows },
      { provide: StepDefinitionsClient, useValue: steps },
    ],
  });
  await TestBed.inject(AuthStore).ensureLoaded();
  return { counts: TestBed.inject(AdminCounts), taskTypes, workflows, steps };
}

describe('AdminCounts (#364)', () => {
  it('reads the active count of each tab the person may use, one request each', async () => {
    const { counts, taskTypes, workflows, steps } = await setup([
      'TaskType.Manage',
      'Workflow.Manage',
    ]);
    expect(counts.counts()).toEqual({ 'task-types': null, workflows: null, steps: null });
    await counts.load();
    expect(counts.counts()).toEqual({ 'task-types': 2, workflows: 30, steps: 66 });
    expect(taskTypes.list).toHaveBeenCalledTimes(1);
    // One row of the list, no filter: the answer carries the library-wide summary.
    expect(workflows.listWorkflows).toHaveBeenCalledTimes(1);
    expect(workflows.listWorkflows.mock.calls[0].slice(-2)).toEqual([1, 1]);
    expect(steps.listStepDefinitions).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing a person may not use', async () => {
    const { counts, taskTypes, workflows, steps } = await setup(['Workflow.Manage']);
    await counts.load();
    expect(counts.counts()).toEqual({ 'task-types': null, workflows: 30, steps: 66 });
    expect(taskTypes.list).not.toHaveBeenCalled();
    expect(workflows.listWorkflows).toHaveBeenCalledTimes(1);
    expect(steps.listStepDefinitions).toHaveBeenCalledTimes(1);
  });

  it('leaves a count it could not read unknown, and the others alone', async () => {
    const { counts } = await setup(['TaskType.Manage', 'Workflow.Manage'], {
      workflows: { listWorkflows: vi.fn().mockReturnValue(throwError(() => new Error('down'))) },
    });
    await counts.load();
    expect(counts.counts()).toEqual({ 'task-types': 2, workflows: null, steps: 66 });
  });

  it('keeps the number the open tab reported (a deactivate moves it without a request)', async () => {
    const { counts } = await setup(['TaskType.Manage', 'Workflow.Manage']);
    const fixture = TestBed.createComponent(Tab);
    fixture.componentInstance.report(29);
    expect(counts.counts()['workflows']).toBe(29);
    await counts.load(); // the answer that was on its way does not overwrite the newer number
    expect(counts.counts()['workflows']).toBe(29);
    fixture.destroy();
    fixture.componentInstance.report(5); // a tab that is gone reports nothing
    expect(counts.counts()['workflows']).toBe(29);
  });
});
