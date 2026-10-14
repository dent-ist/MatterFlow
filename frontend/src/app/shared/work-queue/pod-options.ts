import { firstValueFrom } from 'rxjs';
import { PodsClient } from '../../api/generated/api-client';
import { PodOption } from './work-filter-bar';

export interface PodChoices {
  options: PodOption[];
  primaryPodId: number | null;
}

/**
 * The Pods to offer in a filter: the user's own Pods and, with `includeAll` (Pod.View), every active Pod. Never rejects: the Pod
 * filter and "My Pod" are conveniences, and the list works without them.
 */
export async function loadPodChoices(api: PodsClient, includeAll: boolean): Promise<PodChoices> {
  try {
    const mine = await firstValueFrom(api.listMyPods());
    const byId = new Map(mine.map((p) => [p.podId, p.name] as const));
    if (includeAll) {
      const all = await firstValueFrom(api.listPods(undefined, true, 1, 100));
      for (const p of all.items) byId.set(p.podId, p.name);
    }
    return {
      options: [...byId]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      primaryPodId: mine.find((p) => p.isPrimary)?.podId ?? null,
    };
  } catch {
    return { options: [], primaryPodId: null };
  }
}
