import { expect, Locator, Page } from '@playwright/test';

export type TaskAction = 'START' | 'RESUME' | 'HOLD' | 'COMPLETE' | 'CANCEL' | 'REOPEN';

/** One step of the Workflow tab stepper. */
export class StepPanel {
  readonly root: Locator;

  constructor(
    readonly page: Page,
    readonly title: string,
  ) {
    this.root = page
      .locator('[data-step-id]')
      .filter({ has: page.getByRole('heading', { name: new RegExp(`\\. ${title}(\\s|$)`) }) });
  }

  get state(): Locator {
    return this.root.locator('[data-state]');
  }
  get toggle(): Locator {
    return this.root.getByRole('button', { name: new RegExp(`^\\d+\\. ${this.title}(\\s|$)`) });
  }
  get startButton(): Locator {
    return this.root.locator('[data-start]');
  }
  get completeButton(): Locator {
    return this.root.locator('[data-complete]');
  }
  get skipButton(): Locator {
    return this.root.locator('[data-skip]');
  }
  get reopenButton(): Locator {
    return this.root.locator('[data-reopen]');
  }
  get error(): Locator {
    return this.root.locator('[data-step-error]');
  }
  get locked(): Locator {
    return this.root.locator('[data-locked]');
  }
  get reopenedFlag(): Locator {
    return this.root.locator('[data-reopened]');
  }

  /** Opens the step body when it is collapsed. */
  async expand(): Promise<void> {
    if ((await this.toggle.getAttribute('aria-expanded')) !== 'true') await this.toggle.click();
    await expect(this.toggle).toHaveAttribute('aria-expanded', 'true');
  }

  async complete(): Promise<void> {
    await this.expand();
    await this.completeButton.click();
  }

  /** Answers the skip dialog: optional comment, then confirm. */
  async skip(comment?: string): Promise<void> {
    await this.expand();
    await this.skipButton.click();
    const dialog = this.page.getByRole('dialog');
    if (comment !== undefined) await dialog.getByRole('textbox', { name: /Comment/ }).fill(comment);
    await dialog.getByRole('button', { name: 'Skip step' }).click();
  }

  async reopen(): Promise<void> {
    await this.expand();
    await this.reopenButton.click();
    await this.page.getByRole('dialog').getByRole('button', { name: 'Reopen step' }).click();
  }
}

/** Task detail (UX S10): header, status actions and the Details / Workflow / Comments / Assets / Activity tabs. */
export class TaskDetailPage {
  readonly header: Locator;
  readonly number: Locator;
  readonly titleText: Locator;
  readonly due: Locator;
  readonly assignee: Locator;
  readonly pod: Locator;
  readonly progress: Locator;
  readonly statusMenu: Locator;

  constructor(readonly page: Page) {
    this.header = page.locator('[data-task-header]');
    this.number = page.locator('[data-task-number]');
    this.titleText = page.locator('[data-task-title]');
    this.due = page.locator('[data-due]');
    this.assignee = page.locator('[data-assignee]');
    this.pod = page.locator('[data-pod]');
    this.progress = page.locator('[data-progress]').first();
    this.statusMenu = page.locator('[data-status-menu]');
  }

  async open(taskId: number): Promise<void> {
    await this.page.goto(`/tasks/${taskId}`);
    await expect(this.header).toBeVisible();
  }

  tab(name: 'Details' | 'Workflow' | 'Comments' | 'Assets' | 'Activity'): Locator {
    return this.page.getByRole('tab', { name: new RegExp(`^${name}`) });
  }

  async showTab(name: 'Details' | 'Workflow' | 'Comments' | 'Assets' | 'Activity'): Promise<void> {
    await this.tab(name).click();
    await expect(this.tab(name)).toHaveAttribute('aria-selected', 'true');
  }

  /** The status badge text in the header (New, In Progress, On Hold, Completed, Cancelled). */
  async expectStatus(label: string): Promise<void> {
    await expect(this.header).toContainText(new RegExp(`\\b${label}\\b`));
  }

  /** Opens the Change status menu and returns the item for an action. */
  async menuItem(action: TaskAction): Promise<Locator> {
    if ((await this.statusMenu.getAttribute('aria-expanded')) !== 'true')
      await this.statusMenu.click();
    return this.page.locator(`[data-action="${action}"]`);
  }

  async chooseAction(action: TaskAction): Promise<void> {
    await (await this.menuItem(action)).click();
  }

  step(title: string): StepPanel {
    return new StepPanel(this.page, title);
  }

  get dialog(): Locator {
    return this.page.getByRole('dialog');
  }

  get completeTaskButton(): Locator {
    return this.page.locator('[data-complete-task-button]');
  }

  /** Reason / comment dialog used by Put on hold and Cancel task. */
  async submitReason(confirmLabel: string, text?: string): Promise<void> {
    if (text !== undefined) await this.dialog.getByRole('textbox').fill(text);
    await this.dialog.getByRole('button', { name: confirmLabel }).click();
  }
}
