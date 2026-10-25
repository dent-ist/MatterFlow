import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { SIZES, noHorizontalScroll } from '../support/screens';
import { expect, test } from '../support/fixtures';

/**
 * WP-SR1 #461: every link the box and the results page offer leads where the person may go. Each row of the table in
 * docs/ux/search-review/fixes/sr1-bugs/link-permissions.md is one persona here: the types it may view are the only types it is shown, every
 * hit opens (no 403 page, no 403 from the API on the way) and the page offers no link to a type the person may not view.
 */
const IN_PLACE = /linked assets aren't shown here|permission to view tasks/;
const FORBIDDEN = "You don't have permission to view this.";

type Kind = 'client' | 'matter' | 'project' | 'task' | 'asset';

const PREFIX: Record<Kind, string> = {
  client: '/clients/',
  matter: '/matters/',
  project: '/projects/',
  task: '/tasks/',
  asset: '/assets/',
};

const VIEW: Record<Kind, string> = {
  client: 'Client.View',
  matter: 'Matter.View',
  project: 'Project.View',
  task: 'Task.View',
  asset: 'Asset.View',
};

/** One persona per row of the table: the permissions it holds and the types its search may show. */
const ROWS: { key: string; permissions: string[]; sees: Kind[] }[] = [
  { key: 'task-only', permissions: ['Task.View'], sees: ['task'] },
  { key: 'asset-only', permissions: ['Asset.View'], sees: ['asset'] },
  { key: 'project-only', permissions: ['Project.View'], sees: ['project'] },
  { key: 'client-only', permissions: ['Client.View'], sees: ['client'] },
  { key: 'matter-only', permissions: ['Matter.View'], sees: ['matter'] },
  {
    key: 'client-matter',
    permissions: ['Client.View', 'Matter.View'],
    sees: ['client', 'matter'],
  },
];

/** Every address a hit can have, as the people on this page see them. */
async function hitHrefs(page: Page): Promise<string[]> {
  const all = await page
    .locator('main a[href]')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
  return all.filter((href) => Object.values(PREFIX).some((p) => href.startsWith(p)));
}

function kindOf(href: string): Kind {
  // `/assets/9` opens the asset record page: the first segment names the type.
  const segment = href.split(/[/?]/).filter(Boolean)[0];
  return (Object.keys(PREFIX) as Kind[]).find((k) => PREFIX[k] === `/${segment}/`)!;
}

test.describe('Hit links lead only where the person may go (#461)', () => {
  for (const row of ROWS) {
    test(`${row.key}: ${row.permissions.join(' + ')} sees only ${row.sees.join(', ')}, and every hit opens`, async ({
      seed,
      asUser,
    }) => {
      const world = await seed.world();
      const ref = world.matter.matterRef;
      await seed.task(world, { title: `Linked task ${ref}` });
      await seed.project(world.matter, `Linked project ${ref}`);
      await seed.asset(world.matter, `Linked asset ${ref}`);
      const role = await seed.role(row.permissions, `E2E links ${row.key}`);
      const user = await seed.user([role.name], `links-${row.key}`);
      const page = await asUser(user.username);
      const denied: string[] = [];
      page.on('response', (r) => {
        if (r.status() === 403 && r.url().includes('/api/')) denied.push(r.url());
      });

      // The results page: only the viewable types, and no link to anything else.
      await page.goto(`/search?q=${encodeURIComponent(ref)}`);
      await expect(page.getByRole('heading', { name: 'Search results', level: 1 })).toBeVisible();
      await expect.poll(async () => (await hitHrefs(page)).length).toBeGreaterThan(0);
      const hrefs = await hitHrefs(page);
      const kinds = [...new Set(hrefs.map(kindOf))].sort();
      expect(kinds, `types on the results page of ${row.key}`).toEqual([...row.sees].sort());
      for (const href of hrefs) {
        expect(row.permissions, `${href} is offered to ${row.key}`).toContain(VIEW[kindOf(href)]);
      }
      // The same text is never a link when the person may not view the record behind it (a matter on a task, asset or project row).
      if (!row.permissions.includes('Matter.View')) {
        await expect(page.locator('main a[href^="/matters/"]')).toHaveCount(0);
      }

      // Every hit opens: no 403 page, no inline "no access" and no refused API call on the way.
      for (const href of hrefs) {
        denied.length = 0;
        await page.goto(href);
        await expect(page.getByRole('main')).toBeVisible();
        await expect(page.getByRole('heading', { name: FORBIDDEN })).toHaveCount(0);
        // A page may say in place that one part is not for this person (the linked assets of a task without Asset.View, the tasks of a project
        // without Task.View: the in-place notes of the shell, decided on the client from the permission set). Those are the only notes allowed.
        const inPlace = await page
          .locator('[data-forbidden], [data-no-access]')
          .evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
        for (const note of inPlace)
          expect(note, `in-place note on ${href} as ${row.key}`).toMatch(IN_PLACE);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        expect(denied, `refused API calls opening ${href} as ${row.key}`).toEqual([]);
      }

      // The header suggestions: the same rule for every option.
      await page.goto('/dashboard').catch(() => undefined);
      const box = page.getByRole('combobox', {
        name: /^Search (clients|matters|tasks|assets|projects)/,
      });
      if (!(await box.isVisible())) await page.goto(hrefs[0]);
      await expect(box).toBeVisible();
      await box.fill(ref);
      const options = page.locator(
        '[data-search-panel] [role=option]:not([data-view-all]):not([data-see-all])',
      );
      await expect(options.first()).toBeVisible();
      const count = await options.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        await page.goto(hrefs[0]);
        await box.fill(ref);
        await expect(options.first()).toBeVisible();
        denied.length = 0;
        await options.nth(i).click();
        await expect(page).toHaveURL(
          /\/(clients|matters|projects|tasks)\/\d+|\/assets(\/\d+|\?selected=\d+)/,
        );
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await expect(page.getByRole('heading', { name: FORBIDDEN })).toHaveCount(0);
        expect(denied, `refused API calls from option ${i} as ${row.key}`).toEqual([]);
        expect(row.sees).toContain(kindOf(new URL(page.url()).pathname));
      }
    });
  }

  test('a person with no View permission is sent to the 403 page by the route guard', async ({
    personas,
    asUser,
  }) => {
    const nobody = await personas.create({ label: 'novview', permissions: ['Pod.View'] });
    const page = await asUser(nobody.username);
    await page.goto('/search?q=anything');
    await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeVisible();
    await page.goto('/search/advanced');
    await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeVisible();
  });

  test.describe('the narrowest person at four sizes', () => {
    test.skip(() => !axeAvailable(), 'axe-core is not available');

    test('Task.View only: the results page has no axe violation and no sideways scroll', async ({
      seed,
      asUser,
    }) => {
      const world = await seed.world();
      const ref = world.matter.matterRef;
      await seed.task(world, { title: `Narrow task ${ref}` });
      const role = await seed.role(['Task.View'], 'E2E links narrowest');
      const user = await seed.user([role.name], 'links-narrow');
      const page = await asUser(user.username);
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await page.goto(`/search?q=${encodeURIComponent(ref)}`);
        await expect(page.locator('main a[href^="/tasks/"]').first()).toBeVisible();
        expect(await axeViolations(page), `axe at ${size.width}`).toEqual([]);
        await noHorizontalScroll(page);
      }
    });
  });
});
