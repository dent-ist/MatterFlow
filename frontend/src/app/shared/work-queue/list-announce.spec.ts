import { pageName, resultsAnnouncement } from './list-announce';

describe('pageName', () => {
  it('adds the view after the page name', () => {
    expect(pageName('Task Queue', 'Overdue')).toBe('Task Queue: Overdue');
    expect(pageName('Task Queue', null)).toBe('Task Queue');
  });
});

describe('resultsAnnouncement', () => {
  it('puts the view, the count and the range in one message', () => {
    expect(resultsAnnouncement('Overdue', 101, 1, 50)).toBe(
      'Overdue: 101 tasks, page 1 of 3, showing 1 to 50',
    );
    expect(resultsAnnouncement(null, 101, 3, 50)).toBe(
      '101 tasks, page 3 of 3, showing 101 to 101',
    );
    expect(resultsAnnouncement(null, 442, 3, 50)).toBe(
      '442 tasks, page 3 of 9, showing 101 to 150',
    );
    expect(resultsAnnouncement(null, 40, 1, 50)).toBe('40 tasks, showing 1 to 40');
  });

  it('words one and none', () => {
    expect(resultsAnnouncement('Closed', 1, 1, 50)).toBe('Closed: 1 task');
    expect(resultsAnnouncement(null, 0, 1, 50)).toBe('No tasks');
  });
});
