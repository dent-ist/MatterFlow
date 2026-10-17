function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const key = (userId: number | null) => `mf.my-work.visit.v2.${userId ?? 'anon'}`;

/** A visit ends after more than this much time without activity. */
export const VISIT_GAP_MS = 30 * 60_000;
/** Activity is written at most this often. */
export const ACTIVITY_STEP_MS = 60_000;

interface VisitRecord {
  /** The last moment (ms) the person used a work list or a task. */
  lastActiveAt: number;
  /** When the current visit began = the `lastActiveAt` of the visit before it; null on first use. */
  visitSince: number | null;
}

function read(store: Storage, userId: number | null): VisitRecord | null {
  try {
    const parsed: unknown = JSON.parse(store.getItem(key(userId)) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const { lastActiveAt, visitSince } = parsed as Record<string, unknown>;
    if (typeof lastActiveAt !== 'number' || !Number.isFinite(lastActiveAt)) return null;
    return {
      lastActiveAt,
      visitSince: typeof visitSince === 'number' && Number.isFinite(visitSince) ? visitSince : null,
    };
  } catch {
    return null;
  }
}

/**
 * The start of the current visit (ms): tasks assigned after it are "New". A visit is a period of use with no gap of more than 30
 * minutes, so opening a task, pressing Back, reloading or visiting other screens does not end it; `visitSince` is the moment the
 * previous visit was last active and stays the same for the whole visit. Kept in `localStorage` per user, so every browser tab agrees
 * (device specific by design). Call it whenever the person is active: it starts a new visit after a long gap and records the activity
 * (at most once a minute). Returns null on the first use and when storage is blocked (then nothing is marked New); never throws.
 */
export function touchVisit(userId: number | null, now: number): number | null {
  try {
    const store = storage();
    if (!store) return null;
    const record = read(store, userId);
    if (!record) {
      store.setItem(key(userId), JSON.stringify({ lastActiveAt: now, visitSince: null }));
      return null;
    }
    // A clock that went back counts as the same visit.
    if (now - record.lastActiveAt > VISIT_GAP_MS) {
      store.setItem(
        key(userId),
        JSON.stringify({ lastActiveAt: now, visitSince: record.lastActiveAt }),
      );
      return record.lastActiveAt;
    }
    if (now - record.lastActiveAt >= ACTIVITY_STEP_MS) {
      store.setItem(key(userId), JSON.stringify({ ...record, lastActiveAt: now }));
    }
    return record.visitSince;
  } catch {
    return null;
  }
}

let tracked: { userId: number | null; now: () => number } | null = null;
let listening = false;

/**
 * Keeps the visit alive while the person works anywhere in the app (opening and editing a task is activity too): after the first call a
 * throttled listener records activity for the user of the latest call.
 */
export function trackVisitActivity(userId: number | null, now: () => number): void {
  tracked = { userId, now };
  if (listening || typeof document === 'undefined') return;
  listening = true;
  let last = 0;
  const onActivity = () => {
    const t = Date.now();
    if (!tracked || t - last < 5_000) return;
    last = t;
    touchVisit(tracked.userId, tracked.now());
  };
  for (const type of ['pointerdown', 'keydown'] as const) {
    document.addEventListener(type, onActivity, { passive: true, capture: true });
  }
}
