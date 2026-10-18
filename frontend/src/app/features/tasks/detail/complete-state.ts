import { TaskStepInstance } from '../../../api/generated/api-client';

/** Whether Complete can go straight through, read from the Task's steps (no extra call): the same rule as the server's completion check. */
export interface CompleteState {
  /** `ready`: nothing blocks Complete (it may still ask to mark open steps completed). `blocked`: some steps need information first. */
  kind: 'ready' | 'blocked';
  /** Steps not completed or skipped. */
  unresolved: number;
  /** Unresolved steps whose required inputs are missing, in workflow order. */
  blocked: readonly Pick<TaskStepInstance, 'stepInstanceId' | 'sequenceNo' | 'title'>[];
}

type StepLike = Pick<
  TaskStepInstance,
  'stepInstanceId' | 'sequenceNo' | 'title' | 'status' | 'requiredInputsSatisfied'
>;

const RESOLVED = new Set(['COMPLETED', 'SKIPPED']);

/** M2 (#304): `completeState` of a workflow's steps. No steps, or only resolved ones, is ready; skipped steps never block. */
export function completeStateOf(steps: readonly StepLike[] | null | undefined): CompleteState {
  const open = (steps ?? []).filter((s) => !RESOLVED.has(s.status));
  const blocked = open
    .filter((s) => !s.requiredInputsSatisfied)
    .sort((a, b) => a.sequenceNo - b.sequenceNo);
  return { kind: blocked.length > 0 ? 'blocked' : 'ready', unresolved: open.length, blocked };
}

/** "3 steps need information" for a blocked state, else null. It is the hint of every Complete control (tooltip and `aria-describedby`). */
export function completeHint(state: CompleteState): string | null {
  const n = state.blocked.length;
  return n === 0 ? null : n === 1 ? '1 step needs information' : `${n} steps need information`;
}
