import { Route, Routes } from '@angular/router';
import { ACCESS_PENDING_ROUTES } from '../../features/access-pending/access-pending.routes';
import { ADMIN_ROUTES } from '../../features/admin/admin.routes';
import { TASK_TYPE_ROUTES } from '../../features/admin/task-types/task-types.routes';
import { ASSETS_ROUTES } from '../../features/assets/assets.routes';
import { CLIENTS_ROUTES } from '../../features/clients/clients.routes';
import { DASHBOARD_ROUTES } from '../../features/dashboard/dashboard.routes';
import { MATTERS_ROUTES } from '../../features/matters/matters.routes';
import { MY_MATTERS_ROUTES } from '../../features/my-matters/my-matters.routes';
import { MY_WORK_ROUTES } from '../../features/my-work/my-work.routes';
import { NOTIFICATIONS_ROUTES } from '../../features/notifications/notifications.routes';
import { POD_WORK_ROUTES } from '../../features/pod-work/pod-work.routes';
import { PROFILE_ROUTES } from '../../features/profile/profile.routes';
import { PROJECTS_ROUTES } from '../../features/projects/projects.routes';
import { SEARCH_ROUTES } from '../../features/search/search.routes';
import { SYSTEM_ROUTES } from '../../features/system/system.routes';
import { TASKS_ROUTES } from '../../features/tasks/tasks.routes';
import { routes as APP_ROUTES } from '../../app.routes';
import { documentTitle, pageTab } from './page-title';

/**
 * The document-title rule (S21, #606): `<Page or record>: <Tab or view> - MatterFlow`. One table lists every route (the static title, or
 * the title function for the tabbed pages with the parameters that pick the tab) with the title the tab shows; a second check fails any
 * route title that still puts a hyphen between page and tab. Record pages set their own title (`recordTitle`, tested in
 * `page-title.spec.ts`); the route title is what shows until the record has loaded.
 */
interface Row {
  /** Route set the route sits in (for the failure message). */
  set: string;
  routes: Routes;
  /** `path` of the route, or `matcher` name for matcher routes. */
  key: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  /** The full document title. */
  title: string;
}

type TitleFn = (route: {
  params: Record<string, string>;
  queryParams: Record<string, string>;
}) => string;

function find(routes: Routes, key: string): Route {
  const route = routes.find((r) => (r.path ?? (r.matcher ? r.matcher.name : '')) === key);
  if (!route) throw new Error(`No route "${key}"`);
  return route;
}

function titleOf(row: Row): string {
  const route = find(row.routes, row.key);
  const t = route.title as string | TitleFn | undefined;
  const text =
    typeof t === 'function'
      ? t({ params: row.params ?? {}, queryParams: row.query ?? {} })
      : (t as string | undefined);
  return documentTitle(text);
}

const ADMIN = (key: string, title: string, extra: Partial<Row> = {}): Row => ({
  set: 'admin',
  routes: ADMIN_ROUTES,
  key,
  title,
  ...extra,
});

const TABLE: Row[] = [
  { set: 'app', routes: APP_ROUTES, key: 'error', title: 'Error - MatterFlow' },
  {
    set: 'access-pending',
    routes: ACCESS_PENDING_ROUTES,
    key: '',
    title: 'Access pending - MatterFlow',
  },
  { set: 'dashboard', routes: DASHBOARD_ROUTES, key: '', title: 'Dashboard - MatterFlow' },
  { set: 'my-matters', routes: MY_MATTERS_ROUTES, key: '', title: 'My Matters - MatterFlow' },
  { set: 'my-work', routes: MY_WORK_ROUTES, key: '', title: 'My Work - MatterFlow' },
  { set: 'tasks', routes: TASKS_ROUTES, key: '', title: 'Task Queue - MatterFlow' },
  { set: 'tasks', routes: TASKS_ROUTES, key: 'new', title: 'Create task - MatterFlow' },
  { set: 'tasks', routes: TASKS_ROUTES, key: ':id', title: 'Task - MatterFlow' },
  { set: 'assets', routes: ASSETS_ROUTES[0].children ?? [], key: '', title: 'Assets - MatterFlow' },
  {
    set: 'assets',
    routes: ASSETS_ROUTES[0].children ?? [],
    key: 'new',
    title: 'New asset - MatterFlow',
  },
  {
    set: 'assets',
    routes: ASSETS_ROUTES[0].children ?? [],
    key: ':assetId/edit',
    title: 'Edit asset - MatterFlow',
  },
  {
    set: 'assets',
    routes: ASSETS_ROUTES[0].children ?? [],
    key: ':assetId',
    title: 'Asset - MatterFlow',
  },
  { set: 'pod-work', routes: POD_WORK_ROUTES, key: '', title: 'Pod Work - MatterFlow' },
  { set: 'clients', routes: CLIENTS_ROUTES, key: '', title: 'Clients - MatterFlow' },
  { set: 'clients', routes: CLIENTS_ROUTES, key: 'new', title: 'New client - MatterFlow' },
  {
    set: 'clients',
    routes: CLIENTS_ROUTES,
    key: ':clientId/edit',
    title: 'Edit client - MatterFlow',
  },
  { set: 'clients', routes: CLIENTS_ROUTES, key: ':clientId', title: 'Client - MatterFlow' },
  { set: 'matters', routes: MATTERS_ROUTES, key: '', title: 'Matters - MatterFlow' },
  { set: 'matters', routes: MATTERS_ROUTES, key: 'new', title: 'New matter - MatterFlow' },
  {
    set: 'matters',
    routes: MATTERS_ROUTES,
    key: ':matterId/edit',
    title: 'Edit matter - MatterFlow',
  },
  { set: 'matters', routes: MATTERS_ROUTES, key: ':matterId', title: 'Matter - MatterFlow' },
  { set: 'projects', routes: PROJECTS_ROUTES, key: '', title: 'Projects - MatterFlow' },
  { set: 'projects', routes: PROJECTS_ROUTES, key: 'new', title: 'New project - MatterFlow' },
  {
    set: 'projects',
    routes: PROJECTS_ROUTES,
    key: ':projectId/edit',
    title: 'Edit project - MatterFlow',
  },
  { set: 'projects', routes: PROJECTS_ROUTES, key: ':projectId', title: 'Project - MatterFlow' },
  { set: 'profile', routes: PROFILE_ROUTES, key: '', title: 'My profile - MatterFlow' },
  {
    set: 'notifications',
    routes: NOTIFICATIONS_ROUTES,
    key: '',
    title: 'Notifications - MatterFlow',
  },
  { set: 'search', routes: SEARCH_ROUTES, key: '', title: 'Search results - MatterFlow' },
  { set: 'system', routes: SYSTEM_ROUTES, key: '403', title: 'No access - MatterFlow' },
  { set: 'system', routes: SYSTEM_ROUTES, key: '404', title: 'Page not found - MatterFlow' },
  { set: 'system', routes: SYSTEM_ROUTES, key: '**', title: 'Page not found - MatterFlow' },
  // Administration: the tabbed pages carry the open tab after a colon.
  ADMIN('usersRolesMatcher', 'Users - MatterFlow', { params: { tab: 'users' } }),
  ADMIN('usersRolesMatcher', 'Users: Roles - MatterFlow', { params: { tab: 'roles' } }),
  ADMIN('usersRolesMatcher', 'Users: Pods - MatterFlow', { params: { tab: 'pods' } }),
  ADMIN('taskTypesTabsMatcher', 'Task Types - MatterFlow', { params: { tab: 'task-types' } }),
  ADMIN('taskTypesTabsMatcher', 'Task Types: Workflows - MatterFlow', {
    params: { tab: 'workflows' },
  }),
  ADMIN('taskTypesTabsMatcher', 'Task Types: Workflow Steps - MatterFlow', {
    params: { tab: 'steps' },
  }),
  ADMIN('workflows/new', 'Task Types: New workflow - MatterFlow'),
  ADMIN('asset-types', 'Asset Types - MatterFlow'),
  ADMIN('asset-types', 'Asset Types: Link Roles - MatterFlow', { query: { tab: 'link-roles' } }),
  ADMIN('custom-fields', 'Custom Fields - MatterFlow'),
  ADMIN('labelsTabsMatcher', 'Labels: Priorities - MatterFlow', { params: { tab: 'priorities' } }),
  ADMIN('labelsTabsMatcher', 'Labels: Status labels - MatterFlow', {
    params: { tab: 'status-labels' },
  }),
  ADMIN('reports', 'Reports - MatterFlow'),
  ADMIN('reports', 'Reports: Categories - MatterFlow', { query: { tab: 'categories' } }),
  ADMIN('reports', 'Reports: Run log - MatterFlow', { query: { tab: 'runs' } }),
  ADMIN('reports', 'Reports: Assignments - MatterFlow', { query: { tab: 'assignments' } }),
  ADMIN('reports', 'Reports: Settings - MatterFlow', { query: { tab: 'health' } }),
  ADMIN('audit', 'Audit Logs - MatterFlow'),
  {
    set: 'task-types',
    routes: TASK_TYPE_ROUTES[0].children ?? [],
    key: 'new',
    title: 'New task type - MatterFlow',
  },
];

/** Every title a route in these sets can produce, collected without the table, to check the rule on all of them. */
function allTitles(): { where: string; title: string }[] {
  const sets: [string, Routes][] = [
    ['app', APP_ROUTES],
    ['admin', ADMIN_ROUTES],
    ['task-types', TASK_TYPE_ROUTES[0].children ?? []],
    ['assets', ASSETS_ROUTES[0].children ?? []],
    ['clients', CLIENTS_ROUTES],
    ['matters', MATTERS_ROUTES],
    ['projects', PROJECTS_ROUTES],
    ['tasks', TASKS_ROUTES],
    ['system', SYSTEM_ROUTES],
  ];
  const out: { where: string; title: string }[] = [];
  const tabs = [
    'users',
    'roles',
    'pods',
    'task-types',
    'workflows',
    'steps',
    'priorities',
    'status-labels',
  ];
  const queryTabs = ['link-roles', 'categories', 'runs', 'assignments', 'health', 'other'];
  for (const [name, routes] of sets) {
    for (const r of routes) {
      const t = r.title as string | TitleFn | undefined;
      const where = `${name}:${r.path ?? r.matcher?.name ?? ''}`;
      if (typeof t === 'string') out.push({ where, title: t });
      else if (typeof t === 'function') {
        for (const tab of tabs)
          out.push({ where: `${where}[${tab}]`, title: t({ params: { tab }, queryParams: {} }) });
        for (const tab of queryTabs)
          out.push({
            where: `${where}[?tab=${tab}]`,
            title: t({ params: {}, queryParams: { tab } }),
          });
      }
    }
  }
  return out;
}

describe('document titles by route (S21, #606)', () => {
  it('pageTab joins page and tab with a colon', () => {
    expect(pageTab('Users', 'Roles')).toBe('Users: Roles');
    expect(documentTitle(pageTab('Task Types', 'New workflow'))).toBe(
      'Task Types: New workflow - MatterFlow',
    );
  });

  for (const row of TABLE) {
    const tab = row.params?.['tab'] ?? row.query?.['tab'];
    it(`${row.set} ${row.key || '(root)'}${tab ? ` [${tab}]` : ''} shows "${row.title}"`, () => {
      expect(titleOf(row)).toBe(row.title);
    });
  }

  it('no route title has a hyphen between page and tab', () => {
    const titles = allTitles();
    expect(titles.length).toBeGreaterThan(60);
    const hyphenated = titles.filter((t) => /\S - \S/.test(t.title));
    expect(hyphenated).toEqual([]);
  });
});
