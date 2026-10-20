/**
 * The wording of the Task Types administration dialogs (#362), in one place. The vocabulary of the review (section 3 item 5):
 * published things are **retired**, records are **deactivated**, drafts are **discarded**. The verb is in the primary button
 * ("Deactivate task type", "Publish v3", "Retire v2"), the cancel says what is kept ("Keep active", "Back to draft"), and only the
 * destructive ones are `danger`. Dialogs read this table; none spells its own title or button text.
 */
export interface DialogCopy {
  title: string;
  confirm: string;
  cancel: string;
  /** Destructive: the confirm button is red. */
  danger: boolean;
}

export const DIALOG_COPY = {
  deactivateTaskType: {
    title: 'Deactivate task type?',
    confirm: 'Deactivate task type',
    cancel: 'Keep active',
    danger: true,
  },
  deactivateWorkflow: {
    title: 'Deactivate workflow?',
    confirm: 'Deactivate workflow',
    cancel: 'Keep active',
    danger: true,
  },
  deactivateStep: {
    title: 'Deactivate step?',
    confirm: 'Deactivate step',
    cancel: 'Keep active',
    danger: true,
  },
  discardDraft: {
    title: 'Discard draft?',
    confirm: 'Discard draft',
    cancel: 'Keep draft',
    danger: true,
  },
  discardChanges: {
    title: 'Discard unsaved changes?',
    confirm: 'Discard changes',
    cancel: 'Keep editing',
    danger: true,
  },
  changeMode: {
    title: 'Change execution mode?',
    confirm: 'Change mode',
    cancel: 'Keep mode',
    danger: false,
  },
  conflict: {
    title: 'This draft was changed by someone else',
    confirm: 'Keep my changes',
    cancel: 'Reload latest',
    danger: false,
  },
} as const satisfies Record<string, DialogCopy>;

/** Publish a version: "Publish v3" in the title and on the button, "Back to draft" to leave. */
export function publishCopy(versionNo: number | string): DialogCopy {
  return {
    title: `Publish v${versionNo}`,
    confirm: `Publish v${versionNo}`,
    cancel: 'Back to draft',
    danger: false,
  };
}

/** Retire a published version: "Retire v2", "Keep published" to leave. */
export function retireCopy(versionNo: number | string): DialogCopy {
  return {
    title: `Retire v${versionNo}?`,
    confirm: `Retire v${versionNo}`,
    cancel: 'Keep published',
    danger: true,
  };
}

/** What a dialog is about, for `impactLine`. */
export type ImpactKind =
  | 'deactivateTaskType'
  | 'deactivateWorkflow'
  | 'retireVersion'
  | 'publishVersion'
  | 'deactivateStep';

/**
 * The numbers an impact sentence can use. Every one is optional: a number the API did not return is `null` or absent and its sentence
 * is left out (never a made-up "0"); a known zero is a real answer and reads as such.
 */
export interface ImpactFacts {
  /** Open tasks that use the record (task type or version). */
  openTasks?: number | null;
  /** Names the change affects: task types that lose the workflow, workflows left without a task type. */
  names?: readonly string[] | null;
  /** Workflow drafts that contain the step. */
  drafts?: number | null;
  /** Published workflow versions that use the step. */
  publishedVersions?: number | null;
  /** The version being published or retired, and the one that replaces it. */
  versionNo?: number | null;
  newVersionNo?: number | null;
  /** Publishing the workflow's first version: there are no running tasks to keep, and `usableTaskTypes` task types become usable. */
  firstVersion?: boolean;
  usableTaskTypes?: number | null;
}

export interface Impact {
  /** The sentence(s) for the dialog; empty when nothing is known. */
  text: string;
  /** The names to list under the sentence (empty when none). */
  names: string[];
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const known = (n: number | null | undefined): n is number => typeof n === 'number' && n >= 0;

/** The one place that turns counts into the impact sentence of a deactivate, retire or publish dialog. */
export function impactLine(kind: ImpactKind, facts: ImpactFacts): Impact {
  const names = facts.names?.length ? [...facts.names] : [];
  const parts: string[] = [];
  const open = facts.openTasks;
  switch (kind) {
    case 'deactivateTaskType':
      if (known(open)) {
        parts.push(
          open === 0
            ? 'No open tasks use this task type.'
            : `${plural(open, 'open task keeps', 'open tasks keep')} this type.`,
        );
      }
      if (names.length > 0) {
        parts.push(
          `${plural(names.length, 'workflow is', 'workflows are')} left without a task type.`,
        );
      }
      break;
    case 'deactivateWorkflow':
      if (names.length > 0) {
        parts.push(`${plural(names.length, 'task type loses', 'task types lose')} this workflow.`);
      }
      if (known(open)) {
        parts.push(
          open === 0
            ? 'No open tasks run on it.'
            : `${plural(open, 'open task keeps', 'open tasks keep')} running on it.`,
        );
      }
      break;
    case 'retireVersion': {
      const on = facts.versionNo ? `v${facts.versionNo}` : 'this version';
      if (names.length > 0) parts.push(`${dependents(names)} no other published workflow.`);
      if (known(open) && open > 0) {
        parts.push(`${plural(open, 'open task keeps', 'open tasks keep')} running on ${on}.`);
      }
      parts.push('New tasks cannot use it.');
      break;
    }
    case 'publishVersion': {
      if (facts.firstVersion) {
        parts.push('New tasks use this version.');
        if (known(facts.usableTaskTypes) && facts.usableTaskTypes > 0) {
          parts.push(
            `This makes ${plural(facts.usableTaskTypes, 'task type', 'task types')} usable.`,
          );
        }
        break;
      }
      const old = facts.versionNo ? `v${facts.versionNo}` : 'their version';
      const count = known(open) ? ` (${open} open)` : '';
      parts.push(`Tasks already running keep ${old}${count}.`);
      parts.push(
        facts.newVersionNo
          ? `New tasks use v${facts.newVersionNo}.`
          : 'New tasks use this version.',
      );
      break;
    }
    case 'deactivateStep':
      if (known(facts.drafts)) {
        parts.push(
          facts.drafts === 0
            ? 'No workflow draft contains this step.'
            : `${plural(facts.drafts, 'workflow draft contains', 'workflow drafts contain')} this step; ${facts.drafts === 1 ? 'it keeps' : 'they keep'} it.`,
        );
      }
      if (known(facts.publishedVersions)) {
        parts.push(
          facts.publishedVersions === 0
            ? 'No published workflow version uses it.'
            : `${plural(facts.publishedVersions, 'published workflow version uses', 'published workflow versions use')} it and ${facts.publishedVersions === 1 ? 'is' : 'are'} not changed.`,
        );
      }
      break;
  }
  // The names of a retirement are part of its sentence ("A and 3 other task types ..."), so they are not listed again.
  return { text: parts.join(' '), names: kind === 'retireVersion' ? [] : names };
}

/** "A has", "A and B have", "A, B and C have", "A and 3 other task types have" (the sentence goes on with "no other published workflow"). */
function dependents(names: readonly string[]): string {
  if (names.length === 1) return `${names[0]} has`;
  if (names.length <= 3) {
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} have`;
  }
  const more = names.length - 1;
  return `${names[0]} and ${more} other task types have`;
}
