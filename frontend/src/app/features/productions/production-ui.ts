/** Small pure helpers of the Productions tab (labels, the Bates range, the form values), kept apart so they can be unit tested. */

export type Direction = 'OUT' | 'IN';

export const DIRECTIONS: readonly { value: Direction; label: string }[] = [
  { value: 'OUT', label: 'Produced By Us' },
  { value: 'IN', label: 'Received' },
];

export function directionLabel(direction: string): string {
  return direction === 'IN' ? 'Received' : 'Produced By Us';
}

/** "ABC000001 to ABC000250", one number when only one is known, an empty string when none. */
export function batesRange(begin?: string | null, end?: string | null): string {
  const b = begin?.trim() ?? '';
  const e = end?.trim() ?? '';
  if (b && e) return b === e ? b : `${b} to ${e}`;
  return b || e;
}

/** A whole number from a form field: empty is "none" (null), anything that is not a whole number of 0 or more is NaN. */
export function parseCount(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  return /^\d{1,9}$/.test(t) ? Number(t) : Number.NaN;
}

/** The text of a count for display, with thousands separators; a dash for none. */
export function formatCount(n?: number | null): string {
  return n === null || n === undefined ? '' : n.toLocaleString('en-US');
}

/** The party label that goes with the direction. */
export function partyLabel(direction: string): string {
  return direction === 'IN' ? 'Produced by' : 'Produced to';
}

/** One history line in words, for the field changes and the events of the audit trail. */
export function historyText(entry: {
  eventType: string;
  fieldKey?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  summary?: string | null;
}): string {
  switch (entry.eventType) {
    case 'PRODUCTION_CREATED':
      return 'created the production';
    case 'PRODUCTION_DELETED':
      return 'deleted the production';
    case 'PRODUCTION_COMMENT_ADDED':
      return `added a comment: ${entry.summary ?? ''}`.trim();
    case 'PRODUCTION_COMMENT_EDITED':
      return `edited a comment: ${entry.summary ?? ''}`.trim();
    case 'PRODUCTION_COMMENT_DELETED':
      return 'deleted a comment';
    case 'PRODUCTION_SPEC_CREATED':
      return 'created the spec';
    case 'PRODUCTION_SPEC_RETIRED':
      return 'retired the spec';
    case 'PRODUCTION_SPEC_REINSTATED':
      return 'reinstated the spec';
    case 'FIELD_CHANGED': {
      const field = fieldLabel(entry.fieldKey ?? '');
      const from = entry.oldValue || 'empty';
      const to = entry.newValue || 'empty';
      return `changed ${field} from ${from} to ${to}`;
    }
    default:
      return entry.eventType.toLowerCase().replaceAll('_', ' ');
  }
}

const FIELD_LABELS: Record<string, string> = {
  Name: 'the name',
  VolumeNo: 'the volume',
  Direction: 'the direction',
  PartyName: 'the party',
  Spec: 'the spec',
  BatesBegin: 'Bates begin',
  BatesEnd: 'Bates end',
  DocCount: 'the number of documents',
  PageCount: 'the number of pages',
  DeliveredOrDueOn: 'the delivered or due date',
  Notes: 'the notes',
  SourceOfAgreement: 'the source of the agreement',
  Description: 'the description',
  ImageFormat: 'the image format',
  ColourMode: 'the colour setting',
  TextMode: 'the text setting',
  NativesRule: 'the natives rule',
  LoadFile: 'the load file',
  MetadataFields: 'the metadata fields',
  RedactionRule: 'the redaction rule',
  PrivilegeRule: 'the privilege rule',
  DedupRule: 'the de-duplication rule',
  DateTimeRule: 'the date and time rule',
  NumberingRule: 'the numbering rule',
  DeliveryRule: 'the delivery rule',
};

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/** The metadata fields a new spec starts with (the minimum set of the mockup); the person can add or remove. */
export const METADATA_FIELDS: readonly string[] = [
  'BegBates',
  'EndBates',
  'BegAttach',
  'EndAttach',
  'Custodian',
  'AllCustodians',
  'From',
  'To',
  'CC',
  'BCC',
  'Subject',
  'DateSent',
  'DateReceived',
  'FileName',
  'FileExtension',
  'FilePath',
  'Author',
  'DateCreated',
  'DateModified',
  'MD5Hash',
  'SHA1Hash',
  'Confidentiality',
  'Redacted',
  'NativeLink',
  'TextLink',
  'PageCount',
];

export const MINIMUM_METADATA_FIELDS: readonly string[] = [
  'BegBates',
  'EndBates',
  'Custodian',
  'From',
  'To',
  'Subject',
  'DateSent',
  'FileName',
  'MD5Hash',
  'NativeLink',
  'TextLink',
];
