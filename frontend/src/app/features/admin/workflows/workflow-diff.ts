/** The part of a version the publish diff compares. */
export interface DiffableVersion {
  isOrdered: boolean;
  steps: readonly {
    sourceStepDefinitionId: number;
    title: string;
    isSkippable: boolean;
    skipCommentRequired: boolean;
  }[];
}

/** A step that kept its place among the other steps but got another position number, because steps were added or removed before it. */
export interface ShiftedStep {
  title: string;
  /** The 1-based position in the previous version and in this one. */
  from: number;
  to: number;
}

/** What changed between the previous published version and the draft (UX S16 publish dialog). */
export interface WorkflowDiff {
  added: string[];
  removed: string[];
  /** Steps that were really reordered: their order relative to the steps that stayed changed (#401). */
  moved: string[];
  /** Steps whose position number only changed because steps were added, removed or reordered around them: shown as one line (#401). */
  shifted: ShiftedStep[];
  skipRuleChanged: string[];
  modeChange: { from: 'Ordered' | 'Unordered'; to: 'Ordered' | 'Unordered' } | null;
  /** True when nothing differs. */
  unchanged: boolean;
}

const modeName = (ordered: boolean): 'Ordered' | 'Unordered' => (ordered ? 'Ordered' : 'Unordered');

/**
 * Of the steps in both versions, the ones that were really moved: those outside a longest run that kept its relative order. Moving one
 * step from the top to the bottom moves that step, not the twelve it passed; swapping two steps moves the later one of the new order
 * (the other is the one that stayed). Returns the indexes (into `order`, the common steps in the new order) of the steps that moved.
 */
function reordered(order: readonly number[]): Set<number> {
  // `order[i]` is where the i-th common step of the new version was in the previous one; the steps that kept their order are the
  // longest increasing subsequence (ties go to the earliest steps, so the result does not depend on the sort order of the library).
  const length: number[] = [];
  const back: number[] = [];
  for (let i = 0; i < order.length; i++) {
    length[i] = 1;
    back[i] = -1;
    for (let j = 0; j < i; j++) {
      if (order[j] < order[i] && length[j] + 1 > length[i]) {
        length[i] = length[j] + 1;
        back[i] = j;
      }
    }
  }
  let end = -1;
  for (let i = 0; i < order.length; i++) if (end < 0 || length[i] > length[end]) end = i;
  const kept = new Set<number>();
  for (let i = end; i >= 0; i = back[i]) kept.add(i);
  return new Set(order.map((_, i) => i).filter((i) => !kept.has(i)));
}

/** Compares a draft with the previous published version. `previous` null means this is the first publication. */
export function diffVersions(
  previous: DiffableVersion | null,
  next: DiffableVersion,
): WorkflowDiff {
  const prev = previous?.steps ?? [];
  const prevIds = new Set(prev.map((s) => s.sourceStepDefinitionId));
  const nextIds = new Set(next.steps.map((s) => s.sourceStepDefinitionId));

  const added = next.steps
    .filter((s) => !prevIds.has(s.sourceStepDefinitionId))
    .map((s) => s.title);
  const removed = prev.filter((s) => !nextIds.has(s.sourceStepDefinitionId)).map((s) => s.title);

  const skipRuleChanged: string[] = [];
  for (const step of next.steps) {
    const old = prev.find((p) => p.sourceStepDefinitionId === step.sourceStepDefinitionId);
    if (
      old &&
      (old.isSkippable !== step.isSkippable || old.skipCommentRequired !== step.skipCommentRequired)
    ) {
      skipRuleChanged.push(step.title);
    }
  }

  // Order only has meaning in Ordered mode (an unordered workflow shows no position numbers).
  const moved: string[] = [];
  const shifted: ShiftedStep[] = [];
  if (next.isOrdered && previous) {
    const prevOrder = prev.filter((s) => nextIds.has(s.sourceStepDefinitionId));
    const nextOrder = next.steps.filter((s) => prevIds.has(s.sourceStepDefinitionId));
    const prevIndex = new Map(prevOrder.map((s, i) => [s.sourceStepDefinitionId, i]));
    const movedAt = reordered(nextOrder.map((s) => prevIndex.get(s.sourceStepDefinitionId)!));
    const movedIds = new Set<number>();
    nextOrder.forEach((s, i) => {
      if (!movedAt.has(i)) return;
      moved.push(s.title);
      movedIds.add(s.sourceStepDefinitionId);
    });
    // A step that stayed in place relative to the others but has another number: only because of what was added or removed.
    const without = (steps: DiffableVersion['steps']) =>
      steps.filter((s) => !movedIds.has(s.sourceStepDefinitionId));
    const before = new Map(without(prev).map((s, i) => [s.sourceStepDefinitionId, i]));
    const after = new Map(without(next.steps).map((s, i) => [s.sourceStepDefinitionId, i]));
    next.steps.forEach((s, i) => {
      const id = s.sourceStepDefinitionId;
      if (movedIds.has(id) || !prevIds.has(id)) return;
      if (before.get(id) === after.get(id)) return;
      shifted.push({
        title: s.title,
        from: prev.findIndex((p) => p.sourceStepDefinitionId === id) + 1,
        to: i + 1,
      });
    });
  }

  const modeChange =
    previous && previous.isOrdered !== next.isOrdered
      ? { from: modeName(previous.isOrdered), to: modeName(next.isOrdered) }
      : null;

  return {
    added,
    removed,
    moved,
    shifted,
    skipRuleChanged,
    modeChange,
    unchanged:
      !modeChange &&
      added.length === 0 &&
      removed.length === 0 &&
      moved.length === 0 &&
      skipRuleChanged.length === 0,
  };
}
