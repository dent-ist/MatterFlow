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

/** What changed between the previous published version and the draft (UX S16 publish dialog). */
export interface WorkflowDiff {
  added: string[];
  removed: string[];
  moved: string[];
  skipRuleChanged: string[];
  modeChange: { from: 'Ordered' | 'Unordered'; to: 'Ordered' | 'Unordered' } | null;
  /** True when nothing differs. */
  unchanged: boolean;
}

const modeName = (ordered: boolean): 'Ordered' | 'Unordered' => (ordered ? 'Ordered' : 'Unordered');

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

  // Order only has meaning in Ordered mode: compare the relative order of the steps present in both.
  const moved: string[] = [];
  if (next.isOrdered) {
    const prevOrder = prev.filter((s) => nextIds.has(s.sourceStepDefinitionId));
    const nextOrder = next.steps.filter((s) => prevIds.has(s.sourceStepDefinitionId));
    nextOrder.forEach((s, i) => {
      if (prevOrder[i]?.sourceStepDefinitionId !== s.sourceStepDefinitionId) moved.push(s.title);
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
