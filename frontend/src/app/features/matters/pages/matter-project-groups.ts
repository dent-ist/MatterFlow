import { ProjectResponse } from '../../../api/generated/api-client';
import { naturalCompare } from '../../../shared/ui/list-helpers';

/** The Projects tab of a Matter: active projects first, archived ones in their own (collapsible) group. */
export interface ProjectGroups {
  readonly active: ProjectResponse[];
  readonly archived: ProjectResponse[];
}

/**
 * Splits a matter's projects into Active and Archived and sorts each group in natural order by name ("Wave 7" before "Wave 15", accents and
 * case ignored; ties keep the order they came in). When the matter has more projects than one request returned (`complete` is false) the
 * server order is kept inside each group, so a cut list never looks sorted when it is not.
 */
export function groupProjects(rows: readonly ProjectResponse[], complete: boolean): ProjectGroups {
  const order = (a: ProjectResponse, b: ProjectResponse) =>
    complete ? naturalCompare(a.name, b.name) : 0;
  return {
    active: rows.filter((p) => p.isActive).sort(order),
    archived: rows.filter((p) => !p.isActive).sort(order),
  };
}
