import { AuditEventDto } from '../../api/generated/api-client';
import {
  auditValue,
  describeAuditEvent,
  fieldLabel,
  friendlyText,
  isNoise,
  isTechnicalFieldKey,
  objectTypeLabel,
} from './audit-format';

const event = (extra: Partial<AuditEventDto>): AuditEventDto =>
  ({
    auditEventId: 1,
    occurredAtUtc: '2026-10-14T11:08:00Z',
    eventType: 'FIELD_CHANGED',
    objectType: 'Client',
    objectId: '1',
    ...extra,
  }) as AuditEventDto;

describe('audit formatting', () => {
  it('names the actor on a creation event', () => {
    expect(describeAuditEvent(event({ eventType: 'CLIENT_CREATED' }), 'ke\\kekim')).toBe(
      'ke\\kekim created this client',
    );
  });

  it('shows a boolean change as Yes/No with a readable field name', () => {
    expect(
      describeAuditEvent(
        event({ fieldKey: 'IsSensitive', oldValue: 'False', newValue: 'True' }),
        'x',
      ),
    ).toBe('Sensitive: No -> Yes');
  });

  it('describes a first value and custom fields', () => {
    expect(
      describeAuditEvent(event({ fieldKey: 'form:billing_code', newValue: 'BC-100' }), 'x'),
    ).toBe('Billing code set to BC-100');
    expect(fieldLabel('ClientNumber')).toBe('Client number');
    expect(auditValue(undefined)).toBe('(empty)');
  });

  it('hides technical fields', () => {
    expect(isNoise(event({ fieldKey: 'ClientId', newValue: '1' }))).toBe(true);
    expect(isNoise(event({ fieldKey: 'Name', newValue: 'Acme' }))).toBe(false);
  });

  it('replaces internal names inside a sentence with readable ones', () => {
    expect(friendlyText('Owner kind set to StepInstance')).toBe('Owner kind set to workflow step');
    expect(friendlyText('AssetType 8 and 3 related changes')).toBe(
      'Asset type 8 and 3 related changes',
    );
    expect(friendlyText('received_datetime changed')).toBe('Received date and time changed');
    expect(objectTypeLabel('StepInstance')).toBe('Workflow step');
    expect(isTechnicalFieldKey('OwnerKind')).toBe(true);
    expect(isTechnicalFieldKey('Name')).toBe(false);
  });
});
