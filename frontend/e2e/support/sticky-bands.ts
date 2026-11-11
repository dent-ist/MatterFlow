import { Page } from '@playwright/test';
import { Api } from './api';
import { Seeder, uid } from './seed';

/**
 * The two header bands of a shared grid (#1259): after the grid scrolled down and sideways, EVERY heading cell must still be sticky at the top
 * of the scrolling region, EVERY filter cell (when the filter row is open) right under the headings, each opaque and not covered by a row cell.
 * Returns one line per problem, so a failing test says which cell broke and how.
 */
export async function stickyBandProblems(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const problems: string[] = [];
    const tables = [...document.querySelectorAll('main table')].filter(
      (t) =>
        (t as HTMLElement).offsetParent &&
        t.querySelector('thead th') &&
        t.querySelectorAll('tbody tr').length > 3,
    );
    if (!tables.length) return ['no grid with more than three rows'];
    for (const table of tables) {
      let scroller = table.parentElement;
      while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY))
        scroller = scroller.parentElement;
      if (!scroller) {
        problems.push('no scrolling region around the grid');
        continue;
      }
      scroller.scrollTop = 140;
      scroller.scrollLeft = scroller.scrollWidth;
      await wait(300);
      const box = scroller.getBoundingClientRect();
      const headings = table.querySelector('thead tr:first-child') as HTMLElement;
      const filters = table.querySelector('thead .mf-filter-row') as HTMLElement | null;
      const band = (cells: Element[], top: number, name: string) => {
        for (const cell of cells) {
          const el = cell as HTMLElement;
          if (!el.offsetParent) continue;
          const label = `${name} "${(el.textContent ?? '').trim().slice(0, 14)}"`;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          if (style.position !== 'sticky') problems.push(`${label}: position ${style.position}`);
          if (Math.abs(rect.top - top) > 1.5)
            problems.push(
              `${label}: top ${Math.round(rect.top - box.top)} px, want ${Math.round(top - box.top)} px`,
            );
          if (
            style.backgroundColor === 'rgba(0, 0, 0, 0)' ||
            style.backgroundColor === 'transparent'
          )
            problems.push(`${label}: transparent background`);
          if (rect.right > box.left + 1 && rect.left < box.right - 1) {
            const x = Math.min(Math.max(rect.left + rect.width / 2, box.left + 2), box.right - 2);
            const hit = document.elementFromPoint(x, rect.top + rect.height / 2);
            if (hit && !el.contains(hit))
              problems.push(`${label}: covered by ${hit.tagName.toLowerCase()}`);
          }
        }
      };
      band([...headings.children], box.top, 'heading');
      if (filters)
        band([...filters.children], box.top + headings.getBoundingClientRect().height, 'filter');
    }
    return problems;
  });
}

/**
 * Makes sure every list that `stickyBandProblems` looks at has MORE THAN THREE rows (E2E #1359). The check needs a scrolling grid; a list with three rows or fewer has
 * nothing to scroll and the helper answered "no grid with more than three rows", so the spec passed or failed with whatever the other specs of its CI shard had left
 * behind (28 failures in the first full run, 4 in the second, all Projects). Call it once in a `beforeAll`: it creates four clients with a matter, a workflow and a task
 * type each (Clients, Matters, Workflows, Task Types and Steps lists), four projects, four assets and four tasks assigned to the System Admin (Projects, Assets, Task
 * Queue and My Work), four people and four pods (Users, Pods) and four asset types. It only adds records, so it is safe next to other specs.
 */
export async function seedStickyBandRows(seed: Seeder, admin: Api, rows = 4): Promise<void> {
  const me = await admin.get<{ userId: number }>('/api/v1/me');
  const worlds = [];
  for (let i = 0; i < rows; i++) worlds.push(await seed.world());
  const first = worlds[0];
  for (let i = 0; i < rows; i++) {
    await seed.project(first.matter, `Sticky Project ${uid()}`);
    await seed.asset(first.matter, `Sticky Asset ${uid()}`);
    await seed.task(first, { title: `Sticky Task ${uid()}`, assignedUserId: me.userId });
    await admin.post('/api/v1/asset-types', {
      name: `Sticky Asset Type ${uid()}`,
      description: null,
    });
  }
  for (let i = 0; i < rows; i++) {
    const person = await seed.user([], 'sticky');
    await seed.pod(`Sticky Pod ${uid()}`, [person.userId]);
  }
}
