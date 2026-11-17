import type {
  AccessRoleChoice,
  TaskTypeAccessLists,
  TaskTypeAccessPreview,
  TaskTypeAccessRole,
} from './task-types-api';

/**
 * Task Type access (epic #1397, #1402): the three role lists of a task type and the plain words the screens use for them. Pure functions, no Angular,
 * so the page, the list and the specs share one set of rules and one set of sentences (design `docs/ux/task-type-access/README.md`, mockup
 * `docs/ux/mockups/task-type-access/`).
 *
 * Rules the server also applies: a role in Can Edit or Can Be Assigned is also in Can View (so choosing one on an open type restricts it); all three
 * lists empty means open to everyone.
 */
export interface AccessModel {
  canView: number[];
  canEdit: number[];
  canAssign: number[];
}

export const OPEN_ACCESS: AccessModel = { canView: [], canEdit: [], canAssign: [] };

export function accessOf(
  from: Pick<TaskTypeAccessLists, 'canView' | 'canEdit' | 'canAssign'> | undefined | null,
): AccessModel {
  return {
    canView: [...(from?.canView ?? [])],
    canEdit: [...(from?.canEdit ?? [])],
    canAssign: [...(from?.canAssign ?? [])],
  };
}

const asc = (a: number, b: number): number => a - b;

/** The roles that can view: the chosen Can View roles plus every role of Can Edit and Can Be Assigned, each once, in id order. */
export function viewIds(m: AccessModel): number[] {
  return [...new Set([...m.canView, ...m.canEdit, ...m.canAssign])].sort(asc);
}

/** The lists as they are sent and compared: Can View holds the linked roles too, every list sorted and without duplicates. */
export function normalised(m: AccessModel): AccessModel {
  return {
    canView: viewIds(m),
    canEdit: [...new Set(m.canEdit)].sort(asc),
    canAssign: [...new Set(m.canAssign)].sort(asc),
  };
}

export function sameAccess(a: AccessModel, b: AccessModel): boolean {
  return JSON.stringify(normalised(a)) === JSON.stringify(normalised(b));
}

/** The type is restricted when at least one role can view (an empty set of lists is open to everyone). */
export function isRestricted(m: AccessModel): boolean {
  return viewIds(m).length > 0;
}

/** A role that is in Can View only because Can Edit or Can Be Assigned lists it: the chip is linked and cannot be removed there. */
export function isLinked(m: AccessModel, roleId: number): boolean {
  return m.canEdit.includes(roleId) || m.canAssign.includes(roleId);
}

/** Where the linked role comes from, for its tooltip ("Partner is in Can Edit, so it can also view. Remove it from Can Edit first."). */
export function linkedReason(m: AccessModel, roleId: number, name: string): string {
  const lists = [
    ...(m.canEdit.includes(roleId) ? ['Can Edit'] : []),
    ...(m.canAssign.includes(roleId) ? ['Can Be Assigned'] : []),
  ];
  return `${name} is in ${lists.join(' and ')}, so it can also view. Remove it from ${lists.join(' and ')} first.`;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The live summary line under the lists. */
export function summaryOf(m: AccessModel): string {
  const view = viewIds(m);
  if (view.length === 0) return 'Open to everyone.';
  const edit = m.canEdit.length === 0 ? 'all viewers can edit' : `${m.canEdit.length} can edit`;
  const assign =
    m.canAssign.length === 0
      ? 'all viewers can be assigned'
      : `${m.canAssign.length} can be assigned`;
  return `Restricted: ${plural(view.length, 'role', 'roles')} can view, ${edit}, ${assign}.`;
}

/** Chosen roles that are inactive now (the list keeps them; the summary adds a note). */
export function inactiveChosen(m: AccessModel, roles: readonly TaskTypeAccessRole[]): string[] {
  const names = new Map(roles.filter((r) => !r.isActive).map((r) => [r.roleId, r.name]));
  return viewIds(m)
    .filter((id) => names.has(id))
    .map((id) => names.get(id)!);
}

/** True when every role that can view is inactive: nobody but a System Admin can see the type. */
export function allViewRolesInactive(
  m: AccessModel,
  roles: readonly TaskTypeAccessRole[],
): boolean {
  const view = viewIds(m);
  if (view.length === 0) return false;
  const byId = new Map(roles.map((r) => [r.roleId, r]));
  return view.every((id) => byId.get(id)?.isActive === false);
}

/**
 * The roles a list may choose from: every role of `choices` (names, member counts), with the active flag the server reports for the roles already in the lists (a
 * role the lists name that `choices` no longer has is kept, so its chip still reads its name).
 */
export function mergeRoles(
  choices: readonly AccessRoleChoice[],
  named: readonly TaskTypeAccessRole[],
): AccessRoleChoice[] {
  const byId = new Map(named.map((r) => [r.roleId, r]));
  const merged: AccessRoleChoice[] = choices.map((c) => {
    const n = byId.get(c.roleId);
    return n ? { ...c, name: n.name, isActive: n.isActive } : c;
  });
  for (const n of named) if (!choices.some((c) => c.roleId === n.roleId)) merged.push(n);
  return merged.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

// ---- The list column -------------------------------------------------------------------------------------------------------------------

/** What the Access cell of the list shows for one type. `roleNames` is the lookup of role ids to names. */
export interface AccessCell {
  restricted: boolean;
  /** Roles that can view (the number in the chip). */
  count: number;
  /** Every role that can view is inactive: the chip is amber with a triangle. */
  allInactive: boolean;
  /** The tooltip: the three lists, the inactive warning and "not enforced yet" while the switch is off. */
  tip: string;
  /** The spoken name of the chip's button. */
  label: string;
}

export function accessCellOf(
  lists: TaskTypeAccessLists | undefined,
  roles: ReadonlyMap<number, TaskTypeAccessRole>,
  enforced: boolean | null,
  typeName: string,
): AccessCell {
  if (!lists || !lists.isRestricted) {
    return { restricted: false, count: 0, allInactive: false, tip: '', label: '' };
  }
  const name = (id: number): string => roles.get(id)?.name ?? `Role ${id}`;
  const names = (ids: number[]): string => ids.map(name).join(', ');
  const allInactive =
    lists.canView.length > 0 && lists.canView.every((id) => roles.get(id)?.isActive === false);
  const parts = [
    `Can View: ${names(lists.canView)}`,
    `Can Edit: ${lists.canEdit.length ? names(lists.canEdit) : 'no extra limit'}`,
    `Can Be Assigned: ${lists.canAssign.length ? names(lists.canAssign) : 'no extra limit'}`,
  ];
  if (allInactive) {
    parts.push('All Can View roles are inactive, so only System Admin can see this task type.');
  }
  if (enforced === false) parts.push('Saved, but not enforced yet.');
  return {
    restricted: true,
    count: lists.canView.length,
    allInactive,
    tip: parts.join('\n'),
    label: `Restricted, ${plural(lists.canView.length, 'role', 'roles')} can view. Open the access of ${typeName}`,
  };
}

// ---- The confirmation ------------------------------------------------------------------------------------------------------------------

/** One line under the lead sentence of the confirmation: an icon from the icon scale and the words. */
export interface ConfirmLine {
  icon: string;
  text: string;
  /** The line to read twice: the caller loses access. */
  strong?: boolean;
  warn?: boolean;
}

export interface AccessConfirm {
  lead: string;
  lines: ConfirmLine[];
  /** The last, quiet sentence ("You can change the access again at any time."); empty when the caller loses access. */
  closing: string;
  /** The confirm button is the solid red one: the caller loses access and only a System Admin can change it back. */
  danger: boolean;
}

/** Does this save change who sees or edits? Only then the confirmation opens; otherwise the save happens at once. */
export function needsConfirm(p: TaskTypeAccessPreview): boolean {
  return (
    p.peopleLosingView > 0 || p.peopleLosingEdit > 0 || p.becomesOpenToEveryone || p.callerLosesView
  );
}

export const NOT_ENFORCED_LEAD =
  'These rules are saved but not enforced yet, so nobody loses access today.';
export const CLOSING_LINE = 'You can change the access again at any time.';

/**
 * The words of the confirmation, from the preview (the counts are the server's). While the switch is off the lead says so and every fact line
 * starts with "When Task Type Access is switched on", because nobody loses anything yet.
 */
export function confirmOf(
  p: TaskTypeAccessPreview,
  enforced: boolean,
  typeName: string,
  openTasks: number | null | undefined,
): AccessConfirm {
  const people = (n: number): string => plural(n, 'person', 'people');
  const tasks = (n: number): string => plural(n, 'open task', 'open tasks');
  const when = enforced ? '' : 'When Task Type Access is switched on, ';
  const sentence = (text: string): string =>
    when ? `${when}${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
  const lines: ConfirmLine[] = [];
  let lead = '';

  if (p.peopleLosingView > 0) {
    if (enforced) {
      lead = `This will hide the task type from ${people(p.peopleLosingView)}.`;
      lines.push({
        icon: 'pi-eye-slash',
        text: `${tasks(p.openTasksBecomingHidden)} of this type will no longer appear for them in lists, counts, search or notifications.`,
      });
      if (p.openTasksAssignedToPeopleLosingView > 0) {
        lines.push({
          icon: 'pi-exclamation-triangle',
          warn: true,
          text: `${p.openTasksAssignedToPeopleLosingView} of those tasks ${p.openTasksAssignedToPeopleLosingView === 1 ? 'is' : 'are'} assigned to them and stay assigned. Reassign them first if the work must continue.`,
        });
      }
    } else {
      lines.push({
        icon: 'pi-eye-slash',
        text: `${when}this will hide ${typeName} from ${people(p.peopleLosingView)} (${tasks(p.openTasksBecomingHidden)}).`,
      });
    }
  }
  if (p.becomesOpenToEveryone) {
    const its =
      openTasks === null || openTasks === undefined ? 'its open tasks' : `its ${tasks(openTasks)}`;
    if (enforced) {
      lead ||= 'This makes the task type open to everyone.';
      lines.push({
        icon: 'pi-users',
        text: `Everyone who can use tasks will be able to see and use ${typeName} and ${its}. The roles you removed are no longer needed.`,
      });
    } else {
      lines.push({
        icon: 'pi-users',
        text: `${when}this will make ${typeName} open to everyone.`,
      });
    }
  }
  // The server counts the people who lose view among those who lose edit; this line is for the others, who still see the type.
  const editOnly = Math.max(0, p.peopleLosingEdit - p.peopleLosingView);
  if (editOnly > 0) {
    const who = `${editOnly}${p.peopleLosingView > 0 ? ' more' : ''} ${editOnly === 1 ? 'person' : 'people'}`;
    if (enforced) {
      const text = `${who.charAt(0).toUpperCase()}${who.slice(1)} can still view it but no longer change it.`;
      if (lines.length === 0 && !lead) lead = text;
      else lines.push({ icon: 'pi-pencil', text });
    } else {
      lines.push({
        icon: 'pi-pencil',
        text: `${when}${who} will still be able to view ${typeName} but no longer change it.`,
      });
    }
  }
  if (p.callerLosesView) {
    const text = enforced
      ? `You will lose access yourself. You hold none of the chosen roles, so you will no longer see ${typeName}. Only a System Admin can change it back.`
      : `${sentence(`You will lose access yourself. You hold none of the chosen roles, so you will no longer see ${typeName}. Only a System Admin can change it back.`)}`;
    lines.push({ icon: 'pi-lock', text, strong: enforced });
  }
  if (!enforced) lead = NOT_ENFORCED_LEAD;
  if (!lead && lines.length > 0) {
    // Only the "you lose access" line is left: it becomes the lead sentence.
    lead = lines.shift()!.text;
  }
  const danger = enforced && p.callerLosesView;
  return { lead, lines, closing: danger ? '' : CLOSING_LINE, danger };
}
