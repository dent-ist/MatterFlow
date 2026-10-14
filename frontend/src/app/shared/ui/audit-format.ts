import { AuditEventDto } from '../../api/generated/api-client';

/** Fields recorded by the change tracker that mean nothing to a reader (keys, concurrency tokens, timestamps). */
function isTechnicalField(key: string): boolean {
  return /(^|[^A-Za-z])Id$/.test(key) || /Id$/.test(key) || key === 'RowVersion' || /Utc$/.test(key);
}

/** `IsSensitive` -> `Sensitive`, `form:billing_code` -> `Billing code`, `ClientNumber` -> `Client number`. */
export function fieldLabel(key: string | undefined): string {
  if (!key) return 'Field';
  const raw = key.startsWith('form:') ? key.slice(5).replace(/_/g, ' ') : key;
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
