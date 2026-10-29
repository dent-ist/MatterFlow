import { Page } from '@playwright/test';
import { Api, BASE_URL } from '../support/api';
import { expect, requireRule, test } from '../support/sensitive-fixtures';
import {
  Finding,
  NetworkRecorder,
  PersonaKey,
  SensitiveUniverse,
  hiddenFor,
  pageSurface,
  scan,
  visibleFor,
} from '../support/sensitive-universe';

/**
 * Sensitive matters, end to end (epic #788, SM-17, #805): six people walk the main screens against the real API with the rule switched on,
 * and after every screen the page (visible text, titles, tooltips, links), its browser storage (localStorage, sessionStorage, IndexedDB,
 * CacheStorage) and every answer the API sent are searched for the sentinels of the records the person must not see
 * (`support/sensitive-universe.ts`). Nothing sensitive may be found for P3, P5 and P6, and the other personas see exactly their share.
 *
 * Needs `Features__SensitiveMatterAccess=true` (run-local.sh sets it for `sensitive-*.spec.ts`); the tests skip themselves otherwise.
 *
 * A walk that never finds anything proves nothing, so every persona must also FIND what it may see (the control matter N1 and its own share).
 */
const WHO: readonly Exclude<PersonaKey, 'admin'>[] = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

const NOUN = { matter: 'Matter', project: 'Project', task: 'Task', asset: 'Asset' } as const;
type Kind = keyof typeof NOUN;

/** Who may open each record by address (a person outside the rule gets the same "not found" page as for an id that does not exist). */
function mayOpen(
  who: PersonaKey,
  kind: Kind,
  item: 'n1' | 's1' | 's2' | 's3' | 's3other' | 's3linked',
): boolean {
  if (who === 'admin' || who === 'p4') return true;
  if (who === 'p6') return false;
  switch (item) {
    case 'n1':
      return true;
    case 's1':
      return who === 'p1' || who === 'p2';
    case 's2':
      return false;
    case 's3':
      // The assignee reads her own task, nothing else of the matter (not the matter page, not its project).
      return who === 'p3' && kind === 'task';
    case 's3other':
      return false;
    case 's3linked':
      return who === 'p3' && kind === 'asset';
  }
}

class Walker {
  readonly findings: Finding[] = [];
  readonly seen: string[] = [];
  readonly failures: string[] = [];
  readonly recorder = new NetworkRecorder();

  constructor(
    readonly page: Page,
    private readonly forbidden: ReturnType<typeof hiddenFor>,
  ) {
    this.recorder.attach(page);
  }

  /** Opens an address, waits for it to settle and scans everything the person can see or the browser kept. */
  async visit(path: string, options: { allowErrors?: boolean } = {}): Promise<void> {
    const before = this.recorder.answers.length;
    await this.page.goto(path);
    await this.settle();
    await this.collect(path);
    if (!options.allowErrors) this.checkNoErrors(path, before);
  }

  async settle(): Promise<void> {
    await this.page.waitForLoadState('networkidle').catch(() => undefined);
    await this.page.waitForTimeout(250);
  }

  async collect(step: string): Promise<void> {
    this.findings.push(...(await scan(this.page, this.recorder, this.forbidden, step)));
    const surface = await pageSurface(this.page);
    this.seen.push(surface['dom'], surface['title'], surface['html-attributes']);
    for (const a of this.recorder.answers) this.seen.push(a.body);
  }

  checkNoErrors(step: string, from: number): void {
    for (const a of this.recorder.answers.slice(from)) {
      if (a.status >= 400)
        this.failures.push(`${step}: ${a.status} ${a.url.replace(BASE_URL, '')}`);
    }
  }

  sawText(text: string): boolean {
    return this.seen.some((s) => s.includes(text));
  }
}

async function typeInGlobalSearch(w: Walker, text: string): Promise<void> {
  const box = w.page.getByRole('combobox', { name: /Search clients/ });
  await box.fill(text);
  await w.page.waitForSelector('[role=listbox]', { timeout: 10_000 }).catch(() => undefined);
  await w.page.waitForTimeout(600);
  await w.collect(`search suggestions for "${text}"`);
  await w.page.keyboard.press('Escape');
}

async function openBell(w: Walker): Promise<void> {
  await w.page.getByTestId('notification-bell').click();
  await w.page.locator('[data-notification-panel]').waitFor();
  await w.page.waitForTimeout(500);
  await w.collect('notifications panel');
  await w.page.keyboard.press('Escape');
}

/** PM v2 (PV-37): runs the report builder grouped by matter and by client, so the answers and the table are scanned like every other screen. */
async function runReports(w: Walker): Promise<void> {
  await w.visit('/assets/reports', { allowErrors: true });
  if ((await w.page.locator('[data-run]').count()) === 0) return;
  for (const group of ['matter', 'client', 'disposition']) {
    await w.page.locator('[data-group]').selectOption(group);
    await w.page.locator('[data-run]').click();
    await w.page
      .locator('[data-result-table], [data-result-empty], [data-result-error]')
      .first()
      .waitFor();
    await w.settle();
    await w.collect(`report grouped by ${group}`);
  }
}

async function walk(
  u: SensitiveUniverse,
  who: Exclude<PersonaKey, 'admin'>,
  page: Page,
): Promise<Walker> {
  const w = new Walker(page, hiddenFor(u, who));
  const noLists = who === 'p6';
  const lists = [
    '/dashboard?tab=summary',
    '/dashboard?tab=breakdowns',
    '/dashboard?tab=trends',
    '/dashboard?tab=swimlane',
    '/dashboard?tab=users',
    '/my-work',
    '/tasks',
    '/pods/work',
    '/my-matters',
    '/my-matters?scope=all',
    // PM v2 (epic #851, PV-37): the Breakdown and Data tabs, in the default and the All matters scope, and the Calendar month (epic #893, #944; Trends was removed, #947).
    '/my-matters?tab=breakdown',
    '/my-matters?tab=breakdown&scope=all',
    '/my-matters?tab=data',
    '/my-matters?tab=data&scope=all',
    '/my-matters?view=calendar&scope=all',
    '/matters',
    '/projects',
    '/assets',
    '/assets/reports',
    '/admin/audit',
    '/admin/users',
  ];
  await w.visit('/clients', { allowErrors: noLists });
  await w.visit(`/clients/${u.client.clientId}`, { allowErrors: noLists });
  await w.visit(`/clients/${u.client.clientId}?tab=matters`, { allowErrors: noLists });
  await w.visit('/notifications', { allowErrors: noLists });
  if (!noLists) await openBell(w);
  for (const path of lists) {
    // The list pages a person's roles do not open answer with a page that says so; only the ones they may open must be free of failing calls.
    await w.visit(path, { allowErrors: noLists || path.startsWith('/admin') });
  }
  if (!noLists) await runReports(w);
  await w.visit(`/search?q=ZZSENS-${u.tag}`, { allowErrors: noLists });
  await w.visit(`/search?q=Control-${u.tag}`, { allowErrors: noLists });
  await w.visit('/tasks', { allowErrors: noLists });
  await typeInGlobalSearch(w, `ZZSENS-${u.tag}`);
  await typeInGlobalSearch(w, 'ZZSENS');
  await typeInGlobalSearch(w, `Control-${u.tag}`);
  return w;
}

async function deepLinks(
  u: SensitiveUniverse,
  who: Exclude<PersonaKey, 'admin'>,
  w: Walker,
): Promise<string[]> {
  const problems: string[] = [];
  const items: {
    item: 'n1' | 's1' | 's2' | 's3' | 's3other' | 's3linked';
    ids: Record<Kind, number>;
  }[] = [
    {
      item: 'n1',
      ids: {
        matter: u.n1.matterId,
        project: u.n1.projectId,
        task: u.n1.taskId,
        asset: u.n1.assetId,
      },
    },
    {
      item: 's1',
      ids: {
        matter: u.s1.matterId,
        project: u.s1.projectId,
        task: u.s1.taskId,
        asset: u.s1.assetId,
      },
    },
    {
      item: 's2',
      ids: {
        matter: u.s2.matterId,
        project: u.s2.projectId,
        task: u.s2.taskId,
        asset: u.s2.assetId,
      },
    },
    {
      item: 's3',
      ids: {
        matter: u.s3.matterId,
        project: u.s3.projectId,
        task: u.s3.taskId,
        asset: u.s3.assetId,
      },
    },
    {
      item: 's3other',
      ids: {
        matter: u.s3.matterId,
        project: u.s3.projectId,
        task: u.s3.otherTaskId,
        asset: u.s3.assetId,
      },
    },
    {
      item: 's3linked',
      ids: {
        matter: u.s3.matterId,
        project: u.s3.projectId,
        task: u.s3.taskId,
        asset: u.s3.otherAssetId,
      },
    },
  ];
  const path = {
    matter: '/matters',
    project: '/projects',
    task: '/tasks',
    asset: '/assets',
  } as const;
  for (const { item, ids } of items) {
    for (const kind of ['matter', 'project', 'task', 'asset'] as const) {
      // The record kinds each item really has: s3other is a task only, s3linked an asset only; their other kinds repeat s3 (skipped).
      if ((item === 's3other' && kind !== 'task') || (item === 's3linked' && kind !== 'asset'))
        continue;
      if (item === 's3' && kind === 'asset') continue; // the unlinked S3 asset is checked below as 's3' too
      const url = `${path[kind]}/${ids[kind]}`;
      await w.visit(url, { allowErrors: true });
      const state = w.page.locator('[data-record-state]');
      const open = mayOpen(who, kind, item);
      if (who === 'p6') continue; // no permission at all: 403 pages, nothing more to say than "no findings" (the scan ran)
      const notFound =
        (await state.count()) > 0 &&
        (await state.first().getAttribute('data-record-state')) === 'notFound';
      if (open && notFound)
        problems.push(`${who} should open ${url} (${item}) but got "not found"`);
      if (!open && !notFound) problems.push(`${who} should get "not found" for ${url} (${item})`);
      if (!open && notFound) {
        const title = await w.page.title();
        if (title !== `${NOUN[kind]} not found - MatterFlow`)
          problems.push(`${url}: title "${title}"`);
      }
    }
  }
  // The unlinked asset of S3: only a person who sees the matter as a whole.
  await w.visit(`/assets/${u.s3.assetId}`, { allowErrors: true });
  const hidden = (await w.page.locator('[data-record-state="notFound"]').count()) > 0;
  if (who !== 'p6' && hidden !== (who !== 'p4'))
    problems.push(`${who}: the unlinked S3 asset ${hidden ? 'is hidden' : 'is open'}`);
  return problems;
}

test.describe('Sensitive matters: a person sees only their share (scan of screens, storage and network)', () => {
  test.describe.configure({ timeout: 360_000 });
  test.beforeEach(({ universe }) => requireRule(universe, test.skip));

  for (const who of WHO) {
    test(`${who}: no forbidden text anywhere, and everything they may see is found`, async ({
      universe: u,
      asUser,
    }) => {
      const page = await asUser(u.people[who].username);
      const w = await walk(u, who, page);
      const problems = await deepLinks(u, who, w);
      await w.collect('end');

      expect(w.findings, 'forbidden text found').toEqual([]);
      expect(problems, 'deep links').toEqual([]);
      expect(w.failures, 'failing API calls on screens the person may open').toEqual([]);
      for (const answer of w.recorder.answers) {
        expect(answer.status, `${answer.url} must not fail on the server`).toBeLessThan(500);
      }

      if (who !== 'p6') {
        // Positive controls: the walk reaches what the person may see.
        expect(w.sawText(u.controlText), 'the control matter N1 is visible').toBe(true);
        for (const s of visibleFor(u, who)) {
          if (s.what.includes('comment')) continue; // comments are on the task page only (visited by address above)
          expect(w.sawText(s.text), `${who} should see: ${s.what}`).toBe(true);
        }
      }
    });
  }

  test('P3: the matter header is plain text with no link to the matter, and no call fails', async ({
    universe: u,
    asUser,
  }) => {
    const page = await asUser(u.people.p3.username);
    const w = new Walker(page, hiddenFor(u, 'p3'));
    await w.visit(`/tasks/${u.s3.taskId}`);
    const header = page.locator('[data-task-header]');
    await expect(header).toContainText(u.s3.matterRef);
    await expect(header).toContainText(u.s3.name);
    await expect(page.locator('a[href^="/matters/"]')).toHaveCount(0);
    // The Edit task dialog of the assignee: the matter shows as plain text, nothing it loads fails, nothing hidden is in it.
    const before = w.recorder.answers.length;
    await page.locator('[data-page-actions]').getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(u.s3.matterRef);
    await expect(dialog.locator('a[href^="/matters/"]')).toHaveCount(0);
    await w.settle();
    await w.collect('edit task dialog');
    w.checkNoErrors('edit task dialog', before);
    await page.keyboard.press('Escape');
    // No matter-level tabs or "other tasks in this matter" on the task page.
    await expect(page.getByRole('tab', { name: /^(Projects|Tasks|Overview)/ })).toHaveCount(0);
    // My Work and the Task Queue show the assignee's task with the same plain header.
    await w.visit('/my-work');
    await expect(page.locator('a[href^="/matters/"]')).toHaveCount(0);
    // A person who may be a project manager opens the queue on their own matters (epic #758): this check is about the whole queue, so All.
    await w.visit('/tasks?scope=all');
    // The row is found by its own title (the first page of a long queue holds other tasks); the scan above still read the whole first page.
    await w.visit(`/tasks?scope=all&q=${encodeURIComponent(u.s3.taskTitle)}`);
    await expect(page.locator('tr', { hasText: u.s3.taskTitle }).first()).toBeVisible();
    // The queue also lists tasks of normal matters (their matter is a link); the row of the sensitive matter's task has none.
    const row = page.locator('tr', { hasText: u.s3.taskTitle });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(u.s3.matterRef);
    await expect(row.locator('a[href^="/matters/"]')).toHaveCount(0);
    // The asset linked to the task opens, and its matter reference is plain text too.
    await w.visit(`/assets/${u.s3.otherAssetId}`);
    await expect(page.getByText(u.s3.otherAssetName).first()).toBeVisible();
    await expect(page.locator('a[href^="/matters/"]')).toHaveCount(0);
    expect(w.findings).toEqual([]);
    expect(w.failures, 'no failing call on the pages of the assignee').toEqual([]);
  });

  test('the scan is not vacuous: asked for text the person may see, it finds it on the page and in the network answers', async ({
    universe: u,
    asUser,
  }) => {
    const page = await asUser(u.people.p1.username);
    const w = new Walker(page, [{ text: u.s1.name, what: 'S1 matter name', visibleTo: ['p1'] }]);
    // Its own matter by name: on a database that has already run the suite the first page of the list holds other matters.
    await w.visit(`/matters?name=${encodeURIComponent(u.s1.name)}`);
    const where = w.findings.map((f) => f.where);
    expect(
      where.some((x) => x.endsWith(': dom')),
      'found in the visible text',
    ).toBe(true);
    expect(
      where.some((x) => x.includes('network 200 /api/v1/matters')),
      'found in the matters answer',
    ).toBe(true);
  });

  test('a hidden address answers byte for byte like an id that does not exist', async ({
    universe: u,
  }) => {
    for (const who of ['p3', 'p5'] as const) {
      const api = await Api.as(u.people[who].username);
      try {
        for (const [path, missing] of [
          [`/api/v1/matters/${u.s2.matterId}`, '/api/v1/matters/2000000000'],
          [`/api/v1/projects/${u.s2.projectId}`, '/api/v1/projects/2000000000'],
          [`/api/v1/tasks/${u.s2.taskId}`, '/api/v1/tasks/2000000000'],
          [`/api/v1/assets/${u.s2.assetId}`, '/api/v1/assets/2000000000'],
        ] as const) {
          const hidden = await api.raw('GET', path);
          const gone = await api.raw('GET', missing);
          expect(hidden.status, `${who} ${path}`).toBe(404);
          const strip = (b: unknown) =>
            JSON.stringify({ ...(b as object), traceId: undefined, instance: undefined });
          expect(strip(hidden.body), `${who} ${path}`).toBe(strip(gone.body));
        }
      } finally {
        await api.dispose();
      }
    }
  });
});
