import { firstValueFrom } from 'rxjs';
import { PodsClient } from '../../api/generated/api-client';
export interface PodOption {
  id: number;
  name: string;
}

export interface PodChoices {
  options: PodOption[];
  primaryPodId: number | null;
  /** How many Pods the user belongs to (Pod.View only); null when unknown. */
  memberOf: number | null;
}

/**
 * The Pods to offer in a filter: with `includeAll` (the caller has Pod.View) the user's own Pods and every active Pod; without it none. Never rejects: the Pod
 * filter and "My Pod" are conveniences, and the list works without them.
 */
export async function loadPodChoices(api: PodsClient, includeAll: boolean): Promise<PodChoices> {
  // `GET /me/pods` needs Pod.View too: without it there is nothing to ask (and no 403 in the console, UAT2-19).
  if (!includeAll) return { options: [], primaryPodId: null, memberOf: null };
  try {
    const mine = await firstValueFrom(api.listMyPods());
    const byId = new Map(mine.map((p) => [p.podId, p.name] as const));
    if (includeAll) {
      const all = await firstValueFrom(api.listPods(undefined, undefined, true, 1, 100));
      for (const p of all.items) byId.set(p.podId, p.name);
    }
    return {
      options: [...byId]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      primaryPodId: mine.find((p) => p.isPrimary)?.podId ?? null,
      memberOf: mine.length,
    };
  } catch {
    return { options: [], primaryPodId: null, memberOf: null };
  }
}
