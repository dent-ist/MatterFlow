import { SHOW_COUNTS_NOTE, taskTypeChipText } from './task-type-chip-text';

describe('taskTypeChipText (#978)', () => {
  const names = new Map([
    [7, 'Data Processing'],
    [8, 'Review'],
    [9, 'Production'],
  ]);

  it('names one type', () => {
    expect(taskTypeChipText([7], names)).toEqual({
      label: 'Data Processing',
      title: SHOW_COUNTS_NOTE,
    });
    expect(taskTypeChipText(['8'], names).label).toBe('Review');
  });

  it('names two types in full and says "N types" for more with every name in the tooltip', () => {
    expect(taskTypeChipText([7, 8], names).label).toBe('Data Processing, Review');
    const three = taskTypeChipText([7, 8, 9], names);
    expect(three.label).toBe('3 types');
    expect(three.title).toBe(`Data Processing, Review, Production. ${SHOW_COUNTS_NOTE}`);
  });

  it('falls back to the count until the names are known, and keeps the note about the Show counts', () => {
    expect(taskTypeChipText([7], new Map()).label).toBe('one chosen');
    expect(taskTypeChipText([7, 8], new Map()).label).toBe('2 chosen');
    expect(taskTypeChipText([7, 99], names).label).toBe('2 chosen');
    expect(taskTypeChipText([7], new Map()).title).toContain('Show counts');
  });
});
