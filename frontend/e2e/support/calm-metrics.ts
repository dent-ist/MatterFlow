import { Page } from '@playwright/test';

/**
 * What the calm-page budget test measures on a screen (epic #893, issue #924). It is the `measure` function of
 * `docs/ux/my-matters-calm/after/metrics.mjs` (the one that produced every number of the README's before and after tables), run inside the page. It is kept
 * identical on purpose: change one and change the other, or the budgets would stop meaning what the tables say.
 *
 * "Reach" and "seen" (batch 3): the content of a closed `details` (an Options popover) and a skip link that is hidden until it has the focus are not on
 * screen, and neither are the shell's own controls (the logo, search, menu, bell: `main` only), so they are left out of `controlsReach` and `wordsSeen`.
 */
export interface CalmMetrics {
  viewport: string;
  pageHeight: number;
  /** Pixels above the first task row (its top, from the top of the page). */
  firstTaskRowTop: number | null;
  /** Controls in `main` that a person can reach inside the first screen. */
  controlsReach: number;
  /** Words in `main` that a person sees inside the first screen. */
  wordsSeen: number;
  taskLinks: number;
  /** Task ids that appear more than once on the page. */
  repeatedTaskCodes: number;
  horizontalScroll: boolean;
}

export async function calmMetrics(page: Page): Promise<CalmMetrics> {
  return page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    const main = document.querySelector('main') || document.body;
    const vis = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        s.visibility !== 'hidden' &&
        s.display !== 'none' &&
        !el.closest('[hidden]') &&
        !el.closest('.mf-sr-only') &&
        !el.classList.contains('mf-sr-only')
      );
    };
    const inVp = (r: DOMRect): boolean => r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    const sel =
      'a[href], button, input, select, textarea, summary, [role=tab], [role=button], [role=menuitem], [tabindex]:not([tabindex="-1"])';
    const reachable = (el: Element): boolean =>
      !(el.closest('details:not([open])') && el.tagName !== 'SUMMARY') &&
      !el.closest('[data-skip-links], mf-mm-skip-links');
    const controls = [...main.querySelectorAll(sel)]
      .filter(vis)
      .filter(reachable)
      .filter((e) => inVp(e.getBoundingClientRect())).length;
    let words = 0;
    const tw = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = tw.nextNode())) {
      const t = (n.textContent ?? '').trim();
      if (!t) continue;
      const el = n.parentElement;
      if (!el || !vis(el) || el.closest('script,style')) continue;
      if (!reachable(el) || el.closest('[data-page-description]')) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      const rects = [...rg.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (!rects.some(inVp)) continue;
      words += t.split(/\s+/).length;
    }
    const tl = [...main.querySelectorAll('a[href*="/tasks/"]')].filter(vis);
    let top: number | null = null;
    if (tl.length) {
      const row = tl[0].closest('li,tr,[role=row],article,.row') || tl[0];
      top = Math.round(row.getBoundingClientRect().top + scrollY);
    }
    const codes: Record<string, number> = {};
    for (const m of (main as HTMLElement).innerText.matchAll(/TSK-\d+/g))
      codes[m[0]] = (codes[m[0]] || 0) + 1;
    return {
      viewport: `${vw}x${vh}`,
      pageHeight: document.documentElement.scrollHeight,
      firstTaskRowTop: top,
      controlsReach: controls,
      wordsSeen: words,
      taskLinks: tl.length,
      repeatedTaskCodes: Object.values(codes).filter((c) => c > 1).length,
      horizontalScroll: document.documentElement.scrollWidth > vw + 1,
    };
  });
}
