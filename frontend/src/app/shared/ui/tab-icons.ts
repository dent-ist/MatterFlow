/**
 * The ONE icon registry of the app (LC-10, #1058; D-17, #1133; theme guide 11.3 and 13.3). One concept has one icon wherever it appears, and the registry is keyed by concept:
 *  - `page-*` concepts are the pages: the icon of the navigation item, which is also the icon of the page tile in the page header and of every detail page of that section
 *    (`nav-items.ts` and `section-icons.ts` read these through `pageIcon`);
 *  - every other key is a tab (or a view) concept: "Assets" is the database icon on a Matter, a Task, a My Matters tab and a search result; "Activity", "Activities" and "History"
 *    are the history icon; a tab that is the same thing as a page (Task Types) reads the page's icon, so a page never shows one icon for two different things.
 * The icon is a PrimeIcons class, drawn decorative by `mf-tabs` and the page header (aria-hidden), so the label stays the accessible name; an icon-only control keeps its own accessible
 * name and tooltip. `MfTab.icon` is required: a tab without one does not compile. A key is the tab's key or label in lower case with dashes (`used-by`); singular and plural of a record
 * type share one entry. Icon sizes come from `--mf-icon-xs|sm|md|lg` only (`scripts/check-icon-sizes.mjs`).
 */
export const ICONS: Readonly<Record<string, string>> = {
  // Pages: the navigation item, the page tile and the detail pages of the section (`pageIcon`)
  'page-dashboard': 'pi-home',
  'page-my-matters': 'pi-clipboard',
  // Not `pi-user`, which is the header user button's glyph (S8, #623).
  'page-my-work': 'pi-check-square',
  'page-clients': 'pi-building',
  'page-matters': 'pi-briefcase',
  'page-projects': 'pi-folder',
  'page-assets': 'pi-database',
  'page-pod-work': 'pi-users',
  'page-task-queue': 'pi-list-check',
  'page-users': 'pi-id-card',
  'page-task-types': 'pi-file-edit',
  'page-labels': 'pi-flag',
  'page-asset-types': 'pi-tags',
  'page-custom-fields': 'pi-sliders-h',
  'page-matter-lists': 'pi-sort-alt',
  'page-reports': 'pi-chart-bar',
  // The Administration item of the same feature ("Report Setup"): a different glyph, so the two menu items differ in the icon rail too.
  'page-report-setup': 'pi-wrench',
  'page-audit-logs': 'pi-history',
  'page-settings': 'pi-cog',
  // Pages that are not a navigation item
  'page-new-task': 'pi-plus',
  'page-profile': 'pi-user-edit',
  'page-notifications': 'pi-bell',
  'page-search': 'pi-search',
  'page-access-pending': 'pi-lock',
  'page-forbidden': 'pi-ban',
  'page-not-found': 'pi-compass',
  'page-error': 'pi-exclamation-triangle',
  // Records
  summary: 'pi-home',
  overview: 'pi-home',
  // The Dashboard's own Summary tab is not the record Summary: it must not repeat the Dashboard tile (pi-home).
  'dashboard-summary': 'pi-objects-column',
  details: 'pi-info-circle',
  tasks: 'pi-check-square',
  task: 'pi-check-square',
  'linked-tasks': 'pi-check-square',
  'request-form': 'pi-file',
  permissions: 'pi-lock',
  projects: 'pi-folder',
  project: 'pi-folder',
  assets: 'pi-database',
  asset: 'pi-database',
  productions: 'pi-send',
  notes: 'pi-file-edit',
  // The Matter's Team tab and the three Matter Lists tabs (epic #1298).
  team: 'pi-address-book',
  'matter-types': 'pi-briefcase',
  'current-states': 'pi-map-marker',
  'team-titles': 'pi-address-book',
  activities: 'pi-history',
  activity: 'pi-history',
  history: 'pi-history',
  comments: 'pi-comments',
  matters: 'pi-briefcase',
  matter: 'pi-briefcase',
  client: 'pi-building',
  clients: 'pi-building',
  // Work and views
  all: 'pi-th-large',
  active: 'pi-bolt',
  'due-soon-and-overdue': 'pi-clock',
  closed: 'pi-check-circle',
  'created-by-me': 'pi-user-edit',
  unassigned: 'pi-inbox',
  'by-member': 'pi-users',
  'all-open': 'pi-list',
  calendar: 'pi-calendar',
  metrics: 'pi-chart-bar',
  // Dashboard
  breakdowns: 'pi-chart-pie',
  trends: 'pi-chart-line',
  swimlane: 'pi-table',
  lane: 'pi-table',
  users: 'pi-user',
  // Workflows, task types, steps, forms
  workflow: 'pi-sitemap',
  workflows: 'pi-sitemap',
  steps: 'pi-list',
  inputs: 'pi-inbox',
  'used-by': 'pi-link',
  versions: 'pi-clone',
  // The Task Types tab is the Task Types page's own icon (it was pi-tags, the Asset Types icon of the menu).
  'task-types': 'pi-file-edit',
  // Asset types (the Asset Types page and its tab): pi-tags.
  types: 'pi-tags',
  'asset-types': 'pi-tags',
  'link-roles': 'pi-link',
  fields: 'pi-sliders-h',
  // Asset type numbering (#1297).
  numbering: 'pi-hashtag',
  form: 'pi-file',
  // Reports
  reports: 'pi-file',
  categories: 'pi-folder-open',
  query: 'pi-code',
  parameters: 'pi-sliders-v',
  runs: 'pi-play',
  'run-log': 'pi-play',
  assignments: 'pi-share-alt',
  health: 'pi-heart',
  // People and settings
  roles: 'pi-shield',
  pods: 'pi-users',
  branding: 'pi-palette',
  // Settings > Dashboard (epic #1063): the gauge's working hours.
  dashboard: 'pi-gauge',
  // Settings > Holidays (epic #1074): the flag of the holiday chips.
  holidays: 'pi-flag',
  priorities: 'pi-flag',
  'status-labels': 'pi-tag',
  'on-hold-reasons': 'pi-pause',
  'note-tags': 'pi-hashtag',
};

/** The icon of a tab concept (its key or label); an unlisted concept gets a generic bookmark, and the guard spec lists none in use. */
export function tabIcon(concept: string): string {
  const key = concept.trim().toLowerCase().replace(/\s+/g, '-');
  return ICONS[key] ?? 'pi-bookmark';
}

/** The icon of a page (`pageIcon('dashboard')`), as the classes the navigation and the page tile draw (`pi pi-home`). */
export function pageIcon(page: string): string {
  const icon = ICONS['page-' + page];
  if (!icon) throw new Error(`No page icon registered for "${page}"`);
  return 'pi ' + icon;
}
