import { TestBed } from '@angular/core/testing';

vi.setConfig({ testTimeout: 60000 });
import { ActivatedRoute, Params } from '@angular/router';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { TaskResponse } from '../../../api/generated/api-client';
import { Permission } from '../../../core/auth/permissions';
import { UndoService } from '../../../core/notify/undo.service';
import { TaskDetailStore } from './task-detail.store';
import { apiError, ok, settle } from '../../../shared/testing/org-testing';
import {
  aCheck,
  aStep,
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
  Array.from(el.querySelectorAll<HTMLElement>('[role=menuitemradio]')).map(
    (i) => i.dataset['option']!,
  );

async function openMenu(
  fixture: Awaited<ReturnType<typeof mountTaskPage>>['fixture'],
  el: HTMLElement,
): Promise<void> {
  await click(fixture, q(el, '[data-status] [data-inline-trigger]'));
}

describe('TaskDetailPage header', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('links the Matter in the header and the breadcrumb only with Matter.View (BUG-7)', async () => {
    const { el } = await mountTaskPage(aTask(), [...PERMS, 'Matter.View']);
    expect(el.querySelector('[data-matter] a[href*="/matters/"]')).not.toBeNull();
    expect(el.querySelector('nav[aria-label="Breadcrumb"] a[href*="/matters/"]')).not.toBeNull();
    TestBed.resetTestingModule();

    const plain = await mountTaskPage(aTask(), PERMS);
    expect(plain.el.querySelector('a[href*="/matters/"]')).toBeNull();
    expect(plain.el.querySelector('[data-matter] .mf-ref')).not.toBeNull();
    // Without Matter.View the breadcrumb leaves the matter out (#296): the list, then the task.
    expect(plain.el.querySelector('nav[aria-label="Breadcrumb"]')!.textContent).not.toContain(
      aTask().matter.matterRef,
    );
    expect(
      plain.el.querySelector('nav[aria-label="Breadcrumb"] [aria-current=page]'),
    ).not.toBeNull();
  });

  it('has one Edit button and inline Status, Priority and Assignee menus for a user who may change them', async () => {
    const { el } = await mountTaskPage(aTask(), [...PERMS, 'Task.SetPriority', 'Task.Assign']);

    expect(el.querySelectorAll('[data-action="edit"]').length).toBe(1);
    expect(q(el, '[data-action="edit"]')!.textContent!.trim()).toBe('Edit');
    expect(q(el, '[data-edit-details]')).toBeNull();
    expect(q(el, '[data-action="activity"]')!.textContent).toContain('Activity');
    expect(q(el, '[data-status] [data-inline-trigger]')).not.toBeNull();
    expect(q(el, '[data-priority] [data-inline-trigger]')).not.toBeNull();
    expect(q(el, '[data-assignee] [data-inline-trigger]')).not.toBeNull();
    expect(q(el, '[data-view-only]')).toBeNull();
  });

  it('shows a view-only notice, plain chips and no Edit for a user who can change nothing', async () => {
    const { el } = await mountTaskPage(
      aTask({
        allowedActions: allowed({
          canEdit: false,
          canAssign: false,
          canSetPriority: false,
          transitions: [
            transition('COMPLETE', { permitted: false, blockedReason: 'PERMISSION_DENIED' }),
          ],
        }),
      }),
      ['Task.View'],
    );

    expect(q(el, '[data-view-only]')!.textContent).toContain(
      "View only: you don't have permission to edit tasks.",
    );
    expect(q(el, '[data-inline-trigger]')).toBeNull();
    expect(q(el, '[data-action="edit"]')).toBeNull();
    expect(q(el, 'mf-status-badge')).not.toBeNull();
  });

  it('changes the priority from the header, shows it at once and offers Undo', async () => {
    const updated = aTask({
      priority: { priorityId: 3, label: 'Normal', color: 'normal', sortOrder: 3 },
      rowVersion: 'RV2',
    });
    const setTaskPriority = vi.fn().mockReturnValue(of(updated));
    const { fixture, el, fakes } = await mountTaskPage(aTask(), [...PERMS, 'Task.SetPriority'], {
      tasks: { setTaskPriority },
    });
    const undo = TestBed.inject(UndoService);
    undo.dismiss();

    await click(fixture, q(el, '[data-priority] [data-inline-trigger]'));
    await click(fixture, q(el, '[data-option="3"]'));

    expect(setTaskPriority).toHaveBeenCalledWith(1042, { rowVersion: 'RV1', priorityId: 3 });
    expect(q(el, '[data-priority]')!.textContent).toContain('Normal');
    expect(undo.current()?.message).toBe('TSK-1042 priority set to Normal.');

    // Undo uses the version the server returned last.
    fakes.tasks['getTask'].mockReturnValue(of(updated));
    setTaskPriority.mockReturnValue(of(aTask({ rowVersion: 'RV3' })));
    await undo.run();
    await settle(fixture);
    expect(setTaskPriority).toHaveBeenLastCalledWith(1042, { rowVersion: 'RV2', priorityId: 1 });
    expect(q(el, '[data-priority]')!.textContent).toContain('Critical');
  });

  it('opens the Details form from Edit and returns focus to Edit when it closes', async () => {
    const { fixture, el } = await mountTaskPage(aTask());
    document.body.appendChild(el);
    const edit = q(el, '[data-action="edit"]') as HTMLElement;
    edit.focus();
    await click(fixture, edit);
    expect(q(document.body, '[data-edit-form]')).not.toBeNull();
    fixture.debugElement.injector.get(TaskDetailStore).editing.set(false);
    await settle(fixture);
    await new Promise((r) => setTimeout(r, 20));
    expect(q(document.body, '[data-edit-form]')).toBeNull();
    expect(document.activeElement).toBe(edit);
    el.remove();
  });

  it('shows number, title, status, priority, ASAP, Pod, assignee, matter and workflow', async () => {
    const { el } = await mountTaskPage(aTask());

    expect(q(el, '[data-task-header] [data-ref]')!.textContent).toBe('TSK-1042');
    expect(q(el, '[data-task-header] [data-name]')!.textContent).toBe('Process Smith custodians');
    expect(q(el, 'mf-status-badge')!.textContent).toContain('In Progress');
    expect(q(el, 'mf-priority-badge')!.textContent).toContain('Critical');
    expect(q(el, '[data-task-type]')!.textContent).toContain('Data Processing');
    expect(q(el, '[data-title-icon] svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(q(el, '[data-title-icon]')!.getAttribute('title')).toBe('Data Processing');
    expect(q(el, '[data-due]')!.textContent).toContain('ASAP');
    expect(q(el, '[data-pod]')!.textContent).toContain('Pod A');
    expect(q(el, '[data-assignee]')!.textContent).toContain('Tariq M.');
    expect(q(el, '[data-matter] .mf-ref')!.textContent).toBe('00343-00012');
    // The context line stays one text line: no copy button there (Copy link is in the overflow).
    expect(q(el, '[data-matter] mf-copy-button button')).toBeNull();
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

  it('status menu: one label per item, the target status only as tooltip, a divider and Cancel task last in danger style (#303)', async () => {
    const { fixture, el } = await mountTaskPage(
      aTask({
        allowedActions: allowed({
          transitions: ['CANCEL', 'HOLD', 'COMPLETE'].map((a) => transition(a)),
        }),
      }),
    );
    await openMenu(fixture, el);
    expect(menuActions(el)).toEqual(['HOLD', 'COMPLETE', 'CANCEL']);
    const items = Array.from(el.querySelectorAll<HTMLElement>('[role=menuitemradio]'));
    expect(items.map((i) => i.querySelector('.im-text')!.textContent!.trim())).toEqual([
      'Put on hold',
      'Complete',
      'Cancel task',
    ]);
    expect(el.querySelector('.im-hint')).toBeNull();
    expect(items[0].getAttribute('title')).toBe('On Hold');
    expect(items[2].classList.contains('im-sep')).toBe(true);
    expect(items[2].classList.contains('im-danger')).toBe(true);
    expect(items[1].classList.contains('im-sep')).toBe(false);
  });

  it('assignee menu: "Assign to me" is the first item, assigns in one click and returns focus to the Assignee control (#306)', async () => {
    const { fixture, el, fakes } = await mountTaskPage(aTask({ assignedUser: undefined }), [
      ...PERMS,
      'Task.Assign',
      'Pod.View',
    ]);
    const trigger = q(el, '[data-assignee] [data-inline-trigger]')!;
    await click(fixture, trigger);
    await settle(fixture);
    const lead = q(el, '[data-assignee] [data-lead]')!;
    expect(lead.textContent!.trim()).toBe('Assign to me');
    expect(lead.getAttribute('aria-label')).toBe('Assign TSK-1042 to me');
    expect(q(el, '[data-assignee] .im-pop')!.firstElementChild).toBe(lead);
    // The Pod's open load sits next to each candidate.
    expect(q(el, '[data-assignee] [data-option="9"] .im-hint')!.textContent!.trim()).toBe('4 open');

    await click(fixture, lead);
    expect(fakes.tasks['assignTask']).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it('assignee menu: no "Assign to me" for the current assignee, and no menu without Task.Assign (#306)', async () => {
    const me = { userId: 1, displayName: 'Test User', isActive: true };
    const { fixture, el } = await mountTaskPage(aTask({ assignedUser: me }), [
      ...PERMS,
      'Task.Assign',
    ]);
    await click(fixture, q(el, '[data-assignee] [data-inline-trigger]'));
    expect(q(el, '[data-lead]')).toBeNull();
    TestBed.resetTestingModule();

    const plain = await mountTaskPage(
      aTask({ allowedActions: allowed({ canAssign: false }) }),
      PERMS,
    );
    expect(q(plain.el, '[data-assignee] [data-inline-trigger]')).toBeNull();
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
    expect(q(none.el, '[data-status] [data-inline-trigger]')).toBeNull();
    expect(q(none.el, '[data-action="edit"]')).toBeNull();
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
    const item = q(el, '[data-option=REOPEN]') as HTMLButtonElement;
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(q(el, '.im-reason')!.textContent).toContain(
      "Matter is inactive. This task can't be reopened.",
    );
    expect(q(el, '[data-matter-inactive]')!.textContent).toContain("can't be reopened");
    // The header's primary action is Reopen task, disabled with the reason (#298).
    const header = q(el, '[data-action="reopen"]') as HTMLButtonElement;
    expect(header.getAttribute('aria-disabled')).toBe('true');
    expect(header.getAttribute('title')).toBe("Matter is inactive. This task can't be reopened.");
    expect(q(el, '[data-reopen-task]')).toBeNull();
  });

  it('Start and Resume move the task to In Progress with the rowVersion', async () => {
    const task = aTask({
      status: 'ON_HOLD',
      allowedActions: allowed({ transitions: [transition('RESUME')] }),
    });
    const { fixture, el, fakes } = await mountTaskPage(task);
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-option=RESUME]'));
    expect(fakes.tasks['changeTaskStatus']).toHaveBeenCalledWith(1042, {
      rowVersion: 'RV1',
      status: 'IN_PROGRESS',
    });
  });

  it('On hold needs a reason and sends it', async () => {
    const { fixture, el, fakes } = await mountTaskPage(aTask());
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-option=HOLD]'));

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

  it('dialog wording (#305): Hold dismisses with "Close", Cancel keeps "Keep task", both ask for a "Reason"', async () => {
    const { fixture, el } = await mountTaskPage(aTask());
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-option=HOLD]'));
    expect(dialogButton('Close')).toBeDefined();
    expect(dialogButton('Cancel')).toBeUndefined();
    expect(q(body(), '.reason label')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'Reason (required)',
    );
    await click(fixture, dialogButton('Close')!);
    expect(q(body(), '[data-reason-body]')).toBeNull();

    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-option=CANCEL]'));
    expect(dialogButton('Keep task')).toBeDefined();
    expect(q(body(), '.reason label')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'Reason (required)',
    );
  });

  it('Cancel needs a reason and calls cancel', async () => {
    const { fixture, el, fakes } = await mountTaskPage(aTask());
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-option=CANCEL]'));
    expect(body().querySelector('[data-reason-body]')!.textContent).toContain(
      "Unresolved workflow steps don't block",
    );

    await click(fixture, dialogButton('Cancel task')!);
    expect(q(body(), '[data-reason-error]')!.textContent).toContain(
      "Add a reason explaining why you're cancelling.",
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

  it('a closed task shows its one status note; reopening is the header action, confirms, then calls reopen', async () => {
    const task = aTask({
      status: 'COMPLETED',
      statusLabel: 'Completed',
      statusChangedAtUtc: '2026-10-13T15:03:00Z',
      completedAtUtc: '2026-10-13T15:03:00Z',
      statusChangedBy: { userId: 3, displayName: 'Dana P.', isActive: true },
      allowedActions: allowed({
        canEdit: false,
        transitions: [transition('REOPEN'), transition('CANCEL')],
      }),
    });
    const { fixture, el, fakes } = await mountTaskPage(task);
    expect(el.querySelectorAll('[data-status-note]').length).toBe(1);
    expect(q(el, '[data-status-note]')!.textContent).toMatch(
      /Completed Oct 13, \d{1,2}:\d{2} [AP]M by Dana P/,
    );
    expect(q(el, '[data-closed-banner]')).toBeNull();
    expect(q(el, '[data-action="edit"]')).toBeNull();
    // No Reopen button in the note or the Workflow: it is the header's primary action, and Complete task is gone.
    expect(q(el, '[data-status-note] button')).toBeNull();
    expect(q(el, '[data-action="complete"]')).toBeNull();
    expect(q(el, '[data-workflow-tab] button[data-reopen-task]')).toBeNull();

    await click(fixture, q(el, '[data-action="reopen"]'));
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
    expect(el.querySelectorAll('[data-status-note]').length).toBe(1);
    expect(q(el, '[data-status-note]')!.textContent).toContain('Waiting for the vendor');
    expect(q(el, '[data-status-note]')!.textContent).toContain('Dana P.');
    expect(q(el, '[data-status-reason]')).toBeNull();
  });
});

describe('TaskDetailPage complete', () => {
  afterEach(() => TestBed.resetTestingModule());

  const needingInfo = () =>
    aTask({
      workflow: {
        ...aTask().workflow,
        steps: [
          aStep({ stepInstanceId: 101, sequenceNo: 1, title: 'Intake QC', status: 'COMPLETED' }),
          aStep({
            stepInstanceId: 102,
            sequenceNo: 2,
            title: 'Deduplicate',
            status: 'IN_PROGRESS',
            isCurrent: true,
            requiredInputsSatisfied: false,
          }),
          aStep({
            stepInstanceId: 103,
            sequenceNo: 3,
            title: 'OCR',
            requiredInputsSatisfied: false,
          }),
        ],
      },
    });

  it('keeps Complete enabled while steps need information and says so (tooltip, aria-describedby, menu item) (#304)', async () => {
    const { fixture, el } = await mountTaskPage(needingInfo(), PERMS);
    const button = q(el, '[data-action="complete"]') as HTMLButtonElement;
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(button.getAttribute('title')).toBe('2 steps need information');
    const note = el.querySelector(`#${button.getAttribute('aria-describedby')}`)!;
    expect(note.textContent!.trim()).toBe('2 steps need information');

    await openMenu(fixture, el);
    const item = q(el, '[data-option=COMPLETE]') as HTMLButtonElement;
    expect(item.getAttribute('aria-disabled')).toBeNull();
    const described = el.querySelector(`#${item.getAttribute('aria-describedby')}`)!;
    expect(described.textContent!.trim()).toBe('2 steps need information');
  });

  it('shows no hint when the steps are ready (zero steps, or all inputs there) (#304)', async () => {
    const { el } = await mountTaskPage(aTask(), PERMS);
    expect(q(el, '[data-action="complete"]')!.getAttribute('title')).toBeNull();
    expect(q(el, '[data-complete-task-button]')).toBeNull();
  });

  it('completes straight away when every step is resolved', async () => {
    const { fixture, el, fakes } = await mountTaskPage(aTask(), PERMS, {
      tasks: {
        getTaskCompletionCheck: vi
          .fn()
          .mockReturnValue(ok(aCheck({ isReady: true, unresolved: [] }))),
      },
    });
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-option=COMPLETE]'));
    expect(fakes.tasks['completeTask']).toHaveBeenCalledWith(1042, {
      rowVersion: 'RV1',
      completeUnresolvedSteps: false,
    });
    expect(body().querySelector('[data-bulk-body]')).toBeNull();
  });

  it('bulk case: asks "You have N steps not completed", lists them and confirms with completeUnresolvedSteps', async () => {
    const { fixture, el, fakes } = await mountTaskPage(aTask(), PERMS);
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-option=COMPLETE]'));

    expect(q(body(), '[data-bulk-body]')!.textContent!.replace(/\s+/g, ' ')).toContain(
      'You have 2 steps not completed. Do you want to mark them all completed?',
    );
    expect(q(body(), '[data-bulk-steps]')!.textContent).toContain('Deduplicate');
    expect(q(body(), '[data-bulk-steps]')!.textContent).toContain('OCR');
    expect(fakes.tasks['completeTask']).not.toHaveBeenCalled();

    await click(fixture, dialogButton('Complete all steps and finish')!);
    expect(fakes.tasks['completeTask']).toHaveBeenCalledWith(1042, {
      rowVersion: 'RV1',
      completeUnresolvedSteps: true,
      workflowRowVersion: 'WRV1', // the version of the check the user confirmed (SEC2-08)
    });
  });

  it('cancelling the bulk dialog changes nothing', async () => {
    const { fixture, el, fakes } = await mountTaskPage(aTask(), PERMS);
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-option=COMPLETE]'));
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
    await click(fixture, q(el, '[data-option=COMPLETE]'));

    expect(q(body(), '[data-blocked-body]')!.textContent).toContain(
      'These steps need required information first',
    );
    expect(dialogButton('Complete all steps and finish')).toBeUndefined();
    const link = byText(body(), '[data-blocked-steps] button', 'Step 3: OCR')!;
    await click(fixture, link);

    expect(fakes.tasks['completeTask']).not.toHaveBeenCalled();
    expect(q(el, '[data-step-id="103"] .step__toggle')!.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(q(el, '#step-btn-103'));
  });

  it('blocked case: the primary button is "Go to first step" and opens, scrolls to and focuses the earliest blocked step (#304)', async () => {
    const check = aCheck({
      canBulkComplete: false,
      blocked: [
        { stepInstanceId: 103, sequenceNo: 3, title: 'OCR' },
        { stepInstanceId: 102, sequenceNo: 2, title: 'Deduplicate' },
      ],
    });
    const { fixture, el, fakes } = await mountTaskPage(aTask(), PERMS, {
      tasks: { getTaskCompletionCheck: vi.fn().mockReturnValue(ok(check)) },
    });
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-option=COMPLETE]'));

    expect(dialogButton('Complete all steps and finish')).toBeUndefined();
    expect(dialogButton('Close')).toBeDefined();
    await click(fixture, dialogButton('Go to first step')!);

    expect(fakes.tasks['completeTask']).not.toHaveBeenCalled();
    expect(q(body(), '[data-blocked-body]')).toBeNull();
    expect(q(el, '[data-step-id="102"] .step__toggle')!.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(q(el, '#step-btn-102'));
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
    await click(fixture, q(el, '[data-option=COMPLETE]'));
    await click(fixture, dialogButton('Complete all steps and finish')!);
    expect(q(body(), '[data-blocked-body]')).not.toBeNull();
  });

  it('a stale confirmation (workflow changed meanwhile) shows the fresh list instead of completing', async () => {
    const fresh = aCheck({
      workflowRowVersion: 'WRV2',
      unresolved: [{ stepInstanceId: 103, sequenceNo: 3, title: 'OCR' }],
      bulkCompletable: [{ stepInstanceId: 103, sequenceNo: 3, title: 'OCR' }],
    });
    const check = vi.fn().mockReturnValueOnce(ok(aCheck())).mockReturnValue(ok(fresh));
    const { fixture, el, fakes } = await mountTaskPage(aTask(), PERMS, {
      tasks: {
        getTaskCompletionCheck: check,
        completeTask: vi.fn().mockReturnValue(apiError(409, { code: 'CONCURRENCY_CONFLICT' })),
      },
    });
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-option=COMPLETE]'));
    await click(fixture, dialogButton('Complete all steps and finish')!);

    expect(fakes.tasks['completeTask']).toHaveBeenCalledTimes(1);
    expect(q(body(), '[data-bulk-steps]')!.textContent).not.toContain('Deduplicate');
    expect(q(body(), '[data-bulk-steps]')!.textContent).toContain('OCR');
  });

  it('explains when the user cannot complete steps', async () => {
    const { fixture, el } = await mountTaskPage(
      aTask({ allowedActions: allowed({ canExecuteSteps: false }) }),
      ['Task.View', 'Task.Complete'],
    );
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-option=COMPLETE]'));
    expect(q(body(), '[data-no-execute]')).not.toBeNull();
    expect(dialogButton('Complete all steps and finish')).toBeUndefined();
  });
});

describe('TaskDetailPage layout and states', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => TestBed.resetTestingModule());

  it('is one page: Workflow in the main column, Assets and Comments below it, Details in the side panel, no tabs', async () => {
    const { el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View']);

    expect(q(el, '[role=tablist]')).toBeNull();
    expect(q(el, '[role=tab]')).toBeNull();
    const main = q(el, '[data-detail-main]')!;
    expect(q(main, '[data-section=workflow] [data-workflow-tab]')).not.toBeNull();
    // Assets, then Comments, stacked under the Workflow, in the same (left) column.
    const left = q(el, '[data-detail-left]')!;
    expect(left.contains(main)).toBe(true);
    const below = q(left, '[data-detail-below]')!;
    expect(q(below, '[data-section=comments] mf-task-comments')).not.toBeNull();
    expect(q(below, '[data-section=assets] mf-task-asset-links')).not.toBeNull();
    const panel = q(el, 'aside[data-detail-panel]')!;
    expect(q(panel, '[data-section=details] [data-details-tab]')).not.toBeNull();
    expect(q(panel, '[data-section=assets]')).toBeNull();
    expect(q(el, '[role=separator][aria-label="Resize Details panel"]')).not.toBeNull();
    // Activity is a drawer, not a section.
    expect(q(el, 'mf-task-activity')).toBeNull();
  });

  it('keeps the heading order: one h1, h2 sections Workflow, Assets, Comments, Details', async () => {
    const { el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View']);
    expect(el.querySelectorAll('h1').length).toBe(1);
    const h2 = Array.from(el.querySelectorAll('h2')).map(
      (h) => h.textContent!.replace(/\s+/g, ' ').trim().split(' ')[0],
    );
    expect(h2).toEqual(['Workflow', 'Assets', 'Comments', 'Details']);
    expect(q(el, 'aside')!.getAttribute('aria-labelledby')).toBe(q(el, 'aside h2')!.id);
  });

  it('has a section nav with counts whose links scroll to the section and move focus to its heading', async () => {
    const { fixture, el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View']);
    document.body.appendChild(el);
    const nav = q(el, 'nav[aria-label="Sections"]')!;
    expect(
      Array.from(nav.querySelectorAll('a')).map((a) => a.textContent!.replace(/\s+/g, ' ').trim()),
    ).toEqual(['Workflow 1/3', 'Assets 0', 'Comments 0']);
    for (const [name, selector] of [
      ['workflow', '#wf-h'],
      ['comments', '[data-section=comments] [data-section-heading]'],
      ['assets', '[data-section=assets] [data-section-heading]'],
    ]) {
      await click(fixture, q(nav, `[data-section-link=${name}]`));
      await new Promise((r) => setTimeout(r, 10));
      expect(document.activeElement).toBe(q(el, selector));
    }
    el.remove();
  });

  it.each(['workflow', 'comments', 'assets'])(
    'the old ?tab=%s link scrolls to the section and moves focus to its heading',
    async (name) => {
      const scroll = vi.fn();
      HTMLElement.prototype.scrollIntoView = scroll;
      const { fixture, el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View'], {}, name);
      await settle(fixture);
      await new Promise((r) => setTimeout(r, 20));
      const heading = q(el, `[data-section=${name}] [data-section-heading]`);
      expect(heading).not.toBeNull();
      // The section's box is scrolled to (its margin clears the sticky nav); the heading takes the focus.
      expect(scroll.mock.contexts).toContain(heading!.closest('[data-section]'));
      expect(heading!.getAttribute('tabindex')).toBe('-1');
      expect(fixture.debugElement.injector.get(TaskDetailStore).activityOpen()).toBe(false);
    },
  );

  it('the old ?tab=activity link opens the Activity drawer, and ?tab=details just shows the page', async () => {
    const activity = await mountTaskPage(aTask(), PERMS, {}, 'activity');
    expect(activity.fixture.debugElement.injector.get(TaskDetailStore).activityOpen()).toBe(true);
    expect(q(document.body, 'mf-task-activity')).not.toBeNull();
    TestBed.resetTestingModule();

    const details = await mountTaskPage(aTask(), PERMS, {}, 'details');
    expect(details.fixture.debugElement.injector.get(TaskDetailStore).activityOpen()).toBe(false);
    expect(q(details.el, '[data-header], [data-task-header]')).not.toBeNull();
    expect(q(document.body, 'mf-task-activity')).toBeNull();
  });

  it('the Activity button opens the drawer titled with the task, and closing it returns focus to the button', async () => {
    const { fixture, el } = await mountTaskPage(aTask());
    document.body.appendChild(el);
    const button = q(el, '[data-action="activity"]') as HTMLElement;
    button.focus();
    await click(fixture, button);
    await new Promise((r) => setTimeout(r, 20));
    const drawer = q(document.body, '.mf-drawer')!;
    expect(drawer.textContent).toContain('Activity: TSK-1042 Process Smith custodians');
    expect(q(drawer, 'mf-task-activity')).not.toBeNull();

    fixture.debugElement.injector.get(TaskDetailStore).activityOpen.set(false);
    await settle(fixture);
    await new Promise((r) => setTimeout(r, 30));
    expect(document.activeElement).toBe(button);
    el.remove();
  });

  it('opens the step named by ?step= and puts focus on it', async () => {
    const task = aTask();
    const id = task.workflow.steps[0].stepInstanceId;
    const { fixture, el } = await mountTaskPage(task, PERMS);
    document.body.appendChild(el);
    fixture.componentRef.setInput('step', String(id));
    await settle(fixture);
    await new Promise((r) => setTimeout(r, 20));
    expect(q(el, `[data-step-id="${id}"] .step__toggle`)!.getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(document.activeElement).toBe(q(el, `#step-btn-${id}`));
    el.remove();
  });

  it('a link with ?tab=workflow&step= (from My Work) leaves the focus on the step, not the section heading', async () => {
    const task = aTask();
    const id = task.workflow.steps[0].stepInstanceId;
    const { fixture, el } = await mountTaskPage(task, PERMS);
    document.body.appendChild(el);
    fixture.componentRef.setInput('tab', 'workflow');
    fixture.componentRef.setInput('step', String(id));
    await settle(fixture);
    await new Promise((r) => setTimeout(r, 50));
    expect(q(el, `[data-step-id="${id}"] .step__toggle`)!.getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(document.activeElement).toBe(q(el, `#step-btn-${id}`));
    el.remove();
  });

  it('shows a note in place of the Assets for a user without Asset.View', async () => {
    const { fixture, el } = await mountTaskPage(aTask(), ['Task.View']);
    expect(q(el, '[data-section=assets] [data-preview]')!.textContent).toContain("can't view");
    await click(fixture, q(el, '[data-section=assets] [data-toggle]'));
    expect(q(el, '[data-section=assets] [data-no-access]')).not.toBeNull();
  });

  it('shows a not-found page for 404 and a permission page for 403', async () => {
    const missing = await mountTaskPage(aTask(), PERMS, {
      tasks: { getTask: vi.fn().mockReturnValue(apiError(404, { code: 'NOT_FOUND' })) },
    });
    expect(q(missing.el, '[data-record-state]')!.getAttribute('data-record-state')).toBe(
      'notFound',
    );
    expect(q(missing.el, 'h1')!.textContent).toContain("We couldn't find that task.");
    expect(document.title).toBe('Task not found - MatterFlow');
    TestBed.resetTestingModule();
    const forbidden = await mountTaskPage(aTask(), PERMS, {
      tasks: { getTask: vi.fn().mockReturnValue(apiError(403, { code: 'PERMISSION_DENIED' })) },
    });
    expect(q(forbidden.el, '[data-record-state]')!.getAttribute('data-record-state')).toBe(
      'forbidden',
    );
    expect(q(forbidden.el, 'h1')!.textContent).toContain("You don't have access to this task.");
    expect(document.title).toBe('No access to this task - MatterFlow');
  });

  it('treats an address that is not a task number as a task that does not exist, without asking the API', async () => {
    const getTask = vi.fn().mockReturnValue(ok(aTask()));
    const { fixture, el } = await mountTaskPage(aTask(), PERMS, { tasks: { getTask } });
    fixture.componentRef.setInput('id', 'abc');
    await settle(fixture);
    expect(q(el, '[data-record-state]')!.getAttribute('data-record-state')).toBe('notFound');
    expect(getTask).toHaveBeenCalledTimes(1); // only the first, valid mount
    expect(document.title).toBe('Task not found - MatterFlow');
  });

  it('puts the task in the tab title, cut at 60 characters, and names the Activity drawer while it is open (#295)', async () => {
    const long = 'A'.repeat(200);
    const { fixture, el } = await mountTaskPage(aTask({ title: long }), PERMS);
    const base = `TSK-1042 ${'A'.repeat(60)}…`;
    expect(document.title).toBe(`${base} - MatterFlow`);
    await click(fixture, q(el, '[data-action="activity"]'));
    expect(document.title).toBe(`Activity - ${base} - MatterFlow`);
    fixture.debugElement.injector.get(TaskDetailStore).activityOpen.set(false);
    await settle(fixture);
    expect(document.title).toBe(`${base} - MatterFlow`);
  });

  it('shows the page skeleton while the task loads, then the page', async () => {
    let release!: (t: TaskResponse) => void;
    const pending = new Observable<TaskResponse>((o) => {
      release = (t) => {
        o.next(t);
        o.complete();
      };
    });
    const getTask = vi.fn().mockReturnValue(pending);
    const { fixture, el } = await mountTaskPage(aTask(), PERMS, { tasks: { getTask } });
    expect(q(el, '[data-record-skeleton][data-kind=task]')).not.toBeNull();
    expect(q(el, '[data-loading]')!.textContent).toContain('Loading task');
    release(aTask());
    await settle(fixture);
    expect(q(el, '[data-record-skeleton]')).toBeNull();
    expect(q(el, '[data-task-header] [data-ref]')!.textContent).toBe('TSK-1042');
  });

  it('shows an error with Retry for other failures', async () => {
    const getTask = vi
      .fn()
      .mockReturnValueOnce(apiError(500, { code: 'ERROR' }))
      .mockReturnValue(ok(aTask()));
    const { fixture, el } = await mountTaskPage(aTask(), PERMS, { tasks: { getTask } });
    expect(q(el, '[data-record-error]')).not.toBeNull();
    expect(document.title).toBe('Task could not be loaded - MatterFlow');
    await click(fixture, q(el, '[data-retry] button, button[data-retry]'));
    expect(q(el, '[data-task-header] [data-ref]')!.textContent).toBe('TSK-1042');
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
    await click(fixture, q(el, '[data-option=HOLD]'));
    const area = body().querySelector<HTMLTextAreaElement>('#task-reason')!;
    area.value = 'Because';
    area.dispatchEvent(new Event('input'));
    await click(fixture, dialogButton('Put on hold')!);

    expect(fakes.tasks['changeTaskStatus']).toHaveBeenCalled();
    expect(q(el, '[data-conflict-banner]')!.textContent).toContain('changed by someone else');
    await click(fixture, q(el, '[data-reload]'));
    expect(q(el, '[data-conflict-banner]')).toBeNull();
    expect(q(el, '[data-task-header] [data-name]')!.textContent).toBe('Changed elsewhere');
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
    await click(fixture, q(el, '[data-option=RESUME]'));
    expect(fakes.tasks['getTask']).toHaveBeenCalledTimes(2);
  });

  it('reports unsaved edits to the leave guard', async () => {
    const { fixture, el } = await mountTaskPage(aTask());
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    await click(fixture, q(el, '[data-action="edit"]'));
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    const title = q(document.body, '#td-title') as HTMLInputElement;
    title.value = 'New title';
    title.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
  });

  it('starts with Assets and Comments collapsed, as two slim bars stacked in that order', async () => {
    const { el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View']);
    for (const name of ['comments', 'assets']) {
      const toggle = q(el, `[data-section=${name}] [data-toggle]`)!;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    }
    expect(
      q(el, '[data-section=assets]')!.compareDocumentPosition(q(el, '[data-section=comments]')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(q(el, '[data-section=comments] [data-comment-id]')).toBeNull();
  });

  it('opens a section from its bar; the sections are always stacked, never side by side', async () => {
    const { fixture, el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View']);
    await click(fixture, q(el, '[data-section=assets] [data-toggle]'));
    expect(q(el, '[data-section=assets] [data-toggle]')!.getAttribute('aria-expanded')).toBe(
      'true',
    );
    await click(fixture, q(el, '[data-section=comments] [data-toggle]'));
    expect(q(el, '.bottom')!.className).toBe('bottom');
  });

  it('applies the remembered choice of this user before the first render', async () => {
    localStorage.clear();
    localStorage.setItem('mf.task-detail.comments.open.1', '1');
    const { el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View']);
    expect(q(el, '[data-section=comments] [data-toggle]')!.getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(q(el, '[data-section=assets] [data-toggle]')!.getAttribute('aria-expanded')).toBe(
      'false',
    );
    localStorage.clear();
  });

  it.each(['comments', 'assets'])(
    'the deep link ?tab=%s and the section nav expand the section without changing what is remembered',
    async (name) => {
      localStorage.clear();
      const { fixture, el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View'], {}, name);
      await settle(fixture);
      await new Promise((r) => setTimeout(r, 20));
      expect(q(el, `[data-section=${name}] [data-toggle]`)!.getAttribute('aria-expanded')).toBe(
        'true',
      );
      expect(localStorage.getItem(`mf.task-detail.${name}.open.1`)).toBeNull();
    },
  );

  it('the section nav expands a collapsed section', async () => {
    const { fixture, el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View']);
    await click(fixture, q(el, '[data-section-link=comments]'));
    expect(q(el, '[data-section=comments] [data-toggle]')!.getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('the section nav shows the counts the sections report (comments, assets) once they are known', async () => {
    const { fixture, el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View']);
    await settle(fixture);
    const text = (key: string) =>
      q(el, `[data-section-link=${key}]`)!.textContent!.replace(/\s+/g, ' ').trim();
    expect(text('comments')).toMatch(/^Comments \d+$/);
    expect(text('assets')).toMatch(/^Assets \d+$/);
  });

  it('Assets shows no count without Asset.View, where the section cannot list the links', async () => {
    const { el } = await mountTaskPage(aTask(), PERMS);
    expect(q(el, '[data-section-link=assets]')!.textContent!.trim()).toBe('Assets');
  });

  describe('Details below 1100 px (#307)', () => {
    const original = window.matchMedia;
    beforeEach(() => {
      localStorage.clear();
      window.matchMedia = ((query: string) => ({
        matches: 768 >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })) as never;
    });
    afterEach(() => {
      window.matchMedia = original;
      localStorage.clear();
    });
    const expanded = (el: HTMLElement) =>
      q(el, '[data-detail-toggle]')!.getAttribute('aria-expanded');

    it('is closed with the one-line summary, after the Workflow, Assets and Comments in the reading order', async () => {
      const { el } = await mountTaskPage(aTask(), PERMS);
      expect(expanded(el)).toBe('false');
      expect(q(el, '[data-detail-summary]')!.textContent).toMatch(/^Requestor .+/);
      const order = Array.from(el.querySelectorAll('mf-detail-layout h2')).map(
        (h) => /^(Workflow|Comments|Assets|Details)/.exec(h.textContent!.trim())![1],
      );
      expect(order).toEqual(['Workflow', 'Assets', 'Comments', 'Details']);
      expect(q(el, '[data-detail-left] [data-section-nav]')).not.toBeNull();
    });

    it('opens with a click, remembers the choice for this person and starts open next time', async () => {
      const first = await mountTaskPage(aTask(), PERMS);
      await click(first.fixture, q(first.el, '[data-detail-toggle]'));
      expect(expanded(first.el)).toBe('true');
      expect(localStorage.getItem('mf.task-detail.details.open.1')).toBe('1');
      TestBed.resetTestingModule();
      const again = await mountTaskPage(aTask(), PERMS);
      expect(expanded(again.el)).toBe('true');
    });

    it('?tab=details opens it without changing what is remembered', async () => {
      const { fixture, el } = await mountTaskPage(aTask(), PERMS, {}, 'details');
      await settle(fixture);
      expect(expanded(el)).toBe('true');
      expect(localStorage.getItem('mf.task-detail.details.open.1')).toBeNull();
    });
  });
});

describe('TaskDetailPage drill-in context (M7, #160)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    history.replaceState(null, '');
  });

  async function openFrom(
    from: string,
    returnTo?: string,
    task = aTask(),
    perms: Permission[] = PERMS,
  ) {
    return mountTaskPage(task, perms, {}, undefined, () => {
      const route = TestBed.inject(ActivatedRoute);
      (route.queryParams as BehaviorSubject<Params>).next({ from });
      route.snapshot.queryParams = { from };
      history.replaceState(returnTo ? { returnTo } : null, '');
    });
  }

  const crumb = (el: HTMLElement) =>
    el.querySelector<HTMLAnchorElement>('nav[aria-label="Breadcrumb"] li a')!;

  it('names the list in the first crumb and links to the exact view when the browser knows it', async () => {
    const { el } = await openFrom('my-work', '/my-work?view=dueSoon&priority=1');
    expect(crumb(el).textContent!.trim()).toBe('My Work');
    expect(crumb(el).getAttribute('href')).toBe('/my-work?view=dueSoon&priority=1');
    const back = q(el, '[data-back-link]') as HTMLAnchorElement;
    expect(back.textContent).toContain('Back to My Work');
    expect(back.getAttribute('href')).toBe('/my-work?view=dueSoon&priority=1');
  });

  it('falls back to the plain list path in a new tab (no history state) or for a foreign address', async () => {
    const plain = await openFrom('task-queue');
    expect(crumb(plain.el).textContent!.trim()).toBe('Task Queue');
    expect(crumb(plain.el).getAttribute('href')).toBe('/tasks');
    TestBed.resetTestingModule();
    const foreign = await openFrom('pod-work', '/admin/users?x=1');
    expect(crumb(foreign.el).textContent!.trim()).toBe('Pod Work');
    expect(crumb(foreign.el).getAttribute('href')).toBe('/pods/work');
  });

  describe('from a Matter, Project, Dashboard or Search (T9, #324)', () => {
    const crumbs = (el: HTMLElement) =>
      Array.from(el.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Breadcrumb"] li a')).map(
        (a) => [a.textContent!.trim(), a.getAttribute('href')],
      );
    const back = (el: HTMLElement) => q(el, '[data-back-link]') as HTMLAnchorElement;

    it('Matter: the crumb names the matter and returns to the exact Tasks view; the matter is not a second crumb', async () => {
      const { el } = await openFrom('matter', '/matters/7?tab=tasks&status=NEW&q=abc', undefined, [
        ...PERMS,
        'Matter.View',
      ]);
      expect(crumbs(el)).toEqual([['Matter 00343-00012', '/matters/7?tab=tasks&status=NEW&q=abc']]);
      expect(back(el).textContent).toContain('Back to Matter 00343-00012');
      expect(back(el).getAttribute('href')).toBe('/matters/7?tab=tasks&status=NEW&q=abc');
    });

    it('Matter: a foreign or other-matter address falls back to the matter Tasks tab; without Matter.View the origin is ignored', async () => {
      const other = await openFrom('matter', '/matters/8?tab=tasks', undefined, [
        ...PERMS,
        'Matter.View',
      ]);
      expect(crumbs(other.el)).toEqual([['Matter 00343-00012', '/matters/7?tab=tasks']]);
      TestBed.resetTestingModule();
      const none = await openFrom('matter', '/matters/7?tab=tasks');
      expect(crumbs(none.el)).toEqual([['Tasks', '/tasks']]);
      expect(back(none.el).getAttribute('href')).toBe('/tasks');
    });

    it('Project: the crumb names the project and keeps the matter as the next crumb; a task without a project ignores the origin', async () => {
      const task = aTask({ project: { projectId: 3, name: 'Alpha review', isActive: true } });
      const { el } = await openFrom('project', '/projects/3?tab=tasks&priority=1', task, [
        ...PERMS,
        'Matter.View',
        'Project.View',
      ]);
      expect(crumbs(el)).toEqual([
        ['Project Alpha review', '/projects/3?tab=tasks&priority=1'],
        ['00343-00012 Merger Review', '/matters/7'],
      ]);
      TestBed.resetTestingModule();
      const bare = await openFrom('project', '/projects/3', aTask({ project: undefined }), [
        ...PERMS,
        'Project.View',
      ]);
      expect(crumbs(bare.el)[0]).toEqual(['Tasks', '/tasks']);
    });

    it('Dashboard and Search: the exact address comes back; a foreign address falls back to the page', async () => {
      const dash = await openFrom('dashboard', '/dashboard?pod=4', undefined, [
        ...PERMS,
        'Dashboard.View',
      ]);
      expect(crumbs(dash.el)).toEqual([['Dashboard', '/dashboard?pod=4']]);
      TestBed.resetTestingModule();
      const search = await openFrom('search', '/search?q=merger');
      expect(crumbs(search.el)).toEqual([['Search', '/search?q=merger']]);
      expect(back(search.el).getAttribute('href')).toBe('/search?q=merger');
      TestBed.resetTestingModule();
      const adv = await openFrom('search', '/search/advanced?type=task&q=x');
      expect(crumbs(adv.el)).toEqual([['Search', '/search/advanced?type=task&q=x']]);
      TestBed.resetTestingModule();
      const foreign = await openFrom('search', '//evil.example/search');
      expect(crumbs(foreign.el)).toEqual([['Search', '/search']]);
      TestBed.resetTestingModule();
      const denied = await openFrom('dashboard', '/dashboard');
      expect(crumbs(denied.el)).toEqual([['Tasks', '/tasks']]);
    });
  });

  it('keeps the default crumb and a Back link to the Task list for an unknown from value', async () => {
    const { el } = await openFrom('somewhere-else');
    expect(crumb(el).textContent!.trim()).toBe('Tasks');
    expect(crumb(el).getAttribute('href')).toBe('/tasks');
    expect((q(el, '[data-back-link]') as HTMLAnchorElement).getAttribute('href')).toBe('/tasks');
  });
});
