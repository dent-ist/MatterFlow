/**
 * The icon of every tab in the app (LC-10, #1058; theme guide 11.3). One concept has one icon wherever it appears: "Assets" is the database icon on
 * a Matter, a Task, a My Matters tab and a search result; "Activity", "Activities" and "History" are the history icon. The icon is a PrimeIcons class,
 * drawn decorative by `mf-tabs` (aria-hidden), so the label stays the accessible name. `MfTab.icon` is required: a tab without one does not compile.
 * A key is the tab's key or label in lower case with dashes (`used-by`); singular and plural of a record type share one entry.
 */
export const TAB_ICONS: Readonly<Record<string, string>> = {
  // Records
  summary: 'pi-home',
  overview: 'pi-home',
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
  'task-types': 'pi-tags',
  types: 'pi-tags',
  'link-roles': 'pi-link',
  fields: 'pi-sliders-h',
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
  priorities: 'pi-flag',
  'status-labels': 'pi-tag',
  'on-hold-reasons': 'pi-pause',
  'note-tags': 'pi-hashtag',
};

/** The icon of a tab concept (its key or label); an unlisted concept gets a generic bookmark, and the guard spec lists none in use. */
export function tabIcon(concept: string): string {
  const key = concept.trim().toLowerCase().replace(/\s+/g, '-');
  return TAB_ICONS[key] ?? 'pi-bookmark';
}
