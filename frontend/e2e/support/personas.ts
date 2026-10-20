import { Browser, BrowserContext, Page } from '@playwright/test';
import { ADMIN_USER, BASE_URL, Json } from './api';
import { Seeder } from './seed';

/**
 * E2E personas (#596): people with a known set of permissions, created through the API, and a way to sign in as them.
 *
 * Dev authentication names the user by the `X-Dev-User` header, so "signing in" is a browser context that sends that header
 * (`signInAs`, or the `asUser` fixture with `persona.username`). Everything is created through the same admin API calls the UI makes;
 * nothing here touches production code or the database.
 *
 * ```ts
 * test('a Client.View-only person cannot create', async ({ personas, asUser }) => {
 *   const viewer = await personas.create({ permissions: ['Client.View'] });            // custom role with exactly these permissions
 *   const page = await asUser(viewer.username);
 *   ...
 * });
 *
 * const director = await personas.named('director');                                   // one of the catalogue below
 * const pending = await personas.named('pending');                                     // signed in, no role: Access Pending
 * const longName = await personas.create({ roles: ['Data Technician'], displayNameLength: 66 });
 * for (const spec of PERMISSION_VARIANTS) { const p = await personas.create(spec); ... }   // a matrix over permission sets
 * ```
 *
 * Reuse rules for other epics: add a persona to `PERSONAS` (one line: key, roles or permissions, a comment saying why it exists) rather
 * than a private helper in a spec; build a matrix by looping over `PERMISSION_VARIANTS` or your own `PersonaSpec[]`; every user the
 * helper creates has a unique account (`ke\e2e-<label>-<id>`), so specs never collide and nothing needs cleaning up.
 *
 * Also in this file: the failure and slowness helpers every shell, system-page and state test needs (`failMe`, `failApi`, `delayApi`,
 * `goOffline`), and `SHELL_ROUTES`, the table of the routes the App shell review measured.
 */

/** What to create. Give `roles` (built-in or existing role names), `permissions` (a new custom role with exactly these codes), or neither (Access Pending). */
export interface PersonaSpec {
  /** Part of the account name, so a failing test points at its user (`ke\e2e-<label>-<id>`). */
  label?: string;
  /** Built-in or previously created role names granted to the user. */
  roles?: readonly string[];
  /** Permission codes for one new custom role granted to the user (in addition to `roles`). */
  permissions?: readonly string[];
  /** Replaces the display name (the Dev-auth name is the account name otherwise). */
  displayName?: string;
  /** A display name of exactly this many characters (a long name: header clamp tests). Ignored when `displayName` is given. */
  displayNameLength?: number;
  /** The account is disabled after creation (the disabled-account page). */
  disabled?: boolean;
}

export interface Persona {
  /** The `X-Dev-User` value; pass it to `asUser`, `Api.as` or `signInAs`. */
  username: string;
  userId: number;
  /** Everything granted: the roles given plus the custom role created for `permissions`. */
  roleNames: string[];
  /** The permission codes of the custom role, when one was created. */
  permissions: string[];
  displayName: string | null;
}

/** The catalogue: the people the App shell review used. Add more here. */
export const PERSONAS = {
  /** Oversight role with every Dashboard tab: lands on the Dashboard once S4a is built. */
  director: { label: 'director', roles: ['Director'] },
  readOnlyObserver: { label: 'observer', roles: ['Read-Only Observer'] },
  complianceAuditor: { label: 'auditor', roles: ['Compliance Auditor'] },
  /** Technician; give the user a pod with `Seeder.pod` to land on My Work. */
  technician: { label: 'tech', roles: ['Data Technician'] },
  podLead: { label: 'podlead', roles: ['Pod Lead'] },
  /** Takes in work: creates tasks and records, sees the lists, cannot manage anything. */
  intakeCoordinator: {
    label: 'intake',
    permissions: [
      'Task.View',
      'Task.Create',
      'Task.Comment',
      'Client.View',
      'Matter.View',
      'Project.View',
      'Asset.View',
      'Pod.View',
      'Dashboard.View',
      'Dashboard.ViewUnassigned',
    ],
  },
  /** Sets up task types, workflows, steps and labels, but works no tasks. */
  configurationAdmin: {
    label: 'config',
    permissions: [
      'TaskType.Manage',
      'Workflow.Manage',
      'CustomField.Manage',
      'Priority.Manage',
      'StatusLabel.Manage',
      'AssetType.Manage',
    ],
  },
  clientViewOnly: { label: 'clientview', permissions: ['Client.View'] },
  taskViewOnly: { label: 'taskview', permissions: ['Task.View', 'Matter.View', 'Client.View'] },
  userManageOnly: { label: 'usermanage', permissions: ['User.View', 'User.Manage'] },
  /** Sees Pod Work's permission but not tasks (Pod Work epic BUG-5). */
  podViewWithoutTaskView: { label: 'podview', permissions: ['Pod.View'] },
  /** Signed in once, no role: Access Pending. */
  pending: { label: 'pending' },
  /** Had a role, then was disabled: the disabled-account page. */
  disabled: { label: 'disabled', roles: ['Data Technician'], disabled: true },
  /** A 66-character display name (header and menu clamp tests). */
  longName: { label: 'longname', roles: ['Data Technician'], displayNameLength: 66 },
} as const satisfies Record<string, PersonaSpec>;

export type PersonaKey = keyof typeof PERSONAS;

/** A ready-made matrix for "who may see this" tests: one entry per kind of person the permission checks distinguish. */
export const PERMISSION_VARIANTS: readonly (PersonaSpec & { key: string })[] = [
  { key: 'technician', ...PERSONAS.technician },
  { key: 'director', ...PERSONAS.director },
  { key: 'readOnlyObserver', ...PERSONAS.readOnlyObserver },
  { key: 'complianceAuditor', ...PERSONAS.complianceAuditor },
  { key: 'intakeCoordinator', ...PERSONAS.intakeCoordinator },
  { key: 'clientViewOnly', ...PERSONAS.clientViewOnly },
  { key: 'taskViewOnly', ...PERSONAS.taskViewOnly },
  { key: 'pending', ...PERSONAS.pending },
];

export class Personas {
  constructor(private readonly seed: Seeder) {}

  /** Creates the user (and the custom role) described by the spec. */
  async create(spec: PersonaSpec = {}): Promise<Persona> {
    const roleNames = [...(spec.roles ?? [])];
    const permissions = [...(spec.permissions ?? [])];

    if (permissions.length > 0) {
      const role = await this.seed.role(permissions, `E2E ${spec.label ?? 'persona'}`);
      roleNames.push(role.name);
    }
    const user = await this.seed.user(roleNames, spec.label ?? 'persona');
    const displayName =
      spec.displayName ??
      (spec.displayNameLength ? longName(spec.displayNameLength, spec.label ?? 'Persona') : null);
    if (displayName !== null) await this.setProfile(user.userId, { displayName });
    if (spec.disabled) await this.setActive(user.userId, false);
    return { ...user, roleNames, permissions, displayName };
  }

  /** One of the catalogue's people. `overrides` replaces fields of the catalogue entry. */
  named(key: PersonaKey, overrides: Partial<PersonaSpec> = {}): Promise<Persona> {
    return this.create({ ...(PERSONAS[key] as PersonaSpec), ...overrides });
  }

  async setActive(userId: number, isActive: boolean): Promise<void> {
    const detail = await this.seed.admin.get<Json>(`/api/v1/users/${userId}`);
    await this.seed.admin.put(`/api/v1/users/${userId}/status`, {
      isActive,
      rowVersion: detail.rowVersion,
    });
  }

  async setProfile(userId: number, profile: { displayName: string }): Promise<void> {
    const detail = await this.seed.admin.get<Json>(`/api/v1/users/${userId}`);
    await this.seed.admin.put(`/api/v1/users/${userId}`, {
      displayName: profile.displayName,
      email: detail.email ?? null,
      rowVersion: detail.rowVersion,
    });
  }
}

/** A readable name of exactly `length` characters ("Persona Quartermain Featherstonehaugh ..."). */
export function longName(length: number, prefix = 'Persona'): string {
  const words = [
    'Featherstonehaugh',
    'Cholmondeley',
    'Wolfeschlegelstein',
    'Montgomerie',
    'Beauchamp',
  ];
  let name = prefix;
  for (let i = 0; name.length < length; i++) name += ` ${words[i % words.length]}`;
  return name.slice(0, length).trimEnd().padEnd(length, 'x');
}

/** Opens a page in a fresh browser context signed in as `username` (Dev auth). The caller closes `page.context()`; the `asUser` fixture does it for you. */
export async function signInAs(
  browser: Browser,
  username: string,
  options: { width?: number; height?: number; timezoneId?: string } = {},
): Promise<Page> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    locale: 'en-US',
    timezoneId: options.timezoneId ?? 'America/New_York',
    viewport: { width: options.width ?? 1440, height: options.height ?? 900 },
    extraHTTPHeaders: { 'X-Dev-User': username },
  });
  return context.newPage();
}

/** The System Admin the stack bootstraps (use with `signInAs`). */
export const SYSTEM_ADMIN = ADMIN_USER;

// --- failures, slowness and offline -----------------------------------------------------------------------------------------------

const PROBLEM = {
  401: { code: 'UNAUTHENTICATED', title: 'Unauthorized', detail: 'Sign in again.' },
  403: { code: 'PERMISSION_DENIED', title: 'Forbidden', detail: 'You do not have access.' },
  404: { code: 'NOT_FOUND', title: 'Not found', detail: 'The record does not exist.' },
  500: { code: 'INTERNAL_ERROR', title: 'Server error', detail: 'Something went wrong.' },
} as const;

type Failure = keyof typeof PROBLEM | 502 | 503;

/**
 * Answers requests whose URL matches `url` (a glob such as `**\/api\/v1\/clients?*` or a RegExp) with a problem response. `times` limits
 * how many requests fail (the rest go through, so "Retry" can succeed); default: all. Returns a function that removes the rule.
 */
export async function failApi(
  page: Page,
  url: string | RegExp,
  status: Failure = 500,
  options: { times?: number; method?: string } = {},
): Promise<() => Promise<void>> {
  let left = options.times ?? Infinity;
  const handler = async (route: import('@playwright/test').Route) => {
    if (left <= 0 || (options.method && route.request().method() !== options.method)) {
      return route.fallback();
    }
    left--;
    const body = PROBLEM[status as keyof typeof PROBLEM] ?? PROBLEM[500];
    await route.fulfill({
      status,
      contentType: 'application/problem+json',
      headers: { 'X-Trace-Id': `e2e-${status}-trace` },
      body: JSON.stringify({ status, traceId: `e2e-${status}-trace`, ...body }),
    });
  };
  await page.route(url, handler);
  return () => page.unroute(url, handler);
}

/** `/api/v1/me` answers with an error: the shell cannot start (the error page). Call before the first `goto`. */
export function failMe(page: Page, status: Failure = 500): Promise<() => Promise<void>> {
  return failApi(page, '**/api/v1/me', status);
}

/** Holds every matching request for `ms` before it goes through (the slow-network cases; 6000 shows the skeleton long enough to photograph). */
export async function delayApi(
  page: Page,
  url: string | RegExp,
  ms: number,
): Promise<() => Promise<void>> {
  const handler = async (route: import('@playwright/test').Route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.fallback();
  };
  await page.route(url, handler);
  return () => page.unroute(url, handler);
}

/** Cuts (or restores) the browser's connection: requests fail at the network level, `navigator.onLine` turns false. */
export async function goOffline(target: Page | BrowserContext, offline = true): Promise<void> {
  const context = 'context' in target ? target.context() : target;
  await context.setOffline(offline);
}

// --- the routes -----------------------------------------------------------------------------------------------------------------------

/** The shape of a page's header (App shell review, section 8): A list, B workspace, C record, D administration, S system. */
export type HeaderShape = 'A' | 'B' | 'C' | 'D' | 'S';

export interface ShellRoute {
  path: string;
  /** The H1 text; a record page's H1 is the record, so it is a pattern. */
  heading: string | RegExp;
  shape: HeaderShape;
  /** The person needs ANY of these to open it (the route guard); empty: everyone signed in. */
  anyOf: string[];
  /** Needs a record created first (`:id`). */
  record?: 'client' | 'matter' | 'project' | 'task';
}

/** The routes the review measured, with the permission that opens each. Extend it when a page is added; specs loop over it. */
export const SHELL_ROUTES: readonly ShellRoute[] = [
  { path: '/dashboard', heading: 'Dashboard', shape: 'B', anyOf: ['Dashboard.View'] },
  { path: '/my-work', heading: 'My Work', shape: 'B', anyOf: ['Task.View'] },
  { path: '/tasks', heading: 'Task Queue', shape: 'A', anyOf: ['Task.View'] },
  { path: '/pods/work', heading: 'Pod Work', shape: 'B', anyOf: ['Pod.View'] },
  { path: '/clients', heading: 'Clients', shape: 'A', anyOf: ['Client.View'] },
  { path: '/matters', heading: 'Matters', shape: 'A', anyOf: ['Matter.View'] },
  { path: '/projects', heading: 'Projects', shape: 'A', anyOf: ['Project.View'] },
  { path: '/assets', heading: 'Assets', shape: 'A', anyOf: ['Asset.View'] },
  { path: '/clients/:id', heading: /./, shape: 'C', anyOf: ['Client.View'], record: 'client' },
  { path: '/matters/:id', heading: /./, shape: 'C', anyOf: ['Matter.View'], record: 'matter' },
  { path: '/projects/:id', heading: /./, shape: 'C', anyOf: ['Project.View'], record: 'project' },
  { path: '/tasks/:id', heading: /./, shape: 'C', anyOf: ['Task.View'], record: 'task' },
  { path: '/search', heading: 'Search results', shape: 'A', anyOf: [] },
  { path: '/profile', heading: 'My profile', shape: 'A', anyOf: ['Task.View'] },
  { path: '/admin/users', heading: 'Users', shape: 'D', anyOf: ['User.View', 'User.Manage'] },
  { path: '/admin/task-types', heading: 'Task Types', shape: 'D', anyOf: ['TaskType.Manage'] },
  { path: '/admin/workflows', heading: 'Task Types', shape: 'D', anyOf: ['Workflow.Manage'] },
  { path: '/admin/audit', heading: 'Audit Logs', shape: 'D', anyOf: ['Audit.View'] },
];
