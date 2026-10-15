import { CreateTaskPage } from '../pages/create-task.page';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/** A client with a short number (so the unpadded form differs from the stored one) and matter 00012 with related records. */
async function searchableMatter(seed: import('../support/seed').Seeder) {
  const clientNumber = await seed.freeClientNumber(true);
  const client = await seed.client({ number: clientNumber });
  const matter = await seed.matter({ client, number: '00012' });
  const workflow = await seed.workflow({ stepCount: 1 });
  const taskType = await seed.taskType({ workflows: [workflow] });
  const world = { client, matter, workflow, taskType };
  const task = await seed.task(world, { title: `Search target ${uid()}` });
  const project = await seed.project(matter, `Search project ${uid()}`);
  const asset = await seed.asset(matter, `Search asset ${uid()}`);
  const typed = `${Number(clientNumber)}-12`;
  return { client, matter, task, project, asset, typed, world };
}

test.describe('Search by combined matter number (SCN-020)', () => {
  test('SCN-020: the header search finds a matter typed without padding and shows its related records', async ({
    page,
    seed,
  }) => {
    const s = await searchableMatter(seed);
    await page.goto('/dashboard');
    const box = page.getByRole('combobox', { name: 'Search clients, matters, tasks, assets' });
    await box.fill(s.typed);
    await box.press('Enter');

    await expect(page).toHaveURL(/\/search\?q=/);
    await expect(page.getByRole('heading', { name: 'Search results', level: 1 })).toBeVisible();
    await expect(page.getByText('Showing results for')).toContainText(s.matter.matterRef);
    await expect(page.getByText('Showing results for')).toContainText(`you typed "${s.typed}"`);

    const matters = page.getByRole('region', { name: /^Matters/ });
    await expect(matters.getByRole('link', { name: s.matter.name })).toBeVisible();
    await expect(
      page.getByRole('region', { name: /^Tasks/ }).getByRole('link', { name: s.task.title }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: /^Assets/ })
        .getByRole('link', { name: s.asset.displayName }),
    ).toBeVisible();

    await matters.getByRole('link', { name: s.matter.name }).click();
    await expect(page).toHaveURL(new RegExp(`/matters/${s.matter.matterId}$`));
  });

  test('SCN-020: padded, partly padded and unpadded spellings find the same matter first', async ({
    seed,
    admin,
  }) => {
    const s = await searchableMatter(seed);
    const padded = s.matter.matterRef;
    const spellings = [
      padded,
      s.typed,
      `${s.client.clientNumber}-12`,
      `${Number(s.client.clientNumber)}-00012`,
    ];
    for (const q of spellings) {
      const result = await admin.get(`/api/v1/search?q=${encodeURIComponent(q)}`);
      const matterGroup = result.groups.find((g: { type: string }) => g.type === 'matter');
      expect(matterGroup.items[0].id, `first matter hit for "${q}"`).toBe(s.matter.matterId);
    }
  });

  test('SCN-020: the matter picker on Create Task resolves an unpadded reference', async ({
    page,
    seed,
  }) => {
    const s = await searchableMatter(seed);
    const world = await seed.world();
    const create = new CreateTaskPage(page);
    await create.open(`?taskType=${world.taskType.id}`);
    await create.matter.fill(s.typed);
    const option = page.getByRole('option', { name: new RegExp(`^${s.matter.matterRef}\\b`) });
    await expect(option).toBeVisible();
    await option.click();
    await expect(page.locator('[data-summary-card]')).toContainText(s.matter.matterRef);
  });

  test('SCN-020: a user who may only see matters gets no task or asset groups', async ({
    seed,
    asUser,
  }) => {
    const s = await searchableMatter(seed);
    const role = await seed.role(['Matter.View', 'Client.View'], 'E2E matters only');
    const user = await seed.user([role.name], 'matters-only');
    const page = await asUser(user.username);

    await page.goto(`/search?q=${encodeURIComponent(s.matter.matterRef)}`);
    await expect(
      page.getByRole('region', { name: /^Matters/ }).getByRole('link', { name: s.matter.name }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: /^Tasks/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: /^Assets/ })).toHaveCount(0);
    await expect(page.getByText(s.task.title)).toHaveCount(0);
    await expect(page.getByText(s.asset.displayName)).toHaveCount(0);
  });

  test('a query that matches nothing says so', async ({ page }) => {
    await page.goto(`/search?q=zzz-no-such-${uid()}`);
    await expect(page.getByRole('heading', { name: 'Search results', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: /no results|0 results/i }),
    ).toBeVisible();
  });
});
