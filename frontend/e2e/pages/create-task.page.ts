import { expect, Locator, Page } from '@playwright/test';

/**
 * Create task (UX S09): type first. The page opens on the grid of Task Type cards (`chooser`); choosing a card reveals the form with
 * the type as a header chip (`typeChip`). `?taskType=<id>` skips the chooser. Always `chooseTaskType` before touching form fields.
 */
export class CreateTaskPage {
  readonly matter: Locator;
  readonly project: Locator;
  readonly title: Locator;
  readonly description: Locator;
  readonly chooser: Locator;
  readonly typeChip: Locator;
  readonly changeType: Locator;
  readonly typeSearch: Locator;
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
    this.project = page.getByLabel('Project', { exact: true });
    this.title = page.getByRole('textbox', { name: 'Title (required)' });
    this.description = page.getByRole('textbox', { name: 'Description' });
    this.chooser = page.locator('[data-type-chooser]');
    this.typeChip = page.locator('[data-type-chip]');
    this.changeType = page.getByRole('button', { name: 'Change type' });
    this.typeSearch = page.getByRole('searchbox', { name: 'Search task types' });
    this.requestorName = page.getByRole('textbox', { name: 'Requestor name (required)' });
    this.requestorEmail = page.getByRole('textbox', { name: 'Requestor email', exact: true });
    this.priority = page.getByLabel('Priority (required)');
    this.dueDate = page.getByLabel('Due date', { exact: true });
    this.dueTime = page.getByLabel(/^Time \(/);
    this.pod = page.getByLabel('Pod', { exact: true });
    this.assignee = page.getByRole('combobox', { name: 'Assignee', exact: true });
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
    await expect(this.page.getByRole('heading', { name: 'Create task', level: 1 })).toBeVisible();
    // Either the chooser or (deep link / prefilled type) the form is up.
    await expect(this.chooser.or(this.title)).toBeVisible();
  }

  /** The card of a task type in the chooser (a radio in the "What kind of task is this?" group). */
  typeCard(name: string): Locator {
    return this.chooser.getByRole('radio', {
      name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    });
  }

  /** The "Quick fill from email" panel starts collapsed (UXR-38); opens it unless it is already open. */
  async showEmailPanel(): Promise<void> {
    const toggle = this.page.getByRole('button', { name: 'Fill from email' });
    if (await toggle.isVisible()) await toggle.click();
    await expect(this.pasteBox).toBeVisible();
  }

  /** Types a matter reference (padded or not) and picks the suggestion that starts with the full reference. */
  async pickMatter(typed: string, matterRef: string): Promise<void> {
    await this.matter.fill(typed);
    await this.page.getByRole('option', { name: new RegExp(`^${matterRef}\\b`) }).click();
    await expect(this.page.locator('[data-chosen]').first()).toContainText(matterRef);
  }

  /** Clicks the type's card; the form (with the workflow choice) appears. A no-op when that type is already chosen. */
  async chooseTaskType(name: string): Promise<void> {
    if (!(await this.typeChip.isVisible())) await this.typeCard(name).click();
    await expect(this.typeChip).toContainText(name);
    await expect(this.workflows).toBeVisible();
  }

  workflowChoice(name: string): Locator {
    return this.workflows.getByRole('radio', { name: new RegExp(name) });
  }

  /** The label line of a workflow choice (name, version, step count, ordered or not). */
  workflowLabel(name: string): Locator {
    return this.workflows.locator('label').filter({ hasText: name });
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
    await this.chooseTaskType(opts.taskType);
    await this.pickMatter(opts.typed ?? opts.matterRef, opts.matterRef);
    await this.title.fill(opts.title);
    await this.requestorName.fill(opts.requestor ?? 'Rita Requestor');
  }

  /** Creates the task and returns its id from the URL of the opened detail page. */
  async create(): Promise<number> {
    await this.submit.click();
    await expect(this.page).toHaveURL(/\/tasks\/\d+$/);
    return Number(this.page.url().split('/').pop());
  }
}
