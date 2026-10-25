/**
 * What a person chose last when adding work (issues #814, #819): their last three task types and the last matter they created a task for,
 * remembered per person in the browser. Convenience only: storage may be blocked or empty, and everything then simply starts blank. Nothing
 * here is sent anywhere and no task content is kept (only ids).
 */
export const RECENT_TYPES_MAX = 3;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const typesKey = (userId: number) => `mf.create-task.types.${userId}`;
const matterKey = (userId: number) => `mf.create-task.matter.${userId}`;

/** Adds `typeId` as the newest of the last types (no duplicates, at most `RECENT_TYPES_MAX`); pure. */
export function withRecentType(
  current: readonly number[],
  typeId: number,
  max = RECENT_TYPES_MAX,
): number[] {
  return [typeId, ...current.filter((id) => id !== typeId)].slice(0, max);
}

/** The ids as stored, newest first; anything that is not a positive integer is dropped. */
export function parseIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0)
      .slice(0, RECENT_TYPES_MAX);
  } catch {
    return [];
  }
}

export function recentTypeIds(userId: number): number[] {
  try {
    return parseIds(storage()?.getItem(typesKey(userId)));
  } catch {
    return [];
  }
}

export function rememberType(userId: number, typeId: number): void {
  try {
    storage()?.setItem(
      typesKey(userId),
      JSON.stringify(withRecentType(recentTypeIds(userId), typeId)),
    );
  } catch {
    // Not remembering is fine.
  }
}

export function lastMatterId(userId: number): number | null {
  try {
    const n = Number(storage()?.getItem(matterKey(userId)));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function rememberMatter(userId: number, matterId: number): void {
  try {
    storage()?.setItem(matterKey(userId), String(matterId));
  } catch {
    // Not remembering is fine.
  }
}

/** The key of the flag that asks My Matters to put the focus back on its "New task" control once (set when it is used, taken on the way back). */
const FOCUS_KEY = 'mf.my-matters.focus-new-task';
const FOCUS_MAX_AGE_MS = 30 * 60_000;

export function flagFocusReturn(now = Date.now()): void {
  try {
    storage()?.setItem(FOCUS_KEY, String(now));
  } catch {
    // Focus then goes to the page, as it always did.
  }
}

/** True once after `flagFocusReturn` (within half an hour); the flag is cleared either way. */
export function takeFocusReturn(now = Date.now()): boolean {
  try {
    const raw = storage()?.getItem(FOCUS_KEY);
    storage()?.removeItem(FOCUS_KEY);
    const at = Number(raw);
    return !!raw && Number.isFinite(at) && now - at >= 0 && now - at <= FOCUS_MAX_AGE_MS;
  } catch {
    return false;
  }
}
