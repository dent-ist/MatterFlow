import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { TaskWorkflowClient, TasksClient, TaskQueueRow } from '../../api/generated/api-client';
import { apiError } from '../../core/lookups/lookups-testing';
import { TaskDetailStore } from '../../features/tasks/detail/task-detail.store';
import { InlineStatusFlow } from './inline-status-flow';
import { StatusAction } from './inline-edit';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { aRow } from './work-queue-testing';

const fullTask = (patch: Record<string, unknown> = {}) => ({
  taskId: 1042,
  taskNumber: 'TSK-1042',
  status: 'IN_PROGRESS',
  statusLabel: 'In Progress',
  priority: { priorityId: 1, label: 'Critical', color: 'critical', sortOrder: 1 },
  isAsap: true,
  isOverdue: false,
  statusChangedAtUtc: '2026-10-01T12:00:00Z',
  rowVersion: 'SERVER-LOADED',
  allowedActions: { canExecuteSteps: true },
  warnings: [],
  ...patch,
});

describe('InlineStatusFlow', () => {
  let fixture: ComponentFixture<InlineStatusFlow>;
  let tasks: Record<string, ReturnType<typeof vi.fn>>;
  let rows: TaskQueueRow[];
  let conflicts: number;
  let finished: number;

  async function create(action: StatusAction) {
    tasks = {
      getTask: vi.fn(() => of(fullTask())),
      cancelTask: vi.fn(() =>
        of(fullTask({ status: 'CANCELLED', statusLabel: 'Cancelled', rowVersion: 'AFTER' })),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions())),
        { provide: TasksClient, useValue: tasks },
        { provide: TaskWorkflowClient, useValue: {} },
      ],
    });
    fixture = TestBed.createComponent(InlineStatusFlow);
    fixture.componentRef.setInput('row', aRow());
    fixture.componentRef.setInput('action', action);
    rows = [];
    conflicts = 0;
    finished = 0;
    fixture.componentInstance.rowChange.subscribe((r) => rows.push(r));
    fixture.componentInstance.conflict.subscribe(() => conflicts++);
    fixture.componentInstance.finished.subscribe(() => finished++);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.debugElement.injector.get(TaskDetailStore);
  }

  it('opens the shared Cancel dialog and cancels with the rowVersion of the row on screen', async () => {
    const store = await create('CANCEL');
    expect(store.dialog()).toEqual({ kind: 'reason', action: 'CANCEL' });
    expect(finished).toBe(0);

    await store.submitReason('CANCEL', 'Wrong matter');
    await fixture.whenStable();
    expect(tasks['cancelTask']).toHaveBeenCalledWith(1042, {
      rowVersion: 'AAAA',
      comment: 'Wrong matter',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('CANCELLED');
    expect(rows[0].rowVersion).toBe('AFTER');
    expect(finished).toBe(1);
  });

  it('finishes without a change when the dialog is dismissed', async () => {
    const store = await create('HOLD');
    expect(store.dialog()).toEqual({ kind: 'reason', action: 'HOLD' });
    store.closeDialog();
    await fixture.whenStable();
    expect(rows).toEqual([]);
    expect(finished).toBe(1);
  });

  it('reports a rowVersion conflict', async () => {
    const store = await create('CANCEL');
    tasks['cancelTask'].mockReturnValue(
      throwError(() => apiError(409, 'CONCURRENCY_CONFLICT', 'changed')),
    );
    await store.submitReason('CANCEL', 'Because');
    await fixture.whenStable();
    expect(conflicts).toBe(1);
    expect(rows).toEqual([]);
    expect(finished).toBe(1);
  });
});
