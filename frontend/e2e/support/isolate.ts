import { Page } from '@playwright/test';

/**
 * Layout specs measure a toolbar or a filter row built from the priority list. The suite itself adds priorities as it runs (the Labels
 * specs), some with long names, which widens a select and wraps a one-line toolbar on a database the suite has used. A layout spec calls this
 * so the page is given the four default priorities, as on a new installation, and what is measured is the layout and not the leftovers.
 * Call before `goto`. Only what the page reads is replaced (the priority list and the priorities of the workload answer); nothing is written.
 */
export async function onlyDefaultPriorities(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === '/api/v1/priorities',
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const all = (await response.json()) as { label: string }[];
      const defaults = ['Critical', 'High', 'Normal', 'Low'];
      await route.fulfill({ response, json: all.filter((p) => defaults.includes(p.label)) });
    },
  );
  // The Dashboard Users tab gets the priorities it shows (toolbar choices, legend, per-person counts) inside the workload answer.
  await page.route(
    (url) => url.pathname === '/api/v1/dashboard/workload',
    async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { priorities?: { label: string }[] };
      if (body.priorities) {
        const defaults = ['Critical', 'High', 'Normal', 'Low'];
        body.priorities = body.priorities.filter((p) => defaults.includes(p.label));
      }
      await route.fulfill({ response, json: body });
    },
  );
}
