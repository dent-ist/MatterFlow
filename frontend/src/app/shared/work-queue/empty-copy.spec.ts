import { partsText } from '../ui/copy-parts';
import { emptyCopy, nearEmptyCopy, queueEmpty } from './empty-copy';

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

describe('queueEmpty', () => {
  it('says the good news of an empty view, with no Clear filters', () => {
    const texts: Record<string, string> = {
      unassigned: 'Every open task has an owner.',
      overdue: 'Nothing is overdue.',
      dueSoon: 'Nothing is due in the next 2 days.',
      asap: 'No ASAP tasks.',
      onHold: 'Nothing is on hold.',
      myPod: 'Your pod has no open tasks.',
      recentlyCompleted: 'Nothing was completed in the last 30 days.',
      createdByMe: 'You have no open tasks you created.',
    };
    for (const [view, text] of Object.entries(texts)) {
      const e = queueEmpty(view, true, true);
      expect(e.text).toBe(text);
      expect(e.noMatch).toBe(false);
      expect(e.createTask).toBe(view === 'createdByMe');
    }
  });

  it('offers Create task on Created by me only with Task.Create', () => {
    expect(queueEmpty('createdByMe', true, false).createTask).toBe(false);
  });

  it('uses the generic text with Clear filters for other filters', () => {
    expect(queueEmpty(null, true, true)).toEqual({
      text: 'No tasks match these filters.',
      noMatch: true,
      createTask: false,
    });
  });

  it('says "No tasks yet." with Create task only for someone who may create', () => {
    expect(queueEmpty(null, false, true)).toEqual({
      text: 'No tasks yet.',
      noMatch: false,
      createTask: true,
    });
    expect(queueEmpty(null, false, false).createTask).toBe(false);
  });
});
