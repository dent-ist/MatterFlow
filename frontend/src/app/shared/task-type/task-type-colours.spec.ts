import contract from '../../../../../contracts/task-type-colours.json';
import {
  TASK_TYPE_COLOURS,
  TASK_TYPE_COLOUR_DEFAULT_LABEL,
  isTaskTypeColour,
  taskTypeColour,
} from './task-type-colours';

describe('Task type colour palette', () => {
  it('matches the shared contract the API validates against (keys, labels, order, default label)', () => {
    expect(TASK_TYPE_COLOURS.map((c) => `${c.key}|${c.label}`)).toEqual(
      contract.colours.map((c) => `${c.key}|${c.label}`),
    );
    expect(TASK_TYPE_COLOUR_DEFAULT_LABEL).toBe(contract.defaultLabel);
  });

  it('is ten lower-case names that fit the column', () => {
    expect(TASK_TYPE_COLOURS).toHaveLength(10);
    for (const c of TASK_TYPE_COLOURS) {
      expect(c.key).toMatch(/^[a-z]+$/);
      expect(c.key.length).toBeLessThanOrEqual(20);
    }
  });

  it('accepts exact palette names only', () => {
    expect(isTaskTypeColour('teal')).toBe(true);
    expect(isTaskTypeColour('Teal')).toBe(false);
    expect(isTaskTypeColour('#00ff00')).toBe(false);
    expect(isTaskTypeColour(null)).toBe(false);
    expect(isTaskTypeColour(undefined)).toBe(false);
    expect(taskTypeColour('violet')?.label).toBe('Violet');
    expect(taskTypeColour('nope')).toBeUndefined();
  });
});
