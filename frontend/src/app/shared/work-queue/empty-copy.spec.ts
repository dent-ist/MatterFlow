import { partsText } from '../ui/copy-parts';
import { emptyCopy, nearEmptyCopy } from './empty-copy';

const has =
  (...codes: string[]) =>
  (code: string) =>
    codes.includes(code);

describe('emptyCopy', () => {
  it('names Pod Work on Active only with Pod.View and a Pod, as a link', () => {
    const c = emptyCopy({ tab: 'active', podCount: 2 }, has('Task.View', 'Pod.View'));
    expect(partsText(c.parts)).toBe(
      'Nothing is assigned to you right now. Check Pod Work for unassigned tasks.',
    );
    expect(c.parts).toContainEqual({ label: 'Pod Work', to: '/pods/work' });
  });

  it('never mentions Pod Work without Pod.View', () => {
    const c = emptyCopy({ tab: 'active', podCount: 2 }, has('Task.View'));
    expect(partsText(c.parts)).toBe('Nothing is assigned to you right now.');
  });

  it('tells a user with Pod.View and no Pod to ask an administrator', () => {
    const c = emptyCopy({ tab: 'active', podCount: 0 }, has('Task.View', 'Pod.View'));
    expect(partsText(c.parts)).toBe(
      'Nothing is assigned to you right now. You are not in a Pod yet; ask an administrator.',
    );
  });

  it('keeps the plain sentence while the Pod count is unknown', () => {
    const c = emptyCopy({ tab: 'active', podCount: null }, has('Pod.View'));
    expect(partsText(c.parts)).toBe('Nothing is assigned to you right now.');
  });

  it('does not name another screen on Due soon and overdue or Closed', () => {
    for (const tab of ['dueSoon', 'completed'] as const) {
      const text = partsText(
        emptyCopy({ tab, windowed: true, podCount: 1 }, has('Pod.View')).parts,
      );
      expect(text).not.toMatch(/Pod Work|Task Queue/);
    }
    expect(partsText(emptyCopy({ tab: 'completed', windowed: false }, has()).parts)).toBe(
      'No tasks were closed in this period.',
    );
  });

  it('offers Create task on Created by me only with Task.Create', () => {
    expect(emptyCopy({ tab: 'createdByMe' }, has('Task.Create')).createTask).toBe(true);
    const plain = emptyCopy({ tab: 'createdByMe' }, has('Task.View'));
    expect(plain.createTask).toBeUndefined();
    expect(partsText(plain.parts)).toBe('You have not created any tasks.');
  });
});

describe('nearEmptyCopy', () => {
  it('links Pod Work only with Pod.View', () => {
    expect(nearEmptyCopy(has('Pod.View'))).toContainEqual({ label: 'Pod Work', to: '/pods/work' });
    const without = nearEmptyCopy(has());
    expect(partsText(without)).toBe(
      "That's everything on your plate. Look for more in the Task Queue.",
    );
  });
});
