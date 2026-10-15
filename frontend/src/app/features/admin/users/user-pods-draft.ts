import { UserPodDto } from '../../../core/identity-admin/identity-admin-api';

/** What the Pods editor of one person holds while it is open: the ticked pods and the one marked primary. Nothing is saved until Apply. */
export interface PodDraft {
  readonly selected: readonly number[];
  readonly primary: number | null;
}

/** A pod in the checklist: the active pods, plus the pods the person is already in (an inactive one stays visible, muted). */
export interface PodRow {
  podId: number;
  name: string;
  isActive: boolean;
}

export function initialDraft(pods: readonly UserPodDto[]): PodDraft {
  return {
    selected: pods.map((p) => p.podId),
    primary: pods.find((p) => p.isPrimary)?.podId ?? null,
  };
}

/**
 * Ticks or unticks a pod. The first pod of a person with no pods becomes the primary one (there is nothing else to choose). Unticking
 * the primary pod clears the primary: the editor then asks for the new one and blocks Apply until it is chosen; it never promotes
 * another pod silently.
 */
export function togglePod(
  draft: PodDraft,
  podId: number,
  on: boolean,
  isActive: boolean,
): PodDraft {
  if (on) {
    if (draft.selected.includes(podId)) return draft;
    const first = draft.selected.length === 0 && isActive;
    return { selected: [...draft.selected, podId], primary: first ? podId : draft.primary };
  }
  return {
    selected: draft.selected.filter((id) => id !== podId),
    primary: draft.primary === podId ? null : draft.primary,
  };
}

export function choosePrimary(draft: PodDraft, podId: number): PodDraft {
  return draft.selected.includes(podId) ? { ...draft, primary: podId } : draft;
}

export function sameDraft(a: PodDraft, b: PodDraft): boolean {
  return (
    a.primary === b.primary &&
    a.selected.length === b.selected.length &&
    a.selected.every((id) => b.selected.includes(id))
  );
}

/**
 * True when the draft holds an active pod but no primary pod: Apply is blocked until one is chosen. A person whose only pods are
 * inactive ones can be saved without a primary (an inactive pod cannot be made primary).
 */
export function needsPrimary(draft: PodDraft, rows: readonly PodRow[]): boolean {
  return (
    draft.primary === null &&
    draft.selected.some((id) => rows.find((r) => r.podId === id)?.isActive !== false)
  );
}

/** The pods of a person as chips read them: "Processing (primary), Review, Old pod (inactive)". */
export function podsText(pods: readonly UserPodDto[]): string {
  return pods
    .map((p) => p.name + (p.isPrimary ? ' (primary)' : '') + (p.isActive ? '' : ' (inactive)'))
    .join(', ');
}

/** Checklist rows: every active pod plus the pods the person is in, by name. */
export function podRows(catalog: readonly PodRow[], own: readonly UserPodDto[]): PodRow[] {
  const byId = new Map<number, PodRow>();
  for (const p of catalog) byId.set(p.podId, p);
  for (const p of own) byId.set(p.podId, { podId: p.podId, name: p.name, isActive: p.isActive });
  return [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}
