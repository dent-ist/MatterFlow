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
  serverCanOpen?: boolean | null,
): ['/matters', number] | null {
  // `serverCanOpen` is the server's `canOpen` / `matterCanOpen` answer on a record: false means the viewer sees the record through an assigned task
  // and may not open the (sensitive) matter, so the reference stays plain text (epic #788). Absent means "as before".
  return matterId !== null &&
    matterId !== undefined &&
    serverCanOpen !== false &&
    canOpenMatter(auth)
    ? ['/matters', matterId]
    : null;
}
