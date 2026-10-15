import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Api } from '../support/api';
import { expect, test } from '../support/fixtures';
import { seedBulk } from '../support/bulk';

/**
 * Screenshot run for docs/ux/fixed-header (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/fixed-header/before E2E_SEED_BULK=1 frontend/e2e/run-local.sh -g "fixed-header screenshots"
 * Takes every grid screen in its scrolled state at 1366x768, 1280x800, 1024x768, 768x1024 and 375x812. `E2E_SEED_BULK=1` creates the
 * long lists first (skip it when the stack already holds them).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  { w: 1366, h: 768 },
  { w: 1280, h: 800 },
  { w: 1024, h: 768 },
  { w: 768, h: 1024 },
  { w: 375, h: 812 },
];

interface Screen {
  name: string;
  url: string;
  /** Scrolls the grid (or the page) down a little so the sticky header is visible over moving rows. */
  ready: RegExp | string;
}

async function scrollGrid(page: Page): Promise<void> {
  await page.evaluate(() => {
    const area = document.querySelector<HTMLElement>('.mf-scroll-area');
    if (area && area.scrollHeight > area.clientHeight) area.scrollTop = 220;
    else window.scrollTo(0, 260);
  });
}

test.describe('fixed-header screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, admin, seed }) => {
    test.setTimeout(900_000);
    const bulk = process.env['E2E_SEED_BULK'] ? await seedBulk(admin, seed) : null;
    const api: Api = admin;
    // The client with the most matters and the matter with the most tasks: their grids are the long ones.
    const clients = await api.get('/api/v1/clients?pageSize=100');
    const clientId =
      bulk?.mainClient.clientId ??
      [...clients.items].sort((a, b) => b.matterCount - a.matterCount)[0].clientId;
    const matterId =
      bulk?.mainMatter.matterId ??
      (await api.get(`/api/v1/matters?pageSize=1&clientId=${clientId}`)).items[0].matterId;
    const projects = await api.get('/api/v1/projects?pageSize=100');
    const projectId =
      bulk?.mainProject.projectId ??
      projects.items.find((p: { name: string }) => p.name.startsWith('Bulk main project'))
        ?.projectId ??
      projects.items[0].projectId;
    const screens: Screen[] = [
      {
        name: 'task-queue',
        url: '/tasks?status=NEW&status=IN_PROGRESS&status=ON_HOLD',
        ready: 'Task Queue',
      },
      { name: 'my-work', url: '/my-work', ready: 'My Work' },
      { name: 'pod-work', url: '/pods/work', ready: 'Pod Work' },
      { name: 'clients', url: '/clients', ready: 'Clients' },
      { name: 'matters', url: '/matters', ready: 'Matters' },
      { name: 'projects', url: '/projects', ready: 'Projects' },
      { name: 'assets', url: '/assets', ready: 'Assets' },
      { name: 'client-matters', url: `/clients/${clientId}`, ready: /./ },
      { name: 'matter-tasks', url: `/matters/${matterId}`, ready: /./ },
      { name: 'project-tasks', url: `/projects/${projectId}`, ready: /./ },
      { name: 'admin-users', url: '/admin/users', ready: 'Users' },
      { name: 'admin-roles', url: '/admin/roles', ready: 'Users' },
      { name: 'admin-pods', url: '/admin/pods', ready: 'Pods' },
      { name: 'admin-task-types', url: '/admin/task-types', ready: /Task types/i },
      { name: 'admin-workflows', url: '/admin/workflows', ready: 'Workflows' },
      { name: 'admin-steps', url: '/admin/steps', ready: 'Workflow Steps' },
      { name: 'admin-priorities', url: '/admin/priorities', ready: /./ },
      { name: 'admin-status-labels', url: '/admin/status-labels', ready: /./ },
      { name: 'admin-asset-types', url: '/admin/asset-types', ready: /./ },
      { name: 'admin-link-roles', url: '/admin/asset-types?tab=link-roles', ready: /./ },
      { name: 'admin-custom-fields', url: '/admin/custom-fields', ready: 'Custom Fields' },
      { name: 'admin-audit', url: '/admin/audit', ready: 'Audit Logs' },
    ];
    fs.mkdirSync(OUT!, { recursive: true });
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.w, height: size.h });
      for (const screen of screens) {
        await page.goto(screen.url);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        await scrollGrid(page);
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(OUT!, `${screen.name}-${size.w}x${size.h}.png`) });
      }
    }
  });
});
