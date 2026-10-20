import { firstAllowedTab } from './denial';
import { stepTabOf } from './steps/step-record';
import { tabOf } from './task-types/task-type-record';
import { workflowTabOf } from './workflows/workflow-record';

describe('denial rule: a tab address falls back to the first allowed tab', () => {
  it('keeps an allowed tab and replaces anything else by the first allowed one', () => {
    expect(firstAllowedTab('steps', ['workflows', 'steps'])).toBe('steps');
    expect(firstAllowedTab('task-types', ['workflows', 'steps'])).toBe('workflows');
    expect(firstAllowedTab(undefined, ['workflows', 'steps'])).toBe('workflows');
    expect(firstAllowedTab('x', [], 'task-types')).toBe('task-types');
    expect(() => firstAllowedTab('x', [])).toThrow();
  });

  it('applies to the tabs of the record pages', () => {
    expect(tabOf('form', false)).toBe('form');
    expect(tabOf('form', true)).toBe('overview');
    expect(tabOf('nope', false)).toBe('overview');
    expect(workflowTabOf('versions')).toBe('versions');
    expect(workflowTabOf('used-by')).toBe('overview');
    expect(stepTabOf('inputs', false)).toBe('inputs');
    expect(stepTabOf('inputs', true)).toBe('details');
    expect(stepTabOf(null, false)).toBe('details');
  });
});
