/**
 * The tab registry of the Matter page (MD-01, #1002; owner decision AQ.1): seven tabs in this order. The page builds its strip from this list,
 * filters it by the viewer's permission and reads `?tab=`. Other agents add a tab by giving its entry a component in the page's `@switch`
 * (Productions: MD-11; Notes: MD-13); until then the page shows a placeholder.
 */
export type MatterTabKey =
  'summary' | 'tasks' | 'projects' | 'assets' | 'productions' | 'notes' | 'activities';

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
  { key: 'productions', label: 'Productions', icon: 'pi-send', permission: 'Production.View' },
  { key: 'notes', label: 'Notes', icon: 'pi-file-edit', permission: 'MatterNote.View' },
  { key: 'activities', label: 'Activities', icon: 'pi-history', permission: 'Audit.View' },
];

/** The tabs a viewer gets, in order (`has` answers a permission code). */
export function visibleMatterTabs(has: (code: string) => boolean): MatterTabDef[] {
  return MATTER_TABS.filter((t) => !t.permission || has(t.permission));
}

/**
 * The tab a `?tab=` value opens among the viewer's tabs: absent, unknown or not permitted gives Summary; the old values `details` (the former
 * Overview) and `activity` (the former drawer) map to Summary and Activities.
 */
export function matterTabFromParam(
  param: string | undefined,
  available: readonly string[],
): MatterTabKey {
  const key = param === 'activity' ? 'activities' : param === 'details' ? 'summary' : param;
  const found = MATTER_TABS.find((t) => t.key === key && available.includes(t.key));
  return found ? found.key : 'summary';
}
