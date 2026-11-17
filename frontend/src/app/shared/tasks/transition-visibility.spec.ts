import { TASK_TYPE_READ_ONLY, isHiddenTransition } from './transition-visibility';

describe('isHiddenTransition', () => {
  it('leaves out an action the person has no permission for and one the task type does not let them take', () => {
    expect(isHiddenTransition({ permitted: false, blockedReason: 'PERMISSION_DENIED' })).toBe(true);
    expect(isHiddenTransition({ permitted: false, blockedReason: TASK_TYPE_READ_ONLY })).toBe(true);
  });

  it('keeps an allowed action and one a matter blocks (it shows disabled with its reason)', () => {
    expect(isHiddenTransition({ permitted: true })).toBe(false);
    expect(isHiddenTransition({ permitted: false, blockedReason: 'MATTER_INACTIVE' })).toBe(false);
    expect(isHiddenTransition({ permitted: false, blockedReason: undefined })).toBe(false);
  });
});
