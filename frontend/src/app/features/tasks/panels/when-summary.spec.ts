import { whenSummaryText } from './when-summary';

describe('whenSummaryText', () => {
  const base = {
    priorityLabel: 'Normal',
    dueDate: '',
    dueTime: '',
    assigneeLabel: null,
    podName: null,
  };

  it('says ASAP and Unassigned for an empty task', () => {
    expect(whenSummaryText(base)).toBe('Normal priority, no due date (ASAP), Unassigned');
  });

  it('names the due date with a 12 hour time, the person and the Pod', () => {
    expect(
      whenSummaryText({
        ...base,
        dueDate: '2026-10-24',
        dueTime: '17:00',
        assigneeLabel: 'Kim E.',
      }),
    ).toBe('Normal priority, due Oct 24, 2026 at 5:00 PM, assigned to Kim E.');
    expect(whenSummaryText({ ...base, priorityLabel: null, podName: 'Pod A' })).toBe(
      'Default priority, no due date (ASAP), Pod A (no person)',
    );
  });

  it('writes midnight and noon as 12', () => {
    expect(whenSummaryText({ ...base, dueDate: '2026-10-24', dueTime: '00:05' })).toContain(
      'at 12:05 AM',
    );
    expect(whenSummaryText({ ...base, dueDate: '2026-10-24', dueTime: '12:30' })).toContain(
      'at 12:30 PM',
    );
  });
});
