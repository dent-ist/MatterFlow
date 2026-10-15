import { TestBed } from '@angular/core/testing';

vi.setConfig({ testTimeout: 60000 });
import { Observable, of } from 'rxjs';
import { TaskResponse } from '../../../api/generated/api-client';
import { Permission } from '../../../core/auth/permissions';
import { UndoService } from '../../../core/notify/undo.service';
import { TaskDetailStore } from './task-detail.store';
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

  it('has one Edit button and inline Status, Priority and Assignee menus for a user who may change them', async () => {
    const { el } = await mountTaskPage(aTask(), [...PERMS, 'Task.SetPriority', 'Task.Assign']);

    expect(el.querySelectorAll('[data-edit]').length).toBe(1);
    expect(q(el, '[data-edit]')!.textContent!.trim()).toBe('Edit');
    expect(q(el, '[data-edit-details]')).not.toBeNull();
    expect(q(el, '[data-activity-button]')!.textContent).toContain('Activity');
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
    expect(q(el, '[data-edit]')).toBeNull();
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
    const edit = q(el, '[data-edit]') as HTMLElement;
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

    expect(q(el, '[data-task-number]')!.textContent).toBe('TSK-1042');
    expect(q(el, '[data-task-title]')!.textContent).toBe('Process Smith custodians');
    expect(q(el, 'mf-status-badge')!.textContent).toContain('In Progress');
    expect(q(el, 'mf-priority-badge')!.textContent).toContain('Critical');
    expect(q(el, '[data-task-type]')!.textContent).toContain('Data Processing');
    expect(q(el, '[data-title-icon] svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(q(el, '[data-title-icon]')!.getAttribute('title')).toBe('Data Processing');
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
    expect(q(none.el, '[data-status] [data-inline-trigger]')).toBeNull();
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
    const item = q(el, '[data-option=REOPEN]') as HTMLButtonElement;
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(q(el, '.im-reason')!.textContent).toContain(
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

  it('Cancel needs a comment and calls cancel', async () => {
    const { fixture, el, fakes } = await mountTaskPage(aTask());
    await openMenu(fixture, el);
    await click(fixture, q(el, '[data-option=CANCEL]'));
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
    expect(q(el, '[data-closed-banner]')!.textContent).toMatch(
      /This task is Completed\.\s+Reopen it to edit\./,
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

    await click(fixture, dialogButton('Mark all completed and finish task')!);
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
    expect(dialogButton('Mark all completed and finish task')).toBeUndefined();
    const link = byText(body(), '[data-blocked-steps] button', 'Step 3: OCR')!;
    await click(fixture, link);

    expect(fakes.tasks['completeTask']).not.toHaveBeenCalled();
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
    await click(fixture, q(el, '[data-option=COMPLETE]'));
    await click(fixture, dialogButton('Mark all completed and finish task')!);
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
    await click(fixture, dialogButton('Mark all completed and finish task')!);

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
    expect(dialogButton('Mark all completed and finish task')).toBeUndefined();
  });
});

describe('TaskDetailPage layout and states', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => TestBed.resetTestingModule());

  it('is one page: Workflow in the main column, Comments and Assets below it, Details in the side panel, no tabs', async () => {
    const { el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View']);

    expect(q(el, '[role=tablist]')).toBeNull();
    expect(q(el, '[role=tab]')).toBeNull();
    const main = q(el, '[data-detail-main]')!;
    expect(q(main, '[data-section=workflow] [data-workflow-tab]')).not.toBeNull();
    // Comments and Assets sit side by side under the Workflow, in the same (left) column.
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

  it('keeps the heading order: one h1, h2 sections Workflow, Comments, Assets, Details', async () => {
    const { el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View']);
    expect(el.querySelectorAll('h1').length).toBe(1);
    const h2 = Array.from(el.querySelectorAll('h2')).map(
      (h) => h.textContent!.replace(/\s+/g, ' ').trim().split(' ')[0],
    );
    expect(h2).toEqual(['Workflow', 'Comments', 'Assets', 'Details']);
    expect(q(el, 'aside')!.getAttribute('aria-labelledby')).toBe(q(el, 'aside h2')!.id);
  });

  it('has a Jump to row whose links scroll to the section and move focus to its heading', async () => {
    const { fixture, el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View']);
    document.body.appendChild(el);
    const nav = q(el, 'nav[aria-label="Jump to"]')!;
    expect(Array.from(nav.querySelectorAll('a')).map((a) => a.textContent!.trim())).toEqual([
      'Workflow',
      'Comments',
      'Assets',
    ]);
    for (const [name, selector] of [
      ['workflow', '#wf-h'],
      ['comments', '[data-section=comments] [data-section-heading]'],
      ['assets', '[data-section=assets] [data-section-heading]'],
    ]) {
      await click(fixture, q(nav, `[data-jump-to=${name}]`));
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
      expect(scroll.mock.contexts).toContain(heading);
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
    const button = q(el, '[data-activity-button]') as HTMLElement;
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
    await click(fixture, q(el, '[data-option=HOLD]'));
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
    await click(fixture, q(el, '[data-option=RESUME]'));
    expect(fakes.tasks['getTask']).toHaveBeenCalledTimes(2);
  });

  it('reports unsaved edits to the leave guard', async () => {
    const { fixture, el } = await mountTaskPage(aTask());
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    await click(fixture, q(el, '[data-edit]'));
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    const title = q(document.body, '#td-title') as HTMLInputElement;
    title.value = 'New title';
    title.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
  });

  it('starts with Comments and Assets collapsed, side by side as two slim bars', async () => {
    const { el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View']);
    for (const name of ['comments', 'assets']) {
      const toggle = q(el, `[data-section=${name}] [data-toggle]`)!;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    }
    expect(q(el, '.bottom')!.classList).toContain('bottom--split');
    expect(q(el, '[data-section=comments] [data-comment-id]')).toBeNull();
  });

  it('opens a section from its bar, and one open section takes the whole row (stacked)', async () => {
    const { fixture, el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View']);
    await click(fixture, q(el, '[data-section=assets] [data-toggle]'));
    expect(q(el, '[data-section=assets] [data-toggle]')!.getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(q(el, '.bottom')!.classList).not.toContain('bottom--split');
    await click(fixture, q(el, '[data-section=comments] [data-toggle]'));
    expect(q(el, '.bottom')!.classList).toContain('bottom--split');
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
    'the deep link ?tab=%s and Jump to expand the section without changing what is remembered',
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

  it('Jump to expands a collapsed section', async () => {
    const { fixture, el } = await mountTaskPage(aTask(), [...PERMS, 'Asset.View']);
    await click(fixture, q(el, '[data-jump-to=comments]'));
    expect(q(el, '[data-section=comments] [data-toggle]')!.getAttribute('aria-expanded')).toBe(
      'true',
    );
  });
});
