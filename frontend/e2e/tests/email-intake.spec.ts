import path from 'node:path';
import { CreateTaskPage } from '../pages/create-task.page';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

const SAMPLES = path.join(__dirname, '..', 'fixtures', 'email');

const PASTED = [
  'From: Linda Cho <linda.cho@example-firm.test>',
  'Sent: Tuesday, October 13, 2026 9:05 AM',
  'To: Nora Beck',
  'Subject: Process the Jones mailbox into the Smith workspace by end of day',
  '',
  'Hi Nora,',
  '',
  'Please process the Jones mailbox into the Smith workspace by end of day.',
  'We have a meet-and-confer tomorrow.',
  '',
  'Linda',
].join('\n');

test.describe('Create a task from an Outlook email (SCN-017)', () => {
  test('SCN-017: pasting an email block fills title, description and requestor and leaves type and workflow open', async ({
    page,
  }) => {
    const create = new CreateTaskPage(page);
    await create.open();

    await create.pasteBox.fill(PASTED);
    await create.fillFromPasted.click();
    await expect(page.locator('[data-review]')).toBeVisible();
    await page.getByRole('button', { name: 'Fill the task' }).click();

    await expect(create.title).toHaveValue('Process the Jones mailbox into the Smith workspace by end of day');
    await expect(create.description).toHaveValue(/Please process the Jones mailbox/);
    await expect(create.requestorName).toHaveValue('Linda Cho');
    await expect(create.requestorEmail).toHaveValue('linda.cho@example-firm.test');
    await expect(page.locator('[data-source-sent]')).toContainText('Oct 13, 2026');

    // Nothing the email cannot decide is chosen for the user, and everything stays editable.
    await expect(create.taskType).toHaveValue('');
    await expect(create.workflows).toHaveCount(0);
    await expect(page.locator('[data-chosen]')).toHaveCount(0);
    await create.title.fill('Process Jones mailbox (edited)');
    await expect(create.title).toHaveValue('Process Jones mailbox (edited)');
  });

  test('SCN-017: a pasted email becomes a real task once matter and type are chosen', async ({ page, seed, admin }) => {
    const world = await seed.world();
    const create = new CreateTaskPage(page);
    await create.open();
    await create.pasteBox.fill(PASTED);
    await create.fillFromPasted.click();
    await page.getByRole('button', { name: 'Fill the task' }).click();

    await create.pickMatter(world.matter.matterRef, world.matter.matterRef);
    await create.chooseTaskType(world.taskType.name);
    const taskId = await create.create();

    const task = await admin.get(`/api/v1/tasks/${taskId}`);
    expect(task.requestorName).toBe('Linda Cho');
    expect(task.requestorEmail).toBe('linda.cho@example-firm.test');
    expect(task.title).toContain('Jones mailbox');
    expect(task.requestedAtUtc).toMatch(/^2026-10-13T/);
  });

  test('SCN-017: a saved .eml file is read and its attachment is ignored', async ({ page }) => {
    const create = new CreateTaskPage(page);
    await create.open();

    await page.getByLabel('Choose an .eml or .msg file').setInputFiles(path.join(SAMPLES, '03-multipart-attachment.eml'));
    await expect(page.locator('[data-review]')).toBeVisible();
    await page.getByRole('button', { name: 'Fill the task' }).click();

    await expect(create.title).toHaveValue('Search term report attached');
    await expect(create.requestorName).toHaveValue('Raj Patel');
    await expect(create.requestorEmail).toHaveValue('raj.patel@example-firm.test');
    await expect(create.description).toHaveValue(/Report attached\. Hit counts are in the second tab\./);
    await expect(create.description).not.toHaveValue(/report\.xlsx/);
    await expect(page.locator('[data-source-sent]')).toContainText('Oct 14, 2026');
  });

  test('SCN-017: a plain email file keeps the time of the Date header in the viewer time zone', async ({ page }) => {
    const create = new CreateTaskPage(page);
    await create.open();
    await page.getByLabel('Choose an .eml or .msg file').setInputFiles(path.join(SAMPLES, '01-plain.eml'));
    await page.getByRole('button', { name: 'Fill the task' }).click();

    await expect(create.title).toHaveValue('Production volume 7 - request for load file');
    await expect(create.requestorName).toHaveValue('Jane Doe');
    await expect(page.locator('[data-source-sent]')).toContainText('9:15 AM');
  });

  test('SCN-017: every sample email parses through the API to subject, sender and body', async ({ admin }) => {
    const expected: Record<string, { subject: RegExp; from: RegExp }> = {
      '01-plain.eml': { subject: /^Production volume 7/, from: /^jane\.doe@/ },
      '02-html-only.eml': { subject: /./, from: /@example-firm\.test$/ },
      '03-multipart-attachment.eml': { subject: /^Search term report/, from: /^raj\.patel@/ },
      '04-utf8-subject.eml': { subject: /^Akten/, from: /^juergen\.mueller@/ },
      '05-forwarded-chain.eml': { subject: /^FW: FW:/, from: /^maria\.gomez@/ },
    };
    for (const [file, want] of Object.entries(expected)) {
      const parsed = await admin.upload('/api/v1/intake/parse-email', 'file', path.join(SAMPLES, file));
      expect(parsed.status, file).toBe(200);
      expect(parsed.body.subject, file).toMatch(want.subject);
      expect(parsed.body.fromEmail, file).toMatch(want.from);
      expect(parsed.body.body, file).not.toBe('');
      expect(JSON.stringify(parsed.body), file).not.toContain('report.xlsx');
    }
  });

  test('the paste box needs text and the file box refuses something that is not an email', async ({ page }) => {
    const create = new CreateTaskPage(page);
    await create.open();
    await expect(create.fillFromPasted).toBeDisabled();

    await page.getByLabel('Choose an .eml or .msg file').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(`not an email ${uid()}`),
    });
    await expect(page.locator('[data-error], [data-empty]').first()).toBeVisible();
    await expect(create.title).toHaveValue('');
  });
});
