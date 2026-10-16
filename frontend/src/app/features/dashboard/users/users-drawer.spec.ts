import { TaskQueueRow } from '../../../api/generated/api-client';
import { drawerOrder } from './users-drawer';

const NOW = new Date('2026-10-14T12:00:00Z');

function row(id: number, sortOrder: number, dueDate?: string, extra: Partial<TaskQueueRow> = {}) {
  return {
    taskId: id,
    taskNumber: `TSK-${id}`,
    status: 'IN_PROGRESS',
    priority: { priorityId: sortOrder, label: 'P', color: 'normal', sortOrder },
    dueDate,
    isAsap: false,
    ...extra,
  } as TaskQueueRow;
}

describe('drawerOrder', () => {
  it('lists overdue first, then priority, then the earliest due date, ties in server order', () => {
    const rows = [
      row(1, 1, '2026-10-20'),
      row(2, 3, '2026-10-01'),
      row(3, 2, '2026-10-02'),
      row(4, 1, undefined),
      row(5, 1, '2026-10-16'),
    ];
    expect(drawerOrder(rows, NOW, 'UTC').map((r) => r.taskId)).toEqual([3, 2, 5, 1, 4]);
  });

  it('keeps the input untouched', () => {
    const rows = [row(1, 2, '2026-10-20'), row(2, 1, '2026-10-01')];
    drawerOrder(rows, NOW, 'UTC');
    expect(rows.map((r) => r.taskId)).toEqual([1, 2]);
  });
});
