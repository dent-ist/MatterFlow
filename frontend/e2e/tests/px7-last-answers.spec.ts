import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { mmWorld } from '../support/my-matters-fixtures';
import { SIZES, noHorizontalScroll } from '../support/screens';

/**
 * "Same as my last task of this type" (PM experience follow-up #819): the second task of a type on a matter needs fewer decisions. The page
 * offers the requestor and the answers chosen from lists (Category, due date driver) of the person's own latest task of that type on that
 * matter, as a button, says what it filled, and never touches the privilege answer or free text.
 */
const FIELDS = [
  {
    key: 'category',
    label: 'Category',
    control: 'SELECT',
    required: true,
    options: [
      { key: 'legal', label: 'Legal' },
      { key: 'ops', label: 'Operations' },
    ],
  },
  {
    key: 'driver',
    label: 'What is driving the due date?',
    control: 'SELECT',
    required: true,
    options: [
      { key: 'court', label: 'Court deadline' },
      { key: 'client', label: 'Client request' },
    ],
  },
  {
    key: 'privilege',
    label: 'Privileged material',
    control: 'SELECT',
    options: [
      { key: 'yes', label: 'Privileged' },
      { key: 'no', label: 'Not privileged' },
    ],
  },
] as const;

async function setup(
  seed: Parameters<typeof mmWorld>[0],
  personas: Parameters<typeof mmWorld>[1],
  label: string,
) {
  const w = await mmWorld(seed, personas, label);
  const alpha = await w.matter('Alpha');
  const bravo = await w.matter('Bravo');
  const type = await seed.taskType({
    workflows: [w.world.workflow],
    fields: FIELDS.map((f) => ({ ...f, options: [...f.options] })),
    name: `Same as last ${label} ${w.pm.userId}`,
  });
  return { w, alpha, bravo, type };
}

async function pick(page: Page, field: RegExp, option: string): Promise<void> {
  await page.getByRole('combobox', { name: field }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('Same as my last task of this type', () => {
  test('the second task of the type on the matter needs three clicks fewer; the privilege answer and free text stay with the person', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const { w, alpha, type } = await setup(seed, personas, 'twice');
    const page = await asUser(w.pm.username);
    let clicks = 0;
    const click = async (target: ReturnType<Page['locator']>) => {
      clicks++;
      await target.click();
    };
    const select = async (field: RegExp, option: string) => {
      clicks += 2; // open the list, choose
      await pick(page, field, option);
    };
    const create = page.getByRole('button', { name: 'Create task', exact: true });
    const title = page.getByRole('textbox', { name: 'Title (required)' });
    const requestor = page.getByRole('textbox', { name: 'Requestor name (required)' });

    // The first task: nothing to offer yet.
    await page.goto(`/tasks/new?matterId=${alpha.matterId}`);
    await click(page.getByRole('radio', { name: new RegExp(type.name) }));
    await expect(page.locator('[data-use-last]')).toHaveCount(0);
    await title.fill('First task of the type');
    await requestor.fill('Jane Doe');
    await select(/Category/, 'Operations');
    await select(/What is driving the due date/, 'Court deadline');
    await select(/Privileged material/, 'Privileged');
    await click(create);
    await expect(page).toHaveURL(/\/tasks\/\d+/);
    const first = clicks;

    // The second one: the offer, a sentence that says what was filled, and the person's own decisions left alone.
    clicks = 0;
    await page.goto(`/tasks/new?matterId=${alpha.matterId}`);
    await click(
      page.locator('[data-recent-types]').getByRole('button', { name: new RegExp(type.name) }),
    );
    await title.fill('Second task of the type');
    await expect(requestor).toHaveValue(''); // nothing is filled behind the person's back
    const offer = page.locator('[data-use-last]');
    await expect(offer).toContainText('Same as my last task of this type');
    await click(offer);
    const said = page.locator('[data-last-applied]');
    await expect(said).toContainText('Requestor, Category, What is driving the due date?');
    await expect(said).not.toContainText('Privileged material');
    await expect(requestor).toHaveValue('Jane Doe');
    await expect(page.getByRole('combobox', { name: /Category/ })).toContainText('Operations');
    await expect(page.getByRole('combobox', { name: /What is driving/ })).toContainText(
      'Court deadline',
    );
    await expect(page.getByRole('combobox', { name: /Privileged material/ })).not.toContainText(
      'Privileged',
    );
    // The person can still change what was filled.
    await select(/Category/, 'Legal');
    clicks -= 2; // a change of mind is not part of the count
    await select(/Category/, 'Operations');
    clicks -= 2;
    await click(create);
    await expect(page).toHaveURL(/\/tasks\/\d+/);
    console.log(`first task ${first} clicks, second ${clicks} clicks`);
    expect(clicks, 'the second task needs at least two clicks fewer').toBeLessThanOrEqual(
      first - 2,
    );

    const made = await seed.admin.get<{ items: { taskId: number }[] }>(
      `/api/v1/tasks?matterId=${alpha.matterId}&q=${encodeURIComponent('Second task of the type')}`,
    );
    expect(made.items.length).toBe(1);
    const task = await seed.admin.get(`/api/v1/tasks/${made.items[0].taskId}`);
    expect(task.formValues).toEqual({ category: 'ops', driver: 'court' });
    expect(task.requestorName).toBe('Jane Doe');
  });

  test('only the same type on the same matter is offered, and only for my own tasks', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.setTimeout(120_000);
    const { w, alpha, bravo, type } = await setup(seed, personas, 'scope');
    const page = await asUser(w.pm.username);
    const create = page.getByRole('button', { name: 'Create task', exact: true });
    await page.goto(`/tasks/new?matterId=${alpha.matterId}&taskType=${type.id}`);
    await page.getByRole('textbox', { name: 'Title (required)' }).fill('Mine, first');
    await page.getByRole('textbox', { name: 'Requestor name (required)' }).fill('Jane Doe');
    await pick(page, /Category/, 'Legal');
    await pick(page, /What is driving the due date/, 'Client request');
    await create.click();
    await expect(page).toHaveURL(/\/tasks\/\d+/);

    await page.goto(`/tasks/new?matterId=${alpha.matterId}&taskType=${type.id}`);
    await expect(page.locator('[data-use-last]')).toBeVisible();
    await page.goto(`/tasks/new?matterId=${bravo.matterId}&taskType=${type.id}`);
    await expect(page.getByRole('textbox', { name: 'Title (required)' })).toBeVisible();
    await expect(page.locator('[data-use-last]')).toHaveCount(0);

    // Somebody else's task of the type is not mine: the other manager's own first task has no offer.
    const other = await asUser(w.other.username);
    await other.goto(`/tasks/new?matterId=${alpha.matterId}&taskType=${type.id}`);
    await expect(other.getByRole('textbox', { name: 'Title (required)' })).toBeVisible();
    await expect(other.locator('[data-use-last]')).toHaveCount(0);
  });

  for (const size of SIZES) {
    test(`axe 0 and no sideways scroll at ${size.width}x${size.height}: the form with the offer and with what it filled`, async ({
      seed,
      personas,
      asUser,
    }) => {
      test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH)');
      test.setTimeout(120_000);
      const { w, alpha, type } = await setup(seed, personas, `axe${size.width}`);
      const page = await asUser(w.pm.username);
      await page.setViewportSize(size);
      await page.goto(`/tasks/new?matterId=${alpha.matterId}&taskType=${type.id}`);
      await page.getByRole('textbox', { name: 'Title (required)' }).fill(`Axe ${size.width}`);
      await page.getByRole('textbox', { name: 'Requestor name (required)' }).fill('Rita');
      await pick(page, /Category/, 'Legal');
      await pick(page, /What is driving the due date/, 'Client request');
      await page.getByRole('button', { name: 'Create task', exact: true }).click();
      await expect(page).toHaveURL(/\/tasks\/\d+/);

      await page.goto(`/tasks/new?matterId=${alpha.matterId}&taskType=${type.id}`);
      const offer = page.locator('[data-use-last]');
      await expect(offer).toBeVisible();
      if (size.width < 640) expect((await offer.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await axeViolations(page), 'with the offer').toEqual([]);
      await noHorizontalScroll(page);
      await offer.click();
      await expect(page.locator('[data-last-applied]')).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0)); // axe reads what is on screen: the sticky action bar must not stand on the editor toolbar
      expect(await axeViolations(page), 'after it was used').toEqual([]);
      await noHorizontalScroll(page);
    });
  }
});
