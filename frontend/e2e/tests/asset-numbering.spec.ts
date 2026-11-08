import { Page } from '@playwright/test';
import { Api, Json } from '../support/api';
import { expect, test } from '../support/fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * Asset numbering (#1297): the Numbering tab of the Asset Type (tail, Counter button, validation, Save Numbering), the Next Numbers grid with the Set Next Number
 * dialog, the Asset Number on New Asset, the record page and the Assets list. Only desktop sizes (1366 and 1920). Every test retires the numbered type it made: an
 * active numbered type changes the default columns of the Assets list for everybody (External Reference goes off by default), so none may outlive its test.
 */
const tailBox = (page: Page) => page.getByRole('textbox', { name: 'After the CM Number' });

async function retire(admin: Api, type: Json): Promise<void> {
  const current = await admin.get<Json>(`/api/v1/asset-types/${type.assetTypeId}`);
  await admin.put(`/api/v1/asset-types/${type.assetTypeId}`, {
    name: current.name,
    description: current.description ?? null,
    sortOrder: current.sortOrder,
    isActive: false,
    rowVersion: current.rowVersion,
  });
}

test.describe('Asset numbering (#1297)', () => {
  test('the Numbering tab: validation messages, Counter button, Save Numbering, Turn Off', async ({
    page,
    admin,
  }) => {
    const type = await admin.post('/api/v1/asset-types', {
      name: `Num ${uid()}`,
      description: null,
    });
    try {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/admin/asset-types/${type.assetTypeId}?tab=numbering`);
      await expect(page.getByRole('tab', { name: 'Numbering' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByRole('tab')).toHaveText([/Overview/, /Fields/, /Numbering/, /Assets/]);
      await expect(page.locator('[data-numbering-card]')).toContainText('Automatic Numbering');
      await expect(tailBox(page)).toHaveCount(0);

      await page.getByLabel('Number Assets Automatically').check();
      await expect(tailBox(page)).toHaveValue('_{###}');
      await expect(page.locator('[data-tail-prefix]')).toHaveText('90003-80008');
      await expect(page.locator('[data-numbering-example]')).toHaveText('90003-80008_001');
      await expect(page.locator('[data-example-caption]')).toHaveText('Sample matter 90003-80008.');
      await shot(page, 'asset-numbering-tab');

      // One message at a time, by the first rule broken; Save Numbering is off while the tail is invalid.
      const save = page.getByRole('button', { name: 'Save Numbering' });
      await tailBox(page).fill('_{###}.');
      await tailBox(page).blur();
      await expect(page.locator('[data-tail-error]')).toHaveText('The name can’t end with a dot.');
      await expect(save).toBeDisabled();
      await tailBox(page).fill('_media');
      await expect(page.locator('[data-tail-error]')).toHaveText(
        'Add a counter, for example {###}.',
      );
      await tailBox(page).fill('_{a}_{###}');
      await expect(page.locator('[data-tail-error]')).toContainText('isn’t a token');
      await expect(page.locator('[data-numbering-example]')).toHaveText(
        'Fix the tail to see an example.',
      );

      // The Counter button inserts at the caret and is then disabled.
      await tailBox(page).fill('-M-');
      const counter = page.getByRole('button', { name: 'Insert Counter' });
      await counter.click();
      await expect(tailBox(page)).toHaveValue('-M-{###}');
      await expect(counter).toBeDisabled();
      await expect(page.locator('[data-numbering-example]')).toHaveText('90003-80008-M-001');

      await save.click();
      await expect(
        page.locator('[data-toast]').filter({ hasText: 'Numbering saved' }),
      ).toBeVisible();
      const saved = await admin.get<Json>(`/api/v1/asset-types/${type.assetTypeId}`);
      expect(saved.numbering).toMatchObject({ enabled: true, pattern: '-M-{###}' });

      for (const size of SIZES) {
        await page.setViewportSize(size);
        await noHorizontalScroll(page);
      }
      await shot(page, 'asset-numbering-saved');

      // Turning off asks first.
      await page.getByLabel('Number Assets Automatically').uncheck();
      await save.click();
      const dialog = page.getByRole('dialog', { name: 'Turn Off Numbering' });
      await expect(dialog).toContainText('Numbers already assigned stay');
      await dialog.getByRole('button', { name: 'Turn Off Numbering' }).click();
      await expect(
        page.locator('[data-toast]').filter({ hasText: 'Numbering turned off' }),
      ).toBeVisible();
    } finally {
      await retire(admin, type);
    }
  });

  test('numbered assets: New Asset hint, record page, list column, Next Numbers and Set Next Number', async ({
    page,
    admin,
    seed,
  }) => {
    const type = await admin.post('/api/v1/asset-types', {
      name: `Media ${uid()}`,
      description: null,
      numbering: { enabled: true, pattern: '_{###}' },
    });
    try {
      const matter = await seed.matter();
      await page.setViewportSize({ width: 1366, height: 768 });

      // New Asset: "Assigned on save" and the format, only for a numbered type.
      await page.goto(`/assets/new?matterId=${matter.matterId}`);
      await page.getByRole('button', { name: /Asset Type/ }).click();
      await page.getByRole('option', { name: type.name }).click();
      await expect(page.locator('[data-number-value]')).toHaveText('Assigned on save');
      await expect(page.locator('[data-number-format]')).toContainText(`${matter.matterRef}_###`);
      await page.getByLabel('Display Name').fill(`Folder ${uid()}`);
      await page.getByRole('button', { name: /^Save|Create Asset/ }).click();
      await expect(page).toHaveURL(/\/assets\/\d+$/);
      const number = `${matter.matterRef}_001`;
      await expect(page.locator('[data-asset-number] [data-number-value]')).toHaveText(number);
      await expect(page.getByRole('button', { name: 'Copy asset number' })).toBeVisible();

      // The list: the Asset Number column is a default column and External Reference is off by default.
      await page.goto(`/assets?matter=${matter.matterRef}`);
      await expect(page.getByRole('columnheader', { name: 'Asset Number' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'External Reference' })).toHaveCount(0);
      await expect(page.locator('[data-asset-number-text]').first()).toHaveText(number);
      await shot(page, 'asset-numbering-list');

      // Next Numbers: the counter of the matter, then raised.
      await page.goto(`/admin/asset-types/${type.assetTypeId}?tab=numbering`);
      await expect(page.locator(`[data-next-of="${matter.matterId}"]`)).toHaveText(
        `${matter.matterRef}_002`,
      );
      await expect(page.locator(`[data-highest-of="${matter.matterId}"]`)).toHaveText(number);
      await page.locator(`[data-set-next-of="${matter.matterId}"]`).click();
      const input = page.locator('[data-next-number-input]');
      await expect(input).toHaveValue('2');
      await input.fill('1');
      await page.getByRole('button', { name: 'Set Next Number' }).last().click();
      await expect(page.locator('[data-next-number-error]')).toContainText('can’t be lower than 2');
      await input.fill('120');
      await expect(page.locator('[data-next-number-skipped]')).toHaveText(
        'Numbers 002 to 119 will never be used.',
      );
      await shot(page, 'asset-numbering-set-next');
      await page.getByRole('button', { name: 'Set Next Number' }).last().click();
      await expect(page.locator('[data-next-number-confirm]')).toContainText(
        `${matter.matterRef}_120`,
      );
      await page.locator('[data-confirm-primary] button').click();
      await expect(page.locator(`[data-next-of="${matter.matterId}"]`)).toHaveText(
        `${matter.matterRef}_120`,
      );
    } finally {
      await retire(admin, type);
    }
  });
});
