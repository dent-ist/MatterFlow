import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

test.describe('Step tags', () => {
  test('an admin adds tags with Enter and comma, removes one with Backspace and the chip button, and saves', async ({
    page,
    admin: api,
  }) => {
    const token = uid();
    await page.goto('/admin/steps/new');
    await page.getByRole('textbox', { name: /Title/ }).fill(`Tagged step ${token}`);
    const tags = page.getByRole('combobox', { name: 'Tags' });

    await tags.fill(`  Relativity${token} `);
    await tags.press('Enter');
    await expect(page.locator('[data-tag-announce]')).toContainText(`Added tag Relativity${token}`);
    await tags.pressSequentially(`proc   ess${token},`);
    await tags.pressSequentially(`gone${token}`);
    await tags.press('Enter');
    await expect(page.locator('.ti__chip')).toHaveCount(3);
    await tags.press('Backspace');
    await expect(page.locator('.ti__chip')).toHaveCount(2);
    await expect(page.locator('[data-tag-announce]')).toContainText(`Removed tag gone${token}`);

    // Case-insensitive duplicates are not added twice.
    await tags.fill(`RELATIVITY${token.toUpperCase()}`);
    await tags.press('Enter');
    await expect(page.locator('.ti__chip')).toHaveCount(2);

    await tags.pressSequentially(`qc${token}`);
    await tags.press('Enter');
    await page.getByRole('button', { name: `Remove tag qc${token}` }).click();
    await expect(page.locator('.ti__chip')).toHaveCount(2);

    await page.getByRole('button', { name: 'Create step' }).click();
    await expect(page.getByRole('heading', { name: 'Edit step', level: 1 })).toBeVisible();
    await expect(page.locator('.ti__chip .ti__text')).toHaveText([
      `Relativity${token}`,
      `proc ess${token}`,
    ]);
    const id = Number(page.url().split('/').pop());
    const saved = await api.get(`/api/v1/step-definitions/${id}`);
    expect(saved.tags).toEqual([`Relativity${token}`, `proc ess${token}`]);
  });

  test('the tag box suggests existing tags as you type and also accepts free text', async ({
    page,
    seed,
  }) => {
    const token = uid();
    await seed.step({ title: 'Suggest source', tags: [`Collection${token}`] });
    await page.goto('/admin/steps/new');
    const tags = page.getByRole('combobox', { name: 'Tags' });
    await tags.fill(`collec`);
    await tags.fill(`Collection${token.slice(0, 3)}`);
    const option = page.getByRole('option', { name: `Collection${token}` });
    await expect(option).toBeVisible();
    await tags.press('ArrowDown');
    await tags.press('Enter');
    await expect(page.locator('.ti__chip .ti__text')).toHaveText([`Collection${token}`]);

    await tags.fill(`Brand new ${token}`);
    await tags.press('Enter');
    await expect(page.locator('.ti__chip .ti__text')).toHaveText([
      `Collection${token}`,
      `Brand new ${token}`,
    ]);
  });

  test('the limits are explained and enforced: 40 characters, 20 tags', async ({ page }) => {
    await page.goto('/admin/steps/new');
    const tags = page.getByRole('combobox', { name: 'Tags' });
    await tags.fill('x'.repeat(41));
    await tags.press('Enter');
    await expect(page.locator('#step-tags-error')).toContainText('at most 40 characters');
    await expect(page.locator('.ti__chip')).toHaveCount(0);

    await tags.fill('');
    for (let i = 1; i <= 20; i++) {
      await tags.pressSequentially(`limit${i}`);
      await tags.press('Enter');
    }
    await expect(page.locator('.ti__chip')).toHaveCount(20);
    await tags.pressSequentially('limit21');
    await tags.press('Enter');
    await expect(page.locator('#step-tags-error')).toContainText('at most 20 tags');
    await expect(page.locator('.ti__chip')).toHaveCount(20);
  });

  test('the list shows tags as chips and the free-text search finds steps by tag', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const step = await seed.step({
      title: 'Chips step',
      tags: [`Alpha${token}`, `Bravo${token}`, `Charlie${token}`, `Delta${token}`, `Echo${token}`],
    });
    await seed.step({ title: 'Other step', tags: [`Zulu${token}`] });
    await page.goto('/admin/steps');
    await page.getByRole('searchbox', { name: 'Search steps' }).fill(`bravo${token}`);
    await expect(page).toHaveURL(/q=bravo/);
    const rows = page.locator('table[data-steps] tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(step.title);
    await expect(rows.first().locator('[data-tag]')).toHaveText([
      `Alpha${token}`,
      `Bravo${token}`,
      `Charlie${token}`,
    ]);
    await expect(rows.first().locator('[data-tags-more]')).toContainText('+2 more');
    await expect(page.getByRole('columnheader', { name: 'Tags' })).toBeVisible();
  });

  test('the tag filter matches all selected tags by default, any on request, and lives in the address', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const a = `Aaa${token}`;
    const b = `Bbb${token}`;
    const c = `Ccc${token}`;
    const both = await seed.step({ title: 'Has both', tags: [a, b] });
    const onlyA = await seed.step({ title: 'Has A', tags: [a] });
    const bc = await seed.step({ title: 'Has B and C', tags: [b, c] });

    await page.goto('/admin/steps');
    await page.getByRole('button', { name: /^Tags/ }).click();
    await expect(page.getByRole('checkbox', { name: new RegExp(`^${a} \\(2\\)`) })).toBeVisible();
    await page.getByRole('checkbox', { name: new RegExp(`^${a} `) }).check();
    await page.getByRole('checkbox', { name: new RegExp(`^${b} `) }).check();
    await expect(page).toHaveURL(new RegExp(`tags=${a}&tags=${b}`));
    await expect(page.getByRole('radio', { name: 'Match all' })).toBeChecked();
    const titles = page.locator('table[data-steps] tbody tr a');
    await expect(titles).toHaveText([both.title]);

    await page.getByRole('radio', { name: 'Match any' }).check();
    await expect(page).toHaveURL(/tagMatch=any/);
    await expect(titles).toHaveText([both.title, onlyA.title, bc.title].sort());

    // The state survives a reload and can be removed chip by chip.
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Match any' })).toBeChecked();
    await expect(titles).toHaveCount(3);
    await page.getByRole('button', { name: `Remove tag filter ${a}` }).click();
    await page.getByRole('button', { name: `Remove tag filter ${b}` }).click();
    await expect(page).not.toHaveURL(/tags=/);
  });

  test('the workflow designer step picker shows tags and finds steps by tag', async ({
    page,
    seed,
    admin: api,
  }) => {
    const token = uid();
    const tagged = await seed.step({
      title: 'Picker tagged',
      tags: [`Picker${token}`, 'Relativity'],
    });
    await seed.step({ title: 'Picker plain' });
    const created = await api.post('/api/v1/workflows', {
      name: `Picker workflow ${token}`,
      description: null,
      isOrdered: true,
    });
    const workflow = created.workflow.workflowDefinitionId;
    const draft = created.versions[0].workflowVersionId;
    await page.goto(`/admin/workflows/${workflow}/versions/${draft}`);

    const library = page.locator('[data-library]');
    await expect(library.getByRole('searchbox', { name: 'Search steps' })).toBeVisible();
    await library.getByRole('searchbox', { name: 'Search steps' }).fill(`picker${token}`);
    const item = library.locator(`[data-lib="${tagged.title}"]`);
    await expect(item).toBeVisible();
    await expect(item.locator('[data-tag]').first()).toHaveText(`Picker${token}`);
    await expect(library.locator('[data-lib]')).toHaveCount(1);

    // The tag filter works here too.
    await library.getByRole('searchbox', { name: 'Search steps' }).fill('');
    await library.getByRole('button', { name: /^Tags/ }).click();
    await library.getByRole('checkbox', { name: new RegExp(`^Picker${token} `) }).check();
    await expect(library.locator('[data-lib]')).toHaveCount(1);
    await page.keyboard.press('Escape'); // closes the panel and gives the button focus back
    await expect(library.getByRole('button', { name: /^Tags/ })).toBeFocused();
    await expect(item).toBeVisible();
    await item.getByRole('button', { name: /^Add / }).click();
    await expect(page.locator('[data-steps]')).toContainText(tagged.title);
  });
});
