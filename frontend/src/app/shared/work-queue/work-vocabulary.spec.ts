import {
  CLOSED_WINDOW_DAYS,
  DUE_SOON_CAPTION,
  DUE_SOON_DAYS,
  EMPTY_TEXT,
  TAB_HELP,
  TAB_TOOLTIPS,
} from './work-vocabulary';

describe('work vocabulary (BUG-13, M5)', () => {
  it('builds every sentence from the one window length', () => {
    expect(DUE_SOON_DAYS).toBe(2);
    expect(CLOSED_WINDOW_DAYS).toBe(90);
    expect(DUE_SOON_CAPTION).toBe('Today and the next 2 days, not overdue, not ASAP');
    expect(TAB_TOOLTIPS.dueSoon).toContain('next 2 days');
    expect(TAB_HELP.dueSoon).toBe(
      'Overdue tasks plus tasks due in the next 2 days. ASAP tasks have no due date, so they are not here; find them under Active.',
    );
    expect(TAB_HELP.completed).toBe(
      'Completed or cancelled tasks from the last 90 days. Use Show older for earlier ones.',
    );
    expect(EMPTY_TEXT.dueSoon).toBe('Nothing is overdue and nothing is due in the next 2 days.');
    expect(EMPTY_TEXT.completed).toBe('No tasks were closed in the last 90 days.');
  });
});
