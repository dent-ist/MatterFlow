import { TaskCommentResponse } from '../../../api/generated/api-client';

const who = (userId: number | null | undefined): string => String(userId ?? 'anon');
/** Where a person's choice for the Details disclosure below 1100 px is remembered (closed until opened). */
export const detailsOpenKey = (userId: number | null | undefined): string =>
  `mf.task-detail.details.open.${who(userId)}`;
/** A request form with this many fields or fewer starts open; a longer one starts closed (#313). */
export const REQUEST_OPEN_MAX_FIELDS = 6;
/** Where a person's open / closed choice for the Request details of one task type is remembered. */
export const requestOpenKey = (
  userId: number | null | undefined,
  taskTypeId: number | null | undefined,
): string => `mf.task-detail.request.open.${who(userId)}.${taskTypeId ?? 'none'}`;
/** Request details open or closed: the person's remembered choice for the task type, else open only for a short form. */
export const requestInitiallyOpen = (
  userId: number | null | undefined,
  taskTypeId: number | null | undefined,
  fieldCount: number,
): boolean => readOpen(requestOpenKey(userId, taskTypeId)) ?? fieldCount <= REQUEST_OPEN_MAX_FIELDS;
/** When the person last saw the Comments of one Task (epoch ms). */
export const commentsSeenKey = (userId: number | null | undefined, taskId: number): string =>
  `mf.task-detail.comments.seen.${who(userId)}.${taskId}`;
const seenIndexKey = (userId: number | null | undefined): string =>
  `mf.task-detail.comments.seen-index.${who(userId)}`;
/** How many tasks' "last seen" times are kept per person (least recently seen are dropped). */
export const SEEN_CAP = 200;

function store<T>(run: (s: Storage) => T, fallback: T): T {
  try {
    return run(localStorage);
  } catch {
    return fallback; // Blocked or private storage: nothing is remembered.
  }
}

export const readOpen = (key: string): boolean | null =>
  store((s) => {
    const raw = s.getItem(key);
    return raw === '1' ? true : raw === '0' ? false : null;
  }, null);

export const saveOpen = (key: string, open: boolean): void =>
  store((s) => s.setItem(key, open ? '1' : '0'), undefined);

export const readSeen = (userId: number | null | undefined, taskId: number): number | null =>
  store((s) => {
    const n = Number(s.getItem(commentsSeenKey(userId, taskId)));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, null);

export function saveSeen(userId: number | null | undefined, taskId: number, at: number): void {
  store((s) => {
    s.setItem(commentsSeenKey(userId, taskId), String(at));
    const index = seenIndexKey(userId);
    let ids: number[] = [];
    try {
      ids = JSON.parse(s.getItem(index) ?? '[]') as number[];
    } catch {
      ids = [];
    }
    ids = [taskId, ...ids.filter((id) => id !== taskId)];
    for (const old of ids.splice(SEEN_CAP)) s.removeItem(commentsSeenKey(userId, old));
    s.setItem(index, JSON.stringify(ids));
  }, undefined);
}

const timeOf = (c: TaskCommentResponse): number => Date.parse(c.createdAtUtc) || 0;

/** The latest comment by date (then id). */
export const latestOf = (items: readonly TaskCommentResponse[]): TaskCommentResponse | null =>
  items.reduce<TaskCommentResponse | null>(
    (best, c) =>
      !best ||
      timeOf(c) > timeOf(best) ||
      (timeOf(c) === timeOf(best) && c.commentId > best.commentId)
        ? c
        : best,
    null,
  );

/** Comments by other people written after `seenAt` (nothing counts without a stored time: first visit). */
export const countNew = (
  items: readonly TaskCommentResponse[],
  seenAt: number | null,
  userId: number | null | undefined,
): number =>
  seenAt === null
    ? 0
    : items.filter((c) => c.author.userId !== userId && timeOf(c) > seenAt).length;
