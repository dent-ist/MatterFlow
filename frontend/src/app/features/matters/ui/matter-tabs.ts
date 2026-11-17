/**
 * The section registry of the Matter page (MD-01, #1002; owner decision AQ.1; one continuous page since #1396): six sections in this order (the Team is a panel in the side column of the Summary, #1376, not a section).
 * The one page (`/matters/:id`, `?tab=summary`) shows them one under the other with a sticky jump strip; every other `?tab=` value opens that section's FULL VIEW (the tab page as it was, with
 * its tab strip, the Summary tab leading back to the one page). The page builds the strip and the sections from this list, filters it by the viewer's permission and reads `?tab=`.
 */
export type MatterTabKey = 'summary' | 'tasks' | 'projects' | 'assets' | 'productions' | 'notes';

export interface MatterTabDef {
  key: MatterTabKey;
  label: string;
  /** A PrimeIcons class. */
  icon: string;
  /** The permission that shows the tab; none means every viewer of the matter. */
  permission?: string;
  /** The tab shows a count in parentheses when the viewer may see what it counts. */
  counted?: boolean;
}

export const MATTER_TABS: readonly MatterTabDef[] = [
  { key: 'summary', label: 'Summary', icon: 'pi-home' },
  { key: 'tasks', label: 'Tasks', icon: 'pi-check-square', counted: true },
  {
    key: 'projects',
    label: 'Projects',
    icon: 'pi-folder',
    permission: 'Project.View',
    counted: true,
  },
  { key: 'assets', label: 'Assets', icon: 'pi-database', permission: 'Asset.View', counted: true },
  {
    key: 'productions',
    label: 'Productions',
    icon: 'pi-send',
    permission: 'Production.View',
    counted: true,
  },
  {
    key: 'notes',
    label: 'Notes',
    icon: 'pi-file-edit',
    permission: 'MatterNote.View',
    counted: true,
  },
];

/** Activities is not a section or a tab (#1404): it is an entry of the More Actions menu that opens a dialog; this is the permission that offers it. */
export const MATTER_ACTIVITIES_PERMISSION = 'Audit.View';

/** The `?tab=` values that open the Activities dialog (`activity` is the old drawer link, `activities` the former tab). */
export function isActivitiesParam(param: string | undefined | null): boolean {
  return param === 'activities' || param === 'activity';
}

/** The tabs a viewer gets, in order (`has` answers a permission code). */
export function visibleMatterTabs(has: (code: string) => boolean): MatterTabDef[] {
  return MATTER_TABS.filter((t) => !t.permission || has(t.permission));
}

/**
 * The tab a `?tab=` value opens among the viewer's tabs: absent, unknown or not permitted gives Summary; the old value `details` (the former
 * Overview) maps to Summary. `activities` and `activity` also show the one page: the page opens the Activities dialog over it (#1404).
 */
export function matterTabFromParam(
  param: string | undefined,
  available: readonly string[],
): MatterTabKey {
  const key = param === 'details' ? 'summary' : param;
  const found = MATTER_TABS.find((t) => t.key === key && available.includes(t.key));
  return found ? found.key : 'summary';
}

/** The words of a section card (D-03a): the one line after the heading, and the plural noun of the footer ("Showing 10 of 38 tasks"). */
export const MATTER_SECTION_TEXT: Readonly<Record<string, { hint: string; noun: string }>> = {
  tasks: { hint: 'Open tasks, most urgent first', noun: 'tasks' },
  projects: { hint: 'Projects group the tasks of this matter', noun: 'projects' },
  assets: { hint: 'Evidence and data sources', noun: 'assets' },
  productions: { hint: 'What is sent to and received from other parties', noun: 'productions' },
  notes: { hint: 'Most recently updated first', noun: 'notes' },
};

/** The full view of a section: today's tab page, `?tab=<key>` (the deep links of notifications, audit rows and the Summary tiles). */
export function fullViewParams(key: MatterTabKey): { tab: string } {
  return { tab: key };
}
