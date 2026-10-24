import { RowActionSpec, RowActionsMenu, rowActions } from '../ui/row-actions';

/** The matter a row or a page stands for. */
export interface MatterActionTarget {
  matterId: number;
  matterRef: string;
  name: string;
  isActive: boolean;
}

/** What each quick action does; the page decides (it owns the router and the comment dialog). */
export interface MatterActionRuns {
  newTask: () => void;
  bulk: () => void;
  addComment: () => void;
  openTasks: () => void;
}

/**
 * The quick actions of one matter (epic #758, PX-25; README 7), as data for the shared row menu (`rowActions`): + New task, Bulk re-assign /
 * re-prioritise (the matter's Tasks tab in selection mode), Add comment (pick one of the matter's open tasks, then write) and Open the matter's
 * tasks (the Task Queue filtered to the matter). An action the person may not use is absent, not greyed; a New task on an inactive matter is
 * absent too (the server would refuse it). `omit` leaves out the actions a page already has as a button of its own.
 */
export function matterActionMenu(
  target: MatterActionTarget,
  can: (permission: string) => boolean,
  run: MatterActionRuns,
  omit: readonly ('newTask' | 'bulk' | 'addComment' | 'openTasks')[] = [],
): RowActionsMenu {
  const label = `${target.matterRef} ${target.name}`;
  const specs: RowActionSpec[] = [];
  const add = (key: (typeof omit)[number], spec: RowActionSpec, allowed: boolean) => {
    if (allowed && !omit.includes(key)) specs.push(spec);
  };
  const tasks = can('Task.View');
  add(
    'newTask',
    { id: 'new-task', label: '+ New task', icon: 'pi-plus', run: run.newTask },
    can('Task.Create') && target.isActive,
  );
  add(
    'bulk',
    {
      id: 'bulk-tasks',
      label: 'Bulk re-assign / re-prioritise',
      icon: 'pi-check-square',
      run: run.bulk,
    },
    tasks && (can('Task.Assign') || can('Task.SetPriority')),
  );
  add(
    'addComment',
    { id: 'add-comment', label: 'Add comment', icon: 'pi-comment', run: run.addComment },
    tasks && can('Task.Comment'),
  );
  add(
    'openTasks',
    { id: 'open-tasks', label: "Open the matter's tasks", icon: 'pi-list', run: run.openTasks },
    tasks,
  );
  const menu = rowActions(label, specs, { can });
  return { ...menu, label: `More actions for ${label}` };
}
