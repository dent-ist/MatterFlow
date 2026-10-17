const key = (userId: number | null) => `mf.work-group.v1.my-work.${userId ?? 'anon'}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The grouping the user chose on My Work's Active tab (`due`), or null for the plain list. Never throws. */
export function loadGroup(userId: number | null): 'due' | null {
  try {
    return storage()?.getItem(key(userId)) === 'due' ? 'due' : null;
  } catch {
    return null;
  }
}

/** Remembers the choice per user; null forgets it. */
export function saveGroup(userId: number | null, group: 'due' | null): void {
  try {
    if (group) storage()?.setItem(key(userId), group);
    else storage()?.removeItem(key(userId));
  } catch {
    // Not remembered.
  }
}
