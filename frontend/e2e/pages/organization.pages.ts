import { expect, Locator, Page } from '@playwright/test';

/** Clients: list, create form and detail (UX S05). */
export class ClientFormPage {
  readonly number: Locator;
  readonly name: Locator;
  readonly save: Locator;
  readonly summary: Locator;
  readonly numberError: Locator;

  constructor(readonly page: Page) {
    this.number = page.getByRole('textbox', { name: 'Client number' });
    this.numberError = page.locator('#client-number-error');
    this.name = page.getByRole('textbox', { name: 'Client name' });
    this.save = page.getByRole('button', { name: 'Save client' });
    this.summary = page.locator('[data-summary]');
  }

  async open(): Promise<void> {
    await this.page.goto('/clients/new');
    await expect(this.page.getByRole('heading', { name: 'New Client' })).toBeVisible();
  }

  async fill(number: string, name: string): Promise<void> {
    await this.number.fill(number);
    await this.name.fill(name);
  }

  /** Fills and saves; on success the app opens the client detail page. */
  async create(number: string, name: string): Promise<void> {
    await this.fill(number, name);
    await this.save.click();
  }
}

/** Matters: create form (UX S06) and the detail header. */
export class MatterFormPage {
  readonly client: Locator;
  readonly number: Locator;
  readonly name: Locator;
  readonly sensitive: Locator;
  readonly save: Locator;
  readonly summary: Locator;

  constructor(readonly page: Page) {
    this.client = page.getByRole('combobox', { name: 'Client (required)' });
    this.number = page.getByRole('textbox', { name: 'Matter number' });
    this.name = page.getByRole('textbox', { name: 'Matter name' });
    this.sensitive = page.getByRole('checkbox', { name: /Sensitive matter/ });
    this.save = page.getByRole('button', { name: 'Save matter' });
    this.summary = page.locator('[data-summary]');
  }

  async open(): Promise<void> {
    await this.page.goto('/matters/new');
    await expect(this.page.getByRole('heading', { name: 'New Matter' })).toBeVisible();
  }

  /** Picks the client by typing its number and choosing the suggestion. */
  async pickClient(clientNumber: string): Promise<void> {
    await this.client.fill(clientNumber);
    await this.page.getByRole('option', { name: new RegExp(`^${clientNumber}\\b`) }).click();
  }

  async create(clientNumber: string, matterNumber: string, name: string): Promise<void> {
    await this.pickClient(clientNumber);
    await this.number.fill(matterNumber);
    await this.name.fill(name);
    await this.save.click();
  }

  /** The matter reference shown in the heading of the matter detail page. */
  heading(): Locator {
    return this.page.getByRole('heading', { level: 1 });
  }
}
