import { expect, Locator, Page } from '@playwright/test';

/** Create Task (UX S09): one page, one call. */
export class CreateTaskPage {
  readonly matter: Locator;
  readonly project: Locator;
  readonly title: Locator;
  readonly description: Locator;
  readonly taskType: Locator;
  readonly requestorName: Locator;
  readonly requestorEmail: Locator;
  readonly priority: Locator;
  readonly dueDate: Locator;
  readonly dueTime: Locator;
  readonly pod: Locator;
  readonly assignee: Locator;
  readonly submit: Locator;
  readonly summary: Locator;
  readonly workflows: Locator;
  readonly requestDetails: Locator;
  readonly sensitiveBanner: Locator;
  readonly pasteBox: Locator;
  readonly fillFromPasted: Locator;

  constructor(readonly page: Page) {
    this.matter = page.getByRole('combobox', { name: 'Matter (required)' });
    this.project = page.getByLabel('Project (optional)');
    this.title = page.getByRole('textbox', { name: 'Title (required)' });
    this.description = page.getByRole('textbox', { name: 'Description' });
    this.taskType = page.getByLabel('Task type (required)');
    this.requestorName = page.getByRole('textbox', { name: 'Requestor name (required)' });
    this.requestorEmail = page.getByRole('textbox', { name: 'Requestor email (optional)' });
    this.priority = page.getByLabel('Priority (required)');
    this.dueDate = page.getByLabel('Due date (optional)');
    this.dueTime = page.getByLabel('Time (optional)');
    this.pod = page.getByLabel('Pod (optional)');
    this.assignee = page.getByRole('combobox', { name: 'Assignee (optional)' });
    this.submit = page.getByRole('button', { name: 'Create task', exact: true });
    this.summary = page.locator('[data-summary]');
    this.workflows = page.locator('[data-workflows]');
    this.requestDetails = page.locator('[data-request-details]');
    this.sensitiveBanner = page.locator('[data-sensitive-banner]');
    this.pasteBox = page.getByRole('textbox', { name: 'Paste email text' });
    this.fillFromPasted = page.getByRole('button', { name: /Fill from pasted text/ });
  }

  async open(query = ''): Promise<void> {
    await this.page.goto(`/tasks/new${query}`);
    await expect(this.page.getByRole('heading', { name: 'Create Task', level: 1 })).toBeVisible();
    await expect(this.title).toBeVisible();
  }

  /** Types a matter reference (padded or not) and picks the suggestion that starts with the full reference. */
  async pickMatter(typed: string, matterRef: string): Promise<void> {
    await this.matter.fill(typed);
    await this.page.getByRole('option', { name: new RegExp(`^${matterRef}\\b`) }).click();
    await expect(this.page.locator('[data-chosen]').first()).toContainText(matterRef);
  }

  async chooseTaskType(name: string): Promise<void> {
    await this.taskType.selectOption({ label: name });
    await expect(this.workflows).toBeVisible();
  }

  workflowChoice(name: string): Locator {
    return this.workflows.getByRole('radio', { name: new RegExp(name) });
  }

  /** The field rendered by the form engine for a request-form field key. */
  field(key: string): Locator {
    return this.page.locator(`[data-field="${key}"]`);
  }

  /** Fills the mandatory parts for an existing matter and task type; the workflow is left to the page default. */
  async fillBasics(opts: {
    matterRef: string;
    typed?: string;
    taskType: string;
    title: string;
    requestor?: string;
  }): Promise<void> {
    await this.pickMatter(opts.typed ?? opts.matterRef, opts.matterRef);
    await this.title.fill(opts.title);
    await this.chooseTaskType(opts.taskType);
    await this.requestorName.fill(opts.requestor ?? 'Rita Requestor');
  }

  /** Creates the task and returns its id from the URL of the opened detail page. */
  async create(): Promise<number> {
    await this.submit.click();
    await expect(this.page).toHaveURL(/\/tasks\/\d+$/);
    return Number(this.page.url().split('/').pop());
  }
}
