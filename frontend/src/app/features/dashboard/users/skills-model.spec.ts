import { cellIndex, countOf, growthCandidates, stepOf, thinText } from './skills-model';
import { aMatrix } from './users-testing';

describe('skills model', () => {
  it('steps the intensity by count and keeps zero as its own step', () => {
    expect([0, 1, 2, 3, 4, 5, 9, 10, 40].map(stepOf)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('reads a count for the window and zero without a cell', () => {
    const cells = cellIndex(aMatrix());
    expect(countOf(cells, 1, 1, 3)).toBe(12);
    expect(countOf(cells, 1, 1, 12)).toBe(40);
    expect(countOf(cells, 2, 1, 3)).toBe(0);
  });

  it('lists growth candidates: little experience, can take work now, lightest load first, never someone out of office', () => {
    const m = aMatrix();
    const cells = cellIndex(m);
    // QC (type 2): Ana has 8 (experienced), Cy is out; Ben (0 open) before Di (1 open).
    expect(growthCandidates(m, cells, 2).map((p) => p.displayName)).toEqual([
      'Ben Carter',
      'Di Eng',
    ]);
    expect(growthCandidates(m, cells, 2, 1)).toHaveLength(1);
  });

  it('says the thin marker in words', () => {
    expect(thinText(1, 5)).toBe('Thin coverage: 1 person has completed 5 or more in 12 months.');
    expect(thinText(0, 5)).toContain('0 people have');
  });
});
