import { TaskAssetLinkResponse, TaskCommentResponse } from '../../../api/generated/api-client';
import { htmlToText } from './rich-text';

/** The two collapsible bottom sections of the Task page. */
export type PanelSection = 'comments' | 'assets';

const who = (userId: number | null | undefined): string => String(userId ?? 'anon');
/** Where a person's open / closed choice for a section is remembered (`localStorage`). */
export const sectionOpenKey = (section: PanelSection, userId: number | null | undefined): string =>
  `mf.task-detail.${section}.open.${who(userId)}`;
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

/** `just now`, `5m ago`, `3h ago`, `2d ago`, then the date. */
export function shortAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!t) return '';
  const min = Math.max(0, Math.floor((now - t) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  if (min < 10_080) return `${Math.floor(min / 1440)}d ago`;
  return new Date(t).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function commentsPreview(latest: TaskCommentResponse | null, now = Date.now()): string {
  if (!latest) return 'No comments yet';
  const text = htmlToText(latest.bodyHtml).replace(/\s+/g, ' ').trim().slice(0, 200);
  return `Latest: ${latest.author.displayName}, ${shortAgo(latest.createdAtUtc, now)}: ${text}`;
}

export function assetsPreview(items: readonly TaskAssetLinkResponse[]): string {
  if (items.length === 0) return 'No linked assets';
  const names = items
    .slice(0, 2)
    .map((a) => a.displayName)
    .join(', ');
  return items.length > 2 ? `${names} +${items.length - 2} more` : names;
}
