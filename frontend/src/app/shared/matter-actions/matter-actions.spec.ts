import { matterActionMenu } from './matter-actions';

const target = { matterId: 7, matterRef: '90001-80001', name: 'Merger', isActive: true };
const run = () => ({
  newTask: vi.fn(),
  bulk: vi.fn(),
  addComment: vi.fn(),
  openTasks: vi.fn(),
});
const can =
  (...held: string[]) =>
  (p: string) =>
    held.includes(p);
const ids = (m: ReturnType<typeof matterActionMenu>) => m.items.map((i) => i.id);

describe('matterActionMenu (quick actions per matter, epic #758)', () => {
  it('offers all four actions to a project manager who can create, assign, prioritise and comment', () => {
    const menu = matterActionMenu(
      target,
      can('Task.View', 'Task.Create', 'Task.Assign', 'Task.SetPriority', 'Task.Comment'),
      run(),
    );
    expect(ids(menu)).toEqual(['new-task', 'bulk-tasks', 'add-comment', 'open-tasks']);
    expect(menu.label).toBe('More actions for 90001-80001 Merger');
    expect(menu.items.map((i) => i.label)).toEqual([
      '+ New task',
      'Bulk re-assign / re-prioritise',
      'Add comment',
      "Open the matter's tasks",
    ]);
  });

  it('leaves out what the person may not use, never greying it: absent, not disabled', () => {
    expect(ids(matterActionMenu(target, can('Task.View', 'Task.Create'), run()))).toEqual([
      'new-task',
      'open-tasks',
    ]);
    expect(ids(matterActionMenu(target, can('Task.View', 'Task.SetPriority'), run()))).toEqual([
      'bulk-tasks',
      'open-tasks',
    ]);
    expect(ids(matterActionMenu(target, can('Task.View', 'Task.Comment'), run()))).toEqual([
      'add-comment',
      'open-tasks',
    ]);
    expect(matterActionMenu(target, can('Task.View'), run()).items.every((i) => !i.disabled)).toBe(
      true,
    );
  });

  it("needs Task.View for everything that works on the matter's tasks, and offers no new task on an inactive matter", () => {
    expect(
      ids(matterActionMenu(target, can('Task.Create', 'Task.Assign', 'Task.Comment'), run())),
    ).toEqual(['new-task']);
    expect(matterActionMenu(target, can('Task.Assign', 'Task.Comment'), run()).items).toEqual([]);
    expect(
      ids(matterActionMenu({ ...target, isActive: false }, can('Task.View', 'Task.Create'), run())),
    ).toEqual(['open-tasks']);
  });

  it('omits the actions a page already has as a button, and runs the one that is picked', () => {
    const r = run();
    const menu = matterActionMenu(target, can('Task.View', 'Task.Create', 'Task.Comment'), r, [
      'newTask',
    ]);
    expect(ids(menu)).toEqual(['add-comment', 'open-tasks']);
    menu.items[0].run();
    expect(r.addComment).toHaveBeenCalledOnce();
    expect(r.newTask).not.toHaveBeenCalled();
  });
});
