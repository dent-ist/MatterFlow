import { SkillsMatrix, SkillsPerson } from '../../../api/generated/api-client';

export type SkillsWindow = 3 | 12;
export const AVAILABLE_NOW_STATES = ['AVAILABLE', 'OCCUPIED', 'BUSY', 'OVERLOADED'];

/** Cell intensity by count (the number is always printed; the step only helps the eye): 0 none, 1 to 2, 3 to 4, 5 to 9, 10 and more. */
export function stepOf(count: number): 0 | 1 | 2 | 3 | 4 {
  return count <= 0 ? 0 : count <= 2 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
}

/** The completed count of a person for a task type in the window (0 when the server sent no cell). */
export function countOf(
  cells: ReadonlyMap<string, { completed3Months: number; completed12Months: number }>,
  userId: number,
  typeId: number,
  window: SkillsWindow,
): number {
  const c = cells.get(`${userId}:${typeId}`);
  return c ? (window === 3 ? c.completed3Months : c.completed12Months) : 0;
}

export function cellIndex(m: SkillsMatrix): Map<string, SkillsMatrix['cells'][number]> {
  return new Map(m.cells.map((c) => [`${c.userId}:${c.taskTypeId}`, c]));
}

/** Words of the marker on a thin task type column (icon + word + tooltip, never colour alone). */
export function thinText(experienced: number, min: number): string {
  return `Thin coverage: ${experienced} ${experienced === 1 ? 'person has' : 'people have'} completed ${min} or more in 12 months.`;
}

/**
 * Growth candidates for a task type: people who have not yet built experience in it (fewer than `experiencedMin` completed in 12 months), who can take work now (not out of
 * office or off hours) and, among them, the lightest load first (then name). At most `limit`. Operational suggestion for training, not a ranking.
 */
export function growthCandidates(
  m: SkillsMatrix,
  cells: ReadonlyMap<string, { completed3Months: number; completed12Months: number }>,
  typeId: number,
  limit = 6,
): SkillsPerson[] {
  return m.people
    .filter(
      (p) =>
        AVAILABLE_NOW_STATES.includes(p.state) &&
        countOf(cells, p.userId, typeId, 12) < m.experiencedMin,
    )
    .sort((a, b) => a.load - b.load || a.displayName.localeCompare(b.displayName))
    .slice(0, limit);
}
