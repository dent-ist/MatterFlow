import type { AuthStore } from '../../core/auth/auth.store';

/**
 * Whether a matter reference may be a link (decision V: a link exists only if its target opens). The matter page needs `Matter.View`;
 * without it the reference is plain text. One rule for the Assets list, the asset record page and its Linked tasks tab.
 */
export function canOpenMatter(auth: Pick<AuthStore, 'has'>): boolean {
  return auth.has('Matter.View');
}

/** The router commands of a matter link, or `null` (render plain text) when the person may not open matters. */
export function matterLinkOf(
  auth: Pick<AuthStore, 'has'>,
  matterId: number | null | undefined,
): ['/matters', number] | null {
  return matterId !== null && matterId !== undefined && canOpenMatter(auth)
    ? ['/matters', matterId]
    : null;
}
