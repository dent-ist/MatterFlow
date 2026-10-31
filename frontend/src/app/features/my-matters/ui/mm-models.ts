/**
 * The shapes of the My Matters update (epic #953), as written in `docs/ux/ui-update/api-contract.md`. They mirror the OpenAPI schemas of UI-03, UI-04 and UI-05; when the generated
 * client has them, `MmApi` (`mm-api.ts`) maps the generated classes onto these, so the components never see the positional nswag calls.
 */

export interface TreeMatter {
  matterId: number;
  matterRef: string;
  name: string;
  isSensitive: boolean;
  isActive: boolean;
  openTasks: number;
  overdue: number;
  unassigned: number;
  critical: number;
  lastAssetChangeUtc?: string | null;
}

export interface TreeClient {
  clientId: number;
  clientNumber: string;
  name: string;
  matterCount: number;
  activeMatterCount: number;
  openTasks: number;
  overdue: number;
  unassigned: number;
  critical: number;
  matters: TreeMatter[];
}

export interface MatterTree {
  asOfUtc: string;
  activeDays: number;
  clientCount: number;
  matterCount: number;
  clients: TreeClient[];
}

export interface MatterEventType {
  code: string;
  label: string;
  iconKey: string;
  colourKey: string;
  sortOrder: number;
}

export interface MatterEvent {
  eventId: number;
  matterId: number;
  matterRef: string;
  matterName: string;
  clientId: number;
  clientName: string;
  isSensitive: boolean;
  typeCode: string;
  typeLabel: string;
  typeIconKey: string;
  typeColourKey: string;
  title: string;
  /** yyyy-MM-dd, a floating calendar date. */
  date: string;
  /** HH:mm or null for an all-day event. */
  time: string | null;
  note: string | null;
  canEdit: boolean;
  createdAtUtc: string;
  createdByName: string;
  modifiedAtUtc: string | null;
  modifiedByName: string | null;
  rowVersion: string;
}

export interface EventList {
  from: string;
  to: string;
  total: number;
  items: MatterEvent[];
}

export interface EventInput {
  typeCode: string;
  title: string;
  date: string;
  time: string | null;
  note: string | null;
  rowVersion?: string;
}

export type FeedKind =
  'NEW_ASSETS' | 'NEW_COMMENTS' | 'NEW_STATUS_UPDATES' | 'ON_HOLD' | 'OVERDUE' | 'DUE_DATE_UPDATED';

export interface FeedItem {
  itemKey: string;
  kind: FeedKind;
  occurredAtUtc: string;
  isUnread: boolean;
  actorName: string | null;
  matterId: number;
  matterRef: string;
  matterName: string;
  clientId: number;
  clientName: string;
  taskId: number | null;
  taskNumber: string | null;
  taskTitle: string | null;
  assetId: number | null;
  assetName: string | null;
  assetTypeName: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  onHoldReason: string | null;
  onHoldDays: number | null;
  daysOverdue: number | null;
  oldDueDate: string | null;
  newDueDate: string | null;
}

export interface Feed {
  asOfUtc: string;
  seenAtUtc: string | null;
  unreadCount: number;
  total: number;
  page: number;
  pageSize: number;
  countsByKind: Record<FeedKind, number>;
  items: FeedItem[];
}

export interface TaskCounts {
  byStatus: {
    allOpen: number;
    new: number;
    inProgress: number;
    onHold: number;
    completed: number;
    cancelled: number;
  };
  byShow: {
    everything: number;
    overdue: number;
    risk: number;
    unassigned: number;
    critical: number;
    due7: number;
  };
}

export type AssetStatusCode = 'ACTIVE' | 'INACTIVE' | 'PENDING_DISPOSITION' | 'DISPOSED';

export interface AssetRow {
  assetId: number;
  name: string;
  clientId: number;
  clientName: string;
  matterId: number;
  matterRef: string;
  matterName: string;
  assetTypeId: number;
  assetTypeName: string;
  createdAtUtc: string;
  updatedAtUtc: string | null;
  statusCode: AssetStatusCode;
  linkedTaskCount: number | null;
  openLinkedTaskCount: number | null;
}

export interface AssetPage {
  total: number;
  page: number;
  pageSize: number;
  items: AssetRow[];
}

export interface LinkedTask {
  taskId: number;
  taskNumber: string;
  title: string;
  statusCode: string;
  statusLabel: string;
  dueDate: string | null;
  isOverdue: boolean;
  assigneeName: string | null;
  latestComment: {
    commentId: number;
    authorName: string;
    createdAtUtc: string;
    excerpt: string;
  } | null;
}

export interface AssetDetail extends AssetRow {
  description: string | null;
  externalReference: string | null;
  createdByName: string;
  sizeValue: number | null;
  sizeUnit: string | null;
  linkedTasks: LinkedTask[];
}

/** The "Show" filter of the task grid (the second filter next to the Status chips). `everything` is the default. */
export type ShowFilter = 'everything' | 'overdue' | 'risk' | 'unassigned' | 'critical' | 'due7';
export const SHOW_FILTERS: readonly { key: ShowFilter; label: string }[] = [
  { key: 'everything', label: 'Everything' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'risk', label: 'At risk' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'critical', label: 'Critical' },
  { key: 'due7', label: 'Due in 7 days' },
];

/** The Status chips of the task grid. `open` (New + In Progress + On Hold) is the default. */
export type StatusFilter = 'open' | 'new' | 'progress' | 'hold' | 'completed' | 'cancelled';
export const STATUS_FILTERS: readonly {
  key: StatusFilter;
  label: string;
  codes: readonly string[];
}[] = [
  { key: 'open', label: 'All open', codes: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] },
  { key: 'new', label: 'New', codes: ['NEW'] },
  { key: 'progress', label: 'In Progress', codes: ['IN_PROGRESS'] },
  { key: 'hold', label: 'On Hold', codes: ['ON_HOLD'] },
  { key: 'completed', label: 'Completed', codes: ['COMPLETED'] },
  { key: 'cancelled', label: 'Cancelled', codes: ['CANCELLED'] },
];

export const FEED_KINDS: readonly { kind: FeedKind; label: string }[] = [
  { kind: 'NEW_ASSETS', label: 'New assets' },
  { kind: 'NEW_COMMENTS', label: 'New comments' },
  { kind: 'NEW_STATUS_UPDATES', label: 'New status updates' },
  { kind: 'ON_HOLD', label: 'On hold' },
  { kind: 'OVERDUE', label: 'Overdue' },
  { kind: 'DUE_DATE_UPDATED', label: 'Due date updated' },
];
