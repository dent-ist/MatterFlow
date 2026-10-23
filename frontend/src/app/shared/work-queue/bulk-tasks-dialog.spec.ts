import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  BulkTasksResponse,
  MatterBulkTasksClient,
  PodsClient,
  UsersLookupClient,
} from '../../api/generated/api-client';
import { FakeMeApi, profileOf, provideFakeMe } from '../../core/auth/auth-testing';
import { LookupStore } from '../../core/lookups/lookup-store';
import {
  BULK_MAX,
  BulkMode,
  BulkTarget,
  BulkTasksDialog,
  bulkReason,
  bulkWarning,
} from './bulk-tasks-dialog';

const targets: BulkTarget[] = [
  { taskId: 1, taskNumber: 'TSK-1', title: 'First' },
  { taskId: 2, taskNumber: 'TSK-2', title: 'Second' },
  { taskId: 3, taskNumber: 'TSK-3', title: 'Third' },
];

@Component({
  imports: [BulkTasksDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-bulk-tasks-dialog
    [mode]="mode()"
    [matterId]="9"
    [targets]="targets"
    [(visible)]="open"
    (finished)="done.push($event)"
  />`,
})
class Host {
  readonly mode = signal<BulkMode>('assign');
  readonly open = signal(true);
  readonly targets = targets;
  readonly done: BulkTasksResponse[] = [];
}

const dialog = () => document.body.querySelector<HTMLElement>('[data-bulk-dialog]')!;
const primary = () =>
  document.body.querySelector<HTMLButtonElement>(
    '[data-confirm-primary] button, button[data-confirm-primary]',
  )!;

describe('BulkTasksDialog', () => {
  let bulk: { bulkChangeMatterTasks: ReturnType<typeof vi.fn> };

  async function open(mode: BulkMode, answer?: BulkTasksResponse) {
    bulk = {
      bulkChangeMatterTasks: vi.fn().mockReturnValue(
        of(
          answer ?? {
            correlationId: 'c',
            changed: 3,
            failed: 0,
            results: targets.map((t) => ({ taskId: t.taskId, ok: true, warnings: [] })),
          },
        ),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(
          new FakeMeApi(
            profileOf({ permissions: ['Task.View', 'Task.Assign', 'Task.SetPriority'] }),
          ),
        ),
        { provide: MatterBulkTasksClient, useValue: bulk },
        { provide: UsersLookupClient, useValue: { lookupUsers: vi.fn().mockReturnValue(of([])) } },
        {
          provide: PodsClient,
          useValue: {
            listPods: vi.fn().mockReturnValue(
              of({
                items: [
                  {
                    podId: 4,
                    name: 'Review Pod',
                    isActive: true,
                    memberCount: 3,
                    rowVersion: 'x',
                  },
                ],
              }),
            ),
          },
        },
        {
          provide: LookupStore,
          useValue: {
            ensureLoaded: () => Promise.resolve(),
            activePriorities: () => [
              { id: 7, label: 'High' },
              { id: 8, label: 'Low' },
            ],
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.mode.set(mode);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('states the count and that there is no undo in one step', async () => {
    await open('assign');
    expect(dialog().querySelector('[data-bulk-count]')!.textContent).toContain('3 tasks selected');
    expect(dialog().querySelector('[data-bulk-undo]')!.textContent).toContain(
      'This can’t be undone in one step.',
    );
    expect(document.body.querySelector('.p-dialog-title, .p-dialog-header')!.textContent).toContain(
      'Re-assign tasks',
    );
  });

  it('asks for a person or a pod before it changes anything', async () => {
    const fixture = await open('assign');
    primary().click();
    fixture.detectChanges();
    expect(bulk.bulkChangeMatterTasks).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-confirm-error]')!.textContent).toContain(
      'Choose a person or a pod.',
    );
  });

  it('moves the tasks to a pod alone: the pod, no person', async () => {
    const fixture = await open('assign');
    const pod = dialog().querySelector<HTMLSelectElement>('[data-bulk-pod]')!;
    pod.value = '4';
    pod.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    primary().click();
    await fixture.whenStable();
    expect(bulk.bulkChangeMatterTasks).toHaveBeenCalledWith(9, {
      taskIds: [1, 2, 3],
      reassignTo: { userId: undefined, podId: 4 },
    });
  });

  it('sets the priority of the selected tasks', async () => {
    const fixture = await open('priority');
    const select = dialog().querySelector<HTMLSelectElement>('[data-bulk-priority]')!;
    select.value = '7';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    primary().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(bulk.bulkChangeMatterTasks).toHaveBeenCalledWith(9, {
      taskIds: [1, 2, 3],
      priorityId: 7,
    });
    expect(fixture.componentInstance.done).toHaveLength(1);
    expect(dialog().querySelector('[data-bulk-summary]')!.textContent).toContain(
      '3 tasks changed.',
    );
  });

  it('lists the tasks that could not be changed with the reason, and the warnings of the others', async () => {
    const answer: BulkTasksResponse = {
      correlationId: 'c',
      changed: 2,
      failed: 1,
      results: [
        { taskId: 1, ok: true, warnings: ['USER_NOT_IN_POD'], code: undefined, message: undefined },
        { taskId: 2, ok: false, code: 'TASK_NOT_EDITABLE', message: undefined, warnings: [] },
        { taskId: 3, ok: true, warnings: [], code: undefined, message: undefined },
      ],
    };
    const fixture = await open('priority', answer);
    const select = dialog().querySelector<HTMLSelectElement>('[data-bulk-priority]')!;
    select.value = '8';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    primary().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(dialog().querySelector('[data-bulk-summary]')!.textContent).toContain(
      '2 changed, 1 could not be changed.',
    );
    expect(dialog().querySelector('[data-bulk-failed-row]')!.textContent).toContain(
      'TSK-2 Second: it is completed or cancelled',
    );
    expect(dialog().querySelector('[data-bulk-warned-row]')!.textContent).toContain(
      'TSK-1 First: the person is not a member of the task’s pod',
    );
  });

  it('knows the limit of one call and every failure code', () => {
    expect(BULK_MAX).toBe(100);
    const r = (code: string | undefined, message?: string) => ({
      taskId: 1,
      ok: false,
      code,
      message,
      warnings: [],
    });
    expect(bulkReason(r('NOT_FOUND'))).toBe('it no longer exists');
    expect(bulkReason(r('CONCURRENCY_CONFLICT'))).toContain('somebody else changed it');
    expect(bulkReason(r('OTHER', 'The server said no'))).toBe('The server said no');
    expect(bulkWarning('USER_NOT_IN_POD')).toContain('not a member');
  });
});
