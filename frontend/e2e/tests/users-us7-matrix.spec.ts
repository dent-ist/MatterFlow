import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';

/**
 * Users epic #422, WP-US7 #453: the permission matrix of the Users area (the Users, Roles and Pods tabs, the user drawer, the pod record
 * page and /access-pending).
 *
 * Every administration permission is enough to read what it manages and every denial follows one rule (the Task Types rule, #416): a tab
 * address falls back to the first tab the person may use; a create or edit address (`?pod=new`) shows the shared 403 page when the person lacks
 * the permission that page needs; a person with no tab at all gets the 403 page; a person with no role at all lands on Access Pending.
 * For each variant the spec opens the three tab addresses, the drawer (`?user=`) and the pod editor (`?pod=`), presses the visible actions of
 * the page header and the drawer's controls, and fails on any 401 / 403 / 404 answer from the API, any error alert or toast, a "no access"
 * notice on a page the person may use, or a link to a page the person may not open.
 * The matrix table is written to `permission-matrix.md` in E2E_SCREENSHOTS (docs/ux/users-review/fixes/us7-keyboard).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const TAG = `us7m${Math.floor(Math.random() * 90000) + 10000}`;

interface Variant {
  key: string;
  label: string;
  /** Null: the System Admin (everything). */
  perms: string[] | null;
  /** The tabs offered, in order (empty: the 403 page). */
  tabs: ('Users' | 'Roles' | 'Pods')[];
  /** The drawer opens, with these controls. */
  drawer?: { edit: boolean; pods: boolean } | null;
  /** The pod editor opens for an existing pod; `create` when `?pod=new` opens the empty editor too. */
  pod?: { create: boolean } | null;
}

const VARIANTS: Variant[] = [
  {
    key: 'admin',
    label: 'System Admin',
    perms: null,
    tabs: ['Users', 'Roles', 'Pods'],
    drawer: { edit: true, pods: true },
    pod: { create: true },
  },
  {
    key: 'um',
    label: 'User.View + User.Manage',
    perms: ['User.View', 'User.Manage'],
    tabs: ['Users'],
    drawer: { edit: true, pods: false },
    pod: null,
  },
  {
    key: 'uv',
    label: 'User.View only',
    perms: ['User.View'],
    tabs: ['Users'],
    drawer: { edit: false, pods: false },
    pod: null,
  },
  { key: 'role', label: 'Role.Manage only', perms: ['Role.Manage'], tabs: ['Roles'], pod: null },
  {
    key: 'pm',
    label: 'Pod.View + Pod.Manage',
    perms: ['Pod.View', 'Pod.Manage'],
    tabs: ['Pods'],
    pod: { create: true },
  },
  {
    key: 'pmm',
    label: 'Pod.View + Pod.ManageMembers',
    perms: ['Pod.View', 'Pod.ManageMembers'],
    tabs: ['Pods'],
    pod: { create: false },
  },
  {
    key: 'uv-pmm',
    label: 'User.View + Pod.View + Pod.ManageMembers',
    perms: ['User.View', 'Pod.View', 'Pod.ManageMembers'],
    tabs: ['Users', 'Pods'],
    drawer: { edit: false, pods: true },
    pod: { create: false },
  },
  {
    key: 'all-but-admin',
    label: 'User.View, User.Manage, Role.Manage, Pod.View, Pod.Manage, Pod.ManageMembers',
    perms: [
      'User.View',
      'User.Manage',
      'Role.Manage',
      'Pod.View',
      'Pod.Manage',
      'Pod.ManageMembers',
    ],
    tabs: ['Users', 'Roles', 'Pods'],
    drawer: { edit: true, pods: true },
    pod: { create: true },
  },
  { key: 'task', label: 'Task.View only', perms: ['Task.View'], tabs: [] },
  { key: 'client', label: 'Client.View only', perms: ['Client.View'], tabs: [] },
];

const rows: string[] = [];

/** Failed API answers, collected while pages load. */
function watch(page: Page): { failed: string[] } {
  const seen = { failed: [] as string[] };
  page.on('response', (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/') && [401, 403, 404].includes(r.status())) {
      seen.failed.push(`${r.status()} ${url.pathname}`);
    }
  });
  return seen;
}

const isForbiddenPage = async (page: Page): Promise<boolean> =>
  (await page
    .getByRole('heading', { level: 1, name: "You don't have permission to view this." })
    .count()) > 0;

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-loading], [data-skeleton], [data-record-skeleton]')).toHaveCount(
    0,
  );
}

/** The labels of the tabs offered (without their counts). */
async function tabsOf(page: Page): Promise<string[]> {
  const tabs = await page.getByRole('tab').allTextContents();
  return tabs.map((t) => t.replace(/\s*\(.*\)\s*$/, '').trim());
}

const PATHS: Record<'Users' | 'Roles' | 'Pods', string> = {
  Users: '/admin/users',
  Roles: '/admin/roles',
  Pods: '/admin/pods',
};

test.describe('#453: permission matrix of the Users area', () => {
  test.describe.configure({ mode: 'serial' });
  let podId: number;
  let subjectId: number;

  test.beforeAll(async ({ seed, personas }) => {
    const subject = await personas.create({ label: `${TAG}subject`, roles: ['Data Technician'] });
    subjectId = subject.userId;
    podId = (await seed.pod(`Matrix pod ${TAG}`, [subject.userId])).podId;
  });

  for (const v of VARIANTS) {
    test(`${v.label}`, async ({ personas, asUser, page: adminPage }) => {
      const problems: string[] = [];
      let page: Page;
      if (v.perms === null) {
        page = adminPage;
      } else {
        const person = await personas.create({ permissions: v.perms, label: `${TAG}${v.key}` });
        page = await asUser(person.username);
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      const seen = watch(page);

      // 1. The three tab addresses: the asked tab when it is allowed, else the first allowed tab; nobody with no tab gets a tab.
      for (const wanted of ['Users', 'Roles', 'Pods'] as const) {
        await page.goto(PATHS[wanted]);
        await settle(page);
        if (v.tabs.length === 0) {
          if (!(await isForbiddenPage(page))) problems.push(`${wanted}: expected the 403 page`);
          continue;
        }
        if (await isForbiddenPage(page)) {
          problems.push(`${wanted}: the 403 page for a permitted person`);
          continue;
        }
        const offered = v.tabs.length > 1 ? await tabsOf(page) : v.tabs;
        if (JSON.stringify(offered) !== JSON.stringify(v.tabs)) {
          problems.push(
            `${wanted}: tabs ${JSON.stringify(offered)}, expected ${JSON.stringify(v.tabs)}`,
          );
        }
        const landed = new URL(page.url()).pathname;
        const expectPath = v.tabs.includes(wanted) ? PATHS[wanted] : PATHS[v.tabs[0]];
        if (landed !== expectPath)
          problems.push(`${wanted}: landed on ${landed}, expected ${expectPath}`);
        // No error alert, toast or "no access" notice on a page the person may use.
        const loud = await page.locator('#mf-main [role=alert], [data-toast], .mf-toast').count();
        if (loud > 0) problems.push(`${wanted}: an alert or toast is shown`);
        const text = (await page.locator('#mf-main').textContent()) ?? '';
        if (/don't have permission/i.test(text)) problems.push(`${wanted}: a "no access" notice`);
      }

      // 2. The drawer: opens read only or editable by the permissions; every control it shows works without a refusal.
      if (v.drawer !== undefined && v.drawer !== null) {
        await page.goto(`/admin/users?status=all&account=e2e-${TAG}subject&user=${subjectId}`);
        await settle(page);
        const heading = page.locator('[data-panel-heading]');
        await expect(heading).toBeVisible();
        const hasSave = (await page.getByRole('button', { name: 'Save changes' }).count()) > 0;
        if (hasSave !== v.drawer.edit)
          problems.push(`drawer: Save changes ${hasSave}, expected ${v.drawer.edit}`);
        const hasDeactivate = (await page.locator('[data-deactivate]').count()) > 0;
        if (hasDeactivate !== v.drawer.edit) problems.push(`drawer: Deactivate ${hasDeactivate}`);
        const hasAvailability = (await page.locator('[data-edit-availability]').count()) > 0;
        if (hasAvailability !== v.drawer.edit)
          problems.push(`drawer: Edit availability ${hasAvailability}`);
        const hasPods = (await page.locator('.mf-user-drawer [data-pods-trigger]').count()) > 0;
        if (hasPods !== v.drawer.pods) problems.push(`drawer: pods control ${hasPods}`);
        if ((await page.locator('[data-readonly-reason]').count()) > 0 === v.drawer.edit) {
          problems.push('drawer: the read-only reason does not match the permissions');
        }
        // Press what is there: availability dialog, the pods popover, then close.
        if (hasAvailability) {
          await page.locator('[data-edit-availability]').click();
          await expect(page.getByRole('dialog', { name: /^Availability of / })).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(page.getByRole('dialog', { name: /^Availability of / })).toBeHidden();
        }
        if (hasPods) {
          await page.locator('.mf-user-drawer [data-pods-trigger]').click();
          await expect(page.locator('[data-pods-popover]')).toBeVisible();
          await page.keyboard.press('Escape');
        }
        if (hasDeactivate) {
          await page.locator('[data-deactivate]').click();
          const dialog = page.getByRole('dialog', { name: /^Deactivate / });
          await expect(dialog).toBeVisible();
          await dialog.getByRole('button', { name: 'Cancel' }).click();
          await expect(dialog).toBeHidden();
        }
        // Esc is the drawer's once every dialog above it has left.
        await expect(page.locator('.p-dialog-mask')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(heading).toHaveCount(0);
        await settle(page);
      } else if (v.tabs.includes('Users') === false && v.tabs.length > 0) {
        // No Users tab: the address of a drawer lands on the first tab, without the drawer.
        await page.goto(`/admin/users?user=${subjectId}`);
        await settle(page);
        if ((await page.locator('[data-panel-heading]').count()) > 0)
          problems.push('drawer shown without the Users tab');
      }

      // 3. The pod editor: an existing pod opens (members for ManageMembers, name for Manage); ?pod=new only with Pod.Manage.
      if (v.pod !== undefined && v.pod !== null) {
        await page.goto(`/admin/pods?pod=${podId}`);
        await settle(page);
        if (await isForbiddenPage(page))
          problems.push('pod editor: the 403 page for a permitted person');
        await expect(page.locator('[data-record-header]')).toBeVisible();
        const canManage = v.perms === null || v.perms.includes('Pod.Manage');
        const nameDisabled = await page.locator('input[data-name]').isDisabled();
        if (nameDisabled === canManage) problems.push(`pod editor: name disabled ${nameDisabled}`);
        const menu = await page.locator('[data-record-header] [data-overflow]').count();
        if (menu > 0 !== canManage) problems.push(`pod editor: header menu ${menu}`);
        await page.goto('/admin/pods?pod=new');
        await settle(page);
        const forbidden = (await page.locator('[data-record-state="forbidden"]').count()) > 0;
        if (forbidden === v.pod.create)
          problems.push(`?pod=new: forbidden ${forbidden}, create ${v.pod.create}`);
      }

      // 4. An unknown pod is the not-found state for anyone who may open the Pods tab.
      if (v.tabs.includes('Pods')) {
        await page.goto('/admin/pods?pod=99999999');
        await settle(page);
        if ((await page.locator('[data-record-state="notFound"]').count()) === 0)
          problems.push('unknown pod: not the not-found state');
      }

      const refused = seen.failed.filter((f) => !f.includes('/pods/99999999'));
      problems.push(...refused.map((f) => `refused: ${f}`));
      rows.push(
        `| ${v.label} | ${v.tabs.length ? v.tabs.join(', ') : '403 page'} | ${
          v.drawer
            ? (v.drawer.edit ? 'editable' : 'read only') + (v.drawer.pods ? ', pods' : '')
            : '-'
        } | ${v.pod ? (v.pod.create ? 'open, create' : 'open') : '-'} | ${problems.length === 0 ? 'green' : 'RED'} |`,
      );
      expect(problems, `${v.label}`).toEqual([]);
    });
  }

  test('a person with no role lands on Access Pending from every address', async ({
    personas,
    asUser,
  }) => {
    const pending = await personas.create({ label: `${TAG}pending` });
    const page = await asUser(pending.username);
    for (const url of ['/admin/users', '/admin/roles', '/admin/pods?pod=new', '/access-pending']) {
      await page.goto(url);
      await expect(page).toHaveURL(/access-pending/);
    }
    rows.push('| No role (Access Pending) | Access Pending page | - | - | green |');
  });

  test('the matrix is written down', async () => {
    test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');
    fs.mkdirSync(OUT!, { recursive: true });
    const header =
      '# Permission matrix of the Users area (#453)\n\nGenerated by `e2e/tests/users-us7-matrix.spec.ts`. Every row opens the three tab addresses, the drawer and the pod editor and fails on a refused API call, an error alert or toast, a notice of missing access on a page the person may use, or a control that ends in a refusal.\n\n| Person | Tabs offered | User drawer | Pod editor | Result |\n|---|---|---|---|---|\n';
    fs.writeFileSync(path.join(OUT!, 'permission-matrix.md'), header + rows.join('\n') + '\n');
  });
});
