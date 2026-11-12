import { AuditEventDto } from '../../api/generated/api-client';
import { parseDateOnly } from '../../core/time/time';
import { numericDate } from './numeric-date';

/** Fields recorded by the change tracker that mean nothing to a reader (keys, concurrency tokens, timestamps). */
function isTechnicalField(key: string): boolean {
  return (
    /(^|[^A-Za-z])Id$/.test(key) ||
    /Id$/.test(key) ||
    key === 'RowVersion' ||
    /Utc$/.test(key) ||
    // Which kind of thing owns a record (a form answer set belongs to a step instance): plumbing, not something a person changed.
    key === 'OwnerKind' ||
    key === 'OwnerType'
  );
}

/** True for a field-level change a reader does not need (keys, concurrency tokens, timestamps, owner plumbing). */
export function isTechnicalFieldKey(key: string | undefined | null): boolean {
  return !!key && isTechnicalField(key);
}

/** Well-known form field keys and what people call them (UAT2-14). Anything else is derived from the key. */
const KNOWN_FIELDS: Readonly<Record<string, string>> = {
  received_datetime: 'Received date and time',
  received_date: 'Received date',
  requested_at: 'Request sent',
  requestor_name: 'Requestor name',
  requestor_email: 'Requestor email',
  // Acronyms keep their capitals (UI spec 5).
  dmspath: 'DMS Path',
  dfspath: 'DFS Path',
};

/** Audit object types whose raw name means nothing to a reader. */
const OBJECT_TYPES: Readonly<Record<string, string>> = {
  FormValueSet: 'Form answers',
  StepInstance: 'Workflow step',
  StepDefinition: 'Step',
  WorkflowDefinition: 'Workflow',
  TaskAsset: 'Asset link',
  FormVersion: 'Form version',
  FormDefinition: 'Form',
  TaskStepInstance: 'Task step',
  TaskComment: 'Task comment',
  TaskAssetLink: 'Task asset link',
  TaskType: 'Task type',
  AssetType: 'Asset type',
  AssetLinkRole: 'Asset link role',
  Priority: 'Priority',
  PodMember: 'Pod member',
  StatusLabel: 'Status label',
  AppUser: 'User',
  CustomField: 'Custom field',
};

/** Event codes whose plain sentence case reads wrong. */
const EVENT_TYPES: Readonly<Record<string, string>> = {
  FIELD_CHANGED: 'Field changed',
  TASK_TYPE_WORKFLOWS_CHANGED: 'Task type workflows changed',
  FORM_PUBLISHED: 'Form published',
  FORM_RETIRED: 'Form retired',
  MATTER_SENSITIVITY_CHANGED: 'Matter sensitivity changed',
  MATTER_TYPE_CHANGED: 'Matter Types changed',
  MATTER_STATE_CHANGED: 'Current State changed',
  MATTER_TEAM_MEMBER_ADDED: 'Team member added',
  MATTER_TEAM_MEMBER_CHANGED: 'Team member updated',
  MATTER_TEAM_MEMBER_REMOVED: 'Team member removed',
  ASSET_NEXT_NUMBER_SET: 'Asset next number set',
  ASSET_NUMBER_ASSIGNED: 'Asset number assigned',
};

/** `COMMENT_ADDED` -> `Comment added`, `TASK_STATUS_CHANGED` -> `Task status changed` (the code stays the option's value, #650). */
export function eventTypeLabel(code: string): string {
  const known = EVENT_TYPES[code];
  if (known) return known;
  const words = code.replace(/_/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `FormValueSet` -> `Form answers`, `TaskType` -> `Task type`; unknown names are split into words. */
export function objectTypeLabel(type: string): string {
  return OBJECT_TYPES[type] ?? type.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/** Replaces internal field keys (`received_datetime`) inside a sentence with their labels. */
export function friendlyText(text: string | undefined | null): string {
  if (!text) return '';
  return (
    text
      // The server's generic field label lowercases an acronym ("Dms path set to ..."): the two path fields read DMS Path and DFS Path.
      .replace(/^(Dms|Dfs) path\b/, (_m, a: string) => `${a.toUpperCase()} Path`)
      .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, (key) => fieldLabel(`form:${key}`))
      .replace(
        /\b(?:FormValueSet|StepInstance|TaskStepInstance|TaskAsset|AssetType|AssetLinkRole|StepDefinition|WorkflowDefinition|TaskType|StatusLabel|CustomField)\b/g,
        (type, offset: number) => {
          const label = objectTypeLabel(type);
          return offset === 0 ? label : label.toLowerCase();
        },
      )
  );
}

/** `IsSensitive` -> `Sensitive`, `form:billing_code` -> `Billing code`, `ClientNumber` -> `Client number`. */
export function fieldLabel(key: string | undefined): string {
  if (!key) return 'Field';
  const bare = key.startsWith('form:') ? key.slice(5) : key;
  const known = KNOWN_FIELDS[bare.toLowerCase()];
  if (known) return known;
  const raw = key.startsWith('form:')
    ? bare.replace(/_/g, ' ')
    : bare.includes('_')
      ? bare.replace(/_/g, ' ')
      : key;
  const words = raw
    .replace(/^(Is|Has)(?=[A-Z])/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The numbering scope is stored as a number (1 = per matter, #1297): the Activity drawer says the word. */
const NUMBERING_SCOPES: Readonly<Record<string, string>> = { '1': 'Per matter' };

/** The value of a field-change line: the numbering scope in words, everything else through `auditValue`. */
export function fieldChangeValue(
  fieldKey: string | undefined,
  value: string | undefined | null,
): string {
  if (fieldKey?.toLowerCase() === 'numberingscope' && value && NUMBERING_SCOPES[value])
    return NUMBERING_SCOPES[value];
  return auditValue(value);
}

/** Booleans read Yes/No; a calendar date reads "10/15" ("10/15/2027" outside this year); empty reads "(empty)". */
export function auditValue(value: string | undefined | null, now: Date = new Date()): string {
  if (value === undefined || value === null || value === '') return '(empty)';
  if (/^true$/i.test(value)) return 'Yes';
  if (/^false$/i.test(value)) return 'No';
  return dateValue(value, now);
}

/** A value that is exactly a calendar date (`2026-10-15`) as "10/15" (a floating date: no zone shift, D-60); anything else as it is. */
export function dateValue(value: string, now: Date = new Date()): string {
  return parseDateOnly(value) ? numericDate(value, now, 'UTC') : value;
}

/** What a Task Activity row shows: the sentence and the before / after values with calendar dates in the app's date format (#293). */
export interface ActivityText {
  summary: string;
  oldValue: string | undefined;
  newValue: string | undefined;
}

/**
 * The server writes "Due date changed from 2026-10-15 to 2026-10-14". Only a date that IS one of the event's old or new values (the whole
 * value is a calendar date) is rewritten, in the sentence and in the values; a date-looking piece of free text (a title, a comment
 * excerpt) never is. The stored text is not changed. Without Audit.View there are no values and the sentence has no date to rewrite.
 */
export function activityText(
  e: {
    summary: string;
    oldValue?: string | null;
    newValue?: string | null;
  },
  now: Date = new Date(),
): ActivityText {
  const values = [e.oldValue, e.newValue].filter(
    (v): v is string => !!v && parseDateOnly(v) !== null,
  );
  let summary = e.summary;
  for (const token of new Set(values)) {
    summary = summary.replace(new RegExp(`(?<![\\w-])${token}(?![\\w-])`, 'g'), () =>
      numericDate(token, now, 'UTC'),
    );
  }
  return {
    summary,
    oldValue: e.oldValue ? dateValue(e.oldValue, now) : (e.oldValue ?? undefined),
    newValue: e.newValue ? dateValue(e.newValue, now) : (e.newValue ?? undefined),
  };
}

/** True for events a reader should not see (technical change-tracker noise). */
export function isNoise(e: AuditEventDto): boolean {
  return e.eventType === 'FIELD_CHANGED' && !!e.fieldKey && isTechnicalField(e.fieldKey);
}

const NOUNS: Readonly<Record<string, string>> = {
  Client: 'client',
  Matter: 'matter',
  Project: 'project',
  Asset: 'asset',
  Task: 'task',
};

/** One readable line for an audit event, without the actor and time (shown beside it). */
export function describeAuditEvent(e: AuditEventDto, actor: string): string {
  if (e.eventType.endsWith('_CREATED')) {
    return `${actor} created this ${NOUNS[e.objectType] ?? 'record'}`;
  }
  if (e.eventType === 'FIELD_CHANGED') {
    const field = fieldLabel(e.fieldKey);
    const hasOld = e.oldValue !== undefined && e.oldValue !== null && e.oldValue !== '';
    return hasOld
      ? `${field}: ${fieldChangeValue(e.fieldKey, e.oldValue)} -> ${fieldChangeValue(e.fieldKey, e.newValue)}`
      : `${field} set to ${fieldChangeValue(e.fieldKey, e.newValue)}`;
  }
  return e.summary ?? e.eventType.toLowerCase().replace(/_/g, ' ');
}
