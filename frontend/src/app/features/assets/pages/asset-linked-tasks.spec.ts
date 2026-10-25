import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AssetTaskLink, AssetsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import {
  FakeMeApi,
  apiError,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { provideLookups } from '../../../shared/work-queue/work-queue-testing';
import { AssetLinkedTasks, LinkedTaskTotals } from './asset-linked-tasks';

function link(over: Partial<AssetTaskLink>): AssetTaskLink {
  return {
    taskId: 1042,
    taskNumber: 'TSK-1042',
    title: 'Process Smith custodians',
    statusCode: 'IN_PROGRESS',
    assetLinkRoleId: 2,
    assetLinkRoleName: 'Source',
    linkedAtUtc: '2026-10-01T12:00:00Z',
    dueDate: '2099-03-04',
    isOpen: true,
    isOverdue: false,
    isAsap: false,
    assigneeUserId: 5,
    assigneeName: 'Ada Lovelace',
    ...over,
  };
}

const LATE = link({
  taskId: 1,
  taskNumber: 'TSK-1',
  title: 'Late one',
  dueDate: '2020-01-02',
  isOverdue: true,
});
const SOON = link({ taskId: 2, taskNumber: 'TSK-2', title: 'Soon one', dueDate: '2099-01-02' });
const NONE = link({
  taskId: 3,
  taskNumber: 'TSK-3',
  title: 'No date',
  dueDate: undefined,
  isAsap: true,
  statusCode: 'ON_HOLD',
  assigneeName: undefined,
  assigneeUserId: undefined,
  assetLinkRoleName: undefined,
});
const DONE = link({
  taskId: 4,
  taskNumber: 'TSK-4',
  title: 'Finished',
  statusCode: 'COMPLETED',
  isOpen: false,
  dueDate: '2020-02-02',
});

describe('AssetLinkedTasks', () => {
  let api: { listAssetLinkedTasks: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<AssetLinkedTasks>;
  let totals: LinkedTaskTotals | null;
  const el = (): HTMLElement => fixture.nativeElement;
  const titles = (): string[] =>
    Array.from(el().querySelectorAll('tbody td.mf-cell-name a')).map((a) => a.textContent!.trim());

  async function create(permissions: Permission[], items = [SOON, NONE, LATE, DONE]) {
    api = { listAssetLinkedTasks: vi.fn().mockReturnValue(ok({ items })) };
    totals = null;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: AssetsClient, useValue: api },
        ...provideLookups(),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(AssetLinkedTasks);
    fixture.componentRef.setInput('assetId', 9);
    fixture.componentInstance.loaded.subscribe((t) => (totals = t));
    await settle(fixture);
  }

  it('lists the tasks on the shared cells: ref, the title as the one link, status, due, assignee and role', async () => {
    await create(['Asset.View', 'Task.View']);
    const row = el().querySelector('tbody tr[data-task="TSK-2"]')!;
    expect(row.querySelector('td')?.textContent).toBe('TSK-2');
    expect(row.querySelectorAll('a')).toHaveLength(1);
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/tasks/2');
    expect(row.querySelector('[data-status]')?.getAttribute('data-status')).toBe('IN_PROGRESS');
    expect(row.querySelector('mf-due-cell')).not.toBeNull();
    expect(row.querySelector('[data-assignee]')?.textContent).toContain('Ada Lovelace');
    expect(row.textContent).toContain('Source');
    expect(el().querySelector('tr[data-task="TSK-3"] [data-assignee]')?.textContent).toContain(
      'Unassigned',
    );
    expect(api.listAssetLinkedTasks).toHaveBeenCalledWith(9);
  });

  it('is sorted by due date, no due date last, and sorts by Due and Status', async () => {
    await create(['Asset.View', 'Task.View']);
    // The API order is kept as given for equal keys; the due sort puts the earliest first and ASAP last.
    expect(titles()).toEqual(['Late one', 'Finished', 'Soon one', 'No date']);
    const header = (t: string) =>
      Array.from(el().querySelectorAll<HTMLElement>('thead th')).find((h) =>
        h.textContent?.includes(t),
      )!;
    expect(header('Due').getAttribute('aria-sort')).toBe('ascending');
    header('Due').querySelector('button')!.click();
    await settle(fixture);
    expect(titles()).toEqual(['No date', 'Soon one', 'Finished', 'Late one']);
    header('Status').querySelector('button')!.click();
    await settle(fixture);
    expect(titles()).toEqual(['Late one', 'Soon one', 'No date', 'Finished']);
    expect(header('Status').getAttribute('aria-sort')).toBe('ascending');
  });

  it('says how many are linked, open and overdue, and reports the totals', async () => {
    await create(['Asset.View', 'Task.View']);
    expect(el().querySelector('[data-linked-summary]')?.textContent?.replace(/\s+/g, ' ')).toBe(
      ' 4 linked - 3 open - 1 overdue',
    );
    expect(totals).toEqual({ total: 4, open: 3, overdue: 1 });
  });

  it('shows the empty, error (with Retry) and no-permission states', async () => {
    await create(['Asset.View', 'Task.View'], []);
    expect(el().querySelector('[data-empty="linked-tasks"]')).not.toBeNull();

    TestBed.resetTestingModule();
    await create(['Asset.View', 'Task.View']);
    api.listAssetLinkedTasks.mockReturnValue(apiError(500, { title: 'x' } as never));
    await fixture.componentInstance.load();
    await settle(fixture);
    expect(el().querySelector('[data-error]')).not.toBeNull();
    api.listAssetLinkedTasks.mockReturnValue(ok({ items: [SOON] }));
    (el().querySelector('[data-error] button') as HTMLElement).click();
    await settle(fixture);
    expect(el().querySelector('[data-error]')).toBeNull();
    expect(titles()).toEqual(['Soon one']);

    TestBed.resetTestingModule();
    await create(['Asset.View']);
    expect(el().querySelector('[data-no-access="linked-tasks"]')?.textContent).toContain(
      "You don't have permission to view tasks.",
    );
    expect(api.listAssetLinkedTasks).not.toHaveBeenCalled();
    expect(totals).toBeNull();
  });
});
