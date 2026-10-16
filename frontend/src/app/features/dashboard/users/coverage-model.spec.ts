import { contrastRatio } from '../../../shared/ui/color-contrast';
import {
  STEP_COLORS,
  absoluteStep,
  buildMatrix,
  cellLabel,
  relativeStep,
  stepOf,
  thinText,
} from './coverage-model';
import { aCoverageBoard } from './users-testing';

const OPTS = {
  q: '',
  scale: 'absolute',
  typeOrder: 'name',
  userOrder: 'name',
  gapsOnly: false,
} as const;

describe('coverage model', () => {
  describe('colour steps', () => {
    it('absolute: 0, 1-2, 3-5, 6-10 and 11 or more', () => {
      expect([0, 1, 2, 3, 5, 6, 10, 11, 80].map(absoluteStep)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    });

    it('relative: the share of the highest count in the row; zero stays zero', () => {
      expect([0, 1, 2, 3, 4].map((n) => relativeStep(n, 4))).toEqual([0, 1, 2, 3, 4]);
      expect(relativeStep(1, 100)).toBe(1);
      expect(relativeStep(5, 5)).toBe(4);
      expect(relativeStep(3, 0)).toBe(0);
      expect(stepOf(7, 'relative', 14)).toBe(2);
      expect(stepOf(7, 'absolute', 14)).toBe(3);
    });

    it('the number on every step reaches 4.5:1 and the steps get darker', () => {
      const steps = [1, 2, 3, 4] as const;
      for (const s of steps) {
        expect(
          contrastRatio(STEP_COLORS[s].fg, STEP_COLORS[s].bg),
          `step ${s}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      const light = steps.map((s) => contrastRatio(STEP_COLORS[s].bg, '#FFFFFF'));
      expect(light).toEqual([...light].sort((a, b) => a - b));
    });
  });

  describe('matrix', () => {
    it('fills in zeros, totals rows and columns, and counts the people who handled each type', () => {
      const m = buildMatrix(aCoverageBoard(), OPTS);
      expect(m.rows.map((r) => r.type.name)).toEqual(['Archive', 'Production', 'Review']);
      expect(m.cols.map((c) => c.displayName)).toEqual([
        'Priya Shah',
        'Sam Ortiz',
        'Tess Wu',
        'Uma Vee',
        'Vic Idle',
      ]);
      const production = m.rows[1];
      expect(production.cells.map((c) => c.count)).toEqual([7, 2, 11, 0, 0]);
      expect(production.total).toBe(20);
      expect(production.people).toBe(3);
      expect(production.thin).toBe(false);
      expect(m.rows[2].people).toBe(1);
      expect(m.rows[2].thin).toBe(true);
      expect(m.colTotals).toEqual([10, 2, 11, 1, 0]);
      expect(m.grand).toBe(24);
      expect(m.thinTypes).toBe(2);
    });

    it('marks a zero as a gap only for people who completed something in the period', () => {
      const m = buildMatrix(aCoverageBoard(), OPTS);
      const review = m.rows[2];
      expect(review.cells.map((c) => c.gap)).toEqual([false, true, true, true, false]); // Vic completed nothing: not a gap
      expect(m.gapCount).toBe(m.rows.reduce((n, r) => n + r.cells.filter((c) => c.gap).length, 0));
    });

    it('colours by the chosen scale', () => {
      const abs = buildMatrix(aCoverageBoard(), OPTS).rows[1].cells.map((c) => c.step);
      expect(abs).toEqual([3, 1, 4, 0, 0]);
      const rel = buildMatrix(aCoverageBoard(), { ...OPTS, scale: 'relative' }).rows[1].cells.map(
        (c) => c.step,
      );
      expect(rel).toEqual([3, 1, 4, 0, 0]); // 7/11, 2/11, 11/11
      const review = buildMatrix(aCoverageBoard(), { ...OPTS, scale: 'relative' }).rows[2].cells[0];
      expect(review.step).toBe(4); // the only one in the row is the highest of the row
      expect(buildMatrix(aCoverageBoard(), OPTS).rows[2].cells[0].step).toBe(2); // 3 completed
    });

    it('orders by name or by total (ties by name) and never reorders on a hidden score', () => {
      const m = buildMatrix(aCoverageBoard(), { ...OPTS, typeOrder: 'total', userOrder: 'total' });
      expect(m.rows.map((r) => r.type.name)).toEqual(['Production', 'Review', 'Archive']);
      expect(m.cols.map((c) => c.displayName)).toEqual([
        'Tess Wu',
        'Priya Shah',
        'Sam Ortiz',
        'Uma Vee',
        'Vic Idle',
      ]);
    });

    it('filters people by name and recomputes the totals for those shown', () => {
      const m = buildMatrix(aCoverageBoard(), { ...OPTS, q: 'sam' });
      expect(m.cols.map((c) => c.displayName)).toEqual(['Sam Ortiz']);
      expect(m.rows.find((r) => r.type.name === 'Production')!.total).toBe(2);
      expect(m.grand).toBe(2);
    });

    it('the gaps filter keeps the types with a gap and the active people who have one', () => {
      const m = buildMatrix(aCoverageBoard(), { ...OPTS, gapsOnly: true });
      expect(m.cols.map((c) => c.displayName)).toEqual([
        'Priya Shah',
        'Sam Ortiz',
        'Tess Wu',
        'Uma Vee',
      ]); // Vic completed nothing
      expect(m.rows.map((r) => r.type.name)).toEqual(['Archive', 'Production', 'Review']);
      const all = m.rows.flatMap((r) => r.cells);
      expect(all.some((c) => c.gap)).toBe(true);
      // Remove every gap: nothing is left.
      const full = aCoverageBoard({
        users: aCoverageBoard().users.slice(0, 1),
        cells: [10, 11, 12].map((taskTypeId) => ({ userId: 1, taskTypeId, completed: 2 })),
      });
      const none = buildMatrix(full, { ...OPTS, gapsOnly: true });
      expect(none.rows).toEqual([]);
      expect(none.cols).toEqual([]);
    });
  });

  describe('text', () => {
    it('names a cell as a sentence with the visible number in it', () => {
      expect(
        cellLabel(
          { displayName: 'Priya' },
          { name: 'Relativity Production' },
          7,
          'in the last 90 days',
        ),
      ).toBe('Priya: 7 Relativity Production tasks completed in the last 90 days');
      expect(
        cellLabel({ displayName: 'Priya' }, { name: 'Review' }, 1, 'in the last 30 days'),
      ).toBe('Priya: 1 Review task completed in the last 30 days');
    });

    it('says how many task types have fewer than two people', () => {
      expect(thinText(3)).toBe('3 task types have fewer than 2 people who handled them.');
      expect(thinText(1)).toBe('1 task type has fewer than 2 people who handled them.');
      expect(thinText(0)).toBe('Every task type was handled by at least 2 people.');
    });
  });
});
