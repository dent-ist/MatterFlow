import type { SearchHit } from '../../api/generated/api-client';
import { hitDueText, hitIsOverdue, hitSizeText } from './search-facts';

function hit(over: Partial<SearchHit>): SearchHit {
  return {
    type: 'task',
    id: 1,
    label: 'T',
    path: '/tasks/1',
    isSensitive: false,
    isActive: true,
    status: 'IN_PROGRESS',
    ...over,
  } as SearchHit;
}

describe('search hit facts (PM v2, #885)', () => {
  const zone = 'America/Chicago';
  const now = new Date('2026-10-26T15:00:00Z');

  it('says due, overdue or ASAP for an open task and nothing for a closed one or another type', () => {
    expect(hitDueText(hit({ dueDate: '2026-10-28' }), now, zone)).toBe('Due Oct 28');
    expect(hitDueText(hit({ dueDate: '2026-10-20' }), now, zone)).toBe('Overdue Oct 20');
    expect(hitDueText(hit({ dueDate: '2027-01-05' }), now, zone)).toBe('Due Jan 5, 2027');
    expect(hitDueText(hit({}), now, zone)).toBe('ASAP');
    expect(hitDueText(hit({ status: 'COMPLETED', dueDate: '2026-10-20' }), now, zone)).toBe('');
    expect(hitDueText(hit({ type: 'asset', dueDate: '2026-10-20' }), now, zone)).toBe('');
    expect(hitIsOverdue('Overdue Oct 20')).toBe(true);
    expect(hitIsOverdue('Due Oct 28')).toBe(false);
  });

  it('reads the day of a due instant in the viewer zone', () => {
    // 03:00 UTC on the 27th is still the evening of the 26th in Chicago: due today, not overdue.
    expect(hitDueText(hit({ dueAtUtc: '2026-10-27T03:00:00Z' }), now, zone)).toBe('Due Oct 26');
  });

  it('formats the size of an asset', () => {
    expect(hitSizeText(hit({ type: 'asset', sizeValue: 412, sizeUnit: 'GB' }))).toBe('412 GB');
    expect(hitSizeText(hit({ type: 'asset' }))).toBe('');
  });
});
