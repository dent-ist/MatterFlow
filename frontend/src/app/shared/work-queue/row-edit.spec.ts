import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { TaskQueueRow, TasksClient, UsersLookupClient } from '../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { apiError } from '../../core/lookups/lookups-testing';
import { NotificationService } from '../../core/notify/notification.service';
import { UndoService } from '../../core/notify/undo.service';
import { InlineField } from './inline-edit';
import { InlineStatusFlow } from './inline-status-flow';
import { RowEdit } from './row-edit';
import { aLookupItem } from '../assignees/assignee-testing';
import { aRow, provideLookups } from './work-queue-testing';

const taskOf = (row: TaskQueueRow, patch: Record<string, unknown> = {}) => ({
  taskId: row.taskId,
  taskNumber: row.taskNumber,
  status: row.status,
  statusLabel: row.statusLabel,
  priority: row.priority,
  assignedPod: row.assignedPod,
  assignedUser: row.assignedUser,
  isAsap: true,
  isOverdue: false,
  statusChangedAtUtc: row.statusChangedAtUtc,
  rowVersion: 'NEW-VERSION',
  ...patch,
});

/** Stands in for the status flow, which needs the whole Task page store. */
@Component({
  selector: 'mf-inline-status-flow',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class FlowStub {
  readonly row = input<unknown>();
  readonly action = input<unknown>();
  readonly rowChange = output<unknown>();
  readonly conflict = output<void>();
  readonly finished = output<void>();
}

describe('RowEdit', () => {
  let stubFlow = false;
  let fixture: ComponentFixture<RowEdit>;
  let tasks: Record<string, ReturnType<typeof vi.fn>>;
  let users: { lookupUsers: ReturnType<typeof vi.fn> };
  let notify: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };
  let undo: UndoService;
  let emitted: TaskQueueRow[];
  const el = () => fixture.nativeElement as HTMLElement;
  const trigger = () => el().querySelector<HTMLButtonElement>('[data-inline-trigger]')!;
  const option = (id: string) => el().querySelector<HTMLButtonElement>(`[data-option="${id}"]`)!;

  async function create(
    field: InlineField,
    row: TaskQueueRow,
    permissions: Permission[] = [
      // Task.View is what lets the lookup store read the priority list (AD-D #519); nobody sees a queue row without it.
      'Task.View',
      'Task.SetPriority',
      'Task.Assign',
      'Task.ChangeStatus',
      'Pod.View',
    ],
  ) {
    tasks = {
      setTaskPriority: vi.fn(() =>
        of(taskOf(row, { priority: { priorityId: 3, label: 'Low', color: 'low', sortOrder: 3 } })),
      ),
      assignTask: vi.fn(() =>
        of(
          taskOf(row, {
            status: 'IN_PROGRESS',
            statusLabel: 'In Progress',
            assignedUser: { userId: 4, displayName: 'Sam Kim', isActive: true },
          }),
        ),
      ),
      changeTaskStatus: vi.fn(() =>
        of(taskOf(row, { status: 'IN_PROGRESS', statusLabel: 'In Progress' })),
      ),
      getTask: vi.fn(() => of(taskOf(row, { rowVersion: 'FRESH' }))),
      getTaskCompletionCheck: vi.fn(() =>
        of({
          isReady: true,
          canBulkComplete: false,
          unresolved: [],
          bulkCompletable: [],
          blocked: [],
          workflowRowVersion: 'W1',
        }),
      ),
    };
    // The server decides who is listed and in which order; the spec stands in for it: Sam Kim is the Pod's member, Any Person is everyone else.
    users = {
      lookupUsers: vi.fn((_q?: string, _limit?: number, podId?: number) =>
        of(
          podId
            ? [aLookupItem({ userId: 4, displayName: 'Sam Kim', openTaskCount: 3 })]
            : [aLookupItem({ userId: 8, displayName: 'Any Person', openTaskCount: 1 })],
        ),
      ),
    };
    notify = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        ...provideLookups(),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: TasksClient, useValue: tasks },
        { provide: UsersLookupClient, useValue: users },
        { provide: NotificationService, useValue: notify },
      ],
    });
    if (stubFlow) {
      TestBed.overrideComponent(RowEdit, {
        remove: { imports: [InlineStatusFlow] },
        add: { imports: [FlowStub] },
      });
    }
    await TestBed.inject(AuthStore).ensureLoaded();
    undo = TestBed.inject(UndoService);
    undo.dismiss();
    fixture = TestBed.createComponent(RowEdit);
    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('row', row);
    emitted = [];
    fixture.componentInstance.rowChange.subscribe((r) => emitted.push(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function open() {
    trigger().click();
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function pick(id: string) {
    option(id).click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows the value with a chevron and an accessible name that includes the current value', async () => {
    await create('priority', aRow());
    expect(trigger().getAttribute('aria-label')).toBe('Critical, change priority of TSK-1042');
    // The name starts with the visible value (WCAG 2.5.3 Label in Name).
    expect(trigger().getAttribute('aria-label')!.startsWith(trigger().textContent!.trim())).toBe(
      true,
    );
    expect(trigger().getAttribute('aria-haspopup')).toBe('true');
    expect(trigger().querySelector('.pi-chevron-down')).not.toBeNull();
    expect(el().textContent).toContain('Critical');
  });

  it('priority: shows the new priority at once, then the server row, and toasts', async () => {
    await create('priority', aRow());
    await open();
    expect(option('2')).not.toBeNull();
    expect(option('1').getAttribute('aria-checked')).toBe('true');
    await pick('3');

    expect(tasks['setTaskPriority']).toHaveBeenCalledWith(1042, {
      rowVersion: 'AAAA',
      priorityId: 3,
    });
    expect(emitted[0].priority.priorityId).toBe(3);
    expect(emitted[0].rowVersion).toBe('AAAA');
    expect(emitted[1].rowVersion).toBe('NEW-VERSION');
    // Priority and Assignee offer Undo instead of a plain success toast.
    expect(notify.success).not.toHaveBeenCalled();
    expect(undo.current()?.message).toBe('TSK-1042 priority set to Normal.');
  });

  it('Undo puts the previous priority back with the fresh rowVersion', async () => {
    await create('priority', aRow());
    await open();
    await pick('3');
    const after = taskOf(aRow(), {
      priority: { priorityId: 3, label: 'Low', color: 'low', sortOrder: 3 },
      rowVersion: 'V2',
    });
    tasks['getTask'].mockReturnValue(of(after));
    tasks['setTaskPriority'].mockClear();
    tasks['setTaskPriority'].mockReturnValue(of(taskOf(aRow(), { rowVersion: 'V3' })));

    await undo.run();

    expect(tasks['setTaskPriority']).toHaveBeenCalledWith(1042, {
      rowVersion: 'V2',
      priorityId: 1,
    });
    expect(emitted.at(-1)!.rowVersion).toBe('V3');
    expect(notify.success).toHaveBeenCalledWith('TSK-1042 priority back to Critical.');
    expect(undo.current()).toBeNull();
  });

  it('Undo does not overwrite a priority that was changed again', async () => {
    await create('priority', aRow());
    await open();
    await pick('3');
    tasks['getTask'].mockReturnValue(
      of(
        taskOf(aRow(), {
          priority: { priorityId: 2, label: 'High', color: 'high', sortOrder: 2 },
          rowVersion: 'V9',
        }),
      ),
    );
    tasks['setTaskPriority'].mockClear();

    await undo.run();

    expect(tasks['setTaskPriority']).not.toHaveBeenCalled();
    expect(notify.info).toHaveBeenCalledWith(expect.stringContaining('Not undone'));
    expect(emitted.at(-1)!.priority.priorityId).toBe(2);
  });

  it('Undo that hits a rowVersion conflict says so and refreshes the row', async () => {
    await create('priority', aRow());
    await open();
    await pick('3');
    tasks['getTask'].mockReturnValue(
      of(
        taskOf(aRow(), {
          priority: { priorityId: 3, label: 'Low', color: 'low', sortOrder: 3 },
          rowVersion: 'V2',
        }),
      ),
    );
    tasks['setTaskPriority'].mockReturnValue(
      throwError(() => apiError(409, 'CONCURRENCY_CONFLICT', 'changed')),
    );

    await undo.run();

    expect(notify.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't undo"));
    expect(emitted.at(-1)!.rowVersion).toBe('V2');
  });

  it('Undo of an assignment puts back the previous person', async () => {
    await create('assignee', aRow());
    await open();
    await pick('4');
    tasks['getTask'].mockReturnValue(
      of(
        taskOf(aRow(), {
          assignedUser: { userId: 4, displayName: 'Sam Kim', isActive: true },
          rowVersion: 'V2',
        }),
      ),
    );
    tasks['assignTask'].mockClear();
    tasks['assignTask'].mockReturnValue(of(taskOf(aRow(), { rowVersion: 'V3' })));

    await undo.run();

    expect(tasks['assignTask']).toHaveBeenCalledWith(1042, {
      rowVersion: 'V2',
      podId: 5,
      userId: aRow().assignedUser?.userId,
    });
  });

  it('the Undo offer expires after 8 seconds', async () => {
    vi.useFakeTimers();
    try {
      undo.offer('x', async () => undefined);
      vi.advanceTimersByTime(7900);
      expect(undo.current()).not.toBeNull();
      vi.advanceTimersByTime(200);
      expect(undo.current()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('puts the old value back and toasts when the save fails', async () => {
    await create('priority', aRow());
    tasks['setTaskPriority'].mockReturnValue(throwError(() => new Error('boom')));
    await open();
    await pick('3');

    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toEqual(aRow());
    expect(notify.error).toHaveBeenCalled();
  });

  it('refreshes the row from the server after a rowVersion conflict', async () => {
    await create('priority', aRow());
    tasks['setTaskPriority'].mockReturnValue(
      throwError(() => apiError(409, 'CONCURRENCY_CONFLICT', 'changed')),
    );
    await open();
    await pick('3');

    expect(notify.error).toHaveBeenCalledWith(expect.stringContaining('refreshed'));
    expect(tasks['getTask']).toHaveBeenCalledWith(1042);
    expect(emitted.at(-1)!.rowVersion).toBe('FRESH');
  });

  it('assignee: offers the members of the Pod from the shared list, with Unassigned and a way to search all users, and applies the choice', async () => {
    await create('assignee', aRow({ status: 'NEW' }));
    await open();
    // One lookup, asked for the Pod's members; the client neither ranks nor reads the Pod itself.
    expect(users.lookupUsers).toHaveBeenCalledTimes(1);
    expect(users.lookupUsers).toHaveBeenCalledWith(undefined, 50, 5, 2, undefined);
    expect(option('none')).not.toBeNull();
    expect(option('4')).not.toBeNull();
    // Why the list is short (UAT2-13), and the way out.
    expect(el().querySelector('[data-menu-note]')!.textContent).toContain('members of Pod A');
    expect(el().querySelector('[data-foot-action]')!.textContent).toContain('Search all users');
    expect(el().querySelector('[data-menu-group]')).toBeNull();

    await pick('4');
    expect(tasks['assignTask']).toHaveBeenCalledWith(1042, {
      rowVersion: 'AAAA',
      podId: 5,
      userId: 4,
    });
    // A New task starts at once, and the final row follows the server.
    expect(emitted[0].status).toBe('IN_PROGRESS');
    expect(emitted[0].assignedUser?.displayName).toBe('Sam Kim');
    expect(emitted[1].status).toBe('IN_PROGRESS');
    expect(undo.current()?.detail).toBe('Task moved to In Progress.');
  });

  it('assignee: shows the open-task count next to each candidate, in the order the server sent', async () => {
    await create('assignee', aRow({ status: 'NEW' }));
    users.lookupUsers.mockReturnValue(
      of([
        aLookupItem({ userId: 9, displayName: 'Zed Zane', openTaskCount: 0 }),
        aLookupItem({ userId: 4, displayName: 'Sam Kim', openTaskCount: 3 }),
        aLookupItem({ userId: 2, displayName: 'Ann Ames', openTaskCount: 5 }),
      ]),
    );
    await open();
    const ids = Array.from(el().querySelectorAll('[data-option]')).map((o) =>
      o.getAttribute('data-option'),
    );
    // "Unassigned" first, then the people exactly as sent: not re-sorted by name or count in the client.
    expect(ids).toEqual(['none', '9', '4', '2']);
    expect(option('4')!.querySelector('.im-hint')!.textContent!.trim()).toBe('3 open');
    expect(option('9')!.querySelector('.im-hint')!.textContent!.trim()).toBe('0 open');
  });

  it('assignee: "Search all users" leaves the Pod and searches everyone', async () => {
    await create('assignee', aRow({ status: 'NEW' }));
    await open();
    el().querySelector<HTMLButtonElement>('[data-foot-action]')!.click();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
    // Everyone, as the Suggested list (no Pod): five arguments, the last one asking for suggestions.
    expect(users.lookupUsers).toHaveBeenLastCalledWith(undefined, 6, undefined, 2, true);
    expect(option('8')).not.toBeNull();
    expect(el().querySelector('[data-foot-action]')).toBeNull();

    const input = el().querySelector<HTMLInputElement>('.im-search')!;
    input.value = 'User 1';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    expect(users.lookupUsers).toHaveBeenLastCalledWith('User 1', 25, undefined, 2, undefined);
  });

  it('assignee: typing in a Pod list searches the Pod, with the Pod id', async () => {
    await create('assignee', aRow({ status: 'NEW' }));
    await open();
    const input = el().querySelector<HTMLInputElement>('.im-search')!;
    input.value = 'sam';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    expect(users.lookupUsers).toHaveBeenLastCalledWith('sam', 50, 5, 2, undefined);
  });

  it('assignee: a Pod without people to offer falls back to the Suggested list', async () => {
    await create('assignee', aRow({ status: 'NEW' }));
    users.lookupUsers.mockImplementation((_q?: string, _l?: number, podId?: number) =>
      of(podId ? [] : [aLookupItem({ userId: 8, displayName: 'Any Person', openTaskCount: 1 })]),
    );
    await open();
    expect(option('8')).not.toBeNull();
    expect(el().querySelector('[data-menu-group]')!.textContent).toContain('Suggested');
    expect(el().querySelector('[data-foot-action]')).toBeNull();
  });

  it('assignee: flags a person who is out of office and still lets them be chosen', async () => {
    await create('assignee', aRow({ status: 'NEW' }));
    users.lookupUsers.mockReturnValue(
      of([
        aLookupItem({
          userId: 4,
          displayName: 'Sam Kim',
          availability: { state: 'OUT_OF_OFFICE', outUntil: '2099-03-21T04:00:00Z' },
        }),
      ]),
    );
    await open();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
    const flag = option('4')!.querySelector('[data-option-flag]');
    expect(flag?.textContent).toMatch(/Out of office until Mar 2[01], 2099/);
    await pick('4');
    expect(tasks['assignTask']).toHaveBeenCalled();
  });

  it('assignee: "Assign to me" is the first choice of the menu when asked for and the task is not already the signed-in user\'s, and assigns them', async () => {
    const unassigned = aRow({ status: 'NEW', assignedUser: undefined });
    await create('assignee', unassigned);
    await open();
    expect(document.querySelector('[data-lead]')).toBeNull();

    // Assigned to someone else: still offered (take over); assigned to the user: not.
    TestBed.resetTestingModule();
    await create('assignee', aRow());
    fixture.componentRef.setInput('selfAssign', true);
    fixture.detectChanges();
    await open();
    expect(document.querySelector('[data-lead]')).not.toBeNull();

    TestBed.resetTestingModule();
    await create(
      'assignee',
      aRow({ assignedUser: { userId: 1, displayName: 'Test User', isActive: true } }),
    );
    fixture.componentRef.setInput('selfAssign', true);
    fixture.detectChanges();
    await open();
    expect(document.querySelector('[data-lead]')).toBeNull();

    TestBed.resetTestingModule();
    await create('assignee', unassigned);
    fixture.componentRef.setInput('assignMe', true);
    fixture.detectChanges();
    // No separate link next to the menu unless asked for.
    expect(el().querySelector('[data-assign-link]')).toBeNull();
    expect(trigger().getAttribute('aria-label')).toBe('Unassigned, change assignee of TSK-1042');
    expect(trigger().classList).toContain('im-outlined');
    await open();
    const lead = el().querySelector<HTMLButtonElement>('[data-lead]')!;
    expect(lead.getAttribute('aria-label')).toBe('Assign TSK-1042 to me');
    expect(lead.textContent!.trim()).toBe('Assign to me');
    // First in the menu: above the search box and the people.
    const pop = el().querySelector('.im-pop')!;
    expect(pop.firstElementChild).toBe(lead);
    lead.click();
    await fixture.whenStable();
    expect(tasks['assignTask']).toHaveBeenCalledWith(1042, {
      rowVersion: 'AAAA',
      podId: 5,
      userId: 1,
    });
    expect(emitted[0].assignedUser?.displayName).toBe('Test User');
    expect(undo.current()?.message).toContain('Assigned to you.');
  });

  it('assignee: the "Assign to me" link-button is the same action as the menu item, with an Undo toast', async () => {
    const unassigned = aRow({ status: 'IN_PROGRESS', assignedUser: undefined });
    await create('assignee', unassigned);
    expect(el().querySelector('[data-assign-link]')).toBeNull();

    fixture.componentRef.setInput('assignLink', true);
    fixture.detectChanges();
    const link = el().querySelector<HTMLButtonElement>('[data-assign-link]')!;
    expect(link.getAttribute('aria-label')).toBe('Assign TSK-1042 to me');
    expect(link.textContent!.trim()).toBe('Assign to me');
    link.click();
    await fixture.whenStable();
    expect(tasks['assignTask']).toHaveBeenCalledWith(1042, {
      rowVersion: 'AAAA',
      podId: 5,
      userId: 1,
    });
    expect(emitted.at(-1)?.assignedUser?.userId).toBe(4);
    expect(undo.current()?.message).toBe('Assigned to you.');

    // Not for a task somebody holds, nor for the icon trigger.
    TestBed.resetTestingModule();
    await create('assignee', aRow());
    fixture.componentRef.setInput('assignLink', true);
    fixture.detectChanges();
    expect(el().querySelector('[data-assign-link]')).toBeNull();
  });

  it('assignee without a Pod shows the Suggested list first, with the heading and the counts', async () => {
    await create('assignee', aRow({ assignedPod: undefined, assignedUser: undefined }));
    await open();
    expect(users.lookupUsers).toHaveBeenCalledWith(undefined, 6, undefined, 2, true);
    expect(el().querySelector('[data-menu-group]')!.textContent).toContain('Suggested');
    expect(option('8')!.querySelector('.im-hint')!.textContent!.trim()).toBe('1 open');
    expect(option('none')).toBeNull();
    expect(el().querySelector('[data-foot-action]')).toBeNull();
  });

  it('assignee: Unassigned sends no user and keeps the Pod', async () => {
    await create('assignee', aRow());
    tasks['assignTask'].mockReturnValue(of(taskOf(aRow(), { assignedUser: undefined })));
    await open();
    await pick('none');
    expect(tasks['assignTask']).toHaveBeenCalledWith(1042, {
      rowVersion: 'AAAA',
      podId: 5,
      userId: undefined,
    });
    expect(emitted[0].assignedUser).toBeUndefined();
  });

  it('status: lists only allowed transitions and Start goes straight to In Progress', async () => {
    await create('status', aRow({ status: 'NEW', statusLabel: 'New' }));
    await open();
    expect(
      Array.from(el().querySelectorAll('[data-option]')).map((o) => o.getAttribute('data-option')),
    ).toEqual(['START', 'HOLD']);
    await pick('START');
    expect(tasks['changeTaskStatus']).toHaveBeenCalledWith(1042, {
      rowVersion: 'AAAA',
      status: 'IN_PROGRESS',
    });
    expect(emitted[0].status).toBe('IN_PROGRESS');
  });

  it('shows Reopen disabled with the reason when the matter is inactive', async () => {
    await create('status', aRow({ status: 'CANCELLED', matterIsActive: false }), ['Task.Reopen']);
    await open();
    expect(option('REOPEN').getAttribute('aria-disabled')).toBe('true');
    expect(el().textContent).toContain('Matter is inactive');
    await pick('REOPEN');
    expect(el().querySelector('mf-inline-status-flow')).toBeNull();
  });

  it('Escape closes the menu and returns focus to the trigger; opening is keyboard operable', async () => {
    await create('priority', aRow());
    trigger().focus();
    trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');

    option('1').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el().querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('does not let clicks and keys inside the control reach the row', async () => {
    await create('priority', aRow());
    const reached = vi.fn();
    document.body.addEventListener('click', reached);
    document.body.addEventListener('keydown', reached);
    document.body.appendChild(el());
    await open();
    option('1').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(reached).not.toHaveBeenCalled();
    document.body.removeEventListener('click', reached);
    document.body.removeEventListener('keydown', reached);
  });

  describe('Complete and the step inputs (A6)', () => {
    beforeEach(() => (stubFlow = true));
    afterEach(() => (stubFlow = false));
    const permissions: Permission[] = ['Task.ChangeStatus', 'Task.Complete', 'Task.Cancel'];
    const blockedCheck = {
      isReady: false,
      canBulkComplete: false,
      unresolved: [{ stepInstanceId: 71, sequenceNo: 1, title: 'Intake' }],
      bulkCompletable: [],
      blocked: [{ stepInstanceId: 71, sequenceNo: 1, title: 'Intake' }],
      workflowRowVersion: 'W1',
    };

    it('checks once per menu open and shows a spinner (and a polite note) while it runs', async () => {
      await create('status', aRow({ status: 'IN_PROGRESS' }), permissions);
      tasks['getTaskCompletionCheck'].mockReturnValue(NEVER);
      await open();
      expect(tasks['getTaskCompletionCheck']).toHaveBeenCalledTimes(1);
      expect(tasks['getTaskCompletionCheck']).toHaveBeenCalledWith(1042);
      expect(option('COMPLETE').querySelector('[data-option-pending]')).not.toBeNull();
      expect(option('COMPLETE').getAttribute('aria-disabled')).toBeNull();
      expect(el().querySelector('[data-menu-checking]')?.getAttribute('role')).toBe('status');
    });

    it('a task with missing step inputs reads "Complete... (needs step inputs)" and opens the task at that step', async () => {
      await create('status', aRow({ status: 'IN_PROGRESS' }), permissions);
      tasks['getTaskCompletionCheck'].mockReturnValue(of(blockedCheck));
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      await open();
      expect(option('COMPLETE').textContent).toContain('Complete... (needs step inputs)');
      await pick('COMPLETE');
      expect(navigate).toHaveBeenCalledWith(['/tasks', 1042], {
        queryParams: { tab: 'workflow', step: 71 },
      });
      expect(el().querySelector('mf-inline-status-flow')).toBeNull();
    });

    it('a ready task keeps the plain Complete item and opens the confirmation', async () => {
      await create('status', aRow({ status: 'IN_PROGRESS' }), permissions);
      await open();
      expect(option('COMPLETE').textContent).toContain('Complete');
      expect(option('COMPLETE').textContent).not.toContain('needs step inputs');
      await pick('COMPLETE');
      expect(el().querySelector('mf-inline-status-flow')).not.toBeNull();
    });

    it('a failed check behaves as before: Complete opens the confirmation, which checks again', async () => {
      await create('status', aRow({ status: 'IN_PROGRESS' }), permissions);
      tasks['getTaskCompletionCheck'].mockReturnValue(throwError(() => new Error('offline')));
      await open();
      expect(option('COMPLETE').textContent).not.toContain('needs step inputs');
      expect(option('COMPLETE').querySelector('[data-option-pending]')).toBeNull();
      await pick('COMPLETE');
      expect(el().querySelector('mf-inline-status-flow')).not.toBeNull();
    });

    it('does not check when the person cannot complete, or for Cancel and Hold', async () => {
      await create('status', aRow({ status: 'IN_PROGRESS' }), ['Task.ChangeStatus']);
      await open();
      expect(tasks['getTaskCompletionCheck']).not.toHaveBeenCalled();
    });
  });
});
