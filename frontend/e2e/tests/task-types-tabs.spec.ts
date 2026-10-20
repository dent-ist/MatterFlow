import { expect, test } from '../support/fixtures';
import { axeAvailable, axeViolations } from '../support/axe';
import { uid } from '../support/seed';

const adminMenu = (page: import('@playwright/test').Page) =>
  page.getByRole('list', { name: 'Administration' });
const crumbs = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('listitem');

test.describe('Task Types page: one menu item, three tabs (Task Types, Workflows, Workflow Steps)', () => {
  test('the menu has one Task Types item (no Workflows, no Task Types & Forms) that stays current on every tab and record URL', async ({
    page,
    seed,
  }) => {
    const step = await seed.step({ title: 'Nav step' });
    const workflow = await seed.workflow({ name: `Nav workflow ${uid()}` });
    const type = await seed.taskType({ name: `Nav type ${uid()}`, workflows: [workflow] });
    await page.goto('/dashboard');
    await expect(adminMenu(page).getByRole('link')).toHaveCount(6);
    await expect(
      adminMenu(page).getByRole('link', { name: 'Task Types', exact: true }),
    ).toHaveCount(1);
    for (const gone of ['Workflows', 'Workflow Steps', 'Task Types & Forms']) {
      await expect(adminMenu(page).getByRole('link', { name: gone })).toHaveCount(0);
    }

    for (const url of [
      '/admin/task-types',
      '/admin/workflows',
      '/admin/steps',
      '/admin/task-types/new',
      `/admin/task-types/${type.id}`,
      `/admin/task-types/${type.id}/form`,
      '/admin/workflows/new',
      `/admin/workflows/${workflow.workflowDefinitionId}`,
      '/admin/steps/new',
      `/admin/steps/${step.id}`,
    ]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 }).first(), url).toBeVisible();
      await expect(
        adminMenu(page).getByRole('link', { name: 'Task Types', exact: true }),
        url,
      ).toHaveAttribute('aria-current', 'page');
    }
  });

  test('the three tabs open on their own addresses and the tabs follow the address and the keyboard', async ({
    page,
  }) => {
    await page.goto('/admin/task-types');
    await expect(page.getByRole('heading', { name: 'Task Types', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveText(['Task Types', 'Workflows', 'Workflow Steps']);
    await expect(page.getByRole('tab', { name: 'Task Types' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('button', { name: 'New task type' })).toBeVisible();
    await expect(page).toHaveTitle('Task Types - MatterFlow');
    await expect(crumbs(page)).toHaveText(['Administration', 'Task Types']);

    await page.getByRole('tab', { name: 'Task Types' }).press('ArrowRight');
    await expect(page).toHaveURL(/\/admin\/workflows$/);
    await expect(page.getByRole('tab', { name: 'Workflows' })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Task Types', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /New workflow$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Filters/ })).toBeVisible();
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await expect(page).toHaveTitle('Task Types - Workflows - MatterFlow');
    await expect(crumbs(page)).toHaveText(['Administration', 'Task Types', 'Workflows']);

    await page.getByRole('tab', { name: 'Workflows' }).press('ArrowRight');
    await expect(page).toHaveURL(/\/admin\/steps$/);
    await expect(page.getByRole('tab', { name: 'Workflow Steps' })).toBeFocused();
    await expect(page.getByRole('button', { name: /New step$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Filters/ })).toBeVisible();
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await expect(page).toHaveTitle('Task Types - Workflow Steps - MatterFlow');
    await expect(crumbs(page)).toHaveText(['Administration', 'Task Types', 'Workflow Steps']);

    await page.getByRole('tab', { name: 'Workflow Steps' }).press('Home');
    await expect(page).toHaveURL(/\/admin\/task-types$/);
    await page.goto('/admin/steps');
    await expect(page.getByRole('tab', { name: 'Workflow Steps' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('tab', { name: 'Workflows' }).click();
    await expect(page).toHaveURL(/\/admin\/workflows$/);
  });

  test('record pages keep their URLs and read Administration > Task Types > <tab> > <record>', async ({
    page,
    seed,
  }) => {
    const step = await seed.step({ title: 'Crumb step' });
    const workflow = await seed.workflow({ name: `Crumb workflow ${uid()}` });
    const type = await seed.taskType({ name: `Crumb type ${uid()}`, workflows: [workflow] });

    await page.goto(`/admin/task-types/${type.id}`);
    // The record header's last crumb carries the full name once more for screen readers (the short text is aria-hidden).
    await expect(crumbs(page)).toHaveText([
      'Administration',
      'Task Types',
      `${type.name}${type.name}`,
    ]);
    await page.goto(`/admin/task-types/${type.id}/form`);
    await expect(crumbs(page)).toHaveText(['Administration', 'Task Types', type.name, 'Form']);

    await page.goto(`/admin/workflows/${workflow.workflowDefinitionId}`);
    // The record header's last step is the current page: shortened text for the eye plus the full name for screen readers (#387).
    await expect(crumbs(page)).toHaveText([
      'Administration',
      'Task Types',
      'Workflows',
      new RegExp(`^${workflow.name}`),
    ]);
    await expect(crumbs(page).locator('[data-crumb-current]')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await crumbs(page).getByRole('link', { name: 'Workflows' }).click();
    await expect(page).toHaveURL(/\/admin\/workflows$/);
    await expect(page.getByRole('tab', { name: 'Workflows' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.goto('/admin/steps/new');
    await expect(page.getByRole('heading', { name: 'New step', level: 1 })).toBeVisible();
    // The record header's last crumb carries the full name once more for screen readers (the short text is aria-hidden).
    await expect(crumbs(page)).toHaveText([
      'Administration',
      'Task Types',
      'Workflow Steps',
      'New stepNew step',
    ]);
    await page.goto(`/admin/steps/${step.id}`);
    await expect(crumbs(page)).toHaveText([
      'Administration',
      'Task Types',
      'Workflow Steps',
      `${step.title}${step.title}`,
    ]);
    await crumbs(page).getByRole('link', { name: 'Workflow Steps' }).click();
    await expect(page).toHaveURL(/\/admin\/steps$/);
    await page.goto(`/admin/steps/${step.id}/form`);
    await expect(crumbs(page)).toHaveText([
      'Administration',
      'Task Types',
      'Workflow Steps',
      step.title,
      'Form',
    ]);
  });

  test('a person with only Workflow.Manage sees two tabs and lands on Workflows; only TaskType.Manage sees one', async ({
    seed,
    asUser,
  }) => {
    const workflowRole = await seed.role(['Workflow.Manage'], 'Workflow only');
    const workflowUser = await seed.user([workflowRole.name], 'wf-only');
    const workflowPage = await asUser(workflowUser.username);
    await workflowPage.goto('/admin/task-types');
    await expect(workflowPage).toHaveURL(/\/admin\/workflows$/);
    await expect(workflowPage.getByRole('tab')).toHaveText(['Workflows', 'Workflow Steps']);
    await expect(workflowPage.getByRole('tab', { name: 'Workflows' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(workflowPage.getByRole('button', { name: 'New task type' })).toHaveCount(0);
    const menu = adminMenu(workflowPage).getByRole('link');
    await expect(menu).toHaveText(['Task Types']);
    await workflowPage.goto('/admin/steps');
    await expect(workflowPage.getByRole('tab', { name: 'Workflow Steps' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    const typeRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const typeUser = await seed.user([typeRole.name], 'type-only');
    const typePage = await asUser(typeUser.username);
    await typePage.goto('/admin/workflows');
    await expect(typePage).toHaveURL(/\/admin\/task-types$/);
    await expect(typePage.getByRole('tab')).toHaveText(['Task Types']);
    await expect(adminMenu(typePage).getByRole('link')).toHaveText(['Task Types']);
    // Without Workflow.Manage the workflow chips are not links.
    await expect(typePage.getByRole('heading', { name: 'Task Types', level: 1 })).toBeVisible();
    await expect(typePage.locator('[data-assoc-chip] a')).toHaveCount(0);

    const nobody = await seed.user(['Data Technician'], 'tech');
    const techPage = await asUser(nobody.username);
    await techPage.goto('/admin/workflows');
    await expect(
      techPage.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
  });
});

test.describe('Task type, workflow and step cross-links', () => {
  async function world(seed: import('../support/seed').Seeder) {
    const token = uid();
    const w1 = await seed.workflow({ name: `Alpha flow ${token}` });
    const w2 = await seed.workflow({ name: `Bravo flow ${token}` });
    const w3 = await seed.workflow({ name: `Charlie flow ${token}` });
    const w4 = await seed.workflow({ name: `Delta flow ${token}` });
    const many = await seed.taskType({
      name: `Many ${token}`,
      workflows: [w1, w2, w3, w4],
      defaultIndex: 1,
    });
    const single = await seed.taskType({ name: `Single ${token}`, workflows: [w4] });
    const bare = await seed.taskType({ name: `Bare ${token}`, workflows: [] });
    return { token, w1, w2, w3, w4, many, single, bare };
  }

  test('the Task Types list shows the workflows as chips: default starred, three then +n more, No workflow', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    await page.goto(`/admin/task-types?name=${w.token}`);
    const many = page.locator(`[data-row="${w.many.name}"]`);
    await expect(many).toBeVisible();
    const chips = many.locator('[data-assoc-chip]');
    await expect(chips).toHaveCount(3);
    // The default (Bravo) first, with a star and the text "default"; the others by name.
    await expect(chips.nth(0)).toContainText(w.w2.name);
    await expect(chips.nth(0)).toContainText('default');
    await expect(chips.nth(0).locator('.pi-star-fill')).toBeVisible();
    await expect(chips.nth(1)).toContainText(w.w1.name);
    await expect(chips.nth(1)).not.toContainText('default');
    await expect(many.locator('[data-assoc-more]')).toHaveText('+1 more');
    await expect(many.locator('[data-assoc-all]')).toHaveText('Workflows (4)');

    const bare = page.locator(`[data-row="${w.bare.name}"]`);
    await expect(bare.locator('[data-assoc-empty]')).toHaveText('No workflow');

    // A chip opens the workflow's page.
    await chips.nth(0).getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/admin/workflows/${w.w2.workflowDefinitionId}$`));
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(w.w2.name);
  });

  test('+n more and Workflows (n) open the Workflows tab filtered to the task type, with a removable chip', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    await page.goto(`/admin/task-types?name=${w.token}`);
    await page.locator(`[data-row="${w.many.name}"] [data-assoc-more]`).click();
    await expect(page).toHaveURL(new RegExp(`/admin/workflows\\?taskType=${w.many.id}$`));
    await expect(page.getByRole('tab', { name: 'Workflows' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-filtered-by]')).toContainText(
      `Filtered by task type ${w.many.name}: 4 workflows`,
    );
    const chip = page.getByRole('button', {
      name: `Remove filter Task type: ${w.many.name}`,
    });
    await expect(chip).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(4);

    await chip.click();
    await expect(page).toHaveURL(/\/admin\/workflows$/);
    await expect(page.locator('[data-assoc-filter]')).toHaveCount(0);

    await page.goto(`/admin/task-types?name=${w.token}`);
    await page.locator(`[data-row="${w.single.name}"] [data-assoc-all]`).click();
    await expect(page).toHaveURL(new RegExp(`/admin/workflows\\?taskType=${w.single.id}$`));
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText(w.w4.name);
  });

  test('the Workflows list shows the task types as chips linking to them; +n more opens the Task Types tab filtered to the workflow', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const workflow = await seed.workflow({ name: `Shared flow ${token}` });
    const types = [];
    for (const n of ['A', 'B', 'C', 'D', 'E']) {
      types.push(
        await seed.taskType({
          name: `Type ${n} ${token}`,
          workflows: [workflow],
        }),
      );
    }
    const lonely = await seed.workflow({ name: `Lonely flow ${token}` });
    await page.goto(`/admin/workflows?name=${token}`);
    const row = page.locator(`[data-row="${workflow.name}"]`);
    await expect(row.locator('[data-assoc-chip]')).toHaveCount(3);
    await expect(row.locator('[data-assoc-more]')).toHaveText('+2 more');
    await expect(page.locator(`[data-row="${lonely.name}"] [data-assoc-empty]`)).toHaveText(
      'No task type',
    );
    // The steps count stays.
    await expect(row).toContainText('v1 (3 steps)');

    await row.locator('[data-assoc-more]').click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/task-types\\?workflow=${workflow.workflowDefinitionId}$`),
    );
    await expect(page.getByRole('tab', { name: 'Task Types' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-filtered-by]')).toContainText(
      `Filtered by workflow ${workflow.name}: 5 task types`,
    );
    await expect(page.locator('tbody tr')).toHaveCount(5);
    await page.getByRole('button', { name: `Remove filter Workflow: ${workflow.name}` }).click();
    await expect(page).toHaveURL(/\/admin\/task-types$/);
    await expect(page.locator('[data-assoc-filter]')).toHaveCount(0);

    await page.goto(`/admin/workflows?name=${token}`);
    await page
      .locator(`[data-row="${workflow.name}"] [data-assoc-chip="${types[0].name}"] a`)
      .click();
    await expect(page).toHaveURL(new RegExp(`/admin/task-types/${types[0].id}$`));
  });

  test('the Workflow Steps list says where a step is used and opens the Workflows tab filtered by the step', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const shared = await seed.step({ title: `Shared step ${token}` });
    const spare = await seed.step({ title: `Spare step ${token}` });
    const one = await seed.workflow({
      name: `Uses one ${token}`,
      steps: [{ stepDefinitionId: shared.id, title: shared.title }],
    });
    const two = await seed.workflow({
      name: `Uses two ${token}`,
      steps: [{ stepDefinitionId: shared.id, title: shared.title }],
    });
    await seed.workflow({ name: `Other ${token}` });

    await page.goto(`/admin/steps?title=${token}`);
    const sharedRow = page.locator(`[data-row="${shared.title}"]`);
    await expect(sharedRow.locator('[data-used-in]')).toHaveText('2');
    const spareRow = page.locator(`[data-row="${spare.title}"]`);
    await expect(spareRow.locator('[data-used-in]')).toHaveText('Not used');
    await expect(spareRow.locator('[data-used-in] a')).toHaveCount(0);

    await sharedRow.locator('[data-used-in-link]').click();
    await expect(page).toHaveURL(new RegExp(`/admin/workflows\\?step=${shared.id}$`));
    await expect(page.locator('[data-filtered-by]')).toContainText(
      `Filtered by step ${shared.title}: 2 workflows`,
    );
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(page.locator('tbody')).toContainText(one.name);
    await expect(page.locator('tbody')).toContainText(two.name);
    await page.getByRole('button', { name: `Remove filter Step: ${shared.title}` }).click();
    await expect(page).toHaveURL(/\/admin\/workflows$/);
  });

  test('the three tabs, the chips and the filtered Workflows tab have no axe violations', async ({
    page,
    seed,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(120_000);
    const w = await world(seed);
    for (const size of [
      { width: 1366, height: 768 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(size);
      for (const url of [
        `/admin/task-types?name=${w.token}`,
        `/admin/workflows?name=${w.token}`,
        `/admin/workflows?taskType=${w.many.id}`,
        `/admin/task-types?workflow=${w.w4.workflowDefinitionId}`,
        '/admin/steps',
      ]) {
        await page.goto(url);
        await expect(page.getByRole('tab', { selected: true })).toBeVisible();
        await expect(page.locator('tbody tr').first()).toBeVisible();
        expect(await axeViolations(page), `${url} at ${size.width}`).toEqual([]);
      }
    }
  });
});
