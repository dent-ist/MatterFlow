import { AuditEventDto } from '../../api/generated/api-client';
import { mfDate } from '../../core/time/time';
import {
  activityText,
  auditValue,
  dateValue,
  describeAuditEvent,
  eventTypeLabel,
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

  it('words the event and object types of the Audit filters; the code stays the value (#650)', () => {
    expect(eventTypeLabel('COMMENT_ADDED')).toBe('Comment added');
    expect(eventTypeLabel('TASK_TYPE_WORKFLOWS_CHANGED')).toBe('Task type workflows changed');
    expect(eventTypeLabel('FIELD_CHANGED')).toBe('Field changed');
    expect(eventTypeLabel('SOMETHING_NEW_HAPPENED')).toBe('Something new happened');
    expect(objectTypeLabel('AssetLinkRole')).toBe('Asset link role');
    expect(objectTypeLabel('StepInstance')).toBe('Workflow step');
    expect(objectTypeLabel('FormValueSet')).toBe('Form answers');
    expect(objectTypeLabel('FormDefinition')).toBe('Form');
    expect(objectTypeLabel('Priority')).toBe('Priority');
  });

  it('shows a calendar date as Oct 15, 2026 and leaves other values alone', () => {
    expect(auditValue('2026-10-15')).toBe('Oct 15, 2026');
    expect(dateValue('2026-02-30')).toBe('2026-02-30'); // not a real day: echoed, never guessed
    expect(dateValue('Filing 2026-10-15')).toBe('Filing 2026-10-15');
    expect(dateValue('2026-10-15T09:00:00Z')).toBe('2026-10-15T09:00:00Z');
  });

  describe('activityText (#293)', () => {
    it('rewrites the dates of a due date change in the sentence and the values', () => {
      const t = activityText({
        summary: 'Due date changed from 2026-10-15 to 2026-10-14',
        oldValue: '2026-10-15',
        newValue: '2026-10-14',
      });
      expect(t).toEqual({
        summary: 'Due date changed from Oct 15, 2026 to Oct 14, 2026',
        oldValue: 'Oct 15, 2026',
        newValue: 'Oct 14, 2026',
      });
    });

    it('reads 31 Dec and 1 Jan as the same days, in any zone (a floating date never shifts)', () => {
      for (const zone of ['America/New_York', 'Pacific/Auckland', 'UTC']) {
        expect(mfDate('2026-12-31', zone)).toBe('Dec 31, 2026');
        expect(mfDate('2027-01-01', zone)).toBe('Jan 1, 2027');
      }
      const t = activityText({
        summary: 'Due date changed from 2026-12-31 to 2027-01-01',
        oldValue: '2026-12-31',
        newValue: '2027-01-01',
      });
      expect(t.summary).toBe('Due date changed from Dec 31, 2026 to Jan 1, 2027');
    });

    it('leaves a summary without a date, and without values, unchanged', () => {
      expect(
        activityText({ summary: 'Status changed from A to B', oldValue: 'A', newValue: 'B' }),
      ).toEqual({ summary: 'Status changed from A to B', oldValue: 'A', newValue: 'B' });
      expect(activityText({ summary: 'Due date changed' })).toEqual({
        summary: 'Due date changed',
        oldValue: undefined,
        newValue: undefined,
      });
    });

    it('does not touch a date-looking piece of free text (a title, a comment excerpt)', () => {
      const title = activityText({
        summary: 'Title changed from Filing 2026-10-15 to Filing 2026-10-16',
        oldValue: 'Filing 2026-10-15',
        newValue: 'Filing 2026-10-16',
      });
      expect(title.summary).toBe('Title changed from Filing 2026-10-15 to Filing 2026-10-16');
      expect(title.oldValue).toBe('Filing 2026-10-15');
      const comment = activityText({ summary: 'Comment added: "due 2026-10-15 at the latest"' });
      expect(comment.summary).toBe('Comment added: "due 2026-10-15 at the latest"');
    });

    it('rewrites a date set from nothing and one cleared', () => {
      expect(
        activityText({ summary: 'Due date set to 2026-10-15', newValue: '2026-10-15' }).summary,
      ).toBe('Due date set to Oct 15, 2026');
    });
  });
});
