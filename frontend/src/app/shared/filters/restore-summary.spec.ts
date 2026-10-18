import { FilterChip } from './filter-def';
import { restoreSummary } from './restore-summary';

const chip = (label: string): FilterChip => ({
  id: label,
  defKey: label.split(':')[0],
  label,
  hiddenColumn: false,
  column: undefined,
  remaining: [],
});

describe('restoreSummary', () => {
  it('names the tab and the filters in words', () => {
    expect(
      restoreSummary('Due soon and overdue', [chip('Priority: Critical'), chip('Priority: High')]),
    ).toBe('Restored your last view: Due soon and overdue, Priority Critical or High.');
  });

  it('works without a tab or without filters', () => {
    expect(restoreSummary(null, [chip('Status: Open'), chip('Pod: Pod A')])).toBe(
      'Restored your last view: Status Open, Pod Pod A.',
    );
    expect(restoreSummary('Active', [])).toBe('Restored your last view: Active.');
    expect(restoreSummary(null, [])).toBe('Restored your last view.');
  });

  it('stays near 120 characters and counts what it left out', () => {
    const chips = ['Client', 'Matter', 'Project', 'Workflow', 'Assignee', 'Creator'].map((n) =>
      chip(`${n}: A rather long value`),
    );
    const text = restoreSummary('Active', chips);
    expect(text.length).toBeLessThanOrEqual(125);
    expect(text).toMatch(/ and \d+ more\.$/);
  });

  it('names a quick view instead of listing its filters', () => {
    expect(restoreSummary(null, [chip('Overdue only')], 'Overdue')).toBe(
      'Restored your last view: Overdue.',
    );
  });

  it('keeps the chip words for filters that are not a view', () => {
    expect(restoreSummary(null, [chip('Overdue only'), chip('Priority: Critical')])).toBe(
      'Restored your last view: Overdue only, Priority Critical.',
    );
  });
});
