/**
 * The wording of the Task Types administration dialogs (#362), in one place. The vocabulary of the review (section 3 item 5):
 * published things are **retired**, records are **deactivated**, drafts are **discarded**. The verb is in the primary button
 * ("Deactivate task type", "Publish v3", "Retire v2"), the cancel says what is kept ("Keep active", "Back to draft"), and only the
 * destructive ones are `danger`. Dialogs read this table; none spells its own title or button text.
 */
export interface DialogCopy {
  title: string;
  /** The sentence(s) under the title (the admin kit dialogs of #542; the Task Types dialogs build theirs from `impactLine`). */
  body?: string;
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

/**
 * The dialogs of the admin list kit (#542): every one has a title, a body, a confirm label and a cancel label. The safe button is the
 * cancel one ("Keep ...") and takes the default focus. The body is the `impactLine` of the same kind, so a number the API did not return
 * leaves its sentence out. Vocabulary: Deactivate/Activate everywhere; Delete only for Priorities and Link roles, only when unused, only
 * from the row overflow. Pages call `dialogCopy.deactivatePriority({ openTasks })` and never spell dialog text themselves.
 */
export const dialogCopy = {
  deactivateAssetType: (facts: ImpactFacts = {}): DialogCopy => ({
    title: 'Deactivate asset type?',
    body: impactLine('deactivateAssetType', facts).text,
    confirm: 'Deactivate asset type',
    cancel: 'Keep active',
    danger: true,
  }),
  deactivatePriority: (facts: ImpactFacts = {}): DialogCopy => ({
    title: 'Deactivate priority?',
    body: impactLine('deactivatePriority', facts).text,
    confirm: 'Deactivate priority',
    cancel: 'Keep active',
    danger: true,
  }),
  deactivateLinkRole: (facts: ImpactFacts = {}): DialogCopy => ({
    title: 'Deactivate link role?',
    body: impactLine('deactivateLinkRole', facts).text,
    confirm: 'Deactivate link role',
    cancel: 'Keep active',
    danger: true,
  }),
  deleteUnusedPriority: (facts: ImpactFacts = {}): DialogCopy => ({
    title: 'Delete priority?',
    body: impactLine('deleteUnusedPriority', facts).text,
    confirm: 'Delete priority',
    cancel: 'Keep priority',
    danger: true,
  }),
  deleteUnusedLinkRole: (facts: ImpactFacts = {}): DialogCopy => ({
    title: 'Delete link role?',
    body: impactLine('deleteUnusedLinkRole', facts).text,
    confirm: 'Delete link role',
    cancel: 'Keep link role',
    danger: true,
  }),
  /** One-line confirm; not destructive. */
  setDefaultPriority: (facts: ImpactFacts = {}): DialogCopy => ({
    title: facts.name
      ? `Make ${facts.name} the default priority?`
      : 'Make this the default priority?',
    body: impactLine('setDefaultPriority', facts).text,
    confirm: 'Set as default',
    cancel: 'Keep current default',
    danger: false,
  }),
  /** The rename dialog's helper text is the body; Cancel just closes the form. */
  renameStatusLabel: (facts: ImpactFacts = {}): DialogCopy => ({
    title: 'Rename status label',
    body: impactLine('renameStatusLabel', facts).text,
    confirm: 'Save name',
    cancel: 'Cancel',
    danger: false,
  }),
} as const;

/**
 * The one inline sentence for a delete the server refused because the record is used (409 IN_USE, #537). The page shows it once, on
 * the row's page; the toast for this expected refusal is suppressed in `toastFor`.
 */
export function refusedDeleteMessage(kind: 'priority' | 'linkRole', name: string): string {
  return kind === 'priority'
    ? `Tasks use ${name}, so it can't be deleted. Deactivate it instead.`
    : `Links use ${name}, so it can't be deleted. Deactivate it instead.`;
}

/** What a dialog is about, for `impactLine`. */
export type ImpactKind =
  | 'deactivateTaskType'
  | 'deactivateWorkflow'
  | 'retireVersion'
  | 'publishVersion'
  | 'deactivateStep'
  | 'deactivateAssetType'
  | 'deactivatePriority'
  | 'deactivateLinkRole'
  | 'deleteUnusedPriority'
  | 'deleteUnusedLinkRole'
  | 'setDefaultPriority'
  | 'renameStatusLabel';

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
  /** Assets of an asset type (#542). */
  assets?: number | null;
  /** Links that use an asset link role (#542). */
  links?: number | null;
  /** The record's own name (a priority being made the default, a status label being renamed). */
  name?: string | null;
  /** The priority that is the default now, when another one is being made the default. */
  previousName?: string | null;
  /** The code of a status label (it never changes with the name). */
  code?: string | null;
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
    case 'deactivateAssetType':
      if (known(facts.assets)) {
        parts.push(
          facts.assets === 0
            ? 'No asset has this type.'
            : `${plural(facts.assets, 'asset keeps', 'assets keep')} this type.`,
        );
      }
      parts.push("It won't be offered for new assets. You can activate it again.");
      break;
    case 'deactivatePriority':
      if (known(open)) {
        parts.push(
          open === 0
            ? 'No open task uses this priority.'
            : `${plural(open, 'open task keeps', 'open tasks keep')} this priority.`,
        );
      }
      parts.push("It won't be offered for new or changed tasks. You can activate it again.");
      break;
    case 'deactivateLinkRole':
      if (known(facts.links)) {
        parts.push(
          facts.links === 0
            ? 'No link uses this role.'
            : `${plural(facts.links, 'link keeps', 'links keep')} this role.`,
        );
      }
      parts.push("It won't be offered for new links. You can activate it again.");
      break;
    case 'deleteUnusedPriority':
      parts.push(
        known(open) && open > 0
          ? `${plural(open, 'open task uses', 'open tasks use')} this priority, so it can't be deleted. Deactivate it instead.`
          : "No task uses this priority. Deleting it can't be undone.",
      );
      break;
    case 'deleteUnusedLinkRole':
      parts.push(
        known(facts.links) && facts.links > 0
          ? `${plural(facts.links, 'link uses', 'links use')} this role, so it can't be deleted. Deactivate it instead.`
          : "No link uses this role. Deleting it can't be undone.",
      );
      break;
    case 'setDefaultPriority':
      parts.push(
        facts.name
          ? `${facts.name} is the default priority. New tasks start with it.`
          : 'New tasks start with it.',
      );
      if (facts.previousName) parts.push(`${facts.previousName} stays available.`);
      break;
    case 'renameStatusLabel':
      parts.push(
        facts.code
          ? `Only the name changes. The code ${facts.code} and every task's status stay as they are.`
          : "Only the name changes. Every task's status stays as it is.",
      );
      parts.push('The name shows in the Task Queue, My Work, the Dashboard and on task pages.');
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

/**
 * A list of names for a dialog, at most `max` (three by default) and then "and n others": `A`, `A and B`, `A, B and C`,
 * `A, B, C and 2 others` (PM decision of #379). Empty for no names.
 */
export function listNames(names: readonly string[], max = 3): string {
  if (names.length === 0) return '';
  if (names.length <= max) {
    return names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  const rest = names.length - max;
  return `${names.slice(0, max).join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'}`;
}
