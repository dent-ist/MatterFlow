import {
  calendarDayInZone,
  dayIndex,
  formatCalendarDay,
  formatInstant,
  formatMonthDay,
} from '../../core/time/time';

/** The parts of a notification the text helpers need (the generated `NotificationItem` fits). */
export interface NotificationLike {
  readonly objectKind: string;
  readonly objectId: number;
  readonly message: string;
  readonly createdUtc: string;
  readonly isRead: boolean;
  /** Set on the overdue notices (PM v2, #884): the ones that share a key are one group. */
  readonly groupKey?: string | null;
  readonly matterId?: number | null;
}

/**
 * The text a polite live region says for items a poll found after the first one (README section 10): one item reads "New notification:
 * <message>", several read "3 new notifications. Latest: <message>". `items` is newest first; nothing new gives an empty string.
 */
export function announcementText(items: readonly { message: string }[]): string {
  if (items.length === 0) return '';
  const latest = items[0].message;
  return items.length === 1
    ? `New notification: ${latest}`
    : `${items.length} new notifications. Latest: ${latest}`;
}

/**
 * "5 min ago", "1 h ago", "yesterday", then "Oct 18" (and "Oct 18, 2025" in another year) in the viewer's zone. Under a minute reads
 * "just now". The absolute time is the tooltip (`absoluteTime`).
 */
export function relativeTime(createdUtc: string, now: Date, zone: string): string {
  const created = new Date(createdUtc);
  if (Number.isNaN(created.getTime())) return '';
  const minutes = Math.floor((now.getTime() - created.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const today = calendarDayInZone(now, zone);
  const day = calendarDayInZone(created, zone);
  const daysAgo = dayIndex(today) - dayIndex(day);
  if (daysAgo <= 0) return `${Math.floor(minutes / 60)} h ago`;
  if (daysAgo === 1) return 'yesterday';
  return day.year === today.year ? formatMonthDay(day) : formatCalendarDay(day);
}

/** "Oct 28, 2026, 3:00 PM CDT" for the tooltip and the `<time>` title. */
export function absoluteTime(createdUtc: string, zone: string): string {
  const created = new Date(createdUtc);
  return Number.isNaN(created.getTime()) ? '' : formatInstant(created, zone);
}

/** Router commands for the object a notification is about; built from kind and id only, never from stored text. */
export function notificationLink(
  item: Pick<NotificationLike, 'objectKind' | 'objectId'>,
): unknown[] {
  return [item.objectKind === 'Matter' ? '/matters' : '/tasks', item.objectId];
}

/** The overdue notices of one day and kind (for the matter managers, or for the assignee), as one entry of a list (PM v2, #884). Display only: every notice stays. */
export interface NotificationGroup<T extends NotificationLike = NotificationLike> {
  readonly kind: 'group';
  readonly key: string;
  /** The notices of the group in the order the list has them (newest first). */
  readonly items: readonly T[];
  /** How many of them are still unread. */
  readonly unread: number;
  /** For the matters' managers (`:manager`); false for the person the tasks are assigned to. */
  readonly manager: boolean;
  /** How many different tasks and how many different matters the notices are about. */
  readonly tasks: number;
  readonly matters: number;
  readonly newestUtc: string;
}

export interface NotificationSingle<T extends NotificationLike = NotificationLike> {
  readonly kind: 'single';
  readonly item: T;
}

export type NotificationEntry<T extends NotificationLike = NotificationLike> =
  NotificationSingle<T> | NotificationGroup<T>;

/**
 * The entries of a list: notices that carry the same `groupKey` (at least two on this list) become one group at the place of the newest of them; every
 * other notice stays on its own. Nothing is dropped or merged on the server, so a group can always be opened up into its notices.
 */
export function groupNotifications<T extends NotificationLike>(
  items: readonly T[],
): NotificationEntry<T>[] {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    if (item.groupKey) byKey.set(item.groupKey, [...(byKey.get(item.groupKey) ?? []), item]);
  }
  const entries: NotificationEntry<T>[] = [];
  const done = new Set<string>();
  for (const item of items) {
    const members = item.groupKey ? byKey.get(item.groupKey) : undefined;
    if (!item.groupKey || !members || members.length < 2) {
      entries.push({ kind: 'single', item });
      continue;
    }
    if (done.has(item.groupKey)) continue;
    done.add(item.groupKey);
    entries.push({
      kind: 'group',
      key: item.groupKey,
      items: members,
      unread: members.filter((m) => !m.isRead).length,
      manager: item.groupKey.endsWith(':manager'),
      tasks: new Set(members.map((m) => m.objectId)).size,
      matters: new Set(members.map((m) => m.matterId ?? `o${m.objectId}`)).size,
      newestUtc: item.createdUtc,
    });
  }
  return entries;
}

/** "Overdue - 13 tasks on 3 matters" (reason first, like every notice); "13 of your tasks" for the person the tasks are assigned to. */
export function groupSummary(g: Pick<NotificationGroup, 'manager' | 'tasks' | 'matters'>): string {
  const tasks = g.manager
    ? `${g.tasks} ${g.tasks === 1 ? 'task' : 'tasks'}`
    : `${g.tasks} of your ${g.tasks === 1 ? 'task' : 'tasks'}`;
  return `Overdue - ${tasks} on ${g.matters} ${g.matters === 1 ? 'matter' : 'matters'}`;
}

const OPEN_STATUSES = ['NEW', 'IN_PROGRESS', 'ON_HOLD'];

/** Where a group leads: the Task Queue of the overdue tasks on the matters the person manages, or My Work for the person's own tasks. */
export function groupLink(g: Pick<NotificationGroup, 'manager'>): {
  commands: unknown[];
  queryParams: Record<string, string | string[]> | null;
} {
  return g.manager
    ? {
        commands: ['/tasks'],
        queryParams: { managedByMe: 'true', overdue: 'true', status: OPEN_STATUSES },
      }
    : { commands: ['/my-work'], queryParams: null };
}
