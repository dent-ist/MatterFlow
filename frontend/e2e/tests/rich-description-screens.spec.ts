import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { CreateTaskPage } from '../pages/create-task.page';
import { TaskDetailPage } from '../pages/task-detail.page';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * Screenshots for docs/ux/rich-description (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/rich-description frontend/e2e/run-local.sh -g "rich description screenshots"
 * Photographs the rich text description at 1366x768 and 375x812: pasting a table in Create task (editor with its table toolbar), the saved
 * table in the Details panel, the Edit dialog, and an email file whose table is kept. With axe available every shot is also checked.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SAMPLES = path.join(__dirname, '..', 'fixtures', 'email');
const SIZES = [
  { name: '1366', width: 1366, height: 768 },
  { name: '375', width: 375, height: 812 },
];

const TABLE = `<p>Hi Nora, please process these custodians into the Harbor Point workspace by Friday, 5 pm Eastern.</p>
<table><thead><tr><th scope="col">Custodian</th><th scope="col">Source</th><th scope="col">Batch</th><th scope="col">Volume (GB)</th><th scope="col">Notes</th></tr></thead>
<tbody>
<tr><td>Anna Weller</td><td>Exchange mailbox</td><td>B-001</td><td>14.2</td><td>Includes archive and recoverable items; check the journaling rules before loading</td></tr>
<tr><td>Marcus Okafor</td><td>Laptop image</td><td>B-001</td><td>220.8</td><td>User profile folders only; skip system and program files</td></tr>
<tr><td>Priya Raman</td><td>Teams export</td><td>B-002</td><td>3.9</td><td>Channel messages and chats; attachments are separate files</td></tr>
<tr><td colspan="2">Jonas Lindqvist and Elena Petrova</td><td>B-003</td><td>137.4</td><td>Shared drive folders 04 to 11 only; iOS backup, texts only</td></tr>
</tbody></table>
<p>If anything fails QC, tell me before you re-run it. Do not delete the original load files.</p>`;

async function shoot(page: Page, name: string, fullPage = false): Promise<void> {
  // A toast ("Task created") would cover part of the page.
  for (const close of await page.locator('.p-toast-close-button').all()) await close.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT!, `${name}.png`), fullPage });
}

test.describe('rich description screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, seed }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(OUT!, { recursive: true });
    const world = await seed.world();
    const problems: string[] = [];
    const check = async (label: string, include?: string): Promise<void> => {
      if (!axeAvailable()) return;
      for (const v of await axeViolations(page, include)) {
        problems.push(
          `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        );
      }
    };

    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });

      // 1. Create task: a table pasted from Outlook, the caret in a cell, the table toolbar showing.
      const create = new CreateTaskPage(page);
      await create.open(`?taskType=${world.taskType.id}`);
      await create.fillBasics({
        matterRef: world.matter.matterRef,
        taskType: world.taskType.name,
        title: 'Process Harbor Point custodians',
      });
      await page.evaluate(
        (html) => {
          const target = document.querySelector<HTMLElement>(
            '[data-description-field] [role=textbox]',
          )!;
          target.focus();
          const data = new DataTransfer();
          data.setData('text/html', html);
          data.setData('text/plain', 'table');
          target.dispatchEvent(
            new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
          );
        },
        TABLE.replace(/<table>/, '<table class="MsoTableGrid" style="border-collapse:collapse">'),
      );
      await expect(create.description.locator('table')).toHaveCount(1);
      await create.description.locator('td').first().click();
      await expect(page.locator('[data-table-tools]')).toBeVisible();
      await page.locator('[data-description-field]').scrollIntoViewIfNeeded();
      await shoot(page, `create-editor-${size.name}`);
      await check(`create ${size.name}`, '[data-description-field]');

      const insert = page
        .locator('[data-description-field]')
        .getByRole('button', { name: 'Insert table' });
      await insert.click();
      await shoot(page, `create-insert-table-${size.name}`);
      await page.keyboard.press('Escape');

      // 2. The saved task: the table in the Details panel (and the whole page on a phone).
      const taskId = await create.create();
      const detail = new TaskDetailPage(page);
      // On a phone the Details panel starts collapsed behind a disclosure button.
      if (size.width < 700) {
        const toggle = page.locator('[data-detail-toggle]');
        await toggle.waitFor();
        if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      }
      await expect(page.locator('[data-description] table')).toBeVisible();
      await shoot(page, `details-${size.name}`);
      await check(`details ${size.name}`, '[data-description]');

      // 3. The Edit dialog with the same table in the editor.
      await detail.openEdit();
      await expect(page.locator('[data-edit-form] [data-description-editor] table')).toBeVisible();
      await page.locator('[data-edit-form] [data-description-editor] td').first().click();
      await shoot(page, `edit-dialog-${size.name}`);
      await check(`edit ${size.name}`, '[data-edit-form]');
      await page.keyboard.press('Escape');
      await detail.open(taskId);
    }

    // 4. An email file whose table is kept (review step), once at the desktop size.
    await page.setViewportSize({ width: 1366, height: 768 });
    const create = new CreateTaskPage(page);
    await create.open(`?taskType=${world.taskType.id}`);
    await create.showEmailPanel();
    await page
      .getByLabel('Choose an .eml or .msg file')
      .setInputFiles(path.join(SAMPLES, '06-html-table.eml'));
    await expect(page.locator('[data-review] [data-ei-description] table')).toBeVisible();
    await page.locator('[data-review]').scrollIntoViewIfNeeded();
    await shoot(page, 'email-intake-review-1366');
    await check('email review', '[data-email-intake]');

    expect(problems).toEqual([]);
  });
});
