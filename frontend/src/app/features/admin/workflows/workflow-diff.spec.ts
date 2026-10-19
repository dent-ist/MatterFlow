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
    expect(diff.shifted).toEqual([]);
    expect(diff.modeChange).toEqual({ from: 'Ordered', to: 'Unordered' });
    expect(diff.unchanged).toBe(false);
  });

  it('reports reordered steps only when ordered', () => {
    const previous = { isOrdered: true, steps: [step(1, 'A'), step(2, 'B')] };
    const swapped = [step(2, 'B'), step(1, 'A')];
    // Two steps swapped: the one that stayed is the earlier one of the new order, the other one moved.
    const swap = diffVersions(previous, { isOrdered: true, steps: swapped });
    expect(swap.moved).toEqual(['A']);
    expect(swap.unchanged).toBe(false);
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

  const many = (n: number, from = 1) =>
    Array.from({ length: n }, (_, i) => step(from + i, `Step ${from + i}`));

  it('a removal ahead of 13 steps shifts them: no Moved entries, one folded list of 13 shifted steps', () => {
    const previous = { isOrdered: true, steps: many(15) };
    const next = { isOrdered: true, steps: many(13, 3) }; // steps 1 and 2 removed
    const diff = diffVersions(previous, next);
    expect(diff.removed).toEqual(['Step 1', 'Step 2']);
    expect(diff.moved).toEqual([]);
    expect(diff.shifted).toHaveLength(13);
    expect(diff.shifted[0]).toEqual({ title: 'Step 3', from: 3, to: 1 });
    expect(diff.shifted[12]).toEqual({ title: 'Step 15', from: 15, to: 13 });
    expect(diff.added).toEqual([]);
    expect(diff.unchanged).toBe(false);
  });

  it('a removal and an addition that cancel out shift nothing; steps after an addition shift', () => {
    const previous = { isOrdered: true, steps: many(4) };
    const cancelled = diffVersions(previous, {
      isOrdered: true,
      steps: [step(2, 'Step 2'), step(3, 'Step 3'), step(4, 'Step 4'), step(9, 'New')],
    });
    // Step 1 left the top, so 2, 3 and 4 moved up one; New joined at the end.
    expect(cancelled.shifted.map((s) => s.title)).toEqual(['Step 2', 'Step 3', 'Step 4']);
    const inserted = diffVersions(previous, {
      isOrdered: true,
      steps: [
        step(1, 'Step 1'),
        step(9, 'New'),
        step(2, 'Step 2'),
        step(3, 'Step 3'),
        step(4, 'Step 4'),
      ],
    });
    expect(inserted.added).toEqual(['New']);
    expect(inserted.moved).toEqual([]);
    expect(inserted.shifted).toEqual([
      { title: 'Step 2', from: 2, to: 3 },
      { title: 'Step 3', from: 3, to: 4 },
      { title: 'Step 4', from: 4, to: 5 },
    ]);
  });

  it('a real reorder lists only the step that moved, not the steps it passed', () => {
    const previous = { isOrdered: true, steps: many(13) };
    const top = many(13);
    const toBottom = diffVersions(previous, { isOrdered: true, steps: [...top.slice(1), top[0]] });
    expect(toBottom.moved).toEqual(['Step 1']);
    expect(toBottom.shifted).toEqual([]);
    const toTop = diffVersions(previous, {
      isOrdered: true,
      steps: [top[12], ...top.slice(0, 12)],
    });
    expect(toTop.moved).toEqual(['Step 13']);
    expect(toTop.shifted).toEqual([]);
    const middle = diffVersions(previous, {
      isOrdered: true,
      steps: [top[0], top[3], top[1], top[2], ...top.slice(4)],
    });
    expect(middle.moved).toEqual(['Step 4']);
  });

  it('mixed changes: a removal, an addition, a reorder, a rule change and a mode change are told apart', () => {
    const previous = { isOrdered: true, steps: [...many(6)] };
    const next = {
      isOrdered: true,
      steps: [
        step(1, 'Step 1'),
        step(5, 'Step 5'), // moved up past 2, 3, 4
        step(3, 'Step 3', true), // skip rule changed
        step(7, 'Brand new'), // added
        step(4, 'Step 4'),
        step(6, 'Step 6'),
      ], // step 2 removed
    };
    const diff = diffVersions(previous, next);
    expect(diff.removed).toEqual(['Step 2']);
    expect(diff.added).toEqual(['Brand new']);
    expect(diff.skipRuleChanged).toEqual(['Step 3']);
    expect(diff.moved).toEqual(['Step 5']);
    // Step 3 moved up one (step 2 left above it); steps 4 and 6 keep their numbers: the removal above and the addition cancel out.
    expect(diff.shifted.map((s) => s.title)).toEqual(['Step 3']);
    expect(diff.unchanged).toBe(false);
  });

  it('an unordered version shows no moved or shifted steps (it has no position numbers)', () => {
    const diff = diffVersions(
      { isOrdered: false, steps: many(5) },
      { isOrdered: false, steps: many(3, 3) },
    );
    expect(diff.removed).toHaveLength(2);
    expect(diff.moved).toEqual([]);
    expect(diff.shifted).toEqual([]);
  });
});
