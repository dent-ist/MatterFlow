/**
 * True when a display name and a Windows account name the same identity, so the UI shows it once (#592): trimmed and compared without
 * regard to case, so `KE\kekim` and `ke\kekim` are one name. An empty side is never the same as anything.
 */
export function sameIdentity(
  name: string | null | undefined,
  account: string | null | undefined,
): boolean {
  const a = (name ?? '').trim().toLowerCase();
  const b = (account ?? '').trim().toLowerCase();
  return a.length > 0 && a === b;
}
