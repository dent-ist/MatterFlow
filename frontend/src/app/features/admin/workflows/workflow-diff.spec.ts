import { diffVersions } from './workflow-diff';

const step = (id: number, title: string, skippable = false, comment = false) => ({
  sourceStepDefinitionId: id,
  title,
  isSkippable: skippable,
  skipCommentRequired: comment,
});

describe('diffVersions', () => {
  it('reports added, removed, skip-rule and mode changes', () => {
    const previous = {
      isOrdered: true,
      steps: [step(1, 'Intake'), step(2, 'Load'), step(3, 'Old')],
    };
    const next = {
      isOrdered: false,
      steps: [step(1, 'Intake'), step(2, 'Load', true, true), step(4, 'OCR')],
    };
    const diff = diffVersions(previous, next);
    expect(diff.added).toEqual(['OCR']);
    expect(diff.removed).toEqual(['Old']);
    expect(diff.skipRuleChanged).toEqual(['Load']);
    expect(diff.moved).toEqual([]);
    expect(diff.modeChange).toEqual({ from: 'Ordered', to: 'Unordered' });
    expect(diff.unchanged).toBe(false);
  });

  it('reports reordered steps only when ordered', () => {
    const previous = { isOrdered: true, steps: [step(1, 'A'), step(2, 'B')] };
    const swapped = [step(2, 'B'), step(1, 'A')];
    expect(diffVersions(previous, { isOrdered: true, steps: swapped }).moved).toEqual(['B', 'A']);
    const unordered = diffVersions(
      { ...previous, isOrdered: false },
      { isOrdered: false, steps: swapped },
    );
    expect(unordered.moved).toEqual([]);
    expect(unordered.unchanged).toBe(true);
  });

  it('treats a first publication as all added', () => {
    const diff = diffVersions(null, { isOrdered: true, steps: [step(1, 'A')] });
    expect(diff.added).toEqual(['A']);
    expect(diff.modeChange).toBeNull();
  });
});
