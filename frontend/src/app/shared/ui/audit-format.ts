import { AuditEventDto } from '../../api/generated/api-client';

/** Fields recorded by the change tracker that mean nothing to a reader (keys, concurrency tokens, timestamps). */
function isTechnicalField(key: string): boolean {
  return (
    /(^|[^A-Za-z])Id$/.test(key) || /Id$/.test(key) || key === 'RowVersion' || /Utc$/.test(key)
  );
}

/** Well-known form field keys and what people call them (UAT2-14). Anything else is derived from the key. */
const KNOWN_FIELDS: Readonly<Record<string, string>> = {
  received_datetime: 'Received date and time',
  received_date: 'Received date',
  requested_at: 'Request sent',
  requestor_name: 'Requestor name',
  requestor_email: 'Requestor email',
};

/** Audit object types whose raw name means nothing to a reader. */
const OBJECT_TYPES: Readonly<Record<string, string>> = {
  FormValueSet: 'Form answers',
  FormVersion: 'Form version',
  FormDefinition: 'Form',
  TaskStepInstance: 'Task step',
  TaskComment: 'Task comment',
  TaskAssetLink: 'Task asset link',
  TaskType: 'Task type',
  AssetType: 'Asset type',
  AssetLinkRole: 'Asset link role',
  StatusLabel: 'Status label',
  AppUser: 'User',
  CustomField: 'Custom field',
};

/** `FormValueSet` -> `Form answers`, `TaskType` -> `Task type`; unknown names are split into words. */
export function objectTypeLabel(type: string): string {
  return OBJECT_TYPES[type] ?? type.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/** Replaces internal field keys (`received_datetime`) inside a sentence with their labels. */
export function friendlyText(text: string | undefined | null): string {
  if (!text) return '';
  return text.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, (key) => fieldLabel(`form:${key}`));
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

/** Booleans read Yes/No; empty reads "(empty)". */
export function auditValue(value: string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '(empty)';
  if (/^true$/i.test(value)) return 'Yes';
  if (/^false$/i.test(value)) return 'No';
  return value;
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
      ? `${field}: ${auditValue(e.oldValue)} -> ${auditValue(e.newValue)}`
      : `${field} set to ${auditValue(e.newValue)}`;
  }
  return e.summary ?? e.eventType.toLowerCase().replace(/_/g, ' ');
}
