import { TestBed } from '@angular/core/testing';

vi.setConfig({ testTimeout: 60000 });
import { Observable } from 'rxjs';
import { TaskResponse } from '../../../api/generated/api-client';
import { Permission } from '../../../core/auth/permissions';
import { apiError, ok, settle } from '../../../shared/testing/org-testing';
import {
  aCheck,
  aTask,
  allowed,
  byText,
  click,
  dialogButton,
  mountTaskPage,
  q,
  transition,
} from './task-detail-testing';

const PERMS: Permission[] = ['Task.View', 'Task.Edit', 'Workflow.Execute'];
const body = (): HTMLElement => document.body;
const menuActions = (el: HTMLElement): string[] =>
  Array.from(el.querySelectorAll<HTMLElement>('[role=menuitem]')).map((i) => i.dataset['action']!);

async function openMenu(
  fixture: Awaited<ReturnType<typeof mountTaskPage>>['fixture'],
  el: HTMLElement,
): Promise<void> {
  await click(fixture, q(el, '[data-status-menu]'));
}

describe('TaskDetailPage header', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows number, title, status, priority, ASAP, Pod, assignee, matter and workflow', async () => {
    const { el } = await mountTaskPage(aTask());

    expect(q(el, '[data-task-number]')!.textContent).toBe('TSK-1042');
    expect(q(el, '[data-task-title]')!.textContent).toBe('Process Smith custodians');
    expect(q(el, 'mf-status-badge')!.textContent).toContain('In Progress');
    expect(q(el, 'mf-priority-badge')!.textContent).toContain('Critical');
    expect(q(el, '[data-due]')!.textContent).toContain('ASAP');
    expect(q(el, '[data-pod]')!.textContent).toContain('Pod A');
    expect(q(el, '[data-assignee]')!.textContent).toContain('Tariq M.');
    expect(q(el, '[data-matter] .mf-ref')!.textContent).toBe('00343-00012');
    expect(q(el, '[data-matter] mf-copy-button button')).not.toBeNull();
    expect(q(el, '[data-workflow]')!.textContent).toContain('Standard Processing v2 (ordered)');
    expect(q(el, '[data-progress]')!.textContent).toContain('1 of 3 resolved');
  });

  it('shows the sensitive banner only for sensitive matters', async () => {
    const task = aTask();
    const { el } = await mountTaskPage({ ...task, matter: { ...task.matter, isSensitive: true } });
    expect(q(el, '[data-sensitive-banner]')!.textContent).toContain('Sensitive matter');
    TestBed.resetTestingModule();
    const plain = await mountTaskPage(aTask());
    expect(q(plain.el, '[data-sensitive-banner]')).toBeNull();
  });

  it.each([
    ['NEW', ['START', 'HOLD', 'COMPLETE', 'CANCEL']],
    ['IN_PROGRESS', ['HOLD', 'COMPLETE', 'CANCEL']],
    ['ON_HOLD', ['RESUME', 'CANCEL']],
    ['COMPLETED', ['REOPEN', 'CANCEL']],
    ['CANCELLED', ['REOPEN']],
  ])('lists only the valid transitions for %s', async (status, actions) => {
    const { fixture, el } = await mountTaskPage(
      aTask({
        status,
        allowedActions: allowed({ transitions: actions.map((a) => transition(a)) }),
      }),
    );
    await openMenu(fixture, el);
    expect(menuActions(el)).toEqual(actions);
  });

  it('leaves out transitions the caller has no permission for and hides the menu without any', async () => {
    const denied = (a: string) =>
      transition(a, { permitted: false, blockedReason: 'PERMISSION_DENIED' });
    const { fixture, el } = await mountTaskPage(
      aTask({
        allowedActions: allowed({
          transitions: [transition('HOLD'), denied('COMPLETE'), denied('CANCEL')],
        }),
      }),
    );
    await openMenu(fixture, el);
    expect(menuActions(el)).toEqual(['HOLD']);

    TestBed.resetTestingModule();
    const none = await mountTaskPage(
      aTask({ allowedActions: allowed({ transitions: [denied('COMPLETE')], canEdit: false }) }),
    );
    expect(q(none.el, '[data-status-menu]')).toBeNull();
    expect(q(none.el, '[data-edit]')).toBeNull();
  });

  it('disables Reopen with the reason when the matter is inactive', async () => {
    const task = aTask({
      status: 'COMPLETED',
      statusLabel: 'Completed',
      allowedActions: allowed({
        transitions: [transition('REOPEN', { permitted: false, blockedReason: 'MATTER_INACTIVE' })],
      }),
    });
    const { fixture, el } = await mountTaskPage({
      ...task,
      matter: { ...task.matter, isActive: false },
    });
    await openMenu(fixture, el);
    const item = q(el, '[data-action=REOPEN]') as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(q(el, '.menu__reason')!.textContent).toContain(
      "Matter is inactive. This task can't be reopened.",
    );
    expect(q(el, '[data-matter-inactive]')!.textContent).toContain("can't be reopened");
    expect(q(el, '[data-reopen-task]')).toBeNull();
  });

  it('Start and Resume move the task to In Progress with the rowVersion', async () => {
    const task = aTask({
      status: 'ON_HOLD',
      allowedActions: allowed({ transitions: [transition('RESUME')] }),
    });
    const { fixture, el, fakes } = await mountTaskPage(task);
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-action=RESUME]'));
    expect(fakes.tasks['changeTaskStatus']).toHaveBeenCalledWith(1042, {
      rowVersion: 'RV1',
      status: 'IN_PROGRESS',
    });
  });

  it('On hold needs a reason and sends it', async () => {
    const { fixture, el, fakes } = await mountTaskPage(aTask());
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-action=HOLD]'));

    await click(fixture, dialogButton('Put on hold')!);
    expect(q(body(), '[data-reason-error]')!.textContent).toContain('Add a reason');
    expect(fakes.tasks['changeTaskStatus']).not.toHaveBeenCalled();

    const area = body().querySelector<HTMLTextAreaElement>('#task-reason')!;
    area.value = 'Waiting for the vendor';
    area.dispatchEvent(new Event('input'));
    await click(fixture, dialogButton('Put on hold')!);
    expect(fakes.tasks['changeTaskStatus']).toHaveBeenCalledWith(1042, {
      rowVersion: 'RV1',
      status: 'ON_HOLD',
      comment: 'Waiting for the vendor',
    });
  });

  it('Cancel needs a comment and calls cancel', async () => {
    const { fixture, el, fakes } = await mountTaskPage(aTask());
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-action=CANCEL]'));
    expect(body().querySelector('[data-reason-body]')!.textContent).toContain(
      "Unresolved workflow steps don't block",
    );

    await click(fixture, dialogButton('Cancel task')!);
    expect(q(body(), '[data-reason-error]')!.textContent).toContain(
      "Add a comment explaining why you're cancelling.",
    );
    expect(fakes.tasks['cancelTask']).not.toHaveBeenCalled();

    const area = body().querySelector<HTMLTextAreaElement>('#task-reason')!;
    area.value = 'Client withdrew';
    area.dispatchEvent(new Event('input'));
    await click(fixture, dialogButton('Cancel task')!);
    expect(fakes.tasks['cancelTask']).toHaveBeenCalledWith(1042, {
      rowVersion: 'RV1',
      comment: 'Client withdrew',
    });
  });

  it('closed tasks show the reopen banner; reopening confirms then calls reopen', async () => {
    const task = aTask({
      status: 'COMPLETED',
      statusLabel: 'Completed',
      allowedActions: allowed({
        canEdit: false,
        transitions: [transition('REOPEN'), transition('CANCEL')],
      }),
    });
    const { fixture, el, fakes } = await mountTaskPage(task);
    expect(q(el, '[data-closed-banner]')!.textContent).toContain(
      'This task is Completed. Move it back to In Progress to edit.',
    );
    expect(q(el, '[data-edit]')).toBeNull();

    await click(fixture, q(el, '[data-reopen-task]'));
    expect(body().querySelector('[data-reopen-body]')).not.toBeNull();
    await click(fixture, dialogButton('Reopen')!);
    expect(fakes.tasks['reopenTask']).toHaveBeenCalledWith(1042, { rowVersion: 'RV1' });
  });

  it('shows the stored reason of an On Hold task', async () => {
    const { el } = await mountTaskPage(
      aTask({
        status: 'ON_HOLD',
        statusReason: {
          commentId: 1,
          purpose: 'HOLD',
          bodyHtml: 'Waiting for the vendor',
          authorUserId: 3,
          authorName: 'Dana P.',
          createdAtUtc: '2026-10-13T14:00:00Z',
        },
      }),
    );
    expect(q(el, '[data-status-reason]')!.textContent).toContain('Waiting for the vendor');
    expect(q(el, '[data-status-reason]')!.textContent).toContain('Dana P.');
  });
});

describe('TaskDetailPage complete', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('completes straight away when every step is resolved', async () => {
    const { fixture, el, fakes } = await mountTaskPage(aTask(), PERMS, {
      tasks: {
        getTaskCompletionCheck: vi
          .fn()
          .mockReturnValue(ok(aCheck({ isReady: true, unresolved: [] }))),
      },
    });
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-action=COMPLETE]'));
    expect(fakes.tasks['completeTask']).toHaveBeenCalledWith(1042, {
      rowVersion: 'RV1',
      completeUnresolvedSteps: false,
    });
    expect(body().querySelector('[data-bulk-body]')).toBeNull();
  });

  it('bulk case: asks "You have N steps not completed", lists them and confirms with completeUnresolvedSteps', async () => {
    const { fixture, el, fakes } = await mountTaskPage(aTask(), PERMS);
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-action=COMPLETE]'));

    expect(q(body(), '[data-bulk-body]')!.textContent!.replace(/\s+/g, ' ')).toContain(
      'You have 2 steps not completed. Do you want to mark them all completed?',
    );
    expect(q(body(), '[data-bulk-steps]')!.textContent).toContain('Deduplicate');
    expect(q(body(), '[data-bulk-steps]')!.textContent).toContain('OCR');
    expect(fakes.tasks['completeTask']).not.toHaveBeenCalled();

    await click(fixture, dialogButton('Mark all completed and finish task')!);
    expect(fakes.tasks['completeTask']).toHaveBeenCalledWith(1042, {
      rowVersion: 'RV1',
      completeUnresolvedSteps: true,
    });
  });

  it('cancelling the bulk dialog changes nothing', async () => {
    const { fixture, el, fakes } = await mountTaskPage(aTask(), PERMS);
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-action=COMPLETE]'));
    await click(fixture, dialogButton('Cancel')!);
    expect(fakes.tasks['completeTask']).not.toHaveBeenCalled();
    expect(q(body(), '[data-bulk-body]')).toBeNull();
  });

  it('blocked case: lists steps needing information with links that open the step; the task stays open', async () => {
    const check = aCheck({
      canBulkComplete: false,
      blocked: [{ stepInstanceId: 103, sequenceNo: 3, title: 'OCR' }],
      bulkCompletable: [{ stepInstanceId: 102, sequenceNo: 2, title: 'Deduplicate' }],
    });
    const { fixture, el, fakes } = await mountTaskPage(aTask(), PERMS, {
      tasks: { getTaskCompletionCheck: vi.fn().mockReturnValue(ok(check)) },
    });
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-action=COMPLETE]'));

    expect(q(body(), '[data-blocked-body]')!.textContent).toContain(
      'These steps need required information first',
    );
    expect(dialogButton('Mark all completed and finish task')).toBeUndefined();
    const link = byText(body(), '[data-blocked-steps] button', 'Step 3: OCR')!;
    await click(fixture, link);

    expect(fakes.tasks['completeTask']).not.toHaveBeenCalled();
    expect(q(el, '#task-tab-workflow')!.getAttribute('aria-selected')).toBe('true');
    expect(q(el, '[data-step-id="103"] .step__toggle')!.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(q(el, '#step-btn-103'));
  });

  it('turns a COMPLETION_BLOCKED answer into the blocked dialog', async () => {
    const blocked = aCheck({
      canBulkComplete: false,
      blocked: [{ stepInstanceId: 103, sequenceNo: 3, title: 'OCR' }],
    });
    const check = vi.fn().mockReturnValueOnce(ok(aCheck())).mockReturnValue(ok(blocked));
    const { fixture, el } = await mountTaskPage(aTask(), PERMS, {
      tasks: {
        getTaskCompletionCheck: check,
        completeTask: vi.fn().mockReturnValue(
          apiError(409, {
            code: 'COMPLETION_BLOCKED',
            meta: { stepsMissingInputs: [103], unresolvedStepIds: [102, 103] },
          }),
        ),
      },
    });
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-action=COMPLETE]'));
    await click(fixture, dialogButton('Mark all completed and finish task')!);
    expect(q(body(), '[data-blocked-body]')).not.toBeNull();
  });

  it('explains when the user cannot complete steps', async () => {
    const { fixture, el } = await mountTaskPage(
      aTask({ allowedActions: allowed({ canExecuteSteps: false }) }),
      ['Task.View', 'Task.Complete'],
    );
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-action=COMPLETE]'));
    expect(q(body(), '[data-no-execute]')).not.toBeNull();
    expect(dialogButton('Mark all completed and finish task')).toBeUndefined();
  });
});

describe('TaskDetailPage tabs and states', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('has the five tabs, with placeholder slots for Comments, Assets and Activity', async () => {
    const { fixture, el } = await mountTaskPage(aTask());
    expect(Array.from(el.querySelectorAll('[role=tab]')).map((t) => t.textContent!.trim())).toEqual(
      ['Details', 'Workflow (1/3)', 'Comments', 'Assets', 'Activity'],
    );
    for (const name of ['comments', 'assets', 'activity']) {
      await click(fixture, q(el, `#task-tab-${name}`));
      expect(q(el, `[data-placeholder=${name}]`)!.textContent).toContain('coming soon');
    }
  });

  it('moves between tabs with the arrow keys and exposes ARIA tab semantics', async () => {
    const { fixture, el } = await mountTaskPage(aTask());
    const details = q(el, '#task-tab-details')!;
    details.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle(fixture);
    expect(q(el, '#task-tab-workflow')!.getAttribute('aria-selected')).toBe('true');
    expect(q(el, '#task-tab-workflow')!.getAttribute('tabindex')).toBe('0');
    expect(q(el, '#task-tab-details')!.getAttribute('tabindex')).toBe('-1');
    expect(q(el, '[role=tabpanel]')!.getAttribute('aria-labelledby')).toBe('task-tab-workflow');
  });

  it('opens the tab named in the URL', async () => {
    const { el } = await mountTaskPage(aTask(), PERMS, {}, 'workflow');
    expect(q(el, '#task-tab-workflow')!.getAttribute('aria-selected')).toBe('true');
    expect(q(el, '[data-workflow-tab]')).not.toBeNull();
  });

  it('shows a not-found page for 404 and a permission page for 403', async () => {
    const missing = await mountTaskPage(aTask(), PERMS, {
      tasks: { getTask: vi.fn().mockReturnValue(apiError(404, { code: 'NOT_FOUND' })) },
    });
    expect(q(missing.el, '[data-not-found]')!.textContent).toContain("We couldn't find that task.");
    TestBed.resetTestingModule();
    const forbidden = await mountTaskPage(aTask(), PERMS, {
      tasks: { getTask: vi.fn().mockReturnValue(apiError(403, { code: 'PERMISSION_DENIED' })) },
    });
    expect(q(forbidden.el, '[data-forbidden]')).not.toBeNull();
  });

  it('shows an error with Retry for other failures', async () => {
    const getTask = vi
      .fn()
      .mockReturnValueOnce(apiError(500, { code: 'ERROR' }))
      .mockReturnValue(ok(aTask()));
    const { fixture, el } = await mountTaskPage(aTask(), PERMS, { tasks: { getTask } });
    expect(q(el, '[data-error]')).not.toBeNull();
    await click(fixture, byText(el, '[data-error] button', 'Retry')!);
    expect(q(el, '[data-task-number]')!.textContent).toBe('TSK-1042');
  });

  it('shows the reload banner on a concurrency conflict and reloads on request', async () => {
    const changed = aTask({ title: 'Changed elsewhere', rowVersion: 'RV2' });
    const getTask = vi.fn().mockReturnValueOnce(ok(aTask())).mockReturnValue(ok(changed));
    const { fixture, el, fakes } = await mountTaskPage(aTask(), PERMS, {
      tasks: {
        getTask,
        changeTaskStatus: vi
          .fn()
          .mockReturnValue(
            apiError(409, { code: 'CONCURRENCY_CONFLICT' }) as Observable<TaskResponse>,
          ),
      },
    });
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-action=HOLD]'));
    const area = body().querySelector<HTMLTextAreaElement>('#task-reason')!;
    area.value = 'Because';
    area.dispatchEvent(new Event('input'));
    await click(fixture, dialogButton('Put on hold')!);

    expect(fakes.tasks['changeTaskStatus']).toHaveBeenCalled();
    expect(q(el, '[data-conflict-banner]')!.textContent).toContain('changed by someone else');
    await click(fixture, q(el, '[data-reload]'));
    expect(q(el, '[data-conflict-banner]')).toBeNull();
    expect(q(el, '[data-task-title]')!.textContent).toBe('Changed elsewhere');
  });

  it('refreshes the task after a failed action', async () => {
    const held = aTask({
      status: 'ON_HOLD',
      allowedActions: allowed({ transitions: [transition('RESUME')] }),
    });
    const getTask = vi
      .fn()
      .mockReturnValueOnce(ok(held))
      .mockReturnValue(ok({ ...held, rowVersion: 'RV9' }));
    const { fixture, el, fakes } = await mountTaskPage(held, PERMS, {
      tasks: {
        getTask,
        changeTaskStatus: vi
          .fn()
          .mockReturnValue(apiError(409, { code: 'INVALID_STATUS_TRANSITION' })),
      },
    });
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-action=RESUME]'));
    expect(fakes.tasks['getTask']).toHaveBeenCalledTimes(2);
  });

  it('reports unsaved edits to the leave guard', async () => {
    const { fixture, el } = await mountTaskPage(aTask());
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    await click(fixture, q(el, '[data-edit-details]'));
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    const title = q(el, '#td-title') as HTMLInputElement;
    title.value = 'New title';
    title.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
  });
});
