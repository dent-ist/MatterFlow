import { Page } from '@playwright/test';

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
