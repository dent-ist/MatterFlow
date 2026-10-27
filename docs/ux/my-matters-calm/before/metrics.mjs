// Runs inside the page. Returns measurements for what is shown at load (viewport) and on the whole page.
export const measure = () => {
  const vw = innerWidth, vh = innerHeight;
  const main = document.querySelector('main') || document.body;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden]') && !el.closest('.mf-sr-only') && !(el.classList && el.classList.contains('mf-sr-only')); };
  const inVp = (r) => r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  const sel = 'a[href], button, input, select, textarea, summary, [role=tab], [role=button], [role=menuitem], [tabindex]:not([tabindex="-1"])';
  const ctl = (root) => [...root.querySelectorAll(sel)].filter(vis);
  const cMain = ctl(main), cAll = ctl(document.body);
  const words = (root, onlyVp) => {
    let w = 0, lines = new Set();
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      const t = n.textContent.trim(); if (!t) continue;
      const el = n.parentElement; if (!el || !vis(el) || el.closest('script,style')) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const rects = [...rg.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      if (onlyVp && !rects.some(inVp)) continue;
      w += t.split(/\s+/).length;
      for (const r of rects) { if (!onlyVp || inVp(r)) lines.add(Math.round(r.top + scrollY) + ':' + Math.round(r.left / 300)); }
    }
    return { words: w, lines: new Set([...lines].map((k) => k.split(':')[0])).size };
  };
  const wVp = words(main, true), wAll = words(main, false);
  // first task row: first link to a task inside main
  const tl = [...main.querySelectorAll('a[href*="/tasks/"]')].filter(vis);
  let firstRowTop = null, firstRowBottom = null;
  if (tl.length) { const row = tl[0].closest('li,tr,[role=row],article,.row') || tl[0]; const r = row.getBoundingClientRect(); firstRowTop = Math.round(r.top + scrollY); firstRowBottom = Math.round(r.bottom + scrollY); }
  const codes = {}; for (const m of main.innerText.matchAll(/TSK-\d+/g)) codes[m[0]] = (codes[m[0]] || 0) + 1;
  const rep = Object.values(codes).filter((n) => n > 1);
  const mainTop = Math.round(main.getBoundingClientRect().top + scrollY);
  // above-the-fold usable height: viewport minus shell header
  return {
    viewport: `${vw}x${vh}`, pageHeight: document.documentElement.scrollHeight,
    pxAboveFirstTaskRow: firstRowTop, firstRowBottom, mainTop,
    controlsInViewport: cMain.filter((e) => inVp(e.getBoundingClientRect())).length,
    controlsInViewportWholeScreen: cAll.filter((e) => inVp(e.getBoundingClientRect())).length,
    controlsOnPage: cMain.length,
    wordsInViewport: wVp.words, textLinesInViewport: wVp.lines, wordsOnPage: wAll.words, textLinesOnPage: wAll.lines,
    taskLinks: tl.length, distinctTaskCodes: Object.keys(codes).length, repeatedTaskCodes: rep.length, repeatedExtraOccurrences: rep.reduce((a, n) => a + n - 1, 0),
    horizontalScroll: document.documentElement.scrollWidth > vw + 1,
  };
};
