import { expect, Locator, Page } from '@playwright/test';

/** Shared behaviour of the three work lists (Task Queue, My Work, Pod Work): a table of rows keyed by task number. */
export class WorkListPage {
  readonly table: Locator;
  readonly status: Locator;

  constructor(readonly page: Page) {
    this.table = page.getByRole('table', { name: /Task Queue|My Work|Pod Work/ });
    this.status = page.getByRole('status').filter({ hasText: /Showing|No tasks/ });
  }

  /** The row of a task, by task number (`TSK-12`) or by exact title. */
  row(taskNumberOrTitle: string): Locator {
    return /^TSK-\d+$/.test(taskNumberOrTitle)
      ? this.page.locator(`tr[data-task="${taskNumberOrTitle}"]`)
      : this.page.locator('tr[data-task]').filter({ hasText: taskNumberOrTitle });
  }

  async expectListed(...titles: string[]): Promise<void> {
    for (const title of titles) await expect(this.row(title)).toHaveCount(1);
  }

  async expectNotListed(...titles: string[]): Promise<void> {
    for (const title of titles) await expect(this.row(title)).toHaveCount(0);
  }

  /** The Title or Ref column filter (the filter row is open by default on the work lists). */
  get titleFilter(): Locator {
    return this.page.getByRole('textbox', { name: 'Filter by Title or Ref' });
  }

  /** Filters by title or reference so the row of interest is on the first page whatever else is in the shared database. */
  async search(text: string): Promise<void> {
    const box = this.titleFilter;
    await box.fill(text);
    await box.press('Enter');
  }
}

export class TaskQueuePage extends WorkListPage {
  async open(query = ''): Promise<void> {
    await this.page.goto(`/tasks${query}`);
    await expect(this.page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
  }

  quickView(name: string): Locator {
    return this.page.getByRole('toolbar', { name: 'Quick views' }).getByRole('button', { name });
  }
}

export class MyWorkPage extends WorkListPage {
  async open(query = ''): Promise<void> {
    await this.page.goto(`/my-work${query}`);
    await expect(this.page.getByRole('heading', { name: 'My Work', level: 1 })).toBeVisible();
  }

  tab(name: RegExp | string): Locator {
    return this.page.getByRole('tablist', { name: 'My Work views' }).getByRole('tab', { name });
  }
}

export class PodWorkPage extends WorkListPage {
  readonly podSelect: Locator;

  constructor(page: Page) {
    super(page);
    this.podSelect = page.getByLabel('Pod', { exact: true });
  }

  async open(): Promise<void> {
    await this.page.goto('/pods/work');
    await expect(this.page.getByRole('heading', { name: 'Pod Work', level: 1 })).toBeVisible();
  }

  async choosePod(name: string): Promise<void> {
    await this.podSelect.selectOption({ label: name });
    await expect(this.podSelect.locator('option:checked')).toContainText(name);
  }

  tab(name: RegExp | string): Locator {
    return this.page.getByRole('tablist', { name: 'Pod Work views' }).getByRole('tab', { name });
  }

  assignToMe(taskNumber: string): Locator {
    return this.page.getByRole('button', { name: `Assign ${taskNumber} to me`, exact: true });
  }
}
