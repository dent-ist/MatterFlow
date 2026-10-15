import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { AssetPickerContext } from '../../../shared/ui/asset-picker';
import { TaskStep } from './task-step';

vi.setConfig({ testTimeout: 60000 });
import { of } from 'rxjs';
import { StepActionResponse, TaskResponse } from '../../../api/generated/api-client';
import { TaskDetailStore } from './task-detail.store';
import { apiError, settle } from '../../../shared/testing/org-testing';
import {
  aStep,
  aTask,
  allowed,
  click,
  dialogButton,
  mountTaskPage,
  q,
  transition,
} from './task-detail-testing';

const body = (): HTMLElement => document.body;
const stepResponse = (task: TaskResponse): StepActionResponse => ({
  task,
  affectedStepInstanceIds: [],
  droppedFields: [],
  taskStatusChanged: false,
});

const orderedSteps = () => [
  aStep({
    stepInstanceId: 101,
    sequenceNo: 1,
    title: 'Intake QC',
    status: 'COMPLETED',
    hasBeenResolved: true,
    resolvedAtUtc: '2026-10-13T15:00:00Z',
  }),
  aStep({
    stepInstanceId: 102,
    sequenceNo: 2,
    title: 'Load to Relativity',
    status: 'SKIPPED',
    hasBeenResolved: true,
    isSkippable: true,
    skipComment: 'Already loaded by vendor',
  }),
  aStep({
    stepInstanceId: 103,
    sequenceNo: 3,
    title: 'Deduplicate',
    status: 'IN_PROGRESS',
    isCurrent: true,
    isSkippable: true,
    skipCommentRequired: true,
    instructions: 'Run the global dedupe.',
    documentationUrl: 'https://docs.example.com/dedupe',
  }),
  aStep({ stepInstanceId: 104, sequenceNo: 4, title: 'OCR' }),
  aStep({ stepInstanceId: 105, sequenceNo: 5, title: 'Handover' }),
];

async function mountWorkflow(task: TaskResponse, extra: Parameters<typeof mountTaskPage>[2] = {}) {
  return mountTaskPage(task, ['Task.View', 'Workflow.Execute'], extra, 'workflow');
}

describe('Workflow tab: ordered stepper', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders an ordered list with states, the current step and locks the later steps', async () => {
    const { el } = await mountWorkflow(aTask({ workflow: { steps: orderedSteps() } as never }));

    expect(q(el, 'ol.wf__steps')).not.toBeNull();
    const items = Array.from(el.querySelectorAll('ol.wf__steps > li'));
    expect(items).toHaveLength(5);
    expect(items[2].getAttribute('aria-current')).toBe('step');
    expect(items[0].getAttribute('aria-current')).toBeNull();

    const state = (n: number) => items[n].querySelector('[data-state]')!.textContent!.trim();
    expect([0, 1, 2, 3].map(state)).toEqual(['Completed', 'Skipped', 'In progress', 'Pending']);
    expect(items[1].querySelector('[data-skip-comment]')!.textContent).toContain(
      'Already loaded by vendor',
    );
    expect(items[2].querySelector('[data-current]')).not.toBeNull();
    expect(items[3].querySelector('[data-locked]')!.textContent).toContain(
      'Complete or skip step 3 first',
    );
    expect(items[4].querySelector('[data-locked]')).not.toBeNull();
    expect(q(el, '[data-mode]')!.textContent).toContain('Ordered');
    expect(q(el, '[data-workflow-tab] [data-progress]')!.textContent).toContain('Resolved 2 of 5');
  });

  it('expands only the current step; the others are one-line summaries the user can open', async () => {
    const { fixture, el } = await mountWorkflow(
      aTask({ workflow: { steps: orderedSteps() } as never }),
    );
    const expanded = (id: number) =>
      q(el, `[data-step-id="${id}"] .step__toggle`)!.getAttribute('aria-expanded');
    expect([101, 102, 103, 104, 105].map(expanded)).toEqual([
      'false',
      'false',
      'true',
      'false',
      'false',
    ]);
    // A collapsed step has no body (no instructions, no actions) but keeps its status line.
    expect(q(el, '[data-step-id="101"] .step__body')).toBeNull();
    expect(q(el, '[data-step-id="101"] [data-state]')!.textContent).toContain('Completed');
    expect(q(el, '[data-step-id="102"] [data-skip-comment]')).not.toBeNull();

    await click(fixture, q(el, '[data-step-id="104"] .step__toggle'));
    expect(expanded(104)).toBe('true');
    expect(expanded(103)).toBe('true'); // opening one does not close another
    await click(fixture, q(el, '[data-step-id="103"] .step__toggle'));
    expect(expanded(103)).toBe('false');
  });

  it('folds a step once it is resolved and opens the step that becomes current', async () => {
    const { fixture, el } = await mountWorkflow(
      aTask({ workflow: { steps: orderedSteps() } as never }),
    );
    const next = orderedSteps();
    next[2] = aStep({ ...next[2], status: 'COMPLETED', isCurrent: false, hasBeenResolved: true });
    next[3] = aStep({ ...next[3], status: 'IN_PROGRESS', isCurrent: true });
    fixture.debugElement.injector
      .get(TaskDetailStore)
      .task.set(aTask({ workflow: { steps: next } as never }));
    await settle(fixture);

    const expanded = (id: number) =>
      q(el, `[data-step-id="${id}"] .step__toggle`)!.getAttribute('aria-expanded');
    expect(expanded(103)).toBe('false');
    expect(expanded(104)).toBe('true');
  });

  it('shows instructions and the documentation link for the current step and its actions', async () => {
    const { el } = await mountWorkflow(aTask({ workflow: { steps: orderedSteps() } as never }));
    const step = q(el, '[data-step-id="103"]')!;
    expect(step.querySelector('[data-instructions]')!.textContent).toContain(
      'Run the global dedupe.',
    );
    expect(step.querySelector<HTMLAnchorElement>('[data-doc-link]')!.href).toBe(
      'https://docs.example.com/dedupe',
    );
    expect(step.querySelector('[data-save]')).toBeNull(); // no input form
    expect(step.querySelector('[data-complete]')).not.toBeNull();
    expect(step.querySelector('[data-skip]')).not.toBeNull();
    // a locked step offers no actions
    expect(q(el, '[data-step-id="104"] [data-complete]')).toBeNull();
  });

  it('flags a reopened prerequisite and keeps later steps unchanged', async () => {
    const steps = orderedSteps();
    steps[0] = aStep({
      ...steps[0],
      status: 'IN_PROGRESS',
      isCurrent: true,
      isReopenedPrerequisite: true,
    });
    steps[2] = aStep({ ...steps[2], status: 'COMPLETED', isCurrent: false, hasBeenResolved: true });
    const { el } = await mountWorkflow(aTask({ workflow: { steps } as never }));

    const first = q(el, '[data-step-id="101"]')!;
    expect(first.querySelector('[data-reopened]')!.textContent).toContain('Reopened');
    expect(first.querySelector('[data-reopened-note]')!.textContent).toContain(
      'Later steps are unchanged',
    );
    expect(q(el, '[data-step-id="103"]')!.getAttribute('data-step-status')).toBe('COMPLETED');
    expect(q(el, '[data-step-id="104"] [data-locked]')!.textContent).toContain('step 1 first');
  });

  it('explains why actions are unavailable while the task is On Hold', async () => {
    const { el } = await mountWorkflow(
      aTask({
        status: 'ON_HOLD',
        workflow: { steps: orderedSteps() } as never,
        allowedActions: allowed({
          canExecuteSteps: false,
          canReopenSteps: false,
          transitions: [transition('RESUME')],
        }),
      }),
    );
    expect(q(el, '[data-workflow-notice]')!.textContent).toContain('On Hold');
    const step = q(el, '[data-step-id="103"]')!;
    expect(step.querySelector('[data-complete]')).toBeNull();
    expect(step.querySelector('[data-blocked-reason]')!.textContent).toContain('Resume it');
    expect(q(el, '[data-step-id="101"] [data-reopen]')).toBeNull();
  });

  it('shows the Complete task block at the end', async () => {
    const { fixture, el, fakes } = await mountWorkflow(
      aTask({ workflow: { steps: orderedSteps() } as never }),
    );
    expect(q(el, '[data-complete-task]')!.textContent).toContain('3 steps are not completed');
    await click(fixture, q(el, '[data-complete-task-button]'));
    expect(fakes.tasks['getTaskCompletionCheck']).toHaveBeenCalled();
  });
});

describe('Workflow tab: read-only viewers (UAT2-18)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows a view-only user no Complete task block, no instructions to complete and no edit-oriented notice', async () => {
    const { el } = await mountTaskPage(
      aTask({
        status: 'ON_HOLD',
        statusLabel: 'On Hold',
        workflow: { steps: orderedSteps() } as never,
        allowedActions: allowed({
          canExecuteSteps: false,
          transitions: [
            transition('COMPLETE', { permitted: false, blockedReason: 'PERMISSION_DENIED' }),
          ],
        }),
      }),
      ['Task.View'],
      {},
      'workflow',
    );

    expect(q(el, '[data-complete-task]')).toBeNull();
    expect(q(el, '[data-complete-task-button]')).toBeNull();
    expect(el.textContent).not.toContain('You will be asked');
    expect(el.textContent).not.toContain('Resume it');
    expect(q(el, '[data-view-only]')!.textContent).toContain('View only');
  });

  it('keeps the explained disabled Complete button for a user who works steps but cannot complete tasks', async () => {
    const { el } = await mountTaskPage(
      aTask({
        workflow: { steps: orderedSteps() } as never,
        allowedActions: allowed({
          transitions: [
            transition('COMPLETE', { permitted: false, blockedReason: 'PERMISSION_DENIED' }),
          ],
        }),
      }),
      ['Task.View', 'Workflow.Execute'],
      {},
      'workflow',
    );

    const block = q(el, '[data-complete-task]')!;
    expect(block.textContent).toContain("you don't have permission to complete it");
    expect((q(el, '[data-complete-task-button]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Workflow tab: step actions and skip rules', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('Mark complete sends the workflow rowVersion and applies the returned task', async () => {
    const steps = orderedSteps();
    const after = aTask({
      rowVersion: 'RV2',
      workflow: {
        steps: steps.map((s) =>
          s.stepInstanceId === 103 ? aStep({ ...s, status: 'COMPLETED', isCurrent: false }) : s,
        ),
      } as never,
    });
    const { fixture, el, fakes } = await mountWorkflow(aTask({ workflow: { steps } as never }), {
      workflow: { completeTaskStep: vi.fn().mockReturnValue(of(stepResponse(after))) },
    });
    await click(fixture, q(el, '[data-step-id="103"] [data-complete]'));
    expect(fakes.workflow['completeTaskStep']).toHaveBeenCalledWith(1042, 103, {
      rowVersion: 'WF1',
      values: undefined,
    });
    expect(q(el, '[data-step-id="103"]')!.getAttribute('data-step-status')).toBe('COMPLETED');
  });

  it('skip with a required comment cannot be confirmed without one', async () => {
    const { fixture, el, fakes } = await mountWorkflow(
      aTask({ workflow: { steps: orderedSteps() } as never }),
    );
    await click(fixture, q(el, '[data-step-id="103"] [data-skip]'));

    expect(body().textContent).toContain(
      'This step is skippable. Skipped steps count as resolved.',
    );
    expect(q(body(), 'label[for="skip-comment-103"]')!.textContent).toContain('(required)');
    await click(fixture, dialogButton('Skip step')!);
    expect(q(body(), '[data-skip-error]')!.textContent).toContain(
      'Add a comment to skip this step.',
    );
    expect(fakes.workflow['skipTaskStep']).not.toHaveBeenCalled();
  });

  it('skip sends the comment', async () => {
    const after = aTask({ rowVersion: 'RV2' });
    const { fixture, el, fakes } = await mountWorkflow(
      aTask({ workflow: { steps: orderedSteps() } as never }),
      { workflow: { skipTaskStep: vi.fn().mockReturnValue(of(stepResponse(after))) } },
    );
    await click(fixture, q(el, '[data-step-id="103"] [data-skip]'));
    const area = q(body(), '#skip-comment-103') as HTMLTextAreaElement;
    area.value = 'Not needed';
    area.dispatchEvent(new Event('input'));
    await click(fixture, dialogButton('Skip step')!);
    expect(fakes.workflow['skipTaskStep']).toHaveBeenCalledWith(1042, 103, {
      rowVersion: 'WF1',
      comment: 'Not needed',
    });
  });

  it('skip with an optional comment can be confirmed empty', async () => {
    const steps = orderedSteps();
    steps[2] = aStep({ ...steps[2], skipCommentRequired: false });
    const { fixture, el, fakes } = await mountWorkflow(aTask({ workflow: { steps } as never }), {
      workflow: { skipTaskStep: vi.fn().mockReturnValue(of(stepResponse(aTask()))) },
    });
    await click(fixture, q(el, '[data-step-id="103"] [data-skip]'));
    // Optional fields are not labelled (UXR-16): only a required comment says "(required)".
    expect(q(body(), 'label[for="skip-comment-103"]')!.textContent).not.toContain('(required)');
    await click(fixture, dialogButton('Skip step')!);
    expect(fakes.workflow['skipTaskStep']).toHaveBeenCalledWith(1042, 103, {
      rowVersion: 'WF1',
      comment: undefined,
    });
  });

  it('a non-skippable step has Skip disabled with the reason attached', async () => {
    const steps = orderedSteps();
    steps[2] = aStep({ ...steps[2], isSkippable: false });
    const { el } = await mountWorkflow(aTask({ workflow: { steps } as never }));
    const skip = q(el, '[data-step-id="103"] [data-skip]') as HTMLButtonElement;
    expect(skip.disabled).toBe(true);
    const hint = q(el, '[data-step-id="103"] [data-no-skip]')!;
    expect(hint.textContent).toContain("This step is required and can't be skipped.");
    expect(skip.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('reopen asks for confirmation (no reason) and warns when the task is Completed', async () => {
    const task = aTask({
      status: 'COMPLETED',
      statusLabel: 'Completed',
      workflow: {
        steps: orderedSteps().map((s) =>
          aStep({ ...s, status: 'COMPLETED', isCurrent: false, hasBeenResolved: true }),
        ),
      } as never,
      allowedActions: allowed({ canExecuteSteps: false, transitions: [transition('REOPEN')] }),
    });
    const after = aTask({ rowVersion: 'RV2' });
    const { fixture, el, fakes } = await mountWorkflow(task, {
      workflow: { reopenTaskStep: vi.fn().mockReturnValue(of(stepResponse(after))) },
    });
    await click(fixture, q(el, '[data-step-id="101"]  .step__toggle'));
    await click(fixture, q(el, '[data-step-id="101"] [data-reopen]'));

    expect(body().textContent).toContain('Later steps keep their status.');
    expect(q(body(), '[data-reopen-task-note]')!.textContent).toContain(
      'move the task back to In Progress',
    );
    expect(body().querySelector('textarea')).toBeNull();
    await click(fixture, dialogButton('Reopen step')!);
    expect(fakes.workflow['reopenTaskStep']).toHaveBeenCalledWith(1042, 101, { rowVersion: 'WF1' });
  });

  it('shows a server refusal on the step and refreshes the task', async () => {
    const { fixture, el, fakes } = await mountWorkflow(
      aTask({ workflow: { steps: orderedSteps() } as never }),
      {
        workflow: {
          completeTaskStep: vi
            .fn()
            .mockReturnValue(
              apiError(409, { code: 'STEP_LOCKED', detail: 'Resolve step 2 first.' }),
            ),
        },
      },
    );
    await click(fixture, q(el, '[data-step-id="103"] [data-complete]'));
    expect(q(el, '[data-step-id="103"] [data-step-error]')!.textContent).toContain(
      'Resolve step 2 first.',
    );
    expect(fakes.tasks['getTask']).toHaveBeenCalledTimes(2);
  });
});

describe('Workflow tab: unordered', () => {
  afterEach(() => TestBed.resetTestingModule());

  const unordered = () =>
    aTask({
      workflow: {
        isOrdered: false,
        workflowName: 'Quick Export',
        steps: [
          aStep({
            stepInstanceId: 201,
            sequenceNo: 1,
            title: 'Export A',
            status: 'COMPLETED',
            hasBeenResolved: true,
          }),
          aStep({ stepInstanceId: 202, sequenceNo: 2, title: 'Export B' }),
          aStep({ stepInstanceId: 203, sequenceNo: 3, title: 'Export C', status: 'IN_PROGRESS' }),
        ],
      } as never,
    });

  it('has no locked states and any unresolved step can be worked in any order', async () => {
    const { el } = await mountWorkflow(unordered());
    expect(q(el, '[data-mode]')!.textContent).toContain('Unordered');
    expect(el.querySelector('[data-locked]')).toBeNull();
    expect(el.querySelector('ol.wf__steps [aria-current]')).toBeNull();
    const b = q(el, '[data-step-id="202"]')!;
    // open the pending step: its actions are available even though step 1.. are not "current"
    (b.querySelector('.step__toggle') as HTMLElement).click();
  });

  it('opens a pending step and offers Start / Complete, and filters to unresolved steps', async () => {
    const { fixture, el, fakes } = await mountWorkflow(unordered(), {
      workflow: { startTaskStep: vi.fn().mockReturnValue(of(stepResponse(unordered()))) },
    });
    await click(fixture, q(el, '[data-step-id="202"] .step__toggle'));
    expect(q(el, '[data-step-id="202"] [data-complete]')).not.toBeNull();
    await click(fixture, q(el, '[data-step-id="202"] [data-start]'));
    expect(fakes.workflow['startTaskStep']).toHaveBeenCalledWith(1042, 202, { rowVersion: 'WF1' });

    await click(fixture, q(el, '[data-filter=unresolved]'));
    expect(Array.from(el.querySelectorAll('ol.wf__steps > li'))).toHaveLength(2);
    await click(fixture, q(el, '[data-filter=all]'));
    expect(Array.from(el.querySelectorAll('ol.wf__steps > li'))).toHaveLength(3);
  });
});

describe('Workflow tab: step input form', () => {
  afterEach(() => TestBed.resetTestingModule());

  const schema = {
    fields: [
      { key: 'items_in', control: 'NUMBER', label: 'Items in', required: true, options: [] },
      { key: 'note', control: 'TEXT', label: 'Note', options: [] },
    ],
  };

  it('blocks Mark complete until the required input is filled, then sends the values', async () => {
    const steps = [
      aStep({
        stepInstanceId: 301,
        sequenceNo: 1,
        title: 'Count',
        status: 'IN_PROGRESS',
        isCurrent: true,
        inputFormVersionId: 12,
      }),
    ];
    const { fixture, el, fakes } = await mountWorkflow(aTask({ workflow: { steps } as never }), {
      forms: { getFormVersionSchema: vi.fn().mockReturnValue(of(schema)) },
      workflow: { completeTaskStep: vi.fn().mockReturnValue(of(stepResponse(aTask()))) },
    });
    expect(q(el, '[data-step-id="301"] mf-dynamic-form')).not.toBeNull();

    await click(fixture, q(el, '[data-step-id="301"] [data-complete]'));
    expect(q(el, '[data-step-id="301"] [data-step-error]')!.textContent).toContain(
      'required inputs',
    );
    expect(fakes.workflow['completeTaskStep']).not.toHaveBeenCalled();

    const input = q(el, '[data-step-id="301"] input') as HTMLInputElement;
    input.value = '12400';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await settle(fixture);
    await click(fixture, q(el, '[data-step-id="301"] [data-complete]'));
    expect(fakes.workflow['completeTaskStep']).toHaveBeenCalledTimes(1);
    expect(fakes.workflow['completeTaskStep'].mock.calls[0][2].values).toEqual({ items_in: 12400 });
  });

  it("gives a step's asset inputs the task's matter, so the asset picker is not stuck on 'Choose a matter first'", async () => {
    const steps = [
      aStep({
        stepInstanceId: 301,
        sequenceNo: 1,
        title: 'Workspace',
        status: 'IN_PROGRESS',
        isCurrent: true,
        inputFormVersionId: 12,
      }),
    ];
    const { fixture } = await mountWorkflow(aTask({ workflow: { steps } as never }), {
      forms: {
        getFormVersionSchema: vi.fn().mockReturnValue(
          of({
            fields: [
              { key: 'workspace_asset', control: 'ASSET_REF', label: 'Workspace', options: [] },
            ],
          }),
        ),
      },
    });
    const step = fixture.debugElement.query(By.directive(TaskStep));
    expect(step.injector.get(AssetPickerContext).matterId()).toBe(7);
  });

  it('maps server field errors of the form onto the fields', async () => {
    const steps = [
      aStep({
        stepInstanceId: 301,
        sequenceNo: 1,
        title: 'Count',
        status: 'IN_PROGRESS',
        isCurrent: true,
        inputFormVersionId: 12,
      }),
    ];
    const { fixture, el } = await mountWorkflow(aTask({ workflow: { steps } as never }), {
      forms: {
        getFormVersionSchema: vi
          .fn()
          .mockReturnValue(
            of({ fields: [{ key: 'note', control: 'TEXT', label: 'Note', options: [] }] }),
          ),
      },
      workflow: {
        saveTaskStepValues: vi.fn().mockReturnValue(
          apiError(400, {
            code: 'VALIDATION_FAILED',
            errors: { 'form:note': [{ code: 'TOO_LONG', message: 'Note is too long.' }] },
          }),
        ),
      },
    });
    await click(fixture, q(el, '[data-step-id="301"] [data-save]'));
    expect(q(el, '[data-step-id="301"]')!.textContent).toContain('Note is too long.');
  });
});
