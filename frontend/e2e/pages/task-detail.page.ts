import { expect, Locator, Page } from '@playwright/test';

export type TaskAction = 'START' | 'RESUME' | 'HOLD' | 'COMPLETE' | 'CANCEL' | 'REOPEN';

/** One step of the Workflow section's stepper. */
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

/** Task detail (UX S10): one page with the header, status actions, Workflow and Comments, the Details and Assets side panel and the Activity drawer. */
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
    this.statusMenu = page.locator('[data-task-header] [data-status] [data-inline-trigger]');
  }

  async open(taskId: number): Promise<void> {
    await this.page.goto(`/tasks/${taskId}`);
    await expect(this.header).toBeVisible();
  }

  /** A section of the single-page layout (Workflow and Comments in the main column, Assets in the side panel). */
  section(name: 'Workflow' | 'Comments' | 'Assets'): Locator {
    return this.page.locator(`[data-section="${name.toLowerCase()}"]`);
  }

  /** The Details section of the side panel. */
  get detailsPanel(): Locator {
    return this.page.locator('[data-section="details"]');
  }

  /** The draggable separator between the left column and the Details panel (from 1100 px). */
  get splitter(): Locator {
    return this.page.getByRole('separator', { name: 'Resize Details panel' });
  }

  /** The "Show latest" select of the Comments panel. */
  get commentLimit(): Locator {
    return this.page.getByLabel('Show latest');
  }

  /** Comments on screen (after the "Show latest" limit). */
  get commentItems(): Locator {
    return this.page.locator('[data-comment-id]');
  }

  /** The toggle button of the Comments or Assets bar (a disclosure: aria-expanded / aria-controls). */
  toggle(name: 'Comments' | 'Assets'): Locator {
    return this.section(name).locator('[data-toggle]');
  }

  /** Expands a collapsible section (they start collapsed) and waits until it is open. */
  async ensureOpen(name: 'Comments' | 'Assets'): Promise<void> {
    const toggle = this.toggle(name);
    await toggle.scrollIntoViewIfNeeded();
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }

  ensureCommentsOpen(): Promise<void> {
    return this.ensureOpen('Comments');
  }

  ensureAssetsOpen(): Promise<void> {
    return this.ensureOpen('Assets');
  }

  /** The rich-text editor of the composer: the one-line "Write a comment..." input is clicked first when the composer is collapsed. */
  async composer(): Promise<Locator> {
    await this.ensureCommentsOpen();
    const comments = this.section('Comments');
    const quick = comments.locator('[data-composer-quick]');
    if (await quick.count()) await quick.click();
    const editor = comments.locator('[data-composer] [role=textbox]');
    await expect(editor).toBeFocused();
    return editor;
  }

  /** Brings a section into view, expanding Comments and Assets (collapsed by default), and waits for its heading. */
  async showSection(name: 'Workflow' | 'Comments' | 'Assets'): Promise<void> {
    if (name !== 'Workflow') await this.ensureOpen(name);
    const heading = this.section(name).locator('[data-section-heading]');
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeVisible();
  }

  /** Opens the Activity drawer from the header and returns it. */
  async openActivity(): Promise<Locator> {
    await this.header.locator('[data-activity-button]').click();
    const drawer = this.page.getByRole('dialog', { name: /^Activity:/ });
    await expect(drawer).toBeVisible();
    return drawer;
  }

  /** The status badge text in the header (New, In Progress, On Hold, Completed, Cancelled). */
  async expectStatus(label: string): Promise<void> {
    await expect(this.header).toContainText(new RegExp(`\\b${label}\\b`));
  }

  /** Opens the status menu in the header and returns the item for an action. */
  async menuItem(action: TaskAction): Promise<Locator> {
    if ((await this.statusMenu.getAttribute('aria-expanded')) !== 'true')
      await this.statusMenu.click();
    return this.page.locator(`[data-option="${action}"]`);
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

/** Opens a task and waits until the header, the steps and the (expanded) Comments are there. */
export async function busyTaskPage(page: Page, taskId: number): Promise<void> {
  await page.goto(`/tasks/${taskId}`);
  await expect(page.locator('[data-task-header]')).toBeVisible();
  await expect(page.locator('[data-step-id]').first()).toBeVisible();
  await new TaskDetailPage(page).ensureCommentsOpen();
  await expect(page.locator('[data-comment-id]').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
}
