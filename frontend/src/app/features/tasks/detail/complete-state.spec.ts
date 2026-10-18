import { completeHint, completeStateOf } from './complete-state';

const step = (id: number, status: string, satisfied: boolean) => ({
  stepInstanceId: id,
  sequenceNo: id,
  title: `Step ${id}`,
  status,
  requiredInputsSatisfied: satisfied,
});

describe('completeStateOf (#304)', () => {
  it('is ready with no steps at all, or without a workflow', () => {
    expect(completeStateOf([]).kind).toBe('ready');
    expect(completeStateOf(null).kind).toBe('ready');
    expect(completeHint(completeStateOf([]))).toBeNull();
  });

  it('is ready when every step is resolved, even if a resolved step lacks inputs', () => {
    const s = completeStateOf([step(1, 'COMPLETED', true), step(2, 'SKIPPED', false)]);
    expect(s).toMatchObject({ kind: 'ready', unresolved: 0 });
  });

  it('is ready when open steps have all their required inputs', () => {
    const s = completeStateOf([step(1, 'NOT_STARTED', true), step(2, 'IN_PROGRESS', true)]);
    expect(s).toMatchObject({ kind: 'ready', unresolved: 2 });
    expect(s.blocked).toEqual([]);
  });

  it('is blocked by open steps that need information, counted and in workflow order', () => {
    const s = completeStateOf([
      step(3, 'NOT_STARTED', false),
      step(1, 'COMPLETED', true),
      step(2, 'IN_PROGRESS', false),
      step(4, 'SKIPPED', false),
    ]);
    expect(s.kind).toBe('blocked');
    expect(s.blocked.map((b) => b.stepInstanceId)).toEqual([2, 3]);
    expect(s.unresolved).toBe(2);
    expect(completeHint(s)).toBe('2 steps need information');
  });

  it('says "1 step needs information" for a single step', () => {
    expect(completeHint(completeStateOf([step(1, 'NOT_STARTED', false)]))).toBe(
      '1 step needs information',
    );
  });
});
