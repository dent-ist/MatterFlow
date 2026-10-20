import { test as base, expect, Page } from '@playwright/test';
import { ADMIN_USER, Api, BASE_URL } from './api';
import { Personas } from './personas';
import { Seeder } from './seed';

interface TestFixtures {
  /** Account the browser signs in as (Dev auth `X-Dev-User`). Override per file or describe with `test.use({ devUser })`. */
  devUser: string;
  /** Opens a page in a fresh browser context signed in as another user (closed automatically). */
  asUser: (username: string, options?: { timezoneId?: string }) => Promise<Page>;
}

interface WorkerFixtures {
  /** Admin API client for setup (System Admin). */
  admin: Api;
  /** Builders for isolated test data on top of `admin`. */
  seed: Seeder;
  /** People with a known permission set, created through the API (see `support/personas.ts`); sign in with `asUser(persona.username)`. */
  personas: Personas;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  admin: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const api = await Api.as(ADMIN_USER);
      await use(api);
      await api.dispose();
    },
    { scope: 'worker' },
  ],
  seed: [
    async ({ admin }, use) => {
      await use(new Seeder(admin));
    },
    { scope: 'worker' },
  ],

  personas: [
    async ({ seed }, use) => {
      await use(new Personas(seed));
    },
    { scope: 'worker' },
  ],

  devUser: [ADMIN_USER, { option: true }],
  extraHTTPHeaders: async ({ devUser }, use) => {
    await use({ 'X-Dev-User': devUser });
  },

  asUser: async ({ browser }, use) => {
    const contexts: { close(): Promise<void> }[] = [];
    await use(async (username, options = {}) => {
      const context = await browser.newContext({
        baseURL: BASE_URL,
        locale: 'en-US',
        timezoneId: options.timezoneId ?? 'America/New_York',
        viewport: { width: 1440, height: 900 },
        extraHTTPHeaders: { 'X-Dev-User': username },
      });
      contexts.push(context);
      return context.newPage();
    });
    for (const context of contexts) await context.close();
  },
});

export { expect };
