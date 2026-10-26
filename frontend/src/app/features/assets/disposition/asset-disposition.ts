import { BadgeTone } from '../../../shared/ui/badge';

/** The four dispositions of an asset (epic #851): the retention state of the record. The codes are what the API sends and takes. */
export type DispositionCode = 'ACTIVE' | 'INACTIVE' | 'PENDING_DISPOSITION' | 'DISPOSED';

export interface DispositionOption {
  readonly code: DispositionCode;
  readonly label: string;
  /** One line under the radio button. */
  readonly hint: string;
  readonly tone: BadgeTone;
  readonly icon: string;
}

/** In the order of a record's life. */
export const DISPOSITIONS: readonly DispositionOption[] = [
  {
    code: 'ACTIVE',
    label: 'Active',
    hint: 'In use. Can be linked to tasks and edited.',
    tone: 'success',
    icon: 'pi-check-circle',
  },
  {
    code: 'INACTIVE',
    label: 'Inactive',
    hint: 'Not in use. Keeps its history and existing task links; cannot be newly linked or edited.',
    tone: 'neutral',
    icon: 'pi-minus-circle',
  },
  {
    code: 'PENDING_DISPOSITION',
    label: 'Pending disposition',
    hint: 'Waiting for a decision to dispose of it. Cannot be newly linked or edited.',
    tone: 'warning',
    icon: 'pi-clock',
  },
  {
    code: 'DISPOSED',
    label: 'Disposed',
    hint: 'Disposed of. Final; only a correction back to Inactive is possible, with a note.',
    tone: 'danger',
    icon: 'pi-trash',
  },
];

const BY_CODE = new Map<string, DispositionOption>(DISPOSITIONS.map((d) => [d.code, d]));

export function dispositionOf(code: string | null | undefined): DispositionOption {
  return BY_CODE.get(code ?? 'ACTIVE') ?? DISPOSITIONS[0];
}

export function dispositionLabel(code: string | null | undefined): string {
  return dispositionOf(code).label;
}

/** The longest note the API takes. */
export const NOTE_MAX = 500;

/** Why an option cannot be chosen, or null when it can. The server decides the same way (`AssetDispositionRules`); this only keeps the dialog honest. */
export function whyNot(
  from: DispositionCode,
  to: DispositionCode,
  canEdit: boolean,
  canDispose: boolean,
): string | null {
  if (from === 'DISPOSED') {
    if (to !== 'INACTIVE')
      return 'A disposed asset can only be moved back to Inactive, as a correction.';
    return canDispose
      ? null
      : 'Moving a disposed asset back needs the permission to dispose assets.';
  }
  if (to === 'PENDING_DISPOSITION' || to === 'DISPOSED') {
    return canDispose ? null : 'This needs the permission to dispose assets.';
  }
  return canEdit ? null : 'This needs the permission to edit assets.';
}

/** A note is required to dispose of an asset and to correct a disposal. */
export function noteRequired(from: DispositionCode, to: DispositionCode): boolean {
  return to === 'DISPOSED' || (from === 'DISPOSED' && to === 'INACTIVE');
}

/** The impact line of the dialog: how many open tasks keep their link to an asset that is no longer Active. Null when there is nothing to say or the count is unknown. */
export function impactLine(to: DispositionCode, openTasks: number | null): string | null {
  if (to === 'ACTIVE' || openTasks === null || openTasks <= 0) return null;
  return `${openTasks} open ${openTasks === 1 ? 'task keeps' : 'tasks keep'} this link.`;
}

/** The same for a selection: how many of the selected assets are linked to open tasks. */
export function bulkImpactLine(
  to: DispositionCode,
  openCounts: readonly (number | null)[],
): string | null {
  if (to === 'ACTIVE') return null;
  const linked = openCounts.filter((n): n is number => n !== null && n > 0);
  if (linked.length === 0) return null;
  const tasks = linked.reduce((a, b) => a + b, 0);
  return `${linked.length} of the ${openCounts.length} selected ${linked.length === 1 ? 'asset is' : 'assets are'} linked to open tasks (${tasks} in all). The links stay.`;
}

/** The reason a bulk item was not changed, in plain words. */
export function bulkReason(
  code: string | null | undefined,
  message: string | null | undefined,
): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'it no longer exists';
    case 'DISPOSED_IS_FINAL':
      return 'a disposed asset can only be moved back to Inactive';
    case 'NOTE_REQUIRED':
      return 'a note is required';
    case 'PERMISSION_DENIED':
      return 'you do not have the permission';
    case 'CONCURRENCY_CONFLICT':
      return 'somebody else changed it meanwhile; reload the list';
    default:
      return message || 'it could not be changed';
  }
}
