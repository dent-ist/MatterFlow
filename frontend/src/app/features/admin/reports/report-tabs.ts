import { AdminTab } from '../admin-tabs';

/** The tabs of the admin Reports page (issue #712); `Report.Manage` opens the page, the Assignments overview also needs `Report.Assign`. */
export const REPORT_TABS: readonly AdminTab[] = [
  {
    id: 'reports',
    label: 'Reports',
    route: '/admin/reports',
    permission: ['Report.Manage'],
    countKey: 'reports',
  },
  {
    id: 'categories',
    label: 'Categories',
    route: '/admin/reports?tab=categories',
    permission: ['Report.Manage'],
    countKey: 'categories',
  },
  { id: 'runs', label: 'Run Log', route: '/admin/reports?tab=runs', permission: ['Report.Manage'] },
  {
    id: 'assignments',
    label: 'Assignments',
    route: '/admin/reports?tab=assignments',
    permission: ['Report.Assign'],
  },
  {
    id: 'settings',
    label: 'Settings',
    route: '/admin/reports?tab=settings',
    permission: ['Report.Manage'],
    // The tab was called "health" before (its first address); a bookmark of `?tab=health` still opens it.
    aliases: ['health'],
  },
];

export type ReportAdminTab = 'reports' | 'categories' | 'runs' | 'assignments' | 'settings';

/** One line per tab, 90 characters at most (the header shows it on one line). */
export const REPORT_TAB_TEXT: Record<ReportAdminTab, string> = {
  reports:
    'SQL reports for trusted roles. A report runs for a role only after a successful preview.',
  categories:
    'Categories group the reports in the lists. They can be renamed and hidden, never deleted.',
  runs: 'Who ran or previewed which report, with which values, how it ended and how long it took.',
  assignments: 'Which role may run which report. Read-only; change it on a role or on a report.',
  settings: 'Whether reports can run, and what the read-only report login is allowed to do.',
};
