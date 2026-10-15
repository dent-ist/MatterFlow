function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const key = (userId: number | null) => `mf.my-work.last-visit.v1.${userId ?? 'anon'}`;

/**
 * Reads when the user last opened My Work and records `now` as the new visit. Returns the previous visit in ms, or null on the first
 * visit or when storage is blocked (then nothing is marked "New"). Calling it once per arrival gives the "New since your last visit"
 * semantics: the marker is gone at the next visit.
 */
export function recordVisit(userId: number | null, now: number): number | null {
  try {
    const store = storage();
    if (!store) return null;
    const raw = store.getItem(key(userId));
    store.setItem(key(userId), String(now));
    const previous = raw === null ? NaN : Number(raw);
    return Number.isFinite(previous) ? previous : null;
  } catch {
    return null;
  }
}
