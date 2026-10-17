import { contrastRatio } from '../../../shared/ui/color-contrast';
import {
  STEP_COLORS,
  absoluteStep,
  buildMatrix,
  cellLabel,
  relativeStep,
  stepOf,
  coverageNotes,
  buildTypeRows,
  handledStatus,
  namesText,
  noneNoteText,
  notHandledBy,
  oneNoteText,
} from './coverage-model';
import { aCoverageBoard, aCoverageTypeBoard } from './users-testing';

const OPTS = {
  q: '',
  scale: 'absolute',
  typeOrder: 'name',
  userOrder: 'name',
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
      expect(production.status).toBe('many');
      expect(m.rows[2].people).toBe(1);
      expect(m.rows[2].status).toBe('one');
      expect(m.colTotals).toEqual([10, 2, 11, 1, 0]);
      expect(m.grand).toBe(24);
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

    it('names a zero cell for screen readers', () => {
      expect(
        cellLabel({ displayName: 'Ana B.' }, { name: 'Redaction' }, 0, 'in the last 30 days'),
      ).toBe('Ana B., Redaction: 0 completed in the last 30 days');
    });
  });

  describe('by task type', () => {
    const rows = (order: 'fewest' | 'name' | 'completed') =>
      buildTypeRows(aCoverageTypeBoard(), order).map((r) => r.type.name);

    it('orders fewest people first (ties by name), by type name or by most completed', () => {
      expect(rows('fewest')).toEqual(['Archive', 'Review', 'Production']);
      expect(rows('name')).toEqual(['Archive', 'Production', 'Review']);
      expect(rows('completed')).toEqual(['Production', 'Review', 'Archive']);
    });

    it('lists the people alphabetically, never by count, and truncates the names to five plus the rest', () => {
      const board = aCoverageTypeBoard();
      const people = ['Zed', 'Ann', 'Bea', 'Cat', 'Dan', 'Eve', 'Fay'].map((displayName, i) => ({
        userId: i + 1,
        displayName,
        isActive: true,
        completed: i === 0 ? 99 : 1,
      }));
      board.byType = [{ taskTypeId: 10, people }, ...board.byType!.slice(1)];
      const row = buildTypeRows(board, 'name').find((r) => r.type.taskTypeId === 10)!;
      expect(row.people.map((p) => p.displayName)).toEqual([
        'Ann',
        'Bea',
        'Cat',
        'Dan',
        'Eve',
        'Fay',
        'Zed',
      ]);
      expect(row.names).toEqual(['Ann', 'Bea', 'Cat', 'Dan', 'Eve']);
      expect(row.more).toBe(2);
      expect(namesText(row)).toBe('Ann, Bea, Cat, Dan, Eve, +2');
    });

    it('counts per type equal the matrix counts', () => {
      const typed = buildTypeRows(aCoverageTypeBoard(), 'name');
      const matrix = buildMatrix(aCoverageBoard(), OPTS);
      for (const r of matrix.rows) {
        const t = typed.find((x) => x.type.taskTypeId === r.type.taskTypeId)!;
        expect(t.people.reduce((n, p) => n + p.completed, 0)).toBe(r.total);
        expect(t.people.length).toBe(r.people);
        expect(t.status).toBe(r.status);
      }
    });

    it('lists the scope people who have not handled the type, by name', () => {
      const row = buildTypeRows(aCoverageTypeBoard(), 'name').find(
        (r) => r.type.taskTypeId === 10,
      )!;
      const roster = [
        { userId: 9, displayName: 'Zoe' },
        { userId: 1, displayName: 'Priya Shah' },
        { userId: 5, displayName: 'Vic Idle' },
      ];
      expect(notHandledBy(roster, row)).toEqual(['Vic Idle', 'Zoe']);
    });
  });

  describe('the two statements', () => {
    it('classifies none, one and many', () => {
      expect([0, 1, 2, 9].map(handledStatus)).toEqual(['none', 'one', 'many', 'many']);
    });

    it('separates the types nobody handled from the types handled by one person', () => {
      const types = aCoverageBoard().taskTypes.map((t) => ({ ...t }));
      types[0].peopleWhoHandledIt = 0;
      const notes = coverageNotes(types);
      expect(notes.none.map((t) => t.name)).toEqual(['Production']);
      expect(notes.one.map((t) => t.name)).toEqual(['Archive', 'Review']);
      expect(coverageNotes([]).none).toEqual([]);
    });

    it('pins the strings: no gap, no bus factor, names of types only', () => {
      expect(noneNoteText(17)).toBe('17 task types had no completed tasks in this period.');
      expect(noneNoteText(1)).toBe('1 task type had no completed tasks in this period.');
      expect(oneNoteText(['A', 'B'])).toBe(
        '2 task types were handled by only one person in this period: A, B. Consider cross-training.',
      );
      expect(oneNoteText(['A'])).toBe(
        '1 task type was handled by only one person in this period: A. Consider cross-training.',
      );
      expect(oneNoteText(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])).toContain(
        ': A, B, C, D, E, F and 2 more.',
      );
      for (const text of [noneNoteText(3), oneNoteText(['A', 'B'])]) {
        expect(text).not.toMatch(/gap|bus factor/i);
      }
    });
  });
});
