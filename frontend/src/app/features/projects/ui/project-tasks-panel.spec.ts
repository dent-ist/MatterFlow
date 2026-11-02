import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MatterBulkTasksClient, TaskQueueClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import {
  FakeMeApi,
  aProject,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { aRow, pageOf } from '../../../shared/work-queue/work-queue-testing';
import { ProjectTasksPanel } from './project-tasks-panel';

@Component({
  imports: [ProjectTasksPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-project-tasks-panel
    [matterId]="7"
    matterLabel="00343-00012 Merger Review"
    [project]="project"
    [(visible)]="open"
    (changed)="changes = changes + 1"
  />`,
})
class Host {
  readonly project = aProject({ projectId: 3, name: 'Wave 1' });
  readonly open = signal(true);
  changes = 0;
}

describe('ProjectTasksPanel (MD-05, #1006)', () => {
  let bulk: { setMatterTasksProject: ReturnType<typeof vi.fn> };
  let queue: { getTaskQueue: ReturnType<typeof vi.fn> };
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);

  async function start(permissions: string[]) {
    bulk = {
      setMatterTasksProject: vi
        .fn()
        .mockReturnValue(ok({ correlationId: 'c', changed: 1, failed: 0, results: [] })),
    };
    queue = {
      getTaskQueue: vi.fn().mockImplementation((...args: unknown[]) => {
        // argument 11 is the project filter: the project's own tasks, or (undefined) the matter's open tasks.
        return ok(
          args[11] === 3
            ? pageOf([aRow({ taskId: 1, taskNumber: 'TSK-1', title: 'Linked one', projectId: 3 })])
            : pageOf([
                aRow({ taskId: 1, taskNumber: 'TSK-1', title: 'Linked one', projectId: 3 }),
                aRow({ taskId: 2, taskNumber: 'TSK-2', title: 'Free task', projectId: undefined }),
              ]),
        );
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...(permissions as never[])))),
        { provide: MatterBulkTasksClient, useValue: bulk },
        { provide: TaskQueueClient, useValue: queue },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const f = TestBed.createComponent(Host);
    await settle(f);
    return f;
  }

  it('lists the linked tasks and unlinks one', async () => {
    const f = await start(['Task.View', 'Task.Edit']);
    expect(q('[data-linked-tasks]')!.textContent).toContain('Linked one');
    q('[data-unlink]')!.click();
    await settle(f);
    expect(bulk.setMatterTasksProject).toHaveBeenCalledWith(7, {
      taskIds: [1],
      projectId: undefined,
    });
    expect(f.componentInstance.changes).toBe(1);
  });

  it('adds matter tasks that are not in the project', async () => {
    const f = await start(['Task.View', 'Task.Edit']);
    q('[data-add-task]')!.click();
    await settle(f);
    const names = Array.from(q('[data-candidates]')!.querySelectorAll('li')).map((l) =>
      l.textContent!.trim(),
    );
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('Free task');
    q('[data-candidates] input')!.click();
    await settle(f);
    q('[data-add-confirm]')!.click();
    await settle(f);
    expect(bulk.setMatterTasksProject).toHaveBeenCalledWith(7, { taskIds: [2], projectId: 3 });
  });

  it('offers no Add or Unlink without Task.Edit, and asks for nothing without Task.View', async () => {
    let f = await start(['Task.View']);
    expect(q('[data-add-task]')).toBeNull();
    expect(q('[data-unlink]')).toBeNull();
    TestBed.resetTestingModule();
    f = await start([]);
    expect(q('[data-no-access=tasks]')).not.toBeNull();
    expect(queue.getTaskQueue).not.toHaveBeenCalled();
    expect(f).toBeTruthy();
  });
});
