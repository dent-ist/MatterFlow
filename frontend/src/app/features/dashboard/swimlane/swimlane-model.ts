import { ParamMap } from '@angular/router';
import {
  QueuePriority,
  SwimlaneBoard,
  SwimlaneCard,
  SwimlaneGroup,
  SwimlaneLane,
  SwimlaneLaneCounts,
  TaskQueueRow,
} from '../../../api/generated/api-client';
import { calendarDayInZone, dayIndex } from '../../../core/time/time';

// ---- the view (what the toolbar chooses)

export const GROUP_BYS = ['none', 'priority', 'assignee', 'clientMatter'] as const;
export type GroupBy = (typeof GROUP_BYS)[number];
export const SORTS = ['priority', 'due', 'clientMatter', 'created'] as const;
export type SortKey = (typeof SORTS)[number];
export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];
export const COMPLETED_WINDOWS = [7, 14, 30] as const;
export const DEFAULT_COMPLETED_DAYS = 7;

export const GROUP_LABELS: Record<GroupBy, string> = {
  none: 'None',
  priority: 'Priority',
  assignee: 'Assignee',
  clientMatter: 'Client / matter',
};
export const SORT_LABELS: Record<SortKey, string> = {
  priority: 'Priority',
  due: 'Due date',
  clientMatter: 'Client / matter',
  created: 'Created',
};

/** Everything the toolbar chooses. The data filters and the three display choices below them live in the address (`?tab=swimlane&group=...`). */
export interface SwimlaneView {
  groupBy: GroupBy;
  sort: SortKey;
  days: number;
  q: string;
  /** A user id as text, or `unassigned`. */
  assignee: string | null;
  type: number | null;
  priority: number | null;
  overdue: boolean;
  mine: boolean;
}

export const DEFAULT_VIEW: SwimlaneView = {
  groupBy: 'none',
  sort: 'priority',
  days: DEFAULT_COMPLETED_DAYS,
  q: '',
  assignee: null,
  type: null,
  priority: null,
  overdue: false,
  mine: false,
};

export function isGroupBy(v: unknown): v is GroupBy {
  return typeof v === 'string' && (GROUP_BYS as readonly string[]).includes(v);
}
export function isSortKey(v: unknown): v is SortKey {
  return typeof v === 'string' && (SORTS as readonly string[]).includes(v);
}
export function isDensity(v: unknown): v is Density {
  return typeof v === 'string' && (DENSITIES as readonly string[]).includes(v);
}
export function isCompletedDays(v: unknown): v is number {
  return typeof v === 'number' && (COMPLETED_WINDOWS as readonly number[]).includes(v);
}

/**
 * The query parameters this tab owns; they are removed from the address when another tab is shown. */
export const VIEW_PARAMS = [
  'group',
  'sort',
  'days',
  'q',
  'assignee',
  'type',
  'priority',
  'overdue',
  'mine',
] as const;

function positiveInt(text: string | null): number | null {
  if (text === null || !/^\d{1,9}$/.test(text)) return null;
  const n = Number(text);
  return n > 0 ? n : null;
}

/** True when the address carries at least one of this tab's parameters. */
export function hasViewParams(params: ParamMap): boolean {
  return VIEW_PARAMS.some((k) => params.has(k));
}

/**
 * The view named by the address. A parameter that is missing or invalid falls back to `fallback` for the three display choices
 * (the remembered ones) and to "not set" for the data filters.
 */
export function viewFromParams(
  params: ParamMap,
  fallback: Pick<SwimlaneView, 'groupBy' | 'sort' | 'days'>,
): SwimlaneView {
  const group = params.get('group');
  const sort = params.get('sort');
  const days = Number(params.get('days'));
  const assignee = params.get('assignee');
  return {
    groupBy: isGroupBy(group) ? group : fallback.groupBy,
    sort: isSortKey(sort) ? sort : fallback.sort,
    days: isCompletedDays(days) ? days : fallback.days,
    q: (params.get('q') ?? '').trim(),
    assignee: assignee === 'unassigned' || positiveInt(assignee) !== null ? assignee : null,
    type: positiveInt(params.get('type')),
    priority: positiveInt(params.get('priority')),
    overdue: params.get('overdue') === 'true',
    mine: params.get('mine') === 'true',
  };
}

/** Router query parameters for a view; unset filters are `null` so `merge` removes them. */
export function viewToParams(view: SwimlaneView): Record<string, string | null> {
  return {
    group: view.groupBy,
    sort: view.sort,
    days: String(view.days),
    q: view.q || null,
    assignee: view.assignee,
    type: view.type === null ? null : String(view.type),
    priority: view.priority === null ? null : String(view.priority),
    overdue: view.overdue ? 'true' : null,
    mine: view.mine ? 'true' : null,
  };
}

/** Parameters that clear every swimlane parameter (used when another tab is chosen). */
export function clearedViewParams(): Record<string, null> {
  return Object.fromEntries(VIEW_PARAMS.map((k) => [k, null]));
}

export function sameView(a: SwimlaneView, b: SwimlaneView): boolean {
  return (Object.keys(a) as (keyof SwimlaneView)[]).every((k) => a[k] === b[k]);
}

/** How many data filters are on (the number on the Filters button). "Only mine" has its own toggle and is not counted here. */
export function filterCount(view: SwimlaneView): number {
  return (
    (view.assignee !== null ? 1 : 0) +
    (view.type !== null ? 1 : 0) +
    (view.priority !== null ? 1 : 0) +
    (view.overdue ? 1 : 0)
  );
}

// ---- lanes

export const LANE_CODES = ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED'] as const;
export type LaneCode = (typeof LANE_CODES)[number];

/** The lane a status belongs to: Cancelled sits with Completed. */
export function laneOf(status: string): LaneCode {
  return status === 'COMPLETED' || status === 'CANCELLED'
    ? 'COMPLETED'
    : (status as Exclude<LaneCode, 'COMPLETED'>);
}

export function laneCount(counts: SwimlaneLaneCounts, lane: LaneCode): number {
  switch (lane) {
    case 'NEW':
      return counts.new;
    case 'IN_PROGRESS':
      return counts.inProgress;
    case 'ON_HOLD':
      return counts.onHold;
    default:
      return counts.completed;
  }
}

export const LANE_HINTS: Record<LaneCode, string> = {
  NEW: 'Waiting to be started',
  IN_PROGRESS: 'Being worked on',
  ON_HOLD: 'Waiting on something',
  COMPLETED: 'Completed or cancelled',
};

/** One row of a lane that is not a card: a group header (priority, assignee) or a node of the client > matter tree. */
export interface GroupNode {
  /** Unique within the board: the API group key (`client:12`, `matter:7`, `priority:3`, `assignee:unassigned`). */
  key: string;
  kind: 'priority' | 'assignee' | 'client' | 'matter';
  level: 1 | 2;
  label: string;
  /** Exact number of tasks in this lane, from the API (more than `loaded` when the lane is capped). */
  count: number;
  color: string | null;
  clientNumber: string | null;
  matterRef: string | null;
  /** The assignee of an assignee group, for the availability chip. */
  assignee: SwimlaneCard['assignee'];
}

/** A lane laid out for rendering: rows in display order, each a group header or a card. */
export type LaneRow =
  | { type: 'group'; node: GroupNode; expanded: boolean; hasChildren: boolean }
  | { type: 'card'; card: SwimlaneCard; level: 0 | 1 | 2 | 3 };

export interface LaneModel {
  code: LaneCode;
  label: string;
  /** Exact number of tasks in the lane. */
  count: number;
  truncated: boolean;
  loaded: number;
  rows: LaneRow[];
  /** Whole days since the oldest loaded card was created, or null when the lane is empty. */
  oldestDays: number | null;
}

/** Whole calendar days between `createdAtUtc` and today in the viewer's zone. */
export function ageInDays(createdAtUtc: string, now: Date, zone: string): number {
  return Math.max(
    0,
    dayIndex(calendarDayInZone(now, zone)) - dayIndex(calendarDayInZone(createdAtUtc, zone)),
  );
}

function cardGroupKey(card: SwimlaneCard, by: GroupBy): string | null {
  switch (by) {
    case 'priority':
      return `priority:${card.priority.priorityId}`;
    case 'assignee':
      return `assignee:${card.assignee ? card.assignee.userId : 'unassigned'}`;
    default:
      return null;
  }
}

/**
 * Builds one lane for display. Without grouping the rows are the cards in the server's order. Priority and assignee groups come in the
 * order the API gives them (rank, name), each followed by its cards. The client > matter tree lists a client (level 1), then its matters
 * (level 2), then the cards of each matter (level 3); a collapsed node hides everything below it. A group only appears in a lane that has
 * a card of it. `collapsed` holds the keys of collapsed groups (shared by all lanes).
 */
export function buildLane(
  lane: SwimlaneLane,
  groupBy: GroupBy,
  groups: readonly SwimlaneGroup[],
  collapsed: ReadonlySet<string>,
  now: Date,
  zone: string,
): LaneModel {
  const code = lane.status as LaneCode;
  const cards = lane.cards;
  const rows: LaneRow[] = [];
  const oldest = cards.reduce<string | null>(
    (min, c) => (min === null || c.createdAtUtc < min ? c.createdAtUtc : min),
    null,
  );

  if (groupBy === 'none') {
    for (const card of cards) rows.push({ type: 'card', card, level: 0 });
  } else if (groupBy === 'clientMatter') {
    const byMatter = new Map<number, SwimlaneCard[]>();
    for (const card of cards) {
      const list = byMatter.get(card.matterId);
      if (list) list.push(card);
      else byMatter.set(card.matterId, [card]);
    }
    for (const client of groups) {
      const matters = client.children.filter((m) => byMatter.has(m.id ?? -1));
      if (matters.length === 0) continue;
      const open = !collapsed.has(client.key);
      rows.push({
        type: 'group',
        node: toNode(client, 1, code),
        expanded: open,
        hasChildren: true,
      });
      if (!open) continue;
      for (const matter of matters) {
        const matterOpen = !collapsed.has(matter.key);
        rows.push({
          type: 'group',
          node: toNode(matter, 2, code),
          expanded: matterOpen,
          hasChildren: true,
        });
        if (!matterOpen) continue;
        for (const card of byMatter.get(matter.id ?? -1) ?? []) {
          rows.push({ type: 'card', card, level: 3 });
        }
      }
    }
  } else {
    const byKey = new Map<string, SwimlaneCard[]>();
    for (const card of cards) {
      const key = cardGroupKey(card, groupBy) as string;
      const list = byKey.get(key);
      if (list) list.push(card);
      else byKey.set(key, [card]);
    }
    for (const group of groups) {
      const inLane = byKey.get(group.key);
      if (!inLane) continue;
      const open = !collapsed.has(group.key);
      rows.push({
        type: 'group',
        node: toNode(group, 1, code, inLane[0]?.assignee),
        expanded: open,
        hasChildren: true,
      });
      if (open) for (const card of inLane) rows.push({ type: 'card', card, level: 1 });
    }
  }

  return {
    code,
    label: lane.label,
    count: lane.count,
    truncated: lane.truncated,
    loaded: cards.length,
    rows,
    oldestDays: oldest === null ? null : ageInDays(oldest, now, zone),
  };
}

function toNode(
  group: SwimlaneGroup,
  level: 1 | 2,
  lane: LaneCode,
  assignee?: SwimlaneCard['assignee'],
): GroupNode {
  return {
    key: group.key,
    kind: group.kind as GroupNode['kind'],
    level,
    label: group.label,
    count: laneCount(group.counts, lane),
    color: group.color ?? null,
    clientNumber: group.clientNumber ?? null,
    matterRef: group.matterRef ?? null,
    assignee: group.kind === 'assignee' ? assignee : undefined,
  };
}

/** Keys of every group that can be collapsed in the board (all of them, for "Collapse all"). */
export function allGroupKeys(groups: readonly SwimlaneGroup[]): string[] {
  const keys: string[] = [];
  const walk = (list: readonly SwimlaneGroup[]) => {
    for (const g of list) {
      keys.push(g.key);
      walk(g.children);
    }
  };
  walk(groups);
  return keys;
}

// ---- cards <-> task queue rows (the inline menus work on queue rows)

export function cardToRow(card: SwimlaneCard): TaskQueueRow {
  const priority: QueuePriority = {
    priorityId: card.priority.priorityId,
    label: card.priority.label,
    color: card.priority.color,
    sortOrder: card.priority.rank,
  };
  return {
    taskId: card.taskId,
    taskNumber: card.ref,
    title: card.title,
    matterId: card.matterId,
    matterRef: card.matterRef,
    matterName: card.matterName,
    matterIsSensitive: card.matterIsSensitive,
    matterCanOpen: card.matterCanOpen,
    // The board only lists tasks of Matters the viewer can reach; the server re-checks Reopen on an inactive Matter.
    matterIsActive: true,
    clientId: card.clientId,
    clientName: card.clientName,
    projectId: undefined,
    projectName: undefined,
    taskTypeId: card.taskTypeId,
    taskTypeName: card.taskTypeName,
    taskTypeIconKey: card.taskTypeIconKey,
    taskTypeColourKey: undefined,
    onHoldReasonId: undefined,
    onHoldReasonName: undefined,
    atRisk: false,
    workflowDefinitionId: 0,
    workflowName: '',
    priority,
    status: card.status,
    statusLabel: card.statusLabel,
    assignedPod: card.pod,
    assignedUser: card.assignee
      ? {
          userId: card.assignee.userId,
          displayName: card.assignee.displayName,
          isActive: card.assignee.isActive,
        }
      : undefined,
    createdBy: undefined,
    requestorName: '',
    dueDate: card.dueDate,
    dueAtUtc: card.dueAtUtc,
    isAsap: card.isAsap,
    isOverdue: card.isOverdue,
    createdAtUtc: card.createdAtUtc,
    assignedAtUtc: undefined,
    updatedAtUtc: undefined,
    completedAtUtc: card.completedAtUtc,
    statusChangedAtUtc: card.completedAtUtc ?? card.createdAtUtc,
    closedAtUtc: card.completedAtUtc,
    workflow: {
      stepsTotal: card.stepsTotal,
      stepsResolved: card.stepsResolved,
      currentStepNumber: undefined,
      currentStepName: undefined,
    },
    rowVersion: card.rowVersion,
    holdReason: undefined,
    holdReasonTruncated: false,
  };
}

/** Lays the fields an inline edit can change over the card. The assignee's availability is only known for the person the card came with. */
export function applyRow(card: SwimlaneCard, row: TaskQueueRow): SwimlaneCard {
  const user = row.assignedUser;
  const sameUser = !!user && card.assignee?.userId === user.userId;
  return {
    ...card,
    status: row.status,
    statusLabel: row.statusLabel,
    priority: {
      priorityId: row.priority.priorityId,
      label: row.priority.label,
      color: row.priority.color,
      rank: row.priority.sortOrder,
    },
    assignee: user
      ? {
          userId: user.userId,
          displayName: user.displayName,
          isActive: user.isActive,
          availability: sameUser
            ? card.assignee!.availability
            : { state: 'UNKNOWN', outUntil: undefined, note: undefined },
        }
      : undefined,
    pod: row.assignedPod ?? card.pod,
    isAsap: row.isAsap,
    isOverdue: row.isOverdue,
    completedAtUtc: row.completedAtUtc,
    rowVersion: row.rowVersion,
  };
}

/**
 * Puts a changed card into the board. With `move`, a card whose status now belongs to another lane joins that lane (counts follow; the next
 * read puts the server's numbers in); without it the card is replaced where it is (an optimistic edit that may still be rolled back).
 */
export function withCard(board: SwimlaneBoard, card: SwimlaneCard, move = true): SwimlaneBoard {
  const target = move ? laneOf(card.status) : null;
  let from: LaneCode | null = null;
  let index = -1;
  for (const lane of board.lanes) {
    const i = lane.cards.findIndex((c) => c.taskId === card.taskId);
    if (i >= 0) {
      from = lane.status as LaneCode;
      index = i;
    }
  }
  if (from === null) return board;
  if (target === null || from === target) {
    return {
      ...board,
      lanes: board.lanes.map((l) =>
        l.status === from
          ? { ...l, cards: l.cards.map((c) => (c.taskId === card.taskId ? card : c)) }
          : l,
      ),
    } as SwimlaneBoard;
  }
  return {
    ...board,
    lanes: board.lanes.map((l) => {
      if (l.status === from) {
        return {
          ...l,
          cards: l.cards.filter((_, i) => i !== index),
          count: Math.max(0, l.count - 1),
          total: Math.max(0, l.total - 1),
        };
      }
      if (l.status === target) {
        // Newest change first in the lane it joins; the next read sorts it properly.
        return { ...l, cards: [card, ...l.cards], count: l.count + 1, total: l.total + 1 };
      }
      return l;
    }),
  } as SwimlaneBoard;
}

// ---- task queue link for a lane ("Open the Task Queue")

/** Router query parameters of the Task Queue that list the tasks of one lane under the board's filters. */
export function laneQueueParams(
  view: SwimlaneView,
  lane: LaneCode,
  completedFrom: string,
  myUserId: number,
  pods: readonly string[] = [],
): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {
    status: lane === 'COMPLETED' ? ['COMPLETED', 'CANCELLED'] : [lane],
  };
  if (lane === 'COMPLETED') params['completedFrom'] = completedFrom;
  if (view.q) params['q'] = view.q;
  // The page-wide scope (P1): under a Pod scope the lane's link carries the Pods, as the lane's count is about them.
  if (pods.length > 0) params['pod'] = [...pods];
  if (view.mine && myUserId > 0) params['assignee'] = String(myUserId);
  else if (view.assignee === 'unassigned') params['unassigned'] = 'true';
  else if (view.assignee !== null) params['assignee'] = view.assignee;
  if (view.type !== null) params['type'] = String(view.type);
  if (view.priority !== null) params['priority'] = String(view.priority);
  if (view.overdue) params['overdue'] = 'true';
  return params;
}

// ---- the lane switcher (W4, #125): below 900 px one lane at a time

/** Below this width the four lanes are replaced by the lane switcher and one lane. Keep in step with the 900 px rule of the board. */
export const LANE_SWITCHER_QUERY = '(max-width: 899.98px)';
/** The address parameter that names the selected lane; the default lane is left out (P9). */
export const LANE_PARAM = 'lane';
/** The lane shown first: the largest working lane. */
export const DEFAULT_LANE: LaneCode = 'IN_PROGRESS';

const LANE_PARAMS: Record<LaneCode, string> = {
  NEW: 'new',
  IN_PROGRESS: 'progress',
  ON_HOLD: 'hold',
  COMPLETED: 'done',
};

/** The address value of a lane (`new`, `progress`, `hold`, `done`). */
export function laneParam(code: LaneCode): string {
  return LANE_PARAMS[code];
}

/** The lane an address value names, or null when it names none. */
export function laneFromParam(value: string | null): LaneCode | null {
  const found = (Object.entries(LANE_PARAMS) as [LaneCode, string][]).find(([, v]) => v === value);
  return found ? found[0] : null;
}

const LANE_STORAGE_KEY = 'mf.dashboard.swimlane.lane';

/** The lane chosen earlier in this browser session (sessionStorage), or null. Storage may be unavailable: then nothing is remembered. */
export function rememberedLane(): LaneCode | null {
  try {
    return laneFromParam(sessionStorage.getItem(LANE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function rememberLane(code: LaneCode): void {
  try {
    sessionStorage.setItem(LANE_STORAGE_KEY, laneParam(code));
  } catch {
    /* storage unavailable: the choice lasts until the tab is left */
  }
}
